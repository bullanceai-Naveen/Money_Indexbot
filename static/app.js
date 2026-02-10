/**
 * Index OI Scanner - Frontend Application
 * v1.0
 */

class IndexScannerApp {
    constructor() {
        this.data = {
            dashboard: {},
            nifty: null,
            banknifty: null,
            finnifty: null,
            sensex: null,
            crudeoil: null,
            naturalgas: null
        };

        this.currentPage = 'dashboard';
        this.charts = new ChartManager();
        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = 10;

        this.init();
    }

    async init() {
        // Setup navigation
        this.setupNavigation();

        // Initial data fetch
        await this.fetchAllData();

        // Setup WebSocket
        this.setupWebSocket();

        // Start polling fallback
        setInterval(() => this.fetchAllData(), 25000);

        // Update market status
        this.updateMarketStatus();
        setInterval(() => this.updateMarketStatus(), 60000);
    }

    setupNavigation() {
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                const page = btn.dataset.page;
                this.navigateTo(page);
            });
        });
    }

    navigateTo(page) {
        // Update nav buttons
        document.querySelectorAll('.nav-btn').forEach(btn => {
            btn.classList.toggle('active', btn.dataset.page === page);
        });

        // Update pages
        document.querySelectorAll('.page').forEach(p => {
            p.classList.toggle('active', p.id === `page-${page}`);
        });

        this.currentPage = page;

        // Render page-specific content
        this.renderCurrentPage();
    }

    async fetchAllData() {
        try {
            const [dashboardRes, niftyRes, bankniftyRes, finniftyRes, sensexRes, crudeoilRes, naturalgasRes] = await Promise.all([
                fetch('/api/dashboard').then(r => r.json()).catch(() => ({})),
                fetch('/api/nifty/strikes/live').then(r => r.json()).catch(() => null),
                fetch('/api/banknifty/strikes/live').then(r => r.json()).catch(() => null),
                fetch('/api/finnifty/strikes/live').then(r => r.json()).catch(() => null),
                fetch('/api/sensex/strikes/live').then(r => r.json()).catch(() => null),
                fetch('/api/crudeoil/strikes/live').then(r => r.json()).catch(() => null),
                fetch('/api/naturalgas/strikes/live').then(r => r.json()).catch(() => null)
            ]);

            this.data.dashboard = dashboardRes;
            this.data.nifty = niftyRes;
            this.data.banknifty = bankniftyRes;
            this.data.finnifty = finniftyRes;
            this.data.sensex = sensexRes;
            this.data.crudeoil = crudeoilRes;
            this.data.naturalgas = naturalgasRes;

            // Update poll count
            const stats = await fetch('/api/stats').then(r => r.json()).catch(() => ({}));
            this.setText('poll-count', stats.poll_count || 0);

            this.renderCurrentPage();
            this.updateLastUpdate();

        } catch (error) {
            console.error('Error fetching data:', error);
        }
    }

    setupWebSocket() {
        const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
        const wsUrl = `${protocol}//${window.location.host}/ws`;

        try {
            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.updateConnectionStatus(true);
                this.reconnectAttempts = 0;
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    if (message.type === 'update') {
                        this.handleWebSocketUpdate(message.data);
                    }
                } catch (e) {
                    console.error('WebSocket message error:', e);
                }
            };

            this.ws.onclose = () => {
                this.updateConnectionStatus(false);
                this.attemptReconnect();
            };

            this.ws.onerror = () => {
                this.updateConnectionStatus(false);
            };

        } catch (error) {
            console.error('WebSocket setup error:', error);
            this.updateConnectionStatus(false);
        }
    }

    attemptReconnect() {
        if (this.reconnectAttempts < this.maxReconnectAttempts) {
            this.reconnectAttempts++;
            setTimeout(() => this.setupWebSocket(), 3000);
        }
    }

    handleWebSocketUpdate(data) {
        if (data.NIFTY) this.data.nifty = data.NIFTY;
        if (data.BANKNIFTY) this.data.banknifty = data.BANKNIFTY;
        if (data.FINNIFTY) this.data.finnifty = data.FINNIFTY;
        if (data.SENSEX) this.data.sensex = data.SENSEX;
        if (data.CRUDEOIL) this.data.crudeoil = data.CRUDEOIL;
        if (data.NATURALGAS) this.data.naturalgas = data.NATURALGAS;

        this.renderCurrentPage();
        this.updateLastUpdate();
    }

    updateConnectionStatus(connected) {
        const statusEl = document.getElementById('connection-status');
        const dotEl = statusEl.querySelector('.status-dot');
        const textEl = statusEl.querySelector('.status-text');

        if (connected) {
            dotEl.classList.add('connected');
            dotEl.classList.remove('disconnected');
            textEl.textContent = 'Live';
        } else {
            dotEl.classList.remove('connected');
            dotEl.classList.add('disconnected');
            textEl.textContent = 'Reconnecting...';
        }
    }

    updateLastUpdate() {
        const now = new Date();
        this.setText('last-update', now.toLocaleTimeString());
    }

    updateMarketStatus() {
        const now = new Date();
        const hours = now.getHours();
        const mins = now.getMinutes();
        const totalMins = hours * 60 + mins;

        const marketOpen = 9 * 60 + 15;   // 09:15
        const marketClose = 15 * 60 + 30; // 15:30

        const statusEl = document.getElementById('market-status');

        if (totalMins < marketOpen) {
            statusEl.textContent = 'Pre-Market';
            statusEl.className = 'pre-market';
        } else if (totalMins >= marketOpen && totalMins <= marketClose) {
            statusEl.textContent = 'Market Open';
            statusEl.className = 'market-open';
        } else {
            statusEl.textContent = 'Market Closed';
            statusEl.className = 'market-closed';
        }
    }

    renderCurrentPage() {
        switch (this.currentPage) {
            case 'dashboard':
                this.renderDashboard();
                break;
            case 'nifty':
                this.renderIndexPage('nifty', this.data.nifty);
                break;
            case 'banknifty':
                this.renderIndexPage('banknifty', this.data.banknifty);
                break;
            case 'finnifty':
                this.renderIndexPage('finnifty', this.data.finnifty);
                break;
            case 'sensex':
                this.renderIndexPage('sensex', this.data.sensex);
                break;
            case 'crudeoil':
                this.renderIndexPage('crudeoil', this.data.crudeoil);
                break;
            case 'naturalgas':
                this.renderIndexPage('naturalgas', this.data.naturalgas);
                break;
        }
    }

    renderDashboard() {
        const dashboard = this.data.dashboard;
        const indices = dashboard.indices || {};

        const cardsContainer = document.getElementById('dashboard-cards');
        cardsContainer.innerHTML = '';

        const indexOrder = ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'CRUDEOIL', 'NATURALGAS'];
        const indexIcons = {
            'NIFTY': '📈',
            'BANKNIFTY': '🏦',
            'FINNIFTY': '💰',
            'SENSEX': '🔵',
            'CRUDEOIL': '🛢️',
            'NATURALGAS': '🔥'
        };

        for (const indexName of indexOrder) {
            const data = indices[indexName];
            if (!data) continue;

            const trendClass = data.trend === 'BULLISH' ? 'bullish' :
                data.trend === 'BEARISH' ? 'bearish' : 'neutral';

            const card = document.createElement('div');
            card.className = `index-card ${trendClass}`;
            card.innerHTML = `
                <div class="card-header">
                    <span class="card-icon">${indexIcons[indexName] || '📊'}</span>
                    <span class="card-title">${indexName}</span>
                </div>
                <div class="card-spot">${this.formatNumber(data.spot)}</div>
                <div class="card-stats">
                    <div class="card-stat">
                        <span class="stat-label">ATM</span>
                        <span class="stat-value">${data.atm}</span>
                    </div>
                    <div class="card-stat">
                        <span class="stat-label">PCR</span>
                        <span class="stat-value">${data.pcr?.toFixed(2) || '--'}</span>
                    </div>
                    <div class="card-stat">
                        <span class="stat-label">Score</span>
                        <span class="stat-value ${data.score > 0 ? 'positive' : data.score < 0 ? 'negative' : ''}">${data.score?.toFixed(2) || '0.00'}</span>
                    </div>
                </div>
                <div class="card-trend">
                    <span class="trend-badge ${trendClass}">${data.trend}</span>
                </div>
            `;

            card.addEventListener('click', () => {
                this.navigateTo(indexName.toLowerCase());
            });

            cardsContainer.appendChild(card);
        }

        // Render comparison charts
        this.renderDashboardCharts();
    }

    renderDashboardCharts() {
        // PCR comparison
        const pcrData = [];
        const scoreData = [];

        for (const [indexName, data] of Object.entries(this.data.dashboard.indices || {})) {
            if (data) {
                pcrData.push({ index: indexName, value: data.pcr || 0 });
                scoreData.push({ index: indexName, value: data.score || 0 });
            }
        }

        if (pcrData.length > 0) {
            this.charts.renderComparisonBar('dashboard-pcr-chart', pcrData, 'PCR');
            this.charts.renderComparisonBar('dashboard-score-chart', scoreData, 'Score');
        }
    }

    renderIndexPage(indexKey, data) {
        if (!data) return;

        const prefix = indexKey.toLowerCase();

        // Update stats
        this.setText(`${prefix}-spot`, this.formatNumber(data.spot));
        this.setText(`${prefix}-atm`, data.atm);
        this.setText(`${prefix}-score`, data.current_weighted_score?.score?.toFixed(2) || '0.00');
        this.setText(`${prefix}-pcr`, data.pcr?.toFixed(2) || '0.00');

        // Update trend badge
        const trendEl = document.getElementById(`${prefix}-trend`);
        if (trendEl) {
            const trend = data.overall_trend || 'NEUTRAL';
            trendEl.textContent = trend;
            trendEl.className = `trend-badge ${trend.toLowerCase()}`;
        }

        // Update signal counts
        const summary = data.summary || {};
        this.setText(`${prefix}-bullish`, summary.bullish || 0);
        this.setText(`${prefix}-bearish`, summary.bearish || 0);
        this.setText(`${prefix}-neutral`, summary.neutral || 0);

        // ========================
        // IV Data Rendering
        // ========================
        const ivData = data.iv_data || {};

        // Update IV stats
        const currentIV = ivData.current_iv;
        this.setText(`${prefix}-current-iv`, currentIV ? currentIV.toFixed(1) : '--');

        // Update IV change
        const ivChangeEl = document.getElementById(`${prefix}-iv-change`);
        if (ivChangeEl) {
            const ivChange = ivData.iv_change || 0;
            ivChangeEl.textContent = `${ivChange >= 0 ? '+' : ''}${ivChange.toFixed(2)}%`;
            ivChangeEl.className = `iv-stat-value font-mono ${ivChange >= 0 ? 'positive' : 'negative'}`;
        }

        // Update IV trend badge
        const ivTrendEl = document.getElementById(`${prefix}-iv-trend`);
        if (ivTrendEl) {
            const ivTrend = ivData.iv_trend || 'STABLE';
            ivTrendEl.textContent = ivTrend;
            ivTrendEl.className = `iv-trend-badge ${ivTrend.toLowerCase()}`;
        }

        // Update pattern status
        const patternEl = document.getElementById(`${prefix}-pattern-status`);
        if (patternEl) {
            if (ivData.active_pattern) {
                const duration = ivData.active_pattern.pattern_duration || 0;
                patternEl.textContent = `SURGE (${duration}m)`;
                patternEl.className = 'iv-pattern-badge active';
            } else {
                patternEl.textContent = 'None';
                patternEl.className = 'iv-pattern-badge none';
            }
        }

        // Render charts
        this.charts.renderStrikeBarChart(`${prefix}-bar-chart`, data.bar_graph_data || [], data.atm);
        this.charts.renderTimeseries(`${prefix}-timeseries-chart`, data.timeseries || []);
        this.charts.renderDominanceChart(`${prefix}-dominance-chart`, data.dominance_timeseries || []);

        // Fetch and render candlestick chart
        this.fetchAndRenderCandlestickChart(prefix, indexKey);

        // Render S/R levels
        this.renderSRLevels(prefix, data.support_resistance);

        // Render Max Pain
        this.renderMaxPain(prefix, data.max_pain, data.spot);

        // Render PCR trend
        this.renderPCRTrend(prefix, data.timeseries || []);

        // Render strikes table
        this.renderStrikesTable(prefix, data.bar_graph_data || []);
    }

    async fetchAndRenderCandlestickChart(prefix, indexKey) {
        try {
            const response = await fetch(`/api/${indexKey}/candles`);
            if (!response.ok) return;

            const candleData = await response.json();

            if (!candleData.error && candleData.candles && candleData.candles.length > 0) {
                this.charts.renderCandlestickChart(`${prefix}-candlestick-chart`, candleData);
            }
        } catch (error) {
            console.debug('Candlestick chart fetch error:', error);
        }
    }

    renderSRLevels(prefix, srData) {
        const container = document.getElementById(`${prefix}-sr-levels`);
        if (!container || !srData) return;

        const support = srData.support || [];
        const resistance = srData.resistance || [];

        let html = '<div class="sr-section">';
        html += '<div class="sr-label resistance">Resistance</div>';
        for (const level of resistance) {
            const strength = level.strength === 'STRONG' ? '💪' : '';
            html += `<div class="sr-level resistance">${level.strike} ${strength} <span class="sr-oi">(${this.formatOI(level.oi)})</span></div>`;
        }
        html += '</div>';

        html += '<div class="sr-section">';
        html += '<div class="sr-label support">Support</div>';
        for (const level of support) {
            const strength = level.strength === 'STRONG' ? '💪' : '';
            html += `<div class="sr-level support">${level.strike} ${strength} <span class="sr-oi">(${this.formatOI(level.oi)})</span></div>`;
        }
        html += '</div>';

        container.innerHTML = html;
    }

    renderMaxPain(prefix, maxPain, spot) {
        const container = document.getElementById(`${prefix}-max-pain`);
        if (!container) return;

        if (!maxPain || maxPain.strike === 0) {
            container.innerHTML = '<div class="no-data">Calculating...</div>';
            return;
        }

        const direction = maxPain.distance > 0 ? '↑' : maxPain.distance < 0 ? '↓' : '→';
        const colorClass = maxPain.distance > 0 ? 'positive' : maxPain.distance < 0 ? 'negative' : '';

        container.innerHTML = `
            <div class="max-pain-value">
                <span class="strike">${maxPain.strike}</span>
                <span class="distance ${colorClass}">${direction} ${Math.abs(maxPain.distance).toFixed(2)}%</span>
            </div>
            <div class="max-pain-spot">
                Spot: ${this.formatNumber(spot)}
            </div>
        `;
    }

    renderPCRTrend(prefix, timeseries) {
        const containerId = `${prefix}-pcr-chart`;
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';

        if (!timeseries || timeseries.length === 0) {
            container.innerHTML = '<div class="no-data">Collecting PCR data...</div>';
            return;
        }

        // Extract PCR values from timeseries
        const pcrData = timeseries.map(d => ({
            time_label: d.time_label,
            pcr: d.pcr || 0
        })).filter(d => d.pcr > 0);

        if (pcrData.length === 0) {
            container.innerHTML = '<div class="no-data">No PCR data yet...</div>';
            return;
        }

        this.charts.renderPCRTrendChart(containerId, pcrData);
    }

    renderStrikesTable(prefix, barData) {
        const tbody = document.querySelector(`#${prefix}-strikes-table tbody`);
        if (!tbody) return;

        tbody.innerHTML = '';

        for (const bar of barData) {
            const signalClass = bar.signal_type === 'BULLISH' ? 'bullish' :
                bar.signal_type === 'BEARISH' ? 'bearish' : 'neutral';
            const atmClass = bar.is_atm ? 'atm-row' : '';

            const row = document.createElement('tr');
            row.className = `${signalClass} ${atmClass}`;
            row.innerHTML = `
                <td class="strike-cell">${bar.strike} ${bar.is_atm ? '⭐' : ''}</td>
                <td class="oi-cell">${this.formatOI(bar.ce_oi)}</td>
                <td class="change-cell ${bar.ce_oi_change_pct < 0 ? 'positive' : bar.ce_oi_change_pct > 0 ? 'negative' : ''}">${bar.ce_oi_change_pct.toFixed(2)}%</td>
                <td class="oi-cell">${this.formatOI(bar.pe_oi)}</td>
                <td class="change-cell ${bar.pe_oi_change_pct > 0 ? 'positive' : bar.pe_oi_change_pct < 0 ? 'negative' : ''}">${bar.pe_oi_change_pct.toFixed(2)}%</td>
                <td class="signal-cell ${bar.net_signal > 0 ? 'positive' : bar.net_signal < 0 ? 'negative' : ''}">${bar.net_signal.toFixed(2)}</td>
                <td class="type-cell"><span class="signal-badge ${signalClass}">${bar.signal_type}</span></td>
            `;
            tbody.appendChild(row);
        }
    }

    // Utility methods
    setText(id, value) {
        const el = document.getElementById(id);
        if (el) el.textContent = value;
    }

    formatNumber(num) {
        if (!num) return '--';
        return num.toLocaleString('en-IN', { maximumFractionDigits: 2 });
    }

    formatOI(oi) {
        if (!oi) return '-';
        if (oi >= 10000000) return (oi / 10000000).toFixed(2) + ' Cr';
        if (oi >= 100000) return (oi / 100000).toFixed(2) + ' L';
        if (oi >= 1000) return (oi / 1000).toFixed(1) + ' K';
        return oi.toLocaleString('en-IN');
    }
}

// Initialize app when DOM is ready
document.addEventListener('DOMContentLoaded', () => {
    window.app = new IndexScannerApp();
});

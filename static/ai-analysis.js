/**
 * AI Analysis Page - JavaScript
 * Fetches AI signals and confluence data for all indices
 * with visualizations and real-time updates
 */

// Configuration
const CONFIG = {
    refreshInterval: 60000, // 60 seconds
    apiBase: '',
    indices: ['NIFTY', 'BANKNIFTY', 'FINNIFTY', 'SENSEX', 'CRUDEOIL', 'NATURALGAS']
};

// State
let aiData = {};
let selectedIndex = null;
let refreshTimer = null;

// DOM Elements
const elements = {
    aiStatus: document.getElementById('ai-status'),
    lastUpdate: document.getElementById('last-update'),
    aiModel: document.getElementById('ai-model'),
    activeCount: document.getElementById('active-count'),
    rlLookback: document.getElementById('rl-lookback'),
    marketSentiment: document.getElementById('market-sentiment'),
    indicesContainer: document.getElementById('indices-container'),
    detailPanel: document.getElementById('detail-panel'),
    loadingOverlay: document.getElementById('loading-overlay')
};

// Initialize
document.addEventListener('DOMContentLoaded', async () => {
    showLoading(true);
    await fetchAISummary();
    await fetchAllIndices();
    showLoading(false);

    // Auto-refresh
    refreshTimer = setInterval(async () => {
        await fetchAllIndices();
    }, CONFIG.refreshInterval);
});

// Fetch AI System Summary
async function fetchAISummary() {
    try {
        const response = await fetch('/api/ai-summary');
        const data = await response.json();

        if (data.ai_available) {
            elements.aiStatus.textContent = 'Online';
            elements.aiStatus.className = 'status-badge online';
        } else {
            elements.aiStatus.textContent = 'Offline';
            elements.aiStatus.className = 'status-badge offline';
        }

        elements.aiModel.textContent = data.model?.split('/')[1] || 'Kimi K2.5';
        elements.activeCount.textContent = data.active_indices?.length || 0;
        elements.rlLookback.textContent = `${data.rl_lookback_minutes || 30} min`;

        CONFIG.indices = data.active_indices || CONFIG.indices;
    } catch (error) {
        console.error('Failed to fetch AI summary:', error);
        elements.aiStatus.textContent = 'Error';
        elements.aiStatus.className = 'status-badge offline';
    }
}

// Fetch data for all indices
async function fetchAllIndices() {
    const promises = CONFIG.indices.map(async (indexName) => {
        try {
            // Fetch confluence (faster, doesn't call external API)
            const confluenceRes = await fetch(`/api/${indexName.toLowerCase()}/confluence`);
            const confluenceData = await confluenceRes.json();

            aiData[indexName] = {
                confluence: confluenceData.confluence || {},
                market_data: confluenceData.market_data || {},
                crossover_analysis: confluenceData.crossover_analysis || {},
                ai_signal: null, // Will be fetched on demand
                timestamp: confluenceData.timestamp
            };
        } catch (error) {
            console.error(`Failed to fetch ${indexName}:`, error);
            aiData[indexName] = { error: true };
        }
    });

    await Promise.all(promises);
    renderIndexCards();
    updateMarketSentiment();
    updateLastUpdateTime();
}

// Fetch AI Signal for specific index (on demand - calls external API)
async function fetchAISignal(indexName) {
    showLoading(true);
    try {
        const response = await fetch(`/api/${indexName.toLowerCase()}/ai-signal`);
        const data = await response.json();

        if (data.ai_signal) {
            aiData[indexName].ai_signal = data.ai_signal;
            aiData[indexName].market_data = data.market_data;
        }

        return data;
    } catch (error) {
        console.error(`Failed to fetch AI signal for ${indexName}:`, error);
        return null;
    } finally {
        showLoading(false);
    }
}

// Render Index Cards
function renderIndexCards() {
    const container = elements.indicesContainer;
    container.innerHTML = '';

    CONFIG.indices.forEach((indexName) => {
        const data = aiData[indexName];
        if (!data || data.error) {
            container.appendChild(createErrorCard(indexName));
            return;
        }

        const card = createIndexCard(indexName, data);
        container.appendChild(card);
    });
}

// Create Index Card Element
function createIndexCard(indexName, data) {
    const confluence = data.confluence || {};
    const market = data.market_data || {};
    const signal = data.ai_signal || {};

    const direction = confluence.direction || 'NEUTRAL';
    const signalClass = direction.toLowerCase();

    const card = document.createElement('div');
    card.className = `index-card ${signalClass}`;
    card.onclick = () => openDetailPanel(indexName);

    const confidenceLevel = (signal.confidence || 5) >= 7 ? 'high' :
        (signal.confidence || 5) >= 4 ? 'medium' : 'low';

    card.innerHTML = `
        <div class="card-header">
            <h3 class="card-title">${indexName}</h3>
            <span class="card-signal ${signalClass}">${direction}</span>
        </div>
        <div class="card-body">
            <div class="card-metric">
                <span class="metric-label">Confluence</span>
                <span class="metric-value">${confluence.score || 0}/${confluence.max_score || 5}</span>
            </div>
            <div class="card-metric">
                <span class="metric-label">PCR</span>
                <span class="metric-value">${market.pcr?.toFixed(2) || '--'}</span>
            </div>
            <div class="card-metric">
                <span class="metric-label">Bullish Votes</span>
                <span class="metric-value bullish">${market.bullish_votes || 0}</span>
            </div>
            <div class="card-metric">
                <span class="metric-label">Bearish Votes</span>
                <span class="metric-value bearish">${market.bearish_votes || 0}</span>
            </div>
        </div>
        <div class="confidence-bar">
            <div class="confidence-fill ${confidenceLevel}" style="width: ${((signal.confidence || 5) / 10) * 100}%"></div>
        </div>
        <div class="card-footer">
            <span class="environment-tag">${signal.environment || 'Unknown'}</span>
            <span class="view-details">View Details →</span>
        </div>
    `;

    return card;
}

// Create Error Card
function createErrorCard(indexName) {
    const card = document.createElement('div');
    card.className = 'index-card neutral';
    card.innerHTML = `
        <div class="card-header">
            <h3 class="card-title">${indexName}</h3>
            <span class="card-signal neutral">ERROR</span>
        </div>
        <div class="card-body">
            <p style="grid-column: span 2; color: var(--text-muted);">Failed to load data</p>
        </div>
    `;
    return card;
}

// Open Detail Panel
async function openDetailPanel(indexName) {
    selectedIndex = indexName;
    elements.detailPanel.style.display = 'block';

    // Update header
    document.getElementById('detail-title').textContent = `${indexName} AI Analysis`;

    // Show loading state in panel
    document.getElementById('detail-reasoning').innerHTML = '<li>Fetching AI analysis...</li>';

    // Fetch fresh AI signal (calls external API)
    await fetchAISignal(indexName);

    // Render detail panel
    renderDetailPanel(indexName);
}

// Close Detail Panel
function closeDetailPanel() {
    elements.detailPanel.style.display = 'none';
    selectedIndex = null;
}

// Render Detail Panel
function renderDetailPanel(indexName) {
    const data = aiData[indexName];
    if (!data) return;

    const confluence = data.confluence || {};
    const market = data.market_data || {};
    const signal = data.ai_signal || {};
    const crossover = data.crossover_analysis || {};

    const direction = signal.signal || confluence.direction || 'NEUTRAL';
    const signalClass = direction.toLowerCase();

    // Update gauge needle rotation
    updateGauge(direction, signal.confidence || 5);

    // Signal badge
    const signalBadge = document.getElementById('detail-signal');
    signalBadge.textContent = direction;
    signalBadge.className = `signal-badge ${signalClass}`;

    // Confidence
    document.getElementById('detail-confidence').textContent =
        `Confidence: ${signal.confidence || 5}/10`;

    // Confluence
    const confluencePercent = ((confluence.score || 0) / (confluence.max_score || 6)) * 100;
    document.getElementById('confluence-fill').style.width = `${confluencePercent}%`;
    document.getElementById('confluence-score').textContent =
        `${confluence.score || 0}/${confluence.max_score || 6}`;

    // Confluence factors
    const factorsContainer = document.getElementById('confluence-factors');
    const factors = confluence.aligned_factors || [];
    factorsContainer.innerHTML = factors.length > 0
        ? factors.map(f => {
            const isBullish = f.toLowerCase().includes('bullish');
            return `<div class="factor-item ${isBullish ? 'bullish' : 'bearish'}">${f}</div>`;
        }).join('')
        : '<div class="factor-item">No aligned factors</div>';

    // Render crossover analysis
    renderCrossoverAnalysis(crossover);

    // Market data
    document.getElementById('detail-spot').textContent =
        market.spot ? market.spot.toLocaleString() : '--';
    document.getElementById('detail-atm').textContent =
        market.atm ? market.atm.toLocaleString() : '--';
    document.getElementById('detail-pcr').textContent =
        market.pcr ? market.pcr.toFixed(2) : '--';
    document.getElementById('detail-maxpain').textContent =
        market.max_pain_strike ? `${market.max_pain_strike.toLocaleString()} (${market.max_pain_distance}%)` : '--';
    document.getElementById('detail-bullish').textContent = market.bullish_votes || 0;
    document.getElementById('detail-bearish').textContent = market.bearish_votes || 0;

    // AI Reasoning
    const reasoningList = document.getElementById('detail-reasoning');
    const reasoning = signal.reasoning || ['No AI analysis available'];
    reasoningList.innerHTML = reasoning.map(r => `<li>${r}</li>`).join('');

    // Environment
    const envBadge = document.getElementById('detail-environment');
    const env = (signal.environment || 'Unknown').toLowerCase();
    envBadge.textContent = signal.environment || 'Unknown';
    envBadge.className = `environment-badge ${env}`;
}

// Render Crossover Analysis Section
function renderCrossoverAnalysis(crossover) {
    if (!crossover || !crossover.strike_analysis) {
        return;
    }

    const summary = crossover.summary || {};
    const strikes = crossover.strike_analysis || [];
    const reasoning = crossover.reasoning || [];

    // Update direction signal
    const dirEl = document.getElementById('crossover-signal');
    if (dirEl) {
        const dir = crossover.direction_signal || 'NEUTRAL';
        dirEl.textContent = dir;
        dirEl.className = `direction-value ${dir.toLowerCase()}`;
    }

    // Update crossover score
    const scoreEl = document.getElementById('crossover-score-value');
    if (scoreEl) {
        const score = crossover.crossover_score || 0;
        scoreEl.textContent = `${score.toFixed(1)}/10`;
    }

    // Update stats
    const callCountEl = document.getElementById('call-dominant-count');
    const putCountEl = document.getElementById('put-dominant-count');
    const crossCountEl = document.getElementById('crossover-count');

    if (callCountEl) callCountEl.textContent = summary.call_dominant_strikes || 0;
    if (putCountEl) putCountEl.textContent = summary.put_dominant_strikes || 0;
    if (crossCountEl) crossCountEl.textContent = summary.crossovers_from_baseline || 0;

    // Render strike bars
    const barsContainer = document.getElementById('crossover-visualization');
    if (barsContainer && strikes.length > 0) {
        barsContainer.innerHTML = strikes.map(s => {
            const strikeLabel = s.is_atm ? `${s.strike} ★` : s.strike;
            const labelClass = s.is_atm ? 'atm' : '';
            const domClass = s.dominant === 'CALLS' ? 'calls' :
                s.dominant === 'PUTS' ? 'puts' : 'balanced';
            const crossoverTag = s.crossover_occurred
                ? '<span class="crossover-indicator">⚡ Flipped</span>' : '';

            return `
                <div class="strike-bar">
                    <span class="strike-label ${labelClass}">${strikeLabel}</span>
                    <div class="bar-container">
                        <div class="bar-ce" style="width: ${s.ce_pct}%" title="CE: ${s.ce_pct}%"></div>
                        <div class="bar-pe" style="width: ${s.pe_pct}%" title="PE: ${s.pe_pct}%"></div>
                    </div>
                    <span class="dominance-label ${domClass}">${s.dominant}${crossoverTag}</span>
                </div>
            `;
        }).join('');
    }

    // Render reasoning
    const reasoningContainer = document.getElementById('crossover-reasoning');
    if (reasoningContainer && reasoning.length > 0) {
        reasoningContainer.innerHTML = reasoning.map(r =>
            `<div class="crossover-reason-item">${r}</div>`
        ).join('');
    }
}

// Update Gauge Visualization
function updateGauge(direction, confidence) {
    const needle = document.getElementById('gauge-line');
    const circle = document.getElementById('gauge-needle');

    // Calculate rotation: -90 (bearish) to 90 (bullish)
    let rotation = 0;
    if (direction === 'BULLISH') {
        rotation = 45 + (confidence / 10) * 45; // 45 to 90
    } else if (direction === 'BEARISH') {
        rotation = -45 - (confidence / 10) * 45; // -45 to -90
    } else {
        rotation = ((confidence - 5) / 5) * 30; // -30 to 30
    }

    // Apply rotation
    const transform = `rotate(${rotation}, 100, 100)`;
    needle.setAttribute('transform', transform);
    circle.setAttribute('transform', transform);
}

// Update Market Sentiment Summary
function updateMarketSentiment() {
    let bullishCount = 0;
    let bearishCount = 0;

    Object.values(aiData).forEach(data => {
        if (!data || data.error) return;
        const direction = data.confluence?.direction || 'NEUTRAL';
        if (direction === 'BULLISH') bullishCount++;
        else if (direction === 'BEARISH') bearishCount++;
    });

    const sentimentEl = elements.marketSentiment.querySelector('.overview-value');
    if (bullishCount > bearishCount * 1.5) {
        sentimentEl.textContent = 'BULLISH';
        sentimentEl.className = 'overview-value bullish';
    } else if (bearishCount > bullishCount * 1.5) {
        sentimentEl.textContent = 'BEARISH';
        sentimentEl.className = 'overview-value bearish';
    } else {
        sentimentEl.textContent = 'MIXED';
        sentimentEl.className = 'overview-value neutral';
    }
}

// Update Last Update Time
function updateLastUpdateTime() {
    const now = new Date();
    elements.lastUpdate.textContent = `Updated: ${now.toLocaleTimeString()}`;
}

// Show/Hide Loading Overlay
function showLoading(show) {
    elements.loadingOverlay.classList.toggle('visible', show);
}

// Keyboard shortcut to close panel
document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && selectedIndex) {
        closeDetailPanel();
    }
});

// Click outside to close panel
document.addEventListener('click', (e) => {
    if (selectedIndex &&
        !elements.detailPanel.contains(e.target) &&
        !e.target.closest('.index-card')) {
        closeDetailPanel();
    }
});

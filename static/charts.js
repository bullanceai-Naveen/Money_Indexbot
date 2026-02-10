/**
 * Index OI Scanner - Chart Manager
 * D3.js charts for strike analysis, timeseries, and dominance
 */

class ChartManager {
    constructor() {
        this.colors = {
            bullish: '#00ff88',
            bearish: '#ff3366',
            neutral: '#64748b',
            ceIncrease: '#ff3366',
            ceDecrease: '#00ff88',
            peIncrease: '#00ff88',
            peDecrease: '#ff3366',
            grid: '#243044',
            text: '#94a3b8',
            textLight: '#e2e8f0',
            atm: '#fbbf24',
            background: '#0f172a'
        };

        this.MAX_CHART_HEIGHT = 600;
        this.BAR_HEIGHT = 28;
        this.SCROLL_THRESHOLD = 21;
    }

    /**
     * Render Strike-Level NET Signal Butterfly Chart
     */
    renderStrikeBarChart(containerId, data, atmStrike) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';
        d3.selectAll('.strike-tooltip').remove();

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="no-data">No strike data available</div>';
            return;
        }

        // Sort: highest strike at top
        const sortedData = [...data].sort((a, b) => b.strike - a.strike);

        const margin = { top: 40, right: 100, bottom: 50, left: 90 };
        const width = container.clientWidth - margin.left - margin.right;

        // Dynamic height
        const calculatedHeight = sortedData.length * this.BAR_HEIGHT;
        const needsScroll = sortedData.length > this.SCROLL_THRESHOLD;
        const innerHeight = calculatedHeight;

        if (needsScroll) {
            container.style.overflowY = 'auto';
            container.style.maxHeight = `${this.MAX_CHART_HEIGHT + margin.top + margin.bottom}px`;
        } else {
            container.style.overflowY = 'hidden';
            container.style.maxHeight = 'none';
        }

        const svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', innerHeight + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);

        // Calculate net signal
        const processedData = sortedData.map(d => ({
            ...d,
            netSignal: (d.pe_oi_change_pct || 0) - (d.ce_oi_change_pct || 0)
        }));

        // Dynamic scale
        const netValues = processedData.map(d => d.netSignal);
        const dataMax = Math.max(...netValues.map(Math.abs), 1);
        const maxAbsNet = Math.ceil(dataMax * 1.1);

        const xScale = d3.scaleLinear()
            .domain([-maxAbsNet, maxAbsNet])
            .range([0, width]);

        const yScale = d3.scaleBand()
            .domain(processedData.map(d => d.strike))
            .range([0, innerHeight])
            .padding(0.15);

        // Tooltip
        const tooltip = d3.select('body').append('div')
            .attr('class', 'strike-tooltip')
            .style('position', 'absolute')
            .style('background', 'rgba(10, 14, 23, 0.95)')
            .style('color', '#e5e7eb')
            .style('padding', '12px 16px')
            .style('border-radius', '8px')
            .style('border', '1px solid #374151')
            .style('font-size', '12px')
            .style('font-family', 'JetBrains Mono, monospace')
            .style('pointer-events', 'none')
            .style('opacity', 0)
            .style('z-index', 1000)
            .style('min-width', '220px')
            .style('box-shadow', '0 4px 20px rgba(0,0,0,0.5)');

        // Grid lines
        const gridCount = Math.min(7, Math.ceil(maxAbsNet));
        const gridValues = d3.range(-maxAbsNet, maxAbsNet + 1, maxAbsNet / Math.floor(gridCount / 2));

        gridValues.forEach(val => {
            svg.append('line')
                .attr('x1', xScale(val))
                .attr('x2', xScale(val))
                .attr('y1', 0)
                .attr('y2', innerHeight)
                .attr('stroke', this.colors.grid)
                .attr('stroke-dasharray', Math.abs(val) < 0.01 ? '0' : '3,3')
                .attr('stroke-width', Math.abs(val) < 0.01 ? 2 : 1)
                .attr('opacity', Math.abs(val) < 0.01 ? 0.8 : 0.4);
        });

        // ATM highlight
        processedData.forEach(d => {
            if (d.is_atm) {
                svg.append('rect')
                    .attr('x', 0)
                    .attr('y', yScale(d.strike) - 2)
                    .attr('width', width)
                    .attr('height', yScale.bandwidth() + 4)
                    .attr('fill', 'rgba(251, 191, 36, 0.1)')
                    .attr('stroke', this.colors.atm)
                    .attr('stroke-width', 1)
                    .attr('stroke-dasharray', '4,2')
                    .attr('rx', 4);
            }
        });

        // Draw bars
        svg.selectAll('.net-bar')
            .data(processedData)
            .enter()
            .append('rect')
            .attr('class', 'net-bar')
            .attr('x', d => d.netSignal >= 0 ? xScale(0) : xScale(d.netSignal))
            .attr('y', d => yScale(d.strike) + 2)
            .attr('width', d => Math.abs(xScale(d.netSignal) - xScale(0)))
            .attr('height', yScale.bandwidth() - 4)
            .attr('fill', d => d.netSignal >= 0 ? this.colors.bullish : this.colors.bearish)
            .attr('rx', 3)
            .attr('opacity', 0.85)
            .attr('cursor', 'pointer')
            .on('mouseover', (event, d) => {
                const ceChange = d.ce_oi_change_pct || 0;
                const peChange = d.pe_oi_change_pct || 0;
                const signalType = d.netSignal >= 0 ? 'BULLISH' : 'BEARISH';
                const signalColor = d.netSignal >= 0 ? '#00ff88' : '#ff3366';

                const formatOI = (val) => {
                    if (!val) return '-';
                    if (val >= 10000000) return (val / 10000000).toFixed(2) + ' Cr';
                    if (val >= 100000) return (val / 100000).toFixed(2) + ' L';
                    return val.toLocaleString('en-IN');
                };

                tooltip.transition().duration(200).style('opacity', 1);
                tooltip.html(`
                    <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; color: #fbbf24; border-bottom: 1px solid #374151; padding-bottom: 8px;">
                        Strike: ${d.strike} ${d.is_atm ? '(ATM)' : ''}
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 10px;">
                        <div>
                            <div style="color: #94a3b8; font-size: 10px;">CE OI</div>
                            <div style="font-weight: 600;">${formatOI(d.ce_oi)}</div>
                        </div>
                        <div>
                            <div style="color: #94a3b8; font-size: 10px;">PE OI</div>
                            <div style="font-weight: 600;">${formatOI(d.pe_oi)}</div>
                        </div>
                        <div>
                            <div style="color: #94a3b8; font-size: 10px;">CE Change</div>
                            <div style="color: ${ceChange < 0 ? '#00ff88' : '#ff3366'}; font-weight: 600;">${ceChange >= 0 ? '+' : ''}${ceChange.toFixed(2)}%</div>
                        </div>
                        <div>
                            <div style="color: #94a3b8; font-size: 10px;">PE Change</div>
                            <div style="color: ${peChange > 0 ? '#00ff88' : '#ff3366'}; font-weight: 600;">${peChange >= 0 ? '+' : ''}${peChange.toFixed(2)}%</div>
                        </div>
                    </div>
                    <div style="border-top: 1px solid #374151; padding-top: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #94a3b8;">Net Signal:</span>
                            <span style="color: ${signalColor}; font-weight: 700; font-size: 14px;">${d.netSignal >= 0 ? '+' : ''}${d.netSignal.toFixed(2)} ${signalType}</span>
                        </div>
                    </div>
                `)
                    .style('left', (event.pageX + 15) + 'px')
                    .style('top', (event.pageY - 28) + 'px');
            })
            .on('mouseout', () => {
                tooltip.transition().duration(200).style('opacity', 0);
            });

        // Y-axis labels
        svg.selectAll('.strike-label')
            .data(processedData)
            .enter()
            .append('text')
            .attr('class', 'strike-label')
            .attr('x', -8)
            .attr('y', d => yScale(d.strike) + yScale.bandwidth() / 2 + 4)
            .attr('text-anchor', 'end')
            .attr('fill', d => d.is_atm ? this.colors.atm : this.colors.text)
            .attr('font-size', '11px')
            .attr('font-family', 'JetBrains Mono')
            .attr('font-weight', d => d.is_atm ? '700' : '400')
            .text(d => d.strike);

        // Value labels
        svg.selectAll('.value-label')
            .data(processedData)
            .enter()
            .append('text')
            .attr('class', 'value-label')
            .attr('x', d => d.netSignal >= 0 ? xScale(d.netSignal) + 5 : xScale(d.netSignal) - 5)
            .attr('y', d => yScale(d.strike) + yScale.bandwidth() / 2 + 4)
            .attr('text-anchor', d => d.netSignal >= 0 ? 'start' : 'end')
            .attr('fill', d => d.netSignal >= 0 ? this.colors.bullish : this.colors.bearish)
            .attr('font-size', '10px')
            .attr('font-family', 'JetBrains Mono')
            .attr('font-weight', '600')
            .text(d => `${d.netSignal >= 0 ? '+' : ''}${d.netSignal.toFixed(1)}`);

        // X-axis
        svg.append('g')
            .attr('transform', `translate(0, ${innerHeight})`)
            .call(d3.axisBottom(xScale).ticks(7).tickFormat(d => `${d}%`))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '10px');

        svg.selectAll('.domain').attr('stroke', this.colors.grid);
        svg.selectAll('.tick line').attr('stroke', this.colors.grid);

        // Title
        svg.append('text')
            .attr('x', width / 2)
            .attr('y', -15)
            .attr('text-anchor', 'middle')
            .attr('fill', this.colors.textLight)
            .attr('font-size', '12px')
            .text('← BEARISH (CE Buildup)  |  BULLISH (PE Buildup) →');
    }

    /**
     * Render Cumulative Timeseries Chart with hover details and breach indicators
     */
    renderTimeseries(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';
        d3.selectAll('.ts-tooltip').remove();

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="no-data">Collecting data...</div>';
            return;
        }

        const margin = { top: 30, right: 50, bottom: 30, left: 50 };
        const width = container.clientWidth - margin.left - margin.right;
        const height = 170;

        const svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);

        const xScale = d3.scalePoint()
            .domain(data.map(d => d.time_label))
            .range([0, width]);

        const scores = data.map(d => d.weighted_net_score || 0);
        const maxAbs = Math.max(...scores.map(Math.abs), 0.5);

        const yScale = d3.scaleLinear()
            .domain([-maxAbs * 1.2, maxAbs * 1.2])
            .range([height, 0]);

        // Grid
        svg.append('g')
            .attr('opacity', 0.15)
            .call(d3.axisLeft(yScale).ticks(5).tickSize(-width).tickFormat(''))
            .selectAll('line')
            .attr('stroke', this.colors.grid);

        // Zero line
        svg.append('line')
            .attr('x1', 0)
            .attr('x2', width)
            .attr('y1', yScale(0))
            .attr('y2', yScale(0))
            .attr('stroke', '#4b5563')
            .attr('stroke-width', 1);

        // Calculate 5-period Moving Average (starts from first point using available data)
        const maPeriod = 5;
        const maData = data.map((d, i) => {
            const availablePeriod = Math.min(i + 1, maPeriod);
            let sum = 0;
            for (let j = i - availablePeriod + 1; j <= i; j++) {
                sum += data[j].weighted_net_score || 0;
            }
            return { ...d, ma: sum / availablePeriod };
        });

        // Gradient (define before using)
        const gradient = svg.append('defs')
            .append('linearGradient')
            .attr('id', 'scoreGradient')
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '0%')
            .attr('y2', '100%');

        gradient.append('stop')
            .attr('offset', '0%')
            .attr('stop-color', '#00ff88');

        gradient.append('stop')
            .attr('offset', '100%')
            .attr('stop-color', '#ff3366');

        // Area (draw first so lines appear on top)
        const area = d3.area()
            .x(d => xScale(d.time_label))
            .y0(yScale(0))
            .y1(d => yScale(d.weighted_net_score || 0))
            .curve(d3.curveMonotoneX);

        svg.append('path')
            .datum(data)
            .attr('fill', 'url(#scoreGradient)')
            .attr('opacity', 0.3)
            .attr('d', area);

        // Main Score Line
        const line = d3.line()
            .x(d => xScale(d.time_label))
            .y(d => yScale(d.weighted_net_score || 0))
            .curve(d3.curveMonotoneX);

        svg.append('path')
            .datum(data)
            .attr('fill', 'none')
            .attr('stroke', '#6366f1')
            .attr('stroke-width', 2)
            .attr('d', line);

        // MA Line (5-period Moving Average) - Orange/Gold
        const maLine = d3.line()
            .x(d => xScale(d.time_label))
            .y(d => yScale(d.ma))
            .curve(d3.curveMonotoneX);

        svg.append('path')
            .datum(maData)
            .attr('fill', 'none')
            .attr('stroke', '#fbbf24')
            .attr('stroke-width', 2.5)
            .attr('stroke-dasharray', '6,3')
            .attr('d', maLine);

        // Detect MA Crossovers
        const crossoverData = maData.map((d, i) => {
            const score = d.weighted_net_score || 0;
            const ma = d.ma;
            let isBullishCrossover = false;
            let isBearishCrossover = false;

            if (i > 0) {
                const prevScore = maData[i - 1].weighted_net_score || 0;
                const prevMa = maData[i - 1].ma;

                // Bullish crossover: price crosses above MA
                if (prevScore <= prevMa && score > ma) {
                    isBullishCrossover = true;
                }
                // Bearish crossover: price crosses below MA
                if (prevScore >= prevMa && score < ma) {
                    isBearishCrossover = true;
                }
            }

            return { ...d, isBullishCrossover, isBearishCrossover };
        });

        // Tooltip
        const tooltip = d3.select('body').append('div')
            .attr('class', 'ts-tooltip')
            .style('position', 'absolute')
            .style('background', 'rgba(10, 14, 23, 0.95)')
            .style('color', '#e5e7eb')
            .style('padding', '12px 16px')
            .style('border-radius', '8px')
            .style('border', '1px solid #374151')
            .style('font-size', '12px')
            .style('font-family', 'JetBrains Mono, monospace')
            .style('pointer-events', 'none')
            .style('opacity', 0)
            .style('z-index', 1000)
            .style('min-width', '220px')
            .style('box-shadow', '0 4px 20px rgba(0,0,0,0.5)');

        // Draw crossover indicators and interactive points
        crossoverData.forEach((d, i) => {
            const x = xScale(d.time_label);
            const y = yScale(d.weighted_net_score || 0);
            const score = d.weighted_net_score || 0;
            const ma = d.ma;

            // Draw crossover indicators
            if (d.isBullishCrossover) {
                // Bullish crossover - green diamond
                svg.append('path')
                    .attr('d', d3.symbol().type(d3.symbolDiamond).size(120)())
                    .attr('transform', `translate(${x}, ${y - 15})`)
                    .attr('fill', this.colors.bullish)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1.5);

                svg.append('text')
                    .attr('x', x)
                    .attr('y', y - 28)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', '9px')
                    .attr('fill', this.colors.bullish)
                    .attr('font-weight', '700')
                    .text('BUY ↑');
            }

            if (d.isBearishCrossover) {
                // Bearish crossover - red diamond
                svg.append('path')
                    .attr('d', d3.symbol().type(d3.symbolDiamond).size(120)())
                    .attr('transform', `translate(${x}, ${y + 15})`)
                    .attr('fill', this.colors.bearish)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1.5);

                svg.append('text')
                    .attr('x', x)
                    .attr('y', y + 32)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', '9px')
                    .attr('fill', this.colors.bearish)
                    .attr('font-weight', '700')
                    .text('SELL ↓');
            }

            // Interactive hover point
            svg.append('circle')
                .attr('cx', x)
                .attr('cy', y)
                .attr('r', 6)
                .attr('fill', score >= 0 ? this.colors.bullish : this.colors.bearish)
                .attr('stroke', '#fff')
                .attr('stroke-width', 1)
                .attr('opacity', 0.01)
                .attr('cursor', 'pointer')
                .on('mouseover', (event) => {
                    // Calculate bulls and bears contribution
                    const bullScore = d.pe_change_total || d.bull_score || Math.max(0, score);
                    const bearScore = d.ce_change_total || d.bear_score || Math.abs(Math.min(0, score));
                    const netSignal = score >= 0 ? 'BULLISH' : 'BEARISH';
                    const signalColor = score >= 0 ? '#00ff88' : '#ff3366';
                    const scoreVsMa = score > ma ? 'Above MA' : score < ma ? 'Below MA' : 'At MA';
                    const scoreVsMaColor = score > ma ? '#00ff88' : score < ma ? '#ff3366' : '#fbbf24';

                    let crossoverInfo = '';
                    if (d.isBullishCrossover) {
                        crossoverInfo = `<div style="color: ${this.colors.bullish}; font-weight: 700; margin-top: 8px; padding-top: 8px; border-top: 1px solid #374151;">🚀 BULLISH CROSSOVER!</div>`;
                    } else if (d.isBearishCrossover) {
                        crossoverInfo = `<div style="color: ${this.colors.bearish}; font-weight: 700; margin-top: 8px; padding-top: 8px; border-top: 1px solid #374151;">📉 BEARISH CROSSOVER!</div>`;
                    }

                    tooltip.transition().duration(200).style('opacity', 1);
                    tooltip.html(`
                        <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; color: #8b5cf6; border-bottom: 1px solid #374151; padding-bottom: 8px;">
                            ⏰ ${d.time_label}
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px;">
                            <div>
                                <div style="color: #94a3b8; font-size: 10px;">🐂 Bulls</div>
                                <div style="color: ${this.colors.bullish}; font-weight: 700; font-size: 14px;">${bullScore.toFixed(2)}</div>
                            </div>
                            <div>
                                <div style="color: #94a3b8; font-size: 10px;">🐻 Bears</div>
                                <div style="color: ${this.colors.bearish}; font-weight: 700; font-size: 14px;">${bearScore.toFixed(2)}</div>
                            </div>
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px;">
                            <div>
                                <div style="color: #94a3b8; font-size: 10px;">Score</div>
                                <div style="color: ${signalColor}; font-weight: 600;">${score >= 0 ? '+' : ''}${score.toFixed(2)}</div>
                            </div>
                            <div>
                                <div style="color: #94a3b8; font-size: 10px;">MA(5)</div>
                                <div style="color: #fbbf24; font-weight: 600;">${ma.toFixed(2)}</div>
                            </div>
                        </div>
                        <div style="border-top: 1px solid #374151; padding-top: 8px;">
                            <div style="display: flex; justify-content: space-between; align-items: center;">
                                <span style="color: #94a3b8;">Position:</span>
                                <span style="color: ${scoreVsMaColor}; font-weight: 700;">${scoreVsMa}</span>
                            </div>
                            <div style="display: flex; justify-content: space-between; align-items: center; margin-top: 4px;">
                                <span style="color: #94a3b8;">Signal:</span>
                                <span style="color: ${signalColor}; font-size: 11px; font-weight: 600;">${netSignal}</span>
                            </div>
                        </div>
                        ${crossoverInfo}
                    `)
                        .style('left', (event.pageX + 15) + 'px')
                        .style('top', (event.pageY - 28) + 'px');

                    // Highlight point
                    d3.select(event.target)
                        .attr('opacity', 1)
                        .attr('r', 8);
                })
                .on('mouseout', (event) => {
                    tooltip.transition().duration(200).style('opacity', 0);
                    d3.select(event.target)
                        .attr('opacity', 0.01)
                        .attr('r', 6);
                });
        });

        // X-axis
        const labelStep = data.length <= 10 ? 1 : data.length <= 20 ? 2 : 3;
        const tickValues = data.map(d => d.time_label).filter((_, i) => i % labelStep === 0);

        svg.append('g')
            .attr('transform', `translate(0, ${height})`)
            .call(d3.axisBottom(xScale).tickValues(tickValues))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '10px');

        // Y-axis
        svg.append('g')
            .call(d3.axisLeft(yScale).ticks(5))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '10px');

        svg.selectAll('.domain').attr('stroke', this.colors.grid);
        svg.selectAll('.tick line').attr('stroke', this.colors.grid);

        // Latest value
        if (data.length > 0) {
            const latest = data[data.length - 1];
            const score = latest.weighted_net_score || 0;

            svg.append('text')
                .attr('x', width + 5)
                .attr('y', yScale(score) + 4)
                .attr('font-size', '11px')
                .attr('font-weight', '700')
                .attr('fill', score >= 0 ? this.colors.bullish : this.colors.bearish)
                .text(score.toFixed(2));
        }
    }

    /**
     * Render Interval Dominance Chart with hover details and breach indicators
     */
    renderDominanceChart(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';
        d3.selectAll('.dom-tooltip').remove();

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="no-data">Collecting interval data...</div>';
            return;
        }

        const margin = { top: 30, right: 50, bottom: 30, left: 50 };
        const width = container.clientWidth - margin.left - margin.right;
        const height = 170;

        const svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);

        const timeLabels = data.map(d => d.time_label);

        const xScale = d3.scaleBand()
            .domain(timeLabels)
            .range([0, width])
            .padding(0.2);

        const netValues = data.map(d => d.net_value || 0);
        const maxAbs = Math.max(...netValues.map(Math.abs), 0.5);

        const yScale = d3.scaleLinear()
            .domain([-maxAbs * 1.2, maxAbs * 1.2])
            .range([height, 0]);

        // Track high/low for breach detection
        let runningHigh = -Infinity;
        let runningLow = Infinity;
        const breachData = data.map((d, i) => {
            const netVal = d.net_value || 0;
            const prevHigh = runningHigh;
            const prevLow = runningLow;
            const isHighBreach = i > 0 && netVal > prevHigh && prevHigh !== -Infinity;
            const isLowBreach = i > 0 && netVal < prevLow && prevLow !== Infinity;
            runningHigh = Math.max(runningHigh, netVal);
            runningLow = Math.min(runningLow, netVal);
            return { ...d, isHighBreach, isLowBreach, runningHigh, runningLow };
        });

        // Grid
        svg.append('g')
            .attr('opacity', 0.15)
            .call(d3.axisLeft(yScale).ticks(5).tickSize(-width).tickFormat(''))
            .selectAll('line')
            .attr('stroke', this.colors.grid);

        // Zero line
        svg.append('line')
            .attr('x1', 0)
            .attr('x2', width)
            .attr('y1', yScale(0))
            .attr('y2', yScale(0))
            .attr('stroke', '#4b5563')
            .attr('stroke-width', 1);

        // Tooltip
        const tooltip = d3.select('body').append('div')
            .attr('class', 'dom-tooltip')
            .style('position', 'absolute')
            .style('background', 'rgba(10, 14, 23, 0.95)')
            .style('color', '#e5e7eb')
            .style('padding', '12px 16px')
            .style('border-radius', '8px')
            .style('border', '1px solid #374151')
            .style('font-size', '12px')
            .style('font-family', 'JetBrains Mono, monospace')
            .style('pointer-events', 'none')
            .style('opacity', 0)
            .style('z-index', 1000)
            .style('min-width', '220px')
            .style('box-shadow', '0 4px 20px rgba(0,0,0,0.5)');

        // Draw bars with hover and breach indicators
        breachData.forEach((d, i) => {
            const netVal = d.net_value || 0;
            const barX = xScale(d.time_label);
            const barY = netVal >= 0 ? yScale(netVal) : yScale(0);
            const barHeight = Math.max(2, Math.abs(yScale(netVal) - yScale(0)));

            // Draw the bar
            const bar = svg.append('rect')
                .attr('class', 'dom-bar')
                .attr('x', barX)
                .attr('y', barY)
                .attr('width', xScale.bandwidth())
                .attr('height', barHeight)
                .attr('fill', netVal >= 0 ? this.colors.bullish : this.colors.bearish)
                .attr('rx', 2)
                .attr('opacity', 0.8)
                .attr('cursor', 'pointer');

            // Add breach indicator on top/bottom of bar
            if (d.isHighBreach) {
                svg.append('path')
                    .attr('d', d3.symbol().type(d3.symbolTriangle).size(60)())
                    .attr('transform', `translate(${barX + xScale.bandwidth() / 2}, ${barY - 10})`)
                    .attr('fill', this.colors.bullish)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1);

                svg.append('text')
                    .attr('x', barX + xScale.bandwidth() / 2)
                    .attr('y', barY - 18)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', '7px')
                    .attr('fill', this.colors.bullish)
                    .attr('font-weight', '700')
                    .text('H↑');
            }

            if (d.isLowBreach) {
                svg.append('path')
                    .attr('d', d3.symbol().type(d3.symbolTriangle).size(60)())
                    .attr('transform', `translate(${barX + xScale.bandwidth() / 2}, ${barY + barHeight + 10}) rotate(180)`)
                    .attr('fill', this.colors.bearish)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 1);

                svg.append('text')
                    .attr('x', barX + xScale.bandwidth() / 2)
                    .attr('y', barY + barHeight + 24)
                    .attr('text-anchor', 'middle')
                    .attr('font-size', '7px')
                    .attr('fill', this.colors.bearish)
                    .attr('font-weight', '700')
                    .text('L↓');
            }

            // Add hover event to bar
            bar.on('mouseover', (event) => {
                // Calculate bulls and bears contribution
                const bullValue = d.bull_value || d.pe_change || Math.max(0, netVal);
                const bearValue = d.bear_value || d.ce_change || Math.abs(Math.min(0, netVal));
                const dominance = netVal >= 0 ? 'BULLS' : 'BEARS';
                const dominanceColor = netVal >= 0 ? this.colors.bullish : this.colors.bearish;

                let breachInfo = '';
                if (d.isHighBreach) {
                    breachInfo = `<div style="color: ${this.colors.bullish}; font-weight: 700; margin-top: 8px; padding-top: 8px; border-top: 1px solid #374151;">⬆️ NEW HIGH BREACH!</div>`;
                } else if (d.isLowBreach) {
                    breachInfo = `<div style="color: ${this.colors.bearish}; font-weight: 700; margin-top: 8px; padding-top: 8px; border-top: 1px solid #374151;">⬇️ NEW LOW BREACH!</div>`;
                }

                tooltip.transition().duration(200).style('opacity', 1);
                tooltip.html(`
                    <div style="font-weight: 700; font-size: 14px; margin-bottom: 10px; color: #8b5cf6; border-bottom: 1px solid #374151; padding-bottom: 8px;">
                        ${d.time_label}
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px;">
                        <div>
                            <div style="color: #94a3b8; font-size: 10px;">🐂 Bulls</div>
                            <div style="color: ${this.colors.bullish}; font-weight: 700; font-size: 14px;">${bullValue.toFixed(2)}</div>
                        </div>
                        <div>
                            <div style="color: #94a3b8; font-size: 10px;">🐻 Bears</div>
                            <div style="color: ${this.colors.bearish}; font-weight: 700; font-size: 14px;">${bearValue.toFixed(2)}</div>
                        </div>
                    </div>
                    <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 12px; margin-bottom: 8px;">
                        <div>
                            <div style="color: #94a3b8; font-size: 10px;">Session High</div>
                            <div style="color: #fbbf24; font-weight: 600;">${d.runningHigh.toFixed(2)}</div>
                        </div>
                        <div>
                            <div style="color: #94a3b8; font-size: 10px;">Session Low</div>
                            <div style="color: #fbbf24; font-weight: 600;">${d.runningLow.toFixed(2)}</div>
                        </div>
                    </div>
                    <div style="border-top: 1px solid #374151; padding-top: 8px;">
                        <div style="display: flex; justify-content: space-between; align-items: center;">
                            <span style="color: #94a3b8;">Net Value:</span>
                            <span style="color: ${dominanceColor}; font-weight: 700; font-size: 16px;">${netVal >= 0 ? '+' : ''}${netVal.toFixed(2)}</span>
                        </div>
                        <div style="text-align: right; margin-top: 4px;">
                            <span style="color: ${dominanceColor}; font-size: 11px; font-weight: 600;">${dominance} DOMINATING</span>
                        </div>
                    </div>
                    ${breachInfo}
                `)
                    .style('left', (event.pageX + 15) + 'px')
                    .style('top', (event.pageY - 28) + 'px');

                // Highlight bar
                d3.select(event.target)
                    .attr('opacity', 1)
                    .attr('stroke', '#fff')
                    .attr('stroke-width', 2);
            })
                .on('mouseout', (event) => {
                    tooltip.transition().duration(200).style('opacity', 0);
                    d3.select(event.target)
                        .attr('opacity', 0.8)
                        .attr('stroke', 'none');
                });
        });

        // X-axis
        const labelStep = data.length <= 10 ? 1 : data.length <= 20 ? 2 : 3;
        const tickValues = timeLabels.filter((_, i) => i % labelStep === 0);

        svg.append('g')
            .attr('transform', `translate(0, ${height})`)
            .call(d3.axisBottom(xScale).tickValues(tickValues))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '10px');

        // Y-axis
        svg.append('g')
            .call(d3.axisLeft(yScale).ticks(5))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '10px');

        svg.selectAll('.domain').attr('stroke', this.colors.grid);
        svg.selectAll('.tick line').attr('stroke', this.colors.grid);

        // Legend with cumulative stats
        const bullsWins = data.filter(d => (d.net_value || 0) > 0).length;
        const bearsWins = data.filter(d => (d.net_value || 0) < 0).length;
        const highBreaches = breachData.filter(d => d.isHighBreach).length;
        const lowBreaches = breachData.filter(d => d.isLowBreach).length;

        svg.append('text')
            .attr('x', width - 10)
            .attr('y', -5)
            .attr('text-anchor', 'end')
            .attr('font-size', '10px')
            .attr('fill', this.colors.text)
            .text(`🐂 ${bullsWins} | 🐻 ${bearsWins} | H↑ ${highBreaches} | L↓ ${lowBreaches}`);
    }

    /**
     * Render Comparison Bar Chart (for dashboard)
     */
    renderComparisonBar(containerId, data, label) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="no-data">No data</div>';
            return;
        }

        const margin = { top: 30, right: 30, bottom: 40, left: 60 };
        const width = container.clientWidth - margin.left - margin.right;
        const height = 200;

        const svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);

        const xScale = d3.scaleBand()
            .domain(data.map(d => d.index))
            .range([0, width])
            .padding(0.3);

        const maxVal = Math.max(...data.map(d => Math.abs(d.value)), 0.1);

        const yScale = d3.scaleLinear()
            .domain([0, maxVal * 1.2])
            .range([height, 0]);

        // Bars
        svg.selectAll('.comp-bar')
            .data(data)
            .enter()
            .append('rect')
            .attr('class', 'comp-bar')
            .attr('x', d => xScale(d.index))
            .attr('y', d => yScale(Math.abs(d.value)))
            .attr('width', xScale.bandwidth())
            .attr('height', d => height - yScale(Math.abs(d.value)))
            .attr('fill', d => d.value >= 0 ? this.colors.bullish : this.colors.bearish)
            .attr('rx', 4)
            .attr('opacity', 0.8);

        // Value labels
        svg.selectAll('.comp-label')
            .data(data)
            .enter()
            .append('text')
            .attr('class', 'comp-label')
            .attr('x', d => xScale(d.index) + xScale.bandwidth() / 2)
            .attr('y', d => yScale(Math.abs(d.value)) - 5)
            .attr('text-anchor', 'middle')
            .attr('font-size', '12px')
            .attr('font-weight', '700')
            .attr('fill', d => d.value >= 0 ? this.colors.bullish : this.colors.bearish)
            .text(d => d.value.toFixed(2));

        // X-axis
        svg.append('g')
            .attr('transform', `translate(0, ${height})`)
            .call(d3.axisBottom(xScale))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '11px')
            .attr('font-weight', '600');

        // Y-axis
        svg.append('g')
            .call(d3.axisLeft(yScale).ticks(5))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '10px');

        svg.selectAll('.domain').attr('stroke', this.colors.grid);
        svg.selectAll('.tick line').attr('stroke', this.colors.grid);

        // Title
        svg.append('text')
            .attr('x', width / 2)
            .attr('y', -10)
            .attr('text-anchor', 'middle')
            .attr('fill', this.colors.textLight)
            .attr('font-size', '12px')
            .attr('font-weight', '600')
            .text(label);
    }

    /**
     * Render PCR Trend Chart
     */
    renderPCRTrendChart(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';

        if (!data || data.length === 0) {
            container.innerHTML = '<div class="no-data">No PCR data</div>';
            return;
        }

        const margin = { top: 15, right: 40, bottom: 25, left: 40 };
        const width = container.clientWidth - margin.left - margin.right;
        const height = 120;

        const svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', width + margin.left + margin.right)
            .attr('height', height + margin.top + margin.bottom)
            .append('g')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);

        const xScale = d3.scalePoint()
            .domain(data.map(d => d.time_label))
            .range([0, width]);

        const pcrValues = data.map(d => d.pcr);
        const minPCR = Math.min(...pcrValues) * 0.95;
        const maxPCR = Math.max(...pcrValues) * 1.05;

        const yScale = d3.scaleLinear()
            .domain([minPCR, maxPCR])
            .range([height, 0]);

        // Grid
        svg.append('g')
            .attr('opacity', 0.15)
            .call(d3.axisLeft(yScale).ticks(4).tickSize(-width).tickFormat(''))
            .selectAll('line')
            .attr('stroke', this.colors.grid);

        // Reference line at PCR = 1
        if (minPCR < 1 && maxPCR > 1) {
            svg.append('line')
                .attr('x1', 0)
                .attr('x2', width)
                .attr('y1', yScale(1))
                .attr('y2', yScale(1))
                .attr('stroke', '#fbbf24')
                .attr('stroke-width', 1)
                .attr('stroke-dasharray', '4,4')
                .attr('opacity', 0.6);

            svg.append('text')
                .attr('x', width + 5)
                .attr('y', yScale(1) + 4)
                .attr('font-size', '9px')
                .attr('fill', '#fbbf24')
                .text('1.0');
        }

        // Line
        const line = d3.line()
            .x(d => xScale(d.time_label))
            .y(d => yScale(d.pcr))
            .curve(d3.curveMonotoneX);

        svg.append('path')
            .datum(data)
            .attr('fill', 'none')
            .attr('stroke', '#8b5cf6')
            .attr('stroke-width', 2)
            .attr('d', line);

        // Area fill
        const area = d3.area()
            .x(d => xScale(d.time_label))
            .y0(height)
            .y1(d => yScale(d.pcr))
            .curve(d3.curveMonotoneX);

        svg.append('path')
            .datum(data)
            .attr('fill', '#8b5cf6')
            .attr('opacity', 0.15)
            .attr('d', area);

        // Points
        svg.selectAll('.pcr-point')
            .data(data)
            .enter()
            .append('circle')
            .attr('class', 'pcr-point')
            .attr('cx', d => xScale(d.time_label))
            .attr('cy', d => yScale(d.pcr))
            .attr('r', 3)
            .attr('fill', '#8b5cf6');

        // X-axis
        const labelStep = data.length <= 6 ? 1 : data.length <= 12 ? 2 : 3;
        const tickValues = data.map(d => d.time_label).filter((_, i) => i % labelStep === 0);

        svg.append('g')
            .attr('transform', `translate(0, ${height})`)
            .call(d3.axisBottom(xScale).tickValues(tickValues))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '9px');

        // Y-axis
        svg.append('g')
            .call(d3.axisLeft(yScale).ticks(4).tickFormat(d => d.toFixed(2)))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '9px');

        svg.selectAll('.domain').attr('stroke', this.colors.grid);
        svg.selectAll('.tick line').attr('stroke', this.colors.grid);

        // Latest value label
        if (data.length > 0) {
            const latest = data[data.length - 1];
            const pcrColor = latest.pcr > 1 ? this.colors.bullish : this.colors.bearish;

            svg.append('text')
                .attr('x', width + 5)
                .attr('y', yScale(latest.pcr) + 4)
                .attr('font-size', '10px')
                .attr('font-weight', '700')
                .attr('fill', pcrColor)
                .text(latest.pcr.toFixed(2));
        }
    }

    /**
     * Render Candlestick Chart with Interval Dominance and OI Sentiment
     * 
     * Layout:
     * - Top 60%: Candlestick chart with dominance bars at bottom
     * - Bottom 40%: OI Sentiment line chart with MA
     * 
     * Uses fixed time buckets from 9:15 to 15:30 (3-minute intervals)
     */
    renderCandlestickChart(containerId, data) {
        const container = document.getElementById(containerId);
        if (!container) return;

        container.innerHTML = '';
        d3.selectAll('.candle-tooltip').remove();

        // Use fixed time slots from backend (or all candles if slots not provided)
        const allSlots = data.slots || [];
        const candles = data.candles || [];
        const oiSentiment = data.oi_sentiment || [];
        const intervalDominance = data.interval_dominance || [];

        // Check if we have any slots to display
        if (allSlots.length === 0 && candles.length === 0) {
            container.innerHTML = '<div class="no-data">Loading candlestick data...</div>';
            return;
        }

        // Filter candles that have actual OHLC data (not null placeholders)
        const validCandles = candles.filter(c => c.open !== null && c.close !== null);

        if (validCandles.length === 0) {
            container.innerHTML = '<div class="no-data">Waiting for market data...</div>';
            return;
        }

        const margin = { top: 20, right: 60, bottom: 30, left: 60 };
        const totalWidth = container.clientWidth - margin.left - margin.right;
        const totalHeight = 400;

        // Panel heights
        const candleHeight = totalHeight * 0.55;
        const dominanceHeight = totalHeight * 0.15;
        const sentimentHeight = totalHeight * 0.25;
        const gapHeight = 10;

        const svg = d3.select(`#${containerId}`)
            .append('svg')
            .attr('width', totalWidth + margin.left + margin.right)
            .attr('height', totalHeight + margin.top + margin.bottom);

        // Create main group
        const mainGroup = svg.append('g')
            .attr('transform', `translate(${margin.left}, ${margin.top})`);

        // X-Scale - use ALL fixed time slots for the domain
        const xScale = d3.scaleBand()
            .domain(allSlots.length > 0 ? allSlots : candles.map(d => d.time_label))
            .range([0, totalWidth])
            .padding(0.2);

        // Build candle lookup map for O(1) access
        const candleMap = new Map(candles.map(c => [c.time_label, c]));

        // ================================================
        // PANEL 1: CANDLESTICK CHART
        // ================================================
        const candleGroup = mainGroup.append('g')
            .attr('class', 'candle-panel');

        // Calculate price range from valid candles only
        const priceMin = d3.min(validCandles, d => d.low) * 0.999;
        const priceMax = d3.max(validCandles, d => d.high) * 1.001;

        const yPriceScale = d3.scaleLinear()
            .domain([priceMin, priceMax])
            .range([candleHeight, 0]);

        // Price grid
        candleGroup.append('g')
            .attr('opacity', 0.15)
            .call(d3.axisLeft(yPriceScale).ticks(5).tickSize(-totalWidth).tickFormat(''))
            .selectAll('line')
            .attr('stroke', this.colors.grid);

        // Current price line - use last valid candle
        const currentPrice = validCandles[validCandles.length - 1]?.close || 0;
        candleGroup.append('line')
            .attr('x1', 0)
            .attr('x2', totalWidth)
            .attr('y1', yPriceScale(currentPrice))
            .attr('y2', yPriceScale(currentPrice))
            .attr('stroke', '#fbbf24')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '4,2');

        // Draw candlesticks - only render where we have valid data
        const candleWidth = Math.max(2, xScale.bandwidth() * 0.8);
        const wickWidth = 1.5;

        validCandles.forEach((d, i) => {
            const x = xScale(d.time_label) + xScale.bandwidth() / 2;
            const isBullish = d.close >= d.open;
            const color = isBullish ? this.colors.bullish : this.colors.bearish;

            // Wick
            candleGroup.append('line')
                .attr('x1', x)
                .attr('x2', x)
                .attr('y1', yPriceScale(d.high))
                .attr('y2', yPriceScale(d.low))
                .attr('stroke', color)
                .attr('stroke-width', wickWidth);

            // Body
            const bodyTop = yPriceScale(Math.max(d.open, d.close));
            const bodyBottom = yPriceScale(Math.min(d.open, d.close));
            const bodyHeight = Math.max(1, bodyBottom - bodyTop);

            candleGroup.append('rect')
                .attr('x', x - candleWidth / 2)
                .attr('y', bodyTop)
                .attr('width', candleWidth)
                .attr('height', bodyHeight)
                .attr('fill', isBullish ? this.colors.bullish : 'transparent')
                .attr('stroke', color)
                .attr('stroke-width', 1);
        });

        // Price Y-axis
        candleGroup.append('g')
            .call(d3.axisLeft(yPriceScale).ticks(5).tickFormat(d => d.toFixed(0)))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '10px');

        // Current price label
        candleGroup.append('text')
            .attr('x', totalWidth + 5)
            .attr('y', yPriceScale(currentPrice) + 4)
            .attr('font-size', '11px')
            .attr('font-weight', '700')
            .attr('fill', '#fbbf24')
            .text(currentPrice.toFixed(2));

        // ================================================
        // PANEL 2: INTERVAL DOMINANCE (below candles)
        // ================================================
        const dominanceGroup = mainGroup.append('g')
            .attr('class', 'dominance-panel')
            .attr('transform', `translate(0, ${candleHeight + gapHeight})`);

        // Calculate dominance scale - use bullish/bearish values from valid candles
        const maxBullish = d3.max(validCandles, d => d.bullish_value || 0) || 1;
        const maxBearish = d3.max(validCandles, d => d.bearish_value || 0) || 1;
        const maxDom = Math.max(maxBullish, maxBearish, 0.5);

        const yDomScale = d3.scaleLinear()
            .domain([-maxDom * 1.1, maxDom * 1.1])
            .range([dominanceHeight, 0]);

        // Zero line for dominance
        dominanceGroup.append('line')
            .attr('x1', 0)
            .attr('x2', totalWidth)
            .attr('y1', yDomScale(0))
            .attr('y2', yDomScale(0))
            .attr('stroke', '#4b5563')
            .attr('stroke-width', 1);

        // Draw dominance bars - only for valid candles
        validCandles.forEach((d, i) => {
            const barX = xScale(d.time_label);
            const barWidth = xScale.bandwidth();
            const bullVal = d.bullish_value || 0;
            const bearVal = d.bearish_value || 0;

            // Bullish bar (green, above zero line)
            if (bullVal > 0) {
                const barHeight = Math.abs(yDomScale(0) - yDomScale(bullVal));
                dominanceGroup.append('rect')
                    .attr('class', 'dominance-bar-bullish')
                    .attr('x', barX)
                    .attr('y', yDomScale(bullVal))
                    .attr('width', barWidth)
                    .attr('height', barHeight)
                    .attr('fill', this.colors.bullish)
                    .attr('opacity', 0.6)
                    .attr('rx', 1);
            }

            // Bearish bar (red, below zero line)
            if (bearVal > 0) {
                const barHeight = Math.abs(yDomScale(-bearVal) - yDomScale(0));
                dominanceGroup.append('rect')
                    .attr('class', 'dominance-bar-bearish')
                    .attr('x', barX)
                    .attr('y', yDomScale(0))
                    .attr('width', barWidth)
                    .attr('height', barHeight)
                    .attr('fill', this.colors.bearish)
                    .attr('opacity', 0.6)
                    .attr('rx', 1);
            }
        });

        // ================================================
        // PANEL 3: OI SENTIMENT LINE CHART
        // ================================================
        const sentimentGroup = mainGroup.append('g')
            .attr('class', 'sentiment-panel')
            .attr('transform', `translate(0, ${candleHeight + dominanceHeight + gapHeight * 2})`);

        // Calculate OI score range from valid candles
        const scores = validCandles.map(d => d.oi_score || 0);
        const maxAbsScore = Math.max(...scores.map(Math.abs), 0.5);

        const ySentimentScale = d3.scaleLinear()
            .domain([-maxAbsScore * 1.2, maxAbsScore * 1.2])
            .range([sentimentHeight, 0]);

        // Sentiment grid
        sentimentGroup.append('g')
            .attr('opacity', 0.15)
            .call(d3.axisLeft(ySentimentScale).ticks(3).tickSize(-totalWidth).tickFormat(''))
            .selectAll('line')
            .attr('stroke', this.colors.grid);

        // Zero line
        sentimentGroup.append('line')
            .attr('x1', 0)
            .attr('x2', totalWidth)
            .attr('y1', ySentimentScale(0))
            .attr('y2', ySentimentScale(0))
            .attr('stroke', '#4b5563')
            .attr('stroke-width', 1);

        // OI Sentiment Area - use fixed slots for X scale
        const xPointScale = d3.scalePoint()
            .domain(allSlots.length > 0 ? allSlots : validCandles.map(d => d.time_label))
            .range([0, totalWidth]);

        const sentimentArea = d3.area()
            .x(d => xPointScale(d.time_label))
            .y0(ySentimentScale(0))
            .y1(d => ySentimentScale(d.oi_score || 0))
            .curve(d3.curveMonotoneX);

        // Gradient for sentiment area
        const gradientId = `sentimentGradient-${containerId}`;
        const gradient = svg.append('defs')
            .append('linearGradient')
            .attr('id', gradientId)
            .attr('x1', '0%')
            .attr('y1', '0%')
            .attr('x2', '0%')
            .attr('y2', '100%');

        gradient.append('stop')
            .attr('offset', '0%')
            .attr('stop-color', this.colors.bullish);

        gradient.append('stop')
            .attr('offset', '100%')
            .attr('stop-color', this.colors.bearish);

        sentimentGroup.append('path')
            .datum(validCandles)
            .attr('fill', `url(#${gradientId})`)
            .attr('opacity', 0.3)
            .attr('d', sentimentArea);

        // OI Sentiment Line
        const sentimentLine = d3.line()
            .x(d => xPointScale(d.time_label))
            .y(d => ySentimentScale(d.oi_score || 0))
            .curve(d3.curveMonotoneX);

        sentimentGroup.append('path')
            .datum(validCandles)
            .attr('fill', 'none')
            .attr('stroke', '#6366f1')
            .attr('stroke-width', 2)
            .attr('d', sentimentLine);

        // Calculate and draw MA(5) from valid candles
        const maData = validCandles.map((d, i) => {
            const period = Math.min(i + 1, 5);
            let sum = 0;
            for (let j = i - period + 1; j <= i; j++) {
                sum += validCandles[j].oi_score || 0;
            }
            return { ...d, ma: sum / period };
        });

        const maLine = d3.line()
            .x(d => xPointScale(d.time_label))
            .y(d => ySentimentScale(d.ma))
            .curve(d3.curveMonotoneX);

        sentimentGroup.append('path')
            .datum(maData)
            .attr('fill', 'none')
            .attr('stroke', '#fbbf24')
            .attr('stroke-width', 2)
            .attr('stroke-dasharray', '5,3')
            .attr('d', maLine);

        // Sentiment Y-axis
        sentimentGroup.append('g')
            .call(d3.axisLeft(ySentimentScale).ticks(3))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '9px');

        // Latest sentiment value
        if (validCandles.length > 0) {
            const latest = validCandles[validCandles.length - 1];
            const score = latest.oi_score || 0;
            sentimentGroup.append('text')
                .attr('x', totalWidth + 5)
                .attr('y', ySentimentScale(score) + 4)
                .attr('font-size', '10px')
                .attr('font-weight', '700')
                .attr('fill', score >= 0 ? this.colors.bullish : this.colors.bearish)
                .text(score.toFixed(2));
        }

        // ================================================
        // X-AXIS (shared at bottom)
        // ================================================
        // X-axis ticks - use fixed slots, show every ~15 min (5 slots)
        const xAxisSlots = allSlots.length > 0 ? allSlots : validCandles.map(d => d.time_label);
        const labelStep = Math.max(1, Math.floor(xAxisSlots.length / 20));
        const tickValues = xAxisSlots.filter((_, i) => i % labelStep === 0);

        mainGroup.append('g')
            .attr('transform', `translate(0, ${totalHeight})`)
            .call(d3.axisBottom(xScale).tickValues(tickValues))
            .selectAll('text')
            .attr('fill', this.colors.text)
            .attr('font-size', '9px');

        // ================================================
        // SYNCHRONIZED TOOLTIP
        // ================================================
        const tooltip = d3.select('body').append('div')
            .attr('class', 'candle-tooltip')
            .style('position', 'absolute')
            .style('background', 'rgba(10, 14, 23, 0.95)')
            .style('color', '#e5e7eb')
            .style('padding', '12px 16px')
            .style('border-radius', '8px')
            .style('border', '1px solid #374151')
            .style('font-size', '11px')
            .style('font-family', 'JetBrains Mono, monospace')
            .style('pointer-events', 'none')
            .style('opacity', 0)
            .style('z-index', 1000)
            .style('min-width', '240px')
            .style('box-shadow', '0 4px 20px rgba(0,0,0,0.5)');

        // Crosshair vertical line
        const crosshair = mainGroup.append('line')
            .attr('class', 'crosshair')
            .attr('y1', 0)
            .attr('y2', totalHeight)
            .attr('stroke', '#6366f1')
            .attr('stroke-width', 1)
            .attr('stroke-dasharray', '4,2')
            .attr('opacity', 0);

        // Overlay for mouse tracking
        mainGroup.append('rect')
            .attr('width', totalWidth)
            .attr('height', totalHeight)
            .attr('fill', 'transparent')
            .attr('cursor', 'crosshair')
            .on('mousemove', (event) => {
                const [mouseX] = d3.pointer(event);

                // Find nearest time slot
                const step = xScale.step();
                const slotsToUse = allSlots.length > 0 ? allSlots : validCandles.map(d => d.time_label);
                const index = Math.min(
                    Math.floor(mouseX / step),
                    slotsToUse.length - 1
                );

                if (index >= 0 && index < slotsToUse.length) {
                    const timeLabel = slotsToUse[index];
                    const d = candleMap.get(timeLabel);
                    const candleX = xScale(timeLabel) + xScale.bandwidth() / 2;

                    // Show crosshair
                    crosshair
                        .attr('x1', candleX)
                        .attr('x2', candleX)
                        .attr('opacity', 0.6);

                    // Check if we have data for this slot
                    if (!d || d.open === null) {
                        // No data for this slot
                        tooltip.style('opacity', 1);
                        tooltip.html(`
                            <div style="font-weight: 700; font-size: 13px; margin-bottom: 10px; color: #8b5cf6; border-bottom: 1px solid #374151; padding-bottom: 8px;">
                                📊 ${timeLabel}
                            </div>
                            <div style="color: #6b7280; text-align: center; padding: 20px 0;">
                                No data yet
                            </div>
                        `)
                            .style('left', (event.pageX + 15) + 'px')
                            .style('top', (event.pageY - 28) + 'px');
                        return;
                    }

                    const isBullish = d.close >= d.open;
                    const changePercent = ((d.close - d.open) / d.open * 100).toFixed(2);
                    const priceColor = isBullish ? this.colors.bullish : this.colors.bearish;
                    const oiColor = (d.oi_score || 0) >= 0 ? this.colors.bullish : this.colors.bearish;

                    tooltip.style('opacity', 1);
                    tooltip.html(`
                        <div style="font-weight: 700; font-size: 13px; margin-bottom: 10px; color: #8b5cf6; border-bottom: 1px solid #374151; padding-bottom: 8px;">
                            📊 ${d.time_label}
                        </div>
                        <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px; margin-bottom: 8px;">
                            <div>
                                <div style="color: #94a3b8; font-size: 9px;">Open</div>
                                <div style="font-weight: 600;">${d.open.toFixed(2)}</div>
                            </div>
                            <div>
                                <div style="color: #94a3b8; font-size: 9px;">High</div>
                                <div style="font-weight: 600;">${d.high.toFixed(2)}</div>
                            </div>
                            <div>
                                <div style="color: #94a3b8; font-size: 9px;">Low</div>
                                <div style="font-weight: 600;">${d.low.toFixed(2)}</div>
                            </div>
                            <div>
                                <div style="color: #94a3b8; font-size: 9px;">Close</div>
                                <div style="color: ${priceColor}; font-weight: 700;">${d.close.toFixed(2)}</div>
                            </div>
                        </div>
                        <div style="border-top: 1px solid #374151; padding-top: 8px; margin-bottom: 8px;">
                            <div style="display: flex; justify-content: space-between;">
                                <span style="color: #94a3b8;">Change:</span>
                                <span style="color: ${priceColor}; font-weight: 700;">${isBullish ? '+' : ''}${changePercent}%</span>
                            </div>
                        </div>
                        <div style="border-top: 1px solid #374151; padding-top: 8px;">
                            <div style="display: grid; grid-template-columns: 1fr 1fr; gap: 8px;">
                                <div>
                                    <div style="color: #94a3b8; font-size: 9px;">🐂 Bullish OI</div>
                                    <div style="color: ${this.colors.bullish}; font-weight: 600;">${(d.bullish_value || 0).toFixed(2)}</div>
                                </div>
                                <div>
                                    <div style="color: #94a3b8; font-size: 9px;">🐻 Bearish OI</div>
                                    <div style="color: ${this.colors.bearish}; font-weight: 600;">${(d.bearish_value || 0).toFixed(2)}</div>
                                </div>
                            </div>
                            <div style="margin-top: 8px; display: flex; justify-content: space-between;">
                                <span style="color: #94a3b8;">OI Score:</span>
                                <span style="color: ${oiColor}; font-weight: 700;">${(d.oi_score || 0) >= 0 ? '+' : ''}${(d.oi_score || 0).toFixed(2)} ${d.oi_signal || 'NEUTRAL'}</span>
                            </div>
                        </div>
                    `)
                        .style('left', (event.pageX + 15) + 'px')
                        .style('top', (event.pageY - 28) + 'px');
                }
            })
            .on('mouseout', () => {
                crosshair.attr('opacity', 0);
                tooltip.style('opacity', 0);
            });

        // Panel labels
        candleGroup.append('text')
            .attr('x', 5)
            .attr('y', -5)
            .attr('font-size', '10px')
            .attr('fill', this.colors.text)
            .text('Price');

        dominanceGroup.append('text')
            .attr('x', 5)
            .attr('y', -3)
            .attr('font-size', '9px')
            .attr('fill', this.colors.text)
            .text('OI Dominance');

        sentimentGroup.append('text')
            .attr('x', 5)
            .attr('y', -3)
            .attr('font-size', '9px')
            .attr('fill', this.colors.text)
            .text('OI Score + MA(5)');

        // Style cleanup
        mainGroup.selectAll('.domain').attr('stroke', this.colors.grid);
        mainGroup.selectAll('.tick line').attr('stroke', this.colors.grid);
    }
}

// Export
window.ChartManager = ChartManager;

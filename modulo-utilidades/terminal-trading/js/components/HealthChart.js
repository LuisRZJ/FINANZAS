/**
 * Componente HealthChart
 * Visualiza la salud del trade y proyección de métricas.
 */

(function() {
    const { useRef, useEffect } = React;

    // Helper interno para calcular niveles de precio basados en MAE %
    const getMaePriceInfo = (maePct, entryPrice, tradeType, spread) => {
        const pct = Number(maePct);
        if (!isFinite(pct) || pct < 0) return null;
        
        const ep = Number(entryPrice);
        const sp = Math.max(0, Number(spread) || 0);
        
        if (!isFinite(ep) || ep <= 0 || !isFinite(sp)) return null;
        
        const half = sp / 2;
        // Ajustar entrada efectiva considerando el spread
        const entryEff = tradeType === 'LONG' ? (ep + half) : (ep - half);
        
        if (!isFinite(entryEff) || entryEff <= 0) return null;
        
        const moveAbs = entryEff * (pct / 100);
        // El nivel de MAE siempre está en contra del trade
        const level = tradeType === 'LONG' ? (entryEff - moveAbs) : (entryEff + moveAbs);
        
        if (!isFinite(level) || !isFinite(moveAbs)) return null;
        
        return {
            entryEff,
            level,
            moveAbs
        };
    };

    window.getMaePriceInfo = getMaePriceInfo;

    window.HealthChart = ({
        csvData,
        liveHistory,
        entryIndex,
        candlesSinceEntry,
        tfMinutes,
        simResult,
        tradeType,
        entryPrice,
        stopLoss,
        takeProfit,
        currentPrice,
        liveTradeStatus,
        spread = 0 // Nueva prop
    }) => {
        const containerRef = useRef(null);
        const chartRef = useRef(null);
        const resizeHandlerRef = useRef(null);

        useEffect(() => {
            const container = containerRef.current;
            if (!container) return;
            if (!simResult) return;
            if (liveTradeStatus && liveTradeStatus.status && liveTradeStatus.status !== 'ACTIVE') return;

            const lc = window.LightweightCharts;
            if (!lc || typeof lc.createChart !== 'function') {
                container.innerHTML = '<div class="flex items-center justify-center h-full text-amber-600 dark:text-amber-400 p-4 text-center font-medium">Librería de gráficos no disponible. Verifica tu conexión a internet para cargar Lightweight Charts.</div>';
                return;
            }

            const idx = Number(entryIndex);
            if (!isFinite(idx) || idx < 0 || idx >= csvData.length) return;
            const entryCandle = csvData[idx];
            if (!entryCandle || !(entryCandle.datetime instanceof Date) || isNaN(entryCandle.datetime.getTime())) return;

            if (chartRef.current) {
                try { chartRef.current.remove(); } catch (e) { }
                chartRef.current = null;
            }
            container.innerHTML = '';

            const isDark = document.documentElement.classList.contains('dark');
            const chart = lc.createChart(container, {
                height: 400,
                width: container.clientWidth || 800,
                layout: {
                    background: { color: isDark ? '#0f172a' : '#ffffff' },
                    textColor: isDark ? '#cbd5e1' : '#0f172a'
                },
                grid: {
                    vertLines: { color: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.08)' },
                    horzLines: { color: isDark ? 'rgba(148,163,184,0.12)' : 'rgba(15,23,42,0.08)' }
                },
                rightPriceScale: { borderVisible: false },
                timeScale: { borderVisible: false, rightOffset: 6 },
                crosshair: { mode: lc.CrosshairMode.Normal }
            });
            chartRef.current = chart;

            const addCandles = (opts) => {
                if (typeof chart.addCandlestickSeries === 'function') return chart.addCandlestickSeries(opts);
                if (typeof chart.addSeries === 'function' && lc.CandlestickSeries) return chart.addSeries(lc.CandlestickSeries, opts);
                return null;
            };
            const addLine = (opts) => {
                if (typeof chart.addLineSeries === 'function') return chart.addLineSeries(opts);
                if (typeof chart.addSeries === 'function' && lc.LineSeries) return chart.addSeries(lc.LineSeries, opts);
                return null;
            };

            const candleSeries = addCandles({
                upColor: '#16a34a',
                downColor: '#dc2626',
                borderUpColor: '#16a34a',
                borderDownColor: '#dc2626',
                wickUpColor: '#16a34a',
                wickDownColor: '#dc2626'
            });
            if (!candleSeries) return;

            const startIdx = Math.max(0, idx - 50);
            const p80 = Number(simResult.p80Duration);
            const post = isFinite(p80) ? Math.max(80, p80 + 20) : 120;
            const endIdx = Math.min(csvData.length - 1, idx + post);
            const slice = csvData.slice(startIdx, endIdx + 1);
            const series = [];
            for (let i = 0; i < slice.length; i++) {
                const c = slice[i];
                if (!c || !(c.datetime instanceof Date) || isNaN(c.datetime.getTime())) continue;
                series.push({
                    time: Math.floor(c.datetime.getTime() / 1000),
                    open: Number(c.open),
                    high: Number(c.high),
                    low: Number(c.low),
                    close: Number(c.close)
                });
            }

            const history = Array.isArray(liveHistory) ? liveHistory : [];
            for (let i = 0; i < history.length; i++) {
                const c = history[i];
                if (!c || !(c.datetime instanceof Date) || isNaN(c.datetime.getTime())) continue;
                series.push({
                    time: Math.floor(c.datetime.getTime() / 1000),
                    open: Number(c.open),
                    high: Number(c.high),
                    low: Number(c.low),
                    close: Number(c.close)
                });
            }

            const timeMap = new Map();
            for (let i = 0; i < series.length; i++) {
                const b = series[i];
                if (!b) continue;
                if (!isFinite(b.time)) continue;
                if (![b.open, b.high, b.low, b.close].every(x => isFinite(x))) continue;
                timeMap.set(b.time, b);
            }
            const bars = Array.from(timeMap.values()).sort((a, b) => a.time - b.time);

            if (!bars.length) return;
            candleSeries.setData(bars);

            // --- EMA 200 ---
            const emaData = [];
            const emaPeriod = 200;
            if (bars.length >= emaPeriod) {
                let sum = 0;
                for (let i = 0; i < emaPeriod; i++) {
                    sum += bars[i].close;
                }
                let ema = sum / emaPeriod;
                emaData.push({ time: bars[emaPeriod - 1].time, value: ema });

                const k = 2 / (emaPeriod + 1);
                for (let i = emaPeriod; i < bars.length; i++) {
                    const price = bars[i].close;
                    ema = (price * k) + (ema * (1 - k));
                    emaData.push({ time: bars[i].time, value: ema });
                }
            }

            if (emaData.length > 0) {
                const emaSeries = addLine({
                    color: '#000000',
                    lineWidth: 1,
                    lineStyle: lc.LineStyle.Solid,
                    title: 'EMA 200',
                    crosshairMarkerVisible: false,
                    priceLineVisible: false,
                    lastValueVisible: false
                });
                if (emaSeries) emaSeries.setData(emaData);
            }

            const sl = Number(stopLoss);
            const tp = Number(takeProfit);
            const ep = Number(entryPrice);
            const current = Number(currentPrice);
            const since = Number(candlesSinceEntry);
            const tfMin = Number(tfMinutes);

            const adrTop = Number(entryCandle.adrRoomTop);
            const adrBottom = Number(entryCandle.adrRoomBottom);
            
            // Usar el helper con todos los argumentos necesarios
            const maxMaeInfo = getMaePriceInfo(simResult.maxMae, entryPrice, tradeType, spread);
            const avgMaeInfo = getMaePriceInfo(simResult.avgMae, entryPrice, tradeType, spread);

            const rangeValues = [];
            if (isFinite(sl)) rangeValues.push(sl);
            if (isFinite(tp)) rangeValues.push(tp);
            if (isFinite(ep)) rangeValues.push(ep);
            if (isFinite(current) && current > 0) rangeValues.push(current);
            if (isFinite(adrTop)) rangeValues.push(adrTop);
            if (isFinite(adrBottom)) rangeValues.push(adrBottom);
            if (maxMaeInfo && isFinite(maxMaeInfo.level)) rangeValues.push(Number(maxMaeInfo.level));
            if (avgMaeInfo && isFinite(avgMaeInfo.level)) rangeValues.push(Number(avgMaeInfo.level));

            const minBase = rangeValues.length ? Math.min(...rangeValues) : null;
            const maxBase = rangeValues.length ? Math.max(...rangeValues) : null;
            const pad = (minBase != null && maxBase != null) ? Math.max((maxBase - minBase) * 0.1, (maxBase || 1) * 0.002) : 0;
            const rangeMin = minBase != null ? (minBase - pad) : null;
            const rangeMax = maxBase != null ? (maxBase + pad) : null;

            if (rangeMin != null && rangeMax != null && isFinite(rangeMin) && isFinite(rangeMax) && rangeMax > rangeMin) {
                candleSeries.applyOptions({
                    autoscaleInfoProvider: () => ({
                        priceRange: { minValue: rangeMin, maxValue: rangeMax }
                    })
                });
            }

            if (isFinite(ep)) {
                candleSeries.createPriceLine({
                    price: ep,
                    color: '#2563eb',
                    lineWidth: 2,
                    lineStyle: lc.LineStyle.Solid,
                    axisLabelVisible: true,
                    title: 'Entry'
                });
            }
            if (isFinite(tp)) {
                candleSeries.createPriceLine({
                    price: tp,
                    color: '#16a34a',
                    lineWidth: 2,
                    lineStyle: lc.LineStyle.Solid,
                    axisLabelVisible: true,
                    title: 'TP'
                });
            }
            if (isFinite(sl)) {
                candleSeries.createPriceLine({
                    price: sl,
                    color: '#dc2626',
                    lineWidth: 2,
                    lineStyle: lc.LineStyle.Solid,
                    axisLabelVisible: true,
                    title: 'SL'
                });
            }

            if (isFinite(adrTop)) {
                candleSeries.createPriceLine({
                    price: adrTop,
                    color: isDark ? 'rgba(167,139,250,0.9)' : 'rgba(100,116,139,0.9)',
                    lineWidth: 1,
                    lineStyle: lc.LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: 'ADR High'
                });
            }
            if (isFinite(adrBottom)) {
                candleSeries.createPriceLine({
                    price: adrBottom,
                    color: isDark ? 'rgba(167,139,250,0.9)' : 'rgba(100,116,139,0.9)',
                    lineWidth: 1,
                    lineStyle: lc.LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: 'ADR Low'
                });
            }

            if (maxMaeInfo && isFinite(maxMaeInfo.level)) {
                candleSeries.createPriceLine({
                    price: maxMaeInfo.level,
                    color: '#ea580c',
                    lineWidth: 2,
                    lineStyle: lc.LineStyle.Solid,
                    axisLabelVisible: true,
                    title: 'Peor MAE Histórico'
                });
            }
            if (avgMaeInfo && isFinite(avgMaeInfo.level)) {
                candleSeries.createPriceLine({
                    price: avgMaeInfo.level,
                    color: '#fb923c',
                    lineWidth: 2,
                    lineStyle: lc.LineStyle.Dashed,
                    axisLabelVisible: true,
                    title: 'MAE Promedio'
                });
            }

            const addVerticalHint = (tSec, color) => {
                if (!isFinite(tSec) || tSec <= 0) return null;
                if (rangeMin == null || rangeMax == null) return null;
                const s = addLine({
                    color,
                    lineWidth: 2,
                    lineStyle: lc.LineStyle.Solid,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false
                });
                if (!s) return null;
                s.setData([
                    { time: tSec - 1, value: rangeMin },
                    { time: tSec + 1, value: rangeMax }
                ]);
                return s;
            };

            const markers = [];
            const entryTimeSec = Math.floor(entryCandle.datetime.getTime() / 1000);
            markers.push({
                time: entryTimeSec,
                position: tradeType === 'LONG' ? 'belowBar' : 'aboveBar',
                color: '#2563eb',
                shape: tradeType === 'LONG' ? 'arrowUp' : 'arrowDown',
                text: 'Entry'
            });

            const medianDur = Number(simResult.medianDuration);
            const p80Dur = Number(simResult.p80Duration);
            const tfSec = isFinite(tfMin) && tfMin > 0 ? tfMin * 60 : null;
            if (tfSec) {
                if (isFinite(medianDur) && medianDur > 0) {
                    const tMed = entryTimeSec + Math.round(medianDur * tfSec);
                    addVerticalHint(tMed, 'rgba(234,179,8,0.9)');
                    markers.push({
                        time: tMed,
                        position: 'aboveBar',
                        color: '#eab308',
                        shape: 'circle',
                        text: 'Fase de Decisión'
                    });
                }
                if (isFinite(p80Dur) && p80Dur > 0) {
                    const tP80 = entryTimeSec + Math.round(p80Dur * tfSec);
                    addVerticalHint(tP80, 'rgba(239,68,68,0.9)');
                    markers.push({
                        time: tP80,
                        position: 'aboveBar',
                        color: '#ef4444',
                        shape: 'circle',
                        text: 'Time Stop'
                    });
                }
            }

            const lastBar = bars[bars.length - 1];
            if (lastBar && isFinite(current) && current > 0) {
                const ghost = addLine({
                    color: isDark ? 'rgba(148,163,184,0.9)' : 'rgba(71,85,105,0.9)',
                    lineWidth: 2,
                    lineStyle: lc.LineStyle.Dotted,
                    priceLineVisible: false,
                    lastValueVisible: false,
                    crosshairMarkerVisible: false
                });
                if (ghost) {
                    const projected = (tfSec && isFinite(since) && since >= 0) ? (entryTimeSec + Math.round(since * tfSec)) : Math.floor(Date.now() / 1000);
                    const nowSec = Math.max(projected, lastBar.time + 60);
                    ghost.setData([
                        { time: lastBar.time, value: lastBar.close },
                        { time: nowSec, value: current }
                    ]);
                    markers.push({
                        time: nowSec,
                        position: 'aboveBar',
                        color: isDark ? '#e2e8f0' : '#0f172a',
                        shape: 'circle',
                        text: 'Precio actual'
                    });
                }
            }

            if (candleSeries && typeof candleSeries.setMarkers === 'function') {
                candleSeries.setMarkers(markers);
            }
            chart.timeScale().fitContent();

            const handleResize = () => {
                const el = containerRef.current;
                if (!el || !chartRef.current) return;
                chartRef.current.applyOptions({ width: el.clientWidth || 800 });
            };

            if (resizeHandlerRef.current) {
                window.removeEventListener('resize', resizeHandlerRef.current);
                resizeHandlerRef.current = null;
            }
            resizeHandlerRef.current = handleResize;
            window.addEventListener('resize', handleResize);

            return () => {
                if (resizeHandlerRef.current) {
                    window.removeEventListener('resize', resizeHandlerRef.current);
                    resizeHandlerRef.current = null;
                }
                if (chartRef.current) {
                    try { chartRef.current.remove(); } catch (e) { }
                    chartRef.current = null;
                }
            };
        }, [csvData, liveHistory, entryIndex, candlesSinceEntry, tfMinutes, simResult, tradeType, entryPrice, stopLoss, takeProfit, currentPrice, liveTradeStatus, spread]);

        return (
            <div
                id="health-chart-container"
                ref={containerRef}
                className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-xl shadow-lg overflow-hidden"
                style={{ height: '400px' }}
            />
        );
    };
})();

import { parseCSV } from './utilidades/parser.js';
import { calculateMetrics } from './utilidades/calculos.js';
import { initChart } from './utilidades/graficas.js';
import { loadComponents } from './utilidades/loader.js';
import { simulateDCA } from './utilidades/dca.js';
import { rankResults, runBacktestInline, computeMACache } from './utilidades/optimizador.js';
import { fetchBinanceKlines, detectFirstCandle, getIntervalMilliseconds } from './utilidades/binance.js';
import { 
    estaAutenticadoEnNube, 
    guardarPasswordNube, 
    cerrarSesionNube, 
    respaldarDatosNube, 
    restaurarDatosNube, 
    verificarNubeInicioCloud 
} from './utilidades/sync.js';

document.addEventListener('DOMContentLoaded', async () => {
    // 1. Cargar e inyectar componentes HTML
    await loadComponents();

    // ─── Sincronización en la Nube ──────────────────────
    function updateCloudSyncUI() {
        const guestEl = document.getElementById('auth-guest-cloud');
        const userEl = document.getElementById('auth-user-cloud');
        const msgEl = document.getElementById('sync-message-cloud');

        if (!guestEl || !userEl) return;

        if (estaAutenticadoEnNube()) {
            guestEl.style.display = 'none';
            userEl.style.display = 'block';

            const lastSyncStr = localStorage.getItem('trading_last_sync_timestamp');
            if (msgEl) {
                if (lastSyncStr) {
                    const d = new Date(lastSyncStr);
                    msgEl.textContent = `Último respaldo: ${d.toLocaleString()}`;
                    msgEl.className = 'text-sm text-gray-500 dark:text-gray-400';
                } else {
                    msgEl.textContent = 'Sin respaldos recientes en esta sesión.';
                    msgEl.className = 'text-sm text-yellow-650 dark:text-yellow-450';
                }
            }
        } else {
            guestEl.style.display = 'block';
            userEl.style.display = 'none';
        }
    }

    // Bindeos de eventos para Sincronización en la Nube
    document.getElementById('form-login-cloud')?.addEventListener('submit', (e) => {
        e.preventDefault();
        const password = document.getElementById('input-cloud-password')?.value;
        if (password) {
            guardarPasswordNube(password);
            document.getElementById('form-login-cloud').reset();
            updateCloudSyncUI();
            alert('Sesión de nube iniciada exitosamente.');
            verificarNubeInicioCloud(updateCloudSyncUI).catch(err => console.error(err));
        }
    });

    document.getElementById('btn-logout-cloud')?.addEventListener('click', () => {
        cerrarSesionNube();
        updateCloudSyncUI();
        alert('Sesión cerrada.');
    });

    document.getElementById('btn-backup-cloud')?.addEventListener('click', async () => {
        const btn = document.getElementById('btn-backup-cloud');
        const msgEl = document.getElementById('sync-message-cloud');
        if (btn) btn.disabled = true;

        await respaldarDatosNube(
            (msg) => {
                if (msgEl) {
                    msgEl.textContent = msg;
                    msgEl.className = 'text-sm text-blue-600 dark:text-blue-400';
                }
            },
            (timestamp) => {
                if (btn) btn.disabled = false;
                alert('Respaldo en la nube completado exitosamente.');
                updateCloudSyncUI();
            },
            (err) => {
                if (btn) btn.disabled = false;
                alert('Error al realizar el respaldo: ' + err);
                updateCloudSyncUI();
            }
        );
    });

    document.getElementById('btn-restore-cloud')?.addEventListener('click', async () => {
        if (!confirm('¿Estás seguro de restaurar los datos de la nube? Esto reemplazará toda tu información de trading actual.')) {
            return;
        }
        const btn = document.getElementById('btn-restore-cloud');
        const msgEl = document.getElementById('sync-message-cloud');
        if (btn) btn.disabled = true;

        await restaurarDatosNube(
            (msg) => {
                if (msgEl) {
                    msgEl.textContent = msg;
                    msgEl.className = 'text-sm text-blue-600 dark:text-blue-400';
                }
            },
            (timestamp) => {
                if (btn) btn.disabled = false;
                alert('Datos de trading restaurados desde la nube con éxito.');
                location.reload();
            },
            (err) => {
                if (btn) btn.disabled = false;
                alert('Error al restaurar: ' + err);
                updateCloudSyncUI();
            }
        );
    });

    // Cargar UI inicial
    updateCloudSyncUI();

    // Lanzar chequeo automático
    verificarNubeInicioCloud(updateCloudSyncUI).catch(err => console.error("Error en verificarNubeInicioCloud:", err));

    // ─── Estado Global ─────────────────────────────────
    let globalDataArray = null;
    let lastOptimizationContext = null; // Datos para el buscador de estrategias

    // ─── Referencias DOM Base ──────────────────────────
    const fileInput = document.getElementById('file-upload');
    const loadingEl = document.getElementById('loading');
    const resultsPanel = document.getElementById('results-panel');
    const dcaModal = document.getElementById('dca-modal');
    const errorEl = document.getElementById('error-message');

    const roiValue = document.getElementById('roi-value');
    const cagrValue = document.getElementById('cagr-value');
    const drawdownValue = document.getElementById('drawdown-value');
    const tableBody = document.getElementById('annual-returns-body');
    const timePeriodEl = document.getElementById('time-period');

    // ─── Modal DCA ─────────────────────────────────────
    const openDcaBtn = document.getElementById('open-dca-btn');
    const closeDcaBtn = document.getElementById('close-dca-btn');
    const applyDcaBtn = document.getElementById('apply-dca-btn');
    const dcaInitialInput = document.getElementById('dca-initial');
    const dcaRecurringInput = document.getElementById('dca-recurring');
    const dcaFrequencySelect = document.getElementById('dca-frequency');
    const dcaTotalInvestedEl = document.getElementById('dca-total-invested');
    const dcaPortfolioValueEl = document.getElementById('dca-portfolio-value');
    const dcaRoiEl = document.getElementById('dca-roi');

    // ─── Modal Estrategia ──────────────────────────────
    const estrategiaModal = document.getElementById('estrategia-modal');
    const openEstrategiaBtn = document.getElementById('open-estrategia-btn');
    const closeEstrategiaBtn = document.getElementById('close-estrategia-btn');
    const runOptBtn = document.getElementById('run-optimization-btn');
    const optProgressContainer = document.getElementById('opt-progress-container');
    const optProgressBar = document.getElementById('opt-progress-bar');
    const optProgressText = document.getElementById('opt-progress-text');
    const optComboEstimate = document.getElementById('opt-combo-estimate');

    // ─── Resultados Estrategia ─────────────────────────
    const estrategiaResults = document.getElementById('estrategia-results');
    const splitInfo = document.getElementById('split-info');

    // ─── Formateadores ─────────────────────────────────
    const mxnFormatter = new Intl.NumberFormat('es-MX', {
        style: 'currency', currency: 'MXN', minimumFractionDigits: 2
    });

    // ═══════════════════════════════════════════════════
    //  FUNCIÓN CENTRAL: Recálculo y render de métricas
    // ═══════════════════════════════════════════════════
    function runSimulationAndUpdateUI() {
        if (!globalDataArray || globalDataArray.length === 0) return;

        const metrics = calculateMetrics(globalDataArray);

        roiValue.textContent = `${metrics.totalROI.toFixed(2)}%`;
        roiValue.style.color = metrics.totalROI >= 0 ? 'var(--positive)' : 'var(--negative)';
        cagrValue.textContent = `${metrics.cagr.toFixed(2)}%`;
        cagrValue.style.color = metrics.cagr >= 0 ? 'var(--positive)' : 'var(--negative)';
        drawdownValue.textContent = `${metrics.maxDrawdown.toFixed(2)}%`;

        if (timePeriodEl) {
            const totalDays = Math.round(metrics.timeSpan.days);
            const totalYears = metrics.timeSpan.years.toFixed(1);
            let timeString = totalDays < 365 ? `${totalDays} días` : `${totalYears} años (${totalDays} días)`;
            timePeriodEl.textContent = `Análisis basado en un historial de ${timeString} (${globalDataArray.length} velas procesadas)`;
        }

        tableBody.innerHTML = '';
        metrics.annualReturns.forEach(ar => {
            const tr = document.createElement('tr');
            const returnColor = ar.returnPerc >= 0 ? 'var(--positive)' : 'var(--negative)';
            tr.innerHTML = `
                <td>${ar.year}</td>
                <td>${mxnFormatter.format(ar.startPrice)}</td>
                <td>${mxnFormatter.format(ar.endPrice)}</td>
                <td style="color: ${returnColor}; font-weight: bold;">${ar.returnPerc.toFixed(2)}%</td>
            `;
            tableBody.appendChild(tr);
        });

        // --- Simulación DCA ---
        let dcaTimelineData = null;
        if (dcaModal) {
            const initialCap = parseFloat(dcaInitialInput.value) || 0;
            const recurringCap = parseFloat(dcaRecurringInput.value) || 0;
            const freq = dcaFrequencySelect.value;
            const dcaResult = simulateDCA(globalDataArray, initialCap, recurringCap, freq);
            if (dcaResult) {
                dcaTotalInvestedEl.textContent = mxnFormatter.format(dcaResult.totalInvested);
                dcaPortfolioValueEl.textContent = mxnFormatter.format(dcaResult.endPortfolioValue);
                dcaRoiEl.textContent = `${dcaResult.returnPerc.toFixed(2)}%`;
                dcaRoiEl.style.color = dcaResult.returnPerc >= 0 ? 'var(--positive)' : 'var(--negative)';
                dcaTimelineData = dcaResult.timeline;

                // Calcular CAGR del DCA
                const dcaCagrEl = document.getElementById('dca-cagr');
                if (dcaCagrEl && dcaResult.totalInvested > 0 && globalDataArray.length > 1) {
                    const firstDate = globalDataArray[0].date;
                    const lastDate = globalDataArray[globalDataArray.length - 1].date;
                    const years = (new Date(lastDate) - new Date(firstDate)) / (1000 * 60 * 60 * 24 * 365.25);
                    if (years > 0) {
                        const dcaCagr = (Math.pow(dcaResult.endPortfolioValue / dcaResult.totalInvested, 1 / years) - 1) * 100;
                        dcaCagrEl.textContent = `${dcaCagr.toFixed(2)}%`;
                        dcaCagrEl.style.color = dcaCagr >= 0 ? 'var(--positive)' : 'var(--negative)';
                    }
                }
            }
        }

        initChart('price-chart', globalDataArray, dcaTimelineData);
        loadingEl.classList.add('hidden');
        resultsPanel.classList.remove('hidden');
    }

    // ═══════════════════════════════════════════════════
    //  ESTIMACIÓN DE COMBINACIONES
    // ═══════════════════════════════════════════════════
    function updateComboEstimate() {
        const min = parseInt(document.getElementById('opt-min-period').value) || 5;
        const max = parseInt(document.getElementById('opt-max-period').value) || 200;
        const step = parseInt(document.getElementById('opt-step').value) || 5;
        const maTypeVal = document.getElementById('opt-ma-type').value;
        const exitModeVal = document.getElementById('opt-exit-mode')?.value || 'both';

        const periods = [];
        for (let p = min; p <= max; p += step) periods.push(p);
        const n = periods.length;
        const combosPerType = (n * (n - 1)) / 2; // fast < slow

        let types = 1;
        if (maTypeVal === 'both') types = 2;
        if (maTypeVal === 'auto') types = 4;

        // Contar configuraciones de salida
        let exitConfigs = 0;
        const shouldClassic = exitModeVal === 'classic' || exitModeVal === 'both';
        const shouldFixed = exitModeVal === 'fixed' || exitModeVal === 'both';
        if (shouldClassic) exitConfigs += 1;
        if (shouldFixed) {
            exitConfigs += 1; // Solo 1 config fija: slCandles + rr
        }

        const totalCombos = combosPerType * types * exitConfigs;

        if (optComboEstimate) {
            optComboEstimate.textContent = `Se probarán ~${totalCombos.toLocaleString()} combinaciones (${n} periodos × ${types} tipo${types > 1 ? 's' : ''} de MA × ${exitConfigs} config${exitConfigs > 1 ? 's' : ''} de salida).`;
        }
    }

    // ─── Show/hide panel de R:R según exit mode ───
    function updateExitModeUI() {
        const exitMode = document.getElementById('opt-exit-mode')?.value || 'both';
        const rrPanel = document.getElementById('fixed-rr-params');
        if (rrPanel) {
            rrPanel.style.display = exitMode === 'classic' ? 'none' : '';
        }
        updateComboEstimate();
    }

    // Actualizar estimación cuando cambien los inputs del modal
    ['opt-min-period', 'opt-max-period', 'opt-step', 'opt-ma-type', 'opt-sl-candles', 'opt-rr'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('input', updateComboEstimate);
        if (el) el.addEventListener('change', updateComboEstimate);
    });

    // Listener especial para exit mode (show/hide)
    const exitModeSelect = document.getElementById('opt-exit-mode');
    if (exitModeSelect) {
        exitModeSelect.addEventListener('change', updateExitModeUI);
        updateExitModeUI(); // Estado inicial
    }

    // ═══════════════════════════════════════════════════
    //  OPTIMIZACIÓN VÍA WEB WORKER
    // ═══════════════════════════════════════════════════
    function runOptimization() {
        if (!globalDataArray || globalDataArray.length === 0) return;

        const minPeriod = parseInt(document.getElementById('opt-min-period').value) || 5;
        const maxPeriod = parseInt(document.getElementById('opt-max-period').value) || 200;
        const step = parseInt(document.getElementById('opt-step').value) || 5;
        const maTypeVal = document.getElementById('opt-ma-type').value;
        let maTypes = [maTypeVal];
        if (maTypeVal === 'both') maTypes = ['SMA', 'EMA'];
        if (maTypeVal === 'auto') maTypes = ['SMA', 'EMA', 'SMA/EMA', 'EMA/SMA'];
        const trainRatio = parseFloat(document.getElementById('opt-train-ratio').value) || 0.7;

        const exitModeVal = document.getElementById('opt-exit-mode')?.value || 'both';
        const exitModes = [exitModeVal];

        const slCandles = parseInt(document.getElementById('opt-sl-candles')?.value) || 5;
        const rr = parseFloat(document.getElementById('opt-rr')?.value) || 2;
        const riskPerTrade = parseFloat(document.getElementById('opt-risk-per-trade')?.value) || 2;
        const riskFraction = riskPerTrade / 100; // 2% → 0.02
        const simulatedCapital = parseFloat(document.getElementById('opt-capital')?.value) || 100000;

        const dates = globalDataArray.map(d => d.date);
        const closes = globalDataArray.map(d => d.close);
        const highs = globalDataArray.map(d => d.high);
        const lows = globalDataArray.map(d => d.low);
        const params = { minPeriod, maxPeriod, step, maTypes, trainRatio, exitModes, slCandles, rr, riskFraction, simulatedCapital };

        // ─── UI: Progreso ───
        if (optProgressContainer) optProgressContainer.classList.remove('hidden');
        if (optProgressBar) optProgressBar.style.width = '0%';
        if (optProgressText) optProgressText.textContent = '0%';
        if (runOptBtn) runOptBtn.disabled = true;
        if (runOptBtn) runOptBtn.textContent = '⏳ Optimizando...';

        // ─── Multi-Worker: Spawn N workers ───
        const numWorkers = Math.min(navigator.hardwareConcurrency || 4, 16);
        const progressPerWorker = new Array(numWorkers).fill(0);
        const allTopEntries = [];
        let completedChunks = 0;
        let splitIndex = 0;
        let totalCombinations = 0;
        let totalValidCount = 0;
        const workers = [];

        console.log(`🚀 Lanzando ${numWorkers} workers en paralelo...`);

        function updateProgressBar() {
            const avg = progressPerWorker.reduce((a, b) => a + b, 0) / numWorkers;
            const scaled = Math.round(avg * 0.9); // 0-90% para backtest, 90-100% para ranking
            if (optProgressBar) optProgressBar.style.width = `${scaled}%`;
            if (optProgressText) optProgressText.textContent = `${scaled}% (${numWorkers} hilos)`;
        }

        function onAllChunksDone() {
            // Terminar todos los workers
            workers.forEach(w => w.terminate());

            if (optProgressBar) optProgressBar.style.width = '90%';
            if (optProgressText) optProgressText.textContent = '90% — Clasificando...';

            // Ranking final en hilo principal (rápido: ~200 backtests)
            try {
                const result = rankResults(
                    allTopEntries, dates, closes, highs, lows, params,
                    splitIndex, totalCombinations, totalValidCount
                );

                if (optProgressBar) optProgressBar.style.width = '100%';
                if (optProgressText) optProgressText.textContent = '100%';

                // Guardar contexto para el buscador de estrategias
                lastOptimizationContext = {
                    dates, closes, highs, lows,
                    params,
                    splitIndex: result.splitIndex
                };
                populateSearchDropdowns(params);

                displayOptimizationResults(result);
                if (runOptBtn) runOptBtn.disabled = false;
                if (runOptBtn) runOptBtn.textContent = '🔍 Buscar Mejor Estrategia';
                if (estrategiaModal) {
                    estrategiaModal.close();
                    document.body.style.overflow = '';
                }
            } catch (err) {
                console.error('Error en ranking:', err);
                if (runOptBtn) runOptBtn.disabled = false;
                if (runOptBtn) runOptBtn.textContent = '🔍 Buscar Mejor Estrategia';
                alert('Error durante la clasificación: ' + err.message);
            }
        }

        for (let i = 0; i < numWorkers; i++) {
            const worker = new Worker('./js/workers/optimizador-worker.js', { type: 'module' });

            worker.onmessage = function (e) {
                const { type } = e.data;

                if (type === 'progress') {
                    progressPerWorker[e.data.chunkIdx] = e.data.progress;
                    updateProgressBar();
                }

                if (type === 'chunk-done') {
                    const { result } = e.data;
                    allTopEntries.push(...result.topEntries);
                    splitIndex = result.splitIndex;
                    totalCombinations = result.totalCombinations;
                    totalValidCount += result.validCount;
                    completedChunks++;

                    if (completedChunks === numWorkers) onAllChunksDone();
                }

                if (type === 'error') {
                    workers.forEach(w => w.terminate());
                    console.error('Error en Worker:', e.data.error);
                    if (runOptBtn) runOptBtn.disabled = false;
                    if (runOptBtn) runOptBtn.textContent = '🔍 Buscar Mejor Estrategia';
                    alert('Error durante la optimización: ' + e.data.error);
                }
            };

            worker.postMessage({ dates, closes, highs, lows, params, chunkIdx: i, totalChunks: numWorkers });
            workers.push(worker);
        }
    }

    // ═══════════════════════════════════════════════════
    //  RENDERIZAR RESULTADOS DE OPTIMIZACIÓN
    // ═══════════════════════════════════════════════════
    function displayOptimizationResults(result) {
        if (!result || !result.rankings) return;

        const r = result.rankings;

        // Info del split
        if (splitInfo) {
            splitInfo.textContent = `${result.totalCombinations.toLocaleString()} combinaciones probadas · ${result.validCombinations.toLocaleString()} con ≥3 trades · Train: ${result.trainSize.toLocaleString()} velas · Test: ${result.testSize.toLocaleString()} velas · Riesgo: ${(result.riskFraction * 100).toFixed(1)}% por trade · Capital: $${(lastOptimizationContext?.params?.simulatedCapital || 100000).toLocaleString('es-MX')}`;
        }

        // Todas las tablas usan las mismas columnas completas
        fillRankingTable('table-validated', r.validated);
        fillRankingTable('table-balanced', r.balanced);
        fillRankingTable('table-roi', r.roi);
        fillRankingTable('table-lowdd', r.lowDD);
        fillRankingTable('table-winrate', r.winRate);
        fillRankingTable('table-pf', r.profitFactor);

        // Gráfico comparativo CAGR
        renderCagrComparisonChart(r);

        // Mostrar panel
        if (estrategiaResults) estrategiaResults.classList.remove('hidden');
    }

    // ─── Gráfico CAGR Comparativo ────────────────────────
    let cagrChart = null;

    function renderCagrComparisonChart(rankings) {
        const canvas = document.getElementById('cagr-comparison-chart');
        if (!canvas) return;

        if (cagrChart) cagrChart.destroy();

        // Categorías con colores para agrupar las barras (paleta premium)
        const categories = [
            { key: 'validated', label: '✅ Validadas', color: 'rgba(16, 185, 129, 0.85)', border: '#10b981' },
            { key: 'balanced', label: '⚖️ Balanceadas', color: 'rgba(59, 130, 246, 0.85)', border: '#3b82f6' },
            { key: 'roi', label: '📈 Mayor ROI', color: 'rgba(139, 92, 246, 0.85)', border: '#8b5cf6' },
            { key: 'lowDD', label: '🛡️ Menor DD', color: 'rgba(245, 158, 11, 0.85)', border: '#f59e0b' },
            { key: 'winRate', label: '🎯 Win Rate', color: 'rgba(236, 72, 153, 0.85)', border: '#ec4899' },
            { key: 'profitFactor', label: '💰 Profit Factor', color: 'rgba(14, 165, 233, 0.85)', border: '#0ea5e9' }
        ];

        // Aplanar todas las estrategias con su categoría, deduplicando
        const seen = new Set();
        const labels = [];
        const dataPoints = [];
        const bgColors = [];
        const borderColors = [];

        categories.forEach(cat => {
            const entries = rankings[cat.key] || [];
            entries.forEach((entry, i) => {
                const c = entry.config;
                const id = `${c.fastType}${c.fastPeriod}/${c.slowType}${c.slowPeriod}·${c.exitMode}`;
                if (seen.has(id)) return; // Deduplicar
                seen.add(id);

                let shortLabel = `${c.fastType[0]}${c.fastPeriod}/${c.slowType[0]}${c.slowPeriod}`;
                if (c.exitMode === 'fixed') shortLabel += ` R${c.rr}`;
                labels.push(shortLabel);
                dataPoints.push(entry.test?.cagr ?? entry.train.cagr);
                bgColors.push(cat.color);
                borderColors.push(cat.border);
            });
        });

        // Calcular CAGR del DCA si está configurado
        let dcaCagr = null;
        if (globalDataArray && globalDataArray.length > 1) {
            const initialCap = parseFloat(document.getElementById('dca-initial')?.value) || 0;
            const recurringCap = parseFloat(document.getElementById('dca-recurring')?.value) || 0;
            if (initialCap > 0 || recurringCap > 0) {
                const freq = document.getElementById('dca-frequency')?.value || 'monthly';
                const dcaResult = simulateDCA(globalDataArray, initialCap, recurringCap, freq);
                if (dcaResult && dcaResult.totalInvested > 0) {
                    const firstDate = globalDataArray[0].date;
                    const lastDate = globalDataArray[globalDataArray.length - 1].date;
                    const years = (new Date(lastDate) - new Date(firstDate)) / (1000 * 60 * 60 * 24 * 365.25);
                    if (years > 0) {
                        dcaCagr = (Math.pow(dcaResult.endPortfolioValue / dcaResult.totalInvested, 1 / years) - 1) * 100;
                        if (!isFinite(dcaCagr) || isNaN(dcaCagr)) dcaCagr = null;
                    }
                }
            }
        }

        // Añadir DCA como barra del gráfico si existe
        if (dcaCagr !== null) {
            labels.push('📌 DCA');
            dataPoints.push(dcaCagr);
            bgColors.push('rgba(245, 158, 11, 0.9)');
            borderColors.push('#f59e0b');
        }

        const datasets = [{
            label: 'CAGR (Test)',
            data: dataPoints,
            backgroundColor: bgColors,
            borderColor: borderColors,
            borderWidth: 1.5,
            borderRadius: 6,
            barPercentage: 0.8,
            categoryPercentage: 0.9
        }];

        // Plugin para línea de referencia DCA
        const dcaAnnotationPlugin = {
            id: 'dcaLine',
            afterDatasetsDraw(chart) {
                if (dcaCagr === null) return;
                const { ctx, chartArea: { left, right }, scales: { y } } = chart;
                const yPos = y.getPixelForValue(dcaCagr);
                ctx.save();
                ctx.setLineDash([6, 4]);
                ctx.strokeStyle = '#f59e0b';
                ctx.lineWidth = 2;
                ctx.beginPath();
                ctx.moveTo(left, yPos);
                ctx.lineTo(right, yPos);
                ctx.stroke();

                // Label
                ctx.fillStyle = '#f59e0b';
                ctx.font = 'bold 11px Inter, sans-serif';
                ctx.textAlign = 'right';
                ctx.fillText(`DCA: ${dcaCagr.toFixed(1)}%`, right - 4, yPos - 6);
                ctx.restore();
            }
        };

        cagrChart = new Chart(canvas.getContext('2d'), {
            type: 'bar',
            data: { labels, datasets },
            plugins: [dcaAnnotationPlugin],
            options: {
                responsive: true,
                maintainAspectRatio: false,
                plugins: {
                    legend: { display: false },
                    tooltip: {
                        backgroundColor: 'rgba(22, 26, 43, 0.95)',
                        titleColor: '#f8fafc',
                        bodyColor: '#f8fafc',
                        borderColor: 'rgba(255, 255, 255, 0.1)',
                        borderWidth: 1,
                        padding: 10,
                        callbacks: {
                            label: (ctx) => {
                                const cap = lastOptimizationContext?.params?.simulatedCapital || 100000;
                                const cagr = ctx.parsed.y;
                                const finalVal = fmtMXN.format(cap * (1 + cagr / 100));
                                return `CAGR: ${cagr.toFixed(2)}% → ${finalVal}`;
                            }
                        }
                    }
                },
                scales: {
                    x: {
                        grid: { color: 'rgba(255,255,255,0.04)' },
                        ticks: {
                            color: '#94a3b8',
                            font: { size: 10, family: 'Inter, sans-serif' },
                            maxRotation: 60,
                            minRotation: 30
                        }
                    },
                    y: {
                        grid: { color: 'rgba(255,255,255,0.06)' },
                        ticks: {
                            color: '#94a3b8',
                            callback: (v) => v.toFixed(1) + '%'
                        },
                        title: {
                            display: true,
                            text: 'CAGR Anualizado (%)',
                            color: '#94a3b8',
                            font: { size: 11, family: 'Inter, sans-serif' }
                        }
                    }
                }
            }
        });
    }

    // ─── Helpers de renderizado ───

    const RANKING_HEADERS = ['#', 'Estrategia', 'Salida', 'ROI (Train)', 'CAGR (Train)', 'DD (Train)', 'WR (Train)', 'PF (Train)', 'Trades (Train)', 'ROI (Test)', 'CAGR (Test)', 'DD (Test)', 'WR (Test)', 'PF (Test)', 'Trades (Test)', 'Valor Final', 'Estado'];

    function fillRankingTable(tableId, entries) {
        const table = document.getElementById(tableId);
        if (!table) return;

        // Header
        const thead = table.querySelector('thead');
        thead.innerHTML = '<tr>' + RANKING_HEADERS.map(h => `<th>${h}</th>`).join('') + '</tr>';

        // Body
        const tbody = table.querySelector('tbody');
        tbody.innerHTML = '';

        entries.forEach((entry, i) => {
            const t = entry.train;
            const v = entry.test;
            const c = entry.config;

            // Badge de salida
            let exitBadge;
            if (c.exitMode === 'classic') {
                exitBadge = '<span style="background:rgba(47,129,247,0.15); color:var(--accent); padding:0.15rem 0.4rem; border-radius:4px; font-size:0.75rem;">📊 Cruce</span>';
            } else {
                exitBadge = `<span style="background:rgba(210,153,34,0.15); color:var(--drawdown); padding:0.15rem 0.4rem; border-radius:4px; font-size:0.75rem;">🎯 SL ${c.slCandles}V R1:${c.rr}</span>`;
            }

            const cells = [
                i + 1,
                `<span style="font-weight:500;">${c.fastType} ${c.fastPeriod}/${c.slowType} ${c.slowPeriod}</span>`,
                exitBadge,
                colorVal(t.totalROI),
                colorVal(t.cagr),
                `<span style="color:var(--drawdown)">${t.maxDD.toFixed(2)}%</span>`,
                `${t.winRate.toFixed(1)}%`,
                t.profitFactor.toFixed(2),
                t.numTrades,
                v ? colorVal(v.totalROI) + diffBadge(v.totalROI, t.totalROI, false, true, 2) : '—',
                v ? colorVal(v.cagr) + diffBadge(v.cagr, t.cagr, false, true, 2) : '—',
                v ? `<span style="color:var(--drawdown)">${v.maxDD.toFixed(2)}%</span>` + diffBadge(v.maxDD, t.maxDD, true, true, 2) : '—',
                v ? `${v.winRate.toFixed(1)}%` + diffBadge(v.winRate, t.winRate, false, true, 1) : '—',
                v ? v.profitFactor.toFixed(2) + diffBadge(v.profitFactor, t.profitFactor, false, false, 2) : '—',
                v ? v.numTrades + diffBadge(v.numTrades, t.numTrades, false, false, 0, true) : '—',
                fmtCapitalValue(v || t),
                statusBadge(entry)
            ];

            const tr = document.createElement('tr');
            tr.innerHTML = cells.map(c => `<td>${c}</td>`).join('');
            tbody.appendChild(tr);
        });
    }

    function colorVal(val) {
        const color = val >= 0 ? 'var(--positive)' : 'var(--negative)';
        return `<span style="color:${color}; font-weight:600;">${val.toFixed(2)}%</span>`;
    }

    const fmtMXN = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN', maximumFractionDigits: 0 });

    function fmtCapitalValue(metrics) {
        const cap = lastOptimizationContext?.params?.simulatedCapital || 100000;
        const finalValue = cap * (1 + metrics.totalROI / 100);
        const color = finalValue >= cap ? 'var(--positive)' : 'var(--negative)';
        return `<span style="color:${color}; font-weight:700;">${fmtMXN.format(finalValue)}</span>`;
    }

    function diffBadge(testVal, trainVal, inverseColor = false, isPerc = false, decimals = 2, isNeutral = false) {
        const diff = testVal - trainVal;

        if (Math.abs(diff) < 0.001) return `<span class="diff-badge diff-neutral">=</span>`;

        let colorClass = 'diff-neutral';
        if (!isNeutral) {
            let isGood = diff > 0;
            if (inverseColor) isGood = diff < 0;
            colorClass = isGood ? 'diff-positive' : 'diff-negative';
        }

        const sign = diff > 0 ? '+' : '';
        const fmtDiff = isPerc ? `${sign}${diff.toFixed(decimals)}%` : `${sign}${diff.toFixed(decimals)}`;

        return `<span class="diff-badge ${colorClass}">${fmtDiff}</span>`;
    }

    function statusBadge(entry) {
        if (!entry.test) return '<span style="color:var(--text-muted);">—</span>';
        if (entry.isOverfit) {
            return '<span style="background:rgba(248,81,73,0.15); color:var(--negative); padding:0.2rem 0.5rem; border-radius:12px; font-size:0.75rem;">⚠️ Sobreopt.</span>';
        }
        return '<span style="background:rgba(63,185,80,0.15); color:var(--positive); padding:0.2rem 0.5rem; border-radius:12px; font-size:0.75rem;">✅ Validada</span>';
    }

    // ═══════════════════════════════════════════════════
    //  EVENT LISTENERS: DCA
    // ═══════════════════════════════════════════════════
    [dcaInitialInput, dcaRecurringInput, dcaFrequencySelect].forEach(input => {
        if (input) {
            input.addEventListener('change', runSimulationAndUpdateUI);
            if (input.tagName === 'INPUT') {
                input.addEventListener('input', debounce(runSimulationAndUpdateUI, 500));
            }
        }
    });

    // ═══════════════════════════════════════════════════
    //  EVENT LISTENERS: MODALES
    // ═══════════════════════════════════════════════════
    setupModal(dcaModal, openDcaBtn, closeDcaBtn);
    setupModal(dcaModal, null, applyDcaBtn); // Botón "Cerrar Controles"
    setupModal(estrategiaModal, openEstrategiaBtn, closeEstrategiaBtn);

    // Al abrir el modal de estrategia, actualizar estimación
    if (openEstrategiaBtn && estrategiaModal) {
        openEstrategiaBtn.addEventListener('click', updateComboEstimate);
    }

    // Botón de ejecución
    if (runOptBtn) {
        runOptBtn.addEventListener('click', runOptimization);
    }

    // Cerrar modales al dar clic fuera
    [dcaModal, estrategiaModal].forEach(modal => {
        if (modal) {
            modal.addEventListener('click', (event) => {
                if (event.target === modal) {
                    modal.close();
                    document.body.style.overflow = '';
                }
            });
        }
    });

    // ═══════════════════════════════════════════════════
    //  EVENT LISTENER: FILE UPLOAD
    // ═══════════════════════════════════════════════════

    async function processLocalFile(file) {
        if (!file) return;

        errorEl.classList.add('hidden');
        resultsPanel.classList.add('hidden');
        if (estrategiaResults) estrategiaResults.classList.add('hidden');
        closeAllModals();
        loadingEl.classList.remove('hidden');

        try {
            globalDataArray = await parseCSV(file);
            console.log("Datos parseados:", globalDataArray);
            runSimulationAndUpdateUI();
        } catch (error) {
            console.error(error);
            loadingEl.classList.add('hidden');
            errorEl.textContent = `Error procesando el archivo: ${error.message}`;
            errorEl.classList.remove('hidden');
        }
    }

    fileInput.addEventListener('change', (event) => {
        processLocalFile(event.target.files[0]);
    });

    // ═══════════════════════════════════════════════════
    //  EVENT LISTENERS: BINANCE UPLOAD
    // ═══════════════════════════════════════════════════

    // Tab switching logic
    const tabBtns = document.querySelectorAll('.tab-btn');
    const tabContents = document.querySelectorAll('.tab-content');

    tabBtns.forEach(btn => {
        btn.addEventListener('click', () => {
            // Reset styles
            tabBtns.forEach(b => {
                b.classList.remove('active');
                b.style.color = 'var(--text-muted)';
                b.style.borderBottomColor = 'transparent';
            });
            tabContents.forEach(c => c.classList.add('hidden'));

            // Set active
            btn.classList.add('active');
            btn.style.color = 'var(--text-primary)';
            btn.style.borderBottomColor = 'var(--accent)';
            document.getElementById(`tab-${btn.dataset.tab}`).classList.remove('hidden');
        });
    });

    // Binance UI Elements
    const binanceUntilNowCb = document.getElementById('binance-until-now');
    const binanceEndInput = document.getElementById('binance-end');
    const btnAutodetect = document.getElementById('btn-autodetect-start');
    const btnDownloadBinance = document.getElementById('btn-download-binance');
    const binanceProgressContainer = document.getElementById('binance-progress-container');
    const binanceProgressBar = document.getElementById('binance-progress-bar');
    const binanceProgressText = document.getElementById('binance-progress-text');
    const binanceProgressStatus = document.getElementById('binance-progress-status');
    const binanceEstimation = document.getElementById('binance-estimation');

    // Estimación dinámica de descarga
    function updateBinanceEstimation() {
        if (!binanceEstimation) return;
        const symbol = document.getElementById('binance-symbol')?.value?.trim();
        const interval = document.getElementById('binance-interval')?.value;
        const startStr = document.getElementById('binance-start')?.value;

        // Si falta algún dato, ocultar el panel
        if (!symbol || !interval || !startStr) {
            binanceEstimation.classList.add('hidden');
            return;
        }

        const startDate = new Date(startStr);
        let endDate = new Date();

        if (binanceUntilNowCb && !binanceUntilNowCb.checked) {
            const endStr = binanceEndInput.value;
            if (!endStr) { binanceEstimation.classList.add('hidden'); return; }
            endDate = new Date(endStr);
        }

        // Mostrar el panel
        binanceEstimation.classList.remove('hidden');

        if (startDate >= endDate) {
            binanceEstimation.innerHTML = `<span style="color: var(--negative);">⚠️ La fecha de inicio debe ser anterior a la fecha de fin.</span>`;
            binanceEstimation.style.borderColor = 'rgba(248, 81, 73, 0.3)';
            binanceEstimation.style.background = 'rgba(248, 81, 73, 0.1)';
            if (btnDownloadBinance) btnDownloadBinance.disabled = true;
            return;
        }

        // Restaurar estilo normal
        binanceEstimation.style.borderColor = 'rgba(47, 129, 247, 0.3)';
        binanceEstimation.style.background = 'rgba(47, 129, 247, 0.1)';
        if (btnDownloadBinance) btnDownloadBinance.disabled = false;

        const msPerCandle = getIntervalMilliseconds(interval);
        const diffMs = endDate.getTime() - startDate.getTime();
        const estimatedCandles = Math.ceil(diffMs / msPerCandle);

        // Binance retorna máx 1000 velas por request (~300ms por request)
        const requestsNeeded = Math.ceil(estimatedCandles / 1000);
        let estimatedSeconds = Math.ceil(requestsNeeded * 0.3);

        let timeStr = "⚡ Instantáneo";
        if (estimatedSeconds > 1) timeStr = `~${estimatedSeconds} segs`;
        if (estimatedSeconds > 60) {
            const mins = Math.floor(estimatedSeconds / 60);
            const secs = estimatedSeconds % 60;
            timeStr = `~${mins}min ${secs}s`;
        }

        binanceEstimation.innerHTML = `📊 Se estiman <b>~${estimatedCandles.toLocaleString()} velas</b> &nbsp;·&nbsp; Tiempo de descarga: <b>${timeStr}</b>`;
    }

    // Toggle End Date
    if (binanceUntilNowCb && binanceEndInput) {
        binanceUntilNowCb.addEventListener('change', (e) => {
            binanceEndInput.disabled = e.target.checked;
            if (e.target.checked) binanceEndInput.style.opacity = '0.5';
            else binanceEndInput.style.opacity = '1';
            updateBinanceEstimation();
        });
    }

    // Escuchar cambios en inputs de binance para actualizar estimación
    ['binance-symbol', 'binance-interval', 'binance-start', 'binance-end'].forEach(id => {
        const el = document.getElementById(id);
        if (el) el.addEventListener('change', updateBinanceEstimation);
        if (el) el.addEventListener('input', updateBinanceEstimation);
    });

    // Calcular estimación inicial con valores prellenados
    updateBinanceEstimation();

    // Autodetect First Candle
    if (btnAutodetect) {
        btnAutodetect.addEventListener('click', async () => {
            const symbol = document.getElementById('binance-symbol').value;
            const interval = document.getElementById('binance-interval').value;

            if (!symbol) return alert('Por favor ingresa un Símbolo primero.');

            const originalText = btnAutodetect.textContent;
            btnAutodetect.textContent = 'Buscando...';
            btnAutodetect.disabled = true;

            try {
                const firstDate = await detectFirstCandle(symbol, interval);
                // format YYYY-MM-DD
                const yyyy = firstDate.getFullYear();
                const mm = String(firstDate.getMonth() + 1).padStart(2, '0');
                const dd = String(firstDate.getDate()).padStart(2, '0');
                document.getElementById('binance-start').value = `${yyyy}-${mm}-${dd}`;
                updateBinanceEstimation();
            } catch (error) {
                alert(`Error al autodetectar: ${error.message}`);
            } finally {
                btnAutodetect.textContent = originalText;
                btnAutodetect.disabled = false;
            }
        });
    }

    // Download Data Action
    if (btnDownloadBinance) {
        btnDownloadBinance.addEventListener('click', async () => {
            const prefixMsg = "Error en validación: ";
            const symbol = document.getElementById('binance-symbol').value.trim();
            const interval = document.getElementById('binance-interval').value;
            const startStr = document.getElementById('binance-start').value;

            if (!symbol) return alert(prefixMsg + 'El símbolo es requerido');
            if (!startStr) return alert(prefixMsg + 'La fecha de inicio es requerida');

            const startDate = new Date(startStr);
            let endDate = new Date(); // Hasta hoy por defecto

            if (!binanceUntilNowCb.checked) {
                const endStr = binanceEndInput.value;
                if (!endStr) return alert(prefixMsg + 'La fecha de fin es requerida si no se marca "Hasta hoy"');
                endDate = new Date(endStr);
                // Set to end of day
                endDate.setHours(23, 59, 59, 999);
            }

            if (startDate >= endDate) return alert(prefixMsg + 'La fecha de inicio debe ser menor a la fecha de fin');

            // Preparar UI
            errorEl.classList.add('hidden');
            resultsPanel.classList.add('hidden');
            if (estrategiaResults) estrategiaResults.classList.add('hidden');
            closeAllModals();

            btnDownloadBinance.disabled = true;
            btnDownloadBinance.textContent = 'Descargando...';
            binanceProgressContainer.classList.remove('hidden');
            binanceProgressBar.style.width = '0%';
            binanceProgressText.textContent = '0%';
            binanceProgressStatus.textContent = 'Conectando a Binance...';

            try {
                // Ejecutar descarga
                globalDataArray = await fetchBinanceKlines(symbol, interval, startDate, endDate, (perc, text) => {
                    binanceProgressBar.style.width = `${perc}%`;
                    binanceProgressText.textContent = `${perc}%`;
                    binanceProgressStatus.textContent = text;
                });

                console.log(`Descarga Binance finalizada: ${globalDataArray.length} velas.`);
                runSimulationAndUpdateUI();

            } catch (error) {
                console.error(error);
                errorEl.textContent = error.message;
                errorEl.classList.remove('hidden');
            } finally {
                // Reset UI
                btnDownloadBinance.disabled = false;
                btnDownloadBinance.innerHTML = '⬇️ Descargar Datos y Ejecutar Backtest';
                setTimeout(() => binanceProgressContainer.classList.add('hidden'), 2000); // Hide after a bit
            }
        });
    }
    // ═══════════════════════════════════════════════════
    //  DRAG & DROP
    // ═══════════════════════════════════════════════════
    const dropZone = document.getElementById('drop-zone');
    dropZone.addEventListener('click', () => { fileInput.click(); });

    ['dragenter', 'dragover', 'dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, preventDefaults, false);
    });

    function preventDefaults(e) { e.preventDefault(); e.stopPropagation(); }

    ['dragenter', 'dragover'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => { dropZone.classList.add('active'); }, false);
    });
    ['dragleave', 'drop'].forEach(eventName => {
        dropZone.addEventListener(eventName, () => { dropZone.classList.remove('active'); }, false);
    });

    dropZone.addEventListener('drop', (e) => {
        let files = e.dataTransfer.files;
        if (files.length > 0) {
            fileInput.files = files;
            fileInput.dispatchEvent(new Event('change'));
        }
    }, false);

    // ═══════════════════════════════════════════════════
    //  BUSCADOR INTELIGENTE DE ESTRATEGIAS
    // ═══════════════════════════════════════════════════
    function populateSearchDropdowns(params) {
        const fastPeriodSel = document.getElementById('search-fast-period');
        const slowPeriodSel = document.getElementById('search-slow-period');
        const exitModeSel = document.getElementById('search-exit-mode');
        if (!fastPeriodSel || !slowPeriodSel || !exitModeSel) return;

        // Generar periodos según min/max/step del optimizador
        const periods = [];
        for (let p = params.minPeriod; p <= params.maxPeriod; p += params.step) {
            periods.push(p);
        }

        fastPeriodSel.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');
        slowPeriodSel.innerHTML = periods.map(p => `<option value="${p}">${p}</option>`).join('');

        // Preseleccionar valores razonables (fast=primer valor, slow=último tercio)
        if (periods.length > 1) {
            fastPeriodSel.value = periods[0];
            slowPeriodSel.value = periods[Math.floor(periods.length / 3)];
        }

        // Modos de salida
        const exitOpts = [];
        const doClassic = params.exitModes.includes('classic') || params.exitModes.includes('both');
        const doFixed = params.exitModes.includes('fixed') || params.exitModes.includes('both');
        if (doClassic) exitOpts.push({ value: 'classic', label: '📊 Clásico (Cruce Inverso)' });
        if (doFixed) exitOpts.push({ value: 'fixed', label: `🎯 R:R Fijo (SL ${params.slCandles} velas, R:R ${params.rr})` });
        exitModeSel.innerHTML = exitOpts.map(o => `<option value="${o.value}">${o.label}</option>`).join('');

        // Tipos de MA según lo configurado
        const fastTypeSel = document.getElementById('search-fast-type');
        const slowTypeSel = document.getElementById('search-slow-type');
        const hasMA = type => params.maTypes.some(t => t === type || t.includes(type));
        const types = [];
        if (hasMA('SMA')) types.push('SMA');
        if (hasMA('EMA')) types.push('EMA');
        if (types.length === 0) types.push('SMA', 'EMA'); // Fallback
        const typesHTML = types.map(t => `<option value="${t}">${t}</option>`).join('');
        if (fastTypeSel) fastTypeSel.innerHTML = typesHTML;
        if (slowTypeSel) slowTypeSel.innerHTML = typesHTML;
    }

    function executeStrategySearch() {
        if (!lastOptimizationContext) {
            const statusEl = document.getElementById('search-status');
            if (statusEl) statusEl.textContent = '⚠️ Primero ejecuta una optimización.';
            return;
        }

        const ctx = lastOptimizationContext;
        const fastType = document.getElementById('search-fast-type')?.value || 'SMA';
        const slowType = document.getElementById('search-slow-type')?.value || 'SMA';
        const fastPeriod = parseInt(document.getElementById('search-fast-period')?.value) || 5;
        const slowPeriod = parseInt(document.getElementById('search-slow-period')?.value) || 50;
        const exitMode = document.getElementById('search-exit-mode')?.value || 'classic';

        const statusEl = document.getElementById('search-status');
        const resultContainer = document.getElementById('search-result-container');

        // Validar que periodo rápido < lento
        if (fastPeriod >= slowPeriod) {
            if (statusEl) statusEl.textContent = '⚠️ El periodo rápido debe ser menor al periodo lento.';
            if (resultContainer) resultContainer.classList.add('hidden');
            return;
        }

        if (statusEl) statusEl.textContent = '⏳ Calculando...';

        // Usar setTimeout para permitir que la UI se actualice
        setTimeout(() => {
            try {
                const { dates, closes, highs, lows, params, splitIndex } = ctx;

                // Computar MAs necesarios para los periodos seleccionados
                const searchParams = {
                    minPeriod: Math.min(fastPeriod, slowPeriod),
                    maxPeriod: Math.max(fastPeriod, slowPeriod),
                    step: 1, // Queremos exactamente estos periodos
                    maTypes: [...new Set([fastType, slowType])]
                };

                // Computar cache de MAs para Train
                const trainCloses = closes.slice(0, splitIndex);
                const trainDates = dates.slice(0, splitIndex);
                const trainHighs = highs.slice(0, splitIndex);
                const trainLows = lows.slice(0, splitIndex);

                const trainCache = computeMACache(trainCloses, searchParams);
                const trainFast = trainCache[fastType]?.[fastPeriod];
                const trainSlow = trainCache[slowType]?.[slowPeriod];

                if (!trainFast || !trainSlow) {
                    if (statusEl) statusEl.textContent = '❌ No se encontraron datos para esos periodos.';
                    return;
                }

                const train = runBacktestInline(
                    trainDates, trainCloses, trainHighs, trainLows,
                    trainFast, trainSlow,
                    fastPeriod, slowPeriod, exitMode,
                    params.slCandles, params.rr, params.riskFraction
                );

                // Test Out-of-Sample
                const testCloses = closes.slice(splitIndex);
                const testDates = dates.slice(splitIndex);
                const testHighs = highs.slice(splitIndex);
                const testLows = lows.slice(splitIndex);

                const allCache = computeMACache(closes, searchParams);
                const testFast = allCache[fastType]?.[fastPeriod]?.slice(splitIndex);
                const testSlow = allCache[slowType]?.[slowPeriod]?.slice(splitIndex);

                const test = (testFast && testSlow) ? runBacktestInline(
                    testDates, testCloses, testHighs, testLows,
                    testFast, testSlow,
                    fastPeriod, slowPeriod, exitMode,
                    params.slCandles, params.rr, params.riskFraction
                ) : null;

                // Renderizar resultados
                renderSearchResults(train, test, fastType, fastPeriod, slowType, slowPeriod, exitMode);
                if (statusEl) statusEl.textContent = '';

            } catch (err) {
                console.error('Error en búsqueda de estrategia:', err);
                if (statusEl) statusEl.textContent = '❌ Error: ' + err.message;
            }
        }, 50);
    }

    function renderSearchResults(train, test, fastType, fastPeriod, slowType, slowPeriod, exitMode) {
        const container = document.getElementById('search-result-container');
        const trainEl = document.getElementById('search-train-metrics');
        const testEl = document.getElementById('search-test-metrics');
        const verdictEl = document.getElementById('search-verdict');
        if (!container || !trainEl || !testEl) return;

        container.classList.remove('hidden');

        function fmtMetrics(m) {
            const roiColor = m.totalROI >= 0 ? 'var(--positive)' : 'var(--negative)';
            const cap = lastOptimizationContext?.params?.simulatedCapital || 100000;
            const finalValue = cap * (1 + m.totalROI / 100);
            return `
                <div><strong>ROI:</strong> <span style="color: ${roiColor}; font-weight: 700;">${m.totalROI.toFixed(2)}%</span></div>
                <div><strong>CAGR:</strong> <span style="color: ${roiColor}; font-weight: 700;">${m.cagr.toFixed(2)}%</span></div>
                <div><strong>Win Rate:</strong> ${m.winRate.toFixed(1)}%</div>
                <div><strong>Max Drawdown:</strong> <span style="color: var(--drawdown);">${m.maxDD.toFixed(2)}%</span></div>
                <div><strong>Profit Factor:</strong> ${m.profitFactor >= 999 ? '∞' : m.profitFactor.toFixed(2)}</div>
                <div><strong>Trades:</strong> ${m.numTrades}</div>
                <div style="margin-top: 0.5rem; padding-top: 0.5rem; border-top: 1px solid rgba(255,255,255,0.08);">
                    <strong>Valor Final:</strong> <span style="color: ${roiColor}; font-weight: 700; font-size: 1.1rem;">${fmtMXN.format(finalValue)}</span>
                    <span style="color: var(--text-muted); font-size: 0.8rem;"> de ${fmtMXN.format(cap)}</span>
                </div>
            `;
        }

        trainEl.innerHTML = fmtMetrics(train);

        if (test) {
            testEl.innerHTML = fmtMetrics(test);
        } else {
            testEl.innerHTML = '<div style="color: var(--text-muted);">No disponible</div>';
        }

        // Veredicto
        if (verdictEl && test) {
            const degradation = train.totalROI !== 0 ? Math.abs((test.totalROI - train.totalROI) / train.totalROI) * 100 : 0;
            const isOverfit = degradation > 50 || test.totalROI < 0;
            const stratName = `${fastType} ${fastPeriod} / ${slowType} ${slowPeriod} (${exitMode === 'fixed' ? 'R:R Fijo' : 'Clásico'})`;

            if (isOverfit) {
                verdictEl.innerHTML = `<div style="background: rgba(239,68,68,0.1); border: 1px solid rgba(239,68,68,0.3); padding: 0.75rem; border-radius: var(--radius); color: var(--negative);">
                    ⚠️ <strong>${stratName}</strong> — Degradación del ${degradation.toFixed(0)}%. Posible sobreoptimización.
                </div>`;
            } else if (test.totalROI > 0) {
                verdictEl.innerHTML = `<div style="background: rgba(16,185,129,0.1); border: 1px solid rgba(16,185,129,0.3); padding: 0.75rem; border-radius: var(--radius); color: var(--positive);">
                    ✅ <strong>${stratName}</strong> — Validada. Degradación: ${degradation.toFixed(0)}%.
                </div>`;
            } else {
                verdictEl.innerHTML = `<div style="background: rgba(245,158,11,0.1); border: 1px solid rgba(245,158,11,0.3); padding: 0.75rem; border-radius: var(--radius); color: var(--drawdown);">
                    ⚠️ <strong>${stratName}</strong> — ROI negativo en Test (${test.totalROI.toFixed(2)}%).
                </div>`;
            }
        }
    }

    // Event Listener del buscador
    const btnSearchStrategy = document.getElementById('btn-search-strategy');
    if (btnSearchStrategy) {
        btnSearchStrategy.addEventListener('click', executeStrategySearch);
    }

    // ═══════════════════════════════════════════════════
    //  HELPER FUNCTIONS
    // ═══════════════════════════════════════════════════
    function setupModal(modal, openBtn, closeBtn) {
        if (openBtn && modal) {
            openBtn.addEventListener('click', () => {
                modal.showModal();
                document.body.style.overflow = 'hidden';
            });
        }
        if (closeBtn && modal) {
            closeBtn.addEventListener('click', () => {
                modal.close();
                document.body.style.overflow = '';
            });
        }
    }

    function closeAllModals() {
        [dcaModal, estrategiaModal].forEach(m => {
            if (m) m.close();
        });
        document.body.style.overflow = '';
    }
});

function debounce(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => { clearTimeout(timeout); func(...args); };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}
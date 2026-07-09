if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons();
}

const AVAILABLE_SYMBOLS = [
    'BTCUSDT', 'ETHUSDT', 'BNBUSDT', 'SOLUSDT', 'XRPUSDT', 'ADAUSDT', 'AVAXUSDT',
    'DOTUSDT', 'TRXUSDT', 'LINKUSDT', 'MATICUSDT', 'LTCUSDT', 'BCHUSDT', 'ATOMUSDT',
    'XLMUSDT', 'NEARUSDT', 'ALGOUSDT', 'ICPUSDT', 'FILUSDT', 'HBARUSDT', 'EGLDUSDT',
    'VETUSDT', 'FTMUSDT', 'SANDUSDT', 'MANAUSDT', 'XTZUSDT', 'EOSUSDT', 'IOTAUSDT',
    'UNIUSDT', 'AAVEUSDT', 'MKRUSDT', 'SNXUSDT', 'CRVUSDT', 'LDOUSDT', 'RUNEUSDT',
    'ARBUSDT', 'OPUSDT', 'STRKUSDT', 'IMXUSDT', 'LRCUSDT', 'GMXUSDT', 'DYDXUSDT',
    '1INCHUSDT', 'COMPUSDT', 'CAKEUSDT', 'JUPUSDT', 'ENSUSDT', 'FXSUSDT',
    'RNDRUSDT', 'FETUSDT', 'AGIXUSDT', 'OCEANUSDT', 'GALAUSDT', 'AXSUSDT',
    'DOGEUSDT', 'SHIBUSDT', 'PEPEUSDT', 'BONKUSDT', 'WIFUSDT', 'FLOKIUSDT',
    'MEMEUSDT', 'ORDIUSDT', 'SATSUSDT', 'BOMEUSDT',
    'INJUSDT', 'TIAUSDT', 'SEIUSDT', 'SUIUSDT', 'APTUSDT', 'TONUSDT', 'STXUSDT',
    'KASUSDT', 'BLURUSDT', 'PYTHUSDT', 'WLDUSDT', 'ETCUSDT', 'ZECUSDT', 'DASHUSDT'
];

const AVAILABLE_INTERVALS = ['1m', '5m', '15m', '30m', '1h', '4h', '1d'];

let CONFIG = {
    symbol: 'BTCUSDT',
    interval: '1h',
    limit: 200,
    colors: {
        bg: '#e5e7eb',
        grid: '#e2e8f0',
        bull: '#22c55e',
        bear: '#ef4444',
        text: '#64748b',
        crosshair: '#94a3b8'
    },
    padding: { top: 40, right: 60, bottom: 40, left: 0 }
};

const THEME_COLORS = {
    light: {
        bg: '#e5e7eb',
        grid: '#cbd5e1',
        bull: '#22c55e',
        bear: '#ef4444',
        text: '#64748b',
        crosshair: '#94a3b8'
    },
    dark: {
        bg: '#0f172a',
        grid: '#1e293b',
        bull: '#22c55e',
        bear: '#ef4444',
        text: '#94a3b8',
        crosshair: '#475569'
    }
};

function updateChartTheme() {
    const isDark = document.documentElement.classList.contains('dark');
    CONFIG.colors = isDark ? THEME_COLORS.dark : THEME_COLORS.light;
    if (candles.length > 0) drawChart();
}

const themeObserver = new MutationObserver((mutations) => {
    mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'class') {
            updateChartTheme();
        }
    });
});

themeObserver.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['class']
});

const canvas = document.getElementById('chartCanvas');
const container = document.getElementById('canvas-container');
const ctx = canvas.getContext('2d');
const loader = document.getElementById('loader');
const tooltip = document.getElementById('tooltip');

const symbolDisplay = document.getElementById('symbol-display');
const intervalBadge = document.getElementById('interval-badge');
const floatingPrice = document.getElementById('floating-price');
const floatingChange = document.getElementById('floating-change');
const randomizeButton = document.getElementById('randomize-chart');
const TOOLTIP_ENABLED = false;

const btnLtf = document.getElementById('btn-ltf');
const btnNormal = document.getElementById('btn-normal');
const btnHtf = document.getElementById('btn-htf');
const navToggle = document.getElementById('nav-toggle');
const navMenu = document.getElementById('nav-menu');
const tradePanel = document.getElementById('trade-panel');
const tradeLongBtn = document.getElementById('trade-long');
const tradeShortBtn = document.getElementById('trade-short');
const tradeExecuteBtn = document.getElementById('trade-execute');
const tradeRREl = document.getElementById('trade-rr');
const tradeModal = document.getElementById('trade-result-modal');
const tradeResultStatus = document.getElementById('trade-result-status');
const tradeResultTitle = document.getElementById('trade-result-title');
const tradeResultPnl = document.getElementById('trade-result-pnl');
const tradeResultRR = document.getElementById('trade-result-rr');
const tradeResultDuration = document.getElementById('trade-result-duration');
const tradeResultClose = document.getElementById('trade-result-close');

let candles = [];
let chartDimensions = {};
let currentMode = 'normal';
let cachedData = { ltf: [], normal: [], htf: [] };
let cachedIntervals = { ltf: '', normal: '', htf: '' };
let symbolGenesis = null;
let chartScale = null;
let isDraggingLine = false;
let dragTarget = null;
let futureCandles = { ltf: [], normal: [], htf: [] };
let simulationTimer = null;
const SIM_STEP_MS = 120;
let simulationCandleCount = 0;
let simulationEntryTime = null;
let simulationLastTime = null;
let currentSimulationId = null;

const ANALYTICS_DB_NAME = 'nec_analytics';
const ANALYTICS_DB_VERSION = 1;

function openAnalyticsDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB no disponible'));
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(ANALYTICS_DB_NAME, ANALYTICS_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('simulations')) {
                const store = db.createObjectStore('simulations', { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('result', 'result', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Error abriendo IndexedDB'));
    });
}

async function analyticsAddSimulationStart(payload) {
    const db = await openAnalyticsDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(['simulations'], 'readwrite');
            const store = tx.objectStore('simulations');
            const req = store.add(payload);
            req.onsuccess = () => resolve(req.result);
            req.onerror = () => reject(req.error || new Error('Error guardando simulación'));
        });
    } finally {
        db.close();
    }
}

async function analyticsFinalizeSimulation(id, patch) {
    if (!id) return;
    const db = await openAnalyticsDb();
    try {
        await new Promise((resolve, reject) => {
            const tx = db.transaction(['simulations'], 'readwrite');
            const store = tx.objectStore('simulations');
            const getReq = store.get(id);
            getReq.onsuccess = () => {
                const existing = getReq.result;
                if (!existing) {
                    resolve();
                    return;
                }
                const updated = { ...existing, ...patch };
                const putReq = store.put(updated);
                putReq.onsuccess = () => resolve();
                putReq.onerror = () => reject(putReq.error || new Error('Error actualizando simulación'));
            };
            getReq.onerror = () => reject(getReq.error || new Error('Error leyendo simulación'));
        });
    } finally {
        db.close();
    }
}

const TradeManager = {
    active: false,
    direction: null,
    entryPrice: null,
    slPrice: null,
    tpPrice: null,
    isSimulating: false,
    setDirection(dir) {
        if (!candles.length) return;
        const lastCandle = candles[candles.length - 1];
        const entry = lastCandle.close;
        const rewardPct = 0.02;
        const riskPct = 0.01;
        this.direction = dir;
        this.entryPrice = entry;
        if (dir === 'long') {
            this.tpPrice = entry * (1 + rewardPct);
            this.slPrice = entry * (1 - riskPct);
        } else {
            this.tpPrice = entry * (1 - rewardPct);
            this.slPrice = entry * (1 + riskPct);
        }
        this.active = true;
        if (tradeModal) tradeModal.classList.add('hidden');
        this.updateUI();
        drawChart();
    },
    reset() {
        this.active = false;
        this.direction = null;
        this.entryPrice = null;
        this.slPrice = null;
        this.tpPrice = null;
        this.isSimulating = false;
        futureCandles = { ltf: [], normal: [], htf: [] };
        simulationCandleCount = 0;
        if (simulationTimer) {
            clearTimeout(simulationTimer);
            simulationTimer = null;
        }
        isDraggingLine = false;
        dragTarget = null;
        if (tradePanel) {
            tradePanel.classList.remove('pointer-events-none', 'opacity-60');
        }
        if (tradeExecuteBtn) tradeExecuteBtn.classList.add('hidden');
        if (tradeRREl) tradeRREl.innerText = '--';
        if (tradeLongBtn) tradeLongBtn.classList.remove('bg-emerald-500', 'btn-active-black', 'border-emerald-500');
        if (tradeShortBtn) tradeShortBtn.classList.remove('bg-rose-500', 'btn-active-black', 'border-rose-500');
        if (tradeModal) tradeModal.classList.add('hidden');
        container.style.cursor = 'crosshair';
        drawChart();
    },
    updateUI() {
        const isLong = this.direction === 'long';
        if (tradeLongBtn) {
            tradeLongBtn.classList.toggle('bg-emerald-500', isLong);
            tradeLongBtn.classList.toggle('btn-active-black', isLong);
            tradeLongBtn.classList.toggle('border-emerald-500', isLong);
        }
        if (tradeShortBtn) {
            tradeShortBtn.classList.toggle('bg-rose-500', this.direction === 'short');
            tradeShortBtn.classList.toggle('btn-active-black', this.direction === 'short');
            tradeShortBtn.classList.toggle('border-rose-500', this.direction === 'short');
        }
        if (tradeExecuteBtn) {
            if (this.active) tradeExecuteBtn.classList.remove('hidden');
            else tradeExecuteBtn.classList.add('hidden');
            tradeExecuteBtn.disabled = this.isSimulating;
            tradeExecuteBtn.classList.toggle('opacity-60', this.isSimulating);
            tradeExecuteBtn.classList.toggle('cursor-not-allowed', this.isSimulating);
        }
        if (tradePanel) {
            tradePanel.classList.toggle('pointer-events-none', this.isSimulating);
            tradePanel.classList.toggle('opacity-60', this.isSimulating);
        }
        if (tradeRREl) {
            const rr = getTradeRR();
            tradeRREl.innerText = rr ? `1:${rr.toFixed(2)}` : '--';
        }
    }
};

function getTradeRR() {
    if (!TradeManager.active || !TradeManager.entryPrice || !TradeManager.slPrice || !TradeManager.tpPrice) return null;
    const reward = Math.abs(TradeManager.tpPrice - TradeManager.entryPrice);
    const risk = Math.abs(TradeManager.entryPrice - TradeManager.slPrice);
    if (!risk) return null;
    return reward / risk;
}

function priceToY(price) {
    if (!chartScale) return null;
    const { yMin, yMax, top, height, bottom } = chartScale;
    const chartHeight = height - (top + bottom);
    const clamped = Math.max(yMin, Math.min(yMax, price));
    return top + (chartHeight - ((clamped - yMin) / (yMax - yMin)) * chartHeight);
}

function yToPrice(y) {
    if (!chartScale) return null;
    const { yMin, yMax, top, height, bottom } = chartScale;
    const chartHeight = height - (top + bottom);
    const clampedY = Math.max(top, Math.min(top + chartHeight, y));
    const ratio = 1 - ((clampedY - top) / chartHeight);
    return yMin + (yMax - yMin) * ratio;
}

function getRelatedIntervals(base) {
    const idx = AVAILABLE_INTERVALS.indexOf(base);
    let ltfIdx = Math.max(0, idx - 2);
    let htfIdx = Math.min(AVAILABLE_INTERVALS.length - 1, idx + 2);

    if (AVAILABLE_INTERVALS[ltfIdx] === base && idx > 0) ltfIdx = idx - 1;
    if (AVAILABLE_INTERVALS[htfIdx] === base && idx < AVAILABLE_INTERVALS.length - 1) htfIdx = idx + 1;

    return {
        ltf: AVAILABLE_INTERVALS[ltfIdx],
        normal: base,
        htf: AVAILABLE_INTERVALS[htfIdx]
    };
}

function intervalToMs(interval) {
    const map = {
        '1m': 60 * 1000,
        '5m': 5 * 60 * 1000,
        '15m': 15 * 60 * 1000,
        '30m': 30 * 60 * 1000,
        '1h': 60 * 60 * 1000,
        '4h': 4 * 60 * 60 * 1000,
        '1d': 24 * 60 * 60 * 1000
    };
    return map[interval] || 60 * 1000;
}

async function fetchSymbolGenesis(symbol) {
    try {
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=1d&startTime=0&limit=1`);
        if (!response.ok) throw new Error('Error en API');
        const data = await response.json();
        if (!Array.isArray(data) || data.length === 0) return null;
        return data[0][0];
    } catch (e) {
        console.error(e);
        return null;
    }
}

function resolveEndTime(endTime, intervals) {
    if (!endTime) return undefined;
    const now = Date.now();
    let clamped = Math.min(endTime, now);
    if (!symbolGenesis) return clamped;
    const intervalList = [intervals.ltf, intervals.normal, intervals.htf];
    const minEndTime = intervalList.reduce((max, interval) => {
        const candidate = symbolGenesis + CONFIG.limit * intervalToMs(interval);
        return Math.max(max, candidate);
    }, symbolGenesis);
    if (clamped < minEndTime) clamped = minEndTime;
    return clamped;
}

async function randomizeChart() {
    const randomSymbol = AVAILABLE_SYMBOLS[Math.floor(Math.random() * AVAILABLE_SYMBOLS.length)];
    const randomInterval = AVAILABLE_INTERVALS[Math.floor(Math.random() * AVAILABLE_INTERVALS.length)];

    CONFIG.symbol = randomSymbol;
    CONFIG.interval = randomInterval;

    symbolDisplay.innerText = randomSymbol.replace('USDT', '/USDT');

    symbolGenesis = await fetchSymbolGenesis(CONFIG.symbol);
    const now = Date.now();
    let endTime;
    if (symbolGenesis) {
        const intervals = getRelatedIntervals(CONFIG.interval);
        const minEndTime = Object.values(intervals).reduce((max, interval) => {
            const candidate = symbolGenesis + CONFIG.limit * intervalToMs(interval);
            return Math.max(max, candidate);
        }, symbolGenesis);
        const maxEndTime = Math.max(minEndTime, now);
        endTime = Math.floor(minEndTime + Math.random() * (maxEndTime - minEndTime));
    }

    loadAllTimeframes(endTime);
}

async function fetchCandleData(symbol, interval, endTime) {
    try {
        const endTimeParam = endTime ? `&endTime=${endTime}` : '';
        const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=${CONFIG.limit}${endTimeParam}`);
        if (!response.ok) throw new Error(`API Error ${interval}`);
        const data = await response.json();
        return data.map(d => ({
            time: new Date(d[0]),
            open: parseFloat(d[1]),
            high: parseFloat(d[2]),
            low: parseFloat(d[3]),
            close: parseFloat(d[4])
        }));
    } catch (e) {
        console.error(e);
        return [];
    }
}

async function fetchFutureCandles(symbol, interval, startTime, endTime) {
    const endTimeParam = endTime ? `&endTime=${endTime}` : '';
    const response = await fetch(`https://api.binance.com/api/v3/klines?symbol=${symbol}&interval=${interval}&limit=1000&startTime=${startTime}${endTimeParam}`);
    if (!response.ok) throw new Error('Error en API');
    const data = await response.json();
    if (!Array.isArray(data)) return [];
    return data.map(d => ({
        time: new Date(d[0]),
        open: parseFloat(d[1]),
        high: parseFloat(d[2]),
        low: parseFloat(d[3]),
        close: parseFloat(d[4])
    }));
}

async function loadAllTimeframes(endTime) {
    loader.style.display = 'flex';

    const intervals = getRelatedIntervals(CONFIG.interval);
    cachedIntervals = intervals;
    const resolvedEndTime = resolveEndTime(endTime, intervals);

    try {
        const [ltfData, normalData, htfData] = await Promise.all([
            fetchCandleData(CONFIG.symbol, intervals.ltf, resolvedEndTime),
            fetchCandleData(CONFIG.symbol, intervals.normal, resolvedEndTime),
            fetchCandleData(CONFIG.symbol, intervals.htf, resolvedEndTime)
        ]);

        cachedData.ltf = ltfData;
        cachedData.normal = normalData;
        cachedData.htf = htfData;

        if (normalData.length === 0) throw new Error("No data");

        document.getElementById('last-updated').innerText = `Actualizado: ${new Date().toLocaleTimeString()}`;

        switchTimeframe('normal');

    } catch (error) {
        console.error('Error:', error);
        loader.innerHTML = "<span class='text-red-500'>Error de conexión</span>";
    } finally {
        if (cachedData.normal.length > 0) loader.style.display = 'none';
    }
}

function switchTimeframe(mode) {
    currentMode = mode;
    candles = cachedData[mode] || [];
    const currentInterval = cachedIntervals[mode];

    intervalBadge.innerText = currentInterval.toUpperCase();

    const baseClass = "px-3 py-1 rounded-md transition-all flex items-center";
    const activeClass = "text-slate-900 bg-slate-200 shadow-sm dark:bg-slate-600 dark:text-white font-medium";
    const inactiveClass = "text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800";

    const resetBtn = (btn) => btn.className = `${baseClass} ${inactiveClass}`;
    resetBtn(btnLtf);
    resetBtn(btnNormal);
    resetBtn(btnHtf);

    const activeBtn = mode === 'ltf' ? btnLtf : (mode === 'normal' ? btnNormal : btnHtf);
    activeBtn.className = `${baseClass} ${activeClass}`;

    if (candles.length > 0) {
        const lastCandle = candles[candles.length - 1];
        floatingPrice.innerText = lastCandle.close < 1 ? lastCandle.close.toFixed(6) : lastCandle.close.toFixed(2);

        const change = ((lastCandle.close - lastCandle.open) / lastCandle.open) * 100;
        const sign = change >= 0 ? '+' : '';
        floatingChange.innerHTML = `<span class="${change >= 0 ? 'text-green-400' : 'text-red-400'}">${sign}${change.toFixed(2)}%</span> <span class="text-slate-500 dark:text-slate-400 ml-1">en vela ${currentInterval}</span>`;
    }

    resizeCanvas();
}

async function startSimulation() {
    if (!TradeManager.active || TradeManager.isSimulating || !candles.length) return;
    TradeManager.isSimulating = true;
    TradeManager.updateUI();
    simulationCandleCount = 0;
    simulationEntryTime = null;
    simulationLastTime = null;

    // Usar la última vela de 'normal' como referencia de inicio de simulación
    const normalLastCandle = cachedData.normal[cachedData.normal.length - 1];
    if (!normalLastCandle) {
        TradeManager.isSimulating = false;
        TradeManager.updateUI();
        return;
    }

    simulationEntryTime = normalLastCandle.time.getTime();
    simulationLastTime = simulationEntryTime;

    try {
        currentSimulationId = await analyticsAddSimulationStart({
            timestamp: Date.now(),
            symbol: CONFIG.symbol,
            intervals: { ...cachedIntervals },
            direction: TradeManager.direction,
            entryPrice: TradeManager.entryPrice,
            slPrice: TradeManager.slPrice,
            tpPrice: TradeManager.tpPrice,
            result: null,
            reason: null,
            exitPrice: null,
            exitTime: null,
            pnlPct: null
        });
    } catch (e) {
        currentSimulationId = null;
    }

    // Cargar velas futuras para las 3 temporalidades
    const modes = ['ltf', 'normal', 'htf'];
    const promises = modes.map(mode => {
        const interval = cachedIntervals[mode];
        const data = cachedData[mode];
        if (!interval) return Promise.resolve({ mode, data: [] });

        const lastTime = data.length > 0 ? data[data.length - 1].time.getTime() : simulationEntryTime;
        const startTime = lastTime + intervalToMs(interval);

        return fetchFutureCandles(CONFIG.symbol, interval, startTime)
            .then(data => ({ mode, data }));
    });

    try {
        const results = await Promise.all(promises);
        results.forEach(({ mode, data }) => {
            futureCandles[mode] = data || [];
        });

        // Si no hay futuro en la temporalidad normal, abortar
        if (!futureCandles.normal.length) {
            finishSimulation('no_data');
            return;
        }

        simulateNextStep();
    } catch (e) {
        console.error('Error startSimulation:', e);
        finishSimulation('no_data');
    }
}

async function simulateNextStep() {
    if (!TradeManager.isSimulating) return;

    // Verificar si quedan velas en alguna temporalidad
    const hasLtf = futureCandles.ltf.length > 0;
    const hasNormal = futureCandles.normal.length > 0;
    const hasHtf = futureCandles.htf.length > 0;

    if (!hasLtf && !hasNormal && !hasHtf) {
        finishSimulation('no_data');
        return;
    }

    // Encontrar el siguiente timestamp mínimo (Open Time)
    let nextTimes = [];
    if (hasLtf) nextTimes.push(futureCandles.ltf[0].time.getTime());
    if (hasNormal) nextTimes.push(futureCandles.normal[0].time.getTime());
    if (hasHtf) nextTimes.push(futureCandles.htf[0].time.getTime());

    const minTime = Math.min(...nextTimes);
    simulationLastTime = minTime;

    let candleForCheck = null;
    let hasUpdates = false;

    // Procesar LTF
    if (hasLtf && futureCandles.ltf[0].time.getTime() === minTime) {
        const c = futureCandles.ltf.shift();
        cachedData.ltf.push(c);
        if (cachedData.ltf.length > CONFIG.limit) cachedData.ltf.shift();
        if (currentMode === 'ltf') hasUpdates = true;
        candleForCheck = c; // Prioridad alta para check
    }

    // Procesar Normal
    if (hasNormal && futureCandles.normal[0].time.getTime() === minTime) {
        const c = futureCandles.normal.shift();
        cachedData.normal.push(c);
        if (cachedData.normal.length > CONFIG.limit) cachedData.normal.shift();
        if (currentMode === 'normal') hasUpdates = true;
        simulationCandleCount += 1;
        if (!candleForCheck) candleForCheck = c;
    }

    // Procesar HTF
    if (hasHtf && futureCandles.htf[0].time.getTime() === minTime) {
        const c = futureCandles.htf.shift();
        cachedData.htf.push(c);
        if (cachedData.htf.length > CONFIG.limit) cachedData.htf.shift();
        if (currentMode === 'htf') hasUpdates = true;
        if (!candleForCheck) candleForCheck = c;
    }

    // Renderizar si hubo cambios en la vista actual
    if (hasUpdates) {
        candles = cachedData[currentMode];
        drawChart();
    }

    // Verificar TradeHit con la vela más precisa disponible
    if (candleForCheck) {
        const hit = await resolveTradeHit(candleForCheck);
        if (hit) {
            finishSimulation(hit.result, hit.exitPrice, hit.reason, hit.exitTime);
            return;
        }
    }

    simulationTimer = setTimeout(() => {
        simulateNextStep();
    }, SIM_STEP_MS);
}

async function resolveTradeHit(candle) {
    const { direction, tpPrice, slPrice } = TradeManager;
    if (direction === 'long') {
        const hitSL = candle.low <= slPrice;
        const hitTP = candle.high >= tpPrice;
        if (hitSL && hitTP) return await resolveAmbiguousHit(candle);
        if (hitSL) return { result: 'loss', exitPrice: slPrice, exitTime: candle.time.getTime() };
        if (hitTP) return { result: 'win', exitPrice: tpPrice, exitTime: candle.time.getTime() };
    } else {
        const hitSL = candle.high >= slPrice;
        const hitTP = candle.low <= tpPrice;
        if (hitSL && hitTP) return await resolveAmbiguousHit(candle);
        if (hitSL) return { result: 'loss', exitPrice: slPrice, exitTime: candle.time.getTime() };
        if (hitTP) return { result: 'win', exitPrice: tpPrice, exitTime: candle.time.getTime() };
    }
    return null;
}

async function resolveAmbiguousHit(candle) {
    const currentInterval = cachedIntervals[currentMode] || CONFIG.interval;
    const currentIdx = AVAILABLE_INTERVALS.indexOf(currentInterval);
    const lowerIdx = currentIdx > 0 ? currentIdx - 1 : -1;
    if (lowerIdx === -1) {
        return { result: 'loss', exitPrice: TradeManager.slPrice, reason: 'ambiguous_fallback', exitTime: candle.time.getTime() };
    }

    const lowerInterval = AVAILABLE_INTERVALS[lowerIdx];
    const windowStart = candle.time.getTime();
    const windowEnd = windowStart + intervalToMs(currentInterval);

    try {
        const lowerCandles = await fetchFutureCandles(CONFIG.symbol, lowerInterval, windowStart, windowEnd);
        for (const c of lowerCandles) {
            if (TradeManager.direction === 'long') {
                if (c.low <= TradeManager.slPrice) return { result: 'loss', exitPrice: TradeManager.slPrice, reason: 'ambiguous_ltf', exitTime: c.time.getTime() };
                if (c.high >= TradeManager.tpPrice) return { result: 'win', exitPrice: TradeManager.tpPrice, reason: 'ambiguous_ltf', exitTime: c.time.getTime() };
            } else {
                if (c.high >= TradeManager.slPrice) return { result: 'loss', exitPrice: TradeManager.slPrice, reason: 'ambiguous_ltf', exitTime: c.time.getTime() };
                if (c.low <= TradeManager.tpPrice) return { result: 'win', exitPrice: TradeManager.tpPrice, reason: 'ambiguous_ltf', exitTime: c.time.getTime() };
            }
        }
    } catch (e) {
        return { result: 'loss', exitPrice: TradeManager.slPrice, reason: 'ambiguous_fallback', exitTime: candle.time.getTime() };
    }

    return { result: 'loss', exitPrice: TradeManager.slPrice, reason: 'ambiguous_fallback', exitTime: candle.time.getTime() };
}

function getPrimaryIntervalMs() {
    const primaryInterval = cachedIntervals.normal || CONFIG.interval;
    return intervalToMs(primaryInterval);
}

function getDurationInPrimaryCandles(endTime) {
    if (!simulationEntryTime || !endTime) return 0;
    const delta = Math.max(0, endTime - simulationEntryTime);
    const base = getPrimaryIntervalMs();
    if (!base) return 0;
    return Math.max(0, Math.ceil(delta / base));
}

function finishSimulation(result, exitPrice, reason, exitTime) {
    TradeManager.isSimulating = false;
    TradeManager.updateUI();
    const durationEndTime = exitTime || simulationLastTime || simulationEntryTime;
    const durationCandles = getDurationInPrimaryCandles(durationEndTime);

    const simulationId = currentSimulationId;
    currentSimulationId = null;

    if (result === 'no_data') {
        analyticsFinalizeSimulation(simulationId, {
            result: 'draw',
            reason: reason || 'no_data',
            exitPrice: null,
            exitTime: durationEndTime || null,
            pnlPct: null
        }).catch(() => { });
    }

    if (!tradeModal) return;

    if (result === 'no_data') {
        tradeResultStatus.innerText = 'SIN DATOS';
        tradeResultTitle.innerText = 'NO RESUELTO';
        tradeResultPnl.innerText = '--';
        tradeResultPnl.className = 'text-lg font-semibold text-slate-500 dark:text-slate-400';
        tradeResultStatus.className = 'text-slate-500 dark:text-slate-400';
        tradeResultRR.innerText = '--';
        if (tradeResultDuration) tradeResultDuration.innerText = `${durationCandles} velas`;
        tradeModal.classList.remove('hidden');
        return;
    }

    const entry = TradeManager.entryPrice;
    const pnl = TradeManager.direction === 'long'
        ? ((exitPrice - entry) / entry) * 100
        : ((entry - exitPrice) / entry) * 100;
    const rr = getTradeRR();

    analyticsFinalizeSimulation(simulationId, {
        result: result === 'win' ? 'tp' : 'sl',
        reason: reason || null,
        exitPrice: exitPrice || null,
        exitTime: exitTime || durationEndTime || null,
        pnlPct: Number.isFinite(pnl) ? pnl : null
    }).catch(() => { });

    if (reason === 'ambiguous_ltf') {
        tradeResultStatus.innerText = result === 'win' ? 'WIN (LTF)' : 'LOSS (LTF)';
    } else if (reason === 'ambiguous_fallback') {
        tradeResultStatus.innerText = 'LOSS (AMBIGUO)';
    } else {
        tradeResultStatus.innerText = result === 'win' ? 'WIN' : 'LOSS';
    }
    tradeResultTitle.innerText = result === 'win' ? 'PROFIT' : 'LOSS';
    tradeResultPnl.innerText = `${pnl >= 0 ? '+' : ''}${pnl.toFixed(2)}%`;
    tradeResultPnl.className = result === 'win'
        ? 'text-lg font-semibold text-emerald-500'
        : 'text-lg font-semibold text-rose-500';
    tradeResultStatus.className = result === 'win' ? 'text-emerald-500' : 'text-rose-500';
    tradeResultRR.innerText = rr ? `1:${rr.toFixed(2)}` : '1:--';
    if (tradeResultDuration) tradeResultDuration.innerText = `${durationCandles} velas`;
    tradeModal.classList.remove('hidden');
}

function resizeCanvas() {
    const dpr = window.devicePixelRatio || 1;

    canvas.style.width = container.clientWidth + 'px';
    canvas.style.height = container.clientHeight + 'px';

    canvas.width = container.clientWidth * dpr;
    canvas.height = container.clientHeight * dpr;

    ctx.scale(dpr, dpr);

    chartDimensions = {
        width: container.clientWidth,
        height: container.clientHeight
    };

    if (candles.length > 0) drawChart();
}

function drawChart() {
    if (!candles.length) return;

    const { width, height } = chartDimensions;
    const { top, right, bottom } = CONFIG.padding;

    ctx.fillStyle = CONFIG.colors.bg;
    ctx.fillRect(0, 0, width, height);

    let minPrice = Infinity;
    let maxPrice = -Infinity;
    candles.forEach(c => {
        if (c.low < minPrice) minPrice = c.low;
        if (c.high > maxPrice) maxPrice = c.high;
    });

    const priceRange = maxPrice - minPrice;
    const rangePadding = priceRange * 0.15;
    const yMax = maxPrice + rangePadding;
    const yMin = minPrice - rangePadding;
    const chartHeight = height - (top + bottom);
    chartScale = { yMin, yMax, top, bottom, height, width };

    const getY = (price) => top + (chartHeight - ((price - yMin) / (yMax - yMin)) * chartHeight);
    const candleWidth = (width - right) / CONFIG.limit;
    const gap = candleWidth * 0.3;
    const getX = (index) => index * candleWidth;

    ctx.strokeStyle = CONFIG.colors.grid;
    ctx.lineWidth = 1;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();

    const gridCount = Math.min(9, Math.max(5, Math.round(chartHeight / 80)));
    const lastClose = candles[candles.length - 1].close || 1;
    for (let i = 0; i <= gridCount; i++) {
        const y = top + (chartHeight * (i / gridCount));
        ctx.moveTo(0, y);
        ctx.lineTo(width - right, y);

        const priceVal = (yMax - (i / gridCount) * (yMax - yMin));
        const percentVal = ((priceVal - lastClose) / lastClose) * 100;
        const sign = percentVal >= 0 ? '+' : '';
        const percentLabel = `${sign}${percentVal.toFixed(2)}%`;

        ctx.fillStyle = CONFIG.colors.text;
        ctx.font = '11px JetBrains Mono';
        ctx.fillText(percentLabel, width - right + 8, y + 4);
    }

    for (let i = 0; i < CONFIG.limit; i += 20) {
        const x = getX(i) + (candleWidth / 2);
        ctx.moveTo(x, top);
        ctx.lineTo(x, height - bottom);
    }
    ctx.stroke();
    ctx.setLineDash([]);

    candles.forEach((candle, i) => {
        const x = getX(i);
        const yOpen = getY(candle.open);
        const yClose = getY(candle.close);
        const yHigh = getY(candle.high);
        const yLow = getY(candle.low);

        const isBullish = candle.close >= candle.open;
        const color = isBullish ? CONFIG.colors.bull : CONFIG.colors.bear;

        ctx.fillStyle = color;
        ctx.strokeStyle = color;
        ctx.lineWidth = 1;

        const centerX = x + (candleWidth / 2);
        ctx.beginPath();
        ctx.moveTo(centerX, yHigh);
        ctx.lineTo(centerX, yLow);
        ctx.stroke();

        const bodyWidth = candleWidth - gap;
        const bodyHeight = Math.abs(yClose - yOpen);
        const finalHeight = bodyHeight < 1 ? 1 : bodyHeight;

        ctx.fillRect(x + (gap / 2), Math.min(yOpen, yClose), bodyWidth, finalHeight);

        candle.screenX = x;
        candle.screenY = yClose;
    });

    const lastCandle = candles[candles.length - 1];
    const yCurrent = getY(lastCandle.close);
    ctx.strokeStyle = lastCandle.close >= lastCandle.open ? CONFIG.colors.bull : CONFIG.colors.bear;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(0, yCurrent);
    ctx.lineTo(width, yCurrent);
    ctx.stroke();
    ctx.setLineDash([]);

    if (TradeManager.active) {
        drawTradeOverlay(width, right);
    }
}

function drawTradeOverlay(width, right) {
    if (!TradeManager.active || !chartScale) return;
    const entryY = priceToY(TradeManager.entryPrice);
    const tpY = priceToY(TradeManager.tpPrice);
    const slY = priceToY(TradeManager.slPrice);
    if (entryY === null || tpY === null || slY === null) return;

    const xStart = 0;
    const xEnd = width - right;
    const topZone = Math.min(entryY, tpY);
    const topHeight = Math.abs(entryY - tpY);
    const botZone = Math.min(entryY, slY);
    const botHeight = Math.abs(entryY - slY);

    ctx.fillStyle = 'rgba(34, 197, 94, 0.18)';
    ctx.fillRect(xStart, topZone, xEnd, topHeight);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.18)';
    ctx.fillRect(xStart, botZone, xEnd, botHeight);

    ctx.lineWidth = 2;
    ctx.setLineDash([]);

    ctx.strokeStyle = 'rgba(34, 197, 94, 0.9)';
    ctx.beginPath();
    ctx.moveTo(xStart, tpY);
    ctx.lineTo(xEnd, tpY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(239, 68, 68, 0.9)';
    ctx.beginPath();
    ctx.moveTo(xStart, slY);
    ctx.lineTo(xEnd, slY);
    ctx.stroke();

    ctx.strokeStyle = 'rgba(59, 130, 246, 0.9)';
    ctx.beginPath();
    ctx.moveTo(xStart, entryY);
    ctx.lineTo(xEnd, entryY);
    ctx.stroke();

    ctx.font = '12px JetBrains Mono';
    ctx.fillStyle = 'rgba(34, 197, 94, 0.95)';
    ctx.fillText(`TP ${TradeManager.tpPrice.toFixed(2)}`, xEnd + 8, tpY + 4);
    ctx.fillStyle = 'rgba(239, 68, 68, 0.95)';
    ctx.fillText(`SL ${TradeManager.slPrice.toFixed(2)}`, xEnd + 8, slY + 4);
    ctx.fillStyle = 'rgba(59, 130, 246, 0.95)';
    ctx.fillText(`ENTRY ${TradeManager.entryPrice.toFixed(2)}`, xEnd + 8, entryY + 4);
}

function hitTestTradeLine(mouseY, tolerance = 6) {
    if (!TradeManager.active || TradeManager.isSimulating || !chartScale) return null;
    const tpY = priceToY(TradeManager.tpPrice);
    const slY = priceToY(TradeManager.slPrice);
    if (tpY !== null && Math.abs(mouseY - tpY) <= tolerance) return 'tp';
    if (slY !== null && Math.abs(mouseY - slY) <= tolerance) return 'sl';
    return null;
}

function updateDraggedLine(mouseY) {
    if (!TradeManager.active || !dragTarget) return;
    const price = yToPrice(mouseY);
    if (!price) return;
    const entry = TradeManager.entryPrice;
    const minGap = entry * 0.0005;
    if (dragTarget === 'tp') {
        TradeManager.tpPrice = TradeManager.direction === 'long'
            ? Math.max(price, entry + minGap)
            : Math.min(price, entry - minGap);
    } else if (dragTarget === 'sl') {
        TradeManager.slPrice = TradeManager.direction === 'long'
            ? Math.min(price, entry - minGap)
            : Math.max(price, entry + minGap);
    }
    TradeManager.updateUI();
    drawChart();
}

container.addEventListener('mousedown', (e) => {
    if (!TradeManager.active || TradeManager.isSimulating) return;
    const rect = container.getBoundingClientRect();
    const mouseY = e.clientY - rect.top;
    const hit = hitTestTradeLine(mouseY);
    if (hit) {
        isDraggingLine = true;
        dragTarget = hit;
        container.style.cursor = 'ns-resize';
    }
});

container.addEventListener('mouseup', () => {
    isDraggingLine = false;
    dragTarget = null;
    if (!TradeManager.isSimulating) container.style.cursor = 'crosshair';
});

container.addEventListener('mousemove', (e) => {
    const rect = container.getBoundingClientRect();
    const mouseX = e.clientX - rect.left;
    const mouseY = e.clientY - rect.top;

    if (isDraggingLine) {
        updateDraggedLine(mouseY);
        return;
    }

    const hit = hitTestTradeLine(mouseY);
    if (hit) container.style.cursor = 'ns-resize';
    else if (!TradeManager.isSimulating) container.style.cursor = 'crosshair';

    if (!TOOLTIP_ENABLED) {
        tooltip.style.display = 'none';
        return;
    }
    if (!candles.length) return;

    const candleWidth = (chartDimensions.width - CONFIG.padding.right) / CONFIG.limit;
    const index = Math.floor(mouseX / candleWidth);

    if (index >= 0 && index < candles.length) {
        const c = candles[index];
        const fmt = (n) => n < 1 ? n.toFixed(5) : n.toFixed(2);

        let tooltipX = mouseX + 15;
        let tooltipY = mouseY + 15;

        if (tooltipX + 200 > chartDimensions.width) tooltipX = mouseX - 210;

        tooltip.style.left = tooltipX + 'px';
        tooltip.style.top = tooltipY + 'px';
        tooltip.style.display = 'block';

        document.getElementById('t-date').innerText = c.time.toLocaleDateString() + ' ' + c.time.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
        document.getElementById('t-open').innerText = fmt(c.open);
        document.getElementById('t-high').innerText = fmt(c.high);
        document.getElementById('t-low').innerText = fmt(c.low);
        document.getElementById('t-close').innerText = fmt(c.close);

        const closeEl = document.getElementById('t-close');
        closeEl.className = `text-right font-bold ${c.close >= c.open ? 'text-green-400' : 'text-red-400'}`;
    } else {
        tooltip.style.display = 'none';
    }
});

container.addEventListener('mouseleave', () => {
    if (!TOOLTIP_ENABLED) {
        tooltip.style.display = 'none';
    }
    tooltip.style.display = 'none';
    isDraggingLine = false;
    dragTarget = null;
    if (!TradeManager.isSimulating) container.style.cursor = 'crosshair';
});

// Touch support for mobile devices
container.addEventListener('touchstart', (e) => {
    if (!TradeManager.active || TradeManager.isSimulating) return;
    const touch = e.touches[0];
    const rect = container.getBoundingClientRect();
    const mouseY = touch.clientY - rect.top;
    const hit = hitTestTradeLine(mouseY, 20); // Higher tolerance for touch
    if (hit) {
        isDraggingLine = true;
        dragTarget = hit;
        container.style.cursor = 'ns-resize';
        if (e.cancelable) e.preventDefault();
    }
}, { passive: false });

container.addEventListener('touchmove', (e) => {
    if (!isDraggingLine) return;
    const touch = e.touches[0];
    const rect = container.getBoundingClientRect();
    const mouseY = touch.clientY - rect.top;
    updateDraggedLine(mouseY);
    if (e.cancelable) e.preventDefault();
}, { passive: false });

container.addEventListener('touchend', () => {
    isDraggingLine = false;
    dragTarget = null;
    if (!TradeManager.isSimulating) container.style.cursor = 'crosshair';
});

container.addEventListener('touchcancel', () => {
    isDraggingLine = false;
    dragTarget = null;
    if (!TradeManager.isSimulating) container.style.cursor = 'crosshair';
});

window.addEventListener('resize', () => {
    resizeCanvas();
});

if (randomizeButton) {
    randomizeButton.addEventListener('click', randomizeChart);
}

if (btnLtf && btnNormal && btnHtf) {
    btnLtf.addEventListener('click', () => switchTimeframe('ltf'));
    btnNormal.addEventListener('click', () => switchTimeframe('normal'));
    btnHtf.addEventListener('click', () => switchTimeframe('htf'));
}

if (tradeLongBtn && tradeShortBtn && tradeExecuteBtn) {
    tradeLongBtn.addEventListener('click', () => TradeManager.setDirection('long'));
    tradeShortBtn.addEventListener('click', () => TradeManager.setDirection('short'));
    tradeExecuteBtn.addEventListener('click', () => {
        closeSidebar();
        startSimulation();
    });
}

if (tradeResultClose) {
    tradeResultClose.addEventListener('click', () => TradeManager.reset());
}

if (navToggle && navMenu) {
    navToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        navMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (navMenu.classList.contains('hidden')) return;
        if (!navMenu.contains(e.target) && !navToggle.contains(e.target)) {
            navMenu.classList.add('hidden');
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') navMenu.classList.add('hidden');
    });
    navMenu.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => navMenu.classList.add('hidden'));
    });
}

// --- Mobile Sidebar Logic ---
const appSidebar = document.getElementById('app-sidebar');
const sidebarOverlay = document.getElementById('sidebar-overlay');
const mobileMenuBtn = document.getElementById('mobile-menu-btn');
const mobileMenuClose = document.getElementById('mobile-menu-close');

function openSidebar() {
    if (!appSidebar || !sidebarOverlay) return;
    appSidebar.classList.remove('translate-x-full');
    sidebarOverlay.classList.remove('hidden');
    // Force reflow
    void sidebarOverlay.offsetWidth;
    sidebarOverlay.classList.remove('opacity-0');
    document.body.style.overflow = 'hidden';
}

function closeSidebar() {
    if (!appSidebar || !sidebarOverlay) return;
    appSidebar.classList.add('translate-x-full');
    sidebarOverlay.classList.add('opacity-0');
    setTimeout(() => {
        sidebarOverlay.classList.add('hidden');
        document.body.style.overflow = '';
    }, 300);
}

if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openSidebar);
if (mobileMenuClose) mobileMenuClose.addEventListener('click', closeSidebar);
if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);

updateChartTheme();
loadAllTimeframes();

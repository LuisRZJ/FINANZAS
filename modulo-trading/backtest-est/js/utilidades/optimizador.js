/**
 * Optimizador por Fuerza Bruta - Versión Multi-Worker.
 * 
 * Exports:
 *   optimizeChunk() → corre en N Web Workers en paralelo
 *   rankResults()   → corre una vez tras completar todos los chunks
 *
 * Optimizaciones:
 *   - Métricas inline (zero-allocation, sin array de trades)
 *   - Pre-cálculo y caché de medias móviles
 *   - Top-K por chunk para minimizar transferencia de datos
 */
import { calcSMA, calcEMA } from './indicadores.js';

// ─── Backtest con Métricas Inline ─────────────────────────
export function runBacktestInline(dates, closes, highs, lows, fastMA, slowMA, fastPeriod, slowPeriod, exitMode, slCandles, rr, riskFraction = 0.02) {
    const startIndex = Math.max(fastPeriod, slowPeriod);
    let inPosition = false, entryIdx = -1, slPrice = 0, tpPrice = 0;
    let comp = 1, wins = 0, gp = 0, gl = 0, peak = 1, maxDD = 0, numTrades = 0;

    for (let i = startIndex; i < closes.length; i++) {
        if (fastMA[i] === null || slowMA[i] === null ||
            fastMA[i - 1] === null || slowMA[i - 1] === null) continue;

        if (inPosition && exitMode === 'fixed') {
            let exitPrice = 0;
            if (lows[i] <= slPrice) exitPrice = slPrice;
            else if (highs[i] >= tpPrice) exitPrice = tpPrice;

            if (exitPrice > 0) {
                const ret = ((exitPrice - closes[entryIdx]) / closes[entryIdx]) * 100;
                comp *= (1 + (ret / 100) * riskFraction);
                if (ret > 0) { wins++; gp += ret; } else { gl += Math.abs(ret); }
                if (comp > peak) peak = comp;
                const d = ((peak - comp) / peak) * 100;
                if (d > maxDD) maxDD = d;
                numTrades++;
                inPosition = false;
                continue;
            }
        }

        const prevFastAbove = fastMA[i - 1] > slowMA[i - 1];
        const currFastAbove = fastMA[i] > slowMA[i];

        if (!inPosition && currFastAbove && !prevFastAbove) {
            inPosition = true;
            entryIdx = i;
            if (exitMode === 'fixed') {
                let minLow = lows[i];
                const lookbackStart = Math.max(0, i - slCandles + 1);
                for (let k = lookbackStart; k <= i; k++) {
                    if (lows[k] < minLow) minLow = lows[k];
                }
                slPrice = minLow;

                let distAmount = closes[i] - slPrice;
                if (distAmount <= 0) distAmount = closes[i] * 0.001; // Failsafe para evitar SL plano o negativo

                tpPrice = closes[i] + (distAmount * rr);
            }
        }

        if (inPosition && exitMode === 'classic' && !currFastAbove && prevFastAbove) {
            const ret = ((closes[i] - closes[entryIdx]) / closes[entryIdx]) * 100;
            comp *= (1 + (ret / 100) * riskFraction);
            if (ret > 0) { wins++; gp += ret; } else { gl += Math.abs(ret); }
            if (comp > peak) peak = comp;
            const d = ((peak - comp) / peak) * 100;
            if (d > maxDD) maxDD = d;
            numTrades++;
            inPosition = false;
        }
    }

    if (inPosition && entryIdx >= 0) {
        const ret = ((closes[closes.length - 1] - closes[entryIdx]) / closes[entryIdx]) * 100;
        comp *= (1 + (ret / 100) * riskFraction);
        if (ret > 0) { wins++; gp += ret; } else { gl += Math.abs(ret); }
        if (comp > peak) peak = comp;
        const d = ((peak - comp) / peak) * 100;
        if (d > maxDD) maxDD = d;
        numTrades++;
    }

    if (numTrades === 0) return { totalROI: 0, cagr: 0, winRate: 0, profitFactor: 0, maxDD: 0, numTrades: 0 };

    // Calcular CAGR real basado en el tiempo
    let cagr = 0;
    const totalROI = (comp - 1) * 100;

    // Asumimos que dates[startIndex] y dates[length-1] son strings o timestamps parseables
    const firstDate = new Date(dates[startIndex]);
    const lastDate = new Date(dates[dates.length - 1]);
    const yearsElapsed = (lastDate - firstDate) / (1000 * 60 * 60 * 24 * 365.25);

    if (yearsElapsed > 0) {
        cagr = ((Math.pow(1 + totalROI / 100, 1 / yearsElapsed)) - 1) * 100;
        if (!isFinite(cagr) || isNaN(cagr)) cagr = 0;
    }

    return {
        totalROI,
        cagr,
        winRate: (wins / numTrades) * 100,
        profitFactor: gl > 0 ? gp / gl : (gp > 0 ? 999 : 0),
        maxDD, numTrades
    };
}

// ─── Helpers ──────────────────────────────────────────────
function generateExitConfigs(params) {
    const { exitModes, slCandles, rr } = params;
    const configs = [];
    const doClassic = exitModes.includes('classic') || exitModes.includes('both');
    const doFixed = exitModes.includes('fixed') || exitModes.includes('both');
    if (doClassic) configs.push({ exitMode: 'classic', slCandles: 0, rr: 0 });
    if (doFixed) configs.push({ exitMode: 'fixed', slCandles: slCandles ?? 5, rr: rr ?? 2 });
    return configs;
}

function generateAllCombinations(params) {
    const { minPeriod, maxPeriod, step, maTypes } = params;
    const exitConfigs = generateExitConfigs(params);
    const combos = [];
    for (const maTypeStr of maTypes) {
        let fastType = maTypeStr, slowType = maTypeStr;
        if (maTypeStr.includes('/')) [fastType, slowType] = maTypeStr.split('/');
        for (let fast = minPeriod; fast <= maxPeriod; fast += step)
            for (let slow = fast + step; slow <= maxPeriod; slow += step)
                for (const ec of exitConfigs)
                    combos.push({ fastPeriod: fast, slowPeriod: slow, fastType, slowType, exitMode: ec.exitMode, slCandles: ec.slCandles, rr: ec.rr });
    }
    return combos;
}

export function computeMACache(closes, params) {
    const { minPeriod, maxPeriod, step, maTypes } = params;
    const cache = { SMA: {}, EMA: {} };
    const periods = new Set();
    for (let p = minPeriod; p <= maxPeriod; p += step) periods.add(p);
    const types = new Set();
    maTypes.forEach(t => {
        if (t === 'SMA' || t === 'EMA') types.add(t);
        if (t === 'SMA/EMA' || t === 'EMA/SMA') { types.add('SMA'); types.add('EMA'); }
    });
    periods.forEach(p => {
        if (types.has('SMA')) cache.SMA[p] = calcSMA(closes, p);
        if (types.has('EMA')) cache.EMA[p] = calcEMA(closes, p);
    });
    return cache;
}

function cfgKey(c) {
    return `${c.fastType}${c.fastPeriod}/${c.slowType}${c.slowPeriod}·${c.exitMode}·${c.slCandles}·${c.rr}`;
}

function balancedScore(t) {
    return (t.totalROI / (1 + t.maxDD / 100)) * Math.sqrt(Math.max(t.winRate, 1) / 100);
}

// ─── Top-K tracker para minimizar datos de retorno ────────
const TOP_K = 200;
function insertIntoTopK(list, entry, compareFn) {
    if (list.length < TOP_K) { list.push(entry); return; }
    // Find worst in list
    let worstIdx = 0;
    for (let i = 1; i < list.length; i++) {
        if (compareFn(list[i], list[worstIdx]) < 0) worstIdx = i;
    }
    if (compareFn(entry, list[worstIdx]) > 0) list[worstIdx] = entry;
}

/**
 * Procesa un chunk de combinaciones (llamado por cada Worker).
 * Retorna solo los top-K por cada criterio para minimizar datos.
 */
export function optimizeChunk(allDates, allCloses, allHighs, allLows, params, chunkIdx, totalChunks, onProgress) {
    const { trainRatio, riskFraction } = params;
    const splitIndex = Math.floor(allCloses.length * trainRatio);
    const trainDates = allDates.slice(0, splitIndex);
    const trainCloses = allCloses.slice(0, splitIndex);
    const trainHighs = allHighs.slice(0, splitIndex);
    const trainLows = allLows.slice(0, splitIndex);
    const trainCache = computeMACache(trainCloses, params);

    const allCombos = generateAllCombinations(params);
    const total = allCombos.length;
    const start = Math.floor(chunkIdx * total / totalChunks);
    const end = Math.floor((chunkIdx + 1) * total / totalChunks);

    // Top-K trackers por criterio
    const topROI = [], topBal = [], topDD = [], topWR = [], topPF = [];
    let validCount = 0;

    for (let i = start; i < end; i++) {
        const c = allCombos[i];
        const train = runBacktestInline(
            trainDates, trainCloses, trainHighs, trainLows,
            trainCache[c.fastType][c.fastPeriod], trainCache[c.slowType][c.slowPeriod],
            c.fastPeriod, c.slowPeriod, c.exitMode, c.slCandles, c.rr, riskFraction
        );

        if (train.numTrades < 3) continue;
        validCount++;

        const entry = { config: c, train, _bs: balancedScore(train) };
        insertIntoTopK(topROI, entry, (a, b) => a.train.totalROI - b.train.totalROI);
        insertIntoTopK(topBal, entry, (a, b) => a._bs - b._bs);
        insertIntoTopK(topDD, entry, (a, b) => b.train.maxDD - a.train.maxDD); // lower is better
        insertIntoTopK(topWR, entry, (a, b) => a.train.winRate - b.train.winRate);
        insertIntoTopK(topPF, entry, (a, b) => a.train.profitFactor - b.train.profitFactor);

        if (onProgress && (i - start) % 2000 === 0) {
            onProgress(Math.round(((i - start) / (end - start)) * 100));
        }
    }

    // Deduplicar antes de enviar
    const unique = new Map();
    [topROI, topBal, topDD, topWR, topPF].forEach(list => {
        for (const e of list) {
            const key = cfgKey(e.config);
            if (!unique.has(key)) unique.set(key, { config: e.config, train: e.train });
        }
    });

    if (onProgress) onProgress(100);

    return {
        topEntries: [...unique.values()],
        chunkSize: end - start,
        validCount,
        splitIndex,
        totalCombinations: total
    };
}

/**
 * Genera rankings finales a partir de los top entries fusionados de todos los workers.
 * Incluye validación Train/Test.
 */
export function rankResults(mergedEntries, allDates, allCloses, allHighs, allLows, params, splitIndex, totalCombinations, totalValidCount) {
    // Compute balanced scores
    for (const r of mergedEntries) {
        r.balancedScore = balancedScore(r.train);
    }

    const topBalanced = [...mergedEntries].sort((a, b) => b.balancedScore - a.balancedScore).slice(0, 5);
    const topROI = [...mergedEntries].sort((a, b) => b.train.totalROI - a.train.totalROI).slice(0, 5);
    const topLowDD = [...mergedEntries].sort((a, b) => a.train.maxDD - b.train.maxDD).slice(0, 5);
    const topWinRate = [...mergedEntries].sort((a, b) => b.train.winRate - a.train.winRate).slice(0, 5);
    const topPF = [...mergedEntries].sort((a, b) => b.train.profitFactor - a.train.profitFactor).slice(0, 5);

    // ─── Test Validation ──────────────────────────────
    const allCache = computeMACache(allCloses, params);
    const testDates = allDates.slice(splitIndex);
    const testCloses = allCloses.slice(splitIndex);
    const testHighs = allHighs.slice(splitIndex);
    const testLows = allLows.slice(splitIndex);

    function evalTest(entry) {
        if (entry.test) return;
        const c = entry.config;
        const testFast = allCache[c.fastType][c.fastPeriod].slice(splitIndex);
        const testSlow = allCache[c.slowType][c.slowPeriod].slice(splitIndex);

        entry.test = runBacktestInline(
            testDates, testCloses, testHighs, testLows,
            testFast, testSlow,
            c.fastPeriod, c.slowPeriod, c.exitMode, c.slCandles, c.rr, params.riskFraction
        );

        const trainROI = entry.train.totalROI;
        const testROI = entry.test.totalROI;
        entry.degradation = trainROI !== 0 ? Math.abs((testROI - trainROI) / trainROI) * 100 : 0;
        entry.isOverfit = entry.degradation > 50 || testROI < 0;
    }

    // Evaluar tests en los tops
    const evaluated = new Map();
    [topBalanced, topROI, topLowDD, topWinRate, topPF].forEach(list => {
        for (const entry of list) {
            const key = cfgKey(entry.config);
            if (evaluated.has(key)) {
                const cached = evaluated.get(key);
                entry.test = cached.test;
                entry.degradation = cached.degradation;
                entry.isOverfit = cached.isOverfit;
            } else {
                evalTest(entry);
                evaluated.set(key, entry);
            }
        }
    });

    // Ranking "Mejores Validadas"
    const top100ROI = [...mergedEntries].sort((a, b) => b.train.totalROI - a.train.totalROI).slice(0, 100);
    const top100Bal = [...mergedEntries].sort((a, b) => b.balancedScore - a.balancedScore).slice(0, 100);
    const candidates = new Set([...top100ROI, ...top100Bal]);

    const validatedCandidates = [];
    candidates.forEach(entry => {
        const key = cfgKey(entry.config);
        if (evaluated.has(key)) {
            const cached = evaluated.get(key);
            entry.test = cached.test;
            entry.degradation = cached.degradation;
            entry.isOverfit = cached.isOverfit;
        } else {
            evalTest(entry);
            evaluated.set(key, entry);
        }
        if (!entry.isOverfit && entry.test.numTrades >= 2) validatedCandidates.push(entry);
    });

    const topValidated = validatedCandidates
        .sort((a, b) => (b.train.totalROI + b.test.totalROI) - (a.train.totalROI + a.test.totalROI))
        .slice(0, 5);

    return {
        rankings: { validated: topValidated, balanced: topBalanced, roi: topROI, lowDD: topLowDD, winRate: topWinRate, profitFactor: topPF },
        totalCombinations,
        validCombinations: totalValidCount,
        splitIndex,
        trainSize: splitIndex,
        testSize: allCloses.length - splitIndex,
        riskFraction: params.riskFraction ?? 0.02
    };
}

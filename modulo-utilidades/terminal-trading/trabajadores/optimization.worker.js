let cancelRequested = false;

const lowerBound = (arr, target) => {
    let left = 0;
    let right = arr.length;
    while (left < right) {
        const mid = (left + right) >> 1;
        if (arr[mid] < target) left = mid + 1;
        else right = mid;
    }
    return left;
};

const getTime = (dt) => {
    if (dt instanceof Date) {
        const t = dt.getTime();
        return isNaN(t) ? null : t;
    }
    if (typeof dt === 'string' || typeof dt === 'number') {
        const d = new Date(dt);
        const t = d.getTime();
        return isNaN(t) ? null : t;
    }
    return null;
};

const buildIndex = (data) => {
    const times = [];
    const rows = [];
    for (let i = 0; i < data.length; i++) {
        const x = data[i];
        if (!x) continue;
        const t = getTime(x.datetime);
        if (t == null) continue;
        const revived = x.datetime instanceof Date ? x : { ...x, datetime: new Date(t) };
        times.push(t);
        rows.push(revived);
    }
    return { times, rows };
};

self.onmessage = (event) => {
    const { type, payload } = event.data || {};
    if (type === 'start') {
        cancelRequested = false;
        runOptimization(payload);
    } else if (type === 'cancel') {
        cancelRequested = true;
    }
};

const runOptimization = async (payload) => {
    try {
        const {
            mode,
            csvData,
            htfData,
            ltfData,
            selectedCandleIndex,
            tradeParams,
            rsiTolerance,
            volumeTolerance,
            bpTolerance,
            trendCondition,
            timeMode,
            htfMode,
            adxThreshold,
            tfMinutes,
            htfTfMinutes,
            hasExtended,
            customCriteria,
            forceCooldown
        } = payload;

        if (!Array.isArray(csvData) || !csvData.length) {
            self.postMessage({ type: 'error', payload: { message: 'Sin datos para optimizar.' } });
            return;
        }

        for (let i = 0; i < csvData.length; i++) {
            const c = csvData[i];
            if (!c) continue;
            const t = getTime(c.datetime);
            if (t != null && !(c.datetime instanceof Date)) {
                c.datetime = new Date(t);
            }
        }

        const FILTER_WEIGHTS = {
            HTF: 30,
            VOL: 25,
            RSI: 15,
            TIME: 15,
            OTHER: 15
        };

        const htfIndex = buildIndex(Array.isArray(htfData) ? htfData : []);
        const ltfIndex = buildIndex(Array.isArray(ltfData) ? ltfData : []);

        const calculateBacktest = (data, targetIdx, tradeParamsInner, filters) => {
            if (!data || !data.length) return { error: 'Sin datos' };
            if (targetIdx == null || targetIdx < 0 || targetIdx >= data.length) return { error: 'Índice objetivo inválido' };
            const target = data[targetIdx];
            if (!target) return { error: 'Vela objetivo inválida' };

            const maxIndexExclusive = filters.maxIndexExclusive != null ? filters.maxIndexExclusive : targetIdx;
            const minIndexInclusive = filters.minIndexInclusive != null ? Math.max(200, filters.minIndexInclusive) : 200;
            const iStart = minIndexInclusive;
            const iEndExclusive = Math.min(maxIndexExclusive, data.length - 1);
            if (iEndExclusive <= iStart) return { error: 'No hay suficiente histórico en el rango especificado.' };

            const {
                useRsi, rsiTol,
                useTrend, trendCond,
                useTime, timeMode: tm,
                useVolBody,
                useVol, volTol,
                useBp, bpTol,
                useDelta,
                useCooldown,
                useAdr,
                useHtf,
                htfMode: hm,
                requireHtf: reqHtf,
                useLtfIntra: useIntra,
                maxDurationLimit = 500,
                useRegime,
                adxThreshold: adxThresh = 25,
                minScore = 70
            } = filters;

            const epBase = Number(tradeParamsInner.entryPrice);
            const slBase = Number(tradeParamsInner.stopLoss);
            const tpBase = Number(tradeParamsInner.takeProfit);
            const spreadAbs = Math.max(0, Number(tradeParamsInner.spread) || 0);
            if (!isFinite(epBase) || epBase <= 0 || !isFinite(slBase) || !isFinite(tpBase)) return { error: 'Parámetros inválidos (Entry/SL/TP).' };

            const spreadHalf = spreadAbs / 2;
            const normalizeTradeLevels = () => {
                if (tradeParamsInner.tradeType === 'LONG') {
                    return {
                        entry: epBase + spreadHalf,
                        sl: slBase + spreadHalf,
                        tp: tpBase - spreadHalf
                    };
                }
                return {
                    entry: epBase - spreadHalf,
                    sl: slBase - spreadHalf,
                    tp: tpBase + spreadHalf
                };
            };

            const baseLevels = normalizeTradeLevels();
            if (tradeParamsInner.tradeType === 'LONG') {
                if (!(baseLevels.sl < baseLevels.entry)) return { error: 'Configuración inválida (SL/Spread) en LONG.' };
                if (!(baseLevels.tp > baseLevels.entry)) return { error: 'Configuración inválida (TP/Spread) en LONG.' };
            } else {
                if (!(baseLevels.sl > baseLevels.entry)) return { error: 'Configuración inválida (SL/Spread) en SHORT.' };
                if (!(baseLevels.tp < baseLevels.entry)) return { error: 'Configuración inválida (TP/Spread) en SHORT.' };
            }

            const riskDist = Math.abs((baseLevels.entry - baseLevels.sl) / baseLevels.entry);
            const tpDist = Math.abs((baseLevels.tp - baseLevels.entry) / baseLevels.entry);
            if (!isFinite(riskDist) || riskDist <= 0) return { error: 'Distancia de riesgo inválida.' };
            if (!isFinite(tpDist) || tpDist <= 0) return { error: 'Distancia de beneficio inválida.' };

            const getHour = (x) => {
                const h = (tm === 'UTC') ? x.hourUtc : x.hourLocal;
                return (typeof h === 'number' && isFinite(h)) ? h : null;
            };

            const getHtfCandleAtMs = (tMs) => {
                if (!htfIndex || !htfIndex.times || !htfIndex.times.length) return null;
                const pos = lowerBound(htfIndex.times, tMs) - 1;
                if (pos < 0) return null;
                const c = htfIndex.rows[pos];
                if (!c || !(c.datetime instanceof Date)) return null;
                const tf = htfTfMinutes;
                if (!tf || !isFinite(tf)) return null;
                const startMs = c.datetime.getTime();
                const endMs = startMs + tf * 60000;
                if (tMs < startMs || tMs >= endMs) return null;
                return c;
            };

            const getLtfSlice = (startMs, endMs) => {
                if (!ltfIndex || !ltfIndex.times || !ltfIndex.times.length) return null;
                const startPos = lowerBound(ltfIndex.times, startMs);
                if (startPos >= ltfIndex.times.length) return null;
                const out = [];
                for (let i = startPos; i < ltfIndex.times.length; i++) {
                    const t = ltfIndex.times[i];
                    if (t >= endMs) break;
                    const c = ltfIndex.rows[i];
                    if (c) out.push(c);
                }
                return out;
            };

            if (useRsi && (target.rsi == null || !isFinite(target.rsi))) return { error: 'RSI no disponible en la vela objetivo.' };
            if (useVolBody && (target.bodySizePct == null || !isFinite(target.bodySizePct))) return { error: 'Volatilidad de vela no disponible en la vela objetivo.' };
            if (useVol && (target.volume == null || !isFinite(target.volume))) return { error: 'Volumen no disponible en la vela objetivo.' };
            if (useBp && (target.buyPressurePct == null || !isFinite(target.buyPressurePct))) return { error: 'Presión compradora no disponible en la vela objetivo.' };
            if (useDelta && (target.delta == null || !isFinite(target.delta))) return { error: 'Delta no disponible en la vela objetivo.' };
            if (useRegime && (target.adx == null || !isFinite(target.adx))) return { error: 'ADX no disponible en la vela objetivo.' };

            const simulateTrade = (startIdx) => {
                const startMid = data[startIdx].close;
                const entryEff = (tradeParamsInner.tradeType === 'LONG') ? (startMid + spreadHalf) : (startMid - spreadHalf);
                const simSL = tradeParamsInner.tradeType === 'LONG' ? entryEff * (1 - riskDist) : entryEff * (1 + riskDist);
                const simTP = tradeParamsInner.tradeType === 'LONG' ? entryEff * (1 + tpDist) : entryEff * (1 - tpDist);

                let outcome = 'TIMEOUT';
                let duration = 0;
                let worst = entryEff;
                let exitIdx = null;
                let intraResolved = false;
                let ambiguousHit = false;

                const jMaxExclusive = Math.min(data.length, maxIndexExclusive);
                for (let j = startIdx + 1; j < jMaxExclusive; j++) {
                    duration++;
                    const fut = data[j];

                    const o = fut && typeof fut.open === 'number' ? fut.open : NaN;
                    const h = fut && typeof fut.high === 'number' ? fut.high : NaN;
                    const l = fut && typeof fut.low === 'number' ? fut.low : NaN;
                    const openOk = isFinite(o);
                    const highOk = isFinite(h);
                    const lowOk = isFinite(l);

                    if (tradeParamsInner.tradeType === 'LONG') {
                        if (lowOk) worst = Math.min(worst, l);
                        if (openOk) worst = Math.min(worst, o);

                        if (openOk && o <= simSL) { outcome = 'LOSS'; exitIdx = j; break; }
                        if (openOk && o >= simTP) { outcome = 'WIN'; exitIdx = j; break; }

                        const hitSL = lowOk && l <= simSL;
                        const hitTP = highOk && h >= simTP;
                        if (hitSL && hitTP) {
                            ambiguousHit = true;
                            if (useIntra && tfMinutes && isFinite(tfMinutes)) {
                                const startMs = fut.datetime instanceof Date ? fut.datetime.getTime() : null;
                                if (startMs != null) {
                                    const endMs = startMs + tfMinutes * 60000;
                                    const slice = getLtfSlice(startMs, endMs);
                                    if (slice && slice.length) {
                                        let intraWorst = worst;
                                        let resolved = null;
                                        for (let k = 0; k < slice.length; k++) {
                                            const s = slice[k];
                                            const so = typeof s.open === 'number' ? s.open : NaN;
                                            const sh = typeof s.high === 'number' ? s.high : NaN;
                                            const sl = typeof s.low === 'number' ? s.low : NaN;
                                            const openS = isFinite(so);
                                            const highS = isFinite(sh);
                                            const lowS = isFinite(sl);
                                            if (lowS) intraWorst = Math.min(intraWorst, sl);
                                            if (openS) intraWorst = Math.min(intraWorst, so);
                                            if (openS && so <= simSL) { resolved = 'LOSS'; break; }
                                            if (openS && so >= simTP) { resolved = 'WIN'; break; }
                                            const slHit = lowS && sl <= simSL;
                                            const tpHit = highS && sh >= simTP;
                                            if (slHit && tpHit) { resolved = 'LOSS'; break; }
                                            if (slHit) { resolved = 'LOSS'; break; }
                                            if (tpHit) { resolved = 'WIN'; break; }
                                        }
                                        if (resolved) {
                                            worst = intraWorst;
                                            outcome = resolved;
                                            exitIdx = j;
                                            intraResolved = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            outcome = 'LOSS';
                            exitIdx = j;
                            break;
                        }
                        if (hitSL) { outcome = 'LOSS'; exitIdx = j; break; }
                        if (hitTP) { outcome = 'WIN'; exitIdx = j; break; }
                    } else {
                        if (highOk) worst = Math.max(worst, h);
                        if (openOk) worst = Math.max(worst, o);

                        if (openOk && o >= simSL) { outcome = 'LOSS'; exitIdx = j; break; }
                        if (openOk && o <= simTP) { outcome = 'WIN'; exitIdx = j; break; }

                        const hitSL = highOk && h >= simSL;
                        const hitTP = lowOk && l <= simTP;
                        if (hitSL && hitTP) {
                            ambiguousHit = true;
                            if (useIntra && tfMinutes && isFinite(tfMinutes)) {
                                const startMs = fut.datetime instanceof Date ? fut.datetime.getTime() : null;
                                if (startMs != null) {
                                    const endMs = startMs + tfMinutes * 60000;
                                    const slice = getLtfSlice(startMs, endMs);
                                    if (slice && slice.length) {
                                        let intraWorst = worst;
                                        let resolved = null;
                                        for (let k = 0; k < slice.length; k++) {
                                            const s = slice[k];
                                            const so = typeof s.open === 'number' ? s.open : NaN;
                                            const sh = typeof s.high === 'number' ? s.high : NaN;
                                            const sl = typeof s.low === 'number' ? s.low : NaN;
                                            const openS = isFinite(so);
                                            const highS = isFinite(sh);
                                            const lowS = isFinite(sl);
                                            if (highS) intraWorst = Math.max(intraWorst, sh);
                                            if (openS) intraWorst = Math.max(intraWorst, so);
                                            if (openS && so >= simSL) { resolved = 'LOSS'; break; }
                                            if (openS && so <= simTP) { resolved = 'WIN'; break; }
                                            const slHit = highS && sh >= simSL;
                                            const tpHit = lowS && sl <= simTP;
                                            if (slHit && tpHit) { resolved = 'LOSS'; break; }
                                            if (slHit) { resolved = 'LOSS'; break; }
                                            if (tpHit) { resolved = 'WIN'; break; }
                                        }
                                        if (resolved) {
                                            worst = intraWorst;
                                            outcome = resolved;
                                            exitIdx = j;
                                            intraResolved = true;
                                            break;
                                        }
                                    }
                                }
                            }
                            outcome = 'LOSS';
                            exitIdx = j;
                            break;
                        }
                        if (hitSL) { outcome = 'LOSS'; exitIdx = j; break; }
                        if (hitTP) { outcome = 'WIN'; exitIdx = j; break; }
                    }

                    if (duration > maxDurationLimit) break;
                }

                return { outcome, duration, worst, entryEff, exitIdx, intraResolved, ambiguousHit };
            };

            const wilsonLowerBound = (wins, losses, z = 1.96) => {
                const n = wins + losses;
                if (n <= 0) return null;
                const phat = wins / n;
                const denom = 1 + (z * z) / n;
                const centre = phat + (z * z) / (2 * n);
                const adj = z * Math.sqrt((phat * (1 - phat) + (z * z) / (4 * n)) / n);
                const lower = (centre - adj) / denom;
                return Math.max(0, Math.min(1, lower));
            };
            const erf = (x) => {
                const sign = x >= 0 ? 1 : -1;
                const absX = Math.abs(x);
                const a1 = 0.254829592;
                const a2 = -0.284496736;
                const a3 = 1.421413741;
                const a4 = -1.453152027;
                const a5 = 1.061405429;
                const p = 0.3275911;
                const t = 1 / (1 + p * absX);
                const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t) * Math.exp(-absX * absX);
                return sign * y;
            };
            const normalCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

            let matches = 0;
            let wins = 0;
            let losses = 0;
            let totalDuration = 0;
            let minDuration = Infinity;
            let maxDurationWin = 0;
            const durationList = [];
            const pnlList = [];
            let totalMae = 0;
            let maxMae = 0;
            let totalVolAll = 0;
            let totalVolWins = 0;
            let totalBpAll = 0;
            let totalBpWins = 0;

            let htfAligned = 0;
            let htfOpposed = 0;
            let htfUnknown = 0;
            let htfFilteredOut = 0;
            let htfHighRisk = 0;

            let ltfAmbiguous = 0;
            let ltfResolved = 0;

            let totalConfluenceScore = 0;

            for (let i = iStart; i < iEndExclusive; i++) {
                const c = data[i];
                if (!c) continue;

                let currentScore = 0;
                let maxPossibleScore = 0;

                if (useRsi) {
                    maxPossibleScore += FILTER_WEIGHTS.RSI;
                    let pass = true;
                    if (c.rsi == null || !isFinite(c.rsi)) pass = false;
                    else if (Math.abs(c.rsi - target.rsi) > rsiTol) pass = false;
                    if (pass) currentScore += FILTER_WEIGHTS.RSI;
                }

                if (useTrend) {
                    maxPossibleScore += FILTER_WEIGHTS.HTF;
                    let pass = true;
                    if (c.sma200 == null || !isFinite(c.sma200) || c.close == null || !isFinite(c.close)) pass = false;
                    else {
                        const trend = c.close >= c.sma200 ? 'ABOVE' : 'BELOW';
                        if (trend !== trendCond) pass = false;
                    }
                    if (pass) currentScore += FILTER_WEIGHTS.HTF;
                }

                if (useTime) {
                    maxPossibleScore += FILTER_WEIGHTS.TIME;
                    let pass = true;
                    const hour = getHour(c);
                    if (hour == null) pass = false;
                    else {
                        const targetHour = getHour(target);
                        if (targetHour == null || Math.abs(hour - targetHour) > 2) pass = false;
                    }
                    if (pass) currentScore += FILTER_WEIGHTS.TIME;
                }

                if (useVolBody) {
                    maxPossibleScore += FILTER_WEIGHTS.OTHER;
                    let pass = true;
                    if (c.bodySizePct == null || !isFinite(c.bodySizePct)) pass = false;
                    else if (Math.abs(c.bodySizePct - target.bodySizePct) > 0.5) pass = false;
                    if (pass) currentScore += FILTER_WEIGHTS.OTHER;
                }

                if (useVol) {
                    maxPossibleScore += FILTER_WEIGHTS.VOL;
                    let pass = true;
                    if (c.volume == null || !isFinite(c.volume)) pass = false;
                    else {
                        const low = target.volume * (1 - volTol / 100);
                        const high = target.volume * (1 + volTol / 100);
                        if (c.volume < low || c.volume > high) pass = false;
                    }
                    if (pass) currentScore += FILTER_WEIGHTS.VOL;
                }

                if (useBp) {
                    maxPossibleScore += FILTER_WEIGHTS.VOL;
                    let pass = true;
                    if (c.buyPressurePct == null || !isFinite(c.buyPressurePct)) pass = false;
                    else if (Math.abs(c.buyPressurePct - target.buyPressurePct) > bpTol) pass = false;
                    if (pass) currentScore += FILTER_WEIGHTS.VOL;
                }

                if (useDelta) {
                    maxPossibleScore += FILTER_WEIGHTS.VOL;
                    let pass = true;
                    if (c.delta == null || !isFinite(c.delta)) pass = false;
                    else if (Math.sign(target.delta) !== Math.sign(c.delta)) pass = false;
                    if (pass) currentScore += FILTER_WEIGHTS.VOL;
                }

                if (useAdr) {
                    maxPossibleScore += FILTER_WEIGHTS.OTHER;
                    let pass = true;
                    if (c.adrFilledPct != null && c.adrFilledPct > 100) {
                        pass = false;
                    }
                    if (pass) currentScore += FILTER_WEIGHTS.OTHER;
                }

                if (useRegime) {
                    maxPossibleScore += FILTER_WEIGHTS.OTHER;
                    let pass = true;
                    if (target.adx != null && isFinite(target.adx) && c.adx != null && isFinite(c.adx)) {
                        const isTargetTrend = target.adx >= adxThresh;
                        const isCandleTrend = c.adx >= adxThresh;

                        if (isTargetTrend && !isCandleTrend) {
                            pass = false;
                        } else if (!isTargetTrend && isCandleTrend) {
                            pass = false;
                        }
                    }
                    if (pass) currentScore += FILTER_WEIGHTS.OTHER;
                }

                let isHighRisk = false;
                if (useHtf) {
                    maxPossibleScore += FILTER_WEIGHTS.HTF;
                    let pass = false;
                    const tMs = c.datetime instanceof Date ? c.datetime.getTime() : null;
                    
                    if (tMs == null) {
                        htfUnknown++;
                        isHighRisk = true;
                    } else {
                        const htfC = getHtfCandleAtMs(tMs);
                        if (!htfC || htfC.sma200 == null || !isFinite(htfC.sma200) || htfC.close == null || !isFinite(htfC.close)) {
                            htfUnknown++;
                            isHighRisk = true;
                        } else {
                            const macroDir = htfC.close >= htfC.sma200 ? 'LONG' : 'SHORT';
                            if (macroDir === tradeParamsInner.tradeType) {
                                htfAligned++;
                                pass = true;
                            } else {
                                htfOpposed++;
                                isHighRisk = true;
                            }
                        }
                    }
                    
                    if (pass) currentScore += FILTER_WEIGHTS.HTF;
                }

                let finalScore = 0;
                if (maxPossibleScore > 0) {
                    finalScore = (currentScore / maxPossibleScore) * 100;
                } else {
                    finalScore = 0;
                }

                if (maxPossibleScore > 0 && finalScore < minScore) continue;

                matches++;
                totalConfluenceScore += finalScore;

                const vol = c.volume;
                if (vol != null && isFinite(vol)) totalVolAll += vol;
                const bp = c.buyPressurePct;
                if (bp != null && isFinite(bp)) totalBpAll += bp;

                const sim = simulateTrade(i);
                if (sim.ambiguousHit) ltfAmbiguous++;
                if (sim.intraResolved) ltfResolved++;
                if (sim.outcome === 'WIN') {
                    wins++;
                    pnlList.push(tpDist);
                    totalDuration += sim.duration;
                    durationList.push(sim.duration);
                    if (sim.duration < minDuration) minDuration = sim.duration;
                    if (sim.duration > maxDurationWin) maxDurationWin = sim.duration;
                    const mae = tradeParamsInner.tradeType === 'LONG' ? (sim.entryEff - sim.worst) / sim.entryEff : (sim.worst - sim.entryEff) / sim.entryEff;
                    const maeClamped = Math.max(0, isFinite(mae) ? mae : 0);
                    totalMae += maeClamped;
                    maxMae = Math.max(maxMae, maeClamped);
                    if (vol != null && isFinite(vol)) totalVolWins += vol;
                    if (bp != null && isFinite(bp)) totalBpWins += bp;
                } else if (sim.outcome === 'LOSS') {
                    losses++;
                    pnlList.push(-riskDist);
                }

                if (useCooldown && sim.exitIdx != null && sim.exitIdx > i) {
                    i = Math.min(sim.exitIdx, iEndExclusive - 1);
                }
            }

            if (matches === 0) return { error: 'No hay coincidencias' };

            const closedTrades = wins + losses;
            if (closedTrades === 0) return { error: 'Sin datos (0 operaciones cerradas en el histórico disponible).', matches, wins, losses };

            const winRateNum = (wins / closedTrades) * 100;
            const winRateDecimal = wins / closedTrades;
            const ratioRR = tpDist > 0 && riskDist > 0 ? (tpDist / riskDist) : null;
            const breakEvenWinRate = ratioRR != null ? (1 / (1 + ratioRR)) : null;
            const standardError = breakEvenWinRate != null
                ? Math.sqrt((breakEvenWinRate * (1 - breakEvenWinRate)) / closedTrades)
                : null;
            const zScore = standardError != null && standardError > 0
                ? (winRateDecimal - breakEvenWinRate) / standardError
                : null;
            const falsePositiveProb = zScore != null && isFinite(zScore)
                ? ((1 - normalCdf(zScore)) * 100).toFixed(1)
                : null;
            const wilson = wilsonLowerBound(wins, losses);
            const wilsonLower95 = wilson != null ? (wilson * 100).toFixed(1) : null;
            const painRatio = riskDist > 0 ? (((wins > 0 ? (totalMae / wins) : 0) / riskDist) * 100) : null;

            const sortedDurations = durationList.slice().sort((a, b) => a - b);
            const medianDuration = sortedDurations.length > 0
                ? (sortedDurations.length % 2 === 1
                    ? sortedDurations[Math.floor(sortedDurations.length / 2)]
                    : Math.round((sortedDurations[sortedDurations.length / 2 - 1] + sortedDurations[sortedDurations.length / 2]) / 2))
                : 0;
            const p80Index = Math.ceil(sortedDurations.length * 0.8) - 1;
            const p80Duration = sortedDurations.length > 0 ? sortedDurations[Math.max(0, p80Index)] : 0;

            const durationDistribution = {};
            for (let d = 0; d < durationList.length; d++) {
                const dur = durationList[d];
                durationDistribution[dur] = (durationDistribution[dur] || 0) + 1;
            }

            let expectancy = null;
            let sqn = null;
            let sqnNormalized = null;
            let sqnClassification = null;

            if (pnlList.length >= 5) {
                const sumPnl = pnlList.reduce((acc, v) => acc + v, 0);
                const meanPnl = sumPnl / pnlList.length;
                expectancy = meanPnl * 100;

                const squaredDiffs = pnlList.map(v => Math.pow(v - meanPnl, 2));
                const avgSquaredDiff = squaredDiffs.reduce((acc, v) => acc + v, 0) / pnlList.length;
                const stdDev = Math.sqrt(avgSquaredDiff);

                if (stdDev > 0) {
                    sqn = (meanPnl / stdDev) * Math.sqrt(pnlList.length);
                    sqnNormalized = (meanPnl / stdDev) * Math.sqrt(100);
                    if (sqn < 1.6) sqnClassification = 'POOR';
                    else if (sqn < 2.0) sqnClassification = 'AVERAGE';
                    else if (sqn < 2.5) sqnClassification = 'GOOD';
                    else if (sqn < 3.0) sqnClassification = 'EXCELLENT';
                    else sqnClassification = 'SUPERB';
                }
            }

            const avgConfluenceScore = matches > 0 ? (totalConfluenceScore / matches) : 0;
            let qualityClassification = 'N/A';
            if (matches > 0) {
                if (avgConfluenceScore >= 90) qualityClassification = 'A+ (Premium)';
                else if (avgConfluenceScore >= 80) qualityClassification = 'A (High Quality)';
                else if (avgConfluenceScore >= 70) qualityClassification = 'B (Standard)';
                else if (avgConfluenceScore === 0) qualityClassification = 'Base (Sin Filtros)';
                else qualityClassification = 'C (Low Quality)';
            }

            return {
                matches,
                closedTrades,
                winRate: winRateNum.toFixed(1),
                winRateNum,
                wilsonLower95,
                falsePositiveProb,
                wins,
                losses,
                avgConfluenceScore: avgConfluenceScore.toFixed(1),
                qualityClassification,
                expectancy: expectancy != null ? expectancy.toFixed(3) : null,
                sqn: sqn != null ? sqn.toFixed(2) : null,
                sqnNormalized: sqnNormalized != null ? sqnNormalized.toFixed(2) : null,
                sqnClassification,
                avgDuration: wins > 0 ? Math.round(totalDuration / wins) : 0,
                minDuration: wins > 0 ? minDuration : 0,
                maxDuration: wins > 0 ? maxDurationWin : 0,
                medianDuration,
                p80Duration,
                durationDistribution,
                temporalEfficiency: expectancy != null && wins > 0 && totalDuration > 0
                    ? (expectancy / (totalDuration / wins)).toFixed(4)
                    : null,
                avgMae: wins > 0 ? ((totalMae / wins) * 100).toFixed(2) : 0,
                maxMae: (maxMae * 100).toFixed(2),
                painRatio: painRatio != null ? painRatio.toFixed(1) : null,
                riskDistPercent: (riskDist * 100).toFixed(2),
                weightedWinRateVolume: totalVolAll > 0 ? ((totalVolWins / totalVolAll) * 100).toFixed(1) : null,
                weightedWinRateBuyPressure: totalBpAll > 0 ? ((totalBpWins / totalBpAll) * 100).toFixed(1) : null,
                pnlList,
                htfAligned,
                htfOpposed,
                htfUnknown,
                htfFilteredOut,
                htfHighRisk,
                ltfAmbiguous,
                ltfResolved
            };
        };

        const SENSITIVITY_TIERS = [
            { key: 'NORMAL', label: '[BASE]', factor: 1.0 },
            { key: 'LOOSE', label: '[LAXO]', factor: 1.2 }
        ];

        const computeTieredValues = (tierFactor) => ({
            rsiTol: Math.max(1, Math.round(rsiTolerance * tierFactor)),
            volTol: Math.max(5, Math.round(volumeTolerance * tierFactor)),
            bpTol: Math.max(1, Math.round(bpTolerance * tierFactor))
        });

        const toggleableFilters = [
            { key: 'useRsi', label: 'RSI' },
            { key: 'useTrend', label: 'Tendencia' },
            { key: 'useTime', label: 'Horario' },
            { key: 'useVolBody', label: 'Volatilidad' },
            { key: 'useAdr', label: 'ADR' }
        ];

        if (hasExtended) {
            toggleableFilters.push({ key: 'useVol', label: 'Volumen' });
            toggleableFilters.push({ key: 'useBp', label: 'Presión Compra' });
            toggleableFilters.push({ key: 'useDelta', label: 'Delta' });
        }

        if (htfData && htfData.length) {
            toggleableFilters.push({ key: 'useHtf', label: 'HTF' });
            toggleableFilters.push({ key: 'requireHtf', label: 'HTF Req' });
        }

        if (ltfData && ltfData.length && tfMinutes) {
            toggleableFilters.push({ key: 'useLtfIntra', label: 'LTF Intra' });
        }

        toggleableFilters.push({ key: 'useRegime', label: 'Régimen' });

        const combinations = [];
        const totalCombs = 1 << toggleableFilters.length;
        const signatureGroups = new Map();
        let robustCount = 0;
        let processed = 0;
        let lastPercent = -1;

        const totalCombBase = Math.max(1, totalCombs - 1);

        for (let i = 1; i < totalCombs; i++) {
            if (cancelRequested) {
                self.postMessage({ type: 'cancelled' });
                return;
            }

            processed++;
            if (processed % 64 === 0 || processed === totalCombBase) {
                const percent = Math.min(99, Math.floor((processed / totalCombBase) * 100));
                if (percent !== lastPercent) {
                    lastPercent = percent;
                    self.postMessage({
                        type: 'progress',
                        payload: {
                            percent,
                            processed,
                            total: totalCombBase,
                            stage: 'Evaluando combinaciones'
                        }
                    });
                }
            }

            for (let t = 0; t < SENSITIVITY_TIERS.length; t++) {
                const tier = SENSITIVITY_TIERS[t];
                const tieredValues = computeTieredValues(tier.factor);

                const currentConfig = {
                    useRsi: false, rsiTol: tieredValues.rsiTol,
                    useTrend: false, trendCond: trendCondition,
                    useTime: false, timeMode,
                    useVolBody: false,
                    useVol: false, volTol: tieredValues.volTol,
                    useBp: false, bpTol: tieredValues.bpTol,
                    useDelta: false,
                    useCooldown: !!forceCooldown,
                    useAdr: false,
                    useHtf: false,
                    htfMode,
                    requireHtf: false,
                    useLtfIntra: false,
                    useRegime: false,
                    adxThreshold,
                    tier: tier.key,
                    tierLabel: tier.label
                };

                const activeLabels = [];
                let activeCount = 0;

                for (let j = 0; j < toggleableFilters.length; j++) {
                    if ((i >> j) & 1) {
                        currentConfig[toggleableFilters[j].key] = true;
                        activeLabels.push(toggleableFilters[j].label);
                        activeCount++;
                    }
                }

                if (activeCount === 0) continue;

                const boolSignature = toggleableFilters
                    .map(f => currentConfig[f.key] ? '1' : '0')
                    .join('');

                const modeVariants = (currentConfig.useHtf && htfData && htfData.length) ? ['DISCARD', 'MARK'] : [htfMode];

                for (let mv = 0; mv < modeVariants.length; mv++) {
                    const cfg = {
                        ...currentConfig,
                        htfMode: modeVariants[mv]
                    };

                    const labels = [...activeLabels];
                    if (cfg.useHtf) labels.push(`HTF:${cfg.htfMode}`);
                    if (cfg.useRegime) labels.push('REG:AUTO');

                    const result = calculateBacktest(csvData, selectedCandleIndex, tradeParams, cfg);

                    if (!result.error && result.matches >= 5) {
                        const sig = boolSignature + '_' + cfg.htfMode;
                        const comb = {
                            config: cfg,
                            labels,
                            stats: result,
                            tier: tier.key,
                            tierLabel: tier.label,
                            boolSignature: sig
                        };
                        combinations.push(comb);

                        if (!signatureGroups.has(sig)) {
                            signatureGroups.set(sig, []);
                        }
                        signatureGroups.get(sig).push(comb);

                        const group = signatureGroups.get(sig);
                        if (group.length === 2) {
                            const tiers = new Set(group.map(g => g.tier));
                            if (tiers.size === 2 && group.every(g => g.stats.winRateNum >= 50)) {
                                const normalResult = group.find(g => g.tier === 'NORMAL');
                                if (normalResult && !normalResult.isRobust) {
                                    normalResult.isRobust = true;
                                    normalResult.robustnessScore = group.reduce((acc, g) => acc + g.stats.winRateNum, 0) / 2;
                                    robustCount++;
                                }
                            }
                        }
                    }
                }
            }

            if (robustCount >= 8) break;
        }

        for (const [sig, group] of signatureGroups) {
            const tiers = new Set(group.map(g => g.tier));
            if (tiers.size === 1 && !group[0].isRobust) {
                const onlyTier = [...tiers][0];
                for (const item of group) {
                    item.isSpeculative = true;
                    item.speculativeType = onlyTier;
                }
            }
        }

        const getWinRateNum = (item) => {
            if (item && item.stats && item.stats.winRateNum != null) return item.stats.winRateNum;
            if (item && item.stats && item.stats.winRate != null) return parseFloat(item.stats.winRate) || 0;
            return 0;
        };

        const getSqnScore = (item) => {
            if (!item || !item.stats) return 0;
            if (item.stats.sqnNormalized != null) return parseFloat(item.stats.sqnNormalized) || 0;
            if (item.stats.sqn != null) return parseFloat(item.stats.sqn) || 0;
            return 0;
        };

        const standardSort = (a, b) => {
            if (a.isRobust && !b.isRobust) return -1;
            if (!a.isRobust && b.isRobust) return 1;
            if (a.isSpeculative && a.speculativeType === 'LOOSE' && !(b.isSpeculative && b.speculativeType === 'LOOSE')) return 1;
            if (b.isSpeculative && b.speculativeType === 'LOOSE' && !(a.isSpeculative && a.speculativeType === 'LOOSE')) return -1;
            if (Math.abs(b.stats.matches - a.stats.matches) > 50) {
                return b.stats.matches - a.stats.matches;
            }
            if (getWinRateNum(b) !== getWinRateNum(a)) return getWinRateNum(b) - getWinRateNum(a);
            return b.stats.matches - a.stats.matches;
        };

        const winRateSort = (a, b) => {
            if (getWinRateNum(b) !== getWinRateNum(a)) return getWinRateNum(b) - getWinRateNum(a);
            return b.stats.matches - a.stats.matches;
        };

        const edgeSort = (a, b) => {
            if (a.isRobust && !b.isRobust) return -1;
            if (!a.isRobust && b.isRobust) return 1;
            if (getSqnScore(b) !== getSqnScore(a)) return getSqnScore(b) - getSqnScore(a);
            if (getWinRateNum(b) !== getWinRateNum(a)) return getWinRateNum(b) - getWinRateNum(a);
            return b.stats.matches - a.stats.matches;
        };

        const seenSignatures = new Set();
        const uniqueResults = [];

        for (const comb of combinations) {
            if (comb.isRobust && !seenSignatures.has(comb.boolSignature)) {
                uniqueResults.push(comb);
                seenSignatures.add(comb.boolSignature);
            }
        }

        for (const comb of combinations) {
            if (!seenSignatures.has(comb.boolSignature)) {
                uniqueResults.push(comb);
                seenSignatures.add(comb.boolSignature);
            }
        }

        let sortedResults = [...uniqueResults];
        if (mode === 'WINRATE') sortedResults.sort(winRateSort);
        else if (mode === 'EDGE') sortedResults.sort(edgeSort);
        else sortedResults.sort(standardSort);

        if (mode === 'CUSTOM') {
            const minTradesRaw = customCriteria && customCriteria.minTrades != null ? Number(customCriteria.minTrades) : 30;
            const minTrades = isFinite(minTradesRaw) ? Math.max(5, Math.floor(minTradesRaw)) : 30;
            const minWinRateRaw = customCriteria && customCriteria.minWinRate != null ? Number(customCriteria.minWinRate) : 0;
            const minWinRate = isFinite(minWinRateRaw) ? Math.min(100, Math.max(0, minWinRateRaw)) : 0;
            const robustOnly = !!(customCriteria && customCriteria.robustOnly);
            sortedResults = sortedResults.filter((item) => {
                if (!item || !item.stats) return false;
                if (item.stats.matches < minTrades) return false;
                if (getWinRateNum(item) < minWinRate) return false;
                if (robustOnly && !item.isRobust) return false;
                return true;
            });
        }

        let finalResults = sortedResults.slice(0, 5);

        if (mode === 'STANDARD') {
            const bestHighSampleRobust = sortedResults.reduce((best, current) => {
                if (current.isRobust) {
                    if (!best || current.stats.matches > best.stats.matches) {
                        return current;
                    }
                }
                return best;
            }, null);

            if (bestHighSampleRobust && !finalResults.some(r => r.boolSignature === bestHighSampleRobust.boolSignature)) {
                if (finalResults.length === 5) {
                    finalResults[4] = bestHighSampleRobust;
                } else {
                    finalResults.push(bestHighSampleRobust);
                }
            }
        }

        self.postMessage({
            type: 'progress',
            payload: {
                percent: 100,
                processed: totalCombBase,
                total: totalCombBase,
                stage: 'Finalizando'
            }
        });

        self.postMessage({ type: 'done', payload: { results: finalResults } });
    } catch (e) {
        self.postMessage({ type: 'error', payload: { message: e && e.message ? e.message : 'Error en optimización.' } });
    }
};

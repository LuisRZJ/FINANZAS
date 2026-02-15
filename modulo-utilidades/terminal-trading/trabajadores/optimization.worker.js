
let cancelRequested = false;

// --- Constants & Helpers ---

const FILTER_WEIGHTS = {
    HTF: 30,
    VOL: 25,
    CRT: 20,
    RSI: 15,
    TIME: 15,
    OTHER: 15
};

const SENSITIVITY_TIERS = [
    { key: 'TIGHT', label: '[ESTRICTO]', factor: 0.8 },
    { key: 'NORMAL', label: '[BASE]', factor: 1.0 },
    { key: 'LOOSE', label: '[LAXO]', factor: 1.2 }
];

// Maps filter keys to their weight category values
const getFilterWeight = (key) => {
    switch (key) {
        case 'useRsi': return FILTER_WEIGHTS.RSI;
        case 'useTrend': return FILTER_WEIGHTS.HTF;
        case 'useTime': return FILTER_WEIGHTS.TIME;
        case 'useVolBody': return FILTER_WEIGHTS.OTHER;
        case 'useCrt': return FILTER_WEIGHTS.CRT;
        case 'useWick': return FILTER_WEIGHTS.OTHER;
        case 'useVol': return FILTER_WEIGHTS.VOL;
        case 'useBp': return FILTER_WEIGHTS.VOL;
        case 'useDelta': return FILTER_WEIGHTS.VOL;
        case 'useAdr': return FILTER_WEIGHTS.OTHER;
        case 'useRegime': return FILTER_WEIGHTS.OTHER;
        case 'useHtf': return FILTER_WEIGHTS.HTF;
        default: return 0; // requireHtf, useLtfIntra, etc.
    }
};

const getTime = (dt) => {
    if (dt instanceof Date) return dt.getTime();
    if (typeof dt === 'string' || typeof dt === 'number') {
        const d = new Date(dt);
        return isNaN(d.getTime()) ? null : d.getTime();
    }
    return null;
};

// Binary search for time alignment
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

const buildIndex = (data) => {
    const times = [];
    const rows = [];
    for (let i = 0; i < data.length; i++) {
        const x = data[i];
        if (!x) continue;
        const t = getTime(x.datetime);
        if (t == null) continue;
        times.push(t);
        rows.push(x);
    }
    return { times, rows };
};

// Statistical helpers
const wilsonLowerBound = (wins, losses, z = 1.96) => {
    const n = wins + losses;
    if (n <= 0) return 0;
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
    const t = 1 / (1 + 0.3275911 * absX);
    const y = 1 - (((((1.061405429 * t - 1.453152027) * t + 1.421413741) * t - 0.284496736) * t + 0.254829592) * t) * Math.exp(-absX * absX);
    return sign * y;
};
const normalCdf = (x) => 0.5 * (1 + erf(x / Math.SQRT2));

// --- Main Worker Logic ---

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
            wickTolerance,
            trendCondition,
            timeMode,
            htfMode,
            adxThreshold,
            tfMinutes,
            htfTfMinutes,
            hasExtended,
            customCriteria,
            forceCooldown,
            useMacroMode,
            useCooldownFilter
        } = payload;

        if (!Array.isArray(csvData) || !csvData.length) {
            self.postMessage({ type: 'error', payload: { message: 'Sin datos para optimizar.' } });
            return;
        }

        const target = csvData[selectedCandleIndex];
        if (!target) {
            self.postMessage({ type: 'error', payload: { message: 'Vela objetivo no encontrada.' } });
            return;
        }

        // 1. Setup Filters and Bits
        const toggleableFilters = [
            { key: 'useRsi', label: 'RSI' },
            { key: 'useTrend', label: 'Tendencia' },
            { key: 'useTime', label: 'Horario' },
            { key: 'useVolBody', label: 'Volatilidad' },
            { key: 'useCrt', label: 'CRT' },
            { key: 'useWick', label: 'Mechas' },
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

        // Map filter key to bit index
        const filterBitMap = {};
        toggleableFilters.forEach((f, i) => {
            filterBitMap[f.key] = i;
        });
        const TOTAL_BITS = toggleableFilters.length;
        
        // Pre-calculate Weight Lookup Table (O(2^N))
        // weightTable[mask] = sum of weights for active bits in mask
        const weightTable = new Int16Array(1 << TOTAL_BITS);
        for (let i = 0; i < weightTable.length; i++) {
            let w = 0;
            for (let j = 0; j < TOTAL_BITS; j++) {
                if ((i >> j) & 1) {
                    w += getFilterWeight(toggleableFilters[j].key);
                }
            }
            weightTable[i] = w;
        }

        // 2. Pre-calculation Phase (O(N))
        // Prepare indices
        const htfIndex = (htfData && htfData.length) ? buildIndex(htfData) : null;
        const ltfIndex = (ltfData && ltfData.length) ? buildIndex(ltfData) : null;

        // Trade simulation constants
        const epBase = Number(tradeParams.entryPrice);
        const slBase = Number(tradeParams.stopLoss);
        const tpBase = Number(tradeParams.takeProfit);
        const spreadAbs = Math.max(0, Number(tradeParams.spread) || 0);
        const spreadHalf = spreadAbs / 2;
        
        const isLong = tradeParams.tradeType === 'LONG';
        const baseLevels = isLong
            ? { entry: epBase + spreadHalf, sl: slBase + spreadHalf, tp: tpBase - spreadHalf }
            : { entry: epBase - spreadHalf, sl: slBase - spreadHalf, tp: tpBase + spreadHalf };
        const riskDist = Math.abs((baseLevels.entry - baseLevels.sl) / baseLevels.entry);
        const tpDist = Math.abs((baseLevels.tp - baseLevels.entry) / baseLevels.entry);

        // Limits
        const maxDurationLimit = useMacroMode ? 5000 : 500;
        const minIndexInclusive = 200;
        const maxIndexExclusive = Math.max(minIndexInclusive, selectedCandleIndex);
        
        // Pre-calc Storage
        const N = csvData.length;
        const preCalcResults = new Array(N);
        const preCalcMasks = {
            TIGHT: new Int32Array(N),
            NORMAL: new Int32Array(N),
            LOOSE: new Int32Array(N)
        };

        // Helper for HTF
        const getHtfCandleAtMs = (tMs) => {
            if (!htfIndex || !htfIndex.times.length) return null;
            const pos = lowerBound(htfIndex.times, tMs) - 1;
            if (pos < 0) return null;
            const c = htfIndex.rows[pos];
            if (!c) return null;
            const tf = htfTfMinutes;
            if (!tf) return null;
            // Check validity period
            const startMs = new Date(c.datetime).getTime();
            if (tMs < startMs || tMs >= startMs + tf * 60000) return null;
            return c;
        };

        // Helper for LTF
        const getLtfSlice = (startMs, endMs) => {
            if (!ltfIndex || !ltfIndex.times.length) return null;
            const startPos = lowerBound(ltfIndex.times, startMs);
            if (startPos >= ltfIndex.times.length) return null;
            // Simple slice not optimal for huge arrays, but okay for limited range
            // Optimizing: just find end pos
            let endPos = startPos;
            while(endPos < ltfIndex.times.length && ltfIndex.times[endPos] < endMs) {
                endPos++;
            }
            return ltfIndex.rows.slice(startPos, endPos);
        };

        const targetHour = (timeMode === 'UTC') ? target.hourUtc : target.hourLocal;

        // Loop all candles
        for (let i = minIndexInclusive; i < maxIndexExclusive; i++) {
            const c = csvData[i];
            if (!c) continue;

            // --- A. Trade Simulation ---
            // Simulate outcome ONCE. 
            // We need to know:
            // 1. Outcome (WIN/LOSS/TIMEOUT)
            // 2. Duration
            // 3. Worst excursion (for MAE)
            // 4. Exit Index (for Cooldown)
            // 5. Ambiguous? (High > TP and Low < SL)
            // 6. Intra Outcome (if Ambiguous and LTF available)

            const startMid = c.close;
            if (!isFinite(startMid)) continue;
            const entryEff = isLong ? (startMid + spreadHalf) : (startMid - spreadHalf);
            const simSL = isLong ? entryEff * (1 - riskDist) : entryEff * (1 + riskDist);
            const simTP = isLong ? entryEff * (1 + tpDist) : entryEff * (1 - tpDist);

            let outcome = 'TIMEOUT';
            let duration = 0;
            let worst = entryEff;
            let exitIdx = null;
            let ambiguousHit = false;
            let intraResolvedOutcome = null; // WIN or LOSS if resolved

            const jMax = Math.min(csvData.length, i + maxDurationLimit + 1);
            
            for (let j = i + 1; j < jMax; j++) {
                duration++;
                const fut = csvData[j];
                const o = fut.open;
                const h = fut.high;
                const l = fut.low;
                
                if (isLong) {
                    worst = Math.min(worst, l);
                    worst = Math.min(worst, o);
                    
                    if (o <= simSL) { outcome = 'LOSS'; exitIdx = j; break; }
                    if (o >= simTP) { outcome = 'WIN'; exitIdx = j; break; }
                    
                    const hitSL = l <= simSL;
                    const hitTP = h >= simTP;
                    
                    if (hitSL && hitTP) {
                        ambiguousHit = true;
                        exitIdx = j;
                        outcome = 'LOSS'; // Default to LOSS if unresolved
                        break;
                    }
                    if (hitSL) { outcome = 'LOSS'; exitIdx = j; break; }
                    if (hitTP) { outcome = 'WIN'; exitIdx = j; break; }
                } else {
                    worst = Math.max(worst, h);
                    worst = Math.max(worst, o);

                    if (o >= simSL) { outcome = 'LOSS'; exitIdx = j; break; }
                    if (o <= simTP) { outcome = 'WIN'; exitIdx = j; break; }

                    const hitSL = h >= simSL;
                    const hitTP = l <= simTP;

                    if (hitSL && hitTP) {
                        ambiguousHit = true;
                        exitIdx = j;
                        outcome = 'LOSS'; // Default
                        break;
                    }
                    if (hitSL) { outcome = 'LOSS'; exitIdx = j; break; }
                    if (hitTP) { outcome = 'WIN'; exitIdx = j; break; }
                }
            }

            // Resolve Ambiguous with LTF if needed (Pre-calculate resolution)
            if (ambiguousHit && ltfData && ltfData.length && tfMinutes) {
                const fut = csvData[exitIdx];
                const startMs = new Date(fut.datetime).getTime();
                const slice = getLtfSlice(startMs, startMs + tfMinutes * 60000);
                if (slice && slice.length) {
                    let intraWorst = worst;
                    for (let k = 0; k < slice.length; k++) {
                        const s = slice[k];
                        if (isLong) {
                            intraWorst = Math.min(intraWorst, s.low, s.open);
                            if (s.open <= simSL) { intraResolvedOutcome = 'LOSS'; break; }
                            if (s.open >= simTP) { intraResolvedOutcome = 'WIN'; break; }
                            const slHit = s.low <= simSL;
                            const tpHit = s.high >= simTP;
                            if (slHit) { intraResolvedOutcome = 'LOSS'; break; } // Priority to SL in conflict inside LTF
                            if (tpHit) { intraResolvedOutcome = 'WIN'; break; }
                        } else {
                            intraWorst = Math.max(intraWorst, s.high, s.open);
                            if (s.open >= simSL) { intraResolvedOutcome = 'LOSS'; break; }
                            if (s.open <= simTP) { intraResolvedOutcome = 'WIN'; break; }
                            const slHit = s.high >= simSL;
                            const tpHit = s.low <= simTP;
                            if (slHit) { intraResolvedOutcome = 'LOSS'; break; }
                            if (tpHit) { intraResolvedOutcome = 'WIN'; break; }
                        }
                    }
                    if (intraResolvedOutcome) {
                        worst = intraWorst; // Update worst if resolved
                    }
                }
            }

            // Calculate MAE
            const mae = isLong ? (entryEff - worst) / entryEff : (worst - entryEff) / entryEff;
            const maeClamped = Math.max(0, mae);

            // Store Result
            preCalcResults[i] = {
                outcome,
                intraResolvedOutcome,
                duration,
                exitIdx,
                mae: maeClamped,
                vol: c.volume,
                bp: c.buyPressurePct
            };

            // --- B. Bitmask Calculation ---
            // Calculate masks for all 3 tiers
            
            for (let t = 0; t < SENSITIVITY_TIERS.length; t++) {
                const tier = SENSITIVITY_TIERS[t];
                const factor = tier.factor;
                
                // Tolerances
                const rsiTol = Math.round(rsiTolerance * factor);
                const volTol = Math.round(volumeTolerance * factor);
                const bpTol = Math.round(bpTolerance * factor);
                const wickTol = Math.round((wickTolerance || 10) * factor);

                let mask = 0;

                // 0: RSI
                if (c.rsi != null && Math.abs(c.rsi - target.rsi) <= rsiTol) mask |= (1 << filterBitMap.useRsi);

                // 1: Trend
                if (c.sma200 != null && c.close != null) {
                    const trend = c.close >= c.sma200 ? 'ABOVE' : 'BELOW';
                    if (trend === trendCondition) mask |= (1 << filterBitMap.useTrend);
                }

                // 2: Time
                const h = (timeMode === 'UTC') ? c.hourUtc : c.hourLocal;
                if (h != null && targetHour != null) {
                    let diff = Math.abs(h - targetHour);
                    if (diff > 12) diff = 24 - diff;
                    if (diff <= 2) mask |= (1 << filterBitMap.useTime);
                }

                // 3: VolBody
                if (c.bodySizePct != null && target.bodySizePct != null) {
                    const targetVol = target.bodySizePct;
                    const currentVol = c.bodySizePct;
                    if (currentVol >= targetVol * 0.5 && currentVol <= targetVol * 1.5) {
                        mask |= (1 << filterBitMap.useVolBody);
                    }
                }

                // 4: CRT (Candle Range Theory)
                if (c.crtZone != null && target.crtZone != null && c.crtZone === target.crtZone) {
                    mask |= (1 << filterBitMap.useCrt);
                }

                // 5: Wick
                if (c.upperWickPct != null && c.lowerWickPct != null && 
                    Math.abs(c.upperWickPct - target.upperWickPct) <= wickTol &&
                    Math.abs(c.lowerWickPct - target.lowerWickPct) <= wickTol) mask |= (1 << filterBitMap.useWick);

                // 6: ADR
                if (c.adrFilledPct == null || c.adrFilledPct <= 100) mask |= (1 << filterBitMap.useAdr);

                // 6: Vol
                if (hasExtended && c.volume != null) {
                    const low = target.volume * (1 - volTol / 100);
                    const high = target.volume * (1 + volTol / 100);
                    if (c.volume >= low && c.volume <= high) mask |= (1 << filterBitMap.useVol);
                }

                // 7: BP
                if (hasExtended && c.buyPressurePct != null && Math.abs(c.buyPressurePct - target.buyPressurePct) <= bpTol) mask |= (1 << filterBitMap.useBp);

                // 8: Delta
                if (hasExtended && c.delta != null && Math.sign(target.delta) === Math.sign(c.delta)) mask |= (1 << filterBitMap.useDelta);

                // 9: HTF
                if (htfData && htfData.length) {
                    const tMs = new Date(c.datetime).getTime();
                    const htfC = getHtfCandleAtMs(tMs);
                    if (htfC && htfC.sma200 != null && htfC.close != null) {
                        const macroDir = htfC.close >= htfC.sma200 ? 'LONG' : 'SHORT';
                        if (macroDir === tradeParams.tradeType) mask |= (1 << filterBitMap.useHtf);
                    }
                }

                // 10: Regime
                if (target.adx != null && isFinite(target.adx) && c.adx != null && isFinite(c.adx)) {
                    const isTargetTrend = target.adx >= adxThreshold;
                    const isCandleTrend = c.adx >= adxThreshold;
                    if (isTargetTrend === isCandleTrend) mask |= (1 << filterBitMap.useRegime);
                } else {
                    mask |= (1 << filterBitMap.useRegime);
                }

                // 11: LtfIntra
                // This is a toggle, so it is always "Satisfied" as a criterion (it's not a filter, it's a mode).
                // But we use the bit to indicate the MODE is active.
                // However, for the purpose of "Does this candle match the criteria?", LTF Intra is not a criteria.
                // So we can leave it 0 or 1.
                // Actually, the Optimization Loop checks: (CandleMask & ActiveMask) === ActiveMask.
                // If LtfIntra is in ActiveMask, we MUST set it in CandleMask for it to pass.
                // Since LtfIntra is not a data filter but a mode, we should ALWAYS set it to 1 in the CandleMask
                // so that it never fails the check.
                if (filterBitMap.useLtfIntra !== undefined) {
                    mask |= (1 << filterBitMap.useLtfIntra);
                }
                
                // Same for requireHtf if it existed
                if (filterBitMap.requireHtf !== undefined) {
                     mask |= (1 << filterBitMap.requireHtf);
                }

                preCalcMasks[tier.key][i] = mask;
            }
        }

        // 3. Optimization Loop (O(M))
        const combinations = [];
        const totalCombs = 1 << TOTAL_BITS;
        const totalCombBase = Math.max(1, totalCombs - 1);
        
        let processed = 0;
        let lastPercent = -1;

        const signatureGroups = new Map();
        let robustCount = 0;

        // Bit index for LtfIntra
        const bitLtfIntra = filterBitMap.useLtfIntra;
        const hasLtfIntra = bitLtfIntra !== undefined;

        for (let i = 1; i < totalCombs; i++) {
            if (cancelRequested) {
                self.postMessage({ type: 'cancelled' });
                return;
            }

            // Progress
            if ((i & 63) === 0 || i === totalCombBase) { // Modulo 64 check optimization
                processed = i;
                const percent = Math.min(99, Math.floor((processed / totalCombBase) * 100));
                if (percent !== lastPercent) {
                    lastPercent = percent;
                    self.postMessage({
                        type: 'progress',
                        payload: {
                            percent,
                            processed,
                            total: totalCombBase,
                            stage: 'Evaluando combinaciones',
                            // Calculate simple ETA
                            eta: null // Main thread handles precise ETA now
                        }
                    });
                }
            }

            // Calculate Weight of this combination
            const activeWeight = weightTable[i];
            if (activeWeight === 0 && i !== 0) continue; // Should not happen if bits set

            // Check which filters are active
            const activeFilters = [];
            for (let b = 0; b < TOTAL_BITS; b++) {
                if ((i >> b) & 1) activeFilters.push(toggleableFilters[b]);
            }
            if (activeFilters.length === 0) continue;

            const useIntraForCombo = hasLtfIntra && ((i >> bitLtfIntra) & 1);
            const cooldownActive = !!(forceCooldown || useCooldownFilter);
            const minScore = 70;
            
            // Loop Tiers
            for (let t = 0; t < SENSITIVITY_TIERS.length; t++) {
                const tier = SENSITIVITY_TIERS[t];
                const candleMasks = preCalcMasks[tier.key];

                // --- Fast Scan ---
                let matches = 0;
                let wins = 0;
                let losses = 0;
                let totalDuration = 0;
                let minDuration = Infinity;
                let maxDurationWin = 0;
                let totalMae = 0;
                let maxMae = 0;
                let totalVolWins = 0;
                let totalBpWins = 0;
                let totalVolAll = 0;
                let totalBpAll = 0;
                let totalConfluenceScore = 0;
                
                const pnlList = [];
                const durationList = [];

                // Reconstruct HTF counts for reporting
                let htfAligned = 0, htfOpposed = 0, htfUnknown = 0, htfHighRisk = 0;
                const useHtfBit = filterBitMap.useHtf;
                const hasHtf = useHtfBit !== undefined && ((i >> useHtfBit) & 1);
                
                let nextAvailableIdx = 0;

                for (let cIdx = minIndexInclusive; cIdx < maxIndexExclusive; cIdx++) {
                    if (cIdx < nextAvailableIdx) continue;

                    const cMask = candleMasks[cIdx];
                    const res = preCalcResults[cIdx];
                    if (!res) continue; // Should not happen

                    const matchMask = cMask & i;
                    const matchWeight = weightTable[matchMask];
                    const score = activeWeight > 0 ? (matchWeight / activeWeight) * 100 : 0;
                    if (activeWeight > 0 && score < minScore) continue;

                    // Passed!
                    matches++;
                    totalConfluenceScore += score;
                    
                    if (res.vol) totalVolAll += res.vol;
                    if (res.bp) totalBpAll += res.bp;

                    if (hasHtf) {
                        // If HTF bit is set in cMask, it is aligned.
                        // If not set, it is opposed/unknown.
                        if ((cMask >> useHtfBit) & 1) htfAligned++;
                        else {
                             htfOpposed++; // Simplified tracking
                             htfHighRisk++;
                        }
                    }

                    // Determine Outcome
                    let finalOutcome = res.outcome;
                    
                    if (useIntraForCombo) {
                         if (res.intraResolvedOutcome) finalOutcome = res.intraResolvedOutcome;
                         else if (res.outcome === 'LOSS' && res.exitIdx) {
                             // Was it ambiguous?
                             // Our pre-calc stored intraResolvedOutcome ONLY if ambiguous.
                             // If it was standard LOSS, it stays LOSS.
                         }
                    }

                    if (finalOutcome === 'WIN') {
                        wins++;
                        pnlList.push(tpDist);
                        totalDuration += res.duration;
                        durationList.push(res.duration);
                        minDuration = Math.min(minDuration, res.duration);
                        maxDurationWin = Math.max(maxDurationWin, res.duration);
                        totalMae += res.mae;
                        maxMae = Math.max(maxMae, res.mae);
                        if (res.vol) totalVolWins += res.vol;
                        if (res.bp) totalBpWins += res.bp;
                    } else if (finalOutcome === 'LOSS') {
                        losses++;
                        pnlList.push(-riskDist);
                    }

                    if ((finalOutcome === 'WIN' || finalOutcome === 'LOSS') && cooldownActive && res.exitIdx > cIdx) {
                        nextAvailableIdx = res.exitIdx;
                    }
                }

                // --- Statistics Compilation (Same as before) ---
                const closedTrades = wins + losses;
                if (closedTrades < 5) continue;
                const winRateNum = closedTrades > 0 ? (wins / closedTrades) * 100 : 0;
                
                // Save Result
                const boolSignature = activeFilters.map(f => '1').join(''); // Simplified sig
                // Actually we need the full signature string for grouping
                // 001010...
                // The loop 'i' is the integer signature.
                const sigStr = i.toString(2).padStart(TOTAL_BITS, '0');
                
                // We need to match the original output format for labels and config
                const cfg = {
                     tier: tier.key,
                     tierLabel: tier.label,
                     htfMode: htfMode || 'DISCARD',
                     // Reconstruct config object
                };
                activeFilters.forEach(f => cfg[f.key] = true);
                cfg.useCooldown = cooldownActive;

                const labels = activeFilters.map(f => f.label);
                if (hasHtf) labels.push(`HTF:${htfMode || 'DISCARD'}`);
                if (filterBitMap.useRegime !== undefined && ((i >> filterBitMap.useRegime) & 1)) labels.push('REG:AUTO');

                // Advanced Stats (Wilson, SQN, etc.) - Simplified for brevity in worker but necessary
                // I will include the essential ones.
                
                const avgConfluenceScore = totalConfluenceScore / matches;
                let qualityClassification = 'C (Low Quality)';
                if (avgConfluenceScore >= 90) qualityClassification = 'A+ (Premium)';
                else if (avgConfluenceScore >= 80) qualityClassification = 'A (High Quality)';
                else if (avgConfluenceScore >= 70) qualityClassification = 'B (Standard)';

                // SQN
                let sqn = 0;
                if (pnlList.length >= 5) {
                    const sumPnl = pnlList.reduce((a, b) => a + b, 0);
                    const meanPnl = sumPnl / pnlList.length;
                    const sqDiff = pnlList.reduce((a, b) => a + Math.pow(b - meanPnl, 2), 0);
                    const stdDev = Math.sqrt(sqDiff / pnlList.length);
                    if (stdDev > 0) sqn = (meanPnl / stdDev) * Math.sqrt(pnlList.length);
                }

                const resultStats = {
                    matches,
                    closedTrades,
                    winRate: winRateNum.toFixed(1),
                    winRateNum,
                    wins,
                    losses,
                    avgConfluenceScore: avgConfluenceScore.toFixed(1),
                    qualityClassification,
                    sqn: sqn.toFixed(2),
                    sqnNum: sqn,
                    avgDuration: wins > 0 ? Math.round(totalDuration / wins) : 0,
                    avgMae: wins > 0 ? ((totalMae / wins) * 100).toFixed(2) : 0,
                    htfAligned,
                    htfOpposed,
                    htfHighRisk
                };

                const comb = {
                    config: cfg,
                    labels,
                    stats: resultStats,
                    tier: tier.key,
                    tierLabel: tier.label,
                    boolSignature: sigStr,
                    appliedValues: {
                        rsiTolerance: Math.round(rsiTolerance * tier.factor),
                        volumeTolerance: Math.round(volumeTolerance * tier.factor),
                        bpTolerance: Math.round(bpTolerance * tier.factor),
                        wickTolerance: Math.round((wickTolerance || 10) * tier.factor)
                    }
                };
                
                combinations.push(comb);

                // Robustness Check
                if (!signatureGroups.has(sigStr)) signatureGroups.set(sigStr, []);
                signatureGroups.get(sigStr).push(comb);
                const group = signatureGroups.get(sigStr);
                if (group.length === 2) {
                     const tiers = new Set(group.map(g => g.tier));
                     if (tiers.size === 2 && group.every(g => g.stats.winRateNum >= 50)) {
                         const normal = group.find(g => g.tier === 'NORMAL');
                         if (normal && !normal.isRobust) {
                             normal.isRobust = true;
                             robustCount++;
                         }
                     }
                }
            }
        }

        // Post-processing (Sort/Filter) - Copied from original
        // ... (Sorting logic)
        
        const uniqueResults = [];
        const seenSignatures = new Set();
        
        // Prioritize Robust
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

        const ratioRR = tpDist > 0 && riskDist > 0 ? (tpDist / riskDist) : null;
        const beWr = ratioRR != null ? (100 / (1 + ratioRR)) : null;

        if (mode === 'CUSTOM' && customCriteria) {
            const minTrades = Number(customCriteria.minTrades || 0);
            const minWinRate = Number(customCriteria.minWinRate || 0);
            const robustOnly = !!customCriteria.robustOnly;
            for (let i = uniqueResults.length - 1; i >= 0; i--) {
                const r = uniqueResults[i];
                if (r.stats.closedTrades < minTrades) { uniqueResults.splice(i, 1); continue; }
                if (r.stats.winRateNum < minWinRate) { uniqueResults.splice(i, 1); continue; }
                if (robustOnly && !r.isRobust) { uniqueResults.splice(i, 1); continue; }
            }
        }

        if (mode === 'WINRATE') {
            uniqueResults.sort((a, b) => {
                if (b.stats.winRateNum !== a.stats.winRateNum) return b.stats.winRateNum - a.stats.winRateNum;
                return b.stats.closedTrades - a.stats.closedTrades;
            });
        } else if (mode === 'SQN') {
            uniqueResults.sort((a, b) => {
                const sqnA = typeof a.stats.sqnNum === 'number' ? a.stats.sqnNum : Number(a.stats.sqn) || 0;
                const sqnB = typeof b.stats.sqnNum === 'number' ? b.stats.sqnNum : Number(b.stats.sqn) || 0;
                if (sqnB !== sqnA) return sqnB - sqnA;
                return b.stats.closedTrades - a.stats.closedTrades;
            });
        } else if (mode === 'EDGE') {
            uniqueResults.sort((a, b) => {
                if (a.isRobust && !b.isRobust) return -1;
                if (!a.isRobust && b.isRobust) return 1;
                const edgeA = beWr != null ? (a.stats.winRateNum - beWr) : a.stats.winRateNum;
                const edgeB = beWr != null ? (b.stats.winRateNum - beWr) : b.stats.winRateNum;
                if (edgeB !== edgeA) return edgeB - edgeA;
                return b.stats.closedTrades - a.stats.closedTrades;
            });
        } else {
            uniqueResults.sort((a, b) => {
                if (a.isRobust && !b.isRobust) return -1;
                if (!a.isRobust && b.isRobust) return 1;
                if (b.stats.closedTrades !== a.stats.closedTrades) return b.stats.closedTrades - a.stats.closedTrades;
                return b.stats.winRateNum - a.stats.winRateNum;
            });
        }

        const finalResults = uniqueResults.slice(0, 50);

        self.postMessage({
            type: 'progress',
            payload: { percent: 100, processed: totalCombBase, total: totalCombBase, stage: 'Finalizando' }
        });
        self.postMessage({ type: 'done', payload: { results: finalResults } });

    } catch (e) {
        self.postMessage({ type: 'error', payload: { message: e.message } });
    }
};

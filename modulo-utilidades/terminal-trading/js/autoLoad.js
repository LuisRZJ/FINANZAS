(function () {
    window.FTI_AutoLoad = window.FTI_AutoLoad || {};
    const AutoLoad = window.FTI_AutoLoad;

    const TWELVE_LIMIT_PER_MIN = 8;
    const TWELVE_INTERVAL_MAP = {
        '5m': '5min',
        '15m': '15min',
        '1h': '1h',
        '4h': '4h',
        '1d': '1day',
        '1w': '1week'
    };

    const createTwelveLimiter = () => {
        const bucket = { windowStart: 0, count: 0, queue: [], timer: null };

        const runQueue = () => {
            const now = Date.now();
            if (bucket.windowStart === 0 || now - bucket.windowStart >= 60000) {
                bucket.windowStart = now;
                bucket.count = 0;
            }

            if (!bucket.queue.length) {
                if (bucket.timer) {
                    clearTimeout(bucket.timer);
                    bucket.timer = null;
                }
                return;
            }

            if (bucket.count >= TWELVE_LIMIT_PER_MIN) {
                const waitMs = Math.max(0, 60000 - (now - bucket.windowStart));
                if (!bucket.timer) {
                    bucket.timer = window.setTimeout(() => {
                        bucket.timer = null;
                        runQueue();
                    }, waitMs);
                }
                return;
            }

            const item = bucket.queue.shift();
            bucket.count += 1;
            Promise.resolve()
                .then(item.fn)
                .then(item.resolve)
                .catch(item.reject)
                .finally(() => {
                    window.setTimeout(runQueue, 0);
                });
        };

        const enqueue = (fn) => {
            return new Promise((resolve, reject) => {
                bucket.queue.push({ fn, resolve, reject });
                runQueue();
            });
        };

        const reset = () => {
            bucket.queue = [];
            if (bucket.timer) {
                clearTimeout(bucket.timer);
                bucket.timer = null;
            }
            bucket.windowStart = 0;
            bucket.count = 0;
        };

        return { enqueue, reset };
    };

    const getLimiter = () => {
        if (!AutoLoad._twelveLimiter) AutoLoad._twelveLimiter = createTwelveLimiter();
        return AutoLoad._twelveLimiter;
    };

    AutoLoad.resetTwelveQueue = () => {
        const limiter = getLimiter();
        limiter.reset();
    };

    const scheduleTwelveTask = (fn) => {
        const limiter = getLimiter();
        return limiter.enqueue(fn);
    };

    AutoLoad.intervalToMs = (interval) => {
        const m = String(interval || '').match(/^(\d+)([mhdw])$/i);
        if (!m) return null;
        const n = parseInt(m[1], 10);
        const unit = m[2].toLowerCase();
        if (!n || n <= 0) return null;
        if (unit === 'm') return n * 60 * 1000;
        if (unit === 'h') return n * 60 * 60 * 1000;
        if (unit === 'd') return n * 24 * 60 * 60 * 1000;
        if (unit === 'w') return n * 7 * 24 * 60 * 60 * 1000;
        return null;
    };

    AutoLoad.intervalToMinutes = (interval) => {
        const ms = AutoLoad.intervalToMs(interval);
        return ms != null ? Math.round(ms / 60000) : null;
    };

    AutoLoad.sleep = (ms) => new Promise((r) => window.setTimeout(r, ms));

    AutoLoad.buildAutoRange = (startDateStr, endDateStr) => {
        if (!startDateStr || !endDateStr) return null;
        const startLocal = new Date(`${startDateStr}T00:00:00`);
        const endLocal = new Date(`${endDateStr}T23:59:59.999`);
        if (!(startLocal instanceof Date) || isNaN(startLocal.getTime())) return null;
        if (!(endLocal instanceof Date) || isNaN(endLocal.getTime())) return null;
        const nowMs = Date.now();
        const effectiveEnd = endLocal.getTime() >= nowMs ? nowMs : endLocal.getTime();
        return { startMs: startLocal.getTime(), endMs: effectiveEnd };
    };

    AutoLoad.expectedCandlesForRange = (startMs, endMs, interval) => {
        const ms = AutoLoad.intervalToMs(interval);
        if (!ms) return 0;
        const span = Math.max(0, endMs - startMs);
        return Math.max(1, Math.floor(span / ms) + 2);
    };

    AutoLoad.isForexOpenUtc = (ms) => {
        const d = new Date(ms);
        const day = d.getUTCDay();
        const hour = d.getUTCHours();
        if (day === 6) return false;
        if (day === 0) return hour >= 22;
        if (day >= 1 && day <= 4) return true;
        if (day === 5) return hour < 22;
        return false;
    };

    AutoLoad.expectedCandlesForRangeForex = (startMs, endMs, interval) => {
        const ms = AutoLoad.intervalToMs(interval);
        if (!ms) return 0;
        const end = Math.max(startMs, endMs);
        let t = startMs;
        let count = 0;
        let guard = 0;
        const maxIter = Math.ceil(((end - startMs) / ms) + 10);

        while (t <= end && guard <= maxIter) {
            if (AutoLoad.isForexOpenUtc(t)) count += 1;
            t += ms;
            guard += 1;
        }
        return Math.max(1, count + 1);
    };

    AutoLoad.expectedCandlesForRangeByMarket = (startMs, endMs, interval, market) => {
        if (market === 'forex') return AutoLoad.expectedCandlesForRangeForex(startMs, endMs, interval);
        return AutoLoad.expectedCandlesForRange(startMs, endMs, interval);
    };

    AutoLoad.normalizeTwelveSymbol = (raw) => {
        const s = String(raw || '').trim();
        if (!s) return '';
        const upper = s.toUpperCase();
        if (upper === 'XAUUSD') return 'XAU/USD';
        return upper;
    };

    AutoLoad.parseTwelveDatetimeUtc = (raw) => {
        const s = String(raw || '').trim();
        const m = s.match(/^(\d{4})-(\d{2})-(\d{2})[ T](\d{2}):(\d{2})(?::(\d{2}))?$/);
        if (!m) return null;
        const Y = Number(m[1]);
        const M = Number(m[2]);
        const D = Number(m[3]);
        const h = Number(m[4]);
        const min = Number(m[5]);
        const sec = m[6] != null ? Number(m[6]) : 0;
        const ms = Date.UTC(Y, M - 1, D, h, min, sec);
        if (!isFinite(ms)) return null;
        return ms;
    };

    AutoLoad.formatUtcForTwelve = (ms) => {
        const d = new Date(ms);
        const pad = (n) => (n < 10 ? '0' + n : String(n));
        const Y = d.getUTCFullYear();
        const M = pad(d.getUTCMonth() + 1);
        const D = pad(d.getUTCDate());
        const h = pad(d.getUTCHours());
        const m = pad(d.getUTCMinutes());
        const s = pad(d.getUTCSeconds());
        return `${Y}-${M}-${D} ${h}:${m}:${s}`;
    };

    AutoLoad.fetchTwelveTimeSeries = async ({ symbol, interval, startMs, endMs, onProgress, signal }) => {
        const apiKey = (() => {
            try { return localStorage.getItem('fti_twelve_api_key'); } catch (e) { return null; }
        })();
        if (!apiKey) throw new Error('No se detectó una API Key de TwelveData. Regístrala en Analizador de Mercado.');

        const mapped = TWELVE_INTERVAL_MAP[interval];
        if (!mapped) throw new Error('Temporalidad inválida');

        let currentAnchor = endMs;
        const out = new Map();
        let calls = 0;

        while (true) {
            if (signal && signal.aborted) throw new Error('Carga cancelada');

            const url = new URL('https://api.twelvedata.com/time_series');
            url.searchParams.set('symbol', symbol);
            url.searchParams.set('interval', mapped);
            url.searchParams.set('end_date', AutoLoad.formatUtcForTwelve(currentAnchor));
            url.searchParams.set('order', 'DESC');
            url.searchParams.set('timezone', 'UTC');
            url.searchParams.set('format', 'JSON');
            url.searchParams.set('outputsize', '5000');
            url.searchParams.set('apikey', apiKey);

            const json = await scheduleTwelveTask(async () => {
                const res = await fetch(url.toString(), { signal });
                if (!res.ok) {
                    let msg = `Error TwelveData (${res.status})`;
                    try {
                        const j = await res.json();
                        if (j && j.message) msg = String(j.message);
                    } catch (e) { }
                    throw new Error(msg);
                }
                return await res.json();
            });

            if (json && json.status && String(json.status).toLowerCase() !== 'ok') {
                throw new Error(json.message || 'Respuesta inválida de TwelveData');
            }

            const values = Array.isArray(json && json.values) ? json.values : [];
            if (!values.length) break;

            let oldestInBatch = null;
            let finished = false;

            for (let i = 0; i < values.length; i++) {
                const v = values[i];
                const t = AutoLoad.parseTwelveDatetimeUtc(v && v.datetime);
                if (!isFinite(t)) continue;

                if (oldestInBatch === null || t < oldestInBatch) oldestInBatch = t;

                if (t > endMs) continue;
                if (t < startMs) {
                    finished = true;
                    continue;
                }

                const open = parseFloat(v.open);
                const high = parseFloat(v.high);
                const low = parseFloat(v.low);
                const close = parseFloat(v.close);
                const vol = v.volume !== undefined ? parseFloat(v.volume) : undefined;
                if (!isFinite(open) || !isFinite(high) || !isFinite(low) || !isFinite(close)) continue;

                out.set(t, { timeMs: t, open, high, low, close, volume: isFinite(vol) ? vol : undefined });
            }

            calls++;
            if (onProgress) onProgress({ candles: out.size, calls });

            if (finished) break;
            if (oldestInBatch === null) break;

            const nextAnchor = oldestInBatch - 1000;
            if (nextAnchor >= currentAnchor) break;
            currentAnchor = nextAnchor;

            if (currentAnchor < startMs) break;
        }

        return Array.from(out.values()).sort((a, b) => a.timeMs - b.timeMs);
    };

    AutoLoad.twelveToRows = (points, interval) => {
        const intervalMs = AutoLoad.intervalToMs(interval) || 0;
        const nowMs = Date.now();
        return (Array.isArray(points) ? points : []).map((p, idx) => {
            const openTime = Number(p.timeMs);
            const dt = new Date(openTime);
            const candleEnd = openTime + intervalMs;
            return {
                id: idx,
                dateIso: dt.toISOString(),
                open: p.open,
                high: p.high,
                low: p.low,
                close: p.close,
                volume: p.volume,
                status: candleEnd > nowMs ? 'FORMING' : 'CLOSED',
                datetime: dt
            };
        }).filter((x) => isFinite(x.close) && x.datetime instanceof Date && !isNaN(x.datetime.getTime())).sort((a, b) => a.datetime - b.datetime);
    };

    AutoLoad.fetchBinanceKlines = async ({ symbol, interval, startMs, endMs, onProgress, signal, minDelayMs = 120 }) => {
        const intervalMs = AutoLoad.intervalToMs(interval);
        if (!intervalMs) throw new Error('Temporalidad inválida');

        let cursor = startMs;
        const out = [];
        let calls = 0;
        while (cursor <= endMs) {
            if (signal && signal.aborted) throw new Error('Carga cancelada');

            const url = new URL('https://api.binance.com/api/v3/klines');
            url.searchParams.set('symbol', symbol);
            url.searchParams.set('interval', interval);
            url.searchParams.set('startTime', String(cursor));
            url.searchParams.set('endTime', String(endMs));
            url.searchParams.set('limit', '1000');

            const t0 = Date.now();
            const res = await fetch(url.toString(), { signal });
            if (!res.ok) {
                let msg = `Error Binance (${res.status})`;
                try {
                    const j = await res.json();
                    if (j && j.msg) msg = String(j.msg);
                } catch (e) { }
                throw new Error(msg);
            }
            const data = await res.json();
            if (!Array.isArray(data) || data.length === 0) break;

            for (let i = 0; i < data.length; i++) out.push(data[i]);
            calls++;

            const last = data[data.length - 1];
            const lastOpenTime = last && last[0] != null ? Number(last[0]) : null;
            if (!isFinite(lastOpenTime)) break;
            cursor = lastOpenTime + intervalMs;

            if (onProgress) onProgress({ candles: out.length, calls });
            if (data.length < 1000) break;

            const spent = Date.now() - t0;
            const wait = Math.max(0, minDelayMs - spent);
            if (wait > 0) await AutoLoad.sleep(wait);
        }
        return out;
    };

    AutoLoad.klinesToExtendedRows = (klines) => {
        const nowMs = Date.now();
        return (Array.isArray(klines) ? klines : []).map((k, idx) => {
            const openTime = Number(k[0]);
            const open = parseFloat(k[1]);
            const high = parseFloat(k[2]);
            const low = parseFloat(k[3]);
            const close = parseFloat(k[4]);
            const volume = parseFloat(k[5]);
            const closeTime = Number(k[6]);
            const trades = Number(k[8]);
            const takerBuyVol = parseFloat(k[9]);
            const vol = isFinite(volume) ? volume : 0;
            const buy = isFinite(takerBuyVol) ? takerBuyVol : 0;
            const sell = Math.max(0, vol - buy);
            const delta = buy - sell;
            const bp = vol > 0 ? (buy / vol) * 100 : 0;
            const status = isFinite(closeTime) && closeTime > nowMs ? 'FORMING' : 'CLOSED';
            const dt = new Date(openTime);
            return {
                id: idx,
                dateIso: dt.toISOString(),
                open,
                high,
                low,
                close,
                volume: vol,
                trades,
                takerBuyVol: buy,
                takerSellVol: sell,
                delta,
                buyPressurePct: bp,
                status,
                datetime: dt
            };
        }).filter((x) => isFinite(x.close) && x.datetime instanceof Date && !isNaN(x.datetime.getTime())).sort((a, b) => a.datetime - b.datetime);
    };

    // ============================================================
    // SMART FETCH: Orquestador de carga inteligente
    // ============================================================

    /**
     * Función principal de carga inteligente.
     * Prioriza datasets locales cuando están disponibles, con fallback automático a APIs.
     * Soporta carga híbrida: parte local + parte API cuando hay cobertura parcial.
     * @param {boolean} useLocalData - Si es false, omite búsqueda de datos locales y va directo a API
     */
    AutoLoad.smartFetchTimeSeries = async ({ symbol, market, interval, startMs, endMs, signal, onProgress, useLocalData = true }) => {
        const Constants = window.FTI_Constants || {};
        const DataIO = window.FTI_DataIO || {};
        const findLocalDataset = Constants.findLocalDataset;
        const fetchAndParseLocalMkt = DataIO.fetchAndParseLocalMkt;
        const isForex = market === 'forex';

        // Función auxiliar para fetch desde API
        const fetchFromApi = async (apiStartMs, apiEndMs, progressPrefix = '') => {
            if (isForex) {
                const rawData = await AutoLoad.fetchTwelveTimeSeries({
                    symbol, interval, startMs: apiStartMs, endMs: apiEndMs, signal,
                    onProgress: onProgress ? ({ candles, calls }) => onProgress({
                        candles, calls, source: 'twelvedata',
                        message: progressPrefix + 'Descargando desde TwelveData...'
                    }) : undefined
                });
                return AutoLoad.twelveToRows(rawData, interval);
            } else {
                const rawData = await AutoLoad.fetchBinanceKlines({
                    symbol, interval, startMs: apiStartMs, endMs: apiEndMs, signal,
                    onProgress: onProgress ? ({ candles, calls }) => onProgress({
                        candles, calls, source: 'binance',
                        message: progressPrefix + 'Descargando desde Binance...'
                    }) : undefined
                });
                return AutoLoad.klinesToExtendedRows(rawData);
            }
        };

        // Intentar encontrar dataset local (solo si useLocalData está activado)
        if (useLocalData && typeof findLocalDataset === 'function') {
            const localInfo = findLocalDataset(symbol, interval, startMs, endMs);

            // Cobertura completa: solo usar datos locales
            if (localInfo.coverage === 'full' && localInfo.dataset && localInfo.dataset.path) {
                if (onProgress) {
                    onProgress({ candles: 0, calls: 0, source: 'local', message: '⚡ Usando optimización local (100%)...' });
                }

                try {
                    if (typeof fetchAndParseLocalMkt !== 'function') {
                        throw new Error('fetchAndParseLocalMkt no disponible');
                    }

                    const { enriched } = await fetchAndParseLocalMkt(localInfo.dataset.path, `${symbol}_${interval}`);

                    // Filtrar velas al rango solicitado PRESERVANDO los indicadores ya calculados
                    const filtered = enriched.filter(candle => {
                        if (!candle.datetime || !(candle.datetime instanceof Date)) return false;
                        const t = candle.datetime.getTime();
                        return t >= startMs && t <= endMs;
                    });

                    if (onProgress) {
                        onProgress({ candles: filtered.length, calls: 0, source: 'local', message: '✓ Datos locales cargados (100%)' });
                    }

                    filtered._isEnriched = true;
                    return filtered;

                } catch (localError) {
                    console.warn(`[SmartFetch] Error cargando dataset local completo, usando fallback API:`, localError.message || localError);
                }
            }

            // Cobertura parcial: combinar local + API
            if (localInfo.coverage === 'partial' && localInfo.dataset && localInfo.dataset.path) {
                if (onProgress) {
                    onProgress({ candles: 0, calls: 0, source: 'hybrid', message: '⚡ Carga híbrida: local + API...' });
                }

                try {
                    if (typeof fetchAndParseLocalMkt !== 'function') {
                        throw new Error('fetchAndParseLocalMkt no disponible');
                    }

                    // 1. Cargar datos locales
                    if (onProgress) {
                        onProgress({ candles: 0, calls: 0, source: 'local', message: '⚡ Cargando datos locales...' });
                    }

                    const { enriched } = await fetchAndParseLocalMkt(localInfo.dataset.path, `${symbol}_${interval}`);

                    // Filtrar al rango local
                    const localFiltered = enriched.filter(candle => {
                        if (!candle.datetime || !(candle.datetime instanceof Date)) return false;
                        const t = candle.datetime.getTime();
                        return t >= localInfo.localStartMs && t <= localInfo.localEndMs;
                    });

                    if (onProgress) {
                        onProgress({ candles: localFiltered.length, calls: 0, source: 'local', message: `✓ ${localFiltered.length} velas locales cargadas` });
                    }

                    // 2. Cargar datos de API para el rango faltante
                    let apiData = [];
                    if (localInfo.apiStartMs && localInfo.apiEndMs) {
                        if (onProgress) {
                            onProgress({ candles: localFiltered.length, calls: 0, source: 'api', message: '☁️ Descargando datos complementarios de API...' });
                        }

                        apiData = await fetchFromApi(localInfo.apiStartMs, localInfo.apiEndMs, '☁️ ');
                    }

                    // 3. Fusionar y ordenar
                    const combined = [...localFiltered, ...apiData].sort((a, b) => {
                        const tA = a.datetime instanceof Date ? a.datetime.getTime() : 0;
                        const tB = b.datetime instanceof Date ? b.datetime.getTime() : 0;
                        return tA - tB;
                    });

                    // Eliminar duplicados por timestamp
                    const seen = new Set();
                    const deduplicated = combined.filter(candle => {
                        const t = candle.datetime instanceof Date ? candle.datetime.getTime() : 0;
                        if (seen.has(t)) return false;
                        seen.add(t);
                        return true;
                    });

                    if (onProgress) {
                        onProgress({
                            candles: deduplicated.length,
                            calls: 0,
                            source: 'hybrid',
                            message: `✓ Híbrido: ${localFiltered.length} local + ${apiData.length} API = ${deduplicated.length} total`
                        });
                    }

                    // Los datos locales vienen enriquecidos, los de API no
                    // En carga híbrida, NO marcamos como enriched para forzar recálculo unificado
                    // Esto asegura que indicadores como ADR se calculen con el contexto completo
                    return deduplicated;

                } catch (hybridError) {
                    console.warn(`[SmartFetch] Error en carga híbrida, usando fallback API completo:`, hybridError.message || hybridError);
                }
            }
        }

        // Fallback completo a APIs externas
        return await fetchFromApi(startMs, endMs);
    };
})();

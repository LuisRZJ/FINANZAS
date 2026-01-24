(function () {
    window.FTI_DataIO = window.FTI_DataIO || {};
    const DataIO = window.FTI_DataIO;
    const Utils = window.FTI_Utils || {};
    const Indicators = window.FTI_Indicators || {};

    DataIO.inferTfMinutesFromSeries = (series, nameHint) => {
        try {
            const diffs = [];
            for (let i = 1; i < series.length; i++) {
                const d = Math.round((series[i].datetime - series[i - 1].datetime) / 60000);
                if (d > 0 && d <= 10080) diffs.push(d);
            }
            const freq = {};
            diffs.forEach((d) => { freq[d] = (freq[d] || 0) + 1; });
            const mode = (Object.entries(freq).sort((a, b) => b[1] - a[1])[0] || [])[0];
            const common = [1, 3, 5, 15, 30, 45, 60, 120, 240, 360, 720, 1440];
            const parsedFromName = (() => {
                const n = (nameHint || '').toLowerCase();
                const m = n.match(/(\d+)\s*m/); if (m) return parseInt(m[1], 10);
                const h = n.match(/(\d+)\s*h/); if (h) return parseInt(h[1], 10) * 60;
                const d = n.match(/(\d+)\s*d/); if (d) return parseInt(d[1], 10) * 1440;
                return null;
            })();
            let best = mode ? parseInt(mode, 10) : (parsedFromName || null);
            if (best == null && diffs.length) {
                const avg = Math.round(diffs.reduce((a, b) => a + b, 0) / diffs.length);
                best = avg;
            }
            if (best == null) return null;
            const nearest = common.reduce((prev, cur) => Math.abs(cur - best) < Math.abs(prev - best) ? cur : prev, common[0]);
            return nearest;
        } catch (e) {
            return null;
        }
    };

    DataIO.getSeriesRangeMs = (series) => {
        if (!series || !series.length) return null;
        const first = series[0] && series[0].datetime;
        const last = series[series.length - 1] && series[series.length - 1].datetime;
        if (!(first instanceof Date) || isNaN(first.getTime())) return null;
        if (!(last instanceof Date) || isNaN(last.getTime())) return null;
        return { startMs: first.getTime(), endMs: last.getTime() };
    };

    DataIO.readFileAsText = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (evt) => resolve(String(evt.target.result || ''));
            reader.onerror = () => reject(new Error('Error de lectura del archivo'));
            reader.readAsText(file);
        });
    };

    DataIO.readFileAsArrayBuffer = (file) => {
        return new Promise((resolve, reject) => {
            const reader = new FileReader();
            reader.onload = (evt) => resolve(evt.target.result);
            reader.onerror = () => reject(new Error('Error de lectura del archivo'));
            reader.readAsArrayBuffer(file);
        });
    };

    DataIO.parseCompressedDataset = async (buffer, nameHint) => {
        if (typeof DecompressionStream === 'undefined') {
            throw new Error('Tu navegador no soporta descompresión gzip.');
        }
        const stream = new Blob([buffer]).stream().pipeThrough(new DecompressionStream('gzip'));
        const text = await new Response(stream).text();
        let payload;
        try {
            payload = JSON.parse(text);
        } catch (e) {
            throw new Error('El archivo comprimido no contiene JSON válido.');
        }

        const rawData = payload && Array.isArray(payload.data) ? payload.data : null;
        if (!rawData) {
            throw new Error('Formato comprimido no reconocido.');
        }

        const parsed = rawData.map((row, idx) => {
            const timeValue = row && row.time != null ? Number(row.time) : null;
            const dateIso = row && row.dateIso ? String(row.dateIso) : null;
            const dt = isFinite(timeValue)
                ? new Date(timeValue)
                : (dateIso ? new Date(dateIso) : null);
            const bp = row && row.buyPressure != null ? parseFloat(row.buyPressure)
                : (row && row.buyPressurePct != null ? parseFloat(row.buyPressurePct) : null);
            const status = row && row.isLive != null ? (row.isLive ? 'FORMING' : 'CLOSED') : (row && row.status ? row.status : null);
            return {
                id: idx,
                dateIso: dt instanceof Date && !isNaN(dt.getTime()) ? dt.toISOString() : (dateIso || ''),
                open: parseFloat(row && row.open),
                high: parseFloat(row && row.high),
                low: parseFloat(row && row.low),
                close: parseFloat(row && row.close),
                volume: row && row.volume != null ? parseFloat(row.volume) : null,
                trades: row && row.trades != null ? parseFloat(row.trades) : null,
                takerBuyVol: row && row.takerBuyVol != null ? parseFloat(row.takerBuyVol) : null,
                takerSellVol: row && row.takerSellVol != null ? parseFloat(row.takerSellVol) : null,
                delta: row && row.delta != null ? parseFloat(row.delta) : null,
                buyPressurePct: bp,
                status,
                datetime: dt
            };
        }).filter((x) => !isNaN(x.close) && x.datetime instanceof Date && !isNaN(x.datetime.getTime())).sort((a, b) => a.datetime - b.datetime);

        if (!parsed.length) throw new Error('No se pudieron procesar velas válidas del archivo comprimido.');

        const calculateIndicators = Indicators.calculateIndicators || ((arr) => arr);
        const enriched = calculateIndicators(parsed);
        const tfMin = DataIO.inferTfMinutesFromSeries(enriched, nameHint);
        const isExtended = enriched.some(d => d.volume != null || d.buyPressurePct != null || d.delta != null || d.trades != null);
        return { enriched, tfMin, isExtended };
    };

    /**
     * Carga y parsea un archivo .mkt.gz desde una ruta local (servidor).
     * @param {string} path - Ruta relativa al archivo (ej: 'datos/cripto/BITCOIN/BTCUSDT_1d_2017-2025.mkt.gz')
     * @param {string} nameHint - Nombre descriptivo para inferir temporalidad
     * @returns {Promise<{enriched: Array, tfMin: number, isExtended: boolean}>}
     */
    DataIO.fetchAndParseLocalMkt = async (path, nameHint) => {
        if (!path) {
            throw new Error('Ruta de archivo local no especificada.');
        }

        let response;
        try {
            response = await fetch(path);
        } catch (networkError) {
            throw new Error(`Error de red al cargar archivo local: ${networkError.message || 'desconocido'}`);
        }

        if (!response.ok) {
            if (response.status === 404) {
                throw new Error(`Archivo local no encontrado: ${path}`);
            }
            throw new Error(`Error HTTP ${response.status} al cargar archivo local: ${path}`);
        }

        let buffer;
        try {
            buffer = await response.arrayBuffer();
        } catch (bufferError) {
            throw new Error(`Error al leer contenido del archivo: ${bufferError.message || 'desconocido'}`);
        }

        // Reutilizar la función de parsing existente
        return DataIO.parseCompressedDataset(buffer, nameHint || path);
    };

    DataIO.parseCsvText = (text, nameHint) => {
        const lines = String(text || '').split('\n').filter((l) => l.trim());
        if (lines.length < 2) throw new Error('El archivo CSV está vacío o no tiene datos suficientes');

        const header = (lines[0] || '').split(',').map((s) => s.trim());
        const isExtended = header.includes('Buy Pressure %') || header.length >= 10;
        if (!isExtended && header.length < 6) throw new Error('Formato de columnas no reconocido. Se espera OHLC estándar.');

        const parseCustomDate = Utils.parseCustomDate || (() => null);
        const parseFlexibleDateTime = Utils.parseFlexibleDateTime || (() => null);

        const parsed = lines.slice(1).map((line, idx) => {
            const parts = line.split(',').map((s) => s.trim());
            if (isExtended) {
                const [dtRaw, o, h, l, c, vol, trades, takerBuy, takerSell, delta, bp, status] = parts;
                const dt = parseFlexibleDateTime(dtRaw);
                return {
                    id: idx,
                    dateIso: dtRaw,
                    open: parseFloat(o),
                    high: parseFloat(h),
                    low: parseFloat(l),
                    close: parseFloat(c),
                    volume: parseFloat(vol),
                    trades: parseFloat(trades),
                    takerBuyVol: parseFloat(takerBuy),
                    takerSellVol: parseFloat(takerSell),
                    delta: parseFloat(delta),
                    buyPressurePct: parseFloat(bp),
                    status: status,
                    datetime: dt
                };
            }
            const [d, t, o, h, l, c] = parts;
            const dt = parseCustomDate(d, t) || parseFlexibleDateTime(`${d} ${t}`);
            return {
                id: idx,
                dateRaw: d,
                timeRaw: t,
                open: parseFloat(o),
                high: parseFloat(h),
                low: parseFloat(l),
                close: parseFloat(c),
                datetime: dt
            };
        }).filter((x) => !isNaN(x.close) && x.datetime instanceof Date && !isNaN(x.datetime.getTime())).sort((a, b) => a.datetime - b.datetime);

        if (!parsed.length) throw new Error('No se pudieron procesar velas válidas. Verifique el formato de fecha y números.');

        const calculateIndicators = Indicators.calculateIndicators || ((arr) => arr);
        const enriched = calculateIndicators(parsed);
        const tfMin = DataIO.inferTfMinutesFromSeries(enriched, nameHint);
        return { enriched, tfMin, isExtended };
    };
})();

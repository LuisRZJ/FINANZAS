/**
 * Helper para interactuar con la API pública de Binance (Sin auth).
 * Endpoint: GET /api/v3/klines
 */

const BINANCE_BASE_URL = 'https://api.binance.com/api/v3';

/**
 * Retorna todos los datos históricos (OHLC) de un símbolo en un intervalo de tiempo.
 * Maneja la paginación subyacente (max 1000 velas por Request de Binance).
 * 
 * @param {string} symbol - Par a operar (ej. 'BTCUSDT')
 * @param {string} interval - Intervalo de tiempo (ej. '1d', '1h', '15m')
 * @param {Date} startTime - Fecha inicial (JavaScript Date object)
 * @param {Date} endTime - Fecha final (JavaScript Date object)
 * @param {Function} onProgress - Callback para reportar avance a la UI: (porcentaje, texto)
 * @returns {Promise<Array>} Arreglo OHLC listo para el backtester
 */
export async function fetchBinanceKlines(symbol, interval, startTime, endTime, onProgress) {
    const symbolUpper = symbol.trim().toUpperCase();
    let currentStartTime = startTime.getTime();
    const finalEndTime = endTime.getTime();

    // Validaciones
    if (currentStartTime >= finalEndTime) {
        throw new Error('La fecha de inicio debe ser anterior a la fecha de fin.');
    }

    const allData = [];
    let isFinished = false;
    let page = 1;

    // Estimación bruta para la barra de progreso (no es 100% exacta por huecos del mercado, pero sirve visualmente)
    const msPerCandle = getIntervalMilliseconds(interval);
    const estimatedTotalCandles = Math.ceil((finalEndTime - currentStartTime) / msPerCandle);

    if (onProgress) onProgress(0, `Calculando descarga de aprox. ${estimatedTotalCandles.toLocaleString()} velas...`);

    while (!isFinished && currentStartTime <= finalEndTime) {
        try {
            // Límite máximo de Binance es 1000
            const url = `${BINANCE_BASE_URL}/klines?symbol=${symbolUpper}&interval=${interval}&startTime=${currentStartTime}&endTime=${finalEndTime}&limit=1000`;

            const response = await fetch(url);

            if (!response.ok) {
                if (response.status === 400) throw new Error(`Parámetros inválidos. Comprueba que el activo '${symbolUpper}' exista.`);
                if (response.status === 429) throw new Error('Demasiadas peticiones. Has sido bloqueado temporalmente por Binance.');
                throw new Error(`Error HTTP: ${response.status}`);
            }

            const data = await response.json();

            // Si devuelve un array vacío, ya no hay más datos en ese rango de tiempo
            if (data.length === 0) {
                isFinished = true;
                break;
            }

            // Parsear cada línea: [Open time, Open, High, Low, Close, Volume, Close time, Quote asset volume, Number of trades, Taker buy base asset volume, Taker buy quote asset volume, Ignore]
            for (const row of data) {
                allData.push({
                    date: new Date(row[0]), // Timestamp apertura
                    open: parseFloat(row[1]),
                    high: parseFloat(row[2]),
                    low: parseFloat(row[3]),
                    close: parseFloat(row[4])
                });
            }

            // Avanzar el reloj
            // Tomamos el Close Time (+1ms) del último registro para la próxima petición
            const lastCandleCloseTime = data[data.length - 1][6];
            currentStartTime = lastCandleCloseTime + 1;

            page++;

            // Reportar progreso
            if (onProgress) {
                const perc = Math.min(100, Math.round((allData.length / estimatedTotalCandles) * 100));
                onProgress(perc, `Descargadas ${allData.length.toLocaleString()} velas...`);
            }

        } catch (error) {
            console.error('Error fetching Binance data:', error);
            throw error; // Propagar error a la UI
        }
    }

    if (allData.length === 0) {
        throw new Error(`No se encontraron datos para ${symbolUpper} en las fechas seleccionadas.`);
    }

    if (onProgress) onProgress(100, `¡Compreto! ${allData.length.toLocaleString()} velas obtenidas.`);
    return allData;
}

/**
 * Autodetecta la fecha de la primera vela registrada en Binance para este símbolo e intervalo.
 * Utiliza limit=1 desde el principio del tiempo (0).
 */
export async function detectFirstCandle(symbol, interval) {
    const symbolUpper = symbol.trim().toUpperCase();

    // startTime=0 le dice a Binance: dame lo más viejo que tengas
    const url = `${BINANCE_BASE_URL}/klines?symbol=${symbolUpper}&interval=${interval}&startTime=0&limit=1`;

    try {
        const response = await fetch(url);
        if (!response.ok) {
            if (response.status === 400) throw new Error(`El activo '${symbolUpper}' no existe en Binance (Añade 'USDT' al final si es necesario).`);
            throw new Error(`Status HTTP ${response.status}`);
        }

        const data = await response.json();
        if (data.length === 0) {
            throw new Error(`No hay información histórica disponible para ${symbolUpper}`);
        }

        // Retornamos el timestamp del 'Open time' de la primera vela histórica
        const firstTimestamp = data[0][0];
        return new Date(firstTimestamp);

    } catch (err) {
        console.error('Error en autodetect:', err);
        throw err;
    }
}

/**
 * Helper interno para transiciones en milisegundos y estimaciones de progreso.
 */
export function getIntervalMilliseconds(interval) {
    const unit = interval.slice(-1); // m, h, d, w, M
    const value = parseInt(interval.slice(0, -1));
    const minuetsInMs = 60 * 1000;

    switch (unit) {
        case 'm': return value * minuetsInMs;
        case 'h': return value * 60 * minuetsInMs;
        case 'd': return value * 24 * 60 * minuetsInMs;
        case 'w': return value * 7 * 24 * 60 * minuetsInMs;
        case 'M': return value * 30 * 24 * 60 * minuetsInMs; // Aproximación chusca para meses, está bien para la barra progreso
        default: return 60 * minuetsInMs;
    }
}

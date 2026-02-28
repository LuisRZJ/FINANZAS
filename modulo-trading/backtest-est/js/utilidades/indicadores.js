/**
 * Módulo de Indicadores Técnicos.
 * Diseñado para ser extensible: añadir RSI, MACD, Bandas, etc. en el futuro.
 */

/**
 * Simple Moving Average (SMA).
 * @param {number[]} closes - Array de precios de cierre.
 * @param {number} period - Periodo de la media.
 * @returns {number[]} Array del mismo tamaño. Los primeros (period-1) valores serán null.
 */
export function calcSMA(closes, period) {
    const result = new Array(closes.length).fill(null);
    if (period > closes.length) return result;

    // Calcular la primera ventana
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += closes[i];
    }
    result[period - 1] = sum / period;

    // Ventana deslizante: O(n) en vez de O(n*period)
    for (let i = period; i < closes.length; i++) {
        sum += closes[i] - closes[i - period];
        result[i] = sum / period;
    }

    return result;
}

/**
 * Exponential Moving Average (EMA).
 * @param {number[]} closes - Array de precios de cierre.
 * @param {number} period - Periodo de la media.
 * @returns {number[]} Array del mismo tamaño. Los primeros (period-1) valores serán null.
 */
export function calcEMA(closes, period) {
    const result = new Array(closes.length).fill(null);
    if (period > closes.length) return result;

    const k = 2 / (period + 1); // Factor de suavizado

    // El primer valor EMA = SMA del primer bloque
    let sum = 0;
    for (let i = 0; i < period; i++) {
        sum += closes[i];
    }
    let ema = sum / period;
    result[period - 1] = ema;

    // Iterar el resto
    for (let i = period; i < closes.length; i++) {
        ema = closes[i] * k + ema * (1 - k);
        result[i] = ema;
    }

    return result;
}

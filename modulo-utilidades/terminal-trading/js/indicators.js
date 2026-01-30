/**
 * js/indicators.js - Cálculo de indicadores técnicos (RSI, ADX, ADR, SMA)
 * Las funciones se definen directamente en el objeto global para evitar
 * conflictos con redeclaraciones en scripts Babel.
 */

// Crear el namespace global si no existe
window.FTI_Indicators = window.FTI_Indicators || {};

/**
 * Calcula indicadores técnicos para un conjunto de datos OHLC
 * @param {Array} data - Array de objetos con {datetime, open, high, low, close}
 * @returns {Array} - Datos enriquecidos con indicadores
 */
window.FTI_Indicators.calculateIndicators = function (data) {
    // Cálculos simplificados pero funcionales para la demo
    const period = 14;
    let gains = 0, losses = 0;
    const results = [];
    const sma200 = [];

    // === ADX (Average Directional Index) for Regime Detection ===
    const adxPeriod = 14;
    const adxValues = [];
    let prevPlusDM = 0, prevMinusDM = 0, prevTR = 0, prevDX = 0;

    // Para volatilidad (Cuerpo promedio últimas 5 velas)
    const bodySizes = [];

    // --- ADR (Average Daily Range) ---
    // Estructura para almacenar rangos diarios cerrados
    const dailyRanges = []; // Array de { date: 'YYYY-MM-DD', range: high - low }
    let currentDayKey = null;
    let currentDayOpen = null;
    let currentDayHigh = -Infinity;
    let currentDayLow = Infinity;

    // Pre-procesamiento: Calcular rangos diarios
    const adrData = []; // Almacenará los datos ADR por vela

    const getDayKey = (dt) => {
        if (!dt) return null;
        const dateObj = dt instanceof Date ? dt : new Date(dt);
        if (isNaN(dateObj.getTime())) return null;
        return `${dateObj.getFullYear()}-${String(dateObj.getMonth() + 1).padStart(2, '0')}-${String(dateObj.getDate()).padStart(2, '0')}`;
    };

    for (let i = 0; i < data.length; i++) {
        const c = data[i];
        const dayKey = getDayKey(c.datetime);

        // SMA
        if (i >= 199) {
            let sum = 0;
            for (let j = 0; j < 200; j++) sum += data[i - j].close;
            sma200.push(sum / 200);
        } else sma200.push(null);

        // Volatilidad (Tamaño cuerpo %)
        const bodySize = Math.abs(c.close - c.open) / c.open;
        bodySizes.push(bodySize);
        let avgBodySize = 0;
        if (i >= 4) {
            let sumBody = 0;
            for (let k = 0; k < 5; k++) sumBody += bodySizes[i - k];
            avgBodySize = sumBody / 5;
        } else {
            avgBodySize = bodySize; // Fallback inicial
        }

        // --- Lógica ADR: Detectar cambio de día ---
        const isNewDay = (dayKey !== currentDayKey);
        if (isNewDay) {
            // Si había un día previo, guardar su rango
            if (currentDayKey !== null && currentDayHigh !== -Infinity && currentDayLow !== Infinity) {
                dailyRanges.push({
                    date: currentDayKey,
                    range: currentDayHigh - currentDayLow
                });
                // Mantener solo los últimos 14 días cerrados
                if (dailyRanges.length > 14) {
                    dailyRanges.shift();
                }
            }
        }

        // --- CALCULAR ADR PARA ESTA VELA (Basado en el estado PREVIO a la vela actual) ---
        let adrValue = null;
        let adrFilledPct = null;
        let currentDayRange = null;
        let adrRoomTop = null;
        let adrRoomBottom = null;

        if (dailyRanges.length >= 1 && (isNewDay || currentDayOpen !== null)) {
            // Calcular promedio de rangos diarios (excluyendo día actual)
            const rangesToUse = dailyRanges.slice(-14);
            if (rangesToUse.length > 0) {
                const sumRanges = rangesToUse.reduce((acc, dr) => acc + dr.range, 0);
                adrValue = sumRanges / rangesToUse.length;

                // Rango del día actual:
                // - Si es nuevo día: usar el rango de LA VELA ACTUAL (high - low)
                //   Esto es importante para D1 donde cada vela es un día completo
                // - Si no es nuevo día: usar el rango acumulado del día (prevHigh - prevLow)
                if (isNewDay) {
                    // Para D1, ESTA vela es todo el día, su rango es el rango del día
                    currentDayRange = c.high - c.low;
                } else {
                    // Para timeframes intradiarios, acumular usando los máx/mín previos
                    // y añadir la vela actual al cálculo
                    const intraHighWithCurrent = Math.max(currentDayHigh, c.high);
                    const intraLowWithCurrent = Math.min(currentDayLow, c.low);
                    currentDayRange = intraHighWithCurrent - intraLowWithCurrent;
                }

                // Porcentaje completado del ADR
                adrFilledPct = adrValue > 0 ? (currentDayRange / adrValue) * 100 : 0;

                // Techos y suelos estadísticos (Basados en el Open del día actual)
                const effectiveDayOpen = isNewDay ? c.open : currentDayOpen;
                adrRoomTop = effectiveDayOpen + adrValue;
                adrRoomBottom = effectiveDayOpen - adrValue;
            }
        }

        // --- ACTUALIZAR MÁXIMOS/MÍNIMOS PARA LA PRÓXIMA VELA ---
        if (isNewDay) {
            // Iniciar nuevo día
            currentDayKey = dayKey;
            currentDayOpen = c.open;
            currentDayHigh = c.high;
            currentDayLow = c.low;
        } else {
            // Actualizar máximos y mínimos del día actual
            if (c.high > currentDayHigh) currentDayHigh = c.high;
            if (c.low < currentDayLow) currentDayLow = c.low;
        }

        adrData.push({
            adrValue,
            adrFilledPct,
            currentDayRange,
            adrRoomTop,
            adrRoomBottom,
            dayOpen: currentDayOpen
        });

        // RSI
        if (i === 0) {
            results.push(null);
        } else {
            const change = data[i].close - data[i - 1].close;
            if (change > 0) gains += change; else losses += Math.abs(change);

            if (i < period) {
                results.push(null);
            } else {
                let avgGain, avgLoss;
                if (i === period) {
                    avgGain = gains / period;
                    avgLoss = losses / period;
                } else {
                    const currentGain = change > 0 ? change : 0;
                    const currentLoss = change < 0 ? Math.abs(change) : 0;
                    avgGain = (results[i - 1].avgGain * 13 + currentGain) / 14;
                    avgLoss = (results[i - 1].avgLoss * 13 + currentLoss) / 14;
                }

                const rs = avgLoss === 0 ? 100 : avgGain / avgLoss;
                const rsi = 100 - (100 / (1 + rs));
                results.push({ val: rsi, avgGain, avgLoss });
            }
        }

        // === ADX Calculation ===
        let adx = null;
        if (i >= 1) {
            const high = data[i].high;
            const low = data[i].low;
            const prevHigh = data[i - 1].high;
            const prevLow = data[i - 1].low;
            const prevClose = data[i - 1].close;

            // True Range
            const tr = Math.max(
                high - low,
                Math.abs(high - prevClose),
                Math.abs(low - prevClose)
            );

            // Directional Movement
            const upMove = high - prevHigh;
            const downMove = prevLow - low;
            const plusDM = upMove > downMove && upMove > 0 ? upMove : 0;
            const minusDM = downMove > upMove && downMove > 0 ? downMove : 0;

            if (i < adxPeriod) {
                prevTR += tr;
                prevPlusDM += plusDM;
                prevMinusDM += minusDM;
            } else if (i === adxPeriod) {
                // First smoothed values
                prevTR = prevTR;
                prevPlusDM = prevPlusDM;
                prevMinusDM = prevMinusDM;
            } else {
                // Wilder's smoothing
                prevTR = prevTR - (prevTR / adxPeriod) + tr;
                prevPlusDM = prevPlusDM - (prevPlusDM / adxPeriod) + plusDM;
                prevMinusDM = prevMinusDM - (prevMinusDM / adxPeriod) + minusDM;
            }

            if (i >= adxPeriod && prevTR > 0) {
                const plusDI = (prevPlusDM / prevTR) * 100;
                const minusDI = (prevMinusDM / prevTR) * 100;
                const diSum = plusDI + minusDI;
                const dx = diSum > 0 ? (Math.abs(plusDI - minusDI) / diSum) * 100 : 0;

                if (i === adxPeriod) {
                    prevDX = dx;
                    adx = dx;
                } else {
                    // Smooth ADX with Wilder's method
                    adx = ((prevDX * (adxPeriod - 1)) + dx) / adxPeriod;
                    prevDX = adx;
                }
            }
        }
        adxValues.push(adx);
    }

    return data.map((d, i) => {
        const high = d.high;
        const low = d.low;
        const open = d.open;
        const close = d.close;
        const range = high - low;
        let upperWickPct = 0;
        let lowerWickPct = 0;
        if (isFinite(range) && range > 0) {
            const upperWick = Math.max(0, high - Math.max(open, close));
            const lowerWick = Math.max(0, Math.min(open, close) - low);
            upperWickPct = (upperWick / range) * 100;
            lowerWickPct = (lowerWick / range) * 100;
        }
        return {
            ...d,
            rsi: (results[i] && results[i].val) || null,
            sma200: sma200[i],
            hour: d.datetime ? d.datetime.getHours() : 0,
            hourLocal: d.datetime ? d.datetime.getHours() : null,
            hourUtc: d.datetime ? d.datetime.getUTCHours() : null,
            bodySizePct: (Math.abs(d.close - d.open) / d.open) * 100,
            upperWickPct,
            lowerWickPct,
            adrValue: adrData[i] ? adrData[i].adrValue : null,
            adrFilledPct: adrData[i] ? adrData[i].adrFilledPct : null,
            currentDayRange: adrData[i] ? adrData[i].currentDayRange : null,
            adrRoomTop: adrData[i] ? adrData[i].adrRoomTop : null,
            adrRoomBottom: adrData[i] ? adrData[i].adrRoomBottom : null,
            dayOpen: adrData[i] ? adrData[i].dayOpen : null,
            adx: adxValues[i] || null
        };
    });
};

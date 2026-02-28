/**
 * Cálculos financieros usando datos OHLC completos.
 * Cada punto de `data` tiene: { date, open, high, low, close }
 */
export function calculateMetrics(data) {
    if (!data || data.length < 2) return null;

    const first = data[0];
    const last = data[data.length - 1];

    // Precio de apertura del período (Open de la primera vela)
    // Prevención de división por cero
    const startPrice = first.open > 0 ? first.open : 0.0000001;
    // Precio de cierre del período (Close de la última vela)
    const endPrice = last.close;

    // ─── 1. ROI Total ───────────────────────────────────────────
    const totalROI = ((endPrice - startPrice) / startPrice) * 100;

    // ─── 2. CAGR (Rentabilidad Anualizada Compuesta) ────────────
    const startDate = first.date;
    const endDate = last.date;
    const years = (endDate - startDate) / (1000 * 60 * 60 * 24 * 365.25);

    let cagr = 0;
    if (years > 0 && startPrice > 0) {
        cagr = (Math.pow(endPrice / startPrice, 1 / years) - 1) * 100;
    }

    // ─── 3. Maximum Drawdown (Usando High para picos y Low para valles) ──
    let maxDrawdown = 0;
    let peak = data[0].high; // Pico inicial es el High de la primera vela

    for (const candle of data) {
        // Actualizar pico con el High de cada vela
        if (candle.high > peak) {
            peak = candle.high;
        }
        // Medir la caída desde el pico usando el Low de la vela
        if (peak > 0) {
            const drawdown = ((peak - candle.low) / peak) * 100;
            if (drawdown > maxDrawdown) {
                maxDrawdown = drawdown;
            }
        }
    }

    // ─── 4. Retornos Anuales (Open primera vela → Close última vela por año) ──
    const yearlyData = {};

    for (const candle of data) {
        if (!candle.date || !candle.date.getFullYear) continue;
        const year = String(candle.date.getFullYear());

        if (!yearlyData[year]) {
            yearlyData[year] = {
                firstOpen: candle.open,  // Open de la primera vela del año
                lastClose: candle.close  // Se irá sobreescribiendo hasta quedar con la última
            };
        } else {
            yearlyData[year].lastClose = candle.close;
        }
    }

    const annualReturns = [];
    const sortedYears = Object.keys(yearlyData).sort();

    for (const year of sortedYears) {
        const { firstOpen, lastClose } = yearlyData[year];
        // Prevención de división por cero
        const safeOpen = firstOpen > 0 ? firstOpen : 0.0000001;
        const ret = ((lastClose - safeOpen) / safeOpen) * 100;

        annualReturns.push({
            year: parseInt(year),
            startPrice: firstOpen,
            endPrice: lastClose,
            returnPerc: ret
        });
    }

    return {
        totalROI: isFinite(totalROI) ? totalROI : 0,
        cagr: isFinite(cagr) ? cagr : 0,
        maxDrawdown: isFinite(maxDrawdown) ? maxDrawdown : 0,
        annualReturns,
        timeSpan: {
            years: years,
            days: years * 365.25
        }
    };
}

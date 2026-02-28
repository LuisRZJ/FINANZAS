/**
 * Simulación de Dollar Cost Averaging (DCA).
 * @param {Array} data - El array de velas OHLC ordenado por fecha.
 * @param {Number} initialCapital - Capital aportado el primer día (fiat).
 * @param {Number} recurringAmount - Capital aportado cada periodo (fiat).
 * @param {String} frequency - Frecuencia: "daily", "weekly", "biweekly", "monthly".
 * @returns {Object} { totalInvested, endPortfolioValue, returnPerc, timeline }
 */
export function simulateDCA(data, initialCapital, recurringAmount, frequency) {
    if (!data || data.length === 0) return null;

    let totalInvested = 0;
    let accumulatedAsset = 0;

    // El arreglo `timeline` mapeará 1:1 con el arreglo `data` para graficar,
    // guardando el valor fiat del portafolio en cada vela.
    const timeline = new Array(data.length);

    let nextContributionDate = new Date(data[0].date);

    // 1. Aportación inicial
    if (initialCapital > 0) {
        let firstPrice = data[0].open > 0 ? data[0].open : 0.0000001;
        totalInvested += initialCapital;
        accumulatedAsset += initialCapital / firstPrice;
    }

    // Establecer la fecha de la próxima aportación recurrente
    advanceDate(nextContributionDate, frequency);

    for (let i = 0; i < data.length; i++) {
        let candle = data[i];

        // 2. Verificar si toca hacer aportación recurrente en esta vela
        while (candle.date >= nextContributionDate) {
            // Comprar en la apertura (o similar) en el momento que cruza la fecha
            let buyPrice = candle.open > 0 ? candle.open : 0.0000001;
            totalInvested += recurringAmount;
            accumulatedAsset += recurringAmount / buyPrice;

            // Calcular próxima fecha
            advanceDate(nextContributionDate, frequency);
        }

        // Valor actual de todo el activo acumulado usando el precio de cierre de la vela actual
        let currentPortfolioValue = accumulatedAsset * candle.close;

        // Registrar en la serie de tiempo para graficar
        timeline[i] = {
            date: candle.date,
            invested: totalInvested,      // Cuánto dinero propio hay metido hasta este punto
            value: currentPortfolioValue  // Cuánto vale en el mercado
        };
    }

    const endPortfolioValue = timeline[timeline.length - 1].value;

    let returnPerc = 0;
    if (totalInvested > 0) {
        returnPerc = ((endPortfolioValue - totalInvested) / totalInvested) * 100;
    }

    return {
        totalInvested,
        endPortfolioValue,
        returnPerc,
        timeline
    };
}

/**
 * Función auxiliar para avanzar una fecha según la frecuencia DCA
 */
function advanceDate(dateObj, frequency) {
    switch (frequency) {
        case 'daily':
            dateObj.setDate(dateObj.getDate() + 1);
            break;
        case 'weekly':
            dateObj.setDate(dateObj.getDate() + 7);
            break;
        case 'biweekly':
            dateObj.setDate(dateObj.getDate() + 14);
            break;
        case 'monthly':
            dateObj.setMonth(dateObj.getMonth() + 1);
            break;
    }
}

/**
 * Motor de Backtesting.
 * Simula operaciones basadas en cruces de medias móviles sobre datos OHLC.
 * Soporta dos modos de salida:
 *   - 'classic': Cierre cuando las medias se vuelven a cruzar.
 *   - 'fixed':   Cierre por Stop Loss o Take Profit fijo (R:R).
 */
import { calcSMA, calcEMA } from './indicadores.js';

/**
 * Ejecuta un backtest de cruce de medias móviles.
 * @param {Array} data - Array de velas OHLC: { date, open, high, low, close }
 * @param {Object} config - Configuración de la estrategia:
 *   { fastPeriod, slowPeriod, maType: 'SMA'|'EMA',
 *     exitMode: 'classic'|'fixed', slPerc: number, rr: number }
 * @returns {Object} Resultados del backtest.
 */
export function runBacktest(data, config) {
    const { fastPeriod, slowPeriod, maType, exitMode = 'classic', slCandles = 5, rr = 2 } = config;
    const closes = data.map(d => d.close);

    // Calcular medias
    const calcFn = maType === 'EMA' ? calcEMA : calcSMA;
    const fastMA = calcFn(closes, fastPeriod);
    const slowMA = calcFn(closes, slowPeriod);

    const trades = [];
    let inPosition = false;
    let entryIndex = -1;
    let stopLossPrice = 0;
    let takeProfitPrice = 0;

    // El índice mínimo donde ambas medias tienen valor
    const startIndex = Math.max(fastPeriod, slowPeriod);

    for (let i = startIndex; i < data.length; i++) {
        if (fastMA[i] === null || slowMA[i] === null ||
            fastMA[i - 1] === null || slowMA[i - 1] === null) continue;

        // ─── Verificar SL/TP si estamos en posición con modo 'fixed' ───
        if (inPosition && exitMode === 'fixed') {
            const low = data[i].low;
            const high = data[i].high;
            const entryPrice = data[entryIndex].close;

            // Caso conservador: si ambas tocan en la misma vela, asumimos SL primero
            if (low <= stopLossPrice) {
                // Stop Loss tocado
                const returnPerc = ((stopLossPrice - entryPrice) / entryPrice) * 100;
                trades.push({
                    entryDate: data[entryIndex].date,
                    entryPrice,
                    exitDate: data[i].date,
                    exitPrice: stopLossPrice,
                    returnPerc,
                    exitReason: 'SL'
                });
                inPosition = false;
                entryIndex = -1;
                continue;
            }

            if (high >= takeProfitPrice) {
                // Take Profit tocado
                const returnPerc = ((takeProfitPrice - entryPrice) / entryPrice) * 100;
                trades.push({
                    entryDate: data[entryIndex].date,
                    entryPrice,
                    exitDate: data[i].date,
                    exitPrice: takeProfitPrice,
                    returnPerc,
                    exitReason: 'TP'
                });
                inPosition = false;
                entryIndex = -1;
                continue;
            }
        }

        const prevFastAbove = fastMA[i - 1] > slowMA[i - 1];
        const currFastAbove = fastMA[i] > slowMA[i];

        // Cruce alcista: media rápida cruza por encima de la lenta
        if (!inPosition && currFastAbove && !prevFastAbove) {
            inPosition = true;
            entryIndex = i;

            if (exitMode === 'fixed') {
                const entryPrice = data[i].close;

                let minLow = data[i].low;
                const lookbackStart = Math.max(0, i - slCandles + 1);
                for (let k = lookbackStart; k <= i; k++) {
                    if (data[k].low < minLow) minLow = data[k].low;
                }
                stopLossPrice = minLow;

                let distAmount = entryPrice - stopLossPrice;
                if (distAmount <= 0) distAmount = entryPrice * 0.001; // Failsafe

                takeProfitPrice = entryPrice + (distAmount * rr);
            }
        }

        // Cruce bajista: media rápida cruza por debajo de la lenta (solo en modo 'classic')
        if (inPosition && exitMode === 'classic' && !currFastAbove && prevFastAbove) {
            const entryPrice = data[entryIndex].close;
            const exitPrice = data[i].close;
            const returnPerc = ((exitPrice - entryPrice) / entryPrice) * 100;

            trades.push({
                entryDate: data[entryIndex].date,
                entryPrice,
                exitDate: data[i].date,
                exitPrice,
                returnPerc,
                exitReason: 'CROSS'
            });

            inPosition = false;
            entryIndex = -1;
        }
    }

    // Si queda una posición abierta al final, cerrarla al último precio
    if (inPosition && entryIndex >= 0) {
        const entryPrice = data[entryIndex].close;
        const exitPrice = data[data.length - 1].close;
        const returnPerc = ((exitPrice - entryPrice) / entryPrice) * 100;

        trades.push({
            entryDate: data[entryIndex].date,
            entryPrice,
            exitDate: data[data.length - 1].date,
            exitPrice,
            returnPerc,
            exitReason: 'EOD' // End of Data
        });
    }

    // Calcular métricas de la estrategia
    return calculateStrategyMetrics(trades, data, config.riskFraction ?? 0.02);
}

/**
 * Calcula métricas agregadas a partir de la lista de trades.
 */
function calculateStrategyMetrics(trades, data, riskFraction = 0.02) {
    if (trades.length === 0) {
        return {
            trades,
            totalROI: 0,
            winRate: 0,
            profitFactor: 0,
            maxDrawdown: 0,
            numTrades: 0
        };
    }

    // ROI compuesto: producto de (1 + retorno * riskFraction) de cada trade
    let compoundReturn = 1;
    let wins = 0;
    let grossProfit = 0;
    let grossLoss = 0;

    for (const trade of trades) {
        compoundReturn *= (1 + (trade.returnPerc / 100) * riskFraction);

        if (trade.returnPerc > 0) {
            wins++;
            grossProfit += trade.returnPerc;
        } else {
            grossLoss += Math.abs(trade.returnPerc);
        }
    }

    const totalROI = (compoundReturn - 1) * 100;
    const winRate = (wins / trades.length) * 100;
    const profitFactor = grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : 0;

    // Max Drawdown sobre la Equity Curve de la estrategia
    let equity = 1;
    let peak = 1;
    let maxDrawdown = 0;

    for (const trade of trades) {
        equity *= (1 + (trade.returnPerc / 100) * riskFraction);
        if (equity > peak) peak = equity;
        const dd = ((peak - equity) / peak) * 100;
        if (dd > maxDrawdown) maxDrawdown = dd;
    }

    return {
        trades,
        totalROI: isFinite(totalROI) ? totalROI : 0,
        winRate: isFinite(winRate) ? winRate : 0,
        profitFactor: isFinite(profitFactor) ? profitFactor : 0,
        maxDrawdown: isFinite(maxDrawdown) ? maxDrawdown : 0,
        numTrades: trades.length
    };
}

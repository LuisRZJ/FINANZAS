/**
 * js/components/constants.js - Constantes de configuración y variantes de UI
 * Las constantes se definen directamente en el objeto global para evitar
 * conflictos con redeclaraciones en scripts Babel.
 */

// Crear namespace global
window.FTI_Constants = window.FTI_Constants || {};

// Pares de trading populares
window.FTI_Constants.POPULAR_PAIRS = [
    "BTCUSDT", "ETHUSDT", "ETCUSDT", "LTCUSDT", "XRPUSDT",
    "SOLUSDT", "TRXUSDT", "MATICUSDT", "DASHUSDT", "QTUMUSDT",
    "ZECUSDT", "NOTUSDT", "AUSDT",
    "BNBUSDT", "ADAUSDT", "DOGEUSDT", "AVAXUSDT", "DOTUSDT",
    "LINKUSDT", "BCHUSDT", "XLMUSDT", "NEARUSDT", "ATOMUSDT",
    "UNIUSDT", "FILUSDT", "HBARUSDT", "PEPEUSDT", "SHIBUSDT",
    "SUIUSDT", "APTUSDT", "ARBUSDT", "POLUSDT"
];

window.FTI_Constants.FOREX_PAIRS = [
    "XAU/USD", "XAUUSD",
    "EUR/USD", "USD/JPY", "GBP/USD", "AUD/USD", "USD/CAD",
    "USD/CHF", "NZD/USD", "EUR/JPY", "EUR/GBP", "GBP/JPY",
    "AUD/JPY", "CAD/JPY", "CHF/JPY"
];

// Configuración de carga automática
window.FTI_Constants.AUTOLOAD_ENTRY_TFS = [
    { label: '15M', interval: '15m' },
    { label: '1H', interval: '1h' },
    { label: '4H', interval: '4h' },
    { label: '1D', interval: '1d' }
];

window.FTI_Constants.AUTOLOAD_TF_MAP = {
    '15m': { htf: '1h', ltf: '5m' },
    '1h': { htf: '4h', ltf: '15m' },
    '4h': { htf: '1d', ltf: '1h' },
    '1d': { htf: '1w', ltf: '4h' }
};

window.FTI_Constants.AUTOLOAD_TF_LABEL = {
    '5m': '5m',
    '15m': '15m',
    '1h': '1H',
    '4h': '4H',
    '1d': '1D',
    '1w': '1W'
};

// Variantes de auditoría (requiere Icons cargado previamente)
window.FTI_Constants.getAuditVariants = function (Icons) {
    return {
        INSUFFICIENTE: {
            container: 'bg-slate-100 dark:bg-slate-900/40 border-slate-300 dark:border-slate-700 text-slate-600',
            message: 'Datos Insuficientes',
            icon: Icons.HelpCircle
        },
        FRAGIL: {
            container: 'bg-red-50 dark:bg-red-900/20 border-red-200 dark:border-red-800 text-red-600 dark:text-red-400',
            message: 'Estructura Frágil',
            icon: Icons.Activity
        },
        NEGATIVO: {
            container: 'bg-rose-50 dark:bg-rose-900/20 border-rose-200 dark:border-rose-800 text-rose-600 dark:text-rose-400',
            message: 'Edge Negativo',
            icon: Icons.AlertCircle
        },
        ESPECULATIVO: {
            container: 'bg-orange-50 dark:bg-orange-900/20 border-orange-200 dark:border-orange-800 text-orange-600 dark:text-orange-400',
            message: 'Edge Especulativo',
            icon: Icons.ShieldAlert
        },
        ROBUSTO: {
            container: 'bg-emerald-50 dark:bg-emerald-900/20 border-emerald-200 dark:border-emerald-800 text-emerald-600 dark:text-emerald-400',
            message: 'Edge Robusto',
            icon: Icons.ShieldCheck
        },
        DEFAULT: {
            container: 'bg-slate-50 dark:bg-slate-900/50 border-slate-200 dark:border-slate-800 text-slate-600 dark:text-slate-300',
            message: 'Sin evaluación aún',
            icon: Icons.Activity
        }
    };
};

// ============================================================
// SMART FETCH: Registro de datasets locales disponibles
// ============================================================

/**
 * Registro de archivos .mkt.gz locales disponibles.
 * Cada entrada define: symbol, interval, rango de años cubiertos, ruta y tipo de mercado.
 * Para agregar nuevos datasets, simplemente añadir objetos a este array.
 */
window.FTI_Constants.LOCAL_DATASETS = [
    {
        symbol: 'BTCUSDT',
        interval: '1d',
        startYear: 2017,
        endYear: 2025,
        path: 'datos/cripto/BITCOIN/BTCUSDT_1d_2017-2025.mkt.gz',
        market: 'crypto'
    },
    {
        symbol: 'BTCUSDT',
        interval: '4h',
        startYear: 2017,
        endYear: 2025,
        path: 'datos/cripto/BITCOIN/BTCUSDT_4h_2017-2025.mkt.gz',
        market: 'crypto'
    },
    {
        symbol: 'BTCUSDT',
        interval: '1w',
        startYear: 2017,
        endYear: 2025,
        path: 'datos/cripto/BITCOIN/BTCUSDT_1w_2017-2025.mkt.gz',
        market: 'crypto'
    }
];

/**
 * Busca un dataset local que coincida con los parámetros solicitados.
 * Soporta cobertura parcial: puede retornar un dataset que cubra parte del rango.
 * @param {string} symbol - Símbolo del activo (ej: 'BTCUSDT')
 * @param {string} interval - Intervalo temporal (ej: '1d', '4h', '1w')
 * @param {number} startMs - Timestamp de inicio en milisegundos
 * @param {number} endMs - Timestamp de fin en milisegundos
 * @returns {object} - Objeto con: dataset, coverage ('full'|'partial'|'none'), rangos
 */
window.FTI_Constants.findLocalDataset = function (symbol, interval, startMs, endMs) {
    const datasets = window.FTI_Constants.LOCAL_DATASETS || [];
    const noMatch = { dataset: null, coverage: 'none' };

    if (!symbol || !interval || !isFinite(startMs) || !isFinite(endMs)) return noMatch;

    const symbolUpper = String(symbol).toUpperCase().replace(/[^A-Z0-9]/g, '');
    const intervalLower = String(interval).toLowerCase();

    // Convertir timestamps a años para comparación inicial
    const requestStartYear = new Date(startMs).getUTCFullYear();
    const requestEndYear = new Date(endMs).getUTCFullYear();

    for (let i = 0; i < datasets.length; i++) {
        const ds = datasets[i];
        const dsSymbol = String(ds.symbol || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
        const dsInterval = String(ds.interval || '').toLowerCase();

        // Verificar coincidencia de símbolo e intervalo
        if (dsSymbol !== symbolUpper) continue;
        if (dsInterval !== intervalLower) continue;

        // Convertir años del dataset a timestamps (inicio del año y fin del año)
        const dsStartMs = new Date(Date.UTC(ds.startYear, 0, 1)).getTime();
        const dsEndMs = new Date(Date.UTC(ds.endYear, 11, 31, 23, 59, 59, 999)).getTime();

        // Calcular intersección
        const overlapStart = Math.max(startMs, dsStartMs);
        const overlapEnd = Math.min(endMs, dsEndMs);

        // ¿Hay alguna superposición?
        if (overlapEnd <= overlapStart) continue; // No hay overlap

        // Determinar tipo de cobertura
        const isFullCoverage = ds.startYear <= requestStartYear && ds.endYear >= requestEndYear;

        if (isFullCoverage) {
            // Cobertura completa: el dataset cubre todo el rango solicitado
            return {
                dataset: ds,
                coverage: 'full',
                localStartMs: startMs,
                localEndMs: endMs,
                apiStartMs: null,
                apiEndMs: null
            };
        } else {
            // Cobertura parcial: calcular qué parte va local y qué parte va API
            // Caso 1: Local cubre el inicio, API completa el final
            // Ejemplo: Dataset 2017-2025, Solicitud 2020-2026 → Local 2020-2025, API 2025-2026
            // Caso 2: Local cubre el final, API completa el inicio (menos común)

            let apiStartMs = null;
            let apiEndMs = null;

            // ¿Necesitamos datos ANTES del dataset local?
            if (startMs < dsStartMs) {
                apiStartMs = startMs;
                apiEndMs = dsStartMs;
            }

            // ¿Necesitamos datos DESPUÉS del dataset local?
            if (endMs > dsEndMs) {
                // Si ya hay un gap al inicio, combinamos (aunque es raro)
                if (apiStartMs !== null) {
                    // Caso complejo: gap al inicio Y al final
                    // Por simplicidad, en este caso usamos solo API
                    continue;
                }
                apiStartMs = dsEndMs;
                apiEndMs = endMs;
            }

            return {
                dataset: ds,
                coverage: 'partial',
                localStartMs: overlapStart,
                localEndMs: overlapEnd,
                apiStartMs,
                apiEndMs
            };
        }
    }

    return noMatch;
};

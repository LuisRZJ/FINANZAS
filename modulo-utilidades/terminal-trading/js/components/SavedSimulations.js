
window.SavedSimulations = ({
    savedSims,
    onRefresh,
    onEdit,
    onDelete
}) => {
    const Icons = window.FTI_Icons;

    return (
        <div className="max-w-5xl mx-auto animate-fade-in">
            <div className="text-center mb-8">
                <h2 className="text-2xl font-bold text-slate-800 dark:text-white mb-2">Simulaciones Guardadas</h2>
                <p className="text-slate-500 dark:text-slate-400">Resumen de métricas almacenadas en este equipo.</p>
            </div>
            <div className="flex justify-end mb-4">
                <button
                    onClick={onRefresh}
                    className="bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 px-4 py-2 rounded-lg text-sm font-medium border border-slate-200 dark:border-slate-700 transition-all shadow-sm"
                >
                    Actualizar lista
                </button>
            </div>
            {(!savedSims || savedSims.length === 0) ? (
                <div className="h-64 flex flex-col items-center justify-center text-slate-400 dark:text-slate-600 border-2 border-dashed border-slate-300 dark:border-slate-800 rounded-xl">
                    <Icons.Activity size={32} className="mb-2 opacity-50" />
                    <p className="text-sm">No hay simulaciones guardadas.</p>
                </div>
            ) : (
                <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
                    {savedSims.map(item => (
                        <div
                            key={item.id}
                            className="bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-800 shadow-sm overflow-hidden flex flex-col transition-all hover:shadow-md"
                        >
                            <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50/50 dark:bg-slate-800/30">
                                <div>
                                    <div className="text-lg font-bold text-slate-800 dark:text-white leading-tight">
                                        {item.name}
                                    </div>
                                    <div className="text-[10px] uppercase tracking-wider font-semibold text-slate-400 dark:text-slate-500 mt-1 flex items-center gap-1">
                                        <Icons.Calendar size={10} />
                                        {new Date(item.createdAt).toLocaleString()}
                                    </div>
                                </div>
                                <div className="flex items-center gap-2">
                                    <button
                                        onClick={() => onEdit(item.id)}
                                        className="p-2 text-slate-400 hover:text-indigo-600 dark:hover:text-indigo-400 transition-colors"
                                        title="Editar nombre"
                                    >
                                        <Icons.Edit2 size={16} />
                                    </button>
                                    <button
                                        onClick={() => onDelete(item.id)}
                                        className="p-2 text-slate-400 hover:text-red-600 dark:hover:text-red-400 transition-colors"
                                        title="Eliminar"
                                    >
                                        <Icons.Trash2 size={16} />
                                    </button>
                                </div>
                            </div>

                            <div className="p-5 space-y-5 flex-1">
                                {(() => {
                                    const ds = item.dataset || (item.rawExport && item.rawExport.dataset);
                                    if (!ds) return null;
                                    const candles = ds.candles != null ? ds.candles : ds.length;
                                    const tf = ds.tfMinutes != null ? `${ds.tfMinutes}m` : null;
                                    return (
                                        <div className="flex items-center justify-between text-[10px] text-slate-500 dark:text-slate-400">
                                            <div className="flex flex-col gap-1">
                                                {ds.fileName && (
                                                    <span className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate max-w-[180px]">
                                                        {ds.fileName}
                                                    </span>
                                                )}
                                                <div className="flex flex-wrap gap-1">
                                                    {tf && (
                                                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[9px] font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                            {tf}
                                                        </span>
                                                    )}
                                                    {candles != null && (
                                                        <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[9px] font-medium text-slate-600 dark:text-slate-300 border border-slate-200 dark:border-slate-700">
                                                            {candles} velas
                                                        </span>
                                                    )}
                                                    {ds.hasExtended && (
                                                        <span className="px-1.5 py-0.5 rounded bg-emerald-50 dark:bg-emerald-900/20 text-[9px] font-medium text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-700">
                                                            Datos extendidos
                                                        </span>
                                                    )}
                                                </div>
                                            </div>
                                        </div>
                                    );
                                })()}

                                <div className="flex items-end justify-between gap-4">
                                    <div className="flex-1">
                                        <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 mb-1">
                                            Rendimiento Principal
                                        </div>
                                        <div className="flex items-baseline gap-2">
                                            <span className="text-3xl font-black text-slate-800 dark:text-white">
                                                {item.metrics.winRate}%
                                            </span>
                                            <span className="text-sm font-bold text-slate-400 dark:text-slate-500">
                                                WR
                                            </span>
                                        </div>
                                    </div>
                                    <div className="text-right">
                                        <div className="text-[10px] uppercase font-bold text-slate-400 dark:text-slate-500 mb-1">
                                            Muestras
                                        </div>
                                        <div className="text-xl font-bold text-slate-700 dark:text-slate-300">
                                            {item.metrics.matches}{" "}
                                            <span className="text-xs font-normal text-slate-400">
                                                trades
                                            </span>
                                        </div>
                                    </div>
                                </div>

                                {item.walkForwardMetrics && (
                                    <div className="p-3 rounded-lg bg-indigo-50/50 dark:bg-indigo-900/10 border border-indigo-100 dark:border-indigo-900/30">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="text-[10px] uppercase font-bold text-indigo-600 dark:text-indigo-400 flex items-center gap-1">
                                                <Icons.Shield size={10} /> Validación Walk-Forward
                                            </div>
                                            <div
                                                className={`text-[10px] font-bold px-1.5 py-0.5 rounded-full ${
                                                    item.walkForwardMetrics.degradation < 20
                                                        ? "bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400"
                                                        : item.walkForwardMetrics.degradation < 50
                                                            ? "bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400"
                                                            : "bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400"
                                                }`}
                                            >
                                                {item.walkForwardMetrics.degradation}% DEGRADACIÓN
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-2 gap-4">
                                            <div>
                                                <div className="text-[9px] text-slate-500 uppercase font-semibold">
                                                    In-Sample (IS)
                                                </div>
                                                <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                                    WR: {item.walkForwardMetrics.inSample?.winRate}% · SQN:{" "}
                                                    {item.walkForwardMetrics.inSample?.sqn}
                                                </div>
                                            </div>
                                            <div className="text-right">
                                                <div className="text-[9px] text-slate-500 uppercase font-semibold">
                                                    Out-of-Sample (OOS)
                                                </div>
                                                <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                                    WR: {item.walkForwardMetrics.outOfSample?.winRate}% · SQN:{" "}
                                                    {item.walkForwardMetrics.outOfSample?.sqn}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                {item.monteCarlo && (
                                    <div className="p-3 rounded-lg bg-purple-50/50 dark:bg-purple-900/10 border border-purple-100 dark:border-purple-900/30">
                                        <div className="flex items-center justify-between mb-2">
                                            <div className="text-[10px] uppercase font-bold text-purple-600 dark:text-purple-400 flex items-center gap-1">
                                                <Icons.Activity size={10} /> Monte Carlo
                                            </div>
                                            <div className="text-[10px] text-slate-500 dark:text-slate-400">
                                                {item.monteCarlo.simCount && item.monteCarlo.simCount.toLocaleString
                                                    ? item.monteCarlo.simCount.toLocaleString()
                                                    : item.monteCarlo.simCount}{" "}
                                                simulaciones
                                            </div>
                                        </div>
                                        <div className="grid grid-cols-3 gap-3 text-[11px]">
                                            <div>
                                                <div className="text-slate-400">Prob. Ruina</div>
                                                <div className="font-mono font-bold text-slate-700 dark:text-slate-200">
                                                    {item.monteCarlo.ruinProbability != null ? item.monteCarlo.ruinProbability.toFixed(1) : "—"}%
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-slate-400">Peor DD</div>
                                                <div className="font-mono font-bold text-slate-700 dark:text-slate-200">
                                                    {item.monteCarlo.worstDrawdown != null ? item.monteCarlo.worstDrawdown.toFixed(1) : "—"}%
                                                </div>
                                            </div>
                                            <div>
                                                <div className="text-slate-400">Equity P50</div>
                                                <div className="font-mono font-bold text-slate-700 dark:text-slate-200">
                                                    {item.monteCarlo.equityPercentiles && item.monteCarlo.equityPercentiles.p50 != null
                                                        ? item.monteCarlo.equityPercentiles.p50.toFixed(0)
                                                        : "—"}
                                                </div>
                                            </div>
                                        </div>
                                    </div>
                                )}

                                <div className="grid grid-cols-3 gap-3">
                                    <div className="space-y-1">
                                        <div className="text-[9px] uppercase font-bold text-slate-400 dark:text-slate-500">
                                            Riesgo (MAE)
                                        </div>
                                        <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                            Max: {item.metrics.maxMae}%
                                        </div>
                                        <div className="text-[10px] text-slate-500">
                                            Avg: {item.metrics.avgMae}%
                                        </div>
                                    </div>
                                    <div className="space-y-1">
                                        <div className="text-[9px] uppercase font-bold text-slate-400 dark:text-slate-500">
                                            Esfuerzo
                                        </div>
                                        <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                            Pain: {item.metrics.painRatio}%
                                        </div>
                                        <div className="text-[10px] text-slate-500">
                                            Dist: {item.metrics.riskDistPercent}%
                                        </div>
                                    </div>
                                    <div className="space-y-1 text-right">
                                        <div className="text-[9px] uppercase font-bold text-slate-400 dark:text-slate-500">
                                            Tiempo
                                        </div>
                                        <div className="text-xs font-bold text-slate-700 dark:text-slate-300">
                                            {item.metrics.avgDuration} velas
                                        </div>
                                        <div className="text-[10px] text-slate-500">
                                            promedio
                                        </div>
                                    </div>
                                </div>

                                {item.targetCandle && (
                                    <details className="group border border-slate-100 dark:border-slate-800 rounded-lg overflow-hidden">
                                        <summary className="list-none p-2 bg-slate-50 dark:bg-slate-800/50 text-[10px] font-bold text-slate-500 dark:text-slate-400 cursor-pointer flex items-center justify-between hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors">
                                            <span className="flex items-center gap-1.5">
                                                <Icons.Eye size={12} /> CONTEXTO DE MERCADO
                                            </span>
                                            <Icons.ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
                                        </summary>
                                        <div className="p-3 grid grid-cols-2 gap-y-2 text-[11px] border-t border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900/50">
                                            <div className="col-span-2 text-slate-400 mb-1 border-b border-slate-50 dark:border-slate-800 pb-1 flex justify-between items-center">
                                                <div>
                                                    Vela:{" "}
                                                    <span className="font-mono text-slate-600 dark:text-slate-300">
                                                        {item.targetCandle.datetime}
                                                    </span>
                                                </div>
                                                {item.params && (
                                                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-semibold">
                                                        {item.params.tradeType === "LONG" ? "Largo" : item.params.tradeType === "SHORT" ? "Corto" : item.params.tradeType}
                                                    </div>
                                                )}
                                            </div>
                                            <div className="flex justify-between px-1">
                                                <span className="text-slate-400">Precio:</span>
                                                <span className="font-bold text-slate-700 dark:text-slate-200">
                                                    {item.targetCandle.close}
                                                </span>
                                            </div>
                                            <div className="flex justify-between px-1">
                                                <span className="text-slate-400">RSI:</span>
                                                <span className="font-bold text-slate-700 dark:text-slate-200">
                                                    {item.targetCandle.rsi?.toFixed(1) || "—"}
                                                </span>
                                            </div>
                                            <div className="flex justify-between px-1">
                                                <span className="text-slate-400">SMA200:</span>
                                                <span
                                                    className={`font-bold ${
                                                        item.targetCandle.close > item.targetCandle.sma200
                                                            ? "text-green-500"
                                                            : "text-red-500"
                                                    }`}
                                                >
                                                    {item.targetCandle.close > item.targetCandle.sma200 ? "Encima" : "Debajo"}
                                                </span>
                                            </div>
                                            <div className="flex justify-between px-1">
                                                <span className="text-slate-400">Volatilidad:</span>
                                                <span className="font-bold text-slate-700 dark:text-slate-200">
                                                    {item.targetCandle.bodySizePct?.toFixed(2)}%
                                                </span>
                                            </div>
                                            {item.params && (
                                                <>
                                                    <div className="flex justify-between px-1 col-span-2">
                                                        <span className="text-slate-400">Entrada:</span>
                                                        <span className="font-mono font-bold text-slate-700 dark:text-slate-200">
                                                            {item.params.entryPrice != null ? item.params.entryPrice : "—"}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between px-1">
                                                        <span className="text-slate-400">Stop Loss:</span>
                                                        <span className="font-mono font-bold text-red-600 dark:text-red-400">
                                                            {item.params.stopLoss != null ? item.params.stopLoss : "—"}
                                                        </span>
                                                    </div>
                                                    <div className="flex justify-between px-1">
                                                        <span className="text-slate-400">Take Profit:</span>
                                                        <span className="font-mono font-bold text-green-600 dark:text-green-400">
                                                            {item.params.takeProfit != null ? item.params.takeProfit : "—"}
                                                        </span>
                                                    </div>
                                                </>
                                            )}
                                        </div>
                                    </details>
                                )}

                                <div className="flex flex-wrap gap-1.5 pt-2">
                                    {item.params && (
                                        <>
                                            <span className="px-1.5 py-0.5 rounded bg-slate-100 dark:bg-slate-800 text-[9px] font-bold text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                                                {item.params.tradeType}
                                            </span>
                                            {item.params.rsi?.useRsiFilter && (
                                                <span className="px-1.5 py-0.5 rounded bg-purple-50 dark:bg-purple-900/20 text-[9px] font-medium text-purple-600 dark:text-purple-400 border border-purple-100 dark:border-purple-800/50">
                                                    RSI
                                                </span>
                                            )}
                                            {item.params.trend?.useTrendFilter && (
                                                <span className="px-1.5 py-0.5 rounded bg-indigo-50 dark:bg-indigo-900/20 text-[9px] font-medium text-indigo-600 dark:text-indigo-400 border border-indigo-100 dark:border-indigo-800/50">
                                                    Trend
                                                </span>
                                            )}
                                            {item.params.time?.useTimeFilter && (
                                                <span className="px-1.5 py-0.5 rounded bg-amber-50 dark:bg-amber-900/20 text-[9px] font-medium text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-800/50">
                                                    Time
                                                </span>
                                            )}
                                            {item.params.volBody?.useVolFilter && (
                                                <span className="px-1.5 py-0.5 rounded bg-rose-50 dark:bg-rose-900/20 text-[9px] font-medium text-rose-600 dark:text-rose-400 border border-rose-100 dark:border-rose-800/50">
                                                    Vol
                                                </span>
                                            )}
                                            {item.params.mtf?.useHtfFilter && (
                                                <span className="px-1.5 py-0.5 rounded bg-cyan-50 dark:bg-cyan-900/20 text-[9px] font-medium text-cyan-600 dark:text-cyan-400 border border-cyan-100 dark:border-cyan-800/50">
                                                    HTF
                                                </span>
                                            )}
                                            {item.params.mtf?.useLtfIntra && (
                                                <span className="px-1.5 py-0.5 rounded bg-teal-50 dark:bg-teal-900/20 text-[9px] font-medium text-teal-600 dark:text-teal-400 border border-teal-100 dark:border-teal-800/50">
                                                    LTF
                                                </span>
                                            )}
                                        </>
                                    )}
                                </div>

                                {item.rawExport && (
                                    <details className="mt-3 border border-slate-100 dark:border-slate-800 rounded-lg bg-slate-50/60 dark:bg-slate-900/40">
                                        <summary className="list-none px-2 py-1.5 text-[10px] font-bold text-slate-500 dark:text-slate-400 cursor-pointer flex items-center justify-between">
                                            <span>Datos completos (RAW)</span>
                                            <Icons.ChevronDown size={12} className="group-open:rotate-180 transition-transform" />
                                        </summary>
                                        <pre className="p-2 text-[10px] font-mono text-slate-600 dark:text-slate-300 max-h-64 overflow-auto bg-white/70 dark:bg-slate-950/60 border-t border-slate-100 dark:border-slate-800 whitespace-pre-wrap break-all">
                                            {JSON.stringify(item.rawExport, null, 2)}
                                        </pre>
                                    </details>
                                )}
                            </div>
                        </div>
                    ))}
                </div>
            )}
        </div>
    );
};

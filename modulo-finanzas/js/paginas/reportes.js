
import { listarOperaciones } from '../servicios/operaciones.js';
import { listarEtiquetas } from '../servicios/etiquetas.js';
import { listarCuentas } from '../servicios/cuentas.js';
import { formatoMoneda } from '../utilidades/formato.js';

let chartEvolution = null;
let chartCategories = null;
let chartIncomeCategories = null;
let chartBalanceHistory = null;
let chartProjection = null;
let chartBalanceMode = 'lineal'; // 'lineal' or 'barras'
let showSMA = false; // Control para mostrar SMA 30d
let showBollinger = false; // Control para mostrar Bandas de Bollinger

// Initialize
document.addEventListener('DOMContentLoaded', () => {
    inicializarEventos();
    // El click simulado en inicializarEventos() carga los datos
});

let currentPeriodo = 'semana'; // Track current period
let periodOffset = 0; // 0 = actual, -1 = anterior, etc.

function inicializarEventos() {
    const botones = document.querySelectorAll('[data-period]');
    botones.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Update UI active state
            botones.forEach(b => {
                b.classList.remove('bg-gray-100', 'dark:bg-gray-700', 'text-gray-900', 'dark:text-white');
                b.classList.add('text-gray-500', 'dark:text-gray-400');
            });
            e.target.classList.remove('text-gray-500', 'dark:text-gray-400');
            e.target.classList.add('bg-gray-100', 'dark:bg-gray-700', 'text-gray-900', 'dark:text-white');

            // Reset offset when changing period type
            periodOffset = 0;
            currentPeriodo = e.target.dataset.period;
            cargarDatos(currentPeriodo);
        });
    });

    // Toggle para modo de gráfico (Lineal / Barras)
    const modeButtons = document.querySelectorAll('[data-chart-mode]');
    const toggleSMA = document.getElementById('toggle-sma');
    const toggleBollinger = document.getElementById('toggle-bollinger');

    modeButtons.forEach(btn => {
        btn.addEventListener('click', (e) => {
            // Update UI active state
            modeButtons.forEach(b => {
                b.classList.remove('bg-white', 'dark:bg-gray-600', 'text-gray-900', 'dark:text-white', 'shadow-sm');
                b.classList.add('text-gray-500', 'dark:text-gray-400');
            });
            e.target.classList.remove('text-gray-500', 'dark:text-gray-400');
            e.target.classList.add('bg-white', 'dark:bg-gray-600', 'text-gray-900', 'dark:text-white', 'shadow-sm');

            // Change mode and re-render
            chartBalanceMode = e.target.dataset.chartMode;

            // Habilitar/deshabilitar switches de indicadores según el modo
            const isLineal = chartBalanceMode === 'lineal';
            if (toggleSMA) toggleSMA.disabled = !isLineal;
            if (toggleBollinger) toggleBollinger.disabled = !isLineal;

            const operaciones = listarOperaciones();
            actualizarGraficoBalanceHistorico(operaciones, currentPeriodo);
        });
    });

    // Navegación temporal (flechas < >)
    const btnPrev = document.getElementById('btn-prev-period');
    const btnNext = document.getElementById('btn-next-period');

    if (btnPrev) {
        btnPrev.addEventListener('click', () => {
            periodOffset--;
            cargarDatos(currentPeriodo);
        });
    }

    if (btnNext) {
        btnNext.addEventListener('click', () => {
            if (periodOffset < 0) {
                periodOffset++;
                cargarDatos(currentPeriodo);
            }
        });
    }

    // Indicadores Técnicos (SMA y Bollinger)
    // Nota: toggleSMA y toggleBollinger ya están declarados arriba en la sección de modo gráfico

    if (toggleSMA) {
        toggleSMA.addEventListener('change', (e) => {
            showSMA = e.target.checked;
            // Optimización: solo redibujar el gráfico de balance, no todos los reportes
            actualizarGraficoBalanceHistorico(listarOperaciones(), currentPeriodo);
        });
    }

    if (toggleBollinger) {
        toggleBollinger.addEventListener('change', (e) => {
            showBollinger = e.target.checked;
            // Optimización: solo redibujar el gráfico de balance, no todos los reportes
            actualizarGraficoBalanceHistorico(listarOperaciones(), currentPeriodo);
        });
    }

    // Set default active
    const defaultBtn = document.querySelector('[data-period="semana"]');
    if (defaultBtn) {
        defaultBtn.click();
    }
}

function cargarDatos(periodo) {
    const operaciones = listarOperaciones();
    const etiquetas = listarEtiquetas();

    // Filter by period
    const filteredOps = filtrarOperacionesPorPeriodo(operaciones, periodo);

    // Calculate Summary
    actualizarResumen(filteredOps, periodo);

    // Update Charts
    actualizarGraficoEvolucion(filteredOps);
    actualizarGraficoCategorias(filteredOps, etiquetas);
    actualizarGraficoIngresos(filteredOps, etiquetas);
    actualizarGraficoBalanceHistorico(operaciones, periodo); // Usa TODAS las operaciones para calcular balance inicial
    actualizarProyeccionFinanciera(operaciones, periodo);
    actualizarMaximosMinimos(filteredOps);
}

function calcularRangoPeriodo(periodo, offset = 0) {
    const now = new Date();
    let start, end, label;

    if (periodo === 'semana') {
        // Calcular lunes de la semana actual
        const dayOfWeek = now.getDay();
        const diffToMon = dayOfWeek === 0 ? 6 : dayOfWeek - 1;
        const monday = new Date(now);
        monday.setDate(now.getDate() - diffToMon);
        monday.setHours(0, 0, 0, 0);

        // Aplicar offset (cada offset = 7 días atrás)
        start = new Date(monday);
        start.setDate(start.getDate() + (offset * 7));

        end = new Date(start);
        end.setDate(end.getDate() + 6);
        end.setHours(23, 59, 59, 999);

        // Si es periodo actual, end es hoy
        if (offset === 0) {
            end = new Date(now);
        }

        // Formato de etiqueta
        const opts = { day: 'numeric', month: 'short', year: 'numeric' };
        label = `${start.toLocaleDateString('es-ES', opts)} - ${end.toLocaleDateString('es-ES', opts)}`;

    } else if (periodo === 'mes') {
        // Calcular mes con offset
        const targetMonth = new Date(now.getFullYear(), now.getMonth() + offset, 1);
        start = new Date(targetMonth.getFullYear(), targetMonth.getMonth(), 1);

        if (offset === 0) {
            end = new Date(now);
        } else {
            end = new Date(targetMonth.getFullYear(), targetMonth.getMonth() + 1, 0, 23, 59, 59, 999);
        }

        const monthNames = ['Enero', 'Febrero', 'Marzo', 'Abril', 'Mayo', 'Junio', 'Julio', 'Agosto', 'Septiembre', 'Octubre', 'Noviembre', 'Diciembre'];
        label = `${monthNames[start.getMonth()]} ${start.getFullYear()}`;

    } else if (periodo === 'anio') {
        const targetYear = now.getFullYear() + offset;
        start = new Date(targetYear, 0, 1);

        if (offset === 0) {
            end = new Date(now);
        } else {
            end = new Date(targetYear, 11, 31, 23, 59, 59, 999);
        }

        label = `Año ${targetYear}`;

    } else { // 'todo'
        // Usar la fecha de la primera operación o hace 1 año si no hay
        const todasOps = listarOperaciones();
        if (todasOps.length > 0) {
            const fechas = todasOps.map(op => {
                const fechaNormalizada = op.fecha.includes('T') ? op.fecha : op.fecha + 'T00:00:00';
                return new Date(fechaNormalizada);
            });
            const minFecha = new Date(Math.min(...fechas));
            start = minFecha;
        } else {
            start = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        }
        end = new Date(now);
        label = 'Todo el Historial';
    }

    return { start, end, label };
}

function filtrarOperacionesPorPeriodo(operaciones, periodo) {
    const rango = calcularRangoPeriodo(periodo, periodOffset);

    // Actualizar UI de navegación
    const labelEl = document.getElementById('period-label');
    if (labelEl) {
        labelEl.innerHTML = `<span class="text-sm font-semibold text-gray-900 dark:text-white">${rango.label}</span>`;
    }

    // Habilitar/deshabilitar botón siguiente
    const btnNext = document.getElementById('btn-next-period');
    if (btnNext) {
        btnNext.disabled = (periodOffset >= 0);
    }

    // Ocultar navegación si periodo es 'todo'
    const navContainer = document.getElementById('btn-prev-period')?.parentElement;
    if (navContainer) {
        navContainer.style.display = periodo === 'todo' ? 'none' : 'flex';
    }

    return operaciones.filter(op => {
        // Soportar formato nuevo (YYYY-MM-DDTHH:MM) y antiguo (YYYY-MM-DD)
        const fechaStr = op.fecha.includes('T') ? op.fecha : op.fecha + 'T00:00:00'
        const fechaOp = new Date(fechaStr)
        return fechaOp >= rango.start && fechaOp <= rango.end
    })
}

function actualizarResumen(operaciones, periodo) {
    let ingresos = 0;
    let gastos = 0;

    operaciones.forEach(op => {
        if (op.tipo === 'ingreso') ingresos += Number(op.cantidad);
        if (op.tipo === 'gasto') gastos += Number(op.cantidad);
    });

    let balance;
    if (periodo === 'todo') {
        const cuentas = listarCuentas();
        balance = cuentas.reduce((acc, c) => acc + Number(c.dinero || 0), 0);
    } else {
        balance = ingresos - gastos;
    }

    document.getElementById('stat-balance').textContent = formatoMoneda(balance);
    document.getElementById('stat-ingresos').textContent = formatoMoneda(ingresos);
    document.getElementById('stat-gastos').textContent = formatoMoneda(gastos);

    // Color balance logic
    const balanceEl = document.getElementById('stat-balance');
    balanceEl.classList.remove('text-green-600', 'dark:text-green-400', 'text-red-600', 'dark:text-red-400', 'text-gray-900', 'dark:text-white');
    if (balance > 0) balanceEl.classList.add('text-green-600', 'dark:text-green-400');
    else if (balance < 0) balanceEl.classList.add('text-red-600', 'dark:text-red-400');
    else balanceEl.classList.add('text-gray-900', 'dark:text-white');

    // === Comparativa Periodo Anterior ===
    let etiquetasComparacion = { balance: null, ingresos: null, gastos: null };

    if (periodo !== 'todo') {
        // Usar calcularRangoPeriodo con offset - 1 para el periodo anterior
        const rangoPrev = calcularRangoPeriodo(periodo, periodOffset - 1);
        const startPrev = rangoPrev.start;
        const endPrev = rangoPrev.end;

        // Calcular totales previos
        let ingresosPrev = 0;
        let gastosPrev = 0;
        const todasOps = listarOperaciones();
        todasOps.forEach(op => {
            const fechaNormalizada = op.fecha.includes('T') ? op.fecha : op.fecha + 'T00:00:00';
            const d = new Date(fechaNormalizada);
            if (d >= startPrev && d <= endPrev) {
                if (op.tipo === 'ingreso') ingresosPrev += Number(op.cantidad);
                if (op.tipo === 'gasto') gastosPrev += Number(op.cantidad);
            }
        });
        const balancePrev = ingresosPrev - gastosPrev;

        // Calcular porcentajes
        const calcPercent = (curr, prev) => {
            if (prev === 0) return curr === 0 ? 0 : 100;
            return ((curr - prev) / prev) * 100;
        };

        const pBalance = calcPercent(balance, balancePrev);
        const pIngresos = calcPercent(ingresos, ingresosPrev);
        const pGastos = calcPercent(gastos, gastosPrev);

        // Helper para generar HTML de badge
        const renderBadge = (percent, isExpense = false) => {
            const isPositive = percent > 0;
            const isZero = percent === 0;
            const sign = isPositive ? '+' : '';
            const fixed = percent.toFixed(1) + '%';

            // Colores
            let colorClass = '';
            if (isZero) colorClass = 'bg-gray-100 text-gray-500 dark:bg-gray-700 dark:text-gray-400';
            else if (isExpense) {
                // Gastos: Más es malo (rojo), menos es bueno (verde)
                colorClass = isPositive
                    ? 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400'
                    : 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400';
            } else {
                // Balance/Ingresos: Más es bueno (verde), menos es malo (rojo)
                colorClass = isPositive
                    ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400'
                    : 'bg-red-100 text-red-700 dark:bg-red-900/30 dark:text-red-400';
            }

            return { html: `${sign}${fixed}`, classes: colorClass };
        };

        const bData = renderBadge(pBalance);
        const iData = renderBadge(pIngresos);
        const gData = renderBadge(pGastos, true);

        const updateBadge = (id, data) => {
            const el = document.getElementById(id);
            el.textContent = data.html;
            el.className = `text-xs font-medium px-2 py-0.5 rounded-full ${data.classes}`;
            el.classList.remove('hidden');
        };

        updateBadge('stat-trend-balance', bData);
        updateBadge('stat-trend-ingresos', iData);
        updateBadge('stat-trend-gastos', gData);
    } else {
        // Ocultar si es 'todo'
        ['stat-trend-balance', 'stat-trend-ingresos', 'stat-trend-gastos'].forEach(id => {
            document.getElementById(id).classList.add('hidden');
        });
    }

    // === Promedios Diarios ===
    const now = new Date();
    let diasTranscurridos = 1;

    if (periodo === 'semana') {
        // Days since Monday (inclusive)
        const dayOfWeek = now.getDay(); // 0 (Sun) - 6 (Sat)
        // If today is Monday (1), 1 day. If Sunday (0), 7 days.
        diasTranscurridos = dayOfWeek === 0 ? 7 : dayOfWeek;
    } else if (periodo === 'mes') {
        diasTranscurridos = now.getDate(); // Días del mes (hoy es 17, entonces 17 días)
    } else if (periodo === 'anio') {
        const startOfYear = new Date(now.getFullYear(), 0, 1);
        const diff = now - startOfYear;
        diasTranscurridos = Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
    } else {
        // Todo: Calcular desde la primera operación
        if (operaciones.length > 0) {
            const firstOp = operaciones.reduce((min, op) => op.fecha < min ? op.fecha : min, now.toISOString().split('T')[0]);
            const start = new Date(firstOp);
            const diff = now - start;
            const days = Math.floor(diff / (1000 * 60 * 60 * 24));
            diasTranscurridos = days > 0 ? days : 1;
        }
    }

    const promIngreso = ingresos / diasTranscurridos;
    const promGasto = gastos / diasTranscurridos;
    const promBalance = balance / diasTranscurridos; // PNL Diario

    document.getElementById('stat-ingresos-daily').innerHTML = `Promedio diario: <span class="text-green-600 dark:text-green-400 font-semibold">${formatoMoneda(promIngreso)}</span>`;
    document.getElementById('stat-gastos-daily').innerHTML = `Promedio diario: <span class="text-red-600 dark:text-red-400 font-semibold">${formatoMoneda(promGasto)}</span>`;

    const elBalanceDaily = document.getElementById('stat-balance-daily');
    let colorClass = 'text-gray-500';
    if (promBalance > 0) colorClass = 'text-green-600 dark:text-green-400 font-semibold';
    else if (promBalance < 0) colorClass = 'text-red-600 dark:text-red-400 font-semibold';

    elBalanceDaily.innerHTML = `PNL Medio Diario: <span class="${colorClass}">${formatoMoneda(promBalance)}</span>`;
}

function calcularPnLPorRango(operaciones, start, end) {
    let pnl = 0;
    operaciones.forEach(op => {
        const fechaStr = op.fecha.includes('T') ? op.fecha : op.fecha + 'T00:00:00';
        const fechaOp = new Date(fechaStr);
        if (fechaOp >= start && fechaOp <= end) {
            if (op.tipo === 'ingreso') pnl += Number(op.cantidad);
            if (op.tipo === 'gasto') pnl -= Number(op.cantidad);
        }
    });
    return pnl;
}

function obtenerDiasPeriodo(periodo, referenciaFecha) {
    if (periodo === 'semana') return 7;
    if (periodo === 'mes') {
        return new Date(referenciaFecha.getFullYear(), referenciaFecha.getMonth() + 1, 0).getDate();
    }
    if (periodo === 'anio') {
        const inicio = new Date(referenciaFecha.getFullYear(), 0, 1);
        const fin = new Date(referenciaFecha.getFullYear(), 11, 31);
        const diff = fin - inicio;
        return Math.floor(diff / (1000 * 60 * 60 * 24)) + 1;
    }
    return 30;
}

function calcularPnLPromedioTresPeriodos(operaciones, periodo) {
    const periodoBase = periodo === 'todo' ? 'mes' : periodo;
    const offsets = [periodOffset, periodOffset - 1, periodOffset - 2];
    let suma = 0;
    offsets.forEach(offset => {
        const rango = calcularRangoPeriodo(periodoBase, offset);
        suma += calcularPnLPorRango(operaciones, rango.start, rango.end);
    });
    return { pnlPromedio: suma / 3, periodoBase };
}

function actualizarProyeccionFinanciera(operaciones, periodo) {
    const canvas = document.getElementById('chart-projection-year');
    const statEl = document.getElementById('stat-run-rate');
    const finalEl = document.getElementById('stat-projection-final');
    const growthEl = document.getElementById('stat-projection-growth');
    if (!canvas || !statEl || !finalEl || !growthEl) return;

    const { pnlPromedio, periodoBase } = calcularPnLPromedioTresPeriodos(operaciones, periodo);
    const rangoActual = calcularRangoPeriodo(periodoBase, periodOffset);
    const diasPeriodo = obtenerDiasPeriodo(periodoBase, rangoActual.start);
    const pnlDiario = pnlPromedio / (diasPeriodo || 1);

    const cuentas = listarCuentas();
    const saldoActual = cuentas.reduce((acc, c) => acc + Number(c.dinero || 0), 0);
    const saldoFinal = saldoActual + (pnlDiario * 365);
    const porcentajeCrecimiento = saldoActual === 0 ? 0 : ((saldoFinal - saldoActual) / Math.abs(saldoActual)) * 100;

    const labels = [];
    const data = [];
    const hoy = new Date();
    hoy.setHours(0, 0, 0, 0);
    for (let i = 0; i <= 365; i++) {
        const d = new Date(hoy);
        d.setDate(hoy.getDate() + i);
        labels.push(d.toISOString().split('T')[0]);
        data.push(saldoActual + (pnlDiario * i));
    }

    statEl.textContent = formatoMoneda(pnlPromedio);
    statEl.classList.remove('text-green-600', 'dark:text-green-400', 'text-red-600', 'dark:text-red-400', 'text-gray-900', 'dark:text-white');
    if (pnlPromedio > 0) statEl.classList.add('text-green-600', 'dark:text-green-400');
    else if (pnlPromedio < 0) statEl.classList.add('text-red-600', 'dark:text-red-400');
    else statEl.classList.add('text-gray-900', 'dark:text-white');

    finalEl.textContent = formatoMoneda(saldoFinal);
    finalEl.classList.remove('text-green-600', 'dark:text-green-400', 'text-red-600', 'dark:text-red-400', 'text-gray-900', 'dark:text-white');
    if (saldoFinal > saldoActual) finalEl.classList.add('text-green-600', 'dark:text-green-400');
    else if (saldoFinal < saldoActual) finalEl.classList.add('text-red-600', 'dark:text-red-400');
    else finalEl.classList.add('text-gray-900', 'dark:text-white');

    const growthLabel = `${porcentajeCrecimiento >= 0 ? '+' : ''}${porcentajeCrecimiento.toFixed(1)}%`;
    growthEl.textContent = growthLabel;
    growthEl.classList.remove('text-green-600', 'dark:text-green-400', 'text-red-600', 'dark:text-red-400', 'text-gray-900', 'dark:text-white');
    if (porcentajeCrecimiento > 0) growthEl.classList.add('text-green-600', 'dark:text-green-400');
    else if (porcentajeCrecimiento < 0) growthEl.classList.add('text-red-600', 'dark:text-red-400');
    else growthEl.classList.add('text-gray-900', 'dark:text-white');

    const ctx = canvas.getContext('2d');
    if (chartProjection) chartProjection.destroy();
    const lineColor = pnlDiario >= 0 ? '#10b981' : '#ef4444';
    const areaColor = pnlDiario >= 0 ? 'rgba(16, 185, 129, 0.15)' : 'rgba(239, 68, 68, 0.15)';

    chartProjection = new Chart(ctx, {
        type: 'line',
        data: {
            labels,
            datasets: [{
                label: 'Proyección de saldo',
                data,
                borderColor: lineColor,
                backgroundColor: areaColor,
                fill: true,
                tension: 0.3,
                pointRadius: labels.length > 60 ? 0 : 2,
                pointHoverRadius: 4
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: 'rgba(156, 163, 175, 0.1)' }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        maxTicksLimit: 10
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return formatoMoneda(context.parsed.y);
                        }
                    }
                }
            }
        }
    });
}

function actualizarGraficoEvolucion(operaciones) {
    const ctx = document.getElementById('chart-evolution').getContext('2d');

    // Group by date
    const grouped = {};
    operaciones.forEach(op => {
        const date = op.fecha.split('T')[0]; // Normalizar a YYYY-MM-DD
        if (!grouped[date]) grouped[date] = { ingresos: 0, gastos: 0 };

        if (op.tipo === 'ingreso') grouped[date].ingresos += Number(op.cantidad);
        if (op.tipo === 'gasto') grouped[date].gastos += Number(op.cantidad);
    });

    const labels = Object.keys(grouped).sort();
    const dataIngresos = labels.map(date => grouped[date].ingresos);
    const dataGastos = labels.map(date => grouped[date].gastos);

    // Calcular Balance Neto del Periodo
    const totalIngresos = dataIngresos.reduce((a, b) => a + b, 0);
    const totalGastos = dataGastos.reduce((a, b) => a + b, 0);
    const balanceNeto = totalIngresos - totalGastos;

    const elBalanceEvolution = document.getElementById('total-balance-evolution');
    elBalanceEvolution.textContent = formatoMoneda(balanceNeto);

    // Color condicional
    elBalanceEvolution.classList.remove('text-green-600', 'dark:text-green-400', 'text-red-600', 'dark:text-red-400', 'text-gray-900', 'dark:text-white');
    if (balanceNeto > 0) elBalanceEvolution.classList.add('text-green-600', 'dark:text-green-400');
    else if (balanceNeto < 0) elBalanceEvolution.classList.add('text-red-600', 'dark:text-red-400');
    else elBalanceEvolution.classList.add('text-gray-900', 'dark:text-white');

    if (chartEvolution) chartEvolution.destroy();

    chartEvolution = new Chart(ctx, {
        type: 'bar',
        data: {
            labels: labels,
            datasets: [
                {
                    label: 'Ingresos',
                    data: dataIngresos,
                    backgroundColor: '#10b981', // green-500
                    borderRadius: 4,
                },
                {
                    label: 'Gastos',
                    data: dataGastos,
                    backgroundColor: '#ef4444', // red-500
                    borderRadius: 4,
                }
            ]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: true,
                    grid: { color: 'rgba(156, 163, 175, 0.1)' }
                },
                x: {
                    grid: { display: false }
                }
            },
            plugins: {
                legend: { position: 'bottom' }
            }
        }
    });
}

function actualizarGraficoCategorias(operaciones, etiquetas) {
    const ctx = document.getElementById('chart-categories').getContext('2d');

    // Filter only expenses
    const gastos = operaciones.filter(op => op.tipo === 'gasto');

    // Group by etiqueta
    const grouped = {};
    // Agrupar por etiqueta PADRE
    gastos.forEach(op => {
        let tagId = op.etiquetaId;
        const tag = etiquetas.find(t => t.id === tagId);

        // Si es subetiqueta y tiene padre válido, usar el padre
        if (tag && tag.padreId) {
            const padre = etiquetas.find(p => p.id === tag.padreId);
            if (padre) {
                tagId = padre.id;
            }
        }

        if (!grouped[tagId]) grouped[tagId] = 0;
        grouped[tagId] += Number(op.cantidad);
    });

    const labels = [];
    const data = [];
    const colors = [];

    // Map IDs to Names and Colors
    Object.keys(grouped).forEach(tagId => {
        const tag = etiquetas.find(t => t.id === tagId);
        labels.push(tag ? tag.nombre : 'Sin etiqueta');
        colors.push(tag ? tag.color : '#94a3b8'); // Default slate-400
        data.push(grouped[tagId]);
    });

    if (chartCategories) chartCategories.destroy();

    // If no data, clear chart and legend
    if (data.length === 0) {
        document.getElementById('total-expense-chart').textContent = formatoMoneda(0);
        const legendContainer = document.getElementById('legend-expense-categories');
        legendContainer.innerHTML = '<p class="text-sm text-gray-400 italic text-center py-4">Sin gastos en este periodo</p>';
        return;
    }

    chartCategories = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false } // Ocultar leyenda por defecto de Chart.js
            },
            cutout: '70%' // Hacer el anillo más delgado
        }
    });

    // === Renderizar Leyenda Detallada para Gastos ===
    const total = data.reduce((a, b) => a + b, 0);
    document.getElementById('total-expense-chart').textContent = formatoMoneda(total);

    const legendContainer = document.getElementById('legend-expense-categories');
    legendContainer.innerHTML = '';

    // Crear array de objetos para ordenar
    const items = labels.map((label, i) => ({
        label,
        value: data[i],
        color: colors[i],
        percent: total > 0 ? (data[i] / total) * 100 : 0
    })).sort((a, b) => b.value - a.value); // Ordenar mayor a menor

    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between text-sm py-1 border-b border-gray-100 dark:border-gray-700 last:border-0';
        row.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="w-3 h-3 rounded-full" style="background-color: ${item.color}"></span>
                <span class="text-gray-700 dark:text-gray-300 font-medium truncate max-w-[120px]" title="${item.label}">${item.label}</span>
                <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">${item.percent.toFixed(1)}%</span>
            </div>
            <span class="font-semibold text-gray-900 dark:text-white tabular-nums">${formatoMoneda(item.value)}</span>
        `;
        legendContainer.appendChild(row);
    });
}

function actualizarGraficoIngresos(operaciones, etiquetas) {
    const ctx = document.getElementById('chart-income-categories').getContext('2d');

    // Filter only income
    const ingresos = operaciones.filter(op => op.tipo === 'ingreso');

    // Group by etiqueta
    const grouped = {};
    ingresos.forEach(op => {
        let tagId = op.etiquetaId;
        const tag = etiquetas.find(t => t.id === tagId);

        // Si es subetiqueta y tiene padre válido, usar el padre
        if (tag && tag.padreId) {
            const padre = etiquetas.find(p => p.id === tag.padreId);
            if (padre) {
                tagId = padre.id;
            }
        }

        if (!grouped[tagId]) grouped[tagId] = 0;
        grouped[tagId] += Number(op.cantidad);
    });

    const labels = [];
    const data = [];
    const colors = [];

    // Map IDs to Names and Colors
    Object.keys(grouped).forEach(tagId => {
        const tag = etiquetas.find(t => t.id === tagId);
        labels.push(tag ? tag.nombre : 'Sin etiqueta');
        colors.push(tag ? tag.color : '#94a3b8'); // Default slate-400
        data.push(grouped[tagId]);
    });

    if (chartIncomeCategories) chartIncomeCategories.destroy();

    // If no data, clear chart and legend
    if (data.length === 0) {
        document.getElementById('total-income-chart').textContent = formatoMoneda(0);
        const legendContainer = document.getElementById('legend-income-categories');
        legendContainer.innerHTML = '<p class="text-sm text-gray-400 italic text-center py-4">Sin ingresos en este periodo</p>';
        return;
    }

    chartIncomeCategories = new Chart(ctx, {
        type: 'doughnut',
        data: {
            labels: labels,
            datasets: [{
                data: data,
                backgroundColor: colors,
                borderWidth: 0
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
                legend: { display: false } // Ocultar leyenda Chart.js
            },
            cutout: '70%'
        }
    });

    // === Renderizar Leyenda Detallada para Ingresos ===
    const total = data.reduce((a, b) => a + b, 0);
    document.getElementById('total-income-chart').textContent = formatoMoneda(total);

    const legendContainer = document.getElementById('legend-income-categories');
    legendContainer.innerHTML = '';

    const items = labels.map((label, i) => ({
        label,
        value: data[i],
        color: colors[i],
        percent: total > 0 ? (data[i] / total) * 100 : 0
    })).sort((a, b) => b.value - a.value);

    items.forEach(item => {
        const row = document.createElement('div');
        row.className = 'flex items-center justify-between text-sm py-1 border-b border-gray-100 dark:border-gray-700 last:border-0';
        row.innerHTML = `
            <div class="flex items-center gap-3">
                <span class="w-3 h-3 rounded-full" style="background-color: ${item.color}"></span>
                <span class="text-gray-700 dark:text-gray-300 font-medium truncate max-w-[120px]" title="${item.label}">${item.label}</span>
                <span class="text-xs text-gray-400 bg-gray-100 dark:bg-gray-700 px-2 py-0.5 rounded-full">${item.percent.toFixed(1)}%</span>
            </div>
            <span class="font-semibold text-gray-900 dark:text-white tabular-nums">${formatoMoneda(item.value)}</span>
        `;
        legendContainer.appendChild(row);
    });
}

function OLD_actualizarGraficoBalanceHistorico(todasOperaciones, periodo) {
    const ctx = document.getElementById('chart-balance-history').getContext('2d');
    const cuentas = listarCuentas();

    // Balance actual total
    const balanceActual = cuentas.reduce((acc, c) => acc + Number(c.dinero || 0), 0);

    // Determinar fechas límite del periodo
    const now = new Date();
    let startDate;

    if (periodo === 'mes') {
        startDate = new Date(now.getFullYear(), now.getMonth(), 1);
    } else if (periodo === 'anio') {
        startDate = new Date(now.getFullYear(), 0, 1);
    } else {
        // 'todo': Usar la primera operación o hace 1 año si no hay
        if (todasOperaciones.length > 0) {
            const firstDate = todasOperaciones.reduce((min, op) => op.fecha < min ? op.fecha : min, todasOperaciones[0].fecha);
            const fechaNormalizada = firstDate.includes('T') ? firstDate : firstDate + 'T00:00:00';
            startDate = new Date(fechaNormalizada);
        } else {
            startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        }
    }

    // Filtrar operaciones que están DESPUÉS del inicio del periodo hasta hoy
    const opsDespues = todasOperaciones.filter(op => {
        const fechaNormalizada = op.fecha.includes('T') ? op.fecha : op.fecha + 'T00:00:00';
        const fechaOp = new Date(fechaNormalizada);
        return fechaOp >= startDate && fechaOp <= now;
    });

    // Calcular el balance al INICIO del periodo
    // Balance inicial = Balance actual - efecto de las operaciones del periodo
    let efectoDelPeriodo = 0;
    opsDespues.forEach(op => {
        if (op.tipo === 'ingreso') efectoDelPeriodo += Number(op.cantidad);
        else if (op.tipo === 'gasto') efectoDelPeriodo -= Number(op.cantidad);
        // Las transferencias no cambian el balance total (suma cero)
    });
    const balanceInicial = balanceActual - efectoDelPeriodo;

    // Generar serie temporal día a día
    const labels = [];
    const data = [];
    let balanceAcumulado = balanceInicial;

    // Agrupar operaciones por fecha
    const opsPorDia = {};
    opsDespues.forEach(op => {
        // Normalizar a YYYY-MM-DD para coincidir con el bucle de renderizado
        const fechaKey = op.fecha.split('T')[0];

        if (!opsPorDia[fechaKey]) opsPorDia[fechaKey] = [];
        opsPorDia[fechaKey].push(op);
    });

    // Iterar cada día del periodo
    const currentDate = new Date(startDate);
    while (currentDate <= now) {
        const dateStr = currentDate.toISOString().split('T')[0];

        // Aplicar operaciones de este día
        if (opsPorDia[dateStr]) {
            opsPorDia[dateStr].forEach(op => {
                if (op.tipo === 'ingreso') balanceAcumulado += Number(op.cantidad);
                else if (op.tipo === 'gasto') balanceAcumulado -= Number(op.cantidad);
            });
        }

        labels.push(dateStr);
        data.push(balanceAcumulado);

        // Siguiente día
        currentDate.setDate(currentDate.getDate() + 1);
    }

    if (chartBalanceHistory) chartBalanceHistory.destroy();

    // Determinar color de área según si el balance final es positivo o negativo
    const areaColor = balanceAcumulado >= 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
    const lineColor = balanceAcumulado >= 0 ? '#10b981' : '#ef4444';

    chartBalanceHistory = new Chart(ctx, {
        type: 'line',
        data: {
            labels: labels,
            datasets: [{
                label: 'Balance Total',
                data: data,
                borderColor: lineColor,
                backgroundColor: areaColor,
                fill: true,
                tension: 0.3,
                pointRadius: labels.length > 60 ? 0 : 3, // Ocultar puntos si hay muchos días
                pointHoverRadius: 5
            }]
        },
        options: {
            responsive: true,
            maintainAspectRatio: false,
            scales: {
                y: {
                    beginAtZero: false,
                    grid: { color: 'rgba(156, 163, 175, 0.1)' }
                },
                x: {
                    grid: { display: false },
                    ticks: {
                        maxTicksLimit: 10 // Limitar etiquetas en eje X
                    }
                }
            },
            plugins: {
                legend: { display: false },
                tooltip: {
                    callbacks: {
                        label: function (context) {
                            return formatoMoneda(context.parsed.y);
                        }
                    }
                }
            }
        }
    });
}

/**
 * Calcula la Media Móvil Simple (SMA) para un conjunto de datos
 * @param {Array<number>} data - Array de valores numéricos
 * @param {number} period - Periodo de la media móvil (ej: 30 para 30 días)
 * @returns {Array<number|null>} - Array del mismo tamaño, con null para los primeros period-1 valores
 */
function calcularSMA(data, period) {
    const result = [];

    for (let i = 0; i < data.length; i++) {
        if (i < period - 1) {
            // No hay suficientes datos para calcular el promedio
            result.push(null);
        } else {
            // Calcular promedio de los últimos 'period' valores
            let sum = 0;
            for (let j = 0; j < period; j++) {
                sum += data[i - j];
            }
            result.push(sum / period);
        }
    }

    return result;
}

/**
 * Calcula las Bandas de Bollinger para un conjunto de datos
 * @param {Array<number>} data - Array de valores numéricos
 * @param {number} period - Periodo de la media móvil (ej: 30)
 * @param {number} stdDev - Multiplicador de desviación estándar (ej: 2)
 * @returns {Object} - Objeto con arrays upper y lower del mismo tamaño que data
 */
function calcularBollinger(data, period, stdDev) {
    const upper = [];
    const lower = [];
    const sma = calcularSMA(data, period);

    for (let i = 0; i < data.length; i++) {
        if (i < period - 1 || sma[i] === null) {
            // No hay suficientes datos
            upper.push(null);
            lower.push(null);
        } else {
            // Calcular desviación estándar de la ventana
            let sumSquaredDiff = 0;
            for (let j = 0; j < period; j++) {
                const diff = data[i - j] - sma[i];
                sumSquaredDiff += diff * diff;
            }
            const standardDeviation = Math.sqrt(sumSquaredDiff / period);

            // Bandas superior e inferior
            upper.push(sma[i] + (stdDev * standardDeviation));
            lower.push(sma[i] - (stdDev * standardDeviation));
        }
    }

    return { upper, lower };
}

function actualizarGraficoBalanceHistorico(todasOperaciones, periodo) {
    const ctx = document.getElementById('chart-balance-history').getContext('2d');

    /**
     * Helper function: Normaliza el parseo de fechas para soportar formatos mixtos
     * - Si la fecha ya incluye 'T' (formato ISO con hora), la usa tal cual
     * - Si no incluye 'T' (formato YYYY-MM-DD), agrega 'T00:00:00'
     * @param {string} fechaStr - Fecha en formato YYYY-MM-DD o YYYY-MM-DDTHH:MM
     * @returns {Date} - Objeto Date correctamente parseado
     */
    const normalizarFecha = (fechaStr) => {
        if (!fechaStr) return new Date();
        const fechaNormalizada = fechaStr.includes('T') ? fechaStr : fechaStr + 'T00:00:00';
        return new Date(fechaNormalizada);
    };

    // Sort operations cronologically - ahora con parseo correcto
    const opsSorted = [...todasOperaciones].sort((a, b) => normalizarFecha(a.fecha) - normalizarFecha(b.fecha));

    // Usar calcularRangoPeriodo para determinar fechas límite
    const rango = calcularRangoPeriodo(periodo, periodOffset);
    const startDate = rango.start;
    const endDate = rango.end;

    // Calcular el balance acumulado JUSTO ANTES del inicio del periodo
    // Esto es: Suma de (Ingresos - Gastos) de todas las operaciones anteriores a startDate
    let balanceInicialCalculado = 0;
    const opsAnteriores = opsSorted.filter(op => normalizarFecha(op.fecha) < startDate);

    opsAnteriores.forEach(op => {
        if (op.tipo === 'ingreso') balanceInicialCalculado += Number(op.cantidad);
        else if (op.tipo === 'gasto') balanceInicialCalculado -= Number(op.cantidad);
    });

    // ========================================================================
    // IMPORTANTE: Para que los indicadores técnicos (SMA y Bollinger) estén
    // disponibles incluso en periodos cortos (ej: filtro semanal), necesitamos
    // calcular el balance histórico COMPLETO desde la primera operación hasta
    // el final del periodo filtrado. Luego recortamos solo el rango visible.
    // ========================================================================

    // 1. Determinar la fecha de inicio real (primera operación o startDate)
    let fechaInicioCalculo = startDate;
    if (opsAnteriores.length > 0) {
        const fechasAnteriores = opsAnteriores.map(op => normalizarFecha(op.fecha));
        fechaInicioCalculo = new Date(Math.min(...fechasAnteriores));
    }

    // 2. Agrupar TODAS las operaciones (no solo las del periodo visible)
    const opsPorDia = {};
    opsSorted.forEach(op => {
        const d = normalizarFecha(op.fecha);
        // Solo incluir operaciones hasta endDate
        if (d <= endDate) {
            const fechaKey = op.fecha.split('T')[0];
            if (!opsPorDia[fechaKey]) opsPorDia[fechaKey] = [];
            opsPorDia[fechaKey].push(op);
        }
    });

    // 3. Generar serie temporal COMPLETA desde fechaInicioCalculo hasta endDate
    const labelsCompleto = [];
    const dataCompleto = [];
    let balanceAcumulado = 0; // Empezar desde 0 en la primera fecha histórica

    const currentDate = new Date(fechaInicioCalculo);
    while (currentDate <= endDate) {
        const dateStr = currentDate.toISOString().split('T')[0];

        // Aplicar operaciones de este día
        if (opsPorDia[dateStr]) {
            opsPorDia[dateStr].forEach(op => {
                if (op.tipo === 'ingreso') balanceAcumulado += Number(op.cantidad);
                else if (op.tipo === 'gasto') balanceAcumulado -= Number(op.cantidad);
            });
        }

        labelsCompleto.push(dateStr);
        dataCompleto.push(balanceAcumulado);

        // Siguiente día
        currentDate.setDate(currentDate.getDate() + 1);
    }

    // 4. Encontrar el índice donde empieza el periodo visible
    const startDateStr = startDate.toISOString().split('T')[0];
    const indexInicio = labelsCompleto.findIndex(label => label >= startDateStr);

    // 5. Recortar arrays para el periodo visible
    const labels = labelsCompleto.slice(indexInicio >= 0 ? indexInicio : 0);
    const data = dataCompleto.slice(indexInicio >= 0 ? indexInicio : 0);

    if (chartBalanceHistory) chartBalanceHistory.destroy();

    // === MODO LINEAL (Balance acumulado) ===
    if (chartBalanceMode === 'lineal') {
        const areaColor = balanceAcumulado >= 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
        const lineColor = balanceAcumulado >= 0 ? '#10b981' : '#ef4444';

        // ✅ Calcular indicadores sobre el array COMPLETO (con historial)
        const smaCompleto = showSMA ? calcularSMA(dataCompleto, 30) : null;
        const bollingerCompleto = showBollinger ? calcularBollinger(dataCompleto, 30, 2) : null;

        // ✅ Recortar indicadores al periodo visible
        const smaData = smaCompleto ? smaCompleto.slice(indexInicio >= 0 ? indexInicio : 0) : null;
        const bollingerData = bollingerCompleto ? {
            upper: bollingerCompleto.upper.slice(indexInicio >= 0 ? indexInicio : 0),
            lower: bollingerCompleto.lower.slice(indexInicio >= 0 ? indexInicio : 0)
        } : null;

        // Construir datasets en el orden correcto de capas
        const datasets = [];

        // 1. Bollinger Lower (primera capa, abajo)
        if (showBollinger && bollingerData) {
            datasets.push({
                label: 'Bollinger Inferior',
                data: bollingerData.lower,
                borderColor: 'rgba(200, 200, 200, 0.5)',
                backgroundColor: 'rgba(200, 200, 200, 0.1)',
                fill: false,
                pointRadius: 0,
                borderWidth: 1,
                tension: 0.3
            });
        }

        // 2. Bollinger Upper (rellena hacia la inferior con fill: '-1')
        if (showBollinger && bollingerData) {
            datasets.push({
                label: 'Bollinger Superior',
                data: bollingerData.upper,
                borderColor: 'rgba(200, 200, 200, 0.5)',
                backgroundColor: 'rgba(200, 200, 200, 0.15)',
                fill: '-1', // Rellena hacia el dataset anterior (Bollinger Lower)
                pointRadius: 0,
                borderWidth: 1,
                tension: 0.3
            });
        }

        // 3. SMA (línea punteada violeta)
        if (showSMA && smaData) {
            datasets.push({
                label: 'Tendencia SMA (30d)',
                data: smaData,
                borderColor: '#8b5cf6',
                borderDash: [5, 5],
                fill: false,
                pointRadius: 0,
                borderWidth: 2,
                tension: 0.4
            });
        }

        // 4. Balance Principal (última capa, encima de todo)
        datasets.push({
            label: 'Balance Histórico (Operaciones)',
            data: data,
            borderColor: lineColor,
            backgroundColor: areaColor,
            fill: true,
            tension: 0.3,
            pointRadius: labels.length > 60 ? 0 : 3,
            pointHoverRadius: 5,
            borderWidth: 2
        });

        chartBalanceHistory = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: datasets
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        grid: { color: 'rgba(156, 163, 175, 0.1)' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { maxTicksLimit: 10 }
                    }
                },
                plugins: {
                    legend: {
                        display: showSMA || showBollinger, // Mostrar leyenda solo si hay indicadores
                        position: 'bottom',
                        labels: {
                            usePointStyle: true,
                            padding: 15,
                            font: { size: 11 }
                        }
                    },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return context.dataset.label + ': ' + formatoMoneda(context.parsed.y);
                            }
                        }
                    }
                }
            }
        });
    }
    // === MODO BARRAS (Ingresos vs Gastos por día) ===
    else {
        // Preparar datos para barras (Ingresos y Gastos separados)
        const dataIngresos = [];
        const dataGastos = [];

        labels.forEach(dateStr => {
            let ing = 0, gas = 0;
            if (opsPorDia[dateStr]) {
                opsPorDia[dateStr].forEach(op => {
                    if (op.tipo === 'ingreso') ing += Number(op.cantidad);
                    else if (op.tipo === 'gasto') gas += Number(op.cantidad);
                });
            }
            dataIngresos.push(ing);
            dataGastos.push(gas);
        });

        chartBalanceHistory = new Chart(ctx, {
            type: 'bar',
            data: {
                labels: labels,
                datasets: [
                    {
                        label: 'Ingresos',
                        data: dataIngresos,
                        backgroundColor: '#10b981',
                        borderRadius: 4,
                    },
                    {
                        label: 'Gastos',
                        data: dataGastos,
                        backgroundColor: '#ef4444',
                        borderRadius: 4,
                    }
                ]
            },
            options: {
                responsive: true,
                maintainAspectRatio: false,
                scales: {
                    y: {
                        beginAtZero: true,
                        grid: { color: 'rgba(156, 163, 175, 0.1)' }
                    },
                    x: {
                        grid: { display: false },
                        ticks: { maxTicksLimit: 10 }
                    }
                },
                plugins: {
                    legend: { position: 'bottom' },
                    tooltip: {
                        callbacks: {
                            label: function (context) {
                                return context.dataset.label + ': ' + formatoMoneda(context.parsed.y);
                            }
                        }
                    }
                }
            }
        });
    }
}

function actualizarMaximosMinimos(operaciones) {
    // Separar ingresos y gastos
    const ingresos = operaciones.filter(op => op.tipo === 'ingreso').map(op => ({ ...op, cantidad: Number(op.cantidad) }));
    const gastos = operaciones.filter(op => op.tipo === 'gasto').map(op => ({ ...op, cantidad: Number(op.cantidad) }));

    // Ordenar
    const ingresosDesc = [...ingresos].sort((a, b) => b.cantidad - a.cantidad);
    const ingresosAsc = [...ingresos].sort((a, b) => a.cantidad - b.cantidad);
    const gastosDesc = [...gastos].sort((a, b) => b.cantidad - a.cantidad);
    const gastosAsc = [...gastos].sort((a, b) => a.cantidad - b.cantidad);

    // Helper para renderizar lista
    const renderList = (listId, items, colorClass) => {
        const ul = document.getElementById(listId);
        ul.innerHTML = '';

        if (items.length === 0) {
            ul.innerHTML = '<li class="text-gray-400 dark:text-gray-500 italic">Sin datos</li>';
            return;
        }

        items.slice(0, 3).forEach((op, i) => {
            const li = document.createElement('li');
            li.className = 'flex justify-between items-center py-1.5 px-2 bg-gray-50 dark:bg-gray-700/50 rounded-lg';
            li.innerHTML = `
                <div class="flex items-center gap-2 truncate">
                    <span class="text-xs font-bold text-gray-400">#${i + 1}</span>
                    <span class="truncate text-gray-700 dark:text-gray-300">${op.nombre || 'Sin nombre'}</span>
                </div>
                <span class="font-semibold ${colorClass} whitespace-nowrap">${formatoMoneda(op.cantidad)}</span>
            `;
            ul.appendChild(li);
        });
    };

    // Renderizar listas
    renderList('list-max-ingresos', ingresosDesc, 'text-green-600 dark:text-green-400');
    renderList('list-max-gastos', gastosDesc, 'text-red-600 dark:text-red-400');
    renderList('list-min-ingresos', ingresosAsc, 'text-green-600 dark:text-green-400');
    renderList('list-min-gastos', gastosAsc, 'text-red-600 dark:text-red-400');
}



import { listarOperaciones } from '../servicios/operaciones.js';
import { listarEtiquetas } from '../servicios/etiquetas.js';
import { listarCuentas } from '../servicios/cuentas.js';
import { formatoMoneda } from '../utilidades/formato.js';

let chartEvolution = null;
let chartCategories = null;
let chartIncomeCategories = null;
let chartBalanceHistory = null;
let chartBalanceMode = 'lineal'; // 'lineal' or 'barras'

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
            const fechas = todasOps.map(op => new Date(op.fecha + 'T00:00:00'));
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
            const d = new Date(op.fecha + 'T00:00:00');
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

function actualizarGraficoEvolucion(operaciones) {
    const ctx = document.getElementById('chart-evolution').getContext('2d');

    // Group by date
    const grouped = {};
    operaciones.forEach(op => {
        const date = op.fecha; // YYYY-MM-DD
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

    // If no data
    if (data.length === 0) {
        // Optional: Show empty state or clear canvas
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

    // If no data
    if (data.length === 0) {
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
            startDate = new Date(firstDate + 'T00:00:00');
        } else {
            startDate = new Date(now.getFullYear() - 1, now.getMonth(), now.getDate());
        }
    }

    // Filtrar operaciones que están DESPUÉS del inicio del periodo hasta hoy
    const opsDespues = todasOperaciones.filter(op => {
        const fechaOp = new Date(op.fecha + 'T00:00:00');
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
        if (!opsPorDia[op.fecha]) opsPorDia[op.fecha] = [];
        opsPorDia[op.fecha].push(op);
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

function actualizarGraficoBalanceHistorico(todasOperaciones, periodo) {
    const ctx = document.getElementById('chart-balance-history').getContext('2d');

    // Sort operations cronologically
    const opsSorted = [...todasOperaciones].sort((a, b) => new Date(a.fecha) - new Date(b.fecha));

    // Usar calcularRangoPeriodo para determinar fechas límite
    const rango = calcularRangoPeriodo(periodo, periodOffset);
    const startDate = rango.start;
    const endDate = rango.end;

    // Calcular el balance acumulado JUSTO ANTES del inicio del periodo
    // Esto es: Suma de (Ingresos - Gastos) de todas las operaciones anteriores a startDate
    let balanceInicialCalculado = 0;
    const opsAnteriores = opsSorted.filter(op => new Date(op.fecha + 'T00:00:00') < startDate);

    opsAnteriores.forEach(op => {
        if (op.tipo === 'ingreso') balanceInicialCalculado += Number(op.cantidad);
        else if (op.tipo === 'gasto') balanceInicialCalculado -= Number(op.cantidad);
    });

    // Filtramos operaciones DENTRO del periodo
    const opsDentro = opsSorted.filter(op => {
        const d = new Date(op.fecha + 'T00:00:00');
        return d >= startDate && d <= endDate;
    });

    // Generar serie temporal día a día
    const labels = [];
    const data = [];
    let balanceAcumulado = balanceInicialCalculado;

    // Agrupar operaciones del periodo por fecha
    const opsPorDia = {};
    opsDentro.forEach(op => {
        if (!opsPorDia[op.fecha]) opsPorDia[op.fecha] = [];
        opsPorDia[op.fecha].push(op);
    });

    // Iterar cada día del periodo
    const currentDate = new Date(startDate);

    while (currentDate <= endDate) {
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

    // === MODO LINEAL (Balance acumulado) ===
    if (chartBalanceMode === 'lineal') {
        const areaColor = balanceAcumulado >= 0 ? 'rgba(16, 185, 129, 0.2)' : 'rgba(239, 68, 68, 0.2)';
        const lineColor = balanceAcumulado >= 0 ? '#10b981' : '#ef4444';

        chartBalanceHistory = new Chart(ctx, {
            type: 'line',
            data: {
                labels: labels,
                datasets: [{
                    label: 'Balance Histórico (Operaciones)',
                    data: data,
                    borderColor: lineColor,
                    backgroundColor: areaColor,
                    fill: true,
                    tension: 0.3,
                    pointRadius: labels.length > 60 ? 0 : 3,
                    pointHoverRadius: 5
                }]
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


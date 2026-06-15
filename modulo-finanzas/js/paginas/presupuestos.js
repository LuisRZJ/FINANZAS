import {
  configurarPresupuestoGeneral,
  calcularResumenPresupuestoActual,
  crearPresupuestoCategoria,
  actualizarPresupuestoCategoria,
  eliminarPresupuestoCategoria,
  revisarPeriodosPresupuesto
} from '../servicios/presupuestos.js'
import { listarEtiquetas } from '../servicios/etiquetas.js'
import { listarOperaciones } from '../servicios/operaciones.js'

let activeTab = 'actual'
let chartHistorial = null

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function formatDate(fechaStr) {
  if (!fechaStr) return ''
  // Soportar formato nuevo (YYYY-MM-DDTHH:MM) y antiguo (YYYY-MM-DD)
  const fechaLimpia = String(fechaStr).split('T')[0]
  const [y, m, d] = fechaLimpia.split('-').map((v) => parseInt(v, 10))
  if (!y || !m || !d) return fechaStr
  const dt = new Date(y, m - 1, d)
  return dt.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' })
}

function setActiveNav() {
  const links = document.querySelectorAll('nav a[data-route]')
  const current = location.pathname.split('/').pop() || 'presupuestos.html'
  links.forEach((a) => {
    const route = a.getAttribute('data-route')
    if (!route) return
    if (route === current) a.classList.add('text-primary-600', 'dark:text-primary-400')
    else a.classList.remove('text-primary-600', 'dark:text-primary-400')
  })
}

function buildEtiquetaOptions(select, etiquetas, selectedId) {
  select.innerHTML = ''
  const optEmpty = document.createElement('option')
  optEmpty.value = ''
  optEmpty.textContent = 'Selecciona etiqueta de gasto'
  select.appendChild(optEmpty)
  etiquetas.forEach((e) => {
    if (e.tipo !== 'gasto') return
    const opt = document.createElement('option')
    opt.value = e.id
    opt.textContent = e.nombre
    if (selectedId && selectedId === e.id) opt.selected = true
    select.appendChild(opt)
  })
}

function calcularVistaPreviaFechas(tipoPeriodo) {
  const hoyFecha = new Date()
  const y = hoyFecha.getFullYear()
  const m = hoyFecha.getMonth()

  let inicio, fin

  if (tipoPeriodo === 'mensual') {
    inicio = new Date(y, m, 1)
    fin = new Date(y, m + 1, 0)
  } else if (tipoPeriodo === 'semanal') {
    const dayOfWeek = hoyFecha.getDay()
    const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
    const monday = new Date(hoyFecha)
    monday.setDate(hoyFecha.getDate() + diffToMon)
    const sunday = new Date(monday)
    sunday.setDate(monday.getDate() + 6)
    inicio = monday
    fin = sunday
  } else if (tipoPeriodo === 'anual') {
    inicio = new Date(y, 0, 1)
    fin = new Date(y, 11, 31)
  } else {
    return ''
  }

  // Formatear fechas a ISO string YYYY-MM-DD
  const formatISO = (d) => {
    const year = d.getFullYear()
    const month = String(d.getMonth() + 1).padStart(2, '0')
    const day = String(d.getDate()).padStart(2, '0')
    return `${year}-${month}-${day}`
  }

  return `Periodo automático: ${formatDate(formatISO(inicio))} al ${formatDate(formatISO(fin))}`
}

async function renderGeneral() {
  await revisarPeriodosPresupuesto()
  const resumen = await calcularResumenPresupuestoActual()
  const wrap = document.getElementById('presupuesto-general')
  if (!wrap) return
  wrap.innerHTML = ''

  const card = document.createElement('div')
  card.className = 'space-y-6 animate-fade-in'

  const headerDiv = document.createElement('div')
  headerDiv.className = 'border-b border-gray-100 dark:border-gray-800/80 pb-3'

  const title = document.createElement('h3')
  title.className = 'text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider'
  title.textContent = 'Presupuesto general de gastos'
  headerDiv.appendChild(title)
  card.appendChild(headerDiv)

  const g = resumen.general

  // Alerta si el presupuesto está pausado
  if (g && g.estadoActivo === false) {
    const alertPausado = document.createElement('div')
    alertPausado.className =
      'rounded-2xl border border-amber-100 bg-amber-50/50 text-amber-900 dark:bg-amber-950/20 dark:border-amber-900/40 dark:text-amber-300 p-4 text-xs flex items-start gap-2.5 mb-6'
    alertPausado.innerHTML = `
      <i data-lucide="alert-triangle" class="w-5.5 h-5.5 text-amber-500 flex-shrink-0 mt-0.5"></i>
      <div>
        <span class="font-bold uppercase tracking-wider text-[10px] block mb-0.5">Presupuesto Pausado</span>
        El presupuesto general está actualmente pausado. Las metas de categorías se muestran como inactivas y no se computarán alertas de excedentes.
      </div>
    `
    card.appendChild(alertPausado)
  }

  const resumenBox = document.createElement('div')
  resumenBox.className = 'grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6'

  // Caja Monto General
  const boxMonto = document.createElement('div')
  boxMonto.className = 'p-4 rounded-2xl bg-gray-50/50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800/80 flex items-center gap-3'
  boxMonto.innerHTML = `
    <div class="w-10 h-10 rounded-xl bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center text-sky-500 dark:text-sky-400 border border-sky-100/40 dark:border-sky-900/20 flex-shrink-0">
      <i data-lucide="wallet" class="w-5 h-5"></i>
    </div>
    <div class="min-w-0">
      <span class="text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider block">Presupuesto</span>
      <span class="text-sm font-extrabold text-gray-900 dark:text-white tracking-tight block">${g ? formatCurrency(g.monto) : 'Sin definir'}</span>
    </div>
  `

  // Caja Periodo Vigente
  const boxPeriodo = document.createElement('div')
  boxPeriodo.className = 'p-4 rounded-2xl bg-gray-50/50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800/80 flex items-center gap-3'
  let periodoTxt = 'Sin periodo'
  if (g && g.fechaInicio && g.fechaFin) {
    periodoTxt = formatDate(g.fechaInicio) + ' a ' + formatDate(g.fechaFin)
  }
  boxPeriodo.innerHTML = `
    <div class="w-10 h-10 rounded-xl bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center text-amber-500 dark:text-amber-400 border border-amber-100/40 dark:border-amber-900/20 flex-shrink-0">
      <i data-lucide="calendar" class="w-5 h-5"></i>
    </div>
    <div class="min-w-0">
      <span class="text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider block">Periodo</span>
      <span class="text-[11px] font-bold text-gray-800 dark:text-gray-200 block" title="${periodoTxt}">${periodoTxt}</span>
    </div>
  `

  // Caja Asignado a Etiquetas
  const boxAsignado = document.createElement('div')
  boxAsignado.className = 'p-4 rounded-2xl bg-gray-50/50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800/80 flex items-center gap-3'
  boxAsignado.innerHTML = `
    <div class="w-10 h-10 rounded-xl bg-emerald-50 dark:bg-emerald-950/30 flex items-center justify-center text-emerald-500 dark:text-emerald-400 border border-emerald-100/40 dark:border-emerald-900/20 flex-shrink-0">
      <i data-lucide="tag" class="w-5 h-5"></i>
    </div>
    <div class="min-w-0">
      <span class="text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider block">Asignado</span>
      <span class="text-sm font-extrabold text-gray-900 dark:text-white tracking-tight block">${formatCurrency(resumen.totalCategorias)}</span>
    </div>
  `

  // Caja Disponible para Asignar
  const restante = g ? resumen.restanteAsignar : 0
  const boxRestante = document.createElement('div')
  boxRestante.className = 'p-4 rounded-2xl bg-gray-50/50 dark:bg-gray-900/40 border border-gray-100 dark:border-gray-800/80 flex items-center gap-3'
  boxRestante.innerHTML = `
    <div class="w-10 h-10 rounded-xl bg-purple-50 dark:bg-purple-950/30 flex items-center justify-center text-purple-500 dark:text-purple-400 border border-purple-100/40 dark:border-purple-900/20 flex-shrink-0">
      <i data-lucide="pie-chart" class="w-5 h-5"></i>
    </div>
    <div class="min-w-0">
      <span class="text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider block">Disponible</span>
      <span class="text-sm font-extrabold text-gray-900 dark:text-white tracking-tight block">${formatCurrency(restante)}</span>
    </div>
  `

  resumenBox.appendChild(boxMonto)
  resumenBox.appendChild(boxPeriodo)
  resumenBox.appendChild(boxAsignado)
  resumenBox.appendChild(boxRestante)
  card.appendChild(resumenBox)

  const form = document.createElement('form')
  form.id = 'form-presupuesto-general'
  form.className = 'flex flex-col gap-4 mb-4 bg-gray-50/50 dark:bg-gray-900/30 p-5 rounded-3xl border border-gray-100 dark:border-gray-800/40'

  // Primera Fila: Monto, Frecuencia y Estado
  const gridMain = document.createElement('div')
  gridMain.className = 'grid grid-cols-1 sm:grid-cols-3 gap-4 items-end'

  // Campo Monto
  const fMonto = document.createElement('div')
  const lMonto = document.createElement('label')
  lMonto.className = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1'
  lMonto.textContent = 'Monto General'
  const iMonto = document.createElement('input')
  iMonto.type = 'number'
  iMonto.step = '0.01'
  iMonto.min = '0.01'
  iMonto.required = true
  iMonto.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all font-bold'
  if (g) iMonto.value = g.monto
  fMonto.appendChild(lMonto)
  fMonto.appendChild(iMonto)

  // Campo Frecuencia
  const fFrecuencia = document.createElement('div')
  const lFrecuencia = document.createElement('label')
  lFrecuencia.className = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1'
  lFrecuencia.textContent = 'Frecuencia / Periodo'
  const sFrecuencia = document.createElement('select')
  sFrecuencia.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all'
  sFrecuencia.innerHTML = `
    <option value="mensual">Mensual (Recomendado)</option>
    <option value="semanal">Semanal</option>
    <option value="anual">Anual</option>
    <option value="personalizado">Personalizado (Fechas manuales)</option>
  `
  if (g && g.tipoPeriodo) sFrecuencia.value = g.tipoPeriodo
  fFrecuencia.appendChild(lFrecuencia)
  fFrecuencia.appendChild(sFrecuencia)

  // Campo Estado
  const fEstado = document.createElement('div')
  const lEstado = document.createElement('label')
  lEstado.className = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1'
  lEstado.textContent = 'Estado'
  const sEstado = document.createElement('select')
  sEstado.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all'
  sEstado.innerHTML = `
    <option value="true">Activo</option>
    <option value="false">Pausado</option>
  `
  if (g) sEstado.value = String(g.estadoActivo !== false)
  fEstado.appendChild(lEstado)
  fEstado.appendChild(sEstado)

  gridMain.appendChild(fMonto)
  gridMain.appendChild(fFrecuencia)
  gridMain.appendChild(fEstado)
  form.appendChild(gridMain)

  // Segunda Fila: Fechas Personalizadas (Ocultable por defecto)
  const camposFechas = document.createElement('div')
  camposFechas.id = 'campos-fechas-personalizadas'
  camposFechas.className = 'grid grid-cols-1 sm:grid-cols-2 gap-4 items-end hidden'

  const fInicio = document.createElement('div')
  const lInicio = document.createElement('label')
  lInicio.className = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1'
  lInicio.textContent = 'Fecha inicio'
  const iInicio = document.createElement('input')
  iInicio.type = 'date'
  iInicio.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all'
  if (g && g.fechaInicio) iInicio.value = g.fechaInicio
  fInicio.appendChild(lInicio)
  fInicio.appendChild(iInicio)

  const fFin = document.createElement('div')
  const lFin = document.createElement('label')
  lFin.className = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1'
  lFin.textContent = 'Fecha fin'
  const iFin = document.createElement('input')
  iFin.type = 'date'
  iFin.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all'
  if (g && g.fechaFin) iFin.value = g.fechaFin
  fFin.appendChild(lFin)
  fFin.appendChild(iFin)

  camposFechas.appendChild(fInicio)
  camposFechas.appendChild(fFin)
  form.appendChild(camposFechas)

  // Vista Previa de Fechas
  const vistaPrevia = document.createElement('div')
  vistaPrevia.id = 'vista-previa-fechas'
  vistaPrevia.className = 'text-xs text-gray-500 dark:text-gray-400 italic font-semibold'
  form.appendChild(vistaPrevia)

  // Botón de Enviar (Crear / Actualizar)
  const submitWrapper = document.createElement('div')
  submitWrapper.className = 'flex justify-end mt-2'
  const btn = document.createElement('button')
  btn.type = 'submit'
  btn.className =
    'w-full sm:w-auto inline-flex justify-center items-center bg-sky-600 dark:bg-sky-500 hover:bg-sky-700 dark:hover:bg-sky-600 text-white rounded-2xl py-3 px-6 font-semibold text-xs shadow-sm transition-colors'
  btn.textContent = g ? 'Actualizar' : 'Crear'
  submitWrapper.appendChild(btn)
  form.appendChild(submitWrapper)

  const error = document.createElement('div')
  error.id = 'error-presupuesto-general'
  error.className = 'mt-2 text-xs font-semibold text-red-500 hidden'

  card.appendChild(form)
  card.appendChild(error)

  wrap.appendChild(card)

  if (window.lucide) {
    window.lucide.createIcons()
  }

  // Lógica inicial para alternar visibilidad de fechas y actualizar la vista previa
  const actualizarEstadoFormulario = () => {
    const val = sFrecuencia.value
    if (val === 'personalizado') {
      camposFechas.classList.remove('hidden')
      vistaPrevia.classList.add('hidden')
      iInicio.required = true
      iFin.required = true
    } else {
      camposFechas.classList.add('hidden')
      vistaPrevia.classList.remove('hidden')
      vistaPrevia.textContent = calcularVistaPreviaFechas(val)
      iInicio.required = false
      iFin.required = false
    }
  }

  actualizarEstadoFormulario()
  sFrecuencia.addEventListener('change', actualizarEstadoFormulario)

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const montoVal = iMonto.value
    const tipoPeriodoVal = sFrecuencia.value
    const estadoActivoVal = sEstado.value === 'true'

    const payload = {
      monto: Number(montoVal),
      tipoPeriodo: tipoPeriodoVal,
      estadoActivo: estadoActivoVal
    }

    if (tipoPeriodoVal === 'personalizado') {
      payload.fechaInicio = iInicio.value
      payload.fechaFin = iFin.value
    }

    try {
      await configurarPresupuestoGeneral(payload)
      error.textContent = ''
      error.classList.add('hidden')
      await renderGeneral()
      await renderCategorias()
    } catch (err) {
      error.textContent = err.message || String(err)
      error.classList.remove('hidden')
    }
  })
}

async function renderCategorias() {
  const wrap = document.getElementById('presupuestos-categorias')
  if (!wrap) return
  wrap.innerHTML = ''

  const resumen = await calcularResumenPresupuestoActual()
  const general = resumen.general
  const todasEtiquetas = await listarEtiquetas()
  const etiquetas = todasEtiquetas.filter((e) => e.tipo === 'gasto')

  const header = document.createElement('div')
  header.className = 'flex items-center justify-between mb-2 mt-4 pt-4 border-t border-gray-100 dark:border-gray-800'
  const title = document.createElement('h3')
  title.className = 'text-xs font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider'
  title.textContent = 'Presupuestos por etiqueta de gasto'
  header.appendChild(title)
  wrap.appendChild(header)

  if (!general) {
    const alert = document.createElement('div')
    alert.className =
      'rounded-2xl border border-amber-100 bg-amber-50/50 text-amber-900 dark:bg-amber-950/20 dark:border-amber-900/40 dark:text-amber-300 p-4 text-xs flex items-start gap-2.5 mt-4'
    alert.innerHTML = `
      <i data-lucide="info" class="w-5 h-5 text-amber-500 flex-shrink-0"></i>
      <div>
        <span class="font-bold uppercase tracking-wider text-[10px] block mb-0.5">Atención</span>
        Primero define un presupuesto general para poder asignar presupuestos por etiqueta.
      </div>
    `
    wrap.appendChild(alert)
    if (window.lucide) {
      window.lucide.createIcons()
    }
    return
  }

  const form = document.createElement('form')
  form.id = 'form-presupuesto-categoria'
  form.className = 'grid grid-cols-1 sm:grid-cols-2 gap-4 items-end mb-6 bg-gray-50/50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-800/40 p-4 rounded-3xl mt-4 animate-fade-in'

  const fEtiqueta = document.createElement('div')
  const lEtiqueta = document.createElement('label')
  lEtiqueta.className = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1'
  lEtiqueta.textContent = 'Etiqueta'
  const sEtiqueta = document.createElement('select')
  sEtiqueta.required = true
  sEtiqueta.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-950 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all'
  buildEtiquetaOptions(sEtiqueta, etiquetas, '')
  fEtiqueta.appendChild(lEtiqueta)
  fEtiqueta.appendChild(sEtiqueta)

  const fMonto = document.createElement('div')
  const lMonto = document.createElement('label')
  lMonto.className = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1'
  lMonto.textContent = 'Monto'
  const iMonto = document.createElement('input')
  iMonto.type = 'number'
  iMonto.step = '0.01'
  iMonto.min = '0.01'
  iMonto.required = true
  iMonto.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all font-bold'
  fMonto.appendChild(lMonto)
  fMonto.appendChild(iMonto)

  const fDisponible = document.createElement('div')
  fDisponible.className = 'p-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/80 flex items-center justify-between'
  fDisponible.innerHTML = `
    <div>
      <span class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider block">Disponible</span>
      <span class="text-sm font-black text-gray-900 dark:text-white tracking-tight">${formatCurrency(resumen.restanteAsignar)}</span>
    </div>
    <i data-lucide="check-circle" class="w-4 h-4 text-emerald-500 flex-shrink-0 ml-1"></i>
  `

  const fBtn = document.createElement('div')
  const btn = document.createElement('button')
  btn.type = 'submit'
  btn.className =
    'w-full inline-flex justify-center items-center bg-sky-600 dark:bg-sky-500 hover:bg-sky-700 dark:hover:bg-sky-600 text-white rounded-2xl py-3 px-4 font-semibold text-xs shadow-sm transition-colors'
  btn.textContent = 'Agregar'
  fBtn.appendChild(btn)

  form.appendChild(fEtiqueta)
  form.appendChild(fMonto)
  form.appendChild(fDisponible)
  form.appendChild(fBtn)

  const error = document.createElement('div')
  error.id = 'error-presupuesto-categoria'
  error.className = 'mt-2 text-xs font-semibold text-red-500 hidden'

  wrap.appendChild(form)
  wrap.appendChild(error)

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const etiquetaId = sEtiqueta.value
    const montoVal = iMonto.value
    try {
      await crearPresupuestoCategoria({ etiquetaId, monto: montoVal })
      error.textContent = ''
      error.classList.add('hidden')
      form.reset()
      buildEtiquetaOptions(sEtiqueta, etiquetas, '')
      await renderGeneral()
      await renderCategorias()
    } catch (err) {
      error.textContent = err.message || String(err)
      error.classList.remove('hidden')
    }
  })

  if (resumen.categorias.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'text-xs text-gray-400 dark:text-gray-500 italic py-4 text-center'
    empty.textContent = 'Aún no hay presupuestos por etiqueta.'
    wrap.appendChild(empty)
    if (window.lucide) {
      window.lucide.createIcons()
    }
    return
  }

  const list = document.createElement('div')
  list.className = 'mt-4 space-y-4'

  resumen.categorias.forEach((c) => {
    const card = document.createElement('div')
    card.className =
      'rounded-3xl border border-gray-100 dark:border-gray-800/80 bg-gray-50/40 dark:bg-gray-900/20 p-5 relative overflow-hidden transition-all hover:shadow-sm'

    const categoryColor = c.etiquetaColor || '#3b82f6'
    card.style.borderLeft = `4px solid ${categoryColor}`

    const headerCard = document.createElement('div')
    headerCard.className = 'flex items-center justify-between mb-3'

    const left = document.createElement('div')
    left.className = 'flex items-center gap-2 min-w-0'

    const titleRow = document.createElement('div')
    titleRow.className = 'text-sm font-bold text-gray-900 dark:text-white truncate'
    titleRow.textContent = c.etiquetaNombre
    left.appendChild(titleRow)

    const rightArea = document.createElement('div')
    rightArea.className = 'flex items-center gap-2'

    // Botón para colapsar/expandir el formulario de edición
    const btnToggleEdit = document.createElement('button')
    btnToggleEdit.type = 'button'
    btnToggleEdit.className = 'p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-900/20 rounded-xl transition-all'
    btnToggleEdit.innerHTML = `<i data-lucide="pencil" class="w-3.5 h-3.5"></i>`
    btnToggleEdit.title = 'Editar presupuesto'

    const gastoInfo = document.createElement('div')
    gastoInfo.className = 'text-right'
    gastoInfo.innerHTML = `
      <div class="text-[9px] text-gray-400 dark:text-gray-500 uppercase tracking-wider">Gastado</div>
      <div class="text-xs font-extrabold text-gray-900 dark:text-white">${formatCurrency(c.gastado)} <span class="text-[9px] text-gray-400 dark:text-gray-500 font-semibold">/ ${formatCurrency(c.monto)}</span></div>
    `
    rightArea.appendChild(gastoInfo)
    rightArea.appendChild(btnToggleEdit)

    headerCard.appendChild(left)
    headerCard.appendChild(rightArea)

    const barraContainer = document.createElement('div')
    barraContainer.className = 'mt-3 mb-2'

    const barra = document.createElement('div')
    barra.className = 'h-2 rounded-full bg-gray-100 dark:bg-gray-800/80 overflow-hidden relative'
    const estaPausado = general?.estadoActivo === false

    const porcentaje =
      c.monto > 0 ? Math.min(100, Math.max(0, (c.gastado / c.monto) * 100)) : 0
    const inner = document.createElement('div')
    const excede = c.gastado > c.monto
    
    let innerColorClass = excede ? 'bg-red-500' : 'bg-emerald-500'
    if (estaPausado) {
      innerColorClass = 'bg-gray-400 dark:bg-gray-600'
    }
    
    inner.className = 'h-full rounded-full transition-all duration-500 ' + innerColorClass
    inner.style.width = porcentaje + '%'
    barra.appendChild(inner)

    // Metadatos de la barra de progreso (porcentaje y restante)
    const barraMeta = document.createElement('div')
    barraMeta.className = 'flex justify-between items-center mt-1.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400'
    const porcentajeTxt = c.monto > 0 ? ((c.gastado / c.monto) * 100).toFixed(0) + '%' : '0%'
    
    let restanteLabel, restanteColor
    if (estaPausado) {
      restanteLabel = 'Presupuesto pausado'
      restanteColor = 'text-gray-400 dark:text-gray-500 font-bold'
    } else {
      restanteLabel = excede ? 'Excedido por ' + formatCurrency(c.gastado - c.monto) : 'Disponible ' + formatCurrency(c.restante)
      restanteColor = excede ? 'text-red-500' : 'text-emerald-500 font-bold'
    }

    barraMeta.innerHTML = `<span>${porcentajeTxt} consumido</span><span class="${restanteColor}">${restanteLabel}</span>`

    barraContainer.appendChild(barra)
    barraContainer.appendChild(barraMeta)

    const formEdit = document.createElement('form')
    formEdit.dataset.catId = c.id
    formEdit.className = 'hidden grid grid-cols-1 sm:grid-cols-2 gap-4 items-end mt-4 pt-4 border-t border-gray-100 dark:border-gray-800/60'

    // Listener para expandir/colapsar
    btnToggleEdit.addEventListener('click', (e) => {
      e.stopPropagation()
      formEdit.classList.toggle('hidden')
      btnToggleEdit.classList.toggle('bg-sky-50')
      btnToggleEdit.classList.toggle('dark:bg-sky-900/20')
      btnToggleEdit.classList.toggle('text-sky-600')
    })

    const eEtiqueta = document.createElement('div')
    const lE = document.createElement('label')
    lE.className = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1'
    lE.textContent = 'Etiqueta'
    const sE = document.createElement('select')
    sE.required = true
    sE.className =
      'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-950 dark:text-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500'
    buildEtiquetaOptions(sE, etiquetas, c.etiquetaId)
    eEtiqueta.appendChild(lE)
    eEtiqueta.appendChild(sE)

    const eMonto = document.createElement('div')
    const lM = document.createElement('label')
    lM.className = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1'
    lM.textContent = 'Monto'
    const iM = document.createElement('input')
    iM.type = 'number'
    iM.step = '0.01'
    iM.min = '0.01'
    iM.required = true
    iM.value = c.monto
    iM.className =
      'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 font-bold'
    eMonto.appendChild(lM)
    eMonto.appendChild(iM)

    const eRest = document.createElement('div')
    eRest.className = 'p-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 flex items-center justify-between'
    eRest.innerHTML = `
      <div>
        <span class="text-[9px] font-semibold text-gray-400 uppercase tracking-wider block">Disponible</span>
        <span class="text-sm font-black text-gray-900 dark:text-white tracking-tight">${formatCurrency(c.restante)}</span>
      </div>
    `

    const eActions = document.createElement('div')
    eActions.className = 'flex gap-2'
    const btnSave = document.createElement('button')
    btnSave.type = 'submit'
    btnSave.className =
      'flex-1 inline-flex justify-center items-center bg-sky-600 dark:bg-sky-500 hover:bg-sky-700 dark:hover:bg-sky-600 text-white rounded-2xl py-3 px-3 font-semibold text-xs shadow-sm transition-colors'
    btnSave.textContent = 'Guardar'
    const btnDel = document.createElement('button')
    btnDel.type = 'button'
    btnDel.className =
      'inline-flex justify-center items-center p-3 rounded-2xl border border-red-200 text-red-500 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/20 transition-colors'
    btnDel.innerHTML = `<i data-lucide="trash-2" class="w-4 h-4"></i>`
    btnDel.title = 'Eliminar presupuesto'
    btnDel.dataset.catId = c.id
    eActions.appendChild(btnSave)
    eActions.appendChild(btnDel)

    formEdit.appendChild(eEtiqueta)
    formEdit.appendChild(eMonto)
    formEdit.appendChild(eRest)
    formEdit.appendChild(eActions)

    formEdit.addEventListener('submit', async (e) => {
      e.preventDefault()
      const etiquetaId = sE.value
      const montoVal = iM.value
      try {
        await actualizarPresupuestoCategoria(c.id, { etiquetaId, monto: montoVal })
        await renderGeneral()
        await renderCategorias()
      } catch (err) {
        alert(err.message || String(err))
      }
    })

    btnDel.addEventListener('click', async () => {
      if (!confirm('¿Eliminar este presupuesto de etiqueta?')) return
      try {
        await eliminarPresupuestoCategoria(c.id)
        await renderGeneral()
        await renderCategorias()
      } catch (err) {
        alert(err.message || String(err))
      }
    })

    card.appendChild(headerCard)
    card.appendChild(barraContainer)
    card.appendChild(formEdit)
    list.appendChild(card)
  })

  wrap.appendChild(list)
  if (window.lucide) {
    window.lucide.createIcons()
  }
}

async function init() {
  if (window.GTRTheme && typeof window.GTRTheme.applyThemeOnLoad === 'function') {
    window.GTRTheme.applyThemeOnLoad()
  }
  const toggleBtn = document.getElementById('theme-toggle')
  if (toggleBtn && window.GTRTheme && typeof window.GTRTheme.toggleTheme === 'function') {
    toggleBtn.addEventListener('click', window.GTRTheme.toggleTheme)
  }
  setActiveNav()

  // Inicialización de Pestañas (Tabs)
  const btnActual = document.getElementById('btn-tab-actual')
  const btnHistorial = document.getElementById('btn-tab-historial')
  const vistaActual = document.getElementById('vista-presupuesto-actual')
  const vistaHistorial = document.getElementById('vista-historial-periodos')

  if (btnActual && btnHistorial && vistaActual && vistaHistorial) {
    const switchTab = async (tab) => {
      activeTab = tab
      if (tab === 'actual') {
        btnActual.className = 'flex-1 text-center py-2 text-xs font-semibold rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm transition-all focus:outline-none'
        btnHistorial.className = 'flex-1 text-center py-2 text-xs font-semibold rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all focus:outline-none'
        
        vistaActual.classList.remove('hidden')
        vistaHistorial.classList.add('hidden')

        await renderGeneral()
        await renderCategorias()
      } else {
        btnHistorial.className = 'flex-1 text-center py-2 text-xs font-semibold rounded-xl bg-white dark:bg-gray-700 text-gray-900 dark:text-white shadow-sm transition-all focus:outline-none'
        btnActual.className = 'flex-1 text-center py-2 text-xs font-semibold rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all focus:outline-none'
        
        vistaActual.classList.add('hidden')
        vistaHistorial.classList.remove('hidden')

        await renderHistorial()
      }
    }

    btnActual.addEventListener('click', () => switchTab('actual'))
    btnHistorial.addEventListener('click', () => switchTab('historial'))
  }

  await renderGeneral()
  await renderCategorias()
}

document.addEventListener('DOMContentLoaded', init)

// === RECONSTRUCCIÓN Y RENDERIZADO DEL HISTORIAL DE PRESUPUESTOS ===

function obtenerPeriodosCerrados(general) {
  if (!general || !Array.isArray(general.historial)) return []
  
  const cierres = []
  const regex = /Periodo\s+(\d{4}-\d{2}-\d{2})\s+a\s+(\d{4}-\d{2}-\d{2})/
  
  general.historial.forEach(h => {
    if (h.tipo !== 'cierre') return
    const match = h.mensaje.match(regex)
    if (!match) return
    
    const inicioStr = match[1]
    const finStr = match[2]
    
    let limiteGeneral = 0
    const parts = h.mensaje.split('sobre presupuesto')
    if (parts.length > 1) {
      const matchMonto = parts[1].match(/[\d,.]+/)
      if (matchMonto) {
        limiteGeneral = parseFloat(matchMonto[0].replace(/,/g, ''))
      }
    }
    
    cierres.push({
      fechaLog: h.fecha,
      inicioStr,
      finStr,
      limiteGeneral,
      mensajeOriginal: h.mensaje
    })
  })
  
  return cierres.sort((a, b) => new Date(b.fechaLog).getTime() - new Date(a.fechaLog).getTime())
}

async function calcularDesglosePeriodoPasado(inicioStr, finStr) {
  const [yIni, mIni, dIni] = inicioStr.split('-').map(Number)
  const [yFin, mFin, dFin] = finStr.split('-').map(Number)
  
  const inicio = new Date(yIni, mIni - 1, dIni, 0, 0, 0)
  const fin = new Date(yFin, mFin - 1, dFin, 23, 59, 59)
  
  const ops = await listarOperaciones()
  const todasEtiquetas = await listarEtiquetas()
  const mapEt = new Map(todasEtiquetas.map(e => [e.id, e]))
  
  const iniT = inicio.getTime()
  const finT = fin.getTime()
  
  let gastoTotal = 0
  const gastadoPorEtiqueta = new Map()
  
  const obtenerAncestros = (etiquetaId) => {
    const ancestros = [etiquetaId]
    const visitados = new Set([etiquetaId])
    let actual = mapEt.get(etiquetaId)
    while (actual && actual.padreId) {
      if (visitados.has(actual.padreId)) break
      ancestros.push(actual.padreId)
      visitados.add(actual.padreId)
      actual = mapEt.get(actual.padreId)
    }
    return ancestros
  }
  
  ops.forEach(op => {
    if (op.tipo !== 'gasto') return
    const fLimpia = op.fecha.includes('T') ? op.fecha : op.fecha + 'T12:00:00'
    const d = new Date(fLimpia)
    const t = d.getTime()
    
    if (t >= iniT && t <= finT) {
      const cantidad = Number(op.cantidad || 0)
      if (op.estado === 'pagado') {
        gastoTotal += cantidad
        
        if (op.etiquetaId) {
          const afectadas = obtenerAncestros(op.etiquetaId)
          afectadas.forEach(etId => {
            const prev = gastadoPorEtiqueta.get(etId) || 0
            gastadoPorEtiqueta.set(etId, prev + cantidad)
          })
        }
      }
    }
  })
  
  return {
    gastoTotal,
    gastadoPorEtiqueta,
    mapEt
  }
}

async function renderHistorial() {
  const resumen = await calcularResumenPresupuestoActual()
  const general = resumen.general
  const containerAcordeon = document.getElementById('acordeon-periodos-pasados')
  const cardGrafico = document.getElementById('chart-presupuesto-historial')?.parentElement

  if (!containerAcordeon) return

  containerAcordeon.innerHTML = ''

  const cierres = obtenerPeriodosCerrados(general)

  if (cierres.length === 0) {
    containerAcordeon.innerHTML = `
      <div class="text-gray-400 dark:text-gray-500 italic py-6 text-center bg-gray-50/50 dark:bg-gray-900/30 rounded-2xl border border-gray-100 dark:border-gray-800/40">
        No hay periodos cerrados en el historial todavía. Tu primer periodo aparecerá aquí una vez que expire.
      </div>
    `
    if (cardGrafico) cardGrafico.classList.add('hidden')
    return
  }

  if (cardGrafico) cardGrafico.classList.remove('hidden')

  // === RENDERIZAR GRÁFICO HISTÓRICO (Últimos 5 periodos) ===
  const canvas = document.getElementById('chart-presupuesto-historial')
  if (canvas) {
    const periodosGrafico = cierres.slice(0, 5).reverse()
    
    const promesasGastos = periodosGrafico.map(async (p) => {
      const datos = await calcularDesglosePeriodoPasado(p.inicioStr, p.finStr)
      return datos.gastoTotal
    })
    
    const gastosTotales = await Promise.all(promesasGastos)
    
    const labels = periodosGrafico.map(p => {
      const parsearFechaLocalSimple = (str) => {
        const [y, m, d] = str.split('-').map(Number)
        const dt = new Date(y, m - 1, d)
        return dt.toLocaleDateString('es-ES', { day: 'numeric', month: 'short' })
      }
      return `${parsearFechaLocalSimple(p.inicioStr)} - ${parsearFechaLocalSimple(p.finStr)}`
    })

    const limites = periodosGrafico.map(p => p.limiteGeneral)

    if (chartHistorial) {
      chartHistorial.destroy()
    }

    const isDarkMode = document.documentElement.classList.contains('dark')
    const gridColor = isDarkMode ? 'rgba(75, 85, 99, 0.2)' : 'rgba(229, 231, 235, 0.5)'
    const textColor = isDarkMode ? '#9ca3af' : '#4b5563'

    chartHistorial = new Chart(canvas.getContext('2d'), {
      type: 'bar',
      data: {
        labels: labels,
        datasets: [
          {
            label: 'Presupuesto Límite',
            data: limites,
            backgroundColor: 'rgba(99, 102, 241, 0.2)',
            borderColor: 'rgba(99, 102, 241, 0.8)',
            borderWidth: 1.5,
            borderRadius: 6,
          },
          {
            label: 'Gasto Real',
            data: gastosTotales,
            backgroundColor: gastosTotales.map((g, i) => g > limites[i] ? 'rgba(239, 68, 68, 0.7)' : 'rgba(16, 185, 129, 0.7)'),
            borderColor: gastosTotales.map((g, i) => g > limites[i] ? 'rgba(239, 68, 68, 0.9)' : 'rgba(16, 185, 129, 0.9)'),
            borderWidth: 1.5,
            borderRadius: 6,
          }
        ]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          y: {
            grid: { color: gridColor },
            ticks: { color: textColor, font: { size: 10 } }
          },
          x: {
            grid: { display: false },
            ticks: { color: textColor, font: { size: 9 } }
          }
        },
        plugins: {
          legend: {
            position: 'bottom',
            labels: {
              boxWidth: 12,
              color: textColor,
              font: { size: 10, weight: 'bold' }
            }
          },
          tooltip: {
            callbacks: {
              label: function (context) {
                return context.dataset.label + ': ' + formatCurrency(context.parsed.y)
              }
            }
          }
        }
      }
    })
  }

  // === RENDERIZAR ACORDEÓN DE PERIODOS CERRADOS ===
  for (let i = 0; i < cierres.length; i++) {
    const p = cierres[i]
    const desglose = await calcularDesglosePeriodoPasado(p.inicioStr, p.finStr)
    const cumplido = desglose.gastoTotal <= p.limiteGeneral
    
    const item = document.createElement('div')
    item.className = 'bg-gray-50/50 dark:bg-gray-900/40 rounded-2xl border border-gray-100 dark:border-gray-800/60 overflow-hidden transition-all'
    
    const header = document.createElement('button')
    header.type = 'button'
    header.className = 'w-full flex flex-col sm:flex-row sm:items-center justify-between gap-3 p-4 text-left hover:bg-gray-100/30 dark:hover:bg-gray-800/10 transition-colors focus:outline-none'
    
    const pct = p.limiteGeneral > 0 ? (desglose.gastoTotal / p.limiteGeneral) * 100 : 0
    const pctTxt = pct.toFixed(0) + '%'
    const badgeBg = cumplido 
      ? 'bg-green-100 dark:bg-green-950/30 text-green-700 dark:text-green-400' 
      : 'bg-red-100 dark:bg-red-950/30 text-red-700 dark:text-red-400'
    const statusTxt = cumplido ? 'Cumplido' : 'Excedido'

    const formatearFechaCompleta = (str) => {
      const [y, m, d] = str.split('-').map(Number)
      const dt = new Date(y, m - 1, d)
      return dt.toLocaleDateString('es-ES', { year: 'numeric', month: 'short', day: '2-digit' })
    }

    header.innerHTML = `
      <div class="space-y-1">
        <div class="text-xs font-bold text-gray-900 dark:text-white flex items-center gap-2">
          <span>${formatearFechaCompleta(p.inicioStr)} a ${formatearFechaCompleta(p.finStr)}</span>
          <span class="text-[9px] px-2 py-0.5 rounded-full font-bold uppercase tracking-wider ${badgeBg}">${statusTxt}</span>
        </div>
        <div class="text-[10px] text-gray-400 dark:text-gray-500">
          Gasto: <span class="font-semibold text-gray-700 dark:text-gray-300">${formatCurrency(desglose.gastoTotal)}</span> de ${formatCurrency(p.limiteGeneral)} (${pctTxt})
        </div>
      </div>
      <div class="flex items-center gap-3 w-full sm:w-auto">
        <div class="w-full sm:w-28 bg-gray-200 dark:bg-gray-700 h-1.5 rounded-full overflow-hidden flex-shrink-0">
          <div class="h-full ${cumplido ? 'bg-green-500' : 'bg-red-500'}" style="width: ${Math.min(100, pct)}%"></div>
        </div>
        <i data-lucide="chevron-down" class="w-4 h-4 text-gray-400 flex-shrink-0 transition-transform duration-200 transform"></i>
      </div>
    `
    
    const content = document.createElement('div')
    content.className = 'hidden border-t border-gray-100 dark:border-gray-800/60 p-4 bg-white/40 dark:bg-gray-950/10 space-y-4'
    
    const tableDiv = document.createElement('div')
    tableDiv.className = 'overflow-x-auto rounded-xl border border-gray-100 dark:border-gray-800/40'
    
    const table = document.createElement('table')
    table.className = 'w-full text-xs text-left'
    table.innerHTML = `
      <thead class="bg-gray-50 dark:bg-gray-900/60 text-[10px] uppercase font-bold tracking-wider text-gray-500 dark:text-gray-400 border-b border-gray-100 dark:border-gray-800/40">
        <tr>
          <th class="px-4 py-2.5">Etiqueta</th>
          <th class="px-4 py-2.5 text-right">Límite</th>
          <th class="px-4 py-2.5 text-right">Gastado</th>
          <th class="px-4 py-2.5 text-right">Restante</th>
          <th class="px-4 py-2.5">Estado</th>
        </tr>
      </thead>
      <tbody class="divide-y divide-gray-100 dark:divide-gray-800/30 text-gray-700 dark:text-gray-300">
      </tbody>
    `
    const tbody = table.querySelector('tbody')
    
    resumen.categorias.forEach(catBudget => {
      const gastadoCat = desglose.gastadoPorEtiqueta.get(catBudget.etiquetaId) || 0
      const restanteCat = catBudget.monto - gastadoCat
      const catCumplido = gastadoCat <= catBudget.monto
      const catPct = catBudget.monto > 0 ? (gastadoCat / catBudget.monto) * 100 : 0
      
      const tr = document.createElement('tr')
      tr.className = 'hover:bg-gray-50/20 dark:hover:bg-gray-800/10 transition-colors'
      tr.innerHTML = `
        <td class="px-4 py-2.5">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full" style="background-color: ${catBudget.etiquetaColor || '#9ca3af'}"></span>
            <span class="font-medium">${catBudget.etiquetaNombre}</span>
          </div>
        </td>
        <td class="px-4 py-2.5 text-right font-mono">${formatCurrency(catBudget.monto)}</td>
        <td class="px-4 py-2.5 text-right font-mono font-medium">${formatCurrency(gastadoCat)}</td>
        <td class="px-4 py-2.5 text-right font-mono ${restanteCat >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">${restanteCat >= 0 ? '+' : ''}${formatCurrency(restanteCat)}</td>
        <td class="px-4 py-2.5">
          <div class="flex items-center gap-2">
            <span class="text-[10px] font-bold px-2 py-0.5 rounded-full ${catCumplido ? 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400' : 'bg-red-50 dark:bg-red-950/20 text-red-700 dark:text-red-400'}">
              ${catCumplido ? 'OK' : 'Excedido'}
            </span>
            <span class="text-[10px] text-gray-400 font-bold">${catPct.toFixed(0)}%</span>
          </div>
        </td>
      `
      tbody.appendChild(tr)
    })
    
    const idsPresupuestados = new Set(resumen.categorias.map(c => c.etiquetaId))
    desglose.gastadoPorEtiqueta.forEach((gastadoVal, etId) => {
      if (idsPresupuestados.has(etId)) return
      if (gastadoVal <= 0) return
      
      const et = desglose.mapEt.get(etId)
      const nombre = et ? et.nombre : 'Etiqueta eliminada'
      const color = et ? et.color : '#64748b'
      
      const tr = document.createElement('tr')
      tr.className = 'hover:bg-gray-50/20 dark:hover:bg-gray-800/10 transition-colors opacity-75'
      tr.innerHTML = `
        <td class="px-4 py-2.5">
          <div class="flex items-center gap-2">
            <span class="w-2 h-2 rounded-full" style="background-color: ${color}"></span>
            <span class="font-medium italic">${nombre} (Sin ppt.)</span>
          </div>
        </td>
        <td class="px-4 py-2.5 text-right font-mono text-gray-400 italic">N/A</td>
        <td class="px-4 py-2.5 text-right font-mono font-medium">${formatCurrency(gastadoVal)}</td>
        <td class="px-4 py-2.5 text-right font-mono text-gray-400 italic">N/A</td>
        <td class="px-4 py-2.5">
          <span class="text-[10px] font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400">
            Gastado
          </span>
        </td>
      `
      tbody.appendChild(tr)
    })

    if (tbody.children.length === 0) {
      tbody.innerHTML = `<tr><td colspan="5" class="px-4 py-4 text-center text-gray-400 dark:text-gray-500 italic">No hubo gastos en categorías registradas en este periodo.</td></tr>`
    }
    
    tableDiv.appendChild(table)
    content.appendChild(tableDiv)
    item.appendChild(header)
    item.appendChild(content)
    
    header.addEventListener('click', () => {
      const isHidden = content.classList.contains('hidden')
      const arrow = header.querySelector('[data-lucide="chevron-down"]')
      
      if (isHidden) {
        content.classList.remove('hidden')
        if (arrow) arrow.classList.add('rotate-180')
        item.classList.add('ring-1', 'ring-indigo-500/30', 'dark:ring-indigo-500/20')
      } else {
        content.classList.add('hidden')
        if (arrow) arrow.classList.remove('rotate-180')
        item.classList.remove('ring-1', 'ring-indigo-500/30', 'dark:ring-indigo-500/20')
      }
    })
    
    containerAcordeon.appendChild(item)
  }

  if (window.lucide) {
    window.lucide.createIcons()
  }
}


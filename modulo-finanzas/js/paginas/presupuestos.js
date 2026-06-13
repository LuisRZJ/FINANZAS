import {
  configurarPresupuestoGeneral,
  calcularResumenPresupuestoActual,
  crearPresupuestoCategoria,
  actualizarPresupuestoCategoria,
  eliminarPresupuestoCategoria,
  revisarPeriodosPresupuesto
} from '../servicios/presupuestos.js'
import { listarEtiquetas } from '../servicios/etiquetas.js'

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

  const resumenBox = document.createElement('div')
  resumenBox.className = 'grid grid-cols-1 sm:grid-cols-2 gap-4 mb-6'

  const g = resumen.general

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
  form.className = 'grid grid-cols-1 sm:grid-cols-2 gap-4 items-end mb-4 bg-gray-50/50 dark:bg-gray-900/30 p-5 rounded-3xl border border-gray-100 dark:border-gray-800/40'

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

  const fInicio = document.createElement('div')
  const lInicio = document.createElement('label')
  lInicio.className = 'block text-xs font-semibold text-gray-400 uppercase tracking-wider mb-1'
  lInicio.textContent = 'Fecha inicio'
  const iInicio = document.createElement('input')
  iInicio.type = 'date'
  iInicio.required = true
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
  iFin.required = true
  iFin.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all'
  if (g && g.fechaFin) iFin.value = g.fechaFin
  fFin.appendChild(lFin)
  fFin.appendChild(iFin)

  const fBtn = document.createElement('div')
  const btn = document.createElement('button')
  btn.type = 'submit'
  btn.className =
    'w-full inline-flex justify-center items-center bg-sky-600 dark:bg-sky-500 hover:bg-sky-700 dark:hover:bg-sky-600 text-white rounded-2xl py-3 px-4 font-semibold text-xs shadow-sm transition-colors'
  btn.textContent = g ? 'Actualizar' : 'Crear'
  fBtn.appendChild(btn)

  form.appendChild(fMonto)
  form.appendChild(fInicio)
  form.appendChild(fFin)
  form.appendChild(fBtn)

  const error = document.createElement('div')
  error.id = 'error-presupuesto-general'
  error.className = 'mt-2 text-xs font-semibold text-red-500 hidden'

  card.appendChild(form)
  card.appendChild(error)

  const histWrap = document.createElement('div')
  histWrap.className = 'mt-6 border-t border-gray-100 dark:border-gray-800/80 pt-4'
  const hTitle = document.createElement('div')
  hTitle.className = 'text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-3'
  hTitle.textContent = 'Historial del presupuesto general'
  const histList = document.createElement('div')
  histList.className = 'text-xs max-h-40 overflow-y-auto space-y-3'

  const historial = g && Array.isArray(g.historial) ? g.historial.slice() : []
  if (historial.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'text-gray-400 dark:text-gray-500 italic py-1'
    empty.textContent = 'Sin registros aún.'
    histList.appendChild(empty)
  } else {
    historial
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .forEach((h) => {
        const row = document.createElement('div')
        row.className = 'flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400'

        const dot = document.createElement('div')
        const isCierre = h.tipo === 'cierre'
        const isConfig = h.tipo === 'config'
        dot.className = `w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${isCierre ? 'bg-gray-400' : isConfig ? 'bg-blue-400' : 'bg-sky-400'}`

        const textSpan = document.createElement('span')
        const fechaTxt = formatDate(h.fecha.slice(0, 10))
        const label = isCierre ? '[Cierre]' : isConfig ? '[Config]' : '[Sistema]'
        textSpan.innerHTML = `<span class="font-bold text-gray-400 dark:text-gray-500">${fechaTxt}</span> <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-400 font-bold">${label}</span> ${h.mensaje}`

        row.appendChild(dot)
        row.appendChild(textSpan)
        histList.appendChild(row)
      })
  }

  histWrap.appendChild(hTitle)
  histWrap.appendChild(histList)
  card.appendChild(histWrap)
  wrap.appendChild(card)

  if (window.lucide) {
    window.lucide.createIcons()
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault()
    const montoVal = iMonto.value
    const iniVal = iInicio.value
    const finVal = iFin.value
    try {
      await configurarPresupuestoGeneral({
        monto: montoVal,
        fechaInicio: iniVal,
        fechaFin: finVal
      })
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
    const porcentaje =
      c.monto > 0 ? Math.min(100, Math.max(0, (c.gastado / c.monto) * 100)) : 0
    const inner = document.createElement('div')
    const excede = c.gastado > c.monto
    inner.className = 'h-full rounded-full transition-all duration-500 ' + (excede ? 'bg-red-500' : 'bg-emerald-500')
    inner.style.width = porcentaje + '%'
    barra.appendChild(inner)

    // Metadatos de la barra de progreso (porcentaje y restante)
    const barraMeta = document.createElement('div')
    barraMeta.className = 'flex justify-between items-center mt-1.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400'
    const porcentajeTxt = c.monto > 0 ? ((c.gastado / c.monto) * 100).toFixed(0) + '%' : '0%'
    const restanteLabel = excede ? 'Excedido por ' + formatCurrency(c.gastado - c.monto) : 'Disponible ' + formatCurrency(c.restante)
    const restanteColor = excede ? 'text-red-500' : 'text-emerald-500'

    barraMeta.innerHTML = `<span>${porcentajeTxt} consumido</span><span class="${restanteColor} font-bold">${restanteLabel}</span>`

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
  await renderGeneral()
  await renderCategorias()
}

document.addEventListener('DOMContentLoaded', init)


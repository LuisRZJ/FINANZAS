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

function renderGeneral() {
  revisarPeriodosPresupuesto()
  const resumen = calcularResumenPresupuestoActual()
  const wrap = document.getElementById('presupuesto-general')
  if (!wrap) return
  wrap.innerHTML = ''

  const card = document.createElement('section')
  card.className =
    'rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 shadow-sm'

  const title = document.createElement('h2')
  title.className = 'text-lg font-semibold mb-2'
  title.textContent = 'Presupuesto general de gastos'
  card.appendChild(title)

  const desc = document.createElement('p')
  desc.className = 'text-xs text-gray-600 dark:text-gray-300 mb-4'
  desc.textContent =
    'Define un límite de gasto para un periodo. Luego asigna parte de ese monto a etiquetas de gasto específicas. El gasto real se calcula con base en tus transacciones.'
  card.appendChild(desc)

  const resumenBox = document.createElement('div')
  resumenBox.className = 'grid grid-cols-1 md:grid-cols-4 gap-3 mb-4'

  const g = resumen.general

  const boxMonto = document.createElement('div')
  boxMonto.innerHTML =
    '<div class="text-xs text-gray-500">Presupuesto actual</div><div class="text-lg font-semibold">' +
    (g ? formatCurrency(g.monto) : 'Sin definir') +
    '</div>'

  const boxPeriodo = document.createElement('div')
  let periodoTxt = 'Sin periodo'
  if (g && g.fechaInicio && g.fechaFin) {
    periodoTxt = formatDate(g.fechaInicio) + ' → ' + formatDate(g.fechaFin)
  }
  boxPeriodo.innerHTML =
    '<div class="text-xs text-gray-500">Periodo vigente</div><div class="text-xs">' +
    periodoTxt +
    '</div>'

  const boxAsignado = document.createElement('div')
  boxAsignado.innerHTML =
    '<div class="text-xs text-gray-500">Asignado a etiquetas</div><div class="text-lg font-semibold">' +
    formatCurrency(resumen.totalCategorias) +
    '</div>'

  const restante = g ? resumen.restanteAsignar : 0
  const boxRestante = document.createElement('div')
  boxRestante.innerHTML =
    '<div class="text-xs text-gray-500">Disponible para asignar</div><div class="text-lg font-semibold">' +
    formatCurrency(restante) +
    '</div>'

  resumenBox.appendChild(boxMonto)
  resumenBox.appendChild(boxPeriodo)
  resumenBox.appendChild(boxAsignado)
  resumenBox.appendChild(boxRestante)
  card.appendChild(resumenBox)

  const form = document.createElement('form')
  form.id = 'form-presupuesto-general'
  form.className = 'grid grid-cols-1 md:grid-cols-4 gap-3 items-end mb-3'

  const fMonto = document.createElement('div')
  const lMonto = document.createElement('label')
  lMonto.className = 'block text-xs font-medium mb-1'
  lMonto.textContent = 'Monto del presupuesto general'
  const iMonto = document.createElement('input')
  iMonto.type = 'number'
  iMonto.step = '0.01'
  iMonto.min = '0.01'
  iMonto.required = true
  iMonto.className =
    'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
  if (g) iMonto.value = g.monto
  fMonto.appendChild(lMonto)
  fMonto.appendChild(iMonto)

  const fInicio = document.createElement('div')
  const lInicio = document.createElement('label')
  lInicio.className = 'block text-xs font-medium mb-1'
  lInicio.textContent = 'Fecha inicio'
  const iInicio = document.createElement('input')
  iInicio.type = 'date'
  iInicio.required = true
  iInicio.className =
    'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
  if (g && g.fechaInicio) iInicio.value = g.fechaInicio
  fInicio.appendChild(lInicio)
  fInicio.appendChild(iInicio)

  const fFin = document.createElement('div')
  const lFin = document.createElement('label')
  lFin.className = 'block text-xs font-medium mb-1'
  lFin.textContent = 'Fecha fin'
  const iFin = document.createElement('input')
  iFin.type = 'date'
  iFin.required = true
  iFin.className =
    'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
  if (g && g.fechaFin) iFin.value = g.fechaFin
  fFin.appendChild(lFin)
  fFin.appendChild(iFin)

  const fBtn = document.createElement('div')
  const btn = document.createElement('button')
  btn.type = 'submit'
  btn.className =
    'inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700'
  btn.textContent = g ? 'Actualizar presupuesto' : 'Crear presupuesto'
  fBtn.appendChild(btn)

  form.appendChild(fMonto)
  form.appendChild(fInicio)
  form.appendChild(fFin)
  form.appendChild(fBtn)

  const error = document.createElement('div')
  error.id = 'error-presupuesto-general'
  error.className = 'mt-2 text-sm text-red-600 hidden'

  card.appendChild(form)
  card.appendChild(error)

  const histWrap = document.createElement('div')
  histWrap.className = 'mt-4 border-t border-gray-200 dark:border-gray-800 pt-3'
  const hTitle = document.createElement('div')
  hTitle.className = 'text-xs font-semibold text-gray-600 dark:text-gray-300 mb-1'
  hTitle.textContent = 'Historial del presupuesto general'
  const histList = document.createElement('div')
  histList.className = 'text-xs max-h-40 overflow-y-auto'

  const historial = g && Array.isArray(g.historial) ? g.historial.slice() : []
  if (historial.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'text-gray-500 italic'
    empty.textContent = 'Sin registros aún.'
    histList.appendChild(empty)
  } else {
    historial
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .forEach((h) => {
        const row = document.createElement('div')
        const fechaTxt = formatDate(h.fecha.slice(0, 10))
        const label = h.tipo === 'cierre' ? '[Cierre]' : h.tipo === 'config' ? '[Config]' : '[Sistema]'
        row.textContent = fechaTxt + ' ' + label + ' ' + h.mensaje
        histList.appendChild(row)
      })
  }

  histWrap.appendChild(hTitle)
  histWrap.appendChild(histList)

  card.appendChild(histWrap)
  wrap.appendChild(card)

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const montoVal = iMonto.value
    const iniVal = iInicio.value
    const finVal = iFin.value
    try {
      configurarPresupuestoGeneral({
        monto: montoVal,
        fechaInicio: iniVal,
        fechaFin: finVal
      })
      error.textContent = ''
      error.classList.add('hidden')
      renderGeneral()
      renderCategorias()
    } catch (err) {
      error.textContent = err.message || String(err)
      error.classList.remove('hidden')
    }
  })
}

function renderCategorias() {
  const wrap = document.getElementById('presupuestos-categorias')
  if (!wrap) return
  wrap.innerHTML = ''

  const resumen = calcularResumenPresupuestoActual()
  const general = resumen.general
  const etiquetas = listarEtiquetas().filter((e) => e.tipo === 'gasto')

  const header = document.createElement('div')
  header.className = 'flex items-center justify-between mb-3'
  const title = document.createElement('h2')
  title.className = 'text-lg font-semibold'
  title.textContent = 'Presupuestos por etiqueta de gasto'
  header.appendChild(title)
  wrap.appendChild(header)

  const desc = document.createElement('p')
  desc.className = 'text-xs text-gray-600 dark:text-gray-300 mb-4'
  desc.textContent =
    'Asigna partes de tu presupuesto general a etiquetas específicas. El gasto se calcula con base en transacciones de tipo gasto ligadas a cada etiqueta.'
  wrap.appendChild(desc)

  if (!general) {
    const alert = document.createElement('div')
    alert.className =
      'rounded-md border border-amber-300 bg-amber-50 text-amber-900 dark:bg-amber-900/20 dark:border-amber-500 dark:text-amber-100 px-4 py-3 text-xs'
    alert.textContent = 'Primero define un presupuesto general para poder asignar presupuestos por etiqueta.'
    wrap.appendChild(alert)
    return
  }

  const form = document.createElement('form')
  form.id = 'form-presupuesto-categoria'
  form.className = 'grid grid-cols-1 md:grid-cols-4 gap-3 items-end mb-4'

  const fEtiqueta = document.createElement('div')
  const lEtiqueta = document.createElement('label')
  lEtiqueta.className = 'block text-xs font-medium mb-1'
  lEtiqueta.textContent = 'Etiqueta de gasto'
  const sEtiqueta = document.createElement('select')
  sEtiqueta.required = true
  sEtiqueta.className =
    'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
  buildEtiquetaOptions(sEtiqueta, etiquetas, '')
  fEtiqueta.appendChild(lEtiqueta)
  fEtiqueta.appendChild(sEtiqueta)

  const fMonto = document.createElement('div')
  const lMonto = document.createElement('label')
  lMonto.className = 'block text-xs font-medium mb-1'
  lMonto.textContent = 'Monto del presupuesto'
  const iMonto = document.createElement('input')
  iMonto.type = 'number'
  iMonto.step = '0.01'
  iMonto.min = '0.01'
  iMonto.required = true
  iMonto.className =
    'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
  fMonto.appendChild(lMonto)
  fMonto.appendChild(iMonto)

  const fDisponible = document.createElement('div')
  fDisponible.innerHTML =
    '<div class="text-xs text-gray-500">Disponible del general</div><div class="text-lg font-semibold">' +
    formatCurrency(resumen.restanteAsignar) +
    '</div>'

  const fBtn = document.createElement('div')
  const btn = document.createElement('button')
  btn.type = 'submit'
  btn.className =
    'inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700'
  btn.textContent = 'Agregar presupuesto'
  fBtn.appendChild(btn)

  form.appendChild(fEtiqueta)
  form.appendChild(fMonto)
  form.appendChild(fDisponible)
  form.appendChild(fBtn)

  const error = document.createElement('div')
  error.id = 'error-presupuesto-categoria'
  error.className = 'mt-2 text-sm text-red-600 hidden'

  wrap.appendChild(form)
  wrap.appendChild(error)

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const etiquetaId = sEtiqueta.value
    const montoVal = iMonto.value
    try {
      crearPresupuestoCategoria({ etiquetaId, monto: montoVal })
      error.textContent = ''
      error.classList.add('hidden')
      form.reset()
      buildEtiquetaOptions(sEtiqueta, etiquetas, '')
      renderGeneral()
      renderCategorias()
    } catch (err) {
      error.textContent = err.message || String(err)
      error.classList.remove('hidden')
    }
  })

  if (resumen.categorias.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'text-sm text-gray-500 italic'
    empty.textContent = 'Aún no hay presupuestos por etiqueta.'
    wrap.appendChild(empty)
    return
  }

  const list = document.createElement('div')
  list.className = 'mt-4 space-y-3'

  resumen.categorias.forEach((c) => {
    const card = document.createElement('section')
    card.className =
      'rounded-lg border border-gray-200 dark:border-gray-800 bg-white dark:bg-gray-900 p-4'

    const header = document.createElement('div')
    header.className = 'flex items-center justify-between mb-2'

    const left = document.createElement('div')
    left.className = 'flex items-center gap-2'

    const badge = document.createElement('div')
    badge.className = 'w-3 h-3 rounded-full'
    badge.style.backgroundColor = c.etiquetaColor
    const titleRow = document.createElement('div')
    titleRow.className = 'text-sm font-semibold'
    titleRow.textContent = c.etiquetaNombre

    left.appendChild(badge)
    left.appendChild(titleRow)

    const gastoInfo = document.createElement('div')
    gastoInfo.className = 'text-xs text-right'
    const gastoLinea1 = document.createElement('div')
    gastoLinea1.textContent = 'Gastado ' + formatCurrency(c.gastado)
    const gastoLinea2 = document.createElement('div')
    gastoLinea2.textContent = 'Presupuesto ' + formatCurrency(c.monto)
    gastoInfo.appendChild(gastoLinea1)
    gastoInfo.appendChild(gastoLinea2)

    header.appendChild(left)
    header.appendChild(gastoInfo)

    const barra = document.createElement('div')
    barra.className = 'mt-1 mb-3 h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden'
    const porcentaje =
      c.monto > 0 ? Math.min(150, Math.max(0, (c.gastado / c.monto) * 100)) : 0
    const inner = document.createElement('div')
    inner.className =
      'h-full ' +
      (c.gastado <= c.monto
        ? 'bg-emerald-500'
        : 'bg-red-500')
    inner.style.width = porcentaje + '%'
    barra.appendChild(inner)

    const formEdit = document.createElement('form')
    formEdit.dataset.catId = c.id
    formEdit.className = 'grid grid-cols-1 md:grid-cols-4 gap-3 items-end'

    const eEtiqueta = document.createElement('div')
    const lE = document.createElement('label')
    lE.className = 'block text-xs font-medium mb-1'
    lE.textContent = 'Etiqueta'
    const sE = document.createElement('select')
    sE.required = true
    sE.className =
      'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
    buildEtiquetaOptions(sE, etiquetas, c.etiquetaId)
    eEtiqueta.appendChild(lE)
    eEtiqueta.appendChild(sE)

    const eMonto = document.createElement('div')
    const lM = document.createElement('label')
    lM.className = 'block text-xs font-medium mb-1'
    lM.textContent = 'Monto'
    const iM = document.createElement('input')
    iM.type = 'number'
    iM.step = '0.01'
    iM.min = '0.01'
    iM.required = true
    iM.value = c.monto
    iM.className =
      'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
    eMonto.appendChild(lM)
    eMonto.appendChild(iM)

    const eRest = document.createElement('div')
    eRest.innerHTML =
      '<div class="text-xs text-gray-500">Restante en esta etiqueta</div><div class="text-sm font-semibold">' +
      formatCurrency(c.restante) +
      '</div>'

    const eActions = document.createElement('div')
    eActions.className = 'flex flex-col sm:flex-row gap-2'
    const btnSave = document.createElement('button')
    btnSave.type = 'submit'
    btnSave.className =
      'inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700'
    btnSave.textContent = 'Guardar cambios'
    const btnDel = document.createElement('button')
    btnDel.type = 'button'
    btnDel.className =
      'inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium border border-red-500 text-red-600 hover:bg-red-50 dark:border-red-500 dark:text-red-300 dark:hover:bg-red-900/30'
    btnDel.textContent = 'Eliminar'
    btnDel.dataset.catId = c.id
    eActions.appendChild(btnSave)
    eActions.appendChild(btnDel)

    formEdit.appendChild(eEtiqueta)
    formEdit.appendChild(eMonto)
    formEdit.appendChild(eRest)
    formEdit.appendChild(eActions)

    formEdit.addEventListener('submit', (e) => {
      e.preventDefault()
      const etiquetaId = sE.value
      const montoVal = iM.value
      try {
        actualizarPresupuestoCategoria(c.id, { etiquetaId, monto: montoVal })
        renderGeneral()
        renderCategorias()
      } catch (err) {
        alert(err.message || String(err))
      }
    })

    btnDel.addEventListener('click', () => {
      if (!confirm('¿Eliminar este presupuesto de etiqueta?')) return
      try {
        eliminarPresupuestoCategoria(c.id)
        renderGeneral()
        renderCategorias()
      } catch (err) {
        alert(err.message || String(err))
      }
    })

    card.appendChild(header)
    card.appendChild(barra)
    card.appendChild(formEdit)
    list.appendChild(card)
  })

  wrap.appendChild(list)
}

function init() {
  if (window.GTRTheme && typeof window.GTRTheme.applyThemeOnLoad === 'function') {
    window.GTRTheme.applyThemeOnLoad()
  }
  const toggleBtn = document.getElementById('theme-toggle')
  if (toggleBtn && window.GTRTheme && typeof window.GTRTheme.toggleTheme === 'function') {
    toggleBtn.addEventListener('click', window.GTRTheme.toggleTheme)
  }
  setActiveNav()
  renderGeneral()
  renderCategorias()
}

document.addEventListener('DOMContentLoaded', init)


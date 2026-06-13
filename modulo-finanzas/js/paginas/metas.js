import {
  listarMetas,
  listarMetasSimples,
  guardarMetaParametros,
  cambiarEstadoMeta,
  revisarPeriodosYActualizar,
  crearMetaSimple,
  actualizarMetaSimple,
  eliminarMetaSimple,
  evaluarMetasSimples
} from '../servicios/metas.js'
import { listarOperaciones } from '../servicios/operaciones.js'
import { listarCuentas } from '../servicios/cuentas.js'
import { parseFecha, formatFechaLegible } from '../sistema/fechas.js'

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function formatDate(fechaStr) {
  return formatFechaLegible(fechaStr)
}


function calcularProgresoMeta(meta, operaciones) {
  if (!meta.fechaInicio || !meta.fechaFin) {
    return { actual: 0, porcentaje: 0, contribuciones: [] }
  }

  const inicio = parseFecha(meta.fechaInicio)
  const fin = parseFecha(meta.fechaFin)
  if (!inicio || !fin) return { actual: 0, porcentaje: 0, contribuciones: [] }

  let actual = 0
  const contribuciones = []

  const sortedOps = [...operaciones].sort((a, b) => {
    // Usar parseFecha para evitar problemas de timezone
    const da = parseFecha(a.fecha)
    const db = parseFecha(b.fecha)
    return (da?.getTime() || 0) - (db?.getTime() || 0)
  })

  sortedOps.forEach((op) => {
    const d = parseFecha(op.fecha)
    if (!d) return
    if (d < inicio || d > fin) return

    let aporte = 0
    if (meta.tipo === 'ganancias' && op.tipo === 'ingreso') {
      aporte = Number(op.cantidad || 0)
    } else if (meta.tipo === 'gastos' && op.tipo === 'gasto') {
      aporte = Number(op.cantidad || 0)
    } else if (meta.tipo === 'pnl') {
      if (op.tipo === 'ingreso') aporte = Number(op.cantidad || 0)
      else if (op.tipo === 'gasto') aporte = -Number(op.cantidad || 0)
    }

    if (!aporte) return
    actual += aporte
    contribuciones.push({
      fecha: op.fecha,
      tipo: 'contribucion',
      mensaje: op.nombre || op.descripcion || 'Operación',
      aporte,
      acumulado: actual
    })
  })

  const objetivo = Number(meta.objetivo || 0)
  const porcentaje = objetivo > 0 ? Math.min(999, Math.max(0, (actual / objetivo) * 100)) : 0

  return { actual, porcentaje, contribuciones }
}
function crearCardMeta(meta, progreso) {
  const card = document.createElement('div')
  card.className =
    'rounded-3xl border border-gray-100 dark:border-gray-800/80 bg-gray-50/40 dark:bg-gray-900/20 p-5 relative overflow-hidden transition-all hover:shadow-sm animate-fade-in'

  const typeColors = { ganancias: '#10b981', gastos: '#ef4444', pnl: '#3b82f6' }
  const metaColor = typeColors[meta.tipo] || '#3b82f6'
  card.style.borderLeft = `4px solid ${metaColor}`

  const header = document.createElement('div')
  header.className = 'flex items-start justify-between gap-4 mb-4'

  const titleBox = document.createElement('div')
  titleBox.className = 'min-w-0'
  const title = document.createElement('h4')
  title.className = 'text-sm font-bold text-gray-900 dark:text-white truncate'
  title.textContent = meta.nombre
  const subtitle = document.createElement('p')
  subtitle.className = 'text-[10px] text-gray-400 dark:text-gray-500 mt-0.5'
  subtitle.textContent = meta.activo
    ? 'Seguimiento activo de operaciones.'
    : 'Seguimiento pausado. Configura los parámetros.'
  titleBox.appendChild(title)
  titleBox.appendChild(subtitle)

  const rightArea = document.createElement('div')
  rightArea.className = 'flex items-center gap-2 flex-shrink-0'

  const estado = document.createElement('span')
  estado.className =
    'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider ' +
    (meta.activo
      ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
      : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-400')
  estado.textContent = meta.activo ? 'Activa' : 'Apagada'

  const btnToggleEdit = document.createElement('button')
  btnToggleEdit.type = 'button'
  btnToggleEdit.className =
    'p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-900/20 rounded-xl transition-all'
  btnToggleEdit.innerHTML = `<i data-lucide="pencil" class="w-3.5 h-3.5"></i>`
  btnToggleEdit.title = 'Editar parámetros'

  rightArea.appendChild(estado)
  rightArea.appendChild(btnToggleEdit)

  header.appendChild(titleBox)
  header.appendChild(rightArea)
  card.appendChild(header)

  const grid = document.createElement('div')
  grid.className = 'grid grid-cols-1 sm:grid-cols-3 gap-3 mb-4'

  const objetivoBox = document.createElement('div')
  objetivoBox.className =
    'p-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/80 flex items-center gap-2.5'
  const objValStr = meta.objetivo > 0 ? formatCurrency(meta.objetivo) : 'Sin definir'
  objetivoBox.innerHTML = `
    <div class="w-8 h-8 rounded-lg bg-sky-50 dark:bg-sky-950/30 flex items-center justify-center text-sky-500 dark:text-sky-400 border border-sky-100/40 dark:border-sky-900/20 flex-shrink-0">
      <i data-lucide="target" class="w-4 h-4"></i>
    </div>
    <div class="min-w-0">
      <span class="text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider block">Objetivo</span>
      <span class="text-xs font-extrabold text-gray-900 dark:text-white tracking-tight truncate block">${objValStr}</span>
    </div>
  `

  const actualBox = document.createElement('div')
  actualBox.className =
    'p-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/80 flex items-center gap-2.5'
  const actIconColor =
    meta.tipo === 'gastos'
      ? 'text-red-500 bg-red-50 dark:bg-red-950/30 border-red-100/40 dark:border-red-900/20'
      : 'text-emerald-500 bg-emerald-50 dark:bg-emerald-950/30 border-emerald-100/40 dark:border-emerald-900/20'
  actualBox.innerHTML = `
    <div class="w-8 h-8 rounded-lg ${actIconColor} flex items-center justify-center border flex-shrink-0">
      <i data-lucide="trending-up" class="w-4 h-4"></i>
    </div>
    <div class="min-w-0">
      <span class="text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider block">Actual</span>
      <span class="text-xs font-extrabold text-gray-900 dark:text-white tracking-tight truncate block">${formatCurrency(progreso.actual)}</span>
    </div>
  `

  const periodoBox = document.createElement('div')
  periodoBox.className =
    'p-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/80 flex items-center gap-2.5'
  let perValStr = 'Sin periodo'
  if (meta.fechaInicio && meta.fechaFin) {
    perValStr = formatDate(meta.fechaInicio) + ' → ' + formatDate(meta.fechaFin)
  }
  periodoBox.innerHTML = `
    <div class="w-8 h-8 rounded-lg bg-amber-50 dark:bg-amber-950/30 flex items-center justify-center text-amber-500 dark:text-amber-400 border border-amber-100/40 dark:border-amber-900/20 flex-shrink-0">
      <i data-lucide="calendar" class="w-4 h-4"></i>
    </div>
    <div class="min-w-0">
      <span class="text-[9px] font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider block">Periodo</span>
      <span class="text-[10px] font-bold text-gray-800 dark:text-gray-200 block" title="${perValStr}">${perValStr}</span>
    </div>
  `

  grid.appendChild(objetivoBox)
  grid.appendChild(actualBox)
  grid.appendChild(periodoBox)
  card.appendChild(grid)

  const progressWrapper = document.createElement('div')
  progressWrapper.className = 'mt-3 mb-2'

  const progressBar = document.createElement('div')
  progressBar.className = 'w-full h-2 rounded-full bg-gray-100 dark:bg-gray-800/80 overflow-hidden relative'
  const progressInner = document.createElement('div')
  const isExceeded = meta.tipo === 'gastos' && progreso.actual > meta.objetivo
  const colorFill = meta.tipo === 'gastos' ? (isExceeded ? 'bg-red-500' : 'bg-emerald-500') : 'bg-sky-500'
  progressInner.className = 'h-full rounded-full transition-all duration-500 ' + colorFill
  progressInner.style.width = Math.min(100, progreso.porcentaje) + '%'
  progressBar.appendChild(progressInner)

  const progressMeta = document.createElement('div')
  progressMeta.className =
    'flex justify-between items-center mt-1.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400'
  const porcentajeTxt = progreso.porcentaje.toFixed(0) + '%'
  let restanteTxt = ''
  let restanteColor = 'text-gray-500'
  if (meta.objetivo > 0) {
    if (meta.tipo === 'gastos') {
      restanteTxt = isExceeded
        ? 'Excedido por ' + formatCurrency(progreso.actual - meta.objetivo)
        : 'Disponible ' + formatCurrency(meta.objetivo - progreso.actual)
      restanteColor = isExceeded ? 'text-red-500' : 'text-emerald-500'
    } else {
      const falter = meta.objetivo - progreso.actual
      restanteTxt = falter > 0 ? 'Faltan ' + formatCurrency(falter) : 'Meta alcanzada'
      restanteColor = falter > 0 ? 'text-amber-500' : 'text-emerald-500'
    }
  } else {
    restanteTxt = 'Sin objetivo configurado'
  }
  progressMeta.innerHTML = `<span>${porcentajeTxt} completado</span><span class="${restanteColor} font-bold">${restanteTxt}</span>`

  progressWrapper.appendChild(progressBar)
  progressWrapper.appendChild(progressMeta)
  card.appendChild(progressWrapper)

  const form = document.createElement('form')
  form.dataset.metaId = meta.id
  form.className =
    'hidden grid grid-cols-1 sm:grid-cols-2 gap-4 items-end mt-4 pt-4 border-t border-gray-100 dark:border-gray-800/60'

  btnToggleEdit.addEventListener('click', (e) => {
    e.stopPropagation()
    form.classList.toggle('hidden')
    btnToggleEdit.classList.toggle('bg-sky-50')
    btnToggleEdit.classList.toggle('dark:bg-sky-900/20')
    btnToggleEdit.classList.toggle('text-sky-600')
  })

  const fieldObjetivo = document.createElement('div')
  const labelObj = document.createElement('label')
  labelObj.className = 'block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1'
  labelObj.textContent = 'Objetivo'
  const inputObj = document.createElement('input')
  inputObj.type = 'number'
  inputObj.step = '0.01'
  inputObj.min = '0.01'
  inputObj.required = true
  inputObj.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all font-bold'
  if (meta.objetivo > 0) inputObj.value = meta.objetivo
  fieldObjetivo.appendChild(labelObj)
  fieldObjetivo.appendChild(inputObj)

  const fieldInicio = document.createElement('div')
  const labelIni = document.createElement('label')
  labelIni.className = 'block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1'
  labelIni.textContent = 'Fecha inicio'
  const inputIni = document.createElement('input')
  inputIni.type = 'date'
  inputIni.required = true
  inputIni.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all'
  if (meta.fechaInicio) inputIni.value = meta.fechaInicio
  fieldInicio.appendChild(labelIni)
  fieldInicio.appendChild(inputIni)

  const fieldFin = document.createElement('div')
  const labelFin = document.createElement('label')
  labelFin.className = 'block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1'
  labelFin.textContent = 'Fecha fin'
  const inputFin = document.createElement('input')
  inputFin.type = 'date'
  inputFin.required = true
  inputFin.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all'
  if (meta.fechaFin) inputFin.value = meta.fechaFin
  fieldFin.appendChild(labelFin)
  fieldFin.appendChild(inputFin)

  const actionsBox = document.createElement('div')
  actionsBox.className = 'flex gap-2'

  const btnGuardar = document.createElement('button')
  btnGuardar.type = 'submit'
  btnGuardar.className =
    'flex-1 inline-flex justify-center items-center bg-sky-600 dark:bg-sky-500 hover:bg-sky-700 dark:hover:bg-sky-600 text-white rounded-2xl py-3 px-3 font-semibold text-xs shadow-sm transition-colors'
  btnGuardar.textContent = 'Guardar'

  const btnToggle = document.createElement('button')
  btnToggle.type = 'button'
  const isAct = meta.activo
  btnToggle.className =
    'inline-flex justify-center items-center p-3 rounded-2xl border transition-colors ' +
    (isAct
      ? 'border-gray-200 text-gray-500 hover:bg-gray-50 dark:border-gray-700 dark:text-gray-400 dark:hover:bg-gray-800'
      : 'border-green-100 bg-green-50/50 text-green-700 hover:bg-green-100 dark:border-green-900/30 dark:bg-green-900/10 dark:text-green-300 dark:hover:bg-green-950/20')
  btnToggle.innerHTML = isAct
    ? `<i data-lucide="pause-circle" class="w-4 h-4"></i>`
    : `<i data-lucide="play-circle" class="w-4 h-4"></i>`
  btnToggle.title = isAct ? 'Pausar seguimiento' : 'Reactivar seguimiento'
  btnToggle.dataset.metaId = meta.id
  btnToggle.dataset.action = 'toggle-status'

  actionsBox.appendChild(btnGuardar)
  actionsBox.appendChild(btnToggle)

  form.appendChild(fieldObjetivo)
  form.appendChild(fieldInicio)
  form.appendChild(fieldFin)
  form.appendChild(actionsBox)
  card.appendChild(form)

  const errorBox = document.createElement('div')
  errorBox.className = 'mt-2 text-xs font-semibold text-red-500 hidden'
  errorBox.dataset.errorFor = meta.id
  card.appendChild(errorBox)

  const historyBox = document.createElement('div')
  historyBox.className = 'mt-4 border-t border-gray-100 dark:border-gray-800/80 pt-3'

  const historyTitle = document.createElement('div')
  historyTitle.className = 'text-[10px] font-bold text-gray-450 dark:text-gray-550 uppercase tracking-wider mb-2'
  historyTitle.textContent = 'Historial del rendimiento'

  const historyList = document.createElement('div')
  historyList.className = 'text-xs max-h-40 overflow-y-auto space-y-3'

  const baseHist = Array.isArray(meta.historial) ? meta.historial : []
  const contribs = progreso.contribuciones.map((c) => ({
    fecha: c.fecha + 'T00:00:00',
    tipo: 'contribucion',
    mensaje:
      'Contribución de ' +
      formatCurrency(c.aporte) +
      '. Acumulado: ' +
      formatCurrency(c.acumulado)
  }))

  const combined = [
    ...baseHist.map((h) => ({
      fecha: h.fecha,
      tipo: h.tipo,
      mensaje: h.mensaje
    })),
    ...contribs
  ]

  if (combined.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'text-gray-400 dark:text-gray-500 italic py-1'
    empty.textContent = 'Sin registros en el historial.'
    historyList.appendChild(empty)
  } else {
    combined
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .forEach((item) => {
        const row = document.createElement('div')
        row.className = 'flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400'

        const dot = document.createElement('div')
        const isConfig = item.tipo === 'config'
        const isContrib = item.tipo === 'contribucion'
        dot.className = `w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${isConfig ? 'bg-blue-400' : isContrib ? 'bg-emerald-400' : 'bg-gray-400'}`

        const textSpan = document.createElement('span')
        const fechaTxt = formatDate(item.fecha.slice(0, 10))
        const label = isConfig ? '[Config]' : isContrib ? '[Contribución]' : '[Sistema]'
        textSpan.innerHTML = `<span class="font-bold text-gray-400 dark:text-gray-550">${fechaTxt}</span> <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-450 font-bold">${label}</span> ${item.mensaje}`

        row.appendChild(dot)
        row.appendChild(textSpan)
        historyList.appendChild(row)
      })
  }

  historyBox.appendChild(historyTitle)
  historyBox.appendChild(historyList)
  card.appendChild(historyBox)

  return card
}

async function renderMetasAvanzadas() {
  const cont = document.getElementById('metas-contenedor')
  if (!cont) return
  cont.innerHTML = ''

  const allMetas = await revisarPeriodosYActualizar()
  const metas = allMetas.filter((m) => m.tipo !== 'simple')
  const operaciones = await listarOperaciones()

  metas.forEach((meta) => {
    const progreso = calcularProgresoMeta(meta, operaciones)
    const card = crearCardMeta(meta, progreso)
    cont.appendChild(card)
  })

  bindFormHandlersAvanzadas()
  if (window.lucide) {
    window.lucide.createIcons()
  }
}

function bindFormHandlersAvanzadas() {
  const forms = document.querySelectorAll('form[data-meta-id]')
  forms.forEach((form) => {
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const metaId = form.dataset.metaId
      const inputs = form.querySelectorAll('input')
      const objetivo = inputs[0].value
      const fechaInicio = inputs[1].value
      const fechaFin = inputs[2].value
      const errorBox = document.querySelector('div[data-error-for="' + metaId + '"]')

      try {
        await guardarMetaParametros(metaId, { objetivo, fechaInicio, fechaFin })
        if (errorBox) {
          errorBox.textContent = ''
          errorBox.classList.add('hidden')
        }
        await renderMetasAvanzadas()
      } catch (err) {
        if (errorBox) {
          errorBox.textContent = err.message || String(err)
          errorBox.classList.remove('hidden')
        }
      }
    })
  })

  const toggleButtons = document.querySelectorAll('button[data-action="toggle-status"]')
  toggleButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const metaId = btn.dataset.metaId
      const metas = await listarMetas()
      const meta = metas.find((m) => m.id === metaId)
      if (!meta) return
      try {
        await cambiarEstadoMeta(metaId, !meta.activo)
        await renderMetasAvanzadas()
      } catch (err) {
        alert(err.message || String(err))
      }
    })
  })
}

function buildCuentaOptions(select, cuentas, selectedId) {
  select.innerHTML = ''
  const optEmpty = document.createElement('option')
  optEmpty.value = ''
  optEmpty.textContent = 'Selecciona una cuenta'
  select.appendChild(optEmpty)
  cuentas.forEach((c) => {
    const opt = document.createElement('option')
    opt.value = c.id
    opt.textContent = c.nombre
    if (selectedId && selectedId === c.id) opt.selected = true
    select.appendChild(opt)
  })
}

async function renderMetasSimples() {
  await evaluarMetasSimples()
  const contActivas = document.getElementById('metas-simples-activas')
  const contCompletas = document.getElementById('metas-simples-completadas')
  if (!contActivas || !contCompletas) return
  contActivas.innerHTML = ''
  contCompletas.innerHTML = ''

  const cuentas = await listarCuentas()
  const metasSimples = await listarMetasSimples()
  const activas = metasSimples.filter((m) => !m.completada)
  const completadas = metasSimples.filter((m) => m.completada)

  const form = document.createElement('form')
  form.id = 'form-meta-simple'
  form.className =
    'grid grid-cols-1 sm:grid-cols-2 gap-4 items-end mb-6 bg-gray-50/50 dark:bg-gray-900/30 border border-gray-100 dark:border-gray-800/40 p-5 rounded-3xl mt-4 animate-fade-in'

  const fieldNombre = document.createElement('div')
  const labelNombre = document.createElement('label')
  labelNombre.className = 'block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1'
  labelNombre.textContent = 'Nombre de la meta'
  const inputNombre = document.createElement('input')
  inputNombre.type = 'text'
  inputNombre.required = true
  inputNombre.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all font-bold'
  fieldNombre.appendChild(labelNombre)
  fieldNombre.appendChild(inputNombre)

  const fieldCuenta = document.createElement('div')
  const labelCuenta = document.createElement('label')
  labelCuenta.className = 'block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1'
  labelCuenta.textContent = 'Cuenta'
  const selectCuenta = document.createElement('select')
  selectCuenta.required = true
  selectCuenta.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-950 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all'
  buildCuentaOptions(selectCuenta, cuentas, '')
  fieldCuenta.appendChild(labelCuenta)
  fieldCuenta.appendChild(selectCuenta)

  const fieldObjetivo = document.createElement('div')
  const labelObj = document.createElement('label')
  labelObj.className = 'block text-xs font-semibold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1'
  labelObj.textContent = 'Balance objetivo'
  const inputObj = document.createElement('input')
  inputObj.type = 'number'
  inputObj.step = '0.01'
  inputObj.min = '0.01'
  inputObj.required = true
  inputObj.className =
    'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all font-bold'
  fieldObjetivo.appendChild(labelObj)
  fieldObjetivo.appendChild(inputObj)

  const fieldAcciones = document.createElement('div')
  const btnCrear = document.createElement('button')
  btnCrear.type = 'submit'
  btnCrear.className =
    'w-full inline-flex justify-center items-center bg-sky-600 dark:bg-sky-500 hover:bg-sky-700 dark:hover:bg-sky-600 text-white rounded-2xl py-3 px-4 font-semibold text-xs shadow-sm transition-colors'
  btnCrear.textContent = 'Crear meta simple'
  fieldAcciones.appendChild(btnCrear)

  form.appendChild(fieldNombre)
  form.appendChild(fieldCuenta)
  form.appendChild(fieldObjetivo)
  form.appendChild(fieldAcciones)

  const errorGlobal = document.createElement('div')
  errorGlobal.id = 'error-meta-simple'
  errorGlobal.className = 'mt-2 text-xs font-semibold text-red-500 hidden'

  contActivas.appendChild(form)
  contActivas.appendChild(errorGlobal)

  activas.forEach((meta) => {
    const cuenta = cuentas.find((c) => c.id === meta.cuentaId)
    const card = document.createElement('div')
    card.className =
      'rounded-3xl border border-gray-100 dark:border-gray-800/80 bg-gray-50/40 dark:bg-gray-900/20 p-5 relative overflow-hidden transition-all hover:shadow-sm animate-fade-in'

    const metaColor = meta.color || '#3b82f6'
    card.style.borderLeft = `4px solid ${metaColor}`

    const header = document.createElement('div')
    header.className = 'flex items-start justify-between gap-4 mb-3'

    const left = document.createElement('div')
    left.className = 'min-w-0'
    const title = document.createElement('h4')
    title.className = 'text-sm font-bold text-gray-900 dark:text-white truncate'
    title.textContent = meta.nombre
    const subtitle = document.createElement('p')
    subtitle.className = 'text-[10px] text-gray-400 dark:text-gray-500 mt-0.5'
    subtitle.textContent = cuenta ? cuenta.nombre : 'Cuenta no encontrada'
    left.appendChild(title)
    left.appendChild(subtitle)

    const rightArea = document.createElement('div')
    rightArea.className = 'flex items-center gap-2 flex-shrink-0'

    const badge = document.createElement('span')
    badge.className =
      'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-blue-50 text-blue-700 dark:bg-blue-950/30 dark:text-blue-300'
    badge.textContent = 'Meta activa'

    const btnToggleEdit = document.createElement('button')
    btnToggleEdit.type = 'button'
    btnToggleEdit.className =
      'p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-900/20 rounded-xl transition-all'
    btnToggleEdit.innerHTML = `<i data-lucide="pencil" class="w-3.5 h-3.5"></i>`
    btnToggleEdit.title = 'Editar meta'

    rightArea.appendChild(badge)
    rightArea.appendChild(btnToggleEdit)

    header.appendChild(left)
    header.appendChild(rightArea)

    const body = document.createElement('div')
    body.className = 'grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs mb-3'

    const saldoActual = cuenta ? Number(cuenta.dinero || 0) : 0
    const objetivo = Number(meta.objetivo || 0)
    const dist = Math.abs(objetivo - saldoActual)

    const b1 = document.createElement('div')
    b1.className = 'p-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/80'
    b1.innerHTML = `
      <span class="text-[9px] font-semibold text-gray-450 dark:text-gray-550 uppercase tracking-wider block">Saldo Actual</span>
      <span class="text-xs font-extrabold text-gray-900 dark:text-white tracking-tight truncate block">${formatCurrency(saldoActual)}</span>
    `
    const b2 = document.createElement('div')
    b2.className = 'p-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/80'
    b2.innerHTML = `
      <span class="text-[9px] font-semibold text-gray-450 dark:text-gray-550 uppercase tracking-wider block">Objetivo</span>
      <span class="text-xs font-extrabold text-gray-900 dark:text-white tracking-tight truncate block">${formatCurrency(objetivo)}</span>
    `
    const b3 = document.createElement('div')
    b3.className = 'p-3 rounded-2xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800/80'
    b3.innerHTML = `
      <span class="text-[9px] font-semibold text-gray-450 dark:text-gray-550 uppercase tracking-wider block">Diferencia</span>
      <span class="text-xs font-extrabold text-gray-900 dark:text-white tracking-tight truncate block">${formatCurrency(dist)}</span>
    `

    body.appendChild(b1)
    body.appendChild(b2)
    body.appendChild(b3)

    const progressWrapper = document.createElement('div')
    progressWrapper.className = 'mt-3 mb-2'

    const progressBar = document.createElement('div')
    progressBar.className = 'w-full h-2 rounded-full bg-gray-100 dark:bg-gray-800/80 overflow-hidden relative'
    const progressInner = document.createElement('div')
    progressInner.className = 'h-full rounded-full transition-all duration-500 bg-sky-500'
    const porcentaje = objetivo > 0 ? Math.min(100, Math.max(0, (saldoActual / objetivo) * 100)) : 0
    progressInner.style.width = porcentaje + '%'
    progressBar.appendChild(progressInner)

    const progressMeta = document.createElement('div')
    progressMeta.className =
      'flex justify-between items-center mt-1.5 text-[10px] font-semibold text-gray-500 dark:text-gray-400'
    const pctTxt = porcentaje.toFixed(0) + '%'
    const isCompleted = saldoActual >= objetivo
    const distTxt = isCompleted ? 'Meta alcanzada' : 'Falta ' + formatCurrency(dist)
    const distColor = isCompleted ? 'text-emerald-500' : 'text-amber-500'
    progressMeta.innerHTML = `<span>${pctTxt} completado</span><span class="${distColor} font-bold">${distTxt}</span>`

    progressWrapper.appendChild(progressBar)
    progressWrapper.appendChild(progressMeta)

    const formEdit = document.createElement('form')
    formEdit.dataset.simpleId = meta.id
    formEdit.className =
      'hidden grid grid-cols-1 sm:grid-cols-2 gap-4 items-end mt-4 pt-4 border-t border-gray-100 dark:border-gray-800/60'

    btnToggleEdit.addEventListener('click', (e) => {
      e.stopPropagation()
      formEdit.classList.toggle('hidden')
      btnToggleEdit.classList.toggle('bg-sky-50')
      btnToggleEdit.classList.toggle('dark:bg-sky-900/20')
      btnToggleEdit.classList.toggle('text-sky-600')
    })

    const eNombre = document.createElement('div')
    const eNombreLabel = document.createElement('label')
    eNombreLabel.className = 'block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1'
    eNombreLabel.textContent = 'Nombre'
    const eNombreInput = document.createElement('input')
    eNombreInput.type = 'text'
    eNombreInput.required = true
    eNombreInput.value = meta.nombre
    eNombreInput.className =
      'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all font-bold'
    eNombre.appendChild(eNombreLabel)
    eNombre.appendChild(eNombreInput)

    const eCuenta = document.createElement('div')
    const eCuentaLabel = document.createElement('label')
    eCuentaLabel.className = 'block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1'
    eCuentaLabel.textContent = 'Cuenta'
    const eCuentaSelect = document.createElement('select')
    eCuentaSelect.required = true
    eCuentaSelect.className =
      'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-950 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all'
    buildCuentaOptions(eCuentaSelect, cuentas, meta.cuentaId)
    eCuenta.appendChild(eCuentaLabel)
    eCuenta.appendChild(eCuentaSelect)

    const eObj = document.createElement('div')
    const eObjLabel = document.createElement('label')
    eObjLabel.className = 'block text-[10px] font-bold text-gray-400 dark:text-gray-500 uppercase tracking-wider mb-1'
    eObjLabel.textContent = 'Objetivo'
    const eObjInput = document.createElement('input')
    eObjInput.type = 'number'
    eObjInput.step = '0.01'
    eObjInput.min = '0.01'
    eObjInput.required = true
    eObjInput.value = meta.objetivo
    eObjInput.className =
      'w-full rounded-2xl border border-gray-100 dark:border-gray-800 bg-white dark:bg-gray-900 text-gray-900 dark:text-white px-4 py-2.5 text-sm focus:outline-none focus:ring-2 focus:ring-sky-500/20 focus:border-sky-500 transition-all font-bold'
    eObj.appendChild(eObjLabel)
    eObj.appendChild(eObjInput)

    const eActions = document.createElement('div')
    eActions.className = 'flex gap-2'
    const btnGuardarSimple = document.createElement('button')
    btnGuardarSimple.type = 'submit'
    btnGuardarSimple.className =
      'flex-1 inline-flex justify-center items-center bg-sky-600 dark:bg-sky-500 hover:bg-sky-700 dark:hover:bg-sky-600 text-white rounded-2xl py-3 px-3 font-semibold text-xs shadow-sm transition-colors'
    btnGuardarSimple.textContent = 'Guardar'

    const btnEliminarSimple = document.createElement('button')
    btnEliminarSimple.type = 'button'
    btnEliminarSimple.className =
      'inline-flex justify-center items-center p-3 rounded-2xl border border-red-200 text-red-500 hover:bg-red-50 dark:border-red-900 dark:text-red-400 dark:hover:bg-red-950/20 transition-colors'
    btnEliminarSimple.innerHTML = `<i data-lucide="trash-2" class="w-4 h-4"></i>`
    btnEliminarSimple.title = 'Eliminar meta'
    btnEliminarSimple.dataset.simpleId = meta.id

    eActions.appendChild(btnGuardarSimple)
    eActions.appendChild(btnEliminarSimple)

    formEdit.appendChild(eNombre)
    formEdit.appendChild(eCuenta)
    formEdit.appendChild(eObj)
    formEdit.appendChild(eActions)

    const hist = document.createElement('div')
    hist.className = 'mt-4 border-t border-gray-100 dark:border-gray-800/80 pt-3'
    const histTitle = document.createElement('div')
    histTitle.className = 'text-[10px] font-bold text-gray-400 dark:text-gray-550 uppercase tracking-wider mb-2'
    histTitle.textContent = 'Historial de la meta'

    const histList = document.createElement('div')
    histList.className = 'text-xs max-h-36 overflow-y-auto space-y-3'
    const baseHistSimple = Array.isArray(meta.historial) ? meta.historial : []
    if (baseHistSimple.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'text-gray-400 dark:text-gray-500 italic py-1'
      empty.textContent = 'Sin registros en el historial.'
      histList.appendChild(empty)
    } else {
      baseHistSimple
        .slice()
        .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
        .forEach((h) => {
          const row = document.createElement('div')
          row.className = 'flex items-start gap-2 text-[11px] text-gray-500 dark:text-gray-400'

          const dot = document.createElement('div')
          const isConfig = h.tipo === 'config'
          const isProgreso = h.tipo === 'progreso'
          dot.className = `w-1.5 h-1.5 rounded-full mt-1.5 flex-shrink-0 ${isConfig ? 'bg-blue-400' : isProgreso ? 'bg-purple-400' : 'bg-gray-400'}`

          const textSpan = document.createElement('span')
          const fechaTxt = formatDate(h.fecha.slice(0, 10))
          const label = isConfig ? '[Config]' : isProgreso ? '[Progreso]' : '[Sistema]'
          textSpan.innerHTML = `<span class="font-bold text-gray-400 dark:text-gray-550">${fechaTxt}</span> <span class="text-[9px] px-1.5 py-0.5 rounded bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-455 font-bold">${label}</span> ${h.mensaje}`

          row.appendChild(dot)
          row.appendChild(textSpan)
          histList.appendChild(row)
        })
    }
    hist.appendChild(histTitle)
    hist.appendChild(histList)

    card.appendChild(header)
    card.appendChild(body)
    card.appendChild(progressWrapper)
    card.appendChild(formEdit)
    card.appendChild(hist)

    contActivas.appendChild(card)
  })

  completadas.forEach((meta) => {
    const cuenta = cuentas.find((c) => c.id === meta.cuentaId)
    const card = document.createElement('div')
    card.className =
      'rounded-3xl border border-gray-100 dark:border-gray-800/80 bg-gray-50/20 dark:bg-gray-900/10 p-4 relative overflow-hidden transition-all text-xs flex flex-col gap-2'
    const metaColor = meta.color || '#10b981'
    card.style.borderLeft = `4px solid ${metaColor}`

    const header = document.createElement('div')
    header.className = 'flex items-center justify-between gap-2'

    const title = document.createElement('div')
    title.className = 'font-bold text-gray-900 dark:text-white'
    title.textContent = meta.nombre

    const badge = document.createElement('span')
    badge.className =
      'inline-flex items-center rounded-full px-2 py-0.5 text-[9px] font-bold uppercase tracking-wider bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300'
    badge.textContent = 'Completada'

    header.appendChild(title)
    header.appendChild(badge)

    const desc = document.createElement('div')
    desc.className = 'text-gray-500 dark:text-gray-400 text-[11px] leading-relaxed'
    const objetivo = Number(meta.objetivo || 0)
    const saldoTexto =
      cuenta && typeof cuenta.dinero === 'number'
        ? formatCurrency(cuenta.dinero)
        : 'Saldo actual no disponible'
    desc.innerHTML = `<span class="font-semibold text-gray-700 dark:text-gray-300">${cuenta ? cuenta.nombre : 'Cuenta'}</span> · Objetivo <span class="font-bold text-gray-900 dark:text-white">${formatCurrency(objetivo)}</span> (saldo final ${saldoTexto}).`

    const hist = document.createElement('div')
    hist.className =
      'mt-2 border-t border-gray-100 dark:border-gray-800/40 pt-2 text-[10px] text-gray-500 dark:text-gray-550 max-h-24 overflow-y-auto space-y-1.5'
    const baseHist = Array.isArray(meta.historial) ? meta.historial : []
    baseHist
      .slice()
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .forEach((h) => {
        const row = document.createElement('div')
        const label =
          h.tipo === 'config' ? '[Config]' : h.tipo === 'progreso' ? '[Progreso]' : '[Sistema]'
        const fechaTxt = formatDate(h.fecha.slice(0, 10))
        row.innerHTML = `<span class="font-bold">${fechaTxt}</span> <span class="text-[8px] px-1 py-0.2 rounded bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 font-bold">${label}</span> ${h.mensaje}`
        hist.appendChild(row)
      })

    card.appendChild(header)
    card.appendChild(desc)
    card.appendChild(hist)

    contCompletas.appendChild(card)
  })

  bindMetasSimplesHandlers()
  if (window.lucide) {
    window.lucide.createIcons()
  }
}

function bindMetasSimplesHandlers() {
  const form = document.getElementById('form-meta-simple')
  const errorBox = document.getElementById('error-meta-simple')
  if (form) {
    form.addEventListener('submit', async (e) => {
      e.preventDefault()
      const nombre = form.querySelector('input[type=\"text\"]').value
      const cuentaId = form.querySelector('select').value
      const objetivo = form.querySelector('input[type=\"number\"]').value
      try {
        await crearMetaSimple({ nombre, cuentaId, objetivo })
        if (errorBox) {
          errorBox.textContent = ''
          errorBox.classList.add('hidden')
        }
        form.reset()
        await renderMetasSimples()
      } catch (err) {
        if (errorBox) {
          errorBox.textContent = err.message || String(err)
          errorBox.classList.remove('hidden')
        }
      }
    })
  }

  const editForms = document.querySelectorAll('form[data-simple-id]')
  editForms.forEach((f) => {
    f.addEventListener('submit', async (e) => {
      e.preventDefault()
      const id = f.dataset.simpleId
      const nombre = f.querySelector('input[type=\"text\"]').value
      const cuentaId = f.querySelector('select').value
      const objetivo = f.querySelector('input[type=\"number\"]').value
      try {
        await actualizarMetaSimple(id, { nombre, cuentaId, objetivo })
        await renderMetasSimples()
      } catch (err) {
        alert(err.message || String(err))
      }
    })
  })

  const deleteButtons = document.querySelectorAll('button[data-simple-id]')
  deleteButtons.forEach((btn) => {
    btn.addEventListener('click', async () => {
      const id = btn.dataset.simpleId
      if (!id) return
      if (!confirm('¿Eliminar esta meta simple?')) return
      try {
        await eliminarMetaSimple(id)
        await renderMetasSimples()
      } catch (err) {
        alert(err.message || String(err))
      }
    })
  })
}

function setActiveNav() {
  const links = document.querySelectorAll('nav a[data-route]')
  const current = location.pathname.split('/').pop() || 'metas.html'
  links.forEach((a) => {
    const route = a.getAttribute('data-route')
    if (!route) return
    if (route === current) a.classList.add('text-primary-600', 'dark:text-primary-400')
    else a.classList.remove('text-primary-600', 'dark:text-primary-400')
  })
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
  await renderMetasAvanzadas()
  await renderMetasSimples()
}

document.addEventListener('DOMContentLoaded', init)

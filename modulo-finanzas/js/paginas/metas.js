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
  const card = document.createElement('section')
  card.className = 'rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-5 shadow-sm'

  const header = document.createElement('div')
  header.className = 'flex items-center justify-between gap-4 mb-4'

  const titleBox = document.createElement('div')
  const title = document.createElement('h2')
  title.className = 'text-base font-semibold'
  title.textContent = meta.nombre
  const subtitle = document.createElement('p')
  subtitle.className = 'text-xs text-gray-500'
  subtitle.textContent = 'Configura el periodo y objetivo. El seguimiento solo cuenta operaciones dentro del rango definido.'
  titleBox.appendChild(title)
  titleBox.appendChild(subtitle)

  const estado = document.createElement('span')
  estado.className =
    'inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium ' +
    (meta.activo ? 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-300' : 'bg-gray-100 text-gray-600 dark:bg-gray-800 dark:text-gray-300')
  estado.textContent = meta.activo ? 'Activa' : 'Apagada'

  header.appendChild(titleBox)
  header.appendChild(estado)
  card.appendChild(header)

  const grid = document.createElement('div')
  grid.className = 'grid grid-cols-1 md:grid-cols-3 gap-4 mb-4'

  const objetivoBox = document.createElement('div')
  const objetivoLabel = document.createElement('div')
  objetivoLabel.className = 'text-xs text-gray-500'
  objetivoLabel.textContent = 'Objetivo'
  const objetivoVal = document.createElement('div')
  objetivoVal.className = 'text-lg font-semibold'
  objetivoVal.textContent = meta.objetivo > 0 ? formatCurrency(meta.objetivo) : 'Sin definir'
  objetivoBox.appendChild(objetivoLabel)
  objetivoBox.appendChild(objetivoVal)

  const actualBox = document.createElement('div')
  const actualLabel = document.createElement('div')
  actualLabel.className = 'text-xs text-gray-500'
  actualLabel.textContent = 'Progreso actual'
  const actualVal = document.createElement('div')
  actualVal.className = 'text-lg font-semibold'
  actualVal.textContent = formatCurrency(progreso.actual)
  actualBox.appendChild(actualLabel)
  actualBox.appendChild(actualVal)

  const periodoBox = document.createElement('div')
  const periodoLabel = document.createElement('div')
  periodoLabel.className = 'text-xs text-gray-500'
  periodoLabel.textContent = 'Periodo'
  const periodoVal = document.createElement('div')
  periodoVal.className = 'text-xs'
  if (meta.fechaInicio && meta.fechaFin) {
    periodoVal.textContent = formatDate(meta.fechaInicio) + ' → ' + formatDate(meta.fechaFin)
  } else {
    periodoVal.textContent = 'Sin periodo definido'
  }
  periodoBox.appendChild(periodoLabel)
  periodoBox.appendChild(periodoVal)

  grid.appendChild(objetivoBox)
  grid.appendChild(actualBox)
  grid.appendChild(periodoBox)
  card.appendChild(grid)

  const progressBar = document.createElement('div')
  progressBar.className = 'w-full h-2 rounded-full bg-gray-100 dark:bg-gray-800 overflow-hidden mb-4'
  const progressInner = document.createElement('div')
  progressInner.className =
    'h-full ' + (meta.tipo === 'gastos' ? 'bg-red-500' : 'bg-blue-500')
  progressInner.style.width = Math.min(100, progreso.porcentaje) + '%'
  progressBar.appendChild(progressInner)
  card.appendChild(progressBar)

  const form = document.createElement('form')
  form.dataset.metaId = meta.id
  form.className = 'grid grid-cols-1 md:grid-cols-4 gap-3 items-end'

  const fieldObjetivo = document.createElement('div')
  const labelObj = document.createElement('label')
  labelObj.className = 'block text-xs font-medium mb-1'
  labelObj.textContent = 'Objetivo'
  const inputObj = document.createElement('input')
  inputObj.type = 'number'
  inputObj.step = '0.01'
  inputObj.min = '0.01'
  inputObj.required = true
  inputObj.className = 'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
  if (meta.objetivo > 0) inputObj.value = meta.objetivo
  fieldObjetivo.appendChild(labelObj)
  fieldObjetivo.appendChild(inputObj)

  const fieldInicio = document.createElement('div')
  const labelIni = document.createElement('label')
  labelIni.className = 'block text-xs font-medium mb-1'
  labelIni.textContent = 'Fecha inicio'
  const inputIni = document.createElement('input')
  inputIni.type = 'date'
  inputIni.required = true
  inputIni.className = 'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
  if (meta.fechaInicio) inputIni.value = meta.fechaInicio
  fieldInicio.appendChild(labelIni)
  fieldInicio.appendChild(inputIni)

  const fieldFin = document.createElement('div')
  const labelFin = document.createElement('label')
  labelFin.className = 'block text-xs font-medium mb-1'
  labelFin.textContent = 'Fecha fin'
  const inputFin = document.createElement('input')
  inputFin.type = 'date'
  inputFin.required = true
  inputFin.className = 'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
  if (meta.fechaFin) inputFin.value = meta.fechaFin
  fieldFin.appendChild(labelFin)
  fieldFin.appendChild(inputFin)

  const actionsBox = document.createElement('div')
  actionsBox.className = 'flex flex-col sm:flex-row gap-2'

  const btnGuardar = document.createElement('button')
  btnGuardar.type = 'submit'
  btnGuardar.className = 'inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700'
  btnGuardar.textContent = 'Guardar parámetros'

  const btnToggle = document.createElement('button')
  btnToggle.type = 'button'
  btnToggle.className =
    'inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium border ' +
    (meta.activo
      ? 'border-gray-300 text-gray-700 hover:bg-gray-100 dark:border-gray-600 dark:text-gray-200 dark:hover:bg-gray-800'
      : 'border-green-500 text-green-700 hover:bg-green-50 dark:border-green-500 dark:text-green-300 dark:hover:bg-green-900/30')
  btnToggle.textContent = meta.activo ? 'Parar seguimiento' : 'Reactivar seguimiento'
  btnToggle.dataset.metaId = meta.id

  actionsBox.appendChild(btnGuardar)
  actionsBox.appendChild(btnToggle)

  form.appendChild(fieldObjetivo)
  form.appendChild(fieldInicio)
  form.appendChild(fieldFin)
  form.appendChild(actionsBox)

  const errorBox = document.createElement('div')
  errorBox.className = 'mt-2 text-sm text-red-600 hidden'
  errorBox.dataset.errorFor = meta.id

  card.appendChild(form)
  card.appendChild(errorBox)

  const historyBox = document.createElement('div')
  historyBox.className = 'mt-4 border-t border-gray-200 dark:border-gray-800 pt-3'

  const historyTitle = document.createElement('div')
  historyTitle.className = 'text-xs font-semibold text-gray-600 dark:text-gray-300 mb-2'
  historyTitle.textContent = 'Historial'

  const historyList = document.createElement('div')
  historyList.className = 'space-y-1 max-h-48 overflow-y-auto text-xs'

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

  combined
    .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
    .forEach((item) => {
      const row = document.createElement('div')
      const label = item.tipo === 'config' ? '[Config]' : item.tipo === 'contribucion' ? '[Contribución]' : '[Sistema]'
      const fechaTxt = formatDate(item.fecha.slice(0, 10))
      row.textContent = fechaTxt + ' ' + label + ' ' + item.mensaje
      historyList.appendChild(row)
    })

  if (combined.length === 0) {
    const empty = document.createElement('div')
    empty.className = 'text-gray-500 italic'
    empty.textContent = 'Sin historial para esta meta.'
    historyList.appendChild(empty)
  }

  historyBox.appendChild(historyTitle)
  historyBox.appendChild(historyList)
  card.appendChild(historyBox)

  return card
}

function renderMetasAvanzadas() {
  const cont = document.getElementById('metas-contenedor')
  if (!cont) return
  cont.innerHTML = ''

  const metas = revisarPeriodosYActualizar().filter((m) => m.tipo !== 'simple')
  const operaciones = listarOperaciones()

  metas.forEach((meta) => {
    const progreso = calcularProgresoMeta(meta, operaciones)
    const card = crearCardMeta(meta, progreso)
    cont.appendChild(card)
  })

  bindFormHandlersAvanzadas()
}

function bindFormHandlersAvanzadas() {
  const forms = document.querySelectorAll('form[data-meta-id]')
  forms.forEach((form) => {
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const metaId = form.dataset.metaId
      const inputs = form.querySelectorAll('input')
      const objetivo = inputs[0].value
      const fechaInicio = inputs[1].value
      const fechaFin = inputs[2].value
      const errorBox = document.querySelector('div[data-error-for="' + metaId + '"]')

      try {
        guardarMetaParametros(metaId, { objetivo, fechaInicio, fechaFin })
        if (errorBox) {
          errorBox.textContent = ''
          errorBox.classList.add('hidden')
        }
        renderMetas()
      } catch (err) {
        if (errorBox) {
          errorBox.textContent = err.message || String(err)
          errorBox.classList.remove('hidden')
        }
      }
    })
  })

  const toggleButtons = document.querySelectorAll('button[data-meta-id]')
  toggleButtons.forEach((btn) => {
    if (!btn.textContent || (btn.textContent !== 'Parar seguimiento' && btn.textContent !== 'Reactivar seguimiento')) return
    btn.addEventListener('click', () => {
      const metaId = btn.dataset.metaId
      const metas = listarMetas()
      const meta = metas.find((m) => m.id === metaId)
      if (!meta) return
      try {
        cambiarEstadoMeta(metaId, !meta.activo)
        renderMetas()
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

function renderMetasSimples() {
  evaluarMetasSimples()
  const contActivas = document.getElementById('metas-simples-activas')
  const contCompletas = document.getElementById('metas-simples-completadas')
  if (!contActivas || !contCompletas) return
  contActivas.innerHTML = ''
  contCompletas.innerHTML = ''

  const cuentas = listarCuentas()
  const metasSimples = listarMetasSimples()
  const activas = metasSimples.filter((m) => !m.completada)
  const completadas = metasSimples.filter((m) => m.completada)

  const form = document.createElement('form')
  form.id = 'form-meta-simple'
  form.className = 'grid grid-cols-1 md:grid-cols-4 gap-3 items-end mb-4'

  const fieldNombre = document.createElement('div')
  const labelNombre = document.createElement('label')
  labelNombre.className = 'block text-xs font-medium mb-1'
  labelNombre.textContent = 'Nombre de la meta'
  const inputNombre = document.createElement('input')
  inputNombre.type = 'text'
  inputNombre.required = true
  inputNombre.className =
    'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
  fieldNombre.appendChild(labelNombre)
  fieldNombre.appendChild(inputNombre)

  const fieldCuenta = document.createElement('div')
  const labelCuenta = document.createElement('label')
  labelCuenta.className = 'block text-xs font-medium mb-1'
  labelCuenta.textContent = 'Cuenta'
  const selectCuenta = document.createElement('select')
  selectCuenta.required = true
  selectCuenta.className =
    'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
  buildCuentaOptions(selectCuenta, cuentas, '')
  fieldCuenta.appendChild(labelCuenta)
  fieldCuenta.appendChild(selectCuenta)

  const fieldObjetivo = document.createElement('div')
  const labelObj = document.createElement('label')
  labelObj.className = 'block text-xs font-medium mb-1'
  labelObj.textContent = 'Balance objetivo'
  const inputObj = document.createElement('input')
  inputObj.type = 'number'
  inputObj.step = '0.01'
  inputObj.min = '0.01'
  inputObj.required = true
  inputObj.className =
    'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
  fieldObjetivo.appendChild(labelObj)
  fieldObjetivo.appendChild(inputObj)

  const fieldAcciones = document.createElement('div')
  fieldAcciones.className = 'flex gap-2'
  const btnCrear = document.createElement('button')
  btnCrear.type = 'submit'
  btnCrear.className =
    'inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700'
  btnCrear.textContent = 'Crear meta simple'
  fieldAcciones.appendChild(btnCrear)

  form.appendChild(fieldNombre)
  form.appendChild(fieldCuenta)
  form.appendChild(fieldObjetivo)
  form.appendChild(fieldAcciones)

  const errorGlobal = document.createElement('div')
  errorGlobal.id = 'error-meta-simple'
  errorGlobal.className = 'mt-2 text-sm text-red-600 hidden'

  contActivas.appendChild(form)
  contActivas.appendChild(errorGlobal)

  activas.forEach((meta) => {
    const cuenta = cuentas.find((c) => c.id === meta.cuentaId)
    const card = document.createElement('section')
    card.className =
      'rounded-lg border p-4 flex flex-col gap-2'
    if (meta.color) {
      card.style.borderColor = meta.color
    }

    const header = document.createElement('div')
    header.className = 'flex items-center justify-between gap-2'

    const left = document.createElement('div')
    const title = document.createElement('h3')
    title.className = 'text-sm font-semibold'
    title.textContent = meta.nombre
    const subtitle = document.createElement('p')
    subtitle.className = 'text-xs text-gray-500'
    subtitle.textContent = cuenta ? cuenta.nombre : 'Cuenta no encontrada'
    left.appendChild(title)
    left.appendChild(subtitle)

    const badge = document.createElement('span')
    badge.className =
      'inline-flex items-center rounded-full px-2 py-1 text-[11px] font-medium bg-blue-50 text-blue-700 dark:bg-blue-900/30 dark:text-blue-300'
    badge.textContent = 'Meta simple activa'

    header.appendChild(left)
    header.appendChild(badge)

    const body = document.createElement('div')
    body.className = 'grid grid-cols-1 md:grid-cols-3 gap-3 text-xs'

    const saldoActual = cuenta ? Number(cuenta.dinero || 0) : 0
    const objetivo = Number(meta.objetivo || 0)
    const dist = Math.abs(objetivo - saldoActual)

    const b1 = document.createElement('div')
    b1.innerHTML =
      '<div class=\"text-gray-500\">Saldo actual</div><div class=\"text-sm font-semibold\">' +
      formatCurrency(saldoActual) +
      '</div>'
    const b2 = document.createElement('div')
    b2.innerHTML =
      '<div class=\"text-gray-500\">Objetivo</div><div class=\"text-sm font-semibold\">' +
      formatCurrency(objetivo) +
      '</div>'
    const b3 = document.createElement('div')
    b3.innerHTML =
      '<div class=\"text-gray-500\">Distancia al objetivo</div><div class=\"text-sm font-semibold\">' +
      formatCurrency(dist) +
      '</div>'

    body.appendChild(b1)
    body.appendChild(b2)
    body.appendChild(b3)

    const formEdit = document.createElement('form')
    formEdit.dataset.simpleId = meta.id
    formEdit.className = 'mt-3 grid grid-cols-1 md:grid-cols-4 gap-3 items-end'

    const eNombre = document.createElement('div')
    const eNombreLabel = document.createElement('label')
    eNombreLabel.className = 'block text-xs font-medium mb-1'
    eNombreLabel.textContent = 'Nombre'
    const eNombreInput = document.createElement('input')
    eNombreInput.type = 'text'
    eNombreInput.required = true
    eNombreInput.value = meta.nombre
    eNombreInput.className =
      'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
    eNombre.appendChild(eNombreLabel)
    eNombre.appendChild(eNombreInput)

    const eCuenta = document.createElement('div')
    const eCuentaLabel = document.createElement('label')
    eCuentaLabel.className = 'block text-xs font-medium mb-1'
    eCuentaLabel.textContent = 'Cuenta'
    const eCuentaSelect = document.createElement('select')
    eCuentaSelect.required = true
    eCuentaSelect.className =
      'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
    buildCuentaOptions(eCuentaSelect, cuentas, meta.cuentaId)
    eCuenta.appendChild(eCuentaLabel)
    eCuenta.appendChild(eCuentaSelect)

    const eObj = document.createElement('div')
    const eObjLabel = document.createElement('label')
    eObjLabel.className = 'block text-xs font-medium mb-1'
    eObjLabel.textContent = 'Objetivo'
    const eObjInput = document.createElement('input')
    eObjInput.type = 'number'
    eObjInput.step = '0.01'
    eObjInput.min = '0.01'
    eObjInput.required = true
    eObjInput.value = meta.objetivo
    eObjInput.className =
      'w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm'
    eObj.appendChild(eObjLabel)
    eObj.appendChild(eObjInput)

    const eActions = document.createElement('div')
    eActions.className = 'flex flex-col sm:flex-row gap-2'
    const btnGuardar = document.createElement('button')
    btnGuardar.type = 'submit'
    btnGuardar.className =
      'inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700'
    btnGuardar.textContent = 'Guardar cambios'
    const btnEliminar = document.createElement('button')
    btnEliminar.type = 'button'
    btnEliminar.className =
      'inline-flex justify-center items-center px-3 py-2 rounded-md text-sm font-medium border border-red-500 text-red-600 hover:bg-red-50 dark:border-red-500 dark:text-red-300 dark:hover:bg-red-900/30'
    btnEliminar.textContent = 'Eliminar'
    btnEliminar.dataset.simpleId = meta.id
    eActions.appendChild(btnGuardar)
    eActions.appendChild(btnEliminar)

    formEdit.appendChild(eNombre)
    formEdit.appendChild(eCuenta)
    formEdit.appendChild(eObj)
    formEdit.appendChild(eActions)

    const hist = document.createElement('div')
    hist.className = 'mt-3 border-t border-gray-200 dark:border-gray-800 pt-2 text-xs max-h-36 overflow-y-auto'
    const histTitle = document.createElement('div')
    histTitle.className = 'font-semibold text-gray-600 dark:text-gray-300 mb-1'
    histTitle.textContent = 'Historial'
    const histList = document.createElement('div')
    const baseHist = Array.isArray(meta.historial) ? meta.historial : []
    if (baseHist.length === 0) {
      const empty = document.createElement('div')
      empty.className = 'text-gray-500 italic'
      empty.textContent = 'Sin historial para esta meta.'
      histList.appendChild(empty)
    } else {
      baseHist
        .slice()
        .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
        .forEach((h) => {
          const row = document.createElement('div')
          const label =
            h.tipo === 'config' ? '[Config]' : h.tipo === 'progreso' ? '[Progreso]' : '[Sistema]'
          const fechaTxt = formatDate(h.fecha.slice(0, 10))
          row.textContent = fechaTxt + ' ' + label + ' ' + h.mensaje
          histList.appendChild(row)
        })
    }
    hist.appendChild(histTitle)
    hist.appendChild(histList)

    card.appendChild(header)
    card.appendChild(body)
    card.appendChild(formEdit)
    card.appendChild(hist)

    contActivas.appendChild(card)
  })

  completadas.forEach((meta) => {
    const cuenta = cuentas.find((c) => c.id === meta.cuentaId)
    const card = document.createElement('div')
    card.className =
      'rounded-lg border px-4 py-3 text-xs flex flex-col gap-1 bg-gray-50 dark:bg-gray-900'
    if (meta.color) card.style.borderColor = meta.color

    const title = document.createElement('div')
    title.className = 'font-semibold'
    title.textContent = meta.nombre
    const desc = document.createElement('div')
    desc.className = 'text-gray-600 dark:text-gray-300'
    const objetivo = Number(meta.objetivo || 0)
    const saldoTexto =
      cuenta && typeof cuenta.dinero === 'number'
        ? formatCurrency(cuenta.dinero)
        : 'Saldo actual no disponible'
    desc.textContent =
      (cuenta ? cuenta.nombre + ' · ' : '') +
      'Objetivo ' +
      formatCurrency(objetivo) +
      ' (saldo actual ' +
      saldoTexto +
      ').'

    const hist = document.createElement('div')
    hist.className = 'mt-1 max-h-24 overflow-y-auto'
    const baseHist = Array.isArray(meta.historial) ? meta.historial : []
    baseHist
      .slice()
      .sort((a, b) => new Date(b.fecha).getTime() - new Date(a.fecha).getTime())
      .forEach((h) => {
        const row = document.createElement('div')
        const label =
          h.tipo === 'config' ? '[Config]' : h.tipo === 'progreso' ? '[Progreso]' : '[Sistema]'
        const fechaTxt = formatDate(h.fecha.slice(0, 10))
        row.textContent = fechaTxt + ' ' + label + ' ' + h.mensaje
        hist.appendChild(row)
      })

    card.appendChild(title)
    card.appendChild(desc)
    card.appendChild(hist)

    contCompletas.appendChild(card)
  })

  bindMetasSimplesHandlers()
}

function bindMetasSimplesHandlers() {
  const form = document.getElementById('form-meta-simple')
  const errorBox = document.getElementById('error-meta-simple')
  if (form) {
    form.addEventListener('submit', (e) => {
      e.preventDefault()
      const nombre = form.querySelector('input[type=\"text\"]').value
      const cuentaId = form.querySelector('select').value
      const objetivo = form.querySelector('input[type=\"number\"]').value
      try {
        crearMetaSimple({ nombre, cuentaId, objetivo })
        if (errorBox) {
          errorBox.textContent = ''
          errorBox.classList.add('hidden')
        }
        form.reset()
        renderMetasSimples()
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
    f.addEventListener('submit', (e) => {
      e.preventDefault()
      const id = f.dataset.simpleId
      const nombre = f.querySelector('input[type=\"text\"]').value
      const cuentaId = f.querySelector('select').value
      const objetivo = f.querySelector('input[type=\"number\"]').value
      try {
        actualizarMetaSimple(id, { nombre, cuentaId, objetivo })
        renderMetasSimples()
      } catch (err) {
        alert(err.message || String(err))
      }
    })
  })

  const deleteButtons = document.querySelectorAll('button[data-simple-id]')
  deleteButtons.forEach((btn) => {
    btn.addEventListener('click', () => {
      const id = btn.dataset.simpleId
      if (!id) return
      if (!confirm('¿Eliminar esta meta simple?')) return
      try {
        eliminarMetaSimple(id)
        renderMetasSimples()
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

function init() {
  if (window.GTRTheme && typeof window.GTRTheme.applyThemeOnLoad === 'function') {
    window.GTRTheme.applyThemeOnLoad()
  }
  const toggleBtn = document.getElementById('theme-toggle')
  if (toggleBtn && window.GTRTheme && typeof window.GTRTheme.toggleTheme === 'function') {
    toggleBtn.addEventListener('click', window.GTRTheme.toggleTheme)
  }
  setActiveNav()
  renderMetasAvanzadas()
  renderMetasSimples()
}

document.addEventListener('DOMContentLoaded', init)

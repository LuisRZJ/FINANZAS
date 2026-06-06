import { listarCuentas } from '../servicios/cuentas.js'
import { listarEtiquetas } from '../servicios/etiquetas.js'
import { listarOperaciones, crearIngreso, crearGasto, crearTransferencia, eliminarOperacion, actualizarOperacion, ejecutarPendientes } from '../servicios/operaciones.js'
import { crearRecurrencia, generarInstanciasRecurrentes, obtenerRecurrencia, listarRecurrencias, eliminarRecurrencia, eliminarRecurrenciaCompleta, eliminarDesdeciCiclo, desactivarRecurrencia, actualizarRecurrencia } from '../servicios/recurrencias.js'

let editandoId = null
// Fecha filtro: día 1 del mes actual
let filtroFecha = new Date()
filtroFecha.setDate(1)

// Bug 5: Variables para modal de decisión de series
let operacionEnTransito = null
let accionEnTransito = null // 'editar' o 'borrar'

// === FUNCIONES DEL MODAL DE DECISIÓN ===

function abrirModalDecision(accion, op) {
  operacionEnTransito = op
  accionEnTransito = accion

  const modal = document.getElementById('modal-decision-serie')
  const backdrop = document.getElementById('decision-backdrop')
  const panel = document.getElementById('decision-panel')
  const subtitulo = document.getElementById('decision-subtitulo')
  const opcionesEditar = document.getElementById('decision-opciones-editar')
  const opcionesBorrar = document.getElementById('decision-opciones-borrar')

  if (!modal) return

  // Configurar texto
  subtitulo.textContent = op.nombre || 'Sin nombre'

  // Mostrar opciones según acción
  if (accion === 'editar') {
    opcionesEditar.classList.remove('hidden')
    opcionesBorrar.classList.add('hidden')
  } else {
    opcionesEditar.classList.add('hidden')
    opcionesBorrar.classList.remove('hidden')
  }

  // Mostrar modal con animación
  modal.classList.remove('hidden')
  requestAnimationFrame(() => {
    backdrop.classList.remove('opacity-0')
    panel.classList.remove('opacity-0', 'scale-95')
    panel.classList.add('opacity-100', 'scale-100')
  })
}

window.cerrarModalDecision = function () {
  const modal = document.getElementById('modal-decision-serie')
  const backdrop = document.getElementById('decision-backdrop')
  const panel = document.getElementById('decision-panel')

  if (!modal) return

  backdrop.classList.add('opacity-0')
  panel.classList.remove('opacity-100', 'scale-100')
  panel.classList.add('opacity-0', 'scale-95')

  setTimeout(() => {
    modal.classList.add('hidden')
    operacionEnTransito = null
    accionEnTransito = null
  }, 200)
}

async function ejecutarDecision(decision) {
  if (!operacionEnTransito) return

  const op = operacionEnTransito

  try {
    switch (decision) {
      case 'solo-esta':
        // Editar solo esta operación - abrir modal de edición normal
        window.cerrarModalDecision()
        // Marcar que NO debe actualizar la serie
        op._soloEsta = true
        setTimeout(() => window.abrirModal('editar', op), 250)
        break

      case 'esta-y-futuras':
        // Editar esta y futuras - abrir modal de edición con flag
        window.cerrarModalDecision()
        op._actualizarSerie = true
        setTimeout(() => window.abrirModal('editar', op), 250)
        break

      case 'borrar-solo-esta':
        await eliminarOperacion(op.id)
        window.cerrarModalDecision()
        await renderHistorial()
        break

      case 'borrar-toda-serie':
        if (confirm('⚠️ Esto borrará la plantilla Y todas las operaciones. ¿Continuar?')) {
          await eliminarRecurrenciaCompleta(op.recurrenciaId)
          window.cerrarModalDecision()
          await renderHistorial()
        }
        break

      case 'dejar-repetir':
        await desactivarRecurrencia(op.recurrenciaId)
        window.cerrarModalDecision()
        await renderHistorial()
        alert('✅ Recurrencia desactivada. Se eliminaron las operaciones futuras.')
        break
    }
  } catch (e) {
    alert('Error: ' + e.message)
  }
}

// Bind eventos a botones de decisión
function bindDecisionEvents() {
  const botones = document.querySelectorAll('#modal-decision-serie button[data-decision]')
  botones.forEach(btn => {
    btn.addEventListener('click', async () => {
      const decision = btn.getAttribute('data-decision')
      await ejecutarDecision(decision)
    })
  })
}

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function getCustomSelect(selectEl) {
  return document.querySelector(`[data-select="${selectEl.id}"]`)
}

function closeCustomSelect(custom) {
  const menu = custom.querySelector('[data-select-menu]')
  const trigger = custom.querySelector('[data-select-trigger]')
  if (menu) menu.classList.add('hidden')
  if (trigger) trigger.setAttribute('aria-expanded', 'false')
}

function closeAllCustomSelects(except) {
  const all = document.querySelectorAll('[data-select]')
  all.forEach(custom => {
    if (custom !== except) closeCustomSelect(custom)
  })
}

function updateCustomSelection(custom, value) {
  const options = custom.querySelectorAll('[data-select-options] button[data-value]')
  options.forEach(btn => {
    const selected = btn.getAttribute('data-value') === value
    btn.classList.toggle('bg-blue-50', selected)
    btn.classList.toggle('text-blue-700', selected)
    btn.classList.toggle('dark:bg-blue-900/20', selected)
    btn.classList.toggle('dark:text-blue-300', selected)
  })
}

function updateCustomLabel(selectEl) {
  const custom = getCustomSelect(selectEl)
  if (!custom) return
  const label = custom.querySelector('[data-select-label]')
  if (!label) return
  const selectedOption = selectEl.options[selectEl.selectedIndex]
  label.textContent = selectedOption ? selectedOption.textContent : 'Selecciona una opción'
  label.classList.toggle('text-gray-400', !selectEl.value)
  updateCustomSelection(custom, selectEl.value)
}

function rebuildCustomOptions(selectEl) {
  const custom = getCustomSelect(selectEl)
  if (!custom) return
  const optionsWrap = custom.querySelector('[data-select-options]')
  if (!optionsWrap) return
  optionsWrap.innerHTML = ''
  Array.from(selectEl.options).forEach(opt => {
    const li = document.createElement('li')
    const btn = document.createElement('button')
    btn.type = 'button'
    btn.setAttribute('data-value', opt.value)
    btn.className = 'w-full text-left px-3 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700'
    btn.textContent = opt.textContent
    btn.addEventListener('click', () => {
      selectEl.value = opt.value
      selectEl.dispatchEvent(new Event('change', { bubbles: true }))
      closeCustomSelect(custom)
    })
    li.appendChild(btn)
    optionsWrap.appendChild(li)
  })
  updateCustomLabel(selectEl)
}

function bindCustomSelects() {
  const customSelects = document.querySelectorAll('[data-select]')
  customSelects.forEach(custom => {
    const selectId = custom.getAttribute('data-select')
    const selectEl = document.getElementById(selectId)
    if (!selectEl) return
    const trigger = custom.querySelector('[data-select-trigger]')
    if (trigger) {
      trigger.addEventListener('click', (e) => {
        e.preventDefault()
        e.stopPropagation()
        const menu = custom.querySelector('[data-select-menu]')
        const isOpen = menu && !menu.classList.contains('hidden')
        if (isOpen) {
          closeCustomSelect(custom)
        } else {
          closeAllCustomSelects(custom)
          if (menu) menu.classList.remove('hidden')
          trigger.setAttribute('aria-expanded', 'true')
        }
      })
    }
    custom.addEventListener('click', (e) => e.stopPropagation())
    selectEl.addEventListener('change', () => updateCustomLabel(selectEl))
    rebuildCustomOptions(selectEl)
  })
  document.addEventListener('click', () => closeAllCustomSelects())
}

function setCustomSelectDisabled(selectEl, disabled) {
  const custom = getCustomSelect(selectEl)
  if (!custom) return
  const trigger = custom.querySelector('[data-select-trigger]')
  if (disabled) {
    custom.classList.add('opacity-50', 'pointer-events-none')
    if (trigger) trigger.setAttribute('aria-disabled', 'true')
  } else {
    custom.classList.remove('opacity-50', 'pointer-events-none')
    if (trigger) trigger.setAttribute('aria-disabled', 'false')
  }
}

function setSelectValue(selectEl, value) {
  if (!selectEl) return
  selectEl.value = value ?? ''
  selectEl.dispatchEvent(new Event('change', { bubbles: true }))
}

function fillSelect(el, options, getLabel, getValue) {
  el.innerHTML = ''
  const placeholder = document.createElement('option')
  placeholder.value = ''
  placeholder.textContent = 'Selecciona una opción'
  el.appendChild(placeholder)
  options.forEach(o => {
    const opt = document.createElement('option')
    opt.value = getValue(o)
    opt.textContent = getLabel(o)

    // Jerarquía visual para etiquetas
    if (o.padreId && o.nombre) {
      opt.textContent = `  ↳ ${o.nombre}`
    } else if (getLabel(o)) {
      opt.textContent = getLabel(o)
    }

    el.appendChild(opt)
  })
  rebuildCustomOptions(el)
}

// === Date Navigation Logic ===

function actualizarLabelMes() {
  const label = document.getElementById('label-mes')
  if (!label) return
  // Ej: Enero 2026
  label.textContent = filtroFecha.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' })
}

// === Fondo Estacional ===
let fondoEstacionalOverlay = null

function actualizarFondoEstacional() {
  // Leer preferencia de cookie (activado por defecto)
  const cookieMatch = document.cookie.match(/(?:^|; )gtr_fondos_dinamicos=([^;]*)/)
  const fondosActivos = cookieMatch ? cookieMatch[1] === 'true' : true

  const mesActual = filtroFecha.getMonth() // 0 = Enero, 1 = Febrero

  // Mapa de fondos por mes
  const fondosPorMes = {
    0: 'recursos/imagenes/fondo-enero.svg',
    1: 'recursos/imagenes/fondo-febrero.svg',
    2: 'recursos/imagenes/fondo-marzo.svg',
    3: 'recursos/imagenes/fondo-abril.svg',
    4: 'recursos/imagenes/fondo-mayo.svg',
    5: 'recursos/imagenes/fondo-junio.svg',
    6: 'recursos/imagenes/fondo-julio.svg',
    7: 'recursos/imagenes/fondo-agosto.svg',
    8: 'recursos/imagenes/fondo-septiembre.svg',
    9: 'recursos/imagenes/fondo-octubre.svg',
    10: 'recursos/imagenes/fondo-noviembre.svg',
    11: 'recursos/imagenes/fondo-diciembre.svg'
  }

  const fondoAsignado = fondosPorMes[mesActual]
  const debeMostrarFondo = fondosActivos && fondoAsignado

  if (debeMostrarFondo) {
    // Activar fondo
    document.body.style.backgroundImage = `url("${fondoAsignado}")`
    document.body.style.backgroundSize = 'cover'
    document.body.style.backgroundPosition = 'center bottom'
    document.body.style.backgroundRepeat = 'no-repeat'
    document.body.style.backgroundAttachment = 'fixed'

    // Crear overlay si no existe
    if (!fondoEstacionalOverlay) {
      fondoEstacionalOverlay = document.createElement('div')
      fondoEstacionalOverlay.id = 'fondo-estacional-overlay'
      fondoEstacionalOverlay.style.cssText = 'position:fixed;inset:0;z-index:0;pointer-events:none;transition:opacity 0.5s ease;'
      document.body.prepend(fondoEstacionalOverlay)

      // Elevar contenido sobre el overlay
      const header = document.querySelector('header')
      const main = document.querySelector('main')
      if (header) { header.style.position = 'relative'; header.style.zIndex = '50'; }
      if (main) { main.style.position = 'relative'; main.style.zIndex = '1'; }
    }

    // Adaptar overlay al tema actual
    const isDark = document.documentElement.classList.contains('dark')
    fondoEstacionalOverlay.style.background = isDark
      ? 'rgba(17, 24, 39, 0.35)'
      : 'rgba(249, 250, 251, 0.82)'
    fondoEstacionalOverlay.style.opacity = '1'
  } else {
    // Desactivar fondo
    document.body.style.backgroundImage = ''
    if (fondoEstacionalOverlay) {
      fondoEstacionalOverlay.style.opacity = '0'
    }
  }
}

async function cambiarMes(delta) {
  filtroFecha.setMonth(filtroFecha.getMonth() + delta)
  actualizarLabelMes()
  actualizarFondoEstacional()
  await renderHistorial()
}

// === Modal Logic ===

window.abrirModal = async function (modo = 'crear', op = null) {
  const modal = document.getElementById('modal-operacion')
  const backdrop = document.getElementById('modal-backdrop')
  const panel = document.getElementById('modal-panel')
  const title = document.getElementById('modal-title')

  if (!modal) return

  // Reset form state
  document.getElementById('form-operacion').reset()
  document.getElementById('op-error').classList.add('hidden')
  document.body.style.overflow = 'hidden' // Disable scroll
  const inputFrecuenciaValor = document.getElementById('op-rec-frecuencia-valor')
  const selectFrecuenciaTipo = document.getElementById('op-rec-frecuencia-tipo')
  if (inputFrecuenciaValor && selectFrecuenciaTipo) {
    inputFrecuenciaValor.disabled = false
    selectFrecuenciaTipo.disabled = false
    inputFrecuenciaValor.classList.remove('opacity-50')
    selectFrecuenciaTipo.classList.remove('opacity-50')
    setCustomSelectDisabled(selectFrecuenciaTipo, false)
  }

  // Load Selects Data
  await loadSelectsData()

  // Show Modal
  modal.classList.remove('hidden')
  // Trigger animations
  requestAnimationFrame(() => {
    backdrop.classList.remove('opacity-0')
    panel.classList.remove('opacity-0', 'scale-95')
    panel.classList.add('opacity-100', 'scale-100')
  })

  // Mode Logic
  if (modo === 'editar' && op) {
    editandoId = op.id
    title.textContent = 'Editar Operación'

    // Set Values
    document.getElementById('op-id').value = op.id

    // Set Radio
    const radio = document.querySelector(`input[name="tipo"][value="${op.tipo}"]`)
    if (radio) radio.checked = true

    // Set Fields
    document.getElementById('op-nombre').value = op.nombre
    document.getElementById('op-desc').value = op.descripcion || ''
    document.getElementById('op-cantidad').value = op.cantidad

    // Set DateTime Local
    // op.fecha might be "YYYY-MM-DD" or "YYYY-MM-DDTHH:MM"
    if (op.fecha.includes('T')) {
      document.getElementById('op-fecha').value = op.fecha
    } else {
      // Legacy fallback
      document.getElementById('op-fecha').value = op.fecha + 'T12:00'
    }

    if (op.tipo === 'ingreso' || op.tipo === 'gasto') {
      setSelectValue(document.getElementById('op-cuenta'), op.cuentaId)
      setSelectValue(document.getElementById('op-etiqueta'), op.etiquetaId)
    } else if (op.tipo === 'transferencia') {
      setSelectValue(document.getElementById('op-origen'), op.origenId)
      setSelectValue(document.getElementById('op-destino'), op.destinoId)
    }

    // Bug 1 Fix: Cargar estado de recurrencia si existe
    const toggleRecurrencia = document.getElementById('op-es-recurrente')
    const camposRecurrencia = document.getElementById('campos-recurrencia')

    if (op.recurrenciaId) {
      const rec = await obtenerRecurrencia(op.recurrenciaId)
      if (rec && toggleRecurrencia && camposRecurrencia) {
        // Activar toggle y mostrar campos
        toggleRecurrencia.checked = true
        camposRecurrencia.classList.remove('hidden')

        // Cargar valores de la plantilla
        document.getElementById('op-rec-frecuencia-valor').value = rec.frecuenciaValor || 1
        setSelectValue(document.getElementById('op-rec-frecuencia-tipo'), rec.frecuenciaTipo || 'meses')
        document.getElementById('op-rec-ultimo-dia').checked = rec.ultimoDiaMes || false

        // Cargar tipo de fin
        const radioFin = document.querySelector(`input[name="op-rec-fin"][value="${rec.finTipo || 'nunca'}"]`)
        if (radioFin) radioFin.checked = true

        if (rec.finCiclos) document.getElementById('op-rec-fin-ciclos').value = rec.finCiclos
        if (rec.finFecha) document.getElementById('op-rec-fin-fecha').value = rec.finFecha

        // Deshabilitar frecuencia si es último día del mes
        if (rec.ultimoDiaMes) {
          document.getElementById('op-rec-frecuencia-valor').disabled = true
          document.getElementById('op-rec-frecuencia-tipo').disabled = true
          document.getElementById('op-rec-frecuencia-valor').classList.add('opacity-50')
          document.getElementById('op-rec-frecuencia-tipo').classList.add('opacity-50')
          setCustomSelectDisabled(document.getElementById('op-rec-frecuencia-tipo'), true)
        }
      }
    } else {
      // Operación no recurrente - asegurar que toggle está apagado
      if (toggleRecurrencia) toggleRecurrencia.checked = false
      if (camposRecurrencia) camposRecurrencia.classList.add('hidden')
    }
  } else {
    editandoId = null
    title.textContent = 'Registrar Operación'
    // Default to NOW
    const now = new Date()
    // format to YYYY-MM-DDTHH:MM
    // To get local ISO, we manually build it because toISOString() uses UTC
    const localIso = new Date(now.getTime() - (now.getTimezoneOffset() * 60000)).toISOString().slice(0, 16)
    document.getElementById('op-fecha').value = localIso

    // Default type
    document.querySelector('input[name="tipo"][value="ingreso"]').checked = true
  }

  await updateFormVisibility()
}

window.cerrarModal = function () {
  const modal = document.getElementById('modal-operacion')
  const backdrop = document.getElementById('modal-backdrop')
  const panel = document.getElementById('modal-panel')

  if (!modal) return

  // Reverse animations
  backdrop.classList.add('opacity-0')
  panel.classList.remove('opacity-100', 'scale-100')
  panel.classList.add('opacity-0', 'scale-95')

  setTimeout(() => {
    modal.classList.add('hidden')
    document.body.style.overflow = '' // Enable scroll
    editandoId = null
  }, 200) // Match transition duration
}

async function updateFormVisibility() {
  const tipo = document.querySelector('input[name="tipo"]:checked').value
  const fieldCuenta = document.getElementById('field-cuenta')
  const fieldEtiqueta = document.getElementById('field-etiqueta')
  const fieldsTransf = document.getElementById('fields-transferencia')
  const selEtiquetas = document.getElementById('op-etiqueta')

  if (tipo === 'transferencia') {
    fieldCuenta.classList.add('hidden')
    fieldEtiqueta.classList.add('hidden')
    fieldsTransf.classList.remove('hidden')
    fieldsTransf.classList.add('grid')

    document.getElementById('op-origen').required = true
    document.getElementById('op-destino').required = true
    document.getElementById('op-cuenta').required = false
    document.getElementById('op-etiqueta').required = false

  } else {
    // Ingreso o Gasto
    fieldCuenta.classList.remove('hidden')
    fieldEtiqueta.classList.remove('hidden')
    fieldsTransf.classList.add('hidden')
    fieldsTransf.classList.remove('grid')

    document.getElementById('op-origen').required = false
    document.getElementById('op-destino').required = false
    document.getElementById('op-cuenta').required = true
    // Etiqueta puede ser opcional segun logica, pero aqui required
    document.getElementById('op-etiqueta').required = true

    // Refresh Etiqueta Select based on Type
    const etiquetas = await listarEtiquetas()
    const etiquetasFiltradas = etiquetas.filter(e => e.tipo === tipo)

    // Sort logic to group parent/child if needed, but fillSelect simple handles it
    fillSelect(selEtiquetas, etiquetasFiltradas, e => e.nombre, e => e.id)

    // If editing, re-set value because options changed
    if (editandoId) {
      // For now, simple re-fetch from ID (not optimal but safes)
      const ops = await listarOperaciones()
      const op = ops.find(o => o.id === editandoId)
      if (op && op.tipo === tipo) {
        setSelectValue(selEtiquetas, op.etiquetaId)
      }
    }
  }
}

async function loadSelectsData() {
  const cuentas = await listarCuentas()
  const selCuenta = document.getElementById('op-cuenta')
  const selOrigen = document.getElementById('op-origen')
  const selDestino = document.getElementById('op-destino')

  fillSelect(selCuenta, cuentas, c => c.nombre, c => c.id)
  fillSelect(selOrigen, cuentas, c => c.nombre, c => c.id)
  fillSelect(selDestino, cuentas, c => c.nombre, c => c.id)
}

function bindModalEvents() {
  const radios = document.querySelectorAll('input[name="tipo"]')
  radios.forEach(r => {
    r.addEventListener('change', async () => { await updateFormVisibility() })
  })

  // Close on backdrop click
  const modal = document.getElementById('modal-operacion')
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal || e.target.id === "modal-backdrop") {
        window.cerrarModal()
      }
    })
  }

  // Toggle de recurrencia
  const toggleRecurrencia = document.getElementById('op-es-recurrente')
  const camposRecurrencia = document.getElementById('campos-recurrencia')
  if (toggleRecurrencia && camposRecurrencia) {
    toggleRecurrencia.addEventListener('change', () => {
      camposRecurrencia.classList.toggle('hidden', !toggleRecurrencia.checked)
    })
  }

  // Toggle "último día del mes" deshabilita campos de frecuencia
  const checkUltimoDia = document.getElementById('op-rec-ultimo-dia')
  const inputFrecuenciaValor = document.getElementById('op-rec-frecuencia-valor')
  const selectFrecuenciaTipo = document.getElementById('op-rec-frecuencia-tipo')
  if (checkUltimoDia && inputFrecuenciaValor && selectFrecuenciaTipo) {
    checkUltimoDia.addEventListener('change', () => {
      const deshabilitado = checkUltimoDia.checked
      inputFrecuenciaValor.disabled = deshabilitado
      selectFrecuenciaTipo.disabled = deshabilitado
      if (deshabilitado) {
        inputFrecuenciaValor.classList.add('opacity-50')
        selectFrecuenciaTipo.classList.add('opacity-50')
      } else {
        inputFrecuenciaValor.classList.remove('opacity-50')
        selectFrecuenciaTipo.classList.remove('opacity-50')
      }
      setCustomSelectDisabled(selectFrecuenciaTipo, deshabilitado)
    })
  }

  const form = document.getElementById('form-operacion')
  form?.addEventListener('submit', handleFormSubmit)
}

async function handleFormSubmit(e) {
  e.preventDefault()
  const errorEl = document.getElementById('op-error')
  const tipo = document.querySelector('input[name="tipo"]:checked').value
  const val = (id) => document.getElementById(id).value
  const check = (id) => document.getElementById(id)?.checked

  try {
    const fechaStr = val('op-fecha')

    // Verificar si es fecha futura
    const ahora = new Date()
    const fechaOp = new Date(fechaStr.includes('T') ? fechaStr : fechaStr + 'T23:59:59')
    const esFuturo = fechaOp > ahora

    // Verificar si es recurrente
    const esRecurrente = check('op-es-recurrente') && !editandoId

    if (esFuturo && !editandoId && !esRecurrente) {
      const confirmar = confirm(
        '⏳ Esta operación tiene fecha en el futuro.\n\n' +
        'Se creará como "Pendiente" y NO afectará tus saldos hasta que llegue esa fecha.\n\n' +
        '¿Deseas continuar?'
      )
      if (!confirmar) return
    }

    const payload = {
      nombre: val('op-nombre'),
      descripcion: val('op-desc'),
      cantidad: parseFloat(val('op-cantidad') || '0'),
      fecha: fechaStr
    }

    if (tipo === 'ingreso' || tipo === 'gasto') {
      payload.cuentaId = val('op-cuenta')
      payload.etiquetaId = val('op-etiqueta')
    } else {
      payload.origenId = val('op-origen')
      payload.destinoId = val('op-destino')
    }

    if (editandoId) {
      // Edición de operación existente
      const ops = await listarOperaciones()
      const opActual = ops.find(o => o.id === editandoId)

      if (opActual && opActual.recurrenciaId) {
        // Es una operación recurrente
        // Verificar flags puestos por el modal de decisión
        const soloEsta = opActual._soloEsta
        const actualizarSerie = opActual._actualizarSerie

        // Limpiar flags temporales
        delete opActual._soloEsta
        delete opActual._actualizarSerie

        if (actualizarSerie) {
          // Actualizar plantilla de recurrencia + operación actual
          // EXTRAER valores primero para evitar errores de referencia
          const finTipoSeleccionado = document.querySelector('input[name="op-rec-fin"]:checked')?.value || 'nunca'
          const finCiclosValor = finTipoSeleccionado === 'ciclos' ? parseInt(val('op-rec-fin-ciclos') || '0', 10) : null
          const finFechaValor = finTipoSeleccionado === 'fecha' ? val('op-rec-fin-fecha') : null

          const recPayload = {
            nombre: payload.nombre,
            descripcion: payload.descripcion,
            cantidad: payload.cantidad,
            cuentaId: payload.cuentaId || null,
            etiquetaId: payload.etiquetaId || null,
            origenId: payload.origenId || null,
            destinoId: payload.destinoId || null,

            // Campos de frecuencia
            frecuenciaTipo: val('op-rec-frecuencia-tipo'),
            frecuenciaValor: parseInt(val('op-rec-frecuencia-valor') || '1', 10),
            ultimoDiaMes: document.getElementById('op-rec-ultimo-dia')?.checked || false,

            // Campos de límite (usando variables extraídas)
            finTipo: finTipoSeleccionado,
            finCiclos: finCiclosValor,
            finFecha: finFechaValor
          }

          // Actualizar plantilla de recurrencia (esto ahora limpia zombis y regenera)
          await actualizarRecurrencia(opActual.recurrenciaId, recPayload)

          // También actualizar la instancia actual
          await actualizarOperacion(editandoId, { ...payload, tipo })
        } else {
          // Solo actualizar esta operación (por defecto o si _soloEsta está activo)
          await actualizarOperacion(editandoId, { ...payload, tipo })
        }
      } else {
        // Operación simple (no recurrente)
        await actualizarOperacion(editandoId, { ...payload, tipo })
      }
    } else if (esRecurrente) {
      // === CREAR RECURRENCIA ===
      const ultimoDiaMes = check('op-rec-ultimo-dia')
      const finTipo = document.querySelector('input[name="op-rec-fin"]:checked')?.value || 'nunca'

      // Extraer fecha y hora del datetime-local
      const [fechaParte, horaParte] = fechaStr.split('T')

      const recPayload = {
        tipo: tipo,
        nombre: payload.nombre,
        descripcion: payload.descripcion,
        cantidad: payload.cantidad,
        cuentaId: payload.cuentaId || null,
        etiquetaId: payload.etiquetaId || null,
        origenId: payload.origenId || null,
        destinoId: payload.destinoId || null,

        fechaInicio: fechaParte,
        horaPreferida: horaParte || '12:00',

        frecuenciaTipo: val('op-rec-frecuencia-tipo'),
        frecuenciaValor: parseInt(val('op-rec-frecuencia-valor') || '1', 10),
        ultimoDiaMes: ultimoDiaMes,

        finTipo: finTipo,
        finCiclos: finTipo === 'ciclos' ? parseInt(val('op-rec-fin-ciclos') || '12', 10) : null,
        finFecha: finTipo === 'fecha' ? val('op-rec-fin-fecha') : null
      }

      await crearRecurrencia(recPayload)

      // Generar instancias pendientes (incluye la primera si fecha <= ahora)
      await generarInstanciasRecurrentes()

    } else {
      // Operación simple (no recurrente)
      if (tipo === 'ingreso') await crearIngreso(payload)
      else if (tipo === 'gasto') await crearGasto(payload)
      else if (tipo === 'transferencia') await crearTransferencia(payload)
    }

    window.cerrarModal()
    await renderHistorial()
  } catch (ex) {
    errorEl.textContent = ex.message
    errorEl.classList.remove('hidden')
  }
}

// === Historial Logic ===

async function renderHistorial() {
  const cont = document.getElementById('ops-historial')
  if (!cont) return

  const ops = await listarOperaciones()
  const etiquetas = await listarEtiquetas()
  const etiquetaMap = new Map(etiquetas.map(e => [e.id, e]))
  const cuentas = await listarCuentas()
  const cuentaMap = new Map(cuentas.map(c => [c.id, c]))
  const recurrencias = await listarRecurrencias()

  // Filter by Month
  const targetMonth = filtroFecha.getMonth()
  const targetYear = filtroFecha.getFullYear()

  const filteredOps = ops.filter(op => {
    // op.fecha might be YYYY-MM-DD or YYYY-MM-DDTHH:MM
    // split('T')[0] gives YYYY-MM-DD safely
    const dateOnly = op.fecha.split('T')[0]
    const parts = dateOnly.split('-')
    const year = parseInt(parts[0], 10)
    const month = parseInt(parts[1], 10) - 1
    return year === targetYear && month === targetMonth
  })

  cont.innerHTML = ''

  // 1. Sort by date desc (using full datetime)
  const sorted = [...filteredOps].sort((a, b) => {
    // Treat legacy dates as T00:00:00 for sorting stability, if needed
    // But standard Data.parse handles "YYYY-MM-DD" as UTC usually, so standardizing is better
    const da = new Date(a.fecha.includes('T') ? a.fecha : a.fecha + 'T00:00:00').getTime()
    const db = new Date(b.fecha.includes('T') ? b.fecha : b.fecha + 'T00:00:00').getTime()
    return db - da
  })

  if (sorted.length === 0) {
    const p = document.createElement('p')
    p.className = 'text-center text-sm text-gray-500 italic py-8'
    p.textContent = 'No hay transacciones registradas en este mes.'
    cont.appendChild(p)
    return
  }

  // 2. Group by date (Day only)
  const grouped = {}
  sorted.forEach(op => {
    // Group Key: YYYY-MM-DD
    const dateKey = op.fecha.split('T')[0]
    if (!grouped[dateKey]) grouped[dateKey] = []
    grouped[dateKey].push(op)
  })

  // 3. Render Groups
  Object.keys(grouped).forEach(dateKey => {
    const groupOps = grouped[dateKey]

    // Calculate Day Stats
    let dayIngreso = 0
    let dayGasto = 0
    let countIngreso = 0
    let countGasto = 0
    let countTransf = 0

    groupOps.forEach(op => {
      if (op.tipo === 'ingreso') {
        dayIngreso += op.cantidad
        countIngreso++
      } else if (op.tipo === 'gasto') {
        dayGasto += op.cantidad
        countGasto++
      } else if (op.tipo === 'transferencia') {
        countTransf++
      }
    })

    const pnl = dayIngreso - dayGasto

    // Summary Strings
    const counts = []
    if (countIngreso > 0) counts.push(`${countIngreso} Ingreso${countIngreso > 1 ? 's' : ''}`)
    if (countGasto > 0) counts.push(`${countGasto} Gasto${countGasto > 1 ? 's' : ''}`)
    if (countTransf > 0) counts.push(`${countTransf} Transferencia${countTransf > 1 ? 's' : ''}`)
    const countStr = counts.join(', ')

    // Render Separator
    const dateObj = new Date(dateKey + 'T00:00:00')
    const dateStr = dateObj.toLocaleDateString('es-ES', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' })
    const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1)

    const separator = document.createElement('div')
    separator.className = 'sticky top-0 z-20 bg-gray-50/95 dark:bg-black/80 backdrop-blur-md py-3 px-1 border-b border-gray-200 dark:border-gray-800 flex flex-wrap items-center justify-between mt-6 mb-2 first:mt-0'

    const pnlClass = pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'
    const pnlSign = pnl >= 0 ? '+' : ''

    separator.innerHTML = `
      <div class="flex flex-col">
        <span class="text-sm font-bold text-gray-900 dark:text-white capitalize">${capitalize(dateStr)}</span>
        <span class="text-xs text-gray-500 dark:text-gray-400">${countStr}</span>
      </div>
      <div class="text-right">
        <span class="text-xs font-semibold uppercase tracking-wider text-gray-400 block">PNL Diario</span>
        <span class="text-sm font-bold ${pnlClass}">${pnlSign}${formatCurrency(pnl)}</span>
      </div>
    `
    cont.appendChild(separator)

    // Render Operations
    groupOps.forEach(op => {
      const row = document.createElement('div')
      row.className = 'p-4 rounded-xl bg-white dark:bg-gray-900 border border-gray-100 dark:border-gray-800 flex flex-col sm:flex-row gap-3 items-start sm:items-center justify-between hover:shadow-md transition-shadow group mb-3'

      // Info Left
      const info = document.createElement('div')
      info.className = 'flex items-center gap-3'

      // Icon
      const iconDiv = document.createElement('div')
      let iconClass = ''
      let iconSvg = ''

      if (op.tipo === 'ingreso') {
        iconClass = 'bg-green-100 dark:bg-green-900/30 text-green-600 dark:text-green-400'
        iconSvg = '<path stroke-linecap="round" stroke-linejoin="round" d="M12 4.5v15m7.5-7.5h-15" />'
      } else if (op.tipo === 'gasto') {
        iconClass = 'bg-red-100 dark:bg-red-900/30 text-red-600 dark:text-red-400'
        iconSvg = '<path stroke-linecap="round" stroke-linejoin="round" d="M19.5 12h-15" />'
      } else {
        iconClass = 'bg-blue-100 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400'
        iconSvg = '<path stroke-linecap="round" stroke-linejoin="round" d="M7.5 21L3 16.5m0 0L7.5 12M3 16.5h13.5m0-13.5L21 7.5m0 0L16.5 12M21 7.5H7.5" />'
      }

      iconDiv.className = `w-10 h-10 rounded-full flex items-center justify-center shrink-0 ${iconClass}`
      iconDiv.innerHTML = `<svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke-width="2" stroke="currentColor">${iconSvg}</svg>`

      const textDiv = document.createElement('div')
      const title = document.createElement('div')
      title.className = 'font-semibold text-gray-900 dark:text-white'
      title.textContent = op.nombre

      const meta = document.createElement('div')
      meta.className = 'text-xs text-gray-500 dark:text-gray-400 flex flex-wrap gap-1 items-center mt-0.5'

      let cuentasStr = ''
      if (op.tipo === 'transferencia') {
        const o = cuentaMap.get(op.origenId)
        const d = cuentaMap.get(op.destinoId)
        cuentasStr = `${o?.nombre || '?'} -> ${d?.nombre || '?'}`
      } else {
        const c = cuentaMap.get(op.cuentaId)
        cuentasStr = c?.nombre || '?'
      }

      let etiquetaBadge = ''
      if (op.tipo !== 'transferencia') {
        const et = etiquetaMap.get(op.etiquetaId)
        if (et) {
          etiquetaBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-gray-100 dark:bg-gray-800 text-gray-600 dark:text-gray-300 ml-1.5">${et.icono || ''} ${et.nombre}</span>`
        }
      }

      // Show Time in Meta? User asked for precision, usually showing time is good.
      // Extract time from op.fecha if present
      let timeStr = ''
      if (op.fecha.includes('T')) {
        // Extraer solo HH:MM, eliminando segundos y zona horaria (+00:00)
        const parteHora = op.fecha.split('T')[1] || ''
        const horaLimpia = parteHora.slice(0, 5) // Solo HH:MM
        timeStr = `<span class="text-gray-400 mx-1">@ ${horaLimpia}</span>`
      }

      // Badge de Estado
      let estadoBadge = ''
      if (op.estado === 'pendiente') {
        estadoBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-400 ml-1.5">🕐 Pendiente</span>`
        // Añadir estilo a la fila para indicar que está pendiente
        row.classList.add('opacity-70', 'border-dashed')
      }

      // Badge de Recurrencia
      let recurrenciaBadge = ''
      if (op.recurrenciaId) {
        const rec = recurrencias.find(r => r.id === op.recurrenciaId)
        const cicloInfo = op.cicloNumero ? ` #${op.cicloNumero}` : ''
        const finInfo = rec?.finCiclos ? `/${rec.finCiclos}` : '/∞'
        recurrenciaBadge = `<span class="inline-flex items-center px-1.5 py-0.5 rounded text-[10px] font-medium bg-blue-100 dark:bg-blue-900/30 text-blue-700 dark:text-blue-400 ml-1.5">🔄${cicloInfo}${finInfo}</span>`
      }

      meta.innerHTML = `
          <span>${cuentasStr}</span>
          ${etiquetaBadge}
          ${timeStr}
          ${estadoBadge}
          ${recurrenciaBadge}
        `

      textDiv.appendChild(title)
      textDiv.appendChild(meta)

      const descDiv = document.createElement('div')
      descDiv.className = 'text-xs text-gray-400 dark:text-gray-500 mt-1 italic'
      descDiv.textContent = op.descripcion ? op.descripcion : 'Sin descripción'
      textDiv.appendChild(descDiv)

      info.appendChild(iconDiv)
      info.appendChild(textDiv)

      // Right Side
      const rightSide = document.createElement('div')
      rightSide.className = 'flex items-center gap-4 w-full sm:w-auto justify-between sm:justify-end mt-2 sm:mt-0'

      const amountDiv = document.createElement('div')
      const esNegativo = op.tipo === 'gasto'
      amountDiv.className = `font-bold text-lg ${esNegativo ? 'text-gray-900 dark:text-white' : (op.tipo === 'ingreso' ? 'text-green-600 dark:text-green-400' : 'text-blue-600 dark:text-blue-400')}`
      amountDiv.textContent = (esNegativo ? '- ' : '+ ') + formatCurrency(op.cantidad)

      const actions = document.createElement('div')
      actions.className = 'flex items-center gap-1 opacity-100 sm:opacity-0 group-hover:opacity-100 transition-opacity'

      const btnEdit = document.createElement('button')
      btnEdit.className = 'p-2 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded-lg transition-colors'
      btnEdit.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
      btnEdit.onclick = () => {
        if (op.recurrenciaId) {
          // Operación recurrente - mostrar modal de decisión
          abrirModalDecision('editar', op)
        } else {
          // Operación simple - abrir modal de edición directamente
          window.abrirModal('editar', op)
        }
      }

      const btnDel = document.createElement('button')
      btnDel.className = 'p-2 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/20 rounded-lg transition-colors'
      btnDel.innerHTML = '<svg class="w-4 h-4" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" stroke-linecap="round" stroke-linejoin="round"></path></svg>'
      btnDel.onclick = async () => {
        if (op.recurrenciaId) {
          // Operación recurrente - mostrar modal de decisión
          abrirModalDecision('borrar', op)
        } else {
          // Operación simple
          if (confirm('¿Borrar esta operación?')) {
            try {
              await eliminarOperacion(op.id)
              await renderHistorial()
            } catch (e) {
              alert(e.message)
            }
          }
        }
      }

      actions.appendChild(btnEdit)
      actions.appendChild(btnDel)

      rightSide.appendChild(amountDiv)
      rightSide.appendChild(actions)

      row.appendChild(info)
      row.appendChild(rightSide)

      cont.appendChild(row)
    })
  })
}

async function init() {
  if (window.GTRTheme && typeof window.GTRTheme.applyThemeOnLoad === 'function') window.GTRTheme.applyThemeOnLoad()
  const toggleBtn = document.getElementById('theme-toggle')
  if (toggleBtn && window.GTRTheme && typeof window.GTRTheme.toggleTheme === 'function') {
    toggleBtn.addEventListener('click', window.GTRTheme.toggleTheme)
  }

  const links = document.querySelectorAll('nav a[data-route]')
  const current = location.pathname.split('/').pop() || 'transacciones.html'
  links.forEach((a) => {
    const route = a.getAttribute('data-route')
    if (!route) return
    if (route === current) a.classList.add('text-primary-600', 'dark:text-primary-400')
    else a.classList.remove('no-underline') // Clean previous style if any
  })

  // Date Nav Listeners
  const btnPrev = document.getElementById('btn-prev-mes')
  const btnNext = document.getElementById('btn-next-mes')

  if (btnPrev) btnPrev.addEventListener('click', async () => { await cambiarMes(-1) })
  if (btnNext) btnNext.addEventListener('click', async () => { await cambiarMes(1) })

  bindModalEvents()
  bindCustomSelects()
  bindDecisionEvents() // Eventos del modal de decisión de series
  await ejecutarPendientes() // Procesar operaciones cuya fecha ya pasó
  await generarInstanciasRecurrentes() // Generar instancias de recurrencias pendientes
  actualizarLabelMes() // Init Label
  actualizarFondoEstacional() // Fondo estacional
  await renderHistorial()
}

document.addEventListener('DOMContentLoaded', init)

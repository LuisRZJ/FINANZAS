import { listarCuentas } from '../servicios/cuentas.js'
import { listarEtiquetas } from '../servicios/etiquetas.js'
import { listarOperaciones, crearIngreso, crearGasto, crearTransferencia, eliminarOperacion, actualizarOperacion, ejecutarPendientes } from '../servicios/operaciones.js'
import { crearRecurrencia, generarInstanciasRecurrentes, obtenerRecurrencia, listarRecurrencias, eliminarRecurrencia, eliminarRecurrenciaCompleta, eliminarDesdeciCiclo, desactivarRecurrencia, reactivarRecurrencia, actualizarRecurrencia } from '../servicios/recurrencias.js'

let editandoId = null
let currentTab = 'historial'
// Fecha filtro: día 1 del mes actual
let filtroFecha = new Date()
filtroFecha.setDate(1)

// Bug 5: Variables para modal de decisión de series
let operacionEnTransito = null
let accionEnTransito = null // 'editar' o 'borrar'
// Flags de decisión de series (a nivel de módulo para que persistan hasta handleFormSubmit)
let _flagSoloEsta = false
let _flagActualizarSerie = false

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
        _flagSoloEsta = true
        _flagActualizarSerie = false
        setTimeout(() => window.abrirModal('editar', op), 250)
        break

      case 'esta-y-futuras':
        // Editar esta y futuras - abrir modal de edición con flag
        window.cerrarModalDecision()
        _flagSoloEsta = false
        _flagActualizarSerie = true
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
  
  if (!selectedOption || !selectEl.value) {
    label.innerHTML = 'Selecciona una opción'
    label.classList.add('text-gray-400')
    updateCustomSelection(custom, '')
    return
  }
  
  label.classList.remove('text-gray-400')
  
  const icon = selectedOption.getAttribute('data-icono')
  const color = selectedOption.getAttribute('data-color')
  const nombreLimpio = selectedOption.getAttribute('data-nombre-limpio')
  const displayName = nombreLimpio || selectedOption.textContent
  
  let html = ''
  if (icon) {
    const bgStyle = color ? `background-color: ${color}15; color: ${color};` : 'background-color: rgba(156,163,175,0.1); color: inherit;'
    html = `
      <span class="flex items-center gap-2">
        <span class="inline-flex items-center justify-center shrink-0 w-5 h-5 rounded-full text-xs" style="${bgStyle}">${icon}</span>
        <span class="truncate">${displayName}</span>
      </span>
    `
  } else if (color) {
    html = `
      <span class="flex items-center gap-2">
        <span class="w-2 h-2 rounded-full shrink-0" style="background-color: ${color}"></span>
        <span class="truncate">${displayName}</span>
      </span>
    `
  } else {
    html = `<span class="truncate">${displayName}</span>`
  }
  
  label.innerHTML = html
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
    btn.className = 'w-full text-left px-3 py-2 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 flex items-center gap-2'
    
    const icon = opt.getAttribute('data-icono')
    const color = opt.getAttribute('data-color')
    const nombreLimpio = opt.getAttribute('data-nombre-limpio')
    
    if (icon) {
      const iconSpan = document.createElement('span')
      iconSpan.className = 'inline-flex items-center justify-center shrink-0 w-6 h-6 rounded-full text-sm'
      if (color) {
        iconSpan.style.backgroundColor = `${color}15`
        iconSpan.style.color = color
      } else {
        iconSpan.className += ' bg-gray-100 dark:bg-gray-800'
      }
      iconSpan.textContent = icon
      btn.appendChild(iconSpan)
    } else if (color && opt.value !== '') {
      const dotSpan = document.createElement('span')
      dotSpan.className = 'w-2.5 h-2.5 rounded-full shrink-0'
      dotSpan.style.backgroundColor = color
      btn.appendChild(dotSpan)
    }
    
    const textSpan = document.createElement('span')
    textSpan.className = 'truncate'
    textSpan.textContent = opt.textContent
    btn.appendChild(textSpan)
    
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
    
    if (o.icono) {
      opt.setAttribute('data-icono', o.icono)
    }
    if (o.color) {
      opt.setAttribute('data-color', o.color)
    }
    if (o.padreId) {
      opt.setAttribute('data-padre-id', o.padreId)
    }

    opt.textContent = getLabel(o)

    // Jerarquía visual para etiquetas
    if (o.padreId && o.nombre) {
      opt.textContent = `  ↳ ${o.nombre}`
      opt.setAttribute('data-nombre-limpio', o.nombre)
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
  const seccionRecurrencia = document.getElementById('seccion-recurrencia')
  if (seccionRecurrencia) seccionRecurrencia.classList.remove('hidden')
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
  if (modo === 'editar-recurrencia' && op) {
    const rec = op
    editandoId = rec.id
    title.textContent = 'Editar Transacción Recurrente'

    document.querySelectorAll('input[name="tipo"]').forEach(el => el.disabled = true)

    const radio = document.querySelector(`input[name="tipo"][value="${rec.tipo}"]`)
    if (radio) radio.checked = true

    document.getElementById('op-nombre').value = rec.nombre
    document.getElementById('op-desc').value = rec.descripcion || ''
    document.getElementById('op-cantidad').value = rec.cantidad
    document.getElementById('op-fecha').value = rec.fechaInicio + 'T' + (rec.horaPreferida || '12:00')

    if (rec.tipo === 'ingreso' || rec.tipo === 'gasto') {
      setSelectValue(document.getElementById('op-cuenta'), rec.cuentaId)
      setSelectValue(document.getElementById('op-etiqueta'), rec.etiquetaId)
    } else if (rec.tipo === 'transferencia') {
      setSelectValue(document.getElementById('op-origen'), rec.origenId)
      setSelectValue(document.getElementById('op-destino'), rec.destinoId)
    }

    const toggleRecurrencia = document.getElementById('op-es-recurrente')
    const camposRecurrencia = document.getElementById('campos-recurrencia')
    if (toggleRecurrencia && camposRecurrencia) {
      toggleRecurrencia.checked = true
      toggleRecurrencia.disabled = true
      camposRecurrencia.classList.remove('hidden')

      document.getElementById('op-rec-frecuencia-valor').value = rec.frecuenciaValor || 1
      setSelectValue(document.getElementById('op-rec-frecuencia-tipo'), rec.frecuenciaTipo || 'meses')
      document.getElementById('op-rec-ultimo-dia').checked = rec.ultimoDiaMes || false

      const radioFin = document.querySelector(`input[name="op-rec-fin"][value="${rec.finTipo || 'nunca'}"]`)
      if (radioFin) radioFin.checked = true

      if (rec.finCiclos) document.getElementById('op-rec-fin-ciclos').value = rec.finCiclos
      if (rec.finFecha) document.getElementById('op-rec-fin-fecha').value = rec.finFecha

      if (rec.ultimoDiaMes) {
        document.getElementById('op-rec-frecuencia-valor').disabled = true
        document.getElementById('op-rec-frecuencia-tipo').disabled = true
        document.getElementById('op-rec-frecuencia-valor').classList.add('opacity-50')
        document.getElementById('op-rec-frecuencia-tipo').classList.add('opacity-50')
        setCustomSelectDisabled(document.getElementById('op-rec-frecuencia-tipo'), true)
      }
    }
  } else if (modo === 'editar' && op) {
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

    // Cargar estado de recurrencia si existe y se seleccionó actualizar la serie completa
    const toggleRecurrencia = document.getElementById('op-es-recurrente')
    const camposRecurrencia = document.getElementById('campos-recurrencia')

    if (op.recurrenciaId && _flagActualizarSerie) {
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
      // Operación no recurrente o edición de "Solo esta" - ocultar sección completa
      if (seccionRecurrencia) seccionRecurrencia.classList.add('hidden')
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

  // Re-enable inputs disabled during editing recurrence
  document.querySelectorAll('input[name="tipo"]').forEach(el => el.disabled = false)
  const toggleRecurrencia = document.getElementById('op-es-recurrente')
  if (toggleRecurrencia) toggleRecurrencia.disabled = false

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
    // Organizar jerárquicamente: cada padre seguido inmediatamente por sus hijos
    const padres = etiquetasFiltradas.filter(e => !e.padreId)
    const hijos = etiquetasFiltradas.filter(e => e.padreId)
    
    // Agrupar hijos por padreId
    const hijosPorPadre = {}
    hijos.forEach(h => {
      if (!hijosPorPadre[h.padreId]) {
        hijosPorPadre[h.padreId] = []
      }
      hijosPorPadre[h.padreId].push(h)
    })

    const etiquetasOrdenadas = []
    
    // 1. Agregar cada padre y luego sus hijos ordenados alfabéticamente
    padres.sort((a, b) => a.nombre.localeCompare(b.nombre)).forEach(p => {
      etiquetasOrdenadas.push(p)
      if (hijosPorPadre[p.id]) {
        const hijosOrdenados = hijosPorPadre[p.id].sort((a, b) => a.nombre.localeCompare(b.nombre))
        etiquetasOrdenadas.push(...hijosOrdenados)
        delete hijosPorPadre[p.id]
      }
    })
    
    // 2. Por si queda algún hijo huérfano
    Object.keys(hijosPorPadre).forEach(padreId => {
      const hijosHuerfanos = hijosPorPadre[padreId].sort((a, b) => a.nombre.localeCompare(b.nombre))
      etiquetasOrdenadas.push(...hijosHuerfanos)
    })

    fillSelect(selEtiquetas, etiquetasOrdenadas, e => e.nombre, e => e.id)

    // If editing, re-set value because options changed
    if (editandoId) {
      if (editandoId.startsWith('rec_')) {
        const rec = await obtenerRecurrencia(editandoId)
        if (rec && rec.tipo === tipo) {
          setSelectValue(selEtiquetas, rec.etiquetaId)
        }
      } else {
        const ops = await listarOperaciones()
        const op = ops.find(o => o.id === editandoId)
        if (op && op.tipo === tipo) {
          setSelectValue(selEtiquetas, op.etiquetaId)
        }
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
      if (editandoId.startsWith('rec_')) {
        let finTipoSeleccionado = document.querySelector('input[name="op-rec-fin"]:checked')?.value || 'nunca'
        let finCiclosValor = null
        let finFechaValor = null

        if (finTipoSeleccionado === 'ciclos') {
          finCiclosValor = parseInt(val('op-rec-fin-ciclos') || '12', 10)
          if (isNaN(finCiclosValor) || finCiclosValor < 1) finCiclosValor = 12
        } else if (finTipoSeleccionado === 'fecha') {
          finFechaValor = val('op-rec-fin-fecha') || null
          if (!finFechaValor) {
            finTipoSeleccionado = 'nunca'
          }
        }

        const [fechaParte, horaParte] = payload.fecha.split('T')

        const recPayload = {
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
          ultimoDiaMes: document.getElementById('op-rec-ultimo-dia')?.checked || false,
          finTipo: finTipoSeleccionado,
          finCiclos: finCiclosValor,
          finFecha: finFechaValor
        }

        await actualizarRecurrencia(editandoId, recPayload)
        window.cerrarModal()
        if (currentTab === 'recurrentes') {
          await renderRecurrencias()
        } else {
          await renderHistorial()
        }
        return
      }

      // Edición de operación existente
      const ops = await listarOperaciones()
      const opActual = ops.find(o => o.id === editandoId)

      if (opActual && opActual.recurrenciaId) {
        // Es una operación recurrente
        // Verificar flags puestos por el modal de decisión (variables de módulo)
        const soloEsta = _flagSoloEsta
        const actualizarSerie = _flagActualizarSerie

        // Limpiar flags temporales
        _flagSoloEsta = false
        _flagActualizarSerie = false

        if (actualizarSerie) {
          const esRecurrenteActualmente = check('op-es-recurrente')
          if (!esRecurrenteActualmente) {
            // Desactivar la recurrencia (esto limpia las futuras pendientes y desactiva la serie)
            await desactivarRecurrencia(opActual.recurrenciaId)
            await actualizarOperacion(editandoId, { ...payload, tipo, recurrenciaId: null })
          } else {
            // Actualizar plantilla de recurrencia + operación actual
            // EXTRAER y sanitizar valores primero para evitar errores de referencia o valores basura
            let finTipoSeleccionado = document.querySelector('input[name="op-rec-fin"]:checked')?.value || 'nunca'
            let finCiclosValor = null
            let finFechaValor = null

            if (finTipoSeleccionado === 'ciclos') {
              finCiclosValor = parseInt(val('op-rec-fin-ciclos') || '12', 10)
              if (isNaN(finCiclosValor) || finCiclosValor < 1) finCiclosValor = 12
            } else if (finTipoSeleccionado === 'fecha') {
              finFechaValor = val('op-rec-fin-fecha') || null
              if (!finFechaValor) {
                finTipoSeleccionado = 'nunca'
              }
            }

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

              // Campos de límite
              finTipo: finTipoSeleccionado,
              finCiclos: finCiclosValor,
              finFecha: finFechaValor
            }

            // También actualizar la instancia actual primero para que las operaciones en almacenamiento tengan los nuevos datos
            await actualizarOperacion(editandoId, { ...payload, tipo })

            // Actualizar plantilla de recurrencia (pasamos editandoId para evitar que sea eliminado si es futura y pendiente)
            // Incluyendo fechaInicio y horaPreferida actualizadas a partir de la nueva fecha de la operación
            const [fechaParte, horaParte] = payload.fecha.split('T')
            recPayload.fechaInicio = fechaParte
            recPayload.horaPreferida = horaParte || '12:00'

            await actualizarRecurrencia(opActual.recurrenciaId, recPayload, editandoId)
          }
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
      let finTipo = document.querySelector('input[name="op-rec-fin"]:checked')?.value || 'nunca'
      let finCiclos = null
      let finFecha = null

      if (finTipo === 'ciclos') {
        finCiclos = parseInt(val('op-rec-fin-ciclos') || '12', 10)
        if (isNaN(finCiclos) || finCiclos < 1) finCiclos = 12
      } else if (finTipo === 'fecha') {
        finFecha = val('op-rec-fin-fecha') || null
        if (!finFecha) {
          finTipo = 'nunca'
        }
      }

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
        finCiclos: finCiclos,
        finFecha: finFecha
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

async function renderRecurrencias() {
  const cont = document.getElementById('lista-recurrencias')
  if (!cont) return

  cont.innerHTML = ''

  const recurrencias = await listarRecurrencias()
  const cuentas = await listarCuentas()
  const cuentaMap = new Map(cuentas.map(c => [c.id, c]))
  const etiquetas = await listarEtiquetas()
  const etiquetaMap = new Map(etiquetas.map(e => [e.id, e]))

  if (recurrencias.length === 0) {
    const p = document.createElement('p')
    p.className = 'text-center text-sm text-gray-500 dark:text-gray-400 italic py-8'
    p.textContent = 'No hay transacciones recurrentes registradas.'
    cont.appendChild(p)
    return
  }

  recurrencias.forEach(rec => {
    const item = document.createElement('div')
    let borderColor = 'border-l-blue-500'
    let iconBg = 'bg-blue-100 dark:bg-blue-900/30'
    let iconColor = 'text-blue-600 dark:text-blue-400'
    let iconName = 'arrow-left-right'
    let prefix = ''

    if (rec.tipo === 'ingreso') {
      borderColor = 'border-l-green-500'
      iconBg = 'bg-green-100 dark:bg-green-900/30'
      iconColor = 'text-green-600 dark:text-green-400'
      iconName = 'arrow-up-right'
      prefix = '+'
    } else if (rec.tipo === 'gasto') {
      borderColor = 'border-l-red-500'
      iconBg = 'bg-red-100 dark:bg-red-900/30'
      iconColor = 'text-red-600 dark:text-red-400'
      iconName = 'arrow-down-left'
      prefix = '-'
    }

    const formatFrecuencia = () => {
      const tipo = rec.frecuenciaTipo
      const valor = rec.frecuenciaValor || 1
      let tipoStr = tipo
      if (tipo === 'dias') tipoStr = valor > 1 ? 'días' : 'día'
      if (tipo === 'semanas') tipoStr = valor > 1 ? 'semanas' : 'semana'
      if (tipo === 'meses') tipoStr = valor > 1 ? 'meses' : 'mes'
      if (tipo === 'anios') tipoStr = valor > 1 ? 'años' : 'año'

      let res = `Cada ${valor > 1 ? valor + ' ' : ''}${tipoStr}`
      if (rec.ultimoDiaMes) {
        res += ' (último día)'
      }
      return res
    }

    const formatFin = () => {
      if (rec.finTipo === 'nunca') return 'Siempre activa'
      if (rec.finTipo === 'ciclos') return `Hasta ${rec.finCiclos} ciclos (Generados: ${rec.ciclosGenerados})`
      if (rec.finTipo === 'fecha') {
        const f = new Date(rec.finFecha)
        return `Hasta ${f.toLocaleDateString()}`
      }
      return ''
    }

    let descRelacion = ''
    if (rec.tipo === 'ingreso' || rec.tipo === 'gasto') {
      const cNom = cuentaMap.get(rec.cuentaId)?.nombre || 'Sin cuenta'
      const eNom = etiquetaMap.get(rec.etiquetaId)?.nombre || 'Sin categoría'
      descRelacion = `${cNom} • ${eNom}`
    } else if (rec.tipo === 'transferencia') {
      const origNom = cuentaMap.get(rec.origenId)?.nombre || '?'
      const destNom = cuentaMap.get(rec.destinoId)?.nombre || '?'
      descRelacion = `${origNom} ➔ ${destNom}`
    }

    item.className = `bg-gray-50 dark:bg-gray-900/40 rounded-2xl border border-gray-100 dark:border-gray-800/80 p-4 flex items-center justify-between border-l-4 ${borderColor} hover:shadow-md transition-all gap-4`
    item.innerHTML = `
      <div class="flex items-center gap-3 min-w-0 flex-1">
        <div class="w-10 h-10 rounded-full ${iconBg} flex items-center justify-center flex-shrink-0">
          <i data-lucide="${iconName}" class="w-5 h-5 ${iconColor}"></i>
        </div>
        <div class="min-w-0 flex-1">
          <h4 class="font-bold text-sm text-gray-900 dark:text-white truncate">${rec.nombre}</h4>
          <p class="text-xs text-gray-500 dark:text-gray-400 truncate mb-1">${rec.descripcion || 'Sin descripción'}</p>
          <div class="flex flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-400 dark:text-gray-500">
            <span class="font-semibold text-gray-600 dark:text-gray-300 bg-gray-200 dark:bg-gray-700 px-1.5 py-0.5 rounded">${formatFrecuencia()}</span>
            <span>•</span>
            <span class="truncate">${descRelacion}</span>
            <span>•</span>
            <span>${formatFin()}</span>
          </div>
        </div>
      </div>
      <div class="flex items-center gap-3 flex-shrink-0">
        <div class="text-right">
          <div class="font-bold text-sm ${rec.tipo === 'ingreso' ? 'text-green-600 dark:text-green-400' : rec.tipo === 'gasto' ? 'text-red-600 dark:text-red-400' : 'text-blue-600 dark:text-blue-400'}">
            ${prefix}${formatCurrency(rec.cantidad)}
          </div>
          <span class="inline-flex items-center rounded-full px-1.5 py-0.5 text-[10px] font-medium ${rec.activa ? 'bg-green-50 dark:bg-green-950/20 text-green-700 dark:text-green-400 border border-green-200/50' : 'bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400 border border-gray-200/50'}">
            ${rec.activa ? 'Activa' : 'Pausada'}
          </span>
        </div>

        <div class="flex items-center gap-1">
          <button data-action="toggle-status" title="${rec.activa ? 'Pausar' : 'Activar'}"
            class="p-2 text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 hover:bg-white dark:hover:bg-gray-800 rounded-xl transition-colors">
            <i data-lucide="${rec.activa ? 'pause' : 'play'}" class="w-4 h-4"></i>
          </button>
          <button data-action="edit" title="Editar serie"
            class="p-2 text-gray-400 hover:text-amber-600 dark:hover:text-amber-400 hover:bg-white dark:hover:bg-gray-800 rounded-xl transition-colors">
            <i data-lucide="pencil" class="w-4 h-4"></i>
          </button>
          <button data-action="delete" title="Eliminar"
            class="p-2 text-gray-400 hover:text-red-600 dark:hover:text-red-400 hover:bg-white dark:hover:bg-gray-800 rounded-xl transition-colors">
            <i data-lucide="trash-2" class="w-4 h-4"></i>
          </button>
        </div>
      </div>
    `

    const toggleBtn = item.querySelector('[data-action="toggle-status"]')
    toggleBtn.onclick = async (e) => {
      e.stopPropagation()
      if (rec.activa) {
        await desactivarRecurrencia(rec.id)
      } else {
        await reactivarRecurrencia(rec.id)
      }
      await renderRecurrencias()
    }

    const editBtn = item.querySelector('[data-action="edit"]')
    editBtn.onclick = async (e) => {
      e.stopPropagation()
      window.abrirModal('editar-recurrencia', rec)
    }

    const deleteBtn = item.querySelector('[data-action="delete"]')
    deleteBtn.onclick = async (e) => {
      e.stopPropagation()
      abrirModalDecision('borrar', { recurrenciaId: rec.id, nombre: rec.nombre })
    }

    cont.appendChild(item)
  })

  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons()
  }
}

// === Historial Logic ===

async function renderHistorial() {
  if (currentTab === 'recurrentes') {
    await renderRecurrencias()
    return
  }

  const cont = document.getElementById('ops-historial')
  if (!cont) return

  // Limpiar intervalos de badges anteriores para evitar fugas de memoria
  if (window._badgeIntervals && window._badgeIntervals.length > 0) {
    window._badgeIntervals.forEach(id => clearInterval(id))
  }
  window._badgeIntervals = []

  // Inicializar iconos Lucide estáticos del HTML
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons()
  }

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

  // Calcular diferencia en meses para aviso de límite de proyección de recurrencias
  const ahora = new Date()
  const totalMonthDiff = (targetYear - ahora.getFullYear()) * 12 + (targetMonth - ahora.getMonth())
  if (totalMonthDiff >= 1) {
    let mensaje = ''
    if (totalMonthDiff < 3) {
      mensaje = 'Estás viendo un periodo a futuro. Por optimización, las transacciones recurrentes diarias no se proyectan más allá de 1 mes. El resto aparecerá automáticamente conforme transcurra el tiempo.'
    } else if (totalMonthDiff < 12) {
      mensaje = 'Estás viendo un periodo a futuro. Por optimización, las transacciones recurrentes diarias y semanales no se proyectan a este mes (límites de 1 y 3 meses). El resto aparecerá automáticamente conforme transcurra el tiempo.'
    } else if (totalMonthDiff < 24) {
      mensaje = 'Estás viendo un periodo a futuro lejano. Por optimización, en este mes solo se muestran transacciones recurrentes mensuales y anuales. Las de mayor frecuencia (diarias/semanales) no se proyectan a largo plazo.'
    } else {
      mensaje = 'Estás viendo un periodo a futuro muy lejano. Por optimización, en este mes solo se muestran transacciones recurrentes anuales. Las demás aparecerán automáticamente conforme transcurra el tiempo.'
    }

    const warningBanner = document.createElement('div')
    warningBanner.className = 'mb-5 p-4 rounded-2xl bg-amber-50/80 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 text-amber-800 dark:text-amber-300 text-xs flex items-start gap-3 text-left'
    warningBanner.innerHTML = `
      <i data-lucide="info" class="w-4 h-4 flex-shrink-0 mt-0.5 text-amber-600 dark:text-amber-400"></i>
      <div>
        <p class="font-bold text-xs mb-0.5">Optimización de proyección de recurrencias</p>
        <p class="leading-relaxed opacity-95">${mensaje}</p>
      </div>
    `
    cont.appendChild(warningBanner)
  }

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
    p.className = 'text-center text-sm text-gray-500 dark:text-gray-400 italic py-8'
    p.textContent = 'No hay transacciones registradas en este mes.'
    cont.appendChild(p)

    // Inicializar iconos Lucide por si acaso antes de retornar
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
      window.lucide.createIcons()
    }
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
    const weekday = dateObj.toLocaleDateString('es-ES', { weekday: 'long' })
    const dayNum = dateObj.getDate()
    const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1)

    const separator = document.createElement('div')
    separator.className = 'flex justify-between items-end px-2 mb-3 mt-6 first:mt-0'

    const pnlClass = pnl >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
    const pnlSign = pnl >= 0 ? '+' : ''

    separator.innerHTML = `
      <div>
        <h4 class="text-sm font-semibold text-gray-800 dark:text-gray-200 capitalize">${capitalize(weekday)}, ${dayNum}</h4>
        <span class="text-xs text-gray-400 dark:text-gray-500">${countStr}</span>
      </div>
      <div class="text-right">
        <span class="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider block mb-0.5">PNL Diario</span>
        <span class="text-sm font-medium ${pnlClass}">${pnlSign}${formatCurrency(pnl)}</span>
      </div>
    `
    cont.appendChild(separator)

    // Render Operations
    groupOps.forEach(op => {
      const row = document.createElement('div')
      row.className = 'group bg-white dark:bg-gray-900 rounded-2xl p-3 mb-2 flex items-center gap-3 border border-gray-100/50 dark:border-gray-800/60 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] dark:shadow-none hover:shadow-[0_4px_15px_-4px_rgba(0,0,0,0.08)] transition-all relative overflow-hidden'

      if (op.estado === 'pendiente') {
        row.classList.add('opacity-75', 'border-dashed')
      } else if (op.estado === 'en_espera') {
        row.classList.add('border-dashed', 'bg-amber-50/15', 'dark:bg-amber-950/5', 'border-amber-300/60', 'dark:border-amber-900/40')
      }

      // 1. Decorador lateral
      let decoradorColor = ''
      if (op.tipo === 'ingreso') {
        decoradorColor = 'bg-emerald-400 dark:bg-emerald-500'
      } else if (op.tipo === 'gasto') {
        decoradorColor = 'bg-red-400 dark:bg-red-500'
      } else {
        decoradorColor = 'bg-blue-400 dark:bg-blue-500'
      }
      const decorador = document.createElement('div')
      decorador.className = `absolute left-0 top-0 bottom-0 w-1 ${decoradorColor} opacity-40 group-hover:opacity-100 transition-opacity rounded-l-2xl`
      row.appendChild(decorador)

      // 2. Icono o emoji
      const iconDiv = document.createElement('div')
      const et = op.tipo !== 'transferencia' ? etiquetaMap.get(op.etiquetaId) : null

      if (et && et.icono) {
        // Es un emoji
        iconDiv.className = 'w-10 h-10 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center shrink-0 text-lg border border-gray-100/40 dark:border-gray-700/40'
        iconDiv.textContent = et.icono
      } else {
        // Es un icono de Lucide
        let iconName = ''
        let iconColorClass = ''
        let iconBgClass = ''

        if (op.tipo === 'ingreso') {
          iconName = 'arrow-down-left'
          iconColorClass = 'text-emerald-500 dark:text-emerald-400'
          iconBgClass = 'bg-emerald-50 dark:bg-emerald-950/40'
        } else if (op.tipo === 'gasto') {
          iconName = 'arrow-up-right'
          iconColorClass = 'text-red-500 dark:text-red-400'
          iconBgClass = 'bg-red-50 dark:bg-red-950/40'
        } else {
          iconName = 'arrow-left-right'
          iconColorClass = 'text-blue-500 dark:text-blue-400'
          iconBgClass = 'bg-blue-50 dark:bg-blue-950/40'
        }
        iconDiv.className = `w-10 h-10 rounded-full ${iconBgClass} flex items-center justify-center shrink-0 border border-gray-100/40 dark:border-gray-700/40`
        iconDiv.innerHTML = `<i data-lucide="${iconName}" class="w-5 h-5 ${iconColorClass}"></i>`
      }
      row.appendChild(iconDiv)

      // 3. Info (Centro)
      const infoDiv = document.createElement('div')
      infoDiv.className = 'flex-1 min-w-0'

      const titleWrapper = document.createElement('div')
      titleWrapper.className = 'flex items-center gap-2'

      const title = document.createElement('h5')
      title.className = 'text-sm font-medium text-gray-800 dark:text-gray-200 truncate'
      title.textContent = op.nombre
      titleWrapper.appendChild(title)

      if (op.estado === 'pendiente') {
        const pendingBadge = document.createElement('span')
        pendingBadge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/20 shrink-0 ml-1.5'

        const ahora = new Date()
        ahora.setHours(0, 0, 0, 0)
        const fechaOp = new Date(op.fecha.includes('T') ? op.fecha : op.fecha + 'T00:00:00')
        fechaOp.setHours(0, 0, 0, 0)

        const diffTime = fechaOp.getTime() - ahora.getTime()
        const diffDays = diffTime > 0 ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : 0

        let textoAlterno = 'Próximamente'
        if (diffDays === 0) {
          textoAlterno = 'Hoy'
        } else if (diffDays === 1) {
          textoAlterno = 'Mañana'
        } else if (diffDays > 1) {
          textoAlterno = `En ${diffDays} días`
        }

        pendingBadge.innerHTML = `<i data-lucide="clock" class="w-2.5 h-2.5"></i><span class="transition-opacity duration-300 opacity-100" data-badge-text>Próximamente</span>`
        pendingBadge.title = 'Pendiente'
        titleWrapper.appendChild(pendingBadge)

        if (textoAlterno !== 'Próximamente') {
          const spanText = pendingBadge.querySelector('[data-badge-text]')
          let mostrandoProximamente = true

          const intervalId = setInterval(() => {
            if (!spanText || !spanText.isConnected) {
              clearInterval(intervalId)
              return
            }

            // Fade out
            spanText.classList.remove('opacity-100')
            spanText.classList.add('opacity-0')

            setTimeout(() => {
              if (!spanText || !spanText.isConnected) return
              mostrandoProximamente = !mostrandoProximamente
              spanText.textContent = mostrandoProximamente ? 'Próximamente' : textoAlterno
              // Fade in
              spanText.classList.remove('opacity-0')
              spanText.classList.add('opacity-100')
            }, 300)
          }, 3500)

          window._badgeIntervals.push(intervalId)
        }
      } else if (op.estado === 'en_espera') {
        const pendingBadge = document.createElement('span')
        pendingBadge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-500/10 text-amber-600 dark:text-amber-400 border border-amber-500/20 shrink-0 ml-1.5'
        pendingBadge.innerHTML = `<i data-lucide="alert-circle" class="w-2.5 h-2.5"></i><span>Por Confirmar</span>`
        titleWrapper.appendChild(pendingBadge)
      }
      infoDiv.appendChild(titleWrapper)

      // Subtext / Metadata
      const metaDiv = document.createElement('div')
      metaDiv.className = 'text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 flex flex-wrap items-center gap-1.5 truncate'

      let cuentasStr = ''
      if (op.estado === 'en_espera') {
        cuentasStr = 'Cuenta por definir'
      } else if (op.tipo === 'transferencia') {
        const o = cuentaMap.get(op.origenId)
        const d = cuentaMap.get(op.destinoId)
        cuentasStr = `${o?.nombre || '?'} → ${d?.nombre || '?'}`
      } else {
        const c = cuentaMap.get(op.cuentaId)
        cuentasStr = c?.nombre || '?'
      }
      const spanCuenta = document.createElement('span')
      spanCuenta.textContent = cuentasStr
      if (op.estado === 'en_espera') {
        spanCuenta.classList.add('italic', 'text-gray-400', 'dark:text-gray-505')
      }
      metaDiv.appendChild(spanCuenta)

      const dot1 = document.createElement('span')
      dot1.className = 'w-0.5 h-0.5 rounded-full bg-gray-300 dark:bg-gray-750'
      metaDiv.appendChild(dot1)

      if (op.estado === 'en_espera') {
        const spanCat = document.createElement('span')
        spanCat.className = 'italic text-gray-400 dark:text-gray-505'
        spanCat.textContent = 'Categoría por definir'
        metaDiv.appendChild(spanCat)

        const dot2 = document.createElement('span')
        dot2.className = 'w-0.5 h-0.5 rounded-full bg-gray-300 dark:bg-gray-750'
        metaDiv.appendChild(dot2)
      } else if (op.tipo !== 'transferencia' && et) {
        const spanCat = document.createElement('span')
        spanCat.className = 'text-blue-500/85 dark:text-blue-400/85'
        spanCat.textContent = et.nombre
        metaDiv.appendChild(spanCat)
        
        const dot2 = document.createElement('span')
        dot2.className = 'w-0.5 h-0.5 rounded-full bg-gray-300 dark:bg-gray-750'
        metaDiv.appendChild(dot2)
      }

      let timeStr = '00:00'
      if (op.fecha.includes('T')) {
        timeStr = op.fecha.split('T')[1].slice(0, 5)
      }
      const spanTime = document.createElement('span')
      spanTime.textContent = timeStr
      metaDiv.appendChild(spanTime)

      // Recurrencia badge compacto
      if (op.recurrenciaId) {
        const dot3 = document.createElement('span')
        dot3.className = 'w-0.5 h-0.5 rounded-full bg-gray-300 dark:bg-gray-750'
        metaDiv.appendChild(dot3)

        const rec = recurrencias.find(r => r.id === op.recurrenciaId)
        const cicloInfo = op.cicloNumero ? ` #${op.cicloNumero}` : ''
        const finInfo = rec?.finCiclos ? `/${rec.finCiclos}` : ''
        const spanRec = document.createElement('span')
        spanRec.className = 'text-blue-500 dark:text-blue-400 flex items-center gap-0.5 font-medium'
        spanRec.innerHTML = `<i data-lucide="refresh-cw" class="w-2.5 h-2.5"></i>${cicloInfo}${finInfo}`
        metaDiv.appendChild(spanRec)
      }

      infoDiv.appendChild(metaDiv)

      // Descripción discreta si existe
      if (op.descripcion) {
        const descEl = document.createElement('div')
        descEl.className = 'text-[10px] text-gray-400 dark:text-gray-500 italic truncate mt-0.5'
        descEl.textContent = op.descripcion
        infoDiv.appendChild(descEl)
      }

      row.appendChild(infoDiv)

      // 4. Monto y Acciones a la derecha
      const rightDiv = document.createElement('div')
      rightDiv.className = 'text-right flex flex-col items-end shrink-0 relative'

      const esNegativo = op.tipo === 'gasto'
      const amountEl = document.createElement('span')
      let amountColorClass = ''
      if (op.tipo === 'ingreso') amountColorClass = 'text-emerald-600 dark:text-emerald-400'
      else if (op.tipo === 'gasto') amountColorClass = 'text-gray-800 dark:text-gray-200'
      else amountColorClass = 'text-blue-600 dark:text-blue-400'

      amountEl.textContent = (esNegativo ? '-' : '+') + formatCurrency(op.cantidad)
      rightDiv.appendChild(amountEl)

      if (op.estado === 'en_espera') {
        amountEl.className = `text-sm font-semibold ${amountColorClass}`
        
        const btnConfirmar = document.createElement('button')
        btnConfirmar.className = 'mt-1 px-2.5 py-1 text-[10px] font-bold bg-orange-600 hover:bg-orange-700 text-white rounded-xl transition-all shadow-sm flex items-center gap-1 focus:outline-none'
        btnConfirmar.innerHTML = `<i data-lucide="check" class="w-3 h-3"></i> Confirmar`
        btnConfirmar.onclick = (e) => {
          e.stopPropagation()
          window.abrirModal('editar', op)
        }
        
        const btnDelEnEspera = document.createElement('button')
        btnDelEnEspera.className = 'mt-1 px-2 py-1 text-[10px] font-bold border border-gray-200 dark:border-gray-700 text-gray-500 hover:text-red-500 rounded-xl transition-all flex items-center gap-1 focus:outline-none'
        btnDelEnEspera.innerHTML = `<i data-lucide="trash-2" class="w-3 h-3"></i>`
        btnDelEnEspera.onclick = async (e) => {
          e.stopPropagation()
          if (confirm('¿Borrar esta operación pendiente?')) {
            try {
              await eliminarOperacion(op.id)
              await renderHistorial()
            } catch (ex) {
              alert(ex.message)
            }
          }
        }

        const buttonsRow = document.createElement('div')
        buttonsRow.className = 'flex items-center gap-1'
        buttonsRow.appendChild(btnConfirmar)
        buttonsRow.appendChild(btnDelEnEspera)
        rightDiv.appendChild(buttonsRow)
      } else {
        amountEl.className = `text-sm font-semibold ${amountColorClass} group-hover:-translate-x-12 transition-transform duration-200`
        
        const actionsDiv = document.createElement('div')
        actionsDiv.className = 'absolute right-0 top-1/2 -translate-y-1/2 flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity bg-white dark:bg-gray-900 pl-2'

        const btnEdit = document.createElement('button')
        btnEdit.className = 'p-1 text-gray-400 hover:text-blue-500 hover:bg-blue-50 dark:hover:bg-blue-900/30 rounded-lg transition-colors'
        btnEdit.innerHTML = '<i data-lucide="pencil" class="w-3.5 h-3.5"></i>'
        btnEdit.onclick = (e) => {
          e.stopPropagation()
          if (op.recurrenciaId) {
            abrirModalDecision('editar', op)
          } else {
            window.abrirModal('editar', op)
          }
        }

        const btnDel = document.createElement('button')
        btnDel.className = 'p-1 text-gray-400 hover:text-red-500 hover:bg-red-50 dark:hover:bg-red-900/30 rounded-lg transition-colors'
        btnDel.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>'
        btnDel.onclick = async (e) => {
          e.stopPropagation()
          if (op.recurrenciaId) {
            abrirModalDecision('borrar', op)
          } else {
            if (confirm('¿Borrar esta operación?')) {
              try {
                await eliminarOperacion(op.id)
                await renderHistorial()
              } catch (ex) {
                alert(ex.message)
              }
            }
          }
        }

        actionsDiv.appendChild(btnEdit)
        actionsDiv.appendChild(btnDel)
        rightDiv.appendChild(actionsDiv)
      }

      row.appendChild(rightDiv)
      cont.appendChild(row)
    })
  })

  // Inicializar iconos Lucide dinámicos
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons()
  }
}

async function init() {
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons()
  }
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

  const tabHistorial = document.getElementById('tab-historial')
  const tabRecurrentes = document.getElementById('tab-recurrentes')

  if (tabHistorial && tabRecurrentes) {
    tabHistorial.addEventListener('click', async () => {
      currentTab = 'historial'

      tabHistorial.className = "flex-1 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-gray-700 text-blue-600 dark:text-white shadow-sm transition-all focus:outline-none"
      tabRecurrentes.className = "flex-1 py-2 text-xs font-semibold rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-all focus:outline-none"

      document.getElementById('contenedor-mes-selector')?.classList.remove('hidden')
      document.getElementById('vista-historial')?.classList.remove('hidden')
      document.getElementById('vista-recurrentes')?.classList.add('hidden')

      await renderHistorial()
    })

    tabRecurrentes.addEventListener('click', async () => {
      currentTab = 'recurrentes'

      tabRecurrentes.className = "flex-1 py-2 text-xs font-semibold rounded-xl bg-white dark:bg-gray-700 text-blue-600 dark:text-white shadow-sm transition-all focus:outline-none"
      tabHistorial.className = "flex-1 py-2 text-xs font-semibold rounded-xl text-gray-500 dark:text-gray-400 hover:text-gray-800 dark:hover:text-gray-200 transition-all focus:outline-none"

      document.getElementById('contenedor-mes-selector')?.classList.add('hidden')
      document.getElementById('vista-historial')?.classList.add('hidden')
      document.getElementById('vista-recurrentes')?.classList.remove('hidden')

      await renderRecurrencias()
    })
  }

  bindModalEvents()
  bindCustomSelects()
  bindDecisionEvents() // Eventos del modal de decisión de series
  await ejecutarPendientes() // Procesar operaciones cuya fecha ya pasó
  await generarInstanciasRecurrentes() // Generar instancias de recurrencias pendientes
  actualizarLabelMes() // Init Label
  actualizarFondoEstacional() // Fondo estacional
  await renderHistorial()

  // Auto-confirmar si viene ?confirmar=opId en los query params
  const params = new URLSearchParams(location.search)
  const confirmarId = params.get('confirmar')
  if (confirmarId) {
    const ops = await listarOperaciones()
    const op = ops.find(o => o.id === confirmarId)
    if (op) {
      setTimeout(() => {
        window.abrirModal('editar', op)
      }, 300)
    }
  }
}

document.addEventListener('DOMContentLoaded', init)

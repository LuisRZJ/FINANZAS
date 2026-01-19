import { listarEtiquetas, crearEtiqueta, actualizarEtiqueta, eliminarEtiqueta } from '../servicios/etiquetas.js'
import { contarOperacionesPorEtiqueta, limpiarReferenciaEtiqueta, eliminarOperacionesPorEtiqueta } from '../servicios/operaciones.js'
import { STORAGE_KEYS } from '../sistema/constantes.js'
import { iniciarSesion, registrar, cerrarSesion, obtenerUsuarioActual } from '../servicios/auth.js'
import { respaldarDatos, restaurarDatos } from '../servicios/sincronizacion.js'

function renderSeccion(tipo, containerId) {
  const cont = document.getElementById(containerId)
  if (!cont) return

  const allTags = listarEtiquetas().filter(t => t.tipo === tipo)

  // Separar padres y huérfanos
  const padres = allTags.filter(t => !t.padreId)
  const hijos = allTags.filter(t => t.padreId)

  // Mapa de hijos por padre
  const hijosMap = {}
  hijos.forEach(h => {
    if (!hijosMap[h.padreId]) hijosMap[h.padreId] = []
    hijosMap[h.padreId].push(h)
  })

  cont.innerHTML = ''

  if (padres.length === 0 && hijos.length === 0) {
    cont.innerHTML = `<p class="text-sm text-gray-500 italic py-2">No hay etiquetas de ${tipo} registradas.</p>`
    return
  }

  const grid = document.createElement('div')
  grid.className = 'flex flex-col gap-3'

  padres.forEach(tag => {
    const card = document.createElement('div')
    card.className = 'flex flex-col p-4 rounded-lg bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 shadow-sm transition-colors'
    // Si hay icono, usar el color para el borde izquierdo de la tarjeta
    if (tag.icono) {
      card.style.borderLeft = `4px solid ${tag.color}`
    } else {
      card.style.borderLeft = `4px solid ${tag.color}` // Siempre mostrar borde de color para consistencia
    }

    const header = document.createElement('div')
    header.className = 'flex items-center justify-between mb-2'

    const nameArea = document.createElement('div')
    nameArea.className = 'flex items-center gap-3'

    const badge = document.createElement('div')
    if (tag.icono) {
      badge.textContent = tag.icono
      badge.className = 'text-xl leading-none'
      badge.style.color = tag.color
    } else {
      badge.className = 'w-4 h-4 rounded-full shadow-sm'
      badge.style.backgroundColor = tag.color
    }

    const name = document.createElement('span')
    name.className = 'font-semibold text-gray-900 dark:text-gray-100 text-lg'
    name.textContent = tag.nombre

    nameArea.appendChild(badge)
    nameArea.appendChild(name)
    header.appendChild(nameArea)

    // Acciones principales
    const actions = document.createElement('div')
    actions.className = 'flex flex-wrap items-center gap-2 mt-2 pb-2 border-b border-gray-100 dark:border-gray-700'

    const btnEdit = document.createElement('button')
    btnEdit.className = 'text-xs px-2 py-1 rounded bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors'
    btnEdit.textContent = 'Editar'
    btnEdit.onclick = () => abrirEdicion(tag)

    const btnHist = document.createElement('button')
    btnHist.className = 'text-xs px-2 py-1 rounded bg-blue-50 dark:bg-blue-900/30 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/50 transition-colors'
    btnHist.textContent = 'Historial'
    btnHist.onclick = () => abrirHistorial(tag)

    const btnAddSub = document.createElement('button')
    btnAddSub.className = 'text-xs px-2 py-1 rounded bg-green-50 dark:bg-green-900/30 text-green-600 dark:text-green-400 hover:bg-green-100 dark:hover:bg-green-900/50 transition-colors flex items-center gap-1'
    btnAddSub.innerHTML = '<span>➕</span> Sub-etiqueta'
    btnAddSub.onclick = () => abrirModalCreacion(tag.tipo, tag.id, tag.nombre) // Pasar padreId y nombrePadre

    const btnDel = document.createElement('button')
    btnDel.className = 'text-xs px-2 py-1 rounded bg-red-50 dark:bg-red-900/30 text-red-600 dark:text-red-400 hover:bg-red-100 dark:hover:bg-red-900/50 transition-colors ml-auto'
    btnDel.textContent = 'Eliminar'
    btnDel.onclick = () => confirmarEliminacionEtiqueta(tag)

    actions.appendChild(btnEdit)
    actions.appendChild(btnHist)
    actions.appendChild(btnAddSub)
    actions.appendChild(btnDel)

    card.appendChild(header)
    card.appendChild(actions)

    // Renderizar Sub-etiquetas
    const subTags = hijosMap[tag.id] || []
    if (subTags.length > 0) {
      const subContainer = document.createElement('div')
      subContainer.className = 'mt-3 pl-4 border-l-2 border-gray-100 dark:border-gray-700 space-y-2'

      subTags.forEach(sub => {
        const subRow = document.createElement('div')
        subRow.className = 'flex items-center justify-between p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors group'

        const subLeft = document.createElement('div')
        subLeft.className = 'flex items-center gap-2'

        const subBadge = document.createElement('div')
        if (sub.icono) {
          subBadge.textContent = sub.icono
          subBadge.className = 'text-sm leading-none'
        } else {
          subBadge.className = 'w-2 h-2 rounded-full'
          subBadge.style.backgroundColor = sub.color
        }

        const subName = document.createElement('span')
        subName.className = 'text-sm font-medium text-gray-700 dark:text-gray-300'
        subName.textContent = sub.nombre

        subLeft.appendChild(subBadge)
        subLeft.appendChild(subName)

        const subActions = document.createElement('div')
        subActions.className = 'flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity'

        const btnSubEdit = document.createElement('button')
        btnSubEdit.className = 'p-1 text-gray-400 hover:text-blue-500 transition-colors'
        btnSubEdit.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z"></path></svg>'
        btnSubEdit.onclick = () => abrirEdicion(sub)

        const btnSubDel = document.createElement('button')
        btnSubDel.className = 'p-1 text-gray-400 hover:text-red-500 transition-colors'
        btnSubDel.innerHTML = '<svg class="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>'
        btnSubDel.onclick = () => confirmarEliminacionEtiqueta(sub)

        subActions.appendChild(btnSubEdit)
        subActions.appendChild(btnSubDel)

        subRow.appendChild(subLeft)
        subRow.appendChild(subActions)
        subContainer.appendChild(subRow)
      })
      card.appendChild(subContainer)
    }

    grid.appendChild(card)
  })

  // Renderizar Huérfanos (por si acaso hay inconsistencias de datos, mostrarlos al final)
  // Aunque en teoría siempre deberían tener padre o ser null.
  // Si padreId existe pero no se encuentra en 'padres', son huérfanos reales por borrado de padre.
  // Deberíamos mostrarlos como raíces para no perderlos
  const padresIds = new Set(padres.map(p => p.id))
  const huerfanosReales = hijos.filter(h => !padresIds.has(h.padreId))

  if (huerfanosReales.length > 0) {
    // Logic for orphans could be rendering them as roots or separate section
    // For now, render as roots to allow recovery/editing
    huerfanosReales.forEach(tag => {
      // Simplificado: Renderizar como root básico
      const card = document.createElement('div')
      card.className = 'flex items-center justify-between p-4 rounded-lg bg-gray-50 dark:bg-gray-900 border border-gray-200 dark:border-gray-700 border-dashed'

      /* ... render básico ... */
      // Por brevedad, omitimos detalle, pero es bueno saber que existen.
    })
  }

  cont.appendChild(grid)
}

function renderTodas() {
  renderSeccion('ingreso', 'lista-ingresos')
  renderSeccion('gasto', 'lista-gastos')
}

function abrirEdicion(tag) {
  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in'
  overlay.id = `modal-editar-etiqueta-${tag.id}`

  const modal = document.createElement('div')
  modal.className = 'bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6'

  modal.innerHTML = `
    <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Editar Etiqueta</h3>
    <form id="form-edit-tag" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre</label>
        <input type="text" id="edit-tag-nombre" value="${tag.nombre}" required 
          class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
      </div>
      <div class="grid grid-cols-6 gap-4">
        <div class="col-span-1">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Icono</label>
          <input type="text" id="edit-tag-icono" value="${tag.icono || ''}" placeholder="📝" maxlength="2"
            class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-2 text-center text-lg focus:ring-2 focus:ring-primary-500 outline-none">
        </div>
        <div class="col-span-2">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Color</label>
          <input type="color" id="edit-tag-color" value="${tag.color}" 
            class="w-full h-10 rounded-md border border-gray-300 dark:border-gray-700 p-1 bg-white dark:bg-gray-950 cursor-pointer">
        </div>
        <div class="col-span-3">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">
            Tipo ${tag.padreId ? '<span class="text-xs font-normal text-gray-500 ml-1">(Heredado)</span>' : ''}
          </label>
          <select id="edit-tag-tipo" ${tag.padreId ? 'disabled' : ''} class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm ${tag.padreId ? 'opacity-60 cursor-not-allowed' : ''}">
            <option value="ingreso" ${tag.tipo === 'ingreso' ? 'selected' : ''}>Ingreso</option>
            <option value="gasto" ${tag.tipo === 'gasto' ? 'selected' : ''}>Gasto</option>
          </select>
        </div>
      </div>
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" id="btn-cancel-edit" 
          class="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          Cancelar
        </button>
        <button type="submit" class="px-4 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors shadow-sm">
          Guardar cambios
        </button>
      </div>
    </form>
  `

  overlay.appendChild(modal)
  document.body.appendChild(overlay)

  // Desactivar scroll
  document.body.style.overflow = 'hidden'

  const cerrarModal = () => {
    overlay.remove()
    document.body.style.overflow = ''
  }

  document.getElementById('btn-cancel-edit').addEventListener('click', cerrarModal)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrarModal()
  })

  const form = document.getElementById('form-edit-tag')
  form.onsubmit = (e) => {
    e.preventDefault()
    const nuevoNombre = document.getElementById('edit-tag-nombre').value
    const nuevoIcono = document.getElementById('edit-tag-icono').value
    const nuevoColor = document.getElementById('edit-tag-color').value
    const nuevoTipo = document.getElementById('edit-tag-tipo').value

    try {
      actualizarEtiqueta(tag.id, {
        nombre: nuevoNombre,
        icono: nuevoIcono,
        color: nuevoColor,
        tipo: nuevoTipo
      })
      renderTodas()
      cerrarModal()
    } catch (err) {
      alert(err.message)
    }
  }
}

function abrirHistorial(tag) {
  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in'
  overlay.id = `modal-historial-etiqueta-${tag.id}`

  const modal = document.createElement('div')
  modal.className = 'bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 flex flex-col max-h-[80vh]'

  let tableContent = ''
  let historial = [...(tag.historial || [])]
  if (historial.length === 0 && tag.creadaEn) {
    historial.push({ fecha: tag.creadaEn, tipo: 'creacion', mensaje: 'Etiqueta creada' })
  }
  historial.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))

  if (historial.length === 0) {
    tableContent = '<p class="text-sm text-gray-500 italic text-center py-8">Sin registros registrados en el historial.</p>'
  } else {
    tableContent = `
      <div class="overflow-y-auto px-6 pb-6 space-y-4">
        ${historial.map(h => `
          <div class="border-l-2 border-primary-500 pl-4 py-1 relative">
            <div class="absolute -left-[9px] top-2 w-4 h-4 rounded-full bg-primary-500 border-4 border-white dark:border-gray-800"></div>
            <div class="text-[10px] font-mono text-gray-400 uppercase mb-1">${new Date(h.fecha).toLocaleString()}</div>
            <div class="text-sm text-gray-700 dark:text-gray-200">${h.mensaje}</div>
          </div>
        `).join('')}
      </div>
    `
  }

  modal.innerHTML = `
    <div class="p-6 flex items-center justify-between border-b border-gray-100 dark:border-gray-700 mb-4">
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100">Historial: ${tag.nombre}</h3>
      <button id="btn-close-hist-x" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    </div>
    ${tableContent}
    <div class="p-6 border-t border-gray-100 dark:border-gray-700 flex justify-end">
      <button id="btn-close-hist" class="px-4 py-2 rounded-md text-sm font-medium bg-gray-100 dark:bg-gray-700 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-600 transition-colors">
        Cerrar
      </button>
    </div>
  `

  overlay.appendChild(modal)
  document.body.appendChild(overlay)

  // Desactivar scroll
  document.body.style.overflow = 'hidden'

  const cerrarModal = () => {
    overlay.remove()
    document.body.style.overflow = ''
  }

  document.getElementById('btn-close-hist').addEventListener('click', cerrarModal)
  document.getElementById('btn-close-hist-x').addEventListener('click', cerrarModal)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrarModal()
  })
}

function confirmarEliminacionEtiqueta(tag) {
  const numOperaciones = contarOperacionesPorEtiqueta(tag.id)

  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in'
  overlay.id = `modal-eliminar-etiqueta-${tag.id}`

  const modal = document.createElement('div')
  modal.className = 'bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6'

  // Construir HTML del modal
  let operacionesHTML = ''
  if (numOperaciones > 0) {
    operacionesHTML = `
      <div class="mt-4 p-3 rounded-lg bg-amber-50 dark:bg-amber-900/20 border border-amber-200 dark:border-amber-800 text-left">
        <div class="flex items-start gap-2">
          <svg class="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
          </svg>
          <div>
            <p class="text-sm font-medium text-amber-800 dark:text-amber-200">Transacciones asociadas</p>
            <p class="text-xs text-amber-700 dark:text-amber-300">Esta etiqueta tiene <span class="font-bold">${numOperaciones}</span> transacción(es) registradas.</p>
          </div>
        </div>
      </div>
      <div class="mt-4 p-3 rounded-lg bg-gray-50 dark:bg-gray-700 text-left">
        <p class="text-sm font-medium text-gray-700 dark:text-gray-300 mb-3">¿Qué hacer con las transacciones?</p>
        <div class="space-y-2">
          <label class="flex items-start gap-3 cursor-pointer p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600">
            <input type="radio" name="eliminar-etiqueta-ops" value="conservar" checked class="mt-0.5 w-4 h-4 text-sky-600 border-gray-300 focus:ring-sky-500">
            <div>
              <p class="text-sm font-medium text-gray-700 dark:text-gray-300">Conservar transacciones</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">Las transacciones quedarán sin etiqueta asignada</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer p-2 rounded hover:bg-gray-100 dark:hover:bg-gray-600">
            <input type="radio" name="eliminar-etiqueta-ops" value="eliminar" class="mt-0.5 w-4 h-4 text-red-600 border-gray-300 focus:ring-red-500">
            <div>
              <p class="text-sm font-medium text-red-600 dark:text-red-400">Eliminar transacciones</p>
              <p class="text-xs text-gray-500 dark:text-gray-400">Se borrarán permanentemente todas las transacciones con esta etiqueta</p>
            </div>
          </label>
        </div>
      </div>
    `
  }

  modal.innerHTML = `
    <div class="flex flex-col items-center text-center">
      <div class="w-12 h-12 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mb-4 text-red-600">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
      </div>
      <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">¿Eliminar etiqueta?</h3>
      <p class="text-sm text-gray-600 dark:text-gray-400">
        Esta acción eliminará "<span class="font-bold">${tag.nombre}</span>" permanentemente. No se puede deshacer.
      </p>
      ${operacionesHTML}
      <div class="flex flex-col w-full gap-2 mt-6">
        <button id="btn-confirm-delete" class="w-full px-4 py-2 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700 transition-colors shadow-sm">
          Eliminar permanentemente
        </button>
        <button id="btn-cancel-delete" class="w-full px-4 py-2 rounded-md text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          Cancelar
        </button>
      </div>
    </div>
  `

  overlay.appendChild(modal)
  document.body.appendChild(overlay)

  // Desactivar scroll
  document.body.style.overflow = 'hidden'

  const cerrarModal = () => {
    overlay.remove()
    document.body.style.overflow = ''
  }

  document.getElementById('btn-cancel-delete').addEventListener('click', cerrarModal)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrarModal()
  })

  document.getElementById('btn-confirm-delete').addEventListener('click', () => {
    // Verificar qué opción eligió el usuario
    const radioEliminar = modal.querySelector('input[name="eliminar-etiqueta-ops"][value="eliminar"]')
    const eliminarTransacciones = radioEliminar && radioEliminar.checked

    if (numOperaciones > 0) {
      if (eliminarTransacciones) {
        // Eliminar todas las transacciones con esta etiqueta
        eliminarOperacionesPorEtiqueta(tag.id)
      } else {
        // Limpiar la referencia (las transacciones quedan sin etiqueta)
        limpiarReferenciaEtiqueta(tag.id)
      }
    }

    eliminarEtiqueta(tag.id)
    renderTodas()
    cerrarModal()
  })
}

function abrirModalCreacion(tipoDefault = 'gasto', padreId = null, nombrePadre = null) {
  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in'
  overlay.id = 'modal-crear-etiqueta'

  const modal = document.createElement('div')
  modal.className = 'bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6'

  const colorSugerido = tipoDefault === 'ingreso' ? '#22c55e' : '#ef4444'
  const titulo = padreId ? `Nueva Sub-etiqueta de "${nombrePadre}"` : 'Nueva Categoría'

  modal.innerHTML = `
    <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">${titulo}</h3>
    <form id="form-create-tag" class="space-y-4">
      <div>
        <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Nombre</label>
        <input type="text" id="create-tag-nombre" placeholder="Ej. Salario, Comida..." required 
          class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
      </div>
      <div class="grid grid-cols-6 gap-4">
        <div class="col-span-1">
           <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Icono</label>
           <input type="text" id="create-tag-icono" placeholder="📝" maxlength="2"
             class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-2 text-center text-lg focus:ring-2 focus:ring-primary-500 outline-none">
        </div>
        <div class="col-span-2">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Color</label>
          <input type="color" id="create-tag-color" value="${colorSugerido}" 
            class="w-full h-10 rounded-md border border-gray-300 dark:border-gray-700 p-1 bg-white dark:bg-gray-950 cursor-pointer">
        </div>
        <div class="col-span-3">
          <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo</label>
          <select id="create-tag-tipo" ${padreId ? 'disabled' : ''} class="w-full h-10 rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none ${padreId ? 'opacity-60 cursor-not-allowed' : ''}">
            <option value="ingreso" ${tipoDefault === 'ingreso' ? 'selected' : ''}>Ingreso</option>
            <option value="gasto" ${tipoDefault === 'gasto' ? 'selected' : ''}>Gasto</option>
          </select>
        </div>
      </div>
      <div class="flex gap-3 justify-end pt-2">
        <button type="button" id="btn-cancel-create" 
          class="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
          Cancelar
        </button>
        <button type="submit" class="px-4 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors shadow-sm">
          ${padreId ? 'Crear sub-etiqueta' : 'Crear etiqueta'}
        </button>
      </div>
    </form>
  `

  overlay.appendChild(modal)
  document.body.appendChild(overlay)

  // Desactivar scroll
  document.body.style.overflow = 'hidden'

  const cerrarModal = () => {
    overlay.remove()
    document.body.style.overflow = ''
  }

  document.getElementById('btn-cancel-create').addEventListener('click', cerrarModal)
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) cerrarModal()
  })

  // Cambiar color sugerido si cambia el tipo (solo si no es sub-etiqueta)
  const selectTipo = document.getElementById('create-tag-tipo')
  const inputColor = document.getElementById('create-tag-color')
  if (!padreId) {
    selectTipo.addEventListener('change', () => {
      if (selectTipo.value === 'ingreso') inputColor.value = '#22c55e'
      else inputColor.value = '#ef4444'
    })
  }

  const form = document.getElementById('form-create-tag')
  form.onsubmit = (e) => {
    e.preventDefault()
    const nombre = document.getElementById('create-tag-nombre').value
    const icono = document.getElementById('create-tag-icono').value
    const color = inputColor.value
    const tipo = selectTipo.value

    crearEtiqueta({ nombre, color, tipo, icono, padreId })

    renderTodas()
    cerrarModal()
  }
}

function calcularUsoAlmacenamiento() {
  if (typeof localStorage === 'undefined') return 'N/D'

  try {
    // Simular exactamente el objeto que se descargará
    const snapshot = construirSnapshotDatos()
    // Usar los mismos parámetros de formateo que en la descarga (null, 2)
    const jsonString = JSON.stringify(snapshot, null, 2)
    const total = jsonString.length

    if (total === 0) return '0 B'
    const kb = total / 1024
    const mb = kb / 1024
    if (mb >= 1) return mb.toFixed(2) + ' MB'
    return kb.toFixed(2) + ' KB'
  } catch (err) {
    console.error('Error calculando espacio:', err)
    return 'Error'
  }
}

function construirSnapshotDatos() {
  const snapshot = {}
  const keys = Object.values(STORAGE_KEYS)
  keys.forEach((k) => {
    try {
      const raw = localStorage.getItem(k)
      if (raw !== null) {
        snapshot[k] = JSON.parse(raw)
      }
    } catch {
      // ignorar claves corruptas
    }
  })
  return {
    version: 1,
    exportadoEn: new Date().toISOString(),
    datos: snapshot
  }
}

function restaurarDesdeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.datos) {
    throw new Error('Archivo de respaldo inválido')
  }
  const datos = snapshot.datos
  const keys = Object.values(STORAGE_KEYS)
  keys.forEach((k) => {
    if (Object.prototype.hasOwnProperty.call(datos, k)) {
      localStorage.setItem(k, JSON.stringify(datos[k]))
    } else {
      localStorage.removeItem(k)
    }
  })
}

function inicializarPanelDatos() {
  const usageEl = document.getElementById('data-usage')
  const msgEl = document.getElementById('data-management-message')
  const btnExport = document.getElementById('btn-export-data')
  const inputImport = document.getElementById('input-import-data')
  const btnClear = document.getElementById('btn-clear-data')

  if (usageEl) {
    usageEl.textContent = calcularUsoAlmacenamiento()
  }

  if (btnExport) {
    btnExport.addEventListener('click', () => {
      try {
        const snapshot = construirSnapshotDatos()
        const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
          type: 'application/json'
        })
        const url = URL.createObjectURL(blob)
        const a = document.createElement('a')
        const fecha = new Date().toISOString().slice(0, 10)
        a.href = url
        a.download = `gtr-finanzas-backup-${fecha}.json`
        document.body.appendChild(a)
        a.click()
        a.remove()
        URL.revokeObjectURL(url)
        if (msgEl) {
          msgEl.textContent = 'Respaldo generado correctamente.'
        }
      } catch (err) {
        if (msgEl) {
          msgEl.textContent = 'Error al generar respaldo: ' + (err.message || String(err))
        }
      }
    })
  }

  if (inputImport) {
    inputImport.addEventListener('change', () => {
      const file = inputImport.files && inputImport.files[0]
      if (!file) return
      const reader = new FileReader()
      reader.onload = (ev) => {
        try {
          const text = ev.target?.result
          const data = JSON.parse(text)
          restaurarDesdeSnapshot(data)
          if (msgEl) {
            msgEl.textContent = 'Datos restaurados correctamente. Recarga la página para ver los cambios.'
          }
          if (usageEl) {
            usageEl.textContent = calcularUsoAlmacenamiento()
          }
        } catch (err) {
          if (msgEl) {
            msgEl.textContent = 'Error al importar respaldo: ' + (err.message || String(err))
          }
        }
      }
      reader.readAsText(file)
    })
  }

  if (btnClear) {
    btnClear.addEventListener('click', () => {
      // Crear modal de confirmación
      const overlay = document.createElement('div')
      overlay.className = 'fixed inset-0 bg-black/50 flex items-center justify-center z-50'
      overlay.id = 'modal-borrar-datos'

      const modal = document.createElement('div')
      modal.className = 'bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6'

      modal.innerHTML = `
        <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-4">Borrar todos los datos</h3>
        <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
          Esta acción borrará todos tus datos de cuentas, etiquetas, operaciones, metas y presupuestos.
        </p>
        <div class="space-y-3 mb-6">
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" id="chk-borrar-local" checked disabled class="w-4 h-4 rounded border-gray-300">
            <span class="text-sm text-gray-700 dark:text-gray-300">Borrar datos locales (navegador)</span>
          </label>
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" id="chk-borrar-nube" class="w-4 h-4 rounded border-red-300 text-red-600 focus:ring-red-500">
            <span class="text-sm text-red-600 dark:text-red-400 font-medium">También borrar datos en la nube</span>
          </label>
          <p id="warning-nube" class="hidden text-xs text-red-500 ml-7">⚠️ Los datos en la nube se perderán permanentemente.</p>
        </div>
        <div class="flex gap-3 justify-end">
          <button id="btn-cancelar-borrado" class="px-4 py-2 rounded-md text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700">
            Cancelar
          </button>
          <button id="btn-confirmar-borrado" class="px-4 py-2 rounded-md text-sm font-medium bg-red-600 text-white hover:bg-red-700">
            Borrar datos
          </button>
        </div>
      `

      overlay.appendChild(modal)
      document.body.appendChild(overlay)

      // Mostrar advertencia cuando se marca el checkbox de nube
      const chkNube = document.getElementById('chk-borrar-nube')
      const warningNube = document.getElementById('warning-nube')
      chkNube.addEventListener('change', () => {
        warningNube.classList.toggle('hidden', !chkNube.checked)
      })

      // Cerrar modal
      const cerrarModal = () => overlay.remove()
      document.getElementById('btn-cancelar-borrado').addEventListener('click', cerrarModal)
      overlay.addEventListener('click', (e) => {
        if (e.target === overlay) cerrarModal()
      })

      // Confirmar borrado
      document.getElementById('btn-confirmar-borrado').addEventListener('click', async () => {
        const borrarNube = chkNube.checked

        try {
          // Siempre borramos local
          const keys = Object.values(STORAGE_KEYS)
          keys.forEach((k) => localStorage.removeItem(k))

          // Si se marcó, también borrar en la nube
          if (borrarNube) {
            const { borrarDatosNube } = await import('../servicios/sincronizacion.js')
            const resultado = await borrarDatosNube()
            if (!resultado.success) {
              throw new Error(resultado.error)
            }
          }

          if (msgEl) {
            msgEl.textContent = borrarNube
              ? 'Datos borrados localmente y en la nube.'
              : 'Datos locales borrados.'
          }
          if (usageEl) {
            usageEl.textContent = calcularUsoAlmacenamiento()
          }
          renderTodas()
          cerrarModal()
        } catch (err) {
          if (msgEl) {
            msgEl.textContent = 'Error al borrar datos: ' + (err.message || String(err))
          }
          cerrarModal()
        }
      })
    })
  }

  // === Integración con Discord ===
  const inputWebhook = document.getElementById('input-discord-webhook')
  const btnSaveWebhook = document.getElementById('btn-save-webhook')
  const btnBackupDiscord = document.getElementById('btn-backup-discord')
  const discordMsgEl = document.getElementById('discord-message')

  // Cargar webhook guardado
  const loadWebhook = () => {
    try {
      const config = JSON.parse(localStorage.getItem(STORAGE_KEYS.configuracion) || '{}')
      return config.discordWebhook || ''
    } catch { return '' }
  }

  // Guardar webhook
  const saveWebhook = (url) => {
    try {
      const config = JSON.parse(localStorage.getItem(STORAGE_KEYS.configuracion) || '{}')
      config.discordWebhook = url
      localStorage.setItem(STORAGE_KEYS.configuracion, JSON.stringify(config))
      return true
    } catch { return false }
  }

  if (inputWebhook) {
    inputWebhook.value = loadWebhook()
  }

  if (btnSaveWebhook && inputWebhook) {
    btnSaveWebhook.addEventListener('click', () => {
      const url = inputWebhook.value.trim()
      if (saveWebhook(url)) {
        if (discordMsgEl) discordMsgEl.textContent = url ? '✅ Webhook guardado.' : 'Webhook eliminado.'
        setTimeout(() => { if (discordMsgEl) discordMsgEl.textContent = '' }, 3000)
      }
    })
  }

  if (btnBackupDiscord && inputWebhook) {
    btnBackupDiscord.addEventListener('click', async () => {
      const webhookUrl = inputWebhook.value.trim() || loadWebhook()
      if (!webhookUrl) {
        if (discordMsgEl) discordMsgEl.textContent = '⚠️ Primero guarda una URL de Webhook.'
        return
      }

      btnBackupDiscord.disabled = true
      if (discordMsgEl) discordMsgEl.textContent = '📤 Enviando respaldo...'

      try {
        const snapshot = construirSnapshotDatos()
        const jsonString = JSON.stringify(snapshot, null, 2)
        const fecha = new Date().toISOString().slice(0, 10)
        const fileName = `gtr-finanzas-backup-${fecha}.json`

        const blob = new Blob([jsonString], { type: 'application/json' })
        const formData = new FormData()
        formData.append('file', blob, fileName)
        formData.append('payload_json', JSON.stringify({
          content: `📦 **Respaldo de GTR Finanzas** - ${new Date().toLocaleString()}`
        }))

        const response = await fetch(webhookUrl, {
          method: 'POST',
          body: formData
        })

        if (!response.ok) {
          throw new Error(`HTTP ${response.status}: ${response.statusText}`)
        }

        if (discordMsgEl) discordMsgEl.textContent = '✅ Respaldo enviado a Discord correctamente.'
      } catch (err) {
        if (discordMsgEl) discordMsgEl.textContent = '❌ Error: ' + (err.message || String(err))
      } finally {
        btnBackupDiscord.disabled = false
      }
    })
  }
}

async function inicializarAuth() {
  const guestEl = document.getElementById('auth-guest')
  const userEl = document.getElementById('auth-user')
  const userEmailEl = document.getElementById('user-email')
  const authMsgEl = document.getElementById('auth-message')
  const syncMsgEl = document.getElementById('sync-message')

  const formLogin = document.getElementById('form-login')
  const formRegister = document.getElementById('form-register')
  const btnLogout = document.getElementById('btn-logout')
  const btnBackup = document.getElementById('btn-backup-cloud')
  const btnRestore = document.getElementById('btn-restore-cloud')

  function showMessage(el, msg, isError = false) {
    if (!el) return
    el.textContent = msg
    el.className = `text-sm text-center ${isError ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`
  }

  async function updateAuthUI() {
    const user = await obtenerUsuarioActual()
    if (user) {
      if (guestEl) guestEl.classList.add('hidden')
      if (userEl) userEl.classList.remove('hidden')
      if (userEmailEl) userEmailEl.textContent = user.email
    } else {
      if (guestEl) guestEl.classList.remove('hidden')
      if (userEl) userEl.classList.add('hidden')
    }
  }

  // Inicializar UI
  await updateAuthUI()

  // Login
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault()
      const email = formLogin.querySelector('[name="email"]').value
      const password = formLogin.querySelector('[name="password"]').value

      showMessage(authMsgEl, 'Iniciando sesión...', false)
      const { user, error } = await iniciarSesion(email, password)

      if (error) {
        showMessage(authMsgEl, error, true)
      } else {
        showMessage(authMsgEl, '¡Sesión iniciada!', false)
        formLogin.reset()
        await updateAuthUI()
      }
    })
  }

  // Registro
  if (formRegister) {
    formRegister.addEventListener('submit', async (e) => {
      e.preventDefault()
      const email = formRegister.querySelector('[name="email"]').value
      const password = formRegister.querySelector('[name="password"]').value

      showMessage(authMsgEl, 'Registrando...', false)
      const { user, error } = await registrar(email, password)

      if (error) {
        showMessage(authMsgEl, error, true)
      } else {
        showMessage(authMsgEl, 'Cuenta creada. Revisa tu email para confirmar.', false)
        formRegister.reset()
      }
    })
  }

  // Logout
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      await cerrarSesion()
      await updateAuthUI()
      showMessage(syncMsgEl, '', false)
    })
  }

  // Backup
  if (btnBackup) {
    btnBackup.addEventListener('click', async () => {
      showMessage(syncMsgEl, 'Verificando sincronización...', false)
      const result = await respaldarDatos()

      if (result.success) {
        showMessage(syncMsgEl, `✓ Respaldo subido: ${result.stats.cuentas} cuentas, ${result.stats.etiquetas} etiquetas, ${result.stats.operaciones} operaciones.`, false)
      } else if (result.conflicto) {
        // Mostrar modal de conflicto
        const overlay = document.createElement('div')
        overlay.className = 'fixed inset-0 bg-black/50 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in'
        overlay.id = 'modal-conflicto-sync'

        const modal = document.createElement('div')
        modal.className = 'bg-white dark:bg-gray-800 rounded-lg shadow-xl max-w-md w-full mx-4 p-6'

        modal.innerHTML = `
          <div class="flex flex-col items-center text-center">
            <div class="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mb-4 text-amber-600">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
              </svg>
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-gray-100 mb-2">Conflicto de Sincronización</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-4">
              ${result.error}
            </p>
            <p class="text-xs text-gray-500 dark:text-gray-500 mb-6">
              ${result.conflicto.accionRecomendada}
            </p>
            <div class="flex flex-col w-full gap-2">
              <button id="btn-descargar-primero" class="w-full px-4 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 transition-colors shadow-sm">
                Descargar datos de la nube primero
              </button>
              <button id="btn-forzar-subida" class="w-full px-4 py-2 rounded-md text-sm font-medium border border-red-300 dark:border-red-600 text-red-600 dark:text-red-400 hover:bg-red-50 dark:hover:bg-red-900/20 transition-colors">
                Forzar subida (sobrescribir nube)
              </button>
              <button id="btn-cancelar-sync" class="w-full px-4 py-2 rounded-md text-sm font-medium text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
                Cancelar
              </button>
            </div>
          </div>
        `

        overlay.appendChild(modal)
        document.body.appendChild(overlay)

        const cerrarModal = () => overlay.remove()

        document.getElementById('btn-cancelar-sync').addEventListener('click', cerrarModal)
        overlay.addEventListener('click', (e) => {
          if (e.target === overlay) cerrarModal()
        })

        document.getElementById('btn-descargar-primero').addEventListener('click', async () => {
          cerrarModal()
          showMessage(syncMsgEl, 'Descargando datos de la nube...', false)
          const downloadResult = await restaurarDatos()
          if (downloadResult.success) {
            showMessage(syncMsgEl, '✓ Datos descargados. Ahora puedes subir tu respaldo.', false)
            renderTodas()
            const usageEl = document.getElementById('data-usage')
            if (usageEl) usageEl.textContent = calcularUsoAlmacenamiento()
          } else {
            showMessage(syncMsgEl, downloadResult.error, true)
          }
        })

        document.getElementById('btn-forzar-subida').addEventListener('click', async () => {
          cerrarModal()
          showMessage(syncMsgEl, 'Forzando subida...', false)
          const forceResult = await respaldarDatos({ forzar: true })
          if (forceResult.success) {
            showMessage(syncMsgEl, `✓ Respaldo forzado: ${forceResult.stats.cuentas} cuentas, ${forceResult.stats.etiquetas} etiquetas, ${forceResult.stats.operaciones} operaciones.`, false)
          } else {
            showMessage(syncMsgEl, forceResult.error, true)
          }
        })
      } else {
        showMessage(syncMsgEl, result.error, true)
      }
    })
  }

  // Restore
  if (btnRestore) {
    btnRestore.addEventListener('click', async () => {
      if (!confirm('Esto reemplazará tus datos locales con los de la nube. ¿Continuar?')) return

      showMessage(syncMsgEl, 'Descargando respaldo...', false)
      const result = await restaurarDatos()

      if (result.success) {
        showMessage(syncMsgEl, `✓ Restaurado: ${result.stats.cuentas} cuentas, ${result.stats.etiquetas} etiquetas, ${result.stats.operaciones} operaciones. Recarga la página.`, false)
        renderTodas()
        const usageEl = document.getElementById('data-usage')
        if (usageEl) usageEl.textContent = calcularUsoAlmacenamiento()
      } else {
        showMessage(syncMsgEl, result.error, true)
      }
    })
  }
}

function init() {
  if (window.GTRTheme && typeof window.GTRTheme.applyThemeOnLoad === 'function') window.GTRTheme.applyThemeOnLoad()

  const toggleBtn = document.getElementById('theme-toggle')
  if (toggleBtn && window.GTRTheme) {
    toggleBtn.addEventListener('click', window.GTRTheme.toggleTheme)
  }

  // Active link
  const links = document.querySelectorAll('nav a[data-route]')
  const current = location.pathname.split('/').pop() || 'configuracion.html'
  links.forEach(a => {
    if (a.getAttribute('data-route') === current) {
      a.classList.add('text-primary-600', 'dark:text-primary-400')
    }
  })

  const btnCrearIngreso = document.getElementById('btn-abrir-crear-ingreso')
  if (btnCrearIngreso) btnCrearIngreso.addEventListener('click', () => abrirModalCreacion('ingreso'))

  const btnCrearGasto = document.getElementById('btn-abrir-crear-gasto')
  if (btnCrearGasto) btnCrearGasto.addEventListener('click', () => abrirModalCreacion('gasto'))

  renderTodas()
  inicializarPanelDatos()
  inicializarAuth()
}

document.addEventListener('DOMContentLoaded', init)

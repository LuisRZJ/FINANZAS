import { listarEtiquetas, crearEtiqueta, actualizarEtiqueta, eliminarEtiqueta } from '../servicios/etiquetas.js'
import { contarOperacionesPorEtiqueta, limpiarReferenciaEtiqueta, eliminarOperacionesPorEtiqueta } from '../servicios/operaciones.js'
import { STORAGE_KEYS } from '../sistema/constantes.js'
import { estaAutenticadoEnNube, guardarPasswordNube, cerrarSesionNube } from '../servicios/auth.js'
import { respaldarDatos, restaurarDatos } from '../servicios/sincronizacion.js'
import { leer, escribir, eliminar } from '../servicios/almacenamiento.js'
import { procesarCSVBudge } from '../servicios/migracion.js'

async function renderSeccion(tipo, containerId) {
  const cont = document.getElementById(containerId)
  if (!cont) return

  const etiquetas = await listarEtiquetas()
  const allTags = etiquetas.filter(t => t.tipo === tipo)

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
    cont.innerHTML = `<p class="text-xs text-gray-400 dark:text-gray-500 italic py-3 text-center border border-dashed border-gray-100 dark:border-gray-800 rounded-2xl">No hay etiquetas de ${tipo} registradas.</p>`
    return
  }

  const grid = document.createElement('div')
  grid.className = 'flex flex-col gap-3.5'

  padres.forEach(tag => {
    const card = document.createElement('div')
    card.className = 'flex flex-col p-4 rounded-3xl bg-gray-50/40 dark:bg-gray-900/15 border border-gray-200/60 dark:border-gray-800/60 shadow-sm transition-all duration-300 hover:shadow-md'
    card.style.borderLeft = `4px solid ${tag.color}`

    const header = document.createElement('div')
    header.className = 'flex items-center justify-between mb-1.5'

    const nameArea = document.createElement('div')
    nameArea.className = 'flex items-center gap-2.5'

    const badge = document.createElement('div')
    if (tag.icono) {
      badge.textContent = tag.icono
      badge.className = 'text-lg leading-none w-7 h-7 flex items-center justify-center rounded-xl bg-white dark:bg-gray-800 shadow-sm border border-gray-100 dark:border-gray-800'
    } else {
      badge.className = 'w-3.5 h-3.5 rounded-full shadow-sm'
      badge.style.backgroundColor = tag.color
    }

    const name = document.createElement('span')
    name.className = 'font-bold text-gray-900 dark:text-white text-sm tracking-tight'
    name.textContent = tag.nombre

    nameArea.appendChild(badge)
    nameArea.appendChild(name)
    header.appendChild(nameArea)

    // Acciones principales
    const actions = document.createElement('div')
    actions.className = 'flex flex-wrap items-center gap-1.5 mt-2.5 pt-2.5 border-t border-gray-100 dark:border-gray-800/80'

    const btnEdit = document.createElement('button')
    btnEdit.className = 'text-[10px] px-2 py-1.5 rounded-xl bg-white dark:bg-gray-700 hover:bg-gray-100 dark:hover:bg-gray-600 transition-colors text-gray-700 dark:text-gray-200 border border-gray-200 dark:border-gray-600 flex items-center gap-1 font-semibold'
    btnEdit.innerHTML = '<i data-lucide="pencil" class="w-3 h-3 text-gray-500 dark:text-gray-400"></i>Editar'
    btnEdit.onclick = async () => await abrirEdicion(tag)

    const btnHist = document.createElement('button')
    btnHist.className = 'text-[10px] px-2 py-1.5 rounded-xl bg-blue-50/60 dark:bg-blue-950/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100/60 dark:hover:bg-blue-950/40 transition-colors border border-blue-100 dark:border-blue-900/50 flex items-center gap-1 font-semibold'
    btnHist.innerHTML = '<i data-lucide="history" class="w-3 h-3 text-blue-500"></i>Historial'
    btnHist.onclick = () => abrirHistorial(tag)

    const btnAddSub = document.createElement('button')
    btnAddSub.className = 'text-[10px] px-2 py-1.5 rounded-xl bg-emerald-50/60 dark:bg-emerald-950/20 text-emerald-600 dark:text-emerald-400 hover:bg-emerald-100/60 dark:hover:bg-emerald-950/40 transition-colors border border-emerald-100 dark:border-emerald-900/50 flex items-center gap-1 font-semibold'
    btnAddSub.innerHTML = '<i data-lucide="plus" class="w-3 h-3 text-emerald-500"></i>Sub-etiqueta'
    btnAddSub.onclick = () => abrirModalCreacion(tag.tipo, tag.id, tag.nombre)

    const btnDel = document.createElement('button')
    btnDel.className = 'text-[10px] px-2 py-1.5 rounded-xl bg-rose-50/60 dark:bg-rose-950/20 text-rose-600 dark:text-rose-400 hover:bg-rose-100/60 dark:hover:bg-rose-950/40 transition-colors border border-rose-100 dark:border-rose-900/50 flex items-center gap-1 ml-auto font-semibold'
    btnDel.innerHTML = '<i data-lucide="trash-2" class="w-3 h-3 text-rose-500"></i>Eliminar'
    btnDel.onclick = async () => await confirmarEliminacionEtiqueta(tag)

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
      subContainer.className = 'mt-3 pl-3.5 border-l border-gray-200 dark:border-gray-800 space-y-2'

      subTags.forEach(sub => {
        const subRow = document.createElement('div')
        subRow.className = 'flex items-center justify-between p-2 rounded-xl hover:bg-white dark:hover:bg-gray-800/60 border border-transparent hover:border-gray-100 dark:hover:border-gray-800 transition-all group'

        const subLeft = document.createElement('div')
        subLeft.className = 'flex items-center gap-2'

        const subBadge = document.createElement('div')
        if (sub.icono) {
          subBadge.textContent = sub.icono
          subBadge.className = 'text-sm leading-none'
        } else {
          subBadge.className = 'w-2 h-2 rounded-full shadow-sm'
          subBadge.style.backgroundColor = sub.color
        }

        const subName = document.createElement('span')
        subName.className = 'text-xs font-semibold text-gray-700 dark:text-gray-300'
        subName.textContent = sub.nombre

        subLeft.appendChild(subBadge)
        subLeft.appendChild(subName)

        const subActions = document.createElement('div')
        subActions.className = 'flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity'

        const btnSubEdit = document.createElement('button')
        btnSubEdit.className = 'p-1 text-gray-400 hover:text-blue-500 transition-colors'
        btnSubEdit.innerHTML = '<i data-lucide="pencil" class="w-3.5 h-3.5"></i>'
        btnSubEdit.onclick = async () => await abrirEdicion(sub)

        const btnSubDel = document.createElement('button')
        btnSubDel.className = 'p-1 text-gray-400 hover:text-rose-500 transition-colors'
        btnSubDel.innerHTML = '<i data-lucide="trash-2" class="w-3.5 h-3.5"></i>'
        btnSubDel.onclick = async () => await confirmarEliminacionEtiqueta(sub)

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

  // Renderizar Huérfanos
  const padresIds = new Set(padres.map(p => p.id))
  const huerfanosReales = hijos.filter(h => !padresIds.has(h.padreId))

  if (huerfanosReales.length > 0) {
    huerfanosReales.forEach(tag => {
      const card = document.createElement('div')
      card.className = 'flex items-center justify-between p-3.5 rounded-3xl bg-gray-50/20 dark:bg-gray-900/10 border border-gray-200 dark:border-gray-800 border-dashed text-xs text-gray-500 dark:text-gray-400 italic'
      card.textContent = `Categoría huérfana: ${tag.nombre}`
      grid.appendChild(card)
    })
  }

  cont.appendChild(grid)
}

async function renderTodas() {
  await renderSeccion('ingreso', 'lista-ingresos')
  await renderSeccion('gasto', 'lista-gastos')
  if (window.lucide) {
    window.lucide.createIcons()
  }
}

async function abrirEdicion(tag) {
  const etiquetas = await listarEtiquetas()
  const padresMismaCategoria = etiquetas.filter(t => !t.padreId && t.tipo === tag.tipo && t.id !== tag.id)
  const padreActual = tag.padreId ? etiquetas.find(t => t.id === tag.padreId) : null
  const opcionesPadre = padresMismaCategoria.map(p => {
    const selected = p.id === tag.padreId ? 'selected' : ''
    return `<option value="${p.id}" ${selected}>${p.nombre}</option>`
  }).join('')
  const opcionPadreActual = tag.padreId && !padreActual
    ? `<option value="${tag.padreId}" selected>Etiqueta padre no disponible</option>`
    : ''
  const bloquePadre = tag.padreId ? `
      <div>
        <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Etiqueta padre</label>
        <select id="edit-tag-padre" required class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2.5 text-xs focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all">
          ${opcionPadreActual}
          ${opcionesPadre}
        </select>
      </div>
  ` : ''

  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in'
  overlay.id = `modal-editar-etiqueta-${tag.id}`

  const modal = document.createElement('div')
  modal.className = 'bg-white dark:bg-gray-800 rounded-3xl shadow-xl max-w-md w-full mx-4 p-6'

  modal.innerHTML = `
    <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Editar Etiqueta</h3>
    <form id="form-edit-tag" class="space-y-4">
      <div>
        <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Nombre</label>
        <input type="text" id="edit-tag-nombre" value="${tag.nombre}" required 
          class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2.5 text-xs focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all">
      </div>
      <div class="grid grid-cols-6 gap-4">
        <div class="col-span-1">
          <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Icono</label>
          <input type="text" id="edit-tag-icono" value="${tag.icono || ''}" placeholder="📝" maxlength="2"
            class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-2 text-center text-base focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all">
        </div>
        <div class="col-span-2">
          <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Color</label>
          <input type="color" id="edit-tag-color" value="${tag.color}" 
            class="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 p-1 bg-white dark:bg-gray-950 cursor-pointer">
        </div>
        <div class="col-span-3">
          <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">
            Tipo ${tag.padreId ? '<span class="text-[10px] font-normal text-gray-400 ml-1">(Heredado)</span>' : ''}
          </label>
          <select id="edit-tag-tipo" ${tag.padreId ? 'disabled' : ''} class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2.5 text-xs focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all ${tag.padreId ? 'opacity-60 cursor-not-allowed' : ''}">
            <option value="ingreso" ${tag.tipo === 'ingreso' ? 'selected' : ''}>Ingreso</option>
            <option value="gasto" ${tag.tipo === 'gasto' ? 'selected' : ''}>Gasto</option>
          </select>
        </div>
      </div>
      ${bloquePadre}
      <div class="flex gap-2.5 justify-end pt-2">
        <button type="button" id="btn-cancel-edit" 
          class="px-4 py-2.5 rounded-xl text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          Cancelar
        </button>
        <button type="submit" class="px-4 py-2.5 rounded-xl text-xs font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors shadow-sm">
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
  form.onsubmit = async (e) => {
    e.preventDefault()
    const nuevoNombre = document.getElementById('edit-tag-nombre').value
    const nuevoIcono = document.getElementById('edit-tag-icono').value
    const nuevoColor = document.getElementById('edit-tag-color').value
    const nuevoTipo = document.getElementById('edit-tag-tipo').value
    const nuevoPadre = document.getElementById('edit-tag-padre')?.value

    try {
      await actualizarEtiqueta(tag.id, {
        nombre: nuevoNombre,
        icono: nuevoIcono,
        color: nuevoColor,
        tipo: nuevoTipo,
        padreId: tag.padreId ? (nuevoPadre || null) : undefined
      })
      await renderTodas()
      cerrarModal()
    } catch (err) {
      alert(err.message)
    }
  }
}

function abrirHistorial(tag) {
  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in'
  overlay.id = `modal-historial-etiqueta-${tag.id}`

  const modal = document.createElement('div')
  modal.className = 'bg-white dark:bg-gray-800 rounded-3xl shadow-xl max-w-md w-full mx-4 flex flex-col max-h-[80vh]'

  let tableContent = ''
  let historial = [...(tag.historial || [])]
  if (historial.length === 0 && tag.creadaEn) {
    historial.push({ fecha: tag.creadaEn, tipo: 'creacion', mensaje: 'Etiqueta creada' })
  }
  historial.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))

  if (historial.length === 0) {
    tableContent = '<p class="text-xs text-gray-400 dark:text-gray-500 italic text-center py-10">Sin registros registrados en el historial.</p>'
  } else {
    tableContent = `
      <div class="overflow-y-auto px-5 pb-5 pt-2 space-y-4">
        ${historial.map(h => `
          <div class="border-l border-primary-500 pl-4.5 py-1 relative">
            <div class="absolute -left-[5.5px] top-2 w-2.5 h-2.5 rounded-full bg-primary-500 border-2 border-white dark:border-gray-800"></div>
            <div class="text-[9px] font-bold font-mono text-gray-400 uppercase mb-0.5">${new Date(h.fecha).toLocaleString()}</div>
            <div class="text-xs font-medium text-gray-700 dark:text-gray-200">${h.mensaje}</div>
          </div>
        `).join('')}
      </div>
    `
  }

  modal.innerHTML = `
    <div class="p-5 flex items-center justify-between border-b border-gray-100 dark:border-gray-800 mb-3">
      <h3 class="text-base font-bold text-gray-900 dark:text-gray-100">Historial: ${tag.nombre}</h3>
      <button id="btn-close-hist-x" class="text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors">
        <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M6 18L18 6M6 6l12 12"></path></svg>
      </button>
    </div>
    ${tableContent}
    <div class="p-5 border-t border-gray-100 dark:border-gray-800 flex justify-end">
      <button id="btn-close-hist" class="px-4 py-2.5 rounded-xl text-xs font-semibold bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors">
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

async function confirmarEliminacionEtiqueta(tag) {
  const numOperaciones = await contarOperacionesPorEtiqueta(tag.id)

  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in'
  overlay.id = `modal-eliminar-etiqueta-${tag.id}`

  const modal = document.createElement('div')
  modal.className = 'bg-white dark:bg-gray-800 rounded-3xl shadow-xl max-w-md w-full mx-4 p-6'

  // Construir HTML del modal
  let operacionesHTML = ''
  if (numOperaciones > 0) {
    operacionesHTML = `
      <div class="mt-4 p-4 rounded-2xl bg-amber-50 dark:bg-amber-950/20 border border-amber-200/60 dark:border-amber-900/40 text-left">
        <div class="flex items-start gap-2.5">
          <svg class="w-5 h-5 text-amber-600 dark:text-amber-400 flex-shrink-0 mt-0.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2"></path>
          </svg>
          <div>
            <p class="text-xs font-bold text-amber-800 dark:text-amber-300">Transacciones asociadas</p>
            <p class="text-[11px] text-amber-700 dark:text-amber-400 mt-0.5">Esta etiqueta tiene <span class="font-bold">${numOperaciones}</span> transacción(es) registradas.</p>
          </div>
        </div>
      </div>
      <div class="mt-4 p-4 rounded-2xl bg-gray-50/60 dark:bg-gray-900/30 border border-gray-200 dark:border-gray-800 text-left">
        <p class="text-xs font-bold text-gray-700 dark:text-gray-300 mb-3">¿Qué hacer con las transacciones?</p>
        <div class="space-y-2.5">
          <label class="flex items-start gap-3 cursor-pointer p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <input type="radio" name="eliminar-etiqueta-ops" value="conservar" checked class="mt-0.5 w-4 h-4 text-primary-600 border-gray-300 dark:border-gray-700 focus:ring-primary-500 bg-white dark:bg-gray-950">
            <div>
              <p class="text-xs font-bold text-gray-800 dark:text-gray-200">Conservar transacciones</p>
              <p class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-normal">Las transacciones quedarán sin etiqueta asignada</p>
            </div>
          </label>
          <label class="flex items-start gap-3 cursor-pointer p-2.5 rounded-xl hover:bg-gray-100 dark:hover:bg-gray-800 transition-colors">
            <input type="radio" name="eliminar-etiqueta-ops" value="eliminar" class="mt-0.5 w-4 h-4 text-rose-600 border-gray-300 dark:border-gray-700 focus:ring-rose-500 bg-white dark:bg-gray-950">
            <div>
              <p class="text-xs font-bold text-rose-600 dark:text-rose-400">Eliminar transacciones</p>
              <p class="text-[10px] text-gray-500 dark:text-gray-400 mt-0.5 leading-normal">Se borrarán permanentemente todas las transacciones con esta etiqueta</p>
            </div>
          </label>
        </div>
      </div>
    `
  }

  modal.innerHTML = `
    <div class="flex flex-col items-center text-center">
      <div class="w-12 h-12 rounded-full bg-rose-100 dark:bg-rose-950/40 flex items-center justify-center mb-4 text-rose-600 dark:text-rose-400">
        <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
        </svg>
      </div>
      <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">¿Eliminar etiqueta?</h3>
      <p class="text-xs text-gray-500 dark:text-gray-400 px-2 leading-relaxed">
        Esta acción eliminará "<span class="font-bold">${tag.nombre}</span>" permanentemente. No se puede deshacer.
      </p>
      ${operacionesHTML}
      <div class="flex flex-col w-full gap-2 mt-6">
        <button id="btn-confirm-delete" class="w-full px-4 py-2.5 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors shadow-sm">
          Eliminar permanentemente
        </button>
        <button id="btn-cancel-delete" class="w-full px-4 py-2.5 rounded-xl text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
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

  document.getElementById('btn-confirm-delete').addEventListener('click', async () => {
    // Verificar qué opción eligió el usuario
    const radioEliminar = modal.querySelector('input[name="eliminar-etiqueta-ops"][value="eliminar"]')
    const eliminarTransacciones = radioEliminar && radioEliminar.checked

    if (numOperaciones > 0) {
      if (eliminarTransacciones) {
        // Eliminar todas las transacciones con esta etiqueta
        await eliminarOperacionesPorEtiqueta(tag.id)
      } else {
        // Limpiar la referencia (las transacciones quedan sin etiqueta)
        await limpiarReferenciaEtiqueta(tag.id)
      }
    }

    await eliminarEtiqueta(tag.id)
    await renderTodas()
    cerrarModal()
  })
}

function abrirModalCreacion(tipoDefault = 'gasto', padreId = null, nombrePadre = null) {
  const overlay = document.createElement('div')
  overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in'
  overlay.id = 'modal-crear-etiqueta'

  const modal = document.createElement('div')
  modal.className = 'bg-white dark:bg-gray-800 rounded-3xl shadow-xl max-w-md w-full mx-4 p-6'

  const colorSugerido = tipoDefault === 'ingreso' ? '#22c55e' : '#ef4444'
  const titulo = padreId ? `Nueva Sub-etiqueta de "${nombrePadre}"` : 'Nueva Categoría'

  modal.innerHTML = `
    <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">${titulo}</h3>
    <form id="form-create-tag" class="space-y-4">
      <div>
        <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Nombre</label>
        <input type="text" id="create-tag-nombre" placeholder="Ej. Salario, Comida..." required 
          class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2.5 text-xs focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all">
      </div>
      <div class="grid grid-cols-6 gap-4">
        <div class="col-span-1">
           <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Icono</label>
           <input type="text" id="create-tag-icono" placeholder="📝" maxlength="2"
             class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-2 py-2 text-center text-base focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all">
        </div>
        <div class="col-span-2">
          <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Color</label>
          <input type="color" id="create-tag-color" value="${colorSugerido}" 
            class="w-full h-10 rounded-xl border border-gray-200 dark:border-gray-700 p-1.5 bg-white dark:bg-gray-950 cursor-pointer">
        </div>
        <div class="col-span-3">
          <label class="block text-xs font-semibold text-gray-500 dark:text-gray-400 mb-1.5">Tipo</label>
          <select id="create-tag-tipo" ${padreId ? 'disabled' : ''} class="w-full rounded-xl border border-gray-200 dark:border-gray-700 bg-white dark:bg-gray-950 px-3 py-2.5 text-xs focus:ring-2 focus:ring-primary-500/20 focus:border-primary-500 outline-none transition-all ${padreId ? 'opacity-60 cursor-not-allowed' : ''}">
            <option value="ingreso" ${tipoDefault === 'ingreso' ? 'selected' : ''}>Ingreso</option>
            <option value="gasto" ${tipoDefault === 'gasto' ? 'selected' : ''}>Gasto</option>
          </select>
        </div>
      </div>
      <div class="flex gap-2.5 justify-end pt-2">
        <button type="button" id="btn-cancel-create" 
          class="px-4 py-2.5 rounded-xl text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
          Cancelar
        </button>
        <button type="submit" class="px-4 py-2.5 rounded-xl text-xs font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors shadow-sm">
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
  form.onsubmit = async (e) => {
    e.preventDefault()
    const nombre = document.getElementById('create-tag-nombre').value
    const icono = document.getElementById('create-tag-icono').value
    const color = inputColor.value
    const tipo = selectTipo.value

    await crearEtiqueta({ nombre, color, tipo, icono, padreId })

    await renderTodas()
    cerrarModal()
  }
}

async function calcularUsoAlmacenamiento() {
  if (typeof localStorage === 'undefined') return 'N/D'

  try {
    // Simular exactamente el objeto que se descargará
    const snapshot = await construirSnapshotDatos()
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

async function construirSnapshotDatos() {
  const snapshot = {}
  const keys = Object.values(STORAGE_KEYS)
  for (const k of keys) {
    try {
      const raw = await leer(k)
      if (raw !== null) {
        snapshot[k] = raw
      }
    } catch {
      // ignorar claves corruptas
    }
  }
  return {
    version: 1,
    exportadoEn: new Date().toISOString(),
    datos: snapshot
  }
}

async function restaurarDesdeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.datos) {
    throw new Error('Archivo de respaldo inválido')
  }
  const datos = snapshot.datos
  const keys = Object.values(STORAGE_KEYS)
  for (const k of keys) {
    if (Object.prototype.hasOwnProperty.call(datos, k)) {
      await escribir(k, datos[k])
    } else {
      await eliminar(k)
    }
  }
}

async function inicializarPanelDatos() {
  const usageEl = document.getElementById('data-usage')
  const msgEl = document.getElementById('data-management-message')
  const btnExport = document.getElementById('btn-export-data')
  const inputImport = document.getElementById('input-import-data')
  const btnClear = document.getElementById('btn-clear-data')
  const dropOverlay = document.getElementById('drop-overlay')

  if (usageEl) {
    usageEl.textContent = await calcularUsoAlmacenamiento()
  }

  if (btnExport) {
    btnExport.addEventListener('click', async () => {
      try {
        const snapshot = await construirSnapshotDatos()
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

  const handleImportFile = (file) => {
    if (!file) return
    const reader = new FileReader()
    reader.onload = async (ev) => {
      try {
        const text = ev.target?.result
        
        if (file.name.toLowerCase().endsWith('.csv')) {
          // Lógica para CSV
          const cuentasExistentes = (await leer(STORAGE_KEYS.cuentas)) || []
          const etiquetasExistentes = (await leer(STORAGE_KEYS.etiquetas)) || []
          const operacionesExistentes = (await leer(STORAGE_KEYS.operaciones)) || []
          const metasExistentes = (await leer(STORAGE_KEYS.metas)) || []
          
          const resultado = await procesarCSVBudge(text, cuentasExistentes, etiquetasExistentes, operacionesExistentes, metasExistentes)
          
          const modalImport = document.getElementById('modal-importacion')
          const btnCombinar = document.getElementById('btn-import-combinar')
          const btnReemplazar = document.getElementById('btn-import-reemplazar')
          const btnCancelar = document.getElementById('btn-import-cancelar')
          
          document.getElementById('modal-importacion-mensaje').textContent = 
            `Se han procesado ${resultado.totalProcesadasCSV} filas de transacciones. Se detectaron ${resultado.analisisCuentas.length} cuentas y ${resultado.analisisEtiquetas.length} etiquetas en el archivo. ¿Cómo deseas importarlas?`
          
          modalImport.classList.remove('hidden')
          
          // Funciones locales para manejar clics
          const cerrarModalImport = () => {
            modalImport.classList.add('hidden')
            if (inputImport) inputImport.value = ''
          }
          
          btnCancelar.onclick = cerrarModalImport
          
          btnCombinar.onclick = () => {
            modalImport.classList.add('hidden')
            
            if (resultado.requiereMapeo) {
              const modalMapeo = document.getElementById('modal-mapeo-datos')
              const tbodyCuentas = document.getElementById('tbody-mapeo-cuentas')
              const tbodyEtiquetas = document.getElementById('tbody-mapeo-etiquetas')
              
              // Helper para crear options
              const generarOptions = (lista, seleccionado) => {
                let html = `<option value="NUEVA" ${seleccionado === 'NUEVA' ? 'selected' : ''}>-- CREAR NUEVA --</option>`
                lista.forEach(item => {
                  html += `<option value="${item.id}" ${seleccionado === item.id ? 'selected' : ''}>${item.nombre}</option>`
                })
                return html
              }

              // Llenar cuentas
              tbodyCuentas.innerHTML = resultado.analisisCuentas.map(c => `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td class="px-4 py-2 font-medium">${c.nombre}</td>
                  <td class="px-4 py-2">${c.saldo !== null ? '$' + c.saldo : '-'}</td>
                  <td class="px-4 py-2">
                    <select data-key="${c.keyNormalizada}" class="select-mapeo-cuenta w-full text-sm rounded-md border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 p-1">
                      ${generarOptions(cuentasExistentes, c.idSugerido)}
                    </select>
                  </td>
                </tr>
              `).join('')

              // Llenar etiquetas
              tbodyEtiquetas.innerHTML = resultado.analisisEtiquetas.map(e => `
                <tr class="hover:bg-gray-50 dark:hover:bg-gray-800/50">
                  <td class="px-4 py-2 font-medium">${e.nombre}</td>
                  <td class="px-4 py-2 text-xs opacity-70">${e.tipo}</td>
                  <td class="px-4 py-2">
                    <select data-key="${e.keyNormalizada}" class="select-mapeo-etiqueta w-full text-sm rounded-md border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-950 p-1">
                      ${generarOptions(etiquetasExistentes.filter(et => et.tipo === e.tipo), e.idSugerido)}
                    </select>
                  </td>
                </tr>
              `).join('')

              modalMapeo.classList.remove('hidden')

              document.getElementById('btn-mapeo-cancelar').onclick = () => {
                modalMapeo.classList.add('hidden')
                if (inputImport) inputImport.value = ''
              }

              document.getElementById('btn-mapeo-confirmar').onclick = async () => {
                // Recopilar mapeos
                const mapeoCuentas = {}
                document.querySelectorAll('.select-mapeo-cuenta').forEach(sel => mapeoCuentas[sel.dataset.key] = sel.value)
                
                const mapeoEtiquetas = {}
                document.querySelectorAll('.select-mapeo-etiqueta').forEach(sel => mapeoEtiquetas[sel.dataset.key] = sel.value)

                modalMapeo.classList.add('hidden')
                
                // Ejecutar fase 2
                const resFinal = await procesarCSVBudge(text, cuentasExistentes, etiquetasExistentes, operacionesExistentes, metasExistentes, mapeoCuentas, mapeoEtiquetas)
                
                // Guardar
                await escribir(STORAGE_KEYS.cuentas, resFinal.cuentasFinales)
                await escribir(STORAGE_KEYS.etiquetas, resFinal.etiquetasFinales)
                await escribir(STORAGE_KEYS.operaciones, [...operacionesExistentes, ...resFinal.nuevasOperaciones])
                await escribir(STORAGE_KEYS.metas, [...metasExistentes, ...resFinal.nuevasMetas])
                
                if (msgEl) msgEl.textContent = 'Datos combinados correctamente. Recarga la página para ver los cambios.'
                if (usageEl) usageEl.textContent = await calcularUsoAlmacenamiento()
              }
            }
          }
          
          btnReemplazar.onclick = async () => {
            modalImport.classList.add('hidden')
            // Borrar todo
            const keys = Object.values(STORAGE_KEYS)
            for (const k of keys) await eliminar(k)
            
            // Re-procesar en limpio forzando Fase 2 (pasando {} en lugar de null)
            const resultadoLimpio = await procesarCSVBudge(text, [], [], [], [], {}, {})
            
            await escribir(STORAGE_KEYS.cuentas, resultadoLimpio.cuentasFinales)
            await escribir(STORAGE_KEYS.etiquetas, resultadoLimpio.nuevasEtiquetas)
            await escribir(STORAGE_KEYS.operaciones, resultadoLimpio.nuevasOperaciones)
            await escribir(STORAGE_KEYS.metas, resultadoLimpio.nuevasMetas)
            
            if (msgEl) msgEl.textContent = 'Datos reemplazados correctamente. Recarga la página para ver los cambios.'
            if (usageEl) usageEl.textContent = await calcularUsoAlmacenamiento()
          }
          
        } else {
          // Lógica para JSON normal
          const data = JSON.parse(text)
          await restaurarDesdeSnapshot(data)
          if (msgEl) {
            msgEl.textContent = 'Datos restaurados correctamente. Recarga la página para ver los cambios.'
          }
          if (usageEl) {
            usageEl.textContent = await calcularUsoAlmacenamiento()
          }
          if (inputImport) inputImport.value = ''
        }
      } catch (err) {
        if (msgEl) {
          msgEl.textContent = 'Error al importar respaldo: ' + (err.message || String(err))
        }
        if (inputImport) inputImport.value = ''
      }
    }
    reader.readAsText(file)
  }

  if (inputImport) {
    inputImport.addEventListener('change', () => {
      const file = inputImport.files && inputImport.files[0]
      handleImportFile(file)
    })
  }

  if (dropOverlay) {
    let dragDepth = 0
    const showOverlay = () => dropOverlay.classList.remove('hidden')
    const hideOverlay = () => dropOverlay.classList.add('hidden')

    const onDragEnter = (e) => {
      e.preventDefault()
      dragDepth += 1
      showOverlay()
    }
    const onDragOver = (e) => {
      e.preventDefault()
    }
    const onDragLeave = (e) => {
      e.preventDefault()
      dragDepth -= 1
      if (dragDepth <= 0) {
        dragDepth = 0
        hideOverlay()
      }
    }
    const onDrop = (e) => {
      e.preventDefault()
      dragDepth = 0
      hideOverlay()
      const file = e.dataTransfer && e.dataTransfer.files && e.dataTransfer.files[0]
      handleImportFile(file)
    }

    window.addEventListener('dragenter', onDragEnter)
    window.addEventListener('dragover', onDragOver)
    window.addEventListener('dragleave', onDragLeave)
    window.addEventListener('drop', onDrop)
  }

  if (btnClear) {
    btnClear.addEventListener('click', () => {
      // Crear modal de confirmación
      const overlay = document.createElement('div')
      overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in'
      overlay.id = 'modal-borrar-datos'

      const modal = document.createElement('div')
      modal.className = 'bg-white dark:bg-gray-800 rounded-3xl shadow-xl max-w-md w-full mx-4 p-6'

      modal.innerHTML = `
        <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-4">Borrar todos los datos</h3>
        <p class="text-xs text-gray-500 dark:text-gray-400 mb-5 leading-relaxed">
          Esta acción borrará todos tus datos de cuentas, etiquetas, operaciones, metas y presupuestos.
        </p>
        <div class="space-y-3 mb-6">
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" id="chk-borrar-local" checked disabled class="w-4 h-4 rounded border-gray-300 dark:border-gray-700 bg-gray-100 dark:bg-gray-900 text-primary-600 focus:ring-primary-500">
            <span class="text-xs font-semibold text-gray-700 dark:text-gray-300">Borrar datos locales (navegador)</span>
          </label>
          <label class="flex items-center gap-3 cursor-pointer">
            <input type="checkbox" id="chk-borrar-nube" class="w-4 h-4 rounded border-gray-300 dark:border-gray-700 text-rose-600 focus:ring-rose-500 bg-white dark:bg-gray-950">
            <span class="text-xs text-rose-600 dark:text-rose-400 font-semibold">También borrar datos en la nube</span>
          </label>
          <p id="warning-nube" class="hidden text-[10px] text-rose-500 dark:text-rose-400 ml-7 leading-normal">⚠️ Los datos en la nube se perderán permanentemente.</p>
        </div>
        <div class="flex gap-2.5 justify-end">
          <button id="btn-cancelar-borrado" class="px-4 py-2.5 rounded-xl text-xs font-semibold border border-gray-200 dark:border-gray-700 text-gray-700 dark:text-gray-200 hover:bg-gray-50 dark:hover:bg-gray-700 transition-colors">
            Cancelar
          </button>
          <button id="btn-confirmar-borrado" class="px-4 py-2.5 rounded-xl text-xs font-semibold bg-rose-600 text-white hover:bg-rose-700 transition-colors shadow-sm">
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
          for (const k of keys) {
            await eliminar(k)
          }

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
            usageEl.textContent = await calcularUsoAlmacenamiento()
          }
          await renderTodas()
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
        const snapshot = await construirSnapshotDatos()
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
  const authMsgEl = document.getElementById('auth-message')
  const syncMsgEl = document.getElementById('sync-message')

  const formLogin = document.getElementById('form-login')
  const btnLogout = document.getElementById('btn-logout')
  const btnBackup = document.getElementById('btn-backup-cloud')
  const btnRestore = document.getElementById('btn-restore-cloud')

  function showMessage(el, msg, isError = false) {
    if (!el) return
    el.textContent = msg
    el.className = `text-sm text-center ${isError ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}`
  }

  async function updateAuthUI() {
    const autenticado = estaAutenticadoEnNube()
    if (autenticado) {
      if (guestEl) guestEl.classList.add('hidden')
      if (userEl) userEl.classList.remove('hidden')
    } else {
      if (guestEl) guestEl.classList.remove('hidden')
      if (userEl) userEl.classList.add('hidden')
    }
  }

  // Inicializar UI
  await updateAuthUI()

  // Guardar Password (Login simulado)
  if (formLogin) {
    formLogin.addEventListener('submit', async (e) => {
      e.preventDefault()
      const inputPwd = document.getElementById('input-cloud-password')
      if (!inputPwd) return

      const password = inputPwd.value
      guardarPasswordNube(password)
      
      showMessage(authMsgEl, 'Contraseña de Nube guardada por 15 días.', false)
      formLogin.reset()
      await updateAuthUI()
    })
  }

  // Revocar acceso (Logout)
  if (btnLogout) {
    btnLogout.addEventListener('click', async () => {
      cerrarSesionNube()
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
        showMessage(syncMsgEl, `✓ Respaldo subido: ${result.stats.cuentas} cuentas, ${result.stats.etiquetas} etiquetas, ${result.stats.operaciones} operaciones, ${result.stats.separadores} categorías.`, false)
      } else if (result.conflicto) {
        // Mostrar modal de conflicto
        const overlay = document.createElement('div')
        overlay.className = 'fixed inset-0 bg-black/60 backdrop-blur-sm flex items-center justify-center z-[60] animate-fade-in'
        overlay.id = 'modal-conflicto-sync'

        const modal = document.createElement('div')
        modal.className = 'bg-white dark:bg-gray-800 rounded-3xl shadow-xl max-w-md w-full mx-4 p-6'

        modal.innerHTML = `
          <div class="flex flex-col items-center text-center">
            <div class="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-950/40 flex items-center justify-center mb-4 text-amber-600 dark:text-amber-400">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"></path>
              </svg>
            </div>
            <h3 class="text-lg font-bold text-gray-900 dark:text-gray-100 mb-2">Conflicto de Sincronización</h3>
            <p class="text-xs text-gray-500 dark:text-gray-400 mb-4 px-2 leading-relaxed">
              ${result.error}
            </p>
            <p class="text-[10px] text-gray-500 dark:text-gray-500 mb-6 font-semibold">
              ${result.conflicto.accionRecomendada}
            </p>
            <div class="flex flex-col w-full gap-2">
              <button id="btn-descargar-primero" class="w-full px-4 py-2.5 rounded-xl text-xs font-semibold bg-primary-600 text-white hover:bg-primary-700 transition-colors shadow-sm">
                Descargar datos de la nube primero
              </button>
              <button id="btn-forzar-subida" class="w-full px-4 py-2.5 rounded-xl text-xs font-semibold border border-rose-200 dark:border-rose-900 text-rose-600 dark:text-rose-400 hover:bg-rose-50 dark:hover:bg-rose-950/20 transition-colors">
                Forzar subida (sobrescribir nube)
              </button>
              <button id="btn-cancelar-sync" class="w-full px-4 py-2.5 rounded-xl text-xs font-semibold text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors">
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
            await renderTodas()
            const usageEl = document.getElementById('data-usage')
            if (usageEl) usageEl.textContent = await calcularUsoAlmacenamiento()
          } else {
            showMessage(syncMsgEl, downloadResult.error, true)
          }
        })

        document.getElementById('btn-forzar-subida').addEventListener('click', async () => {
          cerrarModal()
          showMessage(syncMsgEl, 'Forzando subida...', false)
          const forceResult = await respaldarDatos({ forzar: true })
          if (forceResult.success) {
            showMessage(syncMsgEl, `✓ Respaldo forzado: ${forceResult.stats.cuentas} cuentas, ${forceResult.stats.etiquetas} etiquetas, ${forceResult.stats.operaciones} operaciones, ${forceResult.stats.separadores} categorías.`, false)
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
        showMessage(syncMsgEl, `✓ Restaurado: ${result.stats.cuentas} cuentas, ${result.stats.etiquetas} etiquetas, ${result.stats.operaciones} operaciones, ${result.stats.separadores} categorías. Recarga la página.`, false)
        await renderTodas()
        const usageEl = document.getElementById('data-usage')
        if (usageEl) usageEl.textContent = await calcularUsoAlmacenamiento()
      } else {
        showMessage(syncMsgEl, result.error, true)
      }
    })
  }
}

async function init() {
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

  await renderTodas()
  await inicializarPanelDatos()
  await inicializarAuth()

  // Toggle de fondos dinámicos (cookie)
  const toggleFondos = document.getElementById('toggle-fondos-dinamicos')
  if (toggleFondos) {
    // Leer cookie
    const cookieMatch = document.cookie.match(/(?:^|; )gtr_fondos_dinamicos=([^;]*)/)
    const valorActual = cookieMatch ? cookieMatch[1] === 'true' : true // Activado por defecto
    toggleFondos.checked = valorActual

    toggleFondos.addEventListener('change', () => {
      const expires = new Date(Date.now() + 10 * 365 * 24 * 60 * 60 * 1000).toUTCString()
      document.cookie = `gtr_fondos_dinamicos=${toggleFondos.checked}; expires=${expires}; path=/; SameSite=Lax`
    })
  }
}

document.addEventListener('DOMContentLoaded', init)

import { STORAGE_KEYS } from '../sistema/constantes.js'
import { leer, escribir } from './almacenamiento.js'

function uid() {
  return 'tag_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function obtenerTodas() {
  const data = leer(STORAGE_KEYS.etiquetas, [])
  return Array.isArray(data) ? data : []
}

function guardarTodas(list) {
  return escribir(STORAGE_KEYS.etiquetas, list)
}

export function listarEtiquetas() {
  return obtenerTodas()
}

export function crearEtiqueta(payload) {
  const now = new Date().toISOString()
  const etiqueta = {
    id: uid(),
    nombre: String(payload?.nombre || '').trim(),
    color: String(payload?.color || '#64748b'),
    tipo: String(payload?.tipo || 'gasto'), // 'gasto' | 'ingreso'
    icono: String(payload?.icono || ''), // Emoji
    padreId: payload?.padreId || null, // ID de la etiqueta padre opcional
    creadaEn: now,
    actualizadaEn: now,
    historial: [
      {
        fecha: now,
        tipo: 'creacion',
        mensaje: 'Etiqueta creada'
      }
    ]
  }
  const list = obtenerTodas()
  list.push(etiqueta)
  guardarTodas(list)
  return etiqueta
}

export function actualizarEtiqueta(id, payload) {
  const list = obtenerTodas()
  const idx = list.findIndex((c) => c.id === id)
  if (idx === -1) return null
  const prev = list[idx]

  const cambios = []
  const nuevoNombre = payload?.nombre !== undefined ? String(payload.nombre).trim() : prev.nombre
  if (nuevoNombre !== prev.nombre) cambios.push(`Nombre cambiado de "${prev.nombre}" a "${nuevoNombre}"`)

  const nuevoColor = payload?.color !== undefined ? String(payload.color) : prev.color
  if (nuevoColor !== prev.color) cambios.push(`Color cambiado`)

  const nuevoIcono = payload?.icono !== undefined ? String(payload.icono) : (prev.icono || '')
  if (nuevoIcono !== (prev.icono || '')) cambios.push(`Icono cambiado a ${nuevoIcono}`)

  // El tipo generalmente no se cambia, pero por si acaso
  const nuevoTipo = payload?.tipo !== undefined ? String(payload.tipo) : prev.tipo
  let tipoCambiado = false

  if (nuevoTipo !== prev.tipo) {
    // Validación: Verificar duplicados en el destino
    const etiquetasDestino = list.filter(t => t.tipo === nuevoTipo && t.id !== id)

    // 1. Verificar si el padre choca
    const nombreChoca = etiquetasDestino.some(t => t.nombre.toLowerCase() === nuevoNombre.toLowerCase())
    if (nombreChoca) {
      throw new Error(`Ya existe una etiqueta llamada "${nuevoNombre}" en ${nuevoTipo}. No se puede cambiar el tipo.`)
    }

    // 2. Verificar si algún hijo choca
    const hijos = list.filter(h => h.padreId === id)
    for (const hijo of hijos) {
      const hijoChoca = etiquetasDestino.some(t => t.nombre.toLowerCase() === hijo.nombre.toLowerCase())
      if (hijoChoca) {
        throw new Error(`La sub-etiqueta "${hijo.nombre}" ya existe en ${nuevoTipo}. No se puede mover el grupo.`)
      }
    }

    cambios.push(`Tipo cambiado de "${prev.tipo}" a "${nuevoTipo}" (con ${hijos.length} sub-etiquetas)`)
    tipoCambiado = true
  }

  // Cambio de padre (mover etiqueta)
  const nuevoPadreId = payload?.padreId !== undefined ? payload.padreId : (prev.padreId || null)

  // VALIDACIÓN: Prevenir referencias circulares
  if (nuevoPadreId && nuevoPadreId !== (prev.padreId || null)) {
    // No puede ser padre de sí misma
    if (nuevoPadreId === id) {
      throw new Error('Una etiqueta no puede ser su propio padre')
    }

    // Verificar que el nuevo padre no sea un descendiente (causaría ciclo)
    // Recorrer los ancestros del nuevo padre para ver si incluye la etiqueta actual
    const visitados = new Set()
    let ancestro = list.find(e => e.id === nuevoPadreId)
    while (ancestro && ancestro.padreId) {
      if (visitados.has(ancestro.id)) break // Protección extra contra ciclos existentes
      if (ancestro.padreId === id) {
        throw new Error('No se puede mover: crearía una referencia circular (el nuevo padre es descendiente de esta etiqueta)')
      }
      visitados.add(ancestro.id)
      ancestro = list.find(e => e.id === ancestro.padreId)
    }
  }

  if (nuevoPadreId !== (prev.padreId || null)) cambios.push(`Movida a nueva etiqueta padre`)

  const now = new Date().toISOString()
  const historial = Array.isArray(prev.historial) ? [...prev.historial] : []

  if (cambios.length > 0) {
    historial.push({
      fecha: now,
      tipo: 'modificacion',
      mensaje: cambios.join('. ')
    })
  }

  const next = {
    ...prev,
    nombre: nuevoNombre,
    color: nuevoColor,
    tipo: nuevoTipo,
    icono: nuevoIcono,
    padreId: nuevoPadreId,
    actualizadaEn: now,
    historial: historial
  }
  list[idx] = next

  // Propagar cambio a hijos si hubo cambio de tipo
  if (tipoCambiado) {
    const hijos = list.filter(h => h.padreId === id)
    hijos.forEach(hijo => {
      hijo.tipo = nuevoTipo
      hijo.actualizadaEn = now
      hijo.historial.push({
        fecha: now,
        tipo: 'sistema',
        mensaje: `Tipo heredado del padre: cambiado a "${nuevoTipo}"`
      })
    })
  }

  guardarTodas(list)
  return next
}

export function eliminarEtiqueta(id) {
  const list = obtenerTodas()
  const next = list.filter((c) => c.id !== id)
  const changed = next.length !== list.length
  if (changed) guardarTodas(next)
  return changed
}

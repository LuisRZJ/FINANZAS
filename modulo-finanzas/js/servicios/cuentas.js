import { STORAGE_KEYS } from '../sistema/constantes.js'
import { leer, escribir } from './almacenamiento.js'
function uid() {
  return 'cta_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}
function obtenerTodas() {
  const data = leer(STORAGE_KEYS.cuentas, [])
  return Array.isArray(data) ? data : []
}
function guardarTodas(list) {
  return escribir(STORAGE_KEYS.cuentas, list)
}
export function listarCuentas() {
  return obtenerTodas()
}
export function crearCuenta(payload) {
  const now = new Date().toISOString()
  const cuenta = {
    id: uid(),
    nombre: String(payload?.nombre || '').trim(),
    descripcion: String(payload?.descripcion || '').trim(),
    color: String(payload?.color || '#0ea5e9'),
    dinero: Number.isFinite(payload?.dinero) ? Number(payload.dinero) : 0,
    parentId: payload?.parentId || null,
    esSubcuenta: Boolean(payload?.esSubcuenta),
    creadaEn: now,
    actualizadaEn: now,
    historial: [
      {
        fecha: now,
        tipo: 'creacion',
        mensaje: payload?.esSubcuenta ? 'Subcuenta creada' : 'Cuenta creada'
      }
    ]
  }
  const list = obtenerTodas()
  list.push(cuenta)
  guardarTodas(list)
  return cuenta
}

export function actualizarCuenta(id, payload) {
  const list = obtenerTodas()
  const idx = list.findIndex((c) => c.id === id)
  if (idx === -1) return null
  const prev = list[idx]

  const cambios = []
  const nuevoNombre = payload?.nombre !== undefined ? String(payload.nombre).trim() : prev.nombre
  if (nuevoNombre !== prev.nombre) cambios.push(`Nombre cambiado de "${prev.nombre}" a "${nuevoNombre}"`)

  const nuevaDesc = payload?.descripcion !== undefined ? String(payload.descripcion).trim() : prev.descripcion
  if (nuevaDesc !== prev.descripcion) cambios.push(`Descripción actualizada`)

  const nuevoColor = payload?.color !== undefined ? String(payload.color) : prev.color
  if (nuevoColor !== prev.color) cambios.push(`Color cambiado`)

  const nuevoDinero = payload?.dinero !== undefined ? Number(payload.dinero) : prev.dinero
  if (nuevoDinero !== prev.dinero) cambios.push(`Saldo ajustado de ${prev.dinero} a ${nuevoDinero}`)

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
    descripcion: nuevaDesc,
    color: nuevoColor,
    dinero: nuevoDinero,
    actualizadaEn: now,
    historial: historial
  }
  list[idx] = next
  guardarTodas(list)
  return next
}

/**
 * Actualiza los saldos de múltiples cuentas en una sola operación de escritura.
 * Optimizado para rendimiento cuando se procesan lotes de operaciones.
 * @param {Array<{id: string, delta: number}>} actualizaciones - Lista de cambios de saldo
 */
export function actualizarMultiplesSaldos(actualizaciones) {
  const list = obtenerTodas()
  const now = new Date().toISOString()
  let changed = false
  const mapCuentas = new Map(list.map((c, i) => [c.id, i]))

  actualizaciones.forEach(({ id, delta }) => {
    const idx = mapCuentas.get(id)
    if (idx !== undefined) {
      const prev = list[idx]
      const nuevoDinero = Number(prev.dinero || 0) + Number(delta)

      const historial = Array.isArray(prev.historial) ? [...prev.historial] : []
      historial.push({
        fecha: now,
        tipo: 'sistema', // 'sistema' para indicar actualización automática
        mensaje: `Saldo ajustado en lote (${delta > 0 ? '+' : ''}${delta})`
      })

      list[idx] = {
        ...prev,
        dinero: nuevoDinero,
        actualizadaEn: now,
        historial
      }
      changed = true
    }
  })

  if (changed) {
    guardarTodas(list)
  }
}

export function obtenerSubcuentas(parentId) {
  const list = obtenerTodas()
  return list.filter((c) => c.parentId === parentId)
}

export function obtenerCuentaPadre(cuenta) {
  if (!cuenta?.parentId) return null
  const list = obtenerTodas()
  return list.find((c) => c.id === cuenta.parentId) || null
}

export function obtenerCuentaPorId(id) {
  const list = obtenerTodas()
  return list.find((c) => c.id === id) || null
}

/**
 * Obtiene los IDs de todas las cuentas que se eliminarían (cuenta + subcuentas)
 */
export function obtenerIdsParaEliminar(id) {
  const list = obtenerTodas()
  const idsToDelete = new Set([id])
  list.forEach((c) => {
    if (c.parentId === id) idsToDelete.add(c.id)
  })
  return Array.from(idsToDelete)
}

/**
 * Elimina una cuenta y sus subcuentas
 * @returns {{deleted: boolean, deletedIds: string[]}}
 */
export function eliminarCuenta(id) {
  const list = obtenerTodas()
  const deletedIds = obtenerIdsParaEliminar(id)
  const next = list.filter((c) => !deletedIds.includes(c.id))
  const changed = next.length !== list.length
  if (changed) guardarTodas(next)
  return { deleted: changed, deletedIds }
}

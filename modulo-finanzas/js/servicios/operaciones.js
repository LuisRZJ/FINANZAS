import { STORAGE_KEYS } from '../sistema/constantes.js'
import { leer, escribir } from './almacenamiento.js'
import { listarCuentas, actualizarCuenta, actualizarMultiplesSaldos } from './cuentas.js'

function uid() {
  return 'op_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function obtenerTodas() {
  const data = leer(STORAGE_KEYS.operaciones, [])
  return Array.isArray(data) ? data : []
}

function guardarTodas(list) {
  return escribir(STORAGE_KEYS.operaciones, list)
}

export function listarOperaciones() {
  return obtenerTodas()
}

// Determina el estado basándose en la fecha
function determinarEstado(fechaStr) {
  const ahora = new Date()
  // fechaStr puede ser YYYY-MM-DD o YYYY-MM-DDTHH:MM
  const fechaOp = new Date(fechaStr.includes('T') ? fechaStr : fechaStr + 'T23:59:59')
  return fechaOp > ahora ? 'pendiente' : 'pagado'
}

// Valida que la fecha no sea anterior a la creación de las cuentas involucradas
function validarFechaCuentas(fechaStr, cuentaIds) {
  const cuentas = listarCuentas()
  const involucradas = cuentas.filter(c => cuentaIds.includes(c.id))
  if (involucradas.length !== cuentaIds.length) return { ok: false, error: 'Cuenta(s) no encontrada(s)' }

  // Extraer solo la parte de la fecha (YYYY-MM-DD)
  const dateOnly = fechaStr.split('T')[0]
  const d = new Date(dateOnly + 'T00:00:00')

  const minDate = new Date(Math.max(...involucradas.map(c => new Date(c.creadaEn).getTime())))
  minDate.setHours(0, 0, 0, 0)
  if (d < minDate) return { ok: false, error: 'La fecha no puede ser anterior a la creación de la(s) cuenta(s)' }
  return { ok: true }
}

function revertirEfecto(op) {
  const cuentas = listarCuentas()
  if (op.tipo === 'ingreso') {
    const c = cuentas.find(x => x.id === op.cuentaId)
    if (c) actualizarCuenta(c.id, { dinero: Number(c.dinero) - Number(op.cantidad) })
  } else if (op.tipo === 'gasto') {
    const c = cuentas.find(x => x.id === op.cuentaId)
    if (c) actualizarCuenta(c.id, { dinero: Number(c.dinero) + Number(op.cantidad) })
  } else if (op.tipo === 'transferencia') {
    const org = cuentas.find(x => x.id === op.origenId)
    const dest = cuentas.find(x => x.id === op.destinoId)
    if (org) actualizarCuenta(org.id, { dinero: Number(org.dinero) + Number(op.cantidad) })
    if (dest) actualizarCuenta(dest.id, { dinero: Number(dest.dinero) - Number(op.cantidad) })
  }
}

function aplicarEfecto(op) {
  const cuentas = listarCuentas()
  if (op.tipo === 'ingreso') {
    const c = cuentas.find(x => x.id === op.cuentaId)
    if (c) actualizarCuenta(c.id, { dinero: Number(c.dinero) + Number(op.cantidad) })
  } else if (op.tipo === 'gasto') {
    const c = cuentas.find(x => x.id === op.cuentaId)
    if (c) actualizarCuenta(c.id, { dinero: Number(c.dinero) - Number(op.cantidad) })
  } else if (op.tipo === 'transferencia') {
    const org = cuentas.find(x => x.id === op.origenId)
    const dest = cuentas.find(x => x.id === op.destinoId)
    if (org) actualizarCuenta(org.id, { dinero: Number(org.dinero) - Number(op.cantidad) })
    if (dest) actualizarCuenta(dest.id, { dinero: Number(dest.dinero) + Number(op.cantidad) })
  }
}

// === NUEVA FUNCIÓN: Ejecutar operaciones pendientes cuya fecha ya pasó ===
// OPTIMIZADO: Procesa los cambios en batch para evitar múltiples escrituras en disco
export function ejecutarPendientes() {
  const ahora = new Date()
  const list = obtenerTodas()
  let huboCambios = false
  const actualizacionesSaldos = []

  list.forEach(op => {
    if (op.estado === 'pendiente') {
      const fechaOp = new Date(op.fecha.includes('T') ? op.fecha : op.fecha + 'T23:59:59')
      if (fechaOp <= ahora) {
        // En lugar de aplicarEfecto individualmente, acumulamos los cambios
        const cantidad = Number(op.cantidad || 0)

        if (op.tipo === 'ingreso') {
          actualizacionesSaldos.push({ id: op.cuentaId, delta: cantidad })
        } else if (op.tipo === 'gasto') {
          actualizacionesSaldos.push({ id: op.cuentaId, delta: -cantidad })
        } else if (op.tipo === 'transferencia') {
          actualizacionesSaldos.push({ id: op.origenId, delta: -cantidad })
          actualizacionesSaldos.push({ id: op.destinoId, delta: cantidad })
        }

        op.estado = 'pagado'
        huboCambios = true
      }
    }
  })

  if (huboCambios) {
    // 1. Guardar todas las operaciones actualizadas (cambio de estado)
    guardarTodas(list)

    // 2. Aplicar todos los cambios de saldo en una sola escritura
    if (actualizacionesSaldos.length > 0) {
      actualizarMultiplesSaldos(actualizacionesSaldos)
    }
  }

  return huboCambios
}

// === CREACIÓN DE OPERACIONES ===

export function crearIngreso(payload) {
  const nombre = String(payload?.nombre || '').trim()
  const descripcion = String(payload?.descripcion || '').trim()
  const etiquetaId = String(payload?.etiquetaId || '').trim()
  const cantidad = Number(payload?.cantidad || 0)
  const fecha = String(payload?.fecha || '').trim()
  const cuentaId = String(payload?.cuentaId || '').trim()

  if (!nombre || !fecha || !cuentaId || !(cantidad > 0)) throw new Error('Datos de ingreso inválidos')

  const v = validarFechaCuentas(fecha, [cuentaId])
  if (!v.ok) throw new Error(v.error)

  const cuentas = listarCuentas()
  const cuenta = cuentas.find(c => c.id === cuentaId)
  if (!cuenta) throw new Error('Cuenta no encontrada')

  const estado = determinarEstado(fecha)

  // Solo aplicar efecto si está pagado
  if (estado === 'pagado') {
    const nuevoSaldo = Number(cuenta.dinero || 0) + cantidad
    actualizarCuenta(cuentaId, { dinero: nuevoSaldo })
  }

  const now = new Date().toISOString()
  const op = {
    id: uid(),
    tipo: 'ingreso',
    nombre,
    descripcion,
    etiquetaId,
    cantidad,
    fecha,
    cuentaId,
    estado,
    recurrenciaId: payload?.recurrenciaId || null,
    cicloNumero: payload?.cicloNumero || null,
    creadaEn: now
  }

  const list = obtenerTodas()
  list.push(op)
  guardarTodas(list)
  return op
}

export function crearGasto(payload) {
  const nombre = String(payload?.nombre || '').trim()
  const descripcion = String(payload?.descripcion || '').trim()
  const etiquetaId = String(payload?.etiquetaId || '').trim()
  const cantidad = Number(payload?.cantidad || 0)
  const fecha = String(payload?.fecha || '').trim()
  const cuentaId = String(payload?.cuentaId || '').trim()

  if (!nombre || !fecha || !cuentaId || !(cantidad > 0)) throw new Error('Datos de gasto inválidos')

  const v = validarFechaCuentas(fecha, [cuentaId])
  if (!v.ok) throw new Error(v.error)

  const cuentas = listarCuentas()
  const cuenta = cuentas.find(c => c.id === cuentaId)
  if (!cuenta) throw new Error('Cuenta no encontrada')

  const estado = determinarEstado(fecha)

  // Solo aplicar efecto si está pagado
  if (estado === 'pagado') {
    const nuevoSaldo = Number(cuenta.dinero || 0) - cantidad
    actualizarCuenta(cuentaId, { dinero: nuevoSaldo })
  }

  const now = new Date().toISOString()
  const op = {
    id: uid(),
    tipo: 'gasto',
    nombre,
    descripcion,
    etiquetaId,
    cantidad,
    fecha,
    cuentaId,
    estado,
    recurrenciaId: payload?.recurrenciaId || null,
    cicloNumero: payload?.cicloNumero || null,
    creadaEn: now
  }

  const list = obtenerTodas()
  list.push(op)
  guardarTodas(list)
  return op
}

export function crearTransferencia(payload) {
  const nombre = String(payload?.nombre || '').trim()
  const descripcion = String(payload?.descripcion || '').trim()
  const cantidad = Number(payload?.cantidad || 0)
  const fecha = String(payload?.fecha || '').trim()
  const origenId = String(payload?.origenId || '').trim()
  const destinoId = String(payload?.destinoId || '').trim()

  if (!nombre || !fecha || !origenId || !destinoId || !(cantidad > 0)) throw new Error('Datos de transferencia inválidos')
  if (origenId === destinoId) throw new Error('Las cuentas de origen y destino deben ser distintas')

  const v = validarFechaCuentas(fecha, [origenId, destinoId])
  if (!v.ok) throw new Error(v.error)

  const cuentas = listarCuentas()
  const origen = cuentas.find(c => c.id === origenId)
  const destino = cuentas.find(c => c.id === destinoId)
  if (!origen || !destino) throw new Error('Cuenta(s) no encontrada(s)')

  const estado = determinarEstado(fecha)

  // Solo aplicar efecto si está pagado
  if (estado === 'pagado') {
    const nuevoOrigen = Number(origen.dinero || 0) - cantidad
    const nuevoDestino = Number(destino.dinero || 0) + cantidad
    actualizarCuenta(origenId, { dinero: nuevoOrigen })
    actualizarCuenta(destinoId, { dinero: nuevoDestino })
  }

  const now = new Date().toISOString()
  const op = {
    id: uid(),
    tipo: 'transferencia',
    nombre,
    descripcion,
    cantidad,
    fecha,
    origenId,
    destinoId,
    estado,
    recurrenciaId: payload?.recurrenciaId || null,
    cicloNumero: payload?.cicloNumero || null,
    creadaEn: now
  }

  const list = obtenerTodas()
  list.push(op)
  guardarTodas(list)
  return op
}

// === ELIMINACIÓN ===

export function eliminarOperacion(id) {
  const list = obtenerTodas()
  const op = list.find(o => o.id === id)
  if (!op) return false

  // Solo revertir efecto si estaba pagado
  if (op.estado === 'pagado') {
    revertirEfecto(op)
  }

  const next = list.filter(o => o.id !== id)
  guardarTodas(next)
  return true
}

// === ACTUALIZACIÓN ===

export function actualizarOperacion(id, payload) {
  const list = obtenerTodas()
  const idx = list.findIndex(o => o.id === id)
  if (idx === -1) throw new Error('Operación no encontrada')
  const prev = list[idx]

  // 1. Validar nuevos datos
  const nuevoTipo = payload.tipo || prev.tipo
  const cantidad = Number(payload.cantidad !== undefined ? payload.cantidad : prev.cantidad)
  const fecha = String(payload.fecha !== undefined ? payload.fecha : prev.fecha).trim()
  const nombre = String(payload.nombre !== undefined ? payload.nombre : prev.nombre).trim()

  if (!(cantidad > 0)) throw new Error('La cantidad debe ser positiva')
  if (!nombre) throw new Error('El nombre es requerido')

  // Calcular nuevo estado basado en la nueva fecha
  const nuevoEstado = determinarEstado(fecha)

  // Preparar objeto actualizado
  const now = new Date().toISOString()
  let next = {
    ...prev,
    ...payload,
    id: prev.id,
    creadaEn: prev.creadaEn,
    estado: nuevoEstado,
    actualizadaEn: now // Campo clave para sincronización
  }

  if (nuevoTipo === 'ingreso' || nuevoTipo === 'gasto') {
    const cuentaId = String(payload.cuentaId || prev.cuentaId).trim()
    const v = validarFechaCuentas(fecha, [cuentaId])
    if (!v.ok) throw new Error(v.error)
    next.cuentaId = cuentaId
  } else if (nuevoTipo === 'transferencia') {
    const origenId = String(payload.origenId || prev.origenId).trim()
    const destinoId = String(payload.destinoId || prev.destinoId).trim()
    if (origenId === destinoId) throw new Error('Cuentas origen y destino iguales')
    const v = validarFechaCuentas(fecha, [origenId, destinoId])
    if (!v.ok) throw new Error(v.error)
    next.origenId = origenId
    next.destinoId = destinoId
  }

  // 2. Revertir efecto anterior (solo si estaba pagado)
  if (prev.estado === 'pagado') {
    revertirEfecto(prev)
  }

  // 3. Aplicar nuevo efecto (solo si el nuevo estado es pagado)
  if (nuevoEstado === 'pagado') {
    try {
      const cuentas = listarCuentas()
      if (nuevoTipo === 'ingreso') {
        const c = cuentas.find(x => x.id === next.cuentaId)
        if (!c) throw new Error('Cuenta no encontrada')
        actualizarCuenta(c.id, { dinero: Number(c.dinero) + Number(cantidad) })
      } else if (nuevoTipo === 'gasto') {
        const c = cuentas.find(x => x.id === next.cuentaId)
        if (!c) throw new Error('Cuenta no encontrada')
        actualizarCuenta(c.id, { dinero: Number(c.dinero) - Number(cantidad) })
      } else if (nuevoTipo === 'transferencia') {
        const org = cuentas.find(x => x.id === next.origenId)
        const dest = cuentas.find(x => x.id === next.destinoId)
        if (!org || !dest) throw new Error('Cuenta(s) no encontrada(s)')
        actualizarCuenta(org.id, { dinero: Number(org.dinero) - Number(cantidad) })
        actualizarCuenta(dest.id, { dinero: Number(dest.dinero) + Number(cantidad) })
      }
    } catch (e) {
      // Rollback si la anterior estaba pagada
      if (prev.estado === 'pagado') {
        aplicarEfecto(prev)
      }
      throw e
    }
  }

  // 4. Guardar
  // Marcar como modificada manualmente si pertenece a una recurrencia
  if (next.recurrenciaId) {
    next.modificadaManualmente = true
  }
  list[idx] = next
  guardarTodas(list)
  return next
}

// === INTEGRIDAD REFERENCIAL ===

/**
 * Cuenta operaciones asociadas a una o más cuentas
 * @param {string[]} cuentaIds - IDs de cuentas a buscar
 * @returns {number}
 */
export function contarOperacionesPorCuentas(cuentaIds) {
  const ops = obtenerTodas()
  return ops.filter(op =>
    cuentaIds.includes(op.cuentaId) ||
    cuentaIds.includes(op.origenId) ||
    cuentaIds.includes(op.destinoId)
  ).length
}

/**
 * Elimina todas las operaciones asociadas a cuentas específicas
 * @param {string[]} cuentaIds - IDs de cuentas
 * @returns {number} Cantidad de operaciones eliminadas
 */
export function eliminarOperacionesPorCuentas(cuentaIds) {
  const ops = obtenerTodas()
  const filtradas = ops.filter(op =>
    !cuentaIds.includes(op.cuentaId) &&
    !cuentaIds.includes(op.origenId) &&
    !cuentaIds.includes(op.destinoId)
  )
  const eliminadas = ops.length - filtradas.length
  if (eliminadas > 0) {
    // Revertir efectos de operaciones pagadas antes de eliminar
    ops.forEach(op => {
      const afecta = cuentaIds.includes(op.cuentaId) ||
        cuentaIds.includes(op.origenId) ||
        cuentaIds.includes(op.destinoId)
      if (afecta && op.estado === 'pagado') {
        revertirEfecto(op)
      }
    })
    guardarTodas(filtradas)
  }
  return eliminadas
}

/**
 * Cuenta operaciones asociadas a una etiqueta
 * @param {string} etiquetaId
 * @returns {number}
 */
export function contarOperacionesPorEtiqueta(etiquetaId) {
  const ops = obtenerTodas()
  return ops.filter(op => op.etiquetaId === etiquetaId).length
}

/**
 * Elimina la referencia a una etiqueta de todas las operaciones (no borra las operaciones)
 * @param {string} etiquetaId
 * @returns {number} Cantidad de operaciones afectadas
 */
export function limpiarReferenciaEtiqueta(etiquetaId) {
  const ops = obtenerTodas()
  let afectadas = 0
  ops.forEach(op => {
    if (op.etiquetaId === etiquetaId) {
      op.etiquetaId = null
      afectadas++
    }
  })
  if (afectadas > 0) {
    guardarTodas(ops)
  }
  return afectadas
}

/**
 * Elimina todas las operaciones asociadas a una etiqueta
 * @param {string} etiquetaId
 * @returns {number} Cantidad de operaciones eliminadas
 */
export function eliminarOperacionesPorEtiqueta(etiquetaId) {
  const ops = obtenerTodas()
  const filtradas = ops.filter(op => op.etiquetaId !== etiquetaId)
  const eliminadas = ops.length - filtradas.length
  if (eliminadas > 0) {
    // Revertir efectos de operaciones pagadas antes de eliminar
    ops.forEach(op => {
      if (op.etiquetaId === etiquetaId && op.estado === 'pagado') {
        revertirEfecto(op)
      }
    })
    guardarTodas(filtradas)
  }
  return eliminadas
}

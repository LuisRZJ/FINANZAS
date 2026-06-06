import { STORAGE_KEYS } from '../sistema/constantes.js'
import { leer, escribir } from './almacenamiento.js'
import { listarCuentas, actualizarCuenta, actualizarMultiplesSaldos, ajustarSaldoPorOperacion } from './cuentas.js'

function uid() {
  return 'op_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

async function obtenerTodas() {
  const data = await leer(STORAGE_KEYS.operaciones, [])
  return Array.isArray(data) ? data : []
}

async function guardarTodas(list) {
  return await escribir(STORAGE_KEYS.operaciones, list)
}

export async function listarOperaciones() {
  return await obtenerTodas()
}

// Determina el estado basándose en la fecha
function determinarEstado(fechaStr) {
  const ahora = new Date()
  // fechaStr puede ser YYYY-MM-DD o YYYY-MM-DDTHH:MM
  const fechaOp = new Date(fechaStr.includes('T') ? fechaStr : fechaStr + 'T23:59:59')
  return fechaOp > ahora ? 'pendiente' : 'pagado'
}

// Valida que la fecha no sea anterior a la creación de las cuentas involucradas
async function validarFechaCuentas(fechaStr, cuentaIds) {
  const cuentas = await listarCuentas()
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

async function revertirEfecto(op) {
  const opInfo = { nombre: op.nombre, tipo: op.tipo, cantidad: op.cantidad, fecha: op.fecha, accion: 'revertir' }

  if (op.tipo === 'ingreso') {
    await ajustarSaldoPorOperacion(op.cuentaId, -Number(op.cantidad), opInfo)
  } else if (op.tipo === 'gasto') {
    await ajustarSaldoPorOperacion(op.cuentaId, Number(op.cantidad), opInfo)
  } else if (op.tipo === 'transferencia') {
    await ajustarSaldoPorOperacion(op.origenId, Number(op.cantidad), opInfo)
    await ajustarSaldoPorOperacion(op.destinoId, -Number(op.cantidad), opInfo)
  }
}

async function aplicarEfecto(op) {
  const opInfo = { nombre: op.nombre, tipo: op.tipo, cantidad: op.cantidad, fecha: op.fecha, accion: 'aplicar' }

  if (op.tipo === 'ingreso') {
    await ajustarSaldoPorOperacion(op.cuentaId, Number(op.cantidad), opInfo)
  } else if (op.tipo === 'gasto') {
    await ajustarSaldoPorOperacion(op.cuentaId, -Number(op.cantidad), opInfo)
  } else if (op.tipo === 'transferencia') {
    await ajustarSaldoPorOperacion(op.origenId, -Number(op.cantidad), opInfo)
    await ajustarSaldoPorOperacion(op.destinoId, Number(op.cantidad), opInfo)
  }
}

// === NUEVA FUNCIÓN: Ejecutar operaciones pendientes cuya fecha ya pasó ===
export async function ejecutarPendientes() {
  const ahora = new Date()
  const list = await obtenerTodas()
  let huboCambios = false
  const actualizacionesSaldos = []

  list.forEach(op => {
    if (op.estado === 'pendiente') {
      const fechaOp = new Date(op.fecha.includes('T') ? op.fecha : op.fecha + 'T23:59:59')
      if (fechaOp <= ahora) {
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
    await guardarTodas(list)
    if (actualizacionesSaldos.length > 0) {
      await actualizarMultiplesSaldos(actualizacionesSaldos)
    }
  }

  return huboCambios
}

// === CREACIÓN DE OPERACIONES ===

export async function crearIngreso(payload) {
  const nombre = String(payload?.nombre || '').trim()
  const descripcion = String(payload?.descripcion || '').trim()
  const etiquetaId = String(payload?.etiquetaId || '').trim()
  const cantidad = Number(payload?.cantidad || 0)
  const fecha = String(payload?.fecha || '').trim()
  const cuentaId = String(payload?.cuentaId || '').trim()

  if (!nombre || !fecha || !cuentaId || !(cantidad > 0)) throw new Error('Datos de ingreso inválidos')

  const v = await validarFechaCuentas(fecha, [cuentaId])
  if (!v.ok) throw new Error(v.error)

  const cuentas = await listarCuentas()
  const cuenta = cuentas.find(c => c.id === cuentaId)
  if (!cuenta) throw new Error('Cuenta no encontrada')

  const estado = determinarEstado(fecha)

  if (estado === 'pagado') {
    await ajustarSaldoPorOperacion(cuentaId, cantidad, { nombre, tipo: 'ingreso', cantidad, fecha })
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

  const list = await obtenerTodas()
  list.push(op)
  await guardarTodas(list)
  return op
}

export async function crearGasto(payload) {
  const nombre = String(payload?.nombre || '').trim()
  const descripcion = String(payload?.descripcion || '').trim()
  const etiquetaId = String(payload?.etiquetaId || '').trim()
  const cantidad = Number(payload?.cantidad || 0)
  const fecha = String(payload?.fecha || '').trim()
  const cuentaId = String(payload?.cuentaId || '').trim()

  if (!nombre || !fecha || !cuentaId || !(cantidad > 0)) throw new Error('Datos de gasto inválidos')

  const v = await validarFechaCuentas(fecha, [cuentaId])
  if (!v.ok) throw new Error(v.error)

  const cuentas = await listarCuentas()
  const cuenta = cuentas.find(c => c.id === cuentaId)
  if (!cuenta) throw new Error('Cuenta no encontrada')

  const estado = determinarEstado(fecha)

  if (estado === 'pagado') {
    await ajustarSaldoPorOperacion(cuentaId, -cantidad, { nombre, tipo: 'gasto', cantidad, fecha })
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

  const list = await obtenerTodas()
  list.push(op)
  await guardarTodas(list)
  return op
}

export async function crearTransferencia(payload) {
  const nombre = String(payload?.nombre || '').trim()
  const descripcion = String(payload?.descripcion || '').trim()
  const cantidad = Number(payload?.cantidad || 0)
  const fecha = String(payload?.fecha || '').trim()
  const origenId = String(payload?.origenId || '').trim()
  const destinoId = String(payload?.destinoId || '').trim()

  if (!nombre || !fecha || !origenId || !destinoId || !(cantidad > 0)) throw new Error('Datos de transferencia inválidos')
  if (origenId === destinoId) throw new Error('Las cuentas de origen y destino deben ser distintas')

  const v = await validarFechaCuentas(fecha, [origenId, destinoId])
  if (!v.ok) throw new Error(v.error)

  const cuentas = await listarCuentas()
  const origen = cuentas.find(c => c.id === origenId)
  const destino = cuentas.find(c => c.id === destinoId)
  if (!origen || !destino) throw new Error('Cuenta(s) no encontrada(s)')

  const estado = determinarEstado(fecha)

  if (estado === 'pagado') {
    await ajustarSaldoPorOperacion(origenId, -cantidad, { nombre, tipo: 'transferencia', cantidad, fecha })
    await ajustarSaldoPorOperacion(destinoId, cantidad, { nombre, tipo: 'transferencia', cantidad, fecha })
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

  const list = await obtenerTodas()
  list.push(op)
  await guardarTodas(list)
  return op
}

// === ELIMINACIÓN ===

export async function eliminarOperacion(id) {
  const list = await obtenerTodas()
  const op = list.find(o => o.id === id)
  if (!op) return false

  if (op.estado === 'pagado') {
    await revertirEfecto(op)
  }

  const next = list.filter(o => o.id !== id)
  await guardarTodas(next)
  return true
}

// === ACTUALIZACIÓN ===

export async function actualizarOperacion(id, payload) {
  const list = await obtenerTodas()
  const idx = list.findIndex(o => o.id === id)
  if (idx === -1) throw new Error('Operación no encontrada')
  const prev = list[idx]

  const nuevoTipo = payload.tipo || prev.tipo
  const cantidad = Number(payload.cantidad !== undefined ? payload.cantidad : prev.cantidad)
  const fecha = String(payload.fecha !== undefined ? payload.fecha : prev.fecha).trim()
  const nombre = String(payload.nombre !== undefined ? payload.nombre : prev.nombre).trim()

  if (!(cantidad > 0)) throw new Error('La cantidad debe ser positiva')
  if (!nombre) throw new Error('El nombre es requerido')

  const nuevoEstado = determinarEstado(fecha)

  const now = new Date().toISOString()
  let next = {
    ...prev,
    ...payload,
    id: prev.id,
    creadaEn: prev.creadaEn,
    estado: nuevoEstado,
    actualizadaEn: now
  }

  if (nuevoTipo === 'ingreso' || nuevoTipo === 'gasto') {
    const cuentaId = String(payload.cuentaId || prev.cuentaId).trim()
    const v = await validarFechaCuentas(fecha, [cuentaId])
    if (!v.ok) throw new Error(v.error)
    next.cuentaId = cuentaId
  } else if (nuevoTipo === 'transferencia') {
    const origenId = String(payload.origenId || prev.origenId).trim()
    const destinoId = String(payload.destinoId || prev.destinoId).trim()
    if (origenId === destinoId) throw new Error('Cuentas origen y destino iguales')
    const v = await validarFechaCuentas(fecha, [origenId, destinoId])
    if (!v.ok) throw new Error(v.error)
    next.origenId = origenId
    next.destinoId = destinoId
  }

  if (prev.estado === 'pagado') {
    await revertirEfecto(prev)
  }

  if (nuevoEstado === 'pagado') {
    try {
      const opInfo = { nombre, tipo: nuevoTipo, cantidad, fecha }
      if (nuevoTipo === 'ingreso') {
        await ajustarSaldoPorOperacion(next.cuentaId, Number(cantidad), opInfo)
      } else if (nuevoTipo === 'gasto') {
        await ajustarSaldoPorOperacion(next.cuentaId, -Number(cantidad), opInfo)
      } else if (nuevoTipo === 'transferencia') {
        await ajustarSaldoPorOperacion(next.origenId, -Number(cantidad), opInfo)
        await ajustarSaldoPorOperacion(next.destinoId, Number(cantidad), opInfo)
      }
    } catch (e) {
      if (prev.estado === 'pagado') {
        await aplicarEfecto(prev)
      }
      throw e
    }
  }

  if (next.recurrenciaId) {
    next.modificadaManualmente = true
  }
  list[idx] = next
  await guardarTodas(list)
  return next
}

// === INTEGRIDAD REFERENCIAL ===

export async function contarOperacionesPorCuentas(cuentaIds) {
  const ops = await obtenerTodas()
  return ops.filter(op =>
    cuentaIds.includes(op.cuentaId) ||
    cuentaIds.includes(op.origenId) ||
    cuentaIds.includes(op.destinoId)
  ).length
}

export async function eliminarOperacionesPorCuentas(cuentaIds) {
  const ops = await obtenerTodas()
  const filtradas = ops.filter(op =>
    !cuentaIds.includes(op.cuentaId) &&
    !cuentaIds.includes(op.origenId) &&
    !cuentaIds.includes(op.destinoId)
  )
  const eliminadas = ops.length - filtradas.length
  if (eliminadas > 0) {
    for (const op of ops) {
      const afecta = cuentaIds.includes(op.cuentaId) ||
        cuentaIds.includes(op.origenId) ||
        cuentaIds.includes(op.destinoId)
      if (afecta && op.estado === 'pagado') {
        await revertirEfecto(op)
      }
    }
    await guardarTodas(filtradas)
  }
  return eliminadas
}

export async function contarOperacionesPorEtiqueta(etiquetaId) {
  const ops = await obtenerTodas()
  return ops.filter(op => op.etiquetaId === etiquetaId).length
}

export async function limpiarReferenciaEtiqueta(etiquetaId) {
  const ops = await obtenerTodas()
  let afectadas = 0
  ops.forEach(op => {
    if (op.etiquetaId === etiquetaId) {
      op.etiquetaId = null
      afectadas++
    }
  })
  if (afectadas > 0) {
    await guardarTodas(ops)
  }
  return afectadas
}

export async function eliminarOperacionesPorEtiqueta(etiquetaId) {
  const ops = await obtenerTodas()
  const filtradas = ops.filter(op => op.etiquetaId !== etiquetaId)
  const eliminadas = ops.length - filtradas.length
  if (eliminadas > 0) {
    for (const op of ops) {
      if (op.etiquetaId === etiquetaId && op.estado === 'pagado') {
        await revertirEfecto(op)
      }
    }
    await guardarTodas(filtradas)
  }
  return eliminadas
}

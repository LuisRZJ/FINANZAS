import { STORAGE_KEYS } from '../sistema/constantes.js'
import { leer, escribir } from './almacenamiento.js'
function uid() {
  return 'cta_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}
async function obtenerTodas() {
  const data = await leer(STORAGE_KEYS.cuentas, [])
  return Array.isArray(data) ? data : []
}
async function guardarTodas(list) {
  const res = await escribir(STORAGE_KEYS.cuentas, list)
  // Desencadenar la evaluación de metas de forma perezosa para evitar dependencias circulares
  import('./metas.js').then(async ({ evaluarMetasSimples }) => {
    try {
      await evaluarMetasSimples()
    } catch (err) {
      console.error('Error al evaluar metas de forma perezosa:', err)
    }
  }).catch(err => {
    console.error('Error al importar metas.js:', err)
  })
  return res
}
export async function listarCuentas() {
  return await obtenerTodas()
}
export async function crearCuenta(payload) {
  const now = new Date().toISOString()
  // Permitir fecha de creación personalizada para migración de datos históricos
  let fechaCreacion = now
  if (payload?.creadaEn) {
    // Parsear la fecha como hora local (el input date envía YYYY-MM-DD)
    const [año, mes, dia] = payload.creadaEn.split('-').map(Number)
    fechaCreacion = new Date(año, mes - 1, dia, 12, 0, 0).toISOString()
  }
  const dineroInicial = Number.isFinite(payload?.dinero) ? Number(payload.dinero) : 0;
  let mensajeCreacion = payload?.esSubcuenta ? 'Subcuenta creada' : 'Cuenta creada';
  if (dineroInicial > 0) {
    mensajeCreacion += ` con saldo inicial de $${dineroInicial}`;
  }

  const cuenta = {
    id: uid(),
    nombre: String(payload?.nombre || '').trim(),
    descripcion: String(payload?.descripcion || '').trim(),
    color: String(payload?.color || '#0ea5e9'),
    dinero: dineroInicial,
    parentId: payload?.parentId || null,
    esSubcuenta: Boolean(payload?.esSubcuenta),
    creadaEn: fechaCreacion,
    actualizadaEn: now,
    historial: [
      {
        fecha: fechaCreacion,
        tipo: 'creacion',
        mensaje: mensajeCreacion
      }
    ]
  }
  const list = await obtenerTodas()
  list.push(cuenta)
  await guardarTodas(list)
  return cuenta
}

export async function actualizarCuenta(id, payload) {
  const list = await obtenerTodas()
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

  // Permitir modificar fecha de creación para migración de datos históricos
  let nuevaCreadaEn = prev.creadaEn
  if (payload?.creadaEn !== undefined && payload.creadaEn) {
    // Extraer fecha local de la fecha anterior guardada
    const fechaAnteriorObj = new Date(prev.creadaEn)
    const añoAnt = fechaAnteriorObj.getFullYear()
    const mesAnt = fechaAnteriorObj.getMonth()
    const diaAnt = fechaAnteriorObj.getDate()

    // Parsear la fecha nueva como hora local (el input date envía YYYY-MM-DD)
    const [añoNuevo, mesNuevo, diaNuevo] = payload.creadaEn.split('-').map(Number)

    // Comparar solo año, mes y día
    if (añoAnt !== añoNuevo || mesAnt !== (mesNuevo - 1) || diaAnt !== diaNuevo) {
      // Crear fecha nueva a medianoche hora local
      const fechaNuevaObj = new Date(añoNuevo, mesNuevo - 1, diaNuevo, 12, 0, 0)
      nuevaCreadaEn = fechaNuevaObj.toISOString()

      const fechaAnteriorStr = fechaAnteriorObj.toLocaleDateString()
      const fechaNuevaStr = fechaNuevaObj.toLocaleDateString()
      cambios.push(`Fecha de creación modificada de ${fechaAnteriorStr} a ${fechaNuevaStr}`)
    }
  }

  const now = new Date().toISOString()
  const historial = Array.isArray(prev.historial) ? [...prev.historial] : []

  // Si cambió la fecha de creación, sincronizar el evento original de 'creacion'
  if (nuevaCreadaEn !== prev.creadaEn) {
    const idxCreacion = historial.findIndex(h => h.tipo === 'creacion')
    if (idxCreacion !== -1) {
      historial[idxCreacion] = { ...historial[idxCreacion], fecha: nuevaCreadaEn }
    }
  }

  if (cambios.length > 0) {
    historial.push({
      fecha: payload?.fechaHistorial || now,
      tipo: 'modificacion',
      mensaje: cambios.join('. ')
    })
  }

  // Si el ajuste es retroactivo, no rejuvenecer actualizadaEn
  let nuevaActualizadaEn = now
  if (payload?.fechaHistorial) {
    const fechaHist = new Date(payload.fechaHistorial)
    const fechaNow = new Date(now)
    if (fechaHist < fechaNow) {
      // Mantener el mayor entre la fecha previa y la retroactiva
      const prevActualizada = prev.actualizadaEn ? new Date(prev.actualizadaEn) : new Date(0)
      nuevaActualizadaEn = fechaHist > prevActualizada ? payload.fechaHistorial : prev.actualizadaEn
    }
  }

  let nuevoEsSubcuenta = prev.esSubcuenta
  if (payload?.esSubcuenta !== undefined) {
    const esSub = Boolean(payload.esSubcuenta)
    if (esSub !== prev.esSubcuenta) {
      cambios.push(esSub ? 'Convertida a subcuenta' : 'Convertida a cuenta principal')
      nuevoEsSubcuenta = esSub
    }
  }

  let nuevoParentId = prev.parentId
  if (payload?.parentId !== undefined) {
    const pId = payload.parentId || null
    if (pId !== prev.parentId) {
      if (pId) {
        cambios.push(`Cuenta padre asociada`)
      } else {
        cambios.push(`Cuenta padre desasociada`)
      }
      nuevoParentId = pId
    }
  }

  const next = {
    ...prev,
    nombre: nuevoNombre,
    descripcion: nuevaDesc,
    color: nuevoColor,
    dinero: nuevoDinero,
    esSubcuenta: nuevoEsSubcuenta,
    parentId: nuevoParentId,
    creadaEn: nuevaCreadaEn,
    actualizadaEn: nuevaActualizadaEn,
    historial: historial
  }
  list[idx] = next
  await guardarTodas(list)
  return next
}

export async function actualizarMultiplesSaldos(actualizaciones) {
  const list = await obtenerTodas()
  const now = new Date().toISOString()
  let changed = false
  const mapCuentas = new Map(list.map((c, i) => [c.id, i]))

  actualizaciones.forEach(({ id, delta }) => {
    const idx = mapCuentas.get(id)
    if (idx !== undefined) {
      const prev = list[idx]
      const nuevoDinero = Number(prev.dinero || 0) + Number(delta)

      list[idx] = {
        ...prev,
        dinero: nuevoDinero,
        actualizadaEn: now
      }
      changed = true
    }
  })

  if (changed) {
    await guardarTodas(list)
  }
}

export async function ajustarSaldoPorOperacion(id, delta, operacionInfo = {}) {
  const list = await obtenerTodas()
  const idx = list.findIndex((c) => c.id === id)
  if (idx === -1) return null

  const prev = list[idx]
  const now = new Date().toISOString()
  const nuevoDinero = Number(prev.dinero || 0) + Number(delta)

  // Bloqueo condicional de saldo negativo para cuentas vinculadas a trading
  if (nuevoDinero < 0) {
    try {
      const relaciones = JSON.parse(localStorage.getItem('gtr_cuenta_relaciones') || '{}')
      const estaVinculada = Object.values(relaciones).includes(id)
      if (estaVinculada) {
        throw new Error(`La cuenta "${prev.nombre}" está vinculada a trading y no permite saldo negativo. Faltan $${Math.abs(nuevoDinero).toFixed(2)}.`)
      }
    } catch (err) {
      if (err.message.includes('está vinculada')) throw err;
      console.error('Error verificando vinculación de cuenta:', err)
    }
  }

  // Ya no hacemos push al historial aquí.
  // El historial de transacciones se obtiene directamente de la tabla 'operaciones'.

  const next = {
    ...prev,
    dinero: nuevoDinero,
    actualizadaEn: now
    // historial se mantiene igual (solo para eventos administrativos)
  }

  list[idx] = next
  await guardarTodas(list)
  return next
}

export async function obtenerSubcuentas(parentId) {
  const list = await obtenerTodas()
  return list.filter((c) => c.parentId === parentId)
}

export async function obtenerCuentaPadre(cuenta) {
  if (!cuenta?.parentId) return null
  const list = await obtenerTodas()
  return list.find((c) => c.id === cuenta.parentId) || null
}

export async function obtenerCuentaPorId(id) {
  const list = await obtenerTodas()
  return list.find((c) => c.id === id) || null
}

export async function obtenerIdsParaEliminar(id) {
  const list = await obtenerTodas()
  const idsToDelete = new Set([id])
  list.forEach((c) => {
    if (c.parentId === id) idsToDelete.add(c.id)
  })
  return Array.from(idsToDelete)
}

export async function eliminarCuenta(id) {
  const list = await obtenerTodas()
  const deletedIds = await obtenerIdsParaEliminar(id)
  const next = list.filter((c) => !deletedIds.includes(c.id))
  const changed = next.length !== list.length
  if (changed) await guardarTodas(next)
  return { deleted: changed, deletedIds }
}

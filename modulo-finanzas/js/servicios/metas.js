import { STORAGE_KEYS } from '../sistema/constantes.js'
import { leer, escribir } from './almacenamiento.js'
import { listarOperaciones } from './operaciones.js'
import { listarCuentas } from './cuentas.js'
import { parseFecha, hoy } from '../sistema/fechas.js'

const META_DEFS = [
  { id: 'ganancias', tipo: 'ganancias', nombre: 'Meta de ganancias objetivo' },
  { id: 'gastos', tipo: 'gastos', nombre: 'Meta de gastos máximos objetivo' },
  { id: 'pnl', tipo: 'pnl', nombre: 'Meta de PNL objetivo' }
]


function leerTodasRaw() {
  const data = leer(STORAGE_KEYS.metas, null)
  if (!Array.isArray(data) || data.length === 0) return null
  return data
}

function crearPorDefecto() {
  const now = new Date().toISOString()
  return META_DEFS.map((def) => ({
    id: def.id,
    tipo: def.tipo,
    nombre: def.nombre,
    activo: false,
    objetivo: 0,
    fechaInicio: null,
    fechaFin: null,
    historial: [
      {
        fecha: now,
        tipo: 'sistema',
        mensaje: 'Meta creada y desactivada por defecto'
      }
    ]
  }))
}

function obtenerTodas() {
  const existentes = leerTodasRaw()
  if (existentes) return existentes
  const creadas = crearPorDefecto()
  escribir(STORAGE_KEYS.metas, creadas)
  return creadas
}

function guardarTodas(list) {
  escribir(STORAGE_KEYS.metas, list)
}

export function listarMetas() {
  return obtenerTodas()
}

function uidSimple() {
  return 'simple_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

export function listarMetasSimples() {
  return obtenerTodas().filter((m) => m.tipo === 'simple')
}

export function listarMetasAvanzadas() {
  return obtenerTodas().filter((m) => m.tipo !== 'simple')
}

export function guardarMetaParametros(id, payload) {
  const objetivo = Number(payload?.objetivo || 0)
  const fechaInicioStr = String(payload?.fechaInicio || '').trim()
  const fechaFinStr = String(payload?.fechaFin || '').trim()

  if (!(objetivo > 0)) throw new Error('El objetivo debe ser mayor que cero')
  if (!fechaInicioStr || !fechaFinStr) throw new Error('Debes definir fecha de inicio y fin')

  const inicio = parseFecha(fechaInicioStr)
  const fin = parseFecha(fechaFinStr)
  if (!inicio || !fin) throw new Error('Fechas inválidas')

  const hoyFecha = hoy()
  if (inicio < hoyFecha) throw new Error('La fecha de inicio no puede estar en el pasado')
  if (fin < inicio) throw new Error('La fecha de fin no puede ser anterior al inicio')

  const list = obtenerTodas()
  const idx = list.findIndex((m) => m.id === id)
  if (idx === -1) throw new Error('Meta no encontrada')
  const prev = list[idx]

  const cambios = []
  if (prev.objetivo !== objetivo) cambios.push('objetivo')
  if (prev.fechaInicio !== fechaInicioStr) cambios.push('fecha de inicio')
  if (prev.fechaFin !== fechaFinStr) cambios.push('fecha de fin')

  const now = new Date().toISOString()
  const historial = Array.isArray(prev.historial) ? [...prev.historial] : []
  if (cambios.length > 0) {
    historial.push({
      fecha: now,
      tipo: 'config',
      mensaje: 'Parámetros actualizados: ' + cambios.join(', ')
    })
  }

  const next = {
    ...prev,
    objetivo,
    fechaInicio: fechaInicioStr,
    fechaFin: fechaFinStr,
    activo: true,
    historial
  }

  list[idx] = next
  guardarTodas(list)
  return next
}

function calcularBalanceMeta(meta, operaciones) {
  if (!meta.fechaInicio || !meta.fechaFin) return 0
  const inicio = parseFecha(meta.fechaInicio)
  const fin = parseFecha(meta.fechaFin)
  if (!inicio || !fin) return 0

  let total = 0
  operaciones.forEach(op => {
    const d = parseFecha(op.fecha)
    if (!d) return
    // Comparar timestamps para evitar problemas de horas
    if (d.getTime() < inicio.getTime() || d.getTime() > fin.getTime()) return

    let monto = 0
    if (meta.tipo === 'ganancias' && op.tipo === 'ingreso') {
      monto = Number(op.cantidad || 0)
    } else if (meta.tipo === 'gastos' && op.tipo === 'gasto') {
      monto = Number(op.cantidad || 0)
    } else if (meta.tipo === 'pnl') {
      if (op.tipo === 'ingreso') monto = Number(op.cantidad || 0)
      else if (op.tipo === 'gasto') monto = -Number(op.cantidad || 0)
    }
    total += monto
  })
  return total
}

export function cambiarEstadoMeta(id, activo) {
  const list = obtenerTodas()
  const idx = list.findIndex((m) => m.id === id)
  if (idx === -1) throw new Error('Meta no encontrada')
  const prev = list[idx]
  if (prev.activo === activo) return prev

  const now = new Date().toISOString()
  const historial = Array.isArray(prev.historial) ? [...prev.historial] : []
  historial.push({
    fecha: now,
    tipo: 'sistema',
    mensaje: activo ? 'Meta activada' : 'Meta pausada'
  })

  const next = {
    ...prev,
    activo,
    historial
  }

  list[idx] = next
  guardarTodas(list)
  return next
}

export function revisarPeriodosYActualizar() {
  const list = obtenerTodas()
  const operaciones = listarOperaciones()
  const hoyFecha = hoy()
  let cambiado = false

  const nextList = list.map((meta) => {
    if (!meta.activo || !meta.fechaInicio || !meta.fechaFin) return meta
    const fin = parseFecha(meta.fechaFin)
    if (!fin) return meta

    if (fin < hoyFecha) {
      // Calcular resultados finales
      const actual = calcularBalanceMeta(meta, operaciones)
      const objetivo = Number(meta.objetivo || 0)
      const diff = actual - objetivo

      // Determinar éxito
      let cumplido = false
      if (meta.tipo === 'gastos') {
        cumplido = actual <= objetivo
      } else { // ganancias o pnl
        cumplido = actual >= objetivo
      }

      // Formatear moneda
      const fmt = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

      let detalle = ''
      if (meta.tipo === 'gastos') {
        if (cumplido) {
          detalle = `¡Objetivo cumplido! Gastaste ${fmt(actual)} (Límite: ${fmt(objetivo)}). Ahorro: ${fmt(objetivo - actual)}.`
        } else {
          detalle = `Objetivo no cumplido. Gastaste ${fmt(actual)} (Excedido por ${fmt(actual - objetivo)}).`
        }
      } else {
        if (cumplido) {
          detalle = `¡Objetivo cumplido! Lograste ${fmt(actual)} (Meta: ${fmt(objetivo)}). Superavit: ${fmt(diff)}.`
        } else {
          detalle = `Objetivo no cumplido. Lograste ${fmt(actual)} (Faltaron ${fmt(objetivo - actual)}).`
        }
      }

      const now = new Date().toISOString()
      const historial = Array.isArray(meta.historial) ? [...meta.historial] : []
      historial.push({
        fecha: now,
        tipo: 'sistema',
        mensaje: `Finalizado: ${detalle}`
      })
      cambiado = true
      return {
        ...meta,
        activo: false,
        historial
      }
    }
    return meta
  })

  if (cambiado) guardarTodas(nextList)
  return nextList
}

export function crearMetaSimple(payload) {
  const nombre = String(payload?.nombre || '').trim()
  const cuentaId = String(payload?.cuentaId || '').trim()
  const objetivo = Number(payload?.objetivo || 0)

  if (!nombre) throw new Error('El nombre de la meta es obligatorio')
  if (!cuentaId) throw new Error('Debes seleccionar una cuenta')
  if (!(objetivo > 0)) throw new Error('El objetivo debe ser mayor que cero')

  const cuentas = listarCuentas()
  const cuenta = cuentas.find((c) => c.id === cuentaId)
  if (!cuenta) throw new Error('Cuenta no encontrada')

  const list = obtenerTodas()
  const existeDuplicada = list.some(
    (m) => m.tipo === 'simple' && m.cuentaId === cuentaId && Number(m.objetivo || 0) === objetivo
  )
  if (existeDuplicada) throw new Error('Ya existe una meta simple para esta cuenta con ese objetivo')

  const saldoActual = Number(cuenta.dinero || 0)
  const now = new Date().toISOString()

  const meta = {
    id: uidSimple(),
    tipo: 'simple',
    nombre,
    cuentaId,
    objetivo,
    color: cuenta.color,
    activo: true,
    completada: false,
    ultimoSaldo: saldoActual,
    creadaEn: now,
    historial: [
      {
        fecha: now,
        tipo: 'config',
        mensaje: 'Meta simple creada'
      }
    ]
  }

  list.push(meta)
  guardarTodas(list)
  return meta
}

export function actualizarMetaSimple(id, payload) {
  const list = obtenerTodas()
  const idx = list.findIndex((m) => m.id === id && m.tipo === 'simple')
  if (idx === -1) throw new Error('Meta simple no encontrada')
  const prev = list[idx]
  if (prev.completada) throw new Error('No se puede editar una meta simple completada')

  const nombre = payload?.nombre !== undefined ? String(payload.nombre).trim() : prev.nombre
  const cuentaId = payload?.cuentaId !== undefined ? String(payload.cuentaId).trim() : prev.cuentaId
  const objetivo = payload?.objetivo !== undefined ? Number(payload.objetivo) : prev.objetivo

  if (!nombre) throw new Error('El nombre de la meta es obligatorio')
  if (!cuentaId) throw new Error('Debes seleccionar una cuenta')
  if (!(objetivo > 0)) throw new Error('El objetivo debe ser mayor que cero')

  const cuentas = listarCuentas()
  const cuenta = cuentas.find((c) => c.id === cuentaId)
  if (!cuenta) throw new Error('Cuenta no encontrada')

  const existeDuplicada = list.some(
    (m) =>
      m.id !== id &&
      m.tipo === 'simple' &&
      m.cuentaId === cuentaId &&
      Number(m.objetivo || 0) === objetivo
  )
  if (existeDuplicada) throw new Error('Ya existe otra meta simple para esta cuenta con ese objetivo')

  const cambios = []
  if (nombre !== prev.nombre) cambios.push('nombre')
  if (cuentaId !== prev.cuentaId) cambios.push('cuenta')
  if (objetivo !== prev.objetivo) cambios.push('objetivo')

  const now = new Date().toISOString()
  const historial = Array.isArray(prev.historial) ? [...prev.historial] : []
  if (cambios.length > 0) {
    historial.push({
      fecha: now,
      tipo: 'config',
      mensaje: 'Meta actualizada: ' + cambios.join(', ')
    })
  }

  const saldoActual = Number(cuenta.dinero || 0)

  const next = {
    ...prev,
    nombre,
    cuentaId,
    objetivo,
    color: cuenta.color,
    ultimoSaldo: saldoActual,
    historial
  }

  list[idx] = next
  guardarTodas(list)
  return next
}

export function eliminarMetaSimple(id) {
  const list = obtenerTodas()
  const meta = list.find((m) => m.id === id && m.tipo === 'simple')
  if (!meta) return false
  if (meta.completada) throw new Error('No se puede eliminar una meta simple completada')
  const next = list.filter((m) => m.id !== id)
  guardarTodas(next)
  return true
}

export function evaluarMetasSimples() {
  const list = obtenerTodas()
  const cuentas = listarCuentas()
  let cambiado = false

  const nextList = list.map((meta) => {
    if (meta.tipo !== 'simple' || !meta.activo || meta.completada) return meta
    const cuenta = cuentas.find((c) => c.id === meta.cuentaId)
    if (!cuenta) {
      const now = new Date().toISOString()
      const historial = Array.isArray(meta.historial) ? [...meta.historial] : []
      historial.push({
        fecha: now,
        tipo: 'sistema',
        mensaje: 'Cuenta asociada eliminada. Meta pausada.'
      })
      cambiado = true
      return {
        ...meta,
        activo: false,
        historial
      }
    }

    const saldoActual = Number(cuenta.dinero || 0)
    const ultimo = Number(meta.ultimoSaldo != null ? meta.ultimoSaldo : saldoActual)
    if (saldoActual === ultimo) return meta

    const objetivo = Number(meta.objetivo || 0)
    const distAntes = Math.abs(objetivo - ultimo)
    const distAhora = Math.abs(objetivo - saldoActual)
    const acercado = distAhora < distAntes
    const delta = Math.abs(distAntes - distAhora)

    const fmt = (n) => Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })

    let mensaje
    if (acercado) {
      mensaje =
        'Te acercaste ' +
        fmt(delta) +
        ' a la meta. Antes faltaban ' +
        fmt(distAntes) +
        ', ahora faltan ' +
        fmt(distAhora) +
        '.'
    } else {
      mensaje =
        'Te alejaste ' +
        fmt(delta) +
        ' de la meta. Antes faltaban ' +
        fmt(distAntes) +
        ', ahora faltan ' +
        fmt(distAhora) +
        '.'
    }

    const now = new Date().toISOString()
    const historial = Array.isArray(meta.historial) ? [...meta.historial] : []
    historial.push({
      fecha: now,
      tipo: 'progreso',
      mensaje
    })

    let completada = meta.completada
    let activo = meta.activo
    if (saldoActual >= objetivo) {
      completada = true
      activo = false
      const extra = saldoActual - objetivo
      const msgExito =
        'Meta alcanzada. Saldo ' +
        fmt(saldoActual) +
        ', objetivo ' +
        fmt(objetivo) +
        (extra > 0 ? '. Superaste por ' + fmt(extra) + '.' : '.')
      historial.push({
        fecha: now,
        tipo: 'sistema',
        mensaje: msgExito
      })
    }

    cambiado = true
    return {
      ...meta,
      ultimoSaldo: saldoActual,
      completada,
      activo,
      historial
    }
  })

  if (cambiado) guardarTodas(nextList)
  return nextList
}

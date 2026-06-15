import { STORAGE_KEYS } from '../sistema/constantes.js'
import { leer, escribir } from './almacenamiento.js'
import { listarEtiquetas } from './etiquetas.js'
import { listarOperaciones } from './operaciones.js'
import { parseFecha, hoy, formatFechaISO } from '../sistema/fechas.js'

async function leerEstado() {
  const raw = await leer(STORAGE_KEYS.presupuestos, null)
  if (!raw || typeof raw !== 'object') {
    return {
      general: null,
      categorias: []
    }
  }
  if (!Array.isArray(raw.categorias)) raw.categorias = []
  return raw
}

async function guardarEstado(estado) {
  await escribir(STORAGE_KEYS.presupuestos, estado)
}

function nuevoHistorialEntry(tipo, mensaje) {
  return {
    fecha: new Date().toISOString(),
    tipo,
    mensaje
  }
}

export async function obtenerPresupuestoGeneral() {
  const estado = await leerEstado()
  if (estado.general && !estado.general.tipoPeriodo) {
    estado.general.tipoPeriodo = 'personalizado'
    estado.general.estadoActivo = true
  }
  return estado.general
}

export async function listarPresupuestosCategorias() {
  const estado = await leerEstado()
  return estado.categorias
}

function validarPeriodo(fechaInicioStr, fechaFinStr) {
  const inicio = parseFecha(fechaInicioStr)
  const fin = parseFecha(fechaFinStr)
  if (!inicio || !fin) throw new Error('Fechas de periodo inválidas')
  const hoyFecha = hoy()
  if (inicio < hoyFecha) throw new Error('La fecha de inicio del presupuesto no puede estar en el pasado')
  if (fin < inicio) throw new Error('La fecha de fin no puede ser anterior al inicio')
  const dias = Math.max(1, Math.round((fin.getTime() - inicio.getTime()) / 86400000) + 1)
  return { inicio, fin, dias }
}

export async function configurarPresupuestoGeneral(payload) {
  const monto = Number(payload?.monto || 0)
  const tipoPeriodo = String(payload?.tipoPeriodo || 'mensual').trim()
  const estadoActivo = payload?.estadoActivo !== undefined ? Boolean(payload.estadoActivo) : true

  if (!(monto > 0)) throw new Error('El monto del presupuesto general debe ser mayor que cero')

  const estado = await leerEstado()
  const anterior = estado.general

  let fechaInicioStr = ''
  let fechaFinStr = ''

  if (tipoPeriodo === 'personalizado') {
    fechaInicioStr = String(payload?.fechaInicio || '').trim()
    fechaFinStr = String(payload?.fechaFin || '').trim()
    if (!fechaInicioStr || !fechaFinStr) throw new Error('Debes definir fecha de inicio y fin para un periodo personalizado')
    validarPeriodo(fechaInicioStr, fechaFinStr)
  } else {
    const hoyFecha = new Date()
    const y = hoyFecha.getFullYear()
    const m = hoyFecha.getMonth()

    if (tipoPeriodo === 'mensual') {
      const firstDay = new Date(y, m, 1)
      const lastDay = new Date(y, m + 1, 0)
      fechaInicioStr = formatFechaISO(firstDay)
      fechaFinStr = formatFechaISO(lastDay)
    } else if (tipoPeriodo === 'semanal') {
      const dayOfWeek = hoyFecha.getDay()
      const diffToMon = dayOfWeek === 0 ? -6 : 1 - dayOfWeek
      const monday = new Date(hoyFecha)
      monday.setDate(hoyFecha.getDate() + diffToMon)
      const sunday = new Date(monday)
      sunday.setDate(monday.getDate() + 6)
      fechaInicioStr = formatFechaISO(monday)
      fechaFinStr = formatFechaISO(sunday)
    } else if (tipoPeriodo === 'anual') {
      fechaInicioStr = `${y}-01-01`
      fechaFinStr = `${y}-12-31`
    } else {
      throw new Error('Tipo de periodo inválido')
    }
  }

  // Conservar las fechas si el tipo de periodo no cambió para evitar reiniciar el mes
  if (anterior && anterior.tipoPeriodo === tipoPeriodo && tipoPeriodo !== 'personalizado') {
    fechaInicioStr = anterior.fechaInicio
    fechaFinStr = anterior.fechaFin
  }

  const parseFechaObj = (str) => {
    const [año, mes, dia] = str.split('-').map(Number)
    return new Date(año, mes - 1, dia)
  }

  const inicio = parseFechaObj(fechaInicioStr)
  const fin = parseFechaObj(fechaFinStr)
  const diasPeriodo = Math.max(1, Math.round((fin.getTime() - inicio.getTime()) / 86400000) + 1)

  const ahora = new Date().toISOString()
  const historial = anterior && Array.isArray(anterior.historial) ? [...anterior.historial] : []

  if (!anterior) {
    historial.push(nuevoHistorialEntry('creacion', 'Presupuesto general creado'))
  } else {
    const cambios = []
    if (Number(anterior.monto || 0) !== monto) cambios.push('monto')
    if (anterior.tipoPeriodo !== tipoPeriodo) cambios.push('tipoPeriodo')
    if (anterior.estadoActivo !== estadoActivo) cambios.push('estadoActivo')
    if (anterior.fechaInicio !== fechaInicioStr || anterior.fechaFin !== fechaFinStr) cambios.push('fechas')
    if (cambios.length > 0) {
      historial.push(
        nuevoHistorialEntry(
          'config',
          'Presupuesto general actualizado: ' + cambios.join(', ')
        )
      )
    }
  }

  const general = {
    id: 'general',
    monto,
    tipoPeriodo,
    estadoActivo,
    fechaInicio: fechaInicioStr,
    fechaFin: fechaFinStr,
    diasPeriodo,
    creadoEn: anterior?.creadoEn || ahora,
    actualizadoEn: ahora,
    historial
  }

  estado.general = general
  await guardarEstado(estado)
  return general
}

export async function calcularResumenPresupuestoActual() {
  const estado = await leerEstado()
  const general = estado.general
  if (!general) {
    return {
      general: null,
      categorias: [],
      totalCategorias: 0,
      restanteAsignar: 0,
      gastoTotalPeriodo: 0,
      gastoComprometidoTotal: 0
    }
  }

  if (!general.tipoPeriodo) {
    general.tipoPeriodo = 'personalizado'
    general.estadoActivo = true
  }

  const inicio = parseFecha(general.fechaInicio)
  const fin = parseFecha(general.fechaFin)
  const ops = await listarOperaciones()
  const etiquetas = await listarEtiquetas()
  const mapEt = new Map(etiquetas.map((e) => [e.id, e]))

  function dentroPeriodo(fechaStr) {
    const d = parseFecha(fechaStr)
    if (!d || !inicio || !fin) return false
    const t = d.getTime()
    return t >= inicio.getTime() && t <= fin.getTime()
  }

  function obtenerAncestros(etiquetaId) {
    const ancestros = [etiquetaId]
    const visitados = new Set([etiquetaId])
    let actual = mapEt.get(etiquetaId)

    while (actual && actual.padreId) {
      if (visitados.has(actual.padreId)) {
        break
      }
      ancestros.push(actual.padreId)
      visitados.add(actual.padreId)
      actual = mapEt.get(actual.padreId)
    }
    return ancestros
  }

  const gastoPorEtiqueta = new Map() 
  const gastoComprometidoPorEtiqueta = new Map() 

  let gastoTotalPeriodo = 0 
  let gastoComprometidoTotal = 0 

  ops.forEach((op) => {
    if (op.tipo !== 'gasto') return
    if (!dentroPeriodo(op.fecha)) return

    const cantidad = Number(op.cantidad || 0)
    const esPagado = op.estado === 'pagado'

    if (esPagado) {
      gastoTotalPeriodo += cantidad
    } else {
      gastoComprometidoTotal += cantidad
    }

    if (op.etiquetaId) {
      const etiquetasAfectadas = obtenerAncestros(op.etiquetaId)
      etiquetasAfectadas.forEach((etId) => {
        if (esPagado) {
          const prev = gastoPorEtiqueta.get(etId) || 0
          gastoPorEtiqueta.set(etId, prev + cantidad)
        } else {
          const prev = gastoComprometidoPorEtiqueta.get(etId) || 0
          gastoComprometidoPorEtiqueta.set(etId, prev + cantidad)
        }
      })
    }
  })

  const categorias = estado.categorias.map((c) => {
    const et = mapEt.get(c.etiquetaId)
    const gastado = gastoPorEtiqueta.get(c.etiquetaId) || 0
    const comprometido = gastoComprometidoPorEtiqueta.get(c.etiquetaId) || 0
    const restante = Number(c.monto || 0) - gastado 
    const restanteProyectado = Number(c.monto || 0) - gastado - comprometido 
    return {
      ...c,
      etiquetaNombre: et ? et.nombre : 'Etiqueta eliminada',
      etiquetaColor: et ? et.color : '#64748b',
      gastado, 
      comprometido, 
      restante, 
      restanteProyectado 
    }
  })

  const totalCategorias = categorias.reduce((acc, c) => acc + Number(c.monto || 0), 0)
  const restanteAsignar = Number(general.monto || 0) - totalCategorias

  return {
    general,
    categorias,
    totalCategorias,
    restanteAsignar,
    gastoTotalPeriodo, 
    gastoComprometidoTotal 
  }
}

export async function crearPresupuestoCategoria(payload) {
  const estado = await leerEstado()
  if (!estado.general) throw new Error('Primero debes definir un presupuesto general')

  const etiquetaId = String(payload?.etiquetaId || '').trim()
  const monto = Number(payload?.monto || 0)
  if (!etiquetaId) throw new Error('Debes seleccionar una etiqueta de gasto')
  if (!(monto > 0)) throw new Error('El monto del presupuesto debe ser mayor que cero')

  const etiquetas = await listarEtiquetas()
  const etiquetasGasto = etiquetas.filter((e) => e.tipo === 'gasto')
  const etiqueta = etiquetasGasto.find((e) => e.id === etiquetaId)
  if (!etiqueta) throw new Error('Etiqueta de gasto no encontrada')

  const existente = estado.categorias.find((c) => c.etiquetaId === etiquetaId)
  if (existente) throw new Error('Ya existe un presupuesto para esta etiqueta')

  const resumen = await calcularResumenPresupuestoActual()
  if (monto > resumen.restanteAsignar) throw new Error('El monto excede el presupuesto general disponible por asignar')

  const ahora = new Date().toISOString()
  const categoria = {
    id: 'pcat_' + Math.random().toString(36).slice(2) + Date.now().toString(36),
    etiquetaId,
    monto,
    creadoEn: ahora,
    actualizadoEn: ahora,
    historial: [
      nuevoHistorialEntry('creacion', 'Presupuesto creado para etiqueta ' + etiqueta.nombre)
    ]
  }

  estado.categorias.push(categoria)
  await guardarEstado(estado)
  return categoria
}

export async function actualizarPresupuestoCategoria(id, payload) {
  const estado = await leerEstado()
  if (!estado.general) throw new Error('Primero debes definir un presupuesto general')
  const idx = estado.categorias.findIndex((c) => c.id === id)
  if (idx === -1) throw new Error('Presupuesto de etiqueta no encontrado')
  const prev = estado.categorias[idx]

  const etiquetaId = payload?.etiquetaId !== undefined ? String(payload.etiquetaId).trim() : prev.etiquetaId
  const monto = payload?.monto !== undefined ? Number(payload.monto) : prev.monto

  if (!etiquetaId) throw new Error('Debes seleccionar una etiqueta de gasto')
  if (!(monto > 0)) throw new Error('El monto del presupuesto debe ser mayor que cero')

  const etiquetas = await listarEtiquetas()
  const etiquetasGasto = etiquetas.filter((e) => e.tipo === 'gasto')
  const etiqueta = etiquetasGasto.find((e) => e.id === etiquetaId)
  if (!etiqueta) throw new Error('Etiqueta de gasto no encontrada')

  const duplicado = estado.categorias.some(
    (c) => c.id !== id && c.etiquetaId === etiquetaId
  )
  if (duplicado) throw new Error('Ya existe otro presupuesto para esta etiqueta')

  const totalOtros = estado.categorias.reduce((acc, c) => {
    if (c.id === id) return acc
    return acc + Number(c.monto || 0)
  }, 0)
  const disponible = Number(estado.general.monto || 0) - totalOtros
  if (monto > disponible) throw new Error('El monto excede el presupuesto general disponible por asignar')

  const cambios = []
  if (etiquetaId !== prev.etiquetaId) cambios.push('etiqueta')
  if (monto !== prev.monto) cambios.push('monto')

  const ahora = new Date().toISOString()
  const historial = Array.isArray(prev.historial) ? [...prev.historial] : []
  if (cambios.length > 0) {
    historial.push(
      nuevoHistorialEntry('config', 'Presupuesto de etiqueta actualizado: ' + cambios.join(', '))
    )
  }

  const next = {
    ...prev,
    etiquetaId,
    monto,
    actualizadoEn: ahora,
    historial
  }

  estado.categorias[idx] = next
  await guardarEstado(estado)
  return next
}

export async function eliminarPresupuestoCategoria(id) {
  const estado = await leerEstado()
  const idx = estado.categorias.findIndex((c) => c.id === id)
  if (idx === -1) return false
  const prev = estado.categorias[idx]
  const etiquetas = await listarEtiquetas()
  const etiqueta = etiquetas.find((e) => e.id === prev.etiquetaId)
  const nombre = etiqueta ? etiqueta.nombre : 'etiqueta'

  const ahora = new Date().toISOString()
  const general = estado.general
  if (general) {
    const historial = Array.isArray(general.historial) ? [...general.historial] : []
    historial.push(
      nuevoHistorialEntry('config', 'Presupuesto de etiqueta eliminado para ' + nombre)
    )
    estado.general = {
      ...general,
      actualizadoEn: ahora,
      historial
    }
  }

  estado.categorias.splice(idx, 1)
  await guardarEstado(estado)
  return true
}

export async function revisarPeriodosPresupuesto() {
  const estado = await leerEstado()
  if (!estado.general) return estado
  const general = estado.general
  if (!general.fechaInicio || !general.fechaFin) return estado
  const inicio = parseFecha(general.fechaInicio)
  const fin = parseFecha(general.fechaFin)
  if (!inicio || !fin) return estado

  const hoyFecha = hoy()
  if (fin >= hoyFecha) return estado

  const etiquetas = await listarEtiquetas()
  const mapEt = new Map(etiquetas.map((e) => [e.id, e]))
  const ops = await listarOperaciones()

  const diasPeriodo = general.diasPeriodo || Math.max(1, Math.round((fin.getTime() - inicio.getTime()) / 86400000) + 1)

  let desde = inicio
  let hasta = fin
  let historial = Array.isArray(general.historial) ? [...general.historial] : []

  function gastoPeriodo(fechaIni, fechaFin) {
    const iniT = fechaIni.getTime()
    const finT = fechaFin.getTime()
    let total = 0
    const porEtiqueta = new Map()
    ops.forEach((op) => {
      if (op.tipo !== 'gasto') return
      const d = parseFecha(op.fecha)
      if (!d) return
      const t = d.getTime()
      if (t < iniT || t > finT) return
      const cantidad = Number(op.cantidad || 0)
      total += cantidad
      if (op.etiquetaId) {
        const prev = porEtiqueta.get(op.etiquetaId) || 0
        porEtiqueta.set(op.etiquetaId, prev + cantidad)
      }
    })
    return { total, porEtiqueta }
  }

  while (hasta < hoyFecha) {
    const res = gastoPeriodo(desde, hasta)
    const fmt = (n) =>
      Number(n).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
    const cumplido = res.total <= Number(general.monto || 0)

    let detalle = 'Periodo ' + formatFechaISO(desde) + ' a ' + formatFechaISO(hasta) + '. '
    detalle += 'Gasto total ' + fmt(res.total) + ' sobre presupuesto ' + fmt(general.monto) + '. '
    detalle += cumplido ? 'Dentro del presupuesto.' : 'Se excedió el presupuesto.'

    historial.push(nuevoHistorialEntry('cierre', detalle))

    const tipo = general.tipoPeriodo || 'personalizado'
    let nextInicio, nextFin

    if (tipo === 'mensual') {
      nextInicio = new Date(desde.getFullYear(), desde.getMonth() + 1, 1)
      nextFin = new Date(desde.getFullYear(), desde.getMonth() + 2, 0)
    } else if (tipo === 'semanal') {
      nextInicio = new Date(desde.getTime() + 7 * 86400000)
      nextFin = new Date(hasta.getTime() + 7 * 86400000)
    } else if (tipo === 'anual') {
      nextInicio = new Date(desde.getFullYear() + 1, 0, 1)
      nextFin = new Date(desde.getFullYear() + 1, 11, 31)
    } else { // 'personalizado'
      nextInicio = new Date(hasta.getTime() + 86400000)
      nextFin = new Date(nextInicio.getTime() + (diasPeriodo - 1) * 86400000)
    }

    desde = nextInicio
    hasta = nextFin
  }

  const nuevoGeneral = {
    ...general,
    fechaInicio: formatFechaISO(desde),
    fechaFin: formatFechaISO(hasta),
    diasPeriodo,
    historial
  }

  estado.general = nuevoGeneral
  await guardarEstado(estado)
  return estado
}

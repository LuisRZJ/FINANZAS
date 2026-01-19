import { STORAGE_KEYS } from '../sistema/constantes.js'
import { leer, escribir } from './almacenamiento.js'
import { listarEtiquetas } from './etiquetas.js'
import { listarOperaciones } from './operaciones.js'
import { parseFecha, hoy, formatFechaISO } from '../sistema/fechas.js'


function leerEstado() {
  const raw = leer(STORAGE_KEYS.presupuestos, null)
  if (!raw || typeof raw !== 'object') {
    return {
      general: null,
      categorias: []
    }
  }
  if (!Array.isArray(raw.categorias)) raw.categorias = []
  return raw
}

function guardarEstado(estado) {
  escribir(STORAGE_KEYS.presupuestos, estado)
}

function nuevoHistorialEntry(tipo, mensaje) {
  return {
    fecha: new Date().toISOString(),
    tipo,
    mensaje
  }
}

export function obtenerPresupuestoGeneral() {
  const estado = leerEstado()
  return estado.general
}

export function listarPresupuestosCategorias() {
  const estado = leerEstado()
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

export function configurarPresupuestoGeneral(payload) {
  const monto = Number(payload?.monto || 0)
  const fechaInicioStr = String(payload?.fechaInicio || '').trim()
  const fechaFinStr = String(payload?.fechaFin || '').trim()

  if (!(monto > 0)) throw new Error('El monto del presupuesto general debe ser mayor que cero')
  if (!fechaInicioStr || !fechaFinStr) throw new Error('Debes definir fecha de inicio y fin del presupuesto general')

  const periodo = validarPeriodo(fechaInicioStr, fechaFinStr)

  const estado = leerEstado()
  const anterior = estado.general

  const totalCategorias = estado.categorias.reduce((acc, c) => acc + Number(c.monto || 0), 0)
  if (totalCategorias > monto) throw new Error('El monto del presupuesto general no puede ser menor que la suma de los presupuestos por etiqueta')

  const ahora = new Date().toISOString()
  const historial = anterior && Array.isArray(anterior.historial) ? [...anterior.historial] : []

  if (!anterior) {
    historial.push(nuevoHistorialEntry('creacion', 'Presupuesto general creado'))
  } else {
    const cambios = []
    if (Number(anterior.monto || 0) !== monto) cambios.push('monto')
    if (anterior.fechaInicio !== fechaInicioStr) cambios.push('fechaInicio')
    if (anterior.fechaFin !== fechaFinStr) cambios.push('fechaFin')
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
    fechaInicio: fechaInicioStr,
    fechaFin: fechaFinStr,
    diasPeriodo: periodo.dias,
    creadoEn: anterior?.creadoEn || ahora,
    actualizadoEn: ahora,
    historial
  }

  estado.general = general
  guardarEstado(estado)
  return general
}

export function calcularResumenPresupuestoActual() {
  const estado = leerEstado()
  const general = estado.general
  if (!general) {
    return {
      general: null,
      categorias: [],
      totalCategorias: 0,
      restanteAsignar: 0,
      gastoTotalPeriodo: 0
    }
  }

  const inicio = parseFecha(general.fechaInicio)
  const fin = parseFecha(general.fechaFin)
  const ops = listarOperaciones()
  const etiquetas = listarEtiquetas()
  const mapEt = new Map(etiquetas.map((e) => [e.id, e]))

  function dentroPeriodo(fechaStr) {
    const d = parseFecha(fechaStr)
    if (!d || !inicio || !fin) return false
    const t = d.getTime()
    return t >= inicio.getTime() && t <= fin.getTime()
  }

  // Función para obtener todos los ancestros de una etiqueta (incluyendo ella misma)
  // PROTECCIÓN: Detecta referencias circulares para evitar loop infinito
  function obtenerAncestros(etiquetaId) {
    const ancestros = [etiquetaId]
    const visitados = new Set([etiquetaId]) // Para detectar ciclos
    let actual = mapEt.get(etiquetaId)

    while (actual && actual.padreId) {
      // Protección contra referencias circulares
      if (visitados.has(actual.padreId)) {
        console.warn(`[Presupuestos] Referencia circular detectada en etiqueta ${actual.padreId}. Se detuvo la búsqueda de ancestros.`)
        break
      }
      ancestros.push(actual.padreId)
      visitados.add(actual.padreId)
      actual = mapEt.get(actual.padreId)
    }
    return ancestros
  }

  // Separamos gastos PAGADOS (reales) de PENDIENTES (comprometidos/proyectados)
  const gastoPorEtiqueta = new Map() // Solo pagados
  const gastoComprometidoPorEtiqueta = new Map() // Solo pendientes

  let gastoTotalPeriodo = 0 // Solo pagados
  let gastoComprometidoTotal = 0 // Solo pendientes

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
      // Sumar el gasto a la etiqueta directa Y a todos sus ancestros (padres)
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
    const restante = Number(c.monto || 0) - gastado // Solo resta lo realmente gastado
    const restanteProyectado = Number(c.monto || 0) - gastado - comprometido // Incluyendo pendientes
    return {
      ...c,
      etiquetaNombre: et ? et.nombre : 'Etiqueta eliminada',
      etiquetaColor: et ? et.color : '#64748b',
      gastado, // Solo operaciones pagadas
      comprometido, // Operaciones pendientes (futuras)
      restante, // Restante real
      restanteProyectado // Restante incluyendo comprometido
    }
  })

  const totalCategorias = categorias.reduce((acc, c) => acc + Number(c.monto || 0), 0)
  const restanteAsignar = Number(general.monto || 0) - totalCategorias

  return {
    general,
    categorias,
    totalCategorias,
    restanteAsignar,
    gastoTotalPeriodo, // Solo pagados
    gastoComprometidoTotal // Solo pendientes (proyección)
  }
}

export function crearPresupuestoCategoria(payload) {
  const estado = leerEstado()
  if (!estado.general) throw new Error('Primero debes definir un presupuesto general')

  const etiquetaId = String(payload?.etiquetaId || '').trim()
  const monto = Number(payload?.monto || 0)
  if (!etiquetaId) throw new Error('Debes seleccionar una etiqueta de gasto')
  if (!(monto > 0)) throw new Error('El monto del presupuesto debe ser mayor que cero')

  const etiquetas = listarEtiquetas().filter((e) => e.tipo === 'gasto')
  const etiqueta = etiquetas.find((e) => e.id === etiquetaId)
  if (!etiqueta) throw new Error('Etiqueta de gasto no encontrada')

  const existente = estado.categorias.find((c) => c.etiquetaId === etiquetaId)
  if (existente) throw new Error('Ya existe un presupuesto para esta etiqueta')

  const resumen = calcularResumenPresupuestoActual()
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
  guardarEstado(estado)
  return categoria
}

export function actualizarPresupuestoCategoria(id, payload) {
  const estado = leerEstado()
  if (!estado.general) throw new Error('Primero debes definir un presupuesto general')
  const idx = estado.categorias.findIndex((c) => c.id === id)
  if (idx === -1) throw new Error('Presupuesto de etiqueta no encontrado')
  const prev = estado.categorias[idx]

  const etiquetaId = payload?.etiquetaId !== undefined ? String(payload.etiquetaId).trim() : prev.etiquetaId
  const monto = payload?.monto !== undefined ? Number(payload.monto) : prev.monto

  if (!etiquetaId) throw new Error('Debes seleccionar una etiqueta de gasto')
  if (!(monto > 0)) throw new Error('El monto del presupuesto debe ser mayor que cero')

  const etiquetas = listarEtiquetas().filter((e) => e.tipo === 'gasto')
  const etiqueta = etiquetas.find((e) => e.id === etiquetaId)
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
  guardarEstado(estado)
  return next
}

export function eliminarPresupuestoCategoria(id) {
  const estado = leerEstado()
  const idx = estado.categorias.findIndex((c) => c.id === id)
  if (idx === -1) return false
  const prev = estado.categorias[idx]
  const etiquetas = listarEtiquetas()
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
  guardarEstado(estado)
  return true
}

export function revisarPeriodosPresupuesto() {
  const estado = leerEstado()
  if (!estado.general) return estado
  const general = estado.general
  if (!general.fechaInicio || !general.fechaFin) return estado
  const inicio = parseFecha(general.fechaInicio)
  const fin = parseFecha(general.fechaFin)
  if (!inicio || !fin) return estado

  const hoyFecha = hoy()
  if (fin >= hoyFecha) return estado

  const etiquetas = listarEtiquetas()
  const mapEt = new Map(etiquetas.map((e) => [e.id, e]))
  const ops = listarOperaciones()

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

    const nextInicio = new Date(hasta.getTime() + 86400000)
    const nextFin = new Date(nextInicio.getTime() + (diasPeriodo - 1) * 86400000)
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
  guardarEstado(estado)
  return estado
}


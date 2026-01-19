// Servicio de Recurrencias - GTR Finanzas
import { STORAGE_KEYS } from '../sistema/constantes.js'
import { leer, escribir } from './almacenamiento.js'
import { listarOperaciones, crearIngreso, crearGasto, crearTransferencia } from './operaciones.js'

// === ALMACENAMIENTO ===

function uid() {
    return 'rec_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

function obtenerTodas() {
    const data = leer(STORAGE_KEYS.recurrencias, [])
    return Array.isArray(data) ? data : []
}

function guardarTodas(list) {
    return escribir(STORAGE_KEYS.recurrencias, list)
}

export function listarRecurrencias() {
    return obtenerTodas()
}

export function listarRecurrenciasActivas() {
    return obtenerTodas().filter(r => r.activa)
}

// === HELPERS DE FECHA ===

/**
 * Convierte una fecha a formato ISO local (sin conversión a UTC).
 * Evita el desfase de timezone que causa toISOString().
 * @param {Date} date
 * @returns {string} Formato YYYY-MM-DDTHH:MM
 */
function toLocalISOString(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
}

// === CÁLCULO DE FECHAS ===

/**
 * Calcula la próxima fecha de ocurrencia para una recurrencia.
 * Maneja correctamente el desbordamiento de meses (ej. 31 Enero + 1 mes = 28/29 Feb)
 */
export function calcularProximaFecha(recurrencia) {
    const ultima = new Date(recurrencia.ultimaFechaGenerada)
    const diaOriginal = new Date(recurrencia.fechaInicio).getDate()

    // Caso especial: último día del mes
    // IMPORTANTE: Debe respetar frecuenciaValor (ej: trimestral = cada 3 meses)
    if (recurrencia.ultimoDiaMes) {
        // Calcular cuántos meses avanzar según el tipo de frecuencia
        let mesesAvanzar = 1
        if (recurrencia.frecuenciaTipo === 'meses') {
            mesesAvanzar = recurrencia.frecuenciaValor || 1
        } else if (recurrencia.frecuenciaTipo === 'anios') {
            mesesAvanzar = (recurrencia.frecuenciaValor || 1) * 12
        }
        // Para días/semanas, ultimoDiaMes no tiene sentido lógico pero por compatibilidad avanzamos 1 mes

        // El truco: mes + mesesAvanzar + 1, día 0 = último día del mes objetivo
        const nextMonth = new Date(ultima.getFullYear(), ultima.getMonth() + mesesAvanzar + 1, 0)
        if (recurrencia.horaPreferida) {
            const [h, m] = recurrencia.horaPreferida.split(':').map(Number)
            nextMonth.setHours(h, m, 0, 0)
        }
        return nextMonth
    }

    let resultado = new Date(ultima)

    switch (recurrencia.frecuenciaTipo) {
        case 'dias':
            resultado.setDate(resultado.getDate() + recurrencia.frecuenciaValor)
            break

        case 'semanas':
            resultado.setDate(resultado.getDate() + (recurrencia.frecuenciaValor * 7))
            break

        case 'meses': {
            // Avanzar mes primero (guardando el año/mes actual para cálculo)
            const targetMonth = resultado.getMonth() + recurrencia.frecuenciaValor
            resultado.setMonth(targetMonth)

            // Ajustar día si hay desbordamiento (ej. 31 Enero + 1 mes → 28/29 Feb, no 3 Marzo)
            const maxDia = new Date(resultado.getFullYear(), resultado.getMonth() + 1, 0).getDate()
            resultado.setDate(Math.min(diaOriginal, maxDia))
            break
        }

        case 'anios': {
            resultado.setFullYear(resultado.getFullYear() + recurrencia.frecuenciaValor)
            // Manejar 29 Feb en años no bisiestos
            const maxDiaAnio = new Date(resultado.getFullYear(), resultado.getMonth() + 1, 0).getDate()
            resultado.setDate(Math.min(diaOriginal, maxDiaAnio))
            break
        }
    }

    // Aplicar hora preferida
    if (recurrencia.horaPreferida) {
        const [h, m] = recurrencia.horaPreferida.split(':').map(Number)
        resultado.setHours(h, m, 0, 0)
    }

    return resultado
}

// === GENERACIÓN DE INSTANCIAS ===

/**
 * Crea una operación a partir de una plantilla de recurrencia.
 * @private
 */
function crearOperacionDesdeRecurrencia(rec, cicloNumero, fecha) {
    // Usar toLocalISOString para evitar desfase de timezone
    const fechaStr = toLocalISOString(fecha)

    const payloadBase = {
        nombre: rec.nombre,
        descripcion: rec.descripcion || '',
        cantidad: rec.cantidad,
        fecha: fechaStr,
        // Campos de recurrencia para la operación
        recurrenciaId: rec.id,
        cicloNumero: cicloNumero
    }

    if (rec.tipo === 'ingreso') {
        return crearIngreso({
            ...payloadBase,
            cuentaId: rec.cuentaId,
            etiquetaId: rec.etiquetaId
        })
    } else if (rec.tipo === 'gasto') {
        return crearGasto({
            ...payloadBase,
            cuentaId: rec.cuentaId,
            etiquetaId: rec.etiquetaId
        })
    } else if (rec.tipo === 'transferencia') {
        return crearTransferencia({
            ...payloadBase,
            origenId: rec.origenId,
            destinoId: rec.destinoId
        })
    }
}

/**
 * Verifica si una recurrencia ha alcanzado su límite.
 */
function haAlcanzadoLimite(rec) {
    if (rec.finTipo === 'nunca') return false

    if (rec.finTipo === 'ciclos') {
        return rec.ciclosGenerados >= rec.finCiclos
    }

    if (rec.finTipo === 'fecha') {
        const proximaFecha = calcularProximaFecha(rec)
        return proximaFecha > new Date(rec.finFecha)
    }

    return false
}

/**
 * Genera instancias de operaciones para recurrencias activas.
 * IDEMPOTENTE: Verifica si ya existe una operación para el ciclo antes de crear.
 * 
 * LÍMITES DE SEGURIDAD:
 * - Horizonte de proyección: 6 meses (evita generar años de datos)
 * - Máximo por recurrencia por ejecución: 200 operaciones (evita loops infinitos)
 * 
 * @returns {boolean} true si se generaron cambios
 */
export function generarInstanciasRecurrentes() {
    const ahora = new Date()

    // LÍMITE DE PROYECCIÓN: 6 meses en el futuro
    // Esto es suficiente para visualización y evita generar miles de operaciones
    const limiteProyeccion = new Date()
    limiteProyeccion.setMonth(limiteProyeccion.getMonth() + 6)

    // LÍMITE DE SEGURIDAD: Máximo operaciones a generar por recurrencia por ejecución
    const MAX_OPERACIONES_POR_RECURRENCIA = 200

    const recurrencias = obtenerTodas()
    const operaciones = listarOperaciones()
    let huboCambios = false

    for (const rec of recurrencias) {
        if (!rec.activa) continue

        // Contador de seguridad para esta recurrencia
        let operacionesGeneradas = 0

        // Generar instancias hasta el límite de proyección
        let continuar = true
        while (continuar) {
            // PROTECCIÓN: Evitar generar demasiadas operaciones de golpe
            if (operacionesGeneradas >= MAX_OPERACIONES_POR_RECURRENCIA) {
                console.warn(`[Recurrencias] Límite de seguridad alcanzado para recurrencia ${rec.id}. Se generaron ${operacionesGeneradas} operaciones.`)
                break
            }

            const proximaFecha = calcularProximaFecha(rec)

            if (proximaFecha <= limiteProyeccion) {
                const proximoCiclo = rec.ciclosGenerados + 1

                // === VERIFICACIÓN DE IDEMPOTENCIA ===
                const yaExiste = operaciones.some(op =>
                    op.recurrenciaId === rec.id &&
                    op.cicloNumero === proximoCiclo
                )

                // Verificar si este ciclo tiene una excepción manual (no regenerar)
                const esExcepcion = Array.isArray(rec._ciclosExcluidos) &&
                    rec._ciclosExcluidos.includes(proximoCiclo)

                if (yaExiste || esExcepcion) {
                    // Si ya existe o es excepción, solo actualizar contadores si es necesario
                    if (rec.ciclosGenerados < proximoCiclo) {
                        rec.ciclosGenerados = proximoCiclo
                        rec.ultimaFechaGenerada = proximaFecha.toISOString()
                        huboCambios = true
                    }
                    // Verificar si podemos seguir o hemos alcanzado el límite
                    if (haAlcanzadoLimite(rec)) {
                        rec.activa = false
                        continuar = false
                    }
                    continue
                }
                // === FIN VERIFICACIÓN ===

                // Crear la operación
                try {
                    const opCreada = crearOperacionDesdeRecurrencia(rec, proximoCiclo, proximaFecha)
                    operaciones.push(opCreada) // Añadir a lista local para futura verificación

                    rec.ciclosGenerados = proximoCiclo
                    rec.ultimaFechaGenerada = proximaFecha.toISOString()
                    huboCambios = true
                    operacionesGeneradas++

                    // Verificar si alcanzó el límite
                    if (haAlcanzadoLimite(rec)) {
                        rec.activa = false
                        continuar = false
                    }
                } catch (err) {
                    console.error(`Error generando ciclo ${proximoCiclo} de recurrencia ${rec.id}:`, err)
                    continuar = false
                }
            } else {
                // La próxima fecha supera el límite de proyección
                continuar = false
            }
        }
    }

    if (huboCambios) {
        guardarTodas(recurrencias)
    }

    return huboCambios
}

// === CRUD DE RECURRENCIAS ===

/**
 * Crea una nueva recurrencia y genera su primera instancia si corresponde.
 */
export function crearRecurrencia(payload) {
    const nombre = String(payload?.nombre || '').trim()
    const tipo = String(payload?.tipo || '').trim()
    const cantidad = Number(payload?.cantidad || 0)
    const fechaInicio = String(payload?.fechaInicio || '').trim()

    if (!nombre || !tipo || !fechaInicio || !(cantidad > 0)) {
        throw new Error('Datos de recurrencia inválidos')
    }

    const now = new Date().toISOString()

    const rec = {
        id: uid(),

        // Operación plantilla
        tipo: tipo,
        nombre: nombre,
        descripcion: String(payload?.descripcion || '').trim(),
        cantidad: cantidad,
        cuentaId: payload?.cuentaId || null,
        etiquetaId: payload?.etiquetaId || null,
        origenId: payload?.origenId || null,
        destinoId: payload?.destinoId || null,

        // Reglas de recurrencia
        activa: true,
        fechaInicio: fechaInicio,
        horaPreferida: payload?.horaPreferida || '12:00',

        frecuenciaTipo: payload?.frecuenciaTipo || 'meses',
        frecuenciaValor: Number(payload?.frecuenciaValor || 1),
        ultimoDiaMes: Boolean(payload?.ultimoDiaMes),

        finTipo: payload?.finTipo || 'nunca',
        finCiclos: payload?.finCiclos ? Number(payload.finCiclos) : null,
        finFecha: payload?.finFecha || null,

        // Metadatos
        ciclosGenerados: 0,
        ultimaFechaGenerada: null, // Se establecerá al crear la primera instancia
        creadaEn: now
    }

    const list = obtenerTodas()
    list.push(rec)
    guardarTodas(list)

    // Establecer fecha inicial para cálculos
    // La "última fecha generada" antes del primer ciclo es un ciclo antes de fechaInicio
    // Esto permite que calcularProximaFecha devuelva fechaInicio como primera ocurrencia
    rec.ultimaFechaGenerada = calcularFechaAnterior(rec).toISOString()
    guardarTodas(list)

    return rec
}

/**
 * Calcula la fecha anterior a la primera ocurrencia (para inicialización)
 * @private
 */
function calcularFechaAnterior(rec) {
    const inicio = new Date(rec.fechaInicio + 'T' + (rec.horaPreferida || '12:00'))

    if (rec.ultimoDiaMes) {
        return new Date(inicio.getFullYear(), inicio.getMonth(), 0)
    }

    const resultado = new Date(inicio)
    switch (rec.frecuenciaTipo) {
        case 'dias':
            resultado.setDate(resultado.getDate() - rec.frecuenciaValor)
            break
        case 'semanas':
            resultado.setDate(resultado.getDate() - (rec.frecuenciaValor * 7))
            break
        case 'meses':
            resultado.setMonth(resultado.getMonth() - rec.frecuenciaValor)
            break
        case 'anios':
            resultado.setFullYear(resultado.getFullYear() - rec.frecuenciaValor)
            break
    }
    return resultado
}

/**
 * Actualiza una recurrencia existente.
 * Limpia las operaciones futuras (pendientes) y regenera con las nuevas reglas.
 */
export function actualizarRecurrencia(id, payload) {
    const list = obtenerTodas()
    const idx = list.findIndex(r => r.id === id)
    if (idx === -1) throw new Error('Recurrencia no encontrada')

    const prev = list[idx]
    const updated = { ...prev, ...payload, id: prev.id, creadaEn: prev.creadaEn }

    list[idx] = updated
    guardarTodas(list)

    // === LÓGICA DE REGENERACIÓN (Limpieza de Zombis) ===
    // Solo si la recurrencia sigue activa, regeneramos el futuro
    if (updated.activa) {
        const ops = listarOperaciones()

        // a) Identificar operaciones modificadas manualmente (excepciones)
        // Estas NO se borran, son decisiones explícitas del usuario
        const excepcionesIds = new Set(
            ops.filter(op =>
                op.recurrenciaId === id &&
                op.estado === 'pendiente' &&
                op.modificadaManualmente === true
            ).map(op => op.id)
        )

        // b) Borrar futuras pendientes que NO fueron modificadas manualmente
        const opsLimpias = ops.filter(op => {
            // Mantener si NO es de esta recurrencia
            if (op.recurrenciaId !== id) return true
            // Mantener si ya está pagada (historial)
            if (op.estado !== 'pendiente') return true
            // Mantener si fue modificada manualmente (excepción del usuario)
            if (op.modificadaManualmente === true) return true
            // Borrar: es pendiente sin modificar
            return false
        })
        escribir(STORAGE_KEYS.operaciones, opsLimpias)

        // c) Recalcular ciclosGenerados basándose en operaciones reales que quedaron
        const opsRestantes = opsLimpias.filter(op => op.recurrenciaId === id)
        const maxCiclo = opsRestantes.reduce((max, op) => Math.max(max, op.cicloNumero || 0), 0)

        // d) Obtener los ciclos que tienen excepciones (para no regenerarlos)
        const ciclosConExcepcion = new Set(
            opsRestantes
                .filter(op => op.modificadaManualmente === true)
                .map(op => op.cicloNumero)
        )

        // Actualizar contadores de la recurrencia
        updated.ciclosGenerados = maxCiclo
        // Guardar los ciclos con excepciones para que el generador los salte
        updated._ciclosExcluidos = Array.from(ciclosConExcepcion)
        list[idx] = updated
        guardarTodas(list)

        // e) Regenerar con las nuevas reglas (el generador respetará _ciclosExcluidos)
        generarInstanciasRecurrentes()

        // Limpiar campo temporal
        delete updated._ciclosExcluidos
        list[idx] = updated
        guardarTodas(list)
    }

    return updated
}

/**
 * Desactiva una recurrencia y limpia todas las operaciones futuras pendientes.
 * Las operaciones ya pagadas (historial) se mantienen.
 */
export function desactivarRecurrencia(id) {
    // 1. Limpiar operaciones futuras pendientes vinculadas a esta recurrencia
    const ops = listarOperaciones()
    const opsRestantes = ops.filter(op => {
        if (op.recurrenciaId !== id) return true
        // Mantener solo las pagadas (pasadas)
        return op.estado === 'pagado'
    })
    escribir(STORAGE_KEYS.operaciones, opsRestantes)

    // 2. Desactivar la plantilla
    return actualizarRecurrencia(id, { activa: false })
}

/**
 * Reactiva una recurrencia pausada.
 */
export function reactivarRecurrencia(id) {
    return actualizarRecurrencia(id, { activa: true })
}

/**
 * Elimina la plantilla de recurrencia.
 * Las operaciones existentes mantienen sus datos pero pierden el vínculo (recurrenciaId se vuelve huérfano localmente).
 */
export function eliminarRecurrencia(id) {
    const list = obtenerTodas()
    const next = list.filter(r => r.id !== id)
    guardarTodas(next)
    return true
}

/**
 * Elimina la recurrencia Y todas sus operaciones asociadas.
 */
export function eliminarRecurrenciaCompleta(id) {
    // Importar dinámicamente para evitar dependencia circular
    const ops = listarOperaciones()
    const opsRestantes = ops.filter(op => op.recurrenciaId !== id)
    escribir(STORAGE_KEYS.operaciones, opsRestantes)

    return eliminarRecurrencia(id)
}

/**
 * Elimina operaciones de una recurrencia desde un ciclo específico en adelante.
 */
export function eliminarDesdeciCiclo(recurrenciaId, desdeCiclo) {
    const ops = listarOperaciones()
    const opsRestantes = ops.filter(op =>
        op.recurrenciaId !== recurrenciaId ||
        (op.cicloNumero && op.cicloNumero < desdeCiclo)
    )
    escribir(STORAGE_KEYS.operaciones, opsRestantes)

    // Actualizar contadores de la recurrencia
    const list = obtenerTodas()
    const rec = list.find(r => r.id === recurrenciaId)
    if (rec && desdeCiclo <= 1) {
        // Si eliminamos desde el ciclo 1, desactivamos
        rec.activa = false
        rec.ciclosGenerados = 0
    } else if (rec) {
        rec.ciclosGenerados = desdeCiclo - 1
        // Recalcular ultimaFechaGenerada sería complejo, la dejamos como está
    }
    guardarTodas(list)
}

/**
 * Obtiene una recurrencia por su ID.
 */
export function obtenerRecurrencia(id) {
    return obtenerTodas().find(r => r.id === id) || null
}

// Servicio de Recurrencias - GTR Finanzas
import { STORAGE_KEYS } from '../sistema/constantes.js'
import { leer, escribir } from './almacenamiento.js'
import { listarOperaciones, crearIngreso, crearGasto, crearTransferencia, revertirEfecto } from './operaciones.js'

function uid() {
    return 'rec_' + Math.random().toString(36).slice(2) + Date.now().toString(36)
}

async function obtenerTodas() {
    const data = await leer(STORAGE_KEYS.recurrencias, [])
    return Array.isArray(data) ? data : []
}

async function guardarTodas(list) {
    return await escribir(STORAGE_KEYS.recurrencias, list)
}

export async function listarRecurrencias() {
    return await obtenerTodas()
}

export async function listarRecurrenciasActivas() {
    const todas = await obtenerTodas()
    return todas.filter(r => r.activa)
}

function toLocalISOString(date) {
    const year = date.getFullYear()
    const month = String(date.getMonth() + 1).padStart(2, '0')
    const day = String(date.getDate()).padStart(2, '0')
    const hours = String(date.getHours()).padStart(2, '0')
    const minutes = String(date.getMinutes()).padStart(2, '0')
    return `${year}-${month}-${day}T${hours}:${minutes}`
}

export function calcularProximaFecha(recurrencia) {
    const ultima = new Date(recurrencia.ultimaFechaGenerada)
    const diaOriginal = parseInt(recurrencia.fechaInicio.split('-')[2], 10)

    if (recurrencia.ultimoDiaMes) {
        // "Último día del mes" solo es compatible con frecuencia en meses o años
        if (recurrencia.frecuenciaTipo !== 'meses' && recurrencia.frecuenciaTipo !== 'anios') {
            console.warn(`ultimoDiaMes no es compatible con frecuencia "${recurrencia.frecuenciaTipo}". Se usará avance mensual por defecto.`)
        }
        let mesesAvanzar = 1
        if (recurrencia.frecuenciaTipo === 'meses') {
            mesesAvanzar = recurrencia.frecuenciaValor || 1
        } else if (recurrencia.frecuenciaTipo === 'anios') {
            mesesAvanzar = (recurrencia.frecuenciaValor || 1) * 12
        }

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
            // Fijar día a 1 antes de cambiar mes para evitar overflow de JS
            // (ej: 31 enero + setMonth(1) sin esto → 3 marzo en vez de 28 febrero)
            const mesActual = resultado.getMonth()
            resultado.setDate(1)
            resultado.setMonth(mesActual + recurrencia.frecuenciaValor)

            const maxDia = new Date(resultado.getFullYear(), resultado.getMonth() + 1, 0).getDate()
            resultado.setDate(Math.min(diaOriginal, maxDia))
            break
        }

        case 'anios': {
            // Misma protección contra overflow de día
            resultado.setDate(1)
            resultado.setFullYear(resultado.getFullYear() + recurrencia.frecuenciaValor)
            const maxDiaAnio = new Date(resultado.getFullYear(), resultado.getMonth() + 1, 0).getDate()
            resultado.setDate(Math.min(diaOriginal, maxDiaAnio))
            break
        }
    }

    if (recurrencia.horaPreferida) {
        const [h, m] = recurrencia.horaPreferida.split(':').map(Number)
        resultado.setHours(h, m, 0, 0)
    }

    return resultado
}

async function crearOperacionDesdeRecurrencia(rec, cicloNumero, fecha) {
    const fechaStr = toLocalISOString(fecha)

    const payloadBase = {
        nombre: rec.nombre,
        descripcion: rec.descripcion || '',
        cantidad: rec.cantidad,
        fecha: fechaStr,
        recurrenciaId: rec.id,
        cicloNumero: cicloNumero
    }

    if (rec.tipo === 'ingreso') {
        return await crearIngreso({
            ...payloadBase,
            cuentaId: rec.cuentaId,
            etiquetaId: rec.etiquetaId
        })
    } else if (rec.tipo === 'gasto') {
        return await crearGasto({
            ...payloadBase,
            cuentaId: rec.cuentaId,
            etiquetaId: rec.etiquetaId
        })
    } else if (rec.tipo === 'transferencia') {
        return await crearTransferencia({
            ...payloadBase,
            origenId: rec.origenId,
            destinoId: rec.destinoId
        })
    }
}

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

function calcularLimiteProyeccion(rec) {
    const limite = new Date()
    limite.setHours(23, 59, 59, 999)

    let mesesBase = 6
    switch (rec.frecuenciaTipo) {
        case 'dias':
            mesesBase = 1
            break
        case 'semanas':
            mesesBase = 3
            break
        case 'meses':
            mesesBase = 12
            break
        case 'anios':
            mesesBase = 24
            break
    }

    const valor = rec.frecuenciaValor || 1
    let mesesCiclos = 0
    switch (rec.frecuenciaTipo) {
        case 'dias':
            mesesCiclos = Math.ceil((valor * 2) / 30)
            break
        case 'semanas':
            mesesCiclos = Math.ceil((valor * 2) / 4.3)
            break
        case 'meses':
            mesesCiclos = valor * 2
            break
        case 'anios':
            mesesCiclos = valor * 12 * 2
            break
    }

    const mesesFinales = Math.max(mesesBase, mesesCiclos)
    limite.setMonth(limite.getMonth() + mesesFinales)
    return limite
}

export async function generarInstanciasRecurrentes() {
    const ahora = new Date()
    const MAX_OPERACIONES_POR_RECURRENCIA = 200

    const recurrencias = await obtenerTodas()
    let operaciones = await listarOperaciones()
    let huboCambiosRecurrencias = false
    let huboCambiosOperaciones = false

    // Podar operaciones que exceden el nuevo límite dinámico para cada recurrencia activa
    for (const rec of recurrencias) {
        if (!rec.activa) continue

        const limiteProyeccion = calcularLimiteProyeccion(rec)

        const opsExcedentes = operaciones.filter(op =>
            op.recurrenciaId === rec.id &&
            op.estado === 'pendiente' &&
            op.modificadaManualmente !== true &&
            new Date(op.fecha.includes('T') ? op.fecha : op.fecha + 'T23:59:59') > limiteProyeccion
        )

        if (opsExcedentes.length > 0) {
            const excedentesIds = new Set(opsExcedentes.map(op => op.id))
            operaciones = operaciones.filter(op => !excedentesIds.has(op.id))
            huboCambiosOperaciones = true

            const opsRestantes = operaciones.filter(op => op.recurrenciaId === rec.id)
            const maxCiclo = opsRestantes.reduce((max, op) => Math.max(max, op.cicloNumero || 0), 0)
            rec.ciclosGenerados = maxCiclo

            if (opsRestantes.length > 0) {
                const fechaMax = opsRestantes.reduce((max, op) => {
                    const f = new Date(op.fecha)
                    return f > max ? f : max
                }, new Date(0))
                rec.ultimaFechaGenerada = toLocalISOString(fechaMax)
            } else {
                rec.ultimaFechaGenerada = toLocalISOString(calcularFechaAnterior(rec))
            }
            huboCambiosRecurrencias = true
        }
    }

    if (huboCambiosOperaciones) {
        await escribir(STORAGE_KEYS.operaciones, operaciones)
    }

    for (const rec of recurrencias) {
        if (!rec.activa) continue

        let operacionesGeneradas = 0
        let continuar = true
        const limiteProyeccion = calcularLimiteProyeccion(rec)

        while (continuar) {
            if (operacionesGeneradas >= MAX_OPERACIONES_POR_RECURRENCIA) {
                console.warn(`[Recurrencias] Límite de seguridad alcanzado para recurrencia ${rec.id}. Se generaron ${operacionesGeneradas} operaciones.`)
                break
            }

            const proximaFecha = calcularProximaFecha(rec)

            if (proximaFecha <= limiteProyeccion) {
                const proximoCiclo = rec.ciclosGenerados + 1

                const yaExiste = operaciones.some(op =>
                    op.recurrenciaId === rec.id &&
                    op.cicloNumero === proximoCiclo
                )

                const esExcepcion = Array.isArray(rec._ciclosExcluidos) &&
                    rec._ciclosExcluidos.includes(proximoCiclo)

                if (yaExiste || esExcepcion) {
                    if (rec.ciclosGenerados < proximoCiclo) {
                        rec.ciclosGenerados = proximoCiclo
                        rec.ultimaFechaGenerada = toLocalISOString(proximaFecha)
                        huboCambiosRecurrencias = true
                    }
                    if (haAlcanzadoLimite(rec)) {
                        rec.activa = false
                        continuar = false
                    }
                    continue
                }

                try {
                    const opCreada = await crearOperacionDesdeRecurrencia(rec, proximoCiclo, proximaFecha)
                    operaciones.push(opCreada)

                    rec.ciclosGenerados = proximoCiclo
                    rec.ultimaFechaGenerada = toLocalISOString(proximaFecha)
                    huboCambiosRecurrencias = true
                    operacionesGeneradas++

                    if (haAlcanzadoLimite(rec)) {
                        rec.activa = false
                        continuar = false
                    }
                } catch (err) {
                    console.error(`Error generando ciclo ${proximoCiclo} de recurrencia ${rec.id}:`, err)
                    continuar = false
                }
            } else {
                continuar = false
            }
        }
    }

    if (huboCambiosRecurrencias) {
        await guardarTodas(recurrencias)
    }

    return huboCambiosRecurrencias
}

export async function crearRecurrencia(payload) {
    const nombre = String(payload?.nombre || '').trim()
    const tipo = String(payload?.tipo || '').trim()
    const cantidad = Number(payload?.cantidad || 0)
    const fechaInicio = String(payload?.fechaInicio || '').trim()

    if (!nombre || !tipo || !fechaInicio || !(cantidad > 0)) {
        throw new Error('Datos de recurrencia inválidos')
    }

    const now = new Date().toISOString()
    const recId = uid()

    const rec = {
        id: recId,
        tipo: tipo,
        nombre: nombre,
        descripcion: String(payload?.descripcion || '').trim(),
        cantidad: cantidad,
        cuentaId: payload?.cuentaId || null,
        etiquetaId: payload?.etiquetaId || null,
        origenId: payload?.origenId || null,
        destinoId: payload?.destinoId || null,

        activa: true,
        fechaInicio: fechaInicio,
        horaPreferida: payload?.horaPreferida || '12:00',

        frecuenciaTipo: payload?.frecuenciaTipo || 'meses',
        frecuenciaValor: Number(payload?.frecuenciaValor || 1),
        ultimoDiaMes: Boolean(payload?.ultimoDiaMes),

        finTipo: payload?.finTipo || 'nunca',
        finCiclos: payload?.finCiclos ? Number(payload.finCiclos) : null,
        finFecha: payload?.finFecha || null,

        ciclosGenerados: 0,
        ultimaFechaGenerada: null, 
        creadaEn: now
    }

    // Calcular ultimaFechaGenerada antes de guardar para evitar doble escritura
    rec.ultimaFechaGenerada = toLocalISOString(calcularFechaAnterior(rec))

    const list = await obtenerTodas()
    list.push(rec)
    await guardarTodas(list)

    return rec
}

function calcularFechaAnterior(rec) {
    const inicio = new Date(rec.fechaInicio + 'T' + (rec.horaPreferida || '12:00'))
    const diaOriginal = parseInt(rec.fechaInicio.split('-')[2], 10)

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
        case 'meses': {
            // Misma protección anti-overflow que calcularProximaFecha
            const mesActual = resultado.getMonth()
            resultado.setDate(1)
            resultado.setMonth(mesActual - rec.frecuenciaValor)
            const maxDia = new Date(resultado.getFullYear(), resultado.getMonth() + 1, 0).getDate()
            resultado.setDate(Math.min(diaOriginal, maxDia))
            break
        }
        case 'anios': {
            resultado.setDate(1)
            resultado.setFullYear(resultado.getFullYear() - rec.frecuenciaValor)
            const maxDiaAnio = new Date(resultado.getFullYear(), resultado.getMonth() + 1, 0).getDate()
            resultado.setDate(Math.min(diaOriginal, maxDiaAnio))
            break
        }
    }
    return resultado
}

export async function actualizarRecurrencia(id, payload, excluirOperacionId = null) {
    const list = await obtenerTodas()
    const idx = list.findIndex(r => r.id === id)
    if (idx === -1) throw new Error('Recurrencia no encontrada')

    const prev = list[idx]
    const updated = { ...prev, ...payload, id: prev.id, creadaEn: prev.creadaEn }
    list[idx] = updated

    if (!updated.activa) {
        // Si no está activa, solo guardar y salir
        await guardarTodas(list)
        return updated
    }

    {
        const ops = await listarOperaciones()

        const excepcionesIds = new Set(
            ops.filter(op =>
                op.recurrenciaId === id &&
                op.estado === 'pendiente' &&
                op.modificadaManualmente === true
            ).map(op => op.id)
        )

        const opsLimpias = ops.filter(op => {
            if (op.recurrenciaId !== id) return true
            if (op.id === excluirOperacionId) return true // Preservar la operación actual que se está editando
            if (op.estado !== 'pendiente') return true
            if (op.modificadaManualmente === true) return true
            return false
        })
        await escribir(STORAGE_KEYS.operaciones, opsLimpias)

        const opsRestantes = opsLimpias.filter(op => op.recurrenciaId === id)
        const maxCiclo = opsRestantes.reduce((max, op) => Math.max(max, op.cicloNumero || 0), 0)

        const ciclosConExcepcion = new Set(
            opsRestantes
                .filter(op => op.modificadaManualmente === true)
                .map(op => op.cicloNumero)
        )

        updated.ciclosGenerados = maxCiclo
        updated._ciclosExcluidos = Array.from(ciclosConExcepcion)

        // Recalcular ultimaFechaGenerada para que calcularProximaFecha
        // use un punto de referencia correcto tras cambios de frecuencia/fechaInicio
        if (opsRestantes.length > 0) {
            const fechaMax = opsRestantes.reduce((max, op) => {
                const f = new Date(op.fecha)
                return f > max ? f : max
            }, new Date(0))
            updated.ultimaFechaGenerada = toLocalISOString(fechaMax)
        } else {
            // Sin operaciones restantes: posicionar para que el primer ciclo sea fechaInicio
            updated.ultimaFechaGenerada = toLocalISOString(calcularFechaAnterior(updated))
        }

        list[idx] = updated
        await guardarTodas(list)

        await generarInstanciasRecurrentes()

        // Limpiar campo temporal y guardar estado final
        delete updated._ciclosExcluidos
        list[idx] = updated
        await guardarTodas(list)
    }

    return updated
}

export async function desactivarRecurrencia(id) {
    const ops = await listarOperaciones()
    const opsRestantes = ops.filter(op => {
        if (op.recurrenciaId !== id) return true
        return op.estado === 'pagado'
    })
    await escribir(STORAGE_KEYS.operaciones, opsRestantes)

    return await actualizarRecurrencia(id, { activa: false })
}

export async function reactivarRecurrencia(id) {
    return await actualizarRecurrencia(id, { activa: true })
}

export async function eliminarRecurrencia(id) {
    const list = await obtenerTodas()
    const next = list.filter(r => r.id !== id)
    await guardarTodas(next)
    return true
}

export async function eliminarRecurrenciaCompleta(id) {
    const ops = await listarOperaciones()

    // Revertir saldos de operaciones pagadas antes de eliminarlas
    const opsDeSerie = ops.filter(op => op.recurrenciaId === id)
    for (const op of opsDeSerie) {
        if (op.estado === 'pagado') {
            await revertirEfecto(op)
        }
    }

    const opsRestantes = ops.filter(op => op.recurrenciaId !== id)
    await escribir(STORAGE_KEYS.operaciones, opsRestantes)

    return await eliminarRecurrencia(id)
}

export async function eliminarDesdeciCiclo(recurrenciaId, desdeCiclo) {
    const ops = await listarOperaciones()

    // Revertir saldos de operaciones pagadas que se van a eliminar
    const opsAEliminar = ops.filter(op =>
        op.recurrenciaId === recurrenciaId &&
        op.cicloNumero && op.cicloNumero >= desdeCiclo
    )
    for (const op of opsAEliminar) {
        if (op.estado === 'pagado') {
            await revertirEfecto(op)
        }
    }

    const opsRestantes = ops.filter(op =>
        op.recurrenciaId !== recurrenciaId ||
        (op.cicloNumero && op.cicloNumero < desdeCiclo)
    )
    await escribir(STORAGE_KEYS.operaciones, opsRestantes)

    const list = await obtenerTodas()
    const rec = list.find(r => r.id === recurrenciaId)
    if (rec && desdeCiclo <= 1) {
        rec.activa = false
        rec.ciclosGenerados = 0
        rec.ultimaFechaGenerada = null
    } else if (rec) {
        rec.ciclosGenerados = desdeCiclo - 1
        // Recalcular ultimaFechaGenerada basándose en las operaciones restantes de esta serie
        const opsSerieRestantes = opsRestantes.filter(op => op.recurrenciaId === recurrenciaId)
        if (opsSerieRestantes.length > 0) {
            const fechaMax = opsSerieRestantes.reduce((max, op) => {
                const f = new Date(op.fecha)
                return f > max ? f : max
            }, new Date(0))
            rec.ultimaFechaGenerada = toLocalISOString(fechaMax)
        } else {
            rec.ultimaFechaGenerada = null
        }
    }
    await guardarTodas(list)
}

export async function obtenerRecurrencia(id) {
    const todas = await obtenerTodas()
    return todas.find(r => r.id === id) || null
}

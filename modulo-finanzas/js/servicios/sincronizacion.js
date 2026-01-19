// Servicio de Sincronización con Supabase
import { getSupabase } from '../sistema/supabaseClient.js'
import { leer, escribir } from './almacenamiento.js'
import { STORAGE_KEYS } from '../sistema/constantes.js'

// Usar las claves definidas en constantes.js
const CUENTAS_KEY = STORAGE_KEYS.cuentas
const ETIQUETAS_KEY = STORAGE_KEYS.etiquetas
const OPERACIONES_KEY = STORAGE_KEYS.operaciones
const METAS_KEY = STORAGE_KEYS.metas
const PRESUPUESTOS_KEY = STORAGE_KEYS.presupuestos
const CONFIG_KEY = STORAGE_KEYS.configuracion

/**
 * Obtiene la fecha de última actualización de los datos en la nube
 * @returns {Promise<{cloudTimestamp: string|null, hasCloudData: boolean}>}
 */
async function obtenerTimestampNube(supabase, userId) {
    try {
        // Verificar la operación más reciente en la nube (por actualización o creación)
        // Intentamos obtener el máximo de actualizada_en
        const { data: opReciente } = await supabase
            .from('operaciones')
            .select('actualizada_en') // Priorizamos fecha de actualización
            .eq('user_id', userId)
            .order('actualizada_en', { ascending: false })
            .limit(1)
            .maybeSingle()

        // Verificar la cuenta más reciente
        const { data: cuentaReciente } = await supabase
            .from('cuentas')
            .select('actualizada_en')
            .eq('user_id', userId)
            .order('actualizada_en', { ascending: false })
            .limit(1)
            .maybeSingle()

        const timestamps = [
            opReciente?.actualizada_en,
            cuentaReciente?.actualizada_en
        ].filter(Boolean)

        if (timestamps.length === 0) {
            return { cloudTimestamp: null, hasCloudData: false }
        }

        // Retornar el timestamp más reciente
        const masReciente = timestamps.sort((a, b) => new Date(b) - new Date(a))[0]
        return { cloudTimestamp: masReciente, hasCloudData: true }
    } catch {
        return { cloudTimestamp: null, hasCloudData: false }
    }
}

/**
 * Obtiene la fecha de última actualización de los datos locales
 * @returns {string|null}
 */
function obtenerTimestampLocal() {
    const operaciones = leer(OPERACIONES_KEY, [])
    const cuentas = leer(CUENTAS_KEY, [])

    const timestamps = [
        // Usar actualizadaEn si existe, si no creadaEn
        ...operaciones.map(op => op.actualizadaEn || op.creadaEn),
        ...cuentas.map(c => c.actualizadaEn)
    ].filter(Boolean)

    if (timestamps.length === 0) return null

    return timestamps.sort((a, b) => new Date(b) - new Date(a))[0]
}

/**
 * Verifica si es seguro subir datos (no hay datos más recientes en la nube)
 * @param {boolean} forzar - Si es true, omite la verificación de seguridad
 * @returns {Promise<{safe: boolean, reason: string|null, cloudTimestamp: string|null, localTimestamp: string|null}>}
 */
export async function verificarSeguridadSincronizacion() {
    const supabase = getSupabase()
    if (!supabase) {
        return { safe: false, reason: 'Supabase no está disponible', cloudTimestamp: null, localTimestamp: null }
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { safe: false, reason: 'No hay sesión activa', cloudTimestamp: null, localTimestamp: null }
    }

    const { cloudTimestamp, hasCloudData } = await obtenerTimestampNube(supabase, user.id)
    const localTimestamp = obtenerTimestampLocal()

    // Si no hay datos en la nube, es seguro subir
    if (!hasCloudData) {
        return { safe: true, reason: null, cloudTimestamp: null, localTimestamp }
    }

    // Si no hay datos locales, advertir
    if (!localTimestamp) {
        return {
            safe: false,
            reason: 'No tienes datos locales pero existen datos en la nube. Descarga primero para no perderlos.',
            cloudTimestamp,
            localTimestamp: null
        }
    }

    // Comparar timestamps
    const cloudDate = new Date(cloudTimestamp)
    const localDate = new Date(localTimestamp)

    // Si los datos de la nube son más recientes, advertir
    if (cloudDate > localDate) {
        return {
            safe: false,
            reason: 'Existen datos más recientes en la nube. Descarga primero para fusionar los cambios y evitar pérdida de datos.',
            cloudTimestamp,
            localTimestamp
        }
    }

    return { safe: true, reason: null, cloudTimestamp, localTimestamp }
}

/**
 * Subir todos los datos locales a Supabase
 * @param {Object} opciones - Opciones de respaldo
 * @param {boolean} opciones.forzar - Si es true, omite la verificación de seguridad (usar con precaución)
 * @returns {Promise<{success: boolean, error: string|null, stats: object, conflicto?: object}>}
 */
export async function respaldarDatos(opciones = {}) {
    const { forzar = false } = opciones

    const supabase = getSupabase()
    if (!supabase) {
        return { success: false, error: 'Supabase no está disponible', stats: {} }
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { success: false, error: 'Debes iniciar sesión para respaldar', stats: {} }
    }

    // Verificación de seguridad: detectar conflictos potenciales
    if (!forzar) {
        const seguridad = await verificarSeguridadSincronizacion()
        if (!seguridad.safe) {
            return {
                success: false,
                error: seguridad.reason,
                stats: {},
                conflicto: {
                    tipo: 'datos_nube_mas_recientes',
                    cloudTimestamp: seguridad.cloudTimestamp,
                    localTimestamp: seguridad.localTimestamp,
                    accionRecomendada: 'Descarga los datos de la nube primero, o usa la opción "forzar" si estás seguro de querer sobrescribir.'
                }
            }
        }
    }

    const userId = user.id
    const stats = { cuentas: 0, etiquetas: 0, operaciones: 0, metas: 0, presupuestos: 0, configuracion: 0 }

    try {
        const cuentasLocales = leer(CUENTAS_KEY, [])
        const etiquetasLocales = leer(ETIQUETAS_KEY, [])
        const operacionesLocales = leer(OPERACIONES_KEY, [])

        // Limpiar datos existentes
        await supabase.from('operaciones').delete().eq('user_id', userId)
        await supabase.from('cuentas').delete().eq('user_id', userId)
        await supabase.from('etiquetas').delete().eq('user_id', userId)

        const cuentaIdMap = new Map()
        const etiquetaIdMap = new Map()

        // 1. Cuentas
        // Ordenar: primero cuentas principales (sin parentId), luego subcuentas
        cuentasLocales.sort((a, b) => {
            if (!a.parentId && b.parentId) return -1
            if (a.parentId && !b.parentId) return 1
            return 0
        })

        for (const c of cuentasLocales) {
            // Resolver padre ID local -> nube
            let cloudPadreId = null
            if (c.parentId) {
                cloudPadreId = cuentaIdMap.get(c.parentId) || null
            }

            const { data, error } = await supabase.from('cuentas').insert({
                user_id: userId,
                nombre: c.nombre,
                descripcion: c.descripcion || '',
                tipo: c.tipo || 'efectivo',
                dinero: c.dinero !== undefined ? c.dinero : 0,
                moneda: c.moneda || 'MXN',
                color: c.color || null,
                es_subcuenta: c.esSubcuenta || false,
                padre_id: cloudPadreId,
                historial: c.historial || [],
                creada_en: c.creadaEn || new Date().toISOString(),
                actualizada_en: c.actualizadaEn || new Date().toISOString()
            }).select('id').single()

            if (error) throw new Error(`Cuentas: ${error.message}`)
            cuentaIdMap.set(c.id, data.id)
        }
        stats.cuentas = cuentasLocales.length

        // 2. Etiquetas
        // IMPORTANTE: Ordenar para insertar primero las que no tienen padre, para resolver FKs
        // Primero padres (sin padreId), luego hijos
        etiquetasLocales.sort((a, b) => {
            if (!a.padreId && b.padreId) return -1
            if (a.padreId && !b.padreId) return 1
            return 0
        })

        for (const e of etiquetasLocales) {
            // Resolver el ID del padre en la nube si existe
            let cloudPadreId = null
            if (e.padreId) {
                cloudPadreId = etiquetaIdMap.get(e.padreId) || null
            }

            const { data, error } = await supabase.from('etiquetas').insert({
                user_id: userId,
                nombre: e.nombre,
                color: e.color || null,
                tipo: e.tipo || 'gasto', // Guardar tipo real
                icono: e.icono || null,
                padre_id: cloudPadreId, // Mapear a la columna de Supabase
                historial: e.historial || [],
                creada_en: e.creadaEn || new Date().toISOString(),
                actualizada_en: e.actualizadaEn || new Date().toISOString()
            }).select('id').single()

            if (error) throw new Error(`Etiquetas: ${error.message}`)
            etiquetaIdMap.set(e.id, data.id)
        }
        stats.etiquetas = etiquetasLocales.length

        // 3. Recurrencias (ANTES de operaciones para tener recurrenciaIdMap)
        const recurrenciasLocales = leer(STORAGE_KEYS.recurrencias, [])
        const recurrenciaIdMap = new Map()

        await supabase.from('recurrencias').delete().eq('user_id', userId)

        for (const rec of recurrenciasLocales) {
            const { data, error } = await supabase.from('recurrencias').insert({
                user_id: userId,
                tipo: rec.tipo,
                nombre: rec.nombre,
                descripcion: rec.descripcion || '',
                cantidad: rec.cantidad || 0,
                cuenta_id: cuentaIdMap.get(rec.cuentaId) || null,
                etiqueta_id: etiquetaIdMap.get(rec.etiquetaId) || null,
                origen_id: cuentaIdMap.get(rec.origenId) || null,
                destino_id: cuentaIdMap.get(rec.destinoId) || null,
                activa: rec.activa !== false,
                fecha_inicio: rec.fechaInicio,
                hora_preferida: rec.horaPreferida || '12:00',
                frecuencia_tipo: rec.frecuenciaTipo || 'meses',
                frecuencia_valor: rec.frecuenciaValor || 1,
                ultimo_dia_mes: rec.ultimoDiaMes || false,
                fin_tipo: rec.finTipo || 'nunca',
                fin_ciclos: rec.finCiclos || null,
                fin_fecha: rec.finFecha || null,
                ciclos_generados: rec.ciclosGenerados || 0,
                ultima_fecha_generada: rec.ultimaFechaGenerada || null
            }).select('id').single()

            if (error) throw new Error(`Recurrencias: ${error.message}`)
            recurrenciaIdMap.set(rec.id, data.id)
        }
        stats.recurrencias = recurrenciasLocales.length

        // 4. Operaciones (usa los 3 mapas: cuentaIdMap, etiquetaIdMap, recurrenciaIdMap)
        for (const op of operacionesLocales) {
            const { error } = await supabase.from('operaciones').insert({
                user_id: userId,
                cuenta_id: cuentaIdMap.get(op.cuentaId) || null,
                etiqueta_id: etiquetaIdMap.get(op.etiquetaId) || null,
                tipo: op.tipo,
                monto: op.cantidad || 0,
                fecha: op.fecha,
                descripcion: op.descripcion || op.nombre || null,
                origen_id: cuentaIdMap.get(op.origenId) || null,
                destino_id: cuentaIdMap.get(op.destinoId) || null,
                estado: op.estado || 'pagado',
                recurrencia_id: recurrenciaIdMap.get(op.recurrenciaId) || null,
                ciclo_numero: op.cicloNumero || null,
                creada_en: op.creadaEn || new Date().toISOString(),
                actualizada_en: op.actualizadaEn || new Date().toISOString()
            })

            if (error) throw new Error(`Operaciones: ${error.message}`)
        }
        stats.operaciones = operacionesLocales.length

        // 5. Separadores (resolver IDs de cuentas)
        const separadoresLocales = leer(STORAGE_KEYS.separadores, [])
        await supabase.from('separadores').delete().eq('user_id', userId)

        for (const sep of separadoresLocales) {
            // Mapear IDs locales a IDs de nube
            const cloudCuentaIds = (sep.cuentaIds || [])
                .map(localId => cuentaIdMap.get(localId))
                .filter(cloudId => cloudId !== undefined) // Filtrar IDs que no se encontraron (no deberían existir)

            const { error } = await supabase.from('separadores').insert({
                user_id: userId,
                nombre: sep.nombre,
                color: sep.color || null,
                orden: sep.orden || 0,
                cuenta_ids: cloudCuentaIds, // Array de UUIDs de la nube
                creado_en: sep.creadoEn || new Date().toISOString()
            })

            if (error) throw new Error(`Separadores: ${error.message}`)
        }

        // 6. Metas (guardar como JSON completo)
        const metasLocales = leer(METAS_KEY, [])
        await supabase.from('metas').delete().eq('user_id', userId)
        if (metasLocales && metasLocales.length > 0) {
            const { error: errMetas } = await supabase.from('metas').insert({
                user_id: userId,
                datos: metasLocales
            })
            if (errMetas) throw new Error(`Metas: ${errMetas.message}`)
        }
        stats.metas = Array.isArray(metasLocales) ? metasLocales.length : 0

        // 7. Presupuestos (guardar como JSON completo)
        const presupuestosLocales = leer(PRESUPUESTOS_KEY, {})
        await supabase.from('presupuestos').delete().eq('user_id', userId)
        if (presupuestosLocales && (presupuestosLocales.general || (presupuestosLocales.categorias && presupuestosLocales.categorias.length > 0))) {
            const { error: errPres } = await supabase.from('presupuestos').insert({
                user_id: userId,
                datos: presupuestosLocales
            })
            if (errPres) throw new Error(`Presupuestos: ${errPres.message}`)
        }
        stats.presupuestos = presupuestosLocales.categorias ? presupuestosLocales.categorias.length : 0

        // 8. Configuración (guardar como JSON completo)
        const configLocal = leer(CONFIG_KEY, {})
        await supabase.from('configuracion').delete().eq('user_id', userId)
        if (Object.keys(configLocal).length > 0) {
            const { error: errConfig } = await supabase.from('configuracion').insert({
                user_id: userId,
                datos: configLocal
            })
            if (errConfig) throw new Error(`Configuración: ${errConfig.message}`)
        }
        stats.configuracion = Object.keys(configLocal).length > 0 ? 1 : 0

        return { success: true, error: null, stats }
    } catch (err) {
        return { success: false, error: err.message, stats }
    }
}

/**
 * Descargar datos desde Supabase
 */
export async function restaurarDatos() {
    const supabase = getSupabase()
    if (!supabase) {
        return { success: false, error: 'Supabase no está disponible', stats: {} }
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { success: false, error: 'Debes iniciar sesión para restaurar', stats: {} }
    }

    const stats = { cuentas: 0, etiquetas: 0, operaciones: 0, metas: 0, presupuestos: 0 }

    try {
        // 1. Cuentas
        const { data: cuentasCloud, error: errCuentas } = await supabase.from('cuentas').select('*')
        if (errCuentas) throw new Error(`Cuentas: ${errCuentas.message}`)

        const cuentasLocales = cuentasCloud.map(c => ({
            id: c.id, // ID local será el UUID de Supabase
            nombre: c.nombre,
            descripcion: c.descripcion,
            tipo: c.tipo,
            dinero: Number(c.dinero), // Recuperar saldo correcto
            moneda: c.moneda,
            color: c.color,
            esSubcuenta: c.es_subcuenta || false,
            parentId: c.padre_id || null,
            historial: c.historial || [],
            creadaEn: c.creada_en,
            actualizadaEn: c.actualizada_en
        }))
        escribir(CUENTAS_KEY, cuentasLocales)
        stats.cuentas = cuentasLocales.length

        // 2. Etiquetas
        const { data: etiquetasCloud, error: errEtiquetas } = await supabase.from('etiquetas').select('*')
        if (errEtiquetas) throw new Error(`Etiquetas: ${errEtiquetas.message}`)

        const etiquetasLocales = etiquetasCloud.map(e => ({
            id: e.id,
            nombre: e.nombre,
            color: e.color,
            tipo: e.tipo || 'gasto',
            icono: e.icono,
            padreId: e.padre_id || null, // Recuperar padre
            historial: e.historial || [],
            creadaEn: e.creada_en,
            actualizadaEn: e.actualizada_en
        }))
        escribir(ETIQUETAS_KEY, etiquetasLocales)
        stats.etiquetas = etiquetasLocales.length

        // 3. Recurrencias
        const { data: recurrenciasCloud, error: errRec } = await supabase.from('recurrencias').select('*')
        if (errRec) throw new Error(`Recurrencias: ${errRec.message}`)

        const recurrenciasLocales = recurrenciasCloud.map(rec => ({
            id: rec.id,
            tipo: rec.tipo,
            nombre: rec.nombre,
            descripcion: rec.descripcion,
            cantidad: Number(rec.cantidad),
            cuentaId: rec.cuenta_id,
            etiquetaId: rec.etiqueta_id,
            origenId: rec.origen_id,
            destinoId: rec.destino_id,
            activa: rec.activa,
            fechaInicio: rec.fecha_inicio,
            horaPreferida: rec.hora_preferida || '12:00',
            frecuenciaTipo: rec.frecuencia_tipo || 'meses',
            frecuenciaValor: rec.frecuencia_valor || 1,
            ultimoDiaMes: rec.ultimo_dia_mes || false,
            finTipo: rec.fin_tipo || 'nunca',
            finCiclos: rec.fin_ciclos,
            finFecha: rec.fin_fecha,
            ciclosGenerados: rec.ciclos_generados || 0,
            ultimaFechaGenerada: rec.ultima_fecha_generada,
            creadaEn: rec.created_at
        }))
        escribir(STORAGE_KEYS.recurrencias, recurrenciasLocales)
        stats.recurrencias = recurrenciasLocales.length

        // 4. Operaciones
        const { data: operacionesCloud, error: errOps } = await supabase.from('operaciones').select('*')
        if (errOps) throw new Error(`Operaciones: ${errOps.message}`)

        const operacionesLocales = operacionesCloud.map(op => ({
            id: op.id,
            cuentaId: op.cuenta_id,
            etiquetaId: op.etiqueta_id,
            tipo: op.tipo,
            cantidad: Number(op.monto),
            fecha: op.fecha,
            nombre: op.descripcion, // El campo local original solía ser nombre/descripcion mezclado
            descripcion: op.descripcion,
            origenId: op.origen_id,
            destinoId: op.destino_id,
            estado: op.estado || 'pagado',
            recurrenciaId: op.recurrencia_id || null,
            cicloNumero: op.ciclo_numero || null,
            creadaEn: op.created_at || new Date().toISOString()
        }))
        escribir(OPERACIONES_KEY, operacionesLocales)
        stats.operaciones = operacionesLocales.length

        // 5. Separadores
        const { data: separadoresCloud, error: errSep } = await supabase.from('separadores').select('*')
        if (errSep) throw new Error(`Separadores: ${errSep.message}`)

        const separadoresLocales = separadoresCloud.map(sep => ({
            id: sep.id,
            nombre: sep.nombre,
            color: sep.color,
            orden: sep.orden,
            // Los IDs de cuentas ya son UUIDs (mismos que local después de restaurar cuentas)
            cuentaIds: sep.cuenta_ids || [],
            creadoEn: sep.creado_en
        }))
        escribir(STORAGE_KEYS.separadores, separadoresLocales)
        // No stats property for separadores defined in user object but it's fine


        // 4. Metas
        const { data: metasCloud, error: errMetas } = await supabase.from('metas').select('datos').eq('user_id', user.id).maybeSingle()
        if (errMetas) throw new Error(`Metas: ${errMetas.message}`)
        if (metasCloud && metasCloud.datos) {
            escribir(METAS_KEY, metasCloud.datos)
            stats.metas = Array.isArray(metasCloud.datos) ? metasCloud.datos.length : 0
        } else {
            escribir(METAS_KEY, [])
        }

        // 5. Presupuestos
        const { data: presCloud, error: errPres } = await supabase.from('presupuestos').select('datos').eq('user_id', user.id).maybeSingle()
        if (errPres) throw new Error(`Presupuestos: ${errPres.message}`)
        if (presCloud && presCloud.datos) {
            escribir(PRESUPUESTOS_KEY, presCloud.datos)
            stats.presupuestos = presCloud.datos.categorias ? presCloud.datos.categorias.length : 0
        } else {
            escribir(PRESUPUESTOS_KEY, { general: null, categorias: [] })
        }

        // 6. Configuración
        const { data: configCloud, error: errConfig } = await supabase.from('configuracion').select('datos').eq('user_id', user.id).maybeSingle()
        if (errConfig) throw new Error(`Configuración: ${errConfig.message}`)
        if (configCloud && configCloud.datos) {
            escribir(CONFIG_KEY, configCloud.datos)
            stats.configuracion = 1 // Existe config
        } else {
            escribir(CONFIG_KEY, {})
        }

        return { success: true, error: null, stats }
    } catch (err) {
        return { success: false, error: err.message, stats }
    }
}

/**
 * Borrar todos los datos del usuario en Supabase
 * @returns {Promise<{success: boolean, error: string|null}>}
 */
export async function borrarDatosNube() {
    const supabase = getSupabase()
    if (!supabase) {
        return { success: false, error: 'Supabase no está disponible' }
    }

    const { data: { user } } = await supabase.auth.getUser()
    if (!user) {
        return { success: false, error: 'Debes iniciar sesión para borrar datos en la nube' }
    }

    const userId = user.id

    try {
        // Borrar en orden correcto por las foreign keys
        // 1. Primero operaciones (dependen de cuentas, etiquetas, recurrencias)
        await supabase.from('operaciones').delete().eq('user_id', userId)
        // 2. Recurrencias (dependen de cuentas, etiquetas)
        await supabase.from('recurrencias').delete().eq('user_id', userId)
        // 3. Luego cuentas y etiquetas
        await supabase.from('cuentas').delete().eq('user_id', userId)
        await supabase.from('etiquetas').delete().eq('user_id', userId)
        // 4. Finalmente datos JSON
        await supabase.from('metas').delete().eq('user_id', userId)
        await supabase.from('presupuestos').delete().eq('user_id', userId)
        await supabase.from('configuracion').delete().eq('user_id', userId)
        await supabase.from('separadores').delete().eq('user_id', userId)

        return { success: true, error: null }
    } catch (err) {
        return { success: false, error: err.message }
    }
}

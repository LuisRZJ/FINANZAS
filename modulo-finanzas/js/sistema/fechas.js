/**
 * Utilidades centralizadas de fecha para GTR Finanzas
 * 
 * REGLA DE ORO: Todas las fechas se interpretan como LOCAL TIME, nunca UTC.
 * Esto evita problemas de timezone como YYYY-MM-DD interpretándose como medianoche UTC.
 * 
 * Formatos soportados:
 * - YYYY-MM-DD → Se interpreta como medianoche LOCAL
 * - YYYY-MM-DDTHH:MM → Se interpreta como hora LOCAL especificada
 * - ISO String completo → Se convierte a local
 */

/**
 * Parsea una cadena de fecha de forma segura, SIEMPRE en tiempo local.
 * Evita el problema de new Date('YYYY-MM-DD') que interpreta como UTC.
 * 
 * @param {string} fechaStr - Cadena de fecha en formato YYYY-MM-DD o YYYY-MM-DDTHH:MM
 * @param {boolean} finDelDia - Si es true, establece la hora a 23:59:59 (útil para comparaciones de fin de rango)
 * @returns {Date|null} Objeto Date en tiempo local, o null si es inválido
 */
export function parseFechaLocal(fechaStr, finDelDia = false) {
    if (!fechaStr) return null

    const str = String(fechaStr).trim()

    // Caso 1: YYYY-MM-DDTHH:MM o YYYY-MM-DDTHH:MM:SS
    if (str.includes('T')) {
        const [datePart, timePart] = str.split('T')
        const [y, m, d] = datePart.split('-').map(v => parseInt(v, 10))
        if (!y || !m || !d) return null

        const timeParts = timePart.split(':').map(v => parseInt(v, 10))
        const h = timeParts[0] || 0
        const min = timeParts[1] || 0
        const s = timeParts[2] || 0

        return new Date(y, m - 1, d, h, min, s)
    }

    // Caso 2: YYYY-MM-DD (sin hora)
    const [y, m, d] = str.split('-').map(v => parseInt(v, 10))
    if (!y || !m || !d) return null

    const dt = new Date(y, m - 1, d)
    if (finDelDia) {
        dt.setHours(23, 59, 59, 999)
    } else {
        dt.setHours(0, 0, 0, 0)
    }
    return dt
}

/**
 * Alias de parseFechaLocal para compatibilidad con código existente.
 * Siempre retorna medianoche (inicio del día).
 */
export function parseFecha(fechaStr) {
    return parseFechaLocal(fechaStr, false)
}

/**
 * Obtiene la fecha de hoy a medianoche local.
 * @returns {Date}
 */
export function hoy() {
    const d = new Date()
    d.setHours(0, 0, 0, 0)
    return d
}

/**
 * Obtiene la fecha y hora actual.
 * @returns {Date}
 */
export function ahora() {
    return new Date()
}

/**
 * Formatea una fecha como cadena ISO local (YYYY-MM-DD).
 * NO usa toISOString() que convierte a UTC.
 * 
 * @param {Date} date - Fecha a formatear
 * @returns {string} Formato YYYY-MM-DD
 */
export function formatFechaISO(date) {
    if (!(date instanceof Date) || isNaN(date)) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate())
}

/**
 * Formatea una fecha con hora como cadena ISO local (YYYY-MM-DDTHH:MM).
 * NO usa toISOString() que convierte a UTC.
 * 
 * @param {Date} date - Fecha a formatear
 * @returns {string} Formato YYYY-MM-DDTHH:MM
 */
export function formatFechaHoraISO(date) {
    if (!(date instanceof Date) || isNaN(date)) return ''
    const pad = (n) => String(n).padStart(2, '0')
    return date.getFullYear() + '-' +
        pad(date.getMonth() + 1) + '-' +
        pad(date.getDate()) + 'T' +
        pad(date.getHours()) + ':' +
        pad(date.getMinutes())
}

/**
 * Compara si dos fechas son el mismo día (ignorando hora).
 * @param {Date} d1 
 * @param {Date} d2 
 * @returns {boolean}
 */
export function mismoDia(d1, d2) {
    if (!d1 || !d2) return false
    return d1.getFullYear() === d2.getFullYear() &&
        d1.getMonth() === d2.getMonth() &&
        d1.getDate() === d2.getDate()
}

/**
 * Verifica si una fecha está dentro de un rango (incluyendo límites).
 * @param {Date|string} fecha - Fecha a verificar
 * @param {Date|string} inicio - Inicio del rango
 * @param {Date|string} fin - Fin del rango
 * @returns {boolean}
 */
export function estaEnRango(fecha, inicio, fin) {
    const f = fecha instanceof Date ? fecha : parseFechaLocal(fecha)
    const i = inicio instanceof Date ? inicio : parseFechaLocal(inicio)
    const fi = fin instanceof Date ? fin : parseFechaLocal(fin, true)

    if (!f || !i || !fi) return false

    const fTime = f.getTime()
    return fTime >= i.getTime() && fTime <= fi.getTime()
}

/**
 * Calcula la diferencia en días entre dos fechas.
 * @param {Date} d1 
 * @param {Date} d2 
 * @returns {number} Número de días (puede ser negativo)
 */
export function diferenciaEnDias(d1, d2) {
    if (!d1 || !d2) return 0
    const msPerDay = 86400000
    // Normalizar a medianoche para evitar problemas de horas
    const t1 = new Date(d1.getFullYear(), d1.getMonth(), d1.getDate()).getTime()
    const t2 = new Date(d2.getFullYear(), d2.getMonth(), d2.getDate()).getTime()
    return Math.round((t2 - t1) / msPerDay)
}

/**
 * Formatea una fecha para mostrar al usuario (formato amigable).
 * @param {Date|string} fecha 
 * @param {object} options - Opciones de Intl.DateTimeFormat
 * @returns {string}
 */
export function formatFechaLegible(fecha, options = {}) {
    const d = fecha instanceof Date ? fecha : parseFechaLocal(fecha)
    if (!d) return ''

    const defaultOptions = {
        day: 'numeric',
        month: 'short',
        year: 'numeric',
        ...options
    }

    return d.toLocaleDateString('es-MX', defaultOptions)
}

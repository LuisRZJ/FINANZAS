/**
 * js/utils.js - Funciones de utilidad para parsing de fechas
 * Las funciones se definen directamente en el objeto global para evitar
 * conflictos con redeclaraciones en scripts Babel.
 */

// Crear el namespace global si no existe
window.FTI_Utils = window.FTI_Utils || {};

/**
 * Parsea una fecha en formato personalizado (DD/MM/YYYY) con hora (HH:MM AM/PM)
 * @param {string} dateStr - Fecha en formato DD/MM/YYYY
 * @param {string} timeStr - Hora en formato HH:MM AM/PM
 * @returns {Date|null}
 */
window.FTI_Utils.parseCustomDate = function (dateStr, timeStr) {
    if (!dateStr || !timeStr) return null;
    const [day, month, year] = dateStr.split('/').map(Number);
    const parts = timeStr.split(' ');
    const timeParts = parts[0].split(':').map(Number);
    let hours = timeParts[0];
    const minutes = timeParts[1];
    const modifier = parts[1] || parts[2];
    if (hours === 12) hours = 0;
    if (modifier && (modifier.toLowerCase().includes('p.m') || modifier.toLowerCase().includes('pm'))) hours += 12;
    return new Date(year, month - 1, day, hours, minutes);
};

/**
 * Parsea una fecha ISO con hora compacta (YYYY-MM-DD HHMMSS)
 * @param {string} dateTimeStr - Fecha en formato ISO
 * @returns {Date|null}
 */
window.FTI_Utils.parseIsoDateTime = function (dateTimeStr) {
    if (!dateTimeStr) return null;
    const [datePart, timePartRaw] = dateTimeStr.trim().split(' ');
    const [year, month, day] = datePart.split('-').map(Number);
    const tp = (timePartRaw || '').trim();
    const hh = parseInt(tp.slice(0, 2) || '0', 10);
    const mm = parseInt(tp.slice(2, 4) || '0', 10);
    const ss = parseInt(tp.slice(4, 6) || '0', 10);
    return new Date(Date.UTC(year, month - 1, day, hh, mm, ss));
};

/**
 * Parsea una fecha en múltiples formatos flexibles
 * @param {string|any} value - Valor a parsear
 * @returns {Date|null}
 */
window.FTI_Utils.parseFlexibleDateTime = function (value) {
    if (!value) return null;
    const raw = String(value).trim();
    if (!raw) return null;

    const direct = new Date(raw);
    if (!isNaN(direct.getTime())) return direct;

    const m = raw.match(/^(\d{4})-(\d{2})-(\d{2})(?:[ T](\d{2}):?(\d{2})(?::?(\d{2}))?)?$/);
    if (m) {
        const year = Number(m[1]);
        const month = Number(m[2]);
        const day = Number(m[3]);
        const hh = Number(m[4] || 0);
        const mm = Number(m[5] || 0);
        const ss = Number(m[6] || 0);
        const d = new Date(Date.UTC(year, month - 1, day, hh, mm, ss));
        if (!isNaN(d.getTime())) return d;
    }

    return window.FTI_Utils.parseIsoDateTime(raw);
};

export function formatoMoneda(cantidad) {
    return Number(cantidad || 0).toLocaleString('es-MX', {
        style: 'currency',
        currency: 'MXN'
    });
}

export function formatoFecha(fechaStr) {
    // Soportar formato nuevo (YYYY-MM-DDTHH:MM) y antiguo (YYYY-MM-DD)
    if (!fechaStr) return '';
    const fechaLimpia = fechaStr.split('T')[0];
    const [y, m, d] = fechaLimpia.split('-');
    const date = new Date(y, m - 1, d);
    return date.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: 'numeric' });
}

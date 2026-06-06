// Servicio de Autenticación Local para la Nube
const EXPIRATION_DAYS = 15;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

/**
 * Verifica si la contraseña maestra local existe y no ha caducado
 * @returns {boolean}
 */
export function estaAutenticadoEnNube() {
    const pwd = localStorage.getItem('fti_cloud_password');
    const dateStr = localStorage.getItem('fti_cloud_password_date');

    if (!pwd || !dateStr) return false;

    const date = parseInt(dateStr, 10);
    if (isNaN(date)) return false;

    const now = Date.now();
    const diffDays = (now - date) / MS_PER_DAY;

    // Si pasaron más de 15 días, consideramos que caducó
    if (diffDays > EXPIRATION_DAYS) {
        return false;
    }

    return true;
}

/**
 * Obtener la contraseña actual (si es válida)
 * @returns {string|null}
 */
export function obtenerPasswordNube() {
    if (!estaAutenticadoEnNube()) return null;
    return localStorage.getItem('fti_cloud_password');
}

/**
 * Guardar nueva contraseña ingresada en el prompt/modal
 * @param {string} password 
 */
export function guardarPasswordNube(password) {
    if (!password) return;
    localStorage.setItem('fti_cloud_password', password);
    localStorage.setItem('fti_cloud_password_date', Date.now().toString());
}

/**
 * Cerrar sesión en la nube (borrar password local)
 */
export function cerrarSesionNube() {
    localStorage.removeItem('fti_cloud_password');
    localStorage.removeItem('fti_cloud_password_date');
}

// Servicio de Separadores de Cuentas
import { leer, escribir } from './almacenamiento.js'
import { STORAGE_KEYS } from '../sistema/constantes.js'

const KEY = STORAGE_KEYS.separadores

/**
 * Listar todos los separadores ordenados por 'orden'
 */
export function listarSeparadores() {
    const data = leer(KEY, [])
    return data.sort((a, b) => (a.orden || 0) - (b.orden || 0))
}

/**
 * Crear un nuevo separador
 * @param {Object} payload - { nombre: string, cuentaIds: string[], color?: string }
 */
export function crearSeparador({ nombre, cuentaIds = [], color = '#0ea5e9' }) {
    if (!nombre || nombre.trim() === '') {
        throw new Error('El nombre del separador es requerido')
    }

    const separadores = leer(KEY, [])

    // Remove these accounts from any existing separator
    separadores.forEach(sep => {
        sep.cuentaIds = sep.cuentaIds.filter(id => !cuentaIds.includes(id))
    })

    const nuevo = {
        id: crypto.randomUUID(),
        nombre: nombre.trim(),
        cuentaIds: cuentaIds,
        color: color,
        orden: separadores.length,
        creadoEn: new Date().toISOString()
    }

    separadores.push(nuevo)
    escribir(KEY, separadores)
    return nuevo
}

/**
 * Actualizar un separador existente
 * @param {string} id - ID del separador
 * @param {Object} data - { nombre?, cuentaIds? }
 */
export function actualizarSeparador(id, data) {
    const separadores = leer(KEY, [])
    const idx = separadores.findIndex(s => s.id === id)
    if (idx === -1) {
        throw new Error('Separador no encontrado')
    }

    // If updating cuentaIds, remove them from other separators first
    if (data.cuentaIds) {
        separadores.forEach((sep, i) => {
            if (i !== idx) {
                sep.cuentaIds = sep.cuentaIds.filter(cid => !data.cuentaIds.includes(cid))
            }
        })
    }

    separadores[idx] = { ...separadores[idx], ...data }
    escribir(KEY, separadores)
    return separadores[idx]
}

/**
 * Eliminar un separador (las cuentas quedan sin agrupar)
 * @param {string} id - ID del separador
 */
export function eliminarSeparador(id) {
    let separadores = leer(KEY, [])
    separadores = separadores.filter(s => s.id !== id)
    escribir(KEY, separadores)
}

/**
 * Obtener el separador que contiene una cuenta específica
 * @param {string} cuentaId - ID de la cuenta
 * @returns {Object|null} El separador o null
 */
export function obtenerSeparadorDeCuenta(cuentaId) {
    const separadores = leer(KEY, [])
    return separadores.find(s => s.cuentaIds.includes(cuentaId)) || null
}

/**
 * Agregar una cuenta a un separador
 * @param {string} separadorId - ID del separador
 * @param {string} cuentaId - ID de la cuenta a agregar
 */
export function agregarCuentaASeparador(separadorId, cuentaId) {
    const separadores = leer(KEY, [])

    // Remove from any other separator first
    separadores.forEach(sep => {
        sep.cuentaIds = sep.cuentaIds.filter(id => id !== cuentaId)
    })

    const sep = separadores.find(s => s.id === separadorId)
    if (sep && !sep.cuentaIds.includes(cuentaId)) {
        sep.cuentaIds.push(cuentaId)
    }

    escribir(KEY, separadores)
}

/**
 * Quitar una cuenta de su separador actual
 * @param {string} cuentaId - ID de la cuenta
 */
export function quitarCuentaDeSeparador(cuentaId) {
    const separadores = leer(KEY, [])
    separadores.forEach(sep => {
        sep.cuentaIds = sep.cuentaIds.filter(id => id !== cuentaId)
    })
    escribir(KEY, separadores)
}

/**
 * Mover un separador arriba o abajo en el orden
 * @param {string} id - ID del separador
 * @param {string} direction - 'up' o 'down'
 */
export function moverSeparador(id, direction) {
    const separadores = leer(KEY, [])
    separadores.sort((a, b) => (a.orden || 0) - (b.orden || 0))

    const idx = separadores.findIndex(s => s.id === id)
    if (idx === -1) return

    if (direction === 'up' && idx > 0) {
        // Swap with previous
        const temp = separadores[idx].orden
        separadores[idx].orden = separadores[idx - 1].orden
        separadores[idx - 1].orden = temp
    } else if (direction === 'down' && idx < separadores.length - 1) {
        // Swap with next
        const temp = separadores[idx].orden
        separadores[idx].orden = separadores[idx + 1].orden
        separadores[idx + 1].orden = temp
    }

    escribir(KEY, separadores)
}

// Predefined color palette for separators
export const COLORES_SEPARADOR = [
    '#0ea5e9', // sky
    '#8b5cf6', // violet
    '#ec4899', // pink
    '#f97316', // orange
    '#22c55e', // green
    '#eab308', // yellow
    '#6366f1', // indigo
    '#14b8a6', // teal
    '#ef4444', // red
    '#64748b'  // slate
]

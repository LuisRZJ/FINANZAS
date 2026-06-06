// Servicio de Separadores de Cuentas
import { leer, escribir } from './almacenamiento.js'
import { STORAGE_KEYS } from '../sistema/constantes.js'

const KEY = STORAGE_KEYS.separadores

export async function listarSeparadores() {
    const data = await leer(KEY, [])
    return data.sort((a, b) => (a.orden || 0) - (b.orden || 0))
}

export async function crearSeparador({ nombre, cuentaIds = [], color = '#0ea5e9' }) {
    if (!nombre || nombre.trim() === '') {
        throw new Error('El nombre del separador es requerido')
    }

    const separadores = await leer(KEY, [])

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
    await escribir(KEY, separadores)
    return nuevo
}

export async function actualizarSeparador(id, data) {
    const separadores = await leer(KEY, [])
    const idx = separadores.findIndex(s => s.id === id)
    if (idx === -1) {
        throw new Error('Separador no encontrado')
    }

    if (data.cuentaIds) {
        separadores.forEach((sep, i) => {
            if (i !== idx) {
                sep.cuentaIds = sep.cuentaIds.filter(cid => !data.cuentaIds.includes(cid))
            }
        })
    }

    separadores[idx] = { ...separadores[idx], ...data }
    await escribir(KEY, separadores)
    return separadores[idx]
}

export async function eliminarSeparador(id) {
    let separadores = await leer(KEY, [])
    separadores = separadores.filter(s => s.id !== id)
    await escribir(KEY, separadores)
}

export async function obtenerSeparadorDeCuenta(cuentaId) {
    const separadores = await leer(KEY, [])
    return separadores.find(s => s.cuentaIds.includes(cuentaId)) || null
}

export async function agregarCuentaASeparador(separadorId, cuentaId) {
    const separadores = await leer(KEY, [])

    separadores.forEach(sep => {
        sep.cuentaIds = sep.cuentaIds.filter(id => id !== cuentaId)
    })

    const sep = separadores.find(s => s.id === separadorId)
    if (sep && !sep.cuentaIds.includes(cuentaId)) {
        sep.cuentaIds.push(cuentaId)
    }

    await escribir(KEY, separadores)
}

export async function quitarCuentaDeSeparador(cuentaId) {
    const separadores = await leer(KEY, [])
    separadores.forEach(sep => {
        sep.cuentaIds = sep.cuentaIds.filter(id => id !== cuentaId)
    })
    await escribir(KEY, separadores)
}

export async function moverSeparador(id, direction) {
    const separadores = await leer(KEY, [])
    separadores.sort((a, b) => (a.orden || 0) - (b.orden || 0))

    const idx = separadores.findIndex(s => s.id === id)
    if (idx === -1) return

    if (direction === 'up' && idx > 0) {
        const temp = separadores[idx].orden
        separadores[idx].orden = separadores[idx - 1].orden
        separadores[idx - 1].orden = temp
    } else if (direction === 'down' && idx < separadores.length - 1) {
        const temp = separadores[idx].orden
        separadores[idx].orden = separadores[idx + 1].orden
        separadores[idx + 1].orden = temp
    }

    await escribir(KEY, separadores)
}

export const COLORES_SEPARADOR = [
    '#0ea5e9', '#8b5cf6', '#ec4899', '#f97316', '#22c55e',
    '#eab308', '#6366f1', '#14b8a6', '#ef4444', '#64748b'
]

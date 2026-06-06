import { STORAGE_KEYS } from '../sistema/constantes.js'
import { obtenerPasswordNube, estaAutenticadoEnNube } from './auth.js'

// Límite de Vercel Serverless Functions Payload es 4.5MB.
// Usamos chunks de 3MB para estar súper seguros y no tener problemas en un par de años.
const CHUNK_SIZE_CHARS = 3 * 1024 * 1024; // ~3MB de caracteres

function construirSnapshotDatos() {
    const snapshot = {}
    const keys = Object.values(STORAGE_KEYS)
    keys.forEach((k) => {
        try {
            const raw = localStorage.getItem(k)
            if (raw !== null) {
                snapshot[k] = JSON.parse(raw)
            }
        } catch {
            // ignorar claves corruptas
        }
    })
    return {
        version: 1,
        exportadoEn: new Date().toISOString(),
        datos: snapshot
    }
}

function calcularEstadisticas(snapshot) {
    const datos = snapshot.datos || {}
    return {
        cuentas: (datos[STORAGE_KEYS.cuentas] || []).length,
        etiquetas: (datos[STORAGE_KEYS.etiquetas] || []).length,
        operaciones: (datos[STORAGE_KEYS.operaciones] || []).length,
        separadores: (datos[STORAGE_KEYS.separadores] || []).length,
        metas: (datos[STORAGE_KEYS.metas] || []).length,
        presupuestos: datos[STORAGE_KEYS.presupuestos] ? (datos[STORAGE_KEYS.presupuestos].categorias || []).length : 0,
        configuracion: datos[STORAGE_KEYS.configuracion] ? 1 : 0
    }
}

export async function verificarSeguridadSincronizacion() {
    if (!estaAutenticadoEnNube()) {
        return { safe: false, reason: 'No hay sesión activa' }
    }

    try {
        const password = obtenerPasswordNube();
        // Solo verificamos el index
        const response = await fetch('/api/sync?module=finanzas&index=true', {
            method: 'GET',
            headers: {
                'Authorization': `Bearer ${password}`
            }
        });

        if (!response.ok) {
            return { safe: false, reason: 'Error al contactar con la nube' };
        }

        const data = await response.json();
        
        if (!data.exists) {
            return { safe: true, hasCloudData: false };
        }

        const cloudTimestamp = data.data.exportadoEn || new Date().toISOString();
        
        return { safe: true, cloudTimestamp, hasCloudData: true };
    } catch (error) {
        return { safe: false, reason: error.message };
    }
}

export async function respaldarDatos(opciones = {}) {
    if (!estaAutenticadoEnNube()) {
        return { success: false, error: 'Debes ingresar la contraseña maestra para respaldar', stats: {} }
    }

    try {
        const snapshot = construirSnapshotDatos();
        const stats = calcularEstadisticas(snapshot);
        const password = obtenerPasswordNube();

        const jsonString = JSON.stringify(snapshot);
        const chunks = [];
        for (let i = 0; i < jsonString.length; i += CHUNK_SIZE_CHARS) {
            chunks.push(jsonString.slice(i, i + CHUNK_SIZE_CHARS));
        }

        // Subir cada chunk
        for (let i = 0; i < chunks.length; i++) {
            const response = await fetch(`/api/sync?module=finanzas&part=${i}`, {
                method: 'POST',
                headers: {
                    'Content-Type': 'text/plain', // Enviamos texto crudo
                    'Authorization': `Bearer ${password}`
                },
                body: chunks[i]
            });

            const result = await response.json();
            if (!response.ok) {
                throw new Error(result.error || `Error al subir la parte ${i+1}/${chunks.length}`);
            }
        }

        // Subir index
        const indexObj = {
            parts: chunks.length,
            exportadoEn: snapshot.exportadoEn,
            version: snapshot.version
        };
        const indexResponse = await fetch(`/api/sync?module=finanzas&index=true`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${password}`
            },
            body: JSON.stringify(indexObj)
        });

        if (!indexResponse.ok) {
            const result = await indexResponse.json();
            throw new Error(result.error || 'Error al subir el índice.');
        }

        return { success: true, error: null, stats };
    } catch (err) {
        return { success: false, error: err.message, stats: {} };
    }
}

export async function restaurarDatos() {
    if (!estaAutenticadoEnNube()) {
        return { success: false, error: 'Debes ingresar la contraseña maestra para restaurar', stats: {} }
    }

    try {
        const password = obtenerPasswordNube();
        
        // 1. Obtener Index
        const indexRes = await fetch('/api/sync?module=finanzas&index=true', {
            method: 'GET',
            headers: { 'Authorization': `Bearer ${password}` }
        });

        const indexResult = await indexRes.json();
        if (!indexRes.ok) {
            throw new Error(indexResult.error || 'Error al obtener el índice de la nube');
        }

        if (!indexResult.exists || !indexResult.data) {
            return { success: false, error: 'No se encontraron datos de respaldo en la nube', stats: {} };
        }

        const partsCount = indexResult.data.parts || 1;
        const chunks = [];

        // 2. Obtener Chunks
        for (let i = 0; i < partsCount; i++) {
            const partRes = await fetch(`/api/sync?module=finanzas&part=${i}`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${password}` }
            });
            const partResult = await partRes.json();
            
            if (!partRes.ok) {
                throw new Error(partResult.error || `Error al descargar la parte ${i+1}/${partsCount}`);
            }
            if (!partResult.exists) {
                throw new Error(`Parte ${i+1}/${partsCount} no encontrada.`);
            }

            chunks.push(partResult.raw || JSON.stringify(partResult.data));
        }

        // 3. Reconstruir JSON
        const fullJsonStr = chunks.join('');
        let snapshot;
        try {
            snapshot = JSON.parse(fullJsonStr);
        } catch (e) {
            throw new Error('El archivo de la nube está corrupto o no se pudo ensamblar correctamente.');
        }

        if (!snapshot.datos) {
             throw new Error('Estructura de respaldo en la nube inválida');
        }

        // 4. Guardar Localmente
        const datos = snapshot.datos;
        const keys = Object.values(STORAGE_KEYS);
        
        keys.forEach((k) => {
            if (Object.prototype.hasOwnProperty.call(datos, k)) {
                localStorage.setItem(k, JSON.stringify(datos[k]));
            } else {
                localStorage.removeItem(k);
            }
        });

        const stats = calcularEstadisticas(snapshot);
        return { success: true, error: null, stats };
    } catch (err) {
        return { success: false, error: err.message, stats: {} };
    }
}

export async function borrarDatosNube() {
    if (!estaAutenticadoEnNube()) {
        return { success: false, error: 'Debes ingresar la contraseña maestra' }
    }

    try {
        const password = obtenerPasswordNube();
        const emptySnapshot = { version: 1, exportadoEn: new Date().toISOString(), datos: {} };
        
        // Simplemente sobreescribimos la parte 0 y el index indicando 1 parte.
        // Las partes viejas (part1, part2...) quedarán en GitHub, pero no estorban
        // porque el index mandará solo leer part0.
        const responsePart = await fetch(`/api/sync?module=finanzas&part=0`, {
            method: 'POST',
            headers: {
                'Content-Type': 'text/plain',
                'Authorization': `Bearer ${password}`
            },
            body: JSON.stringify(emptySnapshot)
        });

        if (!responsePart.ok) {
            throw new Error('Error al vaciar en la nube (parte)');
        }

        const indexResponse = await fetch(`/api/sync?module=finanzas&index=true`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'Authorization': `Bearer ${password}`
            },
            body: JSON.stringify({ parts: 1, exportadoEn: emptySnapshot.exportadoEn, version: 1 })
        });

        if (!indexResponse.ok) {
            throw new Error('Error al vaciar en la nube (índice)');
        }

        return { success: true, error: null };
    } catch (err) {
        return { success: false, error: err.message };
    }
}

import { STORAGE_KEYS } from '../sistema/constantes.js';

const DB_NAME = 'GTRFinanzasDB';
const STORE_NAME = 'keyval';
const DB_VERSION = 1;

let dbPromise = null;

function getDB() {
    if (!dbPromise) {
        dbPromise = new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            request.onerror = (e) => reject('Error abriendo IndexedDB: ' + e.target.error);
            request.onsuccess = (e) => resolve(e.target.result);
            request.onupgradeneeded = (e) => {
                const db = e.target.result;
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    db.createObjectStore(STORE_NAME);
                }
            };
        });
    }
    return dbPromise;
}

export async function leer(key, fallback = null) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readonly');
            const store = tx.objectStore(STORE_NAME);
            const req = store.get(key);
            req.onsuccess = () => {
                if (req.result === undefined) {
                    resolve(fallback);
                } else {
                    resolve(req.result);
                }
            };
            req.onerror = () => resolve(fallback);
        });
    } catch (e) {
        console.error(e);
        return fallback;
    }
}

export async function escribir(key, value) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.put(value, key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    } catch (e) {
        console.error(e);
        return false;
    }
}

export async function eliminar(key) {
    try {
        const db = await getDB();
        return new Promise((resolve, reject) => {
            const tx = db.transaction(STORE_NAME, 'readwrite');
            const store = tx.objectStore(STORE_NAME);
            const req = store.delete(key);
            req.onsuccess = () => resolve(true);
            req.onerror = () => resolve(false);
        });
    } catch (e) {
        return false;
    }
}

export async function migrarDesdeLocalStorage() {
    let migracionRequerida = false;
    const keysToMigrate = Object.values(STORAGE_KEYS);
    
    for (const key of keysToMigrate) {
        if (localStorage.getItem(key) !== null) {
            migracionRequerida = true;
            break;
        }
    }

    if (!migracionRequerida) return;

    console.log("Iniciando migración de datos desde LocalStorage a IndexedDB...");
    for (const key of keysToMigrate) {
        const raw = localStorage.getItem(key);
        if (raw !== null) {
            try {
                const parsed = JSON.parse(raw);
                await escribir(key, parsed);
                localStorage.removeItem(key);
            } catch (e) {
                console.error(`Error migrando ${key}`, e);
            }
        }
    }
    console.log("Migración a IndexedDB completada.");
}

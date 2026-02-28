/**
 * Parser de datos OHLC.
 * Extrae Date, Open, High, Low, Close de archivos CSV o TXT.
 * Soporta detección automática de delimitador (PapaParse).
 */
export function parseCSV(file) {
    return new Promise((resolve, reject) => {
        Papa.parse(file, {
            header: true,
            skipEmptyLines: true,
            dynamicTyping: true,
            complete: function (results) {
                if (results.errors.length) {
                    console.warn("Errores al parsear:", results.errors);
                }

                try {
                    // Detectar nombres de columna una sola vez usando la primera fila
                    const sampleRow = results.data[0];
                    if (!sampleRow) throw new Error("El archivo está vacío o no tiene datos válidos.");

                    const keys = Object.keys(sampleRow);
                    const dateCol = findColumn(keys, ['date', 'fecha', 'time', 'timestamp']);
                    const openCol = findColumn(keys, ['open', 'apertura']);
                    const highCol = findColumn(keys, ['high', 'máximo', 'maximo', 'max']);
                    const lowCol = findColumn(keys, ['low', 'mínimo', 'minimo', 'min']);
                    const closeCol = findColumn(keys, ['close', 'cierre', 'precio']);

                    if (!dateCol) throw new Error(`No se encontró columna de Fecha. Columnas disponibles: ${keys.join(', ')}`);
                    if (!closeCol) throw new Error(`No se encontró columna de Cierre/Close. Columnas disponibles: ${keys.join(', ')}`);

                    const data = [];

                    for (let i = 0; i < results.data.length; i++) {
                        const row = results.data[i];

                        // Parsear fecha
                        let dateStr = String(row[dateCol] || '').trim();
                        if (!dateStr) continue; // Saltar filas sin fecha

                        let dateObj = parseDate(dateStr);
                        if (!dateObj || isNaN(dateObj.getTime())) continue; // Saltar fechas inválidas

                        // Parsear valores numéricos
                        const close = parseFloat(row[closeCol]);
                        if (isNaN(close)) continue; // Sin precio de cierre, fila inútil

                        const open = openCol ? parseFloat(row[openCol]) : close;
                        const high = highCol ? parseFloat(row[highCol]) : close;
                        const low = lowCol ? parseFloat(row[lowCol]) : close;

                        data.push({
                            date: dateObj,
                            open: isNaN(open) ? close : open,
                            high: isNaN(high) ? close : high,
                            low: isNaN(low) ? close : low,
                            close: close
                        });
                    }

                    if (data.length === 0) throw new Error("No se pudieron extraer datos válidos del archivo.");

                    // Ordenar por fecha ascendente
                    data.sort((a, b) => a.date - b.date);

                    console.log(`Parser OHLC: ${data.length} velas válidas extraídas de ${results.data.length} filas.`);
                    resolve(data);

                } catch (e) {
                    reject(e);
                }
            },
            error: function (err) {
                reject(err);
            }
        });
    });
}

/**
 * Busca la columna correcta entre las claves del CSV.
 * Prioriza coincidencia exacta, luego parcial (case-insensitive).
 */
function findColumn(keys, candidates) {
    // 1. Coincidencia exacta (case-insensitive)
    for (const candidate of candidates) {
        const found = keys.find(k => k.toLowerCase() === candidate.toLowerCase());
        if (found) return found;
    }
    // 2. Coincidencia parcial (la clave contiene el candidato)
    for (const candidate of candidates) {
        const found = keys.find(k => k.toLowerCase().includes(candidate.toLowerCase()));
        if (found) return found;
    }
    return null;
}

/**
 * Parsea strings de fecha en múltiples formatos comunes.
 * Ejemplos soportados:
 *   "2020-01-01"
 *   "2020-01-01 000000"
 *   "2020-01-01 08:00:00"
 *   "01/01/2020"
 *   timestamps numéricos
 */
function parseDate(dateStr) {
    // Limpiar formatos tipo "2020-01-01 000000" (sin separadores de hora)
    // Convertir a "2020-01-01 00:00:00"
    const compactTimeMatch = dateStr.match(/^(\d{4}-\d{2}-\d{2})\s+(\d{2})(\d{2})(\d{2})$/);
    if (compactTimeMatch) {
        dateStr = `${compactTimeMatch[1]}T${compactTimeMatch[2]}:${compactTimeMatch[3]}:${compactTimeMatch[4]}`;
    }

    let d = new Date(dateStr);

    // Fallback: timestamp numérico (milisegundos o segundos)
    if (isNaN(d.getTime()) && !isNaN(Number(dateStr))) {
        const num = Number(dateStr);
        d = new Date(num < 1e12 ? num * 1000 : num); // Si es menor a 1 trillón, asumimos segundos
    }

    return d;
}

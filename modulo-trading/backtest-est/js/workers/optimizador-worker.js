/**
 * Web Worker para el optimizador multi-hilo.
 * Procesa un chunk de combinaciones y retorna los top entries.
 */

import { optimizeChunk } from '../utilidades/optimizador.js';

self.onmessage = function (e) {
    const { dates, closes, highs, lows, params, chunkIdx, totalChunks } = e.data;

    try {
        const result = optimizeChunk(dates, closes, highs, lows, params, chunkIdx, totalChunks, (progress) => {
            self.postMessage({ type: 'progress', progress, chunkIdx });
        });

        self.postMessage({ type: 'chunk-done', result, chunkIdx });
    } catch (error) {
        self.postMessage({ type: 'error', error: error.message });
    }
};

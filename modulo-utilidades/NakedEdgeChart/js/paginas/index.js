function clamp(n, min, max) {
    return Math.max(min, Math.min(max, n));
}

function parseKlines(rows) {
    if (!Array.isArray(rows)) return [];
    return rows
        .map((r) => {
            if (!Array.isArray(r) || r.length < 5) return null;
            const t = Number(r[0]);
            const o = Number(r[1]);
            const h = Number(r[2]);
            const l = Number(r[3]);
            const c = Number(r[4]);
            if (![t, o, h, l, c].every(Number.isFinite)) return null;
            return { t, o, h, l, c };
        })
        .filter(Boolean);
}

function pickRandomWindowMs({ intervalMs, count, lookbackMs }) {
    const now = Date.now();
    const span = intervalMs * count;
    const maxEnd = now - intervalMs;
    const minEnd = now - lookbackMs;
    const end = clamp(minEnd + Math.random() * (maxEnd - minEnd), minEnd, maxEnd);
    const start = end - span;
    return { startTime: Math.floor(start), endTime: Math.floor(end) };
}

async function fetchBinanceKlines({ symbol, interval, startTime, limit }) {
    const url = new URL('https://api.binance.com/api/v3/klines');
    url.searchParams.set('symbol', symbol);
    url.searchParams.set('interval', interval);
    url.searchParams.set('startTime', String(startTime));
    url.searchParams.set('limit', String(limit));

    const res = await fetch(url.toString(), { method: 'GET' });
    if (!res.ok) throw new Error(`Binance HTTP ${res.status}`);
    const json = await res.json();
    return parseKlines(json);
}

function createOffscreenCandleStrip({ candles, heightCssPx, candleWidthCssPx, gapCssPx, dpr }) {
    const len = candles.length;
    const wCss = len * (candleWidthCssPx + gapCssPx);

    const MAX_CANVAS_PX = 16000;
    const safeDpr = (() => {
        const desired = Math.max(1, Math.min(2, Number(dpr) || 1));
        const maxByWidth = Math.max(1, Math.floor(MAX_CANVAS_PX / Math.max(1, wCss)));
        return Math.max(1, Math.min(desired, maxByWidth));
    })();

    const off = document.createElement('canvas');
    off.width = Math.max(1, Math.floor(wCss * safeDpr));
    off.height = Math.max(1, Math.floor(heightCssPx * safeDpr));

    const ctx = off.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return { canvas: off, widthCss: wCss, heightCss: heightCssPx, dpr: safeDpr };

    ctx.setTransform(safeDpr, 0, 0, safeDpr, 0, 0);
    ctx.clearRect(0, 0, wCss, heightCssPx);

    let min = Infinity;
    let max = -Infinity;
    candles.forEach((c) => {
        min = Math.min(min, c.l);
        max = Math.max(max, c.h);
    });
    if (!Number.isFinite(min) || !Number.isFinite(max) || min === max) {
        min = 0;
        max = 1;
    }

    const pad = (max - min) * 0.08;
    const yMin = min - pad;
    const yMax = max + pad;
    const ySpan = yMax - yMin;

    const up = 'rgba(34, 197, 94, 0.95)';
    const down = 'rgba(239, 68, 68, 0.95)';
    const wickUp = 'rgba(34, 197, 94, 0.80)';
    const wickDown = 'rgba(239, 68, 68, 0.80)';

    function y(price) {
        return (1 - (price - yMin) / ySpan) * heightCssPx;
    }

    const bodyMin = 1;
    for (let i = 0; i < len; i += 1) {
        const c = candles[i];
        const x = i * (candleWidthCssPx + gapCssPx) + gapCssPx * 0.5;
        const isUp = c.c >= c.o;
        const yO = y(c.o);
        const yC = y(c.c);
        const yH = y(c.h);
        const yL = y(c.l);
        const top = Math.min(yO, yC);
        const bottom = Math.max(yO, yC);
        const bodyH = Math.max(bodyMin, bottom - top);

        ctx.strokeStyle = isUp ? wickUp : wickDown;
        ctx.lineWidth = 1.25;
        ctx.beginPath();
        ctx.moveTo(x + candleWidthCssPx / 2, yH);
        ctx.lineTo(x + candleWidthCssPx / 2, yL);
        ctx.stroke();

        ctx.fillStyle = isUp ? up : down;
        ctx.shadowColor = isUp ? 'rgba(34, 197, 94, 0.25)' : 'rgba(239, 68, 68, 0.25)';
        ctx.shadowBlur = 6;
        ctx.shadowOffsetX = 0;
        ctx.shadowOffsetY = 0;
        ctx.fillRect(x, top, candleWidthCssPx, bodyH);
    }

    ctx.shadowBlur = 0;

    return { canvas: off, widthCss: wCss, heightCss: heightCssPx, dpr: safeDpr };
}

function startScrollingRenderer({ targetCanvas, offscreen, speedCssPxPerSec, onTick }) {
    const ctx = targetCanvas.getContext('2d', { alpha: true, desynchronized: true });
    if (!ctx) return () => {};

    let raf = 0;
    let last = performance.now();
    let scroll = Math.random() * Math.max(1, offscreen.widthCss);

    function resize() {
        const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
        const rect = targetCanvas.getBoundingClientRect();
        const w = Math.max(1, Math.floor(rect.width * dpr));
        const h = Math.max(1, Math.floor(rect.height * dpr));
        if (targetCanvas.width !== w || targetCanvas.height !== h) {
            targetCanvas.width = w;
            targetCanvas.height = h;
        }
        ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
        return { wCss: rect.width, hCss: rect.height, dpr };
    }

    let metrics = resize();

    function drawSlice(offX, destX, sliceW) {
        if (sliceW <= 0) return;
        const srcDpr = offscreen && typeof offscreen.dpr === 'number' ? offscreen.dpr : metrics.dpr;
        const sx = Math.floor(offX * srcDpr);
        const sw = Math.floor(sliceW * srcDpr);
        const sh = offscreen.canvas.height;
        const dx = destX;
        const dy = 0;
        const dw = sliceW;
        const dh = metrics.hCss;
        ctx.drawImage(offscreen.canvas, sx, 0, sw, sh, dx, dy, dw, dh);
    }

    function frame(now) {
        const dt = Math.max(0, now - last);
        last = now;

        const nextMetrics = resize();
        if (nextMetrics.wCss !== metrics.wCss || nextMetrics.hCss !== metrics.hCss || nextMetrics.dpr !== metrics.dpr) {
            metrics = nextMetrics;
        }

        scroll = (scroll + (speedCssPxPerSec * dt) / 1000) % offscreen.widthCss;

        ctx.clearRect(0, 0, metrics.wCss, metrics.hCss);

        let remaining = metrics.wCss;
        let destX = 0;
        let offX = scroll;

        while (remaining > 0) {
            const chunk = Math.min(remaining, offscreen.widthCss - offX);
            drawSlice(offX, destX, chunk);
            remaining -= chunk;
            destX += chunk;
            offX = 0;
        }

        if (typeof onTick === 'function') onTick();
        raf = requestAnimationFrame(frame);
    }

    raf = requestAnimationFrame(frame);

    return () => {
        if (raf) cancelAnimationFrame(raf);
    };
}

window.addEventListener('DOMContentLoaded', async () => {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }

    const canvas = document.getElementById('bg-chart');
    const statusEl = document.getElementById('bg-status');
    const metaEl = document.getElementById('bg-meta');

    if (!(canvas instanceof HTMLCanvasElement)) {
        if (statusEl) statusEl.textContent = 'Canvas no disponible';
        return;
    }

    const symbol = 'BTCUSDT';
    const interval = '1m';
    const intervalMs = 60_000;
    const limit = 1000;
    const lookbackMs = 30 * 24 * 60 * 60 * 1000;
    const dpr = Math.max(1, Math.min(2, window.devicePixelRatio || 1));
    const heightCssPx = Math.max(240, window.innerHeight);

    if (metaEl) metaEl.textContent = `${symbol} · ${interval}`;

    let candles = [];
    try {
        const { startTime } = pickRandomWindowMs({ intervalMs, count: limit, lookbackMs });
        candles = await fetchBinanceKlines({ symbol, interval, startTime, limit });
    } catch (e) {
        candles = [];
    }

    if (!candles.length) {
        if (statusEl) statusEl.textContent = 'Sin datos de mercado';
        return;
    }

    const offscreen = createOffscreenCandleStrip({
        candles,
        heightCssPx,
        candleWidthCssPx: 6,
        gapCssPx: 3,
        dpr
    });

    if (statusEl) statusEl.textContent = 'Mercado activo';

    const stop = startScrollingRenderer({
        targetCanvas: canvas,
        offscreen,
        speedCssPxPerSec: 36
    });

    window.addEventListener('beforeunload', () => stop(), { once: true });
});

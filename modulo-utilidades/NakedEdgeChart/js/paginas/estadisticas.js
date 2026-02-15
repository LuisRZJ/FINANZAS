const navToggle = document.getElementById('nav-toggle');
const navMenu = document.getElementById('nav-menu');

const weekPrevBtn = document.getElementById('week-prev');
const weekNextBtn = document.getElementById('week-next');
const weekRangeBtn = document.getElementById('week-range');

const rangeModeWeekBtn = document.getElementById('range-mode-week');
const rangeModeMonthBtn = document.getElementById('range-mode-month');
const rangeModeYearBtn = document.getElementById('range-mode-year');

const ANALYTICS_DB_NAME = 'nec_analytics';
const ANALYTICS_DB_VERSION = 1;

const WEEK_MS = 7 * 24 * 60 * 60 * 1000;

const RANGE_MODES = {
    week: 'week',
    month: 'month',
    year: 'year'
};

let rangeMode = RANGE_MODES.week;
let currentRangeStartByMode = { week: null, month: null, year: null };
let selectedRangeStartByMode = { week: null, month: null, year: null };

function openAnalyticsDb() {
    if (!('indexedDB' in window)) return Promise.reject(new Error('IndexedDB no disponible'));
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(ANALYTICS_DB_NAME, ANALYTICS_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains('simulations')) {
                const store = db.createObjectStore('simulations', { keyPath: 'id', autoIncrement: true });
                store.createIndex('timestamp', 'timestamp', { unique: false });
                store.createIndex('result', 'result', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Error abriendo IndexedDB'));
    });
}

function getWeekBounds(date = new Date()) {
    const d = new Date(date);
    const day = d.getDay();
    const diffToMonday = (day + 6) % 7;
    d.setHours(0, 0, 0, 0);
    d.setDate(d.getDate() - diffToMonday);
    const start = d.getTime();
    const end = start + 7 * 24 * 60 * 60 * 1000;
    return { start, end };
}

function getMonthBounds(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setDate(1);
    const start = d.getTime();
    const endDate = new Date(d);
    endDate.setMonth(endDate.getMonth() + 1);
    const end = endDate.getTime();
    return { start, end };
}

function getYearBounds(date = new Date()) {
    const d = new Date(date);
    d.setHours(0, 0, 0, 0);
    d.setMonth(0, 1);
    const start = d.getTime();
    const endDate = new Date(d);
    endDate.setFullYear(endDate.getFullYear() + 1);
    const end = endDate.getTime();
    return { start, end };
}

function getBoundsByMode(mode, date = new Date()) {
    if (mode === RANGE_MODES.month) return getMonthBounds(date);
    if (mode === RANGE_MODES.year) return getYearBounds(date);
    return getWeekBounds(date);
}

function clampToMondayStart(ms) {
    return getWeekBounds(new Date(ms)).start;
}

function clampToMonthStart(ms) {
    return getMonthBounds(new Date(ms)).start;
}

function clampToYearStart(ms) {
    return getYearBounds(new Date(ms)).start;
}

function clampToModeStart(mode, ms) {
    if (mode === RANGE_MODES.month) return clampToMonthStart(ms);
    if (mode === RANGE_MODES.year) return clampToYearStart(ms);
    return clampToMondayStart(ms);
}

function weeksAgoLabel(weeksAgo) {
    if (weeksAgo === 0) return 'Semana actual';
    if (weeksAgo === 1) return 'Semana anterior';
    return `Hace ${weeksAgo} semanas`;
}

function monthsAgoLabel(monthsAgo) {
    if (monthsAgo === 0) return 'Mes actual';
    if (monthsAgo === 1) return 'Mes anterior';
    return `Hace ${monthsAgo} meses`;
}

function yearsAgoLabel(yearsAgo) {
    if (yearsAgo === 0) return 'Año actual';
    if (yearsAgo === 1) return 'Año anterior';
    return `Hace ${yearsAgo} años`;
}

function diffInMonths(currentStart, selectedStart) {
    const c = new Date(currentStart);
    const s = new Date(selectedStart);
    return (c.getFullYear() - s.getFullYear()) * 12 + (c.getMonth() - s.getMonth());
}

function diffInYears(currentStart, selectedStart) {
    const c = new Date(currentStart);
    const s = new Date(selectedStart);
    return c.getFullYear() - s.getFullYear();
}

function labelForRange(mode, currentStart, selectedStart) {
    if (mode === RANGE_MODES.month) {
        const monthsAgo = Math.max(0, diffInMonths(currentStart, selectedStart));
        return monthsAgoLabel(monthsAgo);
    }
    if (mode === RANGE_MODES.year) {
        const yearsAgo = Math.max(0, diffInYears(currentStart, selectedStart));
        return yearsAgoLabel(yearsAgo);
    }
    const weeksAgo = Math.max(0, Math.round((currentStart - selectedStart) / WEEK_MS));
    return weeksAgoLabel(weeksAgo);
}

function formatMonthLabel(startMs) {
    const d = new Date(startMs);
    const month = d.toLocaleDateString([], { month: 'short' });
    return `${month} ${d.getFullYear()}`;
}

function formatRangeDisplay(mode, start, end) {
    if (mode === RANGE_MODES.month) {
        return `Mes: ${formatMonthLabel(start)}`;
    }
    if (mode === RANGE_MODES.year) {
        return `Año: ${new Date(start).getFullYear()}`;
    }
    return `Semana: ${formatShortDate(start)} - ${formatShortDate(end - 1)}`;
}

function formatShortDate(ms) {
    const d = new Date(ms);
    return d.toLocaleDateString([], { day: '2-digit', month: '2-digit' });
}

function formatShortDateTime(ms) {
    const d = new Date(ms);
    return d.toLocaleString([], { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function setText(id, value) {
    const el = document.getElementById(id);
    if (!el) return;
    el.textContent = value;
}

function setSignedPercent(elId, value) {
    const el = document.getElementById(elId);
    if (!el) return;

    const base = 'mt-1 text-lg font-mono font-bold';
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        el.textContent = '--';
        el.className = `${base} text-slate-900 dark:text-slate-100`;
        return;
    }

    const sign = value >= 0 ? '+' : '';
    el.textContent = `${sign}${value.toFixed(2)}%`;
    el.className = `${base} ${value >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;
}

function setRRValue(elId, value) {
    const el = document.getElementById(elId);
    if (!el) return;
    const base = 'mt-1 text-lg font-mono font-bold';
    if (typeof value !== 'number' || !Number.isFinite(value)) {
        el.textContent = '--';
        el.className = `${base} text-slate-900 dark:text-slate-100`;
        return;
    }
    el.textContent = `1:${value.toFixed(2)}`;
    el.className = `${base} text-slate-900 dark:text-slate-100`;
}

function clamp01(n) {
    if (typeof n !== 'number' || !Number.isFinite(n)) return 0;
    return Math.max(0, Math.min(1, n));
}

function logistic01(x) {
    return 1 / (1 + Math.exp(-x));
}

function scoreFromWinRate01(winRate01) {
    const x = (winRate01 - 0.55) / 0.08;
    return clamp01(logistic01(x)) * 100;
}

function scoreFromAvgRR(rr) {
    const x = (rr - 1.2) / 0.35;
    return clamp01(logistic01(x)) * 100;
}

function scoreFromAvgPnlPct(pnlPct) {
    const x = (pnlPct - 0.2) / 0.4;
    return clamp01(logistic01(x)) * 100;
}

function reliabilityFromSample(nResolved) {
    const n = Math.max(0, nResolved || 0);
    return clamp01(1 - Math.exp(-n / 30));
}

function sampleGuidanceByMode(mode) {
    if (mode === RANGE_MODES.month) {
        return 'Mes: útil con 20+ trades resueltos; sólido con 40+.';
    }
    if (mode === RANGE_MODES.year) {
        return 'Año: útil con 80+ trades resueltos; sólido con 120+.';
    }
    return 'Semana: útil con 10+ trades resueltos; sólido con 20+.';
}

function streakGuidanceByMode(mode) {
    if (mode === RANGE_MODES.month) {
        return 'Mes: apunta a 3+ meses consecutivos con trades.';
    }
    if (mode === RANGE_MODES.year) {
        return 'Año: apunta a 2+ años consecutivos con trades.';
    }
    return 'Semana: apunta a 4+ semanas consecutivas con trades.';
}

function scoreFromStreak(streak, mode) {
    const s = Math.max(0, streak || 0);
    if (mode === RANGE_MODES.year) {
        return clamp01(logistic01((s - 2.2) / 0.9)) * 100;
    }
    if (mode === RANGE_MODES.month) {
        return clamp01(logistic01((s - 3.2) / 1.2)) * 100;
    }
    return clamp01(logistic01((s - 4.2) / 1.6)) * 100;
}

function scoreLabel(score) {
    if (score >= 90) return { label: 'Elite', cls: 'text-emerald-600 dark:text-emerald-400' };
    if (score >= 75) return { label: 'Sólido', cls: 'text-emerald-600 dark:text-emerald-400' };
    if (score >= 60) return { label: 'Decente', cls: 'text-slate-700 dark:text-slate-200' };
    if (score >= 45) return { label: 'Inestable', cls: 'text-amber-600 dark:text-amber-400' };
    return { label: 'Riesgoso', cls: 'text-rose-600 dark:text-rose-400' };
}

function reliabilityLabel(r) {
    if (r >= 0.85) return 'Alta';
    if (r >= 0.6) return 'Media';
    return 'Baja';
}

function setScoreUI({ score, labelText, labelClass, reliability, reliabilityText }) {
    const scoreEl = document.getElementById('stat-score');
    const labelEl = document.getElementById('stat-score-label');
    const subEl = document.getElementById('stat-score-sub');
    const relEl = document.getElementById('stat-score-reliability');
    const barEl = document.getElementById('score-bar');

    if (scoreEl) scoreEl.textContent = typeof score === 'number' ? String(score) : '--';
    if (labelEl) {
        labelEl.textContent = labelText || '--';
        labelEl.className = `font-semibold ${labelClass || 'text-slate-700 dark:text-slate-200'}`;
    }
    if (subEl) subEl.textContent = 'Basado en tu rendimiento del rango';
    if (relEl) relEl.textContent = `Confiabilidad: ${reliabilityText || '--'}`;

    if (barEl) {
        const w = typeof score === 'number' ? Math.max(0, Math.min(100, score)) : 0;
        barEl.style.width = `${w}%`;
        if (typeof score !== 'number') {
            barEl.className = 'h-full bg-slate-300 dark:bg-slate-600';
        } else if (score >= 75) {
            barEl.className = 'h-full bg-emerald-500';
        } else if (score >= 60) {
            barEl.className = 'h-full bg-slate-500 dark:bg-slate-400';
        } else if (score >= 45) {
            barEl.className = 'h-full bg-amber-500';
        } else {
            barEl.className = 'h-full bg-rose-500';
        }
        barEl.style.opacity = typeof reliability === 'number' ? String(0.55 + 0.45 * clamp01(reliability)) : '1';
    }
}

async function readSimulationsInRange(start, end) {
    const db = await openAnalyticsDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(['simulations'], 'readonly');
            const store = tx.objectStore('simulations');
            const index = store.index('timestamp');
            const range = IDBKeyRange.bound(start, end - 1);
            const items = [];

            const cursorReq = index.openCursor(range, 'prev');
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) {
                    resolve(items);
                    return;
                }
                items.push(cursor.value);
                cursor.continue();
            };
            cursorReq.onerror = () => reject(cursorReq.error || new Error('Error leyendo simulaciones'));
        });
    } finally {
        db.close();
    }
}

async function hasDecidedTradesInRange(start, end) {
    const db = await openAnalyticsDb();
    try {
        return await new Promise((resolve, reject) => {
            const tx = db.transaction(['simulations'], 'readonly');
            const store = tx.objectStore('simulations');
            const index = store.index('timestamp');
            const range = IDBKeyRange.bound(start, end - 1);

            const cursorReq = index.openCursor(range, 'prev');
            cursorReq.onsuccess = () => {
                const cursor = cursorReq.result;
                if (!cursor) {
                    resolve(false);
                    return;
                }
                const v = cursor.value;
                if (v && (v.result === 'tp' || v.result === 'sl' || v.result === 'draw')) {
                    resolve(true);
                    return;
                }
                cursor.continue();
            };
            cursorReq.onerror = () => reject(cursorReq.error || new Error('Error leyendo simulaciones'));
        });
    } finally {
        db.close();
    }
}

function streakLabelByMode(mode) {
    if (mode === RANGE_MODES.month) return 'Meses consecutivos con trades';
    if (mode === RANGE_MODES.year) return 'Años consecutivos con trades';
    return 'Semanas consecutivas con trades';
}

function formatDayKeyLocal(ms) {
    const d = new Date(ms);
    const y = d.getFullYear();
    const m = String(d.getMonth() + 1).padStart(2, '0');
    const day = String(d.getDate()).padStart(2, '0');
    return `${y}-${m}-${day}`;
}

function dayStartMs(ms) {
    const d = new Date(ms);
    d.setHours(0, 0, 0, 0);
    return d.getTime();
}

function heatLevel(count, max) {
    if (!count || count <= 0) return 0;
    if (!max || max <= 1) return 4;
    const r = count / max;
    if (r > 0.75) return 4;
    if (r > 0.5) return 3;
    if (r > 0.25) return 2;
    return 1;
}

function heatClass(level) {
    if (level === 4) return 'bg-emerald-500 border-emerald-400/70';
    if (level === 3) return 'bg-emerald-400 dark:bg-emerald-600/70 border-emerald-300/60 dark:border-emerald-900/40';
    if (level === 2) return 'bg-emerald-200 dark:bg-emerald-900/35 border-emerald-200/60 dark:border-emerald-900/40';
    if (level === 1) return 'bg-emerald-100 dark:bg-emerald-900/20 border-emerald-200/60 dark:border-emerald-900/40';
    return 'bg-slate-100 dark:bg-slate-800 border-slate-200 dark:border-slate-700';
}

function renderHeatmap({ mode, start, end, label, items }) {
    const grid = document.getElementById('heatmap-grid');
    if (!grid) return;

    setText('heatmap-title', `Actividad diaria · ${label}`);
    setText('heatmap-subtitle', `Días con operaciones en ${label.toLowerCase()}`);

    const countsByDay = new Map();
    for (const it of items) {
        if (!it || typeof it.timestamp !== 'number' || !Number.isFinite(it.timestamp)) continue;
        const key = formatDayKeyLocal(it.timestamp);
        countsByDay.set(key, (countsByDay.get(key) || 0) + 1);
    }

    const gridStart = mode === RANGE_MODES.week ? start : getWeekBounds(new Date(start)).start;
    const gridEnd = mode === RANGE_MODES.week ? end : getWeekBounds(new Date(end - 1)).end;

    const oneDayMs = 24 * 60 * 60 * 1000;
    const weeks = [];
    let maxCount = 0;

    for (let t = gridStart; t < gridEnd; t += oneDayMs) {
        const ws = Math.floor((t - gridStart) / WEEK_MS);
        const dow = (new Date(t).getDay() + 6) % 7;
        if (!weeks[ws]) weeks[ws] = Array(7).fill(null);

        const inRange = t >= start && t < end;
        if (!inRange) {
            weeks[ws][dow] = { inRange: false, ms: t, count: null };
            continue;
        }

        const k = formatDayKeyLocal(t);
        const c = countsByDay.get(k) || 0;
        if (c > maxCount) maxCount = c;
        weeks[ws][dow] = { inRange: true, ms: t, count: c };
    }

    grid.innerHTML = '';
    weeks.forEach((col) => {
        const colEl = document.createElement('div');
        colEl.className = 'flex flex-col gap-1';

        for (let i = 0; i < 7; i += 1) {
            const cell = col ? col[i] : null;
            const el = document.createElement('div');
            el.className = 'w-3 h-3 rounded border';

            if (!cell || !cell.inRange) {
                el.className = `${el.className} bg-transparent border-transparent`;
                colEl.appendChild(el);
                continue;
            }

            const level = heatLevel(cell.count, maxCount);
            el.className = `${el.className} ${heatClass(level)}`;

            const d = new Date(dayStartMs(cell.ms));
            const dateLabel = d.toLocaleDateString([], { day: '2-digit', month: '2-digit', year: 'numeric' });
            const countLabel = cell.count === 1 ? '1 operación' : `${cell.count} operaciones`;
            el.setAttribute('title', `${dateLabel} · ${countLabel}`);
            el.setAttribute('role', 'gridcell');
            el.setAttribute('tabindex', '0');
            el.setAttribute('aria-label', `${dateLabel}: ${countLabel}`);
            colEl.appendChild(el);
        }

        grid.appendChild(colEl);
    });
}

function resultBadge(result) {
    if (result === 'tp') {
        return { text: 'TP', cls: 'bg-emerald-50 text-emerald-700 border-emerald-100 dark:bg-emerald-900/20 dark:text-emerald-300 dark:border-emerald-900/40' };
    }
    if (result === 'sl') {
        return { text: 'SL', cls: 'bg-rose-50 text-rose-700 border-rose-100 dark:bg-rose-900/20 dark:text-rose-300 dark:border-rose-900/40' };
    }
    if (result === 'draw') {
        return { text: 'EMPATE', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700' };
    }
    return { text: 'PENDIENTE', cls: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-slate-800 dark:text-slate-200 dark:border-slate-700' };
}

function renderHistory(items) {
    const tbody = document.getElementById('stats-history');
    const empty = document.getElementById('stats-empty');
    if (!tbody) return;

    tbody.innerHTML = '';
    const slice = items.slice(0, 10);

    if (!slice.length) {
        if (empty) empty.classList.remove('hidden');
        return;
    }

    if (empty) empty.classList.add('hidden');

    slice.forEach((it) => {
        const tr = document.createElement('tr');
        tr.className = 'border-t border-slate-100 dark:border-slate-800';

        const tdDate = document.createElement('td');
        tdDate.className = 'py-2 pr-3 whitespace-nowrap text-slate-500 dark:text-slate-400';
        tdDate.textContent = formatShortDateTime(it.timestamp);

        const tdSymbol = document.createElement('td');
        tdSymbol.className = 'py-2 pr-3 font-mono';
        tdSymbol.textContent = String(it.symbol || '--');

        const tdDir = document.createElement('td');
        tdDir.className = 'py-2 pr-3';
        tdDir.textContent = it.direction === 'long' ? 'Long' : (it.direction === 'short' ? 'Short' : '--');

        const tdRes = document.createElement('td');
        tdRes.className = 'py-2 pr-3';
        const badge = resultBadge(it.result);
        const span = document.createElement('span');
        span.className = `inline-flex items-center px-2 py-0.5 rounded-md border text-[10px] font-semibold tracking-wide ${badge.cls}`;
        span.textContent = badge.text;
        tdRes.appendChild(span);

        const tdPnl = document.createElement('td');
        tdPnl.className = 'py-2 pr-3 text-right font-mono';
        if (typeof it.pnlPct === 'number' && Number.isFinite(it.pnlPct)) {
            const sign = it.pnlPct >= 0 ? '+' : '';
            tdPnl.textContent = `${sign}${it.pnlPct.toFixed(2)}%`;
            tdPnl.classList.add(it.pnlPct >= 0 ? 'text-emerald-600' : 'text-rose-600', 'dark:text-slate-100');
        } else {
            tdPnl.textContent = '--';
            tdPnl.classList.add('text-slate-500', 'dark:text-slate-400');
        }

        tr.appendChild(tdDate);
        tr.appendChild(tdSymbol);
        tr.appendChild(tdDir);
        tr.appendChild(tdRes);
        tr.appendChild(tdPnl);
        tbody.appendChild(tr);
    });
}

async function loadWeeklyStats() {
    const loading = document.getElementById('stats-loading');
    if (loading) loading.textContent = 'Cargando...';

    const currentStart = currentRangeStartByMode[rangeMode] ?? getBoundsByMode(rangeMode).start;
    const selectedStart = selectedRangeStartByMode[rangeMode] ?? currentStart;
    const { start, end } = getBoundsByMode(rangeMode, new Date(selectedStart));
    const isCurrent = start === currentStart;
    const label = labelForRange(rangeMode, currentStart, start);

    setText('week-range', `${label} · ${formatRangeDisplay(rangeMode, start, end)}`);
    setText('stats-subtitle', `${label} · Resumen de tu rendimiento`);
    setText('stats-week-footer-label', label);
    setText('stats-history-title', `Últimas simulaciones · ${label}`);
    setText('stats-empty-text', `Aún no hay simulaciones registradas en ${label.toLowerCase()}.`);
    setText('score-guide-sample-text', sampleGuidanceByMode(rangeMode));
    setText('score-guide-streak-text', streakGuidanceByMode(rangeMode));

    if (weekNextBtn) {
        weekNextBtn.disabled = isCurrent;
    }

    let items = [];
    try {
        items = await readSimulationsInRange(start, end);
    } catch (e) {
        items = [];
    }

    renderHeatmap({ mode: rangeMode, start, end, label, items });

    const total = items.length;
    const tp = items.filter(i => i.result === 'tp').length;
    const sl = items.filter(i => i.result === 'sl').length;
    const draw = items.filter(i => i.result === 'draw').length;
    const pending = items.filter(i => !i.result).length;
    const resolved = tp + sl;
    const decided = resolved + draw;

    const resolvedItems = items.filter(i => i && (i.result === 'tp' || i.result === 'sl'));
    let rrSum = 0;
    let rrCount = 0;
    for (const it of resolvedItems) {
        const entry = typeof it.entryPrice === 'number' ? it.entryPrice : null;
        const slPrice = typeof it.slPrice === 'number' ? it.slPrice : null;
        const tpPrice = typeof it.tpPrice === 'number' ? it.tpPrice : null;
        if (!Number.isFinite(entry) || !Number.isFinite(slPrice) || !Number.isFinite(tpPrice)) continue;
        const risk = Math.abs(entry - slPrice);
        const reward = Math.abs(tpPrice - entry);
        if (!Number.isFinite(risk) || !Number.isFinite(reward) || risk <= 0) continue;
        rrSum += reward / risk;
        rrCount += 1;
    }
    const rrAvg = rrCount > 0 ? rrSum / rrCount : null;

    const pnlItems = resolvedItems.filter(i => typeof i.pnlPct === 'number' && Number.isFinite(i.pnlPct));
    const pnlCount = pnlItems.length;
    const netPnl = pnlCount > 0 ? pnlItems.reduce((acc, it) => acc + it.pnlPct, 0) : null;
    const avgPnl = pnlCount > 0 ? netPnl / pnlCount : null;

    let streak = 0;
    if (decided > 0) {
        streak = 1;
        let prevStart = stepRangeStart(rangeMode, start, -1);
        const cap = rangeMode === RANGE_MODES.year ? 50 : (rangeMode === RANGE_MODES.month ? 240 : 520);
        for (let i = 0; i < cap; i += 1) {
            const prevBounds = getBoundsByMode(rangeMode, new Date(prevStart));
            const has = await hasDecidedTradesInRange(prevBounds.start, prevBounds.end);
            if (!has) break;
            streak += 1;
            prevStart = stepRangeStart(rangeMode, prevBounds.start, -1);
        }
    }

    const scoreWrEl = document.getElementById('stat-score-wr');
    const scoreRrEl = document.getElementById('stat-score-rr');
    const scoreAvgPnlEl = document.getElementById('stat-score-avgpnl');
    const scoreNEl = document.getElementById('stat-score-n');

    if (scoreWrEl) {
        if (resolved > 0) {
            const winRate01 = tp / resolved;
            scoreWrEl.textContent = `${(winRate01 * 100).toFixed(1)}%`;
        } else {
            scoreWrEl.textContent = '--';
        }
    }

    if (scoreRrEl) {
        scoreRrEl.textContent = rrCount > 0 && rrAvg !== null ? `1:${rrAvg.toFixed(2)}` : '--';
    }

    if (scoreAvgPnlEl) {
        if (pnlCount > 0 && avgPnl !== null) {
            const sign = avgPnl >= 0 ? '+' : '';
            scoreAvgPnlEl.textContent = `${sign}${avgPnl.toFixed(2)}%`;
            scoreAvgPnlEl.className = `mt-1 text-sm font-mono font-bold ${avgPnl >= 0 ? 'text-emerald-600 dark:text-emerald-400' : 'text-rose-600 dark:text-rose-400'}`;
        } else {
            scoreAvgPnlEl.textContent = '--';
            scoreAvgPnlEl.className = 'mt-1 text-sm font-mono font-bold text-slate-900 dark:text-slate-100';
        }
    }

    if (scoreNEl) {
        scoreNEl.textContent = resolved > 0 ? `${resolved} trades` : '--';
    }

    if (resolved <= 0) {
        setScoreUI({ score: null, labelText: 'Sin trades resueltos', labelClass: 'text-slate-700 dark:text-slate-200', reliability: 0, reliabilityText: '--' });
    } else {
        const winRate01 = tp / resolved;
        const wrScore = scoreFromWinRate01(winRate01);
        const rrScore = rrAvg !== null ? scoreFromAvgRR(rrAvg) : 50;
        const pnlScore = avgPnl !== null ? scoreFromAvgPnlPct(avgPnl) : 50;
        const streakScore = scoreFromStreak(streak, rangeMode);
        const baseScore = 0.40 * wrScore + 0.22 * rrScore + 0.28 * pnlScore + 0.10 * streakScore;
        const reliability = reliabilityFromSample(resolved);
        const finalScore = 50 + (baseScore - 50) * reliability;
        const score = Math.max(1, Math.min(100, Math.round(finalScore)));
        const { label: lbl, cls } = scoreLabel(score);
        setScoreUI({ score, labelText: lbl, labelClass: cls, reliability, reliabilityText: reliabilityLabel(reliability) });
    }

    setText('stat-week-sims', String(total));
    const simsSub = pending > 0 ? `${label} · ${pending} pendientes` : label;
    setText('stat-week-sims-sub', simsSub);
    setText('stat-week-tp', String(tp));
    setText('stat-week-sl', String(sl));
    setText('stat-week-draw', String(draw));
    setText('stat-week-breakdown', `TP ${tp} / SL ${sl} / Empates ${draw}`);

    setRRValue('stat-avg-rr', rrAvg);
    setText('stat-avg-rr-sub', rrCount > 0 ? `Sobre ${rrCount} trades resueltos` : 'Sin trades resueltos');

    setSignedPercent('stat-net-pnl', netPnl);
    setText('stat-net-pnl-sub', pnlCount > 0 ? `Suma de ${pnlCount} trades resueltos` : 'Sin trades resueltos');

    setSignedPercent('stat-avg-pnl', avgPnl);
    setText('stat-avg-pnl-sub', pnlCount > 0 ? `Promedio en ${pnlCount} trades resueltos` : 'Sin trades resueltos');

    setText('stat-streak', String(streak));
    setText('stat-streak-sub', `${streakLabelByMode(rangeMode)} · hasta ${label.toLowerCase()}`);

    if (resolved > 0) {
        const winRate = (tp / resolved) * 100;
        setText('stat-week-winrate', `${winRate.toFixed(1)}%`);
        setText('stat-week-winrate-sub', `Sobre ${resolved} trades resueltos`);
    } else {
        setText('stat-week-winrate', '--');
        setText('stat-week-winrate-sub', 'Sin trades resueltos');
    }

    const denom = Math.max(1, tp + sl + draw);
    const wTp = (tp / denom) * 100;
    const wSl = (sl / denom) * 100;
    const wDraw = (draw / denom) * 100;

    const barTp = document.getElementById('bar-tp');
    const barSl = document.getElementById('bar-sl');
    const barDraw = document.getElementById('bar-draw');
    if (barTp) barTp.style.width = `${wTp}%`;
    if (barSl) barSl.style.width = `${wSl}%`;
    if (barDraw) barDraw.style.width = `${wDraw}%`;

    renderHistory(items);

    if (loading) loading.textContent = 'Listo';
}

function stepRangeStart(mode, start, direction) {
    const d = new Date(start);
    if (mode === RANGE_MODES.month) {
        d.setMonth(d.getMonth() + direction);
        return clampToMonthStart(d.getTime());
    }
    if (mode === RANGE_MODES.year) {
        d.setFullYear(d.getFullYear() + direction);
        return clampToYearStart(d.getTime());
    }
    return clampToMondayStart(start + direction * WEEK_MS);
}

function setSelectedRangeStart(mode, targetStart) {
    const currentStart = currentRangeStartByMode[mode] ?? getBoundsByMode(mode).start;
    const aligned = clampToModeStart(mode, targetStart);
    const safe = Math.min(aligned, currentStart);
    selectedRangeStartByMode[mode] = safe;
    loadWeeklyStats();
}

function setRangeMode(nextMode) {
    rangeMode = nextMode;
    const currentStart = currentRangeStartByMode[nextMode] ?? getBoundsByMode(nextMode).start;
    if (selectedRangeStartByMode[nextMode] === null) {
        selectedRangeStartByMode[nextMode] = currentStart;
    }

    const activeClass = 'bg-slate-200 text-slate-900 shadow-sm dark:bg-slate-600 dark:text-white font-semibold';
    const inactiveClass = 'text-slate-600 hover:text-slate-900 hover:bg-slate-100 dark:text-slate-400 dark:hover:text-slate-200 dark:hover:bg-slate-800';

    const setBtn = (btn, active) => {
        if (!btn) return;
        btn.className = `px-3 py-1 rounded-md transition ${active ? activeClass : inactiveClass}`;
        btn.setAttribute('aria-pressed', active ? 'true' : 'false');
    };

    setBtn(rangeModeWeekBtn, nextMode === RANGE_MODES.week);
    setBtn(rangeModeMonthBtn, nextMode === RANGE_MODES.month);
    setBtn(rangeModeYearBtn, nextMode === RANGE_MODES.year);

    loadWeeklyStats();
}

if (navToggle && navMenu) {
    navToggle.addEventListener('click', (e) => {
        e.stopPropagation();
        navMenu.classList.toggle('hidden');
    });
    document.addEventListener('click', (e) => {
        if (navMenu.classList.contains('hidden')) return;
        if (!navMenu.contains(e.target) && !navToggle.contains(e.target)) {
            navMenu.classList.add('hidden');
        }
    });
    document.addEventListener('keydown', (e) => {
        if (e.key === 'Escape') navMenu.classList.add('hidden');
    });
    navMenu.querySelectorAll('a').forEach((link) => {
        link.addEventListener('click', () => navMenu.classList.add('hidden'));
    });
}

window.addEventListener('DOMContentLoaded', () => {
    if (window.lucide && typeof window.lucide.createIcons === 'function') {
        window.lucide.createIcons();
    }

    currentRangeStartByMode.week = getWeekBounds().start;
    currentRangeStartByMode.month = getMonthBounds().start;
    currentRangeStartByMode.year = getYearBounds().start;

    selectedRangeStartByMode.week = currentRangeStartByMode.week;
    rangeMode = RANGE_MODES.week;

    setRangeMode(RANGE_MODES.week);

    if (weekPrevBtn) {
        weekPrevBtn.addEventListener('click', () => {
            const base = selectedRangeStartByMode[rangeMode] ?? currentRangeStartByMode[rangeMode];
            setSelectedRangeStart(rangeMode, stepRangeStart(rangeMode, base, -1));
        });
    }
    if (weekNextBtn) {
        weekNextBtn.addEventListener('click', () => {
            const base = selectedRangeStartByMode[rangeMode] ?? currentRangeStartByMode[rangeMode];
            setSelectedRangeStart(rangeMode, stepRangeStart(rangeMode, base, +1));
        });
    }
    if (weekRangeBtn) {
        weekRangeBtn.addEventListener('click', () => {
            setSelectedRangeStart(rangeMode, currentRangeStartByMode[rangeMode]);
        });
    }

    if (rangeModeWeekBtn) {
        rangeModeWeekBtn.addEventListener('click', () => setRangeMode(RANGE_MODES.week));
    }
    if (rangeModeMonthBtn) {
        rangeModeMonthBtn.addEventListener('click', () => setRangeMode(RANGE_MODES.month));
    }
    if (rangeModeYearBtn) {
        rangeModeYearBtn.addEventListener('click', () => setRangeMode(RANGE_MODES.year));
    }
});

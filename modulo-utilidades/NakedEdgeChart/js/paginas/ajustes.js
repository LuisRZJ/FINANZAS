const navToggle = document.getElementById('nav-toggle');
const navMenu = document.getElementById('nav-menu');

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

    const optionButtons = document.querySelectorAll('[data-theme-option]');
    if (window.NECTheme) {
        const stored = window.NECTheme.getStoredTheme();
        const storedAccent = window.NECTheme.getStoredAccent();
        window.NECTheme.updateUI(stored);
        window.NECTheme.updateUIAccent(storedAccent);

        optionButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const value = btn.getAttribute('data-theme-option');
                window.NECTheme.setTheme(value);
            });
        });

        const accentButtons = document.querySelectorAll('[data-accent-option]');
        accentButtons.forEach((btn) => {
            btn.addEventListener('click', () => {
                const value = btn.getAttribute('data-accent-option');
                window.NECTheme.setAccent(value);
            });
        });
    }

    const storageUsedEl = document.getElementById('storage-used');
    const storageQuotaEl = document.getElementById('storage-quota');
    const storageBarEl = document.getElementById('storage-bar');
    const storageStatusEl = document.getElementById('storage-status');
    const storageNoteEl = document.getElementById('storage-note');
    const exportBtn = document.getElementById('storage-export');
    const discordBtn = document.getElementById('storage-discord');
    const deleteBtn = document.getElementById('storage-delete');
    const importBtn = document.getElementById('storage-import');
    const importFileInput = document.getElementById('storage-import-file');

    const webhookUrlInput = document.getElementById('discord-webhook-url');
    const webhookSaveBtn = document.getElementById('discord-webhook-save');
    const webhookClearBtn = document.getElementById('discord-webhook-clear');
    const webhookStatusEl = document.getElementById('discord-webhook-status');

    const ANALYTICS_DB_NAME = 'nec_analytics';
    const ANALYTICS_DB_VERSION = 1;
    const DISCORD_WEBHOOK_STORAGE_KEY = 'nec_discord_webhook_url';

    function setStatus(text) {
        if (storageStatusEl) storageStatusEl.textContent = text;
    }

    function formatBytes(bytes) {
        const n = Number(bytes);
        if (!Number.isFinite(n) || n < 0) return '--';
        const units = ['B', 'KB', 'MB', 'GB'];
        let v = n;
        let i = 0;
        while (v >= 1024 && i < units.length - 1) {
            v /= 1024;
            i += 1;
        }
        return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
    }

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

    async function readAllSimulations() {
        const db = await openAnalyticsDb();
        try {
            return await new Promise((resolve, reject) => {
                const tx = db.transaction(['simulations'], 'readonly');
                const store = tx.objectStore('simulations');
                const req = store.getAll();
                req.onsuccess = () => resolve(req.result || []);
                req.onerror = () => reject(req.error || new Error('Error leyendo simulaciones'));
            });
        } finally {
            db.close();
        }
    }

    function localStorageSnapshot() {
        const out = {};
        try {
            const keys = ['nec_theme_preference', 'nec_accent_preference', DISCORD_WEBHOOK_STORAGE_KEY];
            keys.forEach((k) => {
                const v = localStorage.getItem(k);
                if (v !== null) out[k] = v;
            });
        } catch (e) { }
        return out;
    }

    function setWebhookStatus(text) {
        if (webhookStatusEl) webhookStatusEl.textContent = text;
    }

    function normalizeWebhookUrl(raw) {
        const t = String(raw || '').trim();
        if (!t) return '';
        try {
            const u = new URL(t);
            const hostOk = u.hostname === 'discord.com' || u.hostname === 'canary.discord.com' || u.hostname === 'ptb.discord.com';
            const pathOk = /^\/api\/webhooks\/[0-9]+\/.+/.test(u.pathname);
            if (!hostOk || !pathOk) return '';
            return u.toString();
        } catch (e) {
            return '';
        }
    }

    function getStoredWebhookUrl() {
        try {
            return localStorage.getItem(DISCORD_WEBHOOK_STORAGE_KEY) || '';
        } catch (e) {
            return '';
        }
    }

    function setStoredWebhookUrl(url) {
        try {
            if (!url) {
                localStorage.removeItem(DISCORD_WEBHOOK_STORAGE_KEY);
                return;
            }
            localStorage.setItem(DISCORD_WEBHOOK_STORAGE_KEY, url);
        } catch (e) { }
    }

    async function estimateUsage() {
        if (navigator.storage && typeof navigator.storage.estimate === 'function') {
            try {
                const { usage, quota } = await navigator.storage.estimate();
                return {
                    usage: typeof usage === 'number' ? usage : null,
                    quota: typeof quota === 'number' ? quota : null,
                    source: 'storage-api'
                };
            } catch (e) { }
        }

        try {
            const simulations = await readAllSimulations();
            const payload = { simulations, localStorage: localStorageSnapshot() };
            const approx = new Blob([JSON.stringify(payload)]).size;
            return { usage: approx, quota: null, source: 'approx' };
        } catch (e) {
            return { usage: null, quota: null, source: 'unknown' };
        }
    }

    async function refreshStorageUI() {
        setStatus('Calculando…');
        const { usage, quota, source } = await estimateUsage();

        if (storageUsedEl) storageUsedEl.textContent = formatBytes(usage);
        if (storageQuotaEl) storageQuotaEl.textContent = quota ? formatBytes(quota) : '--';

        if (storageBarEl) {
            const pct = usage && quota ? Math.max(0, Math.min(100, (usage / quota) * 100)) : 0;
            storageBarEl.style.width = `${pct}%`;
        }

        if (storageNoteEl) {
            storageNoteEl.textContent = source === 'storage-api'
                ? 'Incluye IndexedDB y preferencias de la app.'
                : 'Estimación aproximada basada en datos exportables.';
        }

        setStatus('Listo');
    }

    async function deleteAllData() {
        const ok = window.confirm('Esto borrará todos tus datos locales (historial y preferencias) en este navegador. ¿Deseas continuar?');
        if (!ok) return;

        setStatus('Borrando…');

        try {
            await new Promise((resolve, reject) => {
                const req = indexedDB.deleteDatabase(ANALYTICS_DB_NAME);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error || new Error('Error borrando IndexedDB'));
                req.onblocked = () => reject(new Error('Borrado bloqueado. Cierra otras pestañas de la app.'));
            });
        } catch (e) {
            setStatus(e && e.message ? e.message : 'Error borrando');
            return;
        }

        try {
            localStorage.removeItem('nec_theme_preference');
            localStorage.removeItem('nec_accent_preference');
            localStorage.removeItem(DISCORD_WEBHOOK_STORAGE_KEY);
        } catch (e) { }

        setStatus('Borrado');
        await refreshStorageUI();

        if (window.NECTheme) {
            const stored = window.NECTheme.getStoredTheme();
            const storedAccent = window.NECTheme.getStoredAccent();
            window.NECTheme.updateUI(stored);
            window.NECTheme.updateUIAccent(storedAccent);
        }
    }

    async function downloadData() {
        setStatus('Preparando…');
        let simulations = [];
        try {
            simulations = await readAllSimulations();
        } catch (e) {
            simulations = [];
        }

        const exportObject = {
            meta: {
                app: 'NakedEdgeChart',
                exportedAt: new Date().toISOString(),
                formatVersion: 1
            },
            localStorage: localStorageSnapshot(),
            indexedDB: {
                [ANALYTICS_DB_NAME]: {
                    version: ANALYTICS_DB_VERSION,
                    simulations
                }
            }
        };

        const blob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `naked-edge-chart-datos-${new Date().toISOString().slice(0, 10)}.json`;
        document.body.appendChild(a);
        a.click();
        a.remove();
        URL.revokeObjectURL(url);
        setStatus('Descargado');
        await refreshStorageUI();
    }

    function buildDiscordEmbedFromData(simulations) {
        const sims = Array.isArray(simulations) ? simulations : [];
        const total = sims.length;
        const tp = sims.filter(i => i && i.result === 'tp').length;
        const sl = sims.filter(i => i && i.result === 'sl').length;
        const draw = sims.filter(i => i && i.result === 'draw').length;
        const pending = sims.filter(i => i && !i.result).length;

        return {
            title: 'Exportación de NakedEdgeChart',
            description: 'Datos exportados desde la sección de Ajustes',
            color: 0x22c55e,
            timestamp: new Date().toISOString(),
            fields: [
                { name: 'Simulaciones', value: String(total), inline: true },
                { name: 'TP / SL / Empates', value: `${tp} / ${sl} / ${draw}`, inline: true },
                { name: 'Pendientes', value: String(pending), inline: true }
            ]
        };
    }

    async function sendDataToDiscord() {
        const raw = webhookUrlInput ? webhookUrlInput.value : getStoredWebhookUrl();
        const webhookUrl = normalizeWebhookUrl(raw);
        if (!webhookUrl) {
            setStatus('Webhook inválido');
            setWebhookStatus('URL inválida');
            return;
        }

        setStatus('Preparando…');
        setWebhookStatus('Enviando…');

        let simulations = [];
        try {
            simulations = await readAllSimulations();
        } catch (e) {
            simulations = [];
        }

        const exportObject = {
            meta: {
                app: 'NakedEdgeChart',
                exportedAt: new Date().toISOString(),
                formatVersion: 1
            },
            localStorage: localStorageSnapshot(),
            indexedDB: {
                [ANALYTICS_DB_NAME]: {
                    version: ANALYTICS_DB_VERSION,
                    simulations
                }
            }
        };

        const fileName = `naked-edge-chart-datos-${new Date().toISOString().slice(0, 10)}.json`;
        const fileBlob = new Blob([JSON.stringify(exportObject, null, 2)], { type: 'application/json' });
        const file = new File([fileBlob], fileName, { type: 'application/json' });

        const payload = {
            username: 'NakedEdgeChart',
            embeds: [buildDiscordEmbedFromData(simulations)]
        };

        const form = new FormData();
        form.append('payload_json', JSON.stringify(payload));
        form.append('files[0]', file);

        try {
            const res = await fetch(webhookUrl, { method: 'POST', body: form });
            if (!res.ok) {
                setStatus(`Error Discord (${res.status})`);
                setWebhookStatus(`Error ${res.status}`);
                return;
            }
        } catch (e) {
            setStatus('Error enviando');
            setWebhookStatus('Error');
            return;
        }

        setStatus('Enviado');
        setWebhookStatus('Listo');
        await refreshStorageUI();
    }

    function parseImportJson(text) {
        const obj = JSON.parse(text);
        const db = obj && obj.indexedDB && obj.indexedDB[ANALYTICS_DB_NAME];
        const simulations = db && Array.isArray(db.simulations) ? db.simulations : [];
        const ls = obj && obj.localStorage && typeof obj.localStorage === 'object' ? obj.localStorage : {};
        return { simulations, localStorage: ls };
    }

    async function restoreDataFromFile(file) {
        if (!file) return;
        const ok = window.confirm('Esto reemplazará tus datos locales actuales por los del archivo. ¿Deseas continuar?');
        if (!ok) return;

        setStatus('Restaurando…');
        let text = '';
        try {
            text = await file.text();
        } catch (e) {
            setStatus('No se pudo leer el archivo');
            return;
        }

        let parsed;
        try {
            parsed = parseImportJson(text);
        } catch (e) {
            setStatus('JSON inválido');
            return;
        }

        try {
            await new Promise((resolve, reject) => {
                const req = indexedDB.deleteDatabase(ANALYTICS_DB_NAME);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error || new Error('Error borrando IndexedDB'));
                req.onblocked = () => reject(new Error('Restauración bloqueada. Cierra otras pestañas de la app.'));
            });
        } catch (e) {
            setStatus(e && e.message ? e.message : 'Error');
            return;
        }

        let db;
        try {
            db = await openAnalyticsDb();
        } catch (e) {
            setStatus('No se pudo abrir la base de datos');
            return;
        }

        try {
            await new Promise((resolve, reject) => {
                const tx = db.transaction(['simulations'], 'readwrite');
                const store = tx.objectStore('simulations');
                store.clear();

                const sims = Array.isArray(parsed.simulations) ? parsed.simulations : [];
                sims.forEach((it) => {
                    if (!it || typeof it !== 'object') return;
                    const v = { ...it };
                    const req = store.put(v);
                    req.onerror = () => { };
                });

                tx.oncomplete = () => resolve();
                tx.onerror = () => reject(tx.error || new Error('Error restaurando'));
                tx.onabort = () => reject(tx.error || new Error('Restauración abortada'));
            });
        } catch (e) {
            setStatus('Error restaurando datos');
            db.close();
            return;
        }

        db.close();

        try {
            if (parsed.localStorage && typeof parsed.localStorage === 'object') {
                if (typeof parsed.localStorage.nec_theme_preference === 'string') {
                    localStorage.setItem('nec_theme_preference', parsed.localStorage.nec_theme_preference);
                }
                if (typeof parsed.localStorage.nec_accent_preference === 'string') {
                    localStorage.setItem('nec_accent_preference', parsed.localStorage.nec_accent_preference);
                }
                if (typeof parsed.localStorage[DISCORD_WEBHOOK_STORAGE_KEY] === 'string') {
                    const normalized = normalizeWebhookUrl(parsed.localStorage[DISCORD_WEBHOOK_STORAGE_KEY]);
                    if (normalized) {
                        localStorage.setItem(DISCORD_WEBHOOK_STORAGE_KEY, normalized);
                    } else {
                        localStorage.removeItem(DISCORD_WEBHOOK_STORAGE_KEY);
                    }
                }
            }
        } catch (e) { }

        if (window.NECTheme) {
            const stored = window.NECTheme.getStoredTheme();
            const storedAccent = window.NECTheme.getStoredAccent();
            window.NECTheme.applyTheme(stored);
            window.NECTheme.applyAccent(storedAccent);
        }

        setStatus('Restaurado');
        await refreshStorageUI();

        if (webhookUrlInput) {
            webhookUrlInput.value = getStoredWebhookUrl();
        }
        setWebhookStatus(getStoredWebhookUrl() ? 'Configurado' : 'No configurado');
    }

    if (exportBtn) exportBtn.addEventListener('click', () => downloadData());
    if (discordBtn) discordBtn.addEventListener('click', () => sendDataToDiscord());
    if (deleteBtn) deleteBtn.addEventListener('click', () => deleteAllData());
    if (importBtn) {
        importBtn.addEventListener('click', () => {
            const file = importFileInput && importFileInput.files ? importFileInput.files[0] : null;
            restoreDataFromFile(file);
        });
    }

    refreshStorageUI();

    if (webhookUrlInput) {
        webhookUrlInput.value = getStoredWebhookUrl();
    }
    setWebhookStatus(getStoredWebhookUrl() ? 'Configurado' : 'No configurado');

    if (webhookSaveBtn) {
        webhookSaveBtn.addEventListener('click', () => {
            const normalized = normalizeWebhookUrl(webhookUrlInput ? webhookUrlInput.value : '');
            if (!normalized) {
                setWebhookStatus('URL inválida');
                return;
            }
            setStoredWebhookUrl(normalized);
            if (webhookUrlInput) webhookUrlInput.value = normalized;
            setWebhookStatus('Guardado');
            refreshStorageUI();
        });
    }

    if (webhookClearBtn) {
        webhookClearBtn.addEventListener('click', () => {
            setStoredWebhookUrl('');
            if (webhookUrlInput) webhookUrlInput.value = '';
            setWebhookStatus('Eliminado');
            refreshStorageUI();
        });
    }
    if (webhookClearBtn) {
        webhookClearBtn.addEventListener('click', () => {
            setStoredWebhookUrl('');
            if (webhookUrlInput) webhookUrlInput.value = '';
            setWebhookStatus('Eliminado');
            refreshStorageUI();
        });
    }

    // --- Mobile Sidebar Logic ---
    const appSidebar = document.getElementById('app-sidebar');
    const sidebarOverlay = document.getElementById('sidebar-overlay');
    const mobileMenuBtn = document.getElementById('mobile-menu-btn');
    const mobileMenuClose = document.getElementById('mobile-menu-close');

    function openSidebar() {
        if (!appSidebar || !sidebarOverlay) return;
        appSidebar.classList.remove('translate-x-full');
        sidebarOverlay.classList.remove('hidden');
        // Force reflow
        void sidebarOverlay.offsetWidth;
        sidebarOverlay.classList.remove('opacity-0');
        document.body.style.overflow = 'hidden';
    }

    function closeSidebar() {
        if (!appSidebar || !sidebarOverlay) return;
        appSidebar.classList.add('translate-x-full');
        sidebarOverlay.classList.add('opacity-0');
        setTimeout(() => {
            sidebarOverlay.classList.add('hidden');
            document.body.style.overflow = '';
        }, 300);
    }

    if (mobileMenuBtn) mobileMenuBtn.addEventListener('click', openSidebar);
    if (mobileMenuClose) mobileMenuClose.addEventListener('click', closeSidebar);
    if (sidebarOverlay) sidebarOverlay.addEventListener('click', closeSidebar);
});

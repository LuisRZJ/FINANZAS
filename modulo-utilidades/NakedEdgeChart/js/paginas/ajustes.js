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
            const keys = ['nec_theme_preference', 'nec_accent_preference', DISCORD_WEBHOOK_STORAGE_KEY, 'nec_last_sync_timestamp'];
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

    async function restoreDataFromPayload(parsed) {
        if (!parsed) return false;

        try {
            await new Promise((resolve, reject) => {
                const req = indexedDB.deleteDatabase(ANALYTICS_DB_NAME);
                req.onsuccess = () => resolve();
                req.onerror = () => reject(req.error || new Error('Error borrando IndexedDB'));
                req.onblocked = () => reject(new Error('Restauración bloqueada. Cierra otras pestañas de la app.'));
            });
        } catch (e) {
            return false;
        }

        let db;
        try {
            db = await openAnalyticsDb();
        } catch (e) {
            return false;
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
            db.close();
            return false;
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
                if (typeof parsed.localStorage.nec_last_sync_timestamp === 'string') {
                    localStorage.setItem('nec_last_sync_timestamp', parsed.localStorage.nec_last_sync_timestamp);
                }
            }
        } catch (e) { }

        if (window.NECTheme) {
            const stored = window.NECTheme.getStoredTheme();
            const storedAccent = window.NECTheme.getStoredAccent();
            window.NECTheme.applyTheme(stored);
            window.NECTheme.applyAccent(storedAccent);
        }

        if (webhookUrlInput) {
            webhookUrlInput.value = getStoredWebhookUrl();
        }
        setWebhookStatus(getStoredWebhookUrl() ? 'Configurado' : 'No configurado');
        return true;
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

        const success = await restoreDataFromPayload(parsed);
        if (success) {
            setStatus('Restaurado');
            await refreshStorageUI();
        } else {
            setStatus('Error al restaurar');
        }
    }

    // --- Lógica de Sincronización en la Nube ---
    const CLOUD_PASSWORD_KEY = 'fti_cloud_password';
    const CLOUD_PASSWORD_DATE_KEY = 'fti_cloud_password_date';
    const CLOUD_MODULE_NAME = 'nakededgechart';
    const CHUNK_SIZE_CHARS = 3 * 1024 * 1024; // ~3MB
    const EXPIRATION_DAYS = 15;
    const MS_PER_DAY = 1000 * 60 * 60 * 24;
    const LAST_SYNC_TIMESTAMP_KEY = 'nec_last_sync_timestamp';

    const cloudStatusBadge = document.getElementById('cloud-status-badge');
    const cloudGuestPanel = document.getElementById('cloud-guest-panel');
    const cloudUserPanel = document.getElementById('cloud-user-panel');
    const cloudLoginForm = document.getElementById('cloud-login-form');
    const cloudPasswordInput = document.getElementById('cloud-password-input');
    const cloudLastSyncTime = document.getElementById('cloud-last-sync-time');
    const cloudLogoutBtn = document.getElementById('cloud-logout-btn');
    const cloudBackupBtn = document.getElementById('cloud-backup-btn');
    const cloudRestoreBtn = document.getElementById('cloud-restore-btn');
    const cloudCheckBtn = document.getElementById('cloud-check-btn');
    const cloudInfoMessage = document.getElementById('cloud-info-message');

    function crearModalBloqueante(htmlContent) {
        const overlay = document.createElement('div');
        overlay.className = 'fixed inset-0 z-[100] flex items-center justify-center bg-slate-900/60 backdrop-blur-sm';
        
        const modal = document.createElement('div');
        modal.className = 'w-[90%] max-w-sm bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-2xl rounded-2xl p-6 relative animate-in fade-in zoom-in-95 duration-200';
        modal.innerHTML = htmlContent;

        overlay.appendChild(modal);
        document.body.appendChild(overlay);
        document.body.style.overflow = 'hidden';
        return overlay;
    }

    function cerrarModal(overlay) {
        if (overlay) {
            overlay.remove();
            document.body.style.overflow = '';
        }
    }

    function estaAutenticadoEnNube() {
        const pwd = localStorage.getItem(CLOUD_PASSWORD_KEY);
        const dateStr = localStorage.getItem(CLOUD_PASSWORD_DATE_KEY);
        if (!pwd || !dateStr) return false;
        const date = parseInt(dateStr, 10);
        if (isNaN(date)) return false;
        return (Date.now() - date) / MS_PER_DAY <= EXPIRATION_DAYS;
    }

    function obtenerPasswordNube() {
        return estaAutenticadoEnNube() ? localStorage.getItem(CLOUD_PASSWORD_KEY) : null;
    }

    function guardarPasswordNube(password) {
        if (!password) return;
        localStorage.setItem(CLOUD_PASSWORD_KEY, password);
        localStorage.setItem(CLOUD_PASSWORD_DATE_KEY, Date.now().toString());
    }

    function cerrarSesionNube() {
        localStorage.removeItem(CLOUD_PASSWORD_KEY);
        localStorage.removeItem(CLOUD_PASSWORD_DATE_KEY);
    }

    function showCloudInfo(text, isError = false) {
        if (!cloudInfoMessage) return;
        cloudInfoMessage.textContent = text;
        cloudInfoMessage.classList.remove('hidden');
        if (isError) {
            cloudInfoMessage.className = 'mt-4 text-xs text-center font-medium text-rose-500 dark:text-rose-400';
        } else {
            cloudInfoMessage.className = 'mt-4 text-xs text-center font-medium text-emerald-500 dark:text-emerald-400';
        }
    }

    function hideCloudInfo() {
        if (cloudInfoMessage) cloudInfoMessage.classList.add('hidden');
    }

    async function verificarSeguridadSincronizacionCloud() {
        if (!estaAutenticadoEnNube()) return { safe: false, reason: 'No hay sesión activa' };

        try {
            const password = obtenerPasswordNube();
            const response = await fetch(`/api/sync?module=${CLOUD_MODULE_NAME}&index=true`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${password}` }
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

    async function updateAuthUICloud() {
        hideCloudInfo();
        const authed = estaAutenticadoEnNube();
        
        if (cloudStatusBadge) {
            if (authed) {
                cloudStatusBadge.textContent = 'Conectado';
                cloudStatusBadge.className = 'inline-flex items-center gap-1.5 bg-emerald-50 text-emerald-700 dark:bg-emerald-950/30 dark:text-emerald-300 text-xs font-semibold px-3 py-1 rounded-full border border-emerald-200 dark:border-emerald-800/50';
            } else {
                cloudStatusBadge.textContent = 'Desconectado';
                cloudStatusBadge.className = 'inline-flex items-center gap-1.5 bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300 text-xs font-semibold px-3 py-1 rounded-full border border-slate-200 dark:border-slate-700';
            }
        }

        if (authed) {
            if (cloudGuestPanel) cloudGuestPanel.classList.add('hidden');
            if (cloudUserPanel) cloudUserPanel.classList.remove('hidden');
            
            const res = await verificarSeguridadSincronizacionCloud();
            if (res.safe && res.hasCloudData) {
                if (cloudLastSyncTime) {
                    const date = new Date(res.cloudTimestamp);
                    cloudLastSyncTime.textContent = date.toLocaleString('es-ES');
                }
            } else {
                if (cloudLastSyncTime) cloudLastSyncTime.textContent = 'Sin respaldos';
            }
        } else {
            if (cloudGuestPanel) cloudGuestPanel.classList.remove('hidden');
            if (cloudUserPanel) cloudUserPanel.classList.add('hidden');
        }
    }

    async function chequearDatosNuevosCloud(manual = false) {
        if (!estaAutenticadoEnNube()) return;
        if (!manual && sessionStorage.getItem('nec_local_session_only') === 'true') return;

        try {
            const check = await verificarSeguridadSincronizacionCloud();
            if (!check.safe) {
                if (manual) showCloudInfo(check.reason || 'Error verificando la nube', true);
                return;
            }
            if (!check.hasCloudData) {
                if (manual) showCloudInfo('No se encontraron datos en la nube.');
                return;
            }

            const lastSyncStr = localStorage.getItem(LAST_SYNC_TIMESTAMP_KEY);
            const cloudDate = new Date(check.cloudTimestamp);
            
            let hasNewerData = false;
            if (!lastSyncStr) {
                hasNewerData = true;
            } else {
                const localDate = new Date(lastSyncStr);
                if (cloudDate.getTime() > localDate.getTime() + 5000) {
                    hasNewerData = true;
                }
            }

            if (hasNewerData) {
                return new Promise((resolve) => {
                    const overlay = crearModalBloqueante(`
                        <div class="text-center">
                            <div class="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4 text-amber-600 dark:text-amber-400">
                                <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24" xmlns="http://www.w3.org/2000/svg"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
                            </div>
                            <h3 class="text-base font-bold text-slate-900 dark:text-slate-100 mb-2">Datos más recientes en la nube</h3>
                            <p class="text-xs text-slate-600 dark:text-slate-400 mb-6">
                                Se detectó un respaldo de NakedEdgeChart más actualizado en la nube (${cloudDate.toLocaleString()}). ¿Deseas restaurarlo ahora?
                            </p>
                            <div id="restore-loading-cloud" class="hidden mb-4 text-xs font-semibold text-blue-600 animate-pulse">Descargando datos...</div>
                            <div class="flex flex-col gap-2 mt-2" id="restore-actions-cloud">
                                <button type="button" id="btn-do-restore-cloud" class="w-full px-4 py-2 rounded-lg text-xs font-semibold bg-amber-600 hover:bg-amber-700 text-white shadow-sm transition">
                                    Sí, restaurar datos de la nube
                                </button>
                                <button type="button" id="btn-skip-restore-cloud" class="w-full px-4 py-2 rounded-lg text-xs font-semibold border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-300 hover:bg-slate-50 dark:hover:bg-slate-800 transition">
                                    Trabajar en local (ignorar aviso)
                                </button>
                            </div>
                        </div>
                    `);

                    document.getElementById('btn-skip-restore-cloud').addEventListener('click', () => {
                        sessionStorage.setItem('nec_local_session_only', 'true');
                        cerrarModal(overlay);
                        if (manual) showCloudInfo('Trabajando en sesión local.');
                        resolve();
                    });

                    document.getElementById('btn-do-restore-cloud').addEventListener('click', async () => {
                        const actions = document.getElementById('restore-actions-cloud');
                        const loading = document.getElementById('restore-loading-cloud');
                        if (actions) actions.classList.add('hidden');
                        if (loading) loading.classList.remove('hidden');

                        try {
                            const password = obtenerPasswordNube();
                            const indexRes = await fetch(`/api/sync?module=${CLOUD_MODULE_NAME}&index=true`, {
                                method: 'GET',
                                headers: { 'Authorization': `Bearer ${password}` }
                            });
                            const indexResult = await indexRes.json();
                            if (!indexRes.ok) throw new Error(indexResult.error || 'Error de conexión');

                            const partsCount = indexResult.data.parts || 1;
                            const chunks = [];
                            for (let i = 0; i < partsCount; i++) {
                                const partRes = await fetch(`/api/sync?module=${CLOUD_MODULE_NAME}&part=${i}`, {
                                    method: 'GET',
                                    headers: { 'Authorization': `Bearer ${password}` }
                                });
                                const partResult = await partRes.json();
                                if (!partRes.ok) throw new Error(partResult.error || 'Error de conexión');
                                chunks.push(partResult.raw || JSON.stringify(partResult.data));
                            }

                            const fullJsonStr = chunks.join('');
                            const parsed = parseImportJson(fullJsonStr);
                            const success = await restoreDataFromPayload(parsed);
                            if (!success) throw new Error('No se pudo restaurar en el navegador');

                            localStorage.setItem(LAST_SYNC_TIMESTAMP_KEY, indexResult.data.exportadoEn);
                            showCloudInfo('¡Restauración exitosa!');
                            await refreshStorageUI();
                            await updateAuthUICloud();
                        } catch (e) {
                            showCloudInfo(`Error: ${e.message}`, true);
                        } finally {
                            cerrarModal(overlay);
                            resolve();
                        }
                    });
                });
            } else {
                if (manual) {
                    showCloudInfo('Tus datos locales están actualizados respecto a la nube.');
                }
            }
        } catch (error) {
            if (manual) showCloudInfo(`Error: ${error.message}`, true);
        }
    }

    async function cloudBackup() {
        if (!estaAutenticadoEnNube()) return;
        
        showCloudInfo('Preparando respaldo...');
        if (cloudBackupBtn) cloudBackupBtn.disabled = true;

        try {
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

            const jsonString = JSON.stringify(exportObject);
            const chunks = [];
            for (let i = 0; i < jsonString.length; i += CHUNK_SIZE_CHARS) {
                chunks.push(jsonString.slice(i, i + CHUNK_SIZE_CHARS));
            }

            const password = obtenerPasswordNube();

            for (let i = 0; i < chunks.length; i++) {
                showCloudInfo(`Subiendo parte ${i+1}/${chunks.length}...`);
                const response = await fetch(`/api/sync?module=${CLOUD_MODULE_NAME}&part=${i}`, {
                    method: 'POST',
                    headers: {
                        'Content-Type': 'text/plain',
                        'Authorization': `Bearer ${password}`
                    },
                    body: chunks[i]
                });

                const result = await response.json();
                if (!response.ok) {
                    throw new Error(result.error || `Error al subir la parte ${i+1}/${chunks.length}`);
                }
            }

            showCloudInfo('Registrando índice de respaldo...');
            const indexObj = {
                parts: chunks.length,
                exportadoEn: exportObject.meta.exportedAt,
                version: exportObject.meta.formatVersion
            };

            const indexResponse = await fetch(`/api/sync?module=${CLOUD_MODULE_NAME}&index=true`, {
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

            localStorage.setItem(LAST_SYNC_TIMESTAMP_KEY, indexObj.exportadoEn);
            showCloudInfo('¡Sincronización exitosa!');
            await updateAuthUICloud();
        } catch (error) {
            showCloudInfo(error.message, true);
        } finally {
            if (cloudBackupBtn) cloudBackupBtn.disabled = false;
        }
    }

    async function cloudRestore() {
        if (!estaAutenticadoEnNube()) return;
        
        const ok = window.confirm('Esto reemplazará todos tus datos locales actuales (simulaciones y preferencias) con el respaldo de la nube. ¿Deseas continuar?');
        if (!ok) return;

        showCloudInfo('Descargando respaldo...');
        if (cloudRestoreBtn) cloudRestoreBtn.disabled = true;

        try {
            const password = obtenerPasswordNube();

            const indexRes = await fetch(`/api/sync?module=${CLOUD_MODULE_NAME}&index=true`, {
                method: 'GET',
                headers: { 'Authorization': `Bearer ${password}` }
            });

            const indexResult = await indexRes.json();
            if (!indexRes.ok) {
                throw new Error(indexResult.error || 'Error al obtener el índice de la nube');
            }

            if (!indexResult.exists || !indexResult.data) {
                throw new Error('No se encontraron datos de respaldo en la nube');
            }

            const partsCount = indexResult.data.parts || 1;
            const chunks = [];

            for (let i = 0; i < partsCount; i++) {
                showCloudInfo(`Descargando parte ${i+1}/${partsCount}...`);
                const partRes = await fetch(`/api/sync?module=${CLOUD_MODULE_NAME}&part=${i}`, {
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

            showCloudInfo('Reconstruyendo base de datos...');
            const fullJsonStr = chunks.join('');
            let parsed;
            try {
                parsed = parseImportJson(fullJsonStr);
            } catch (e) {
                throw new Error('El archivo de la nube está corrupto o no se pudo ensamblar correctamente.');
            }

            const success = await restoreDataFromPayload(parsed);
            if (!success) {
                throw new Error('No se pudieron restaurar los datos en el navegador.');
            }

            localStorage.setItem(LAST_SYNC_TIMESTAMP_KEY, indexResult.data.exportadoEn);
            showCloudInfo('¡Restauración exitosa!');
            await refreshStorageUI();
            await updateAuthUICloud();
        } catch (error) {
            showCloudInfo(error.message, true);
        } finally {
            if (cloudRestoreBtn) cloudRestoreBtn.disabled = false;
        }
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

    // --- Vinculación de Eventos de Sincronización en la Nube ---
    if (cloudLoginForm) {
        cloudLoginForm.addEventListener('submit', (e) => {
            e.preventDefault();
            const password = cloudPasswordInput ? cloudPasswordInput.value.trim() : '';
            if (password) {
                guardarPasswordNube(password);
                if (cloudPasswordInput) cloudPasswordInput.value = '';
                updateAuthUICloud().then(() => {
                    chequearDatosNuevosCloud();
                });
            }
        });
    }

    if (cloudLogoutBtn) {
        cloudLogoutBtn.addEventListener('click', () => {
            if (window.confirm('¿Seguro que deseas cerrar la conexión con la nube? Tus datos locales se conservarán.')) {
                cerrarSesionNube();
                updateAuthUICloud();
            }
        });
    }

    if (cloudBackupBtn) cloudBackupBtn.addEventListener('click', () => cloudBackup());
    if (cloudRestoreBtn) cloudRestoreBtn.addEventListener('click', () => cloudRestore());
    if (cloudCheckBtn) {
        cloudCheckBtn.addEventListener('click', async () => {
            showCloudInfo('Buscando actualizaciones...');
            await updateAuthUICloud();
            await chequearDatosNuevosCloud(true);
        });
    }

    refreshStorageUI();
    updateAuthUICloud().then(() => {
        chequearDatosNuevosCloud();
    });

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

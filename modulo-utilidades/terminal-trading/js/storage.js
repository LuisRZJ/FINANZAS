 (function () {
     window.FTI_Storage = window.FTI_Storage || {};
     const Storage = window.FTI_Storage;
 
     Storage.SESSION_KEY = 'fti_terminal_session';
     Storage.SIMS_KEY = 'fti_saved_simulations';
 
     const safeGet = (key) => {
         try { return localStorage.getItem(key); } catch (e) { return null; }
     };
 
     const safeSet = (key, value) => {
         try { localStorage.setItem(key, value); return true; } catch (e) { return false; }
     };
 
     const safeRemove = (key) => {
         try { localStorage.removeItem(key); return true; } catch (e) { return false; }
     };
 
     const sessionReviver = (key, value) => {
         if ((key === 'datetime' || key === 'dateIso') && typeof value === 'string') {
             const d = new Date(value);
             return isNaN(d.getTime()) ? value : d;
         }
         return value;
     };
 
     Storage.loadSession = (options) => {
         const opts = options || {};
         const raw = safeGet(Storage.SESSION_KEY);
         if (!raw) return { session: null, expired: false };
         let session = null;
         try {
             session = JSON.parse(raw, sessionReviver);
         } catch (e) {
             return { session: null, expired: false, error: e };
         }
         if (session && opts.expiryMs && session.lastUpdate && (Date.now() - session.lastUpdate > opts.expiryMs)) {
             safeRemove(Storage.SESSION_KEY);
             return { session: null, expired: true };
         }
         return { session: session || null, expired: false };
     };
 
     Storage.saveSession = (session, options) => {
         if (!session) return { ok: false, light: false };
         const opts = options || {};
         const lightKeys = Array.isArray(opts.lightKeys) ? opts.lightKeys : ['csvData', 'htfData', 'ltfData'];
         const raw = JSON.stringify(session);
         if (safeSet(Storage.SESSION_KEY, raw)) return { ok: true, light: false };
         const light = Object.assign({}, session);
         for (let i = 0; i < lightKeys.length; i++) {
             delete light[lightKeys[i]];
         }
         const lightRaw = JSON.stringify(light);
         if (safeSet(Storage.SESSION_KEY, lightRaw)) return { ok: true, light: true };
         return { ok: false, light: true };
     };
 
     Storage.clearSession = () => safeRemove(Storage.SESSION_KEY);
 
     Storage.loadSavedSimulations = () => {
         const raw = safeGet(Storage.SIMS_KEY);
         if (!raw) return [];
         try {
             const arr = JSON.parse(raw);
             return Array.isArray(arr) ? arr : [];
         } catch (e) {
             return [];
         }
     };
 
     Storage.saveSavedSimulations = (arr) => {
         const list = Array.isArray(arr) ? arr : [];
         return safeSet(Storage.SIMS_KEY, JSON.stringify(list));
     };
 
     Storage.addSavedSimulation = (item) => {
         const list = Storage.loadSavedSimulations();
         const next = list.concat([item]);
        const ok = Storage.saveSavedSimulations(next);
        if (ok) return { ok: true, list: next, fallback: false };
        const fallbackOk = Storage.saveSavedSimulations([item]);
        return { ok: fallbackOk, list: fallbackOk ? [item] : list, fallback: true };
     };
 
     Storage.updateSavedSimulationName = (id, name) => {
         const list = Storage.loadSavedSimulations();
         const next = list.map((s) => s.id === id ? Object.assign({}, s, { name }) : s);
         const ok = Storage.saveSavedSimulations(next);
         return { ok, list: ok ? next : list };
     };
 
     Storage.deleteSavedSimulation = (id) => {
         const list = Storage.loadSavedSimulations();
         const next = list.filter((s) => s.id !== id);
         const ok = Storage.saveSavedSimulations(next);
         return { ok, list: ok ? next : list };
     };
 })();

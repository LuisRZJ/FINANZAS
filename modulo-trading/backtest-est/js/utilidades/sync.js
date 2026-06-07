// ==========================================
// SERVICIOS DE SINCRONIZACIÓN EN LA NUBE (SHARED)
// ==========================================

const ACCOUNT_META_KEY = 'tradingAccountsMeta';
const ACCOUNT_ACTIVE_KEY = 'activeTradingAccountId';
const ACCOUNT_DATA_PREFIX = 'tradingAccountData:';

const CLOUD_PASSWORD_KEY = 'fti_cloud_password';
const CLOUD_PASSWORD_DATE_KEY = 'fti_cloud_password_date';
const SYNC_TIMESTAMP_KEY = 'trading_last_sync_timestamp';
const EXPIRATION_DAYS = 15;
const MS_PER_DAY = 1000 * 60 * 60 * 24;

export function estaAutenticadoEnNube() {
  const pwd = localStorage.getItem(CLOUD_PASSWORD_KEY);
  const dateStr = localStorage.getItem(CLOUD_PASSWORD_DATE_KEY);
  if (!pwd || !dateStr) return false;
  const date = parseInt(dateStr, 10);
  if (isNaN(date)) return false;
  return (Date.now() - date) / MS_PER_DAY <= EXPIRATION_DAYS;
}

export function obtenerPasswordNube() {
  return estaAutenticadoEnNube() ? localStorage.getItem(CLOUD_PASSWORD_KEY) : null;
}

export function guardarPasswordNube(password) {
  if (!password) return;
  localStorage.setItem(CLOUD_PASSWORD_KEY, password);
  localStorage.setItem(CLOUD_PASSWORD_DATE_KEY, Date.now().toString());
}

export function cerrarSesionNube() {
  localStorage.removeItem(CLOUD_PASSWORD_KEY);
  localStorage.removeItem(CLOUD_PASSWORD_DATE_KEY);
}

function readAccountsMeta() {
  const raw = localStorage.getItem(ACCOUNT_META_KEY);
  if (!raw) return [];
  try {
    return JSON.parse(raw);
  } catch (error) {
    return [];
  }
}

function writeAccountsMeta(meta) {
  localStorage.setItem(ACCOUNT_META_KEY, JSON.stringify(meta));
}

function readAccountData(accountId) {
  const raw = localStorage.getItem(ACCOUNT_DATA_PREFIX + accountId);
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch (error) {
    return {};
  }
}

function writeAccountData(accountId, data) {
  localStorage.setItem(ACCOUNT_DATA_PREFIX + accountId, JSON.stringify(data));
}

export function buildCloudExportState() {
  const accountsMeta = readAccountsMeta();
  const activeAccountId = localStorage.getItem(ACCOUNT_ACTIVE_KEY) || (accountsMeta[0] ? accountsMeta[0].id : null);
  const accounts = {};
  accountsMeta.forEach(account => {
    accounts[account.id] = readAccountData(account.id);
  });
  return {
    format: 'tradingAccountsExport',
    scope: 'all',
    version: 1,
    exportedAt: new Date().toISOString(),
    activeAccountId,
    accountsMeta,
    accounts
  };
}

export function restoreCloudImportState(parsed) {
  if (!parsed || parsed.format !== 'tradingAccountsExport') return false;
  const currentMeta = readAccountsMeta();
  currentMeta.forEach(account => {
    localStorage.removeItem(ACCOUNT_DATA_PREFIX + account.id);
  });
  writeAccountsMeta(parsed.accountsMeta);
  parsed.accountsMeta.forEach(account => {
    const data = parsed.accounts[account.id] || {};
    writeAccountData(account.id, data);
  });
  const nextActive = parsed.activeAccountId && parsed.accountsMeta.some(a => a.id === parsed.activeAccountId)
    ? parsed.activeAccountId
    : (parsed.accountsMeta[0] ? parsed.accountsMeta[0].id : null);
  if (nextActive) {
    localStorage.setItem(ACCOUNT_ACTIVE_KEY, nextActive);
  }
  return true;
}

export async function verificarSeguridadSincronizacionCloud() {
  if (!estaAutenticadoEnNube()) {
    return { safe: false, reason: 'No hay sesión activa' };
  }
  try {
    const password = obtenerPasswordNube();
    const response = await fetch('/api/sync?module=trading&index=true', {
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

export async function respaldarDatosNube(onProgress, onSuccess, onError) {
  if (!estaAutenticadoEnNube()) {
    if (onError) onError('Debes autorizar la sesión primero.');
    return;
  }
  const password = obtenerPasswordNube();
  try {
    if (onProgress) onProgress('Generando respaldo...', 0);
    const exportState = buildCloudExportState();
    const jsonString = JSON.stringify(exportState);
    const CHUNK_SIZE_CHARS = 3 * 1024 * 1024; // 3MB
    const chunks = [];
    for (let i = 0; i < jsonString.length; i += CHUNK_SIZE_CHARS) {
      chunks.push(jsonString.slice(i, i + CHUNK_SIZE_CHARS));
    }
    for (let i = 0; i < chunks.length; i++) {
      if (onProgress) onProgress(`Subiendo parte ${i + 1}/${chunks.length}...`, Math.round(((i + 1) / (chunks.length + 1)) * 100));
      const res = await fetch(`/api/sync?module=trading&part=${i}`, {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain',
          'Authorization': `Bearer ${password}`
        },
        body: chunks[i]
      });
      const result = await res.json();
      if (!res.ok) throw new Error(result.error || `Error al subir la parte ${i+1}/${chunks.length}`);
    }
    if (onProgress) onProgress('Subiendo índice de sincronización...', 95);
    const exportTimestamp = new Date().toISOString();
    const indexObj = {
      parts: chunks.length,
      exportadoEn: exportTimestamp,
      version: 1
    };
    const indexRes = await fetch(`/api/sync?module=trading&index=true`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${password}`
      },
      body: JSON.stringify(indexObj)
    });
    const indexResult = await indexRes.json();
    if (!indexRes.ok) throw new Error(indexResult.error || 'Error al guardar el índice en la nube.');
    localStorage.setItem(SYNC_TIMESTAMP_KEY, exportTimestamp);
    if (onSuccess) onSuccess(exportTimestamp);
  } catch (err) {
    if (onError) onError(err.message);
  }
}

export async function restaurarDatosNube(onProgress, onSuccess, onError) {
  if (!estaAutenticadoEnNube()) {
    if (onError) onError('Debes autorizar la sesión primero.');
    return;
  }
  const password = obtenerPasswordNube();
  try {
    if (onProgress) onProgress('Descargando índice de respaldo...', 5);
    const indexRes = await fetch(`/api/sync?module=trading&index=true`, {
      method: 'GET',
      headers: { 'Authorization': `Bearer ${password}` }
    });
    const indexResult = await indexRes.json();
    if (!indexRes.ok) throw new Error(indexResult.error || 'Error al obtener el índice de la nube');
    if (!indexResult.exists || !indexResult.data) {
      throw new Error('No se encontraron datos de respaldo de trading en la nube.');
    }
    const partsCount = indexResult.data.parts || 1;
    const chunks = [];
    for (let i = 0; i < partsCount; i++) {
      if (onProgress) onProgress(`Descargando parte ${i + 1}/${partsCount}...`, Math.round(((i + 1) / (partsCount + 1)) * 100));
      const partRes = await fetch(`/api/sync?module=trading&part=${i}`, {
        method: 'GET',
        headers: { 'Authorization': `Bearer ${password}` }
      });
      const partResult = await partRes.json();
      if (!partRes.ok) throw new Error(partResult.error || `Error al descargar parte ${i + 1}/${partsCount}`);
      if (!partResult.exists) throw new Error(`Parte ${i + 1}/${partsCount} no encontrada.`);
      chunks.push(partResult.raw || JSON.stringify(partResult.data));
    }
    if (onProgress) onProgress('Procesando datos descargados...', 95);
    const fullJsonStr = chunks.join('');
    const parsedData = JSON.parse(fullJsonStr);
    const success = restoreCloudImportState(parsedData);
    if (!success) {
      throw new Error('El archivo recuperado no tiene un formato multicuenta válido.');
    }
    localStorage.setItem(SYNC_TIMESTAMP_KEY, indexResult.data.exportadoEn);
    if (onSuccess) onSuccess(indexResult.data.exportadoEn);
  } catch (err) {
    if (onError) onError(err.message);
  }
}

export async function verificarNubeInicioCloud(onAuthUIUpdate) {
  if (sessionStorage.getItem('trading_local_session_only') === 'true') {
    return;
  }
  const crearModalBloqueante = (htmlContent) => {
    const overlay = document.createElement('div');
    overlay.style.cssText = 'position: fixed; inset: 0; background: rgba(0, 0, 0, 0.85); backdrop-filter: blur(8px); display: flex; align-items: center; justify-content: center; z-index: 10000; font-family: "Inter", sans-serif;';
    overlay.id = 'modal-inicio-nube-cloud';
    const modal = document.createElement('div');
    modal.style.cssText = 'background: rgba(22, 26, 43, 0.95); border: 1px solid rgba(255, 255, 255, 0.1); border-radius: 16px; padding: 2rem; max-width: 420px; width: 100%; text-align: center; box-shadow: 0 24px 64px rgba(0,0,0,0.6); color: #f8fafc; margin: 0 1rem;';
    modal.innerHTML = htmlContent;
    overlay.appendChild(modal);
    document.body.appendChild(overlay);
    document.body.style.overflow = 'hidden';
    return overlay;
  };
  const cerrarModal = (overlay) => {
    overlay.remove();
    document.body.style.overflow = '';
  };
  const chequearDatosNuevosCloud = async () => {
    const check = await verificarSeguridadSincronizacionCloud();
    if (!check.safe || !check.hasCloudData) return;
    const lastSyncStr = localStorage.getItem(SYNC_TIMESTAMP_KEY);
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
          <div style="display: flex; flex-direction: column; align-items: center;">
            <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(245, 158, 11, 0.15); display: flex; align-items: center; justify-content: center; margin-bottom: 1rem; color: #f59e0b;">
              <svg style="width: 24px; height: 24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            </div>
            <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem;">Datos más recientes en la nube</h3>
            <p style="font-size: 0.9rem; color: #94a3b8; margin-bottom: 1.5rem; line-height: 1.5;">
              Se detectó un respaldo de trading más actualizado en la nube (${cloudDate.toLocaleString()}). ¿Deseas restaurarlo ahora?
            </p>
            <div id="restore-loading-cloud" style="display: none; margin-bottom: 1rem; font-size: 0.9rem; font-weight: 600; color: #3b82f6;">Descargando datos...</div>
            <div style="display: flex; flex-direction: column; gap: 0.75rem; width: 100%;" id="restore-actions-cloud">
              <button type="button" id="btn-do-restore-cloud" style="width: 100%; padding: 0.75rem; background: #f59e0b; border: none; border-radius: 12px; color: white; font-weight: 600; cursor: pointer; transition: background 0.2s;">
                Sí, restaurar datos
              </button>
              <button type="button" id="btn-skip-restore-cloud" style="width: 100%; padding: 0.75rem; background: transparent; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 12px; color: #cbd5e1; font-weight: 600; cursor: pointer; transition: all 0.2s;">
                Continuar en local
              </button>
            </div>
          </div>
        `);
        
        document.getElementById('btn-skip-restore-cloud').addEventListener('click', () => {
          sessionStorage.setItem('trading_local_session_only', 'true');
          cerrarModal(overlay);
          resolve();
        });
        
        document.getElementById('btn-do-restore-cloud').addEventListener('click', async () => {
          const actions = document.getElementById('restore-actions-cloud');
          const loading = document.getElementById('restore-loading-cloud');
          if (actions) actions.style.display = 'none';
          if (loading) loading.style.display = 'block';
          
          await restaurarDatosNube(
            (msg) => { if (loading) loading.textContent = msg; },
            () => {
              alert('Restauración inicial exitosa.');
              cerrarModal(overlay);
              resolve();
              location.reload();
            },
            (err) => {
              alert('Error al restaurar al inicio: ' + err);
              cerrarModal(overlay);
              resolve();
            }
          );
        });
      });
    }
  };
  
  if (!estaAutenticadoEnNube()) {
    return new Promise((resolve) => {
      const overlay = crearModalBloqueante(`
        <div style="display: flex; flex-direction: column; align-items: center;">
          <div style="width: 48px; height: 48px; border-radius: 50%; background: rgba(59, 130, 246, 0.15); display: flex; align-items: center; justify-content: center; margin-bottom: 1rem; color: #3b82f6;">
            <svg style="width: 24px; height: 24px;" fill="none" stroke="currentColor" viewBox="0 0 24 24" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
          </div>
          <h3 style="font-size: 1.25rem; font-weight: 700; margin-bottom: 0.5rem;">Seguridad de Sincronización</h3>
          <p style="font-size: 0.9rem; color: #94a3b8; margin-bottom: 1.5rem; line-height: 1.5;">Por favor, ingresa tu contraseña para habilitar la sincronización en la nube. Esta sesión durará 15 días.</p>
          <form id="form-auth-inicio-cloud" style="width: 100%; display: flex; flex-direction: column; gap: 1rem;">
            <input type="password" id="input-password-inicio-cloud" required placeholder="Contraseña de la nube" 
              style="width: 100%; padding: 0.75rem; background: rgba(255,255,255,0.03); border: 1px solid rgba(255,255,255,0.1); border-radius: 12px; color: #f8fafc; outline: none; font-size: 0.9rem;">
            <div style="display: flex; flex-direction: column; gap: 0.75rem; width: 100%;">
              <button type="submit" style="width: 100%; padding: 0.75rem; background: #3b82f6; border: none; border-radius: 12px; color: white; font-weight: 600; cursor: pointer; transition: background 0.2s;">
                Ingresar y Sincronizar
              </button>
              <button type="button" id="btn-local-only-cloud" style="width: 100%; padding: 0.75rem; background: transparent; border: 1px solid rgba(255, 255, 255, 0.15); border-radius: 12px; color: #cbd5e1; font-weight: 600; cursor: pointer; transition: all 0.2s;">
                Trabajar en local por esta sesión
              </button>
            </div>
          </form>
        </div>
      `);
      
      const form = document.getElementById('form-auth-inicio-cloud');
      const btnLocal = document.getElementById('btn-local-only-cloud');
      
      btnLocal.addEventListener('click', () => {
        sessionStorage.setItem('trading_local_session_only', 'true');
        cerrarModal(overlay);
        resolve();
      });
      
      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('input-password-inicio-cloud').value;
        guardarPasswordNube(pwd);
        cerrarModal(overlay);
        if (onAuthUIUpdate) {
          onAuthUIUpdate();
        }
        await chequearDatosNuevosCloud();
        resolve();
      });
    });
  } else {
    await chequearDatosNuevosCloud();
  }
}

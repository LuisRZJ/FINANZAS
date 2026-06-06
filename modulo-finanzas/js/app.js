import { listarOperaciones } from './servicios/operaciones.js'
import { listarEtiquetas } from './servicios/etiquetas.js'
import { listarCuentas } from './servicios/cuentas.js'
import { formatoMoneda } from './utilidades/formato.js'
import { estaAutenticadoEnNube, guardarPasswordNube } from './servicios/auth.js'
import { verificarSeguridadSincronizacion, restaurarDatos } from './servicios/sincronizacion.js'

function formatDate(s) {
  // Soportar formato nuevo (YYYY-MM-DDTHH:MM) y antiguo (YYYY-MM-DD)
  const fechaLimpia = s.split('T')[0]
  const [y, m, d] = fechaLimpia.split('-')
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' })
}

async function getMonthData() {
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  const allOps = await listarOperaciones()

  // Filter for current month
  const monthOps = allOps.filter(op => {
    // Limpiar fecha: extraer solo YYYY-MM-DD
    const fechaLimpia = op.fecha.split('T')[0]
    const [y, m, d] = fechaLimpia.split('-')
    const opDate = new Date(y, m - 1, d)
    return opDate.getMonth() === currentMonth && opDate.getFullYear() === currentYear
  })

  // Calculate totals
  let income = 0
  let expense = 0

  monthOps.forEach(op => {
    const amount = Number(op.cantidad || 0)
    if (op.tipo === 'ingreso') {
      income += amount
    } else if (op.tipo === 'gasto') {
      expense += amount
    }
    // Transfers are neutral for PNL
  })

  const pnl = income - expense

  return {
    pnl,
    income,
    expense,
    ops: monthOps
  }
}

function renderSummary(data) {
  const balanceEl = document.getElementById('balance-amount')
  const incomeEl = document.getElementById('income-amount')
  const expenseEl = document.getElementById('expense-amount')

  if (balanceEl) {
    balanceEl.textContent = '$' + formatoMoneda(data.pnl)
    balanceEl.className = `mt-2 text-2xl font-bold ${data.pnl >= 0 ? 'text-gray-900 dark:text-gray-100' : 'text-red-600 dark:text-red-400'}`
  }
  if (incomeEl) incomeEl.textContent = '$' + formatoMoneda(data.income)
  if (expenseEl) expenseEl.textContent = '$' + formatoMoneda(data.expense)
}

async function renderTransactions(ops) {
  const tbody = document.getElementById('transactions-body')
  if (!tbody) return
  tbody.innerHTML = ''

  if (ops.length === 0) {
    const tr = document.createElement('tr')
    const td = document.createElement('td')
    td.colSpan = 5
    td.className = 'px-4 py-8 text-center text-sm text-gray-500 italic'
    td.textContent = 'No hay transacciones este mes.'
    tr.appendChild(td)
    tbody.appendChild(tr)
    return
  }

  // Sort by date desc
  const sorted = [...ops].sort((a, b) => {
    // Soportar formato nuevo y antiguo
    const fechaA = a.fecha.includes('T') ? a.fecha : a.fecha + 'T00:00:00'
    const fechaB = b.fecha.includes('T') ? b.fecha : b.fecha + 'T00:00:00'
    const da = new Date(fechaA).getTime()
    const db = new Date(fechaB).getTime()
    return db - da
  })

  const etiquetas = await listarEtiquetas()
  const etMap = new Map(etiquetas.map(e => [e.id, e.nombre]))
  const cuentas = await listarCuentas()
  const ctMap = new Map(cuentas.map(c => [c.id, c.nombre]))

  sorted.forEach((tx) => {
    const tr = document.createElement('tr')
    tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-800'

    // Fecha
    const tdDate = document.createElement('td')
    tdDate.className = 'px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap snap-start'
    tdDate.textContent = formatDate(tx.fecha)

    // Cuenta
    const tdAccount = document.createElement('td')
    tdAccount.className = 'px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap snap-start'
    let accText = ''
    if (tx.tipo === 'transferencia') {
      const o = ctMap.get(tx.origenId) || '?'
      const d = ctMap.get(tx.destinoId) || '?'
      accText = `${o} → ${d}`
    } else {
      accText = ctMap.get(tx.cuentaId) || 'Cuenta borrada'
    }
    tdAccount.textContent = accText

    // Categoría / Etiqueta
    const tdCat = document.createElement('td')
    tdCat.className = 'px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap snap-start'
    let catText = tx.tipo.charAt(0).toUpperCase() + tx.tipo.slice(1)
    if (tx.etiquetaId) {
      const etName = etMap.get(tx.etiquetaId)
      if (etName) catText = etName
    } else if (tx.tipo === 'transferencia') {
      catText = 'Transferencia'
    }
    tdCat.textContent = catText

    // Descripción
    const tdDesc = document.createElement('td')
    tdDesc.className = 'px-4 py-3 text-sm text-gray-700 dark:text-gray-300 whitespace-nowrap snap-start'
    tdDesc.textContent = tx.descripcion || tx.nombre

    // Monto
    const tdAmount = document.createElement('td')
    let amtClass = 'px-4 py-3 text-sm font-medium text-right whitespace-nowrap snap-start '
    let sign = ''

    if (tx.tipo === 'ingreso') {
      amtClass += 'text-green-600 dark:text-green-400'
      sign = '+'
    } else if (tx.tipo === 'gasto') {
      amtClass += 'text-red-600 dark:text-red-400'
      sign = '-'
    } else {
      amtClass += 'text-gray-600 dark:text-gray-400'
    }

    tdAmount.className = amtClass
    tdAmount.textContent = sign + '$' + formatoMoneda(tx.cantidad)

    tr.appendChild(tdDate)
    tr.appendChild(tdAccount)
    tr.appendChild(tdCat)
    tr.appendChild(tdDesc)
    tr.appendChild(tdAmount)
    tbody.appendChild(tr)
  })
}

function setActiveNav() {
  const links = document.querySelectorAll('nav a[data-route]')
  const current = location.pathname.split('/').pop() || 'index.html'
  links.forEach((a) => {
    const route = a.getAttribute('data-route')
    if (!route) return
    if (route === current) {
      a.classList.add('text-primary-600', 'dark:text-primary-400')
    } else {
      a.classList.remove('text-primary-600', 'dark:text-primary-400')
    }
  })
}

async function verificarNubeInicio() {
  if (sessionStorage.getItem('fti_local_session_only') === 'true') {
    return; // El usuario ya decidió trabajar en local por esta sesión
  }

  const crearModalBloqueante = (htmlContent) => {
    const overlay = document.createElement('div');
    overlay.className = 'fixed inset-0 bg-gray-900/80 backdrop-blur-sm flex items-center justify-center z-[100] animate-fade-in';
    overlay.id = 'modal-inicio-nube';

    const modal = document.createElement('div');
    modal.className = 'bg-white dark:bg-gray-800 rounded-lg shadow-2xl max-w-md w-full mx-4 p-6 relative overflow-hidden';
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

  // 1. Pedir contraseña si no está autenticado
  if (!estaAutenticadoEnNube()) {
    return new Promise((resolve) => {
      const overlay = crearModalBloqueante(`
        <div class="text-center">
          <div class="w-12 h-12 rounded-full bg-blue-100 dark:bg-blue-900/30 flex items-center justify-center mx-auto mb-4 text-blue-600 dark:text-blue-400">
            <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 15v2m-6 4h12a2 2 0 002-2v-6a2 2 0 00-2-2H6a2 2 0 00-2 2v6a2 2 0 002 2zm10-10V7a4 4 0 00-8 0v4h8z"></path></svg>
          </div>
          <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Seguridad de Sincronización</h3>
          <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">Por favor, ingresa tu contraseña para habilitar la sincronización en la nube. Esta sesión durará 15 días.</p>
          
          <form id="form-auth-inicio" class="space-y-4">
            <div>
              <input type="password" id="input-password-inicio" required placeholder="Contraseña de la nube" 
                class="w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-4 py-2 text-sm focus:ring-2 focus:ring-primary-500 outline-none">
            </div>
            <div class="flex flex-col gap-3 mt-6">
              <button type="submit" class="w-full px-4 py-2 rounded-md text-sm font-medium bg-primary-600 text-white hover:bg-primary-700 shadow-sm transition-colors">
                Ingresar y Sincronizar
              </button>
              <button type="button" id="btn-local-only" class="w-full px-4 py-2 rounded-md text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                Trabajar en local por esta sesión
              </button>
            </div>
          </form>
        </div>
      `);

      const form = document.getElementById('form-auth-inicio');
      const btnLocal = document.getElementById('btn-local-only');

      btnLocal.addEventListener('click', () => {
        sessionStorage.setItem('fti_local_session_only', 'true');
        cerrarModal(overlay);
        resolve();
      });

      form.addEventListener('submit', async (e) => {
        e.preventDefault();
        const pwd = document.getElementById('input-password-inicio').value;
        guardarPasswordNube(pwd);
        cerrarModal(overlay);
        // Despues de poner la contraseña, verificamos si hay datos nuevos
        await chequearDatosNuevos();
        resolve();
      });
    });
  } else {
    await chequearDatosNuevos();
  }

  async function chequearDatosNuevos() {
    const check = await verificarSeguridadSincronizacion();
    if (!check.safe || !check.hasCloudData) return;

    const lastSyncStr = localStorage.getItem('fti_last_sync_timestamp');
    const cloudDate = new Date(check.cloudTimestamp);
    
    let hasNewerData = false;
    if (!lastSyncStr) {
      hasNewerData = true; // Si no hay sync previa local, la nube tiene algo
    } else {
      const localDate = new Date(lastSyncStr);
      // Si la fecha de la nube es más de 5 segundos más nueva que la local, consideramos que hay datos nuevos
      if (cloudDate.getTime() > localDate.getTime() + 5000) {
         hasNewerData = true;
      }
    }

    if (hasNewerData) {
      return new Promise((resolve) => {
        const overlay = crearModalBloqueante(`
          <div class="text-center">
            <div class="w-12 h-12 rounded-full bg-amber-100 dark:bg-amber-900/30 flex items-center justify-center mx-auto mb-4 text-amber-600 dark:text-amber-400">
              <svg class="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"></path></svg>
            </div>
            <h3 class="text-lg font-semibold text-gray-900 dark:text-white mb-2">Datos más recientes en la nube</h3>
            <p class="text-sm text-gray-600 dark:text-gray-400 mb-6">
              Se detectaron datos más actualizados en la nube (${cloudDate.toLocaleString()}). ¿Deseas restaurarlos ahora?
            </p>
            <div id="restore-loading" class="hidden mb-4 text-sm font-medium text-primary-600">Descargando datos...</div>
            <div class="flex flex-col gap-3 mt-2" id="restore-actions">
              <button type="button" id="btn-do-restore" class="w-full px-4 py-2 rounded-md text-sm font-medium bg-amber-600 text-white hover:bg-amber-700 shadow-sm transition-colors">
                Sí, restaurar datos
              </button>
              <button type="button" id="btn-skip-restore" class="w-full px-4 py-2 rounded-md text-sm font-medium border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 hover:bg-gray-100 dark:hover:bg-gray-700 transition-colors">
                Continuar en local
              </button>
            </div>
          </div>
        `);

        document.getElementById('btn-skip-restore').addEventListener('click', () => {
          sessionStorage.setItem('fti_local_session_only', 'true');
          cerrarModal(overlay);
          resolve();
        });

        document.getElementById('btn-do-restore').addEventListener('click', async () => {
          document.getElementById('restore-actions').classList.add('hidden');
          document.getElementById('restore-loading').classList.remove('hidden');
          
          const result = await restaurarDatos();
          if (result.success) {
            localStorage.setItem('fti_last_sync_timestamp', new Date().toISOString());
            cerrarModal(overlay);
            // Recargar la página para aplicar los cambios del restore
            window.location.reload();
          } else {
            alert('Error al restaurar: ' + result.error);
            document.getElementById('restore-actions').classList.remove('hidden');
            document.getElementById('restore-loading').classList.add('hidden');
          }
        });
      });
    }
  }
}

async function init() {
  if (window.GTRTheme && typeof window.GTRTheme.applyThemeOnLoad === 'function') {
    window.GTRTheme.applyThemeOnLoad()
  }

  await verificarNubeInicio()

  setActiveNav()

  const data = await getMonthData()
  renderSummary(data)
  await renderTransactions(data.ops)

  const toggleBtn = document.getElementById('theme-toggle')
  if (toggleBtn && window.GTRTheme && typeof window.GTRTheme.toggleTheme === 'function') {
    toggleBtn.addEventListener('click', window.GTRTheme.toggleTheme)
  }
}

document.addEventListener('DOMContentLoaded', init)

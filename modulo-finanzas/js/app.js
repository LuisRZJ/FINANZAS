import { listarOperaciones } from './servicios/operaciones.js'
import { listarEtiquetas } from './servicios/etiquetas.js'
import { listarCuentas } from './servicios/cuentas.js'
import { formatoMoneda } from './utilidades/formato.js'
import { estaAutenticadoEnNube, guardarPasswordNube } from './servicios/auth.js'
import { verificarSeguridadSincronizacion, restaurarDatos } from './servicios/sincronizacion.js'
import { listarRecurrencias } from './servicios/recurrencias.js'

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

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

async function renderTransactions(ops) {
  const cont = document.getElementById('transactions-list')
  if (!cont) return

  // Limpiar intervalos de badges anteriores para evitar fugas de memoria
  if (window._indexBadgeIntervals && window._indexBadgeIntervals.length > 0) {
    window._indexBadgeIntervals.forEach(id => clearInterval(id))
  }
  window._indexBadgeIntervals = []

  // Inicializar iconos Lucide estáticos del HTML si estuvieran cargados
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons()
  }

  cont.innerHTML = ''

  if (ops.length === 0) {
    const p = document.createElement('p')
    p.className = 'text-center text-sm text-gray-500 italic py-8'
    p.textContent = 'No hay transacciones registradas en este mes.'
    cont.appendChild(p)
    return
  }

  // 1. Sort by date desc
  const sorted = [...ops].sort((a, b) => {
    const da = new Date(a.fecha.includes('T') ? a.fecha : a.fecha + 'T00:00:00').getTime()
    const db = new Date(b.fecha.includes('T') ? b.fecha : b.fecha + 'T00:00:00').getTime()
    return db - da
  })

  // 2. Group by date (Day only)
  const grouped = {}
  sorted.forEach(op => {
    const dateKey = op.fecha.split('T')[0]
    if (!grouped[dateKey]) grouped[dateKey] = []
    grouped[dateKey].push(op)
  })

  const etiquetas = await listarEtiquetas()
  const etiquetaMap = new Map(etiquetas.map(e => [e.id, e]))
  const cuentas = await listarCuentas()
  const cuentaMap = new Map(cuentas.map(c => [c.id, c]))
  const recurrencias = await listarRecurrencias()

  // 3. Render Groups
  Object.keys(grouped).forEach(dateKey => {
    const groupOps = grouped[dateKey]

    // Calculate Day Stats
    let dayIngreso = 0
    let dayGasto = 0
    let countIngreso = 0
    let countGasto = 0
    let countTransf = 0

    groupOps.forEach(op => {
      if (op.tipo === 'ingreso') {
        dayIngreso += op.cantidad
        countIngreso++
      } else if (op.tipo === 'gasto') {
        dayGasto += op.cantidad
        countGasto++
      } else if (op.tipo === 'transferencia') {
        countTransf++
      }
    })

    const pnl = dayIngreso - dayGasto

    // Summary Strings
    const counts = []
    if (countIngreso > 0) counts.push(`${countIngreso} Ingreso${countIngreso > 1 ? 's' : ''}`)
    if (countGasto > 0) counts.push(`${countGasto} Gasto${countGasto > 1 ? 's' : ''}`)
    if (countTransf > 0) counts.push(`${countTransf} Transferencia${countTransf > 1 ? 's' : ''}`)
    const countStr = counts.join(', ')

    // Render Separator
    const dateObj = new Date(dateKey + 'T00:00:00')
    const weekday = dateObj.toLocaleDateString('es-ES', { weekday: 'long' })
    const dayNum = dateObj.getDate()
    const capitalize = s => s.charAt(0).toUpperCase() + s.slice(1)

    const separator = document.createElement('div')
    separator.className = 'flex justify-between items-end px-2 mb-3 mt-6 first:mt-0'

    const pnlClass = pnl >= 0 ? 'text-emerald-500 dark:text-emerald-400' : 'text-red-500 dark:text-red-400'
    const pnlSign = pnl >= 0 ? '+' : ''

    separator.innerHTML = `
      <div>
        <h4 class="text-sm font-semibold text-gray-800 dark:text-gray-200 capitalize">${capitalize(weekday)}, ${dayNum}</h4>
        <span class="text-xs text-gray-400 dark:text-gray-500">${countStr}</span>
      </div>
      <div class="text-right">
        <span class="text-[10px] text-gray-400 dark:text-gray-500 uppercase tracking-wider block mb-0.5">PNL Diario</span>
        <span class="text-sm font-medium ${pnlClass}">${pnlSign}${formatCurrency(pnl)}</span>
      </div>
    `
    cont.appendChild(separator)

    // Render Operations
    groupOps.forEach(op => {
      const row = document.createElement('div')
      row.className = 'group bg-white dark:bg-gray-900 rounded-2xl p-3 mb-2 flex items-center gap-3 border border-gray-100/50 dark:border-gray-800/60 shadow-[0_2px_10px_-4px_rgba(0,0,0,0.05)] dark:shadow-none hover:shadow-[0_4px_15px_-4px_rgba(0,0,0,0.08)] transition-all relative overflow-hidden'

      if (op.estado === 'pendiente') {
        row.classList.add('opacity-75', 'border-dashed')
      }

      // 1. Decorador lateral
      let decoradorColor = ''
      if (op.tipo === 'ingreso') {
        decoradorColor = 'bg-emerald-400 dark:bg-emerald-500'
      } else if (op.tipo === 'gasto') {
        decoradorColor = 'bg-red-400 dark:bg-red-500'
      } else {
        decoradorColor = 'bg-blue-400 dark:bg-blue-500'
      }
      const decorador = document.createElement('div')
      decorador.className = `absolute left-0 top-0 bottom-0 w-1 ${decoradorColor} opacity-40 group-hover:opacity-100 transition-opacity rounded-l-2xl`
      row.appendChild(decorador)

      // 2. Icono o emoji
      const iconDiv = document.createElement('div')
      const et = op.tipo !== 'transferencia' ? etiquetaMap.get(op.etiquetaId) : null

      if (et && et.icono) {
        iconDiv.className = 'w-10 h-10 rounded-full bg-gray-50 dark:bg-gray-800 flex items-center justify-center shrink-0 text-lg border border-gray-100/40 dark:border-gray-700/40'
        iconDiv.textContent = et.icono
      } else {
        let iconName = ''
        let iconColorClass = ''
        let iconBgClass = ''

        if (op.tipo === 'ingreso') {
          iconName = 'arrow-down-left'
          iconColorClass = 'text-emerald-500 dark:text-emerald-400'
          iconBgClass = 'bg-emerald-50 dark:bg-emerald-950/40'
        } else if (op.tipo === 'gasto') {
          iconName = 'arrow-up-right'
          iconColorClass = 'text-red-500 dark:text-red-400'
          iconBgClass = 'bg-red-50 dark:bg-red-950/40'
        } else {
          iconName = 'arrow-left-right'
          iconColorClass = 'text-blue-500 dark:text-blue-400'
          iconBgClass = 'bg-blue-50 dark:bg-blue-950/40'
        }
        iconDiv.className = `w-10 h-10 rounded-full ${iconBgClass} flex items-center justify-center shrink-0 border border-gray-100/40 dark:border-gray-700/40`
        iconDiv.innerHTML = `<i data-lucide="${iconName}" class="w-5 h-5 ${iconColorClass}"></i>`
      }
      row.appendChild(iconDiv)

      // 3. Info (Centro)
      const infoDiv = document.createElement('div')
      infoDiv.className = 'flex-1 min-w-0'

      const titleWrapper = document.createElement('div')
      titleWrapper.className = 'flex items-center gap-2'

      const title = document.createElement('h5')
      title.className = 'text-sm font-medium text-gray-800 dark:text-gray-200 truncate'
      title.textContent = op.nombre
      titleWrapper.appendChild(title)

      if (op.estado === 'pendiente') {
        const pendingBadge = document.createElement('span')
        pendingBadge.className = 'inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[10px] font-semibold bg-amber-50 dark:bg-amber-950/30 text-amber-600 dark:text-amber-400 border border-amber-100 dark:border-amber-900/20 shrink-0 ml-1.5'

        const ahora = new Date()
        ahora.setHours(0, 0, 0, 0)
        const fechaOp = new Date(op.fecha.includes('T') ? op.fecha : op.fecha + 'T00:00:00')
        fechaOp.setHours(0, 0, 0, 0)

        const diffTime = fechaOp.getTime() - ahora.getTime()
        const diffDays = diffTime > 0 ? Math.ceil(diffTime / (1000 * 60 * 60 * 24)) : 0

        let textoAlterno = 'Próximamente'
        if (diffDays === 0) {
          textoAlterno = 'Hoy'
        } else if (diffDays === 1) {
          textoAlterno = 'Mañana'
        } else if (diffDays > 1) {
          textoAlterno = `En ${diffDays} días`
        }

        pendingBadge.innerHTML = `<i data-lucide="clock" class="w-2.5 h-2.5"></i><span class="transition-opacity duration-300 opacity-100" data-badge-text>Próximamente</span>`
        pendingBadge.title = 'Pendiente'
        titleWrapper.appendChild(pendingBadge)

        if (textoAlterno !== 'Próximamente') {
          const spanText = pendingBadge.querySelector('[data-badge-text]')
          let mostrandoProximamente = true

          const intervalId = setInterval(() => {
            if (!spanText || !spanText.isConnected) {
              clearInterval(intervalId)
              return
            }

            spanText.classList.remove('opacity-100')
            spanText.classList.add('opacity-0')

            setTimeout(() => {
              if (!spanText || !spanText.isConnected) return
              mostrandoProximamente = !mostrandoProximamente
              spanText.textContent = mostrandoProximamente ? 'Próximamente' : textoAlterno
              spanText.classList.remove('opacity-0')
              spanText.classList.add('opacity-100')
            }, 300)
          }, 3500)

          window._indexBadgeIntervals.push(intervalId)
        }
      }
      infoDiv.appendChild(titleWrapper)

      // Subtext / Metadata
      const metaDiv = document.createElement('div')
      metaDiv.className = 'text-[11px] text-gray-400 dark:text-gray-500 mt-0.5 flex flex-wrap items-center gap-1.5 truncate'

      let cuentasStr = ''
      if (op.tipo === 'transferencia') {
        const o = cuentaMap.get(op.origenId)
        const d = cuentaMap.get(op.destinoId)
        cuentasStr = `${o?.nombre || '?'} → ${d?.nombre || '?'}`
      } else {
        const c = cuentaMap.get(op.cuentaId)
        cuentasStr = c?.nombre || 'Cuenta borrada'
      }
      const spanCuentas = document.createElement('span')
      spanCuentas.textContent = cuentasStr
      metaDiv.appendChild(spanCuentas)

      if (op.tipo !== 'transferencia') {
        const dot1 = document.createElement('span')
        dot1.className = 'w-0.5 h-0.5 rounded-full bg-gray-300 dark:bg-gray-700'
        metaDiv.appendChild(dot1)

        const spanCat = document.createElement('span')
        spanCat.textContent = et?.nombre || 'General'
        metaDiv.appendChild(spanCat)
      }

      const dot2 = document.createElement('span')
      dot2.className = 'w-0.5 h-0.5 rounded-full bg-gray-300 dark:bg-gray-700'
      metaDiv.appendChild(dot2)

      let timeStr = '00:00'
      if (op.fecha.includes('T')) {
        timeStr = op.fecha.split('T')[1].slice(0, 5)
      }
      const spanTime = document.createElement('span')
      spanTime.textContent = timeStr
      metaDiv.appendChild(spanTime)

      // Recurrencia badge compacto
      if (op.recurrenciaId) {
        const dot3 = document.createElement('span')
        dot3.className = 'w-0.5 h-0.5 rounded-full bg-gray-300 dark:bg-gray-750'
        metaDiv.appendChild(dot3)

        const rec = recurrencias.find(r => r.id === op.recurrenciaId)
        const cicloInfo = op.cicloNumero ? ` #${op.cicloNumero}` : ''
        const finInfo = rec?.finCiclos ? `/${rec.finCiclos}` : ''
        const spanRec = document.createElement('span')
        spanRec.className = 'text-blue-500 dark:text-blue-400 flex items-center gap-0.5 font-medium'
        spanRec.innerHTML = `<i data-lucide="refresh-cw" class="w-2.5 h-2.5"></i>${cicloInfo}${finInfo}`
        metaDiv.appendChild(spanRec)
      }

      infoDiv.appendChild(metaDiv)

      if (op.descripcion) {
        const descEl = document.createElement('div')
        descEl.className = 'text-[10px] text-gray-400 dark:text-gray-500 italic truncate mt-0.5'
        descEl.textContent = op.descripcion
        infoDiv.appendChild(descEl)
      }

      row.appendChild(infoDiv)

      // 4. Monto (Derecha)
      const rightDiv = document.createElement('div')
      rightDiv.className = 'text-right flex flex-col items-end shrink-0 relative'

      const amountEl = document.createElement('span')
      amountEl.className = 'text-sm font-semibold whitespace-nowrap'
      const esNegativo = op.tipo === 'gasto'
      if (op.tipo === 'ingreso') {
        amountEl.classList.add('text-emerald-500', 'dark:text-emerald-400')
      } else if (op.tipo === 'gasto') {
        amountEl.classList.add('text-red-500', 'dark:text-red-400')
      } else {
        amountEl.classList.add('text-gray-650', 'dark:text-gray-400')
      }
      amountEl.textContent = (esNegativo ? '-' : '+') + formatCurrency(op.cantidad)
      rightDiv.appendChild(amountEl)

      row.appendChild(rightDiv)
      cont.appendChild(row)
    })
  })

  // Inicializar iconos Lucide
  if (window.lucide && typeof window.lucide.createIcons === 'function') {
    window.lucide.createIcons()
  }
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

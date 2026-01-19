import { listarOperaciones } from './servicios/operaciones.js'
import { listarEtiquetas } from './servicios/etiquetas.js'
import { listarCuentas } from './servicios/cuentas.js'

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function formatDate(s) {
  // Soportar formato nuevo (YYYY-MM-DDTHH:MM) y antiguo (YYYY-MM-DD)
  const fechaLimpia = s.split('T')[0]
  const [y, m, d] = fechaLimpia.split('-')
  const date = new Date(y, m - 1, d)
  return date.toLocaleDateString('es-MX', { year: 'numeric', month: 'short', day: '2-digit' })
}

function getMonthData() {
  const now = new Date()
  const currentMonth = now.getMonth()
  const currentYear = now.getFullYear()

  const allOps = listarOperaciones()

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
    balanceEl.textContent = formatCurrency(data.pnl)
    balanceEl.className = `mt-2 text-2xl font-bold ${data.pnl >= 0 ? 'text-gray-900 dark:text-gray-100' : 'text-red-600 dark:text-red-400'}`
  }
  if (incomeEl) incomeEl.textContent = formatCurrency(data.income)
  if (expenseEl) expenseEl.textContent = formatCurrency(data.expense)
}

function renderTransactions(ops) {
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

  const etiquetas = listarEtiquetas()
  const etMap = new Map(etiquetas.map(e => [e.id, e.nombre]))
  const cuentas = listarCuentas()
  const ctMap = new Map(cuentas.map(c => [c.id, c.nombre]))

  sorted.forEach((tx) => {
    const tr = document.createElement('tr')
    tr.className = 'hover:bg-gray-50 dark:hover:bg-gray-800'

    // Fecha
    const tdDate = document.createElement('td')
    tdDate.className = 'px-4 py-3 text-sm text-gray-700 dark:text-gray-300'
    tdDate.textContent = formatDate(tx.fecha)

    // Cuenta
    const tdAccount = document.createElement('td')
    tdAccount.className = 'px-4 py-3 text-sm text-gray-700 dark:text-gray-300'
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
    tdCat.className = 'px-4 py-3 text-sm text-gray-700 dark:text-gray-300'
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
    tdDesc.className = 'px-4 py-3 text-sm text-gray-700 dark:text-gray-300'
    tdDesc.textContent = tx.descripcion || tx.nombre

    // Monto
    const tdAmount = document.createElement('td')
    let amtClass = 'px-4 py-3 text-sm font-medium text-right '
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
    tdAmount.textContent = sign + formatCurrency(tx.cantidad)

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

function init() {
  if (window.GTRTheme && typeof window.GTRTheme.applyThemeOnLoad === 'function') {
    window.GTRTheme.applyThemeOnLoad()
  }

  setActiveNav()

  const data = getMonthData()
  renderSummary(data)
  renderTransactions(data.ops)

  const toggleBtn = document.getElementById('theme-toggle')
  if (toggleBtn && window.GTRTheme && typeof window.GTRTheme.toggleTheme === 'function') {
    toggleBtn.addEventListener('click', window.GTRTheme.toggleTheme)
  }
}

document.addEventListener('DOMContentLoaded', init)

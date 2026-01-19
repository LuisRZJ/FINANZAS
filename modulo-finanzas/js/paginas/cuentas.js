import { listarCuentas, crearCuenta, actualizarCuenta, eliminarCuenta, obtenerSubcuentas, obtenerCuentaPadre, obtenerCuentaPorId, obtenerIdsParaEliminar } from '../servicios/cuentas.js'
import { contarOperacionesPorCuentas, eliminarOperacionesPorCuentas } from '../servicios/operaciones.js'
import { listarSeparadores, crearSeparador, actualizarSeparador, eliminarSeparador, obtenerSeparadorDeCuenta, moverSeparador, COLORES_SEPARADOR } from '../servicios/separadores.js'

function formatCurrency(n) {
  return Number(n || 0).toLocaleString('es-MX', { style: 'currency', currency: 'MXN' })
}

function renderLista() {
  const cont = document.getElementById('cuentas-lista')
  if (!cont) return
  const cuentas = listarCuentas()
  const separadores = listarSeparadores()
  cont.innerHTML = ''

  // Separate main accounts and sub-accounts
  const mainAccounts = cuentas.filter(c => !c.esSubcuenta)
  const subAccounts = cuentas.filter(c => c.esSubcuenta)

  // Sort main accounts by balance (descending)
  mainAccounts.sort((a, b) => (b.dinero || 0) - (a.dinero || 0))
  subAccounts.sort((a, b) => (b.dinero || 0) - (a.dinero || 0))

  // Find accounts in separators and ungrouped
  const accountsInSeparators = new Set()
  separadores.forEach(sep => {
    sep.cuentaIds.forEach(id => accountsInSeparators.add(id))
  })

  const ungroupedMain = mainAccounts.filter(c => !accountsInSeparators.has(c.id))

  // Render Chart
  renderGraficoDistribucion(mainAccounts, subAccounts, separadores)

  // Render each user separator first
  separadores.forEach(sep => {
    const sepContainer = crearSeparadorVisual(sep, mainAccounts, subAccounts)
    cont.appendChild(sepContainer)
  })

  // Render "Sin categoría" system separator for ungrouped accounts
  if (ungroupedMain.length > 0) {
    const systemSep = {
      id: '__system__',
      nombre: 'Sin categoría',
      color: '#64748b', // slate
      cuentaIds: ungroupedMain.map(c => c.id)
    }
    const sepContainer = crearSeparadorVisual(systemSep, mainAccounts, subAccounts, true)
    cont.appendChild(sepContainer)
  }

  // Render orphan sub-accounts
  const orphans = subAccounts.filter(s => !mainAccounts.some(m => m.id === s.parentId))
  if (orphans.length > 0) {
    const orphansContainer = document.createElement('div')
    orphansContainer.className = 'mt-8'
    const title = document.createElement('h3')
    title.className = 'text-lg font-semibold mb-4 text-gray-500'
    title.textContent = 'Subcuentas sin asignar'
    orphansContainer.appendChild(title)

    const grid = document.createElement('div')
    grid.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6'

    orphans.forEach((sub) => {
      const subCard = crearTarjetaCuenta(sub, true)
      grid.appendChild(subCard)
    })
    orphansContainer.appendChild(grid)
    cont.appendChild(orphansContainer)
  }
}

function crearSeparadorVisual(sep, mainAccounts, subAccounts, isSystem = false) {
  const sepContainer = document.createElement('div')
  sepContainer.className = isSystem ? 'mt-8 opacity-80' : 'mt-8'

  const sepColor = sep.color || '#0ea5e9'

  // Separator header
  const header = document.createElement('div')
  header.className = 'flex items-center justify-between mb-4 pb-2 border-b-2'
  header.style.borderColor = sepColor

  const titleWrapper = document.createElement('div')
  titleWrapper.className = 'flex items-center gap-3'

  const icon = document.createElement('div')
  icon.className = 'w-2 h-8 rounded-full'
  icon.style.backgroundColor = sepColor

  const title = document.createElement('h3')
  title.className = 'text-lg font-bold text-gray-800 dark:text-gray-200'
  title.textContent = sep.nombre

  // Get accounts in this separator
  const sepAccounts = mainAccounts.filter(c => sep.cuentaIds.includes(c.id))

  // Count sub-accounts under these main accounts
  const subCount = subAccounts.filter(s => sepAccounts.some(m => m.id === s.parentId)).length

  // Calculate total money (main accounts + their sub-accounts)
  let totalDinero = 0
  sepAccounts.forEach(c => {
    totalDinero += (c.dinero || 0)
    const subs = subAccounts.filter(s => s.parentId === c.id)
    subs.forEach(s => totalDinero += (s.dinero || 0))
  })

  // Badges container
  const badgesWrapper = document.createElement('div')
  badgesWrapper.className = 'flex items-center gap-2 flex-wrap'

  const countBadge = document.createElement('span')
  countBadge.className = 'text-xs px-2 py-0.5 rounded-full'
  countBadge.style.backgroundColor = sepColor + '20'
  countBadge.style.color = sepColor

  let countText = `${sepAccounts.length} cuenta(s)`
  if (subCount > 0) {
    countText += `, ${subCount} subcuenta(s)`
  }
  countBadge.textContent = countText

  const totalBadge = document.createElement('span')
  totalBadge.className = 'text-xs font-bold px-2 py-0.5 rounded-full bg-gray-100 dark:bg-gray-800 text-gray-700 dark:text-gray-300'
  totalBadge.textContent = formatCurrency(totalDinero)

  badgesWrapper.appendChild(countBadge)
  badgesWrapper.appendChild(totalBadge)

  titleWrapper.appendChild(icon)
  titleWrapper.appendChild(title)
  titleWrapper.appendChild(badgesWrapper)
  header.appendChild(titleWrapper)
  sepContainer.appendChild(header)

  // Separator accounts grid
  const grid = document.createElement('div')
  grid.className = 'grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-6'

  // Sort accounts by balance (already filtered above)
  sepAccounts.sort((a, b) => (b.dinero || 0) - (a.dinero || 0))

  sepAccounts.forEach((c) => {
    const card = crearTarjetaCuentaConSubs(c, subAccounts)
    grid.appendChild(card)
  })

  if (sepAccounts.length === 0) {
    const empty = document.createElement('p')
    empty.className = 'text-sm text-gray-400 italic col-span-full'
    empty.textContent = 'Sin cuentas en esta categoría'
    grid.appendChild(empty)
  }

  sepContainer.appendChild(grid)
  return sepContainer
}


// Variable global para la instancia del gráfico y el estado de la vista
let chartDistribucion = null
let chartViewMode = 'cuentas' // 'cuentas' | 'categorias'

function renderGraficoDistribucion(cuentas, subcuentas, separadores = []) {
  const ctx = document.getElementById('grafico-distribucion')
  const totalEl = document.getElementById('resumen-total-dinero')
  const legendEl = document.getElementById('grafico-leyenda')
  const toggleContainer = document.getElementById('grafico-view-toggle')

  if (!ctx || !totalEl) return

  // 1. Manejo del Toggle de Vistas
  if (toggleContainer) {
    if (separadores.length >= 2) {
      toggleContainer.classList.remove('hidden')
      const btns = toggleContainer.querySelectorAll('button')
      btns.forEach(btn => {
        // Estilos para seleccionado vs no seleccionado
        const isSelected = btn.dataset.view === chartViewMode
        if (isSelected) {
          btn.className = 'flex-1 px-3 py-1.5 text-xs font-medium rounded-md bg-white dark:bg-gray-600 text-gray-900 dark:text-white shadow-sm transition-all'
        } else {
          btn.className = 'flex-1 px-3 py-1.5 text-xs font-medium rounded-md text-gray-500 dark:text-gray-400 hover:text-gray-900 dark:hover:text-white transition-all'
        }

        // Listener (solo agregar una vez es ideal, pero aquí simplificamos regenerando)
        btn.onclick = () => {
          if (chartViewMode !== btn.dataset.view) {
            chartViewMode = btn.dataset.view
            renderGraficoDistribucion(cuentas, subcuentas, separadores)
          }
        }
      })
    } else {
      toggleContainer.classList.add('hidden')
      chartViewMode = 'cuentas' // Revertir si bajó de 2 categorías
    }
  }

  // 2. Calcular Balance Total Real (Todas las cuentas + subcuentas)
  const totalReal = [...cuentas, ...subcuentas].reduce((sum, c) => sum + (c.dinero || 0), 0)
  totalEl.textContent = formatCurrency(totalReal)

  // 3. Preparar Datos según el Modo
  let dataPoints = []

  if (chartViewMode === 'categorias') {
    // --- VISTA POR CATEGORÍAS ---

    // a) Categorías Definidas
    separadores.forEach(sep => {
      // Cuentas principales en esta categoría
      const ctasEnSep = cuentas.filter(c => sep.cuentaIds.includes(c.id))

      // Sumar saldos (Principal + Sus subcuentas)
      let totalSep = 0
      ctasEnSep.forEach(c => {
        totalSep += (c.dinero || 0)
        // Sumar subcuentas de esta principal
        const subs = subcuentas.filter(s => s.parentId === c.id)
        subs.forEach(s => totalSep += (s.dinero || 0))
      })

      if (totalSep > 0) {
        dataPoints.push({
          nombre: sep.nombre,
          dinero: totalSep,
          color: sep.color || '#3b82f6',
          tipo: 'categoria'
        })
      }
    })

    // b) Sin Categoría (Resto)
    const idsEnSeparadores = new Set()
    separadores.forEach(s => s.cuentaIds.forEach(id => idsEnSeparadores.add(id)))

    const ctasSinCat = cuentas.filter(c => !idsEnSeparadores.has(c.id))
    let totalSinCat = 0
    ctasSinCat.forEach(c => {
      totalSinCat += (c.dinero || 0)
      const subs = subcuentas.filter(s => s.parentId === c.id)
      subs.forEach(s => totalSinCat += (s.dinero || 0))
    })

    if (totalSinCat > 0) {
      dataPoints.push({
        nombre: 'Sin categoría',
        dinero: totalSinCat,
        color: '#64748b', // Slate
        tipo: 'categoria'
      })
    }

  } else {
    // --- VISTA POR CUENTAS (Original) ---
    dataPoints = cuentas.map(principal => {
      // Sumar dinero propio + subcuentas hijas
      const montoPropio = principal.dinero || 0
      const montoSubs = subcuentas
        .filter(sub => sub.parentId === principal.id)
        .reduce((sum, sub) => sum + (sub.dinero || 0), 0)

      return {
        nombre: principal.nombre,
        dinero: montoPropio + montoSubs,
        montoPropio: montoPropio,
        montoSubs: montoSubs,
        color: principal.color || '#3b82f6',
        tipo: 'cuenta'
      }
    }).filter(d => d.dinero > 0)
  }

  // Ordenar de mayor a menor
  dataPoints.sort((a, b) => b.dinero - a.dinero)

  // Renderizar Leyenda Detallada
  if (legendEl) {
    legendEl.innerHTML = ''
    dataPoints.forEach(item => {
      const percentage = totalReal > 0 ? ((item.dinero / totalReal) * 100).toFixed(1) : 0

      const itemContainer = document.createElement('div')
      itemContainer.className = 'text-xs text-gray-600 dark:text-gray-400'

      // Fila principal
      const mainRow = document.createElement('div')
      mainRow.className = 'flex items-center justify-between font-medium text-gray-800 dark:text-gray-200'

      const left = document.createElement('div')
      left.className = 'flex items-center gap-2'
      const dot = document.createElement('div')
      dot.className = 'w-2 h-2 rounded-full'
      dot.style.backgroundColor = item.color
      const name = document.createElement('span')
      name.textContent = item.nombre
      left.appendChild(dot)
      left.appendChild(name)

      const right = document.createElement('div')
      right.textContent = `${formatCurrency(item.dinero)} (${percentage}%)`

      mainRow.appendChild(left)
      mainRow.appendChild(right)
      itemContainer.appendChild(mainRow)

      // Desglose (Solo para vista de Cuentas, por ahora)
      if (item.tipo === 'cuenta' && item.montoSubs > 0) {
        const pctPropio = ((item.montoPropio / item.dinero) * 100).toFixed(0)
        const pctSubs = ((item.montoSubs / item.dinero) * 100).toFixed(0)

        const breakdown = document.createElement('div')
        breakdown.className = 'pl-4 mt-1 space-y-0.5 border-l-2 border-gray-100 dark:border-gray-700 ml-1'

        breakdown.innerHTML = `
          <div class="flex justify-between">
             <span>↳ Propio</span>
             <span>${formatCurrency(item.montoPropio)} (${pctPropio}%)</span>
          </div>
          <div class="flex justify-between">
             <span>↳ Subcuentas</span>
             <span>${formatCurrency(item.montoSubs)} (${pctSubs}%)</span>
          </div>
        `
        itemContainer.appendChild(breakdown)
      }

      legendEl.appendChild(itemContainer)
    })
  }

  // Si no hay datos (saldo 0), mostrar un placeholder sutil o vaciar
  if (dataPoints.length === 0) {
    if (chartDistribucion) {
      chartDistribucion.destroy()
      chartDistribucion = null
    }
    if (legendEl) legendEl.innerHTML = '<p class="text-xs text-center text-gray-400 italic">Sin fondos disponibles</p>'
    return
  }

  // Configuración de visualización (Chart.js)
  const labels = dataPoints.map(d => d.nombre)
  const data = dataPoints.map(d => d.dinero)
  const backgroundColors = dataPoints.map(d => d.color)
  const isDark = document.documentElement.classList.contains('dark')
  const borderColor = isDark ? '#1f2937' : '#ffffff'

  // Crear o Actualizar Gráfico
  if (chartDistribucion) {
    chartDistribucion.data.labels = labels
    chartDistribucion.data.datasets[0].data = data
    chartDistribucion.data.datasets[0].backgroundColor = backgroundColors
    chartDistribucion.data.datasets[0].borderColor = borderColor
    chartDistribucion.data.datasets[0].customData = dataPoints
    chartDistribucion.update()
  } else {
    chartDistribucion = new Chart(ctx, {
      type: 'doughnut',
      data: {
        labels: labels,
        datasets: [{
          data: data,
          backgroundColor: backgroundColors,
          borderWidth: 2,
          borderColor: borderColor,
          hoverOffset: 4,
          customData: dataPoints
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        cutout: '70%',
        plugins: {
          legend: { display: false },
          tooltip: {
            backgroundColor: isDark ? 'rgba(30, 41, 59, 0.95)' : 'rgba(255, 255, 255, 0.95)',
            titleColor: isDark ? '#e2e8f0' : '#1e293b',
            bodyColor: isDark ? '#e2e8f0' : '#1e293b',
            borderColor: isDark ? '#334155' : '#e2e8f0',
            borderWidth: 1,
            padding: 10,
            cornerRadius: 8,
            callbacks: {
              label: function (context) {
                const index = context.dataIndex
                const dataset = context.dataset
                const item = dataset.customData ? dataset.customData[index] : null

                if (!item) return ''
                const value = item.dinero
                const percentage = totalReal > 0 ? ((value / totalReal) * 100).toFixed(1) : 0
                return ` ${item.nombre}: ${formatCurrency(value)} (${percentage}%)`
              }
            }
          }
        }
      }
    })
  }
}

function crearTarjetaCuentaConSubs(c, subAccounts) {
  const card = crearTarjetaCuenta(c, false)

  // Find and add sub-accounts sorted by balance
  const subs = subAccounts.filter(s => s.parentId === c.id)
  subs.sort((a, b) => (b.dinero || 0) - (a.dinero || 0))

  if (subs.length > 0) {
    const subsContainer = document.createElement('div')
    subsContainer.className = 'mt-6 pt-4 border-t border-gray-100 dark:border-gray-800 space-y-3'

    const subsTitle = document.createElement('h4')
    subsTitle.className = 'text-xs font-semibold text-gray-400 uppercase tracking-wider mb-3'
    subsTitle.textContent = `Subcuentas (${subs.length})`
    subsContainer.appendChild(subsTitle)

    const grid = document.createElement('div')
    grid.className = `grid grid-cols-1 ${subs.length > 1 ? 'lg:grid-cols-2' : ''} gap-3`

    subs.forEach((sub) => {
      const subItem = crearItemSubcuenta(sub)
      grid.appendChild(subItem)
    })
    subsContainer.appendChild(grid)
    card.appendChild(subsContainer)
  }

  return card
}

function crearItemSubcuenta(c) {
  const item = document.createElement('div')
  item.className = 'flex items-center justify-between p-3 rounded-lg bg-gray-50 dark:bg-gray-800/50 border border-gray-100 dark:border-gray-800 group hover:border-sky-200 dark:hover:border-sky-900 transition-colors'

  const left = document.createElement('div')
  left.className = 'flex items-center gap-3'

  const color = document.createElement('div')
  color.className = 'w-2 h-8 rounded-full'
  color.style.backgroundColor = c.color || '#0ea5e9'

  const info = document.createElement('div')
  const name = document.createElement('div')
  name.className = 'font-medium text-sm text-gray-900 dark:text-gray-100'
  name.textContent = c.nombre

  const money = document.createElement('div')
  money.className = 'text-xs font-bold text-gray-500 dark:text-gray-400'
  money.textContent = formatCurrency(c.dinero)

  info.appendChild(name)
  info.appendChild(money)
  left.appendChild(color)
  left.appendChild(info)

  const actions = document.createElement('div')
  actions.className = 'flex items-center gap-1 opacity-100 sm:opacity-0 sm:group-hover:opacity-100 transition-opacity'

  const btnEdit = document.createElement('button')
  btnEdit.className = 'p-1.5 text-gray-400 hover:text-sky-600 hover:bg-sky-50 dark:hover:bg-sky-900/20 rounded block'
  btnEdit.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"></path></svg>`
  btnEdit.onclick = () => abrirModalEdicion(c)

  const btnHistory = document.createElement('button')
  btnHistory.className = 'p-1.5 text-gray-400 hover:text-blue-600 hover:bg-blue-50 dark:hover:bg-blue-900/20 rounded block'
  btnHistory.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path></svg>`
  btnHistory.onclick = () => abrirModalHistorial(c)

  const btnDel = document.createElement('button')
  btnDel.className = 'p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded block'
  btnDel.innerHTML = `<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>`
  btnDel.onclick = () => abrirModalEliminar(c)

  actions.appendChild(btnEdit)
  actions.appendChild(btnHistory)
  actions.appendChild(btnDel)

  item.appendChild(left)
  item.appendChild(actions)

  return item
}

function crearTarjetaCuenta(c, esSubcuenta) {
  const card = document.createElement('div')
  card.className = esSubcuenta
    ? 'rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-sm ml-6 border-l-4 border-l-sky-400'
    : 'rounded-lg bg-white dark:bg-gray-900 border border-gray-200 dark:border-gray-800 p-6 shadow-sm'

  const header = document.createElement('div')
  header.className = 'flex items-center justify-between'
  const titleWrapper = document.createElement('div')
  titleWrapper.className = 'flex items-center gap-2'

  if (esSubcuenta) {
    // Only used for orphans now
    const subIcon = document.createElement('span')
    subIcon.className = 'text-xs bg-amber-100 dark:bg-amber-900/30 text-amber-700 dark:text-amber-300 px-2 py-0.5 rounded-full'
    subIcon.textContent = 'Huérfana'
    titleWrapper.appendChild(subIcon)
  }

  const title = document.createElement('div')
  title.className = 'font-semibold'
  title.textContent = c.nombre || 'Sin nombre'
  titleWrapper.appendChild(title)

  const badge = document.createElement('div')
  badge.className = 'w-4 h-4 rounded-full'
  badge.style.backgroundColor = c.color || '#0ea5e9'
  header.appendChild(titleWrapper)
  header.appendChild(badge)

  const desc = document.createElement('div')
  desc.className = 'mt-2 text-sm text-gray-600 dark:text-gray-400'
  desc.textContent = c.descripcion || ''

  const money = document.createElement('div')
  money.className = 'mt-4 text-lg font-bold'
  money.textContent = formatCurrency(c.dinero)

  const actions = document.createElement('div')
  actions.className = 'mt-4 flex flex-wrap items-center gap-3'

  const btnEdit = document.createElement('button')
  btnEdit.className = 'inline-flex rounded-md px-3 py-2 bg-gray-100 dark:bg-gray-800 hover:bg-gray-200 dark:hover:bg-gray-700 transition-colors text-sm font-medium'
  btnEdit.textContent = 'Editar'
  btnEdit.addEventListener('click', () => abrirModalEdicion(c))

  const btnHistory = document.createElement('button')
  btnHistory.className = 'inline-flex rounded-md px-3 py-2 bg-blue-50 dark:bg-blue-900/20 text-blue-600 dark:text-blue-400 hover:bg-blue-100 dark:hover:bg-blue-900/40 transition-colors text-sm font-medium'
  btnHistory.textContent = 'Ver historial'
  btnHistory.addEventListener('click', () => abrirModalHistorial(c))

  const btnDel = document.createElement('button')
  btnDel.className = 'inline-flex rounded-md px-3 py-2 bg-red-600 text-white hover:bg-red-700 transition-colors text-sm font-medium'
  btnDel.textContent = 'Eliminar'
  btnDel.addEventListener('click', () => abrirModalEliminar(c))

  actions.appendChild(btnEdit)
  actions.appendChild(btnHistory)
  actions.appendChild(btnDel)
  card.appendChild(header)
  card.appendChild(desc)
  card.appendChild(money)
  card.appendChild(actions)
  return card
}
function abrirModalHistorial(c) {
  const modal = document.getElementById('modal-historial-cuenta')
  if (!modal) return

  // Actualizar títulos
  const titulo = document.getElementById('modal-historial-titulo')
  const subtitulo = document.getElementById('modal-historial-subtitulo')
  if (titulo) titulo.textContent = `Historial: ${c.nombre}`
  if (subtitulo) subtitulo.textContent = c.descripcion || 'Movimientos registrados en esta cuenta'

  // Generar lista
  const container = document.getElementById('lista-historial-content')
  if (container) {
    container.innerHTML = ''
    const list = document.createElement('ul')
    list.className = 'space-y-4'

    let historial = Array.isArray(c.historial) ? [...c.historial] : []

    // Compatibilidad
    const hasCreation = historial.some(h => h.tipo === 'creacion')
    if (!hasCreation && c.creadaEn) {
      historial.push({ fecha: c.creadaEn, tipo: 'creacion', mensaje: 'Cuenta creada' })
    }

    historial.sort((a, b) => new Date(b.fecha) - new Date(a.fecha))

    if (historial.length === 0) {
      container.innerHTML = `
        <div class="flex flex-col items-center justify-center py-8 text-gray-500">
          <svg class="w-12 h-12 mb-3 text-gray-300 dark:text-gray-600" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
          <p class="text-sm">No hay actividad registrada en esta cuenta.</p>
        </div>
      `
    } else {
      historial.forEach((h) => {
        const item = document.createElement('li')
        item.className = 'flex gap-4 p-3 rounded-lg hover:bg-gray-50 dark:hover:bg-gray-800/50 transition-colors border border-transparent hover:border-gray-100 dark:hover:border-gray-800'

        const date = new Date(h.fecha)
        const dateStr = date.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
        const timeStr = date.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' })

        // Icono según tipo (opcional, por ahora genérico)
        const iconDiv = document.createElement('div')
        iconDiv.className = 'flex-shrink-0 w-10 h-10 rounded-full bg-blue-50 dark:bg-blue-900/20 flex items-center justify-center text-blue-600 dark:text-blue-400'
        iconDiv.innerHTML = `
          <svg class="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"></path>
          </svg>
        `

        const contentDiv = document.createElement('div')
        contentDiv.className = 'flex-1 min-w-0'

        const msgP = document.createElement('p')
        msgP.className = 'text-sm font-medium text-gray-900 dark:text-gray-100'
        msgP.textContent = h.mensaje

        const timeP = document.createElement('p')
        timeP.className = 'text-xs text-gray-500 dark:text-gray-400 mt-0.5'
        timeP.textContent = `${dateStr} • ${timeStr}`

        contentDiv.appendChild(msgP)
        contentDiv.appendChild(timeP)

        item.appendChild(iconDiv)
        item.appendChild(contentDiv)
        list.appendChild(item)
      })
      container.appendChild(list)
    }
  }

  modal.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
}

function cerrarModalHistorial() {
  const modal = document.getElementById('modal-historial-cuenta')
  if (!modal) return
  modal.classList.add('hidden')
  document.body.style.overflow = ''
}

function abrirModalCuenta() {
  const modal = document.getElementById('modal-cuenta')
  if (!modal) return

  // Populate parent account selector
  const parentSelect = document.getElementById('cuenta-padre')
  if (parentSelect) {
    const cuentas = listarCuentas().filter(c => !c.esSubcuenta)
    parentSelect.innerHTML = '<option value="">Selecciona una cuenta principal...</option>'
    cuentas.forEach(c => {
      const opt = document.createElement('option')
      opt.value = c.id
      opt.textContent = c.nombre
      parentSelect.appendChild(opt)
    })
  }

  // Reset checkbox
  const checkbox = document.getElementById('cuenta-es-subcuenta')
  if (checkbox) checkbox.checked = false
  const container = document.getElementById('cuenta-padre-container')
  if (container) container.classList.add('hidden')

  modal.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
  const nombre = document.getElementById('cuenta-nombre')
  if (nombre) nombre.focus()
}

function cerrarModalCuenta() {
  const modal = document.getElementById('modal-cuenta')
  if (!modal) return
  modal.classList.add('hidden')
  document.body.style.overflow = ''
}

function abrirModalEdicion(c) {
  const modal = document.getElementById('modal-editar-cuenta')
  if (!modal) return

  // Llenar datos
  document.getElementById('editar-cuenta-id').value = c.id
  document.getElementById('editar-cuenta-nombre').value = c.nombre || ''
  document.getElementById('editar-cuenta-desc').value = c.descripcion || ''
  document.getElementById('editar-cuenta-color').value = c.color || '#0ea5e9'
  document.getElementById('editar-cuenta-dinero').value = c.dinero ?? 0

  // Handle parent info for sub-accounts
  const padreInfo = document.getElementById('editar-cuenta-padre-info')
  const padreNombre = document.getElementById('editar-cuenta-padre-nombre')
  if (c.esSubcuenta && c.parentId) {
    const parent = obtenerCuentaPorId(c.parentId)
    if (padreInfo) padreInfo.classList.remove('hidden')
    if (padreNombre) padreNombre.textContent = parent?.nombre || 'Cuenta eliminada'
  } else {
    if (padreInfo) padreInfo.classList.add('hidden')
  }

  // Handle sub-accounts panel for parent accounts
  const subcuentasPanel = document.getElementById('editar-subcuentas-panel')
  const subcuentasLista = document.getElementById('editar-subcuentas-lista')
  const subcuentasCount = document.getElementById('editar-subcuentas-count')
  if (!c.esSubcuenta) {
    const subs = obtenerSubcuentas(c.id)
    if (subs.length > 0) {
      if (subcuentasPanel) subcuentasPanel.classList.remove('hidden')
      if (subcuentasCount) subcuentasCount.textContent = subs.length
      if (subcuentasLista) {
        subcuentasLista.innerHTML = ''
        subs.forEach(sub => {
          const item = document.createElement('div')
          item.className = 'flex items-center gap-2 p-2 rounded-md bg-gray-50 dark:bg-gray-800'
          const colorDot = document.createElement('div')
          colorDot.className = 'w-3 h-3 rounded-full flex-shrink-0'
          colorDot.style.backgroundColor = sub.color || '#0ea5e9'
          const name = document.createElement('span')
          name.className = 'text-sm text-gray-700 dark:text-gray-300'
          name.textContent = sub.nombre
          item.appendChild(colorDot)
          item.appendChild(name)
          subcuentasLista.appendChild(item)
        })
      }
    } else {
      if (subcuentasPanel) subcuentasPanel.classList.add('hidden')
    }
  } else {
    if (subcuentasPanel) subcuentasPanel.classList.add('hidden')
  }

  modal.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
  const nombre = document.getElementById('editar-cuenta-nombre')
  if (nombre) nombre.focus()
}

function cerrarModalEdicion() {
  const modal = document.getElementById('modal-editar-cuenta')
  if (!modal) return
  modal.classList.add('hidden')
  document.body.style.overflow = ''
}

function handleEditar() {
  const form = document.getElementById('form-editar-cuenta')
  if (!form) return
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const id = document.getElementById('editar-cuenta-id').value
    const nombre = document.getElementById('editar-cuenta-nombre').value
    const descripcion = document.getElementById('editar-cuenta-desc').value
    const color = document.getElementById('editar-cuenta-color').value
    const dinero = parseFloat(document.getElementById('editar-cuenta-dinero').value || '0')

    actualizarCuenta(id, { nombre, descripcion, color, dinero })
    renderLista()
    cerrarModalEdicion()
  })
}

function initModalEdicion() {
  const closeBtn = document.getElementById('btn-cerrar-modal-editar')
  const cancelBtn = document.getElementById('btn-cancelar-modal-editar')
  const modal = document.getElementById('modal-editar-cuenta')

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault()
      cerrarModalEdicion()
    })
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault()
      cerrarModalEdicion()
    })
  }
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cerrarModalEdicion()
    })
  }
}

function handleCrear() {
  const form = document.getElementById('form-cuenta')
  if (!form) return
  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const nombre = document.getElementById('cuenta-nombre').value
    const descripcion = document.getElementById('cuenta-desc').value
    const color = document.getElementById('cuenta-color').value
    const dinero = parseFloat(document.getElementById('cuenta-dinero').value || '0')

    const esSubcuenta = document.getElementById('cuenta-es-subcuenta')?.checked || false
    const parentId = esSubcuenta ? document.getElementById('cuenta-padre')?.value || null : null

    crearCuenta({ nombre, descripcion, color, dinero, esSubcuenta, parentId })
    form.reset()
    renderLista()
    cerrarModalCuenta()
  })
}

function initModal() {
  const openBtn = document.getElementById('btn-abrir-modal-cuenta')
  const closeBtn = document.getElementById('btn-cerrar-modal-cuenta')
  const cancelBtn = document.getElementById('btn-cancelar-modal-cuenta')
  const modal = document.getElementById('modal-cuenta')
  if (openBtn) {
    openBtn.addEventListener('click', (e) => {
      e.preventDefault()
      abrirModalCuenta()
    })
  }
  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault()
      cerrarModalCuenta()
    })
  }
  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault()
      cerrarModalCuenta()
    })
  }
  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cerrarModalCuenta()
    })
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      cerrarModalCuenta()
      cerrarModalEdicion()
      cerrarModalHistorial()
      cerrarModalEliminar()
    }
  })

  // Sub-account checkbox toggle
  const subcuentaCheckbox = document.getElementById('cuenta-es-subcuenta')
  const padreContainer = document.getElementById('cuenta-padre-container')
  if (subcuentaCheckbox && padreContainer) {
    subcuentaCheckbox.addEventListener('change', () => {
      if (subcuentaCheckbox.checked) {
        padreContainer.classList.remove('hidden')
      } else {
        padreContainer.classList.add('hidden')
      }
    })
  }
}

function initModalHistorial() {
  const modal = document.getElementById('modal-historial-cuenta')
  const closeBtn = document.getElementById('btn-cerrar-modal-historial')

  if (closeBtn) {
    closeBtn.addEventListener('click', (e) => {
      e.preventDefault()
      cerrarModalHistorial()
    })
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cerrarModalHistorial()
    })
  }
}

function abrirModalEliminar(c) {
  const modal = document.getElementById('modal-eliminar-cuenta')
  if (!modal) return

  const spanNombre = document.getElementById('nombre-cuenta-eliminar')
  const inputId = document.getElementById('id-cuenta-eliminar')

  if (spanNombre) spanNombre.textContent = c.nombre || 'Sin nombre'
  if (inputId) inputId.value = c.id

  // Check for sub-accounts and show warning
  const subcuentasWarning = document.getElementById('eliminar-subcuentas-warning')
  const subcuentasCountEl = document.getElementById('eliminar-subcuentas-count')
  if (!c.esSubcuenta) {
    const subs = obtenerSubcuentas(c.id)
    if (subs.length > 0) {
      if (subcuentasWarning) subcuentasWarning.classList.remove('hidden')
      if (subcuentasCountEl) subcuentasCountEl.textContent = subs.length
    } else {
      if (subcuentasWarning) subcuentasWarning.classList.add('hidden')
    }
  } else {
    if (subcuentasWarning) subcuentasWarning.classList.add('hidden')
  }

  // Check for associated operations
  const idsAfectados = obtenerIdsParaEliminar(c.id)
  const numOperaciones = contarOperacionesPorCuentas(idsAfectados)

  const operacionesWarning = document.getElementById('eliminar-operaciones-warning')
  const operacionesCountEl = document.getElementById('eliminar-operaciones-count')
  const opcionesOperaciones = document.getElementById('eliminar-opciones-operaciones')

  if (numOperaciones > 0) {
    if (operacionesWarning) operacionesWarning.classList.remove('hidden')
    if (operacionesCountEl) operacionesCountEl.textContent = numOperaciones
    if (opcionesOperaciones) opcionesOperaciones.classList.remove('hidden')
  } else {
    if (operacionesWarning) operacionesWarning.classList.add('hidden')
    if (opcionesOperaciones) opcionesOperaciones.classList.add('hidden')
  }

  // Reset radio selection
  const radioConservar = document.getElementById('eliminar-ops-conservar')
  if (radioConservar) radioConservar.checked = true

  modal.classList.remove('hidden')
  document.body.style.overflow = 'hidden'

  const btnConfirm = document.getElementById('btn-confirmar-eliminar')
  if (btnConfirm) btnConfirm.focus()
}

function cerrarModalEliminar() {
  const modal = document.getElementById('modal-eliminar-cuenta')
  if (!modal) return
  modal.classList.add('hidden')
  document.body.style.overflow = ''
}

function initModalEliminar() {
  const modal = document.getElementById('modal-eliminar-cuenta')
  const cancelBtn = document.getElementById('btn-cancelar-eliminar')
  const confirmBtn = document.getElementById('btn-confirmar-eliminar')

  if (cancelBtn) {
    cancelBtn.addEventListener('click', (e) => {
      e.preventDefault()
      cerrarModalEliminar()
    })
  }

  if (modal) {
    modal.addEventListener('click', (e) => {
      if (e.target === modal) cerrarModalEliminar()
    })
  }

  if (confirmBtn) {
    // Usar onclick para evitar acumulación de listeners o manejarlo con cuidado
    confirmBtn.onclick = (e) => {
      e.preventDefault()
      const id = document.getElementById('id-cuenta-eliminar').value
      if (id) {
        // Verificar si el usuario quiere eliminar las operaciones
        const radioEliminarOps = document.getElementById('eliminar-ops-eliminar')
        const eliminarOperaciones = radioEliminarOps && radioEliminarOps.checked

        const idsAfectados = obtenerIdsParaEliminar(id)

        // Si eligió eliminar operaciones, hacerlo primero
        if (eliminarOperaciones) {
          eliminarOperacionesPorCuentas(idsAfectados)
        }

        // Eliminar la cuenta
        eliminarCuenta(id)
        renderLista()
        cerrarModalEliminar()
      }
    }
  }
}

function init() {
  if (window.GTRTheme && typeof window.GTRTheme.applyThemeOnLoad === 'function') window.GTRTheme.applyThemeOnLoad()
  const toggleBtn = document.getElementById('theme-toggle')
  if (toggleBtn && window.GTRTheme && typeof window.GTRTheme.toggleTheme === 'function') {
    toggleBtn.addEventListener('click', window.GTRTheme.toggleTheme)
  }
  const links = document.querySelectorAll('nav a[data-route]')
  const current = location.pathname.split('/').pop() || 'index.html'
  links.forEach((a) => {
    const route = a.getAttribute('data-route')
    if (!route) return
    if (route === current) a.classList.add('text-primary-600', 'dark:text-primary-400')
    else a.classList.remove('text-primary-600', 'dark:text-primary-400')
  })
  initModal()
  initModalHistorial()
  initModalEliminar()
  initModalEdicion()
  initModalSeparadores()
  handleCrear()
  handleEditar()
  renderLista()
}

// ========== SEPARADORES ==========

function abrirModalCrearSeparador() {
  const modal = document.getElementById('modal-crear-separador')
  if (!modal) return

  // Populate accounts checklist (only main accounts not already in a separator)
  const lista = document.getElementById('separador-cuentas-lista')
  if (lista) {
    const cuentas = listarCuentas().filter(c => !c.esSubcuenta)
    cuentas.sort((a, b) => (b.dinero || 0) - (a.dinero || 0))

    lista.innerHTML = ''
    if (cuentas.length === 0) {
      lista.innerHTML = '<p class="text-sm text-gray-400 italic">No hay cuentas disponibles.</p>'
    } else {
      cuentas.forEach(c => {
        const sep = obtenerSeparadorDeCuenta(c.id)
        const label = document.createElement('label')
        label.className = 'flex items-center gap-3 p-2 rounded hover:bg-gray-50 dark:hover:bg-gray-800 cursor-pointer'

        const checkbox = document.createElement('input')
        checkbox.type = 'checkbox'
        checkbox.value = c.id
        checkbox.className = 'w-4 h-4 rounded border-gray-300 text-sky-600 focus:ring-sky-500'

        const colorDot = document.createElement('div')
        colorDot.className = 'w-3 h-3 rounded-full flex-shrink-0'
        colorDot.style.backgroundColor = c.color || '#0ea5e9'

        const info = document.createElement('div')
        info.className = 'flex-1'
        const name = document.createElement('span')
        name.className = 'text-sm font-medium text-gray-800 dark:text-gray-200'
        name.textContent = c.nombre
        info.appendChild(name)

        if (sep) {
          const badge = document.createElement('span')
          badge.className = 'ml-2 text-xs text-gray-400'
          badge.textContent = `(en ${sep.nombre})`
          info.appendChild(badge)
        }

        label.appendChild(checkbox)
        label.appendChild(colorDot)
        label.appendChild(info)
        lista.appendChild(label)
      })
    }
  }

  // Populate color picker
  const coloresContainer = document.getElementById('separador-colores')
  if (coloresContainer) {
    coloresContainer.innerHTML = ''
    COLORES_SEPARADOR.forEach((col, i) => {
      const label = document.createElement('label')
      label.className = 'cursor-pointer'

      const radio = document.createElement('input')
      radio.type = 'radio'
      radio.name = 'separador-color'
      radio.value = col
      radio.className = 'sr-only peer'
      if (i === 0) radio.checked = true

      const dot = document.createElement('div')
      dot.className = 'w-7 h-7 rounded-full border-2 border-transparent peer-checked:border-gray-800 dark:peer-checked:border-white peer-checked:scale-110 transition-transform'
      dot.style.backgroundColor = col

      label.appendChild(radio)
      label.appendChild(dot)
      coloresContainer.appendChild(label)
    })
  }

  // Reset form
  const form = document.getElementById('form-crear-separador')
  if (form) form.reset()

  modal.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
  const nombreInput = document.getElementById('separador-nombre')
  if (nombreInput) nombreInput.focus()
}

function cerrarModalCrearSeparador() {
  const modal = document.getElementById('modal-crear-separador')
  if (!modal) return
  modal.classList.add('hidden')
  document.body.style.overflow = ''
}

function handleCrearSeparador() {
  const form = document.getElementById('form-crear-separador')
  if (!form) return

  form.addEventListener('submit', (e) => {
    e.preventDefault()
    const nombre = document.getElementById('separador-nombre').value
    const checkboxes = document.querySelectorAll('#separador-cuentas-lista input[type="checkbox"]:checked')
    const cuentaIds = Array.from(checkboxes).map(cb => cb.value)
    const colorRadio = document.querySelector('#separador-colores input[name="separador-color"]:checked')
    const color = colorRadio ? colorRadio.value : COLORES_SEPARADOR[0]

    if (cuentaIds.length === 0) {
      alert('Selecciona al menos una cuenta.')
      return
    }

    crearSeparador({ nombre, cuentaIds, color })
    renderLista()
    cerrarModalCrearSeparador()
  })
}

function abrirModalGestionSeparadores() {
  const modal = document.getElementById('modal-gestionar-separadores')
  if (!modal) return

  renderGestionSeparadores()

  modal.classList.remove('hidden')
  document.body.style.overflow = 'hidden'
}

function cerrarModalGestionSeparadores() {
  const modal = document.getElementById('modal-gestionar-separadores')
  if (!modal) return
  modal.classList.add('hidden')
  document.body.style.overflow = ''
}

function renderGestionSeparadores() {
  const cont = document.getElementById('gestionar-separadores-content')
  if (!cont) return

  const separadores = listarSeparadores()
  const cuentas = listarCuentas().filter(c => !c.esSubcuenta)

  cont.innerHTML = ''

  if (separadores.length === 0) {
    cont.innerHTML = '<p class="text-sm text-gray-400 italic text-center py-8">No hay categorías creadas.</p>'
    return
  }

  separadores.forEach(sep => {
    const card = document.createElement('div')
    card.className = 'p-4 rounded-lg border border-gray-200 dark:border-gray-700 bg-gray-50 dark:bg-gray-800/50'

    // Header
    const header = document.createElement('div')
    header.className = 'flex items-center justify-between mb-3'

    const titleArea = document.createElement('div')
    titleArea.className = 'flex items-center gap-2'

    const icon = document.createElement('div')
    icon.className = 'w-1.5 h-6 rounded-full'
    icon.style.backgroundColor = sep.color || '#0ea5e9'

    const title = document.createElement('input')
    title.type = 'text'
    title.value = sep.nombre
    title.className = 'font-semibold text-gray-800 dark:text-gray-200 bg-transparent border-0 border-b border-transparent hover:border-gray-300 focus:border-sky-500 focus:ring-0 outline-none px-1 py-0.5'
    title.onblur = () => {
      if (title.value.trim() !== sep.nombre) {
        actualizarSeparador(sep.id, { nombre: title.value.trim() })
        renderLista()
      }
    }
    title.onkeydown = (e) => { if (e.key === 'Enter') title.blur() }

    titleArea.appendChild(icon)
    titleArea.appendChild(title)

    const actions = document.createElement('div')
    actions.className = 'flex items-center gap-1'

    // Move up button
    const btnUp = document.createElement('button')
    btnUp.className = 'p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors'
    btnUp.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 15l7-7 7 7"></path></svg>'
    btnUp.title = 'Mover arriba'
    btnUp.onclick = () => {
      moverSeparador(sep.id, 'up')
      renderGestionSeparadores()
      renderLista()
    }

    // Move down button
    const btnDown = document.createElement('button')
    btnDown.className = 'p-1.5 text-gray-400 hover:text-gray-700 dark:hover:text-gray-200 hover:bg-gray-100 dark:hover:bg-gray-700 rounded transition-colors'
    btnDown.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 9l-7 7-7-7"></path></svg>'
    btnDown.title = 'Mover abajo'
    btnDown.onclick = () => {
      moverSeparador(sep.id, 'down')
      renderGestionSeparadores()
      renderLista()
    }

    const btnDel = document.createElement('button')
    btnDel.className = 'p-1.5 text-gray-400 hover:text-red-600 hover:bg-red-50 dark:hover:bg-red-900/20 rounded transition-colors'
    btnDel.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"></path></svg>'
    btnDel.onclick = () => {
      if (confirm(`¿Eliminar categoría "${sep.nombre}"? Las cuentas quedarán sin agrupar.`)) {
        eliminarSeparador(sep.id)
        renderGestionSeparadores()
        renderLista()
      }
    }

    actions.appendChild(btnUp)
    actions.appendChild(btnDown)
    actions.appendChild(btnDel)
    header.appendChild(titleArea)
    header.appendChild(actions)
    card.appendChild(header)

    // Color picker row
    const colorRow = document.createElement('div')
    colorRow.className = 'flex items-center gap-2 mb-3 pb-2 border-b border-gray-100 dark:border-gray-700'
    const colorLabel = document.createElement('span')
    colorLabel.className = 'text-xs text-gray-500'
    colorLabel.textContent = 'Color:'
    colorRow.appendChild(colorLabel)

    COLORES_SEPARADOR.forEach(col => {
      const dot = document.createElement('button')
      dot.className = 'w-5 h-5 rounded-full border-2 transition-transform hover:scale-110'
      dot.style.backgroundColor = col
      dot.style.borderColor = (sep.color === col) ? '#1f2937' : 'transparent'
      dot.onclick = () => {
        actualizarSeparador(sep.id, { color: col })
        renderGestionSeparadores()
        renderLista()
      }
      colorRow.appendChild(dot)
    })
    card.appendChild(colorRow)

    // Accounts list
    const accountsList = document.createElement('div')
    accountsList.className = 'space-y-1'

    cuentas.forEach(c => {
      const isInSep = sep.cuentaIds.includes(c.id)
      // Check if this account is in ANOTHER separator
      const otherSep = separadores.find(s => s.id !== sep.id && s.cuentaIds.includes(c.id))
      const isInOtherSep = !!otherSep

      const row = document.createElement('label')
      row.className = 'flex items-center gap-2 p-1.5 rounded ' + (isInOtherSep ? 'opacity-50 cursor-not-allowed' : 'hover:bg-gray-100 dark:hover:bg-gray-700 cursor-pointer')

      const cb = document.createElement('input')
      cb.type = 'checkbox'
      cb.checked = isInSep
      cb.disabled = isInOtherSep
      cb.className = 'w-3.5 h-3.5 rounded border-gray-300 text-sky-600 focus:ring-sky-500' + (isInOtherSep ? ' cursor-not-allowed' : '')
      cb.onchange = () => {
        if (isInOtherSep) return
        let newIds = [...sep.cuentaIds]
        if (cb.checked) {
          newIds.push(c.id)
        } else {
          newIds = newIds.filter(id => id !== c.id)
        }
        actualizarSeparador(sep.id, { cuentaIds: newIds })
        renderGestionSeparadores()
        renderLista()
      }

      const colorDot = document.createElement('div')
      colorDot.className = 'w-2 h-2 rounded-full'
      colorDot.style.backgroundColor = c.color || '#0ea5e9'

      const name = document.createElement('span')
      name.className = 'text-xs text-gray-600 dark:text-gray-300'
      name.textContent = c.nombre

      row.appendChild(cb)
      row.appendChild(colorDot)
      row.appendChild(name)
      accountsList.appendChild(row)
    })

    card.appendChild(accountsList)
    cont.appendChild(card)
  })
}

function initModalSeparadores() {
  const btnAbrir = document.getElementById('btn-abrir-modal-separador')
  const btnCerrar = document.getElementById('btn-cerrar-modal-separador')
  const btnCancelar = document.getElementById('btn-cancelar-separador')
  const modal = document.getElementById('modal-crear-separador')

  const btnGestionar = document.getElementById('btn-gestionar-separadores')
  const btnCerrarGestionar = document.getElementById('btn-cerrar-gestionar-separadores')
  const btnCerrarAbajo = document.getElementById('btn-cerrar-gestionar-abajo')
  const modalGestionar = document.getElementById('modal-gestionar-separadores')

  if (btnAbrir) btnAbrir.addEventListener('click', abrirModalCrearSeparador)
  if (btnCerrar) btnCerrar.addEventListener('click', cerrarModalCrearSeparador)
  if (btnCancelar) btnCancelar.addEventListener('click', cerrarModalCrearSeparador)
  if (modal) modal.addEventListener('click', (e) => { if (e.target === modal) cerrarModalCrearSeparador() })

  if (btnGestionar) btnGestionar.addEventListener('click', abrirModalGestionSeparadores)
  if (btnCerrarGestionar) btnCerrarGestionar.addEventListener('click', cerrarModalGestionSeparadores)
  if (btnCerrarAbajo) btnCerrarAbajo.addEventListener('click', cerrarModalGestionSeparadores)
  if (modalGestionar) modalGestionar.addEventListener('click', (e) => { if (e.target === modalGestionar) cerrarModalGestionSeparadores() })

  handleCrearSeparador()
}

document.addEventListener('DOMContentLoaded', init)

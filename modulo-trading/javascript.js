// Service Worker registrado globalmente desde /app.js; evitar registro duplicado aquí

const ACCOUNT_META_KEY = 'tradingAccountsMeta';
const ACCOUNT_ACTIVE_KEY = 'activeTradingAccountId';
const ACCOUNT_DATA_PREFIX = 'tradingAccountData:';
const ACCOUNT_SCOPED_KEYS = new Set(['trades', 'capitalMovements', 'initialCapital', 'username', 'capitalStartDate', 'strategies']);
const ACCOUNT_SELECT_ID = 'account-select';
const ACCOUNT_CREATE_BUTTON_ID = 'add-account-btn';
const ACCOUNT_NAME_ID = 'active-account-name';
let capitalEvolutionChartInstance = null;
const CAPITAL_MONTH_NAMES_ES = ['Ene', 'Feb', 'Mar', 'Abr', 'May', 'Jun', 'Jul', 'Ago', 'Sep', 'Oct', 'Nov', 'Dic'];
const MS_PER_YEAR = 365 * 24 * 60 * 60 * 1000;
const STRATEGY_STORAGE_KEY = 'strategies';
const STRATEGY_ID_PREFIX = 'strategy-';
const STRATEGIES_UPDATED_EVENT = 'tradingStrategiesUpdated';
const STRATEGY_NAME_MAX_LENGTH = 80;
const DEFAULT_STRATEGIES = [
  'Script CCI',
  'Script RSI',
  'Script MACD',
  'Script AO',
  'Script TII',
  'Script DeMarker',
  'Script Estocastico',
  'Script Cruce de MMs',
  'Script SAR',
  'Script BMSB',
  'Script CDM-RSI',
  'Script EMA Grupos',
  'Script FCT',
  'Señales app',
  'Análisis técnico',
  'Script SuperTrend',
  'Script Ruptura EMA200 tendencia',
  'Script Señales TradingView'
];

function slugifyStrategyName(name) {
  return name
    .toLowerCase()
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '') || 'estrategia';
}

function generateStrategyId() {
  return STRATEGY_ID_PREFIX + Date.now() + '-' + Math.floor(Math.random() * 1000000);
}

function getDefaultStrategyObjects() {
  return DEFAULT_STRATEGIES.map(name => ({
    id: `${STRATEGY_ID_PREFIX}default-${slugifyStrategyName(name)}`,
    name,
    builtIn: true
  }));
}

function normalizeStrategyItem(item) {
  if (!item || typeof item !== 'object') return null;
  const name = typeof item.name === 'string' ? item.name.trim().slice(0, STRATEGY_NAME_MAX_LENGTH) : '';
  if (!name) return null;
  const lowerName = name.toLowerCase();
  const isBuiltInName = DEFAULT_STRATEGIES.some(defaultName => defaultName.toLowerCase() === lowerName);
  const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : generateStrategyId();
  return {
    id,
    name,
    builtIn: item.builtIn === true && isBuiltInName
  };
}

function normalizeStrategiesList(raw) {
  const defaults = getDefaultStrategyObjects();
  const custom = [];
  const seenNames = new Set(defaults.map(item => item.name.toLowerCase()));
  if (Array.isArray(raw)) {
    raw.forEach(entry => {
      const normalized = normalizeStrategyItem(entry);
      if (!normalized) return;
      if (normalized.builtIn) return;
      const lower = normalized.name.toLowerCase();
      if (seenNames.has(lower)) return;
      seenNames.add(lower);
      custom.push({ id: normalized.id, name: normalized.name, builtIn: false });
    });
  }
  custom.sort((a, b) => a.name.localeCompare(b.name, 'es', { sensitivity: 'base' }));
  return defaults.concat(custom);
}

const originalLocalStorageGetItem = localStorage.getItem.bind(localStorage);
const originalLocalStorageSetItem = localStorage.setItem.bind(localStorage);
const originalLocalStorageRemoveItem = localStorage.removeItem.bind(localStorage);

function normalizeAccountsMeta(meta) {
  if (!Array.isArray(meta)) return [];
  const sanitized = meta
    .filter(account => account && account.id)
    .map(account => ({
      id: account.id,
      nombre: account.nombre || 'Cuenta',
      creadoEn: account.creadoEn || new Date().toISOString(),
      esPrincipal: account.esPrincipal === true
    }));
  if (!sanitized.length) return [];
  if (!sanitized.some(account => account.esPrincipal)) {
    sanitized[0].esPrincipal = true;
  }
  return sanitized;
}

function readAccountsMeta() {
  const raw = originalLocalStorageGetItem(ACCOUNT_META_KEY);
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return normalizeAccountsMeta(parsed);
  } catch (error) {
    return [];
  }
}

function writeAccountsMeta(meta) {
  const normalized = normalizeAccountsMeta(meta);
  originalLocalStorageSetItem(ACCOUNT_META_KEY, JSON.stringify(normalized));
}

function normalizeAccountData(data) {
  const trades = Array.isArray(data && data.trades) ? data.trades : [];
  const capitalMovements = Array.isArray(data && data.capitalMovements) ? data.capitalMovements : [];
  const initialCapital = data && data.initialCapital !== undefined && data.initialCapital !== null ? String(data.initialCapital) : null;
  const username = data && data.username !== undefined && data.username !== null ? String(data.username) : null;
  const capitalStartDate = data && data.capitalStartDate ? data.capitalStartDate : null;
  const strategies = normalizeStrategiesList(data && data.strategies);
  return { trades, capitalMovements, initialCapital, username, capitalStartDate, strategies };
}

function readAccountData(accountId) {
  const raw = originalLocalStorageGetItem(ACCOUNT_DATA_PREFIX + accountId);
  if (!raw) return normalizeAccountData({});
  try {
    const parsed = JSON.parse(raw);
    return normalizeAccountData(parsed);
  } catch (error) {
    return normalizeAccountData({});
  }
}

function writeAccountData(accountId, data) {
  const payload = normalizeAccountData(data);
  originalLocalStorageSetItem(ACCOUNT_DATA_PREFIX + accountId, JSON.stringify(payload));
}

function readStrategies(accountId) {
  const data = readAccountData(accountId || getActiveAccountId());
  return data.strategies;
}

function writeStrategies(accountId, strategies) {
  const id = accountId || getActiveAccountId();
  const current = readAccountData(id);
  current.strategies = normalizeStrategiesList(strategies);
  writeAccountData(id, current);
  return current.strategies;
}

function getActiveAccountStrategies() {
  return readStrategies(getActiveAccountId());
}

function dispatchStrategiesUpdated(strategies, options) {
  const event = new CustomEvent(STRATEGIES_UPDATED_EVENT, {
    detail: {
      strategies,
      accountId: options && options.accountId ? options.accountId : getActiveAccountId(),
      reason: options && options.reason ? options.reason : 'update'
    }
  });
  window.dispatchEvent(event);
}

function getActiveStrategyList() {
  return getActiveAccountStrategies();
}

function setActiveStrategyList(strategies, reason) {
  const updated = writeStrategies(getActiveAccountId(), strategies);
  dispatchStrategiesUpdated(updated, { reason: reason || 'update' });
  return updated;
}

function fillStrategySelectOptions(select, selectedValue) {
  if (!select) return;
  const strategies = ensureStrategyDataInitialized();
  const placeholder = select.dataset.strategyPlaceholder || '';
  const allowEmpty = select.dataset.strategyAllowEmpty === 'true';
  const previousValue = selectedValue !== undefined ? selectedValue : select.value;
  select.innerHTML = '';
  if (placeholder) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = placeholder;
    if (!allowEmpty) option.disabled = true;
    select.appendChild(option);
  } else if (allowEmpty) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = '';
    select.appendChild(option);
  }
  let matched = false;
  strategies.forEach(strategy => {
    const option = document.createElement('option');
    option.value = strategy.name;
    option.textContent = strategy.name;
    if (previousValue && strategy.name === previousValue) {
      option.selected = true;
      matched = true;
    }
    select.appendChild(option);
  });
  if (!matched) {
    if (placeholder && select.options.length > 1 && select.options[0].disabled) {
      select.selectedIndex = 1;
    } else if (select.options.length) {
      select.selectedIndex = placeholder && allowEmpty ? 0 : 0;
    }
  }
}

function populateStrategySelects() {
  const selects = document.querySelectorAll('[data-strategy-select="true"]');
  selects.forEach(select => {
    const selected = select.value;
    fillStrategySelectOptions(select, selected);
  });
}

function populateStrategySelectOptions(select, placeholder) {
  if (!select) return;
  const strategies = ensureStrategyDataInitialized();
  select.innerHTML = '';
  if (placeholder) {
    const option = document.createElement('option');
    option.value = '';
    option.textContent = placeholder;
    option.disabled = true;
    option.selected = true;
    select.appendChild(option);
  }
  strategies.forEach(strategy => {
    const option = document.createElement('option');
    option.value = strategy.name;
    option.textContent = strategy.name;
    select.appendChild(option);
  });
}

function addCustomStrategy(name) {
  const trimmed = typeof name === 'string' ? name.trim().slice(0, STRATEGY_NAME_MAX_LENGTH) : '';
  if (!trimmed) return { success: false, error: 'Nombre inválido' };
  const current = getActiveStrategyList();
  if (current.some(item => item.name.toLowerCase() === trimmed.toLowerCase())) {
    return { success: false, error: 'Ya existe una estrategia con ese nombre' };
  }
  const newStrategy = { id: generateStrategyId(), name: trimmed, builtIn: false };
  const updated = setActiveStrategyList(current.concat([newStrategy]), 'create');
  return { success: true, strategy: newStrategy, strategies: updated };
}

function updateCustomStrategy(id, newName) {
  const trimmed = typeof newName === 'string' ? newName.trim().slice(0, STRATEGY_NAME_MAX_LENGTH) : '';
  if (!trimmed) return { success: false, error: 'Nombre inválido' };
  const current = getActiveStrategyList();
  const targetIndex = current.findIndex(item => item.id === id);
  if (targetIndex === -1) return { success: false, error: 'Estrategia no encontrada' };
  const target = current[targetIndex];
  if (target.builtIn) return { success: false, error: 'No se puede editar una estrategia predeterminada' };
  if (current.some(item => item.id !== id && item.name.toLowerCase() === trimmed.toLowerCase())) {
    return { success: false, error: 'Ya existe una estrategia con ese nombre' };
  }
  const updated = current.slice();
  updated[targetIndex] = { ...target, name: trimmed };
  const normalized = setActiveStrategyList(updated, 'update');
  return { success: true, strategy: normalized.find(item => item.id === id), strategies: normalized };
}

function deleteCustomStrategy(id) {
  const current = getActiveStrategyList();
  const target = current.find(item => item.id === id);
  if (!target) return { success: false, error: 'Estrategia no encontrada' };
  if (target.builtIn) return { success: false, error: 'No se puede eliminar una estrategia predeterminada' };
  const updated = current.filter(item => item.id !== id);
  const normalized = setActiveStrategyList(updated, 'delete');
  return { success: true, strategies: normalized };
}

function ensureStrategyDataInitialized() {
  const current = getActiveStrategyList();
  if (!Array.isArray(current) || !current.length) {
    setActiveStrategyList(getDefaultStrategyObjects(), 'initialize');
  }
  return getActiveStrategyList();
}

function renderStrategyManagementSection() {
  const container = document.getElementById('strategy-management');
  if (!container) return;
  const builtInList = container.querySelector('#built-in-strategy-list');
  const customList = container.querySelector('#custom-strategy-list');
  const emptyMessage = container.querySelector('#custom-strategy-empty');
  const strategies = ensureStrategyDataInitialized();
  if (builtInList) {
    builtInList.innerHTML = '';
    strategies.filter(item => item.builtIn).forEach(strategy => {
      const li = document.createElement('li');
      const span = document.createElement('span');
      span.textContent = strategy.name;
      li.appendChild(span);
      builtInList.appendChild(li);
    });
  }
  if (customList) {
    customList.innerHTML = '';
    const customs = strategies.filter(item => !item.builtIn);
    customs.forEach(strategy => {
      const li = document.createElement('li');
      li.dataset.id = strategy.id;
      const span = document.createElement('span');
      span.textContent = strategy.name;
      const actions = document.createElement('div');
      actions.className = 'strategy-actions';
      const editButton = document.createElement('button');
      editButton.type = 'button';
      editButton.className = 'nav-btn secondary';
      editButton.dataset.action = 'edit';
      editButton.dataset.id = strategy.id;
      editButton.textContent = 'Editar';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'nav-btn clear';
      deleteButton.dataset.action = 'delete';
      deleteButton.dataset.id = strategy.id;
      deleteButton.textContent = 'Eliminar';
      actions.appendChild(editButton);
      actions.appendChild(deleteButton);
      li.appendChild(span);
      li.appendChild(actions);
      customList.appendChild(li);
    });
    if (emptyMessage) {
      emptyMessage.style.display = customs.length ? 'none' : 'block';
    }
  }
}

function setupStrategyManagementUI() {
  const container = document.getElementById('strategy-management');
  if (!container || container.dataset.bound === 'true') return;
  const form = container.querySelector('#strategy-add-form');
  const input = container.querySelector('#new-strategy-name');
  const list = container.querySelector('#custom-strategy-list');
  if (form && input) {
    form.addEventListener('submit', function(event) {
      event.preventDefault();
      const name = input.value.trim();
      if (!name) {
        alert('Ingresa un nombre de estrategia.');
        return;
      }
      const result = addCustomStrategy(name);
      if (!result.success) {
        alert(result.error);
        return;
      }
      input.value = '';
    });
  }
  if (list) {
    list.addEventListener('click', function(event) {
      const button = event.target.closest('button');
      if (!button) return;
      const id = button.dataset.id;
      if (!id) return;
      if (button.dataset.action === 'edit') {
        const strategies = ensureStrategyDataInitialized();
        const target = strategies.find(item => item.id === id);
        if (!target) return;
        const newName = prompt('Nuevo nombre de la estrategia:', target.name);
        if (newName === null) return;
        const result = updateCustomStrategy(id, newName);
        if (!result.success) {
          alert(result.error);
        }
      } else if (button.dataset.action === 'delete') {
        if (!confirm('¿Deseas eliminar esta estrategia?')) return;
        const result = deleteCustomStrategy(id);
        if (!result.success) {
          alert(result.error);
        }
      }
    });
  }
  container.dataset.bound = 'true';
  renderStrategyManagementSection();
}

window.addEventListener(STRATEGIES_UPDATED_EVENT, function() {
  populateStrategySelects();
  renderStrategyManagementSection();
});

function getAccountsMeta() {
  return readAccountsMeta();
}

function setActiveAccountId(accountId) {
  const meta = readAccountsMeta();
  if (!meta.find(account => account.id === accountId)) return false;
  originalLocalStorageSetItem(ACCOUNT_ACTIVE_KEY, accountId);
  return true;
}

function ensureActiveAccount() {
  let meta = readAccountsMeta();
  let activeId = originalLocalStorageGetItem(ACCOUNT_ACTIVE_KEY);
  if (!meta.length) {
    const defaultId = `account-${Date.now()}`;
    let legacyTrades = [];
    const legacyTradesRaw = originalLocalStorageGetItem('trades');
    if (legacyTradesRaw) {
      try {
        legacyTrades = JSON.parse(legacyTradesRaw);
      } catch (error) {
        legacyTrades = [];
      }
    }
    let legacyMovements = [];
    const legacyMovementsRaw = originalLocalStorageGetItem('capitalMovements');
    if (legacyMovementsRaw) {
      try {
        legacyMovements = JSON.parse(legacyMovementsRaw);
      } catch (error) {
        legacyMovements = [];
      }
    }
    const legacyInitialCapital = originalLocalStorageGetItem('initialCapital');
    const legacyUsername = originalLocalStorageGetItem('username');
    const legacyCapitalStartDate = originalLocalStorageGetItem('capitalStartDate');
    meta = [{ id: defaultId, nombre: 'Cuenta Principal', creadoEn: new Date().toISOString(), esPrincipal: true }];
    writeAccountsMeta(meta);
    writeAccountData(defaultId, {
      trades: legacyTrades,
      capitalMovements: legacyMovements,
      initialCapital: legacyInitialCapital,
      username: legacyUsername,
      capitalStartDate: legacyCapitalStartDate,
      strategies: getDefaultStrategyObjects()
    });
    originalLocalStorageRemoveItem('trades');
    originalLocalStorageRemoveItem('capitalMovements');
    originalLocalStorageRemoveItem('initialCapital');
    originalLocalStorageRemoveItem('username');
    originalLocalStorageRemoveItem('capitalStartDate');
    activeId = defaultId;
    originalLocalStorageSetItem(ACCOUNT_ACTIVE_KEY, activeId);
  }
  if (!meta.some(account => account.esPrincipal)) {
    meta[0].esPrincipal = true;
    writeAccountsMeta(meta);
    meta = readAccountsMeta();
  }
  if (!activeId || !meta.find(account => account.id === activeId)) {
    activeId = meta[0].id;
    originalLocalStorageSetItem(ACCOUNT_ACTIVE_KEY, activeId);
  }
  return activeId;
}

function getActiveAccountId() {
  return ensureActiveAccount();
}

function getActiveAccountMeta() {
  const id = getActiveAccountId();
  const meta = readAccountsMeta();
  return meta.find(account => account.id === id) || null;
}

function createTradingAccount(name) {
  const trimmed = name.trim();
  if (!trimmed) return null;
  const meta = readAccountsMeta();
  const id = `account-${Date.now()}-${Math.floor(Math.random() * 100000)}`;
  meta.push({ id, nombre: trimmed, creadoEn: new Date().toISOString(), esPrincipal: false });
  writeAccountsMeta(meta);
  writeAccountData(id, { trades: [], capitalMovements: [], initialCapital: null, username: null, capitalStartDate: null, strategies: getDefaultStrategyObjects() });
  return id;
}

function deleteAccountData(accountId) {
  originalLocalStorageRemoveItem(ACCOUNT_DATA_PREFIX + accountId);
}

function renameTradingAccount(accountId, newName) {
  const trimmed = (newName || '').trim();
  if (!trimmed) return false;
  const meta = readAccountsMeta();
  const account = meta.find(item => item.id === accountId);
  if (!account) return false;
  account.nombre = trimmed;
  writeAccountsMeta(meta);
  const activeId = originalLocalStorageGetItem(ACCOUNT_ACTIVE_KEY);
  if (activeId === accountId) {
    updateActiveAccountNameDisplay();
  }
  populateAccountSelectElement();
  return true;
}

function deleteTradingAccount(accountId) {
  const meta = readAccountsMeta();
  const accountIndex = meta.findIndex(item => item.id === accountId);
  if (accountIndex === -1) return false;
  if (meta[accountIndex].esPrincipal) return false;
  const updatedMeta = [...meta.slice(0, accountIndex), ...meta.slice(accountIndex + 1)];
  if (!updatedMeta.length) return false;
  writeAccountsMeta(updatedMeta);
  deleteAccountData(accountId);
  const activeId = originalLocalStorageGetItem(ACCOUNT_ACTIVE_KEY);
  if (activeId === accountId) {
    originalLocalStorageSetItem(ACCOUNT_ACTIVE_KEY, updatedMeta[0].id);
  }
  populateAccountSelectElement();
  updateActiveAccountNameDisplay();
  return true;
}

function getActiveAccountSnapshot() {
  const id = getActiveAccountId();
  const data = readAccountData(id);
  const meta = getActiveAccountMeta();
  return {
    accountId: id,
    accountName: meta ? meta.nombre : '',
    trades: data.trades,
    capitalMovements: data.capitalMovements,
    initialCapital: data.initialCapital,
    username: data.username,
    capitalStartDate: data.capitalStartDate,
    strategies: data.strategies
  };
}

function applySnapshotToActiveAccount(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return;
  const id = getActiveAccountId();
  const current = readAccountData(id);
  if (Array.isArray(snapshot.trades)) current.trades = snapshot.trades;
  if (Array.isArray(snapshot.capitalMovements)) current.capitalMovements = snapshot.capitalMovements;
  if (snapshot.initialCapital !== undefined) current.initialCapital = snapshot.initialCapital !== null ? String(snapshot.initialCapital) : null;
  if (snapshot.username !== undefined) current.username = snapshot.username !== null ? String(snapshot.username) : null;
  if (snapshot.capitalStartDate !== undefined) current.capitalStartDate = snapshot.capitalStartDate || null;
  if (Array.isArray(snapshot.strategies)) current.strategies = normalizeStrategiesList(snapshot.strategies);
  writeAccountData(id, current);
  dispatchStrategiesUpdated(current.strategies, { accountId: id, reason: 'snapshot' });
}

function populateAccountSelectElement() {
  const select = document.getElementById(ACCOUNT_SELECT_ID);
  if (!select) return;
  const meta = readAccountsMeta();
  const activeId = getActiveAccountId();
  select.innerHTML = '';
  meta.forEach(account => {
    const option = document.createElement('option');
    option.value = account.id;
    option.textContent = account.nombre;
    if (account.id === activeId) option.selected = true;
    select.appendChild(option);
  });
}

function updateActiveAccountNameDisplay() {
  const label = document.getElementById(ACCOUNT_NAME_ID);
  if (!label) return;
  const meta = getActiveAccountMeta();
  label.textContent = meta ? meta.nombre : '';
}

function setupAccountUI() {
  ensureActiveAccount();
  populateAccountSelectElement();
  updateActiveAccountNameDisplay();
  const select = document.getElementById(ACCOUNT_SELECT_ID);
  if (select && !select.dataset.bound) {
    select.addEventListener('change', function(event) {
      if (setActiveAccountId(event.target.value)) {
        populateAccountSelectElement();
        updateActiveAccountNameDisplay();
        location.reload();
      }
    });
    select.dataset.bound = 'true';
  }
  const button = document.getElementById(ACCOUNT_CREATE_BUTTON_ID);
  if (button && !button.dataset.bound) {
    button.addEventListener('click', function() {
      const proposedName = prompt('Nombre de la nueva cuenta');
      if (!proposedName) return;
      const newId = createTradingAccount(proposedName);
      if (newId && setActiveAccountId(newId)) {
        populateAccountSelectElement();
        updateActiveAccountNameDisplay();
        location.reload();
      }
    });
    button.dataset.bound = 'true';
  }
}

localStorage.getItem = function(key) {
  if (ACCOUNT_SCOPED_KEYS.has(key)) {
    const accountId = getActiveAccountId();
    const data = readAccountData(accountId);
    if (key === 'trades') return JSON.stringify(data.trades);
    if (key === 'capitalMovements') return JSON.stringify(data.capitalMovements);
    if (key === 'initialCapital') return data.initialCapital !== null ? String(data.initialCapital) : null;
    if (key === 'username') return data.username !== null ? String(data.username) : null;
    if (key === 'capitalStartDate') return data.capitalStartDate;
    if (key === STRATEGY_STORAGE_KEY) return JSON.stringify(data.strategies);
  }
  return originalLocalStorageGetItem(key);
};

localStorage.setItem = function(key, value) {
  if (ACCOUNT_SCOPED_KEYS.has(key)) {
    const accountId = getActiveAccountId();
    const data = readAccountData(accountId);
    if (key === 'trades' || key === 'capitalMovements') {
      try {
        data[key] = value ? JSON.parse(value) : [];
      } catch (error) {
        data[key] = [];
      }
    } else if (key === 'initialCapital') {
      data.initialCapital = value !== null && value !== undefined ? String(value) : null;
    } else if (key === 'username') {
      data.username = value !== null && value !== undefined ? String(value) : null;
    } else if (key === 'capitalStartDate') {
      data.capitalStartDate = value || null;
    } else if (key === STRATEGY_STORAGE_KEY) {
      try {
        data.strategies = normalizeStrategiesList(value ? JSON.parse(value) : []);
      } catch (error) {
        data.strategies = normalizeStrategiesList([]);
      }
    }
    writeAccountData(accountId, data);
    return;
  }
  originalLocalStorageSetItem(key, value);
};

localStorage.removeItem = function(key) {
  if (ACCOUNT_SCOPED_KEYS.has(key)) {
    const accountId = getActiveAccountId();
    const data = readAccountData(accountId);
    if (key === 'trades' || key === 'capitalMovements') {
      data[key] = [];
    } else if (key === 'initialCapital') {
      data.initialCapital = null;
    } else if (key === 'username') {
      data.username = null;
    } else if (key === 'capitalStartDate') {
      data.capitalStartDate = null;
    } else if (key === STRATEGY_STORAGE_KEY) {
      data.strategies = getDefaultStrategyObjects();
    }
    writeAccountData(accountId, data);
    return;
  }
  originalLocalStorageRemoveItem(key);
};

function clearActiveAccountData() {
  const accountId = getActiveAccountId();
  writeAccountData(accountId, {
    trades: [],
    capitalMovements: [],
    initialCapital: null,
    username: null,
    capitalStartDate: null,
    strategies: getDefaultStrategyObjects()
  });
  dispatchStrategiesUpdated(getDefaultStrategyObjects(), { accountId: accountId, reason: 'clear' });
}

function exportActiveAccountData() {
  const snapshot = getActiveAccountSnapshot();
  return {
    account: {
      id: snapshot.accountId,
      nombre: snapshot.accountName
    },
    trades: snapshot.trades,
    capitalMovements: snapshot.capitalMovements,
    initialCapital: snapshot.initialCapital,
    username: snapshot.username,
    capitalStartDate: snapshot.capitalStartDate,
    strategies: snapshot.strategies
  };
}

function importDataToActiveAccount(payload) {
  if (!payload || typeof payload !== 'object') return false;
  const snapshot = {};
  if ('trades' in payload) {
    snapshot.trades = Array.isArray(payload.trades) ? payload.trades : [];
  }
  if ('capitalMovements' in payload) {
    snapshot.capitalMovements = Array.isArray(payload.capitalMovements) ? payload.capitalMovements : [];
  }
  if ('initialCapital' in payload) {
    snapshot.initialCapital = payload.initialCapital !== null && payload.initialCapital !== undefined ? payload.initialCapital : null;
  }
  if ('username' in payload) {
    snapshot.username = payload.username !== null && payload.username !== undefined ? payload.username : null;
  }
  if ('capitalStartDate' in payload) {
    snapshot.capitalStartDate = payload.capitalStartDate || null;
  }
  if ('strategies' in payload) {
    snapshot.strategies = Array.isArray(payload.strategies) ? payload.strategies : [];
  }
  applySnapshotToActiveAccount(snapshot);
  return true;
}

ensureActiveAccount();
document.addEventListener('DOMContentLoaded', function() {
  setupAccountUI();
  setupNavigationMenu();
  ensureStrategyDataInitialized();
  setupStrategyManagementUI();
  populateStrategySelects();
});

function setupNavigationMenu() {
  const navMenu = document.querySelector('.nav-menu');
  const menuOverlay = document.querySelector('.menu-overlay');
  const menuItems = document.querySelectorAll('.menu-items a');
  const menuToggleButton = document.querySelector('.menu-toggle');
  if (!navMenu || !menuOverlay) {
    window.toggleMenu = function() {};
    window.setActiveLink = function() {};
    return;
  }

  let scrollPosition = 0;

  function openMenu() {
    scrollPosition = window.pageYOffset;
    document.body.classList.add('menu-open');
    document.body.style.top = `-${scrollPosition}px`;
    menuOverlay.classList.add('visible');
    navMenu.classList.add('visible');
    if (menuToggleButton) {
      menuToggleButton.classList.add('opened');
    }
  }

  function closeMenu() {
    if (!navMenu.classList.contains('visible')) return;
    navMenu.classList.remove('visible');
    menuOverlay.classList.remove('visible');
    document.body.classList.remove('menu-open');
    document.body.style.top = '';
    window.scrollTo(0, scrollPosition);
    if (menuToggleButton) {
      menuToggleButton.classList.remove('opened');
    }
  }

  window.toggleMenu = function() {
    if (navMenu.classList.contains('visible')) {
      closeMenu();
    } else {
      openMenu();
    }
  };

  if (!menuOverlay.dataset.bound) {
    menuOverlay.addEventListener('click', closeMenu);
    menuOverlay.dataset.bound = 'true';
  }

  menuItems.forEach(link => {
    if (!link.dataset.menuBound) {
      link.addEventListener('click', () => {
        closeMenu();
      });
      link.dataset.menuBound = 'true';
    }
  });

  function setActiveLink() {
    const currentPage = window.location.pathname.split('/').pop() || 'index.html';
    menuItems.forEach(link => {
      const href = link.getAttribute('href');
      if (href === currentPage) {
        link.classList.add('active');
      } else {
        link.classList.remove('active');
      }
    });
  }

  window.setActiveLink = setActiveLink;
  setActiveLink();
}

function showTab(tab) {
  ['entry', 'diary', 'stats'].forEach(t => document.getElementById('tab-' + t).classList.remove('active'));
  ['entry', 'diary', 'stats'].forEach(t => document.getElementById('tab-' + t + '-btn').classList.remove('active'));
  document.getElementById('tab-' + tab).classList.add('active');
  document.getElementById('tab-' + tab + '-btn').classList.add('active');
  if (tab === 'diary') renderDiary();
  if (tab === 'stats') renderStats();
}

function addTrade() {
  const trade = {
    asset: document.getElementById('asset').value,
    resultMxn: document.getElementById('resultMxn').value,
    lots: document.getElementById('lots').value,
    direction: document.getElementById('direction').value,
    openTime: document.getElementById('openTime').value,
    closeTime: document.getElementById('closeTime').value,
    openPrice: document.getElementById('openPrice').value,
    closePrice: document.getElementById('closePrice').value,
    strategy: document.getElementById('strategy').value,
    notes: document.getElementById('notes').value,
    pips: document.getElementById('pips').value,
    resultMetricType: document.getElementById('resultMetricType') ? document.getElementById('resultMetricType').value || 'pips' : 'pips'
  };

  if (!trade.asset || !trade.resultMxn || !trade.lots || !trade.direction || 
      !trade.openTime || !trade.closeTime || !trade.openPrice || !trade.closePrice || !trade.pips) {
    alert('Por favor, completa todos los campos requeridos');
    return;
  }

  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  trades.push(trade);
  localStorage.setItem('trades', JSON.stringify(trades));

  document.getElementById('resultMxn').value = '';
  document.getElementById('lots').value = '';
  document.getElementById('openTime').value = '';
  document.getElementById('closeTime').value = '';
  document.getElementById('openPrice').value = '';
  document.getElementById('closePrice').value = '';
  document.getElementById('notes').value = '';
  document.getElementById('pips').value = '';

  alert('Trade agregado correctamente');
  
  if (typeof loadCardData === 'function') {
    loadCardData();
  }
  if (document.getElementById('diaryContainer')) {
    renderDiary();
  }
  if (document.getElementById('statsContainer')) {
    renderStats();
  }
}

// --- Corregir renderizado de pips en tabla de trades ---
function renderTradesTable() {
  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  const tableContainer = document.getElementById('tableContainer');
  if (trades.length === 0) {
    tableContainer.innerHTML = '<p>No hay trades registrados aún.</p>';
    return;
  }
  let html = '<div style="overflow-x:auto;">';
  html += '<table class="trades-table">';
  html += '<thead><tr>' +
      '<th>Activo</th>' +
      '<th>Dirección</th>' +
      '<th>Lotes</th>' +
      '<th>Resultado (MXN)</th>' +
      '<th>Resultado</th>' +
      '<th>Fecha Apertura</th>' +
      '<th>Fecha Cierre</th>' +
      '<th>Precio Entrada</th>' +
      '<th>Precio Salida</th>' +
      '<th>Estrategia</th>' +
      '<th>Notas</th>' +
      '</tr></thead><tbody>';
  trades.slice().reverse().forEach(trade => {
    const formattedAsset = formatAssetSymbol(trade.asset);
    const isCompra = trade.direction === 'long';
    const direction = isCompra ? 'COMPRA' : 'VENTA';
    const directionClass = isCompra ? 'trade-direction-compra' : 'trade-direction-venta';
    const openDate = new Date(trade.openTime);
    const closeDate = new Date(trade.closeTime);
    const metricType = trade.resultMetricType === 'percent' ? 'percent' : 'pips';
    let metricDisplay = '-';
    if (trade.pips !== undefined && trade.pips !== null && trade.pips !== '') {
      const numericMetric = parseFloat(trade.pips);
      if (!Number.isNaN(numericMetric)) {
        metricDisplay = metricType === 'percent'
          ? `${numericMetric.toFixed(2)}%`
          : `${numericMetric.toFixed(3)} pips`;
      }
    }
    html += `<tr>` +
        `<td>${formattedAsset}</td>` +
        `<td class="${directionClass}">${direction}</td>` +
        `<td>${parseFloat(trade.lots).toFixed(3)}</td>` +
        `<td class="${parseFloat(trade.resultMxn) >= 0 ? 'positive' : 'negative'}">${parseFloat(trade.resultMxn).toFixed(2)}</td>` +
        `<td>${metricDisplay}</td>` +
        `<td>${openDate.toLocaleString('es-ES')}</td>` +
        `<td>${closeDate.toLocaleString('es-ES')}</td>` +
        `<td>${trade.openPrice}</td>` +
        `<td>${trade.closePrice}</td>` +
        `<td>${trade.strategy}</td>` +
        `<td>${trade.notes ? trade.notes : '-'}</td>` +
        `</tr>`;
  });
  html += '</tbody></table></div>';
  tableContainer.innerHTML = html;
}

function formatAssetSymbol(symbol) {
  if (!symbol || typeof symbol !== 'string') return '-';
  const upper = symbol.toUpperCase();
  if (upper.includes('/')) return upper;
  const knownQuotes = ['USDT', 'USDC', 'BUSD', 'BTC', 'ETH', 'USD', 'EUR', 'JPY', 'GBP', 'AUD', 'CAD', 'CHF', 'NZD', 'MXN'];
  for (let i = 0; i < knownQuotes.length; i++) {
    const quote = knownQuotes[i];
    if (upper.endsWith(quote)) {
      const base = upper.slice(0, upper.length - quote.length);
      if (base) return `${base}/${quote}`;
    }
  }
  if (upper.length > 3) {
    const base = upper.slice(0, Math.max(upper.length - 3, 3));
    const quote = upper.slice(base.length);
    if (base && quote) return `${base}/${quote}`;
  }
  return upper;
}

function renderStorageInfo() {
  const storageContainer = document.getElementById('storageContainer');
  if (!storageContainer) return;

  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  const total = trades.length;
  const jsonString = JSON.stringify(trades);
  const storageUsed = jsonString.length * 2;
  const storageUsedKB = (storageUsed / 1024).toFixed(2);
  const storageUsedMB = (storageUsed / (1024 * 1024)).toFixed(4);

  const initialCapital = localStorage.getItem('initialCapital');
  const capitalStorageUsed = initialCapital ? initialCapital.length * 2 : 0;
  const capitalStorageUsedKB = (capitalStorageUsed / 1024).toFixed(2);

  const username = localStorage.getItem('username');
  const usernameStorageUsed = username ? username.length * 2 : 0;
  const usernameStorageUsedKB = (usernameStorageUsed / 1024).toFixed(2);

  const movements = JSON.parse(localStorage.getItem('capitalMovements')) || [];
  const movementsJsonString = JSON.stringify(movements);
  const movementsStorageUsed = movementsJsonString.length * 2;
  const movementsStorageUsedKB = (movementsStorageUsed / 1024).toFixed(2);

  const strategies = ensureStrategyDataInitialized();
  const customStrategies = strategies.filter(item => !item.builtIn);
  const strategiesJsonString = JSON.stringify(strategies);
  const strategiesStorageUsed = strategiesJsonString.length * 2;
  const strategiesStorageUsedKB = (strategiesStorageUsed / 1024).toFixed(2);
  const customStrategiesJsonString = JSON.stringify(customStrategies);
  const customStrategiesStorageUsed = customStrategiesJsonString.length * 2;
  const customStrategiesStorageUsedKB = (customStrategiesStorageUsed / 1024).toFixed(2);
  const customStrategiesCount = customStrategies.length;

  const totalStorageUsedBytes = storageUsed + capitalStorageUsed + usernameStorageUsed + movementsStorageUsed + strategiesStorageUsed;
  const totalStorageUsedKB = (totalStorageUsedBytes / 1024).toFixed(2);
  const totalStorageUsedMB = (totalStorageUsedBytes / (1024 * 1024)).toFixed(4);

  const avgSizePerTrade = total > 0 ? storageUsed / total : 0;
  const remainingSpace5MB = 5 * 1024 * 1024 - totalStorageUsedBytes;
  const remainingSpace10MB = 10 * 1024 * 1024 - totalStorageUsedBytes;
  const remainingTrades5MB = avgSizePerTrade > 0 ? Math.max(Math.floor(remainingSpace5MB / avgSizePerTrade), 0) : 0;
  const remainingTrades10MB = avgSizePerTrade > 0 ? Math.max(Math.floor(remainingSpace10MB / avgSizePerTrade), 0) : 0;

  storageContainer.innerHTML = `
      <div class="storage-info">
          <h3>Uso de Almacenamiento</h3>
          <div class="storage-details">
              <p>Has registrado un total de ${total} trades, lo que supone un uso de memoria de ${storageUsedKB} KB</p>
              ${initialCapital ? `<p>El capital inicial ocupa ${capitalStorageUsedKB} KB de almacenamiento</p>` : ''}
              ${username ? `<p>El nombre de usuario ocupa ${usernameStorageUsedKB} KB de almacenamiento</p>` : ''}
              <p>Tu historial de movimientos ocupa ${movementsStorageUsedKB} KB de almacenamiento</p>
              <p>Las estrategias guardadas ocupan ${strategiesStorageUsedKB} KB de almacenamiento total</p>
              <p>Tus estrategias personalizadas (${customStrategiesCount}) ocupan ${customStrategiesStorageUsedKB} KB</p>
              <p class="storage-limit-info">Uso total estimado: ${totalStorageUsedKB} KB (${totalStorageUsedMB} MB)</p>
              <p class="storage-limit-info">El límite de LocalStorage es aproximadamente 5-10 MB</p>
          </div>
          ${total > 0 && avgSizePerTrade > 0 ? `
              <div class="storage-limit-info">
                  En base a un límite de 5MB y el tamaño promedio del registro (${(avgSizePerTrade / 1024).toFixed(2)} KB por trade), 
                  se estima que esa capacidad te permita registrar un restante de ${remainingTrades5MB.toLocaleString()} trades.
              </div>
              <div class="storage-limit-info">
                  Si el límite fuera de 10MB, podrías registrar aproximadamente ${remainingTrades10MB.toLocaleString()} trades adicionales.
              </div>
              <div class="storage-capacidad-info">
                  <strong>Capacidad a largo plazo:</strong>
                  <ul>
                      <li>Con el límite de 5MB: Podrías registrar aproximadamente ${(remainingTrades5MB / 600).toFixed(1)} años más de operaciones (asumiendo 600 trades por año)</li>
                      <li>Con el límite de 10MB: Podrías registrar aproximadamente ${(remainingTrades10MB / 600).toFixed(1)} años más de operaciones</li>
                  </ul>
              </div>
          ` : `<div class="storage-capacity-info"><strong>No hay suficientes datos de trades para estimar la capacidad futura.</strong></div>`}
      </div>
  `;
}

// Nueva función para eliminar trade por identificadores únicos
function deleteTradeById(openTime, closeTime, asset, resultMxn, lots) {
  if (confirm('¿Estás seguro de que deseas eliminar este trade?')) {
    let trades = JSON.parse(localStorage.getItem('trades')) || [];
    // Buscar el trade que coincida exactamente con todos los datos clave
    const index = trades.findIndex(t => t.openTime === openTime && t.closeTime === closeTime && t.asset === asset && t.resultMxn === resultMxn && t.lots === lots);
    if (index !== -1) {
      trades.splice(index, 1);
      localStorage.setItem('trades', JSON.stringify(trades));
      renderDiary();
      if (document.getElementById('statsContainer')) renderStats();
      if (typeof loadCardData === 'function') loadCardData();
    } else {
      alert('No se pudo encontrar el trade para eliminar.');
    }
  }
}

function showTradeDetails(trade) {
  // Si ya existe un modal, eliminarlo primero
  const oldModal = document.getElementById('trade-details-modal');
  if (oldModal) oldModal.remove();

  // Formatear datos
  const formattedAsset = formatAssetSymbol(trade.asset);
  const isCompra = trade.direction === 'long';
  const direction = isCompra ? 'COMPRA' : 'VENTA';
  const directionClass = isCompra ? 'trade-direction-compra' : 'trade-direction-venta';
  const closeDate = new Date(trade.closeTime);
  const closeDateStr = closeDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
  const closeTimeStr = closeDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
  const openDate = new Date(trade.openTime);
  const openDateStr = openDate.toLocaleDateString('es-ES', { year: 'numeric', month: 'long', day: 'numeric' });
  const openTimeStr = openDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

  const metricType = trade.resultMetricType === 'percent' ? 'percent' : 'pips';
  let metricDisplay = '-';
  if (trade.pips !== undefined && trade.pips !== null && trade.pips !== '') {
    const numericMetric = parseFloat(trade.pips);
    if (!Number.isNaN(numericMetric)) {
      metricDisplay = metricType === 'percent'
        ? `${numericMetric.toFixed(2)}%`
        : `${numericMetric.toFixed(3)} pips`;
    }
  }

  // Crear modal
  const modal = document.createElement('div');
  modal.id = 'trade-details-modal';
  modal.className = 'trade-details-modal-bg';
  modal.innerHTML = `
    <div class="trade-details-modal-card">
      <button class="trade-details-close" title="Cerrar">&times;</button>
      <h2>Detalles de la Operación</h2>
      <div class="trade-details-list">
        <div><strong>Activo:</strong> <span>${formattedAsset}</span></div>
        <div><strong>Dirección:</strong> <span class="${directionClass}">${direction}</span></div>
        <div><strong>Lotes:</strong> <span>${parseFloat(trade.lots).toFixed(3)}</span></div>
        <div><strong>Resultado:</strong> <span class="${parseFloat(trade.resultMxn) >= 0 ? 'positive' : 'negative'}">${parseFloat(trade.resultMxn) >= 0 ? '+' : ''}${parseFloat(trade.resultMxn).toFixed(2)} MXN</span></div>
        <div><strong>Resultado:</strong> <span>${metricDisplay}</span></div>
        <div><strong>Fecha de Apertura:</strong> <span>${openDateStr} | ${openTimeStr}</span></div>
        <div><strong>Fecha de Cierre:</strong> <span>${closeDateStr} | ${closeTimeStr}</span></div>
        <div><strong>Precio de Entrada:</strong> <span>${trade.openPrice}</span></div>
        <div><strong>Precio de Salida:</strong> <span>${trade.closePrice}</span></div>
        <div><strong>Estrategia:</strong> <span>${trade.strategy}</span></div>
        <div style='align-items: flex-start;'><strong>Notas:</strong> <span class='trade-details-list-notes'>${trade.notes ? trade.notes : '-'}</span></div>
      </div>
    </div>
  `;

  // Evento de cierre
  modal.querySelector('.trade-details-close').onclick = function() {
    modal.remove();
  };

  document.body.appendChild(modal);
}

function deleteTrade(index) {
  if (confirm('¿Estás seguro de que deseas eliminar este trade?')) {
    const trades = JSON.parse(localStorage.getItem('trades')) || [];
    trades.splice(index, 1);
    localStorage.setItem('trades', JSON.stringify(trades));
    
    // Actualizar la vista
    renderDiary();
    
    // Actualizar otras vistas si existen
    if (document.getElementById('statsContainer')) {
      renderStats();
    }
    if (typeof loadCardData === 'function') {
      loadCardData();
    }
  }
}

function getTradeEffectiveDate(trade) {
  if (!trade) return null;
  const rawDate = trade.closeTime || trade.openTime;
  if (!rawDate) return null;
  const date = new Date(rawDate);
  return Number.isNaN(date.getTime()) ? null : date;
}

function calculateCapitalEvolutionData() {
  const initialCapitalRaw = localStorage.getItem('initialCapital');
  if (initialCapitalRaw === null || initialCapitalRaw === '') {
    return { labels: [], values: [], pnl: null, roi: null, baseCapital: null, finalCapital: null };
  }

  const initialCapital = parseFloat(initialCapitalRaw);
  if (!Number.isFinite(initialCapital)) {
    return { labels: [], values: [], pnl: null, roi: null, baseCapital: null, finalCapital: null };
  }

  const capitalStartDateRaw = localStorage.getItem('capitalStartDate');
  let capitalStartDate = capitalStartDateRaw ? new Date(capitalStartDateRaw) : null;
  if (capitalStartDate && Number.isNaN(capitalStartDate.getTime())) {
    capitalStartDate = null;
  }

  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  const movements = JSON.parse(localStorage.getItem('capitalMovements')) || [];

  const tradesData = trades
    .map(trade => {
      const date = getTradeEffectiveDate(trade);
      if (!date) return null;
      const value = parseFloat(trade.resultMxn);
      if (!Number.isFinite(value)) return null;
      return { date, value };
    })
    .filter(Boolean);

  const movementsData = movements
    .map(movement => {
      if (!movement) return null;
      const date = movement.date ? new Date(movement.date) : null;
      if (!date || Number.isNaN(date.getTime())) return null;
      const rawAmount = parseFloat(movement.amount);
      if (!Number.isFinite(rawAmount)) return null;
      const value = movement.type === 'retiro' ? -Math.abs(rawAmount) : Math.abs(rawAmount);
      return { date, value };
    })
    .filter(Boolean);

  const now = new Date();
  const currentYear = now.getFullYear();
  const monthlyNet = new Array(12).fill(0);
  let contributionsBeforeYear = 0;
  const baselineDate = capitalStartDate || null;
  const isFirstYear = !baselineDate || (now.getTime() - baselineDate.getTime() < MS_PER_YEAR);

  tradesData.forEach(item => {
    if (baselineDate && item.date < baselineDate) return;
    const year = item.date.getFullYear();
    if (year < currentYear) {
      contributionsBeforeYear += item.value;
    } else if (year === currentYear) {
      monthlyNet[item.date.getMonth()] += item.value;
    }
  });

  movementsData.forEach(item => {
    if (baselineDate && item.date < baselineDate) return;
    const year = item.date.getFullYear();
    if (year < currentYear) {
      contributionsBeforeYear += item.value;
    } else if (year === currentYear) {
      monthlyNet[item.date.getMonth()] += item.value;
    }
  });

  let runningCapital = initialCapital;
  if (!isFirstYear) {
    runningCapital += contributionsBeforeYear;
  }
  const baseCapital = Number(runningCapital.toFixed(2));

  const labels = [];
  const values = [];

  for (let month = 0; month < 12; month++) {
    const monthStart = new Date(currentYear, month, 1);
    if (monthStart > now) break;
    runningCapital += monthlyNet[month];
    labels.push(`${CAPITAL_MONTH_NAMES_ES[month]} ${currentYear}`);
    values.push(Number(runningCapital.toFixed(2)));
  }

  if (!labels.length) {
    const month = now.getMonth();
    labels.push(`${CAPITAL_MONTH_NAMES_ES[month]} ${currentYear}`);
    values.push(Number(runningCapital.toFixed(2)));
  }

  const finalCapital = values.length ? values[values.length - 1] : Number(runningCapital.toFixed(2));
  const pnl = Number((finalCapital - baseCapital).toFixed(2));
  const roi = baseCapital !== 0 ? Number(((pnl / baseCapital) * 100).toFixed(2)) : null;

  return { labels, values, pnl, roi, baseCapital, finalCapital };
}

function renderCapitalEvolutionChart() {
  const canvas = document.getElementById('capitalEvolutionChart');
  const emptyState = document.getElementById('capitalEvolutionEmptyState');
  const pnlElement = document.getElementById('capitalEvolutionPnl');
  const roiElement = document.getElementById('capitalEvolutionRoi');
  if (!canvas || typeof Chart === 'undefined') {
    if (pnlElement) pnlElement.textContent = '-';
    if (roiElement) roiElement.textContent = '-';
    return;
  }

  const { labels, values, pnl, roi, baseCapital } = calculateCapitalEvolutionData();
  const hasSeries = labels.length && values.length;

  if (!hasSeries) {
    if (capitalEvolutionChartInstance) {
      capitalEvolutionChartInstance.destroy();
      capitalEvolutionChartInstance = null;
    }
    if (emptyState) emptyState.style.display = 'block';
    canvas.style.display = 'none';
    if (pnlElement) {
      pnlElement.textContent = '-';
      pnlElement.style.color = '';
    }
    if (roiElement) {
      roiElement.textContent = '-';
      roiElement.style.color = '';
    }
    return;
  }

  canvas.style.display = 'block';
  if (emptyState) emptyState.style.display = 'none';

  if (pnlElement) {
    const formattedPnl = pnl >= 0 ? `+$${Math.abs(pnl).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}` : `-$${Math.abs(pnl).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
    pnlElement.textContent = formattedPnl;
    pnlElement.style.color = pnl >= 0 ? '#16a085' : '#e74c3c';
  }

  if (roiElement) {
    if (roi === null || baseCapital === 0) {
      roiElement.textContent = 'N/A';
      roiElement.style.color = '';
    } else {
      const formattedRoi = `${roi >= 0 ? '+' : ''}${roi.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
      roiElement.textContent = formattedRoi;
      roiElement.style.color = roi >= 0 ? '#16a085' : '#e74c3c';
    }
  }

  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  let suggestedMin = minValue;
  let suggestedMax = maxValue;
  if (minValue === maxValue) {
    const padding = minValue === 0 ? 100 : Math.abs(minValue) * 0.05;
    suggestedMin = minValue - padding;
    suggestedMax = maxValue + padding;
  }

  const datasetConfig = {
    label: 'Capital acumulado',
    data: values,
    fill: true,
    borderColor: '#1abc9c',
    backgroundColor: 'rgba(26, 188, 156, 0.15)',
    borderWidth: 2,
    tension: 0.25,
    pointRadius: 3,
    pointBackgroundColor: '#16a085',
    pointBorderColor: '#16a085',
    pointHoverRadius: 4
  };

  if (capitalEvolutionChartInstance) {
    capitalEvolutionChartInstance.data.labels = labels;
    const dataset = capitalEvolutionChartInstance.data.datasets[0];
    dataset.label = datasetConfig.label;
    dataset.data = datasetConfig.data;
    dataset.fill = datasetConfig.fill;
    dataset.borderColor = datasetConfig.borderColor;
    dataset.backgroundColor = datasetConfig.backgroundColor;
    dataset.borderWidth = datasetConfig.borderWidth;
    dataset.tension = datasetConfig.tension;
    dataset.pointRadius = datasetConfig.pointRadius;
    dataset.pointBackgroundColor = datasetConfig.pointBackgroundColor;
    dataset.pointBorderColor = datasetConfig.pointBorderColor;
    dataset.pointHoverRadius = datasetConfig.pointHoverRadius;
    capitalEvolutionChartInstance.options.scales.y.suggestedMin = suggestedMin;
    capitalEvolutionChartInstance.options.scales.y.suggestedMax = suggestedMax;
    capitalEvolutionChartInstance.update();
    return;
  }

  capitalEvolutionChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [datasetConfig]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: 'Meses' },
          ticks: {
            autoSkip: false,
            maxRotation: 0,
            minRotation: 0
          }
        },
        y: {
          title: { display: true, text: 'Capital acumulado (MXN)' },
          suggestedMin,
          suggestedMax,
          ticks: {
            callback: function(value) {
              return `$${Number(value).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function(context) {
              const value = context.parsed.y ?? 0;
              return `Capital: $${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
          }
        }
      }
    }
  });
}

function renderStats() {
  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  const total = trades.length;
  const winningTrades = trades.filter(t => parseFloat(t.resultMxn) > 0).length;
  const losingTrades = trades.filter(t => parseFloat(t.resultMxn) < 0).length;
  const gains = trades.filter(t => parseFloat(t.resultMxn) > 0).reduce((sum, t) => sum + parseFloat(t.resultMxn), 0);
  const lossesArray = trades.filter(t => parseFloat(t.resultMxn) < 0).map(t => parseFloat(t.resultMxn));
  const losses = lossesArray.reduce((sum, val) => sum + val, 0);
  const pnl = gains + losses;
  const winRate = total ? (winningTrades / total * 100).toFixed(2) : '0.00';
  const best = total ? Math.max(...trades.map(t => parseFloat(t.resultMxn))) : 0;
  const worst = lossesArray.length ? Math.min(...lossesArray) : 0;
  const avgWin = winningTrades ? (gains / winningTrades).toFixed(2) : 0;
  const avgLoss = losingTrades ? (losses / losingTrades).toFixed(2) : 0;
  const profitFactor = Math.abs(losses) ? (gains / Math.abs(losses)).toFixed(2) : 0;

  // Calcular operaciones Break Even
  const breakevenTrades = trades.filter(t => parseFloat(t.resultMxn) === 0).length;

  // Cálculos de estrategias
  const strategyStats = {};
  trades.forEach(trade => {
    const strategy = trade.strategy || 'Sin estrategia';
    if (!strategyStats[strategy]) {
      strategyStats[strategy] = {
        total: 0,
        wins: 0,
        pnl: 0
      };
    }
    strategyStats[strategy].total++;
    strategyStats[strategy].pnl += parseFloat(trade.resultMxn);
    if (parseFloat(trade.resultMxn) > 0) {
      strategyStats[strategy].wins++;
    }
  });

  // Encontrar estrategia más rentable
  let mostProfitable = { name: 'N/A', pnl: 0 };
  Object.entries(strategyStats).forEach(([strategy, stats]) => {
    if (stats.pnl > mostProfitable.pnl) {
      mostProfitable = { name: strategy, pnl: stats.pnl };
    }
  });

  // Encontrar estrategia más operada
  let mostUsed = { name: 'N/A', total: 0 };
  Object.entries(strategyStats).forEach(([strategy, stats]) => {
    if (stats.total > mostUsed.total) {
      mostUsed = { name: strategy, total: stats.total };
    }
  });

  // Encontrar estrategia más fiable
  let mostReliable = { name: 'N/A', winRate: 0 };
  Object.entries(strategyStats).forEach(([strategy, stats]) => {
    const winRate = (stats.wins / stats.total) * 100;
    if (winRate > mostReliable.winRate) {
      mostReliable = { name: strategy, winRate: winRate };
    }
  });

  // Actualizar estadísticas generales
  const totalTradesElement = document.getElementById('totalTrades');
  const winningTradesElement = document.getElementById('winningTrades');
  const losingTradesElement = document.getElementById('losingTrades');
  const winRateElement = document.getElementById('winRate');
  const totalProfitElement = document.getElementById('totalProfit');
  const maxDrawdownElement = document.getElementById('maxDrawdown');
  const profitRiskRatioElement = document.getElementById('profitRiskRatio');
  const breakevenTradesElement = document.getElementById('breakevenTrades');

  if (totalTradesElement) totalTradesElement.textContent = total;
  if (winningTradesElement) winningTradesElement.textContent = winningTrades;
  if (losingTradesElement) losingTradesElement.textContent = losingTrades;
  if (breakevenTradesElement) breakevenTradesElement.textContent = breakevenTrades;
  if (winRateElement) {
    winRateElement.textContent = `${winRate}%`;
    if (parseFloat(winRate) >= 80) {
      winRateElement.className = 'stat-value winrate-excellent';
    } else if (parseFloat(winRate) >= 51) {
      winRateElement.className = 'stat-value winrate-good';
    } else if (parseFloat(winRate) >= 30) {
      winRateElement.className = 'stat-value winrate-poor';
    } else {
      winRateElement.className = 'stat-value winrate-bad';
    }
  }

  // Actualizar estadísticas de rendimiento
  if (totalProfitElement) {
    totalProfitElement.textContent = `${pnl.toFixed(2)} MXN`;
    totalProfitElement.className = `stat-value ${pnl >= 0 ? 'positive' : 'negative'}`;
  }
  if (maxDrawdownElement) {
    maxDrawdownElement.textContent = `${worst.toFixed(2)} MXN`;
    maxDrawdownElement.className = `stat-value ${worst >= 0 ? 'positive' : 'negative'}`;
  }
  if (profitRiskRatioElement) {
    profitRiskRatioElement.textContent = profitFactor;
    profitRiskRatioElement.className = `stat-value ${profitFactor >= 1 ? 'positive' : 'negative'}`;
  }

  // Actualizar estadísticas de estrategias
  const mostProfitableElement = document.getElementById('mostProfitableStrategy');
  const mostUsedElement = document.getElementById('mostUsedStrategy');
  const mostReliableElement = document.getElementById('mostReliableStrategy');

  if (mostProfitableElement) {
    mostProfitableElement.textContent = `${mostProfitable.name} (${mostProfitable.pnl.toFixed(2)} MXN)`;
    mostProfitableElement.className = `stat-value ${mostProfitable.pnl >= 0 ? 'positive' : 'negative'}`;
  }
  if (mostUsedElement) {
    mostUsedElement.textContent = `${mostUsed.name} (${mostUsed.total} ops)`;
  }
  if (mostReliableElement) {
    mostReliableElement.textContent = `${mostReliable.name} (${mostReliable.winRate.toFixed(1)}%)`;
    if (mostReliable.winRate >= 80) {
      mostReliableElement.className = 'stat-value winrate-excellent';
    } else if (mostReliable.winRate >= 51) {
      mostReliableElement.className = 'stat-value winrate-good';
    } else if (mostReliable.winRate >= 30) {
      mostReliableElement.className = 'stat-value winrate-poor';
    } else {
      mostReliableElement.className = 'stat-value winrate-bad';
    }
  }

  // Cálculo de PNL Pips y Promedio Pips por Trade
  const tradesWithPips = trades.filter(t => t.pips !== undefined && t.pips !== null && t.pips !== '' && t.resultMetricType !== 'percent');
  const totalPips = tradesWithPips.reduce((sum, t) => sum + parseFloat(t.pips), 0);
  const avgPips = tradesWithPips.length ? (totalPips / tradesWithPips.length) : 0;

  // Actualizar tarjetas de pips
  const totalPipsElement = document.getElementById('totalPips');
  const avgPipsElement = document.getElementById('avgPips');
  if (totalPipsElement) totalPipsElement.textContent = `${totalPips.toFixed(3)} pips`;
  if (avgPipsElement) avgPipsElement.textContent = `${avgPips.toFixed(3)} pips`;

  // Cálculo de Max. Ganancia (MXN) y Promedio Ganancia (MXN)
  const tradesWithMxn = trades.filter(t => t.resultMxn !== undefined && t.resultMxn !== null && t.resultMxn !== '');
  const maxProfit = tradesWithMxn.length ? Math.max(...tradesWithMxn.map(t => parseFloat(t.resultMxn))) : 0;
  const avgProfit = tradesWithMxn.length ? (tradesWithMxn.reduce((sum, t) => sum + parseFloat(t.resultMxn), 0) / tradesWithMxn.length) : 0;

  // Actualizar tarjetas de ganancias monetarias
  const maxProfitElement = document.getElementById('maxProfit');
  const avgProfitElement = document.getElementById('avgProfit');
  if (maxProfitElement) maxProfitElement.textContent = `$${maxProfit.toFixed(2)}`;
  if (avgProfitElement) avgProfitElement.textContent = `$${avgProfit.toFixed(2)}`;

  renderCapitalEvolutionChart();

  // === Cálculo de Holding Promedio ===
  const tradesWithTimes = trades.filter(t => t.openTime && t.closeTime);
  let avgHoldingMs = 0;
  if (tradesWithTimes.length > 0) {
    const totalHoldingMs = tradesWithTimes.reduce((sum, t) => {
      const open = new Date(t.openTime);
      const close = new Date(t.closeTime);
      return sum + (close - open);
    }, 0);
    avgHoldingMs = totalHoldingMs / tradesWithTimes.length;
  }
  // Convertir a formato legible (horas, minutos)
  function formatDuration(ms) {
    if (!ms || ms <= 0) return '-';
    const totalSeconds = Math.floor(ms / 1000);
    const hours = Math.floor(totalSeconds / 3600);
    const minutes = Math.floor((totalSeconds % 3600) / 60);
    if (hours > 0) {
      return `${hours}h ${minutes}min`;
    } else {
      return `${minutes}min`;
    }
  }
  const avgHoldingElement = document.getElementById('avgHolding');
  if (avgHoldingElement) avgHoldingElement.textContent = formatDuration(avgHoldingMs);

  // === Cálculo de Horario Favorito (franjas de 4 horas) ===
  const hourRanges = [
    { label: '00:00-03:59', start: 0, end: 3 },
    { label: '04:00-07:59', start: 4, end: 7 },
    { label: '08:00-11:59', start: 8, end: 11 },
    { label: '12:00-15:59', start: 12, end: 15 },
    { label: '16:00-19:59', start: 16, end: 19 },
    { label: '20:00-23:59', start: 20, end: 23 }
  ];
  const hourCounts = Array(hourRanges.length).fill(0);
  tradesWithTimes.forEach(t => {
    const open = new Date(t.openTime);
    const hour = open.getHours();
    for (let i = 0; i < hourRanges.length; i++) {
      if (hour >= hourRanges[i].start && hour <= hourRanges[i].end) {
        hourCounts[i]++;
        break;
      }
    }
  });
  let maxCount = Math.max(...hourCounts);
  let favoriteRange = '-';
  if (maxCount > 0) {
    const idx = hourCounts.indexOf(maxCount);
    favoriteRange = hourRanges[idx].label + ` (${maxCount} ops)`;
  }
  const favoriteHourElement = document.getElementById('favoriteHour');
  if (favoriteHourElement) favoriteHourElement.textContent = favoriteRange;

  // === Cálculo de Calificación de Rendimiento ===
  let performanceScore = 0;
  const maxPossibleScore = 6; // Aumentar a 6 criterios

  // Calcular valores individuales de los criterios
  const winRateValue = total ? (winningTrades / total * 100).toFixed(2) : '0.00';
  const pnlValue = pnl.toFixed(2);
  const drawdownValue = worst.toFixed(2); // 'worst' ya es el drawdown máximo (más negativo)
  const profitFactorValue = profitFactor;
  const avgPipsValue = avgPips.toFixed(3);
  const avgProfitValue = avgProfit.toFixed(2); // Obtener el valor del promedio de ganancia (ya calculado previamente)

  // Determinar si cada criterio suma un punto y actualizar los elementos HTML

  // Criterio 1: Win Rate
  const newWinRateThreshold = 60; // New threshold
  const winRateMet = parseFloat(winRateValue) >= newWinRateThreshold;
  if (winRateMet) { performanceScore += 1; }
  const winRateCriterionValueElement = document.querySelector('#criterion-winrate .criterion-value');
  const winRateCriterionScoreElement = document.querySelector('#criterion-winrate .criterion-score');

  if (winRateCriterionValueElement) winRateCriterionValueElement.textContent = `${winRateValue}%`;
  if (winRateCriterionScoreElement) {
      winRateCriterionScoreElement.textContent = winRateMet ? '✓' : '✗';
      winRateCriterionScoreElement.className = `criterion-score ${winRateMet ? 'scored' : 'not-scored'}`;
  }

  // Criterio 2: PNL Final
  const pnlMet = pnl > 0;
  if (pnlMet) { performanceScore += 1; }
  const pnlElement = document.querySelector('#criterion-pnl .criterion-value');
  const pnlScoreElement = document.querySelector('#criterion-pnl .criterion-score');
  if (pnlElement) pnlElement.textContent = `${pnlValue} MXN`;
  if (pnlScoreElement) {
      pnlScoreElement.textContent = pnlMet ? '✓' : '✗';
      pnlScoreElement.className = `criterion-score ${pnlMet ? 'scored' : 'not-scored'}`;
  }

  // Criterio 3: Drawdown Máximo
  const newProfitFactorThreshold = 150.00; // New threshold (assuming this is the factor value)
  const profitFactorMet = parseFloat(profitFactorValue) >= newProfitFactorThreshold;
  if (profitFactorMet) { performanceScore += 1; }
  const ratioElement = document.querySelector('#criterion-ratio .criterion-value');
  const ratioScoreElement = document.querySelector('#criterion-ratio .criterion-score');
  if (ratioElement) ratioElement.textContent = profitFactorValue;
  if (ratioScoreElement) {
      ratioScoreElement.textContent = profitFactorMet ? '✓' : '✗';
      ratioScoreElement.className = `criterion-score ${profitFactorMet ? 'scored' : 'not-scored'}`;
  }

  // Criterio 4: Promedio Pips por Trade
  const newAvgPipsThreshold = 5; // New threshold
  const avgPipsMet = avgPips > newAvgPipsThreshold;
  if (avgPipsMet) { performanceScore += 1; }
  const avgPipsCriterionValueElement = document.querySelector('#criterion-avgpips .criterion-value');
  const avgPipsCriterionScoreElement = document.querySelector('#criterion-avgpips .criterion-score');

  if (avgPipsCriterionValueElement) avgPipsCriterionValueElement.textContent = `${avgPipsValue} pips`;
  if (avgPipsCriterionScoreElement) {
      avgPipsCriterionScoreElement.textContent = avgPipsMet ? '✓' : '✗';
      avgPipsCriterionScoreElement.className = `criterion-score ${avgPipsMet ? 'scored' : 'not-scored'}`;
  }

  // Criterio 5: Promedio Ganancia (MXN)
  const newAvgProfitThreshold = 10; // New threshold (ajustar según necesites)
  const avgProfitMet = parseFloat(avgProfitValue) > newAvgProfitThreshold;
   // Asegurarse de que haya trades ganadores para considerar este criterio
  if (winningTrades > 0 && avgProfitMet) { performanceScore += 1; }
  const avgProfitCriterionValueElement = document.querySelector('#criterion-avgprofit .criterion-value');
  const avgProfitCriterionScoreElement = document.querySelector('#criterion-avgprofit .criterion-score');

  if (avgProfitCriterionValueElement) avgProfitCriterionValueElement.textContent = `${avgProfitValue} MXN`;
   if (avgProfitCriterionScoreElement) {
       // Solo mostrar ✓ o ✗ si hay trades ganadores para evaluar este criterio
       if (winningTrades > 0) {
           avgProfitCriterionScoreElement.textContent = avgProfitMet ? '✓' : '✗';
           avgProfitCriterionScoreElement.className = `criterion-score ${avgProfitMet ? 'scored' : 'not-scored'}`;
       } else {
           avgProfitCriterionScoreElement.textContent = '-'; // No aplicable si no hay ganancias
           avgProfitCriterionScoreElement.className = 'criterion-score'; // Sin color
       }
   }


  // Calcular porcentaje de calificación
  const ratingPercentage = total > 0 ? (performanceScore / maxPossibleScore) * 100 : 0;

  // Determinar descripción de la calificación
  let ratingDescription = 'Sin datos';
   if (total > 0) {
      if (ratingPercentage >= 80) {
          ratingDescription = 'Excelente';
      } else if (ratingPercentage >= 60) {
          ratingDescription = 'Bueno';
      } else if (ratingPercentage >= 40) {
          ratingDescription = 'Regular';
      } else {
          ratingDescription = 'Malo';
      }
   } else {
        ratingDescription = 'Aún no hay trades';
   }


  const ratingSummaryElement = document.getElementById('performanceRatingSummary');
  if (ratingSummaryElement) {
      if (total === 0) {
          ratingSummaryElement.textContent = 'Aún no hay trades para calcular el rendimiento.';
          // Restablecer estilos si no hay datos
          ratingSummaryElement.style.color = '';
          ratingSummaryElement.style.fontWeight = '';
      } else {
           ratingSummaryElement.textContent = `Tu rendimiento general es ${ratingDescription} (${ratingPercentage.toFixed(0)}%)`;

           // Cambiar color basado en el porcentaje
           if (ratingPercentage < 30) {
               ratingSummaryElement.style.color = '#f44336'; // Rojo
               ratingSummaryElement.style.fontWeight = 'bold';
           } else if (ratingPercentage >= 31 && ratingPercentage <= 70) {
               ratingSummaryElement.style.color = '#FF9800'; // Naranja
               ratingSummaryElement.style.fontWeight = 'bold';
           } else if (ratingPercentage >= 71) {
               ratingSummaryElement.style.color = '#4CAF50'; // Verde
               ratingSummaryElement.style.fontWeight = 'bold';
           } else {
               // Color por defecto si no cae en los rangos (aunque teóricamente siempre caerá)
               ratingSummaryElement.style.color = '';
               ratingSummaryElement.style.fontWeight = '';
           }
      }
  }

  // === Actualizar Barra de Progreso ===
  const progressBarFillElement = document.getElementById('performanceProgressBarFill');
  const progressBarMarkerElement = document.getElementById('performanceProgressBarMarker');

  if (progressBarFillElement) {
      // Asegurarse de que el porcentaje esté entre 0 y 100
      const clampedPercentage = Math.max(0, Math.min(100, ratingPercentage));
      progressBarFillElement.style.width = `${clampedPercentage}%`;
  }

  if (progressBarMarkerElement) {
      // Posicionar el marcador. El left es el porcentaje, pero necesitamos ajustarlo un poco si está muy cerca de los bordes
      // Para un marcador centrado, la posición left debería ser el porcentaje.
      // Sin embargo, para que no se salga del borde, podemos limitarlo.
      // Por ejemplo, si es 0%, left debería ser 0%. Si es 100%, left debería ser 100%.
      // Ya que el marcador está centrado horizontalmente con transform: translateX(-50%), left = 50% lo pone al medio.
      // Si left = 0%, el centro del marcador está en el borde izquierdo.
      // Si left = 100%, el centro del marcador está en el borde derecho.
      // Queremos que la punta del marcador (el centro) esté en la posición correcta.
      // El marcador tiene un ancho de 16px (8px left + 8px right borders). Con transform: translateX(-50%), se ajusta.
      // left: 0% pone la punta en 0.
      // left: 100% pone la punta en 100.
      const clampedPercentage = Math.max(0, Math.min(100, ratingPercentage));
      progressBarMarkerElement.style.left = `${clampedPercentage}%`;

      // Opcional: Ajustar un poco la posición si está muy cerca de los bordes para que la flecha no se corte
      // Esto es más complejo y quizás no necesario con translateX(-50%)
      // if (clampedPercentage < 5) { progressBarMarkerElement.style.left = '5%'; }
      // if (clampedPercentage > 95) { progressBarMarkerElement.style.left = '95%'; }
  }

  // === Actualizar criterios de Calificación de Rendimiento ===
  const winrateCriterionValue = document.querySelector('#criterion-winrate .criterion-value');
  const pnlCriterionValue = document.querySelector('#criterion-pnl .criterion-value');
  const drawdownCriterionValue = document.querySelector('#criterion-drawdown .criterion-value');
  const ratioCriterionValue = document.querySelector('#criterion-ratio .criterion-value');
  const avgpipsCriterionValue = document.querySelector('#criterion-avgpips .criterion-value');
  const avgprofitCriterionValue = document.querySelector('#criterion-avgprofit .criterion-value');

  const winrateCriterionScore = document.querySelector('#criterion-winrate .criterion-score');
  const pnlCriterionScore = document.querySelector('#criterion-pnl .criterion-score');
  const drawdownCriterionScore = document.querySelector('#criterion-drawdown .criterion-score');
  const ratioCriterionScore = document.querySelector('#criterion-ratio .criterion-score');
  const avgpipsCriterionScore = document.querySelector('#criterion-avgpips .criterion-score');
  const avgprofitCriterionScore = document.querySelector('#criterion-avgprofit .criterion-score');

  // Actualizar valores de los criterios
  if (winrateCriterionValue) winrateCriterionValue.textContent = `${winRate}%`;
  if (pnlCriterionValue) pnlCriterionValue.textContent = `${pnl.toFixed(2)} MXN`;
  // Actualizar el Drawdown Máximo en la sección de calificación
  if (drawdownCriterionValue) {
    drawdownCriterionValue.textContent = `${worst.toFixed(2)} MXN`;
  }
  if (ratioCriterionValue) ratioCriterionValue.textContent = profitFactor;
  if (avgpipsCriterionValue) avgpipsCriterionValue.textContent = `${avgPips.toFixed(3)} pips`;
  if (avgprofitCriterionValue) avgprofitCriterionValue.textContent = `${avgProfit.toFixed(2)} MXN`;

  // Determinar puntuación para cada criterio
  let totalScore = 0;

  // Win Rate >= 60%
  if (parseFloat(winRate) >= 60) {
    if (winrateCriterionScore) winrateCriterionScore.textContent = '✅';
    totalScore++;
  } else {
    if (winrateCriterionScore) winrateCriterionScore.textContent = '❌';
  }

  // PNL Final > 0
  if (pnl > 0) {
    if (pnlCriterionScore) pnlCriterionScore.textContent = '✅';
    totalScore++;
  } else {
    if (pnlCriterionScore) pnlCriterionScore.textContent = '❌';
  }

  // Drawdown Máximo es 0 O PNL Final > 0 y Drawdown Máximo (valor absoluto) <= Pérdidas Totales (valor absoluto)
  const absWorst = Math.abs(worst);
  const absLosses = Math.abs(losses);
  if (worst === 0 || (pnl > 0 && absWorst <= absLosses)) {
    if (drawdownCriterionScore) drawdownCriterionScore.textContent = '✅';
    totalScore++;
  } else {
    if (drawdownCriterionScore) drawdownCriterionScore.textContent = '❌';
  }

  // Ratio Beneficio/Riesgo >= 1.50 (ajustado basado en la nota)
  if (parseFloat(profitFactor) >= 1.50) {
    if (ratioCriterionScore) ratioCriterionScore.textContent = '✅';
    totalScore++;
  } else {
    if (ratioCriterionScore) ratioCriterionScore.textContent = '❌';
  }

  // Promedio Pips por Trade > 5 pips
  if (avgPips > 5) {
    if (avgpipsCriterionScore) avgpipsCriterionScore.textContent = '✅';
    totalScore++;
  } else {
    if (avgpipsCriterionScore) avgpipsCriterionScore.textContent = '❌';
  }

  // Promedio Ganancia (MXN) > 10 MXN (solo si hay operaciones ganadoras).
  if (winningTrades > 0 && avgProfit > 10) {
    if (avgprofitCriterionScore) avgprofitCriterionScore.textContent = '✅';
    totalScore++;
  } else {
     if (avgprofitCriterionScore) avgprofitCriterionScore.textContent = '❌';
  }

  // Calcular la calificación de rendimiento en base a la puntuación total
  let performanceRating = '';
  if (totalScore === 6) {
    performanceRating = 'Excelente (6/6 criterios cumplidos)';
  } else if (totalScore >= 4) {
    performanceRating = 'Bueno (4-5/6 criterios cumplidos)';
  } else if (totalScore >= 2) {
    performanceRating = 'Regular (2-3/6 criterios cumplidos)';
  } else {
    performanceRating = 'Mejorable (0-1/6 criterios cumplidos)';
  }

  // Actualizar el resumen de la calificación
  const performanceRatingSummaryElement = document.getElementById('performanceRatingSummary');
  if (performanceRatingSummaryElement) {
    performanceRatingSummaryElement.textContent = `Calificación: ${performanceRating}`;
  }

  // Actualizar la barra de progreso de rendimiento
  const performanceProgressBarFill = document.getElementById('performanceProgressBarFill');
  const performanceProgressBarMarker = document.getElementById('performanceProgressBarMarker');
  const percentage = (totalScore / 6) * 100; // Basado en 6 criterios
  if (performanceProgressBarFill) {
    performanceProgressBarFill.style.width = `${percentage}%`;
    performanceProgressBarFill.style.backgroundColor = percentage >= 80 ? '#4CAF50' : percentage >= 50 ? '#ffeb3b' : '#f44336';
  }
  if (performanceProgressBarMarker) {
    performanceProgressBarMarker.style.left = `${percentage}%`;
  }
}

function saveData() {
  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  localStorage.setItem('trades', JSON.stringify(trades));
  alert('Datos guardados correctamente');
}

function clearData() {
  if (confirm('¿Estás seguro de que deseas eliminar todos los datos?')) {
    localStorage.removeItem('trades');
    alert('Datos eliminados correctamente');
    location.reload();
  }
}

document.addEventListener('DOMContentLoaded', function() {
  if (document.getElementById('diaryContainer')) {
    renderDiary();
  }
  
  if (document.getElementById('statsContainer')) {
    renderStats();
  }

  // Añadir funcionalidad a los desplegables
  const collapsibleHeaders = document.querySelectorAll('.collapsible-header');

  collapsibleHeaders.forEach(header => {
    header.addEventListener('click', function() {
      this.classList.toggle('active');
      const content = this.nextElementSibling;
      if (content.classList.contains('active')) {
        content.classList.remove('active');
      } else {
        content.classList.add('active');
      }
    });
  });

  // Tu código para cargar datos y otras funciones aquí...
  loadCardData(); // Asegúrate de que esta llamada esté aquí si carga datos necesarios
  setActiveLink(); // Asegúrate de que esta llamada esté aquí si marca enlaces activos
  // ... otras llamadas a funciones de inicialización si las tienes
});

// === EVOLUCIÓN DE CAPITAL Y SALDO ACTUAL ===

// Instancias de los 3 gráficos
let capitalChartInstances = {
    monthly: null,
    yearly: null,
    all: null
};

function getCapitalHistory(period) {
    let initialCapital = parseFloat(localStorage.getItem('initialCapital') || '0');
    let trades = JSON.parse(localStorage.getItem('trades')) || [];
    // Buscar la fecha más antigua entre el saldo inicial y el trade más antiguo
    let firstTradeDate = trades.length > 0 ? new Date(Math.min(...trades.map(t => new Date(t.openTime).getTime()))) : new Date();
    let capitalStartDate = localStorage.getItem('capitalStartDate');
    let startDate;
    const today = new Date();
    switch(period) {
        case 'monthly':
            startDate = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
        case 'yearly':
            startDate = new Date(today.getFullYear(), 0, 1);
            break;
        case 'all':
        default:
            // Usar la fecha más antigua entre el saldo inicial y el primer trade
            if (capitalStartDate) {
                let capDate = new Date(capitalStartDate);
                startDate = capDate < firstTradeDate ? capDate : firstTradeDate;
            } else {
                startDate = firstTradeDate;
            }
    }
    // Incluir todos los trades desde la fecha de inicio
    const tradesAfterStart = trades
        .filter(trade => new Date(trade.openTime) >= startDate)
        .sort((a, b) => new Date(a.openTime) - new Date(b.openTime));
    let capitalHistory = [{ date: startDate, value: initialCapital }];
    let currentCapital = initialCapital;
    tradesAfterStart.forEach(trade => {
        currentCapital += parseFloat(trade.resultMxn);
        capitalHistory.push({ date: new Date(trade.openTime), value: currentCapital });
    });
    return capitalHistory;
}

function renderCapitalChart(period) {
    const canvasId = 'capitalChart-' + period;
    const ctx = document.getElementById(canvasId).getContext('2d');
    const capitalHistory = getCapitalHistory(period);
    if (capitalChartInstances[period]) {
        capitalChartInstances[period].destroy();
    }
    capitalChartInstances[period] = new Chart(ctx, {
        type: 'line',
        data: {
            labels: capitalHistory.map(p => p.date.toLocaleDateString('es-ES', { year: '2-digit', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })),
            datasets: [{
                label: 'Evolución del Capital',
                data: capitalHistory.map(p => p.value),
                borderColor: '#1de9b6',
                backgroundColor: 'rgba(29,233,182,0.08)',
                tension: 0.3,
                pointRadius: 2,
                fill: true,
                borderWidth: 2
            }]
        },
        options: {
            plugins: { legend: { display: false } },
            scales: { x: { display: false }, y: { display: true, beginAtZero: false } }
        }
    });
}

function showCapitalChart(period) {
    // Oculta todos los canvas y muestra solo el seleccionado
    document.querySelectorAll('.capitalChartCanvas').forEach(c => c.style.display = 'none');
    document.getElementById('capitalChart-' + period).style.display = 'block';
}

function updateCapitalHeader(period) {
    const username = localStorage.getItem('username') || 'Usuario';
    const welcomeMessage = document.getElementById('welcome-message');
    if (welcomeMessage) welcomeMessage.textContent = `Hola, ${username}`;

    let initialCapital = parseFloat(localStorage.getItem('initialCapital') || '0');
    let trades = JSON.parse(localStorage.getItem('trades')) || [];
    if (trades.length === 0) {
        // Sin trades, mostrar solo el saldo inicial
        const balanceElement = document.getElementById('capital-balance');
        const roiElement = document.getElementById('capital-roi');
         if (balanceElement) {
             balanceElement.textContent = `$${initialCapital.toFixed(2)}`;
             balanceElement.style.color = initialCapital >= 0 ? '#2ecc71' : '#e74c3c';
             balanceElement.style.fontWeight = 'bold';
             balanceElement.style.fontSize = '2.2em';
             balanceElement.style.display = 'none'; // Ocultar Saldo Actual
         }
         if (roiElement) {
             roiElement.textContent = `PNL del período: $0.00`; // Mostrar PNL 0 si no hay trades
             roiElement.style.color = '#00b894';
             roiElement.style.fontWeight = 'bold';
         }
        return;
    }

    // Ordenar trades por fecha de apertura
    trades = trades.slice().sort((a, b) => new Date(a.openTime) - new Date(b.openTime));

    // Agrupar trades por periodo
    function getPeriodKey(date, period) {
        const d = new Date(date);
        if (period === 'monthly') {
            return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
        } else if (period === 'yearly') {
            return `${d.getFullYear()}`;
        } else if (period === 'weekly') {
            // Semana ISO: lunes como primer día
            const temp = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
            const dayNum = temp.getUTCDay() || 7;
            temp.setUTCDate(temp.getUTCDate() + 4 - dayNum);
            const yearStart = new Date(Date.UTC(temp.getUTCFullYear(),0,1));
            const weekNum = Math.ceil((((temp - yearStart) / 86400000) + 1)/7);
            return `${temp.getUTCFullYear()}-W${String(weekNum).padStart(2, '0')}`;
        }
        return 'all';
    }

    // Agrupar trades por periodo
    const periods = {};
    trades.forEach(trade => {
        const key = getPeriodKey(trade.openTime, period);
        if (!periods[key]) periods[key] = [];
        periods[key].push(trade);
    });
    const periodKeys = Object.keys(periods).sort();

    // Calcular balances acumulativos por periodo
    let balances = [];
    let lastBalance = initialCapital;
    periodKeys.forEach((key, idx) => {
        const pnl = periods[key].reduce((sum, t) => sum + parseFloat(t.resultMxn), 0);
        const balance = lastBalance + pnl;
        balances.push({ key, pnl, balance });
        lastBalance = balance;
    });

    // Determinar el periodo actual
    const now = new Date();
    const currentKey = getPeriodKey(now, period);
    let currentIdx = periodKeys.indexOf(currentKey);

    let balance, ganancia;
    if (currentIdx === -1) {
        // No hay trades en el periodo actual
        balance = balances.length > 0 ? balances[balances.length - 1].balance : initialCapital;
        ganancia = 0;
    } else {
        const current = balances[currentIdx];
        balance = current.balance;
        ganancia = current.pnl;
    }

    // Mostrar datos
    const balanceElement = document.getElementById('capital-balance');
    const roiElement = document.getElementById('capital-roi');
    if (balanceElement) {
        balanceElement.textContent = `$${balance.toFixed(2)}`;
        balanceElement.style.color = balance >= initialCapital ? '#2ecc71' : '#e74c3c';
        balanceElement.style.fontWeight = 'bold';
        balanceElement.style.fontSize = '2.2em';
        balanceElement.style.display = 'none'; // Ocultar Saldo Actual
    }
    if (roiElement) {
        roiElement.textContent = `PNL del período: ${ganancia >= 0 ? '+' : ''}$${ganancia.toFixed(2)}`; // Añadir etiqueta y mostrar solo la ganancia/pérdida
        roiElement.style.color = ganancia >= 0 ? '#00b894' : '#e74c3c'; // Mantener el color basado en la ganancia/pérdida
        roiElement.style.fontWeight = 'bold';
    }
}

document.addEventListener('DOMContentLoaded', function() {
    const periodButtons = Array.from(document.querySelectorAll('.period-filter'));
    const activeClasses = ['active', 'text-orange-600', 'dark:text-orange-400', 'border-orange-600'];
    const inactiveClasses = ['text-gray-500', 'dark:text-gray-400', 'border-transparent'];

    function setActivePeriodButton(button) {
        periodButtons.forEach(btn => {
            btn.classList.remove(...activeClasses);
            inactiveClasses.forEach(cls => {
                if (!btn.classList.contains(cls)) {
                    btn.classList.add(cls);
                }
            });
        });
        if (button) {
            button.classList.remove(...inactiveClasses);
            button.classList.add(...activeClasses);
        }
    }

    updateCapitalHeader('monthly');
    const defaultButton = periodButtons.find(btn => btn.dataset.period === 'monthly') || periodButtons[0];
    setActivePeriodButton(defaultButton);

    periodButtons.forEach(btn => {
        btn.addEventListener('click', function() {
            setActivePeriodButton(this);
            const period = this.dataset.period;
            updateCapitalHeader(period);
        });
    });
});

// Agregar función para mostrar el modal de edición
function showEditTradeModal(trade) {
  // Si ya existe un modal, eliminarlo primero
  const oldModal = document.getElementById('trade-details-modal');
  if (oldModal) oldModal.remove();

  // Crear modal con formulario editable
  const modal = document.createElement('div');
  modal.id = 'trade-details-modal';
  modal.className = 'trade-details-modal-bg';
  const metricType = trade.resultMetricType === 'percent' ? 'percent' : 'pips';
  const editMetricStep = metricType === 'percent' ? '0.01' : '0.001';
  const editMetricMin = metricType === 'percent' ? '-1000' : '-999.999';
  const editMetricMax = metricType === 'percent' ? '1000' : '999.999';
  const editMetricPlaceholder = metricType === 'percent' ? 'Ej: 2.50 o -1.25' : 'Ej: 25.500 o -12.345';

  modal.innerHTML = `
    <div class="trade-details-modal-card">
      <button class="trade-details-close" title="Cerrar">&times;</button>
      <h2>Editar Operación</h2>
      <form id="edit-trade-form" class="trade-details-list">
        <div><strong>Activo:</strong> <input type="text" name="asset" value="${trade.asset}" required></div>
        <div><strong>Dirección:</strong> 
          <select name="direction" required>
            <option value="long" ${trade.direction === 'long' ? 'selected' : ''}>COMPRA</option>
            <option value="short" ${trade.direction === 'short' ? 'selected' : ''}>VENTA</option>
          </select>
        </div>
        <div><strong>Lotes:</strong> <input type="number" step="0.001" name="lots" value="${trade.lots}" required></div>
        <div><strong>Resultado (MXN):</strong> <input type="number" step="0.01" name="resultMxn" value="${trade.resultMxn}" required></div>
        <div><strong>Métrica:</strong> 
          <select name="resultMetricType" id="editMetricType">
            <option value="pips" ${metricType === 'pips' ? 'selected' : ''}>Pips</option>
            <option value="percent" ${metricType === 'percent' ? 'selected' : ''}>%</option>
          </select>
        </div>
        <div><strong id="editMetricLabel">Resultado (${metricType === 'percent' ? '%' : 'Pips'}):</strong> <input type="number" step="${editMetricStep}" min="${editMetricMin}" max="${editMetricMax}" name="pips" value="${trade.pips ? trade.pips : ''}" required placeholder="${editMetricPlaceholder}"></div>
        <div><strong>Fecha de Apertura:</strong> <input type="datetime-local" name="openTime" value="${trade.openTime}" required></div>
        <div><strong>Fecha de Cierre:</strong> <input type="datetime-local" name="closeTime" value="${trade.closeTime}" required></div>
        <div><strong>Precio de Entrada:</strong> <input type="number" step="0.00001" name="openPrice" value="${trade.openPrice}" required></div>
        <div><strong>Precio de Salida:</strong> <input type="number" step="0.00001" name="closePrice" value="${trade.closePrice}" required></div>
        <div><strong>Estrategia:</strong> 
          <select name="strategy" required>
            <option value="Script CCI" ${trade.strategy === 'Script CCI' ? 'selected' : ''}>Script CCI</option>
            <option value="Script RSI" ${trade.strategy === 'Script RSI' ? 'selected' : ''}>Script RSI</option>
            <option value="Script MACD" ${trade.strategy === 'Script MACD' ? 'selected' : ''}>Script MACD</option>
            <option value="Script AO" ${trade.strategy === 'Script AO' ? 'selected' : ''}>Script AO</option>
            <option value="Script TII" ${trade.strategy === 'Script TII' ? 'selected' : ''}>Script TII</option>
            <option value="Script DeMarker" ${trade.strategy === 'Script DeMarker' ? 'selected' : ''}>Script DeMarker</option>
            <option value="Script Estocastico" ${trade.strategy === 'Script Estocastico' ? 'selected' : ''}>Script Estocastico</option>
            <option value="Script Cruce de MMs" ${trade.strategy === 'Script Cruce de MMs' ? 'selected' : ''}>Script Cruce de MMs</option>
            <option value="Script SAR" ${trade.strategy === 'Script SAR' ? 'selected' : ''}>Script SAR</option>
            <option value="Script BMSB" ${trade.strategy === 'Script BMSB' ? 'selected' : ''}>Script BMSB</option>
            <option value="Script CDM-RSI" ${trade.strategy === 'Script CDM-RSI' ? 'selected' : ''}>Script CDM-RSI</option>
            <option value="Script EMA Grupos" ${trade.strategy === 'Script EMA Grupos' ? 'selected' : ''}>Script EMA Grupos</option>
            <option value="Script FCT" ${trade.strategy === 'Script FCT' ? 'selected' : ''}>Script FCT</option>
            <option value="Señales app" ${trade.strategy === 'Señales app' ? 'selected' : ''}>Señales app</option>
            <option value="Análisis técnico" ${trade.strategy === 'Análisis técnico' ? 'selected' : ''}>Análisis técnico</option>
          </select>
        </div>
        <div style='align-items: flex-start;'><strong>Notas:</strong> <textarea name="notes" class='trade-details-list-notes'>${trade.notes ? trade.notes : ''}</textarea></div>
        <div style="margin-top:18px; text-align:right;">
          <button type="submit" class="btn" style="margin-right:10px;">Guardar</button>
          <button type="button" class="btn clear" id="cancel-edit-trade">Cancelar</button>
        </div>
      </form>
    </div>
  `;

  // Evento de cierre
  modal.querySelector('.trade-details-close').onclick = function() {
    modal.remove();
  };
  modal.querySelector('#cancel-edit-trade').onclick = function() {
    modal.remove();
  };

  const editMetricTypeSelect = modal.querySelector('#editMetricType');
  const metricInput = modal.querySelector('input[name="pips"]');
  const metricLabel = modal.querySelector('#editMetricLabel');

  function syncEditMetricControls(type) {
    if (!metricInput || !metricLabel) return;
    if (type === 'percent') {
      metricLabel.textContent = 'Resultado (%):';
      metricInput.step = '0.01';
      metricInput.min = '-1000';
      metricInput.max = '1000';
      metricInput.placeholder = 'Ej: 2.50 o -1.25';
    } else {
      metricLabel.textContent = 'Resultado (Pips):';
      metricInput.step = '0.001';
      metricInput.min = '-999.999';
      metricInput.max = '999.999';
      metricInput.placeholder = 'Ej: 25.500 o -12.345';
    }
  }

  if (editMetricTypeSelect) {
    syncEditMetricControls(editMetricTypeSelect.value);
    editMetricTypeSelect.addEventListener('change', function() {
      syncEditMetricControls(this.value);
      if (metricInput) metricInput.value = '';
    });
  }

  // Evento de guardado
  modal.querySelector('#edit-trade-form').onsubmit = function(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const updatedTrade = {
      asset: formData.get('asset'),
      direction: formData.get('direction'),
      lots: formData.get('lots'),
      resultMxn: formData.get('resultMxn'),
      pips: formData.get('pips'),
      resultMetricType: formData.get('resultMetricType') || 'pips',
      openTime: formData.get('openTime'),
      closeTime: formData.get('closeTime'),
      openPrice: formData.get('openPrice'),
      closePrice: formData.get('closePrice'),
      strategy: formData.get('strategy'),
      notes: formData.get('notes')
    };
    // Buscar y actualizar el trade en localStorage
    let trades = JSON.parse(localStorage.getItem('trades')) || [];
    const index = trades.findIndex(t => t.openTime === trade.openTime && t.closeTime === trade.closeTime && t.asset === trade.asset && t.resultMxn === trade.resultMxn && t.lots === trade.lots);
    if (index !== -1) {
      trades[index] = updatedTrade;
      localStorage.setItem('trades', JSON.stringify(trades));
      modal.remove();
      renderDiary();
      if (document.getElementById('statsContainer')) renderStats();
      if (typeof loadCardData === 'function') loadCardData();
      if (document.getElementById('tableContainer')) renderTradesTable();
    } else {
      alert('No se pudo encontrar el trade para editar.');
    }
  };

  document.body.appendChild(modal);
}

// Función para añadir un nuevo movimiento de capital (depósito/retiro)
function addMovement() {
  const type = document.getElementById('movement-type').value;
  const amount = parseFloat(document.getElementById('movement-amount').value);

  if (isNaN(amount) || amount <= 0) {
    alert('Por favor, ingresa un monto válido.');
    return;
  }

  const movement = {
    type: type,
    amount: amount,
    date: new Date().toISOString() // Usar ISOString para fácil parseo
  };

  const movements = JSON.parse(localStorage.getItem('capitalMovements')) || [];
  movements.push(movement);
  localStorage.setItem('capitalMovements', JSON.stringify(movements));

  // Limpiar el formulario
  document.getElementById('movement-amount').value = '0.00';

  // Actualizar el historial mostrado en la página de deposito-retiro
  renderMovementsHistory();

  // Si estamos en la página de inicio, actualizar el saldo mostrado
  if (typeof loadCardData === 'function') {
    loadCardData();
  }

  alert('Movimiento registrado correctamente');
}

// Función para renderizar el historial de movimientos en la página de deposito-retiro
function renderMovementsHistory() {
  const movementsList = document.getElementById('movements-list');
  if (!movementsList) return; // Asegurarse de que el elemento existe (solo en deposito-retiro.html)

  let movements = JSON.parse(localStorage.getItem('capitalMovements')) || [];
  movementsList.innerHTML = ''; // Limpiar lista actual

  if (movements.length === 0) {
    movementsList.innerHTML = '<li>No hay movimientos registrados aún.</li>';
    return;
  }

  // Ordenar movimientos por fecha, más recientes primero
  movements.sort((a, b) => new Date(b.date) - new Date(a.date));

  movements.forEach((movement, index) => {
    const listItem = document.createElement('li');
    listItem.className = 'movement-item'; // Añadir clase para estilos
    const date = new Date(movement.date);
    const dateString = date.toLocaleDateString('es-ES') + ' ' + date.toLocaleTimeString('es-ES');
    const amountString = `${movement.type === 'deposito' ? '+' : '-'}${movement.amount.toFixed(2)} MXN`;
    const amountClass = movement.type === 'deposito' ? 'positive' : 'negative';

    listItem.innerHTML = `
      <span class="movement-date">${dateString}</span>
      <span class="movement-type">${movement.type.charAt(0).toUpperCase() + movement.type.slice(1)}</span>
      <span class="movement-amount ${amountClass}">${amountString}</span>
      <div class="movement-actions">
        <button class="btn-edit-movement" title="Editar movimiento" data-date="${movement.date}" data-type="${movement.type}">✏️</button>
        <button class="btn-delete-movement" title="Eliminar movimiento" data-date="${movement.date}" data-type="${movement.type}">×</span></button>
      </div>
    `;
    movementsList.appendChild(listItem);
  });

  // Añadir event listeners a los botones después de que se han renderizado
  document.querySelectorAll('.btn-edit-movement').forEach(button => {
    button.addEventListener('click', function() {
      const dateToEdit = this.dataset.date;
      const typeToEdit = this.dataset.type;
      showEditMovementModal(dateToEdit, typeToEdit);
    });
  });

  document.querySelectorAll('.btn-delete-movement').forEach(button => {
    button.addEventListener('click', function() {
      const dateToDelete = this.dataset.date;
      const typeToDelete = this.dataset.type;
      deleteMovement(dateToDelete, typeToDelete);
    });
  });
}

// Función para mostrar modal de edición de movimiento
function showEditMovementModal(date, type) {
  const movements = JSON.parse(localStorage.getItem('capitalMovements')) || [];
  
  // Encontrar el movimiento que coincide con la fecha y el tipo
  const movementIndex = movements.findIndex(movement => movement.date === date && movement.type === type);
  const movement = movements[movementIndex];

  if (!movement) {
      alert('No se pudo encontrar el movimiento para editar.');
      return;
  }

  // Si ya existe un modal, eliminarlo primero
  const oldModal = document.getElementById('edit-movement-modal');
  if (oldModal) oldModal.remove();

  // Crear modal con formulario editable
  const modal = document.createElement('div');
  modal.id = 'edit-movement-modal';
  modal.className = 'trade-details-modal-bg'; // Reutilizar clase de estilo si es posible
  modal.innerHTML = `
    <div class="trade-details-modal-card">
      <button class="trade-details-close" title="Cerrar">&times;</button>
      <h2>Editar Movimiento</h2>
      <form id="edit-movement-form" class="trade-details-list"> <!-- Reutilizar clase de estilo -->
        <div><strong>Tipo:</strong>
          <select name="type" required>
            <option value="deposito" ${movement.type === 'deposito' ? 'selected' : ''}>Depósito</option>
            <option value="retiro" ${movement.type === 'retiro' ? 'selected' : ''}>Retiro</option>
          </select>
        </div>
        <div><strong>Monto:</strong> <input type="number" step="0.01" name="amount" value="${movement.amount}" required> MXN</div>
        <!-- La fecha se puede mostrar pero no editar fácilmente con input[datetime-local] si se guarda como ISOString simple sin zona horaria local. Podríamos simplificar o dejarla no editable para esta versión. -->
        <!-- <div><strong>Fecha:</strong> <input type="datetime-local" name="date" value="${movement.date.substring(0, 16)}" required></div> -->
         <div><strong>Fecha:</strong> <span>${new Date(movement.date).toLocaleString('es-ES')}</span></div>
        <div style="margin-top:18px; text-align:right;">
          <button type="submit" class="btn" style="margin-right:10px;">Guardar</button>
          <button type="button" class="btn clear" id="cancel-edit-movement">Cancelar</button>
        </div>
      </form>
    </div>
  `;

  // Evento de cierre
  modal.querySelector('.trade-details-close').onclick = function() {
    modal.remove();
  };
  modal.querySelector('#cancel-edit-movement').onclick = function() {
    modal.remove();
  };

  // Evento de guardado
  modal.querySelector('#edit-movement-form').onsubmit = function(e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const updatedMovement = {
      type: formData.get('type'),
      amount: parseFloat(formData.get('amount')),
      date: movement.date // Mantener la fecha original o actualizar si se añade campo de fecha editable
    };

    if (isNaN(updatedMovement.amount) || updatedMovement.amount <= 0) {
        alert('Por favor, ingresa un monto válido.');
        return;
    }

    let movements = JSON.parse(localStorage.getItem('capitalMovements')) || [];
    
    // Encontrar el índice del movimiento original para actualizarlo
    const originalIndex = movements.findIndex(m => m.date === date && m.type === type); // Usar los argumentos originales date y type

    if(originalIndex !== -1) {
        movements[originalIndex] = updatedMovement;
        localStorage.setItem('capitalMovements', JSON.stringify(movements));
        modal.remove();
        renderMovementsHistory();
        if (typeof loadCardData === 'function') {
          loadCardData(); // Actualizar saldo en index.html si está visible
        }
        alert('Movimiento actualizado correctamente');
    } else {
        alert('Error al actualizar el movimiento: no se encontró el original.');
        modal.remove(); // Cerrar modal si no se encuentra
    }
  };

  document.body.appendChild(modal);
}

// Función para eliminar un movimiento de capital
function deleteMovement(date, type) {
  console.log('Intentando eliminar movimiento con fecha:', date, 'y tipo:', type); // Log para depuración
  if (confirm('¿Estás seguro de que deseas eliminar este movimiento?')) {
    let movements = JSON.parse(localStorage.getItem('capitalMovements')) || [];
    
    // Encontrar el índice del movimiento que coincide con la fecha y el tipo
    const indexToDelete = movements.findIndex(movement => movement.date === date && movement.type === type);

    if (indexToDelete !== -1) {
      movements.splice(indexToDelete, 1);
      localStorage.setItem('capitalMovements', JSON.stringify(movements));
      renderMovementsHistory();
      if (typeof loadCardData === 'function') {
        loadCardData(); // Actualizar saldo en index.html si está visible
      }
      alert('Movimiento eliminado correctamente');
    } else {
      alert('No se pudo encontrar el movimiento para eliminar.');
    }
  }
}

// Modificar loadCardData para incluir movimientos de capital en el cálculo del saldo
function loadCardData() {
    const trades = JSON.parse(localStorage.getItem('trades')) || [];
    const movements = JSON.parse(localStorage.getItem('capitalMovements')) || []; // Cargar movimientos de capital
    const today = new Date();
    today.setHours(0, 0, 0, 0); // Establecer inicio del día

    // Calcular estadísticas del resumen diario
    const tradesHoy = trades.filter(trade => {
        const tradeDate = new Date(trade.openTime);
        tradeDate.setHours(0, 0, 0, 0);
        return tradeDate.getTime() === today.getTime();
    });

    // Calcular estadísticas del resumen diario
    const winningTrades = tradesHoy.filter(trade => parseFloat(trade.resultMxn) > 0).length;
    const losingTrades = tradesHoy.filter(trade => parseFloat(trade.resultMxn) < 0).length;
    const breakevenTrades = tradesHoy.filter(trade => parseFloat(trade.resultMxn) === 0).length;
    const dailyPnl = tradesHoy.reduce((sum, trade) => sum + parseFloat(trade.resultMxn), 0);

    // Actualizar el resumen diario
    document.getElementById('winning-trades').textContent = winningTrades;
    document.getElementById('losing-trades').textContent = losingTrades;
    document.getElementById('breakeven-trades').textContent = breakevenTrades;

    const dailyPnlElement = document.getElementById('daily-pnl');
    dailyPnlElement.textContent = `$${dailyPnl.toFixed(2)}`;
    dailyPnlElement.style.color = dailyPnl >= 0 ? '#2ecc71' : '#e74c3c';

    // Calcular estadísticas semanales
    const startOfWeek = new Date(today);
    startOfWeek.setDate(today.getDate() - today.getDay()); // Inicio de la semana (domingo)
    startOfWeek.setHours(0, 0, 0, 0);

    const tradesSemana = trades.filter(trade => {
        const tradeDate = new Date(trade.openTime);
        tradeDate.setHours(0, 0, 0, 0);
        return tradeDate >= startOfWeek && tradeDate <= today;
    });

    // Calcular estadísticas del resumen semanal
    const weeklyWinningTrades = tradesSemana.filter(trade => parseFloat(trade.resultMxn) > 0).length;
    const weeklyLosingTrades = tradesSemana.filter(trade => parseFloat(trade.resultMxn) < 0).length;
    const weeklyBreakevenTrades = tradesSemana.filter(trade => parseFloat(trade.resultMxn) === 0).length;
    const weeklyPnl = tradesSemana.reduce((sum, trade) => sum + parseFloat(trade.resultMxn), 0);

    // Actualizar el resumen semanal
    document.getElementById('weekly-winning-trades').textContent = weeklyWinningTrades;
    document.getElementById('weekly-losing-trades').textContent = weeklyLosingTrades;
    document.getElementById('weekly-breakeven-trades').textContent = weeklyBreakevenTrades;

    const weeklyPnlElement = document.getElementById('weekly-pnl');
    weeklyPnlElement.textContent = `$${weeklyPnl.toFixed(2)}`;
    weeklyPnlElement.style.color = weeklyPnl >= 0 ? '#2ecc71' : '#e74c3c';

    // Calcular estadísticas mensuales
    const startOfMonth = new Date(today.getFullYear(), today.getMonth(), 1);
    startOfMonth.setHours(0, 0, 0, 0);

    const tradesMes = trades.filter(trade => {
        const tradeDate = new Date(trade.openTime);
        tradeDate.setHours(0, 0, 0, 0);
        return tradeDate >= startOfMonth && tradeDate <= today;
    });

    // Calcular estadísticas del resumen mensual
    const monthlyWinningTrades = tradesMes.filter(trade => parseFloat(trade.resultMxn) > 0).length;
    const monthlyLosingTrades = tradesMes.filter(trade => parseFloat(trade.resultMxn) < 0).length;
    const monthlyBreakevenTrades = tradesMes.filter(trade => parseFloat(trade.resultMxn) === 0).length;
    const monthlyPnl = tradesMes.reduce((sum, trade) => sum + parseFloat(trade.resultMxn), 0);

    // Actualizar el resumen mensual
    document.getElementById('monthly-winning-trades').textContent = monthlyWinningTrades;
    document.getElementById('monthly-losing-trades').textContent = monthlyLosingTrades;
    document.getElementById('monthly-breakeven-trades').textContent = monthlyBreakevenTrades;

    const monthlyPnlElement = document.getElementById('monthly-pnl');
    monthlyPnlElement.textContent = `$${monthlyPnl.toFixed(2)}`;
    monthlyPnlElement.style.color = monthlyPnl >= 0 ? '#2ecc71' : '#e74c3c';

    // Calcular estadísticas anuales
    const startOfYear = new Date(today.getFullYear(), 0, 1);
    startOfYear.setHours(0, 0, 0, 0);

    const tradesAnio = trades.filter(trade => {
        const tradeDate = new Date(trade.openTime);
        tradeDate.setHours(0, 0, 0, 0);
        return tradeDate >= startOfYear && tradeDate <= today;
    });

    // Calcular estadísticas del resumen anual
    const annualWinningTrades = tradesAnio.filter(trade => parseFloat(trade.resultMxn) > 0).length;
    const annualLosingTrades = tradesAnio.filter(trade => parseFloat(trade.resultMxn) < 0).length;
    const annualBreakevenTrades = tradesAnio.filter(trade => parseFloat(trade.resultMxn) === 0).length;
    const annualPnl = tradesAnio.reduce((sum, trade) => sum + parseFloat(trade.resultMxn), 0);

    // Actualizar el resumen anual
    document.getElementById('annual-winning-trades').textContent = annualWinningTrades;
    document.getElementById('annual-losing-trades').textContent = annualLosingTrades;
    document.getElementById('annual-breakeven-trades').textContent = annualBreakevenTrades;
    const annualPnlElement = document.getElementById('annual-pnl');
    annualPnlElement.textContent = `$${annualPnl.toFixed(2)}`;
    annualPnlElement.style.color = annualPnl >= 0 ? '#2e7d32' : '#e74c3c';

    // Cargar meta y período desde cookies
    const monthlyGoal = getCookie('monthlyGoal') || '10000';
    const goalPeriod = getCookie('goalPeriod') || 'monthly';

    // Actualizar el texto del período
    const periodTexts = {
        'daily': 'Diaria',
        'weekly': 'Semanal',
        'monthly': 'Mensual',
        'yearly': 'Anual'
    };
    document.getElementById('goal-period-text').textContent = periodTexts[goalPeriod] || 'Mensual';

    // Calcular el PNL para el período seleccionado
    let periodStart;
    switch(goalPeriod) {
        case 'daily':
            periodStart = new Date(today.setHours(0, 0, 0, 0));
            break;
        case 'weekly':
            periodStart = new Date(today.setDate(today.getDate() - today.getDay()));
            break;
        case 'monthly':
            periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
            break;
        case 'yearly':
            periodStart = new Date(today.getFullYear(), 0, 1);
            break;
        default:
            periodStart = new Date(today.getFullYear(), today.getMonth(), 1);
    }

    const periodPNL = trades
        .filter(trade => new Date(trade.openTime) >= periodStart)
        .reduce((sum, trade) => sum + parseFloat(trade.resultMxn), 0);

    // Actualizar la visualización del progreso
    const goalAmount = parseFloat(monthlyGoal);
    const progressPercentage = (periodPNL / goalAmount) * 100;

    // Actualizar elementos con los valores calculados
    const currentAmountElement = document.getElementById('current-amount');
    const goalAmountElement = document.getElementById('goal-amount');
    const progressElement = document.getElementById('progress-percentage');

    currentAmountElement.textContent = `$${periodPNL.toFixed(2)}`;
    goalAmountElement.textContent = `$${goalAmount.toFixed(2)}`;
    progressElement.textContent = `${progressPercentage.toFixed(1)}%`;

    // Aplicar colores según el progreso
    currentAmountElement.style.color = periodPNL >= goalAmount ? '#2e7d32' : '#f57c00';
    currentAmountElement.style.fontWeight = 'bold';
    goalAmountElement.style.color = '#2e7d32';
    progressElement.style.color = '#FF6B00';

    // --- Calcular y mostrar Saldo Final --- //
    const initialCapital = parseFloat(localStorage.getItem('initialCapital')) || 0; // Obtener capital inicial, default 0 si no existe
    const totalMovementsPnl = movements.reduce((sum, movement) => {
        if (movement.type === 'deposito') {
            return sum + parseFloat(movement.amount);
        } else if (movement.type === 'retiro') {
            return sum - parseFloat(movement.amount);
        }
        return sum;
    }, 0);

    // Calcular el PNL total de las operaciones de trading
    const totalTradesPnl = trades.reduce((sum, trade) => sum + parseFloat(trade.resultMxn), 0);

    // Calcular el saldo final sumando el capital inicial, el PNL de movimientos y el PNL de trades
    const finalBalance = initialCapital + totalMovementsPnl + totalTradesPnl;

    const finalBalanceElement = document.getElementById('final-account-balance');
    if (finalBalanceElement) {
        finalBalanceElement.textContent = `$${finalBalance.toFixed(2)}`;
        // Aplicar color basado en si el saldo ha crecido desde el capital inicial
        finalBalanceElement.style.color = finalBalance >= initialCapital ? '#2e7d32' : '#e74c3c';
    }
    // ------------------------------------ //
}

// Cargar tema guardado
function loadTheme() {
    const theme = getCookie('theme') || 'light';
    document.body.className = theme;
}

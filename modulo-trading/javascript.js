// Service Worker registrado globalmente desde /app.js; evitar registro duplicado aquí

const ACCOUNT_META_KEY = 'tradingAccountsMeta';
const ACCOUNT_ACTIVE_KEY = 'activeTradingAccountId';
const ACCOUNT_DATA_PREFIX = 'tradingAccountData:';
const ACCOUNT_SCOPED_KEYS = new Set(['trades', 'capitalMovements', 'initialCapital', 'capitalHistory', 'username', 'capitalStartDate', 'discordWebhookUrl', 'strategies']);
const ACCOUNT_SELECT_ID = 'account-select';
const ACCOUNT_CREATE_BUTTON_ID = 'add-account-btn';
const ACCOUNT_NAME_ID = 'active-account-name';
let capitalEvolutionChartInstance = null;
let weekdayPnlChartInstance = null;
let durationPnlScatterInstance = null;
let pnlHistogramChartInstance = null;
let lossReasonDonutInstance = null;
let gainReasonDonutInstance = null;
let sqnGaugeChartInstance = null;
let pfGaugeChartInstance = null;
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
  const discordWebhookUrl = data && typeof data.discordWebhookUrl === 'string' && data.discordWebhookUrl.trim()
    ? data.discordWebhookUrl.trim().slice(0, 2048)
    : null;
  const strategies = normalizeStrategiesList(data && data.strategies);
  const capitalHistory = Array.isArray(data && data.capitalHistory) ? data.capitalHistory : [];
  return { trades, capitalMovements, initialCapital, capitalHistory, username, capitalStartDate, discordWebhookUrl, strategies };
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
    form.addEventListener('submit', function (event) {
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
    list.addEventListener('click', function (event) {
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

window.addEventListener(STRATEGIES_UPDATED_EVENT, function () {
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
    discordWebhookUrl: data.discordWebhookUrl,
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
  if (snapshot.discordWebhookUrl !== undefined) {
    current.discordWebhookUrl = snapshot.discordWebhookUrl && String(snapshot.discordWebhookUrl).trim()
      ? String(snapshot.discordWebhookUrl).trim().slice(0, 2048)
      : null;
  }
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
  if (typeof getTradingViewMode === 'function' && getTradingViewMode() === 'all') {
    label.textContent = 'Todas las cuentas';
    return;
  }
  const meta = getActiveAccountMeta();
  label.textContent = meta ? meta.nombre : '';
}

function setupAccountUI() {
  ensureActiveAccount();
  populateAccountSelectElement();
  updateActiveAccountNameDisplay();
  const select = document.getElementById(ACCOUNT_SELECT_ID);
  if (select && !select.dataset.bound) {
    select.addEventListener('change', function (event) {
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
    button.addEventListener('click', function () {
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

localStorage.getItem = function (key) {
  if (ACCOUNT_SCOPED_KEYS.has(key)) {
    const accountId = getActiveAccountId();
    const data = readAccountData(accountId);
    if (key === 'trades') return JSON.stringify(data.trades);
    if (key === 'capitalMovements') return JSON.stringify(data.capitalMovements);
    if (key === 'capitalHistory') return JSON.stringify(data.capitalHistory);
    if (key === 'initialCapital') return data.initialCapital !== null ? String(data.initialCapital) : null;
    if (key === 'username') return data.username !== null ? String(data.username) : null;
    if (key === 'capitalStartDate') return data.capitalStartDate;
    if (key === 'discordWebhookUrl') return data.discordWebhookUrl;
    if (key === STRATEGY_STORAGE_KEY) return JSON.stringify(data.strategies);
  }
  return originalLocalStorageGetItem(key);
};

localStorage.setItem = function (key, value) {
  if (ACCOUNT_SCOPED_KEYS.has(key)) {
    const accountId = getActiveAccountId();
    const data = readAccountData(accountId);
    if (key === 'trades' || key === 'capitalMovements' || key === 'capitalHistory') {
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
    } else if (key === 'discordWebhookUrl') {
      data.discordWebhookUrl = value !== null && value !== undefined && String(value).trim()
        ? String(value).trim().slice(0, 2048)
        : null;
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

localStorage.removeItem = function (key) {
  if (ACCOUNT_SCOPED_KEYS.has(key)) {
    const accountId = getActiveAccountId();
    const data = readAccountData(accountId);
    if (key === 'trades' || key === 'capitalMovements' || key === 'capitalHistory') {
      data[key] = [];
    } else if (key === 'initialCapital') {
      data.initialCapital = null;
    } else if (key === 'username') {
      data.username = null;
    } else if (key === 'capitalStartDate') {
      data.capitalStartDate = null;
    } else if (key === 'discordWebhookUrl') {
      data.discordWebhookUrl = null;
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
    discordWebhookUrl: null,
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
    discordWebhookUrl: snapshot.discordWebhookUrl,
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
  if ('discordWebhookUrl' in payload) {
    snapshot.discordWebhookUrl = payload.discordWebhookUrl !== null && payload.discordWebhookUrl !== undefined ? payload.discordWebhookUrl : null;
  }
  if ('strategies' in payload) {
    snapshot.strategies = Array.isArray(payload.strategies) ? payload.strategies : [];
  }
  applySnapshotToActiveAccount(snapshot);
  return true;
}

ensureActiveAccount();
document.addEventListener('DOMContentLoaded', function () {
  setupAccountUI();
  setupNavigationMenu();
  ensureStrategyDataInitialized();
  setupStrategyManagementUI();
  populateStrategySelects();
  setupStatsTimeFilterUI();
  setupMonthlyHeatmapNavigationUI();
  setupPerformanceRankingUI();
});

function setupNavigationMenu() {
  const navMenu = document.querySelector('.nav-menu');
  const menuOverlay = document.querySelector('.menu-overlay');
  const menuItems = document.querySelectorAll('.menu-items a');
  const menuToggleButton = document.querySelector('.menu-toggle');
  if (!navMenu || !menuOverlay) {
    window.toggleMenu = function () { };
    window.setActiveLink = function () { };
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

  window.toggleMenu = function () {
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
    const rawPage = window.location.pathname.split('/').pop() || 'index.html';
    const routeAliases = {
      'calculadora-roi.html': 'estadisticas.html',
      'tabla-trades.html': 'diario.html'
    };
    const currentPage = routeAliases[rawPage] || rawPage;
    const activeClasses = ['active', 'bg-orange-600', 'dark:bg-orange-700', 'text-white'];
    menuItems.forEach(link => {
      link.classList.remove(...activeClasses);
      link.removeAttribute('aria-current');
      const href = link.getAttribute('href');
      if (href === currentPage) {
        link.classList.add(...activeClasses);
        link.setAttribute('aria-current', 'page');
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

const TRADE_RESULT_REASONS = {
  gain: [
    { value: 'plan_ejecutado', label: 'Plan Ejecutado (Perfecto)' },
    { value: 'salida_anticipada', label: 'Salida Anticipada (Acierto)' },
    { value: 'suerte_mala_ejecucion', label: 'Suerte (Mala ejecución)' },
    { value: 'trailing_stop', label: 'Trailing Stop' }
  ],
  loss: [
    { value: 'stop_loss_tecnico', label: 'Stop Loss Técnico' },
    { value: 'fomo_entrada_impulsiva', label: 'FOMO / Entrada Impulsiva' },
    { value: 'salida_prematura_miedo', label: 'Salida Prematura (Miedo)' },
    { value: 'over_trading_revancha', label: 'Over-trading / Revancha' },
    { value: 'error_lotes_riesgo', label: 'Error de Lotes/Riesgo' },
    { value: 'noticia_fundamental', label: 'Noticia Fundamental' }
  ]
};

function getResultReasonMode(resultMxnValue) {
  const numeric = Number.parseFloat(String(resultMxnValue ?? '').trim());
  if (!Number.isFinite(numeric) || numeric === 0) return null;
  return numeric > 0 ? 'gain' : 'loss';
}

function getResultReasonLabel(reasonKey) {
  const key = String(reasonKey || '').trim();
  if (!key) return '';
  const all = [...TRADE_RESULT_REASONS.gain, ...TRADE_RESULT_REASONS.loss];
  const match = all.find(item => item.value === key);
  return match ? match.label : key;
}

function syncResultReasonControls(inputEl, groupEl, labelEl, selectEl, hintEl, selectedReasonValue) {
  if (!inputEl || !groupEl || !labelEl || !selectEl || !hintEl) return;

  const mode = getResultReasonMode(inputEl.value);
  if (!mode) {
    groupEl.classList.add('hidden');
    selectEl.required = false;
    selectEl.disabled = true;
    selectEl.value = '';
    hintEl.textContent = '-';
    return;
  }

  const config = mode === 'gain'
    ? { title: 'Motivo de la ganancia', hint: 'Clasifica si fue habilidad o suerte.', options: TRADE_RESULT_REASONS.gain }
    : { title: 'Motivo de la pérdida', hint: 'Distingue mercado (estadística) vs ejecución (error).', options: TRADE_RESULT_REASONS.loss };

  labelEl.textContent = config.title;
  hintEl.textContent = config.hint;

  const prevValue = typeof selectedReasonValue === 'string' ? selectedReasonValue : String(selectEl.value || '');
  selectEl.innerHTML = '<option value="">Selecciona un motivo</option>';
  config.options.forEach(item => {
    const opt = document.createElement('option');
    opt.value = item.value;
    opt.textContent = item.label;
    selectEl.appendChild(opt);
  });
  selectEl.value = config.options.some(item => item.value === prevValue) ? prevValue : '';

  selectEl.required = true;
  selectEl.disabled = false;
  groupEl.classList.remove('hidden');
}

function addTrade() {
  const currentBalance = getCurrentBalance();
  if (currentBalance <= 0) {
    alert('No puedes registrar trades sin saldo en la cuenta. Por favor, configura un capital inicial o realiza un depósito.');
    return;
  }

  const marginEl = document.getElementById('margin');
  const marginValue = marginEl ? marginEl.value : '';
  const leverageEl = document.getElementById('leverage');
  const leverageValue = leverageEl ? leverageEl.value : '';
  const marginNumber = marginEl ? parseFloat(marginValue) : null;
  const leverageNumber = leverageEl ? parseFloat(leverageValue) : null;
  const resultReasonEl = document.getElementById('resultReason');
  const resultReasonValue = resultReasonEl ? resultReasonEl.value : '';
  const trade = {
    id: 'trade-' + Date.now() + '-' + Math.floor(Math.random() * 1000000),
    asset: document.getElementById('asset').value,
    margin: marginValue,
    leverage: leverageValue,
    resultMxn: document.getElementById('resultMxn').value,
    resultReason: resultReasonValue,
    lots: document.getElementById('lots').value,
    direction: document.getElementById('direction').value,
    openTime: document.getElementById('openTime').value,
    closeTime: document.getElementById('closeTime').value,
    openPrice: document.getElementById('openPrice').value,
    closePrice: document.getElementById('closePrice').value,
    strategy: document.getElementById('strategy').value,
    notes: document.getElementById('notes').value,
    pips: document.getElementById('pips').value,
    resultMetricType: document.getElementById('resultMetricType') ? document.getElementById('resultMetricType').value || 'pips' : 'pips',
    mae: null,
    mfe: null
  };

  if (!trade.asset || !trade.resultMxn || !trade.lots || !trade.direction ||
    !trade.openTime || !trade.closeTime || !trade.openPrice || !trade.closePrice || !trade.pips || (marginEl && !trade.margin) || (leverageEl && !trade.leverage)) {
    alert('Por favor, completa todos los campos requeridos');
    return;
  }

  const resultReasonMode = getResultReasonMode(trade.resultMxn);
  if (resultReasonMode && !trade.resultReason) {
    alert('Por favor, selecciona el motivo del resultado.');
    return;
  }

  if (marginEl && (!Number.isFinite(marginNumber) || marginNumber <= 0)) {
    alert('Por favor, ingresa un margen válido (mayor a 0).');
    return;
  }

  if (leverageEl && (!Number.isFinite(leverageNumber) || leverageNumber <= 0)) {
    alert('Por favor, ingresa un apalancamiento válido (mayor a 0).');
    return;
  }

  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  trades.push(trade);
  localStorage.setItem('trades', JSON.stringify(trades));

  // Disparar cálculo de MAE/MFE en segundo plano (solo para cripto)
  if (typeof triggerMAEMFECalculation === 'function') {
    triggerMAEMFECalculation(trade);
  }

  document.getElementById('resultMxn').value = '';
  if (resultReasonEl) {
    resultReasonEl.value = '';
    resultReasonEl.required = false;
  }
  const resultReasonGroupEl = document.getElementById('resultReasonGroup');
  const resultReasonLabelEl = document.getElementById('resultReasonLabel');
  const resultReasonHintEl = document.getElementById('resultReasonHint');
  if (resultReasonGroupEl && resultReasonLabelEl && resultReasonEl && resultReasonHintEl) {
    syncResultReasonControls(document.getElementById('resultMxn'), resultReasonGroupEl, resultReasonLabelEl, resultReasonEl, resultReasonHintEl, '');
  }
  document.getElementById('lots').value = '';
  if (marginEl) marginEl.value = '';
  if (leverageEl) leverageEl.value = '';
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
    '<th>Margen (MXN)</th>' +
    '<th>Apalancamiento</th>' +
    '<th>Resultado (MXN)</th>' +
    '<th>Motivo</th>' +
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
    const marginValue = parseFloat(trade.margin);
    const marginDisplay = Number.isFinite(marginValue) ? marginValue.toFixed(2) : '-';
    const leverageNumeric = parseFloat(trade.leverage);
    let leverageDisplay = '-';
    if (Number.isFinite(leverageNumeric) && leverageNumeric > 0) {
      leverageDisplay = `${Number.isInteger(leverageNumeric) ? leverageNumeric.toFixed(0) : leverageNumeric.toFixed(2)}X`;
    }
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
      `<td>${parseFloat(trade.lots).toFixed(8).replace(/\.?0+$/, '')}</td>` +
      `<td>${marginDisplay}</td>` +
      `<td>${leverageDisplay}</td>` +
      `<td class="${parseFloat(trade.resultMxn) >= 0 ? 'positive' : 'negative'}">${parseFloat(trade.resultMxn).toFixed(2)}</td>` +
      `<td>${trade.resultReason ? getResultReasonLabel(trade.resultReason) : '-'}</td>` +
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

function showTradeDetails(index) {
  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  const trade = trades[index];
  if (!trade) return;
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

  // Crear modal con Tailwind
  const modal = document.createElement('div');
  modal.id = 'trade-details-modal';
  modal.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300';
  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-md relative overflow-hidden transform transition-all scale-100">
      <div class="p-6">
        <button class="trade-details-close absolute top-4 right-4 text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" title="Cerrar">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
        
        <h2 class="text-2xl font-bold text-gray-900 dark:text-white mb-6 pr-8">Detalles de la Operación</h2>
        
        <div class="space-y-4">
          <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">Activo</span>
            <span class="font-bold text-gray-900 dark:text-white text-lg">${formattedAsset}</span>
          </div>
          
          <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">Dirección</span>
            <span class="${directionClass} px-3 py-1 rounded-full text-sm font-bold">${direction}</span>
          </div>
          
          <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">Lotes</span>
            <span class="font-medium text-gray-900 dark:text-white">${parseFloat(trade.lots).toFixed(8).replace(/\.?0+$/, '')}</span>
          </div>

          <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">Margen (MXN)</span>
            <span class="font-medium text-gray-900 dark:text-white">${Number.isFinite(parseFloat(trade.margin)) ? parseFloat(trade.margin).toFixed(2) : '-'}</span>
          </div>

          <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">Apalancamiento</span>
            <span class="font-medium text-gray-900 dark:text-white">${Number.isFinite(parseFloat(trade.leverage)) && parseFloat(trade.leverage) > 0 ? `${Number.isInteger(parseFloat(trade.leverage)) ? parseFloat(trade.leverage).toFixed(0) : parseFloat(trade.leverage).toFixed(2)}X` : '-'}</span>
          </div>
          
          <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">Resultado (MXN)</span>
            <span class="font-bold text-lg ${parseFloat(trade.resultMxn) >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}">
              ${parseFloat(trade.resultMxn) >= 0 ? '+' : ''}${parseFloat(trade.resultMxn).toFixed(2)}
            </span>
          </div>

          <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">Motivo</span>
            <span class="font-medium text-gray-900 dark:text-white">${trade.resultReason ? getResultReasonLabel(trade.resultReason) : '-'}</span>
          </div>
          
          <div class="flex justify-between items-center py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="text-gray-500 dark:text-gray-400">Resultado (${metricType === 'percent' ? '%' : 'Pips'})</span>
            <span class="font-medium text-gray-900 dark:text-white">${metricDisplay}</span>
          </div>
          
          <div class="grid grid-cols-2 gap-4 py-2 border-b border-gray-100 dark:border-gray-700">
            <div>
              <span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Apertura</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">${openDateStr}<br>${openTimeStr}</span>
            </div>
            <div class="text-right">
              <span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Cierre</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">${closeDateStr}<br>${closeTimeStr}</span>
            </div>
          </div>
          
          <div class="grid grid-cols-2 gap-4 py-2 border-b border-gray-100 dark:border-gray-700">
            <div>
              <span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Precio Entrada</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">${trade.openPrice}</span>
            </div>
            <div class="text-right">
              <span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Precio Salida</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">${trade.closePrice}</span>
            </div>
          </div>
          
          <div class="py-2 border-b border-gray-100 dark:border-gray-700">
            <span class="block text-xs text-gray-500 dark:text-gray-400 mb-1">Estrategia</span>
            <span class="inline-block bg-gray-100 dark:bg-gray-700 text-gray-800 dark:text-gray-200 px-3 py-1 rounded text-sm font-medium">
              ${trade.strategy}
            </span>
          </div>
          
          <div class="py-2">
            <span class="block text-xs text-gray-500 dark:text-gray-400 mb-2">Notas</span>
            <div class="bg-gray-50 dark:bg-gray-900/50 p-3 rounded-lg text-sm text-gray-700 dark:text-gray-300 italic min-h-[60px]">
              ${trade.notes ? trade.notes : 'Sin notas'}
            </div>
          </div>
        </div>
      </div>
    </div>
  `;

  // Evento de cierre
  modal.querySelector('.trade-details-close').onclick = function () {
    modal.remove();
  };

  // Cerrar al hacer clic fuera
  modal.onclick = function (e) {
    if (e.target === modal) modal.remove();
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

let statsTimeFilterState = { mode: 'all', value: null, unit: 'days' };

let monthlyHeatmapMonthIndex = null;
let monthlyHeatmapBounds = null;
let monthlyHeatmapTradesCache = [];

let performanceRankingMode = 'strategy';
let performanceRankingTradesCache = [];

function setupPerformanceRankingUI() {
  const tabStrategy = document.getElementById('performanceTabStrategy');
  const tabAsset = document.getElementById('performanceTabAsset');
  if (!tabStrategy || !tabAsset) return;

  if (tabStrategy.dataset.bound) {
    syncPerformanceRankingTabsUI();
    return;
  }
  tabStrategy.dataset.bound = 'true';

  tabStrategy.addEventListener('click', function () {
    setPerformanceRankingMode('strategy');
  });
  tabAsset.addEventListener('click', function () {
    setPerformanceRankingMode('asset');
  });

  syncPerformanceRankingTabsUI();
}

function setPerformanceRankingMode(mode) {
  const nextMode = mode === 'asset' ? 'asset' : 'strategy';
  if (performanceRankingMode === nextMode) return;
  performanceRankingMode = nextMode;
  syncPerformanceRankingTabsUI();
  renderPerformanceRanking(performanceRankingMode);
}

function syncPerformanceRankingTabsUI() {
  const tabStrategy = document.getElementById('performanceTabStrategy');
  const tabAsset = document.getElementById('performanceTabAsset');
  if (!tabStrategy || !tabAsset) return;

  const isStrategy = performanceRankingMode !== 'asset';

  function syncTab(tab, isActive) {
    tab.classList.toggle('bg-orange-600', isActive);
    tab.classList.toggle('text-white', isActive);
    tab.classList.toggle('hover:bg-orange-700', isActive);

    tab.classList.toggle('bg-white', !isActive);
    tab.classList.toggle('dark:bg-gray-800', !isActive);
    tab.classList.toggle('text-gray-700', !isActive);
    tab.classList.toggle('dark:text-gray-200', !isActive);
    tab.classList.toggle('hover:bg-gray-100', !isActive);
    tab.classList.toggle('dark:hover:bg-gray-700', !isActive);
  }

  syncTab(tabStrategy, isStrategy);
  syncTab(tabAsset, !isStrategy);
}

function renderPerformanceRanking(mode) {
  const body = document.getElementById('performanceRankingBody');
  const nameHeader = document.getElementById('performanceRankingNameHeader');
  if (!body) return;

  const normalizedMode = mode === 'asset' ? 'asset' : 'strategy';
  if (nameHeader) {
    nameHeader.textContent = normalizedMode === 'asset' ? 'Activo/Símbolo' : 'Estrategia';
  }

  const trades = Array.isArray(performanceRankingTradesCache) ? performanceRankingTradesCache : [];
  const groups = new Map();
  trades.forEach(trade => {
    const pnl = resolveTradePnl(trade);
    if (!Number.isFinite(pnl)) return;
    const key = normalizedMode === 'asset'
      ? formatAssetSymbol(trade && trade.asset)
      : ((trade && typeof trade.strategy === 'string' && trade.strategy.trim()) ? trade.strategy.trim() : 'Sin estrategia');
    if (!key || key === '-') return;

    const current = groups.get(key) || { total: 0, wins: 0, losses: 0, pnl: 0, grossProfit: 0, grossLossAbs: 0 };
    current.total += 1;
    if (pnl > 0) current.wins += 1;
    else if (pnl < 0) current.losses += 1;
    current.pnl += pnl;
    if (pnl > 0) current.grossProfit += pnl;
    else if (pnl < 0) current.grossLossAbs += Math.abs(pnl);
    groups.set(key, current);
  });

  const rows = Array.from(groups.entries())
    .map(([name, stats]) => {
      const total = stats.total;
      const winRate = total ? (stats.wins / total) * 100 : 0;
      let profitFactor = null;
      if (stats.grossLossAbs > 0) {
        profitFactor = stats.grossProfit / stats.grossLossAbs;
      } else if (stats.grossProfit > 0) {
        profitFactor = Infinity;
      }
      return {
        name,
        total,
        winRate,
        profitFactor,
        pnl: stats.pnl
      };
    })
    .sort((a, b) => {
      if (b.pnl !== a.pnl) return b.pnl - a.pnl;
      return b.total - a.total;
    });

  body.innerHTML = '';
  if (!rows.length) {
    const tr = document.createElement('tr');
    tr.className = 'odd:bg-gray-50 odd:dark:bg-gray-700/40';
    const td = document.createElement('td');
    td.colSpan = 5;
    td.className = 'py-4 pr-4 text-sm text-gray-500 dark:text-gray-400';
    td.textContent = 'Sin datos suficientes para clasificar';
    tr.appendChild(td);
    body.appendChild(tr);
    return;
  }

  rows.forEach(row => {
    const tr = document.createElement('tr');
    tr.className = 'odd:bg-gray-50 odd:dark:bg-gray-700/40';

    const nameTd = document.createElement('td');
    nameTd.className = 'py-3 pr-4 font-medium text-gray-900 dark:text-white max-w-[220px] truncate';
    nameTd.title = row.name;
    nameTd.textContent = row.name;

    const totalTd = document.createElement('td');
    totalTd.className = 'py-3 pr-4 text-gray-700 dark:text-gray-200';
    totalTd.textContent = String(row.total);

    const winRateTd = document.createElement('td');
    const winRateText = row.winRate.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    const winRateClass = row.winRate > 50
      ? 'text-green-600 dark:text-green-400'
      : (row.winRate < 50 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200');
    winRateTd.className = `py-3 pr-4 font-semibold ${winRateClass}`;
    winRateTd.textContent = `${winRateText}%`;

    const pfTd = document.createElement('td');
    pfTd.className = 'py-3 pr-4 text-gray-700 dark:text-gray-200';
    pfTd.textContent = row.profitFactor === Infinity
      ? '∞'
      : (row.profitFactor === null ? '-' : row.profitFactor.toFixed(2));

    const pnlTd = document.createElement('td');
    const pnlClass = row.pnl > 0
      ? 'text-green-600 dark:text-green-400'
      : (row.pnl < 0 ? 'text-red-600 dark:text-red-400' : 'text-gray-700 dark:text-gray-200');
    pnlTd.className = `py-3 pr-4 font-bold ${pnlClass}`;
    pnlTd.textContent = formatSignedMoney(Number(row.pnl.toFixed(2)));

    tr.appendChild(nameTd);
    tr.appendChild(totalTd);
    tr.appendChild(winRateTd);
    tr.appendChild(pfTd);
    tr.appendChild(pnlTd);
    body.appendChild(tr);
  });
}

function getMonthIndexFromDate(date) {
  return date.getFullYear() * 12 + date.getMonth();
}

function getYearMonthFromMonthIndex(monthIndex) {
  const year = Math.floor(monthIndex / 12);
  const month = monthIndex % 12;
  return { year, month };
}

function computeMonthlyHeatmapBounds(trades) {
  const months = (Array.isArray(trades) ? trades : [])
    .map(trade => getTradeEffectiveDate(trade))
    .filter(date => date && Number.isFinite(date.getTime()))
    .map(date => getMonthIndexFromDate(date));
  if (!months.length) return null;
  const minIndex = Math.min(...months);
  const maxIndex = Math.max(...months);
  return { minIndex, maxIndex };
}

function updateMonthlyHeatmapNavigationUI() {
  const prevBtn = document.getElementById('monthlyHeatmapPrevBtn');
  const nextBtn = document.getElementById('monthlyHeatmapNextBtn');
  const todayBtn = document.getElementById('monthlyHeatmapTodayBtn');
  if (!prevBtn || !nextBtn || !todayBtn) return;

  const nowIndex = getMonthIndexFromDate(new Date());
  const bounds = monthlyHeatmapBounds;
  const minIndex = bounds ? bounds.minIndex : monthlyHeatmapMonthIndex;
  const maxIndex = bounds ? bounds.maxIndex : monthlyHeatmapMonthIndex;

  const canPrev = Number.isFinite(monthlyHeatmapMonthIndex) && Number.isFinite(minIndex) && monthlyHeatmapMonthIndex > minIndex;
  const canNext = Number.isFinite(monthlyHeatmapMonthIndex) && Number.isFinite(maxIndex) && monthlyHeatmapMonthIndex < maxIndex;
  const isToday = monthlyHeatmapMonthIndex === nowIndex;

  prevBtn.disabled = !canPrev;
  nextBtn.disabled = !canNext;
  todayBtn.disabled = isToday;

  prevBtn.classList.toggle('opacity-50', !canPrev);
  prevBtn.classList.toggle('cursor-not-allowed', !canPrev);
  nextBtn.classList.toggle('opacity-50', !canNext);
  nextBtn.classList.toggle('cursor-not-allowed', !canNext);
  todayBtn.classList.toggle('opacity-50', isToday);
  todayBtn.classList.toggle('cursor-not-allowed', isToday);
}

function goToMonthlyHeatmapMonth(monthIndex) {
  if (!Number.isFinite(monthIndex)) return;
  const bounds = monthlyHeatmapBounds;
  if (bounds) {
    monthlyHeatmapMonthIndex = Math.min(bounds.maxIndex, Math.max(bounds.minIndex, monthIndex));
  } else {
    monthlyHeatmapMonthIndex = monthIndex;
  }
  renderMonthlyPnlHeatmap(monthlyHeatmapTradesCache);
}

function setupMonthlyHeatmapNavigationUI() {
  const prevBtn = document.getElementById('monthlyHeatmapPrevBtn');
  const nextBtn = document.getElementById('monthlyHeatmapNextBtn');
  const todayBtn = document.getElementById('monthlyHeatmapTodayBtn');
  if (!prevBtn || !nextBtn || !todayBtn) return;

  if (prevBtn.dataset.bound) {
    updateMonthlyHeatmapNavigationUI();
    return;
  }
  prevBtn.dataset.bound = 'true';

  prevBtn.addEventListener('click', function () {
    if (!Number.isFinite(monthlyHeatmapMonthIndex)) return;
    goToMonthlyHeatmapMonth(monthlyHeatmapMonthIndex - 1);
  });
  nextBtn.addEventListener('click', function () {
    if (!Number.isFinite(monthlyHeatmapMonthIndex)) return;
    goToMonthlyHeatmapMonth(monthlyHeatmapMonthIndex + 1);
  });
  todayBtn.addEventListener('click', function () {
    goToMonthlyHeatmapMonth(getMonthIndexFromDate(new Date()));
  });
}

function getStatsTimeFilterRange() {
  if (!statsTimeFilterState || statsTimeFilterState.mode !== 'last') return null;
  const value = Math.floor(Number(statsTimeFilterState.value));
  if (!Number.isFinite(value) || value <= 0) return null;
  const unit = statsTimeFilterState.unit;
  if (unit !== 'days' && unit !== 'months' && unit !== 'years') return null;
  const end = new Date();
  const anchor = unit === 'years' ? startOfYear(end) : (unit === 'months' ? startOfMonth(end) : startOfDay(end));
  const start = unit === 'years'
    ? addYears(anchor, -(value - 1))
    : (unit === 'months'
      ? addMonths(anchor, -(value - 1))
      : addDays(anchor, -(value - 1)));
  return Number.isFinite(start.getTime()) ? { start, end } : null;
}

function clampValidDate(date) {
  if (!(date instanceof Date)) return null;
  return Number.isFinite(date.getTime()) ? date : null;
}

function startOfDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function startOfMonth(date) {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

function startOfYear(date) {
  return new Date(date.getFullYear(), 0, 1);
}

function addDays(date, amount) {
  const next = new Date(date);
  next.setDate(next.getDate() + amount);
  return next;
}

function addMonths(date, amount) {
  return new Date(date.getFullYear(), date.getMonth() + amount, 1);
}

function addYears(date, amount) {
  return new Date(date.getFullYear() + amount, 0, 1);
}

function startOfIsoWeek(date) {
  const d = startOfDay(date);
  const day = d.getDay();
  const diff = (day === 0 ? -6 : 1) - day;
  d.setDate(d.getDate() + diff);
  return d;
}

function startOfWeekSunday(date) {
  const d = startOfDay(date);
  d.setDate(d.getDate() - d.getDay());
  return d;
}

function formatCapitalPeriodLabel(date, unit) {
  if (unit === 'years') return String(date.getFullYear());
  if (unit === 'months') return `${CAPITAL_MONTH_NAMES_ES[date.getMonth()]} ${date.getFullYear()}`;
  const label = date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short' });
  return label.replace('.', '');
}

function roundMoney(value) {
  return Number(Number(value).toFixed(2));
}

function computeCapitalAtDate(events, initialCapital, date, inclusive) {
  const end = clampValidDate(date);
  if (!end) return roundMoney(initialCapital);
  const isInclusive = inclusive !== false;
  let running = Number.isFinite(initialCapital) ? initialCapital : 0;
  (Array.isArray(events) ? events : []).forEach(item => {
    if (!item || !(item.date instanceof Date) || !Number.isFinite(item.date.getTime()) || !Number.isFinite(item.value)) return;
    if (isInclusive ? item.date <= end : item.date < end) running += item.value;
  });
  return roundMoney(running);
}

function buildCapitalSeriesByUnit({ events, initialCapital, capitalStartDate, unit, startBoundary, periodsCount, endDate, includeBaselinePoint }) {
  const safeUnit = unit === 'years' ? 'years' : (unit === 'months' ? 'months' : 'days');
  const now = clampValidDate(endDate) || new Date();
  let start = clampValidDate(startBoundary);
  if (!start) start = safeUnit === 'years' ? startOfYear(now) : (safeUnit === 'months' ? startOfMonth(now) : startOfDay(now));

  const baselineDate = clampValidDate(capitalStartDate);
  const startFloor = safeUnit === 'years' ? startOfYear(start) : (safeUnit === 'months' ? startOfMonth(start) : startOfDay(start));
  let effectiveStart = startFloor;
  let allowBaseline = includeBaselinePoint === true;

  if (baselineDate) {
    const baselineFloor = safeUnit === 'years' ? startOfYear(baselineDate) : (safeUnit === 'months' ? startOfMonth(baselineDate) : startOfDay(baselineDate));
    if (effectiveStart < baselineFloor) {
      effectiveStart = baselineFloor;
      allowBaseline = false;
    }
  }

  const netByPeriodStart = new Map();
  (Array.isArray(events) ? events : []).forEach(item => {
    if (!item || !(item.date instanceof Date) || !Number.isFinite(item.date.getTime()) || !Number.isFinite(item.value)) return;
    if (baselineDate && item.date < baselineDate) return;
    if (item.date < effectiveStart || item.date > now) return;
    const periodStart = safeUnit === 'years' ? startOfYear(item.date) : (safeUnit === 'months' ? startOfMonth(item.date) : startOfDay(item.date));
    const key = periodStart.getTime();
    netByPeriodStart.set(key, (netByPeriodStart.get(key) || 0) + item.value);
  });

  const baseCapital = computeCapitalAtDate(events, initialCapital, effectiveStart, false);
  const labels = [];
  const values = [];
  let running = baseCapital;

  if (allowBaseline) {
    const prev = safeUnit === 'years' ? addYears(effectiveStart, -1) : (safeUnit === 'months' ? addMonths(effectiveStart, -1) : addDays(effectiveStart, -1));
    labels.push(formatCapitalPeriodLabel(prev, safeUnit));
    values.push(baseCapital);
  }

  const count = Number.isFinite(periodsCount) && periodsCount > 0 ? Math.floor(periodsCount) : 1;
  for (let i = 0; i < count; i++) {
    const periodStart = safeUnit === 'years' ? addYears(effectiveStart, i) : (safeUnit === 'months' ? addMonths(effectiveStart, i) : addDays(effectiveStart, i));
    const key = periodStart.getTime();
    running += netByPeriodStart.get(key) || 0;
    labels.push(formatCapitalPeriodLabel(periodStart, safeUnit));
    values.push(roundMoney(running));
  }

  let peak = values.length ? values[0] : baseCapital;
  const drawdownPercents = values.map(value => {
    if (!Number.isFinite(value)) return 0;
    if (!Number.isFinite(peak) || value > peak) peak = value;
    if (peak === 0) return 0;
    return Number((((value - peak) / peak) * 100).toFixed(2));
  });

  const finalCapital = values.length ? values[values.length - 1] : baseCapital;
  const pnl = roundMoney(finalCapital - baseCapital);
  const roi = baseCapital !== 0 ? Number(((pnl / baseCapital) * 100).toFixed(2)) : null;

  return {
    unit: safeUnit,
    axisTitle: safeUnit === 'years' ? 'Años' : (safeUnit === 'months' ? 'Meses' : 'Días'),
    labels,
    values,
    pnl,
    roi,
    baseCapital,
    finalCapital,
    drawdownPercents
  };
}

function applyStatsTimeFilterToTrades(trades) {
  const range = getStatsTimeFilterRange();
  if (!range) return Array.isArray(trades) ? trades : [];
  const start = range.start;
  const end = range.end;
  return (Array.isArray(trades) ? trades : []).filter(trade => {
    const date = getTradeEffectiveDate(trade) || (trade && trade.openTime ? new Date(trade.openTime) : null);
    if (!date || !Number.isFinite(date.getTime())) return false;
    return date >= start && date <= end;
  });
}

function formatStatsTimeFilterLabel() {
  if (!statsTimeFilterState || statsTimeFilterState.mode !== 'last') return 'Todo el periodo';
  const value = Number(statsTimeFilterState.value);
  const unit = statsTimeFilterState.unit;
  if (!Number.isFinite(value) || value <= 0) return 'Todo el periodo';
  const unitLabel = unit === 'days' ? 'días' : (unit === 'months' ? 'meses' : 'años');
  return `Últimos ${value} ${unitLabel}`;
}

function setupStatsTimeFilterUI() {
  const button = document.getElementById('time-filter-btn');
  const label = document.getElementById('time-filter-btn-label');
  const modal = document.getElementById('time-filter-modal');
  const overlay = document.getElementById('time-filter-overlay');
  const closeButton = document.getElementById('time-filter-close');
  const cancelButton = document.getElementById('time-filter-cancel');
  const applyButton = document.getElementById('time-filter-apply');
  const resetButton = document.getElementById('time-filter-reset');
  const modeSelect = document.getElementById('time-filter-mode');
  const lastFields = document.getElementById('time-filter-last-fields');
  const valueInput = document.getElementById('time-filter-value');
  const unitSelect = document.getElementById('time-filter-unit');
  if (!button || !label || !modal || !overlay || !closeButton || !cancelButton || !applyButton || !resetButton || !modeSelect || !lastFields || !valueInput || !unitSelect) {
    return;
  }

  if (button.dataset.bound) {
    label.textContent = formatStatsTimeFilterLabel();
    return;
  }
  button.dataset.bound = 'true';

  function syncModeVisibility() {
    const isLast = modeSelect.value === 'last';
    lastFields.classList.toggle('hidden', !isLast);
  }

  function openModal() {
    modeSelect.value = statsTimeFilterState.mode === 'last' ? 'last' : 'all';
    valueInput.value = statsTimeFilterState.value === null || statsTimeFilterState.value === undefined ? '' : String(statsTimeFilterState.value);
    unitSelect.value = statsTimeFilterState.unit === 'months' ? 'months' : (statsTimeFilterState.unit === 'years' ? 'years' : 'days');
    syncModeVisibility();
    modal.classList.remove('hidden');
    modeSelect.focus();
  }

  function closeModal() {
    modal.classList.add('hidden');
    button.focus();
  }

  function applyFilter() {
    const mode = modeSelect.value === 'last' ? 'last' : 'all';
    if (mode === 'all') {
      statsTimeFilterState = { mode: 'all', value: null, unit: 'days' };
      label.textContent = formatStatsTimeFilterLabel();
      closeModal();
      if (typeof renderStats === 'function') renderStats();
      return;
    }

    const rawValue = valueInput.value;
    const parsed = Number(rawValue);
    const value = Number.isFinite(parsed) ? Math.floor(parsed) : NaN;
    if (!Number.isFinite(value) || value <= 0) {
      alert('Ingresa un número válido mayor a 0.');
      valueInput.focus();
      return;
    }
    const unit = unitSelect.value === 'months' ? 'months' : (unitSelect.value === 'years' ? 'years' : 'days');
    statsTimeFilterState = { mode: 'last', value, unit };
    label.textContent = formatStatsTimeFilterLabel();
    closeModal();
    if (typeof renderStats === 'function') renderStats();
  }

  function resetFilter() {
    statsTimeFilterState = { mode: 'all', value: null, unit: 'days' };
    label.textContent = formatStatsTimeFilterLabel();
    closeModal();
    if (typeof renderStats === 'function') renderStats();
  }

  label.textContent = formatStatsTimeFilterLabel();
  syncModeVisibility();

  button.addEventListener('click', openModal);
  overlay.addEventListener('click', closeModal);
  closeButton.addEventListener('click', closeModal);
  cancelButton.addEventListener('click', closeModal);
  resetButton.addEventListener('click', resetFilter);
  applyButton.addEventListener('click', applyFilter);
  modeSelect.addEventListener('change', syncModeVisibility);

  modal.addEventListener('keydown', function (event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      closeModal();
    }
  });
}

function calculateCapitalEvolutionData(range) {
  const mode = typeof getTradingViewMode === 'function' ? getTradingViewMode() : 'active';
  const snapshot = typeof getTradingViewSnapshot === 'function' ? getTradingViewSnapshot() : null;

  if (mode !== 'all') {
    let initialCapital = parseFloat(localStorage.getItem('initialCapital'));
    if (!Number.isFinite(initialCapital)) initialCapital = 0;

    const trades = JSON.parse(localStorage.getItem('trades')) || [];
    const movements = JSON.parse(localStorage.getItem('capitalMovements')) || [];

    if (initialCapital === 0 && trades.length === 0 && movements.length === 0) {
      return { labels: [], values: [], pnl: null, roi: null, baseCapital: null, finalCapital: null };
    }

    const capitalStartDateRaw = localStorage.getItem('capitalStartDate');
    let capitalStartDate = capitalStartDateRaw ? new Date(capitalStartDateRaw) : null;
    if (capitalStartDate && Number.isNaN(capitalStartDate.getTime())) {
      capitalStartDate = null;
    }

    return calculateCapitalEvolutionDataFromCollections({ initialCapital, capitalStartDate, trades, movements, range });
  }

  const initialCapital = snapshot && Number.isFinite(snapshot.initialCapital) ? snapshot.initialCapital : 0;
  const capitalStartDateRaw = snapshot && snapshot.capitalStartDate ? snapshot.capitalStartDate : null;
  let capitalStartDate = capitalStartDateRaw ? new Date(capitalStartDateRaw) : null;
  if (capitalStartDate && Number.isNaN(capitalStartDate.getTime())) {
    capitalStartDate = null;
  }

  const trades = snapshot && Array.isArray(snapshot.trades) ? snapshot.trades : [];
  const movements = snapshot && Array.isArray(snapshot.capitalMovements) ? snapshot.capitalMovements : [];

  return calculateCapitalEvolutionDataFromCollections({ initialCapital, capitalStartDate, trades, movements, range });
}

function calculateCapitalEvolutionDataFromCollections({ initialCapital, capitalStartDate, trades, movements, range }) {
  if (!Number.isFinite(initialCapital)) {
    initialCapital = 0;
  }
  if (initialCapital === 0 && (!trades || trades.length === 0) && (!movements || movements.length === 0)) {
    return { labels: [], values: [], pnl: null, roi: null, baseCapital: null, finalCapital: null };
  }

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

  const now = range && range.end instanceof Date && Number.isFinite(range.end.getTime()) ? new Date(range.end) : new Date();
  const baselineDate = capitalStartDate || null;
  let rangeStart = range && range.start instanceof Date && Number.isFinite(range.start.getTime()) ? new Date(range.start) : null;
  if (rangeStart && baselineDate && rangeStart < baselineDate) {
    rangeStart = new Date(baselineDate);
  }

  const events = [];
  tradesData.forEach(item => {
    if (baselineDate && item.date < baselineDate) return;
    events.push(item);
  });
  movementsData.forEach(item => {
    if (baselineDate && item.date < baselineDate) return;
    events.push(item);
  });
  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  const filter = typeof statsTimeFilterState === 'object' && statsTimeFilterState ? statsTimeFilterState : null;
  const isLastMode = filter && filter.mode === 'last';
  const filterValue = isLastMode ? Number(filter.value) : NaN;
  const filterUnit = isLastMode && (filter.unit === 'days' || filter.unit === 'months' || filter.unit === 'years') ? filter.unit : null;

  if (isLastMode && Number.isFinite(filterValue) && filterValue > 0 && filterUnit) {
    const nowAnchor = filterUnit === 'years' ? startOfYear(now) : (filterUnit === 'months' ? startOfMonth(now) : startOfDay(now));
    const startBoundary = filterUnit === 'years'
      ? addYears(nowAnchor, -(Math.floor(filterValue) - 1))
      : (filterUnit === 'months'
        ? addMonths(nowAnchor, -(Math.floor(filterValue) - 1))
        : addDays(nowAnchor, -(Math.floor(filterValue) - 1)));

    return buildCapitalSeriesByUnit({
      events,
      initialCapital,
      capitalStartDate,
      unit: filterUnit,
      startBoundary,
      periodsCount: Math.floor(filterValue),
      endDate: now,
      includeBaselinePoint: true
    });
  }

  let effectiveStart = rangeStart;
  if (!effectiveStart) {
    if (capitalStartDate) {
      effectiveStart = startOfMonth(capitalStartDate);
    } else if (events.length > 0) {
      effectiveStart = startOfMonth(events[0].date);
    } else {
      effectiveStart = new Date(now.getFullYear(), 0, 1);
    }
  } else {
    effectiveStart = startOfMonth(effectiveStart);
  }

  const monthsSpan = (now.getFullYear() - effectiveStart.getFullYear()) * 12 + (now.getMonth() - effectiveStart.getMonth()) + 1;
  return buildCapitalSeriesByUnit({
    events,
    initialCapital,
    capitalStartDate,
    unit: 'months',
    startBoundary: effectiveStart,
    periodsCount: Math.max(1, monthsSpan),
    endDate: now,
    includeBaselinePoint: false
  });
}

function renderCapitalEvolutionChart(range) {
  const canvas = document.getElementById('capitalEvolutionChart');
  const emptyState = document.getElementById('capitalEvolutionEmptyState');
  const pnlElement = document.getElementById('capitalEvolutionPnl');
  const roiElement = document.getElementById('capitalEvolutionRoi');
  if (!canvas || typeof Chart === 'undefined') {
    if (pnlElement) pnlElement.textContent = '-';
    if (roiElement) roiElement.textContent = '-';
    return;
  }

  const { labels, values, pnl, roi, baseCapital, drawdownPercents, axisTitle } = calculateCapitalEvolutionData(range);
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

  const datasetCapitalConfig = {
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
    pointHoverRadius: 4,
    yAxisID: 'y'
  };

  const drawdownSeries = Array.isArray(drawdownPercents) && drawdownPercents.length === values.length
    ? drawdownPercents
    : new Array(values.length).fill(0);

  const minDrawdown = drawdownSeries.length ? Math.min(...drawdownSeries) : 0;
  const datasetDrawdownConfig = {
    label: 'Drawdown',
    data: drawdownSeries,
    borderColor: 'rgba(231, 76, 60, 0.65)',
    backgroundColor: 'rgba(231, 76, 60, 0.18)',
    fill: 'origin',
    borderWidth: 1.5,
    tension: 0.25,
    pointRadius: 0,
    pointHitRadius: 8,
    yAxisID: 'yDrawdown'
  };

  if (capitalEvolutionChartInstance) {
    capitalEvolutionChartInstance.data.labels = labels;
    const capitalDataset = capitalEvolutionChartInstance.data.datasets[0];
    capitalDataset.label = datasetCapitalConfig.label;
    capitalDataset.data = datasetCapitalConfig.data;
    capitalDataset.fill = datasetCapitalConfig.fill;
    capitalDataset.borderColor = datasetCapitalConfig.borderColor;
    capitalDataset.backgroundColor = datasetCapitalConfig.backgroundColor;
    capitalDataset.borderWidth = datasetCapitalConfig.borderWidth;
    capitalDataset.tension = datasetCapitalConfig.tension;
    capitalDataset.pointRadius = datasetCapitalConfig.pointRadius;
    capitalDataset.pointBackgroundColor = datasetCapitalConfig.pointBackgroundColor;
    capitalDataset.pointBorderColor = datasetCapitalConfig.pointBorderColor;
    capitalDataset.pointHoverRadius = datasetCapitalConfig.pointHoverRadius;
    capitalDataset.yAxisID = datasetCapitalConfig.yAxisID;

    if (capitalEvolutionChartInstance.data.datasets.length < 2) {
      capitalEvolutionChartInstance.data.datasets.push(datasetDrawdownConfig);
    } else {
      const ddDataset = capitalEvolutionChartInstance.data.datasets[1];
      ddDataset.label = datasetDrawdownConfig.label;
      ddDataset.data = datasetDrawdownConfig.data;
      ddDataset.borderColor = datasetDrawdownConfig.borderColor;
      ddDataset.backgroundColor = datasetDrawdownConfig.backgroundColor;
      ddDataset.fill = datasetDrawdownConfig.fill;
      ddDataset.borderWidth = datasetDrawdownConfig.borderWidth;
      ddDataset.tension = datasetDrawdownConfig.tension;
      ddDataset.pointRadius = datasetDrawdownConfig.pointRadius;
      ddDataset.pointHitRadius = datasetDrawdownConfig.pointHitRadius;
      ddDataset.yAxisID = datasetDrawdownConfig.yAxisID;
    }
    capitalEvolutionChartInstance.options.scales.y.suggestedMin = suggestedMin;
    capitalEvolutionChartInstance.options.scales.y.suggestedMax = suggestedMax;
    if (!capitalEvolutionChartInstance.options.scales.yDrawdown) {
      capitalEvolutionChartInstance.options.scales.yDrawdown = {
        position: 'right',
        suggestedMin: Math.min(minDrawdown, -0.01),
        suggestedMax: 0,
        grid: { drawOnChartArea: false },
        ticks: {
          callback: function (value) {
            return `${Number(value).toFixed(0)}%`;
          }
        }
      };
    } else {
      capitalEvolutionChartInstance.options.scales.yDrawdown.suggestedMin = Math.min(minDrawdown, -0.01);
      capitalEvolutionChartInstance.options.scales.yDrawdown.suggestedMax = 0;
    }
    if (capitalEvolutionChartInstance.options.scales.x && capitalEvolutionChartInstance.options.scales.x.title) {
      capitalEvolutionChartInstance.options.scales.x.title.text = typeof axisTitle === 'string' && axisTitle ? axisTitle : 'Meses';
    }
    if (capitalEvolutionChartInstance.options.scales.x && capitalEvolutionChartInstance.options.scales.x.ticks) {
      const shouldSkip = labels.length > 18;
      capitalEvolutionChartInstance.options.scales.x.ticks.autoSkip = shouldSkip;
      capitalEvolutionChartInstance.options.scales.x.ticks.maxRotation = labels.length > 35 ? 45 : 0;
      capitalEvolutionChartInstance.options.scales.x.ticks.minRotation = labels.length > 35 ? 45 : 0;
    }
    capitalEvolutionChartInstance.update();
    return;
  }

  capitalEvolutionChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'line',
    data: {
      labels,
      datasets: [datasetCapitalConfig, datasetDrawdownConfig]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      scales: {
        x: {
          title: { display: true, text: typeof axisTitle === 'string' && axisTitle ? axisTitle : 'Meses' },
          ticks: {
            autoSkip: labels.length > 18,
            maxRotation: labels.length > 35 ? 45 : 0,
            minRotation: labels.length > 35 ? 45 : 0
          }
        },
        y: {
          title: { display: true, text: 'Capital acumulado (MXN)' },
          suggestedMin,
          suggestedMax,
          ticks: {
            callback: function (value) {
              return `$${Number(value).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
            }
          }
        },
        yDrawdown: {
          position: 'right',
          suggestedMin: Math.min(minDrawdown, -0.01),
          suggestedMax: 0,
          grid: {
            drawOnChartArea: false
          },
          ticks: {
            callback: function (value) {
              return `${Number(value).toFixed(0)}%`;
            }
          }
        }
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (context) {
              const value = context.parsed.y ?? 0;
              if (context.dataset && context.dataset.label === 'Drawdown') {
                return `Drawdown: ${Number(value).toFixed(2)}%`;
              }
              return `Capital: $${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
            }
          }
        }
      }
    }
  });
}

function calculateMaxStreak(values, predicate) {
  let current = 0;
  let max = 0;
  values.forEach(value => {
    if (predicate(value)) {
      current += 1;
      if (current > max) max = current;
    } else {
      current = 0;
    }
  });
  return max;
}

function calculateSqnFromReturns(returns) {
  const n = returns.length;
  if (n < 2) return null;
  const mean = returns.reduce((sum, value) => sum + value, 0) / n;
  const variance = returns.reduce((sum, value) => sum + Math.pow(value - mean, 2), 0) / (n - 1);
  const std = Math.sqrt(variance);
  if (!Number.isFinite(std) || std === 0) return null;
  return (mean / std) * Math.sqrt(n);
}

function formatSignedMoney(value) {
  if (!Number.isFinite(value)) return '-';
  const formatted = Math.abs(value).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
  return `${value >= 0 ? '+' : '-'}$${formatted}`;
}

function formatSignedPercent(value) {
  if (!Number.isFinite(value)) return '-';
  return `${value >= 0 ? '+' : ''}${value.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}%`;
}

function resolveTradePnl(trade) {
  const value = parseFloat(trade && trade.resultMxn);
  return Number.isFinite(value) ? value : null;
}

function formatMoney(value) {
  if (!Number.isFinite(value)) return '-';
  return `$${Number(value).toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function calculateReasonBreakdown(trades, mode) {
  const sign = mode === 'loss' ? -1 : 1;
  const totalModeTrades = trades.reduce((count, trade) => {
    const pnl = resolveTradePnl(trade);
    if (!Number.isFinite(pnl)) return count;
    if (sign === -1 && pnl < 0) return count + 1;
    if (sign === 1 && pnl > 0) return count + 1;
    return count;
  }, 0);

  const groups = new Map();
  let totalAmount = 0;
  let tradesWithReason = 0;

  trades.forEach(trade => {
    const pnl = resolveTradePnl(trade);
    if (!Number.isFinite(pnl)) return;
    if (sign === -1 && pnl >= 0) return;
    if (sign === 1 && pnl <= 0) return;

    const rawKey = trade && typeof trade.resultReason === 'string' ? trade.resultReason.trim() : '';
    if (!rawKey) return;

    tradesWithReason += 1;
    const amount = sign === -1 ? Math.abs(pnl) : pnl;
    totalAmount += amount;

    const key = rawKey;
    const current = groups.get(key) || { key, label: getResultReasonLabel(key), amount: 0, trades: 0 };
    current.amount += amount;
    current.trades += 1;
    groups.set(key, current);
  });

  const rows = Array.from(groups.values())
    .map(item => ({
      ...item,
      amount: Number(item.amount.toFixed(2))
    }))
    .sort((a, b) => b.amount - a.amount);

  return {
    mode,
    totalModeTrades,
    tradesWithReason,
    totalAmount: Number(totalAmount.toFixed(2)),
    rows
  };
}

function renderReasonDonut(canvasId, instance, labels, values, colors, mode) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return instance;

  const data = {
    labels,
    datasets: [{
      data: values,
      backgroundColor: colors,
      borderWidth: 0,
      hoverOffset: 6
    }]
  };

  const formatter = function (context) {
    const value = context.parsed ?? 0;
    const sign = mode === 'loss' ? '-' : '+';
    const label = typeof context.label === 'string' ? context.label : '';
    return `${label}: ${sign}${formatMoney(Math.abs(Number(value)))}`;
  };

  if (instance) {
    instance.data.labels = labels;
    instance.data.datasets[0].data = values;
    instance.data.datasets[0].backgroundColor = colors;
    instance.update();
    return instance;
  }

  return new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data,
    options: {
      responsive: true,
      maintainAspectRatio: false,
      cutout: '72%',
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: formatter
          }
        }
      }
    }
  });
}

function renderReasonList(containerId, breakdown, mode) {
  const container = document.getElementById(containerId);
  if (!container) return;

  if (!breakdown.rows.length || !Number.isFinite(breakdown.totalAmount) || breakdown.totalAmount <= 0) {
    container.innerHTML = '<div class="text-sm text-gray-500 dark:text-gray-400">No hay datos con motivo para este período.</div>';
    return;
  }

  const totalAmount = breakdown.totalAmount;
  const totalTrades = breakdown.tradesWithReason;
  const sign = mode === 'loss' ? '-' : '+';
  const barClass = mode === 'loss'
    ? 'bg-red-500/80 dark:bg-red-400/80'
    : 'bg-green-500/80 dark:bg-green-400/80';

  container.innerHTML = breakdown.rows.map(row => {
    const amountShare = totalAmount > 0 ? (row.amount / totalAmount) * 100 : 0;
    const tradesShare = totalTrades > 0 ? (row.trades / totalTrades) * 100 : 0;
    const avgAmount = row.trades ? row.amount / row.trades : 0;
    const amountText = `${sign}${formatMoney(row.amount)}`;
    const avgText = `${sign}${formatMoney(avgAmount)}`;
    const label = escapeHtml(row.label);

    return `
      <div class="rounded-xl border border-gray-200 dark:border-gray-700 p-4">
        <div class="flex items-start justify-between gap-3">
          <div class="min-w-0">
            <div class="font-semibold text-gray-900 dark:text-white truncate">${label}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">
              ${row.trades} ${row.trades === 1 ? 'trade' : 'trades'} (${tradesShare.toFixed(0)}%) · Promedio: ${avgText}
            </div>
          </div>
          <div class="text-right">
            <div class="font-semibold ${mode === 'loss' ? 'text-red-600 dark:text-red-400' : 'text-green-600 dark:text-green-400'}">${amountText}</div>
            <div class="text-xs text-gray-500 dark:text-gray-400 mt-1">${amountShare.toFixed(0)}%</div>
          </div>
        </div>
        <div class="mt-3 h-2 rounded-full bg-gray-100 dark:bg-gray-700 overflow-hidden">
          <div class="h-full ${barClass}" style="width: ${Math.max(2, Math.min(100, amountShare)).toFixed(2)}%"></div>
        </div>
      </div>
    `;
  }).join('');
}

function renderResultReasonInsights(trades) {
  const section = document.getElementById('resultReasonInsightsSection');
  if (!section) return;

  const lossMetaEl = document.getElementById('lossReasonMeta');
  const lossTotalEl = document.getElementById('lossReasonTotal');
  const lossSampleEl = document.getElementById('lossReasonSample');
  const gainMetaEl = document.getElementById('gainReasonMeta');
  const gainTotalEl = document.getElementById('gainReasonTotal');
  const gainSampleEl = document.getElementById('gainReasonSample');

  const lossBreakdown = calculateReasonBreakdown(trades, 'loss');
  const gainBreakdown = calculateReasonBreakdown(trades, 'gain');

  const lossTotal = lossBreakdown.totalAmount;
  const gainTotal = gainBreakdown.totalAmount;

  if (lossTotalEl) lossTotalEl.textContent = lossBreakdown.tradesWithReason ? `-${formatMoney(lossTotal)}` : '-';
  if (gainTotalEl) gainTotalEl.textContent = gainBreakdown.tradesWithReason ? `+${formatMoney(gainTotal)}` : '-';

  if (lossSampleEl) lossSampleEl.textContent = lossBreakdown.tradesWithReason ? `${lossBreakdown.tradesWithReason}/${lossBreakdown.totalModeTrades} trades con motivo` : 'Sin trades con motivo';
  if (gainSampleEl) gainSampleEl.textContent = gainBreakdown.tradesWithReason ? `${gainBreakdown.tradesWithReason}/${gainBreakdown.totalModeTrades} trades con motivo` : 'Sin trades con motivo';

  if (lossMetaEl) {
    const coverage = lossBreakdown.totalModeTrades ? (lossBreakdown.tradesWithReason / lossBreakdown.totalModeTrades) * 100 : 0;
    const avg = lossBreakdown.tradesWithReason ? lossTotal / lossBreakdown.tradesWithReason : null;
    lossMetaEl.textContent = lossBreakdown.tradesWithReason
      ? `Motivos: ${lossBreakdown.rows.length} · Cobertura: ${coverage.toFixed(0)}% · Promedio: -${formatMoney(avg)}`
      : 'Sin trades con motivo en este período.';
  }

  if (gainMetaEl) {
    const coverage = gainBreakdown.totalModeTrades ? (gainBreakdown.tradesWithReason / gainBreakdown.totalModeTrades) * 100 : 0;
    const avg = gainBreakdown.tradesWithReason ? gainTotal / gainBreakdown.tradesWithReason : null;
    gainMetaEl.textContent = gainBreakdown.tradesWithReason
      ? `Motivos: ${gainBreakdown.rows.length} · Cobertura: ${coverage.toFixed(0)}% · Promedio: +${formatMoney(avg)}`
      : 'Sin trades con motivo en este período.';
  }

  renderReasonList('lossReasonList', lossBreakdown, 'loss');
  renderReasonList('gainReasonList', gainBreakdown, 'gain');

  const lossLabels = lossBreakdown.rows.map(row => row.label);
  const lossValues = lossBreakdown.rows.map(row => row.amount);
  const gainLabels = gainBreakdown.rows.map(row => row.label);
  const gainValues = gainBreakdown.rows.map(row => row.amount);

  const lossColorsBase = [
    'rgba(231, 76, 60, 0.78)',
    'rgba(192, 57, 43, 0.78)',
    'rgba(214, 48, 49, 0.78)',
    'rgba(225, 112, 85, 0.78)',
    'rgba(255, 118, 117, 0.78)',
    'rgba(244, 67, 54, 0.78)',
    'rgba(210, 77, 87, 0.78)',
    'rgba(183, 21, 64, 0.78)'
  ];
  const gainColorsBase = [
    'rgba(46, 204, 113, 0.78)',
    'rgba(39, 174, 96, 0.78)',
    'rgba(0, 184, 148, 0.78)',
    'rgba(29, 209, 161, 0.78)',
    'rgba(16, 172, 132, 0.78)',
    'rgba(85, 239, 196, 0.78)',
    'rgba(0, 206, 201, 0.78)',
    'rgba(119, 221, 119, 0.78)'
  ];

  const pickColors = (base, count) => {
    if (!count) return [];
    return Array.from({ length: count }, (_, idx) => base[idx % base.length]);
  };

  if (!lossValues.length || typeof Chart === 'undefined') {
    if (lossReasonDonutInstance) {
      lossReasonDonutInstance.destroy();
      lossReasonDonutInstance = null;
    }
  } else {
    lossReasonDonutInstance = renderReasonDonut('lossReasonDonut', lossReasonDonutInstance, lossLabels, lossValues, pickColors(lossColorsBase, lossValues.length), 'loss');
  }

  if (!gainValues.length || typeof Chart === 'undefined') {
    if (gainReasonDonutInstance) {
      gainReasonDonutInstance.destroy();
      gainReasonDonutInstance = null;
    }
  } else {
    gainReasonDonutInstance = renderReasonDonut('gainReasonDonut', gainReasonDonutInstance, gainLabels, gainValues, pickColors(gainColorsBase, gainValues.length), 'gain');
  }
}

function renderWeekdayPnlChart(trades) {
  const canvas = document.getElementById('weekdayPnlChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const labels = ['Dom', 'Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb'];
  const sums = new Array(7).fill(0);
  trades.forEach(trade => {
    const pnl = resolveTradePnl(trade);
    if (!Number.isFinite(pnl)) return;
    const date = getTradeEffectiveDate(trade);
    if (!date) return;
    const dow = date.getDay(); // 0 (Domingo) - 6 (Sábado)
    sums[dow] += pnl;
  });

  // Reordenar para empezar en Lunes si se prefiere, pero el estándar JS es Domingo=0
  // Para visualización financiera suele ser L-D. Ajustemos a L-D.
  // JS getDay(): 0=Dom, 1=Lun, ..., 6=Sáb
  // Queremos: 0=Lun, 1=Mar, ..., 5=Sáb, 6=Dom

  const displayLabels = ['Lun', 'Mar', 'Mié', 'Jue', 'Vie', 'Sáb', 'Dom'];
  const displaySums = [
    sums[1], // Lun
    sums[2], // Mar
    sums[3], // Mié
    sums[4], // Jue
    sums[5], // Vie
    sums[6], // Sáb
    sums[0]  // Dom
  ];

  const data = displaySums.map(value => Number(value.toFixed(2)));
  const bg = data.map(value => value >= 0 ? 'rgba(46, 204, 113, 0.6)' : 'rgba(231, 76, 60, 0.6)');
  const border = data.map(value => value >= 0 ? 'rgba(46, 204, 113, 0.9)' : 'rgba(231, 76, 60, 0.9)');

  if (weekdayPnlChartInstance) {
    weekdayPnlChartInstance.data.labels = displayLabels;
    weekdayPnlChartInstance.data.datasets[0].data = data;
    weekdayPnlChartInstance.data.datasets[0].backgroundColor = bg;
    weekdayPnlChartInstance.data.datasets[0].borderColor = border;
    weekdayPnlChartInstance.update();
    return;
  }

  weekdayPnlChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels: displayLabels,
      datasets: [{
        label: 'PnL (MXN)',
        data,
        backgroundColor: bg,
        borderColor: border,
        borderWidth: 1.5,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (context) {
              const value = context.parsed.y ?? 0;
              return `PnL: ${formatSignedMoney(Number(value))}`;
            }
          }
        }
      },
      scales: {
        x: { grid: { display: false } },
        y: {
          ticks: {
            callback: function (value) {
              return `$${Number(value).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
            }
          }
        }
      }
    }
  });
}

/**
 * Renderiza un gráfico de tipo Velocímetro (Gauge) usando Chart.js
 * @param {string} canvasId - ID del canvas
 * @param {number|null} value - Valor actual
 * @param {Array} segments - Arreglo de objetos { limit, color }
 * @param {number} maxValue - Valor máximo del eje
 * @param {Chart} instance - Instancia del gráfico para reutilizar
 * @returns {Chart} - Nueva o actualizada instancia del gráfico
 */
function renderGaugeChart(canvasId, value, segments, maxValue, instance) {
  const canvas = document.getElementById(canvasId);
  if (!canvas || typeof Chart === 'undefined') return instance;

  const safeValue = value === null ? 0 : Math.min(Math.max(value, 0), maxValue);

  // Plugin personalizado para dibujar la aguja (flecha)
  const gaugeNeedle = {
    id: 'gaugeNeedle',
    afterDatasetsDraw(chart) {
      const { ctx, data, chartArea } = chart;
      ctx.save();

      const centerX = (chartArea.left + chartArea.right) / 2;
      const centerY = chartArea.bottom;
      const outerRadius = chart.getDatasetMeta(0).data[0].outerRadius;

      // Calcular ángulo (usar el valor guardado en las opciones para la aguja)
      const currentNeedleValue = chart.options.plugins.gaugeNeedleValue ?? safeValue;
      const angle = Math.PI + (currentNeedleValue / maxValue) * Math.PI;

      const isDarkMode = document.documentElement.classList.contains('dark');
      const needleColor = isDarkMode ? '#ffffff' : '#1f2937';

      // Dibujar base de la aguja (círculo central)
      ctx.beginPath();
      ctx.arc(centerX, centerY, 4, 0, Math.PI * 2);
      ctx.fillStyle = needleColor;
      ctx.fill();

      // Dibujar la aguja (flecha) más delgada y elegante
      ctx.translate(centerX, centerY);
      ctx.rotate(angle);
      ctx.beginPath();
      ctx.moveTo(0, -1.5);
      ctx.lineTo(outerRadius - 8, 0);
      ctx.lineTo(0, 1.5);
      ctx.fillStyle = needleColor;
      ctx.fill();

      ctx.restore();
    }
  };

  // Datos para los segmentos de fondo
  const segmentValues = [];
  const segmentColors = [];
  const segmentLabels = [];
  const segmentRanges = [];
  let lastLimit = 0;

  segments.forEach(s => {
    segmentValues.push(s.limit - lastLimit);
    segmentColors.push(s.color);
    segmentLabels.push(s.label || '');
    segmentRanges.push(`${lastLimit.toFixed(1)} - ${s.limit.toFixed(1)}`);
    lastLimit = s.limit;
  });

  if (lastLimit < maxValue) {
    segmentValues.push(maxValue - lastLimit);
    segmentColors.push('rgba(200, 200, 200, 0.2)');
    segmentLabels.push('Fuera de rango');
    segmentRanges.push(`> ${lastLimit.toFixed(1)}`);
  }

  const data = {
    labels: segmentLabels,
    datasets: [
      {
        data: segmentValues,
        backgroundColor: segmentColors,
        borderWidth: 0,
        circumference: 180,
        rotation: 270,
        cutout: '80%',
        ranges: segmentRanges // Guardar rangos para el tooltip
      }
    ]
  };

  if (instance) {
    instance.data.labels = segmentLabels; // Actualizar etiquetas explícitamente
    instance.data.datasets[0].data = segmentValues;
    instance.data.datasets[0].backgroundColor = segmentColors;
    instance.data.datasets[0].ranges = segmentRanges;
    instance.options.plugins.gaugeNeedleValue = safeValue;
    instance.update('none');
    return instance;
  }

  return new Chart(canvas.getContext('2d'), {
    type: 'doughnut',
    data: data,
    plugins: [gaugeNeedle],
    options: {
      responsive: true,
      maintainAspectRatio: false,
      layout: {
        padding: { bottom: 20, left: 10, right: 10 }
      },
      // Configuración para mejor soporte touch e interacción
      interaction: {
        mode: 'nearest',
        intersect: true
      },
      plugins: {
        legend: { display: false },
        tooltip: {
          enabled: true,
          position: 'average',
          callbacks: {
            title: (tooltipItems) => {
              const item = tooltipItems[0];
              return item.chart.data.labels[item.dataIndex];
            },
            label: (tooltipItem) => {
              const range = tooltipItem.dataset.ranges[tooltipItem.dataIndex];
              return `Rango: ${range}`;
            }
          }
        },
        gaugeNeedleValue: safeValue
      }
    }
  });
}

function renderDurationPnlScatter(trades) {
  const canvas = document.getElementById('durationPnlScatter');
  if (!canvas || typeof Chart === 'undefined') return;

  const points = [];
  trades.forEach(trade => {
    const pnl = resolveTradePnl(trade);
    if (!Number.isFinite(pnl)) return;
    const open = trade && trade.openTime ? new Date(trade.openTime) : null;
    const close = trade && trade.closeTime ? new Date(trade.closeTime) : null;
    if (!open || !close) return;
    if (!Number.isFinite(open.getTime()) || !Number.isFinite(close.getTime())) return;
    const durationMs = close.getTime() - open.getTime();
    if (!Number.isFinite(durationMs) || durationMs < 0) return;
    const durationMinutes = durationMs / 60000;
    points.push({ x: Number(durationMinutes.toFixed(2)), y: Number(pnl.toFixed(2)) });
  });

  if (durationPnlScatterInstance) {
    durationPnlScatterInstance.data.datasets[0].data = points;
    durationPnlScatterInstance.update();
    return;
  }

  durationPnlScatterInstance = new Chart(canvas.getContext('2d'), {
    type: 'scatter',
    data: {
      datasets: [{
        label: 'Trades',
        data: points,
        pointRadius: 4,
        pointHoverRadius: 6,
        backgroundColor: 'rgba(52, 152, 219, 0.55)',
        borderColor: 'rgba(52, 152, 219, 0.85)'
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false },
        tooltip: {
          callbacks: {
            label: function (context) {
              const x = context.parsed.x ?? 0;
              const y = context.parsed.y ?? 0;
              return `Duración: ${Number(x).toLocaleString('es-MX', { maximumFractionDigits: 2 })} min | PnL: ${formatSignedMoney(Number(y))}`;
            }
          }
        }
      },
      scales: {
        x: {
          title: { display: true, text: 'Duración (min)' },
          ticks: {
            callback: function (value) {
              return Number(value).toLocaleString('es-MX', { maximumFractionDigits: 0 });
            }
          }
        },
        y: {
          title: { display: true, text: 'PnL (MXN)' },
          ticks: {
            callback: function (value) {
              return `$${Number(value).toLocaleString('es-MX', { maximumFractionDigits: 0 })}`;
            }
          }
        }
      }
    }
  });
}

function renderPnlHistogramChart(trades) {
  const canvas = document.getElementById('pnlHistogramChart');
  if (!canvas || typeof Chart === 'undefined') return;

  const values = trades
    .map(resolveTradePnl)
    .filter(value => Number.isFinite(value));

  if (!values.length) {
    if (pnlHistogramChartInstance) {
      pnlHistogramChartInstance.destroy();
      pnlHistogramChartInstance = null;
    }
    return;
  }

  const min = Math.min(...values);
  const max = Math.max(...values);
  const bins = Math.min(14, Math.max(6, Math.round(Math.sqrt(values.length))));
  const range = max - min;
  const width = range === 0 ? 1 : range / bins;
  const counts = new Array(bins).fill(0);

  values.forEach(value => {
    const rawIndex = range === 0 ? Math.floor(bins / 2) : Math.floor((value - min) / width);
    const idx = Math.max(0, Math.min(bins - 1, rawIndex));
    counts[idx] += 1;
  });

  const labels = counts.map((_, idx) => {
    const start = min + idx * width;
    const end = start + width;
    const fmtStart = Number(start.toFixed(0)).toLocaleString('es-MX');
    const fmtEnd = Number(end.toFixed(0)).toLocaleString('es-MX');
    return `$${fmtStart}–$${fmtEnd}`;
  });

  const backgroundColor = labels.map((_, idx) => {
    const mid = min + (idx + 0.5) * width;
    return mid >= 0 ? 'rgba(46, 204, 113, 0.55)' : 'rgba(231, 76, 60, 0.55)';
  });

  if (pnlHistogramChartInstance) {
    pnlHistogramChartInstance.data.labels = labels;
    pnlHistogramChartInstance.data.datasets[0].data = counts;
    pnlHistogramChartInstance.data.datasets[0].backgroundColor = backgroundColor;
    pnlHistogramChartInstance.update();
    return;
  }

  pnlHistogramChartInstance = new Chart(canvas.getContext('2d'), {
    type: 'bar',
    data: {
      labels,
      datasets: [{
        label: 'Frecuencia',
        data: counts,
        backgroundColor,
        borderWidth: 0,
        borderRadius: 8
      }]
    },
    options: {
      responsive: true,
      maintainAspectRatio: false,
      plugins: {
        legend: { display: false }
      },
      scales: {
        x: {
          ticks: { maxRotation: 0, minRotation: 0 },
          grid: { display: false }
        },
        y: {
          beginAtZero: true,
          ticks: { precision: 0 }
        }
      }
    }
  });
}

function renderMonthlyPnlHeatmap(trades) {
  const container = document.getElementById('monthlyPnlHeatmap');
  const titleEl = document.getElementById('monthlyHeatmapTitle');
  const legendEl = document.getElementById('monthlyHeatmapLegend');
  if (!container) return;

  monthlyHeatmapTradesCache = Array.isArray(trades) ? trades : [];
  monthlyHeatmapBounds = computeMonthlyHeatmapBounds(monthlyHeatmapTradesCache);
  const now = new Date();
  const nowMonthIndex = getMonthIndexFromDate(now);
  if (!Number.isFinite(monthlyHeatmapMonthIndex)) {
    monthlyHeatmapMonthIndex = nowMonthIndex;
  }
  if (monthlyHeatmapBounds) {
    monthlyHeatmapMonthIndex = Math.min(monthlyHeatmapBounds.maxIndex, Math.max(monthlyHeatmapBounds.minIndex, monthlyHeatmapMonthIndex));
  } else {
    monthlyHeatmapMonthIndex = nowMonthIndex;
  }

  const selected = getYearMonthFromMonthIndex(monthlyHeatmapMonthIndex);
  const year = selected.year;
  const month = selected.month;
  const monthStart = new Date(year, month, 1);
  const monthEnd = new Date(year, month + 1, 0);
  const daysInMonth = monthEnd.getDate();

  if (titleEl) {
    const monthName = monthStart.toLocaleString('es-ES', { month: 'long' });
    titleEl.textContent = `${monthName.charAt(0).toUpperCase()}${monthName.slice(1)} ${year}`;
  }
  if (legendEl) legendEl.textContent = 'Verde: día positivo · Rojo: día negativo · Gris: sin trades · Número: trades del día';

  updateMonthlyHeatmapNavigationUI();

  const pnlByDay = new Map();
  const tradesCountByDay = new Map();
  trades.forEach(trade => {
    const pnl = resolveTradePnl(trade);
    if (!Number.isFinite(pnl)) return;
    const date = getTradeEffectiveDate(trade);
    if (!date) return;
    if (date.getFullYear() !== year || date.getMonth() !== month) return;
    const day = date.getDate();
    pnlByDay.set(day, (pnlByDay.get(day) || 0) + pnl);
    tradesCountByDay.set(day, (tradesCountByDay.get(day) || 0) + 1);
  });

  const absMax = Math.max(
    1,
    ...Array.from(pnlByDay.values()).map(value => Math.abs(value))
  );

  container.innerHTML = '';
  const mondayIndex = (monthStart.getDay() + 6) % 7;
  for (let i = 0; i < mondayIndex; i++) {
    const spacer = document.createElement('div');
    spacer.className = 'h-12 rounded-lg bg-transparent';
    container.appendChild(spacer);
  }

  for (let day = 1; day <= daysInMonth; day++) {
    const pnl = pnlByDay.has(day) ? pnlByDay.get(day) : null;
    const tradesCount = tradesCountByDay.has(day) ? tradesCountByDay.get(day) : 0;
    const cell = document.createElement('button');
    cell.type = 'button';
    cell.className = 'relative h-12 rounded-lg flex flex-col items-center justify-center text-xs font-semibold border border-gray-100 dark:border-gray-700 focus:outline-none focus:ring-2 focus:ring-orange-500';

    let background = 'rgba(107, 114, 128, 0.10)';
    let color = '#374151';
    if (pnl !== null) {
      const intensity = Math.min(1, Math.max(0.15, Math.abs(pnl) / absMax));
      if (pnl > 0) {
        background = `rgba(46, 204, 113, ${0.15 + 0.55 * intensity})`;
        color = '#064e3b';
      } else if (pnl < 0) {
        background = `rgba(231, 76, 60, ${0.15 + 0.55 * intensity})`;
        color = '#7f1d1d';
      } else {
        background = 'rgba(107, 114, 128, 0.18)';
        color = '#111827';
      }
    }
    cell.style.backgroundColor = background;
    cell.style.color = color;

    const date = new Date(year, month, day);
    const labelDate = date.toLocaleDateString('es-ES', { weekday: 'short', day: '2-digit', month: '2-digit' });
    const labelPnl = pnl === null ? 'Sin trades' : formatSignedMoney(pnl);
    const tradesLabel = pnl === null ? '' : ` · ${tradesCount} ${tradesCount === 1 ? 'trade' : 'trades'}`;
    cell.title = `${labelDate} · ${labelPnl}${tradesLabel}`;
    cell.setAttribute('aria-label', `${labelDate}. ${labelPnl}${tradesLabel}.`);

    const dayEl = document.createElement('div');
    dayEl.textContent = String(day);
    dayEl.className = 'leading-none';
    cell.appendChild(dayEl);

    const pnlEl = document.createElement('div');
    pnlEl.className = 'leading-none opacity-80';
    pnlEl.textContent = pnl === null ? '' : (pnl > 0 ? '+' : '') + parseFloat(pnl).toFixed(2).replace(/\.?0+$/, '');
    cell.appendChild(pnlEl);

    if (pnl !== null && tradesCount > 0) {
      const countEl = document.createElement('div');
      countEl.className = 'absolute top-1 right-1 px-1.5 py-0.5 rounded-md text-[10px] leading-none bg-white/70 dark:bg-gray-900/40 text-gray-700 dark:text-gray-200 border border-white/50 dark:border-gray-700/60';
      countEl.textContent = String(tradesCount);
      cell.appendChild(countEl);
    }

    container.appendChild(cell);
  }
}

function renderStats() {
  const snapshot = typeof getTradingViewSnapshot === 'function' ? getTradingViewSnapshot() : null;
  const allTrades = snapshot && Array.isArray(snapshot.trades)
    ? snapshot.trades
    : (JSON.parse(localStorage.getItem('trades')) || []);
  const trades = applyStatsTimeFilterToTrades(allTrades);
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
  const volume = trades.reduce((sum, trade) => {
    const margin = trade ? parseFloat(trade.margin) : NaN;
    return sum + (Number.isFinite(margin) ? margin : 0);
  }, 0);

  const tradesForDrawdown = trades
    .map(trade => {
      const date = typeof getTradeEffectiveDate === 'function' ? getTradeEffectiveDate(trade) : null;
      const fallbackDate = trade && trade.openTime ? new Date(trade.openTime) : null;
      const resolvedDate = date || fallbackDate;
      if (!resolvedDate || !Number.isFinite(resolvedDate.getTime())) return null;
      const value = resolveTradePnl(trade);
      if (!Number.isFinite(value)) return null;
      return { date: resolvedDate, pnl: value };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.getTime() - b.date.getTime());
  let equity = 0;
  let peakEquity = 0;
  let maxDrawdown = 0;
  tradesForDrawdown.forEach(item => {
    equity += item.pnl;
    if (equity > peakEquity) peakEquity = equity;
    const drawdown = equity - peakEquity;
    if (drawdown < maxDrawdown) maxDrawdown = drawdown;
  });

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
  const winPercentElement = document.getElementById('winPercent');
  const lossPercentElement = document.getElementById('lossPercent');
  const bePercentElement = document.getElementById('bePercent');
  const winSegment = document.getElementById('winSegment');
  const lossSegment = document.getElementById('lossSegment');
  const beSegment = document.getElementById('beSegment');
  const winRateIcon = document.getElementById('winRateIcon');
  const totalProfitElement = document.getElementById('totalProfit');
  const totalProfitPercentElement = document.getElementById('totalProfitPercent');
  const avgProfitPercentElement = document.getElementById('avgProfitPercent');
  const totalVolumeElement = document.getElementById('totalVolume');
  const worstLossElement = document.getElementById('worstLoss');
  const maxDrawdownElement = document.getElementById('maxDrawdown');
  const profitRiskRatioElement = document.getElementById('profitRiskRatio');
  const breakevenTradesElement = document.getElementById('breakevenTrades');

  if (totalTradesElement) totalTradesElement.textContent = total;
  if (winningTradesElement) winningTradesElement.textContent = winningTrades;
  if (losingTradesElement) losingTradesElement.textContent = losingTrades;
  if (breakevenTradesElement) breakevenTradesElement.textContent = breakevenTrades;
  if (winRateElement) {
    const winRateVal = parseFloat(winRate);
    winRateElement.textContent = `${winRate}%`;

    // Actualizar segmentos de la barra y porcentajes
    if (total > 0) {
      const winP = (winningTrades / total) * 100;
      const lossP = (losingTrades / total) * 100;
      const beP = (breakevenTrades / total) * 100;

      if (winSegment) winSegment.style.width = `${winP}%`;
      if (lossSegment) lossSegment.style.width = `${lossP}%`;
      if (beSegment) beSegment.style.width = `${beP}%`;

      if (winPercentElement) winPercentElement.textContent = `(${winP.toFixed(1)}%)`;
      if (lossPercentElement) lossPercentElement.textContent = `(${lossP.toFixed(1)}%)`;
      if (bePercentElement) bePercentElement.textContent = `(${beP.toFixed(1)}%)`;
    } else {
      if (winSegment) winSegment.style.width = '0%';
      if (lossSegment) lossSegment.style.width = '0%';
      if (beSegment) beSegment.style.width = '0%';

      if (winPercentElement) winPercentElement.textContent = '(0%)';
      if (lossPercentElement) lossPercentElement.textContent = '(0%)';
      if (bePercentElement) bePercentElement.textContent = '(0%)';
    }

    // Actualizar icono de tendencia
    if (winRateIcon) {
      winRateIcon.textContent = winRateVal >= 50 ? '📈' : '📉';
      winRateIcon.className = winRateVal >= 50 ? 'text-green-500' : 'text-red-500';
    }

    if (winRateVal >= 80) {
      winRateElement.className = 'text-2xl font-black text-green-500';
    } else if (winRateVal >= 51) {
      winRateElement.className = 'text-2xl font-black text-blue-500';
    } else if (winRateVal >= 30) {
      winRateElement.className = 'text-2xl font-black text-orange-500';
    } else {
      winRateElement.className = 'text-2xl font-black text-red-500';
    }
  }

  // Actualizar estadísticas de rendimiento
  if (totalProfitElement) {
    totalProfitElement.textContent = `${pnl.toFixed(2)} MXN`;
    totalProfitElement.className = `stat-value ${pnl >= 0 ? 'positive' : 'negative'}`;
  }
  if (totalVolumeElement) {
    totalVolumeElement.textContent = `$${volume.toLocaleString('es-MX', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
  }
  if (worstLossElement) {
    worstLossElement.textContent = formatSignedMoney(worst);
    worstLossElement.className = `stat-value ${worst >= 0 ? 'positive' : 'negative'}`;
  }
  if (maxDrawdownElement) {
    maxDrawdownElement.textContent = formatSignedMoney(maxDrawdown);
    maxDrawdownElement.className = `stat-value ${maxDrawdown >= 0 ? 'positive' : 'negative'}`;
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

  // Cálculo de PNL Porcentaje y Promedio Porcentaje por Trade
  const tradesWithPercent = trades.filter(t => t.resultMetricType === 'percent' && t.pips !== undefined && t.pips !== null && t.pips !== '');
  const totalPercent = tradesWithPercent.reduce((sum, t) => sum + parseFloat(t.pips), 0);
  const avgPercent = tradesWithPercent.length ? (totalPercent / tradesWithPercent.length) : 0;

  // Actualizar tarjetas de porcentajes
  if (totalProfitPercentElement) {
    totalProfitPercentElement.textContent = `${totalPercent.toFixed(2)}%`;
    totalProfitPercentElement.className = `text-2xl font-bold ${totalPercent >= 0 ? 'text-green-500' : 'text-red-500'}`;
  }
  if (avgProfitPercentElement) {
    avgProfitPercentElement.textContent = `${avgPercent.toFixed(2)}%`;
    avgProfitPercentElement.className = `text-2xl font-bold ${avgPercent >= 0 ? 'text-green-500' : 'text-red-500'}`;
  }

  // Actualizar tarjetas de pips
  const totalPipsElement = document.getElementById('totalPips');
  const avgPipsElement = document.getElementById('avgPips');
  if (totalPipsElement) totalPipsElement.textContent = `${totalPips.toFixed(3)} pips`;
  if (avgPipsElement) avgPipsElement.textContent = `${avgPips.toFixed(3)} pips`;

  // Cálculo de Max. Ganancia (MXN) y Promedio Ganancia (MXN)
  const tradesWithMxn = trades.filter(t => t.resultMxn !== undefined && t.resultMxn !== null && t.resultMxn !== '');
  const maxProfit = tradesWithMxn.length ? Math.max(...tradesWithMxn.map(t => parseFloat(t.resultMxn))) : 0;
  const avgWinningProfit = winningTrades ? gains / winningTrades : null;

  // Actualizar tarjetas de ganancias monetarias
  const maxProfitElement = document.getElementById('maxProfit');
  const avgProfitElement = document.getElementById('avgProfit');
  if (maxProfitElement) maxProfitElement.textContent = `$${maxProfit.toFixed(2)}`;
  if (avgProfitElement) avgProfitElement.textContent = avgWinningProfit === null ? '-' : `$${avgWinningProfit.toFixed(2)}`;

  renderCapitalEvolutionChart(getStatsTimeFilterRange());

  const robustProfitFactorEl = document.getElementById('robustProfitFactor');
  const robustProfitFactorHintEl = document.getElementById('robustProfitFactorHint');
  const robustExpectancyEl = document.getElementById('robustExpectancy');
  const robustSqnEl = document.getElementById('robustSqn');
  const robustSqnHintEl = document.getElementById('robustSqnHint');
  const maxWinStreakEl = document.getElementById('maxWinStreak');
  const maxLossStreakEl = document.getElementById('maxLossStreak');
  const dirLongTradesEl = document.getElementById('dirLongTrades');
  const dirLongWinRateEl = document.getElementById('dirLongWinRate');
  const dirLongPnlEl = document.getElementById('dirLongPnl');
  const dirShortTradesEl = document.getElementById('dirShortTrades');
  const dirShortWinRateEl = document.getElementById('dirShortWinRate');
  const dirShortPnlEl = document.getElementById('dirShortPnl');

  const returns = trades
    .map(resolveTradePnl)
    .filter(value => Number.isFinite(value));

  const pfValue = Number.isFinite(gains) && Number.isFinite(losses) && Math.abs(losses) > 0
    ? gains / Math.abs(losses)
    : null;

  const pfSegments = [
    { limit: 1.0, color: 'rgba(231, 76, 60, 0.6)', label: 'Negativo' },
    { limit: 1.5, color: 'rgba(243, 156, 18, 0.6)', label: 'Break-even+' },
    { limit: 2.0, color: 'rgba(46, 204, 113, 0.6)', label: 'Bueno' },
    { limit: 4.0, color: 'rgba(39, 174, 96, 0.8)', label: 'Excelente' }
  ];

  // Actualizar Ratio B/R (Profit Factor) con color inteligente
  if (profitRiskRatioElement) {
    profitRiskRatioElement.textContent = pfValue === null ? '-' : pfValue.toFixed(2);
    let pfColor = 'inherit';
    if (pfValue !== null) {
      const segment = pfSegments.find(s => pfValue <= s.limit) || pfSegments[pfSegments.length - 1];
      pfColor = segment.color.replace('0.6', '1').replace('0.8', '1');
    }
    profitRiskRatioElement.style.color = pfColor;
    profitRiskRatioElement.className = 'text-2xl font-bold';
  }

  if (robustProfitFactorEl) {
    robustProfitFactorEl.textContent = pfValue === null ? '-' : pfValue.toFixed(2);
    // Color inteligente basado en el rango
    let pfColor = 'inherit';
    if (pfValue !== null) {
      const segment = pfSegments.find(s => pfValue <= s.limit) || pfSegments[pfSegments.length - 1];
      pfColor = segment.color.replace('0.6', '1').replace('0.8', '1'); // Hacerlo opaco para el texto
    }
    robustProfitFactorEl.style.color = pfColor;
    robustProfitFactorEl.className = 'text-xl font-bold';
  }

  // Renderizar Gauge de Profit Factor
  pfGaugeChartInstance = renderGaugeChart('pfGaugeChart', pfValue, pfSegments, 4.0, pfGaugeChartInstance);

  if (robustProfitFactorHintEl) {
    let hint = '-';
    if (pfValue !== null) {
      const segment = pfSegments.find(s => pfValue <= s.limit) || pfSegments[pfSegments.length - 1];
      hint = segment.label;
    }
    robustProfitFactorHintEl.textContent = hint;
  }

  const expectancy = total ? pnl / total : null;
  if (robustExpectancyEl) {
    robustExpectancyEl.textContent = expectancy === null ? '-' : `${formatSignedMoney(expectancy)} / trade`;
    robustExpectancyEl.className = `text-xl font-bold ${expectancy !== null && expectancy >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`;
  }

  // --- NUEVAS MÉTRICAS INSTITUCIONALES (Sharpe & Risk of Ruin) ---
  const robustSharpeEl = document.getElementById('robustSharpe');
  const riskOfRuinEl = document.getElementById('riskOfRuin');

  // 1. Ratio de Sharpe (Simplificado: Trade-based, Rf=0)
  // Sharpe = Promedio Retornos / Desviación Estándar Retornos
  let sharpeRatio = null;
  if (returns.length > 1) {
    const mean = returns.reduce((a, b) => a + b, 0) / returns.length;
    const variance = returns.reduce((a, b) => a + Math.pow(b - mean, 2), 0) / returns.length;
    const stdDev = Math.sqrt(variance);

    if (stdDev > 0) {
      sharpeRatio = mean / stdDev;
    }
  }

  if (robustSharpeEl) {
    robustSharpeEl.textContent = sharpeRatio === null ? '-' : sharpeRatio.toFixed(2);
    // Color: > 1.0 bueno (verde), > 0.0 ok (gris/verde), < 0 malo (rojo)
    if (sharpeRatio !== null) {
      if (sharpeRatio >= 1.0) robustSharpeEl.className = 'text-xl font-bold text-green-600 dark:text-green-400';
      else if (sharpeRatio >= 0) robustSharpeEl.className = 'text-xl font-bold text-gray-700 dark:text-gray-300';
      else robustSharpeEl.className = 'text-xl font-bold text-red-600 dark:text-red-400';
    } else {
      robustSharpeEl.className = 'text-xl font-bold';
    }
  }

  // 2. Risk of Ruin
  // Formula: ((1 - WR) / (1 + WR)) ^ Units
  // Asumimos 30 unidades de riesgo como solicitado
  let riskOfRuin = null;
  const totalTradesCount = trades.length;
  if (totalTradesCount > 0) {
    const winningTradesCount = trades.filter(t => parseFloat(t.resultMxn) > 0).length;
    const winRateDecimal = winningTradesCount / totalTradesCount;

    // Evitar división por cero implícita y casos extremos
    const numerator = 1 - winRateDecimal;
    const denominator = 1 + winRateDecimal;

    if (denominator > 0) {
      // Risk of Ruin con 30 unidades
      const unitsOfRisk = 30;
      const roRValue = Math.pow(numerator / denominator, unitsOfRisk);

      // Convertir a porcentaje
      riskOfRuin = roRValue * 100;

      // Capar a 100% y 0% por si acaso
      riskOfRuin = Math.min(100, Math.max(0, riskOfRuin));
    }
  }

  if (riskOfRuinEl) {
    if (riskOfRuin !== null) {
      // Mostrar < 0.01% como "< 0.01%" para limpieza visual
      if (riskOfRuin < 0.01 && riskOfRuin > 0) {
        riskOfRuinEl.textContent = '< 0.01%';
      } else {
        riskOfRuinEl.textContent = riskOfRuin.toFixed(2) + '%';
      }

      // Lógica de colores: < 1% verde, > 5% rojo, intermedio amarillo/gris
      if (riskOfRuin < 1) {
        riskOfRuinEl.className = 'text-xl font-bold text-green-600 dark:text-green-400';
      } else if (riskOfRuin > 5) {
        riskOfRuinEl.className = 'text-xl font-bold text-red-600 dark:text-red-400';
      } else {
        riskOfRuinEl.className = 'text-xl font-bold text-yellow-600 dark:text-yellow-400';
      }
    } else {
      riskOfRuinEl.textContent = '-';
      riskOfRuinEl.className = 'text-xl font-bold';
    }
  }

  const sqn = calculateSqnFromReturns(returns);
  const sqnSegments = [
    { limit: 1.6, color: 'rgba(231, 76, 60, 0.6)', label: 'Pobre' },
    { limit: 2.0, color: 'rgba(243, 156, 18, 0.6)', label: 'Promedio' },
    { limit: 2.5, color: 'rgba(46, 204, 113, 0.6)', label: 'Bueno' },
    { limit: 3.0, color: 'rgba(39, 174, 96, 0.8)', label: 'Muy bueno' },
    { limit: 5.0, color: 'rgba(52, 152, 219, 0.8)', label: 'Excelente' }
  ];

  if (robustSqnEl) {
    robustSqnEl.textContent = sqn === null ? '-' : sqn.toFixed(2);
    // Color inteligente basado en el rango
    let sqnColor = 'inherit';
    if (sqn !== null) {
      const segment = sqnSegments.find(s => sqn <= s.limit) || sqnSegments[sqnSegments.length - 1];
      sqnColor = segment.color.replace('0.6', '1').replace('0.8', '1'); // Hacerlo opaco para el texto
    }
    robustSqnEl.style.color = sqnColor;
    robustSqnEl.className = 'text-xl font-bold';
  }

  // Renderizar Gauge de SQN
  sqnGaugeChartInstance = renderGaugeChart('sqnGaugeChart', sqn, sqnSegments, 5.0, sqnGaugeChartInstance);

  if (robustSqnHintEl) {
    let hint = '-';
    if (sqn !== null) {
      const segment = sqnSegments.find(s => sqn <= s.limit) || sqnSegments[sqnSegments.length - 1];
      hint = segment.label;
    }
    robustSqnHintEl.textContent = hint;
  }

  const tradesSortedForStreaks = trades
    .map(trade => {
      const date = getTradeEffectiveDate(trade);
      const pnl = resolveTradePnl(trade);
      if (!date || !Number.isFinite(pnl)) return null;
      return { date, pnl };
    })
    .filter(Boolean)
    .sort((a, b) => a.date.getTime() - b.date.getTime());

  const pnlSeries = tradesSortedForStreaks.map(item => item.pnl);
  const maxWinStreak = calculateMaxStreak(pnlSeries, value => value > 0);
  const maxLossStreak = calculateMaxStreak(pnlSeries, value => value < 0);
  if (maxWinStreakEl) maxWinStreakEl.textContent = maxWinStreak ? String(maxWinStreak) : '0';
  if (maxLossStreakEl) maxLossStreakEl.textContent = maxLossStreak ? String(maxLossStreak) : '0';

  const directional = {
    long: { trades: 0, wins: 0, pnl: 0 },
    short: { trades: 0, wins: 0, pnl: 0 }
  };
  trades.forEach(trade => {
    const dir = trade && trade.direction === 'short' ? 'short' : (trade && trade.direction === 'long' ? 'long' : null);
    if (!dir) return;
    const pnl = resolveTradePnl(trade);
    if (!Number.isFinite(pnl)) return;
    directional[dir].trades += 1;
    directional[dir].pnl += pnl;
    if (pnl > 0) directional[dir].wins += 1;
  });
  const longWinRate = directional.long.trades ? (directional.long.wins / directional.long.trades) * 100 : null;
  const shortWinRate = directional.short.trades ? (directional.short.wins / directional.short.trades) * 100 : null;
  if (dirLongTradesEl) dirLongTradesEl.textContent = String(directional.long.trades);
  if (dirLongWinRateEl) dirLongWinRateEl.textContent = longWinRate === null ? '-' : formatSignedPercent(longWinRate);
  if (dirLongPnlEl) {
    dirLongPnlEl.textContent = directional.long.trades ? formatSignedMoney(Number(directional.long.pnl.toFixed(2))) : '-';
    dirLongPnlEl.className = `py-2 pr-4 ${directional.long.pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`;
  }
  if (dirShortTradesEl) dirShortTradesEl.textContent = String(directional.short.trades);
  if (dirShortWinRateEl) dirShortWinRateEl.textContent = shortWinRate === null ? '-' : formatSignedPercent(shortWinRate);
  if (dirShortPnlEl) {
    dirShortPnlEl.textContent = directional.short.trades ? formatSignedMoney(Number(directional.short.pnl.toFixed(2))) : '-';
    dirShortPnlEl.className = `py-2 pr-4 ${directional.short.pnl >= 0 ? 'text-green-600 dark:text-green-400' : 'text-red-600 dark:text-red-400'}`;
  }

  renderResultReasonInsights(trades);
  renderWeekdayPnlChart(trades);
  renderDurationPnlScatter(trades);
  renderPnlHistogramChart(trades);
  renderMonthlyPnlHeatmap(allTrades);
  performanceRankingTradesCache = trades;
  renderPerformanceRanking(performanceRankingMode);

  // === Cálculo de Holding Promedio ===
  const tradesWithTimes = trades.filter(t => t.openTime && t.closeTime);
  let avgHoldingMs = 0;
  let avgHoldingWinMs = 0;
  let avgHoldingLossMs = 0;

  if (tradesWithTimes.length > 0) {
    const totalHoldingMs = tradesWithTimes.reduce((sum, t) => {
      const open = new Date(t.openTime);
      const close = new Date(t.closeTime);
      return sum + (close - open);
    }, 0);
    avgHoldingMs = totalHoldingMs / tradesWithTimes.length;

    const winningWithTimes = tradesWithTimes.filter(t => parseFloat(t.resultMxn) > 0);
    if (winningWithTimes.length > 0) {
      const totalWinHoldingMs = winningWithTimes.reduce((sum, t) => {
        const open = new Date(t.openTime);
        const close = new Date(t.closeTime);
        return sum + (close - open);
      }, 0);
      avgHoldingWinMs = totalWinHoldingMs / winningWithTimes.length;
    }

    const losingWithTimes = tradesWithTimes.filter(t => parseFloat(t.resultMxn) < 0);
    if (losingWithTimes.length > 0) {
      const totalLossHoldingMs = losingWithTimes.reduce((sum, t) => {
        const open = new Date(t.openTime);
        const close = new Date(t.closeTime);
        return sum + (close - open);
      }, 0);
      avgHoldingLossMs = totalLossHoldingMs / losingWithTimes.length;
    }
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
  const avgHoldingWinElement = document.getElementById('avgHoldingWin');
  const avgHoldingLossElement = document.getElementById('avgHoldingLoss');

  if (avgHoldingElement) avgHoldingElement.textContent = formatDuration(avgHoldingMs);
  if (avgHoldingWinElement) avgHoldingWinElement.textContent = formatDuration(avgHoldingWinMs);
  if (avgHoldingLossElement) avgHoldingLossElement.textContent = formatDuration(avgHoldingLossMs);

  // === Cálculo de Horario Favorito (franjas de 4 horas) y Heatmap 24h ===
  const hourRanges = [
    { label: '00:00-03:59', start: 0, end: 3 },
    { label: '04:00-07:59', start: 4, end: 7 },
    { label: '08:00-11:59', start: 8, end: 11 },
    { label: '12:00-15:59', start: 12, end: 15 },
    { label: '16:00-19:59', start: 16, end: 19 },
    { label: '20:00-23:59', start: 20, end: 23 }
  ];
  const hourCounts = Array(hourRanges.length).fill(0);
  const hourly24Data = Array(24).fill(null).map(() => ({ count: 0, pnl: 0 }));

  tradesWithTimes.forEach(t => {
    const open = new Date(t.openTime);
    const hour = open.getHours();
    const pnl = parseFloat(t.resultMxn) || 0;

    // Para franjas de 4h
    for (let i = 0; i < hourRanges.length; i++) {
      if (hour >= hourRanges[i].start && hour <= hourRanges[i].end) {
        hourCounts[i]++;
        break;
      }
    }

    // Para heatmap de 24h
    hourly24Data[hour].count++;
    hourly24Data[hour].pnl += pnl;
  });

  let maxCount = Math.max(...hourCounts);
  let favoriteRange = '-';
  if (maxCount > 0) {
    const idx = hourCounts.indexOf(maxCount);
    favoriteRange = hourRanges[idx].label + ` (${maxCount} ops)`;
  }
  const favoriteHourElement = document.getElementById('favoriteHour');
  if (favoriteHourElement) favoriteHourElement.textContent = favoriteRange;

  // Renderizar Heatmap de 24h
  const heatmapContainer = document.getElementById('hourHeatmapContainer');
  const heatmapTotalEl = document.getElementById('hourHeatmapTotal');
  const heatmapDetailEl = document.getElementById('hourHeatmapDetail');

  if (heatmapContainer) {
    heatmapContainer.innerHTML = '';
    const counts = hourly24Data.map(d => d.count);
    const maxHourly = Math.max(...counts);
    if (heatmapTotalEl) heatmapTotalEl.textContent = `${tradesWithTimes.length} ops`;

    hourly24Data.forEach((data, hour) => {
      const { count, pnl } = data;
      const block = document.createElement('div');
      const timeStr = `${hour.toString().padStart(2, '0')}:00`;
      const pnlStr = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' }).format(pnl);
      const detailText = `${timeStr} — ${count} ops | PnL: ${pnlStr}`;

      block.className = 'h-4 rounded-sm transition-all duration-300 hover:scale-110 cursor-pointer active:scale-95';
      block.title = detailText; // Para desktop (hover)

      if (count === 0) {
        block.classList.add('bg-gray-100', 'dark:bg-gray-700', 'opacity-30');
      } else {
        // Escala de colores según PnL (Verde si > 0, Rojo si <= 0)
        // Intensidad según volumen (count)
        const intensity = maxHourly > 0 ? (count / maxHourly) : 0;

        if (pnl > 0) {
          // Verdes
          if (intensity <= 0.25) block.classList.add('bg-green-200', 'dark:bg-green-900/40');
          else if (intensity <= 0.5) block.classList.add('bg-green-400', 'dark:bg-green-700/60');
          else if (intensity <= 0.75) block.classList.add('bg-green-500', 'dark:bg-green-600');
          else block.classList.add('bg-green-600', 'dark:bg-green-400');
        } else {
          // Rojos
          if (intensity <= 0.25) block.classList.add('bg-red-200', 'dark:bg-red-900/40');
          else if (intensity <= 0.5) block.classList.add('bg-red-400', 'dark:bg-red-700/60');
          else if (intensity <= 0.75) block.classList.add('bg-red-500', 'dark:bg-red-600');
          else block.classList.add('bg-red-600', 'dark:bg-red-400');
        }
      }

      // Evento para touch/click
      block.addEventListener('click', () => {
        if (heatmapDetailEl) {
          heatmapDetailEl.textContent = detailText;
          // Color dinámico según PnL
          heatmapDetailEl.className = `mt-2 text-[10px] text-center font-medium min-h-[15px] ${pnl > 0 ? 'text-green-500' : pnl < 0 ? 'text-red-500' : 'text-gray-500'}`;

          // Pequeña animación de feedback
          heatmapDetailEl.classList.remove('animate-pulse');
          void heatmapDetailEl.offsetWidth; // Trigger reflow
          heatmapDetailEl.classList.add('animate-pulse');
        }
      });

      heatmapContainer.appendChild(block);
    });
  }

  const sampleSizeCriterionValue = document.querySelector('#criterion-samplesize .criterion-value');
  const winrateCriterionValue = document.querySelector('#criterion-winrate .criterion-value');
  const expectancyCriterionValue = document.querySelector('#criterion-expectancy .criterion-value');
  const profitFactorCriterionValue = document.querySelector('#criterion-profitfactor .criterion-value');
  const recoveryCriterionValue = document.querySelector('#criterion-recovery .criterion-value');
  const lossStreakCriterionValue = document.querySelector('#criterion-lossstreak .criterion-value');

  const sampleSizeCriterionScore = document.querySelector('#criterion-samplesize .criterion-score');
  const winrateCriterionScore = document.querySelector('#criterion-winrate .criterion-score');
  const expectancyCriterionScore = document.querySelector('#criterion-expectancy .criterion-score');
  const profitFactorCriterionScore = document.querySelector('#criterion-profitfactor .criterion-score');
  const recoveryCriterionScore = document.querySelector('#criterion-recovery .criterion-score');
  const lossStreakCriterionScore = document.querySelector('#criterion-lossstreak .criterion-score');

  const recoveryFactor = (() => {
    const absDrawdown = Math.abs(maxDrawdown);
    if (!(pnl > 0)) return null;
    if (absDrawdown === 0) return Infinity;
    return pnl / absDrawdown;
  })();

  if (sampleSizeCriterionValue) sampleSizeCriterionValue.textContent = `${total} ops`;
  if (winrateCriterionValue) winrateCriterionValue.textContent = `${winRate}%`;
  if (expectancyCriterionValue) expectancyCriterionValue.textContent = expectancy === null ? '-' : formatSignedMoney(expectancy);
  if (profitFactorCriterionValue) profitFactorCriterionValue.textContent = pfValue === null ? '-' : pfValue.toFixed(2);
  if (recoveryCriterionValue) {
    recoveryCriterionValue.textContent = recoveryFactor === null ? '-' : (recoveryFactor === Infinity ? '∞' : recoveryFactor.toFixed(2));
  }
  if (lossStreakCriterionValue) lossStreakCriterionValue.textContent = String(maxLossStreak ? maxLossStreak : 0);

  const applyCriterionScore = (element, passed) => {
    if (!element) return;
    element.textContent = passed ? '✅' : '❌';
    element.className = `criterion-score ${passed ? 'scored' : 'not-scored'}`;
  };

  const criteria = [
    { passed: total >= 30, scoreEl: sampleSizeCriterionScore },
    { passed: Number.parseFloat(winRate) >= 50, scoreEl: winrateCriterionScore },
    { passed: expectancy !== null && expectancy >= 0, scoreEl: expectancyCriterionScore },
    { passed: pfValue !== null && pfValue >= 1.3, scoreEl: profitFactorCriterionScore },
    { passed: recoveryFactor !== null && recoveryFactor >= 1.0, scoreEl: recoveryCriterionScore },
    { passed: (maxLossStreak ? maxLossStreak : 0) <= 5, scoreEl: lossStreakCriterionScore }
  ];

  criteria.forEach(item => applyCriterionScore(item.scoreEl, item.passed));
  const totalScore = criteria.reduce((sum, item) => sum + (item.passed ? 1 : 0), 0);
  const criteriaCount = criteria.length;

  const ratio = criteriaCount ? totalScore / criteriaCount : 0;
  let performanceRating = '';
  let ratingColor = '';
  if (ratio >= 1) {
    performanceRating = `Excelente (${totalScore}/${criteriaCount})`;
    ratingColor = '#10b981';
  } else if (ratio >= 2 / 3) {
    performanceRating = `Bueno (${totalScore}/${criteriaCount})`;
    ratingColor = '#3b82f6';
  } else if (ratio >= 1 / 3) {
    performanceRating = `Regular (${totalScore}/${criteriaCount})`;
    ratingColor = '#f59e0b';
  } else {
    performanceRating = `Mejorable (${totalScore}/${criteriaCount})`;
    ratingColor = '#ef4444';
  }

  const performanceRatingSummaryElement = document.getElementById('performanceRatingSummary');
  if (performanceRatingSummaryElement) {
    performanceRatingSummaryElement.textContent = `Calificación: ${performanceRating}`;
    performanceRatingSummaryElement.style.color = ratingColor;
    performanceRatingSummaryElement.style.fontWeight = 'bold';
  }

  const performanceProgressBarFill = document.getElementById('performanceProgressBarFill');
  const performanceProgressBarMarker = document.getElementById('performanceProgressBarMarker');
  const currentProgressLabel = document.getElementById('currentProgressLabel');
  const percentage = criteriaCount ? (totalScore / criteriaCount) * 100 : 0;

  if (performanceProgressBarFill) {
    performanceProgressBarFill.style.width = `${percentage.toFixed(2)}%`;
    performanceProgressBarFill.style.backgroundColor = ratingColor;
  }
  if (performanceProgressBarMarker) {
    performanceProgressBarMarker.style.left = `${percentage.toFixed(2)}%`;
  }
  if (currentProgressLabel) {
    currentProgressLabel.textContent = `${percentage.toFixed(0)}%`;
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

document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('diaryContainer')) {
    renderDiary();
  }

  if (document.getElementById('statsContainer')) {
    renderStats();
  }

  // Añadir funcionalidad a los desplegables
  const collapsibleHeaders = document.querySelectorAll('.collapsible-header');

  collapsibleHeaders.forEach(header => {
    header.addEventListener('click', function () {
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

function safeParseArrayFromStorage(raw) {
  if (!raw) return [];
  try {
    const parsed = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed : [];
  } catch (error) {
    return [];
  }
}

function getTradingViewMode() {
  const select = document.getElementById('view-mode-select');
  return select && select.value === 'all' ? 'all' : 'active';
}

function getTradingViewSnapshot() {
  if (getTradingViewMode() !== 'all') {
    return {
      username: localStorage.getItem('username') || 'Usuario',
      initialCapital: parseFloat(localStorage.getItem('initialCapital') || '0'),
      trades: safeParseArrayFromStorage(localStorage.getItem('trades')),
      capitalMovements: safeParseArrayFromStorage(localStorage.getItem('capitalMovements')),
      capitalStartDate: localStorage.getItem('capitalStartDate')
    };
  }

  const accounts = typeof getAccountsMeta === 'function' ? getAccountsMeta() : [];
  const trades = [];
  const capitalMovements = [];
  let initialCapital = 0;
  let earliestStartDate = null;
  accounts.forEach(account => {
    if (!account || !account.id) return;
    if (typeof readAccountData !== 'function') return;
    const data = readAccountData(account.id);
    if (data && Array.isArray(data.trades)) trades.push(...data.trades);
    if (data && Array.isArray(data.capitalMovements)) capitalMovements.push(...data.capitalMovements);
    const cap = data && data.initialCapital !== null && data.initialCapital !== undefined ? parseFloat(data.initialCapital) : 0;
    if (Number.isFinite(cap)) initialCapital += cap;
    if (data && data.capitalStartDate) {
      const date = new Date(data.capitalStartDate);
      if (Number.isFinite(date.getTime())) {
        if (!earliestStartDate || date < earliestStartDate) earliestStartDate = date;
      }
    }
  });
  const capitalStartDate = earliestStartDate ? earliestStartDate.toISOString() : null;
  return {
    username: 'Todas las cuentas',
    initialCapital: Number.isFinite(initialCapital) ? initialCapital : 0,
    trades,
    capitalMovements,
    capitalStartDate
  };
}

function getCapitalHistory(period) {
  const snapshot = getTradingViewSnapshot();
  let initialCapital = snapshot.initialCapital;
  let trades = Array.isArray(snapshot.trades) ? snapshot.trades : [];
  // Buscar la fecha más antigua entre el saldo inicial y el trade más antiguo
  let firstTradeDate = trades.length > 0 ? new Date(Math.min(...trades.map(t => new Date(t.openTime).getTime()))) : new Date();
  let capitalStartDate = snapshot.capitalStartDate;
  let startDate;
  const today = new Date();
  switch (period) {
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
  const snapshot = getTradingViewSnapshot();
  const username = snapshot.username || 'Usuario';
  const welcomeMessage = document.getElementById('welcome-message');
  if (welcomeMessage) {
    welcomeMessage.textContent = getTradingViewMode() === 'all' ? 'Hola, Todas las cuentas' : `Hola, ${username}`;
  }

  let initialCapital = Number(snapshot && snapshot.initialCapital);
  if (!Number.isFinite(initialCapital)) initialCapital = 0;

  const trades = snapshot && Array.isArray(snapshot.trades) ? snapshot.trades : [];
  const movements = snapshot && Array.isArray(snapshot.capitalMovements) ? snapshot.capitalMovements : [];
  const capitalStartDate = snapshot && snapshot.capitalStartDate ? clampValidDate(new Date(snapshot.capitalStartDate)) : null;
  const baselineDate = capitalStartDate || null;

  const events = [];
  trades.forEach(trade => {
    const date = typeof getTradeEffectiveDate === 'function' ? getTradeEffectiveDate(trade) : null;
    if (!date || !Number.isFinite(date.getTime())) return;
    if (baselineDate && date < baselineDate) return;
    const value = parseFloat(trade && trade.resultMxn);
    if (!Number.isFinite(value)) return;
    events.push({ date, value });
  });
  movements.forEach(movement => {
    if (!movement) return;
    const date = movement.date ? new Date(movement.date) : null;
    if (!date || Number.isNaN(date.getTime())) return;
    if (baselineDate && date < baselineDate) return;
    const rawAmount = parseFloat(movement.amount);
    if (!Number.isFinite(rawAmount)) return;
    const value = movement.type === 'retiro' ? -Math.abs(rawAmount) : Math.abs(rawAmount);
    events.push({ date, value });
  });
  events.sort((a, b) => a.date.getTime() - b.date.getTime());

  const now = new Date();
  const periodMode = period === 'yearly' ? 'yearly' : (period === 'weekly' ? 'weekly' : 'monthly');
  const periodStart = periodMode === 'yearly' ? startOfYear(now) : (periodMode === 'weekly' ? startOfWeekSunday(now) : startOfMonth(now));

  const currentBalance = computeCapitalAtDate(events, initialCapital, now, true);
  const baseBalance = computeCapitalAtDate(events, initialCapital, periodStart, false);
  const ganancia = roundMoney(currentBalance - baseBalance);
  const balance = currentBalance;

  const balanceElement = document.getElementById('capital-balance');
  const roiElement = document.getElementById('capital-roi');
  if (balanceElement) {
    balanceElement.textContent = `$${balance.toFixed(2)}`;
    balanceElement.style.color = balance >= initialCapital ? '#2ecc71' : '#e74c3c';
    balanceElement.style.fontWeight = 'bold';
    balanceElement.style.fontSize = '2.2em';
    balanceElement.style.display = 'none';
  }
  if (roiElement) {
    roiElement.textContent = `PNL del período: ${ganancia >= 0 ? '+' : ''}$${ganancia.toFixed(2)}`; // Añadir etiqueta y mostrar solo la ganancia/pérdida
    roiElement.style.color = ganancia >= 0 ? '#00b894' : '#e74c3c'; // Mantener el color basado en la ganancia/pérdida
    roiElement.style.fontWeight = 'bold';
  }
}

document.addEventListener('DOMContentLoaded', function () {
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
    btn.addEventListener('click', function () {
      setActivePeriodButton(this);
      const period = this.dataset.period;
      updateCapitalHeader(period);
    });
  });
});

// Agregar función para mostrar el modal de edición
function showEditTradeModal(index) {
  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  const trade = trades[index];
  if (!trade) return;
  // Si ya existe un modal, eliminarlo primero
  const oldModal = document.getElementById('trade-details-modal');
  if (oldModal) oldModal.remove();

  // Crear modal con formulario editable y Tailwind
  const modal = document.createElement('div');
  modal.id = 'trade-details-modal';
  modal.className = 'fixed inset-0 bg-black/50 z-50 flex items-center justify-center p-4 backdrop-blur-sm transition-opacity duration-300';
  const metricType = trade.resultMetricType === 'percent' ? 'percent' : 'pips';
  const editMetricStep = metricType === 'percent' ? '0.01' : '0.001';
  const editMetricMin = metricType === 'percent' ? '-1000' : '-999.999';
  const editMetricMax = metricType === 'percent' ? '1000' : '999.999';
  const editMetricPlaceholder = metricType === 'percent' ? 'Ej: 2.50 o -1.25' : 'Ej: 25.500 o -12.345';

  modal.innerHTML = `
    <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-2xl w-full max-w-2xl relative overflow-hidden flex flex-col max-h-[90vh]">
      <div class="p-6 border-b border-gray-100 dark:border-gray-700 flex justify-between items-center bg-gray-50 dark:bg-gray-800/50">
        <h2 class="text-xl font-bold text-gray-900 dark:text-white">Editar Operación</h2>
        <button class="trade-details-close text-gray-400 hover:text-gray-600 dark:hover:text-gray-200 transition-colors" title="Cerrar">
          <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
        </button>
      </div>
      
      <div class="overflow-y-auto p-6">
        <form id="edit-trade-form" class="space-y-4">
          <div class="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Activo</label>
              <input type="text" name="asset" value="${trade.asset}" required class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Dirección</label>
              <select name="direction" required class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
                <option value="long" ${trade.direction === 'long' ? 'selected' : ''}>COMPRA</option>
                <option value="short" ${trade.direction === 'short' ? 'selected' : ''}>VENTA</option>
              </select>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Lotes</label>
              <input type="number" step="0.00000001" min="0.00000001" name="lots" value="${trade.lots}" required class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Margen (MXN)</label>
              <input type="number" step="0.01" min="0.01" name="margin" value="${trade.margin !== undefined && trade.margin !== null ? trade.margin : ''}" required class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Apalancamiento</label>
              <div class="relative">
                <input type="number" step="1" min="1" name="leverage" value="${trade.leverage !== undefined && trade.leverage !== null ? trade.leverage : ''}" required class="w-full px-3 py-2 pr-10 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
                <span class="pointer-events-none absolute inset-y-0 right-3 flex items-center font-semibold text-gray-500 dark:text-gray-400">X</span>
              </div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Resultado (MXN)</label>
              <input type="number" step="0.01" name="resultMxn" value="${trade.resultMxn}" required class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
            </div>
            <div>
              <label id="editResultReasonLabel" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Motivo del resultado</label>
              <select name="resultReason" id="editResultReason" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
                <option value="">Selecciona un motivo</option>
              </select>
              <div class="text-xs text-gray-500 dark:text-gray-400 mt-1" id="editResultReasonHint">-</div>
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Tipo de Métrica</label>
              <select name="resultMetricType" id="editMetricType" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
                <option value="pips" ${metricType === 'pips' ? 'selected' : ''}>Pips</option>
                <option value="percent" ${metricType === 'percent' ? 'selected' : ''}>%</option>
              </select>
            </div>
            <div>
              <label id="editMetricLabel" class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Resultado (${metricType === 'percent' ? '%' : 'Pips'})</label>
              <input type="number" step="${editMetricStep}" min="${editMetricMin}" max="${editMetricMax}" name="pips" value="${trade.pips ? trade.pips : ''}" required placeholder="${editMetricPlaceholder}" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha Apertura</label>
              <input type="datetime-local" name="openTime" value="${trade.openTime}" required class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Fecha Cierre</label>
              <input type="datetime-local" name="closeTime" value="${trade.closeTime}" required class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Precio Entrada</label>
              <input type="number" step="0.00001" name="openPrice" value="${trade.openPrice}" required class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
            </div>
            <div>
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Precio Salida</label>
              <input type="number" step="0.00001" name="closePrice" value="${trade.closePrice}" required class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
            </div>
            <div class="col-span-1 md:col-span-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Estrategia</label>
              <select name="strategy" required class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">
                ${(() => {
      let strategies = [];
      try {
        strategies = JSON.parse(localStorage.getItem('strategies')) || [];
      } catch (e) {
        console.error('Error loading strategies', e);
      }

      if (!Array.isArray(strategies) || strategies.length === 0) {
        strategies = [
          { name: "Script CCI" }, { name: "Script RSI" }, { name: "Script MACD" },
          { name: "Script AO" }, { name: "Script TII" }, { name: "Script DeMarker" },
          { name: "Script Estocastico" }, { name: "Script Cruce de MMs" },
          { name: "Script SAR" }, { name: "Script BMSB" }, { name: "Script CDM-RSI" },
          { name: "Script EMA Grupos" }, { name: "Script FCT" },
          { name: "Señales app" }, { name: "Análisis técnico" }
        ];
      }

      let options = strategies.map(s =>
        `<option value="${s.name}" ${trade.strategy === s.name ? 'selected' : ''}>${s.name}</option>`
      ).join('');

      const exists = strategies.some(s => s.name === trade.strategy);
      if (trade.strategy && !exists) {
        options += `<option value="${trade.strategy}" selected>${trade.strategy} (Archivada)</option>`;
      }
      return options;
    })()}
              </select>
            </div>
            <div class="col-span-1 md:col-span-2">
              <label class="block text-sm font-medium text-gray-700 dark:text-gray-300 mb-1">Notas</label>
              <textarea name="notes" rows="3" class="w-full px-3 py-2 bg-white dark:bg-gray-700 border border-gray-300 dark:border-gray-600 rounded-lg focus:ring-2 focus:ring-orange-500 focus:border-orange-500 text-gray-900 dark:text-white">${trade.notes ? trade.notes : ''}</textarea>
            </div>
          </div>
          
          <div class="flex justify-end gap-3 pt-4 border-t border-gray-100 dark:border-gray-700">
            <button type="button" class="px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-lg text-sm font-semibold hover:bg-gray-300 dark:hover:bg-gray-600 transition" id="cancel-edit-trade">Cancelar</button>
            <button type="submit" class="px-4 py-2 bg-orange-600 text-white rounded-lg text-sm font-semibold hover:bg-orange-700 transition">Guardar Cambios</button>
          </div>
        </form>
      </div>
    </div>
  `;

  // Evento de cierre
  modal.querySelector('.trade-details-close').onclick = function () {
    modal.remove();
  };
  modal.querySelector('#cancel-edit-trade').onclick = function () {
    modal.remove();
  };

  // Cerrar al hacer clic fuera
  modal.onclick = function (e) {
    if (e.target === modal) modal.remove();
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
    editMetricTypeSelect.addEventListener('change', function () {
      syncEditMetricControls(this.value);
      if (metricInput) metricInput.value = '';
    });
  }

  const editResultMxnInput = modal.querySelector('input[name="resultMxn"]');
  const editReasonLabel = modal.querySelector('#editResultReasonLabel');
  const editReasonSelect = modal.querySelector('#editResultReason');
  const editReasonHint = modal.querySelector('#editResultReasonHint');
  if (editResultMxnInput && editReasonLabel && editReasonSelect && editReasonHint) {
    syncResultReasonControls(editResultMxnInput, editReasonSelect.parentElement, editReasonLabel, editReasonSelect, editReasonHint, String(trade.resultReason || ''));
    editResultMxnInput.addEventListener('input', () => {
      syncResultReasonControls(editResultMxnInput, editReasonSelect.parentElement, editReasonLabel, editReasonSelect, editReasonHint);
    });
  }

  // Evento de guardado
  modal.querySelector('#edit-trade-form').onsubmit = function (e) {
    e.preventDefault();
    const formData = new FormData(e.target);
    const updatedTrade = {
      ...trade,
      asset: formData.get('asset'),
      direction: formData.get('direction'),
      lots: formData.get('lots'),
      margin: formData.get('margin'),
      leverage: formData.get('leverage'),
      resultMxn: formData.get('resultMxn'),
      resultReason: formData.get('resultReason') || '',
      pips: formData.get('pips'),
      resultMetricType: formData.get('resultMetricType') || 'pips',
      openTime: formData.get('openTime'),
      closeTime: formData.get('closeTime'),
      openPrice: formData.get('openPrice'),
      closePrice: formData.get('closePrice'),
      strategy: formData.get('strategy'),
      notes: formData.get('notes')
    };

    const updatedReasonMode = getResultReasonMode(updatedTrade.resultMxn);
    if (updatedReasonMode && !updatedTrade.resultReason) {
      alert('Por favor, selecciona el motivo del resultado.');
      return;
    }
    // Buscar y actualizar el trade en localStorage
    let trades = JSON.parse(localStorage.getItem('trades')) || [];
    // Usar el índice pasado a la función
    if (index >= 0 && index < trades.length) {
      // Verificar si cambiaron campos que afectan MAE/MFE
      const originalTrade = trades[index];
      const priceOrTimeChanged =
        originalTrade.openTime !== updatedTrade.openTime ||
        originalTrade.closeTime !== updatedTrade.closeTime ||
        originalTrade.openPrice !== updatedTrade.openPrice ||
        originalTrade.closePrice !== updatedTrade.closePrice ||
        originalTrade.asset !== updatedTrade.asset ||
        originalTrade.direction !== updatedTrade.direction;

      // Asegurar que el trade tenga un ID
      if (!updatedTrade.id) {
        updatedTrade.id = 'trade-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
      }

      // Si cambiaron datos relevantes, invalidar MAE/MFE para recálculo
      if (priceOrTimeChanged) {
        updatedTrade.mae = null;
        updatedTrade.mfe = null;
      }

      trades[index] = updatedTrade;
      localStorage.setItem('trades', JSON.stringify(trades));

      // Disparar recálculo de MAE/MFE en segundo plano (solo para cripto si cambió algo)
      if (priceOrTimeChanged && typeof triggerMAEMFECalculation === 'function') {
        triggerMAEMFECalculation(updatedTrade);
      }

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

function createMovementId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return crypto.randomUUID();
  }
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

function getCapitalMovementsNormalized() {
  const raw = JSON.parse(localStorage.getItem('capitalMovements')) || [];
  if (!Array.isArray(raw)) return [];

  let changed = false;
  const normalized = raw
    .map(movement => {
      if (!movement || typeof movement !== 'object') return null;
      if (!movement.id) {
        changed = true;
        return { ...movement, id: createMovementId() };
      }
      return movement;
    })
    .filter(Boolean);

  if (changed) {
    localStorage.setItem('capitalMovements', JSON.stringify(normalized));
  }

  return normalized;
}

function getCurrentBalance() {
  const initialCapital = parseFloat(localStorage.getItem('initialCapital')) || 0;
  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  const movements = JSON.parse(localStorage.getItem('capitalMovements')) || [];

  const tradesPnl = trades.reduce((sum, trade) => sum + (parseFloat(trade.resultMxn) || 0), 0);
  const movementsPnl = movements.reduce((sum, m) => {
    const val = parseFloat(m.amount) || 0;
    return sum + (m.type === 'retiro' ? -val : val);
  }, 0);

  return initialCapital + tradesPnl + movementsPnl;
}

// Función para añadir un nuevo movimiento de capital (depósito/retiro)
function addMovement() {
  const type = document.getElementById('movement-type').value;
  const amount = parseFloat(document.getElementById('movement-amount').value);

  if (isNaN(amount) || amount <= 0) {
    alert('Por favor, ingresa un monto válido.');
    return;
  }

  if (type === 'retiro') {
    const currentBalance = getCurrentBalance();
    if (amount > currentBalance) {
      alert(`Fondos insuficientes. Tu saldo actual es $${currentBalance.toFixed(2)} MXN.`);
      return;
    }
  }

  const dateInput = document.getElementById('movement-date');
  const now = new Date();
  let date = now;
  if (dateInput && typeof dateInput.value === 'string' && dateInput.value) {
    const parts = dateInput.value.split('-').map(Number);
    if (parts.length === 3 && parts.every(Number.isFinite)) {
      date = new Date(parts[0], parts[1] - 1, parts[2], now.getHours(), now.getMinutes(), now.getSeconds(), now.getMilliseconds());
    }
  }

  const movement = {
    id: createMovementId(),
    type: type,
    amount: amount,
    date: date.toISOString()
  };

  const movements = getCapitalMovementsNormalized();
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

  let movements = getCapitalMovementsNormalized();
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
        <button class="btn-edit-movement" title="Editar movimiento" data-id="${movement.id || ''}" data-date="${movement.date}" data-type="${movement.type}">✏️</button>
        <button class="btn-delete-movement" title="Eliminar movimiento" data-id="${movement.id || ''}" data-date="${movement.date}" data-type="${movement.type}">×</span></button>
      </div>
    `;
    movementsList.appendChild(listItem);
  });

  // Añadir event listeners a los botones después de que se han renderizado
  document.querySelectorAll('.btn-edit-movement').forEach(button => {
    button.addEventListener('click', function () {
      const idToEdit = this.dataset.id;
      if (idToEdit) {
        showEditMovementModal(idToEdit);
        return;
      }
      const dateToEdit = this.dataset.date;
      const typeToEdit = this.dataset.type;
      showEditMovementModal(dateToEdit, typeToEdit);
    });
  });

  document.querySelectorAll('.btn-delete-movement').forEach(button => {
    button.addEventListener('click', function () {
      const idToDelete = this.dataset.id;
      if (idToDelete) {
        deleteMovement(idToDelete);
        return;
      }
      const dateToDelete = this.dataset.date;
      const typeToDelete = this.dataset.type;
      deleteMovement(dateToDelete, typeToDelete);
    });
  });
}

// Función para mostrar modal de edición de movimiento
function showEditMovementModal(identifier, type) {
  const movements = getCapitalMovementsNormalized();

  const movementIndex = typeof type === 'string'
    ? movements.findIndex(movement => movement.date === identifier && movement.type === type)
    : movements.findIndex(movement => movement.id === identifier);
  const movement = movements[movementIndex];

  if (!movement) {
    alert('No se pudo encontrar el movimiento para editar.');
    return;
  }

  // Si ya existe un modal, eliminarlo primero
  const oldModal = document.getElementById('edit-movement-modal');
  if (oldModal) oldModal.remove();

  // Crear modal con formulario editable
  const movementDate = new Date(movement.date);
  const dateInputValue = Number.isNaN(movementDate.getTime())
    ? ''
    : `${String(movementDate.getFullYear())}-${String(movementDate.getMonth() + 1).padStart(2, '0')}-${String(movementDate.getDate()).padStart(2, '0')}`;

  const modal = document.createElement('div');
  modal.id = 'edit-movement-modal';
  modal.className = 'trade-details-modal-bg'; // Reutilizar clase de estilo si es posible
  modal.innerHTML = `
    <div class="trade-details-modal-card">
      <button class="trade-details-close" title="Cerrar">&times;</button>
      <h2>Editar Movimiento</h2>
      <form id="edit-movement-form" class="trade-details-list">
        <div><strong>Tipo:</strong>
          <select name="type" required>
            <option value="deposito" ${movement.type === 'deposito' ? 'selected' : ''}>Depósito</option>
            <option value="retiro" ${movement.type === 'retiro' ? 'selected' : ''}>Retiro</option>
          </select>
        </div>
        <div><strong>Monto:</strong> <input type="number" step="0.01" name="amount" value="${movement.amount}" required> MXN</div>
        <div><strong>Fecha:</strong> <input type="date" name="date" value="${dateInputValue}" required></div>
        <div style="margin-top:18px; text-align:right;">
          <button type="submit" class="btn" style="margin-right:10px;">Guardar</button>
          <button type="button" class="btn clear" id="cancel-edit-movement">Cancelar</button>
        </div>
      </form>
    </div>
  `;

  // Evento de cierre
  modal.querySelector('.trade-details-close').onclick = function () {
    modal.remove();
  };
  modal.querySelector('#cancel-edit-movement').onclick = function () {
    modal.remove();
  };

  // Evento de guardado
  modal.querySelector('#edit-movement-form').onsubmit = function (e) {
    e.preventDefault();
    const formData = new FormData(e.target);

    const dateRaw = formData.get('date');
    if (typeof dateRaw !== 'string' || !dateRaw) {
      alert('Por favor, selecciona una fecha válida.');
      return;
    }
    const dateParts = dateRaw.split('-').map(Number);
    if (dateParts.length !== 3 || !dateParts.every(Number.isFinite)) {
      alert('Por favor, selecciona una fecha válida.');
      return;
    }
    const baseTime = Number.isNaN(movementDate.getTime()) ? new Date() : movementDate;
    const updatedDate = new Date(
      dateParts[0],
      dateParts[1] - 1,
      dateParts[2],
      baseTime.getHours(),
      baseTime.getMinutes(),
      baseTime.getSeconds(),
      baseTime.getMilliseconds()
    );

    const updatedMovement = {
      id: movement.id || createMovementId(),
      type: formData.get('type'),
      amount: parseFloat(formData.get('amount')),
      date: updatedDate.toISOString()
    };

    if (isNaN(updatedMovement.amount) || updatedMovement.amount <= 0) {
      alert('Por favor, ingresa un monto válido.');
      return;
    }

    let movements = getCapitalMovementsNormalized();

    const originalIndex = typeof type === 'string'
      ? movements.findIndex(m => m.date === identifier && m.type === type)
      : movements.findIndex(m => m.id === identifier);

    if (originalIndex !== -1) {
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
function deleteMovement(identifier, type) {
  if (confirm('¿Estás seguro de que deseas eliminar este movimiento?')) {
    let movements = getCapitalMovementsNormalized();

    const indexToDelete = typeof type === 'string'
      ? movements.findIndex(movement => movement.date === identifier && movement.type === type)
      : movements.findIndex(movement => movement.id === identifier);

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
  const winningTradesElement = document.getElementById('winning-trades');
  if (!winningTradesElement) return;

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
  winningTradesElement.textContent = winningTrades;
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
  switch (goalPeriod) {
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

// Función para renderizar el diario de trading (Vista de Tarjetas)
function renderDiary() {
  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  const diaryContainer = document.getElementById('diaryContainer');

  if (!diaryContainer) return;

  if (trades.length === 0) {
    diaryContainer.innerHTML = '<div class="col-span-full p-8 text-center text-gray-500 dark:text-gray-400 bg-white dark:bg-gray-800 rounded-2xl shadow-sm">No hay trades registrados aún.</div>';
    return;
  }

  let html = '';
  trades.slice().reverse().forEach((trade, index) => {
    // Calcular índice real en el array original (ya que estamos invirtiendo la copia)
    const realIndex = trades.length - 1 - index;

    const formattedAsset = typeof formatAssetSymbol === 'function'
      ? formatAssetSymbol(trade.asset)
      : trade.asset;

    const isCompra = trade.direction === 'long';
    const direction = isCompra ? 'COMPRA' : 'VENTA';
    const directionClass = isCompra
      ? 'bg-green-100 text-green-800 dark:bg-green-900 dark:text-green-300'
      : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-300';

    const resultMxn = parseFloat(trade.resultMxn);
    const resultClass = resultMxn >= 0
      ? 'text-green-600 dark:text-green-400'
      : 'text-red-600 dark:text-red-400';

    const marginNumeric = parseFloat(trade.margin);
    const marginDisplay = Number.isFinite(marginNumeric)
      ? marginNumeric.toFixed(2)
      : '-';

    const leverageNumeric = parseFloat(trade.leverage);
    const leverageDisplay = Number.isFinite(leverageNumeric) && leverageNumeric > 0
      ? `${Number.isInteger(leverageNumeric) ? leverageNumeric.toFixed(0) : leverageNumeric.toFixed(2)}X`
      : '-';

    const openDate = new Date(trade.openTime);
    const dateStr = openDate.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', year: 'numeric' });
    const timeStr = openDate.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });

    html += `
      <div class="bg-white dark:bg-gray-800 rounded-2xl shadow-md hover:shadow-lg transition-shadow duration-300 overflow-hidden flex flex-col">
        <div class="p-5 flex-grow">
          <div class="flex justify-between items-start mb-4">
            <div>
              <h3 class="text-xl font-bold text-gray-900 dark:text-white">${formattedAsset}</h3>
              <p class="text-xs text-gray-500 dark:text-gray-400 mt-1">${dateStr} • ${timeStr}</p>
            </div>
            <span class="${directionClass} text-xs font-medium px-2.5 py-0.5 rounded border border-current opacity-90">
              ${direction}
            </span>
          </div>
          
          <div class="space-y-3">
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-500 dark:text-gray-400">Resultado</span>
              <span class="text-lg font-bold ${resultClass}">$${resultMxn.toFixed(2)}</span>
            </div>

            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-500 dark:text-gray-400">Motivo</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white text-right max-w-[220px] truncate" title="${trade.resultReason ? getResultReasonLabel(trade.resultReason) : '-'}">${trade.resultReason ? getResultReasonLabel(trade.resultReason) : '-'}</span>
            </div>
            
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-500 dark:text-gray-400">Lotes</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">${parseFloat(trade.lots).toFixed(8).replace(/\.?0+$/, '')}</span>
            </div>

            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-500 dark:text-gray-400">Margen (MXN)</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">${marginDisplay}</span>
            </div>

            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-500 dark:text-gray-400">Apalancamiento</span>
              <span class="text-sm font-medium text-gray-900 dark:text-white">${leverageDisplay}</span>
            </div>
            
            <div class="flex justify-between items-center">
              <span class="text-sm text-gray-500 dark:text-gray-400">Estrategia</span>
              <span class="text-xs font-medium bg-gray-100 text-gray-800 px-2 py-0.5 rounded dark:bg-gray-700 dark:text-gray-300 truncate max-w-[120px]" title="${trade.strategy}">
                ${trade.strategy}
              </span>
            </div>
          </div>
          
          ${trade.notes ? `
            <div class="mt-4 pt-3 border-t border-gray-100 dark:border-gray-700">
              <p class="text-xs text-gray-500 dark:text-gray-400 italic line-clamp-2">"${trade.notes}"</p>
            </div>
          ` : ''}
        </div>
        
        <div class="bg-gray-50 dark:bg-gray-700/50 px-5 py-3 border-t border-gray-100 dark:border-gray-700 flex justify-between items-center">
           <button onclick='showTradeDetails(${realIndex})' class="text-sm font-medium text-orange-600 dark:text-orange-400 hover:text-orange-700 dark:hover:text-orange-300 transition-colors">
             Ver detalles
           </button>
           <div class="flex gap-2 items-center">
             ${(() => {
        // Mostrar botón de sincronización si es cripto y no tiene MAE/MFE
        const isCrypto = typeof isCryptoAsset === 'function' && isCryptoAsset(trade.asset);
        const needsSync = isCrypto && (trade.mae === null || trade.mae === undefined || trade.mfe === null || trade.mfe === undefined);
        if (needsSync) {
          return `<button onclick="syncTradeMAEMFE(${realIndex})" class="p-1.5 text-yellow-500 hover:text-yellow-600 dark:text-yellow-400 dark:hover:text-yellow-300 transition-colors" title="Sincronizar MAE/MFE">
                   <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>
                 </button>`;
        }
        return '';
      })()}
             <button onclick='showEditTradeModal(${realIndex})' class="p-1.5 text-gray-500 hover:text-blue-600 dark:text-gray-400 dark:hover:text-blue-400 transition-colors" title="Editar">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17 3a2.828 2.828 0 1 1 4 4L7.5 20.5 2 22l1.5-5.5L17 3z"></path></svg>
             </button>
             <button onclick="deleteTrade(${realIndex})" class="p-1.5 text-gray-500 hover:text-red-600 dark:text-gray-400 dark:hover:text-red-400 transition-colors" title="Eliminar">
               <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6m3 0V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2"></path></svg>
             </button>
           </div>
        </div>
      </div>
    `;
  });

  diaryContainer.innerHTML = html;
}

document.addEventListener('DOMContentLoaded', function () {
  const resultMxnInput = document.getElementById('resultMxn');
  const group = document.getElementById('resultReasonGroup');
  const label = document.getElementById('resultReasonLabel');
  const select = document.getElementById('resultReason');
  const hint = document.getElementById('resultReasonHint');
  if (!resultMxnInput || !group || !label || !select || !hint) return;
  syncResultReasonControls(resultMxnInput, group, label, select, hint, select.value);
  resultMxnInput.addEventListener('input', () => {
    syncResultReasonControls(resultMxnInput, group, label, select, hint);
  });
});

// Observador para detectar cambios en el tema (clase 'dark') y actualizar los gráficos de velocímetro
const themeObserver = new MutationObserver((mutations) => {
  mutations.forEach((mutation) => {
    if (mutation.attributeName === 'class') {
      if (typeof sqnGaugeChartInstance !== 'undefined' && sqnGaugeChartInstance) {
        sqnGaugeChartInstance.update('none');
      }
      if (typeof pfGaugeChartInstance !== 'undefined' && pfGaugeChartInstance) {
        pfGaugeChartInstance.update('none');
      }
    }
  });
});

themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] });

// ============================================================================
// MAE/MFE (Maximum Adverse/Favorable Excursion) - API Binance
// ============================================================================

/**
 * Lista de símbolos de criptomonedas soportados (deben coincidir con data-market="crypto" en el HTML).
 * Se usa para detectar si un activo es cripto.
 */
const CRYPTO_SYMBOLS = new Set([
  'BTCUSD', 'ETHUSD', 'BNBUSDT', 'SOLUSD', 'XRPUSD', 'ADAUSDT', 'AVAXUSDT', 'DOGEUSDT',
  'DOTUSDT', 'LINKUSDT', 'TRXUSD', 'POLUSD', 'LTCUSD', 'DASHUSD', 'BCHUSDT', 'NOTUSD',
  'QTUMUSD', 'ZECUSD', 'AUSD', 'SHIBUSDT', 'UNIUSDT', 'ATOMUSDT', 'XLMUSDT', 'ETCUSD',
  'NEARUSDT', 'FILUSDT', 'ICPUSDT', 'LDOUSDT', 'APTUSDT', 'ARBUSDT', 'OPUSDT', 'SUIUSDT',
  'TONUSDT', 'PEPEUSDT', 'WIFUSDT', 'FETUSDT', 'RNDRUSDT', 'INJUSDT', 'TIAUSDT', 'SEIUSDT',
  'FTMUSDT', 'RUNEUSDT', 'ALGOUSDT', 'KASUSDT', 'STXUSDT', 'IMXUSDT', 'TAOUSDT', 'PYTHUSDT',
  'JUPUSDT', 'ENAUSDT', 'STRKUSDT'
]);

/**
 * Mapeo de símbolos internos a símbolos de Binance.
 * Binance usa principalmente pares contra USDT.
 */
const SYMBOL_TO_BINANCE = {
  'BTCUSD': 'BTCUSDT',
  'ETHUSD': 'ETHUSDT',
  'SOLUSD': 'SOLUSDT',
  'XRPUSD': 'XRPUSDT',
  'TRXUSD': 'TRXUSDT',
  'POLUSD': 'MATICUSDT', // Polygon antes era MATIC
  'LTCUSD': 'LTCUSDT',
  'DASHUSD': 'DASHUSDT',
  'NOTUSD': 'NOTUSDT',
  'QTUMUSD': 'QTUMUSDT',
  'ZECUSD': 'ZECUSDT',
  'AUSD': 'EOSUSDT', // Vaulta es EOS rebrandeado
  'ETCUSD': 'ETCUSDT'
};

/**
 * Detecta si un símbolo de activo es una criptomoneda.
 * Soporta múltiples formatos: "BTCUSD", "BTCUSDT", "BTC/USD", "BTC/USDT"
 * @param {string} assetSymbol - Símbolo del activo.
 * @returns {boolean}
 */
function isCryptoAsset(assetSymbol) {
  if (!assetSymbol || typeof assetSymbol !== 'string') return false;

  // Normalizar: quitar barras, espacios, y convertir a mayúsculas
  let normalized = assetSymbol.toUpperCase().trim().replace(/[\/\-\s]/g, '');

  // Si ya está en la lista, retornar true
  if (CRYPTO_SYMBOLS.has(normalized)) return true;

  // Intentar variaciones comunes
  // Si termina en USDT, probar con USD
  if (normalized.endsWith('USDT')) {
    const withUSD = normalized.slice(0, -1); // BTCUSDT -> BTCUSD
    if (CRYPTO_SYMBOLS.has(withUSD)) return true;
  }

  // Si termina en USD, probar con USDT
  if (normalized.endsWith('USD') && !normalized.endsWith('USDT')) {
    const withUSDT = normalized + 'T'; // BTCUSD -> BTCUSDT
    if (CRYPTO_SYMBOLS.has(withUSDT)) return true;
  }

  // Extraer el símbolo base (ej: BTC de BTCUSD o BTCUSDT)
  const cryptoBases = ['BTC', 'ETH', 'BNB', 'SOL', 'XRP', 'ADA', 'AVAX', 'DOGE', 'DOT', 'LINK',
    'TRX', 'POL', 'LTC', 'DASH', 'BCH', 'NOT', 'QTUM', 'ZEC', 'SHIB', 'UNI', 'ATOM', 'XLM',
    'ETC', 'NEAR', 'FIL', 'ICP', 'LDO', 'APT', 'ARB', 'OP', 'SUI', 'TON', 'PEPE', 'WIF',
    'FET', 'RNDR', 'INJ', 'TIA', 'SEI', 'FTM', 'RUNE', 'ALGO', 'KAS', 'STX', 'IMX', 'TAO',
    'PYTH', 'JUP', 'ENA', 'STRK', 'MATIC'];

  for (const base of cryptoBases) {
    if (normalized.startsWith(base) &&
      (normalized.endsWith('USD') || normalized.endsWith('USDT') || normalized === base)) {
      return true;
    }
  }

  return false;
}

/**
 * Convierte un símbolo interno al formato de Binance.
 * Soporta múltiples formatos: "BTCUSD", "BTCUSDT", "BTC/USD", "BTC/USDT"
 * @param {string} assetSymbol - Símbolo del activo.
 * @returns {string|null} - Símbolo de Binance (ej. "BTCUSDT") o null si no es cripto.
 */
function getBinanceSymbol(assetSymbol) {
  if (!assetSymbol || typeof assetSymbol !== 'string') return null;

  // Normalizar: quitar barras, espacios
  let normalized = assetSymbol.toUpperCase().trim().replace(/[\/\-\s]/g, '');

  // Verificar si es cripto
  if (!isCryptoAsset(assetSymbol)) return null;

  // Si hay un mapeo específico, usarlo
  if (SYMBOL_TO_BINANCE[normalized]) {
    return SYMBOL_TO_BINANCE[normalized];
  }

  // Si termina en USD (no USDT), convertir a USDT para Binance
  if (normalized.endsWith('USD') && !normalized.endsWith('USDT')) {
    return normalized + 'T'; // BTCUSD -> BTCUSDT
  }

  // Si ya termina en USDT, usarlo directamente
  if (normalized.endsWith('USDT')) {
    return normalized;
  }

  // Caso default: agregar USDT
  return normalized + 'USDT';
}

/**
 * Selecciona el intervalo de vela óptimo basado en la duración del trade.
 * Maximiza la precisión sin exceder el límite de 1000 velas por petición de Binance.
 * @param {number} durationMs - Duración del trade en milisegundos.
 * @returns {string} - Intervalo de vela (ej. "1m", "5m", "1h").
 */
function selectCandleInterval(durationMs) {
  const ONE_HOUR = 60 * 60 * 1000;
  const ONE_DAY = 24 * ONE_HOUR;

  if (durationMs <= ONE_HOUR) return '1m';           // ≤1h → 1m (máx 60 velas)
  if (durationMs <= 4 * ONE_HOUR) return '5m';       // 1-4h → 5m (máx 48 velas)
  if (durationMs <= ONE_DAY) return '15m';           // 4-24h → 15m (máx 96 velas)
  if (durationMs <= 7 * ONE_DAY) return '1h';        // 1-7d → 1h (máx 168 velas)
  return '4h';                                        // >7d → 4h
}

/**
 * Obtiene velas históricas de la API de Binance.
 * @param {string} symbol - Símbolo de Binance (ej. "BTCUSDT").
 * @param {string} interval - Intervalo de vela (ej. "1m", "1h").
 * @param {number} startTime - Timestamp de inicio (ms).
 * @param {number} endTime - Timestamp de fin (ms).
 * @returns {Promise<Array>} - Array de velas [openTime, open, high, low, close, ...].
 */
async function fetchBinanceKlines(symbol, interval, startTime, endTime) {
  const url = `https://api.binance.com/api/v3/klines?symbol=${encodeURIComponent(symbol)}&interval=${encodeURIComponent(interval)}&startTime=${startTime}&endTime=${endTime}&limit=1000`;

  const response = await fetch(url);
  if (!response.ok) {
    throw new Error(`Binance API error: ${response.status}`);
  }

  return response.json();
}

/**
 * Calcula MAE y MFE para un trade de criptomoneda.
 * @param {Object} trade - Objeto del trade con openTime, closeTime, openPrice, closePrice, asset, direction.
 * @returns {Promise<{mae: number|null, mfe: number|null}>} - MAE y MFE como PORCENTAJE del precio de entrada.
 */
async function calculateMAEAndMFE(trade) {
  if (!trade) return { mae: null, mfe: null };

  const asset = trade.asset || trade.symbol;
  if (!isCryptoAsset(asset)) return { mae: null, mfe: null };

  const binanceSymbol = getBinanceSymbol(asset);
  if (!binanceSymbol) return { mae: null, mfe: null };

  // Parsear fechas de apertura y cierre
  const openTime = trade.openTime ? new Date(trade.openTime).getTime() : null;
  const closeTime = trade.closeTime ? new Date(trade.closeTime).getTime() : null;

  if (!openTime || !closeTime || !Number.isFinite(openTime) || !Number.isFinite(closeTime)) {
    return { mae: null, mfe: null };
  }

  if (closeTime <= openTime) return { mae: null, mfe: null };

  // Parsear precios (openPrice = precio de entrada, closePrice = precio de salida)
  const entryPrice = parseFloat(trade.openPrice);
  const exitPrice = parseFloat(trade.closePrice);

  if (!Number.isFinite(entryPrice) || !Number.isFinite(exitPrice) || entryPrice <= 0) {
    return { mae: null, mfe: null };
  }

  // Determinar dirección del trade (long/short)
  // Si no está explícito, inferir del resultado
  let isLong = true;
  if (trade.direction) {
    isLong = trade.direction.toLowerCase() === 'long' || trade.direction.toLowerCase() === 'compra';
  } else {
    // Inferir: si el precio de salida es mayor que el de entrada y hubo ganancia, es long
    const pnl = parseFloat(trade.resultMxn);
    if (Number.isFinite(pnl)) {
      isLong = (exitPrice > entryPrice && pnl > 0) || (exitPrice < entryPrice && pnl < 0);
    }
  }

  const durationMs = closeTime - openTime;
  const interval = selectCandleInterval(durationMs);

  try {
    const klines = await fetchBinanceKlines(binanceSymbol, interval, openTime, closeTime);

    if (!Array.isArray(klines) || klines.length === 0) {
      return { mae: null, mfe: null };
    }

    // Encontrar el máximo y mínimo durante el trade
    let highestHigh = -Infinity;
    let lowestLow = Infinity;

    for (const kline of klines) {
      const high = parseFloat(kline[2]);
      const low = parseFloat(kline[3]);

      if (Number.isFinite(high) && high > highestHigh) highestHigh = high;
      if (Number.isFinite(low) && low < lowestLow) lowestLow = low;
    }

    if (highestHigh === -Infinity || lowestLow === Infinity) {
      return { mae: null, mfe: null };
    }

    let maeAbs, mfeAbs;

    if (isLong) {
      // Para LONG: MFE = máximo alcanzado - precio entrada, MAE = precio entrada - mínimo alcanzado
      mfeAbs = highestHigh - entryPrice;
      maeAbs = entryPrice - lowestLow;
    } else {
      // Para SHORT: MFE = precio entrada - mínimo alcanzado, MAE = máximo alcanzado - precio entrada
      mfeAbs = entryPrice - lowestLow;
      maeAbs = highestHigh - entryPrice;
    }

    // Asegurar que MAE/MFE sean positivos
    maeAbs = Math.max(0, maeAbs);
    mfeAbs = Math.max(0, mfeAbs);

    // Convertir a PORCENTAJE respecto al precio de entrada
    const mae = Number(((maeAbs / entryPrice) * 100).toFixed(4));
    const mfe = Number(((mfeAbs / entryPrice) * 100).toFixed(4));

    return { mae, mfe };

  } catch (error) {
    console.warn('Error calculando MAE/MFE:', error);
    return { mae: null, mfe: null };
  }
}

/**
 * Actualiza los campos MAE/MFE de un trade existente en LocalStorage.
 * @param {string} tradeId - ID del trade a actualizar.
 * @param {number|null} mae - Valor de MAE.
 * @param {number|null} mfe - Valor de MFE.
 * @returns {boolean} - true si se actualizó correctamente.
 */
function updateTradeMAEMFE(tradeId, mae, mfe) {
  if (!tradeId) return false;

  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  const tradeIndex = trades.findIndex(t => t && t.id === tradeId);

  if (tradeIndex === -1) return false;

  trades[tradeIndex].mae = mae;
  trades[tradeIndex].mfe = mfe;

  localStorage.setItem('trades', JSON.stringify(trades));
  return true;
}

/**
 * Dispara el cálculo de MAE/MFE en segundo plano para un trade.
 * No bloquea la ejecución y silencia errores.
 * @param {Object} trade - Objeto del trade.
 */
function triggerMAEMFECalculation(trade) {
  if (!trade || !trade.id) return;
  if (!isCryptoAsset(trade.asset || trade.symbol)) return;

  // Ejecutar en segundo plano
  setTimeout(() => {
    calculateMAEAndMFE(trade)
      .then(result => {
        if (result.mae !== null || result.mfe !== null) {
          updateTradeMAEMFE(trade.id, result.mae, result.mfe);
          console.log(`MAE/MFE calculado para trade ${trade.id}:`, result);
        }
      })
      .catch(err => {
        console.warn(`Error en cálculo MAE/MFE para trade ${trade.id}:`, err);
      });
  }, 100);
}

/**
 * Renderiza las métricas MAE/MFE en la página de estadísticas.
 * Respeta los filtros de vista (cuenta activa / todas) y período de tiempo.
 */
function renderMAEMFEStats() {
  const maeAvgEl = document.getElementById('maeAverage');
  const mfeAvgEl = document.getElementById('mfeAverage');
  const ratioEl = document.getElementById('mfeMaeRatio');
  const sampleEl = document.getElementById('maeMfeSampleSize');
  const pendingHintEl = document.getElementById('maeMfePendingHint');

  // Si no estamos en la página de estadísticas, salir
  if (!maeAvgEl || !mfeAvgEl || !ratioEl || !sampleEl) return;

  // Obtener trades según el modo de vista (cuenta activa o todas)
  let trades = [];
  const viewModeSelect = document.getElementById('view-mode-select');
  const viewMode = viewModeSelect ? viewModeSelect.value : 'active';

  if (viewMode === 'all' && typeof getTradingViewSnapshot === 'function') {
    const snapshot = getTradingViewSnapshot();
    trades = snapshot && Array.isArray(snapshot.trades) ? snapshot.trades : [];
  } else {
    trades = JSON.parse(localStorage.getItem('trades')) || [];
  }

  // Aplicar filtro de período temporal si existe
  if (typeof applyStatsTimeFilterToTrades === 'function') {
    trades = applyStatsTimeFilterToTrades(trades);
  }

  // Filtrar solo trades de cripto con MAE/MFE calculados
  const cryptoTradesWithData = trades.filter(t => {
    if (!t) return false;
    if (!isCryptoAsset(t.asset || t.symbol)) return false;
    return t.mae !== null && t.mae !== undefined && t.mfe !== null && t.mfe !== undefined;
  });

  // Contar trades de cripto pendientes de cálculo
  const cryptoTradesPending = trades.filter(t => {
    if (!t) return false;
    if (!isCryptoAsset(t.asset || t.symbol)) return false;
    return t.mae === null || t.mae === undefined || t.mfe === null || t.mfe === undefined;
  }).length;

  const sampleSize = cryptoTradesWithData.length;

  if (sampleSize === 0) {
    maeAvgEl.textContent = '-';
    mfeAvgEl.textContent = '-';
    ratioEl.textContent = '-';
    sampleEl.textContent = '0';
    if (pendingHintEl) {
      pendingHintEl.textContent = cryptoTradesPending > 0
        ? `${cryptoTradesPending} pendiente(s) de cálculo`
        : 'Sin trades de crypto';
    }
    return;
  }

  // Calcular promedios
  let totalMae = 0;
  let totalMfe = 0;

  cryptoTradesWithData.forEach(t => {
    totalMae += parseFloat(t.mae) || 0;
    totalMfe += parseFloat(t.mfe) || 0;
  });

  const avgMae = totalMae / sampleSize;
  const avgMfe = totalMfe / sampleSize;
  const ratio = avgMae > 0 ? avgMfe / avgMae : (avgMfe > 0 ? Infinity : 0);

  // Formatear y mostrar (valores ya son porcentajes)
  maeAvgEl.textContent = avgMae.toFixed(2) + '%';
  mfeAvgEl.textContent = avgMfe.toFixed(2) + '%';
  ratioEl.textContent = Number.isFinite(ratio) ? ratio.toFixed(2) + 'x' : '∞';
  sampleEl.textContent = String(sampleSize);

  if (pendingHintEl) {
    pendingHintEl.textContent = cryptoTradesPending > 0
      ? `${cryptoTradesPending} pendiente(s)`
      : '';
  }
}

// Llamar a renderMAEMFEStats automáticamente cuando se llame a renderStats (si existe)
const originalRenderStats = typeof window.renderStats === 'function' ? window.renderStats : null;
if (originalRenderStats) {
  window.renderStats = function (...args) {
    const result = originalRenderStats.apply(this, args);
    renderMAEMFEStats();
    return result;
  };
}

// También llamar en DOMContentLoaded si estamos en la página de estadísticas
document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('maeAverage')) {
    renderMAEMFEStats();
  }
});

/**
 * Sincroniza MAE/MFE para un trade específico (llamado desde el botón en el diario).
 * @param {number} tradeIndex - Índice del trade en el array de trades.
 */
function syncTradeMAEMFE(tradeIndex) {
  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  if (tradeIndex < 0 || tradeIndex >= trades.length) {
    alert('No se encontró el trade.');
    return;
  }

  const trade = trades[tradeIndex];

  if (!trade) {
    alert('Trade no válido.');
    return;
  }

  // Verificar que sea cripto
  if (!isCryptoAsset(trade.asset)) {
    alert('Este trade no es de criptomonedas.');
    return;
  }

  // Asegurar que tenga un ID
  if (!trade.id) {
    trade.id = 'trade-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
    trades[tradeIndex] = trade;
    localStorage.setItem('trades', JSON.stringify(trades));
  }

  // Mostrar indicador de carga
  const buttons = document.querySelectorAll(`button[onclick="syncTradeMAEMFE(${tradeIndex})"]`);
  buttons.forEach(btn => {
    btn.disabled = true;
    btn.innerHTML = `<svg class="animate-spin" xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10" stroke-dasharray="60" stroke-dashoffset="20"></circle></svg>`;
  });

  // Calcular MAE/MFE
  calculateMAEAndMFE(trade)
    .then(result => {
      if (result.mae !== null || result.mfe !== null) {
        // Actualizar trade en localStorage
        const updatedTrades = JSON.parse(localStorage.getItem('trades')) || [];
        if (tradeIndex < updatedTrades.length) {
          updatedTrades[tradeIndex].mae = result.mae;
          updatedTrades[tradeIndex].mfe = result.mfe;
          localStorage.setItem('trades', JSON.stringify(updatedTrades));
        }

        // Re-renderizar diario
        if (typeof renderDiary === 'function') {
          renderDiary();
        }

        console.log(`MAE/MFE sincronizado para trade ${trade.id}:`, result);
      } else {
        alert('No se pudieron obtener datos de Binance para este trade. Verifica que el símbolo y las fechas sean correctos.');
        // Restaurar botón
        buttons.forEach(btn => {
          btn.disabled = false;
          btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`;
        });
      }
    })
    .catch(err => {
      console.error('Error al sincronizar MAE/MFE:', err);
      alert('Error al conectar con Binance. Intenta de nuevo.');
      // Restaurar botón
      buttons.forEach(btn => {
        btn.disabled = false;
        btn.innerHTML = `<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12a9 9 0 0 0-9-9 9.75 9.75 0 0 0-6.74 2.74L3 8"/><path d="M3 3v5h5"/><path d="M3 12a9 9 0 0 0 9 9 9.75 9.75 0 0 0 6.74-2.74L21 16"/><path d="M16 16h5v5"/></svg>`;
      });
    });
}

/**
 * Cuenta los trades cripto que necesitan sincronización de MAE/MFE.
 * @returns {number}
 */
function countCryptoTradesNeedingSync() {
  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  return trades.filter(t => {
    if (!t) return false;
    if (!isCryptoAsset(t.asset)) return false;
    return t.mae === null || t.mae === undefined || t.mfe === null || t.mfe === undefined;
  }).length;
}

/**
 * Actualiza la visibilidad del botón global de sincronización MAE/MFE.
 */
function updateSyncAllMAEMFEButtonVisibility() {
  const btn = document.getElementById('syncAllMAEMFEBtn');
  const label = document.getElementById('syncAllMAEMFELabel');
  if (!btn) return;

  const count = countCryptoTradesNeedingSync();
  if (count > 0) {
    btn.style.display = 'flex';
    if (label) label.textContent = `Sincronizar MAE/MFE (${count})`;
  } else {
    btn.style.display = 'none';
  }
}

/**
 * Sincroniza MAE/MFE para todos los trades cripto pendientes.
 */
async function syncAllCryptoTradesMAEMFE() {
  const trades = JSON.parse(localStorage.getItem('trades')) || [];
  const tradesNeedingSync = [];

  trades.forEach((trade, index) => {
    if (!trade) return;
    if (!isCryptoAsset(trade.asset)) return;
    if (trade.mae === null || trade.mae === undefined || trade.mfe === null || trade.mfe === undefined) {
      tradesNeedingSync.push({ trade, index });
    }
  });

  if (tradesNeedingSync.length === 0) {
    alert('No hay trades de cripto pendientes de sincronizar.');
    return;
  }

  const btn = document.getElementById('syncAllMAEMFEBtn');
  const label = document.getElementById('syncAllMAEMFELabel');

  if (btn) btn.disabled = true;
  if (label) label.textContent = `Sincronizando 0/${tradesNeedingSync.length}...`;

  let successCount = 0;
  let errorCount = 0;

  for (let i = 0; i < tradesNeedingSync.length; i++) {
    const { trade, index } = tradesNeedingSync[i];

    if (label) label.textContent = `Sincronizando ${i + 1}/${tradesNeedingSync.length}...`;

    try {
      // Asegurar que el trade tenga un ID
      if (!trade.id) {
        trade.id = 'trade-' + Date.now() + '-' + Math.floor(Math.random() * 1000000);
        const currentTrades = JSON.parse(localStorage.getItem('trades')) || [];
        if (index < currentTrades.length) {
          currentTrades[index].id = trade.id;
          localStorage.setItem('trades', JSON.stringify(currentTrades));
        }
      }

      const result = await calculateMAEAndMFE(trade);

      if (result.mae !== null || result.mfe !== null) {
        const currentTrades = JSON.parse(localStorage.getItem('trades')) || [];
        if (index < currentTrades.length) {
          currentTrades[index].mae = result.mae;
          currentTrades[index].mfe = result.mfe;
          localStorage.setItem('trades', JSON.stringify(currentTrades));
        }
        successCount++;
      } else {
        errorCount++;
      }

      // Pequeña pausa para evitar rate limiting de Binance
      await new Promise(resolve => setTimeout(resolve, 200));

    } catch (err) {
      console.error(`Error sincronizando trade ${index}:`, err);
      errorCount++;
    }
  }

  // Re-renderizar diario
  if (typeof renderDiary === 'function') {
    renderDiary();
  }

  // Actualizar visibilidad del botón
  updateSyncAllMAEMFEButtonVisibility();

  if (btn) btn.disabled = false;

  alert(`Sincronización completada:\n✅ ${successCount} trades actualizados\n❌ ${errorCount} errores`);
}

// Actualizar visibilidad del botón al cargar el diario
const originalRenderDiary = typeof window.renderDiary === 'function' ? window.renderDiary : null;
if (originalRenderDiary) {
  window.renderDiary = function (...args) {
    const result = originalRenderDiary.apply(this, args);
    updateSyncAllMAEMFEButtonVisibility();
    return result;
  };
}

// También actualizar al cargar la página
document.addEventListener('DOMContentLoaded', function () {
  if (document.getElementById('diaryContainer')) {
    setTimeout(updateSyncAllMAEMFEButtonVisibility, 500);
  }
});

/**
 * Exporta las estadísticas actuales al portapapeles en formato optimizado para prompts de IA.
 * Incluye exhaustivamente todos los KPIs, tablas y secciones visibles.
 */
function exportStatsForAI() {
  const getVal = (id) => {
    const el = document.getElementById(id);
    return el ? el.innerText.trim() : 'N/A';
  };

  const getListContent = (id) => {
    const el = document.getElementById(id);
    if (!el) return 'N/A';
    // Si tiene hijos, iterar
    if (el.children.length > 0) {
      return Array.from(el.children).map(c => c.innerText.trim().replace(/\n/g, ' ')).join('; ');
    }
    return el.innerText.trim();
  };

  // --- 1. Header & Filtros ---
  const periodText = document.getElementById('time-filter-btn-label')
    ? document.getElementById('time-filter-btn-label').innerText
    : 'Periodo Desconocido';
  const accountName = document.getElementById('active-account-name')
    ? document.getElementById('active-account-name').innerText
    : 'Cuenta Desconocida';
  const timestamp = new Date().toLocaleString();

  // --- 2. Calificación de Rendimiento ---
  const perfRating = getVal('performanceRatingSummary');
  const perfScore = getVal('currentProgressLabel'); // Progreso actual

  // --- 3. Criterios de Calificación ---
  const criteria = [
    'criterion-samplesize', 'criterion-winrate', 'criterion-expectancy',
    'criterion-profitfactor', 'criterion-recovery', 'criterion-lossstreak'
  ].map(id => {
    const el = document.getElementById(id);
    if (!el) return '';
    const name = el.querySelector('span')?.innerText || id;
    const val = el.querySelector('.criterion-value')?.innerText || 'N/A';
    const score = el.querySelector('.criterion-score')?.innerText || '';
    return `- ${name}: ${val} ${score}`;
  }).join('\n');

  // --- 4. KPIs Principales (Financial) ---
  const totalTrades = getVal('totalTrades');
  const winningTrades = getVal('winningTrades');
  const winPercent = getVal('winPercent');
  const winRate = getVal('winRate');
  const lossPercent = getVal('lossPercent');
  const losingTrades = getVal('losingTrades');
  const breakevenTrades = getVal('breakevenTrades');
  const bePercent = getVal('bePercent');

  const totalProfit = getVal('totalProfit');
  const totalVolume = getVal('totalVolume');
  const totalProfitPercent = getVal('totalProfitPercent');
  const avgTradePercent = getVal('avgTradePercent');

  // --- 5. Métricas de Robustez (Advanced KPIs) ---
  const maxDrawdown = getVal('maxDrawdown');
  const maxWinStreak = getVal('maxWinStreak');
  const maxLossStreak = getVal('maxLossStreak');
  const robustSqn = getVal('robustSqn');
  const robustSqnHint = getVal('robustSqnHint');
  const robustProfitFactor = getVal('robustProfitFactor');
  const robustProfitFactorHint = getVal('robustProfitFactorHint');
  const robustExpectancy = getVal('robustExpectancy');
  const robustSharpe = getVal('robustSharpe');
  const riskOfRuin = getVal('riskOfRuin');

  // --- 6. Análisis Direccional (Long vs Short) ---
  const longStats = `Trades: ${getVal('dirLongTrades')} | WinRate: ${getVal('dirLongWinRate')} | PNL: ${getVal('dirLongPnl')}`;
  const shortStats = `Trades: ${getVal('dirShortTrades')} | WinRate: ${getVal('dirShortWinRate')} | PNL: ${getVal('dirShortPnl')}`;

  // --- 7. Eficiencia (Crypto only) ---
  const maeAvg = getVal('maeAverage');
  const mfeAvg = getVal('mfeAverage');
  const mfeMaeRatio = getVal('mfeMaeRatio');
  const maeSample = getVal('maeMfeSampleSize');

  // --- 8. Insights por Motivo ---
  const lossReasonMeta = getVal('lossReasonMeta');
  const gainReasonMeta = getVal('gainReasonMeta');
  // Extraer texto de listas de motivos (intentando limpiar saltos de linea)
  const lossReasons = getListContent('lossReasonList');
  const gainReasons = getListContent('gainReasonList');

  // --- 9. Evolución Capital ---
  const periodPnl = getVal('capitalEvolutionPnl');
  const periodRoi = getVal('capitalEvolutionRoi');

  // --- 10. Estrategias ---
  const mostProfitableStrat = getVal('mostProfitableStrategy');
  const mostUsedStrat = getVal('mostUsedStrategy');
  const mostReliableStrat = getVal('mostReliableStrategy');

  // --- 11. Análisis de Tiempo ---
  const avgHolding = getVal('avgHolding');
  const avgHoldingWin = getVal('avgHoldingWin');
  const avgHoldingLoss = getVal('avgHoldingLoss');
  const favoriteHour = getVal('favoriteHour');
  const heatmapTotalOps = getVal('hourHeatmapTotal');

  // --- 12. Auditoría de Rendimiento (Tabla Ranking) ---
  // Intentar leer la tabla si tiene filas
  let rankingTableData = 'Sin datos en tabla';
  const rankingBody = document.getElementById('performanceRankingBody');
  if (rankingBody && rankingBody.children.length > 0) {
    rankingTableData = Array.from(rankingBody.querySelectorAll('tr')).map(tr => {
      const cells = Array.from(tr.querySelectorAll('td')).map(td => td.innerText.trim());
      return cells.join(' | ');
    }).join('\n');
  }

  // --- MUESTRA EN FORMATO TEXTO ---
  const promptText = `
=== REPORTE COMPLETO DE ESTADÍSTICAS DE TRADING ===
Fecha reporte: ${timestamp}
Cuenta: ${accountName}
Filtro Temporal: ${periodText}

1. CALIFICACIÓN Y CRITERIOS
---------------------------
Estado: ${perfRating} (Score: ${perfScore})
Criterios:
${criteria}

2. RESULTADOS FINANCIEROS (GENERAL)
-----------------------------------
PNL Total: ${totalProfit} (${totalProfitPercent})
Volumen Total: ${totalVolume}
Avg Trade %: ${avgTradePercent}

Trades Totales: ${totalTrades}
- Ganadores: ${winningTrades} (${winPercent} / WinRate Real: ${winRate})
- Perdedores: ${losingTrades} (${lossPercent})
- Break-even: ${breakevenTrades} (${bePercent})

3. ROBUSTEZ Y RIESGO (KPIs INSTITUCIONALES)
-------------------------------------------
SQN: ${robustSqn} (${robustSqnHint})
Profit Factor: ${robustProfitFactor} (${robustProfitFactorHint})
Sharpe Ratio: ${robustSharpe}
Risk of Ruin: ${riskOfRuin}
Expectancy: ${robustExpectancy}
Max Drawdown: ${maxDrawdown}
Rachas: Max Win ${maxWinStreak} | Max Loss ${maxLossStreak}

4. ANÁLISIS DIRECCIONAL
-----------------------
Longs: ${longStats}
Shorts: ${shortStats}

5. EFICIENCIA DE ENTRADA (MFE/MAE)
----------------------------------
Muestra: ${maeSample} trades
MAE Promedio (Pain): ${maeAvg}
MFE Promedio (Gain): ${mfeAvg}
Ratio Eficiencia: ${mfeMaeRatio}

6. INSIGHTS POR MOTIVO (Etiquetas)
----------------------------------
Pérdidas (${lossReasonMeta}):
${lossReasons}

Ganancias (${gainReasonMeta}):
${gainReasons}

7. ESTRATEGIAS Y TIEMPO
-----------------------
Top Estrategias:
- Más Rentable: ${mostProfitableStrat}
- Más Usada: ${mostUsedStrat}
- Más Fiable: ${mostReliableStrat}

Tiempos:
- Holding Promedio: ${avgHolding} (Wins: ${avgHoldingWin} | Loss: ${avgHoldingLoss})
- Hora Favorita: ${favoriteHour} (Volumen horario: ${heatmapTotalOps})

8. EVOLUCIÓN PERIODO
--------------------
PNL Periodo: ${periodPnl}
ROI Periodo: ${periodRoi}

9. TABLA DE RENDIMIENTO (DETALLE)
---------------------------------
(Nombre | Trades | WinRate | PF | PNL)
${rankingTableData}

=====================================================
Fin del reporte.
`.trim();

  // Copiar al portapapeles
  navigator.clipboard.writeText(promptText).then(() => {
    alert('✅ Reporte completo de estadísticas copiado al portapapeles.');
  }).catch(err => {
    console.error('Error al copiar: ', err);
    alert('Hubo un error al intentar copiar los datos.');
  });
}

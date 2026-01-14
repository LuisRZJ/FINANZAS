// --- Gestión de Categorías (modal, CRUD, renderizado, subcategorías) ---
const CATEGORIES_STORAGE_KEY = 'fti-categories';
const BUDGET_PLAN_STORAGE_KEY = 'fti-budget-plan-v1';
const BUDGET_USAGE_STORAGE_KEY = 'fti-budget-usage-v1';

async function fetchCategoriesFromStorage() {
    let stored = null;
    try {
        stored = await preferencesDB.getItem(CATEGORIES_STORAGE_KEY);
    } catch {
        stored = null;
    }
    if (!stored) {
        stored = getLocalStorageFallback(CATEGORIES_STORAGE_KEY);
    }
    let parsed = [];
    try {
        parsed = stored ? JSON.parse(stored) : [];
    } catch {
        parsed = [];
    }
    return Array.isArray(parsed) ? parsed : [];
}

function buildCategoryOptionEntries(categoriesList, type) {
    const filtered = categoriesList.filter(cat => cat && cat.type === type);
    const byId = new Map(filtered.map(cat => [cat.id, cat]));
    const children = new Map();
    filtered.forEach(cat => {
        const parentKey = cat.parentId || '';
        if (!children.has(parentKey)) {
            children.set(parentKey, []);
        }
        children.get(parentKey).push(cat);
    });

    const ordered = [];
    function visit(parentId, depth) {
        const items = children.get(parentId || '') || [];
        items.forEach(cat => {
            const color = sanitizeHexColor(cat.color || '#6366f1', '#6366f1');
            ordered.push({
                id: cat.id,
                name: cat.name,
                rawName: cat.name,
                displayName: `${depth ? `${'—'.repeat(depth)} ` : ''}${cat.name}`,
                color,
                icon: cat.icon || '',
                type: cat.type,
                parentId: cat.parentId || null
            });
            visit(cat.id, depth + 1);
        });
    }

    visit('', 0);
    const map = new Map();
    ordered.forEach(entry => {
        const base = byId.get(entry.id);
        map.set(entry.id, {
            ...entry,
            rawName: base?.name || entry.rawName,
            color: sanitizeHexColor(base?.color || entry.color, '#6366f1'),
            icon: base?.icon || entry.icon || ''
        });
    });
    return { ordered, map };
}

let operationCategoryOptions = { income: [], expense: [] };
let operationCategoryMap = new Map();
let budgetedExpenseCategoryIds = new Set();
let budgetUsageByMonth = new Map();
let budgetUsageHydrated = false;

async function hydrateOperationCategoriesOptions() {
    const categoriesList = await fetchCategoriesFromStorage();

    // 1. Construir mapa base con TODAS las categorías encontradas (independiente del tipo)
    // Esto asegura que getOperationCategoryMeta siempre resuelva si la categoría existe
    const fullMap = new Map();
    categoriesList.forEach(cat => {
        if (cat && cat.id) {
            fullMap.set(cat.id, {
                ...cat,
                rawName: cat.name,
                displayName: cat.name, // Nombre simple como fallback
                color: sanitizeHexColor(cat.color || '#6366f1', '#6366f1'),
                icon: cat.icon || ''
            });
        }
    });

    // 2. Construir estructuras jerárquicas para los selectores (filtrado estricto por tipo)
    const incomeData = buildCategoryOptionEntries(categoriesList, 'income');
    const expenseData = buildCategoryOptionEntries(categoriesList, 'expense');

    operationCategoryOptions = {
        income: incomeData.ordered,
        expense: expenseData.ordered
    };
    
    // 3. Enriquecer el mapa con la info jerárquica (displayName indentado) donde sea posible
    incomeData.map.forEach((val, key) => fullMap.set(key, val));
    expenseData.map.forEach((val, key) => fullMap.set(key, val));

    operationCategoryMap = fullMap;
}

function getOperationCategoryMeta(categoryId) {
    if (!categoryId) return null;
    return operationCategoryMap.get(categoryId) || null;
}

function getOperationCategoryLabel(operation) {
    const categoryId = typeof operation?.categoryId === 'string' ? operation.categoryId : '';
    if (!categoryId) return '';
    const meta = getOperationCategoryMeta(categoryId);
    return meta?.displayName || meta?.rawName || '';
}

function updateOperationsCategorySection(type, selectedCategoryId = '') {
    const wrap = document.getElementById('opsCategoryWrap');
    const select = document.getElementById('opsCategorySelect');
    if (!wrap || !select) return;

    const normalizedType = type === 'income' ? 'income' : (type === 'expense' ? 'expense' : '');
    const shouldShow = Boolean(normalizedType);
    wrap.classList.toggle('hidden', !shouldShow);
    if (!shouldShow) {
        select.value = '';
        return;
    }

    const options = operationCategoryOptions[normalizedType] || [];
    const optionsMarkup = [
        '<option value="">Sin categoría</option>',
        ...options.map(cat => `<option value="${cat.id}">${escapeHtml(cat.displayName || cat.name)}</option>`)
    ].join('');
    select.innerHTML = optionsMarkup;
    select.value = selectedCategoryId || '';
}

async function hydrateBudgetedExpenseCategories() {
    const currencyCode = await getPreferredCurrencyCodeForBudgets();
    const plan = await loadBudgetPlan(currencyCode);
    recomputeBudgetedExpenseCategoryIds(plan);
}

function recomputeBudgetedExpenseCategoryIds(plan) {
    const nextSet = new Set();
    if (Array.isArray(plan?.subBudgets)) {
        plan.subBudgets.forEach(entry => {
            if (entry?.categoryId) {
                nextSet.add(entry.categoryId);
            }
        });
    }
    budgetedExpenseCategoryIds = nextSet;
}

async function ensureBudgetUsageHydrated() {
    if (budgetUsageHydrated) return;
    await hydrateBudgetUsageFromStorage();
}

async function hydrateBudgetUsageFromStorage() {
    await preferencesDB.initPromise;
    let stored = null;
    try {
        stored = await preferencesDB.getItem(BUDGET_USAGE_STORAGE_KEY);
    } catch {
        stored = null;
    }
    if (!stored) {
        stored = getLocalStorageFallback(BUDGET_USAGE_STORAGE_KEY);
    }
    let parsed = {};
    try {
        parsed = stored ? JSON.parse(stored) : {};
    } catch {
        parsed = {};
    }

    budgetUsageByMonth = new Map();
    if (parsed && typeof parsed === 'object') {
        Object.entries(parsed).forEach(([monthKey, value]) => {
            const categories = new Map();
            const sourceCategories = value?.categories && typeof value.categories === 'object' ? value.categories : {};
            Object.entries(sourceCategories).forEach(([categoryId, amount]) => {
                categories.set(categoryId, parseMoney(amount));
            });
            budgetUsageByMonth.set(monthKey, {
                total: parseMoney(value?.total),
                categories
            });
        });
    }
    budgetUsageHydrated = true;
}

async function saveBudgetUsageToStorage() {
    const payload = {};
    budgetUsageByMonth.forEach((entry, monthKey) => {
        payload[monthKey] = {
            total: parseMoney(entry?.total),
            categories: Object.fromEntries(
                Array.from(entry?.categories?.entries() || []).map(([categoryId, amount]) => [categoryId, parseMoney(amount)])
            )
        };
    });
    const serialized = JSON.stringify(payload);
    await preferencesDB.setItem(BUDGET_USAGE_STORAGE_KEY, serialized);
    setLocalStorageFallback(BUDGET_USAGE_STORAGE_KEY, serialized);
}

function getBudgetUsageEntry(monthKey) {
    if (!monthKey) return null;
    if (!budgetUsageByMonth.has(monthKey)) {
        budgetUsageByMonth.set(monthKey, { total: 0, categories: new Map() });
    }
    return budgetUsageByMonth.get(monthKey);
}

function adjustBudgetUsage(monthKey, categoryId, delta) {
    if (!monthKey || !categoryId || !Number.isFinite(delta) || delta === 0) {
        return false;
    }
    const entry = getBudgetUsageEntry(monthKey);
    if (!entry) return false;
    const current = entry.categories.get(categoryId) || 0;
    const nextValue = parseMoney(current + delta);
    if (nextValue <= 0) {
        entry.categories.delete(categoryId);
    } else {
        entry.categories.set(categoryId, nextValue);
    }

    const nextTotal = parseMoney((entry.total || 0) + delta);
    entry.total = nextTotal > 0 ? nextTotal : 0;

    if (entry.categories.size === 0 && entry.total === 0) {
        budgetUsageByMonth.delete(monthKey);
    }
    return true;
}

function getBudgetEligibleCategoryId(operation) {
    if (!operation || operation.type !== 'expense') return '';
    const categoryId = typeof operation.categoryId === 'string' ? operation.categoryId : '';
    if (!categoryId) return '';
    if (!budgetedExpenseCategoryIds.has(categoryId)) return '';
    return categoryId;
}

function applyOperationBudgetImpact(operation) {
    const categoryId = getBudgetEligibleCategoryId(operation);
    if (!categoryId) return false;
    const monthKey = operation.monthKey || getMonthKeyFromDate(operation.datetime);
    return adjustBudgetUsage(monthKey, categoryId, operation.amount);
}

function revertOperationBudgetImpact(operation) {
    const categoryId = getBudgetEligibleCategoryId(operation);
    if (!categoryId) return false;
    const monthKey = operation.monthKey || getMonthKeyFromDate(operation.datetime);
    return adjustBudgetUsage(monthKey, categoryId, operation.amount * -1);
}

function getBudgetUsageForCategory(monthKey, categoryId) {
    if (!monthKey || !categoryId) return 0;
    const entry = budgetUsageByMonth.get(monthKey);
    if (!entry) return 0;
    return parseMoney(entry.categories.get(categoryId) || 0);
}

function getBudgetUsageTotal(monthKey) {
    if (!monthKey) return 0;
    const entry = budgetUsageByMonth.get(monthKey);
    return parseMoney(entry?.total || 0);
}

async function applyBudgetTrackingForOperation(operation) {
    if (!operation || operation.type !== 'expense') return;
    const categoryId = typeof operation.categoryId === 'string' ? operation.categoryId : '';
    if (!categoryId) return;
    await ensureBudgetUsageHydrated();
    if (!budgetedExpenseCategoryIds.size) {
        await hydrateBudgetedExpenseCategories();
    }
    if (!budgetedExpenseCategoryIds.has(categoryId)) return;
    const changed = applyOperationBudgetImpact(operation);
    if (changed) {
        await saveBudgetUsageToStorage();
    }
}

async function revertBudgetTrackingForOperation(operation) {
    if (!operation || operation.type !== 'expense') return;
    const categoryId = typeof operation.categoryId === 'string' ? operation.categoryId : '';
    if (!categoryId) return;
    await ensureBudgetUsageHydrated();
    if (!budgetedExpenseCategoryIds.size) {
        await hydrateBudgetedExpenseCategories();
    }
    if (!budgetedExpenseCategoryIds.has(categoryId)) return;
    const changed = revertOperationBudgetImpact(operation);
    if (changed) {
        await saveBudgetUsageToStorage();
    }
}

// Estructura de categoría: { id, type: 'income'|'expense', name, color, icon, parentId }

function attachCategoryReorderListeners() {
    if (!accountCategoriesReorderMode) return;
    document.querySelectorAll('.category-move-up').forEach(btn => {
        btn.addEventListener('click', () => {
            changeAccountCategoryOrder(btn.dataset.id, -1);
        });
    });
    document.querySelectorAll('.category-move-down').forEach(btn => {
        btn.addEventListener('click', () => {
            changeAccountCategoryOrder(btn.dataset.id, 1);
        });
    });
}

function changeAccountCategoryOrder(categoryId, direction) {
    if (!categoryId || !direction) return;
    const sorted = accountCategories.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
    const currentIndex = sorted.findIndex(cat => cat.id === categoryId);
    if (currentIndex === -1) return;

    let targetIndex = currentIndex + direction;
    while (sorted[targetIndex] && sorted[targetIndex].isSystem) {
        targetIndex += direction;
    }

    if (targetIndex < 0 || targetIndex >= sorted.length) return;
    const currentCat = sorted[currentIndex];
    const targetCat = sorted[targetIndex];
    if (!targetCat) return;

    const currentOrder = currentCat.order ?? currentIndex;
    const targetOrder = targetCat.order ?? targetIndex;
    currentCat.order = targetOrder;
    targetCat.order = currentOrder;
    ensureAccountCategoriesHaveOrder();
    saveAccountCategoriesToStorage().then(() => {
        renderAccountsUI();
    });
}

function updateCategoryReorderToggleUI() {
    const toggleBtn = document.getElementById('toggleCategoryReorder');
    if (!toggleBtn) return;
    const iconColorClass = accountCategoriesReorderMode ? 'text-indigo-600' : 'text-gray-500';
    const iconMarkup = `<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${iconColorClass}"><path d="M3 7.5L7.5 3m0 0L12 7.5M7.5 3v13.5m13.5-4.5L16.5 21m0 0L12 16.5m4.5 4.5V7.5"/></svg>`;
    const label = accountCategoriesReorderMode ? 'Salir de reordenar' : 'Reordenar categorías';
    toggleBtn.innerHTML = `${iconMarkup}<span>${label}</span>`;
    toggleBtn.classList.toggle('text-indigo-600', accountCategoriesReorderMode);
    toggleBtn.classList.toggle('font-semibold', accountCategoriesReorderMode);
    toggleBtn.classList.toggle('bg-indigo-50', accountCategoriesReorderMode);
}

function toggleAccountCategoriesReorderMode() {
    closeActiveMenus();
    accountCategoriesReorderMode = !accountCategoriesReorderMode;
    if (!accountCategoriesReorderMode) {
        ensureAccountCategoriesHaveOrder();
        saveAccountCategoriesToStorage();
    }
    renderAccountsUI();
}

function populateAccountCategoryFormOptions() {
    const iconSelect = document.getElementById('accountCategoryIconSelect');
    if (iconSelect) {
        iconSelect.innerHTML = ACCOUNT_ICON_OPTIONS
            .map(icon => `<option value="${icon.id}">${icon.label}</option>`)
            .join('');
    }
}

function hydrateAccountCategoryForm(category) {
    populateAccountCategoryFormOptions();
    const modalTitle = document.getElementById('accountCategoryModalTitle');
    const idField = document.getElementById('accountCategoryIdField');
    const nameInput = document.getElementById('accountCategoryNameInput');
    const typeSelect = document.getElementById('accountCategoryTypeSelect');
    const iconSelect = document.getElementById('accountCategoryIconSelect');
    const colorInput = document.getElementById('accountCategoryColorInput');

    if (!modalTitle || !idField || !nameInput || !typeSelect || !iconSelect || !colorInput) return;

    if (category) {
        modalTitle.textContent = 'Editar categoría';
        idField.value = category.id;
        nameInput.value = category.name;
        typeSelect.value = category.type === 'liability' ? 'liability' : 'asset';
        iconSelect.value = category.iconId || ACCOUNT_ICON_OPTIONS[0].id;
        colorInput.value = category.color || '#2563eb';
    } else {
        modalTitle.textContent = 'Agregar categoría';
        idField.value = '';
        nameInput.value = '';
        typeSelect.value = 'asset';
        iconSelect.value = ACCOUNT_ICON_OPTIONS[0].id;
        colorInput.value = '#2563eb';
    }
}

function resetAccountCategoryForm() {
    editingAccountCategoryId = null;
    hydrateAccountCategoryForm(null);
}

function startEditAccountCategory(categoryId) {
    const category = getAccountCategoryById(categoryId);
    if (!category || category.isSystem) return;
    editingAccountCategoryId = categoryId;
    hydrateAccountCategoryForm(category);
    openAccountCategoryModal(true);
}

async function deleteAccountCategory(categoryId) {
    const category = getAccountCategoryById(categoryId);
    if (!category || category.isSystem) return;
    closeActiveMenus();
    const confirmDelete = confirm('¿Eliminar esta categoría? Las cuentas asociadas pasarán a "Sin categoría".');
    if (!confirmDelete) return;

    let accountsMoved = false;
    accounts.forEach(account => {
        if (account.groupId === categoryId) {
            account.groupId = FALLBACK_ACCOUNT_CATEGORY_ID;
            accountsMoved = true;
        }
    });

    accountCategories = accountCategories.filter(cat => cat.id !== categoryId);
    ensureAccountCategoriesHaveOrder();

    await saveAccountCategoriesToStorage();
    if (accountsMoved) {
        reindexGroupOrders(FALLBACK_ACCOUNT_CATEGORY_ID);
        await saveAccountsToStorage();
    }

    renderAccountsUI();
}

async function handleAccountCategoryFormSubmit(event) {
    event.preventDefault();

    const nameInput = document.getElementById('accountCategoryNameInput');
    const typeSelect = document.getElementById('accountCategoryTypeSelect');
    const iconSelect = document.getElementById('accountCategoryIconSelect');
    const colorInput = document.getElementById('accountCategoryColorInput');

    if (!nameInput || !typeSelect || !iconSelect || !colorInput) {
        return;
    }

    const name = nameInput.value.trim();
    const type = typeSelect.value === 'liability' ? 'liability' : 'asset';
    const iconId = iconSelect.value || ACCOUNT_ICON_OPTIONS[0].id;
    const color = colorInput.value || '#2563eb';

    if (!name) {
        alert('Ingresa un nombre para la categoría.');
        return;
    }

    if (editingAccountCategoryId) {
        const category = getAccountCategoryById(editingAccountCategoryId);
        if (!category || category.isSystem) {
            closeAccountCategoryModal();
            return;
        }
        const previousType = category.type;
        category.name = name;
        category.type = type;
        category.iconId = iconId;
        category.color = color;

        if (previousType !== type) {
            accounts.forEach(account => {
                if (account.groupId === category.id) {
                    if (type === 'liability' && account.balance >= 0) {
                        account.balance = -Math.abs(account.balance || 0);
                    }
                    if (type === 'asset' && account.balance < 0) {
                        account.balance = Math.abs(account.balance || 0);
                    }
                }
            });
        }

        await saveAccountCategoriesToStorage();
        await saveAccountsToStorage();
    } else {
        const newCategory = {
            id: generateAccountCategoryId(),
            name,
            type,
            iconId,
            color,
            order: accountCategories.length ? Math.max(...accountCategories.map(cat => cat.order ?? 0)) + 1 : 0
        };
        accountCategories.push(newCategory);
        ensureAccountCategoriesHaveOrder();
        await saveAccountCategoriesToStorage();
    }

    resetAccountCategoryForm();
    closeAccountCategoryModal();
    renderAccountsUI();
}

function openAccountCategoryModal(isEdit = false) {
    const modal = document.getElementById('accountCategoryModal');
    if (!modal) return;
    closeActiveMenus();
    if (!isEdit) {
        resetAccountCategoryForm();
    }
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function closeAccountCategoryModal() {
    const modal = document.getElementById('accountCategoryModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    if (!editingAccountCategoryId) {
        resetAccountCategoryForm();
    }
}
let categories = [];
let editingCategoryId = null;

const ACCOUNTS_STORAGE_KEY = 'fti-accounts';

const ACCOUNT_ICON_OPTIONS = [
    {
        id: 'bank',
        label: 'Banco',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="m3 10 9-7 9 7"/><path d="M4 10v10"/><path d="M20 10v10"/><path d="M2 20h20"/><path d="M9 14h6"/><path d="M9 18h6"/><path d="M10 12v2"/><path d="M14 12v2"/></svg>'
    },
    {
        id: 'wallet',
        label: 'Billetera',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7h18a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V9a2 2 0 0 1 2-2Z"/><path d="M16 7V5a2 2 0 0 0-2-2H3"/><path d="M21 12h-6"/><circle cx="16" cy="12" r="1"/></svg>'
    },
    {
        id: 'target',
        label: 'Meta de Ahorro',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>'
    },
    {
        id: 'spark',
        label: 'Inversión',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 2 9.5 8.5 3 11l6.5 2.5L12 20l2.5-6.5L21 11l-6.5-2.5Z"/></svg>'
    },
    {
        id: 'loan',
        label: 'Préstamo',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M6 8h.01"/><path d="M10 8h8"/><path d="M10 12h8"/><path d="M10 16h8"/></svg>'
    },
    {
        id: 'credit-card',
        label: 'Tarjeta',
        svg: '<svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="4" width="20" height="16" rx="2"/><path d="M2 10h20"/><path d="M6 16h2"/><path d="M10 16h2"/></svg>'
    }
];

const DEFAULT_ACCOUNTS = [];

let accounts = [];
let editingAccountId = null;
let activeChartView = 'accounts';
let accountsCurrency = 'MXN';
let accountsCurrencyFormatter = new Intl.NumberFormat('es-MX', { style: 'currency', currency: 'MXN' });

const ACCOUNT_CATEGORIES_STORAGE_KEY = 'fti-account-categories';
const FALLBACK_ACCOUNT_CATEGORY_ID = 'uncategorized';

const DEFAULT_ACCOUNT_CATEGORIES = [
    { id: 'primary', name: 'Cuentas Principales', type: 'asset', color: '#2563eb', iconId: 'bank', order: 0 },
    { id: 'savings', name: 'Ahorros e Inversión', type: 'asset', color: '#059669', iconId: 'spark', order: 1 },
    { id: 'debts', name: 'Deudas', type: 'liability', color: '#f97316', iconId: 'loan', order: 2 },
    { id: FALLBACK_ACCOUNT_CATEGORY_ID, name: 'Sin categoría', type: 'asset', color: '#6b7280', iconId: 'wallet', order: 999, isSystem: true }
];

let accountCategories = [];
let editingAccountCategoryId = null;
let accountCategoriesReorderMode = false;
let categoriesInitializedFromDefaults = false;
let activeAccountMenu = null;
let activeCategoryMenu = null;
let addMenuOpen = false;
let globalMenuListenerAttached = false;

const OPERATIONS_STORAGE_KEY = 'fti-operations-v1';
let operations = [];
let selectedOperationsMonthKey = null;
let operationsPeriodMode = 'monthly';
let selectedResumenMonthKey = null;
let resumenPeriodMode = 'monthly';
let resumenAccountsMode = 'all';
let resumenSelectedAccountIds = [];
let operationsFilterType = 'all';
let operationsListenersAttached = false;
let editingOperationId = null;
let activeOperationDetailsId = null;

const OPERATIONS_PERIOD_META = {
    monthly: { label: 'Mensual', months: 1 },
    quarterly: { label: 'Trimestral', months: 3 },
    annual: { label: 'Anual', months: 12 }
};

function normalizeMonthKey(monthKey) {
    if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
        return getCurrentMonthKey();
    }
    const [yearStr, monthStr] = monthKey.split('-');
    const year = Number.parseInt(yearStr, 10);
    let month = Number.parseInt(monthStr, 10);
    if (!Number.isFinite(year) || year < 1970) {
        return getCurrentMonthKey();
    }
    if (!Number.isFinite(month)) {
        month = 1;
    }
    month = Math.min(12, Math.max(1, month));
    return `${year}-${String(month).padStart(2, '0')}`;
}

function clampMonthKeyToPeriod(monthKey, mode = 'monthly') {
    const normalized = normalizeMonthKey(monthKey);
    const [yearStr, monthStr] = normalized.split('-');
    let month = Number.parseInt(monthStr, 10);
    if (mode === 'quarterly') {
        const quarterIndex = Math.floor((month - 1) / 3);
        month = quarterIndex * 3 + 1;
    } else if (mode === 'annual') {
        month = 1;
    }
    return `${yearStr}-${String(month).padStart(2, '0')}`;
}

function getPeriodMonthKeys(anchorKey, mode = 'monthly') {
    const baseKey = clampMonthKeyToPeriod(anchorKey || getCurrentMonthKey(), mode);
    const months = OPERATIONS_PERIOD_META[mode]?.months ?? 1;
    const [yearStr, monthStr] = baseKey.split('-');
    const baseYear = Number.parseInt(yearStr, 10);
    const baseMonth = Number.parseInt(monthStr, 10) - 1;
    const keys = [];
    for (let i = 0; i < months; i += 1) {
        const date = new Date(baseYear, baseMonth + i, 1);
        keys.push(getMonthKeyFromDate(date));
    }
    return keys;
}

function formatPeriodLabel(monthKey, mode = 'monthly') {
    const baseKey = clampMonthKeyToPeriod(monthKey || getCurrentMonthKey(), mode);
    const [yearStr, monthStr] = baseKey.split('-');
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10);
    if (mode === 'quarterly') {
        const quarter = Math.floor((month - 1) / 3) + 1;
        return `Trimestre ${quarter} · ${year}`;
    }
    if (mode === 'annual') {
        return `Año ${year}`;
    }
    return formatMonthLabel(baseKey);
}

function shiftPeriodKey(monthKey, mode, offset) {
    const baseKey = clampMonthKeyToPeriod(monthKey || getCurrentMonthKey(), mode);
    const monthsPerPeriod = OPERATIONS_PERIOD_META[mode]?.months ?? 1;
    const [yearStr, monthStr] = baseKey.split('-');
    const startDate = new Date(Number.parseInt(yearStr, 10), Number.parseInt(monthStr, 10) - 1, 1);
    const shifted = new Date(startDate.getFullYear(), startDate.getMonth() + offset * monthsPerPeriod, 1);
    return clampMonthKeyToPeriod(getMonthKeyFromDate(shifted), mode);
}

function getCurrentPeriodStartKey(mode = 'monthly') {
    return clampMonthKeyToPeriod(getCurrentMonthKey(), mode);
}

function isCurrentPeriodSelected() {
    if (!selectedOperationsMonthKey) return false;
    const selectedBase = clampMonthKeyToPeriod(selectedOperationsMonthKey, operationsPeriodMode);
    const currentBase = getCurrentPeriodStartKey(operationsPeriodMode);
    return compareMonthKeys(selectedBase, currentBase) >= 0;
}

function updateOperationsPeriodControls() {
    const labelEl = document.getElementById('opsPeriodLabel');
    const meta = OPERATIONS_PERIOD_META[operationsPeriodMode] || OPERATIONS_PERIOD_META.monthly;
    if (labelEl) {
        labelEl.textContent = meta?.label || 'Mensual';
    }
    const menu = document.getElementById('opsPeriodMenu');
    if (menu) {
        menu.querySelectorAll('[data-period-mode]').forEach(button => {
            const mode = button.dataset.periodMode;
            const isActive = mode === operationsPeriodMode;
            button.classList.toggle('bg-gray-100', isActive);
            button.classList.toggle('text-indigo-600', isActive);
            button.classList.toggle('font-semibold', isActive);
        });
    }

    const balanceTitle = document.getElementById('opsBalanceTitle');
    const historyTitle = document.getElementById('opsHistoryTitle');
    
    let periodText = 'Mes';
    if (operationsPeriodMode === 'quarterly') periodText = 'Trimestre';
    if (operationsPeriodMode === 'annual') periodText = 'Año';

    if (balanceTitle) balanceTitle.textContent = `Balance del ${periodText}`;
    if (historyTitle) historyTitle.textContent = `Operaciones del ${periodText}`;
}

function closeOperationsPeriodMenu() {
    const menu = document.getElementById('opsPeriodMenu');
    if (menu) {
        menu.classList.add('hidden');
    }
}

function toggleOperationsPeriodMenu() {
    const menu = document.getElementById('opsPeriodMenu');
    if (!menu) return;
    const isHidden = menu.classList.contains('hidden');
    if (isHidden) {
        menu.classList.remove('hidden');
    } else {
        menu.classList.add('hidden');
    }
}

function setOperationsPeriodMode(mode) {
    if (!OPERATIONS_PERIOD_META[mode]) return;
    if (operationsPeriodMode === mode) {
        closeOperationsPeriodMenu();
        return;
    }
    operationsPeriodMode = mode;
    selectedOperationsMonthKey = clampMonthKeyToPeriod(selectedOperationsMonthKey || getCurrentMonthKey(), operationsPeriodMode);
    closeOperationsPeriodMenu();
    updateOperationsPeriodControls();
    renderOperationsView();
}

const accountCurrencyLocaleMap = {
    MXN: 'es-MX',
    USD: 'en-US',
    EUR: 'es-ES',
    JPY: 'ja-JP'
};

function getAccountCategoryById(categoryId) {
    return accountCategories.find(cat => cat.id === categoryId) || null;
}

function getAccountById(accountId) {
    return accounts.find(acc => acc.id === accountId) || null;
}

function generateOperationId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `op_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

function formatDateValueForInput(date) {
    const target = date instanceof Date ? date : new Date(date);
    const offset = target.getTimezoneOffset();
    const local = new Date(target.getTime() - offset * 60000);
    return local.toISOString().slice(0, 16);
}

function normalizeOperationType(type) {
    if (type === 'income' || type === 'expense' || type === 'transfer') {
        return type;
    }
    return 'expense';
}

function ensureFallbackAccountCategory() {
    if (!accountCategories.some(cat => cat.id === FALLBACK_ACCOUNT_CATEGORY_ID)) {
        const fallback = DEFAULT_ACCOUNT_CATEGORIES.find(cat => cat.id === FALLBACK_ACCOUNT_CATEGORY_ID);
        if (fallback) {
            accountCategories.push({ ...fallback });
        } else {
            accountCategories.push({
                id: FALLBACK_ACCOUNT_CATEGORY_ID,
                name: 'Sin categoría',
                type: 'asset',
                color: '#6b7280',
                iconId: 'wallet',
                order: 999,
                isSystem: true
            });
        }
    }
}

function ensureAccountCategoriesHaveOrder() {
    accountCategories
        .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER))
        .forEach((cat, index) => {
            if (typeof cat.order !== 'number' || Number.isNaN(cat.order)) {
                cat.order = index;
            }
        });
}

function getAccountCategoriesOrdered() {
    const list = accountCategories.map(cat => ({ ...cat }));

    // Siempre ordenar por el orden personalizado definido por el usuario
    return list.sort((a, b) => {
        // La categoría fallback (General) siempre va al final
        if (a.id === FALLBACK_ACCOUNT_CATEGORY_ID) return 1;
        if (b.id === FALLBACK_ACCOUNT_CATEGORY_ID) return -1;
        
        return (a.order ?? 0) - (b.order ?? 0);
    });
}

async function hydrateAccountCategoriesFromStorage() {
    let stored = await preferencesDB.getItem(ACCOUNT_CATEGORIES_STORAGE_KEY);
    if (!stored) {
        stored = getLocalStorageFallback(ACCOUNT_CATEGORIES_STORAGE_KEY);
    }

    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                accountCategories = parsed.map(cat => ({ ...cat }));
                ensureFallbackAccountCategory();
                ensureAccountCategoriesHaveOrder();
                return;
            }
        } catch (error) {
            console.error('Error parsing account categories storage:', error);
        }
    }

    accountCategories = DEFAULT_ACCOUNT_CATEGORIES.map(cat => ({ ...cat }));
    categoriesInitializedFromDefaults = true;
    ensureFallbackAccountCategory();
    ensureAccountCategoriesHaveOrder();
    await saveAccountCategoriesToStorage();
}

async function saveAccountCategoriesToStorage() {
    ensureFallbackAccountCategory();
    ensureAccountCategoriesHaveOrder();
    try {
        await preferencesDB.setItem(ACCOUNT_CATEGORIES_STORAGE_KEY, JSON.stringify(accountCategories));
    } catch (error) {
        console.error('Error saving account categories:', error);
    }
    setLocalStorageFallback(ACCOUNT_CATEGORIES_STORAGE_KEY, JSON.stringify(accountCategories));
}

function generateAccountCategoryId() {
    return 'acctcat_' + Math.random().toString(36).slice(2, 10);
}

function calculateAccountTotalsByCategory() {
    const totals = new Map();
    for (const cat of accountCategories) {
        totals.set(cat.id, { total: 0, type: cat.type });
    }
    for (const account of accounts) {
        const category = getAccountCategoryById(account.groupId) || getAccountCategoryById(FALLBACK_ACCOUNT_CATEGORY_ID);
        const entry = totals.get(category.id) || { total: 0, type: category.type };
        entry.total += account.balance;
        totals.set(category.id, entry);
    }
    return totals;
}

function getAccountCategoryType(categoryId) {
    const category = getAccountCategoryById(categoryId);
    return category ? category.type : 'asset';
}

function getAccountCategoryColor(categoryId) {
    const category = getAccountCategoryById(categoryId);
    return category ? category.color : '#2563eb';
}

function getAccountCategoryIcon(categoryId) {
    const category = getAccountCategoryById(categoryId);
    return category ? category.iconId : ACCOUNT_ICON_OPTIONS[0].id;
}

function getSelectableAccountCategories() {
    // Siempre incluir fallback
    return accountCategories.slice().sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
}

function getDefaultAccountCategoryId() {
    const ordered = getSelectableAccountCategories();
    const firstNonSystem = ordered.find(cat => !cat.isSystem);
    return (firstNonSystem || ordered[0] || { id: FALLBACK_ACCOUNT_CATEGORY_ID }).id;
}

function ensureAccountsCategoryIntegrity() {
    let changed = false;
    const validCategoryIds = new Set(accountCategories.map(cat => cat.id));
    for (const account of accounts) {
        if (!validCategoryIds.has(account.groupId)) {
            account.groupId = FALLBACK_ACCOUNT_CATEGORY_ID;
            changed = true;
        }
    }
    if (changed) {
        reindexAllGroups();
    }
    return changed;
}

function getAccountIconSvg(iconId) {
    const option = ACCOUNT_ICON_OPTIONS.find(opt => opt.id === iconId);
    return option ? option.svg : ACCOUNT_ICON_OPTIONS[0].svg;
}

function formatAccountAmount(amount) {
    return accountsCurrencyFormatter.format(amount);
}

function calculateAccountTotals() {
    const totals = {
        netBalance: 0,
        assets: 0,
        liabilities: 0,
        byCategory: new Map()
    };

    for (const account of accounts) {
        if (account.deletedAt) continue; // Ignorar cuentas eliminadas en cálculos actuales
        const category = getAccountCategoryById(account.groupId) || getAccountCategoryById(FALLBACK_ACCOUNT_CATEGORY_ID);
        if (!category) continue;
        const currentTotal = totals.byCategory.get(category.id) || { total: 0, type: category.type };
        currentTotal.total += account.balance;
        totals.byCategory.set(category.id, currentTotal);

        totals.netBalance += account.balance;
        if (category.type === 'asset') {
            totals.assets += Math.max(account.balance, 0);
        } else {
            totals.liabilities += Math.abs(Math.min(account.balance, 0));
        }
    }

    return totals;
}

function getAccountsChartData(view) {
    const totals = calculateAccountTotals();
    const entries = [];

    if (view === 'categories') {
        for (const category of accountCategories) {
            if (category.id === FALLBACK_ACCOUNT_CATEGORY_ID) continue;
            const info = totals.byCategory.get(category.id);
            entries.push({
                id: category.id,
                label: category.name,
                amount: info?.total ?? 0,
                color: category.color
            });
        }
        if (!entries.length) {
            entries.push({
                id: 'empty_categories',
                label: 'Sin registros',
                amount: 1,
                color: '#cbd5f5'
            });
        }
    } else {
        const positiveAccounts = accounts.filter(acc => acc.balance > 0 && !acc.deletedAt).sort((a, b) => b.balance - a.balance);
        for (const account of positiveAccounts) {
            entries.push({
                id: account.id,
                label: account.name,
                amount: account.balance,
                color: account.color
            });
        }
    }

    const totalAmount = entries.reduce((sum, item) => sum + item.amount, 0);
    return { entries, totalAmount };
}

function getLocalStorageFallback(key) {
    try {
        return localStorage.getItem(key);
    } catch (error) {
        console.error('LocalStorage read error:', error);
        return null;
    }
}

function setLocalStorageFallback(key, value) {
    try {
        localStorage.setItem(key, value);
    } catch (error) {
        console.error('LocalStorage write error:', error);
    }
}

function determineAccountsCurrency(defaultCurrency = 'MXN') {
    const select = document.getElementById('defaultCurrencySelect');
    if (select && select.value) {
        return select.value;
    }
    return defaultCurrency;
}

async function hydrateAccountsFromStorage() {
    let stored = await preferencesDB.getItem(ACCOUNTS_STORAGE_KEY);
    if (!stored) {
        stored = getLocalStorageFallback(ACCOUNTS_STORAGE_KEY);
    }

    if (stored) {
        try {
            const parsed = JSON.parse(stored);
            if (Array.isArray(parsed)) {
                accounts = parsed.map(acc => ({
                    ...acc,
                    history: Array.isArray(acc?.history) ? acc.history : []
                }));
                reindexAllGroups();
                const changed = ensureAccountsCategoryIntegrity();
                if (changed) {
                    await saveAccountsToStorage();
                }
                return;
            }
        } catch (error) {
            console.error('Error parsing accounts storage:', error);
        }
    }

    accounts = DEFAULT_ACCOUNTS.map(acc => ({ ...acc }));
    await preferencesDB.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
    setLocalStorageFallback(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
    ensureAccountsCategoryIntegrity();
}

async function saveAccountsToStorage() {
    try {
        await preferencesDB.setItem(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
    } catch (error) {
        console.error('Error saving accounts:', error);
    }
    setLocalStorageFallback(ACCOUNTS_STORAGE_KEY, JSON.stringify(accounts));
}

function sortAccounts() {
    accounts.sort((a, b) => {
        const categoryA = getAccountCategoryById(a.groupId) || getAccountCategoryById(FALLBACK_ACCOUNT_CATEGORY_ID);
        const categoryB = getAccountCategoryById(b.groupId) || getAccountCategoryById(FALLBACK_ACCOUNT_CATEGORY_ID);
        const orderA = categoryA ? categoryA.order ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        const orderB = categoryB ? categoryB.order ?? Number.MAX_SAFE_INTEGER : Number.MAX_SAFE_INTEGER;
        if (orderA !== orderB) return orderA - orderB;
        // Dentro de la categoría, ordenar por saldo descendente
        if (a.balance === b.balance) {
            return (a.name || '').localeCompare(b.name || '');
        }
        return b.balance - a.balance;
    });
}

function reindexGroupOrders(groupId) {
    const groupAccounts = accounts
        .filter(acc => acc.groupId === groupId)
        .sort((a, b) => b.balance - a.balance);
    groupAccounts.forEach((acc, index) => {
        acc.order = index;
    });
}

function reindexAllGroups() {
    const categoryIds = new Set(accounts.map(acc => acc.groupId));
    for (const catId of categoryIds) {
        reindexGroupOrders(catId);
    }
}

function getAccountsByGroup() {
    const grouped = new Map();
    for (const category of accountCategories) {
        grouped.set(category.id, []);
    }

    for (const account of accounts) {
        const category = getAccountCategoryById(account.groupId) || getAccountCategoryById(FALLBACK_ACCOUNT_CATEGORY_ID);
        if (!grouped.has(category.id)) {
            grouped.set(category.id, []);
        }
        grouped.get(category.id).push(account);
    }

    for (const [categoryId, list] of grouped.entries()) {
        list.sort((a, b) => b.balance - a.balance || (a.name || '').localeCompare(b.name || ''));
        grouped.set(categoryId, list);
    }

    return grouped;
}

function renderAccountsList() {
    const container = document.getElementById('accountGroupsContainer');
    if (!container) return;

    const grouped = getAccountsByGroup();
    container.innerHTML = '';

    const totals = calculateAccountTotals();

    const orderedCategories = getAccountCategoriesOrdered();

    orderedCategories.forEach(category => {
        const accountsInGroup = grouped.get(category.id) || [];
        
        // Mostrar siempre la categoría, incluso si no tiene cuentas
        const groupTotal = totals.byCategory.get(category.id)?.total || 0;
        const formattedTotal = formatAccountAmount(groupTotal);
        const categoryColor = category.color || '#4b5563';
        const categoryIconSvg = getAccountIconSvg(category.iconId || 'bank');

        const groupSection = document.createElement('div');
        groupSection.className = 'account-group-section border border-gray-200 rounded-xl bg-white shadow-sm';
        groupSection.dataset.categoryId = category.id;

        const reorderControls = accountCategoriesReorderMode && !category.isSystem ? `
            <div class="flex items-center gap-2">
                <button class="category-move-up p-1.5 rounded-full hover:bg-gray-100 text-gray-500" data-id="${category.id}" title="Subir">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="18 15 12 9 6 15"></polyline></svg>
                </button>
                <button class="category-move-down p-1.5 rounded-full hover:bg-gray-100 text-gray-500" data-id="${category.id}" title="Bajar">
                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="6 9 12 15 18 9"></polyline></svg>
                </button>
            </div>
        ` : '';

        const categoryManagement = category.isSystem ? '' : `
            <div class="relative category-menu-wrapper">
                <button class="category-settings-btn p-2 rounded-full hover:bg-indigo-100 text-indigo-600 transition" data-id="${category.id}">
                    <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"></circle><path d="M19.4 15a1.78 1.78 0 0 0 .33 2l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.78 1.78 0 0 0-2-.33 1.78 1.78 0 0 0-1 1.62V21a2 2 0 0 1-4 0 1.78 1.78 0 0 0-1-1.62 1.78 1.78 0 0 0-2 .33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.78 1.78 0 0 0 .33-2 1.78 1.78 0 0 0-1.62-1H3a2 2 0 0 1 0-4 1.78 1.78 0 0 0 1.62-1 1.78 1.78 0 0 0-.33-2l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06a1.78 1.78 0 0 0 2 .33H9a1.78 1.78 0 0 0 1-1.62V3a2 2 0 0 1 4 0 1.78 1.78 0 0 0 1 1.62 1.78 1.78 0 0 0 2-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.78 1.78 0 0 0-.33 2 1.78 1.78 0 0 0 1.62 1H21a2 2 0 0 1 0 4h-.38a1.78 1.78 0 0 0-1.62 1z"></path></svg>
                </button>
                <div class="category-menu hidden absolute right-0 mt-2 w-48 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                    <button class="category-menu-edit flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" data-id="${category.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"></path><path d="M14.06 4.94l3.75 3.75"></path></svg>
                        Editar categoría
                    </button>
                    <button class="category-menu-delete flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50" data-id="${category.id}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M15 6l-1-3h-4l-1 3"></path></svg>
                        Eliminar categoría
                    </button>
                </div>
            </div>
        `;

        groupSection.innerHTML = `
            <div class="flex flex-wrap items-center justify-between gap-3 px-4 py-3 border-b border-gray-100 bg-gray-50 rounded-t-xl">
                <div class="flex items-center gap-3">
                    <div class="w-9 h-9 flex items-center justify-center rounded-full" style="background:${categoryColor}22">
                        ${categoryIconSvg}
                    </div>
                    <div>
                        <h2 class="text-base font-bold text-gray-700">${category.name}</h2>
                        <p class="text-sm font-semibold text-gray-500">${formattedTotal}</p>
                    </div>
                </div>
                <div class="flex items-center gap-2">
                    ${reorderControls}
                    ${categoryManagement}
                </div>
            </div>
            <div class="space-y-3 px-4 py-4"></div>
        `;

        const listContainer = groupSection.querySelector('.space-y-3');

        if (!accountsInGroup.length) {
            const emptyState = document.createElement('div');
            emptyState.className = 'text-sm text-gray-400 text-center py-4 border border-dashed border-gray-200 rounded-lg';
            emptyState.textContent = accountCategoriesReorderMode ? 'Sin cuentas' : 'No hay cuentas registradas en esta categoría';
            listContainer.appendChild(emptyState);
        } else {
            accountsInGroup.forEach(account => {
                const formattedBalance = formatAccountAmount(account.balance);
                const isNegative = account.balance < 0;
                const balanceClass = isNegative ? 'text-red-600' : 'text-gray-800';
                const accentBg = `${account.color || categoryColor}22`;

                const item = document.createElement('div');
                item.className = 'flex items-center gap-4 p-4 bg-white rounded-xl border border-gray-200 shadow-sm';
                item.innerHTML = `
                    <div class="p-3 rounded-full flex items-center justify-center" style="background:${accentBg}">
                        ${getAccountIconSvg(account.iconId)}
                    </div>
                    <div class="flex-grow min-w-0">
                        <p class="font-semibold text-gray-800 truncate">${account.name}</p>
                        <p class="text-sm text-gray-500 truncate">${account.institution || ''}</p>
                    </div>
                    <div class="text-right">
                        <p class="font-bold ${balanceClass} text-lg">${formattedBalance}</p>
                    </div>
                    <div class="relative">
                        <button class="account-menu-trigger p-2 rounded-full hover:bg-gray-100 text-gray-500" data-id="${account.id}">
                            <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="1"></circle><circle cx="12" cy="5" r="1"></circle><circle cx="12" cy="19" r="1"></circle></svg>
                        </button>
                        <div class="account-menu hidden absolute right-0 mt-2 w-44 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                            <button class="account-menu-edit flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" data-id="${account.id}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"></path><path d="M14.06 4.94l3.75 3.75"></path></svg>
                                Editar cuenta
                            </button>
                            <button class="account-menu-history flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" data-id="${account.id}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><polyline points="12 6 12 12 16 14"></polyline></svg>
                                Historial
                            </button>
                            <button class="account-menu-delete flex items-center gap-2 w-full px-4 py-2 text-sm text-red-600 hover:bg-red-50" data-id="${account.id}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="3 6 5 6 21 6"></polyline><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M15 6l-1-3h-4l-1 3"></path></svg>
                                Eliminar cuenta
                            </button>
                        </div>
                    </div>
                `;

                listContainer.appendChild(item);
            });
        }

        container.appendChild(groupSection);
    });

    attachAccountMenus();
    attachCategoryManagementListeners();
    attachCategoryReorderListeners();
}

function closeAccountHistoryModal() {
    const modal = document.getElementById('accountHistoryModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
}

function pushAccountHistoryEntry(account, entry) {
    if (!account) return;
    if (!Array.isArray(account.history)) {
        account.history = [];
    }

    const date = typeof entry?.date === 'string' ? entry.date : new Date().toISOString();
    const type = typeof entry?.type === 'string' ? entry.type : 'adjustment';
    const description = typeof entry?.description === 'string' ? entry.description : 'Actividad';
    const details = typeof entry?.details === 'string' ? entry.details : '';

    account.history.unshift({ date, type, description, details });
    if (account.history.length > 200) {
        account.history = account.history.slice(0, 200);
    }
}

function closeActiveMenus(exceptions = {}) {
    if (!exceptions.keepAccountMenu && activeAccountMenu) {
        activeAccountMenu.classList.add('hidden');
        activeAccountMenu = null;
    }
    if (!exceptions.keepCategoryMenu && activeCategoryMenu) {
        activeCategoryMenu.classList.add('hidden');
        activeCategoryMenu = null;
    }
    if (!exceptions.keepAddMenu) {
        const addMenu = document.getElementById('addMenu');
        if (addMenu) {
            addMenu.classList.add('hidden');
            addMenuOpen = false;
        }
    }
}

function ensureGlobalMenuListener() {
    if (globalMenuListenerAttached) return;
    document.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof Element)) {
            closeActiveMenus();
            return;
        }

        const addWrapper = document.getElementById('addAccountCategoryWrapper');
        if (addWrapper && addWrapper.contains(target)) {
            return;
        }

        if (target.closest('.account-menu-trigger') || target.closest('.account-menu')) {
            return;
        }

        const categoryMenuWrapper = target.closest('.category-menu-wrapper');
        if (categoryMenuWrapper) {
            const menu = categoryMenuWrapper.querySelector('.category-menu');
            if (menu && menu.contains(target)) {
                return;
            }
            const trigger = categoryMenuWrapper.querySelector('.category-settings-btn');
            if (trigger && trigger.contains(target)) {
                return;
            }
        }

        closeActiveMenus();
    });
    globalMenuListenerAttached = true;
}

function toggleAddMenu() {
    const addMenu = document.getElementById('addMenu');
    if (!addMenu) return;
    const isHidden = addMenu.classList.contains('hidden');
    closeActiveMenus({ keepAddMenu: true });
    if (isHidden) {
        addMenu.classList.remove('hidden');
        addMenuOpen = true;
    } else {
        addMenu.classList.add('hidden');
        addMenuOpen = false;
    }
}

function attachAccountMenus() {
    const triggers = document.querySelectorAll('.account-menu-trigger');
    triggers.forEach(trigger => {
        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            const menu = trigger.nextElementSibling;
            if (!menu) return;
            if (activeAccountMenu && activeAccountMenu !== menu) {
                activeAccountMenu.classList.add('hidden');
            }
            const isHidden = menu.classList.contains('hidden');
            closeActiveMenus({ keepAccountMenu: true, keepCategoryMenu: true, keepAddMenu: true });
            if (isHidden) {
                menu.classList.remove('hidden');
                activeAccountMenu = menu;
            } else {
                menu.classList.add('hidden');
                activeAccountMenu = null;
            }
        });
    });

    document.querySelectorAll('.account-menu-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            closeActiveMenus();
            startEditAccountItem(id);
        });
    });

    document.querySelectorAll('.account-menu-history').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            closeActiveMenus();
            const account = accounts.find(acc => acc.id === id);
            if (!account) return;
            showAccountHistory(account);
        });
    });

    document.querySelectorAll('.account-menu-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            closeActiveMenus();
            deleteAccount(id);
        });
    });
}

function showAccountHistory(account) {
    const historyListEl = document.getElementById('accountHistoryList');
    const modalTitleEl = document.getElementById('accountHistoryModalTitle');
    const modalSubtitleEl = document.getElementById('accountHistoryModalSubtitle');
    const historyModalEl = document.getElementById('accountHistoryModal');

    if (!historyListEl || !modalTitleEl || !modalSubtitleEl || !historyModalEl) {
        return;
    }

    modalTitleEl.textContent = account?.name || 'Historial de Cuenta';
    modalSubtitleEl.textContent = 'HISTORIAL DE ACTIVIDAD';
    historyListEl.innerHTML = '';

    const rawHistory = Array.isArray(account?.history) ? account.history : [];
    const history = [...rawHistory].sort((a, b) => {
        const aTime = Number.isFinite(Date.parse(a?.date)) ? Date.parse(a.date) : 0;
        const bTime = Number.isFinite(Date.parse(b?.date)) ? Date.parse(b.date) : 0;
        return bTime - aTime;
    });

    if (history.length === 0) {
        historyListEl.innerHTML = `
            <div class="text-center py-10">
                <div class="inline-flex p-3 bg-gray-50 rounded-full text-gray-300 mb-3">
                    <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                </div>
                <p class="text-sm text-gray-400 italic">No hay actividad registrada para esta cuenta.</p>
            </div>
        `;
        historyModalEl.classList.remove('hidden');
        document.body.classList.add('overflow-hidden');
        return;
    }

    for (const entry of history) {
        const entryType = typeof entry?.type === 'string' ? entry.type : '';
        const entryDescription = typeof entry?.description === 'string' ? entry.description : 'Actividad';
        const entryDetails = typeof entry?.details === 'string' ? entry.details : '';

        const parsedTime = Date.parse(entry?.date);
        const date = Number.isFinite(parsedTime) ? new Date(parsedTime) : null;
        const formattedDate = date
            ? date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
            : 'Fecha no disponible';
        const formattedTime = date
            ? date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
            : '';

        let icon = '';
        let iconBg = 'bg-gray-100';
        let iconColor = 'text-gray-600';

        if (entryType === 'deposit') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14"/><path d="M5 12h14"/></svg>';
            iconBg = 'bg-green-100';
            iconColor = 'text-green-600';
        } else if (entryType === 'expense') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>';
            iconBg = 'bg-rose-100';
            iconColor = 'text-rose-600';
        } else if (entryType === 'transfer') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M16 3h5v5"/><path d="M4 20 21 3"/><path d="M21 16v5h-5"/><path d="M15 15 21 21"/><path d="M4 4l6 6"/></svg>';
            iconBg = 'bg-indigo-100';
            iconColor = 'text-indigo-600';
        } else if (entryType === 'adjustment') {
            icon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
            iconBg = 'bg-amber-100';
            iconColor = 'text-amber-600';
        }

        const entryEl = document.createElement('div');
        entryEl.className = 'flex gap-4 relative';
        entryEl.innerHTML = `
            <div class="flex flex-col items-center">
                <div class="z-10 flex items-center justify-center w-8 h-8 rounded-full ${iconBg} ${iconColor} shadow-sm border-2 border-white">
                    ${icon}
                </div>
                <div data-history-connector="true" class="w-0.5 h-full bg-gray-100 absolute top-8 bottom-0 -z-0"></div>
            </div>
            <div class="pb-6">
                <div class="flex items-center gap-2 mb-0.5">
                    <span class="text-sm font-bold text-gray-800">${entryDescription}</span>
                    <span class="text-[10px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded uppercase">${formattedDate}${formattedTime ? ` • ${formattedTime}` : ''}</span>
                </div>
                <p class="text-xs text-gray-500 leading-relaxed">${entryDetails || '-'}</p>
            </div>
        `;
        historyListEl.appendChild(entryEl);
    }

    const last = historyListEl.lastElementChild;
    const lastConnector = last ? last.querySelector('[data-history-connector="true"]') : null;
    if (lastConnector) lastConnector.classList.add('hidden');

    historyModalEl.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function attachCategoryManagementListeners() {
    const triggers = document.querySelectorAll('.category-settings-btn');
    triggers.forEach(trigger => {
        trigger.addEventListener('click', (event) => {
            event.stopPropagation();
            const wrapper = trigger.closest('.category-menu-wrapper');
            const menu = wrapper?.querySelector('.category-menu');
            if (!menu) return;
            if (activeCategoryMenu && activeCategoryMenu !== menu) {
                activeCategoryMenu.classList.add('hidden');
            }
            const isHidden = menu.classList.contains('hidden');
            closeActiveMenus({ keepCategoryMenu: true, keepAccountMenu: true, keepAddMenu: true });
            if (isHidden) {
                menu.classList.remove('hidden');
                activeCategoryMenu = menu;
            } else {
                menu.classList.add('hidden');
                activeCategoryMenu = null;
            }
        });
    });

    document.querySelectorAll('.category-menu-edit').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            closeActiveMenus();
            startEditAccountCategory(id);
        });
    });

    document.querySelectorAll('.category-menu-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            closeActiveMenus();
            deleteAccountCategory(id);
        });
    });
}

function renderAccountsChart() {
    const chartContainer = document.querySelector('#accountsChartContainer svg');
    const legendContainer = document.getElementById('accountsChartLegend');
    if (!chartContainer || !legendContainer) return;

    setBalanceToggleActive(activeChartView);

    const { entries, totalAmount } = getAccountsChartData(activeChartView);

    const centerValue = totalAmount > 0 ? formatAccountAmount(totalAmount) : '$0';
    const centerLabel = activeChartView === 'categories' ? 'Categorías +' : 'Activos';
    const centerValueEl = document.getElementById('chartCenterValue');
    const centerLabelEl = document.getElementById('chartCenterLabel');
    if (centerValueEl) centerValueEl.textContent = centerValue;
    if (centerLabelEl) centerLabelEl.textContent = centerLabel;

    const circumference = 2 * Math.PI * 42;
    chartContainer.innerHTML = '<circle class="text-gray-200" stroke-width="12" stroke="currentColor" fill="transparent" r="42" cx="50" cy="50" />';

    let offset = 0;
    legendContainer.innerHTML = '';

    if (!entries.length) {
        legendContainer.innerHTML = '<p class="text-sm text-gray-500">No hay datos positivos para mostrar.</p>';
        return;
    }

    for (const entry of entries) {
        const percentage = totalAmount ? (entry.amount / totalAmount) * 100 : 0;
        const segmentLength = totalAmount ? (entry.amount / totalAmount) * circumference : 0;

        const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        arc.setAttribute('class', 'chart-segment');
        arc.setAttribute('stroke-width', '12');
        arc.setAttribute('stroke-linecap', 'round');
        arc.setAttribute('fill', 'transparent');
        arc.setAttribute('r', '42');
        arc.setAttribute('cx', '50');
        arc.setAttribute('cy', '50');
        arc.setAttribute('stroke', entry.color);
        arc.style.strokeDasharray = `${segmentLength} ${circumference}`;
        arc.style.strokeDashoffset = `-${offset}`;
        chartContainer.appendChild(arc);

        offset += segmentLength;

        const legendItem = document.createElement('div');
        legendItem.className = 'flex items-center justify-between text-sm';
        legendItem.innerHTML = `
            <div class="flex items-center gap-2">
                <span class="w-3 h-3 rounded-full" style="background:${entry.color}"></span>
                <span class="font-medium text-gray-700">${entry.label}</span>
            </div>
            <span class="font-semibold text-gray-800">${percentage.toFixed(1)}%</span>
        `;
        legendContainer.appendChild(legendItem);
    }
}

async function renderSavingsGoalsAllocationCard() {
    const chartSvg = document.querySelector('#savingsGoalsChartContainer svg');
    const legendContainer = document.getElementById('savingsGoalsLegend');
    const totalValueEl = document.getElementById('savingsGoalsTotalValue');
    const centerValueEl = document.getElementById('savingsGoalsCenterValue');

    if (!chartSvg || !legendContainer || !totalValueEl || !centerValueEl) {
        return;
    }

    legendContainer.innerHTML = '';
    chartSvg.innerHTML = '<circle class="text-gray-200" stroke-width="12" stroke="currentColor" fill="transparent" r="42" cx="50" cy="50" />';

    let goals = [];
    try {
        goals = await preferencesDB.getAllSavings();
    } catch (error) {
        totalValueEl.textContent = '$0';
        centerValueEl.textContent = '$0';
        legendContainer.innerHTML = '<p class="text-sm text-gray-500">No se pudo cargar la información de metas.</p>';
        return;
    }

    const safeGoals = Array.isArray(goals) ? goals : [];
    const palette = ['#10b981', '#6366f1', '#f59e0b', '#ef4444', '#8b5cf6', '#06b6d4', '#f97316', '#22c55e'];
    let paletteIndex = 0;

    const entries = safeGoals
        .map(goal => {
            const amount = Number(goal?.current);
            return {
                id: String(goal?.id ?? ''),
                label: typeof goal?.name === 'string' && goal.name.trim() ? goal.name.trim() : 'Meta',
                amount: Number.isFinite(amount) ? amount : 0,
                target: Number.isFinite(Number(goal?.target)) ? Number(goal.target) : 0,
                color: typeof goal?.color === 'string' && goal.color ? goal.color : palette[paletteIndex++ % palette.length]
            };
        })
        .filter(entry => entry.amount > 0)
        .sort((a, b) => b.amount - a.amount);

    const totalAmount = entries.reduce((sum, item) => sum + item.amount, 0);
    totalValueEl.textContent = totalAmount > 0 ? formatAccountAmount(totalAmount) : '$0';
    centerValueEl.textContent = totalAmount > 0 ? formatAccountAmount(totalAmount) : '$0';

    if (!entries.length || totalAmount <= 0) {
        legendContainer.innerHTML = '<p class="text-sm text-gray-500">No hay metas con saldo registrado.</p>';
        return;
    }

    const circumference = 2 * Math.PI * 42;
    let offset = 0;

    for (const entry of entries) {
        const share = (entry.amount / totalAmount) * 100;
        const segmentLength = (entry.amount / totalAmount) * circumference;

        const arc = document.createElementNS('http://www.w3.org/2000/svg', 'circle');
        arc.setAttribute('class', 'chart-segment');
        arc.setAttribute('stroke-width', '12');
        arc.setAttribute('stroke-linecap', 'round');
        arc.setAttribute('fill', 'transparent');
        arc.setAttribute('r', '42');
        arc.setAttribute('cx', '50');
        arc.setAttribute('cy', '50');
        arc.setAttribute('stroke', entry.color);
        arc.style.strokeDasharray = `${segmentLength} ${circumference}`;
        arc.style.strokeDashoffset = `-${offset}`;
        chartSvg.appendChild(arc);
        offset += segmentLength;

        const formattedAmount = formatAccountAmount(entry.amount);
        const targetLabel = entry.target > 0 ? ` · Meta: ${formatAccountAmount(entry.target)}` : '';
        const legendItem = document.createElement('div');
        legendItem.className = 'rounded-lg border border-gray-100 bg-gray-50/50 px-3 py-2';
        legendItem.innerHTML = `
            <div class="flex items-start justify-between gap-3">
                <div class="min-w-0">
                    <div class="flex items-center gap-2">
                        <span class="w-2.5 h-2.5 rounded-full flex-shrink-0" style="background:${entry.color}"></span>
                        <span class="text-sm font-semibold text-gray-800 truncate">${entry.label}</span>
                    </div>
                    <p class="text-xs text-gray-500 mt-0.5">${formattedAmount}${targetLabel}</p>
                </div>
                <span class="text-xs font-bold text-gray-700">${share.toFixed(1)}%</span>
            </div>
            <div class="mt-2 h-1.5 bg-gray-200 rounded-full overflow-hidden" aria-hidden="true">
                <div class="h-full rounded-full" style="width:${Math.max(0, Math.min(100, share))}%; background:${entry.color}"></div>
            </div>
        `;
        legendContainer.appendChild(legendItem);
    }
}

function renderAccountsSummary() {
    const totals = calculateAccountTotals();
    const netBalanceEl = document.getElementById('netBalanceValue');
    if (netBalanceEl) {
        netBalanceEl.textContent = formatAccountAmount(totals.netBalance);
    }
}

function renderAccountsUI() {
    sortAccounts();
    renderAccountsSummary();
    renderAccountsChart();
    renderAccountsList();
    updateCategoryReorderToggleUI();
    populateAccountFormOptions();
}

function populateAccountFormOptions() {
    const groupSelect = document.getElementById('accountGroupSelect');
    const iconSelect = document.getElementById('accountIconSelect');
    if (groupSelect) {
        const options = getSelectableAccountCategories()
            .map(category => `<option value="${category.id}">${category.name}</option>`)
            .join('');
        groupSelect.innerHTML = options;
    }
    if (iconSelect) {
        iconSelect.innerHTML = ACCOUNT_ICON_OPTIONS.map(icon => `<option value="${icon.id}">${icon.label}</option>`).join('');
    }
}

function startEditAccountItem(accountId) {
    const account = accounts.find(acc => acc.id === accountId);
    if (!account) return;
    editingAccountId = accountId;
    openAccountModal(true);
    hydrateAccountForm(account);
}

function hydrateAccountForm(account) {
    const form = document.getElementById('accountForm');
    if (!form) return;

    populateAccountFormOptions();

    document.getElementById('accountModalTitle').textContent = account ? 'Editar cuenta' : 'Agregar cuenta';
    document.getElementById('accountIdField').value = account?.id || '';
    document.getElementById('accountNameInput').value = account?.name || '';
    document.getElementById('accountInstitutionInput').value = account?.institution || '';
    document.getElementById('accountBalanceInput').value = account ? account.balance : '';
    const defaultCategoryId = getDefaultAccountCategoryId();
    const categoryId = account?.groupId && getAccountCategoryById(account.groupId)
        ? account.groupId
        : defaultCategoryId;
    const category = getAccountCategoryById(categoryId) || getAccountCategoryById(FALLBACK_ACCOUNT_CATEGORY_ID);
    const defaultIcon = category?.iconId || ACCOUNT_ICON_OPTIONS[0].id;
    const defaultColor = category?.color || '#2563eb';
    document.getElementById('accountGroupSelect').value = categoryId;
    document.getElementById('accountIconSelect').value = account?.iconId || defaultIcon;
    document.getElementById('accountColorInput').value = account?.color || defaultColor;
}

function resetAccountForm() {
    editingAccountId = null;
    hydrateAccountForm(null);
}

function openAccountModal(isEdit = false) {
    const modal = document.getElementById('accountModal');
    if (!modal) return;
    populateAccountFormOptions();
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    if (!isEdit) {
        const form = document.getElementById('accountForm');
        if (form) form.reset();
        hydrateAccountForm(null);
    }
}

function closeAccountModal() {
    const modal = document.getElementById('accountModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    resetAccountForm();
}

async function deleteAccount(accountId) {
    const accountIndex = accounts.findIndex(acc => acc.id === accountId);
    if (accountIndex === -1) return;
    
    const accountToDelete = accounts[accountIndex];
    if (!confirm(`¿Eliminar la cuenta "${accountToDelete.name}"?\n\nLa cuenta desaparecerá de la lista, pero su historial se conservará para mantener la coherencia de tus gráficos pasados.`)) return;

    // Soft Delete: Marcar como eliminada y guardar fecha y saldo final
    const now = new Date();
    
    // Registrar evento de "Cierre" en el historial antes de "borrarla"
    // Esto sirve como punto final para la gráfica: ese día el saldo cayó a 0 (o dejó de contar)
    pushAccountHistoryEntry(accounts[accountIndex], {
        type: 'deleted',
        description: 'Cuenta eliminada',
        details: `Saldo final al cierre: ${formatAccountAmount(accountToDelete.balance)}`,
        date: now.toISOString()
    });

    accounts[accountIndex] = {
        ...accountToDelete,
        deletedAt: now.toISOString(),
        finalBalance: accountToDelete.balance, // Guardamos saldo final por si acaso
        balance: 0 // Ponemos a 0 para que no sume al "Total Actual"
    };

    reindexGroupOrders(accountToDelete.groupId);
    await saveAccountsToStorage();
    renderAccountsUI();
}

function generateAccountId() {
    return 'acc_' + Math.random().toString(36).slice(2, 10);
}

async function handleAccountFormSubmit(event) {
    event.preventDefault();
    const name = document.getElementById('accountNameInput')?.value.trim();
    const institution = document.getElementById('accountInstitutionInput')?.value.trim();
    const balanceInput = document.getElementById('accountBalanceInput');
    const balanceValue = balanceInput ? balanceInput.value : '';
    const balanceRaw = Number(balanceValue);
    const defaultCategoryId = getDefaultAccountCategoryId();
    const groupId = document.getElementById('accountGroupSelect')?.value || defaultCategoryId;
    const iconId = document.getElementById('accountIconSelect')?.value || ACCOUNT_ICON_OPTIONS[0].id;
    const color = document.getElementById('accountColorInput')?.value || '#2563eb';
    const category = getAccountCategoryById(groupId) || getAccountCategoryById(FALLBACK_ACCOUNT_CATEGORY_ID);

    if (!name || balanceValue === '' || Number.isNaN(balanceRaw)) {
        alert('Completa el nombre de la cuenta y un balance válido.');
        return;
    }

    let normalizedBalance = balanceRaw;
    if (category && category.type === 'liability') {
        if (balanceRaw >= 0) {
            alert('Las categorías de tipo deuda requieren un saldo negativo.');
            return;
        }
        normalizedBalance = -Math.abs(balanceRaw);
    }

    const accountData = {
        name,
        institution,
        balance: normalizedBalance,
        groupId,
        iconId,
        color: color || category?.color || '#2563eb'
    };

    accounts = accounts.filter(acc => !acc.deletedAt); // Solo cuentas activas
    if (editingAccountId) {
        const index = accounts.findIndex(acc => acc.id === editingAccountId);
        if (index !== -1) {
            const existing = accounts[index];
            const previousBalance = Number(existing.balance);
            const previousGroupId = existing.groupId;
            accounts[index] = { ...existing, ...accountData };
            if (accountData.groupId !== previousGroupId) {
                accounts[index].order = accounts.filter(acc => acc.groupId === accountData.groupId && acc.id !== accounts[index].id).length;
                reindexGroupOrders(previousGroupId);
            }
            reindexGroupOrders(accounts[index].groupId);

            const nextBalance = Number(accounts[index].balance);
            if (Number.isFinite(previousBalance) && Number.isFinite(nextBalance) && previousBalance !== nextBalance) {
                const delta = nextBalance - previousBalance;
                const deltaLabel = `${delta >= 0 ? '+' : ''}${formatAccountAmount(delta)}`;
                pushAccountHistoryEntry(accounts[index], {
                    type: 'adjustment',
                    description: 'Ajuste de saldo',
                    details: `${formatAccountAmount(previousBalance)} → ${formatAccountAmount(nextBalance)} (${deltaLabel})`
                });
            }
        }
    } else {
        const newAccount = {
            ...accountData,
            id: generateAccountId(),
            order: accounts.filter(acc => acc.groupId === groupId).length,
            history: []
        };
        
        // Registrar historial inicial si hay saldo
        if (Math.abs(normalizedBalance) > 0) {
            newAccount.history.push({
                date: new Date().toISOString(),
                type: 'initial',
                description: 'Saldo inicial',
                details: `${formatAccountAmount(normalizedBalance)}`
            });
        }
        
        accounts.push(newAccount);
        reindexGroupOrders(groupId);
    }

    await saveAccountsToStorage();
    closeAccountModal();
    renderAccountsUI();
}

function resetAccountCategoriesOrder() {
    if (!confirm('¿Estás seguro de que quieres restablecer el orden de las categorías? Se ordenarán por balance total.')) return;
    
    // Marcar que queremos reindexar basándonos en el balance
    const totalsByCategory = calculateAccountTotalsByCategory();
    
    // Crear una copia para ordenar
    const sorted = [...accountCategories].sort((a, b) => {
        if (a.id === FALLBACK_ACCOUNT_CATEGORY_ID) return 1;
        if (b.id === FALLBACK_ACCOUNT_CATEGORY_ID) return -1;
        const totalA = totalsByCategory.get(a.id)?.total ?? 0;
        const totalB = totalsByCategory.get(b.id)?.total ?? 0;
        return totalB - totalA;
    });

    // Asignar nuevos índices de orden
    sorted.forEach((cat, index) => {
        const originalCat = accountCategories.find(c => c.id === cat.id);
        if (originalCat) {
            originalCat.order = index;
        }
    });

    // Desactivar modo reordenar si estaba activo
    accountCategoriesReorderMode = false;
    
    // Guardar y renderizar
    saveAccountCategoriesToStorage().then(() => {
        renderAccountsUI();
    });
}

function attachAccountsEventListeners() {
    ensureGlobalMenuListener();

    const addMenuTrigger = document.getElementById('openAddMenu');
    if (addMenuTrigger) {
        addMenuTrigger.addEventListener('click', (event) => {
            event.preventDefault();
            event.stopPropagation();
            toggleAddMenu();
        });
    }

    const addAccountOption = document.getElementById('addAccountOption');
    if (addAccountOption) {
        addAccountOption.addEventListener('click', () => {
            closeActiveMenus();
            openAccountModal(false);
        });
    }

    const addCategoryOption = document.getElementById('addCategoryOption');
    if (addCategoryOption) {
        addCategoryOption.addEventListener('click', () => {
            closeActiveMenus();
            openAccountCategoryModal(false);
        });
    }

    const closeBtn = document.getElementById('closeAccountModal');
    if (closeBtn) {
        closeBtn.addEventListener('click', closeAccountModal);
    }

    const cancelBtn = document.getElementById('cancelAccountModal');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeAccountModal);
    }

    const form = document.getElementById('accountForm');
    if (form) {
        form.addEventListener('submit', handleAccountFormSubmit);
    }

    const closeHistoryBtn = document.getElementById('closeAccountHistoryModal');
    if (closeHistoryBtn) {
        closeHistoryBtn.addEventListener('click', closeAccountHistoryModal);
    }

    const historyModal = document.getElementById('accountHistoryModal');
    if (historyModal) {
        historyModal.addEventListener('click', (event) => {
            const target = event.target;
            if (!(target instanceof Element)) return;
            if (target.closest('[data-close-account-history="true"]')) {
                closeAccountHistoryModal();
            }
        });
    }

    const categoryForm = document.getElementById('accountCategoryForm');
    if (categoryForm) {
        categoryForm.addEventListener('submit', handleAccountCategoryFormSubmit);
    }

    const closeCategoryBtn = document.getElementById('closeAccountCategoryModal');
    if (closeCategoryBtn) {
        closeCategoryBtn.addEventListener('click', () => {
            editingAccountCategoryId = null;
            closeAccountCategoryModal();
        });
    }

    const cancelCategoryBtn = document.getElementById('cancelAccountCategoryModal');
    if (cancelCategoryBtn) {
        cancelCategoryBtn.addEventListener('click', () => {
            editingAccountCategoryId = null;
            closeAccountCategoryModal();
        });
    }

    const toggleReorderBtn = document.getElementById('toggleCategoryReorder');
    if (toggleReorderBtn) {
        toggleReorderBtn.addEventListener('click', (event) => {
            event.preventDefault();
            toggleAccountCategoriesReorderMode();
        });
    }

    const resetOrderBtn = document.getElementById('resetCategoryOrder');
    if (resetOrderBtn) {
        resetOrderBtn.addEventListener('click', (event) => {
            event.preventDefault();
            resetAccountCategoriesOrder();
        });
    }




    document.querySelectorAll('.balance-toggle').forEach(btn => {
        btn.addEventListener('click', () => {
            const view = btn.dataset.chartView;
            if (!view || view === activeChartView) return;
            activeChartView = view;
            setBalanceToggleActive(view);
            renderAccountsChart();
        });
    });

    const groupSelect = document.getElementById('accountGroupSelect');
    if (groupSelect) {
        groupSelect.addEventListener('change', () => {
            const category = getAccountCategoryById(groupSelect.value) || getAccountCategoryById(FALLBACK_ACCOUNT_CATEGORY_ID);
            if (!editingAccountId) {
                const iconSelect = document.getElementById('accountIconSelect');
                const colorInput = document.getElementById('accountColorInput');
                if (iconSelect) {
                    iconSelect.value = category?.iconId || ACCOUNT_ICON_OPTIONS[0].id;
                }
                if (colorInput) {
                    colorInput.value = category?.color || '#2563eb';
                }
            }
        });
    }
}

function refreshAccountsCurrencyFormatter(currencyCode) {
    const locale = accountCurrencyLocaleMap[currencyCode] || 'es-MX';
    accountsCurrency = currencyCode;
    accountsCurrencyFormatter = new Intl.NumberFormat(locale, { style: 'currency', currency: currencyCode });
}

function watchCurrencyPreferenceChanges() {
    const defaultSelect = document.getElementById('defaultCurrencySelect');
    if (!defaultSelect) return;
    defaultSelect.addEventListener('change', () => {
        refreshAccountsCurrencyFormatter(defaultSelect.value);
        renderAccountsUI();
        renderSavingsGoalsAllocationCard();
    });
}

function setBalanceToggleActive(view) {
    document.querySelectorAll('.balance-toggle').forEach(btn => {
        const isActive = btn.dataset.chartView === view;
        btn.classList.toggle('bg-white', isActive);
        btn.classList.toggle('text-indigo-600', isActive);
        btn.classList.toggle('shadow-sm', isActive);
        btn.classList.toggle('text-gray-500', !isActive);
    });
}

function openCategoriesModal() {
    document.getElementById('categoriesModal').classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
    loadCategories();
}

function closeCategoriesModal() {
    document.getElementById('categoriesModal').classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    resetCategoryForm();
}

function openCategoryFormModal() {
    document.getElementById('categoryFormModal').classList.remove('hidden');
}

function closeCategoryFormModal() {
    document.getElementById('categoryFormModal').classList.add('hidden');
    resetCategoryForm();
}

function resetCategoryForm() {
    document.getElementById('categoryForm').reset();
    document.getElementById('categoryColor').value = '#2563eb';
    document.getElementById('parentCategory').value = '';
    editingCategoryId = null;
    document.getElementById('categoryFormTitle').textContent = 'Agregar Nueva Categoría';
}

function renderCategories() {
        const incomeList = document.getElementById('incomeCategoriesList');
        const expenseList = document.getElementById('expenseCategoriesList');
        incomeList.innerHTML = '';
        expenseList.innerHTML = '';

        // Helper: reordenar dentro de un conjunto de hermanos (mismo type y mismo parentId)
        function reorderAmongSiblings(itemId, targetBeforeId, type, parentId) {
                const siblings = categories.filter(c => c.type === type && (c.parentId || '') === (parentId || ''));
                const moving = siblings.find(s => s.id === itemId);
                if (!moving) return;
                const others = siblings.filter(s => s.id !== itemId);
                const newSiblings = [];
                if (!targetBeforeId) {
                        // append at end
                        newSiblings.push(...others, moving);
                } else {
                        for (const s of others) {
                                if (s.id === targetBeforeId) newSiblings.push(moving);
                                newSiblings.push(s);
                        }
                }
                // Now rebuild categories preserving non-sibling items
                const newCategories = [];
                // iterate original categories and replace siblings block in order of newSiblings when encountering first sibling
                const added = new Set();
                for (const c of categories) {
                        if (c.type === type && (c.parentId || '') === (parentId || '')) {
                                if (!added.size) {
                                        // insert all newSiblings now
                                        for (const ns of newSiblings) {
                                                newCategories.push(ns);
                                                added.add(ns.id);
                                        }
                                }
                                // skip original sibling
                                continue;
                        }
                        newCategories.push(c);
                }
                // Edge: if no sibling encountered (maybe empty), append newSiblings
                if (newCategories.length === 0 || ![...newCategories].some(c => c.type === type && (c.parentId || '') === (parentId || ''))) {
                        // place at end
                        categories = [...newCategories, ...newSiblings];
                } else {
                        categories = newCategories;
                }
        }

        // Mover hacia arriba/abajo para móviles (u alternativa a drag)
        function moveItemUp(id) {
                const item = categories.find(c => c.id === id);
                if (!item) return;
                const type = item.type;
                const parentId = item.parentId || '';
                const siblings = categories.filter(c => c.type === type && (c.parentId || '') === parentId);
                const idx = siblings.findIndex(s => s.id === id);
                if (idx > 0) {
                        const beforeId = siblings[idx - 1].id;
                        reorderAmongSiblings(id, siblings[idx - 1].id, type, parentId);
                        saveCategories();
                }
        }
        function moveItemDown(id) {
                const item = categories.find(c => c.id === id);
                if (!item) return;
                const type = item.type;
                const parentId = item.parentId || '';
                const siblings = categories.filter(c => c.type === type && (c.parentId || '') === parentId);
                const idx = siblings.findIndex(s => s.id === id);
                if (idx !== -1 && idx < siblings.length - 1) {
                        const afterId = siblings[idx + 1].id;
                        // To move down, we place moving before the item after the next (i.e., before afterId's next). Simpler: remove and insert after.
                        // We'll construct new order manually
                        const moving = siblings[idx];
                        const others = siblings.filter(s => s.id !== id);
                        const newSiblings = [];
                        for (let i = 0; i < others.length; i++) {
                                newSiblings.push(others[i]);
                                if (others[i].id === afterId) {
                                        newSiblings.push(moving);
                                }
                        }
                        // rebuild categories preserving order
                        const newCategories = [];
                        let inserted = false;
                        for (const c of categories) {
                                if (c.type === type && (c.parentId || '') === parentId) {
                                        if (!inserted) {
                                                for (const ns of newSiblings) newCategories.push(ns);
                                                inserted = true;
                                        }
                                        continue;
                                }
                                newCategories.push(c);
                        }
                        categories = newCategories;
                        saveCategories();
                }
        }

        // Renderizado moderno de categorías y subcategorías (con atributos para reorder)
        function renderCategoryCards(type) {
                return categories
                        .filter(cat => cat.type === type && !cat.parentId)
                        .map(cat => {
                                const subs = categories.filter(sub => sub.parentId === cat.id);
                                                return `
                                                <li class="mb-4" data-id="${cat.id}" role="listitem">
                                                    <div role="button" aria-grabbed="false" class="flex items-center gap-3 bg-gray-50 border border-gray-200 rounded-lg px-4 py-3 shadow-sm relative draggable-cat" draggable="true" data-id="${cat.id}">
                                        <span class="inline-flex items-center justify-center w-8 h-8 rounded-full" style="background:${cat.color}">
                                            ${cat.icon ? `<i class="${escapeHtml(cat.icon)} text-white text-lg"></i>` : ''}
                                        </span>
                                        <span class="font-semibold text-gray-800 text-base">${escapeHtml(cat.name)}</span>
                                        <div class="flex-1"></div>
                                        <button class="move-up p-1.5 rounded-full hover:bg-gray-100 text-gray-500 mr-1" title="Mover arriba" data-id="${cat.id}">
                                            <i class="fa-solid fa-chevron-up"></i>
                                        </button>
                                        <button class="move-down p-1.5 rounded-full hover:bg-gray-100 text-gray-500 mr-2" title="Mover abajo" data-id="${cat.id}">
                                            <i class="fa-solid fa-chevron-down"></i>
                                        </button>
                                        <button class="edit-category-btn p-1.5 rounded-full hover:bg-indigo-100 text-indigo-600" title="Editar" data-id="${cat.id}">
                                            <i class="fa-solid fa-pen"></i>
                                        </button>
                                        <button class="delete-category-btn p-1.5 rounded-full hover:bg-red-100 text-red-600 ml-1" title="Borrar" data-id="${cat.id}">
                                            <i class="fa-solid fa-trash"></i>
                                        </button>
                                    </div>
                                    ${subs.length > 0 ? `
                                    <div class="ml-8 mt-2 bg-white rounded-lg border border-gray-200 overflow-hidden subs-container" data-parent-id="${cat.id}" role="list">
                                            ${subs.map(sub => `
                                                <div role="listitem" class="flex items-center gap-2 px-3 py-2 border-b last:border-b-0 border-gray-100 group relative draggable-sub" draggable="true" data-id="${sub.id}" data-parent-id="${cat.id}">
                                                    <div class="flex items-center gap-2 flex-1">
                                                        <div class="flex items-center gap-1.5">
                                                            <span class="inline-block w-2 h-2 rounded-full opacity-70" style="background:${sub.color}"></span>
                                                            ${sub.icon ? `<i class="${escapeHtml(sub.icon)} text-gray-400 text-xs"></i>` : ''}
                                                        </div>
                                                        <span class="text-gray-600 text-sm">${escapeHtml(sub.name)}</span>
                                                    </div>
                                                    <div class="flex items-center gap-1">
                                                        <button class="move-up p-1 rounded hover:bg-gray-100 text-gray-400" title="Mover arriba" data-id="${sub.id}">
                                                            <i class="fa-solid fa-chevron-up text-xs"></i>
                                                        </button>
                                                        <button class="move-down p-1 rounded hover:bg-gray-100 text-gray-400 ml-1" title="Mover abajo" data-id="${sub.id}">
                                                            <i class="fa-solid fa-chevron-down text-xs"></i>
                                                        </button>
                                                        <button class="edit-category-btn p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-indigo-600" title="Editar" data-id="${sub.id}">
                                                            <i class="fa-solid fa-pen text-xs"></i>
                                                        </button>
                                                        <button class="delete-category-btn p-1 rounded hover:bg-gray-100 text-gray-400 hover:text-red-600" title="Borrar" data-id="${sub.id}">
                                                            <i class="fa-solid fa-trash text-xs"></i>
                                                        </button>
                                                    </div>
                                                </div>
                                            `).join('')}
                                        </div>
                                    ` : ''}
                                </li>
                                `;
                        }).join('');
        }

        incomeList.innerHTML = renderCategoryCards('income');
        expenseList.innerHTML = renderCategoryCards('expense');

        // Después del render, adjuntar listeners para mover y drag/drop
        // Move up/down
        document.querySelectorAll('.move-up').forEach(btn => {
                btn.addEventListener('click', (e) => {
                        const id = btn.dataset.id;
                        moveItemUp(id);
                });
        });
        document.querySelectorAll('.move-down').forEach(btn => {
                btn.addEventListener('click', (e) => {
                        const id = btn.dataset.id;
                        moveItemDown(id);
                });
        });

        // Drag & drop (escritorio)
        let draggedId = null;
        let draggedType = null; // 'cat' or 'sub'

        document.querySelectorAll('.draggable-cat, .draggable-sub').forEach(el => {
            // make keyboard-focusable
            el.setAttribute('tabindex', '0');
            el.addEventListener('dragstart', (e) => {
                draggedId = el.dataset.id;
                draggedType = el.classList.contains('draggable-cat') ? 'cat' : 'sub';
                e.dataTransfer.effectAllowed = 'move';
                try { e.dataTransfer.setData('text/plain', draggedId); } catch (err) {}
                el.classList.add('opacity-50');
                el.setAttribute('aria-grabbed', 'true');
            });
            el.addEventListener('dragend', (e) => {
                draggedId = null;
                draggedType = null;
                el.classList.remove('opacity-50');
                el.setAttribute('aria-grabbed', 'false');
            });
        });

        // Allow drop on category list items and sub containers
        document.querySelectorAll('#incomeCategoriesList > li, #expenseCategoriesList > li, .subs-container').forEach(target => {
                target.addEventListener('dragover', (e) => {
                        e.preventDefault();
                        e.dataTransfer.dropEffect = 'move';
                        target.classList.add('drag-over');
                });
                target.addEventListener('dragleave', (e) => {
                        target.classList.remove('drag-over');
                });
                target.addEventListener('drop', (e) => {
                        e.preventDefault();
                        target.classList.remove('drag-over');
                        const targetParentId = target.dataset.parentId || null;
                        // If drop on a li (category), get its id and type
                        const targetLi = target.closest('li[data-id]');
                        let beforeId = null;
                        let targetType = null;
                        if (targetLi && targetLi.dataset.id) {
                                // Dropping on a category li -> if dragged is cat and types match, place before this category
                                beforeId = targetLi.dataset.id;
                                // Determine type by seeing which list contains this li
                                const list = targetLi.closest('#incomeCategoriesList') ? 'income' : 'expense';
                                targetType = list;
                        } else if (target.classList.contains('subs-container')) {
                                // Dropping into a sub container -> append to that parent's subs
                                targetType = categories.find(c => c.id === target.dataset.parentId)?.type;
                        }

                        if (!draggedId) return;
                        const moving = categories.find(c => c.id === draggedId);
                        if (!moving) return;

                        // If moving a main category
                        if (draggedType === 'cat') {
                                // Ensure same type
                                if (targetType && moving.type === targetType) {
                                        reorderAmongSiblings(draggedId, beforeId, moving.type, '');
                                        saveCategories();
                                }
                        } else if (draggedType === 'sub') {
                                // Only allow dropping within same parent container
                                const parentIdOfTarget = target.dataset.parentId || (targetLi ? (targetLi.dataset.id ? targetLi.dataset.id : null) : null);
                                if (parentIdOfTarget && moving.parentId === parentIdOfTarget) {
                                        // When dropping on a sub-container, beforeId null -> append
                                        const beforeSubId = targetLi && targetLi.dataset.id && targetLi.dataset.parentId === parentIdOfTarget ? targetLi.dataset.id : null;
                                        reorderAmongSiblings(draggedId, beforeSubId, moving.type, parentIdOfTarget);
                                        saveCategories();
                                }
                        }
                });
        });

    // Actualizar opciones de subcategoría (parent)
    const parentSelect = document.getElementById('parentCategory');
    const type = document.getElementById('categoryType').value;
    parentSelect.innerHTML = '<option value="">Ninguna (Categoría principal)</option>' +
        categories.filter(cat => cat.type === type && !cat.parentId).map(cat =>
            `<option value="${cat.id}">${cat.name}</option>`
        ).join('');

    // Asignar listeners a los botones de editar/borrar
    document.querySelectorAll('.edit-category-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = btn.dataset.id;
            startEditCategory(id);
        });
    });
    document.querySelectorAll('.delete-category-btn').forEach(btn => {
        btn.addEventListener('click', (e) => {
            const id = btn.dataset.id;
            deleteCategory(id);
        });
    });
}

async function loadCategories() {
    const stored = await preferencesDB.getItem(CATEGORIES_STORAGE_KEY);
    try {
        categories = stored ? JSON.parse(stored) : [];
    } catch {
        categories = [];
    }
    renderCategories();
}

async function saveCategories() {
    await preferencesDB.setItem(CATEGORIES_STORAGE_KEY, JSON.stringify(categories));
    renderCategories();
}

function startEditCategory(id) {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;
    editingCategoryId = id;
    document.getElementById('categoryFormTitle').textContent = 'Editar Categoría';
    document.getElementById('categoryType').value = cat.type;
    document.getElementById('categoryName').value = cat.name;
    document.getElementById('categoryColor').value = cat.color;
    document.getElementById('categoryIcon').value = cat.icon || '';
    document.getElementById('parentCategory').value = cat.parentId || '';
    renderCategories(); // Para actualizar el select de parent
    openCategoryFormModal();
}

function generateId() {
    return 'cat_' + Math.random().toString(36).substr(2, 9);
}

async function deleteCategory(id) {
    const cat = categories.find(c => c.id === id);
    if (!cat) return;

    // Verificar si es una categoría padre con subcategorías
    const hasChildren = categories.some(c => c.parentId === id);
    let message = `¿Estás seguro de que deseas eliminar la categoría "${cat.name}"?`;
    
    if (hasChildren) {
        message += `\n\nADVERTENCIA: Esta categoría tiene subcategorías que también serán eliminadas permanentemente.`;
    }

    if (!confirm(message)) return;

    // Eliminar subcategorías recursivamente
    function deleteRecursive(catId) {
        categories = categories.filter(c => c.id !== catId);
        categories.filter(c => c.parentId === catId).forEach(sub => deleteRecursive(sub.id));
    }
    deleteRecursive(id);
    await saveCategories();
}

document.addEventListener('DOMContentLoaded', () => {
    // Modal open/close
    const openBtn = document.getElementById('openCategoriesModal');
    const closeBtn = document.getElementById('closeCategoriesModal');
    const modal = document.getElementById('categoriesModal');
    if (openBtn && closeBtn && modal) {
        openBtn.addEventListener('click', openCategoriesModal);
        closeBtn.addEventListener('click', closeCategoriesModal);
        modal.addEventListener('click', (e) => {
            if (e.target === modal) closeCategoriesModal();
        });
    }

    // Modal de formulario de categoría (Nuevo/Editar)
    const openCreateCatBtn = document.getElementById('openCreateCategoryModal');
    const closeCreateCatBtn = document.getElementById('closeCategoryFormModal');
    const createCatModal = document.getElementById('categoryFormModal');
    
    if (openCreateCatBtn) {
        openCreateCatBtn.addEventListener('click', openCategoryFormModal);
    }
    if (closeCreateCatBtn) {
        closeCreateCatBtn.addEventListener('click', closeCategoryFormModal);
    }
    if (createCatModal) {
        createCatModal.addEventListener('click', (e) => {
            if (e.target === createCatModal) closeCategoryFormModal();
        });
    }

    // Cancelar edición / cerrar formulario
    const cancelBtn = document.getElementById('cancelEditCategory');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', closeCategoryFormModal);
    }

    // Cambiar tipo actualiza parent
    const typeSelect = document.getElementById('categoryType');
    if (typeSelect) {
        typeSelect.addEventListener('change', renderCategories);
    }
    // Formulario submit
    const form = document.getElementById('categoryForm');
    if (form) {
        form.addEventListener('submit', async (e) => {
            e.preventDefault();
            const type = document.getElementById('categoryType').value;
            const name = document.getElementById('categoryName').value.trim();
            const color = document.getElementById('categoryColor').value;
            const icon = document.getElementById('categoryIcon').value.trim();
            const parentId = document.getElementById('parentCategory').value || null;
            if (!name) return;
            if (editingCategoryId) {
                // Editar
                const idx = categories.findIndex(c => c.id === editingCategoryId);
                if (idx !== -1) {
                    categories[idx] = { ...categories[idx], type, name, color, icon, parentId };
                }
            } else {
                // Nueva
                categories.push({ id: generateId(), type, name, color, icon, parentId });
            }
            await saveCategories();
            closeCategoryFormModal();
        });
    }

    initAccountsModule().catch(console.error);
    initOperationsModule().catch(console.error);
});

async function initAccountsModule() {
    const accountsSection = document.getElementById('accountGroupsContainer');
    if (!accountsSection) {
        return;
    }

    await preferencesDB.initPromise;
    await hydrateAccountCategoriesFromStorage();
    await hydrateAccountsFromStorage();
    const integrityChanged = ensureAccountsCategoryIntegrity();
    if (integrityChanged) {
        await saveAccountsToStorage();
    }

    const detectedCurrency = determineAccountsCurrency(accountsCurrency);
    refreshAccountsCurrencyFormatter(detectedCurrency);

    watchCurrencyPreferenceChanges();
    attachAccountsEventListeners();
    renderAccountsUI();
    await renderSavingsGoalsAllocationCard();
}

// --- Operaciones (registro de movimientos) ---
const OPERATION_TYPE_META = {
    income: {
        label: 'Ingreso',
        badgeClasses: 'bg-green-100 text-green-600',
        amountClasses: 'text-green-600',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 19V5"/><path d="M5 12l7-7 7 7"/></svg>'
    },
    expense: {
        label: 'Gasto',
        badgeClasses: 'bg-red-100 text-red-600',
        amountClasses: 'text-red-600',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12h14"/></svg>'
    },
    transfer: {
        label: 'Transferencia',
        badgeClasses: 'bg-indigo-100 text-indigo-600',
        amountClasses: 'text-indigo-600',
        icon: '<svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><polyline points="17 1 21 5 17 9"/><polyline points="7 23 3 19 7 15"/><path d="M20 5H8a4 4 0 0 0-4 4v2"/><path d="M4 19h12a4 4 0 0 0 4-4v-2"/></svg>'
    }
};

function normalizeOperationRecord(raw) {
    if (!raw || typeof raw !== 'object') {
        return null;
    }
    const type = normalizeOperationType(raw.type);
    const id = typeof raw.id === 'string' && raw.id.trim() ? raw.id : generateOperationId();
    const amount = Math.abs(Number(raw.amount)) || 0;
    const datetime = Number.isFinite(Date.parse(raw.datetime || raw.date))
        ? new Date(raw.datetime || raw.date).toISOString()
        : new Date().toISOString();
    const monthKey = getMonthKeyFromDate(datetime);
    const title = String(raw.title || raw.name || OPERATION_TYPE_META[type].label || 'Operación').trim();
    const description = typeof raw.description === 'string' ? raw.description : '';
    const categoryId = typeof raw.categoryId === 'string' ? raw.categoryId : '';
    const status = (typeof raw.status === 'string' && (raw.status === 'scheduled' || raw.status === 'executed')) ? raw.status : 'executed';
    const base = {
        id,
        type,
        title,
        description,
        amount,
        datetime,
        monthKey,
        status,
        createdAt: Number.isFinite(Date.parse(raw.createdAt)) ? new Date(raw.createdAt).toISOString() : datetime,
        updatedAt: Number.isFinite(Date.parse(raw.updatedAt)) ? new Date(raw.updatedAt).toISOString() : datetime,
        categoryId
    };

    if (type === 'transfer') {
        return {
            ...base,
            fromAccountId: typeof raw.fromAccountId === 'string' ? raw.fromAccountId : null,
            toAccountId: typeof raw.toAccountId === 'string' ? raw.toAccountId : null,
            accountId: null
        };
    }

    return {
        ...base,
        accountId: typeof raw.accountId === 'string' ? raw.accountId : null,
        fromAccountId: null,
        toAccountId: null
    };
}

async function hydrateOperationsFromStorage() {
    let stored = await preferencesDB.getItem(OPERATIONS_STORAGE_KEY);
    if (!stored) {
        stored = getLocalStorageFallback(OPERATIONS_STORAGE_KEY);
    }

    if (!stored) {
        operations = [];
        return;
    }

    try {
        const parsed = JSON.parse(stored);
        if (Array.isArray(parsed)) {
            operations = parsed
                .map(normalizeOperationRecord)
                .filter(Boolean)
                .sort((a, b) => Date.parse(b.datetime) - Date.parse(a.datetime));
            return;
        }
    } catch (error) {
        console.error('Error parsing operations storage:', error);
    }
    operations = [];
}

async function saveOperationsToStorage() {
    try {
        const payload = JSON.stringify(operations);
        await preferencesDB.setItem(OPERATIONS_STORAGE_KEY, payload);
        setLocalStorageFallback(OPERATIONS_STORAGE_KEY, payload);
    } catch (error) {
        console.error('Error saving operations:', error);
    }
}

function getMonthlyOperations(monthKey) {
    if (!monthKey) return [];
    return operations.filter(op => op.monthKey === monthKey);
}

function getOperationsForCurrentPeriod() {
    if (!selectedOperationsMonthKey) return [];
    const monthKeys = getPeriodMonthKeys(selectedOperationsMonthKey, operationsPeriodMode);
    if (!monthKeys.length) return [];
    const lookup = new Set(monthKeys);
    return operations.filter(op => lookup.has(op.monthKey));
}

function getFilteredOperations(monthOperations, filterType) {
    if (!Array.isArray(monthOperations)) return [];
    
    // Filter by type or schedule status
    if (filterType === 'scheduled') {
        return monthOperations.filter(op => op.status === 'scheduled');
    }

    if (filterType === 'all') {
        return monthOperations;
    }
    
    // For other filters, we typically only show executed operations unless we want to show everything
    // But usually 'Ingresos' implies executed incomes. 
    // Let's decide: 'Todos', 'Ingresos', 'Gastos' show executed operations. 
    // 'Programadas' shows scheduled operations (any type).
    // Or 'Todos' shows executed (any type).
    
    // Let's filter out scheduled operations from normal views to avoid confusion
    const executedOps = monthOperations.filter(op => op.status !== 'scheduled');

    if (filterType === 'income') {
        return executedOps.filter(op => op.type === 'income');
    }
    if (filterType === 'expense') {
        return executedOps.filter(op => op.type === 'expense');
    }
    // filterType === 'all'
    return executedOps;
}

function calculateOperationsTotals(monthOperations) {
    let income = 0;
    let expense = 0;
    // Only count executed operations for totals
    monthOperations.forEach(op => {
        if (op.status === 'scheduled') return;
        
        if (op.type === 'income') {
            income += op.amount;
        } else if (op.type === 'expense') {
            expense += op.amount;
        }
    });
    const balance = income - expense;
    return { income, expense, balance };
}

function updateOperationsMonthHeader() {
    const labelEl = document.getElementById('opsCurrentMonthLabel');
    const prevBtn = document.getElementById('opsPrevMonthBtn');
    const nextBtn = document.getElementById('opsNextMonthBtn');
    const isAtCurrentPeriod = isCurrentPeriodSelected();
    if (labelEl) {
        labelEl.textContent = formatPeriodLabel(selectedOperationsMonthKey, operationsPeriodMode);
    }
    if (prevBtn) {
        prevBtn.disabled = false;
        prevBtn.classList.remove('opacity-40', 'cursor-not-allowed');
    }
    if (nextBtn) {
        nextBtn.disabled = isAtCurrentPeriod;
        nextBtn.classList.toggle('opacity-40', isAtCurrentPeriod);
        nextBtn.classList.toggle('cursor-not-allowed', isAtCurrentPeriod);
    }
}

function renderOperationsSummary() {
    const balanceEl = document.getElementById('opsMonthBalanceValue');
    const incomeEl = document.getElementById('opsMonthIncomeValue');
    const expenseEl = document.getElementById('opsMonthExpenseValue');
    const percentEl = document.getElementById('opsMonthExpensePercent');
    const arcEl = document.getElementById('opsMonthExpenseArc');
    
    // Only show period ops, excluding scheduled unless specific view requested? 
    // Usually Summary is "What happened", so executed only.
    // getOperationsForCurrentPeriod gets all based on date.
    // calculateOperationsTotals now excludes scheduled.
    const periodOps = getOperationsForCurrentPeriod();
    const totals = calculateOperationsTotals(periodOps);

    if (balanceEl) balanceEl.textContent = formatAccountAmount(totals.balance);
    if (incomeEl) incomeEl.textContent = formatAccountAmount(totals.income);
    if (expenseEl) expenseEl.textContent = formatAccountAmount(totals.expense);

    const expensePercent = totals.income <= 0
        ? (totals.expense > 0 ? 100 : 0)
        : Math.min(100, Math.round((totals.expense / totals.income) * 100));

    if (percentEl) {
        percentEl.textContent = `${expensePercent}%`;
        percentEl.title = `${expensePercent}% del ingreso gastado`;
        percentEl.classList.toggle('text-amber-500', true);
    }

    if (arcEl) {
        const radius = 42;
        const circumference = 2 * Math.PI * radius;
        const offset = circumference - (expensePercent / 100) * circumference;
        arcEl.style.strokeDasharray = `${circumference}`;
        arcEl.style.strokeDashoffset = `${offset}`;
    }
}

function capitalizeLabel(label) {
    if (!label) return '';
    return label.charAt(0).toUpperCase() + label.slice(1);
}

function renderOperationsEmptyState(container, message) {
    container.innerHTML = `
        <div class="text-center py-10 bg-white border border-dashed border-gray-200 rounded-2xl">
            <div class="inline-flex p-3 rounded-full bg-gray-100 text-gray-400 mb-3">
                <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"></circle><line x1="12" y1="8" x2="12.01" y2="8"></line><line x1="12" y1="12" x2="12" y2="16"></line></svg>
            </div>
            <p class="text-sm text-gray-500">${message}</p>
        </div>
    `;
}

function getOperationAccountsLabel(operation) {
    if (!operation) return '—';
    if (operation.type === 'transfer') {
        const fromAcc = getAccountById(operation.fromAccountId);
        const toAcc = getAccountById(operation.toAccountId);
        const fromName = fromAcc?.name || 'Cuenta origen';
        const toName = toAcc?.name || 'Cuenta destino';
        return `${fromName} → ${toName}`;
    }
    const account = getAccountById(operation.accountId);
    return account?.name || 'Cuenta no disponible';
}

function formatOperationAmount(operation) {
    const formatted = formatAccountAmount(operation.amount);
    if (operation.type === 'expense') return `- ${formatted}`;
    if (operation.type === 'income') return `+ ${formatted}`;
    return formatted;
}

function formatMoneyWithSign(value) {
    const formatted = formatAccountAmount(Math.abs(value));
    if (value > 0) return `+ ${formatted}`;
    if (value < 0) return `- ${formatted}`;
    return formatted;
}

function buildOperationHistoryItem(operation) {
    const meta = OPERATION_TYPE_META[operation.type] || OPERATION_TYPE_META.expense;
    const date = new Date(operation.datetime);
    const timeLabel = Number.isFinite(date.getTime())
        ? date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
        : '';
    const accountLabel = getOperationAccountsLabel(operation);
    const description = operation.description ? `<p class="text-xs text-gray-500 mt-0.5">${escapeHtml(operation.description)}</p>` : '';
    
    const categoryMeta = getOperationCategoryMeta(operation.categoryId);
    const categoryLabel = categoryMeta?.displayName || categoryMeta?.rawName || '';
    const hasCategory = Boolean(categoryLabel);
    const baseColor = categoryMeta?.color || '#6b7280';
    
    const categoryBadge = hasCategory
        ? `<span class="inline-flex items-center gap-1 text-[10px] font-semibold px-2 py-0.5 rounded-full border" style="background-color: ${baseColor}20; color: ${baseColor}; border-color: ${baseColor}40;">
                <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${baseColor};"></span>${escapeHtml(categoryLabel)}
           </span>`
        : '';

    const isScheduled = operation.status === 'scheduled';
    const scheduledBadge = isScheduled
        ? `<span class="inline-flex items-center gap-1 text-[10px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full bg-indigo-100 text-indigo-700 border border-indigo-200">
            <svg xmlns="http://www.w3.org/2000/svg" width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
            Programado
           </span>`
        : '';

    const opacityClass = isScheduled ? 'opacity-75' : '';
    const borderClass = isScheduled ? 'border-dashed border-indigo-300 bg-indigo-50/30' : 'border-gray-100 bg-white';

    return `
        <div class="flex items-center gap-4 p-4 ${borderClass} rounded-xl shadow-sm ${opacityClass}">
            <div class="flex-shrink-0">
                <div class="w-11 h-11 rounded-full flex items-center justify-center ${meta.badgeClasses}">
                    ${meta.icon}
                </div>
            </div>
            <div class="flex-grow min-w-0">
                <div class="flex items-center gap-2">
                    <p class="font-semibold text-gray-800 truncate">${escapeHtml(operation.title)}</p>
                    <span class="text-[11px] font-bold uppercase tracking-wider px-2 py-0.5 rounded-full ${meta.badgeClasses}">${meta.label}</span>
                    ${scheduledBadge}
                </div>
                <div class="flex flex-wrap items-center gap-2 text-xs text-gray-400">
                    <span>${escapeHtml(accountLabel)}${timeLabel ? ` • ${timeLabel}` : ''}</span>
                    ${categoryBadge}
                </div>
                ${description}
            </div>
            <div class="text-right flex flex-col items-end gap-2">
                <p class="font-bold text-sm ${meta.amountClasses}">${formatOperationAmount(operation)}</p>
                <button type="button" class="text-xs font-semibold text-indigo-600 hover:text-indigo-800 transition ops-history-manage" data-operation-id="${operation.id}">
                    Detalles
                </button>
            </div>
        </div>
    `;
}

function renderOperationsHistory() {
    const container = document.getElementById('opsHistoryContainer');
    if (!container) return;
    container.innerHTML = '';

    const periodOperations = getOperationsForCurrentPeriod();
    const filteredOperations = getFilteredOperations(periodOperations, operationsFilterType).sort((a, b) => Date.parse(b.datetime) - Date.parse(a.datetime));

    if (!filteredOperations.length) {
        const message = periodOperations.length
            ? 'No hay operaciones para este filtro.'
            : 'No has registrado operaciones en este periodo.';
        renderOperationsEmptyState(container, message);
        return;
    }

    const groupsMap = new Map();
    filteredOperations.forEach(operation => {
        let dayKey;
        if (operation.datetime) {
            const d = new Date(operation.datetime);
            const year = d.getFullYear();
            const month = String(d.getMonth() + 1).padStart(2, '0');
            const day = String(d.getDate()).padStart(2, '0');
            dayKey = `${year}-${month}-${day}`;
        } else {
            dayKey = operation.id;
        }

        if (!groupsMap.has(dayKey)) {
            groupsMap.set(dayKey, []);
        }
        groupsMap.get(dayKey).push(operation);
    });

    const groups = Array.from(groupsMap.entries()).sort((a, b) => b[0].localeCompare(a[0]));
    const fragment = document.createDocumentFragment();

    groups.forEach(([dayKey, items]) => {
        let dayDate;
        // Intentar parsear YYYY-MM-DD localmente
        if (/^\d{4}-\d{2}-\d{2}$/.test(dayKey)) {
            const [y, m, d] = dayKey.split('-').map(Number);
            dayDate = new Date(y, m - 1, d);
        } else {
            dayDate = items.length ? new Date(items[0].datetime) : new Date();
        }
        
        const label = capitalizeLabel(dayDate.toLocaleDateString('es-ES', { weekday: 'long', day: '2-digit', month: 'long' }));
        let incomeTotal = 0;
        let expenseTotal = 0;
        items.forEach(operation => {
            if (operation.type === 'income') {
                incomeTotal += operation.amount;
            } else if (operation.type === 'expense') {
                expenseTotal += operation.amount;
            }
        });
        let pnlLabelText = 'Balance del día';
        let pnlValue = 0;
        if (incomeTotal > 0 && expenseTotal > 0) {
            pnlValue = incomeTotal - expenseTotal;
        } else if (incomeTotal > 0) {
            pnlValue = incomeTotal;
            pnlLabelText = 'Ingresos del día';
        } else if (expenseTotal > 0) {
            pnlValue = -expenseTotal;
            pnlLabelText = 'Gastos del día';
        }
        const pnlAmountClasses = pnlValue > 0
            ? 'text-emerald-600'
            : (pnlValue < 0 ? 'text-red-600' : 'text-gray-500');
        const pnlValueLabel = formatMoneyWithSign(pnlValue);

        const groupEl = document.createElement('div');
        groupEl.className = 'mb-6';
        groupEl.innerHTML = `
            <div class="flex items-center justify-between mb-3">
                <div>
                    <p class="text-sm font-semibold text-gray-700">${escapeHtml(label)}</p>
                    <p class="text-xs text-gray-400">${items.length} ${items.length === 1 ? 'movimiento' : 'movimientos'}</p>
                </div>
                <div class="text-right">
                    <p class="text-[11px] font-bold uppercase tracking-wider text-gray-400">${escapeHtml(pnlLabelText)}</p>
                    <p class="text-sm font-semibold ${pnlAmountClasses}">${pnlValueLabel}</p>
                </div>
            </div>
            <div class="space-y-3">
                ${items.map(buildOperationHistoryItem).join('')}
            </div>
        `;
        fragment.appendChild(groupEl);
    });

    container.appendChild(fragment);
}

function updateOperationsFilterButtons() {
    const buttons = document.querySelectorAll('#opsTypeFilter [data-filter]');
    buttons.forEach(button => {
        const filter = button.dataset.filter || 'all';
        const isActive = filter === operationsFilterType;
        button.classList.toggle('bg-white', isActive);
        button.classList.toggle('shadow-sm', isActive);
        button.classList.toggle('text-indigo-600', isActive);
        button.classList.toggle('text-gray-500', !isActive);
    });
}

function renderOperationsView() {
    updateOperationsMonthHeader();
    renderOperationsSummary();
    updateOperationsFilterButtons();
    renderOperationsHistory();
}

function hydrateOperationsEditorForm(operation = null) {
    const titleInput = document.getElementById('opsTitleInput');
    const descriptionInput = document.getElementById('opsDescriptionInput');
    const amountInput = document.getElementById('opsAmountInput');
    const datetimeInput = document.getElementById('opsDatetimeInput');
    const accountSelect = document.getElementById('opsAccountSelect');
    const transferFromSelect = document.getElementById('opsTransferFromSelect');
    const transferToSelect = document.getElementById('opsTransferToSelect');
    const categorySelect = document.getElementById('opsCategorySelect');

    const defaultDateValue = formatDateValueForInput(new Date());

    if (!operation) {
        if (titleInput) titleInput.value = '';
        if (descriptionInput) descriptionInput.value = '';
        if (amountInput) amountInput.value = '';
        if (datetimeInput) datetimeInput.value = defaultDateValue;
        if (accountSelect) accountSelect.value = accountSelect.options[0]?.value || '';
        if (transferFromSelect) transferFromSelect.value = transferFromSelect.options[0]?.value || '';
        if (transferToSelect) transferToSelect.value = transferToSelect.options[transferToSelect.options.length - 1]?.value || '';
        if (categorySelect) categorySelect.value = '';
        return;
    }

    if (titleInput) titleInput.value = operation.title || '';
    if (descriptionInput) descriptionInput.value = operation.description || '';
    if (amountInput) amountInput.value = typeof operation.amount === 'number' ? String(operation.amount) : '';

    const parsedDate = Number.isFinite(Date.parse(operation.datetime))
        ? new Date(operation.datetime)
        : new Date();
    if (datetimeInput) datetimeInput.value = formatDateValueForInput(parsedDate);

    if (operation.type === 'transfer') {
        if (transferFromSelect) transferFromSelect.value = operation.fromAccountId || transferFromSelect.value;
        if (transferToSelect) transferToSelect.value = operation.toAccountId || transferToSelect.value;
    } else if (accountSelect) {
        accountSelect.value = operation.accountId || accountSelect.value;
    }

    if (categorySelect && operation.categoryId) {
        categorySelect.value = operation.categoryId;
    }
}

function populateOperationsAccountSelect(selectElement, excludeId = null) {
    if (!selectElement) return;
    const options = accounts
        .filter(acc => !excludeId || acc.id !== excludeId)
        .map(acc => `<option value="${acc.id}">${escapeHtml(acc.name || 'Cuenta')}</option>`)
        .join('');
    selectElement.innerHTML = options;
}

function populateOperationsAccountSelects() {
    const accountSelect = document.getElementById('opsAccountSelect');
    const transferFromSelect = document.getElementById('opsTransferFromSelect');
    const transferToSelect = document.getElementById('opsTransferToSelect');
    populateOperationsAccountSelect(accountSelect);
    populateOperationsAccountSelect(transferFromSelect);
    populateOperationsAccountSelect(transferToSelect);
}

function toggleOperationsEditorMode(type) {
    const singleWrap = document.getElementById('opsAccountSingleWrap');
    const transferWrap = document.getElementById('opsAccountTransferWrap');
    if (!singleWrap || !transferWrap) return;
    if (type === 'transfer') {
        singleWrap.classList.add('hidden');
        transferWrap.classList.remove('hidden');
    } else {
        singleWrap.classList.remove('hidden');
        transferWrap.classList.add('hidden');
    }
}

async function openOperationsEditor(type, operation = null) {
    const modal = document.getElementById('opsEditorModal');
    const typeInput = document.getElementById('opsEditorType');
    const titleEl = document.getElementById('opsEditorTitle');
    const subtitleEl = document.getElementById('opsEditorSubtitle');
    const categorySelect = document.getElementById('opsCategorySelect');
    const wrap = document.getElementById('opsCategoryWrap');
    if (!modal || !typeInput) return;

    if (!accounts.length) {
        alert('Registra al menos una cuenta antes de crear operaciones.');
        return;
    }

    populateOperationsAccountSelects();

    const supportsCategory = type === 'income' || type === 'expense';
    if (wrap && categorySelect) {
        if (!supportsCategory) {
            wrap.classList.add('hidden');
            categorySelect.value = '';
        } else {
            try {
                await hydrateOperationCategoriesOptions();
            } catch (error) {
                console.error('Error loading categories for operaciones:', error);
            }
            updateOperationsCategorySection(type, operation?.categoryId || '');
        }
    }
    typeInput.value = type;
    toggleOperationsEditorMode(type);
    hydrateOperationsEditorForm(operation);
    editingOperationId = operation?.id || null;

    if (titleEl) {
        if (operation) {
            titleEl.textContent = 'Editar operación';
        } else if (type === 'income') {
            titleEl.textContent = 'Registrar ingreso';
        } else if (type === 'transfer') {
            titleEl.textContent = 'Registrar transferencia';
        } else {
            titleEl.textContent = 'Registrar gasto';
        }
    }
    if (subtitleEl) {
        subtitleEl.textContent = operation ? 'ACTUALIZA TU MOVIMIENTO' : 'REGISTRA UN MOVIMIENTO';
    }

    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function closeOperationsEditor() {
    const modal = document.getElementById('opsEditorModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    editingOperationId = null;
}

function openOperationsDetailsModal(operationId) {
    const modal = document.getElementById('opsDetailsModal');
    if (!modal) return;
    const operation = operations.find(op => op.id === operationId);
    if (!operation) return;

    const meta = OPERATION_TYPE_META[operation.type] || OPERATION_TYPE_META.expense;
    const titleEl = document.getElementById('opsDetailsTitle');
    const subtitleEl = document.getElementById('opsDetailsSubtitle');
    const typeEl = document.getElementById('opsDetailsType');
    const amountEl = document.getElementById('opsDetailsAmount');
    const dateEl = document.getElementById('opsDetailsDate');
    const accountsEl = document.getElementById('opsDetailsAccounts');
    const descriptionEl = document.getElementById('opsDetailsDescription');
    const categoryEl = document.getElementById('opsDetailsCategory');

    if (titleEl) titleEl.textContent = operation.title || meta.label;
    if (subtitleEl) subtitleEl.textContent = 'OPERACIÓN';
    if (typeEl) typeEl.textContent = meta.label;
    if (amountEl) {
        amountEl.textContent = formatOperationAmount(operation);
        amountEl.className = `text-sm font-bold ${meta.amountClasses}`;
    }

    const date = new Date(operation.datetime);
    const formattedDate = Number.isFinite(date.getTime())
        ? date.toLocaleString('es-ES', { dateStyle: 'full', timeStyle: 'short' })
        : 'Fecha no disponible';
    if (dateEl) dateEl.textContent = formattedDate;
    if (accountsEl) accountsEl.textContent = getOperationAccountsLabel(operation);
    if (descriptionEl) descriptionEl.textContent = operation.description?.trim() || 'Sin descripción';
    if (categoryEl) {
        const catMeta = getOperationCategoryMeta(operation.categoryId);
        const label = catMeta?.displayName || catMeta?.rawName || 'Sin categoría';
        
        if (catMeta) {
             const baseColor = catMeta.color || '#6b7280';
             // Usamos innerHTML para insertar el badge coloreado
             categoryEl.innerHTML = `
                <span class="inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full border text-xs" style="background-color: ${baseColor}20; color: ${baseColor}; border-color: ${baseColor}40;">
                    <span class="w-1.5 h-1.5 rounded-full" style="background-color: ${baseColor};"></span>
                    ${escapeHtml(label)}
                </span>
             `;
        } else {
             categoryEl.textContent = label;
        }
    }

    activeOperationDetailsId = operation.id;
    modal.classList.remove('hidden');
    document.body.classList.add('overflow-hidden');
}

function closeOperationsDetailsModal() {
    const modal = document.getElementById('opsDetailsModal');
    if (!modal) return;
    modal.classList.add('hidden');
    document.body.classList.remove('overflow-hidden');
    activeOperationDetailsId = null;
}

function applyOperationToAccounts(operation, options = {}) {
    const { recordHistory = true } = options;
    if (!operation) {
        return { success: false, message: 'Operación inválida.' };
    }

    // Skip balance update if scheduled
    if (operation.status === 'scheduled') {
        return { success: true };
    }

    if (operation.type === 'income') {
        const account = getAccountById(operation.accountId);
        if (!account) return { success: false, message: 'Selecciona una cuenta válida.' };
        account.balance = Number(account.balance || 0) + operation.amount;
        if (recordHistory) {
            pushAccountHistoryEntry(account, {
                type: 'deposit',
                description: operation.title || 'Ingreso',
                details: `+${formatAccountAmount(operation.amount)} · Saldo: ${formatAccountAmount(account.balance)}`,
                date: operation.datetime
            });
        }
        return { success: true };
    }
    if (operation.type === 'expense') {
        const account = getAccountById(operation.accountId);
        if (!account) return { success: false, message: 'Selecciona una cuenta válida.' };
        account.balance = Number(account.balance || 0) - operation.amount;
        if (recordHistory) {
            pushAccountHistoryEntry(account, {
                type: 'expense',
                description: operation.title || 'Gasto',
                details: `-${formatAccountAmount(operation.amount)} · Saldo: ${formatAccountAmount(account.balance)}`,
                date: operation.datetime
            });
        }
        return { success: true };
    }
    const fromAccount = getAccountById(operation.fromAccountId);
    const toAccount = getAccountById(operation.toAccountId);
    if (!fromAccount || !toAccount) {
        return { success: false, message: 'Selecciona cuentas válidas para transferir.' };
    }
    if (fromAccount.id === toAccount.id) {
        return { success: false, message: 'La cuenta origen y destino deben ser diferentes.' };
    }

    fromAccount.balance = Number(fromAccount.balance || 0) - operation.amount;
    toAccount.balance = Number(toAccount.balance || 0) + operation.amount;

    if (recordHistory) {
        pushAccountHistoryEntry(fromAccount, {
            type: 'transfer',
            description: `Transferencia hacia ${toAccount.name || 'Cuenta'}`,
            details: `-${formatAccountAmount(operation.amount)} · Saldo: ${formatAccountAmount(fromAccount.balance)}`,
            date: operation.datetime
        });
        pushAccountHistoryEntry(toAccount, {
            type: 'transfer',
            description: `Transferencia desde ${fromAccount.name || 'Cuenta'}`,
            details: `+${formatAccountAmount(operation.amount)} · Saldo: ${formatAccountAmount(toAccount.balance)}`,
            date: operation.datetime
        });
    }
    return { success: true };
}

function revertOperationEffect(operation) {
    if (!operation) {
        return { success: false, message: 'Operación inválida.' };
    }
    const inverseOperation = {
        ...operation,
        amount: (operation.amount || 0) * -1
    };
    return applyOperationToAccounts(inverseOperation, { recordHistory: false });
}

async function handleOperationsFormSubmit(event) {
    event.preventDefault();
    const typeInput = document.getElementById('opsEditorType');
    const titleInput = document.getElementById('opsTitleInput');
    const descriptionInput = document.getElementById('opsDescriptionInput');
    const amountInput = document.getElementById('opsAmountInput');
    const datetimeInput = document.getElementById('opsDatetimeInput');
    const accountSelect = document.getElementById('opsAccountSelect');
    const transferFromSelect = document.getElementById('opsTransferFromSelect');
    const transferToSelect = document.getElementById('opsTransferToSelect');
    const categorySelect = document.getElementById('opsCategorySelect');

    if (!typeInput || !amountInput) return;

    const type = normalizeOperationType(typeInput.value);
    const amount = parseMoney(amountInput.value);
    if (amount <= 0) {
        alert('Ingresa un monto mayor a cero.');
        return;
    }

    let datetimeValue = datetimeInput?.value;
    if (!datetimeValue) {
        datetimeValue = formatDateValueForInput(new Date());
    }
    let datetime = new Date(datetimeValue);
    if (!Number.isFinite(datetime.getTime())) {
        datetime = new Date();
    }
    const datetimeISO = new Date(datetime.getTime()).toISOString();
    const now = new Date();
    const nowISO = now.toISOString();
    
    // Check if date is in the future (ignore seconds/milliseconds for usability)
    const isFuture = datetime.getTime() > (now.getTime() + 60000);
    let status = 'executed';
    
    if (isFuture) {
        const confirmed = confirm('La fecha seleccionada es futura. ¿Deseas registrar esta operación como programada?\n\nNo afectará el saldo hasta que llegue la fecha.');
        if (confirmed) {
            status = 'scheduled';
        } else {
            // If user says no, we could either cancel or save as executed.
            // Usually "No" in this context implies "I made a mistake with the date" or "Save it as executed anyway"
            // Let's assume they want to correct the date, so we return to let them edit.
            // Or if they mean "Just save it", we save as executed.
            // Given "Validar que no se afecten los saldos... hasta la fecha", forcing executed on future date breaks that rule.
            // So if they decline scheduling on a future date, we should probably return.
            // However, maybe they want to record a future expense that they ALREADY paid?
            // "Ya lo pagué pero es para el mes que viene".
            // Let's offer a choice or just default to executed if they decline "Scheduled".
            // But the requirement says "Si la fecha es futura, marcar automáticamente como transacción programada".
            // The prompt also says "Incluir confirmación explícita".
            // So: Future -> Ask "Schedule?". Yes -> Scheduled. No -> Executed (Already paid).
            // Let's go with that.
        }
    }

    const isEditing = Boolean(editingOperationId);
    let targetIndex = -1;
    let previousOperation = null;
    if (isEditing) {
        targetIndex = operations.findIndex(op => op.id === editingOperationId);
        if (targetIndex !== -1) {
            previousOperation = operations[targetIndex];
        }
    }

    const supportsCategory = type === 'income' || type === 'expense';
    const selectedCategoryId = supportsCategory ? (categorySelect?.value || '') : '';

    const operation = {
        id: previousOperation?.id || generateOperationId(),
        type,
        title: titleInput?.value.trim() || (OPERATION_TYPE_META[type]?.label ?? 'Operación'),
        description: descriptionInput?.value.trim() || '',
        amount,
        datetime: datetimeISO,
        monthKey: getMonthKeyFromDate(datetimeISO),
        status, // 'executed' or 'scheduled'
        createdAt: previousOperation?.createdAt || nowISO,
        updatedAt: nowISO,
        accountId: null,
        fromAccountId: null,
        toAccountId: null,
        categoryId: selectedCategoryId
    };

    if (type === 'transfer') {
        const fromId = transferFromSelect?.value;
        const toId = transferToSelect?.value;
        if (!fromId || !toId) {
            alert('Selecciona cuentas válidas para transferir.');
            return;
        }
        operation.fromAccountId = fromId;
        operation.toAccountId = toId;
    } else {
        const accountId = accountSelect?.value;
        if (!accountId) {
            alert('Selecciona una cuenta.');
            return;
        }
        operation.accountId = accountId;
    }

    let previousBudgetReverted = false;
    if (previousOperation) {
        const revertResult = revertOperationEffect(previousOperation);
        if (!revertResult.success) {
            alert(revertResult.message || 'No se pudo actualizar la operación.');
            return;
        }
        try {
            await revertBudgetTrackingForOperation(previousOperation);
            previousBudgetReverted = true;
        } catch (error) {
            console.error('Error reverting budget tracking:', error);
        }
    }

    const applyResult = applyOperationToAccounts(operation, { recordHistory: !isEditing });
    if (!applyResult.success) {
        if (previousOperation) {
            applyOperationToAccounts(previousOperation, { recordHistory: false });
            if (previousBudgetReverted) {
                try {
                    await applyBudgetTrackingForOperation(previousOperation);
                } catch (error) {
                    console.error('Error restoring previous budget tracking:', error);
                }
            }
        }
        alert(applyResult.message || 'No se pudo registrar la operación.');
        return;
    }

    try {
        await applyBudgetTrackingForOperation(operation);
    } catch (error) {
        console.error('Error applying budget tracking:', error);
    }

    if (isEditing && targetIndex !== -1) {
        operations[targetIndex] = operation;
    } else {
        operations.unshift(operation);
    }
    operations.sort((a, b) => Date.parse(b.datetime) - Date.parse(a.datetime));

    await Promise.all([
        saveOperationsToStorage(),
        saveAccountsToStorage()
    ]);

    renderOperationsView();
    closeOperationsEditor();
}

function attachOperationsListeners() {
    if (operationsListenersAttached) return;
    operationsListenersAttached = true;

    const periodToggleBtn = document.getElementById('opsPeriodToggle');
    if (periodToggleBtn) {
        periodToggleBtn.addEventListener('click', toggleOperationsPeriodMenu);
    }

    const periodMenu = document.getElementById('opsPeriodMenu');
    if (periodMenu) {
        periodMenu.addEventListener('click', (e) => {
            const periodBtn = e.target.closest('[data-period-mode]');
            if (periodBtn) {
                setOperationsPeriodMode(periodBtn.dataset.periodMode);
            }
        });
    }

    document.addEventListener('click', (e) => {
        const periodSelector = document.getElementById('opsPeriodSelector');
        if (periodSelector && !periodSelector.contains(e.target)) {
            closeOperationsPeriodMenu();
        }
    });

    const prevBtn = document.getElementById('opsPrevMonthBtn');
    const nextBtn = document.getElementById('opsNextMonthBtn');
    if (prevBtn) {
        prevBtn.addEventListener('click', () => {
            selectedOperationsMonthKey = shiftPeriodKey(selectedOperationsMonthKey, operationsPeriodMode, -1);
            renderOperationsView();
        });
    }
    if (nextBtn) {
        nextBtn.addEventListener('click', () => {
            const candidate = shiftPeriodKey(selectedOperationsMonthKey, operationsPeriodMode, 1);
            if (compareMonthKeys(candidate, getCurrentMonthKey()) > 0) {
                return;
            }
            selectedOperationsMonthKey = candidate;
            renderOperationsView();
        });
    }

    document.querySelectorAll('#opsTypeFilter [data-filter]').forEach(button => {
        button.addEventListener('click', () => {
            const filter = button.dataset.filter || 'all';
            if (operationsFilterType === filter) return;
            operationsFilterType = filter;
            updateOperationsFilterButtons();
            renderOperationsHistory();
        });
    });

    const addExpenseBtn = document.getElementById('opsAddExpenseBtn');
    const addIncomeBtn = document.getElementById('opsAddIncomeBtn');
    const addTransferBtn = document.getElementById('opsAddTransferBtn');
    if (addExpenseBtn) addExpenseBtn.addEventListener('click', () => openOperationsEditor('expense'));
    if (addIncomeBtn) addIncomeBtn.addEventListener('click', () => openOperationsEditor('income'));
    if (addTransferBtn) addTransferBtn.addEventListener('click', () => {
        if (accounts.length < 2) {
            alert('Necesitas al menos dos cuentas para realizar una transferencia.');
            return;
        }
        openOperationsEditor('transfer');
    });

    const cancelEditorBtn = document.getElementById('opsCancelEditorBtn');
    const closeEditorBtn = document.getElementById('opsCloseEditorModal');
    const editorModal = document.getElementById('opsEditorModal');
    const editorForm = document.getElementById('opsEditorForm');

    if (cancelEditorBtn) cancelEditorBtn.addEventListener('click', closeOperationsEditor);
    if (closeEditorBtn) closeEditorBtn.addEventListener('click', closeOperationsEditor);
    if (editorModal) {
        editorModal.addEventListener('click', (event) => {
            if (event.target === editorModal) {
                closeOperationsEditor();
            }
        });
    }
    if (editorForm) {
        editorForm.addEventListener('submit', handleOperationsFormSubmit);
    }

    const scheduledFilterBtn = document.getElementById('opsFilterScheduled');
    if (scheduledFilterBtn) {
        scheduledFilterBtn.addEventListener('click', () => {
            if (operationsFilterType === 'scheduled') return;
            operationsFilterType = 'scheduled';
            updateOperationsFilterButtons();
            renderOperationsHistory();
        });
    }

    const detailsModal = document.getElementById('opsDetailsModal');
    const closeDetailsBtn = document.getElementById('opsCloseDetailsModal');
    if (closeDetailsBtn) closeDetailsBtn.addEventListener('click', closeOperationsDetailsModal);
    if (detailsModal) {
        detailsModal.addEventListener('click', (event) => {
            if (event.target === detailsModal) {
                closeOperationsDetailsModal();
            }
        });
    }

    const editOperationBtn = document.getElementById('opsEditOperationBtn');
    const deleteOperationBtn = document.getElementById('opsDeleteOperationBtn');
    if (editOperationBtn) {
        editOperationBtn.addEventListener('click', () => {
            if (!activeOperationDetailsId) return;
            const operation = operations.find(op => op.id === activeOperationDetailsId);
            if (!operation) return;
            closeOperationsDetailsModal();
            openOperationsEditor(operation.type, operation);
        });
    }
    if (deleteOperationBtn) {
        deleteOperationBtn.addEventListener('click', async () => {
            if (!activeOperationDetailsId) return;
            const operationIndex = operations.findIndex(op => op.id === activeOperationDetailsId);
            if (operationIndex === -1) return;
            const operation = operations[operationIndex];
            const confirmed = confirm('Esta acción eliminará la operación de forma permanente. ¿Deseas continuar?');
            if (!confirmed) return;
            const revertResult = revertOperationEffect(operation);
            if (!revertResult.success) {
                alert(revertResult.message || 'No se pudo revertir la operación.');
                return;
            }
            try {
                await revertBudgetTrackingForOperation(operation);
            } catch (error) {
                console.error('Error reverting budget tracking on delete:', error);
            }
            operations.splice(operationIndex, 1);
            await Promise.all([
                saveOperationsToStorage(),
                saveAccountsToStorage()
            ]);
            closeOperationsDetailsModal();
            renderOperationsView();
        });
    }

    const historyContainer = document.getElementById('opsHistoryContainer');
    if (historyContainer) {
        historyContainer.addEventListener('click', (event) => {
            const button = event.target.closest('.ops-history-manage');
            if (!button) return;
            const opId = button.dataset.operationId;
            openOperationsDetailsModal(opId);
        });
    }
}

async function initOperationsModule() {
    const historyContainer = document.getElementById('opsHistoryContainer');
    if (!historyContainer) {
        return;
    }

    await preferencesDB.initPromise;
    await hydrateAccountCategoriesFromStorage();
    await hydrateAccountsFromStorage();
    const detectedCurrency = determineAccountsCurrency(accountsCurrency);
    refreshAccountsCurrencyFormatter(detectedCurrency);
    await hydrateOperationsFromStorage();
    try {
        await hydrateOperationCategoriesOptions();
    } catch (error) {
        console.error('Error loading operation categories:', error);
    }

    if (!selectedOperationsMonthKey) {
        selectedOperationsMonthKey = getCurrentMonthKey();
    }
    operationsFilterType = operationsFilterType || 'all';

    // Process scheduled operations
    await processScheduledOperations();

    renderOperationsView();
    updateOperationsPeriodControls();
    attachOperationsListeners();
}

async function processScheduledOperations() {
    let changed = false;
    const now = new Date();
    
    for (const op of operations) {
        if (op.status === 'scheduled') {
            const opDate = new Date(op.datetime);
            if (Number.isFinite(opDate.getTime()) && opDate <= now) {
                // Time to execute
                op.status = 'executed';
                // Apply financial impact
                const result = applyOperationToAccounts(op, { recordHistory: true });
                if (result.success) {
                    await applyBudgetTrackingForOperation(op);
                    changed = true;
                }
            }
        }
    }

    if (changed) {
        await Promise.all([
            saveOperationsToStorage(),
            saveAccountsToStorage()
        ]);
        // alert('Se han ejecutado operaciones programadas pendientes.'); 
        // Optional alert, maybe too intrusive on load? User requested "Mostrar alertas claras cuando se registre una transacción programada" 
        // but for execution "Asegurar que el sistema funcione correctamente al cambiar de día".
        // Let's keep it silent or use a toast if available. For now silent is better than annoying alert on every reload if multiple.
        console.log('Processed scheduled operations');
    }
}

const THEME_STORAGE_KEY = 'fti-theme-preference';
const ACCENT_STORAGE_KEY = 'fti-accent-preference';
const DEFAULT_CURRENCY_KEY = 'fti-default-currency';
const SECONDARY_CURRENCY_KEY = 'fti-secondary-currency';
const DB_NAME = 'IndexedDB-Finanzas';
const DB_VERSION = 3; // Incrementar versión para asegurar la creación del store de ahorros
const STORE_NAME = 'user-preferences';
const SAVINGS_STORE_NAME = 'savings-goals'; // Nuevo store para ahorros
const dataStorageMethodElement = document.getElementById('dataStorageMethod');
const dataUsageValueElement = document.getElementById('dataUsageValue');
const dataUsageBarElement = document.getElementById('dataUsageBar');
const dataRecordsCountElement = document.getElementById('dataRecordsCount');
const dataAvailableValueElement = document.getElementById('dataAvailableValue');
const deleteDataButton = document.getElementById('deleteDataButton');
const importDataButton = document.getElementById('importDataButton');
const exportDataButton = document.getElementById('exportDataButton');
const importDataInput = document.getElementById('importDataInput');

// IndexedDB wrapper class for user preferences
class PreferencesDB {
    constructor() {
        this.db = null;
        this.isReady = false;
        this.initPromise = this.init();
    }

    async init() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = () => {
                console.error('Error opening IndexedDB:', request.error);
                reject(request.error);
            };
            
            request.onsuccess = () => {
                this.db = request.result;
                this.isReady = true;
                resolve(this.db);
            };
            
            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                console.log(`Upgrading IndexedDB from ${event.oldVersion} to ${event.newVersion}`);
                
                // Create object store for user preferences
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                    store.createIndex('key', 'key', { unique: true });
                }

                // Create object store for savings goals
                if (!db.objectStoreNames.contains(SAVINGS_STORE_NAME)) {
                    db.createObjectStore(SAVINGS_STORE_NAME, { keyPath: 'id', autoIncrement: true });
                }
            };
        });
    }

    async ensureReady() {
        if (!this.isReady) {
            await this.initPromise;
        }
    }

    async setItem(key, value) {
        try {
            await this.ensureReady();
            
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.put({ key, value });
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error setting item in IndexedDB:', error);
            // Fallback to localStorage
            localStorage.setItem(key, value);
        }
    }

    async getItem(key) {
        try {
            await this.ensureReady();
            
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([STORE_NAME], 'readonly');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.get(key);
                
                request.onsuccess = () => {
                    const result = request.result;
                    resolve(result ? result.value : null);
                };
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error getting item from IndexedDB:', error);
            // Fallback to localStorage
            return localStorage.getItem(key);
        }
    }

    async removeItem(key) {
        try {
            await this.ensureReady();
            
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([STORE_NAME], 'readwrite');
                const store = transaction.objectStore(STORE_NAME);
                const request = store.delete(key);
                
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error removing item from IndexedDB:', error);
            // Fallback to localStorage
            localStorage.removeItem(key);
        }
    }

    // Métodos para el nuevo store de ahorros
    async getAllSavings() {
        try {
            await this.ensureReady();
            return new Promise((resolve, reject) => {
                const transaction = this.db.transaction([SAVINGS_STORE_NAME], 'readonly');
                const store = transaction.objectStore(SAVINGS_STORE_NAME);
                const request = store.getAll();
                request.onsuccess = () => resolve(request.result || []);
                request.onerror = () => reject(request.error);
            });
        } catch (error) {
            console.error('Error getting savings:', error);
            return [];
        }
    }

    async addSaving(goal) {
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([SAVINGS_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(SAVINGS_STORE_NAME);
                const request = store.add(goal);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    async updateSaving(goal) {
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([SAVINGS_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(SAVINGS_STORE_NAME);
                const request = store.put(goal);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (err) {
                reject(err);
            }
        });
    }

    async deleteSaving(id) {
        await this.ensureReady();
        return new Promise((resolve, reject) => {
            try {
                const transaction = this.db.transaction([SAVINGS_STORE_NAME], 'readwrite');
                const store = transaction.objectStore(SAVINGS_STORE_NAME);
                const request = store.delete(id);
                request.onsuccess = () => resolve(request.result);
                request.onerror = () => reject(request.error);
            } catch (err) {
                reject(err);
            }
        });
    }
}

// Initialize the preferences database
const preferencesDB = new PreferencesDB();
let cachedDBSnapshot = null;
let cachedDBSnapshotTimestamp = 0;
const DB_CACHE_TTL_MS = 2000;
const DEFAULT_AVAILABLE_TEXT = 'Calculando...';
const rootElement = document.documentElement;
const themeButtons = Array.from(document.querySelectorAll('.theme-button[data-theme-option]'));
const accentButtons = Array.from(document.querySelectorAll('.accent-option[data-accent-option]'));
const systemDarkQuery = window.matchMedia('(prefers-color-scheme: dark)');
const metaThemeColor = document.querySelector('meta[name="theme-color"]');

const themeColorMap = {
    light: '#2563eb',
    dark: '#0f172a'
};

const accentColorMap = {
    indigo: {
        text: '#2563eb',
        solid: '#4f46e5',
        solidHover: '#4338ca',
        bg: 'rgba(37, 99, 235, 0.12)',
        bgHover: 'rgba(37, 99, 235, 0.2)',
        shadow: '0 1px 2px rgba(79, 70, 229, 0.18)'
    },
    emerald: {
        text: '#047857',
        solid: '#059669',
        solidHover: '#047857',
        bg: 'rgba(16, 185, 129, 0.12)',
        bgHover: 'rgba(16, 185, 129, 0.2)',
        shadow: '0 1px 2px rgba(16, 185, 129, 0.22)'
    },
    rose: {
        text: '#be123c',
        solid: '#e11d48',
        solidHover: '#be123c',
        bg: 'rgba(244, 63, 94, 0.12)',
        bgHover: 'rgba(244, 63, 94, 0.2)',
        shadow: '0 1px 2px rgba(225, 29, 72, 0.22)'
    },
    orange: {
        text: '#c2410c',
        solid: '#f97316',
        solidHover: '#ea580c',
        bg: 'rgba(251, 146, 60, 0.12)',
        bgHover: 'rgba(251, 146, 60, 0.2)',
        shadow: '0 1px 2px rgba(249, 115, 22, 0.22)'
    },
    cyan: {
        text: '#0e7490',
        solid: '#06b6d4',
        solidHover: '#0891b2',
        bg: 'rgba(34, 211, 238, 0.12)',
        bgHover: 'rgba(34, 211, 238, 0.2)',
        shadow: '0 1px 2px rgba(6, 182, 212, 0.22)'
    },
    slate: {
        text: '#1e293b',
        solid: '#475569',
        solidHover: '#334155',
        bg: 'rgba(148, 163, 184, 0.12)',
        bgHover: 'rgba(148, 163, 184, 0.2)',
        shadow: '0 1px 2px rgba(71, 85, 105, 0.22)'
    }
};

function getSystemTheme() {
    return systemDarkQuery.matches ? 'dark' : 'light';
}

function updateMetaThemeColor(activeTheme) {
    if (!metaThemeColor) return;
    const color = themeColorMap[activeTheme] || themeColorMap.light;
    metaThemeColor.setAttribute('content', color);
}

function markActiveButton(preference) {
    themeButtons.forEach((button) => {
        const option = button.dataset.themeOption;
        const isActive = option === preference;
        button.classList.toggle('is-active', isActive);
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

async function applyTheme(preference) {
    const resolvedTheme = preference === 'system' ? getSystemTheme() : preference;

    rootElement.setAttribute('data-theme', resolvedTheme);
    rootElement.setAttribute('data-theme-mode', preference);

    // Save to IndexedDB
    await preferencesDB.setItem(THEME_STORAGE_KEY, preference);

    markActiveButton(preference);
    updateMetaThemeColor(resolvedTheme);
}

async function handleThemeSelection(event) {
    const button = event.currentTarget;
    const preference = button.dataset.themeOption;
    if (!preference) return;

    await applyTheme(preference);
}

function markActiveAccent(accentKey) {
    accentButtons.forEach((button) => {
        const option = button.dataset.accentOption;
        const isActive = option === accentKey;
        button.setAttribute('aria-pressed', isActive ? 'true' : 'false');
    });
}

async function applyAccent(accentKey) {
    const colors = accentColorMap[accentKey] || accentColorMap.indigo;

    rootElement.style.setProperty('--color-accent-text', colors.text);
    rootElement.style.setProperty('--color-theme-active-text', colors.text);
    rootElement.style.setProperty('--color-accent-bg', colors.bg);
    rootElement.style.setProperty('--color-accent-bg-hover', colors.bgHover);
    rootElement.style.setProperty('--color-accent-solid', colors.solid);
    rootElement.style.setProperty('--color-accent-solid-hover', colors.solidHover);
    rootElement.style.setProperty('--shadow-theme-button', colors.shadow);

    markActiveAccent(accentKey);
    // Save to IndexedDB
    await preferencesDB.setItem(ACCENT_STORAGE_KEY, accentKey);
}

async function handleAccentSelection(event) {
    const button = event.currentTarget;
    const accentKey = button.dataset.accentOption;
    if (!accentKey) return;

    await applyAccent(accentKey);
}

async function hydrateAccentPreference() {
    const storedAccent = await preferencesDB.getItem(ACCENT_STORAGE_KEY);
    const initialAccent = storedAccent && accentColorMap[storedAccent] ? storedAccent : 'indigo';

    await applyAccent(initialAccent);
}

async function hydrateCurrencyPreferences() {
    try {
        const defaultCurrency = await preferencesDB.getItem(DEFAULT_CURRENCY_KEY);
        const secondaryCurrency = await preferencesDB.getItem(SECONDARY_CURRENCY_KEY);
        const discordWebhook = await preferencesDB.getItem(DATA_WEBHOOK_URL_STORAGE_KEY);

        const defaultSelect = document.getElementById('defaultCurrencySelect');
        const secondarySelect = document.getElementById('secondaryCurrencySelect');
        const discordInput = document.getElementById('discordWebhookInput');

        if (defaultSelect && defaultCurrency) {
            const opt = Array.from(defaultSelect.options).find(o => o.value === defaultCurrency);
            if (opt) defaultSelect.value = defaultCurrency;
        }

        if (secondarySelect && secondaryCurrency) {
            const opt2 = Array.from(secondarySelect.options).find(o => o.value === secondaryCurrency);
            if (opt2) secondarySelect.value = secondaryCurrency;
        }

        if (discordInput && discordWebhook) {
            discordInput.value = discordWebhook;
        }
    } catch (err) {
        console.error('Error hydrating preferences:', err);
    }
}

async function handleDiscordWebhookChange(event) {
    const input = event.currentTarget;
    const value = input.value.trim();
    try {
        await preferencesDB.setItem(DATA_WEBHOOK_URL_STORAGE_KEY, value);
    } catch (err) {
        console.error('Error saving discord webhook', err);
        try { localStorage.setItem(DATA_WEBHOOK_URL_STORAGE_KEY, value); } catch (e) { /* ignore */ }
    }
}

async function handleCurrencyChange(event) {
    const select = event.currentTarget;
    if (!select) return;

    const defaultSelect = document.getElementById('defaultCurrencySelect');
    const secondarySelect = document.getElementById('secondaryCurrencySelect');

    if (!defaultSelect || !secondarySelect) return;

    // Limpiar error anterior si existe
    document.getElementById('currency-error')?.remove();

    if (defaultSelect.value === secondarySelect.value) {
        // Mostrar error visual
        const container = select.closest('.relative') || select.parentElement;
        const errorMsg = document.createElement('div');
        errorMsg.id = 'currency-error';
        errorMsg.className = 'absolute -bottom-6 left-0 text-[10px] font-bold text-red-600 animate-pulse whitespace-nowrap';
        errorMsg.textContent = 'Las monedas no pueden ser iguales';

        container.appendChild(errorMsg);

        // No guardamos nada si son iguales
        return;
    }

    // Si son diferentes, guardar ambas para asegurar consistencia
    const defaultKey = DEFAULT_CURRENCY_KEY;
    const secondaryKey = SECONDARY_CURRENCY_KEY;

    try {
        await Promise.all([
            preferencesDB.setItem(defaultKey, defaultSelect.value),
            preferencesDB.setItem(secondaryKey, secondarySelect.value)
        ]);
    } catch (err) {
        console.error('Error saving currency preferences', err);
        // fallback to localStorage
        try { 
            localStorage.setItem(defaultKey, defaultSelect.value); 
            localStorage.setItem(secondaryKey, secondarySelect.value); 
        } catch (e) { /* ignore */ }
    }
}

async function hydrateThemePreference() {
    const storedPreference = await preferencesDB.getItem(THEME_STORAGE_KEY);
    const initialPreference = storedPreference || 'system';

    await applyTheme(initialPreference);
}

function handleSystemThemeChange(event) {
    const currentPreference = rootElement.getAttribute('data-theme-mode');
    if (currentPreference !== 'system') return;

    const resolvedTheme = event.matches ? 'dark' : 'light';
    rootElement.setAttribute('data-theme', resolvedTheme);
    updateMetaThemeColor(resolvedTheme);
}

async function initThemeToggle() {
    // Wait for IndexedDB to be ready
    await preferencesDB.initPromise;
    
    // Load saved preferences
    await hydrateThemePreference();
    await hydrateAccentPreference();

    if (themeButtons.length) {
        themeButtons.forEach((button) => {
            button.addEventListener('click', handleThemeSelection);
        });
    }

    if (accentButtons.length) {
        accentButtons.forEach((button) => {
            button.addEventListener('click', handleAccentSelection);
        });
    }

    if (typeof systemDarkQuery.addEventListener === 'function') {
        systemDarkQuery.addEventListener('change', handleSystemThemeChange);
    } else if (typeof systemDarkQuery.addListener === 'function') {
        systemDarkQuery.addListener(handleSystemThemeChange);
    }
}

async function setupSettingsListeners() {
    try {
        const defaultSelect = document.getElementById('defaultCurrencySelect');
        const secondarySelect = document.getElementById('secondaryCurrencySelect');
        const discordWebhookInput = document.getElementById('discordWebhookInput');

        if (defaultSelect) defaultSelect.addEventListener('change', handleCurrencyChange);
        if (secondarySelect) secondarySelect.addEventListener('change', handleCurrencyChange);
        if (discordWebhookInput) discordWebhookInput.addEventListener('change', handleDiscordWebhookChange);

        await setupWebhookModal();
        await setupBudgetsManagement();
        await renderFeaturedBudgetsPanel();
        await renderResumenPeriodSummary();
        await renderResumenExtremesAndFeatured();
        await setupSavingsManagement();
        await hydrateCurrencyPreferences();
    } catch (err) {
        console.error('Error initializing settings listeners:', err);
    }
}

function escapeHtml(unsafeValue) {
    return String(unsafeValue)
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function getCurrentMonthKey() {
    const now = new Date();
    const month = String(now.getMonth() + 1).padStart(2, '0');
    return `${now.getFullYear()}-${month}`;
}

function parseMoney(value) {
    if (typeof value === 'number') return Number.isFinite(value) && value >= 0 ? value : 0;
    
    // Normalize string: remove non-numeric chars except dot and comma
    // If we have commas and dots, we need to guess which is which or enforce a format.
    // Given the previous issue, "1,000" became 1.
    // If the string has only commas, they are likely thousands separators if there are no dots.
    // Or if it has both, usually the last one is the decimal separator.
    // However, input[type="number"] in standard browsers usually returns values with dot as decimal or empty string if invalid.
    // But if the user provides a string from another source (e.g. storage), we need to be careful.
    
    const str = String(value ?? '').trim();
    if (!str) return 0;

    // Remove all whitespace
    const cleanStr = str.replace(/\s/g, '');
    
    // Simple heuristic: 
    // If it contains both ',' and '.', the last one is the decimal.
    // If it contains only ',', it might be decimal (EU) or thousands (US/MX). 
    // But usually in JS context, dot is decimal.
    
    // Let's stick to a robust parsing that handles common "1,000.00" (US/MX) format.
    // We will remove all commas.
    const usFormat = cleanStr.replace(/,/g, '');
    const parsedUs = parseFloat(usFormat);
    
    if (Number.isFinite(parsedUs) && parsedUs >= 0) return parsedUs;
    
    return 0;
}

function sanitizeHexColor(value, fallback = '#e5e7eb') {
    const raw = typeof value === 'string' ? value.trim() : '';
    return /^#[0-9a-fA-F]{6}$/.test(raw) ? raw : fallback;
}

function getMonthKeyFromDate(date) {
    const target = date instanceof Date ? date : new Date(date);
    const year = target.getFullYear();
    const month = String(target.getMonth() + 1).padStart(2, '0');
    return `${year}-${month}`;
}

function shiftMonthKey(monthKey, offset) {
    if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
        return getCurrentMonthKey();
    }
    const [yearStr, monthStr] = monthKey.split('-');
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10) - 1;
    const date = new Date(year, month + offset, 1);
    return getMonthKeyFromDate(date);
}

function formatMonthLabel(monthKey) {
    if (typeof monthKey !== 'string' || !/^\d{4}-\d{2}$/.test(monthKey)) {
        return '—';
    }
    const [yearStr, monthStr] = monthKey.split('-');
    const date = new Date(Number.parseInt(yearStr, 10), Number.parseInt(monthStr, 10) - 1, 1);
    return date.toLocaleDateString('es-ES', { month: 'long', year: 'numeric' });
}

function compareMonthKeys(a, b) {
    if (a === b) return 0;
    if (typeof a !== 'string' || typeof b !== 'string') return 0;
    const [ay, am] = a.split('-').map(num => Number.parseInt(num, 10));
    const [by, bm] = b.split('-').map(num => Number.parseInt(num, 10));
    if (ay === by) return (am || 0) - (bm || 0);
    return (ay || 0) - (by || 0);
}

function formatMoney(amount, currencyCode) {
    const numeric = Number.isFinite(amount) ? amount : 0;
    const code = typeof currencyCode === 'string' && currencyCode.trim() ? currencyCode.trim() : 'MXN';
    try {
        return new Intl.NumberFormat('es-MX', { style: 'currency', currency: code }).format(numeric);
    } catch {
        return `${numeric.toFixed(2)} ${code}`;
    }
}

function generateBudgetId() {
    if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
        return crypto.randomUUID();
    }
    return `bud_${Math.random().toString(36).slice(2, 10)}_${Date.now().toString(36)}`;
}

async function getPreferredCurrencyCodeForBudgets() {
    const defaultSelect = document.getElementById('defaultCurrencySelect');
    if (defaultSelect && defaultSelect.value) return defaultSelect.value;
    try {
        const stored = await preferencesDB.getItem(DEFAULT_CURRENCY_KEY);
        if (stored) return stored;
    } catch {
        return 'MXN';
    }
    return 'MXN';
}

function normalizeBudgetPlan(rawPlan, currencyCode) {
    const nowIso = new Date().toISOString();
    const effectiveFromRaw = rawPlan && typeof rawPlan.effectiveFrom === 'string' ? rawPlan.effectiveFrom : '';
    const effectiveFrom = /^\d{4}-\d{2}$/.test(effectiveFromRaw) ? effectiveFromRaw : getCurrentMonthKey();
    let totalAmount = parseMoney(rawPlan?.totalAmount);
    
    // Safety check: if totalAmount is 0 but rawPlan had a value, it might be a parsing error or actual 0.
    // If it's a general budget, it usually shouldn't be 0 unless explicitly set.
    // But we can't easily distinguish "invalid" from "0".
    // However, we should ensure it's a number. parseMoney guarantees that.
    
    const subBudgets = Array.isArray(rawPlan?.subBudgets)
        ? rawPlan.subBudgets
            .map((entry) => {
                const id = typeof entry?.id === 'string' && entry.id ? entry.id : generateBudgetId();
                const categoryId = typeof entry?.categoryId === 'string' && entry.categoryId ? entry.categoryId : '';
                const amount = parseMoney(entry?.amount);
                if (!categoryId || amount <= 0) return null;
                return { id, categoryId, amount };
            })
            .filter(Boolean)
        : [];

    const createdAt = typeof rawPlan?.createdAt === 'string' && rawPlan.createdAt ? rawPlan.createdAt : nowIso;
    return {
        version: 1,
        currency: typeof currencyCode === 'string' && currencyCode ? currencyCode : 'MXN',
        effectiveFrom,
        totalAmount,
        subBudgets,
        createdAt,
        updatedAt: nowIso
    };
}

async function loadBudgetPlan(currencyCode) {
    let stored = null;
    try {
        stored = await preferencesDB.getItem(BUDGET_PLAN_STORAGE_KEY);
    } catch {
        stored = null;
    }

    if (!stored) {
        stored = getLocalStorageFallback(BUDGET_PLAN_STORAGE_KEY);
    }

    let raw = null;
    try {
        raw = stored ? JSON.parse(stored) : null;
    } catch {
        raw = null;
    }
    return normalizeBudgetPlan(raw, currencyCode);
}

async function saveBudgetPlan(plan) {
    const payload = JSON.stringify(plan);
    await preferencesDB.setItem(BUDGET_PLAN_STORAGE_KEY, payload);
    setLocalStorageFallback(BUDGET_PLAN_STORAGE_KEY, payload);
}

async function loadExpenseCategoriesForBudgets() {
    const categoriesList = await fetchCategoriesFromStorage();
    const { ordered, map } = buildCategoryOptionEntries(categoriesList, 'expense');
    return { ordered, categoryMap: map };
}

async function calculateMonthlyBudgetUsage(targetCurrencyCode, period) {
    const explicitMonthKeys = Array.isArray(period?.monthKeys)
        ? period.monthKeys.filter(key => typeof key === 'string' && /^\d{4}-\d{2}$/.test(key))
        : null;
    const effectiveMonthKey = typeof period === 'string' && /^\d{4}-\d{2}$/.test(period) ? period : getCurrentMonthKey();
    const monthKeySet = explicitMonthKeys?.length ? new Set(explicitMonthKeys) : new Set([effectiveMonthKey]);
    const accountIdSet = period?.accountIdSet instanceof Set ? period.accountIdSet : null;
    
    // Ensure we have the latest operations
    await hydrateOperationsFromStorage();
    const allOps = operations; 
    
    // Normalize target currency
    if (!targetCurrencyCode) {
        targetCurrencyCode = await getPreferredCurrencyCodeForBudgets();
    }

    const usageMap = new Map();
    let totalSpent = 0;

    for (const op of allOps) {
        // Filter: Expense only, match month
        if (op.type !== 'expense') continue;
        
        const opMonthKey = op?.monthKey || getMonthKeyFromDate(new Date(op.datetime));
        if (!monthKeySet.has(opMonthKey)) continue;
        if (accountIdSet && (!op?.accountId || !accountIdSet.has(op.accountId))) continue;

        // Convert amount if needed (Simplified for now, assuming 1:1 if currency not handled fully yet)
        // ideally we check accounts currency vs budget currency. 
        // For this implementation we assume amounts are compatible or user manages single currency mainly.
        const amount = Number(op.amount) || 0;
        
        if (op.categoryId) {
            const current = usageMap.get(op.categoryId) || 0;
            usageMap.set(op.categoryId, current + amount);
        } else {
             // Expenses without category? Maybe track them as 'uncategorized'
        }
        totalSpent += amount;
    }

    return { usageMap, totalSpent, monthKey: effectiveMonthKey, monthKeys: Array.from(monthKeySet) };
}

async function renderFeaturedBudgetsPanel(monthKey, mode) {
    const listEl = document.getElementById('featuredBudgetsList');
    const summaryWrap = document.getElementById('featuredBudgetsSummary');
    const currencyEl = document.getElementById('featuredBudgetsCurrency');
    const totalEl = document.getElementById('featuredBudgetsTotal');
    const assignedEl = document.getElementById('featuredBudgetsAssigned');
    const availableEl = document.getElementById('featuredBudgetsAvailable');
    const barEl = document.getElementById('featuredBudgetsAssignedBar');

    if (!listEl || !summaryWrap || !currencyEl || !totalEl || !assignedEl || !availableEl || !barEl) {
        return;
    }

    const currencyCode = await getPreferredCurrencyCodeForBudgets();
    const categoriesData = await loadExpenseCategoriesForBudgets();
    const categoryMap = categoriesData.categoryMap;
    const plan = await loadBudgetPlan(currencyCode);

    const effectiveMode = OPERATIONS_PERIOD_META[mode] ? mode : 'monthly';
    const baseKey = clampMonthKeyToPeriod(
        typeof monthKey === 'string' && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : getCurrentMonthKey(),
        effectiveMode
    );
    const monthKeys = getPeriodMonthKeys(baseKey, effectiveMode);
    
    const effectiveAccountIds = getEffectiveResumenAccountIds();
    // Usage data
    const { usageMap, totalSpent } = await calculateMonthlyBudgetUsage(currencyCode, { monthKeys, accountIdSet: effectiveAccountIds });

    const monthsMultiplier = monthKeys.length || 1;
    const totalAmount = parseMoney(plan?.totalAmount) * monthsMultiplier;
    const subBudgets = Array.isArray(plan?.subBudgets) ? plan.subBudgets : [];
    const assignedAmount = subBudgets.reduce((acc, entry) => acc + (Number.isFinite(entry?.amount) ? entry.amount : 0), 0) * monthsMultiplier;
    const unassignedAmount = totalAmount - assignedAmount;

    // Calculate total remaining across all budgets (Plan - Spent) or (Assigned - Spent)?
    // Usually "Available" in a budget context means "How much I can still spend".
    // But in the header "Total | Asignado | Disponible", "Disponible" usually refers to "Unallocated".
    // Let's keep the header as "Planning Status" but maybe add a "Spent" indicator or just focus on the list.
    
    // The user specifically asked to see how money decreases in relation to the budget.
    // Let's update the header to show "Gasto Total" vs "Presupuesto Total" maybe?
    // User: "El presupuesto general no se debe de tocar... distribución... la hace el usuario"
    // User: "revisar los presupuestos debo de ver como efectivamente me queda menos dinero disponible"
    
    // Let's stick to modifying the list items to show consumption, and maybe leave the header as Planning Summary,
    // OR change the header to be "Monthly Overview".
    // Let's keep the header as Planning (Total Budget, Assigned to Categories, Unassigned).
    // And the list shows the status of those categories.
    
    currencyEl.textContent = currencyCode;
    totalEl.textContent = formatMoney(totalAmount, currencyCode);
    assignedEl.textContent = formatMoney(assignedAmount, currencyCode);
    availableEl.textContent = formatMoney(unassignedAmount, currencyCode);
    availableEl.classList.toggle('text-red-600', unassignedAmount < 0);
    availableEl.classList.toggle('text-gray-800', unassignedAmount >= 0);

    // Render Fractionated Bar
    if (totalAmount <= 0) {
        barEl.innerHTML = '';
    } else {
        let segmentsHtml = '';
        subBudgets.forEach((entry) => {
             const amount = parseMoney(entry.amount) * monthsMultiplier;
             if (amount <= 0) return;
             
             const category = categoryMap.get(entry.categoryId);
             const color = sanitizeHexColor(category?.color, '#6366f1');
             const widthPercent = (amount / totalAmount) * 100;
             
             segmentsHtml += `<div style="width: ${widthPercent}%; background-color: ${color}" title="${escapeHtml(category?.displayName || 'Categoría')} (${formatMoney(amount, currencyCode)})"></div>`;
        });
        
        barEl.innerHTML = segmentsHtml;
        // Clean up previous styles applied to the container itself if any
        barEl.style.width = ''; 
        barEl.classList.remove('bg-red-600', 'bg-indigo-600');
    }

    const hasPlan = totalAmount > 0 || subBudgets.length > 0;
    summaryWrap.classList.toggle('hidden', !hasPlan);

    if (!hasPlan) {
        listEl.innerHTML = `
            <div class="text-center py-4">
                <p class="text-xs text-gray-400 italic">No hay presupuestos configurados.</p>
            </div>
        `;
        return;
    }

    const featured = [...subBudgets]
        .map((entry) => ({
            id: entry.id,
            categoryId: entry.categoryId,
            amount: parseMoney(entry.amount) * monthsMultiplier
        }))
        .filter((entry) => entry.categoryId && entry.amount > 0)
        .sort((a, b) => b.amount - a.amount)
        .slice(0, 3);

    if (!featured.length) {
        listEl.innerHTML = `
            <div class="text-center py-4">
                <p class="text-xs text-gray-400 italic">Define subpresupuestos para verlos aquí.</p>
            </div>
        `;
        return;
    }

    listEl.innerHTML = featured
        .map((entry) => {
            const category = categoryMap.get(entry.categoryId);
            const name = category?.rawName || 'Categoría eliminada';
            const display = category?.displayName || name;
            const color = sanitizeHexColor(category?.color, '#6366f1');
            const bg = `${color}1A`;
            
            const spent = usageMap.get(entry.categoryId) || 0;
            const assigned = entry.amount;
            const remaining = assigned - spent;
            
            // Percent of Budget Consumed
            const percentConsumed = assigned > 0 ? Math.min(100, Math.round((spent / assigned) * 100)) : 0;
            
            const spentLabel = formatMoney(spent, currencyCode);
            const assignedLabel = formatMoney(assigned, currencyCode);
            const remainingLabel = formatMoney(remaining, currencyCode);

            // Bar Color Logic
            let barColorClass = '';
            if (remaining < 0) {
                 barColorClass = 'bg-red-600'; // Over budget
            } else if (percentConsumed > 85) {
                 barColorClass = 'bg-amber-500'; // Warning
            } else {
                 barColorClass = 'bg-emerald-500'; // Healthy
            }
            // Override with category color if preferred, but status colors are better for budgets.
            // Or use category color but turn red if over?
            // User asked for "see clearly... how money decreases".
            // Let's use the category color for the bar, but maybe turn red if over.
            const finalBarColor = remaining < 0 ? '#dc2626' : color;

            return `
                <div class="flex items-center gap-4">
                    <div class="p-2 rounded-lg" style="background:${escapeHtml(bg)}">
                        <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="${escapeHtml(color)}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21.21 15.89A10 10 0 1 1 8 2.83"/><path d="M22 12A10 10 0 0 0 12 2v10z"/></svg>
                    </div>
                    <div class="flex-grow">
                        <div class="flex justify-between text-sm mb-1">
                            <span class="font-medium text-gray-700 truncate" title="${escapeHtml(name)}">${escapeHtml(display)}</span>
                            <span class="font-semibold ${remaining < 0 ? 'text-red-600' : 'text-gray-600'}">
                                ${remaining < 0 ? 'Excedido' : 'Restante'}: ${escapeHtml(remainingLabel)}
                            </span>
                        </div>
                        <div class="w-full bg-gray-200 rounded-full h-2">
                            <div class="h-2 rounded-full transition-all duration-500" style="width: ${percentConsumed}%; background: ${escapeHtml(finalBarColor)}"></div>
                        </div>
                        <div class="flex justify-between text-xs text-gray-500 mt-1">
                            <span>Gastado: ${escapeHtml(spentLabel)}</span>
                            <span>Total: ${escapeHtml(assignedLabel)}</span>
                        </div>
                    </div>
                </div>
            `;
        })
        .join('');
}

async function renderResumenPeriodSummary(monthKey, mode) {
    const titleEl = document.getElementById('periodSummaryTitle');
    const spentLabelEl = document.getElementById('periodSpentLabel');
    const availableLabelEl = document.getElementById('periodAvailableLabel');
    const barBgEl = document.getElementById('periodBalanceBarBg');
    const availablePercentEl = document.getElementById('periodAvailablePercent');
    const spentBarEl = document.getElementById('periodSpentBar');
    const spentPercentEl = document.getElementById('periodSpentPercent');
    const incomeInlineEl = document.getElementById('periodIncomeTotalInline');
    const incomeTotalEl = document.getElementById('periodIncomeTotal');
    const expenseTotalEl = document.getElementById('periodExpenseTotal');
    const balanceTotalEl = document.getElementById('periodBalanceTotal');
    const incomeDeltaRowEl = document.getElementById('periodIncomeDeltaRow');
    const incomeDeltaUpEl = document.getElementById('periodIncomeDeltaIconUp');
    const incomeDeltaDownEl = document.getElementById('periodIncomeDeltaIconDown');
    const incomeDeltaTextEl = document.getElementById('periodIncomeDeltaText');
    const expenseDeltaRowEl = document.getElementById('periodExpenseDeltaRow');
    const expenseDeltaUpEl = document.getElementById('periodExpenseDeltaIconUp');
    const expenseDeltaDownEl = document.getElementById('periodExpenseDeltaIconDown');
    const expenseDeltaTextEl = document.getElementById('periodExpenseDeltaText');
    const balanceDeltaRowEl = document.getElementById('periodBalanceDeltaRow');
    const balanceDeltaUpEl = document.getElementById('periodBalanceDeltaIconUp');
    const balanceDeltaDownEl = document.getElementById('periodBalanceDeltaIconDown');
    const balanceDeltaTextEl = document.getElementById('periodBalanceDeltaText');
    const opsTotalEl = document.getElementById('periodOpsTotalCount');
    const opsIncomeEl = document.getElementById('periodOpsIncomeCount');
    const opsExpenseEl = document.getElementById('periodOpsExpenseCount');
    const opsTransferEl = document.getElementById('periodOpsTransferCount');

    if (!titleEl || !spentLabelEl || !availableLabelEl || !barBgEl || !availablePercentEl || !spentBarEl || !spentPercentEl || !incomeInlineEl || !incomeTotalEl || !expenseTotalEl || !balanceTotalEl || !incomeDeltaRowEl || !incomeDeltaUpEl || !incomeDeltaDownEl || !incomeDeltaTextEl || !expenseDeltaRowEl || !expenseDeltaUpEl || !expenseDeltaDownEl || !expenseDeltaTextEl || !balanceDeltaRowEl || !balanceDeltaUpEl || !balanceDeltaDownEl || !balanceDeltaTextEl || !opsTotalEl || !opsIncomeEl || !opsExpenseEl || !opsTransferEl) {
        return;
    }

    const currencyCode = await getPreferredCurrencyCodeForBudgets();
    await hydrateOperationsFromStorage();

    const effectiveMode = OPERATIONS_PERIOD_META[mode] ? mode : 'monthly';
    const candidateBase = clampMonthKeyToPeriod(
        typeof monthKey === 'string' && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : getCurrentMonthKey(),
        effectiveMode
    );
    const currentBase = getCurrentPeriodStartKey(effectiveMode);
    const selectedBase = compareMonthKeys(candidateBase, currentBase) > 0 ? currentBase : candidateBase;
    const previousBase = shiftPeriodKey(selectedBase, effectiveMode, -1);
    titleEl.textContent = `Resumen de ${formatPeriodLabel(selectedBase, effectiveMode)}`;

    const allOps = Array.isArray(operations) ? operations : [];
    
    const effectiveAccountIds = getEffectiveResumenAccountIds();
    const filteredOps = effectiveAccountIds 
        ? allOps.filter(op => {
             if (op.type === 'transfer') {
                 return effectiveAccountIds.has(op.fromAccountId) || effectiveAccountIds.has(op.toAccountId);
             }
             return effectiveAccountIds.has(op.accountId);
        })
        : allOps;

    const getOpMonthKey = (op) => op?.monthKey || getMonthKeyFromDate(op?.datetime);

    const selectedLookup = new Set(getPeriodMonthKeys(selectedBase, effectiveMode));
    const previousLookup = new Set(getPeriodMonthKeys(previousBase, effectiveMode));
    const currentOps = filteredOps.filter(op => selectedLookup.has(getOpMonthKey(op)));
    const previousOps = filteredOps.filter(op => previousLookup.has(getOpMonthKey(op)));

    const normalizeAmount = (value) => {
        const num = Number(value);
        return Number.isFinite(num) ? Math.abs(num) : 0;
    };

    const sumByType = (list, type) => list.reduce((acc, op) => (op?.type === type ? acc + normalizeAmount(op.amount) : acc), 0);
    const countByType = (list, type) => list.reduce((acc, op) => (op?.type === type ? acc + 1 : acc), 0);

    const currentIncome = sumByType(currentOps, 'income');
    const currentExpense = sumByType(currentOps, 'expense');
    const currentBalance = currentIncome - currentExpense;

    const prevIncome = sumByType(previousOps, 'income');
    const prevExpense = sumByType(previousOps, 'expense');
    const prevBalance = prevIncome - prevExpense;

    spentLabelEl.textContent = formatMoney(currentExpense, currencyCode);
    availableLabelEl.textContent = formatMoney(currentBalance, currencyCode);
    incomeInlineEl.textContent = formatMoney(currentIncome, currencyCode);

    incomeTotalEl.textContent = formatMoney(currentIncome, currencyCode);
    expenseTotalEl.textContent = formatMoney(currentExpense, currencyCode);
    balanceTotalEl.textContent = currentBalance >= 0 ? `+${formatMoney(currentBalance, currencyCode)}` : formatMoney(currentBalance, currencyCode);

    const computeDeltaPercent = (currentValue, previousValue) => {
        if (!Number.isFinite(currentValue) || !Number.isFinite(previousValue)) return null;
        if (previousValue === 0) return null;
        return ((currentValue - previousValue) / Math.abs(previousValue)) * 100;
    };

    const applyDelta = (rowEl, upEl, downEl, textEl, deltaPercent, isPositiveGood) => {
        rowEl.classList.remove('text-green-600', 'text-red-600', 'text-gray-400');
        upEl.classList.add('hidden');
        downEl.classList.add('hidden');

        if (deltaPercent === null) {
            rowEl.classList.add('text-gray-400');
            textEl.textContent = '— vs Anterior';
            return;
        }

        const isUp = deltaPercent >= 0;
        const absValue = Number(Math.abs(deltaPercent).toFixed(1));
        textEl.textContent = `${absValue}% vs Anterior`;

        const isGood = isPositiveGood ? isUp : !isUp;
        rowEl.classList.add(isGood ? 'text-green-600' : 'text-red-600');
        (isUp ? upEl : downEl).classList.remove('hidden');
    };

    applyDelta(incomeDeltaRowEl, incomeDeltaUpEl, incomeDeltaDownEl, incomeDeltaTextEl, computeDeltaPercent(currentIncome, prevIncome), true);
    applyDelta(expenseDeltaRowEl, expenseDeltaUpEl, expenseDeltaDownEl, expenseDeltaTextEl, computeDeltaPercent(currentExpense, prevExpense), false);
    applyDelta(balanceDeltaRowEl, balanceDeltaUpEl, balanceDeltaDownEl, balanceDeltaTextEl, computeDeltaPercent(currentBalance, prevBalance), true);

    const setBarTheme = (isDeficit) => {
        barBgEl.classList.remove('bg-green-200', 'bg-red-200');
        availablePercentEl.classList.remove('text-green-900', 'text-red-900');
        barBgEl.classList.add(isDeficit ? 'bg-red-200' : 'bg-green-200');
        availablePercentEl.classList.add(isDeficit ? 'text-red-900' : 'text-green-900');
    };

    let spentPercent = 0;
    let availablePercent = 0;
    if (currentIncome > 0) {
        const rawSpent = (currentExpense / currentIncome) * 100;
        spentPercent = Math.min(100, Math.max(0, Math.round(rawSpent)));
        availablePercent = Math.max(0, 100 - spentPercent);
    } else if (currentExpense > 0) {
        spentPercent = 100;
        availablePercent = 0;
    }

    if (currentBalance < 0) {
        spentPercent = 100;
        availablePercent = 0;
        setBarTheme(true);
    } else {
        setBarTheme(false);
    }

    spentBarEl.style.width = `${spentPercent}%`;
    spentPercentEl.textContent = `${spentPercent}%`;
    availablePercentEl.textContent = `${availablePercent}%`;

    const incomeCount = countByType(currentOps, 'income');
    const expenseCount = countByType(currentOps, 'expense');
    const transferCount = countByType(currentOps, 'transfer');
    const totalCount = incomeCount + expenseCount + transferCount;

    opsTotalEl.textContent = String(totalCount);
    opsIncomeEl.textContent = String(incomeCount);
    opsExpenseEl.textContent = String(expenseCount);
    opsTransferEl.textContent = String(transferCount);
}

async function renderResumenExtremesAndFeatured(monthKey, mode) {
    const extremeExpenseMin = document.getElementById('extremeExpenseMin');
    const extremeExpenseMax = document.getElementById('extremeExpenseMax');
    const extremeIncomeMin = document.getElementById('extremeIncomeMin');
    const extremeIncomeMax = document.getElementById('extremeIncomeMax');
    const featuredIncomesList = document.getElementById('featuredIncomesList');
    const featuredExpensesList = document.getElementById('featuredExpensesList');

    if (!extremeExpenseMin || !extremeExpenseMax || !extremeIncomeMin || !extremeIncomeMax || !featuredIncomesList || !featuredExpensesList) {
        return;
    }

    // Get currency
    const currencyCode = await getPreferredCurrencyCodeForBudgets();

    // Ensure operations are loaded
    await hydrateOperationsFromStorage();
    const effectiveMode = OPERATIONS_PERIOD_META[mode] ? mode : 'monthly';
    const candidateBase = clampMonthKeyToPeriod(
        typeof monthKey === 'string' && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : getCurrentMonthKey(),
        effectiveMode
    );
    const currentBase = getCurrentPeriodStartKey(effectiveMode);
    const selectedBase = compareMonthKeys(candidateBase, currentBase) > 0 ? currentBase : candidateBase;
    const allOps = Array.isArray(operations) ? operations : [];

    const effectiveAccountIds = getEffectiveResumenAccountIds();
    const filteredOps = effectiveAccountIds 
        ? allOps.filter(op => {
             if (op.type === 'transfer') {
                 return effectiveAccountIds.has(op.fromAccountId) || effectiveAccountIds.has(op.toAccountId);
             }
             return effectiveAccountIds.has(op.accountId);
        })
        : allOps;

    const monthLookup = new Set(getPeriodMonthKeys(selectedBase, effectiveMode));
    const monthOps = filteredOps.filter(op => monthLookup.has(op?.monthKey || getMonthKeyFromDate(op?.datetime)));

    if (monthOps.length === 0) {
         extremeExpenseMin.classList.add('hidden');
         extremeExpenseMax.classList.add('hidden');
         extremeIncomeMin.classList.add('hidden');
         extremeIncomeMax.classList.add('hidden');
         
         featuredIncomesList.innerHTML = '<div class="text-center py-4"><p class="text-xs text-gray-400 italic">No hay ingresos registrados.</p></div>';
         featuredExpensesList.innerHTML = '<div class="text-center py-4"><p class="text-xs text-gray-400 italic">No hay gastos registrados.</p></div>';
         return;
    }

    const expenses = monthOps.filter(op => op.type === 'expense').map(op => ({...op, amount: Number(op.amount)}));
    const incomes = monthOps.filter(op => op.type === 'income').map(op => ({...op, amount: Number(op.amount)}));

    const renderExtremeCard = (element, op, type) => {
        if (!op) {
            element.classList.add('hidden');
            return;
        }
        element.classList.remove('hidden');
        const nameEl = element.querySelector('.name');
        const amountEl = element.querySelector('.amount');
        
        if (nameEl) nameEl.textContent = op.title || op.description || 'Sin descripción';
        
        if (amountEl) {
             const sign = type === 'expense' ? '-' : '+';
             const colorClass = type === 'expense' ? 'text-red-600' : 'text-green-600';
             
             const dateObj = new Date(op.datetime);
             const isValidDate = !isNaN(dateObj.getTime());
             const formattedDate = isValidDate ? dateObj.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
             
             amountEl.className = `text-sm font-bold ${colorClass} amount`;
             amountEl.innerHTML = `${sign}${formatMoney(op.amount, currencyCode)} <span class="font-normal text-gray-500 text-xs date">· ${formattedDate}</span>`;
        }
    };

    // Extremes
    if (expenses.length > 0) {
        const sortedExpenses = [...expenses].sort((a, b) => a.amount - b.amount);
        const minExpense = sortedExpenses[0]; 
        const maxExpense = sortedExpenses[sortedExpenses.length - 1];
        
        renderExtremeCard(extremeExpenseMin, minExpense, 'expense');
        renderExtremeCard(extremeExpenseMax, maxExpense, 'expense');
    } else {
        extremeExpenseMin.classList.add('hidden');
        extremeExpenseMax.classList.add('hidden');
    }

    if (incomes.length > 0) {
         const sortedIncomes = [...incomes].sort((a, b) => a.amount - b.amount);
         const minIncome = sortedIncomes[0];
         const maxIncome = sortedIncomes[sortedIncomes.length - 1];

         renderExtremeCard(extremeIncomeMin, minIncome, 'income');
         renderExtremeCard(extremeIncomeMax, maxIncome, 'income');
    } else {
        extremeIncomeMin.classList.add('hidden');
        extremeIncomeMax.classList.add('hidden');
    }

    // Featured
    const topIncomes = [...incomes].sort((a, b) => b.amount - a.amount).slice(0, 3);
    const topExpenses = [...expenses].sort((a, b) => b.amount - a.amount).slice(0, 3);

    const renderFeaturedItem = (op, type) => {
        const isExpense = type === 'expense';
        const colorClass = isExpense ? 'text-red-600' : 'text-green-600';
        const iconColor = isExpense ? 'text-red-700' : 'text-green-700';
        const iconBg = isExpense ? 'bg-red-200' : 'bg-green-200';
        
        const dateObj = new Date(op.datetime);
        const dateStr = !isNaN(dateObj.getTime()) ? dateObj.toLocaleDateString('es-ES', { day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' }) : '';
        const sign = isExpense ? '-' : '+';
        
        const expensePath = '<path d="m3 9 9-7 9 7v11a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><polyline points="9 22 9 12 15 12 15 22"/>';
        const incomePath = '<rect width="20" height="14" x="2" y="7" rx="2" ry="2"/><path d="M16 21V5a2 2 0 0 0-2-2h-4a2 2 0 0 0-2 2v16"/>';
        
        return `
            <div class="flex items-center p-3 bg-white rounded-xl border border-gray-200 hover:shadow-sm transition">
                <div class="p-2 ${iconBg} rounded-full mr-4">
                    <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="${iconColor}">
                        ${isExpense ? expensePath : incomePath}
                    </svg>
                </div>
                <div class="flex-grow">
                    <p class="font-semibold text-gray-800 truncate">${escapeHtml(op.title || op.description || 'Sin descripción')}</p>
                    <p class="text-xs text-gray-500">${dateStr}</p>
                </div>
                <p class="font-bold ${colorClass} text-right">${sign}${formatMoney(op.amount, currencyCode)}</p>
            </div>
        `;
    };

    if (topIncomes.length > 0) {
        featuredIncomesList.innerHTML = topIncomes.map(op => renderFeaturedItem(op, 'income')).join('');
    } else {
        featuredIncomesList.innerHTML = '<div class="text-center py-4"><p class="text-xs text-gray-400 italic">No hay ingresos registrados.</p></div>';
    }

    if (topExpenses.length > 0) {
        featuredExpensesList.innerHTML = topExpenses.map(op => renderFeaturedItem(op, 'expense')).join('');
    } else {
        featuredExpensesList.innerHTML = '<div class="text-center py-4"><p class="text-xs text-gray-400 italic">No hay gastos registrados.</p></div>';
    }
}

function getResumenMonthControls() {
    return {
        prevBtn: document.getElementById('resumenPrevMonthBtn'),
        nextBtn: document.getElementById('resumenNextMonthBtn'),
        labelEl: document.getElementById('resumenCurrentMonthLabel'),
        saldoTotalEl: document.getElementById('resumenTotalBalanceValue'),
        forecastEl: document.getElementById('resumenForecastValue'),
        periodSelector: document.getElementById('resumenPeriodSelector'),
        periodToggle: document.getElementById('resumenPeriodToggle'),
        periodLabel: document.getElementById('resumenPeriodLabel'),
        periodMenu: document.getElementById('resumenPeriodMenu')
    };
}

function closeResumenPeriodMenu() {
    const { periodMenu } = getResumenMonthControls();
    if (periodMenu) {
        periodMenu.classList.add('hidden');
    }
}

function toggleResumenPeriodMenu() {
    const { periodMenu } = getResumenMonthControls();
    if (!periodMenu) return;
    const isHidden = periodMenu.classList.contains('hidden');
    periodMenu.classList.toggle('hidden', !isHidden);
}

function updateResumenPeriodControls() {
    const { periodLabel, periodMenu } = getResumenMonthControls();
    const meta = OPERATIONS_PERIOD_META[resumenPeriodMode] || OPERATIONS_PERIOD_META.monthly;
    if (periodLabel) {
        periodLabel.textContent = meta?.label || 'Mensual';
    }
    if (periodMenu) {
        periodMenu.querySelectorAll('[data-period-mode]').forEach(button => {
            const mode = button.dataset.periodMode;
            const isActive = mode === resumenPeriodMode;
            button.classList.toggle('bg-gray-100', isActive);
            button.classList.toggle('text-indigo-600', isActive);
            button.classList.toggle('font-semibold', isActive);
        });
    }
}

async function renderResumenTotalBalance() {
    const { saldoTotalEl, forecastEl } = getResumenMonthControls();
    if (!saldoTotalEl) return;

    await preferencesDB.initPromise;
    await Promise.all([
        hydrateAccountsFromStorage(),
        hydrateOperationsFromStorage()
    ]);

    const list = Array.isArray(accounts) ? accounts : [];
    const effectiveAccountIds = getEffectiveResumenAccountIds();

    const currentBalance = list.reduce((sum, acc) => {
        if (effectiveAccountIds && !effectiveAccountIds.has(acc.id)) return sum;
        const balance = Number(acc?.balance);
        return sum + (Number.isFinite(balance) ? balance : 0);
    }, 0);

    const currencyCode = await getPreferredCurrencyCodeForBudgets();
    saldoTotalEl.textContent = formatMoney(currentBalance, currencyCode);

    if (forecastEl) {
        const currentMonthKey = getCurrentMonthKey();
        const scheduledOps = (operations || []).filter(op => {
            const opMonth = op.monthKey || getMonthKeyFromDate(op.datetime);
            return opMonth === currentMonthKey && op.status === 'scheduled';
        });

        const relevantScheduled = effectiveAccountIds 
            ? scheduledOps.filter(op => effectiveAccountIds.has(op.accountId))
            : scheduledOps;

        let scheduledNet = 0;
        relevantScheduled.forEach(op => {
            if (op.type === 'income') scheduledNet += Number(op.amount);
            if (op.type === 'expense') scheduledNet -= Number(op.amount);
            if (op.type === 'transfer' && effectiveAccountIds) {
                scheduledNet -= Number(op.amount);
            }
        });

        const projectedBalance = currentBalance + scheduledNet;
        
        forecastEl.classList.remove('hidden');
        
        // Actualizar etiqueta para ser explícitos sobre el mes actual
        const [cY, cM] = currentMonthKey.split('-');
        const currentMonthName = new Date(Number(cY), Number(cM) - 1, 1).toLocaleDateString('es-ES', { month: 'long' });
        const labelTextNode = forecastEl.firstChild;
        if (labelTextNode && labelTextNode.nodeType === Node.TEXT_NODE) {
            labelTextNode.textContent = `Proyección cierre de ${capitalizeLabel(currentMonthName)}: `;
        } else {
            // Fallback si la estructura HTML cambió
            forecastEl.childNodes[0].textContent = `Proyección cierre de ${capitalizeLabel(currentMonthName)}: `;
        }

        const span = forecastEl.querySelector('span');
        if (span) {
            span.textContent = formatMoney(projectedBalance, currencyCode);
            span.classList.remove('text-amber-600', 'text-green-600', 'text-gray-700');
            
            if (projectedBalance < currentBalance) {
                span.classList.add('text-amber-600');
            } else if (projectedBalance > currentBalance) {
                span.classList.add('text-green-600');
            } else {
                span.classList.add('text-gray-700');
            }
        }
    }
}

function setResumenMonthKey(monthKey) {
    const effectiveMode = OPERATIONS_PERIOD_META[resumenPeriodMode] ? resumenPeriodMode : 'monthly';
    const currentBase = getCurrentPeriodStartKey(effectiveMode);
    const candidateBase = clampMonthKeyToPeriod(
        typeof monthKey === 'string' && /^\d{4}-\d{2}$/.test(monthKey) ? monthKey : currentBase,
        effectiveMode
    );
    selectedResumenMonthKey = compareMonthKeys(candidateBase, currentBase) > 0 ? currentBase : candidateBase;
    return selectedResumenMonthKey;
}

function updateResumenMonthNavigator() {
    const { prevBtn, nextBtn, labelEl } = getResumenMonthControls();
    if (!prevBtn || !nextBtn || !labelEl) return;

    const effectiveMode = OPERATIONS_PERIOD_META[resumenPeriodMode] ? resumenPeriodMode : 'monthly';
    const baseKey = setResumenMonthKey(selectedResumenMonthKey);
    const [yearStr, monthStr] = baseKey.split('-');
    const year = Number.parseInt(yearStr, 10);
    const month = Number.parseInt(monthStr, 10);

    if (effectiveMode === 'annual') {
        labelEl.textContent = String(year);
    } else if (effectiveMode === 'quarterly') {
        const quarter = Math.floor((month - 1) / 3) + 1;
        labelEl.textContent = `Q${quarter} ${year}`;
    } else {
        const monthDate = new Date(year, month - 1, 1);
        labelEl.textContent = capitalizeLabel(monthDate.toLocaleDateString('es-ES', { month: 'long' }));
    }
    labelEl.title = capitalizeLabel(formatPeriodLabel(baseKey, effectiveMode));

    prevBtn.disabled = false;
    prevBtn.classList.remove('opacity-40', 'cursor-not-allowed');

    const isAtCurrentPeriod = compareMonthKeys(baseKey, getCurrentPeriodStartKey(effectiveMode)) >= 0;
    nextBtn.disabled = isAtCurrentPeriod;
    nextBtn.classList.toggle('opacity-40', isAtCurrentPeriod);
    nextBtn.classList.toggle('cursor-not-allowed', isAtCurrentPeriod);
}

async function refreshResumenDashboard() {
    const { labelEl } = getResumenMonthControls();
    const hasResumenView = !!labelEl || !!document.getElementById('periodSummaryTitle') || !!document.getElementById('featuredBudgetsList');
    if (!hasResumenView) return;

    const monthKey = setResumenMonthKey(selectedResumenMonthKey);
    updateResumenMonthNavigator();

    await Promise.all([
        renderFeaturedBudgetsPanel(monthKey, resumenPeriodMode),
        renderResumenPeriodSummary(monthKey, resumenPeriodMode),
        renderResumenExtremesAndFeatured(monthKey, resumenPeriodMode)
    ]);
}

function setResumenPeriodMode(mode) {
    if (!OPERATIONS_PERIOD_META[mode]) return;
    if (resumenPeriodMode === mode) {
        closeResumenPeriodMenu();
        return;
    }
    resumenPeriodMode = mode;
    selectedResumenMonthKey = clampMonthKeyToPeriod(selectedResumenMonthKey || getCurrentMonthKey(), resumenPeriodMode);
    setResumenMonthKey(selectedResumenMonthKey);
    closeResumenPeriodMenu();
    updateResumenPeriodControls();
}

// --- Selección de Cuentas (Resumen) ---
const RESUMEN_ACCOUNTS_STORAGE_KEY = 'fti-resumen-accounts-selection';

function getEffectiveResumenAccountIds() {
    if (resumenAccountsMode === 'all') {
        return null; // Null means all accounts
    }
    return new Set(resumenSelectedAccountIds);
}

function saveResumenAccountsSelection() {
    try {
        const payload = JSON.stringify({
            mode: resumenAccountsMode,
            selectedIds: resumenSelectedAccountIds
        });
        sessionStorage.setItem(RESUMEN_ACCOUNTS_STORAGE_KEY, payload);
    } catch (e) {
        console.error('Error saving resumen accounts selection:', e);
    }
}

function loadResumenAccountsSelection() {
    try {
        const stored = sessionStorage.getItem(RESUMEN_ACCOUNTS_STORAGE_KEY);
        if (stored) {
            const parsed = JSON.parse(stored);
            if (parsed.mode === 'all' || parsed.mode === 'specific') {
                resumenAccountsMode = parsed.mode;
            }
            if (Array.isArray(parsed.selectedIds)) {
                resumenSelectedAccountIds = parsed.selectedIds;
            }
        }
    } catch (e) {
        console.error('Error loading resumen accounts selection:', e);
    }
}

function updateResumenAccountsLabel() {
    const labelEl = document.getElementById('resumenAccountsLabel');
    const hintEl = document.getElementById('resumenAccountsHint');
    if (!labelEl) return;

    if (resumenAccountsMode === 'all') {
        labelEl.textContent = 'Todas las Cuentas';
        if (hintEl) hintEl.textContent = `${accounts.length} cuentas seleccionadas`;
    } else {
        const count = resumenSelectedAccountIds.length;
        if (count === 0) {
            labelEl.textContent = 'Ninguna cuenta';
            if (hintEl) hintEl.textContent = 'Selecciona al menos una';
        } else if (count === 1) {
            const acc = getAccountById(resumenSelectedAccountIds[0]);
            labelEl.textContent = acc ? acc.name : '1 Cuenta';
            if (hintEl) hintEl.textContent = '1 cuenta seleccionada';
        } else if (count === accounts.length) {
            labelEl.textContent = 'Todas las Cuentas';
            if (hintEl) hintEl.textContent = `${count} cuentas seleccionadas`;
        } else {
            labelEl.textContent = `${count} Cuentas`;
            if (hintEl) hintEl.textContent = `${count} cuentas seleccionadas`;
        }
    }
}

async function loadResumenAccountsList() {
    const listEl = document.getElementById('resumenAccountsList');
    if (!listEl) return;

    await hydrateAccountsFromStorage();
    // Sort accounts by order
    const sortedAccounts = [...accounts].sort((a, b) => (a.order ?? 0) - (b.order ?? 0));

    listEl.innerHTML = sortedAccounts.map(acc => {
        const isSelected = resumenAccountsMode === 'all' || resumenSelectedAccountIds.includes(acc.id);
        const iconSvg = getAccountIconSvg(acc.iconId);
        return `
            <label class="flex items-center gap-3 p-2 hover:bg-gray-50 rounded-lg cursor-pointer">
                <input type="checkbox" value="${acc.id}" ${isSelected ? 'checked' : ''} class="w-4 h-4 text-indigo-600 rounded border-gray-300 focus:ring-indigo-500 transition">
                <div class="flex items-center gap-2 flex-grow min-w-0">
                    <div class="w-6 h-6 flex items-center justify-center rounded-full bg-gray-100 text-gray-500">
                        ${iconSvg}
                    </div>
                    <span class="text-sm font-medium text-gray-700 truncate">${escapeHtml(acc.name)}</span>
                </div>
            </label>
        `;
    }).join('');

    updateResumenAccountsLabel();
}

function toggleResumenAccountsMenu() {
    const menu = document.getElementById('resumenAccountsMenu');
    const toggleBtn = document.getElementById('resumenAccountsToggle');
    if (!menu || !toggleBtn) return;
    
    const isHidden = menu.classList.contains('hidden');
    if (isHidden) {
        menu.classList.remove('hidden');
        toggleBtn.setAttribute('aria-expanded', 'true');
        loadResumenAccountsList();
    } else {
        closeResumenAccountsMenu();
    }
}

function closeResumenAccountsMenu() {
    const menu = document.getElementById('resumenAccountsMenu');
    const toggleBtn = document.getElementById('resumenAccountsToggle');
    if (menu) {
        menu.classList.add('hidden');
    }
    if (toggleBtn) {
        toggleBtn.setAttribute('aria-expanded', 'false');
    }
}

function updateResumenAccountsSelection() {
    const checkboxes = document.querySelectorAll('#resumenAccountsList input[type="checkbox"]');
    const selectedIds = Array.from(checkboxes).filter(cb => cb.checked).map(cb => cb.value);
    
    resumenAccountsMode = 'specific';
    resumenSelectedAccountIds = selectedIds;
    
    saveResumenAccountsSelection();
    updateResumenAccountsLabel();
    refreshResumenDashboard();
    renderResumenTotalBalance();
}

function resetResumenAccountsFilter() {
    resumenAccountsMode = 'all';
    resumenSelectedAccountIds = [];
    saveResumenAccountsSelection();
    updateResumenAccountsLabel();
    closeResumenAccountsMenu();
    refreshResumenDashboard();
    renderResumenTotalBalance();
}

async function initResumenModule() {
    const { prevBtn, nextBtn, labelEl, saldoTotalEl, periodToggle, periodMenu, periodSelector } = getResumenMonthControls();
    const hasResumenControls = !!prevBtn || !!nextBtn || !!labelEl || !!saldoTotalEl || !!periodToggle;
    if (!hasResumenControls) return;

    resumenPeriodMode = 'monthly';
    selectedResumenMonthKey = getCurrentMonthKey();
    setResumenMonthKey(selectedResumenMonthKey);
    updateResumenPeriodControls();
    updateResumenMonthNavigator();

    if (periodToggle && !periodToggle.dataset.listenerAttached) {
        periodToggle.dataset.listenerAttached = 'true';
        periodToggle.addEventListener('click', toggleResumenPeriodMenu);
    }
    if (periodMenu && !periodMenu.dataset.listenerAttached) {
        periodMenu.dataset.listenerAttached = 'true';
        periodMenu.addEventListener('click', async (event) => {
            const button = event.target.closest('[data-period-mode]');
            if (!button) return;
            setResumenPeriodMode(button.dataset.periodMode);
            await refreshResumenDashboard();
        });
    }
    if (periodSelector && !periodSelector.dataset.listenerAttached) {
        periodSelector.dataset.listenerAttached = 'true';
        document.addEventListener('click', (event) => {
            if (!periodSelector.contains(event.target)) {
                closeResumenPeriodMenu();
            }
        });
    }

    const accountsToggleBtn = document.getElementById('resumenAccountsToggle');
    if (accountsToggleBtn && !accountsToggleBtn.dataset.listenerAttached) {
        accountsToggleBtn.dataset.listenerAttached = 'true';
        accountsToggleBtn.addEventListener('click', toggleResumenAccountsMenu);
    }
    const accountsMenu = document.getElementById('resumenAccountsMenu');
    if (accountsMenu && !accountsMenu.dataset.listenerAttached) {
        accountsMenu.dataset.listenerAttached = 'true';
        accountsMenu.addEventListener('click', (e) => {
            const resetBtn = e.target.closest('#resumenAccountsResetBtn');
            if (resetBtn) {
                resetResumenAccountsFilter();
                return;
            }
            const closeBtn = e.target.closest('#resumenAccountsCloseBtn');
            if (closeBtn) {
                closeResumenAccountsMenu();
                return;
            }
            const checkbox = e.target.closest('[type="checkbox"]');
            if (checkbox) {
                updateResumenAccountsSelection();
            }
        });
    }
    document.addEventListener('click', (e) => {
        const accountsSelector = document.getElementById('resumenAccountsSelector');
        if (accountsSelector && !accountsSelector.contains(e.target)) {
            closeResumenAccountsMenu();
        }
    });

    loadResumenAccountsSelection();
    await loadResumenAccountsList();

    if (prevBtn && !prevBtn.dataset.listenerAttached) {
        prevBtn.dataset.listenerAttached = 'true';
        prevBtn.addEventListener('click', async () => {
            selectedResumenMonthKey = shiftPeriodKey(setResumenMonthKey(selectedResumenMonthKey), resumenPeriodMode, -1);
            await refreshResumenDashboard();
        });
    }

    if (nextBtn && !nextBtn.dataset.listenerAttached) {
        nextBtn.dataset.listenerAttached = 'true';
        nextBtn.addEventListener('click', async () => {
            const candidate = shiftPeriodKey(setResumenMonthKey(selectedResumenMonthKey), resumenPeriodMode, 1);
            if (compareMonthKeys(candidate, getCurrentPeriodStartKey(resumenPeriodMode)) > 0) return;
            selectedResumenMonthKey = candidate;
            await refreshResumenDashboard();
        });
    }

    await renderResumenTotalBalance();
    await refreshResumenDashboard();
}

async function setupBudgetsManagement() {
    const budgetsModal = document.getElementById('budgetsModal');
    const openBudgetsModalBtn = document.getElementById('openBudgetsModal');
    const closeBudgetsModalBtn = document.getElementById('closeBudgetsModal');

    if (!budgetsModal || !openBudgetsModalBtn || !closeBudgetsModalBtn) {
        return;
    }

    const totalInput = document.getElementById('budgetTotalAmount');
    const effectiveFromInput = document.getElementById('budgetEffectiveFrom');
    const currencyLabel = document.getElementById('budgetCurrencyLabel');
    const summaryTotalEl = document.getElementById('budgetsSummaryTotal');
    const summaryAssignedEl = document.getElementById('budgetsSummaryAssigned');
    const summaryAvailableEl = document.getElementById('budgetsSummaryAvailable');
    const assignedBarEl = document.getElementById('budgetsAssignedBar');
    const categorySelect = document.getElementById('budgetCategorySelect');
    const categoryAmountInput = document.getElementById('budgetCategoryAmount');
    const saveSubBudgetBtn = document.getElementById('saveSubBudgetBtn');
    const cancelSubBudgetEditBtn = document.getElementById('cancelSubBudgetEditBtn');
    const editingSubBudgetIdInput = document.getElementById('editingSubBudgetId');
    const subBudgetsList = document.getElementById('budgetsSubBudgetsList');

    if (!totalInput || !effectiveFromInput || !currencyLabel || !summaryTotalEl || !summaryAssignedEl || !summaryAvailableEl || !assignedBarEl || !categorySelect || !categoryAmountInput || !saveSubBudgetBtn || !cancelSubBudgetEditBtn || !editingSubBudgetIdInput || !subBudgetsList) {
        return;
    }

    const backdrop = budgetsModal.firstElementChild;
    let currencyCode = 'MXN';
    let plan = null;
    let orderedExpenseCategories = [];
    let expenseCategoryMap = new Map();
    let usageMap = new Map();

    function closeModal() {
        budgetsModal.classList.add('hidden');
        document.body.style.overflow = '';
        exitSubBudgetEdit();
    }

    function computeAssignedAmount() {
        const list = Array.isArray(plan?.subBudgets) ? plan.subBudgets : [];
        return list.reduce((acc, entry) => acc + (Number.isFinite(entry?.amount) ? entry.amount : 0), 0);
    }

    function renderSummary() {
        const totalAmount = parseMoney(plan?.totalAmount);
        const assignedAmount = computeAssignedAmount();
        const availableAmount = totalAmount - assignedAmount; // Unassigned amount

        currencyLabel.textContent = currencyCode;
        summaryTotalEl.textContent = formatMoney(totalAmount, currencyCode);
        summaryAssignedEl.textContent = formatMoney(assignedAmount, currencyCode);
        summaryAvailableEl.textContent = formatMoney(availableAmount, currencyCode);
        summaryAvailableEl.classList.toggle('text-red-600', availableAmount < 0);
        summaryAvailableEl.classList.toggle('text-gray-800', availableAmount >= 0);

        // Render Fractionated Bar
        if (totalAmount <= 0) {
            assignedBarEl.innerHTML = '';
            return;
        }

        const list = Array.isArray(plan?.subBudgets) ? plan.subBudgets : [];
        let segmentsHtml = '';
        
        list.forEach((entry) => {
             const amount = parseMoney(entry.amount);
             if (amount <= 0) return;
             
             const category = expenseCategoryMap.get(entry.categoryId);
             const color = sanitizeHexColor(category?.color, '#6366f1');
             const widthPercent = (amount / totalAmount) * 100;
             
             // We won't round percent here to allow precise stacking, 
             // but CSS width works fine with decimals.
             
             segmentsHtml += `<div style="width: ${widthPercent}%; background-color: ${color}" title="${escapeHtml(category?.displayName || 'Categoría')} (${formatMoney(amount, currencyCode)})"></div>`;
        });
        
        assignedBarEl.innerHTML = segmentsHtml;
        // Clean up previous styles applied to the container itself if any
        assignedBarEl.style.width = ''; 
        assignedBarEl.classList.remove('bg-red-600', 'bg-indigo-600');
    }

    function renderCategoryOptions() {
        if (!orderedExpenseCategories.length) {
            categorySelect.innerHTML = '<option value="" disabled selected>No hay categorías de gasto</option>';
            categorySelect.disabled = true;
            return;
        }

        categorySelect.disabled = false;
        categorySelect.innerHTML = '<option value="" disabled selected>Selecciona una categoría</option>' + orderedExpenseCategories
            .map((cat) => `<option value="${escapeHtml(cat.id)}">${escapeHtml(cat.name)}</option>`)
            .join('');
    }

    function renderSubBudgetsList() {
        const list = Array.isArray(plan?.subBudgets) ? plan.subBudgets : [];
        if (!list.length) {
            subBudgetsList.innerHTML = `
                <div class="text-center py-6">
                    <p class="text-sm text-gray-400 italic">Aún no tienes subpresupuestos configurados.</p>
                </div>
            `;
            return;
        }

        const totalAmount = parseMoney(plan?.totalAmount);
        subBudgetsList.innerHTML = list
            .map((entry) => {
                const category = expenseCategoryMap.get(entry.categoryId);
                const name = category?.rawName || 'Categoría eliminada';
                const badge = category?.displayName || name;
                const color = category?.color || '#e5e7eb';
                const assigned = parseMoney(entry.amount);
                
                // Usage Calculation
                const spent = usageMap.get(entry.categoryId) || 0;
                const remaining = assigned - spent;
                const percentConsumed = assigned > 0 ? Math.min(100, Math.round((spent / assigned) * 100)) : 0;
                
                const iconMarkup = category?.icon ? `<i class="${escapeHtml(category.icon)} text-gray-500"></i>` : '';
                
                // Status color for text
                const statusColorClass = remaining < 0 ? 'text-red-600' : 'text-gray-500';
                const barColor = remaining < 0 ? '#dc2626' : color;

                return `
                    <div class="flex items-center justify-between gap-3 bg-gray-50 border border-gray-100 rounded-xl p-3">
                        <div class="flex items-start gap-3 min-w-0 flex-1">
                            <div class="mt-1 w-2.5 h-2.5 rounded-full" style="background:${escapeHtml(color)}"></div>
                            <div class="min-w-0 flex-1">
                                <div class="flex items-center gap-2 min-w-0">
                                    ${iconMarkup}
                                    <p class="text-sm font-semibold text-gray-800 truncate" title="${escapeHtml(name)}">${escapeHtml(badge)}</p>
                                    <span class="text-[10px] font-bold ${remaining < 0 ? 'text-red-100 bg-red-600' : 'text-gray-400 bg-white'} px-2 py-0.5 rounded-full border border-gray-100">
                                        ${percentConsumed}%
                                    </span>
                                </div>
                                <div class="w-full bg-white rounded-full h-2 mt-2 border border-gray-100 overflow-hidden">
                                    <div class="h-2 rounded-full transition-all" style="width:${percentConsumed}%;background:${escapeHtml(barColor)}"></div>
                                </div>
                                <div class="flex justify-between text-xs mt-1">
                                    <span class="text-gray-500">Gastado: ${escapeHtml(formatMoney(spent, currencyCode))}</span>
                                    <span class="${statusColorClass} font-medium">Restante: ${escapeHtml(formatMoney(remaining, currencyCode))}</span>
                                </div>
                            </div>
                        </div>
                        <div class="flex items-center gap-2 flex-shrink-0">
                            <p class="text-sm font-bold text-gray-800">${escapeHtml(formatMoney(assigned, currencyCode))}</p>
                            <div class="flex items-center gap-1">
                                <button data-action="edit-sub" data-id="${escapeHtml(entry.id)}" class="p-2 rounded-lg bg-white hover:bg-gray-100 border border-gray-100 transition" aria-label="Editar">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-gray-500"><path d="M12 20h9"/><path d="M16.5 3.5a2.121 2.121 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
                                </button>
                                <button data-action="delete-sub" data-id="${escapeHtml(entry.id)}" class="p-2 rounded-lg bg-white hover:bg-red-50 border border-gray-100 transition" aria-label="Eliminar">
                                    <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" class="text-red-600"><path d="M3 6h18"/><path d="M8 6V4h8v2"/><path d="M19 6l-1 14H6L5 6"/><path d="M10 11v6"/><path d="M14 11v6"/></svg>
                                </button>
                            </div>
                        </div>
                    </div>
                `;
            })
            .join('');
    }

    function enterSubBudgetEdit(entry) {
        editingSubBudgetIdInput.value = entry.id;
        categorySelect.value = entry.categoryId;
        categoryAmountInput.value = String(parseMoney(entry.amount) || '');
        saveSubBudgetBtn.textContent = 'Guardar';
        cancelSubBudgetEditBtn.classList.remove('hidden');
    }

    function exitSubBudgetEdit() {
        editingSubBudgetIdInput.value = '';
        categorySelect.value = '';
        categoryAmountInput.value = '';
        saveSubBudgetBtn.textContent = 'Agregar';
        cancelSubBudgetEditBtn.classList.add('hidden');
    }

    function renderAll() {
        totalInput.value = plan?.totalAmount ? String(plan.totalAmount) : '';
        effectiveFromInput.value = plan?.effectiveFrom || getCurrentMonthKey();
        renderCategoryOptions();
        renderSummary();
        renderSubBudgetsList();
    }

    async function hydrate() {
        currencyCode = await getPreferredCurrencyCodeForBudgets();
        const categoriesData = await loadExpenseCategoriesForBudgets();
        orderedExpenseCategories = categoriesData.ordered;
        expenseCategoryMap = categoriesData.categoryMap;
        plan = await loadBudgetPlan(currencyCode);
        
        const usageData = await calculateMonthlyBudgetUsage(currencyCode);
        usageMap = usageData.usageMap;

        renderAll();
    }

    openBudgetsModalBtn.addEventListener('click', async () => {
        budgetsModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        await hydrate();
    });

    closeBudgetsModalBtn.addEventListener('click', closeModal);
    if (backdrop) {
        backdrop.addEventListener('click', closeModal);
    }

    totalInput.addEventListener('change', async () => {
        if (!plan) return;
        plan.totalAmount = parseMoney(totalInput.value);
        plan.currency = currencyCode;
        plan.updatedAt = new Date().toISOString();
        await saveBudgetPlan(plan);
        renderSummary();
        renderSubBudgetsList();
    });

    effectiveFromInput.addEventListener('change', async () => {
        if (!plan) return;
        const raw = String(effectiveFromInput.value || '').trim();
        plan.effectiveFrom = /^\d{4}-\d{2}$/.test(raw) ? raw : getCurrentMonthKey();
        plan.updatedAt = new Date().toISOString();
        await saveBudgetPlan(plan);
    });

    saveSubBudgetBtn.addEventListener('click', async () => {
        if (!plan) return;
        const categoryId = String(categorySelect.value || '').trim();
        const amount = parseMoney(categoryAmountInput.value);

        if (!categoryId || amount <= 0) {
            alert('Selecciona una categoría válida y un monto mayor a cero.');
            return;
        }

        const editingId = String(editingSubBudgetIdInput.value || '').trim();
        const existingByCategory = plan.subBudgets.find((entry) => entry.categoryId === categoryId);

        if (editingId) {
            const target = plan.subBudgets.find((entry) => entry.id === editingId);
            if (target) {
                target.categoryId = categoryId;
                target.amount = amount;
            }
        } else if (existingByCategory) {
            existingByCategory.amount = amount;
        } else {
            plan.subBudgets.push({ id: generateBudgetId(), categoryId, amount });
        }

        plan.updatedAt = new Date().toISOString();
        await saveBudgetPlan(plan);
        exitSubBudgetEdit();
        renderSummary();
        renderSubBudgetsList();
    });

    cancelSubBudgetEditBtn.addEventListener('click', () => {
        exitSubBudgetEdit();
    });

    subBudgetsList.addEventListener('click', async (event) => {
        const button = event.target?.closest('button[data-action]');
        if (!button || !plan) return;

        const action = button.dataset.action;
        const id = String(button.dataset.id || '').trim();
        if (!id) return;

        if (action === 'edit-sub') {
            const entry = plan.subBudgets.find((item) => item.id === id);
            if (entry) {
                enterSubBudgetEdit(entry);
            }
            return;
        }

        if (action === 'delete-sub') {
            const entry = plan.subBudgets.find((item) => item.id === id);
            const category = entry ? expenseCategoryMap.get(entry.categoryId) : null;
            const name = category?.rawName || 'esta categoría';
            if (!confirm(`¿Eliminar el subpresupuesto de "${name}"?`)) return;
            plan.subBudgets = plan.subBudgets.filter((item) => item.id !== id);
            plan.updatedAt = new Date().toISOString();
            await saveBudgetPlan(plan);
            exitSubBudgetEdit();
            renderSummary();
            renderSubBudgetsList();
        }
    });
}

async function setupWebhookModal() {
    const discordWebhookInput = document.getElementById('discordWebhookInput');
    const openWebhookModalBtn = document.getElementById('openWebhookModal');
    const closeWebhookModalBtn = document.getElementById('closeWebhookModal');
    const webhookModal = document.getElementById('webhookModal');
    const saveWebhookBtn = document.getElementById('saveWebhookButton');
    const deleteWebhookBtn = document.getElementById('deleteWebhookButton');
    const toggleWebhookVisibilityBtn = document.getElementById('toggleWebhookVisibility');

    if (openWebhookModalBtn && webhookModal) {
        openWebhookModalBtn.addEventListener('click', () => {
            webhookModal.classList.remove('hidden');
            document.body.style.overflow = 'hidden'; // Prevent scroll
        });
    }

    if (closeWebhookModalBtn && webhookModal) {
        closeWebhookModalBtn.addEventListener('click', () => {
            webhookModal.classList.add('hidden');
            document.body.style.overflow = '';
        });
        // Close on backdrop click
        webhookModal.addEventListener('click', (e) => {
            if (e.target === webhookModal) {
                webhookModal.classList.add('hidden');
                document.body.style.overflow = '';
            }
        });
    }

    if (saveWebhookBtn && discordWebhookInput) {
        saveWebhookBtn.addEventListener('click', async () => {
            const value = discordWebhookInput.value.trim();
            await handleDiscordWebhookChange({ currentTarget: discordWebhookInput });
            alert('Configuración guardada correctamente.');
            webhookModal.classList.add('hidden');
            document.body.style.overflow = '';
        });
    }

    if (deleteWebhookBtn && discordWebhookInput) {
        deleteWebhookBtn.addEventListener('click', async () => {
            if (confirm('¿Estás seguro de que quieres eliminar la URL del Webhook?')) {
                discordWebhookInput.value = '';
                await handleDiscordWebhookChange({ currentTarget: discordWebhookInput });
                alert('Webhook eliminado.');
                webhookModal.classList.add('hidden');
                document.body.style.overflow = '';
            }
        });
    }

    if (toggleWebhookVisibilityBtn && discordWebhookInput) {
        toggleWebhookVisibilityBtn.addEventListener('click', () => {
            const isPassword = discordWebhookInput.type === 'password';
            discordWebhookInput.type = isPassword ? 'text' : 'password';
            toggleWebhookVisibilityBtn.innerHTML = isPassword 
                ? '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9.88 9.88a3 3 0 1 0 4.24 4.24"></path><path d="M10.73 5.08A10.43 10.43 0 0 1 12 5c7 0 10 7 10 7a13.16 13.16 0 0 1-1.67 2.68"></path><path d="M6.61 6.61A13.52 13.52 0 0 0 2 12s3 7 10 7a9.74 9.74 0 0 0 5.39-1.61"></path><line x1="2" y1="2" x2="22" y2="22"></line></svg>'
                : '<svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>';
        });
    }
}

/**
 * Gestión de Metas de Ahorro
 */
async function setupSavingsManagement() {
    const savingsModal = document.getElementById('savingsModal');
    const openSavingsModalBtn = document.getElementById('openSavingsModal');
    const closeSavingsModalBtn = document.getElementById('closeSavingsModal');
    const savingsGoalsList = document.getElementById('savingsGoalsList');
    const featuredSavingsList = document.getElementById('featuredSavingsList');
    const showNewGoalFormBtn = document.getElementById('showNewGoalForm');
    const newGoalForm = document.getElementById('newGoalForm');
    const cancelGoalBtn = document.getElementById('cancelGoal');
    const saveGoalBtn = document.getElementById('saveGoal');
    const historyModal = document.getElementById('historyModal');
    const historyList = document.getElementById('historyList');
    const closeHistoryModalBtn = document.getElementById('closeHistoryModal');

    if (savingsGoalsList || featuredSavingsList) {
        await renderSavingsGoals();
    }

    if (!savingsModal || !openSavingsModalBtn) return;

    // Cerrar modal de historial
    if (closeHistoryModalBtn) {
        closeHistoryModalBtn.addEventListener('click', () => {
            historyModal.classList.add('hidden');
        });
    }

    // Abrir modal principal
    openSavingsModalBtn.addEventListener('click', async () => {
        savingsModal.classList.remove('hidden');
        document.body.style.overflow = 'hidden';
        await renderSavingsGoals();
    });

    // Cerrar modal
    closeSavingsModalBtn.addEventListener('click', () => {
        savingsModal.classList.add('hidden');
        document.body.style.overflow = '';
        if (newGoalForm) newGoalForm.classList.add('hidden');
    });

    // Mostrar/Ocultar formulario
    if (showNewGoalFormBtn && newGoalForm) {
        showNewGoalFormBtn.addEventListener('click', () => {
            const isHidden = newGoalForm.classList.contains('hidden');
            if (isHidden) {
                resetGoalForm();
                document.getElementById('goalFormTitle').textContent = 'Nueva Meta';
                newGoalForm.classList.remove('hidden');
                newGoalForm.scrollIntoView({ behavior: 'smooth' });
            } else {
                newGoalForm.classList.add('hidden');
            }
        });
    }

    if (cancelGoalBtn && newGoalForm) {
        cancelGoalBtn.addEventListener('click', () => {
            newGoalForm.classList.add('hidden');
            resetGoalForm();
        });
    }

    // Manejo de colores
    const colorOpts = document.querySelectorAll('.color-opt');
    colorOpts.forEach(opt => {
        opt.addEventListener('click', () => {
            colorOpts.forEach(o => o.classList.remove('ring-2', 'ring-offset-2', 'ring-indigo-500'));
            opt.classList.add('ring-2', 'ring-offset-2', 'ring-indigo-500');
        });
    });

    // Guardar o Actualizar meta
    if (saveGoalBtn) {
        saveGoalBtn.addEventListener('click', async () => {
            const idField = document.getElementById('goalIdField').value;
            const name = document.getElementById('goalName').value.trim();
            const description = document.getElementById('goalDescription').value.trim();
            const target = parseFloat(document.getElementById('goalTarget').value);
            const current = parseFloat(document.getElementById('goalCurrent').value) || 0;
            const selectedColorBtn = document.querySelector('.color-opt.ring-2');
            const color = selectedColorBtn ? selectedColorBtn.dataset.color : 'indigo';

            if (!name || isNaN(target) || target <= 0) {
                alert('Por favor, ingresa un nombre válido y un monto objetivo mayor a cero.');
                return;
            }

            try {
                if (idField) {
                    const oldGoal = (await preferencesDB.getAllSavings()).find(g => g.id === parseInt(idField));
                    const goalData = {
                        ...oldGoal,
                        name,
                        description,
                        target,
                        current,
                        color,
                        updatedAt: new Date().toISOString()
                    };

                    // Detectar cambios para el historial
                    let changes = [];
                    if (oldGoal.name !== name) changes.push(`Nombre: "${oldGoal.name}" → "${name}"`);
                    if (oldGoal.target !== target) changes.push(`Objetivo: ${formatCurrency(oldGoal.target)} → ${formatCurrency(target)}`);
                    if (oldGoal.current !== current) changes.push(`Monto: ${formatCurrency(oldGoal.current)} → ${formatCurrency(current)}`);
                    if (oldGoal.description !== description) changes.push(`Descripción actualizada`);
                    if (oldGoal.color !== color) changes.push(`Color actualizado`);

                    if (changes.length > 0) {
                        if (!goalData.history) goalData.history = [];
                        goalData.history.unshift({
                            date: new Date().toISOString(),
                            type: 'edit',
                            description: 'Meta editada',
                            details: changes.join(', ')
                        });
                    }

                    await preferencesDB.updateSaving(goalData);
                } else {
                    const goalData = {
                        name,
                        description,
                        target,
                        current,
                        color,
                        createdAt: new Date().toISOString(),
                        updatedAt: new Date().toISOString(),
                        history: [{
                            date: new Date().toISOString(),
                            type: 'creation',
                            description: 'Meta creada',
                            details: `Iniciada con ${formatCurrency(current)} de un objetivo de ${formatCurrency(target)}`
                        }]
                    };
                    await preferencesDB.addSaving(goalData);
                }
                resetGoalForm();
                if (newGoalForm) newGoalForm.classList.add('hidden');
                await renderSavingsGoals();
            } catch (error) {
                console.error('Error saving goal:', error);
                alert(`Error al guardar la meta: ${error.message || 'Error de base de datos'}`);
            }
        });
    }

    async function renderSavingsGoals() {
        const goals = await preferencesDB.getAllSavings();
        const containers = [savingsGoalsList, featuredSavingsList].filter(c => c !== null);
        
        containers.forEach(container => {
            container.innerHTML = '';
            
            if (goals.length === 0) {
                container.innerHTML = `
                    <div class="text-center py-8 w-full">
                        <p class="text-gray-400 italic">No tienes metas de ahorro configuradas.</p>
                    </div>
                `;
                return;
            }

            goals.forEach(goal => {
                const targetAmount = Number(goal.target) || 0;
                const currentAmount = Number(goal.current) || 0;
                const remainingAmount = Math.max(targetAmount - currentAmount, 0);
                const progress = targetAmount > 0 ? Math.min(Math.round((currentAmount / targetAmount) * 100), 100) : 0;
                const colorClass = `bg-${goal.color}-500`;
                const textClass = `text-${goal.color}-600`;
                const bgLightClass = `bg-${goal.color}-100`;
                const remainingText = remainingAmount === 0
                    ? '<span class="font-semibold text-emerald-600">Objetivo alcanzado</span>'
                    : `Faltan <span class="font-semibold ${textClass}">${formatCurrency(remainingAmount)}</span> para llegar`;

                const goalEl = document.createElement('div');
                goalEl.className = container === featuredSavingsList 
                    ? 'bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow w-full'
                    : 'bg-white border border-gray-100 rounded-xl p-4 shadow-sm hover:shadow-md transition-shadow flex-shrink-0 w-[280px] snap-center';
                
                goalEl.innerHTML = `
                    <div class="flex justify-between items-start mb-2">
                        <div class="flex items-center gap-3">
                            <div class="p-2 ${bgLightClass} rounded-lg ${textClass}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/></svg>
                            </div>
                            <div>
                                <h4 class="font-bold text-gray-800">${goal.name}</h4>
                                <p class="text-[10px] text-gray-400 uppercase tracking-wider font-semibold">Objetivo: ${formatCurrency(goal.target)}</p>
                            </div>
                        </div>
                        <div class="flex gap-1">
                            <button class="view-history p-1.5 text-gray-400 hover:text-indigo-600 transition" data-id="${goal.id}" title="Ver Historial">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 12s3-7 10-7 10 7 10 7-3 7-10 7-10-7-10-7Z"></path><circle cx="12" cy="12" r="3"></circle></svg>
                            </button>
                            <button class="edit-goal p-1.5 text-gray-400 hover:text-indigo-500 transition" data-id="${goal.id}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"></path><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"></path></svg>
                            </button>
                            <button class="delete-goal p-1.5 text-gray-400 hover:text-red-500 transition" data-id="${goal.id}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 6h18"></path><path d="M19 6v14c0 1-1 2-2 2H7c-1 0-2-1-2-2V6"></path><path d="M8 6V4c0-1 1-2 2-2h4c1 0 2 1 2 2v2"></path></svg>
                            </button>
                        </div>
                    </div>
                    
                    ${goal.description ? `<p class="text-xs text-gray-500 mb-3 line-clamp-2 italic">"${goal.description}"</p>` : ''}
                    
                    <div class="space-y-2">
                        <div class="flex justify-between text-xs font-semibold">
                            <span class="text-gray-600">${formatCurrency(currentAmount)} ahorrados</span>
                            <span class="${textClass}">${progress}%</span>
                        </div>
                        <div class="w-full bg-gray-100 rounded-full h-2.5 overflow-hidden">
                            <div class="${colorClass} h-full transition-all duration-500" style="width: ${progress}%"></div>
                        </div>
                        <div class="text-[11px] text-gray-500">${remainingText}</div>
                    </div>

                    <div class="flex gap-2 mt-4">
                        <button class="update-amount flex-grow py-1.5 text-xs font-bold rounded-lg border border-gray-200 text-gray-600 hover:bg-gray-50 transition" data-id="${goal.id}" data-action="subtract">
                            - Restar
                        </button>
                        <button class="update-amount flex-grow py-1.5 text-xs font-bold rounded-lg bg-white border border-gray-200 text-indigo-600 hover:bg-indigo-50 transition" data-id="${goal.id}" data-action="add">
                            + Aportar
                        </button>
                    </div>
                `;
                container.appendChild(goalEl);
            });
        });
    }

    // Manejador común para eventos de metas
    async function handleGoalAction(e, container) {
        const btn = e.target.closest('button');
        if (!btn || !container.contains(btn)) return;

        const id = Number(btn.dataset.id);
        if (!Number.isFinite(id)) return;

        let goals;
        try {
            goals = await preferencesDB.getAllSavings();
        } catch (error) {
            console.error('Error loading savings goals:', error);
            alert('No se pudo cargar la información de las metas.');
            return;
        }

        const goal = goals.find(g => Number(g.id) === id);
        if (!goal) return;

        if (btn.classList.contains('view-history')) {
            try {
                showHistory(goal);
            } catch (error) {
                console.error('Error showing goal history:', error);
                alert('No se pudo abrir el historial de la meta.');
            }
            return;
        }

        if (btn.classList.contains('edit-goal')) {
            if (savingsModal.classList.contains('hidden')) {
                savingsModal.classList.remove('hidden');
                document.body.style.overflow = 'hidden';
            }

            document.getElementById('goalIdField').value = goal.id;
            document.getElementById('goalName').value = goal.name;
            document.getElementById('goalDescription').value = goal.description || '';
            document.getElementById('goalTarget').value = goal.target;
            document.getElementById('goalCurrent').value = goal.current;
            document.getElementById('goalFormTitle').textContent = 'Editar Meta';
            
            // Seleccionar color
            const colorOpts = document.querySelectorAll('.color-opt');
            colorOpts.forEach(o => {
                o.classList.remove('ring-2', 'ring-offset-2', 'ring-indigo-500');
                if (o.dataset.color === goal.color) {
                    o.classList.add('ring-2', 'ring-offset-2', 'ring-indigo-500');
                }
            });

            if (newGoalForm) {
                newGoalForm.classList.remove('hidden');
                newGoalForm.scrollIntoView({ behavior: 'smooth' });
            }
        } else if (btn.classList.contains('delete-goal')) {
            if (confirm('¿Estás seguro de que quieres eliminar esta meta de ahorro?')) {
                try {
                    await preferencesDB.deleteSaving(id);
                    await renderSavingsGoals();
                } catch (error) {
                    console.error('Error deleting goal:', error);
                    alert('No se pudo eliminar la meta.');
                }
            }
        } else if (btn.classList.contains('update-amount')) {
            const action = btn.dataset.action;
            const isAdd = action === 'add';
            const promptMsg = isAdd ? '¿Cuánto quieres aportar a esta meta?' : '¿Cuánto quieres retirar de esta meta?';
            const amountStr = prompt(promptMsg, '0');
            const amount = Number(amountStr);

            if (!Number.isFinite(amount) || amount <= 0) return;

            const modePrompt = isAdd
                ? 'Elige el tipo de movimiento:\n1) Transferencia desde cuenta\n2) Depósito sin cuenta (manual)\n\nEscribe 1 o 2:'
                : 'Elige el tipo de movimiento:\n1) Transferencia a cuenta\n2) Retiro sin cuenta (manual)\n\nEscribe 1 o 2:';
            const modeStr = prompt(modePrompt, '1');
            const mode = modeStr === '1' ? 'transfer' : modeStr === '2' ? 'manual' : null;
            if (!mode) return;

            if (mode === 'manual') {
                try {
                    if (isAdd) {
                        goal.current += amount;
                    } else {
                        goal.current = Math.max(0, goal.current - amount);
                    }

                    if (!goal.history) goal.history = [];
                    goal.history.unshift({
                        date: new Date().toISOString(),
                        type: 'transaction',
                        description: isAdd ? 'Depósito sin cuenta' : 'Retiro sin cuenta',
                        details: `${isAdd ? '+' : '-'}${formatCurrency(amount)} (Saldo: ${formatCurrency(goal.current)})`
                    });

                    await preferencesDB.updateSaving(goal);
                    await renderSavingsGoals();
                } catch (error) {
                    console.error('Error updating goal:', error);
                    alert('No se pudo actualizar el monto de la meta.');
                }
                return;
            }

            try {
                const nextAccounts = await loadAccountsSnapshot();
                const previousAccounts = nextAccounts.map(acc => ({ ...acc }));
                const selectable = isAdd
                    ? nextAccounts.filter(acc => Number.isFinite(Number(acc?.balance)) && Number(acc.balance) > 0)
                    : nextAccounts.filter(acc => acc && typeof acc.id === 'string');

                if (selectable.length === 0) {
                    alert(isAdd
                        ? 'No hay cuentas con saldo disponible para transferir a la meta.'
                        : 'No hay cuentas disponibles para recibir la transferencia.'
                    );
                    return;
                }

                const selected = promptSelectAccount(
                    selectable,
                    isAdd ? 'Selecciona la cuenta origen para transferir a la meta:' : 'Selecciona la cuenta destino para recibir el retiro:'
                );
                if (!selected) return;

                const accountIndex = nextAccounts.findIndex(acc => acc?.id === selected.id);
                if (accountIndex === -1) {
                    alert('No se encontró la cuenta seleccionada.');
                    return;
                }

                const accountBalance = Number(nextAccounts[accountIndex].balance);
                if (isAdd && accountBalance < amount) {
                    alert(`Saldo insuficiente en "${selected.name || 'Cuenta'}". Disponible: ${formatCurrency(accountBalance)}.`);
                    return;
                }
                if (!isAdd && goal.current < amount) {
                    alert(`Saldo insuficiente en la meta "${goal.name}". Disponible: ${formatCurrency(goal.current)}.`);
                    return;
                }

                if (isAdd) {
                    nextAccounts[accountIndex].balance = accountBalance - amount;
                    goal.current += amount;
                } else {
                    nextAccounts[accountIndex].balance = accountBalance + amount;
                    goal.current = Math.max(0, goal.current - amount);
                }

                const updatedAccount = nextAccounts[accountIndex];
                if (updatedAccount) {
                    if (!Array.isArray(updatedAccount.history)) {
                        updatedAccount.history = [];
                    }

                    const updatedAccountBalance = Number(updatedAccount.balance);
                    const balanceLabel = Number.isFinite(updatedAccountBalance) ? formatCurrency(updatedAccountBalance) : '$0.00';
                    const amountLabel = `${isAdd ? '-' : '+'}${formatCurrency(amount)}`;
                    updatedAccount.history.unshift({
                        date: new Date().toISOString(),
                        type: 'transfer',
                        description: isAdd ? 'Transferencia a meta de ahorro' : 'Transferencia desde meta de ahorro',
                        details: `${amountLabel} (Meta: ${goal.name || 'Meta'} · Saldo: ${balanceLabel})`
                    });
                    if (updatedAccount.history.length > 200) {
                        updatedAccount.history = updatedAccount.history.slice(0, 200);
                    }
                }

                if (!goal.history) goal.history = [];
                goal.history.unshift({
                    date: new Date().toISOString(),
                    type: 'transaction',
                    description: isAdd ? 'Transferencia desde cuenta' : 'Transferencia a cuenta',
                    details: `${isAdd ? '+' : '-'}${formatCurrency(amount)} (${isAdd ? 'Desde' : 'A'}: ${selected.name || 'Cuenta'} · Saldo meta: ${formatCurrency(goal.current)})`
                });

                await persistAccountsSnapshot(nextAccounts);
                try {
                    await preferencesDB.updateSaving(goal);
                } catch (error) {
                    await persistAccountsSnapshot(previousAccounts);
                    throw error;
                }
                await renderSavingsGoals();
            } catch (error) {
                console.error('Error processing transfer:', error);
                alert('No se pudo completar la transferencia.');
            }
        }
    }

    async function loadAccountsSnapshot() {
        let stored = await preferencesDB.getItem(ACCOUNTS_STORAGE_KEY);
        if (!stored) {
            stored = getLocalStorageFallback(ACCOUNTS_STORAGE_KEY);
        }

        if (stored) {
            try {
                const parsed = JSON.parse(stored);
                if (Array.isArray(parsed)) {
                    return parsed.map(acc => ({ ...acc }));
                }
            } catch (error) {
                console.error('Error parsing accounts snapshot:', error);
            }
        }

        const fallbackAccounts = DEFAULT_ACCOUNTS.map(acc => ({ ...acc }));
        await persistAccountsSnapshot(fallbackAccounts);
        return fallbackAccounts;
    }

    async function persistAccountsSnapshot(nextAccounts) {
        const payload = JSON.stringify(nextAccounts);
        await preferencesDB.setItem(ACCOUNTS_STORAGE_KEY, payload);
        setLocalStorageFallback(ACCOUNTS_STORAGE_KEY, payload);
    }

    function promptSelectAccount(accountList, title) {
        const lines = accountList.map((acc, idx) => {
            const name = acc?.name || 'Cuenta';
            const balance = Number(acc?.balance);
            const displayBalance = Number.isFinite(balance) ? formatCurrency(balance) : '$0.00';
            return `${idx + 1}) ${name} — Saldo: ${displayBalance}`;
        });

        const selectionStr = prompt(`${title}\n\n${lines.join('\n')}\n\nEscribe el número:`, '1');
        const selection = Number(selectionStr);
        if (!Number.isFinite(selection) || selection < 1 || selection > accountList.length) return null;
        return accountList[selection - 1];
    }

    // Eventos delegados para las listas de metas
    if (savingsGoalsList) {
        savingsGoalsList.addEventListener('click', (e) => handleGoalAction(e, savingsGoalsList));
    }
    if (featuredSavingsList) {
        featuredSavingsList.addEventListener('click', (e) => handleGoalAction(e, featuredSavingsList));
    }

    function resetGoalForm() {
        document.getElementById('goalIdField').value = '';
        document.getElementById('goalName').value = '';
        document.getElementById('goalDescription').value = '';
        document.getElementById('goalTarget').value = '';
        document.getElementById('goalCurrent').value = '0';
        document.getElementById('goalFormTitle').textContent = 'Nueva Meta';
        const colorOpts = document.querySelectorAll('.color-opt');
        colorOpts.forEach(o => o.classList.remove('ring-2', 'ring-offset-2', 'ring-indigo-500'));
        colorOpts[0].classList.add('ring-2', 'ring-offset-2', 'ring-indigo-500');
    }

    function formatCurrency(amount) {
        return '$' + amount.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    }

    function showHistory(goal) {
        const historyListEl = document.getElementById('historyList');
        const modalTitleEl = document.getElementById('historyModalTitle');
        const modalSubtitleEl = document.getElementById('historyModalSubtitle');
        const historyModalEl = document.getElementById('historyModal');

        if (!historyListEl || !modalTitleEl || !modalSubtitleEl || !historyModalEl) {
            throw new Error('Elementos del modal de historial no encontrados');
        }

        modalTitleEl.textContent = goal?.name || 'Historial de Meta';
        modalSubtitleEl.textContent = 'HISTORIAL DE ACTIVIDAD';
        historyListEl.innerHTML = '';

        const rawHistory = Array.isArray(goal?.history) ? goal.history : [];
        const history = [...rawHistory].sort((a, b) => {
            const aTime = Number.isFinite(Date.parse(a?.date)) ? Date.parse(a.date) : 0;
            const bTime = Number.isFinite(Date.parse(b?.date)) ? Date.parse(b.date) : 0;
            return bTime - aTime;
        });

        if (history.length === 0) {
            historyListEl.innerHTML = `
                <div class="text-center py-10">
                    <div class="inline-flex p-3 bg-gray-50 rounded-full text-gray-300 mb-3">
                        <svg xmlns="http://www.w3.org/2000/svg" width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="10"/><polyline points="12 6 12 12 16 14"/></svg>
                    </div>
                    <p class="text-sm text-gray-400 italic">No hay actividad registrada para esta meta.</p>
                </div>
            `;
            historyModalEl.classList.remove('hidden');
            return;
        }

        for (const entry of history) {
            const entryType = typeof entry?.type === 'string' ? entry.type : '';
            const entryDescription = typeof entry?.description === 'string' ? entry.description : 'Actividad';
            const entryDetails = typeof entry?.details === 'string' ? entry.details : '';

            const parsedTime = Date.parse(entry?.date);
            const date = Number.isFinite(parsedTime) ? new Date(parsedTime) : null;
            const formattedDate = date
                ? date.toLocaleDateString('es-ES', { day: '2-digit', month: 'short', year: 'numeric' })
                : 'Fecha no disponible';
            const formattedTime = date
                ? date.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' })
                : '';

            let icon = '';
            let iconBg = 'bg-gray-100';
            let iconColor = 'text-gray-600';

            if (entryType === 'creation') {
                icon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M12 5v14M5 12h14"/></svg>';
                iconBg = 'bg-green-100';
                iconColor = 'text-green-600';
            } else if (entryType === 'edit') {
                icon = '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>';
                iconBg = 'bg-amber-100';
                iconColor = 'text-amber-600';
            } else if (entryType === 'transaction') {
                const detailsTrimmed = entryDetails.trim();
                const isAdd = detailsTrimmed.startsWith('+') || /\+/.test(detailsTrimmed) || /aporte/i.test(entryDescription);

                icon = isAdd
                    ? '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 6 13.5 15.5 8.5 10.5 1 18"/><polyline points="17 6 23 6 23 12"/></svg>'
                    : '<svg xmlns="http://www.w3.org/2000/svg" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5" stroke-linecap="round" stroke-linejoin="round"><polyline points="23 18 13.5 8.5 8.5 13.5 1 6"/><polyline points="17 18 23 18 23 12"/></svg>';
                iconBg = isAdd ? 'bg-indigo-100' : 'bg-rose-100';
                iconColor = isAdd ? 'text-indigo-600' : 'text-rose-600';
            }

            const entryEl = document.createElement('div');
            entryEl.className = 'flex gap-4 relative';
            entryEl.innerHTML = `
                <div class="flex flex-col items-center">
                    <div class="z-10 flex items-center justify-center w-8 h-8 rounded-full ${iconBg} ${iconColor} shadow-sm border-2 border-white">
                        ${icon}
                    </div>
                    <div data-history-connector="true" class="w-0.5 h-full bg-gray-100 absolute top-8 bottom-0 -z-0"></div>
                </div>
                <div class="pb-6">
                    <div class="flex items-center gap-2 mb-0.5">
                        <span class="text-sm font-bold text-gray-800">${entryDescription}</span>
                        <span class="text-[10px] font-bold text-gray-400 bg-gray-100 px-1.5 py-0.5 rounded uppercase">${formattedDate}${formattedTime ? ` • ${formattedTime}` : ''}</span>
                    </div>
                    <p class="text-xs text-gray-500 leading-relaxed">${entryDetails || '-'}</p>
                </div>
            `;
            historyListEl.appendChild(entryEl);
        }

        const last = historyListEl.lastElementChild;
        const lastConnector = last ? last.querySelector('[data-history-connector="true"]') : null;
        if (lastConnector) lastConnector.classList.add('hidden');

        historyModalEl.classList.remove('hidden');
    }
}



if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initThemeToggle().catch(console.error);
        setupSettingsListeners().catch(console.error);
        setupDataManagement();
        initResumenModule().catch(console.error);
        initStatisticsModule().catch(console.error);
    });
} else {
    initThemeToggle().catch(console.error);
    setupSettingsListeners().catch(console.error);
    setupDataManagement();
    initResumenModule().catch(console.error);
    initStatisticsModule().catch(console.error);
}

async function getDatabaseSnapshot(force = false) {
    const now = Date.now();
    if (!force && cachedDBSnapshot && now - cachedDBSnapshotTimestamp < DB_CACHE_TTL_MS) {
        return cachedDBSnapshot;
    }

    const databases = await indexedDB.databases?.() || [];
    const targetDB = databases.find((db) => db.name === DB_NAME);
    const usageEstimate = ('storage' in navigator && 'estimate' in navigator.storage)
        ? await navigator.storage.estimate()
        : null;

    const snapshot = {
        exists: !!targetDB,
        version: targetDB?.version ?? null,
        originUsage: usageEstimate?.usage ?? null,
        originQuota: usageEstimate?.quota ?? null,
        stores: {},
        totalRecords: 0,
    };

    if (snapshot.exists) {
        const openRequest = indexedDB.open(DB_NAME, DB_VERSION);
        snapshot.stores = await new Promise((resolve, reject) => {
            openRequest.onerror = () => reject(openRequest.error);
            openRequest.onsuccess = (event) => {
                const db = event.target.result;
                const storesData = {};
                let pendingStores = db.objectStoreNames.length;

                if (!pendingStores) {
                    resolve(storesData);
                    db.close();
                    return;
                }

                Array.from(db.objectStoreNames).forEach((storeName) => {
                    const transaction = db.transaction(storeName, 'readonly');
                    const store = transaction.objectStore(storeName);
                    const getAllKeysRequest = store.getAllKeys();

                    getAllKeysRequest.onerror = () => {
                        storesData[storeName] = { count: 0 };
                        pendingStores -= 1;
                        if (!pendingStores) {
                            db.close();
                            resolve(storesData);
                        }
                    };

                    getAllKeysRequest.onsuccess = () => {
                        const keys = getAllKeysRequest.result || [];
                        storesData[storeName] = { count: keys.length };
                        snapshot.totalRecords += keys.length;
                        pendingStores -= 1;
                        if (!pendingStores) {
                            db.close();
                            resolve(storesData);
                        }
                    };
                });
            };
        });
    }

    cachedDBSnapshot = snapshot;
    cachedDBSnapshotTimestamp = now;
    return snapshot;
}

function formatBytes(bytes) {
    if (typeof bytes !== 'number' || Number.isNaN(bytes)) return 'N/D';
    if (bytes === 0) return '0 B';
    const units = ['B', 'KB', 'MB', 'GB', 'TB'];
    const exponent = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
    const value = bytes / (1024 ** exponent);
    return `${value.toFixed(value >= 10 ? 1 : 2)} ${units[exponent]}`;
}

async function refreshDataPanel(force = false) {
    if (!dataStorageMethodElement) return;
    dataStorageMethodElement.textContent = 'IndexedDB';

    try {
        const snapshot = await getDatabaseSnapshot(force);
        const usage = snapshot.originUsage;
        const quota = snapshot.originQuota;

        if (usage != null) {
            dataUsageValueElement.textContent = formatBytes(usage);
            if (usage > 0 && quota) {
                const percentage = Math.min(100, Math.round((usage / quota) * 100));
                dataUsageBarElement.style.width = `${percentage}%`;
                dataAvailableValueElement.textContent = formatBytes(quota - usage);
            } else {
                dataUsageBarElement.style.width = '0%';
                dataAvailableValueElement.textContent = quota ? formatBytes(quota) : DEFAULT_AVAILABLE_TEXT;
            }
        } else {
            dataUsageValueElement.textContent = 'N/D';
            dataUsageBarElement.style.width = '0%';
            dataAvailableValueElement.textContent = DEFAULT_AVAILABLE_TEXT;
        }

        dataRecordsCountElement.textContent = snapshot.totalRecords;
    } catch (error) {
        console.error('Error refreshing data panel:', error);
        dataUsageValueElement.textContent = 'Error';
        dataAvailableValueElement.textContent = 'Error';
        dataRecordsCountElement.textContent = '0';
        dataUsageBarElement.style.width = '0%';
    }
}

async function deleteModuleDatabase() {
    await preferencesDB.ensureReady();
    const openRequest = indexedDB.open(DB_NAME, DB_VERSION);

    const storeNames = await new Promise((resolve) => {
        openRequest.onerror = () => resolve([]);
        openRequest.onsuccess = (event) => {
            const db = event.target.result;
            const names = Array.from(db.objectStoreNames);
            db.close();
            resolve(names);
        };
    });

    await Promise.all(
        storeNames.map(async (name) => {
            const transaction = preferencesDB.db.transaction(name, 'readwrite');
            const store = transaction.objectStore(name);
            store.clear();
            return new Promise((resolve, reject) => {
                transaction.oncomplete = () => resolve();
                transaction.onerror = () => reject(transaction.error);
            });
        })
    );

    cachedDBSnapshot = null;
}

async function readAllData() {
    await preferencesDB.ensureReady();
    const data = {
        metadata: {
            exportDate: new Date().toISOString(),
            version: '1.0',
            platform: 'Finance Module'
        },
        stores: {},
        localStorage: {}
    };

    // 1. Leer IndexedDB
    const openRequest = indexedDB.open(DB_NAME, DB_VERSION);
    await new Promise((resolve, reject) => {
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = (event) => {
            const db = event.target.result;
            const storeNames = Array.from(db.objectStoreNames);
            let pending = storeNames.length;

            if (!pending) {
                db.close();
                resolve();
                return;
            }

            storeNames.forEach((name) => {
                const transaction = db.transaction(name, 'readonly');
                const store = transaction.objectStore(name);
                const getAllRequest = store.getAll();

                getAllRequest.onsuccess = () => {
                    data.stores[name] = getAllRequest.result || [];
                    pending -= 1;
                    if (!pending) {
                        db.close();
                        resolve();
                    }
                };
                getAllRequest.onerror = () => {
                    console.warn(`Error leyendo store ${name}`);
                    pending -= 1;
                    if (!pending) {
                        db.close();
                        resolve();
                    }
                };
            });
        };
    });

    // 2. Leer LocalStorage relevante (configuraciones, webhook, tema, etc.)
    const keysToExport = [
        DATA_WEBHOOK_URL_STORAGE_KEY,
        'fti-theme-preference',
        'fti-accent-preference',
        'fti-default-currency'
        // Agregar aquí otras claves de localStorage si existen
    ];

    keysToExport.forEach(key => {
        const val = localStorage.getItem(key);
        if (val !== null) {
            data.localStorage[key] = val;
        }
    });

    return data;
}

async function restoreDataFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object') {
        throw new Error('Formato de snapshot inválido');
    }

    // Soporte legacy (si el snapshot era directo de stores sin la estructura nueva)
    const storesData = snapshot.stores || snapshot; 
    
    await preferencesDB.ensureReady();
    const openRequest = indexedDB.open(DB_NAME, DB_VERSION);

    await new Promise((resolve, reject) => {
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = (event) => {
            const db = event.target.result;
            const storeNames = Array.from(db.objectStoreNames);

            const operations = storeNames.map((name) => {
                // Si no hay datos para este store en el snapshot, lo limpiamos o lo ignoramos?
                // Mejor limpiar para evitar mezclar datos viejos con restauración parcial
                const values = Array.isArray(storesData[name]) ? storesData[name] : [];
                const transaction = db.transaction(name, 'readwrite');
                const store = transaction.objectStore(name);
                store.clear(); // Limpiar antes de restaurar
                values.forEach((value) => store.put(value));

                return new Promise((innerResolve, innerReject) => {
                    transaction.oncomplete = () => innerResolve();
                    transaction.onerror = () => innerReject(transaction.error);
                });
            });

            Promise.all(operations)
                .then(() => {
                    db.close();
                    resolve();
                })
                .catch((error) => {
                    db.close();
                    reject(error);
                });
        };
    });

    // Restaurar LocalStorage
    if (snapshot.localStorage && typeof snapshot.localStorage === 'object') {
        Object.entries(snapshot.localStorage).forEach(([key, value]) => {
            localStorage.setItem(key, value);
        });
        
        // Refrescar UI basada en preferencias restauradas
        const theme = localStorage.getItem('fti-theme-preference');
        if (theme) {
            applyTheme(theme);
            markActiveButton(theme);
        }
    }
}

async function handleDeleteData() {
    if (!confirm('¿Eliminar todos los datos locales de este módulo? Esta acción no se puede deshacer.')) {
        return;
    }

    try {
        await deleteModuleDatabase();
        await refreshDataPanel(true);
        alert('Datos eliminados correctamente.');
    } catch (error) {
        console.error('Error deleting data:', error);
        alert('Ocurrió un error al eliminar los datos. Revisa la consola para más detalles.');
    }
}

function validateImportedSnapshot(snapshot) {
    // Aceptar formato nuevo (objeto con metadata/stores) O formato viejo (objeto simple de stores)
    return snapshot && typeof snapshot === 'object' && !Array.isArray(snapshot);
}

async function handleImportData(event) {
    event.preventDefault();
    if (!importDataInput) return;

    importDataInput.value = '';
    importDataInput.click();
}

async function processImportFile(file) {
    if (!file) return;
    try {
        const text = await file.text();
        const parsed = JSON.parse(text);
        if (!validateImportedSnapshot(parsed)) {
            throw new Error('Formato no válido');
        }

        await restoreDataFromSnapshot(parsed);
        cachedDBSnapshot = null;
        await refreshDataPanel(true);
        alert('Importación completada. Los datos han sido restaurados.');
    } catch (error) {
        console.error('Import error:', error);
        alert('No se pudieron importar los datos. Asegúrate de seleccionar un archivo JSON válido.');
    }
}

const DATA_WEBHOOK_URL_STORAGE_KEY = 'fti-discord-webhook-url';

async function handleExportData() {
    try {
        const webhookUrl = await preferencesDB.getItem(DATA_WEBHOOK_URL_STORAGE_KEY) || getLocalStorageFallback(DATA_WEBHOOK_URL_STORAGE_KEY);
        
        if (!webhookUrl) {
            alert('Por favor, configura la URL del Webhook de Discord en los ajustes antes de respaldar.');
            return;
        }

        const data = await readAllData();
        const payload = {
            username: 'Finance Module Backup',
            embeds: [
                {
                    title: 'Respaldo de IndexedDB',
                    description: 'Datos exportados del módulo de finanzas.',
                    color: 0x5865F2,
                    timestamp: new Date().toISOString(),
                    footer: { text: 'Gestión de Datos - IndexedDB' },
                },
            ],
            files: [
                {
                    name: 'finanzas-backup.json',
                    data: new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' }),
                },
            ],
        };

        const formData = new FormData();
        formData.append('payload_json', JSON.stringify({ username: payload.username, embeds: payload.embeds }));
        formData.append('file', payload.files[0].data, payload.files[0].name);

        const response = await fetch(webhookUrl, {
            method: 'POST',
            body: formData,
        });

        if (!response.ok) {
            throw new Error(`HTTP ${response.status}`);
        }

        alert('Datos respaldados en Discord exitosamente.');
    } catch (error) {
        console.error('Export error:', error);
        alert('No se pudo respaldar la información en Discord. Revisa la consola para más detalles.');
    }
}

async function handleDownloadData() {
    try {
        const data = await readAllData();
        const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `finanzas-backup-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    } catch (error) {
        console.error('Download error:', error);
        alert('Error al descargar el archivo de datos.');
    }
}

function setupDataManagement() {
    const downloadDataButton = document.getElementById('downloadDataButton');

    if (deleteDataButton) deleteDataButton.addEventListener('click', handleDeleteData);
    if (importDataButton) importDataButton.addEventListener('click', handleImportData);
    if (exportDataButton) exportDataButton.addEventListener('click', handleExportData);
    
    if (downloadDataButton) {
        downloadDataButton.addEventListener('click', handleDownloadData);
    }

    if (importDataInput) {
        importDataInput.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            processImportFile(file);
        });
    }

    refreshDataPanel().catch(console.error);
}

async function refreshDataPanel(force = false) {
    // Si no estamos en la página de ajustes, no hacer nada
    const dataUsageValue = document.getElementById('dataUsageValue');
    if (!dataUsageValue) return;

    // Throttle para evitar lecturas excesivas
    const now = Date.now();
    if (!force && cachedDBSnapshot && (now - cachedDBSnapshotTimestamp < DB_CACHE_TTL_MS)) {
        updateDataPanelUI(cachedDBSnapshot);
        return;
    }

    try {
        const data = await readAllData();
        // Calcular tamaño y conteo
        // data.stores tiene los datos de IDB
        // data.localStorage tiene lo de LS
        
        let totalRecords = 0;
        let totalBytes = 0;

        // Sumar IndexedDB
        if (data.stores) {
            Object.values(data.stores).forEach(storeData => {
                if (Array.isArray(storeData)) {
                    totalRecords += storeData.length;
                    // Estimación aproximada del tamaño en JSON
                    totalBytes += new Blob([JSON.stringify(storeData)]).size;
                }
            });
        }

        // Sumar LocalStorage (metadatos)
        if (data.localStorage) {
            totalRecords += Object.keys(data.localStorage).length;
            totalBytes += new Blob([JSON.stringify(data.localStorage)]).size;
        }

        const snapshot = { totalRecords, totalBytes };
        cachedDBSnapshot = snapshot;
        cachedDBSnapshotTimestamp = now;
        
        updateDataPanelUI(snapshot);
    } catch (error) {
        console.error('Error refreshing data panel:', error);
        dataUsageValue.textContent = 'Error';
    }
}

function updateDataPanelUI(snapshot) {
    const dataUsageValue = document.getElementById('dataUsageValue');
    const dataUsageBar = document.getElementById('dataUsageBar');
    const dataRecordsCount = document.getElementById('dataRecordsCount');
    const dataAvailableValue = document.getElementById('dataAvailableValue');

    if (!dataUsageValue) return;

    // Formatear bytes
    const formatBytes = (bytes) => {
        if (bytes === 0) return '0 Bytes';
        const k = 1024;
        const sizes = ['Bytes', 'KB', 'MB', 'GB'];
        const i = Math.floor(Math.log(bytes) / Math.log(k));
        return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
    };

    const usageStr = formatBytes(snapshot.totalBytes);
    dataUsageValue.textContent = usageStr;
    dataRecordsCount.textContent = snapshot.totalRecords.toLocaleString();

    // Barra de progreso (Asumiendo cuota de 50MB como referencia visual suave, aunque IDB soporta mucho más)
    // Es solo visual para que se vea "algo" lleno si hay datos.
    const visualQuota = 50 * 1024 * 1024; // 50MB
    const percentage = Math.min(100, (snapshot.totalBytes / visualQuota) * 100);
    dataUsageBar.style.width = `${percentage}%`;

    // Intentar obtener cuota real
    if (navigator.storage && navigator.storage.estimate) {
        navigator.storage.estimate().then(estimate => {
            if (estimate.quota) {
                const available = estimate.quota - estimate.usage;
                dataAvailableValue.textContent = formatBytes(available);
                // Actualizar barra con datos reales si es posible
                const realPercentage = (estimate.usage / estimate.quota) * 100;
                // Si es muy pequeño, mostrar al menos un pixel
                dataUsageBar.style.width = `${Math.max(realPercentage, percentage > 0 ? 1 : 0)}%`; 
            } else {
                dataAvailableValue.textContent = 'Amplio';
            }
        }).catch(() => {
            dataAvailableValue.textContent = 'Desconocido';
        });
    } else {
        dataAvailableValue.textContent = 'No disponible';
    }
}



// --- Módulo de Estadísticas ---
let statsSelectedMonthKey = null;
let statsPeriodMode = 'monthly';
let statsCharts = {};

function getStatsPeriodControls() {
    return {
        toggle: document.getElementById('statsPeriodToggle'),
        menu: document.getElementById('statsPeriodMenu'),
        label: document.getElementById('statsPeriodLabel'),
        selector: document.getElementById('statsPeriodSelector')
    };
}

function closeStatsPeriodMenu() {
    const { menu } = getStatsPeriodControls();
    if (menu) menu.classList.add('hidden');
}

function toggleStatsPeriodMenu() {
    const { menu } = getStatsPeriodControls();
    if (menu) menu.classList.toggle('hidden');
}

function updateStatsPeriodControls() {
    const { label, menu } = getStatsPeriodControls();
    const meta = OPERATIONS_PERIOD_META[statsPeriodMode] || OPERATIONS_PERIOD_META.monthly;
    if (label) label.textContent = meta.label;
    
    if (menu) {
        menu.querySelectorAll('[data-stats-period-mode]').forEach(btn => {
            const mode = btn.dataset.statsPeriodMode;
            const isActive = mode === statsPeriodMode;
            btn.classList.toggle('bg-gray-100', isActive);
            btn.classList.toggle('text-indigo-600', isActive);
            btn.classList.toggle('font-semibold', isActive);
        });
    }
}

function setStatsPeriodMode(mode) {
    if (!OPERATIONS_PERIOD_META[mode]) return;
    statsPeriodMode = mode;
    // Alinear el mes seleccionado al inicio del nuevo periodo
    statsSelectedMonthKey = clampMonthKeyToPeriod(statsSelectedMonthKey || getCurrentMonthKey(), statsPeriodMode);
    
    closeStatsPeriodMenu();
    updateStatsPeriodControls();
    updateStatisticsUI();
}

async function initStatisticsModule() {
    // Verificar si estamos en la página de estadísticas buscando un elemento único
    if (!document.getElementById('statsMonthBalance')) return;

    await hydrateOperationCategoriesOptions(); // Asegurar categorías cargadas

    // Inicializar mes seleccionado
    if (!statsSelectedMonthKey) {
        statsSelectedMonthKey = getCurrentMonthKey();
    }
    // Asegurar alineación con el modo por defecto
    statsSelectedMonthKey = clampMonthKeyToPeriod(statsSelectedMonthKey, statsPeriodMode);

    updateStatsPeriodControls();

    // Listeners del selector de periodo
    const { toggle, menu, selector } = getStatsPeriodControls();
    if (toggle) {
        toggle.addEventListener('click', toggleStatsPeriodMenu);
    }
    if (menu) {
        menu.addEventListener('click', (e) => {
            const btn = e.target.closest('[data-stats-period-mode]');
            if (btn) {
                setStatsPeriodMode(btn.dataset.statsPeriodMode);
            }
        });
    }
    if (selector) {
        document.addEventListener('click', (e) => {
            if (!selector.contains(e.target)) {
                closeStatsPeriodMenu();
            }
        });
    }

    // Listeners de navegación
    const prevBtn = document.getElementById('statsPrevMonthBtn');
    const nextBtn = document.getElementById('statsNextMonthBtn');
    
    if (prevBtn) {
        prevBtn.onclick = () => {
            statsSelectedMonthKey = shiftPeriodKey(statsSelectedMonthKey, statsPeriodMode, -1);
            updateStatisticsUI();
        };
    }
    
    if (nextBtn) {
        nextBtn.onclick = () => {
            const candidate = shiftPeriodKey(statsSelectedMonthKey, statsPeriodMode, 1);
            // Validar no pasar del periodo actual
            if (compareMonthKeys(candidate, getCurrentPeriodStartKey(statsPeriodMode)) > 0) return;
            statsSelectedMonthKey = candidate;
            updateStatisticsUI();
        };
    }

    // Cargar datos iniciales
    await hydrateOperationsFromStorage();
    await hydrateAccountsFromStorage(); // Necesario para el balance
    await updateStatisticsUI();
}

async function updateStatisticsUI() {
    const baseKey = statsSelectedMonthKey;
    const currentPeriodStart = getCurrentPeriodStartKey(statsPeriodMode);
    
    // Obtener ahorros para cálculos de balance
    const savingsGoals = await preferencesDB.getAllSavings();

    // Actualizar label del mes/periodo
    const labelEl = document.getElementById('statsCurrentMonthDisplay');
    if (labelEl) {
        labelEl.textContent = formatPeriodLabel(baseKey, statsPeriodMode);
    }

    // Controlar navegación futura
    const nextBtn = document.getElementById('statsNextMonthBtn');
    // Variable global al scope de la función para reutilizar
    const isAtCurrentPeriod = compareMonthKeys(baseKey, currentPeriodStart) >= 0;

    if (nextBtn) {
        nextBtn.disabled = isAtCurrentPeriod;
        if (isAtCurrentPeriod) {
            nextBtn.classList.add('opacity-30', 'cursor-not-allowed');
            nextBtn.classList.remove('hover:bg-gray-100');
        } else {
            nextBtn.classList.remove('opacity-30', 'cursor-not-allowed');
            nextBtn.classList.add('hover:bg-gray-100');
        }
    }

    // Operaciones Programadas: Manejo de visibilidad temprano
    const scheduledSection = document.getElementById('scheduledOperationsSection');
    if (scheduledSection) {
        if (isAtCurrentPeriod) {
            scheduledSection.classList.remove('hidden');
        } else {
            scheduledSection.classList.add('hidden');
        }
    }

    // Filtrar operaciones del periodo seleccionado
    const allOps = operations || [];
    const periodMonthKeys = new Set(getPeriodMonthKeys(baseKey, statsPeriodMode));
    
    const periodOps = allOps.filter(op => {
        const opMonth = op.monthKey || getMonthKeyFromDate(op.datetime);
        return periodMonthKeys.has(opMonth) && op.status === 'executed';
    });

    // Calcular Totales Generales
    const incomeOps = periodOps.filter(op => op.type === 'income');
    const expenseOps = periodOps.filter(op => op.type === 'expense');

    const totalIncome = incomeOps.reduce((acc, op) => acc + Number(op.amount), 0);
    const totalExpense = expenseOps.reduce((acc, op) => acc + Number(op.amount), 0);
    const balance = totalIncome - totalExpense;

    // Actualizar DOM Totales
    const balanceEl = document.getElementById('statsMonthBalance');
    const incomeEl = document.getElementById('statsMonthIncome');
    const expenseEl = document.getElementById('statsMonthExpense');
    
    const currencyCode = await getPreferredCurrencyCodeForBudgets();

    if (balanceEl) balanceEl.textContent = formatMoney(balance, currencyCode);
    if (incomeEl) incomeEl.textContent = formatMoney(totalIncome, currencyCode);
    if (expenseEl) expenseEl.textContent = formatMoney(totalExpense, currencyCode);

    // Operaciones Programadas (SIEMPRE del mes actual real, independiente del filtro)
    // Operaciones Programadas (Actualizar datos si es visible)
    const realCurrentMonthKey = getCurrentMonthKey();
    
    if (scheduledSection && isAtCurrentPeriod) {
        const scheduledOps = allOps.filter(op => {
            const opMonth = op.monthKey || getMonthKeyFromDate(op.datetime);
            return opMonth === realCurrentMonthKey && op.status === 'scheduled';
        });

        const scheduledIncome = scheduledOps.filter(op => op.type === 'income').reduce((acc, op) => acc + Number(op.amount), 0);
        const scheduledExpense = scheduledOps.filter(op => op.type === 'expense').reduce((acc, op) => acc + Number(op.amount), 0);
        const scheduledTransfer = scheduledOps.filter(op => op.type === 'transfer').reduce((acc, op) => acc + Number(op.amount), 0);

        const schIncomeEl = document.getElementById('statsScheduledIncome');
        const schExpenseEl = document.getElementById('statsScheduledExpense');
        const schTransferEl = document.getElementById('statsScheduledTransfer');

        if (schIncomeEl) schIncomeEl.textContent = formatMoney(scheduledIncome, currencyCode);
        if (schExpenseEl) schExpenseEl.textContent = formatMoney(scheduledExpense, currencyCode);
        if (schTransferEl) schTransferEl.textContent = formatMoney(scheduledTransfer, currencyCode);

        // --- Proyección en Estadísticas ---
        const statsForecastEl = document.getElementById('statsForecastValue');
        if (statsForecastEl) {
             const currentTotalBalance = (accounts || []).reduce((sum, acc) => {
                const b = Number(acc.balance);
                return sum + (Number.isFinite(b) ? b : 0);
            }, 0);
            
            const projected = currentTotalBalance + scheduledIncome - scheduledExpense;
            statsForecastEl.textContent = formatMoney(projected, currencyCode);
            
            // Actualizar etiqueta del contenedor padre para ser explícitos
            const parentDiv = statsForecastEl.parentElement;
            if (parentDiv) {
                const labelSpan = parentDiv.querySelector('span:first-child');
                if (labelSpan) {
                    const [cY, cM] = realCurrentMonthKey.split('-');
                    const currentMonthName = new Date(Number(cY), Number(cM) - 1, 1).toLocaleDateString('es-ES', { month: 'long' });
                    labelSpan.textContent = `Proyección Cierre de ${capitalizeLabel(currentMonthName)}`;
                }
            }
            
            statsForecastEl.classList.remove('text-amber-600', 'text-green-600', 'text-gray-800');
            if (projected < currentTotalBalance) {
                statsForecastEl.classList.add('text-amber-600');
            } else if (projected > currentTotalBalance) {
                statsForecastEl.classList.add('text-green-600');
            } else {
                statsForecastEl.classList.add('text-gray-800');
            }
        }
    }

    // Promedios
    // Calcular días efectivos en el periodo
    const meta = OPERATIONS_PERIOD_META[statsPeriodMode];
    let totalDaysInPeriod = 0;
    
    // Sumar días de cada mes en el periodo
    getPeriodMonthKeys(baseKey, statsPeriodMode).forEach(mk => {
        const [y, m] = mk.split('-').map(Number);
        totalDaysInPeriod += new Date(y, m, 0).getDate();
    });

    const isCurrentPeriod = compareMonthKeys(baseKey, currentPeriodStart) === 0;
    let effectiveDays = totalDaysInPeriod;

    if (isCurrentPeriod) {
        // Si es el periodo actual, calcular días hasta hoy desde el inicio del periodo
        const [startY, startM] = baseKey.split('-').map(Number);
        const startDate = new Date(startY, startM - 1, 1);
        const now = new Date();
        const diffTime = Math.abs(now - startDate);
        const diffDays = Math.ceil(diffTime / (1000 * 60 * 60 * 24)); 
        effectiveDays = diffDays;
    }
    
    effectiveDays = Math.max(1, effectiveDays);
    const weeksElapsed = effectiveDays / 7;

    const avgDailyIncome = totalIncome / effectiveDays;
    const avgWeeklyIncome = totalIncome / (weeksElapsed > 0 ? weeksElapsed : 1);
    const avgDailyExpense = totalExpense / effectiveDays;
    const avgWeeklyExpense = totalExpense / (weeksElapsed > 0 ? weeksElapsed : 1);

    const setContent = (id, val) => {
        const el = document.getElementById(id);
        if (el) el.textContent = formatMoney(val, currencyCode);
    };

    setContent('statsAvgDailyIncome', avgDailyIncome);
    setContent('statsAvgWeeklyIncome', avgWeeklyIncome);
    setContent('statsAvgDailyExpense', avgDailyExpense);
    setContent('statsAvgWeeklyExpense', avgWeeklyExpense);

    // --- Trend Analysis (Month-over-Month) ---
    const prevBaseKey = shiftPeriodKey(baseKey, statsPeriodMode, -1);
    const prevPeriodMonthKeys = new Set(getPeriodMonthKeys(prevBaseKey, statsPeriodMode));
    
    const prevOps = allOps.filter(op => {
        const opMonth = op.monthKey || getMonthKeyFromDate(op.datetime);
        return prevPeriodMonthKeys.has(opMonth) && op.status === 'executed';
    });

    const prevTotalIncome = prevOps.filter(op => op.type === 'income').reduce((acc, op) => acc + Number(op.amount), 0);
    const prevTotalExpense = prevOps.filter(op => op.type === 'expense').reduce((acc, op) => acc + Number(op.amount), 0);

    // Calculate Previous Period Averages
    let prevTotalDays = 0;
    getPeriodMonthKeys(prevBaseKey, statsPeriodMode).forEach(mk => {
        const [y, m] = mk.split('-').map(Number);
        prevTotalDays += new Date(y, m, 0).getDate();
    });
    
    // For previous period, we usually take full duration unless it is the future (impossible)
    const prevEffectiveDays = Math.max(1, prevTotalDays);
    const prevWeeksElapsed = prevEffectiveDays / 7;

    const prevAvgDailyIncome = prevTotalIncome / prevEffectiveDays;
    const prevAvgWeeklyIncome = prevTotalIncome / prevWeeksElapsed;
    const prevAvgDailyExpense = prevTotalExpense / prevEffectiveDays;
    const prevAvgWeeklyExpense = prevTotalExpense / prevWeeksElapsed;

    const updateTrendUI = (elementId, current, prev, isIncome, isSmall = false) => {
        const el = document.getElementById(elementId);
        if (!el) return;
        
        if (prev === 0) {
            if (isSmall) {
                el.textContent = current > 0 ? "Nuevo" : "-";
                el.className = "text-xs font-medium text-gray-300 mt-1 h-4";
            } else {
                el.textContent = current > 0 ? (isIncome ? "Primer ingreso registrado" : "Primer gasto registrado") : "Sin datos previos";
                el.className = "text-center text-xs mt-3 text-gray-400 font-medium";
            }
            return;
        }

        const diff = current - prev;
        const percentage = ((diff / prev) * 100).toFixed(1);
        const absPercent = Math.abs(percentage);
        const isPositive = diff >= 0;
        
        let icon = isPositive ? '▲' : '▼';
        let colorClass = '';

        if (isIncome) {
            // Income: Increase is Green, Decrease is Red/Amber
            colorClass = isPositive ? 'text-green-600' : 'text-red-600';
        } else {
            // Expense: Increase is Red/Amber, Decrease is Green
            colorClass = isPositive ? 'text-red-600' : 'text-green-600';
        }

        if (isSmall) {
            // Minimal version for averages
            el.innerHTML = `<span class="${colorClass}">${icon} ${absPercent}%</span> <span class="text-gray-400">vs ant.</span>`;
            el.className = "text-xs font-medium mt-1 h-4";
        } else {
            // Full version for main totals
            const prevLabel = statsPeriodMode === 'month' ? 'vs el mes pasado' : 'vs periodo anterior';
            el.innerHTML = `<span class="${colorClass} font-bold">${icon} ${absPercent}%</span> ${prevLabel}`;
        }
    };

    updateTrendUI('statsIncomeTrend', totalIncome, prevTotalIncome, true);
    updateTrendUI('statsExpenseTrend', totalExpense, prevTotalExpense, false);

    // Update Average Trends
    updateTrendUI('statsAvgDailyIncomeMoM', avgDailyIncome, prevAvgDailyIncome, true, true);
    updateTrendUI('statsAvgWeeklyIncomeMoM', avgWeeklyIncome, prevAvgWeeklyIncome, true, true);
    updateTrendUI('statsAvgDailyExpenseMoM', avgDailyExpense, prevAvgDailyExpense, false, true);
    updateTrendUI('statsAvgWeeklyExpenseMoM', avgWeeklyExpense, prevAvgWeeklyExpense, false, true);


    // Renderizar Gráficos
    renderStatisticsCharts(periodOps, baseKey, totalIncome, totalExpense, currencyCode, accounts, savingsGoals, allOps);
    
    // Renderizar Listas de Distribución
    renderDistributionList('income', incomeOps, totalIncome, currencyCode);
    renderDistributionList('expense', expenseOps, totalExpense, currencyCode);
}

function renderDistributionList(type, ops, total, currencyCode) {
    const listId = type === 'income' ? 'statsIncomeDistributionList' : 'statsExpenseDistributionList';
    const listEl = document.getElementById(listId);
    if (!listEl) return;

    // 1. Agrupar montos por ID
    const byId = {};
    ops.forEach(op => {
        const catId = op.categoryId || 'uncategorized';
        if (!byId[catId]) byId[catId] = { amount: 0, id: catId };
        byId[catId].amount += Number(op.amount);
    });

    // 2. Construir Familias (Agrupar por Categoría Padre)
    const families = {};
    
    const getMeta = (id) => {
        if (id === 'uncategorized') return { rawName: 'Sin Categoría', color: '#9ca3af', parentId: null };
        return getOperationCategoryMeta(id) || { rawName: 'Desconocido', color: '#6366f1', parentId: null };
    };

    Object.values(byId).forEach(item => {
        const meta = getMeta(item.id);
        const parentId = meta.parentId || item.id; // Si no tiene padre, es su propia familia
        
        if (!families[parentId]) {
            families[parentId] = { 
                id: parentId, 
                total: 0, 
                items: [] 
            };
        }
        families[parentId].total += item.amount;
        families[parentId].items.push({ ...item, meta });
    });

    // 3. Ordenar Familias por Total Descendente
    const sortedFamilies = Object.values(families).sort((a, b) => b.total - a.total);

    // 4. Top 3 Familias + Otros
    const topFamilies = sortedFamilies.slice(0, 3);
    const otherFamilies = sortedFamilies.slice(3);
    const othersAmount = otherFamilies.reduce((acc, f) => acc + f.total, 0);

    let html = '';
    
    // Renderizar Familias Principales
    topFamilies.forEach(family => {
        // Ordenar items dentro de la familia: Padre primero, luego subs por monto
        family.items.sort((a, b) => {
            if (a.id === family.id) return -1;
            if (b.id === family.id) return 1;
            return b.amount - a.amount;
        });

        family.items.forEach(item => {
             const percent = total > 0 ? ((item.amount / total) * 100).toFixed(1) : 0;
             const isSub = item.id !== family.id;
             let displayName = item.meta.rawName;
             let indentClass = '';
             
             if (isSub) {
                 const parentPresent = family.items.some(i => i.id === family.id);
                 if (parentPresent) {
                     // Si el padre está presente, solo indentamos
                     indentClass = 'pl-4 border-l-2 border-gray-100';
                 } else {
                     // Si el padre no está (monto 0), mostramos la ruta completa
                     const parentMeta = getMeta(family.id);
                     displayName = `${parentMeta.rawName} › ${displayName}`;
                     // Si hay múltiples hermanos huérfanos, añadimos indentación visual también
                     if (family.items.length > 1) {
                        indentClass = 'pl-4 border-l-2 border-gray-100';
                     }
                 }
             }

             html += `
                <div class="flex justify-between items-center w-full ${indentClass} mb-2">
                    <div class="flex items-center gap-2 flex-1 min-w-0 pr-2">
                        <span class="w-3 h-3 rounded-full flex-shrink-0" style="background-color: ${item.meta.color}"></span>
                        <span class="break-words leading-tight text-sm" title="${item.meta.rawName}">
                            ${displayName}
                        </span>
                    </div>
                    <span class="font-semibold flex-shrink-0 text-sm">${percent}%</span>
                </div>
            `;
        });
    });

    if (othersAmount > 0) {
         const percent = total > 0 ? ((othersAmount / total) * 100).toFixed(1) : 0;
         html += `
             <div class="flex justify-between items-center mt-3 pt-3 border-t border-gray-100">
                <div class="flex items-center gap-2">
                    <span class="w-3 h-3 rounded-full bg-gray-400"></span>
                    <span>Otros</span>
                </div>
                <span class="font-semibold">${percent}%</span>
            </div>
        `;
    }

    if (sortedFamilies.length === 0) {
        html = '<p class="text-xs text-gray-400 italic text-center">Sin datos</p>';
    }

    listEl.innerHTML = html;
}

function renderStatisticsCharts(ops, monthKey, totalIncome, totalExpense, currencyCode, accounts = [], savingsGoals = [], allOps = []) {
    // 1. Gráficos de Dona (Ingresos/Gastos) - Sin cambios, usa ops filtradas
    const prepareDoughnutData = (typeOps) => {
        // 1. Agrupar montos por ID
        const byId = {};
        typeOps.forEach(op => {
            const catId = op.categoryId || 'uncategorized';
            if (!byId[catId]) byId[catId] = { amount: 0, id: catId };
            byId[catId].amount += Number(op.amount);
        });

        // 2. Agrupar familias para ordenamiento
        const families = {};
        Object.values(byId).forEach(item => {
             const meta = item.id === 'uncategorized' ? null : getOperationCategoryMeta(item.id);
             const parentId = meta?.parentId || item.id;
             if (!families[parentId]) families[parentId] = { total: 0, id: parentId };
             families[parentId].total += item.amount;
        });

        // 3. Ordenar Items (Familias desc, luego Parent > Subs)
        const sorted = Object.values(byId).sort((a, b) => {
             const metaA = a.id === 'uncategorized' ? null : getOperationCategoryMeta(a.id);
             const metaB = b.id === 'uncategorized' ? null : getOperationCategoryMeta(b.id);
             const parentA = metaA?.parentId || a.id;
             const parentB = metaB?.parentId || b.id;
             
             if (parentA !== parentB) {
                 const totalA = families[parentA]?.total || 0;
                 const totalB = families[parentB]?.total || 0;
                 return totalB - totalA; 
             }
             
             if (a.id === parentA) return -1;
             if (b.id === parentB) return 1;
             return b.amount - a.amount;
        });
        
        const labels = [];
        const data = [];
        const colors = [];
        
        sorted.forEach(item => {
             const meta = item.id === 'uncategorized' ? { displayName: 'Sin Categoría', color: '#9ca3af' } : getOperationCategoryMeta(item.id);
             labels.push(meta?.displayName || meta?.name || 'Desconocido');
             data.push(item.amount);
             colors.push(meta?.color || '#6366f1');
        });
        
        return { labels, data, colors };
    };

    const centerTextPlugin = {
        id: 'centerText',
        beforeDraw: function(chart) {
             const { width } = chart;
             const { height } = chart;
             const { ctx } = chart;
             
             const text = chart.options.plugins.centerText?.text;
             if (!text) return;

             ctx.restore();
             const fontSize = (height / 100).toFixed(2);
             ctx.font = `bold ${fontSize}em sans-serif`;
             ctx.textBaseline = 'middle';
             ctx.textAlign = 'center';
             ctx.fillStyle = '#1f2937'; // gray-800
             
             const textX = width / 2;
             const textY = height / 2;
             
             ctx.fillText(text, textX, textY);
             ctx.save();
        }
    };

    const incomeData = prepareDoughnutData(ops.filter(o => o.type === 'income'));
    const expenseData = prepareDoughnutData(ops.filter(o => o.type === 'expense'));

    updateChart('incomeChart', 'doughnut', {
        labels: incomeData.labels,
        datasets: [{
            data: incomeData.data,
            backgroundColor: incomeData.colors,
            borderWidth: 0,
            hoverOffset: 4
        }]
    }, { 
        cutout: '70%', 
        plugins: { 
            legend: { display: false },
            centerText: { text: formatMoney(totalIncome, currencyCode) }
        } 
    }, [centerTextPlugin]);

    updateChart('expenseChart', 'doughnut', {
        labels: expenseData.labels,
        datasets: [{
            data: expenseData.data,
            backgroundColor: expenseData.colors,
            borderWidth: 0,
            hoverOffset: 4
        }]
    }, { 
        cutout: '70%', 
        plugins: { 
            legend: { display: false },
            centerText: { text: formatMoney(totalExpense, currencyCode) }
        } 
    }, [centerTextPlugin]);

    // 2. Flujo (Mensual: Semanas; Trim/Anual: Meses)
    let flowLabels = [];
    let incomeFlow = [];
    let expenseFlow = [];

    if (statsPeriodMode === 'monthly') {
        flowLabels = ['Semana 1', 'Semana 2', 'Semana 3', 'Semana 4'];
        incomeFlow = [0, 0, 0, 0];
        expenseFlow = [0, 0, 0, 0];
        
        ops.forEach(op => {
            const date = new Date(op.datetime);
            const day = date.getDate();
            let weekIdx = Math.floor((day - 1) / 7);
            if (weekIdx > 3) weekIdx = 3; 
            
            if (op.type === 'income') incomeFlow[weekIdx] += Number(op.amount);
            if (op.type === 'expense') expenseFlow[weekIdx] += Number(op.amount);
        });
    } else {
        // Agrupar por meses del periodo
        const monthKeys = getPeriodMonthKeys(monthKey, statsPeriodMode);
        const monthMap = new Map(); // key -> index
        
        monthKeys.forEach((k, i) => {
            const [y, m] = k.split('-');
            const date = new Date(y, m - 1, 1);
            const label = capitalizeLabel(date.toLocaleDateString('es-ES', { month: 'short' }));
            flowLabels.push(label);
            monthMap.set(k, i);
            incomeFlow.push(0);
            expenseFlow.push(0);
        });

        ops.forEach(op => {
            const mKey = op.monthKey || getMonthKeyFromDate(op.datetime);
            const idx = monthMap.get(mKey);
            if (idx !== undefined) {
                if (op.type === 'income') incomeFlow[idx] += Number(op.amount);
                if (op.type === 'expense') expenseFlow[idx] += Number(op.amount);
            }
        });
    }

    updateChart('monthlyFlowChart', 'bar', {
        labels: flowLabels,
        datasets: [
            {
                label: 'Ingresos',
                data: incomeFlow,
                backgroundColor: 'rgba(34, 197, 94, 0.8)',
                borderRadius: 4
            },
            {
                label: 'Gastos',
                data: expenseFlow,
                backgroundColor: 'rgba(239, 68, 68, 0.8)',
                borderRadius: 4
            }
        ]
    }, {
        scales: { y: { beginAtZero: true, grid: { display: false } }, x: { grid: { display: false } } },
        plugins: { legend: { position: 'bottom' } }
    });

    // 3. Evolución Balance (Diaria para todo el periodo)
    // Definir rango de fechas
    const monthKeys = getPeriodMonthKeys(monthKey, statsPeriodMode);
    const startKey = monthKeys[0];
    const endKey = monthKeys[monthKeys.length - 1];
    
    const [startYear, startMonth] = startKey.split('-').map(Number);
    const startDate = new Date(startYear, startMonth - 1, 1);
    
    const [endYear, endMonth] = endKey.split('-').map(Number);
    const endDate = new Date(endYear, endMonth, 0, 23, 59, 59, 999); // Fin del último mes

    const totalDays = Math.ceil((endDate - startDate) / (1000 * 60 * 60 * 24));
    
    // Generar etiquetas de días (si son muchos, Chart.js los maneja, pero podríamos simplificar etiquetas)
    // Para simplificar, generamos un array de fechas para el eje X
    const timelineDates = [];
    for (let d = new Date(startDate); d <= endDate; d.setDate(d.getDate() + 1)) {
        timelineDates.push(new Date(d));
    }
    const daysLabels = timelineDates.map(d => d.getDate()); // Solo el número del día, el tooltip dará detalle

    // --- Algoritmo de Reconstrucción ---
    // 1. Estado actual (HOY)
    let currentLiquid = accounts.reduce((sum, acc) => sum + Number(acc.balance || 0), 0);
    let currentSavings = savingsGoals.reduce((sum, goal) => sum + Number(goal.current || 0), 0);

    // 2. Historial de eventos
    let historyEvents = [];
    allOps.forEach(op => {
        if (op.status !== 'executed') return;
        historyEvents.push({
            date: new Date(op.datetime).getTime(),
            type: 'operation',
            opType: op.type,
            amount: Number(op.amount)
        });
    });

    accounts.forEach(acc => {
        if (Array.isArray(acc.history)) {
            acc.history.forEach(h => {
                // EVITAR DOBLE CONTEO: Las operaciones (ingresos, gastos, transferencias) ya están en allOps.
                // Solo procesamos eventos de historia que NO sean operaciones estándar.
                if (['deposit', 'expense', 'transfer'].includes(h.type)) return;

                const amountMatch = (h.details || '').match(/([+-])\s*\$?\s*([\d,]+(\.\d+)?)/);
                if (amountMatch) {
                    const sign = amountMatch[1];
                    const val = Number(amountMatch[2].replace(/,/g, ''));
                    if (!isNaN(val)) {
                        historyEvents.push({
                            date: new Date(h.date).getTime(),
                            type: h.type === 'initial' ? 'initial' : (h.type === 'deleted' ? 'deleted' : 'account_history'),
                            historyType: h.type, 
                            desc: h.description || '',
                            details: h.details,
                            amount: sign === '+' ? val : -val
                        });
                    }
                } else if (h.type === 'initial' && h.details) {
                    const val = Number(h.details.replace(/[^0-9.]/g, ''));
                     if (!isNaN(val)) {
                        historyEvents.push({
                            date: new Date(h.date).getTime(),
                            type: 'initial',
                            historyType: 'initial',
                            desc: h.description || '',
                            amount: val
                        });
                    }
                } else if (h.type === 'deleted' && h.details) {
                     historyEvents.push({
                         date: new Date(h.date).getTime(),
                         type: 'deleted',
                         historyType: 'deleted',
                         desc: h.description || '',
                         details: h.details,
                         amount: 0 
                     });
                }
            });
        }
    });

    historyEvents.sort((a, b) => b.date - a.date);

    const revertEvent = (evt) => {
        if (evt.type === 'operation') {
            if (evt.opType === 'income') currentLiquid -= evt.amount;
            if (evt.opType === 'expense') currentLiquid += evt.amount;
        } else if (evt.type === 'account_history') {
            currentLiquid -= evt.amount; 
            const isSavingsTransfer = evt.desc.toLowerCase().includes('meta de ahorro');
            if (isSavingsTransfer) {
                if (evt.amount < 0) currentSavings -= Math.abs(evt.amount);
                else currentSavings += Math.abs(evt.amount);
            }
        } else if (evt.type === 'initial') {
             currentLiquid -= evt.amount;
        } else if (evt.type === 'deleted') {
            const finalBalanceMatch = (evt.details || '').match(/Saldo final.*:\s*\$?([\d,]+(\.\d+)?)/);
            if (finalBalanceMatch) {
                 const val = Number(finalBalanceMatch[1].replace(/,/g, ''));
                 if (!isNaN(val)) currentLiquid += val;
            }
        }
    };

    // Rebobinar hasta el final del periodo seleccionado
    const endTime = endDate.getTime();
    let eventIdx = 0;
    while (eventIdx < historyEvents.length && historyEvents[eventIdx].date > endTime) {
        revertEvent(historyEvents[eventIdx]);
        eventIdx++;
    }

    // Llenar arrays día a día hacia atrás
    const dailyLiquid = new Array(timelineDates.length).fill(0);
    const dailySavings = new Array(timelineDates.length).fill(0);
    
    // Iteramos timelineDates de atrás hacia adelante (índices altos son fechas más recientes)
    for (let i = timelineDates.length - 1; i >= 0; i--) {
        const currentDateObj = timelineDates[i];
        
        // Guardar estado al FINAL de este día
        dailyLiquid[i] = currentLiquid;
        dailySavings[i] = currentSavings;

        // Inicio de este día
        const startOfDay = new Date(currentDateObj);
        startOfDay.setHours(0, 0, 0, 0);
        const startOfDayTime = startOfDay.getTime();

        // Revertir eventos de este día
        while (eventIdx < historyEvents.length && historyEvents[eventIdx].date >= startOfDayTime) {
            revertEvent(historyEvents[eventIdx]);
            eventIdx++;
        }
    }

    // Optimización visual para periodos largos:
    // Si statsPeriodMode es annual, mostrar labels solo de meses o cada X días
    // Chart.js lo hace auto si no pasamos labels explícitos, pero aquí pasamos daysLabels.
    // Pasaremos fechas formateadas en labels para que Chart.js las maneje si es necesario, o índices.
    // Usaremos los índices para data, y configuraremos tooltip para mostrar fecha.
    
    updateChart('balanceEvolutionChart', 'line', {
        labels: daysLabels, // 1..31 repetido, no ideal. Mejor string fecha corta.
        // Mejor usamos indices y el tooltip formatea.
        // O labels vacíos y tooltip usa timelineDates[index]
        datasets: [
            {
                label: 'Balance Disponible',
                data: dailyLiquid,
                borderColor: '#4F46E5',
                backgroundColor: 'rgba(79, 70, 229, 0.1)',
                borderWidth: 2,
                pointRadius: statsPeriodMode === 'annual' ? 0 : 0, // Sin puntos para anual
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4
            },
            {
                label: 'Ahorro Acumulado',
                data: dailySavings,
                borderColor: '#059669',
                backgroundColor: 'rgba(5, 150, 105, 0.1)',
                borderWidth: 2,
                pointRadius: statsPeriodMode === 'annual' ? 0 : 0,
                pointHoverRadius: 6,
                fill: true,
                tension: 0.4
            }
        ]
    }, {
        interaction: {
            mode: 'index',
            intersect: false,
        },
        scales: { 
            x: { 
                grid: { display: false },
                ticks: {
                    // Mostrar menos etiquetas si es anual
                    callback: function(val, index) {
                        const date = timelineDates[index];
                        if (!date) return '';
                        // Mostrar 1er día de cada mes
                        if (date.getDate() === 1) {
                            return date.toLocaleDateString('es-ES', { month: 'short' });
                        }
                        return ''; // Ocultar otros
                    },
                    autoSkip: false, // Control manual
                    maxRotation: 0
                }
            }, 
            y: { 
                display: true, 
                stacked: true,
                ticks: {
                    callback: function(value) {
                        return formatMoney(value, currencyCode, false);
                    }
                }
            } 
        },
        plugins: { 
            legend: { display: true, position: 'bottom' },
            tooltip: {
                enabled: true,
                mode: 'index',
                intersect: false,
                backgroundColor: 'rgba(255, 255, 255, 0.95)',
                titleColor: '#111827',
                bodyColor: '#374151',
                borderColor: '#e5e7eb',
                borderWidth: 1,
                padding: 10,
                titleFont: { size: 14, weight: 'bold' },
                callbacks: {
                    title: (context) => {
                        const index = context[0].dataIndex;
                        const date = timelineDates[index];
                        if (date) {
                            return date.toLocaleDateString('es-MX', { weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' });
                        }
                        return '';
                    },
                    label: (context) => {
                        return `${context.dataset.label}: ${formatMoney(context.parsed.y, currencyCode)}`;
                    },
                    footer: (tooltipItems) => {
                        const total = tooltipItems.reduce((acc, item) => acc + item.parsed.y, 0);
                        return `Patrimonio Total: ${formatMoney(total, currencyCode)}`;
                    }
                }
            }
        }
    });
}

function updateChart(canvasId, type, data, options, plugins = []) {
    const ctx = document.getElementById(canvasId)?.getContext('2d');
    if (!ctx) return;

    if (statsCharts[canvasId]) {
        statsCharts[canvasId].destroy();
    }

    statsCharts[canvasId] = new Chart(ctx, {
        type: type,
        data: data,
        plugins: plugins,
        options: {
            responsive: true,
            maintainAspectRatio: false,
            ...options
        }
    });
}

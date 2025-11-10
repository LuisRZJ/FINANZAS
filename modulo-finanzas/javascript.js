// --- Gestión de Categorías (modal, CRUD, renderizado, subcategorías) ---
const CATEGORIES_STORAGE_KEY = 'fti-categories';

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

const DEFAULT_ACCOUNTS = [
    {
        id: 'acc_primary_main',
        groupId: 'primary',
        name: 'Cuenta Principal',
        institution: 'Banco XYZ',
        balance: 1250.75,
        color: '#2563eb',
        iconId: 'bank',
        order: 0
    },
    {
        id: 'acc_primary_cash',
        groupId: 'primary',
        name: 'Efectivo',
        institution: 'Billetera',
        balance: 115.5,
        color: '#f59e0b',
        iconId: 'wallet',
        order: 1
    },
    {
        id: 'acc_savings_goal',
        groupId: 'savings',
        name: 'Meta de Ahorro',
        institution: 'Viaje a la playa',
        balance: 5820,
        color: '#059669',
        iconId: 'target',
        order: 0
    },
    {
        id: 'acc_savings_crypto',
        groupId: 'savings',
        name: 'Criptomonedas',
        institution: 'Portfolio de Inversión',
        balance: 2500,
        color: '#8b5cf6',
        iconId: 'spark',
        order: 1
    },
    {
        id: 'acc_debt_loan',
        groupId: 'debts',
        name: 'Préstamo Personal',
        institution: 'Financiera Z',
        balance: -1200,
        color: '#f97316',
        iconId: 'loan',
        order: 0
    },
    {
        id: 'acc_debt_card',
        groupId: 'debts',
        name: 'Tarjeta de Crédito',
        institution: 'Banco ABC',
        balance: -310.2,
        color: '#ef4444',
        iconId: 'credit-card',
        order: 1
    }
];

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

const accountCurrencyLocaleMap = {
    MXN: 'es-MX',
    USD: 'en-US',
    EUR: 'es-ES',
    JPY: 'ja-JP'
};

function getAccountCategoryById(categoryId) {
    return accountCategories.find(cat => cat.id === categoryId) || null;
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

    if (!accountCategoriesReorderMode) {
        // Ordenar por balance total descendente (excluyendo fallback al final)
        const totalsByCategory = calculateAccountTotalsByCategory();
        list.sort((a, b) => {
            if (a.id === FALLBACK_ACCOUNT_CATEGORY_ID) return 1;
            if (b.id === FALLBACK_ACCOUNT_CATEGORY_ID) return -1;
            const totalA = totalsByCategory.get(a.id)?.total ?? 0;
            const totalB = totalsByCategory.get(b.id)?.total ?? 0;
            if (totalA !== totalB) {
                return totalB - totalA;
            }
            if (totalA === totalB) {
                return (a.order ?? 0) - (b.order ?? 0);
            }
        });
        return list;
    }

    return list.sort((a, b) => (a.order ?? 0) - (b.order ?? 0));
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
        const positiveAccounts = accounts.filter(acc => acc.balance > 0).sort((a, b) => b.balance - a.balance);
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
                accounts = parsed.map(acc => ({ ...acc }));
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
        if (!accountsInGroup.length && !accountCategoriesReorderMode && category.id !== FALLBACK_ACCOUNT_CATEGORY_ID) {
            return;
        }

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
                        <div class="account-menu hidden absolute right-0 mt-2 w-40 bg-white border border-gray-200 rounded-lg shadow-lg py-1 z-10">
                            <button class="account-menu-edit flex items-center gap-2 w-full px-4 py-2 text-sm text-gray-700 hover:bg-gray-100" data-id="${account.id}">
                                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25z"></path><path d="M14.06 4.94l3.75 3.75"></path></svg>
                                Editar cuenta
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

    document.querySelectorAll('.account-menu-delete').forEach(btn => {
        btn.addEventListener('click', () => {
            const id = btn.dataset.id;
            closeActiveMenus();
            deleteAccount(id);
        });
    });
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
    const accountToDelete = accounts.find(acc => acc.id === accountId);
    if (!confirm('¿Eliminar esta cuenta?')) return;
    accounts = accounts.filter(acc => acc.id !== accountId);
    if (accountToDelete) {
        reindexGroupOrders(accountToDelete.groupId);
    }
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

    if (editingAccountId) {
        const index = accounts.findIndex(acc => acc.id === editingAccountId);
        if (index !== -1) {
            const existing = accounts[index];
            const previousGroupId = existing.groupId;
            accounts[index] = { ...existing, ...accountData };
            if (accountData.groupId !== previousGroupId) {
                accounts[index].order = accounts.filter(acc => acc.groupId === accountData.groupId && acc.id !== accounts[index].id).length;
                reindexGroupOrders(previousGroupId);
            }
            reindexGroupOrders(accounts[index].groupId);
        }
    } else {
        const newAccount = {
            ...accountData,
            id: generateAccountId(),
            order: accounts.filter(acc => acc.groupId === groupId).length
        };
        accounts.push(newAccount);
        reindexGroupOrders(groupId);
    }

    await saveAccountsToStorage();
    closeAccountModal();
    renderAccountsUI();
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

function resetCategoryForm() {
    document.getElementById('categoryForm').reset();
    document.getElementById('categoryColor').value = '#2563eb';
    document.getElementById('parentCategory').value = '';
    editingCategoryId = null;
    document.getElementById('categoryFormTitle').textContent = 'Agregar Nueva Categoría';
    document.getElementById('cancelEditCategory').classList.add('hidden');
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
                                            ${cat.icon ? `<i class="${cat.icon} text-white text-lg"></i>` : ''}
                                        </span>
                                        <span class="font-semibold text-gray-800 text-base">${cat.name}</span>
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
                                                            ${sub.icon ? `<i class="${sub.icon} text-gray-400 text-xs"></i>` : ''}
                                                        </div>
                                                        <span class="text-gray-600 text-sm">${sub.name}</span>
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
    document.getElementById('cancelEditCategory').classList.remove('hidden');
    renderCategories(); // Para actualizar el select de parent
}

function generateId() {
    return 'cat_' + Math.random().toString(36).substr(2, 9);
}

async function deleteCategory(id) {
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
    // Cancelar edición
    const cancelBtn = document.getElementById('cancelEditCategory');
    if (cancelBtn) {
        cancelBtn.addEventListener('click', resetCategoryForm);
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
            resetCategoryForm();
        });
    }

    initAccountsModule().catch(console.error);
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
}
const THEME_STORAGE_KEY = 'fti-theme-preference';
const ACCENT_STORAGE_KEY = 'fti-accent-preference';
const DEFAULT_CURRENCY_KEY = 'fti-default-currency';
const SECONDARY_CURRENCY_KEY = 'fti-secondary-currency';
const DB_NAME = 'IndexedDB-Finanzas';
const DB_VERSION = 1;
const STORE_NAME = 'user-preferences';
const DATA_WEBHOOK_URL = 'https://discord.com/api/webhooks/1427864454753812662/Jvb_ecz6gH286QhpOlM7nLEBsPU43O_GH7LnHcbikur8oU5rpjzbZpeWQLTbEJDXyv_c';
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
                
                // Create object store for user preferences
                if (!db.objectStoreNames.contains(STORE_NAME)) {
                    const store = db.createObjectStore(STORE_NAME, { keyPath: 'key' });
                    store.createIndex('key', 'key', { unique: true });
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

        const defaultSelect = document.getElementById('defaultCurrencySelect');
        const secondarySelect = document.getElementById('secondaryCurrencySelect');

        if (defaultSelect && defaultCurrency) {
            // ensure option with value exists before setting
            const opt = Array.from(defaultSelect.options).find(o => o.value === defaultCurrency);
            if (opt) defaultSelect.value = defaultCurrency;
        }

        if (secondarySelect && secondaryCurrency) {
            const opt2 = Array.from(secondarySelect.options).find(o => o.value === secondaryCurrency);
            if (opt2) secondarySelect.value = secondaryCurrency;
        }
    } catch (err) {
        console.error('Error hydrating currency preferences:', err);
    }
}

async function handleCurrencyChange(event) {
    const select = event.currentTarget;
    if (!select || !select.dataset) return;

    const prefKey = select.id === 'defaultCurrencySelect' ? DEFAULT_CURRENCY_KEY :
                    select.id === 'secondaryCurrencySelect' ? SECONDARY_CURRENCY_KEY : null;

    if (!prefKey) return;

    const value = select.value;
    try {
        await preferencesDB.setItem(prefKey, value);
    } catch (err) {
        console.error('Error saving currency preference', err);
        // fallback to localStorage
        try { localStorage.setItem(prefKey, value); } catch (e) { /* ignore */ }
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

    // Attach currency selects listeners and hydrate
    try {
        const defaultSelect = document.getElementById('defaultCurrencySelect');
        const secondarySelect = document.getElementById('secondaryCurrencySelect');

        if (defaultSelect) defaultSelect.addEventListener('change', handleCurrencyChange);
        if (secondarySelect) secondarySelect.addEventListener('change', handleCurrencyChange);

        await hydrateCurrencyPreferences();
    } catch (err) {
        console.error('Error initializing currency preferences:', err);
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initThemeToggle().catch(console.error);
    });
} else {
    initThemeToggle().catch(console.error);
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
    const data = {};
    const openRequest = indexedDB.open(DB_NAME, DB_VERSION);

    return new Promise((resolve, reject) => {
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = (event) => {
            const db = event.target.result;
            const storeNames = Array.from(db.objectStoreNames);
            let pending = storeNames.length;

            if (!pending) {
                resolve(data);
                db.close();
                return;
            }

            storeNames.forEach((name) => {
                const transaction = db.transaction(name, 'readonly');
                const store = transaction.objectStore(name);
                const getAllRequest = store.getAll();

                getAllRequest.onerror = () => {
                    data[name] = [];
                    pending -= 1;
                    if (!pending) {
                        db.close();
                        resolve(data);
                    }
                };

                getAllRequest.onsuccess = () => {
                    data[name] = getAllRequest.result || [];
                    pending -= 1;
                    if (!pending) {
                        db.close();
                        resolve(data);
                    }
                };
            });
        };
    });
}

async function restoreDataFromSnapshot(snapshot) {
    if (!snapshot || typeof snapshot !== 'object' || Array.isArray(snapshot)) {
        throw new Error('Formato de snapshot inválido');
    }

    await preferencesDB.ensureReady();
    const openRequest = indexedDB.open(DB_NAME, DB_VERSION);

    return new Promise((resolve, reject) => {
        openRequest.onerror = () => reject(openRequest.error);
        openRequest.onsuccess = (event) => {
            const db = event.target.result;
            const storeNames = Array.from(db.objectStoreNames);

            const operations = storeNames.map((name) => {
                const values = Array.isArray(snapshot[name]) ? snapshot[name] : [];
                const transaction = db.transaction(name, 'readwrite');
                const store = transaction.objectStore(name);
                store.clear();
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

async function handleExportData() {
    try {
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

        const response = await fetch(DATA_WEBHOOK_URL, {
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

function setupDataManagement() {
    if (!deleteDataButton || !importDataButton || !exportDataButton) return;

    deleteDataButton.addEventListener('click', handleDeleteData);
    importDataButton.addEventListener('click', handleImportData);
    exportDataButton.addEventListener('click', handleExportData);

    if (importDataInput) {
        importDataInput.addEventListener('change', (event) => {
            const file = event.target.files?.[0];
            processImportFile(file);
        });
    }

    refreshDataPanel().catch(console.error);
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', setupDataManagement);
} else {
    setupDataManagement();
}

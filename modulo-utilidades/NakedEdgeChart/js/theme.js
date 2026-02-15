const NECTheme = {
    STORAGE_KEY: 'nec_theme_preference',
    ACCENT_STORAGE_KEY: 'nec_accent_preference',
    THEMES: {
        LIGHT: 'light',
        DARK: 'dark',
        SYSTEM: 'system'
    },
    ACCENTS: {
        ORANGE: {
            id: 'orange',
            name: 'Naranja',
            color: '#f97316',
            hover: '#fb923c',
            darker: '#c2410c', // orange-700
            shadow: 'rgba(249, 115, 22, 0.3)',
            soft: 'rgba(249, 115, 22, 0.12)',
            tw_active_bg: 'bg-orange-50', // Fallback/Helper if needed
            tw_dark_active_bg: 'dark:bg-orange-900/20'
        },
        BLUE: {
            id: 'blue',
            name: 'Azul',
            color: '#3b82f6',
            hover: '#60a5fa',
            darker: '#1d4ed8', // blue-700
            shadow: 'rgba(59, 130, 246, 0.3)',
            soft: 'rgba(59, 130, 246, 0.12)',
            tw_active_bg: 'bg-blue-50',
            tw_dark_active_bg: 'dark:bg-blue-900/20'
        },
        GREEN: {
            id: 'green',
            name: 'Verde',
            color: '#22c55e',
            hover: '#4ade80',
            darker: '#15803d', // green-700
            shadow: 'rgba(34, 197, 94, 0.3)',
            soft: 'rgba(34, 197, 94, 0.12)',
            tw_active_bg: 'bg-green-50',
            tw_dark_active_bg: 'dark:bg-green-900/20'
        },
        PURPLE: {
            id: 'purple',
            name: 'Morado',
            color: '#a855f7',
            hover: '#c084fc',
            darker: '#7e22ce', // purple-700
            shadow: 'rgba(168, 85, 247, 0.3)',
            soft: 'rgba(168, 85, 247, 0.12)',
            tw_active_bg: 'bg-purple-50',
            tw_dark_active_bg: 'dark:bg-purple-900/20'
        },
        RED: {
            id: 'red',
            name: 'Rojo',
            color: '#ef4444',
            hover: '#f87171',
            darker: '#b91c1c', // red-700
            shadow: 'rgba(239, 68, 68, 0.3)',
            soft: 'rgba(239, 68, 68, 0.12)',
            tw_active_bg: 'bg-red-50',
            tw_dark_active_bg: 'dark:bg-red-900/20'
        },
        CYAN: {
            id: 'cyan',
            name: 'Cian',
            color: '#06b6d4',
            hover: '#22d3ee',
            darker: '#0e7490', // cyan-700
            shadow: 'rgba(6, 182, 212, 0.3)',
            soft: 'rgba(6, 182, 212, 0.12)',
            tw_active_bg: 'bg-cyan-50',
            tw_dark_active_bg: 'dark:bg-cyan-900/20'
        }
    },
    init() {
        this.applyTheme(this.getStoredTheme());
        this.applyAccent(this.getStoredAccent());
        
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (this.getStoredTheme() === this.THEMES.SYSTEM) {
                this.applyVisualTheme(e.matches ? this.THEMES.DARK : this.THEMES.LIGHT);
            }
        });
    },
    getStoredTheme() {
        return localStorage.getItem(this.STORAGE_KEY) || this.THEMES.SYSTEM;
    },
    getStoredAccent() {
        return localStorage.getItem(this.ACCENT_STORAGE_KEY) || 'orange';
    },
    setTheme(theme) {
        localStorage.setItem(this.STORAGE_KEY, theme);
        this.applyTheme(theme);
    },
    setAccent(accentId) {
        localStorage.setItem(this.ACCENT_STORAGE_KEY, accentId);
        this.applyAccent(accentId);
    },
    applyTheme(theme) {
        let visualTheme = theme;
        if (theme === this.THEMES.SYSTEM) {
            const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            visualTheme = systemDark ? this.THEMES.DARK : this.THEMES.LIGHT;
        }
        this.applyVisualTheme(visualTheme);
        this.updateUI(theme);
    },
    applyVisualTheme(visualTheme) {
        document.documentElement.classList.toggle('dark', visualTheme === this.THEMES.DARK);
    },
    applyAccent(accentId) {
        const accent = Object.values(this.ACCENTS).find(a => a.id === accentId) || this.ACCENTS.ORANGE;
        const root = document.documentElement;
        
        root.style.setProperty('--accent-color', accent.color);
        root.style.setProperty('--accent-color-hover', accent.hover);
        root.style.setProperty('--accent-color-darker', accent.darker);
        root.style.setProperty('--accent-color-shadow', accent.shadow);
        root.style.setProperty('--accent-color-soft', accent.soft);
        
        this.updateUIAccent(accentId);
        // Re-update theme UI to apply new accent colors if needed
        this.updateUI(this.getStoredTheme());
    },
    updateUI(activeTheme) {
        const buttons = document.querySelectorAll('[data-theme-option]');
        // Get current accent for specific background classes if we want to use them
        // Although using tailwind config with CSS variables is better, we might need specific utility classes for bg opacity
        // We will use the generic 'accent' classes defined in tailwind config for most things
        
        buttons.forEach((btn) => {
            const themeValue = btn.getAttribute('data-theme-option');
            const isActive = themeValue === activeTheme;
            
            // Remove old specific color classes to be safe
            // We'll rely on our new 'border-accent' and 'text-accent' classes
            
            if (isActive) {
                // Estilo Activo: Borde accent, fondo accent suave
                // Note: We use style directly for bg because dynamic tailwind classes for bg-opacity with variables are tricky without plugin
                // Or we can use the specific TW classes from our ACCENTS object
                const accentId = this.getStoredAccent();
                const accent = Object.values(this.ACCENTS).find(a => a.id === accentId) || this.ACCENTS.ORANGE;

                btn.className = `theme-option group relative flex flex-col items-center justify-center p-3 rounded-xl border transition-all duration-200 shadow-sm ${accent.tw_active_bg} ${accent.tw_dark_active_bg}`;
                
                // Add border color via style or class if configured
                btn.style.borderColor = 'var(--accent-color)';
                
                // Icono y texto interno
                const icon = btn.querySelector('.theme-icon');
                if(icon) {
                    icon.style.color = 'var(--accent-color)';
                }
                
            } else {
                // Estilo Inactivo
                btn.className = 'theme-option group relative flex flex-col items-center justify-center p-3 rounded-xl border border-slate-200 dark:border-slate-700 transition-all duration-200 hover:shadow-md bg-white dark:bg-slate-800/40';
                
                // Remove inline styles
                btn.style.borderColor = '';
                const icon = btn.querySelector('.theme-icon');
                if(icon) {
                    icon.style.color = '';
                }
            }
        });
    },
    updateUIAccent(activeAccentId) {
        const buttons = document.querySelectorAll('[data-accent-option]');
        buttons.forEach((btn) => {
            const value = btn.getAttribute('data-accent-option');
            const isActive = value === activeAccentId;
            
            if (isActive) {
                btn.classList.add('ring-2', 'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-slate-900');
                btn.style.setProperty('--tw-ring-color', 'var(--accent-color)');
                btn.classList.remove('scale-100', 'opacity-80');
                btn.classList.add('scale-110', 'opacity-100');
            } else {
                btn.classList.remove('ring-2', 'ring-offset-2', 'ring-offset-white', 'dark:ring-offset-slate-900', 'scale-110', 'opacity-100');
                btn.style.removeProperty('--tw-ring-color');
                btn.classList.add('scale-100', 'opacity-80', 'hover:opacity-100', 'hover:scale-105');
            }
        });
    }
};

NECTheme.init();
window.NECTheme = NECTheme;
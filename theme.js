/**
 * Sistema de gestión de temas (Claro/Oscuro/Sistema)
 * Se encarga de aplicar el tema seleccionado y persistir la preferencia.
 */

const ThemeManager = {
    // Clave para localStorage
    STORAGE_KEY: 'fti_theme_preference',

    // Opciones disponibles
    THEMES: {
        LIGHT: 'light',
        DARK: 'dark',
        SYSTEM: 'system'
    },

    // Inicializar el gestor de temas
    init() {
        this.applyTheme(this.getStoredTheme());
        
        // Escuchar cambios en la preferencia del sistema
        window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', (e) => {
            if (this.getStoredTheme() === this.THEMES.SYSTEM) {
                this.applyVisualTheme(e.matches ? this.THEMES.DARK : this.THEMES.LIGHT);
            }
        });
    },

    // Obtener el tema guardado o por defecto 'system'
    getStoredTheme() {
        return localStorage.getItem(this.STORAGE_KEY) || this.THEMES.SYSTEM;
    },

    // Guardar el tema seleccionado
    setTheme(theme) {
        localStorage.setItem(this.STORAGE_KEY, theme);
        this.applyTheme(theme);
    },

    // Aplicar la lógica del tema (decidir si es dark o light)
    applyTheme(theme) {
        let visualTheme = theme;

        if (theme === this.THEMES.SYSTEM) {
            const systemDark = window.matchMedia('(prefers-color-scheme: dark)').matches;
            visualTheme = systemDark ? this.THEMES.DARK : this.THEMES.LIGHT;
        }

        this.applyVisualTheme(visualTheme);
        this.updateUI(theme);
    },

    // Aplicar cambios visuales al DOM (clase 'dark')
    applyVisualTheme(visualTheme) {
        const html = document.documentElement;
        
        if (visualTheme === this.THEMES.DARK) {
            html.classList.add('dark');
        } else {
            html.classList.remove('dark');
        }
    },

    // Actualizar selectores en la UI si existen
    updateUI(activeTheme) {
        // Buscar botones de selección de tema y actualizar estado activo
        const buttons = document.querySelectorAll('[data-theme-value]');
        buttons.forEach(btn => {
            const themeValue = btn.getAttribute('data-theme-value');
            if (themeValue === activeTheme) {
                btn.classList.add('ring-2', 'ring-blue-500', 'bg-blue-50', 'dark:bg-blue-900/30');
                btn.classList.remove('hover:bg-gray-50', 'dark:hover:bg-gray-700');
                // Icono activo
                const icon = btn.querySelector('i');
                if(icon) icon.classList.add('text-blue-600', 'dark:text-blue-400');
            } else {
                btn.classList.remove('ring-2', 'ring-blue-500', 'bg-blue-50', 'dark:bg-blue-900/30');
                btn.classList.add('hover:bg-gray-50', 'dark:hover:bg-gray-700');
                // Icono inactivo
                const icon = btn.querySelector('i');
                if(icon) icon.classList.remove('text-blue-600', 'dark:text-blue-400');
            }
        });
    }
};

// Inicializar inmediatamente para evitar flash
ThemeManager.init();

// Exponer globalmente
window.ThemeManager = ThemeManager;

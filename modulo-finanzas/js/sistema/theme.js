;(() => {
  const STORAGE_KEY = 'gtr-theme'
  function getPreferredTheme() {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === 'dark' || saved === 'light') return saved
    return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
  }
  function applyTheme(theme) {
    const root = document.documentElement
    if (theme === 'dark') root.classList.add('dark')
    else root.classList.remove('dark')
    localStorage.setItem(STORAGE_KEY, theme)
  }
  function toggleTheme() {
    const next = document.documentElement.classList.contains('dark') ? 'light' : 'dark'
    applyTheme(next)
  }
  function applyThemeOnLoad() {
    applyTheme(getPreferredTheme())
  }
  window.GTRTheme = { applyTheme, toggleTheme, getPreferredTheme, applyThemeOnLoad }
  tailwind.config = {
    darkMode: 'class',
    theme: {
      extend: {
        colors: {
          primary: {
            DEFAULT: '#0ea5e9',
            50: '#f0f9ff',
            100: '#e0f2fe',
            200: '#bae6fd',
            300: '#7dd3fc',
            400: '#38bdf8',
            500: '#0ea5e9',
            600: '#0284c7',
            700: '#0369a1',
            800: '#075985',
            900: '#0c4a6e'
          },
          success: { DEFAULT: '#22c55e' },
          danger: { DEFAULT: '#ef4444' },
          warning: { DEFAULT: '#f59e0b' }
        },
        fontFamily: {
          sans: [
            'system-ui',
            '-apple-system',
            'Segoe UI',
            'Roboto',
            'Helvetica Neue',
            'Arial',
            'Noto Sans',
            'Ubuntu',
            'Cantarell',
            'Fira Sans',
            'Droid Sans',
            'Apple Color Emoji',
            'Segoe UI Emoji',
            'Segoe UI Symbol'
          ]
        }
      }
    }
  }
})()

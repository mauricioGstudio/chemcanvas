export type Theme = 'dark' | 'light'

const THEME_KEY = 'chemcanvas:theme'

/** Persisted choice wins; otherwise follow the system preference. */
export function initialTheme(): Theme {
  const stored = localStorage.getItem(THEME_KEY)
  if (stored === 'dark' || stored === 'light') return stored
  return window.matchMedia?.('(prefers-color-scheme: light)').matches ? 'light' : 'dark'
}

export function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle('light', theme === 'light')
  localStorage.setItem(THEME_KEY, theme)
}

export function applyHighContrast(on: boolean) {
  document.documentElement.classList.toggle('high-contrast', on)
}

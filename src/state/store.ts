import { create } from 'zustand'
import { applyHighContrast, applyTheme, initialTheme, type Theme } from '../design/theme'

const UI_KEY = 'chemcanvas:ui'

export interface DisplayOptions {
  colorScheme: 'cpk' | 'mono'
  lineWidth: number // 0.5–4
  labelSize: number // 8–18
  atomLabels: 'hetero' | 'all' | 'none'
  showCharges: boolean
  showStereo: boolean // (R)/(S) and (E)/(Z) labels
  showImplicitH: boolean // H counts in atom labels (H key)
}

const DEFAULT_DISPLAY: DisplayOptions = {
  colorScheme: 'cpk',
  lineWidth: 1.8,
  labelSize: 13.5,
  atomLabels: 'hetero',
  showCharges: true,
  showStereo: true,
  showImplicitH: true,
}

interface PersistedUI {
  highContrast: boolean
  leftOpen: boolean
  rightOpen: boolean
  display: DisplayOptions
}

function loadUI(): PersistedUI {
  const defaults: PersistedUI = {
    highContrast: false,
    leftOpen: true,
    rightOpen: true,
    display: DEFAULT_DISPLAY,
  }
  try {
    const raw = localStorage.getItem(UI_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedUI>
      return { ...defaults, ...parsed, display: { ...DEFAULT_DISPLAY, ...parsed.display } }
    }
  } catch {
    /* corrupted storage — fall through to defaults */
  }
  return defaults
}

function saveUI(ui: PersistedUI) {
  localStorage.setItem(UI_KEY, JSON.stringify(ui))
}

interface UIState extends PersistedUI {
  theme: Theme
  rdkitReady: boolean
  rdkitVersion: string | null
  rdkitError: string | null
  paletteOpen: boolean
  projectionBond: string | null
  historyOpen: boolean
  setTheme: (t: Theme) => void
  toggleTheme: () => void
  setHighContrast: (on: boolean) => void
  toggleLeft: () => void
  toggleRight: () => void
  rdkitLoaded: (version: string) => void
  rdkitFailed: (message: string) => void
  setPaletteOpen: (open: boolean) => void
  setProjectionBond: (bondId: string | null) => void
  setHistoryOpen: (open: boolean) => void
  setDisplay: (patch: Partial<DisplayOptions>) => void
}

export const useUIStore = create<UIState>((set, get) => {
  const persisted = loadUI()
  const theme = initialTheme()
  applyTheme(theme)
  applyHighContrast(persisted.highContrast)

  const persist = () => {
    const { highContrast, leftOpen, rightOpen, display } = get()
    saveUI({ highContrast, leftOpen, rightOpen, display })
  }

  return {
    ...persisted,
    theme,
    rdkitReady: false,
    rdkitVersion: null,
    rdkitError: null,
    setTheme: (t) => {
      applyTheme(t)
      set({ theme: t })
    },
    toggleTheme: () => get().setTheme(get().theme === 'dark' ? 'light' : 'dark'),
    setHighContrast: (on) => {
      applyHighContrast(on)
      set({ highContrast: on })
      persist()
    },
    toggleLeft: () => {
      set((s) => ({ leftOpen: !s.leftOpen }))
      persist()
    },
    toggleRight: () => {
      set((s) => ({ rightOpen: !s.rightOpen }))
      persist()
    },
    rdkitLoaded: (version) => set({ rdkitReady: true, rdkitVersion: version }),
    rdkitFailed: (message) => set({ rdkitError: message }),
    paletteOpen: false,
    projectionBond: null,
    historyOpen: false,
    setPaletteOpen: (open) => set({ paletteOpen: open }),
    setProjectionBond: (projectionBond) => set({ projectionBond }),
    setHistoryOpen: (historyOpen) => set({ historyOpen }),
    setDisplay: (patch) => {
      set((s) => ({ display: { ...s.display, ...patch } }))
      persist()
    },
  }
})

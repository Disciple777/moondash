export type ThemeMode = 'system' | 'light' | 'dark'

export interface PalettePreview {
  bg: string
  sidebar: string
  accent: string
  text: string
}

export interface PaletteDef {
  id: string
  label: string
  tagline: string
  light: PalettePreview
  dark: PalettePreview
}

/**
 * Theme palettes. Each one ships a light and a dark variant; the "default"
 * palette is the original Moondash look (Notion-style neutrals).
 * The actual CSS variables live in styles.css under html[data-theme='<id>-<mode>'].
 */
export const PALETTES: PaletteDef[] = [
  {
    id: 'default',
    label: 'Default',
    tagline: 'The classic Moondash look',
    light: { bg: '#ffffff', sidebar: '#f7f7f5', accent: '#5b5bd6', text: '#37352f' },
    dark: { bg: '#191919', sidebar: '#202020', accent: '#7b7bd9', text: '#ebebea' }
  },
  {
    id: 'ocean',
    label: 'Ocean',
    tagline: 'Deep blues, calm focus',
    light: { bg: '#fbfcfe', sidebar: '#eef3f9', accent: '#0e7490', text: '#16293a' },
    dark: { bg: '#0a1526', sidebar: '#0f1d33', accent: '#38bdf8', text: '#dceaf5' }
  },
  {
    id: 'forest',
    label: 'Forest',
    tagline: 'Soft greens, grounded',
    light: { bg: '#fbfdf9', sidebar: '#f0f5ec', accent: '#2f855a', text: '#1c2b21' },
    dark: { bg: '#0d1512', sidebar: '#131e19', accent: '#4ade80', text: '#d9e7dc' }
  },
  {
    id: 'ember',
    label: 'Ember',
    tagline: 'Warm oranges, cozy',
    light: { bg: '#fdfaf6', sidebar: '#f7efe6', accent: '#d97706', text: '#33241a' },
    dark: { bg: '#180f08', sidebar: '#221610', accent: '#fb923c', text: '#f3e4d2' }
  },
  {
    id: 'grape',
    label: 'Grape',
    tagline: 'Rich violets, creative',
    light: { bg: '#fcfaff', sidebar: '#f4effa', accent: '#7c3aed', text: '#2d2340' },
    dark: { bg: '#120d1f', sidebar: '#1a1430', accent: '#a78bfa', text: '#e7ddf7' }
  },
  {
    id: 'cyber',
    label: 'Cyber',
    tagline: 'Hacker green on dark gray',
    light: { bg: '#f5f7f5', sidebar: '#ecefec', accent: '#00a859', text: '#1a241d' },
    dark: { bg: '#141414', sidebar: '#1d1d1d', accent: '#00ff77', text: '#ececec' }
  },
  {
    id: 'cherry',
    label: 'Cherry',
    tagline: 'Hot pink on dark gray',
    light: { bg: '#faf6f8', sidebar: '#f3ecef', accent: '#d1004f', text: '#2c1a22' },
    dark: { bg: '#141414', sidebar: '#1d1d1d', accent: '#ff0059', text: '#ececec' }
  },
  {
    id: 'ultraviolet',
    label: 'Ultraviolet',
    tagline: 'Electric blue on dark gray',
    light: { bg: '#f7f7fc', sidebar: '#efeff8', accent: '#1a00c9', text: '#16163a' },
    dark: { bg: '#0a0a14', sidebar: '#101020', accent: '#1500ff', text: '#dde0ff' }
  },
  {
    id: 'mono',
    label: 'Mono',
    tagline: 'Pure black & white',
    light: { bg: '#ffffff', sidebar: '#f5f5f5', accent: '#171717', text: '#161616' },
    dark: { bg: '#0a0a0a', sidebar: '#131313', accent: '#f5f5f5', text: '#f2f2f2' }
  }
]

export const DEFAULT_MODE: ThemeMode = 'system'
export const DEFAULT_PALETTE = 'default'

const STORAGE_KEY = 'moondash.theme'

export interface ThemePrefs {
  mode: ThemeMode
  palette: string
}

export function loadThemePrefs(): ThemePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<ThemePrefs>
      const mode: ThemeMode =
        parsed.mode === 'light' || parsed.mode === 'dark' || parsed.mode === 'system'
          ? parsed.mode
          : DEFAULT_MODE
      const palette = PALETTES.some((p) => p.id === parsed.palette)
        ? (parsed.palette as string)
        : DEFAULT_PALETTE
      return { mode, palette }
    }
  } catch {
    // corrupt storage — fall back to defaults
  }
  return { mode: DEFAULT_MODE, palette: DEFAULT_PALETTE }
}

export function saveThemePrefs(prefs: ThemePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // storage unavailable — theme just won't persist
  }
}

export function systemPrefersDark(): boolean {
  return (
    typeof window !== 'undefined' &&
    typeof window.matchMedia === 'function' &&
    window.matchMedia('(prefers-color-scheme: dark)').matches
  )
}

export function effectiveMode(mode: ThemeMode): 'light' | 'dark' {
  return mode === 'system' ? (systemPrefersDark() ? 'dark' : 'light') : mode
}

export function paletteLabel(id: string): string {
  return PALETTES.find((p) => p.id === id)?.label ?? 'Default'
}

/**
 * Applies the chosen theme to <html data-theme="...">.
 * - "default" palette + system mode → no attribute (original behavior: CSS
 *   :root defaults + prefers-color-scheme media query handle it).
 * - anything else → explicit `<palette>-<mode>` attribute; styles.css ships a
 *   variable block for each combination.
 */
export function applyTheme(prefs: ThemePrefs): void {
  const html = document.documentElement
  const eff = effectiveMode(prefs.mode)
  if (prefs.palette === DEFAULT_PALETTE && prefs.mode === 'system') {
    delete html.dataset.theme
  } else {
    html.dataset.theme = `${prefs.palette}-${eff}`
  }
}

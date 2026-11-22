/**
 * Reading & typography preferences — how the note itself looks.
 *
 * The theme (ThemeContext) decides the palette; this decides the type: which
 * font the note is set in, how big, how wide the page is, how far apart the
 * lines sit, and the few colours a writer actually wants control over
 * (headings, bold, and the accent used for links and UI).
 *
 * Everything is applied as CSS custom properties on <html>, so there is one
 * place that knows the mapping and the stylesheet stays declarative. Values
 * live in localStorage: they are per-device on purpose, the way zoom is in a
 * browser — the same account on a laptop and a phone wants different sizes.
 */

export interface FontOption {
  id: string
  label: string
  stack: string
}

/**
 * System font stacks only — no webfonts. The desktop app and the PWA both have
 * to work with no network, and a font that fails to load is worse than one
 * that was never offered.
 */
export const FONTS: FontOption[] = [
  {
    id: 'system',
    label: 'System',
    stack:
      "-apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif"
  },
  {
    id: 'humanist',
    label: 'Humanist',
    stack: "'Segoe UI', Candara, 'Gill Sans', 'Trebuchet MS', 'Lucida Grande', sans-serif"
  },
  {
    id: 'serif',
    label: 'Serif',
    stack: "Georgia, Cambria, 'Times New Roman', 'Liberation Serif', serif"
  },
  {
    id: 'book',
    label: 'Book',
    stack: "'Iowan Old Style', 'Palatino Linotype', Palatino, 'Book Antiqua', Georgia, serif"
  },
  {
    id: 'mono',
    label: 'Monospace',
    stack: "'Cascadia Mono', Consolas, 'SF Mono', Menlo, 'Liberation Mono', monospace"
  }
]

export function fontStack(id: string): string {
  return (FONTS.find((f) => f.id === id) ?? FONTS[0]).stack
}

export interface AppearancePrefs {
  /** FontOption id the note is set in. */
  font: string
  /** Base type size for the note, in px. */
  fontSize: number
  /** Multiple of the font size between baselines. */
  lineHeight: number
  /** How wide the page may get, in px. */
  pageWidth: number
  /** Content zoom, in percent — the Ctrl +/- shortcuts move this. */
  zoom: number
  /** Overrides for the palette's own colours; null = leave the theme alone. */
  accent: string | null
  headingColor: string | null
  boldColor: string | null
}

export const DEFAULT_APPEARANCE: AppearancePrefs = {
  font: 'system',
  fontSize: 16,
  lineHeight: 1.7,
  pageWidth: 860,
  zoom: 100,
  accent: null,
  headingColor: null,
  boldColor: null
}

export const FONT_SIZE_RANGE = { min: 13, max: 24 }
export const LINE_HEIGHT_RANGE = { min: 1.2, max: 2.2 }
export const PAGE_WIDTH_RANGE = { min: 600, max: 1400 }
export const ZOOM_RANGE = { min: 60, max: 200 }
/** Ctrl +/- steps through these rather than adding a fixed percentage. */
export const ZOOM_STEPS = [60, 70, 80, 90, 100, 110, 125, 150, 175, 200]

const STORAGE_KEY = 'moondash.appearance'

const clamp = (n: number, min: number, max: number) => Math.min(max, Math.max(min, n))

/** A colour we are willing to write into a style attribute. */
function safeColor(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const v = value.trim()
  return /^#[0-9a-f]{3}([0-9a-f]{3})?$/i.test(v) ? v : null
}

function num(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value) ? clamp(value, min, max) : fallback
}

export function loadAppearance(): AppearancePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_APPEARANCE
    const p = JSON.parse(raw) as Partial<AppearancePrefs>
    return {
      font: FONTS.some((f) => f.id === p.font) ? (p.font as string) : DEFAULT_APPEARANCE.font,
      fontSize: num(p.fontSize, DEFAULT_APPEARANCE.fontSize, FONT_SIZE_RANGE.min, FONT_SIZE_RANGE.max),
      lineHeight: num(p.lineHeight, DEFAULT_APPEARANCE.lineHeight, LINE_HEIGHT_RANGE.min, LINE_HEIGHT_RANGE.max),
      pageWidth: num(p.pageWidth, DEFAULT_APPEARANCE.pageWidth, PAGE_WIDTH_RANGE.min, PAGE_WIDTH_RANGE.max),
      zoom: num(p.zoom, DEFAULT_APPEARANCE.zoom, ZOOM_RANGE.min, ZOOM_RANGE.max),
      accent: safeColor(p.accent),
      headingColor: safeColor(p.headingColor),
      boldColor: safeColor(p.boldColor)
    }
  } catch {
    // corrupt or unavailable storage — defaults are always valid
    return DEFAULT_APPEARANCE
  }
}

export function saveAppearance(prefs: AppearancePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // storage unavailable — the prefs just won't persist
  }
}

/**
 * Push the prefs onto <html> as custom properties. A null colour REMOVES its
 * property instead of writing a value, so the palette's own definition (which
 * changes with light/dark) wins again.
 */
export function applyAppearance(prefs: AppearancePrefs): void {
  const root = document.documentElement
  const style = root.style
  style.setProperty('--doc-font', fontStack(prefs.font))
  style.setProperty('--doc-font-size', `${prefs.fontSize}px`)
  style.setProperty('--doc-line-height', String(prefs.lineHeight))
  style.setProperty('--doc-width', `${prefs.pageWidth}px`)
  style.setProperty('--doc-zoom', String(prefs.zoom / 100))

  // Headings and bold fall back in the stylesheet (var(--heading-color,
  // var(--text))), so removing the property hands them back to the palette.
  // The accent is set directly: an inline property beats the palette's own
  // html[data-theme=…] block, and clearing it lets that block win again.
  const colors: [string, string | null][] = [
    ['--heading-color', prefs.headingColor],
    ['--bold-color', prefs.boldColor],
    ['--accent', prefs.accent],
    ['--accent-strong', prefs.accent]
  ]
  for (const [name, value] of colors) {
    if (value) style.setProperty(name, value)
    else style.removeProperty(name)
  }
}

/** The next zoom step up or down from the current value. */
export function stepZoom(current: number, direction: 1 | -1): number {
  if (direction === 1) return ZOOM_STEPS.find((z) => z > current) ?? ZOOM_RANGE.max
  return [...ZOOM_STEPS].reverse().find((z) => z < current) ?? ZOOM_RANGE.min
}

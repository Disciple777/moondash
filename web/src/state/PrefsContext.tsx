import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import {
  applyAppearance,
  DEFAULT_APPEARANCE,
  loadAppearance,
  saveAppearance,
  stepZoom,
  type AppearancePrefs
} from '../appearance'

/* ------------------------------------------------------------------ */
/*  Date formatting                                                    */
/* ------------------------------------------------------------------ */

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December'
]
const MONTHS_SHORT = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec']
const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday']
const DAYS_SHORT = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']

const pad = (n: number) => String(n).padStart(2, '0')

/** Formats a date with simple tokens: YYYY, MMMM, MMM, MM, dddd, ddd, DD, D. */
export function formatDate(date: Date, fmt: string): string {
  return fmt
    .replace('YYYY', String(date.getFullYear()))
    .replace('MMMM', MONTHS[date.getMonth()])
    .replace('MMM', MONTHS_SHORT[date.getMonth()])
    .replace('MM', pad(date.getMonth() + 1))
    .replace('dddd', DAYS[date.getDay()])
    .replace('ddd', DAYS_SHORT[date.getDay()])
    .replace('DD', pad(date.getDate()))
    .replace('D', String(date.getDate()))
}

export interface DateFormatOption {
  id: string
  label: string
}

export const DATE_FORMATS: DateFormatOption[] = [
  { id: 'MM/DD/YYYY', label: 'Month first' },
  { id: 'DD/MM/YYYY', label: 'Day first' },
  { id: 'YYYY-MM-DD', label: 'ISO (year first)' },
  { id: 'MMMM D, YYYY', label: 'Long, month first' },
  { id: 'D MMMM YYYY', label: 'Long, day first' },
  { id: 'MMM D, YYYY', label: 'Short, month first' },
  { id: 'D MMM YYYY', label: 'Short, day first' },
  { id: 'dddd, MMMM D, YYYY', label: 'Full, with weekday' },
  { id: 'ddd, MMM D YYYY', label: 'Short, with weekday' }
]

/* ------------------------------------------------------------------ */
/*  Prefs persistence                                                  */
/* ------------------------------------------------------------------ */

export interface DatePrefs {
  enabled: boolean
  shortcut: string
  format: string
}

const STORAGE_KEY = 'moondash.datePrefs'

export const DEFAULT_DATE_PREFS: DatePrefs = {
  enabled: true,
  shortcut: '@date',
  format: 'MM/DD/YYYY'
}

/** Read the prefs straight from storage (used by the editor extension on every keystroke). */
export function loadDatePrefs(): DatePrefs {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<DatePrefs>
      const format = DATE_FORMATS.some((f) => f.id === parsed.format)
        ? (parsed.format as string)
        : DEFAULT_DATE_PREFS.format
      const shortcut =
        typeof parsed.shortcut === 'string' && parsed.shortcut.trim()
          ? parsed.shortcut.trim()
          : DEFAULT_DATE_PREFS.shortcut
      return { enabled: parsed.enabled !== false, shortcut, format }
    }
  } catch {
    // corrupt storage — fall back to defaults
  }
  return DEFAULT_DATE_PREFS
}

export function saveDatePrefs(prefs: DatePrefs): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(prefs))
  } catch {
    // storage unavailable — prefs just won't persist
  }
}

/* ------------------------------------------------------------------ */
/*  Context                                                            */
/* ------------------------------------------------------------------ */

interface PrefsContextValue {
  datePrefs: DatePrefs
  setDatePrefs: (prefs: DatePrefs) => void
  /** Type, page width and colour overrides for the note itself. */
  appearance: AppearancePrefs
  setAppearance: (prefs: AppearancePrefs) => void
  /** Zoom the note in or out one step (Ctrl +/-), or back to 100% (Ctrl 0). */
  zoomBy: (direction: 1 | -1) => void
  resetZoom: () => void
}

const PrefsContext = createContext<PrefsContextValue | null>(null)

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [datePrefs, setDatePrefsState] = useState<DatePrefs>(loadDatePrefs)
  const [appearance, setAppearanceState] = useState<AppearancePrefs>(loadAppearance)

  const setDatePrefs = (prefs: DatePrefs) => {
    setDatePrefsState(prefs)
    saveDatePrefs(prefs)
  }

  const setAppearance = (prefs: AppearancePrefs) => {
    setAppearanceState(prefs)
    saveAppearance(prefs)
  }

  // Written to <html> rather than through React so the values are in place for
  // the first paint and for anything rendered outside the tree (popovers).
  useEffect(() => {
    applyAppearance(appearance)
  }, [appearance])

  const zoomBy = (direction: 1 | -1) =>
    setAppearanceState((prev) => {
      const next = { ...prev, zoom: stepZoom(prev.zoom, direction) }
      saveAppearance(next)
      return next
    })

  const resetZoom = () =>
    setAppearanceState((prev) => {
      const next = { ...prev, zoom: DEFAULT_APPEARANCE.zoom }
      saveAppearance(next)
      return next
    })

  // Ctrl/Cmd +, - and 0 zoom the note. Bound here rather than in the editor so
  // they work on the workspace home and in the plain-text editor too, and so
  // the browser's own page zoom doesn't fight the app's.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.altKey) return
      // '=' and '+' share a key; Numpad sends 'Add'/'Subtract'.
      if (e.key === '+' || e.key === '=' || e.code === 'NumpadAdd') {
        e.preventDefault()
        zoomBy(1)
      } else if (e.key === '-' || e.key === '_' || e.code === 'NumpadSubtract') {
        e.preventDefault()
        zoomBy(-1)
      } else if (e.key === '0' || e.code === 'Numpad0') {
        e.preventDefault()
        resetZoom()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <PrefsContext.Provider
      value={{ datePrefs, setDatePrefs, appearance, setAppearance, zoomBy, resetZoom }}
    >
      {children}
    </PrefsContext.Provider>
  )
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs must be used within a PrefsProvider')
  return ctx
}

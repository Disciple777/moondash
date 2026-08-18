import { createContext, useContext, useState, type ReactNode } from 'react'

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
}

const PrefsContext = createContext<PrefsContextValue | null>(null)

export function PrefsProvider({ children }: { children: ReactNode }) {
  const [datePrefs, setDatePrefsState] = useState<DatePrefs>(loadDatePrefs)

  const setDatePrefs = (prefs: DatePrefs) => {
    setDatePrefsState(prefs)
    saveDatePrefs(prefs)
  }

  return <PrefsContext.Provider value={{ datePrefs, setDatePrefs }}>{children}</PrefsContext.Provider>
}

export function usePrefs(): PrefsContextValue {
  const ctx = useContext(PrefsContext)
  if (!ctx) throw new Error('usePrefs must be used within a PrefsProvider')
  return ctx
}

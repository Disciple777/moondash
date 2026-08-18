import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useState,
  type ReactNode
} from 'react'
import {
  applyTheme,
  effectiveMode,
  loadThemePrefs,
  saveThemePrefs,
  type ThemeMode,
  type ThemePrefs
} from '../theme'

interface ThemeContextValue {
  mode: ThemeMode
  palette: string
  isDark: boolean
  setMode: (mode: ThemeMode) => void
  setPalette: (palette: string) => void
}

const ThemeContext = createContext<ThemeContextValue | null>(null)

export function ThemeProvider({ children }: { children: ReactNode }) {
  const [prefs, setPrefs] = useState<ThemePrefs>(() => loadThemePrefs())

  // Apply on load and whenever the preference changes.
  useEffect(() => {
    applyTheme(prefs)
  }, [prefs])

  // While in "system" mode, live-follow OS theme changes.
  useEffect(() => {
    if (prefs.mode !== 'system') return
    const mq = window.matchMedia('(prefers-color-scheme: dark)')
    const onChange = () => applyTheme(prefs)
    mq.addEventListener?.('change', onChange)
    return () => mq.removeEventListener?.('change', onChange)
  }, [prefs])

  // Persist after every change (updaters stay pure for StrictMode).
  useEffect(() => {
    saveThemePrefs(prefs)
  }, [prefs])

  const setMode = useCallback((mode: ThemeMode) => {
    setPrefs((prev) => ({ ...prev, mode }))
  }, [])

  const setPalette = useCallback((palette: string) => {
    setPrefs((prev) => ({ ...prev, palette }))
  }, [])

  const value = useMemo<ThemeContextValue>(
    () => ({
      mode: prefs.mode,
      palette: prefs.palette,
      isDark: effectiveMode(prefs.mode) === 'dark',
      setMode,
      setPalette
    }),
    [prefs, setMode, setPalette]
  )

  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}

export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext)
  if (!ctx) throw new Error('useTheme must be used inside ThemeProvider')
  return ctx
}

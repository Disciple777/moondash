import { Check, Monitor, Moon, Palette, Sun, X } from 'lucide-react'
import { PALETTES, paletteLabel, type ThemeMode } from '../theme'
import { useTheme } from '../state/ThemeContext'
import { DATE_FORMATS, formatDate, usePrefs } from '../state/PrefsContext'

const MODE_OPTIONS: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon }
]

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mode, palette, isDark, setMode, setPalette } = useTheme()
  const { datePrefs, setDatePrefs } = usePrefs()

  if (!open) return null

  return (
    <div className="modal-backdrop" onClick={onClose}>
      <div className="modal settings-modal" onClick={(e) => e.stopPropagation()}>
        <div className="settings-head">
          <h2 className="modal-title">
            <Palette size={17} /> Settings
          </h2>
          <button className="icon-btn" title="Close" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        <div className="settings-current">
          {paletteLabel(palette)} · {isDark ? 'Dark' : 'Light'}
        </div>

        <div className="dialog-label">Appearance</div>
        <div className="mode-toggle" role="radiogroup" aria-label="Appearance mode">
          {MODE_OPTIONS.map(({ id, label, icon: Icon }) => (
            <button
              key={id}
              role="radio"
              aria-checked={mode === id}
              className={`mode-btn${mode === id ? ' is-active' : ''}`}
              onClick={() => setMode(id)}
            >
              <Icon size={14} /> {label}
            </button>
          ))}
        </div>

        <div className="dialog-label">Date shortcut</div>
        <div className="settings-row">
          <label htmlFor="date-shortcut">Shortcut</label>
          <input
            id="date-shortcut"
            className="settings-input"
            value={datePrefs.shortcut}
            onChange={(e) => setDatePrefs({ ...datePrefs, shortcut: e.target.value })}
          />
        </div>
        <div className="settings-row">
          <label htmlFor="date-format">Format</label>
          <select
            id="date-format"
            className="settings-input"
            value={datePrefs.format}
            onChange={(e) => setDatePrefs({ ...datePrefs, format: e.target.value })}
          >
            {DATE_FORMATS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label} — {formatDate(new Date(), f.id)}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="date-shortcut-enable">Enable</label>
          <input
            id="date-shortcut-enable"
            type="checkbox"
            className="settings-check"
            checked={datePrefs.enabled}
            onChange={(e) => setDatePrefs({ ...datePrefs, enabled: e.target.checked })}
          />
        </div>
        <p className="settings-hint">
          Type “{datePrefs.shortcut || '@date'}” in a note to insert today's date — make sure the
          shortcut is distinctive so it doesn't appear in normal writing.
        </p>

        <div className="dialog-label">Theme</div>
        <div className="theme-grid">
          {PALETTES.map((p) => {
            const active = palette === p.id
            return (
              <button
                key={p.id}
                className={`theme-card${active ? ' is-active' : ''}`}
                title={p.tagline}
                onClick={() => setPalette(p.id)}
              >
                <span className="theme-preview">
                  <span className="theme-preview-half" style={{ background: p.light.bg }}>
                    <span className="theme-preview-side" style={{ background: p.light.sidebar }} />
                    <span
                      className="theme-preview-line"
                      style={{ background: p.light.text, opacity: 0.35 }}
                    />
                    <span className="theme-preview-dot" style={{ background: p.light.accent }} />
                  </span>
                  <span className="theme-preview-half" style={{ background: p.dark.bg }}>
                    <span className="theme-preview-side" style={{ background: p.dark.sidebar }} />
                    <span
                      className="theme-preview-line"
                      style={{ background: p.dark.text, opacity: 0.35 }}
                    />
                    <span className="theme-preview-dot" style={{ background: p.dark.accent }} />
                  </span>
                  {active && (
                    <span className="theme-card-check">
                      <Check size={11} strokeWidth={3} />
                    </span>
                  )}
                </span>
                <span className="theme-card-label">{p.label}</span>
              </button>
            )
          })}
        </div>
        <p className="settings-hint">Each theme has a light and a dark variant.</p>

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

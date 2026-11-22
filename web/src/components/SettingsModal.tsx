import { Check, Download, Monitor, Moon, Palette, RotateCcw, Sun, X } from 'lucide-react'
import { PALETTES, paletteLabel, type ThemeMode } from '../theme'
import { useTheme } from '../state/ThemeContext'
import { DATE_FORMATS, formatDate, usePrefs } from '../state/PrefsContext'
import {
  DEFAULT_APPEARANCE,
  FONTS,
  FONT_SIZE_RANGE,
  LINE_HEIGHT_RANGE,
  PAGE_WIDTH_RANGE,
  ZOOM_RANGE,
  fontStack,
  type AppearancePrefs
} from '../appearance'

const MODE_OPTIONS: { id: ThemeMode; label: string; icon: typeof Sun }[] = [
  { id: 'system', label: 'System', icon: Monitor },
  { id: 'light', label: 'Light', icon: Sun },
  { id: 'dark', label: 'Dark', icon: Moon }
]

// The static download page ships inside the web build (public/download/), so on
// the web it sits next to the app — this works from any deploy folder. There is
// no http origin to resolve against under file://, so fall back to the live one.
const DOWNLOAD_PAGE_FALLBACK = 'https://guatermelon.com/moondash/download/'
function downloadPageUrl(): string {
  if (location.protocol === 'http:' || location.protocol === 'https:') {
    return new URL('download/', location.href).href
  }
  return DOWNLOAD_PAGE_FALLBACK
}

// Colours offered for headings, bold and the accent. Picked to stay legible on
// both the light and the dark side of every palette.
const INK_COLORS: string[] = [
  '#e5484d',
  '#f76b15',
  '#f5a623',
  '#30a46c',
  '#3e63dd',
  '#5b5bd6',
  '#8e4ec6',
  '#d6409f',
  '#a8653f',
  '#8f8f8f'
]

/**
 * One colour row: the theme's own colour (null) plus the swatches. Used for
 * headings, bold and the accent, which all override a palette colour.
 */
function ColorRow({
  label,
  value,
  onChange
}: {
  label: string
  value: string | null
  onChange: (color: string | null) => void
}) {
  return (
    <div className="settings-color-row">
      <span className="settings-color-label">{label}</span>
      <span className="settings-swatches">
        <button
          type="button"
          className={`settings-swatch is-default${value === null ? ' is-active' : ''}`}
          title="Use the theme's own colour"
          aria-label={`${label}: theme default`}
          aria-pressed={value === null}
          onClick={() => onChange(null)}
        />
        {INK_COLORS.map((c) => (
          <button
            key={c}
            type="button"
            className={`settings-swatch${value === c ? ' is-active' : ''}`}
            style={{ background: c }}
            title={c}
            aria-label={`${label}: ${c}`}
            aria-pressed={value === c}
            onClick={() => onChange(c)}
          />
        ))}
      </span>
    </div>
  )
}

export function SettingsModal({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { mode, palette, isDark, setMode, setPalette } = useTheme()
  const { datePrefs, setDatePrefs, appearance, setAppearance } = usePrefs()

  const patch = (change: Partial<AppearancePrefs>) => setAppearance({ ...appearance, ...change })

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

        <div className="dialog-label">
          Reading
          <button
            type="button"
            className="settings-reset"
            title="Back to the default type and colours"
            onClick={() => setAppearance(DEFAULT_APPEARANCE)}
          >
            <RotateCcw size={11} /> Reset
          </button>
        </div>
        <div className="settings-row">
          <label htmlFor="doc-font">Font</label>
          <select
            id="doc-font"
            className="settings-input"
            value={appearance.font}
            onChange={(e) => patch({ font: e.target.value })}
          >
            {FONTS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.label}
              </option>
            ))}
          </select>
        </div>
        <div className="settings-row">
          <label htmlFor="doc-size">Text size</label>
          <span className="settings-slider">
            <input
              id="doc-size"
              type="range"
              min={FONT_SIZE_RANGE.min}
              max={FONT_SIZE_RANGE.max}
              step={1}
              value={appearance.fontSize}
              onChange={(e) => patch({ fontSize: Number(e.target.value) })}
            />
            <span className="settings-value">{appearance.fontSize}px</span>
          </span>
        </div>
        <div className="settings-row">
          <label htmlFor="doc-leading">Line spacing</label>
          <span className="settings-slider">
            <input
              id="doc-leading"
              type="range"
              min={LINE_HEIGHT_RANGE.min}
              max={LINE_HEIGHT_RANGE.max}
              step={0.05}
              value={appearance.lineHeight}
              onChange={(e) => patch({ lineHeight: Number(e.target.value) })}
            />
            <span className="settings-value">{appearance.lineHeight.toFixed(2)}</span>
          </span>
        </div>
        <div className="settings-row">
          <label htmlFor="doc-width">Page width</label>
          <span className="settings-slider">
            <input
              id="doc-width"
              type="range"
              min={PAGE_WIDTH_RANGE.min}
              max={PAGE_WIDTH_RANGE.max}
              step={20}
              value={appearance.pageWidth}
              onChange={(e) => patch({ pageWidth: Number(e.target.value) })}
            />
            <span className="settings-value">{appearance.pageWidth}px</span>
          </span>
        </div>
        <div className="settings-row">
          <label htmlFor="doc-zoom">Zoom</label>
          <span className="settings-slider">
            <input
              id="doc-zoom"
              type="range"
              min={ZOOM_RANGE.min}
              max={ZOOM_RANGE.max}
              step={5}
              value={appearance.zoom}
              onChange={(e) => patch({ zoom: Number(e.target.value) })}
            />
            <span className="settings-value">{appearance.zoom}%</span>
          </span>
        </div>
        <p className="settings-hint">
          Ctrl + and Ctrl − zoom while you write; Ctrl 0 goes back to 100%.
        </p>

        <div
          className="settings-preview"
          style={{ fontFamily: fontStack(appearance.font), lineHeight: appearance.lineHeight }}
        >
          <span
            className="settings-preview-h"
            style={{
              fontSize: appearance.fontSize * 1.4,
              color: appearance.headingColor ?? undefined
            }}
          >
            A heading
          </span>
          <span className="settings-preview-p" style={{ fontSize: appearance.fontSize }}>
            Ordinary text, with{' '}
            <strong style={{ color: appearance.boldColor ?? undefined }}>something in bold</strong>{' '}
            and <u>something underlined</u>.
          </span>
        </div>

        <div className="dialog-label">Colors</div>
        <ColorRow
          label="Headings"
          value={appearance.headingColor}
          onChange={(c) => patch({ headingColor: c })}
        />
        <ColorRow
          label="Bold"
          value={appearance.boldColor}
          onChange={(c) => patch({ boldColor: c })}
        />
        <ColorRow label="Accent" value={appearance.accent} onChange={(c) => patch({ accent: c })} />
        <p className="settings-hint">
          The first swatch in each row keeps the theme's own colour. The accent is used for links,
          buttons and selections.
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

        {!window.moondash?.isDesktop && (
          <p className="settings-hint">
            <a className="settings-download-link" href={downloadPageUrl()} target="_blank" rel="noopener">
              <Download size={11} /> Download the desktop app
            </a>
          </p>
        )}

        <div className="modal-actions">
          <button className="btn primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </div>
  )
}

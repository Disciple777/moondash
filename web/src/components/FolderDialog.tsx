import { useEffect, useState } from 'react'
import { FOLDER_ICON_MAP, FOLDER_ICONS, folderIconName } from './FolderGlyph'

export const FOLDER_COLORS = [
  '#5B5BD6',
  '#2EA043',
  '#F5A623',
  '#E0245E',
  '#1AA7EC',
  '#8250DF',
  '#10B981',
  '#F43F5E',
  '#ffd500',
  '#6B7280',
  '#00ffc3',
  '#ccff00',
  '#2b00ff',
  '#00ff91',
  '#b3ab84'
]

interface FolderDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initialName?: string
  initialColor?: string
  initialIcon?: string | null
  onSave: (name: string, colorHex: string, iconKey: string | null) => Promise<void>
  onClose: () => void
}

export function FolderDialog({
  open,
  mode,
  initialName = '',
  initialColor = FOLDER_COLORS[0],
  initialIcon = 'Folder',
  onSave,
  onClose
}: FolderDialogProps) {
  const [name, setName] = useState(initialName)
  const [color, setColor] = useState(initialColor)
  const [icon, setIcon] = useState<string | null>(folderIconName(initialIcon))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initialName)
      setColor(initialColor)
      setIcon(folderIconName(initialIcon))
    }
  }, [open, initialName, initialColor, initialIcon])

  if (!open) return null

  const submit = async () => {
    setBusy(true)
    try {
      await onSave(name.trim() !== '' ? name.trim() : 'New folder', color, icon)
      onClose()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) onClose()
      }}
    >
      <div className="modal" role="dialog" aria-modal="true">
        <h3 className="modal-title">{mode === 'edit' ? 'Edit folder' : 'New folder'}</h3>

        <label className="field">
          <span>Name</span>
          <input
            autoFocus
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
              if (e.key === 'Escape') onClose()
            }}
            placeholder="Folder name…"
          />
        </label>

        <div className="dialog-label">Color</div>
        <div className="folder-colors">
          {FOLDER_COLORS.map((c) => (
            <button
              key={c}
              type="button"
              className={`swatch${color === c ? ' is-active' : ''}`}
              style={{ background: c }}
              onClick={() => setColor(c)}
              aria-label={`Color ${c}`}
            />
          ))}
        </div>

        <div className="dialog-label">Icon</div>
        <div className="folder-icons">
          {FOLDER_ICONS.map((name) => {
            const Icon = FOLDER_ICON_MAP[name]
            return (
              <button
                key={name}
                type="button"
                className={`icon-choice${icon === name ? ' is-active' : ''}`}
                onClick={() => setIcon(icon === name ? null : name)}
                title={name}
              >
                <Icon size={17} />
              </button>
            )
          })}
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={onClose}>
            Cancel
          </button>
          <button className="btn primary" onClick={() => void submit()} disabled={busy}>
            {busy ? 'Saving…' : mode === 'edit' ? 'Save' : 'Create'}
          </button>
        </div>
      </div>
    </div>
  )
}

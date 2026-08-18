import { useEffect, useState } from 'react'
import { Folder, Layers } from 'lucide-react'
import { FOLDER_COLORS } from './FolderDialog'
import { FOLDER_ICON_MAP, FOLDER_ICONS, folderIconName } from './FolderGlyph'

export interface WorkspaceDraft {
  name: string
  description: string
  type: 'folder' | 'multi'
  color_hex: string
  icon_key: string | null
}

interface WorkspaceDialogProps {
  open: boolean
  mode: 'create' | 'edit'
  initial?: Partial<WorkspaceDraft>
  onSave: (draft: WorkspaceDraft) => Promise<void>
  onClose: () => void
}

export function WorkspaceDialog({ open, mode, initial, onSave, onClose }: WorkspaceDialogProps) {
  const [name, setName] = useState(initial?.name ?? '')
  const [description, setDescription] = useState(initial?.description ?? '')
  const [type, setType] = useState<'folder' | 'multi'>(initial?.type ?? 'folder')
  const [color, setColor] = useState(initial?.color_hex ?? FOLDER_COLORS[0])
  const [icon, setIcon] = useState<string | null>(folderIconName(initial?.icon_key ?? 'Folder'))
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? '')
      setDescription(initial?.description ?? '')
      setType(initial?.type ?? 'folder')
      setColor(initial?.color_hex ?? FOLDER_COLORS[0])
      setIcon(folderIconName(initial?.icon_key ?? 'Folder'))
    }
  }, [open, initial])

  if (!open) return null

  const submit = async () => {
    setBusy(true)
    try {
      await onSave({
        name: name.trim() !== '' ? name.trim() : 'Untitled workspace',
        description,
        type,
        color_hex: color,
        icon_key: icon
      })
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
        <h3 className="modal-title">{mode === 'edit' ? 'Edit workspace' : 'New workspace'}</h3>

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
            placeholder="Workspace name…"
          />
        </label>

        <label className="field" style={{ marginTop: 12 }}>
          <span>Description (optional)</span>
          <input
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') void submit()
              if (e.key === 'Escape') onClose()
            }}
            placeholder="What lives here?"
          />
        </label>

        {mode === 'create' && (
          <>
            <div className="dialog-label">Type</div>
            <div className="ws-type-grid">
              <button
                type="button"
                className={`ws-type-card${type === 'folder' ? ' is-active' : ''}`}
                onClick={() => setType('folder')}
              >
                <span className="ws-type-icon">
                  <Folder size={16} />
                </span>
                <span className="ws-type-name">Folder workspace</span>
                <span className="ws-type-desc">Syncs 1:1 with a folder on your computer</span>
              </button>
              <button
                type="button"
                className={`ws-type-card${type === 'multi' ? ' is-active' : ''}`}
                onClick={() => setType('multi')}
              >
                <span className="ws-type-icon">
                  <Layers size={16} />
                </span>
                <span className="ws-type-name">Multi-space</span>
                <span className="ws-type-desc">
                  Gather docs from different folders under one roof
                </span>
              </button>
            </div>
          </>
        )}

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

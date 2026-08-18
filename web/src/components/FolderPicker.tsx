import { useEffect, useMemo, useState } from 'react'
import { Check, FolderPlus, Search } from 'lucide-react'
import { useApp } from '../state/AppContext'
import type { FolderInfo } from '../types'
import { FolderDialog } from './FolderDialog'
import { FolderGlyph } from './FolderGlyph'

interface FolderPickerProps {
  docId: number
  position: { x: number; y: number } | null
  onClose: () => void
}

export function FolderPicker({ docId, position, onClose }: FolderPickerProps) {
  const { folders, memberships, addDocToFolder, removeDocFromFolder, createFolder } = useApp()
  const [busy, setBusy] = useState(false)
  const [query, setQuery] = useState('')
  const [creating, setCreating] = useState(false)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  // Nesting: folder -> parent folder (a folder member of another folder).
  const parentOf = useMemo(() => {
    const map = new Map<number, number>()
    const folderIds = new Set(folders.map((f) => f.bit_id))
    for (const m of memberships) {
      if (folderIds.has(m.item_id)) map.set(m.item_id, m.folder_id)
    }
    return map
  }, [folders, memberships])

  const folderName = useMemo(
    () => new Map(folders.map((f) => [f.bit_id, f.name])),
    [folders]
  )

  const depthOf = (id: number): number => {
    let depth = 0
    let cur = id
    const seen = new Set<number>()
    while (parentOf.has(cur) && !seen.has(cur)) {
      seen.add(cur)
      cur = parentOf.get(cur)!
      depth++
    }
    return depth
  }

  const memberFolderIds = useMemo(
    () => new Set(memberships.filter((m) => m.item_id === docId).map((m) => m.folder_id)),
    [memberships, docId]
  )

  const q = query.trim().toLowerCase()
  const visible = q ? folders.filter((f) => f.name.toLowerCase().includes(q)) : folders

  if (!position) return null

  const toggle = async (folderId: number) => {
    setBusy(true)
    try {
      if (memberFolderIds.has(folderId)) {
        await removeDocFromFolder(docId, folderId)
      } else {
        await addDocToFolder(docId, folderId)
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <>
      <div className="picker-backdrop" onClick={onClose} />
      <div
        className="picker"
        style={{
          left: Math.min(position.x, window.innerWidth - 280),
          top: Math.min(position.y, window.innerHeight - 360)
        }}
      >
        <div className="picker-title">Add to folder</div>
        <div className="picker-search">
          <Search size={12} className="picker-search-icon" />
          <input
            autoFocus
            placeholder="Find a folder…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="picker-list">
          {visible.length === 0 && (
            <div className="picker-empty">
              {q ? 'No folders match' : 'No folders yet — create one below.'}
            </div>
          )}
          {visible.map((f) => {
            const checked = memberFolderIds.has(f.bit_id)
            const depth = depthOf(f.bit_id)
            return (
              <button
                key={f.bit_id}
                type="button"
                className={`picker-item${checked ? ' is-checked' : ''}`}
                disabled={busy}
                style={{ paddingLeft: 10 + depth * 16 }}
                onClick={() => void toggle(f.bit_id)}
              >
                <span className="picker-icon">
                  <FolderGlyph iconKey={f.icon_key} color={f.color_hex} size={14} />
                </span>
                <span className="picker-name" style={{ color: f.color_hex }}>
                  {f.name}
                </span>
                <span className="picker-breadcrumb">
                  {depth > 0 ? (folderName.get(parentOf.get(f.bit_id)!) ?? '') : ''}
                </span>
                {checked && <Check size={14} className="picker-check" />}
              </button>
            )
          })}
        </div>
        {creating ? (
          <FolderDialog
            open
            mode="create"
            onSave={async (name, colorHex, iconKey) => {
              await createFolder(name, colorHex, iconKey, null)
              setCreating(false)
            }}
            onClose={() => setCreating(false)}
          />
        ) : (
          <button
            className="picker-create"
            type="button"
            onClick={() => setCreating(true)}
          >
            <FolderPlus size={13} /> New folder
          </button>
        )}
      </div>
    </>
  )
}

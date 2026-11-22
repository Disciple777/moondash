import { useMemo, useState } from 'react'
import { FileText, Layers, Lock, Moon, Plus, Upload } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { isEncrypted } from '../crypto/noteCrypto'
import { docDisplayName } from '../docNames'

function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hours = Math.floor(mins / 60)
  if (hours < 24) return `${hours}h ago`
  const days = Math.floor(hours / 24)
  if (days < 7) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

export function WorkspaceHome() {
  const { docs, requestNewDoc, openDoc, activeWorkspace, openMultiModal } = useApp()
  const isMultiSpace = activeWorkspace?.type === 'multi'
  const [fileDragOver, setFileDragOver] = useState(false)

  const recent = useMemo(
    () =>
      [...docs]
        .filter((d) => !d.is_deleted)
        .sort((a, b) => b.updated_at.localeCompare(a.updated_at))
        .slice(0, 8),
    [docs]
  )

  // Drop an OS file anywhere on the multi-space home to import it.
  const onDragOver = (e: React.DragEvent) => {
    if (isMultiSpace && e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      setFileDragOver(true)
    }
  }
  const onDrop = (e: React.DragEvent) => {
    if (isMultiSpace && e.dataTransfer.types.includes('Files')) {
      e.preventDefault()
      setFileDragOver(false)
      const file = e.dataTransfer.files?.[0]
      if (file) openMultiModal('link', undefined, file)
    }
  }

  const dropOverlay = fileDragOver ? (
    <div className="drop-import-overlay">
      <Upload size={22} />
      <span>Drop to import into “{activeWorkspace?.name}”</span>
    </div>
  ) : null

  if (docs.length === 0) {
    return (
      <div className="home home-empty" onDragOver={onDragOver} onDragLeave={() => setFileDragOver(false)} onDrop={onDrop}>
        {dropOverlay}
        <div className="home-logo">
          <Moon size={30} />
        </div>
        <h1>{activeWorkspace?.name ?? 'Moondash'}</h1>
        {isMultiSpace ? (
          <>
            <p>
              This multi-space is empty. Add documents from any of your workspaces — or drop in a
              file from your computer — and they stay synced to their original folders while living
              here too.
            </p>
            <button className="btn primary" onClick={() => openMultiModal('link')}>
              <Layers size={15} /> Add a document
            </button>
          </>
        ) : (
          <>
            <p>
              This workspace is empty. Create your first page here, or bind a local folder with the
              desktop app and it will sync automatically.
            </p>
            <button className="btn primary" onClick={() => requestNewDoc()}>
              <Plus size={15} /> New page
            </button>
          </>
        )}
      </div>
    )
  }

  return (
    <div className="home" onDragOver={onDragOver} onDragLeave={() => setFileDragOver(false)} onDrop={onDrop}>
      {dropOverlay}
      <div className="home-head">
        <div>
          <h1>{activeWorkspace?.name}</h1>
          <p className="home-sub">
            {docs.filter((d) => !d.is_deleted).length} pages
          </p>
        </div>
        {isMultiSpace ? (
          <button className="btn primary" onClick={() => openMultiModal('link')}>
            <Layers size={15} /> Add a document
          </button>
        ) : (
          <button className="btn primary" onClick={() => requestNewDoc()}>
            <Plus size={15} /> New page
          </button>
        )}
      </div>

      <div className="home-cards">
        {recent.map((doc) => (
          <button key={doc.id} className="home-card" onClick={() => void openDoc(doc.id)}>
            <div className="home-card-top">
              <FileText size={15} className="home-card-icon" />
              <span className="home-card-time">{timeAgo(doc.updated_at)}</span>
            </div>
            <div className="home-card-title">{docDisplayName(doc)}</div>
            <div className="home-card-preview">
              {doc.content_preview && isEncrypted(doc.content_preview) ? (
                // The stored preview of a protected note is the start of its
                // envelope — meaningless, so say what it is instead.
                <span className="home-card-locked">
                  <Lock size={12} /> Password-protected
                </span>
              ) : (
                doc.content_preview || 'Empty page'
              )}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useRef, useState } from 'react'
import { FileText, Loader2, Search, UploadCloud } from 'lucide-react'
import { api } from '../api/client'
import { useApp } from '../state/AppContext'
import type { DocNode, Workspace } from '../types'
import { FolderGlyph } from './FolderGlyph'

interface SourceTree {
  workspace: Workspace
  docs: DocNode[]
  loaded: boolean
}

/** A local file queued for import. */
interface PendingImport {
  file: File
  /** Desktop: linked in place — the file stays at this absolute path. */
  path?: string
  content?: string
  /** Web: no disk access — the doc gets a home in the chosen workspace. */
  wsId: number | null
}

export function MultiSpaceModal() {
  const {
    multiModal,
    multiModalFolderId,
    multiModalFile,
    closeMultiModal,
    workspaces,
    activeWorkspace,
    docs,
    linkDocToWorkspace,
    createDocInWorkspace,
    importFileIntoMulti,
    importLinkedFileIntoMulti
  } = useApp()

  const [query, setQuery] = useState('')
  const [trees, setTrees] = useState<SourceTree[]>([])
  const [busy, setBusy] = useState(false)
  const [pending, setPending] = useState<PendingImport | null>(null)
  const [importing, setImporting] = useState(false)
  const [importError, setImportError] = useState<string | null>(null)
  const [dropOver, setDropOver] = useState(false)
  const fileInputRef = useRef<HTMLInputElement>(null)
  const bridge = window.moondash

  const folderWorkspaces = useMemo(
    () => workspaces.filter((w) => w.type !== 'multi'),
    [workspaces]
  )

  // Load one tree per folder workspace when the modal opens, so the picker
  // can offer every doc the user owns across all their synced folders.
  useEffect(() => {
    if (!multiModal) {
      setTrees([])
      setQuery('')
      setPending(null)
      setImportError(null)
      setDropOver(false)
      return
    }
    let cancelled = false
    setTrees(folderWorkspaces.map((w) => ({ workspace: w, docs: [], loaded: false })))
    folderWorkspaces.forEach((w, index) => {
      api
        .tree(w.id)
        .then((tree) => {
          if (cancelled) return
          setTrees((prev) => {
            const next = [...prev]
            if (next[index]) next[index] = { workspace: w, docs: tree.docs, loaded: true }
            return next
          })
        })
        .catch(() => {
          if (cancelled) return
          setTrees((prev) => {
            const next = [...prev]
            if (next[index]) next[index] = { ...next[index], loaded: true }
            return next
          })
        })
    })
    return () => {
      cancelled = true
    }
  }, [multiModal, folderWorkspaces])

  // A file dropped on the sidebar/home preloads the import flow.
  useEffect(() => {
    if (multiModalFile) void queueFile(multiModalFile)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [multiModalFile])

  // Run the import once the pending file is ready (linked-in-place on desktop,
  // or a target workspace chosen on the web).
  useEffect(() => {
    if (!pending) return
    const linked = pending.path && pending.content !== undefined
    if (!linked && pending.wsId === null) return
    let cancelled = false
    ;(async () => {
      setImporting(true)
      setImportError(null)
      try {
        if (linked) {
          await importLinkedFileIntoMulti(
            pending.file.name,
            pending.path!,
            pending.content!,
            multiModalFolderId
          )
        } else {
          const content = await pending.file.text()
          await importFileIntoMulti(pending.wsId!, pending.file.name, content, multiModalFolderId)
        }
        if (!cancelled) closeMultiModal()
      } catch (e) {
        if (!cancelled) {
          setImportError(
            e instanceof Error && e.message ? e.message : 'Import failed — please try again.'
          )
        }
      } finally {
        if (!cancelled) setImporting(false)
      }
    })()
    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pending])

  if (!multiModal || !activeWorkspace) return null

  const linkedIds = new Set(docs.filter((d) => !d.is_deleted).map((d) => d.id))
  const q = query.trim().toLowerCase()

  const link = async (docId: number) => {
    setBusy(true)
    try {
      await linkDocToWorkspace(activeWorkspace.id, docId)
      closeMultiModal()
    } finally {
      setBusy(false)
    }
  }

  const create = async (workspaceId: number) => {
    setBusy(true)
    try {
      await createDocInWorkspace(workspaceId, multiModalFolderId)
      closeMultiModal()
    } finally {
      setBusy(false)
    }
  }

  /**
   * Accept a picked/dropped file.
   * Desktop: link it IN PLACE — record its absolute path, no copy into a
   * workspace (the file stays exactly where it lives on disk).
   * Web (no disk access): read the content and ask which workspace should own it.
   */
  const queueFile = async (file: File | null) => {
    if (!file) return
    setImportError(null)
    const bridge = window.moondash
    if (bridge?.isDesktop) {
      try {
        const absPath = bridge.pathForFile(file)
        if (absPath) {
          const content = await bridge.readExternalFile(absPath)
          if (content === null) {
            setImportError(
              'Could not read that file — only .md, .markdown and .txt files can be linked.'
            )
            return
          }
          setPending({ file, path: absPath, content, wsId: null })
          return
        }
      } catch {
        // fall through to the web flow
      }
    }
    if (folderWorkspaces.length === 0) {
      setImportError(
        'Create a folder workspace first — a multi-space only gathers files that live in your other workspaces.'
      )
      return
    }
    setPending(folderWorkspaces.length === 1 ? { file, wsId: folderWorkspaces[0].id } : { file, wsId: null })
  }

  const isLink = multiModal === 'link'

  const groups = trees
    .map((t) => ({
      workspace: t.workspace,
      docs: t.docs
        .filter((d) => !d.is_deleted)
        .filter((d) => !linkedIds.has(d.id))
        .filter((d) => !q || d.title.toLowerCase().includes(q))
    }))
    .filter((g) => g.docs.length > 0)

  const empty = !isLink ? folderWorkspaces.length === 0 : groups.length === 0

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget) closeMultiModal()
      }}
    >
      <div className="modal multi-modal" role="dialog" aria-modal="true">
        <h3 className="modal-title">
          {isLink ? `Add a document to “${activeWorkspace.name}”` : `New page in “${activeWorkspace.name}”`}
        </h3>
        <p className="picker-title" style={{ marginTop: -8 }}>
          {isLink
            ? 'Pick a file from any of your workspaces — or drop in a file from your computer.'
            : multiModalFolderId != null
              ? 'The file will be created in the chosen workspace, then filed into this folder too.'
              : 'The file will be created in the chosen workspace, then appear here too.'}
        </p>

        {/* Import a local file: picker or drop. */}
        <div
          className={`import-zone${dropOver ? ' is-drag' : ''}`}
          onDragOver={(e) => {
            e.preventDefault()
            if (e.dataTransfer.types.includes('Files')) setDropOver(true)
          }}
          onDragLeave={() => setDropOver(false)}
          onDrop={(e) => {
            e.preventDefault()
            setDropOver(false)
            void queueFile(e.dataTransfer.files?.[0] ?? null)
          }}
          onClick={() => fileInputRef.current?.click()}
        >
          <input
            ref={fileInputRef}
            type="file"
            accept=".md,.markdown,.txt"
            hidden
            onChange={(e) => {
              void queueFile(e.target.files?.[0] ?? null)
              e.target.value = ''
            }}
          />
          {importing ? (
            <>
              <Loader2 size={18} className="spin" />
              <span>Importing “{pending?.file.name ?? '…'}”…</span>
            </>
          ) : (
            <>
              <UploadCloud size={18} />
              <span>
                Drop a file here, or <b>browse your computer</b>
              </span>
              <small>
                {bridge
                  ? 'Any text file — it stays exactly where it is on your computer and stays in sync.'
                  : 'Any text file — it gets a home in one of your workspaces and stays linked here.'}
              </small>
            </>
          )}
        </div>

        {importError && <div className="import-error">{importError}</div>}

        {pending && pending.wsId === null && !pending.path && !importing && (
          <div className="import-targets">
            <span className="import-targets-label">Where should “{pending.file.name}” live?</span>
            <div className="import-targets-row">
              {folderWorkspaces.map((w) => (
                <button
                  key={w.id}
                  type="button"
                  className="btn ghost picker-item import-target"
                  onClick={() => setPending({ ...pending, wsId: w.id })}
                  disabled={importing}
                >
                  <span className="picker-icon">
                    <FolderGlyph iconKey={w.icon_key} color={w.color_hex} size={15} />
                  </span>
                  <span className="picker-name">{w.name}</span>
                </button>
              ))}
            </div>
          </div>
        )}

        {isLink && (
          <div className="picker-search">
            <Search size={13} className="picker-search-icon" />
            <input
              autoFocus
              placeholder="Search documents…"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </div>
        )}

        <div className="multi-modal-list">
          {isLink ? (
            groups.length === 0 ? (
              <div className="picker-empty">
                {trees.some((t) => !t.loaded)
                  ? 'Loading…'
                  : q
                    ? 'No matching documents'
                    : 'Nothing to add — all your docs are already here'}
              </div>
            ) : (
              groups.map((g) => (
                <div key={g.workspace.id}>
                  <div className="multi-modal-group">
                    <FolderGlyph iconKey={g.workspace.icon_key} color={g.workspace.color_hex} size={13} />
                    <span>{g.workspace.name}</span>
                  </div>
                  {g.docs.map((d) => (
                    <button
                      key={d.id}
                      type="button"
                      className="picker-item"
                      onClick={() => void link(d.id)}
                      disabled={busy}
                    >
                      <span className="picker-icon">
                        <FileText size={14} />
                      </span>
                      <span className="picker-name">{d.title}</span>
                    </button>
                  ))}
                </div>
              ))
            )
          ) : folderWorkspaces.length === 0 ? (
            <div className="picker-empty">
              Create a folder workspace first — a multi-space only gathers files that live in your
              other workspaces.
            </div>
          ) : (
            folderWorkspaces.map((w) => (
              <button
                key={w.id}
                type="button"
                className="picker-item"
                onClick={() => void create(w.id)}
                disabled={busy}
              >
                <span className="picker-icon">
                  <FolderGlyph iconKey={w.icon_key} color={w.color_hex} size={15} />
                </span>
                <span className="picker-name">{w.name}</span>
              </button>
            ))
          )}
        </div>

        <div className="modal-actions">
          <button className="btn ghost" onClick={closeMultiModal}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  )
}

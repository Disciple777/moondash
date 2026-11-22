import { useEffect, useRef, useState, type FormEvent } from 'react'
import { FileCode2, FilePlus2, FileText, Loader2 } from 'lucide-react'
import { useApp } from '../state/AppContext'
import { toFileName, type NoteExt } from '../docNames'

const FORMATS: { id: NoteExt; label: string; hint: string; icon: typeof FileText }[] = [
  { id: '.md', label: 'Markdown', hint: 'Rich text, saved as .md', icon: FileCode2 },
  { id: '.txt', label: 'Plain text', hint: 'No formatting, saved as .txt', icon: FileText }
]

/**
 * Asks for a name before a page is created, instead of dropping an
 * "Untitled" file into the workspace. Opened by every "New page" button via
 * requestNewDoc(). The format picker chooses Markdown (the default) or plain
 * text; typing the extension in the name yourself overrides it.
 */
export function NewDocDialog() {
  const { newDocTarget, cancelNewDoc, createDoc, createDocInWorkspace, docs, workspaces } = useApp()
  const [name, setName] = useState('')
  const [ext, setExt] = useState<NoteExt>('.md')
  const [busy, setBusy] = useState(false)
  const inputRef = useRef<HTMLInputElement | null>(null)

  useEffect(() => {
    if (!newDocTarget) return
    setName('')
    setExt('.md')
    setBusy(false)
    inputRef.current?.focus()
  }, [newDocTarget])

  if (!newDocTarget) return null

  const fileName = toFileName(name, ext)
  // Only checkable for the active workspace — in the multi-space flow the file
  // lives in another workspace, where createDocInWorkspace de-duplicates.
  const exists =
    newDocTarget.workspaceId === null &&
    fileName !== '' &&
    docs.some((d) => !d.is_deleted && d.relative_path.toLowerCase() === fileName.toLowerCase())
  const home =
    newDocTarget.workspaceId !== null ? workspaces.find((w) => w.id === newDocTarget.workspaceId) : null

  const submit = async (e: FormEvent) => {
    e.preventDefault()
    if (busy || fileName === '' || exists) return
    setBusy(true)
    const target = newDocTarget
    try {
      // Pass the resolved file name so the chosen format is what gets created.
      if (target.workspaceId !== null) {
        await createDocInWorkspace(target.workspaceId, target.folderId, fileName)
      } else {
        await createDoc(target.folderId, fileName)
      }
    } finally {
      cancelNewDoc()
    }
  }

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(e) => {
        if (e.target === e.currentTarget && !busy) cancelNewDoc()
      }}
    >
      <form
        className="modal new-doc-modal"
        onSubmit={submit}
        onKeyDown={(e) => {
          if (e.key === 'Escape' && !busy) cancelNewDoc()
        }}
      >
        <h3 className="modal-title">
          <FilePlus2 size={16} /> New page
        </h3>
        <label className="dialog-label" htmlFor="new-doc-name">
          Name
        </label>
        <input
          id="new-doc-name"
          ref={inputRef}
          autoFocus
          className="lock-input"
          value={name}
          placeholder="e.g. Meeting notes"
          autoComplete="off"
          spellCheck={false}
          onChange={(e) => setName(e.target.value)}
          disabled={busy}
        />
        <div className="new-doc-formats" role="radiogroup" aria-label="Format">
          {FORMATS.map(({ id, label, hint, icon: Icon }) => (
            <button
              key={id}
              type="button"
              role="radio"
              aria-checked={ext === id}
              title={hint}
              className={`new-doc-format${ext === id ? ' is-active' : ''}`}
              onClick={() => setExt(id)}
              disabled={busy}
            >
              <Icon size={13} /> {label}
            </button>
          ))}
        </div>
        <p className={`new-doc-hint${exists ? ' is-error' : ''}`}>
          {fileName === ''
            ? ext === '.md'
              ? 'Markdown — headings, lists and formatting.'
              : 'Plain text — no formatting, just the words.'
            : exists
              ? `A page called “${fileName}” already exists here.`
              : `Saved as ${fileName}${home ? ` in ${home.name}` : ''}`}
        </p>
        <div className="modal-actions">
          <button type="button" className="btn ghost" onClick={cancelNewDoc} disabled={busy}>
            Cancel
          </button>
          <button type="submit" className="btn primary" disabled={busy || fileName === '' || exists}>
            {busy ? <Loader2 size={14} className="spin" /> : null}
            Create page
          </button>
        </div>
      </form>
    </div>
  )
}

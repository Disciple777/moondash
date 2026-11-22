import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import CharacterCount from '@tiptap/extension-character-count'
import {
  AlertTriangle,
  Bold,
  Braces,
  Check,
  ChevronDownSquare,
  CloudOff,
  Code2,
  Folder as FolderIcon,
  FolderOpen,
  Heading1,
  Heading2,
  Heading3,
  Home,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Palette,
  Pencil,
  Plus,
  Quote,
  Redo2,
  SquareCode,
  Strikethrough,
  Tag,
  Underline as UnderlineIcon,
  Undo2,
  Lock,
  LockOpen,
  X
} from 'lucide-react'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { SlashMenu } from './SlashMenu'
import { FolderPicker } from './FolderPicker'
import { TextColor } from '../extensions/TextColor'
import { Underline } from '../extensions/Underline'
import { BlockDrag } from '../extensions/BlockDrag'
import { DateShortcut } from '../extensions/DateShortcut'
import { Toggle } from '../extensions/Toggle'
import { TaskBackspace } from '../extensions/TaskBackspace'
import { MarkdownFidelity } from '../extensions/MarkdownFidelity'
import { useApp } from '../state/AppContext'
import { ProtectDialog } from './NoteLock'
import { PlainTextArea, isPlainTextPath, lineEndingOf, withLineEnding } from './PlainTextArea'
import { FindBar, textMatches } from './FindBar'
import { FindHighlight, findState } from '../extensions/FindHighlight'
import type { DocNode } from '../types'

const TEXT_COLORS: { name: string; value: string }[] = [
  { name: 'Red', value: '#e5484d' },
  { name: 'Orange', value: '#f76b15' },
  { name: 'Yellow', value: '#f5a623' },
  { name: 'Green', value: '#30a46c' },
  { name: 'Blue', value: '#3e63dd' },
  { name: 'Purple', value: '#8e4ec6' },
  { name: 'Pink', value: '#d6409f' },
  { name: 'Brown', value: '#a8653f' },
  { name: 'Gray', value: '#8f8f8f' }
]

function ToolbarButton({
  onClick,
  active,
  disabled,
  title,
  children
}: {
  onClick: (e: ReactMouseEvent<HTMLButtonElement>) => void
  active?: boolean
  disabled?: boolean
  title: string
  children: ReactNode
}) {
  return (
    <button
      type="button"
      className={`tb-btn${active ? ' is-active' : ''}`}
      onClick={onClick}
      onMouseDown={(e) => e.preventDefault()}
      disabled={disabled}
      title={title}
    >
      {children}
    </button>
  )
}

export function Editor({ doc }: { doc: DocNode }) {
  const { activeDocContent, activeDocProtected, saveDoc, saveStatus, renameDoc, setDocAlias, folders, memberships, removeDocFromFolder, closeDoc } = useApp()
  // .txt files are edited as plain text and saved byte-for-byte; running them
  // through the markdown pipeline would add escapes (`array[0]` → `array\[0\]`).
  const plainText = isPlainTextPath(doc.relative_path)
  const [rawView, setRawView] = useState(plainText)
  const [rawText, setRawText] = useState(plainText ? activeDocContent : '')
  const rawTimerRef = useRef<number | null>(null)
  const lastSavedRef = useRef<string>('')
  const timerRef = useRef<number | null>(null)
  // The latest edit not yet written, so leaving the note mid-debounce (clicking
  // another page, going home) still saves it instead of dropping it.
  const pendingRef = useRef<string | null>(null)
  // The file's own line-ending style, re-applied to everything saved.
  const eolRef = useRef(lineEndingOf(activeDocContent))
  const persist = (text: string) => withLineEnding(text, eolRef.current)
  const [title, setTitle] = useState(doc.title)
  const [renaming, setRenaming] = useState(false)
  // The doc's "second name" (934): a label the app shows for it, stored in the
  // cloud so it follows the doc across devices. Editing it never touches the
  // file, so the heading above keeps showing the real file name.
  const [aliasing, setAliasing] = useState(false)
  const [aliasDraft, setAliasDraft] = useState('')
  // The name the user just committed, shown until the tree catches up. A rename
  // is two round-trips (save, then refresh) and the doc can come back with the
  // server's "Untitled" fallback in between, which used to flash on screen.
  const [pendingTitle, setPendingTitle] = useState<string | null>(null)
  // Find-in-page (Ctrl+F). The query lives here; the matches live in the
  // editor's own plugin state (rich view) or are recomputed from the text
  // (raw / plain view), so a search is never part of the saved document.
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [rawFindIndex, setRawFindIndex] = useState(0)
  const rawRef = useRef<HTMLTextAreaElement | null>(null)
  const [stats, setStats] = useState({ words: 0, chars: 0 })
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null)
  const [showFolderChips, setShowFolderChips] = useState(false)
  const [showProtect, setShowProtect] = useState(false)
  const [colorPos, setColorPos] = useState<{ x: number; y: number } | null>(null)
  const addChipRef = useRef<HTMLButtonElement | null>(null)

  const editor = useEditor({
    extensions: [
      // TaskBackspace + Toggle must come BEFORE StarterKit so their keyboard
      // shortcuts win over the base keymap (StarterKit's splitBlock/backspace
      // would otherwise swallow Enter-on-toggle-title and empty-task deletion).
      TaskBackspace,
      Toggle,
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        // Per-node ghost placeholders: an empty toggle title shows a faint
        // "Toggle heading" prompt; the editor's own placeholder only when the
        // whole document is empty.
        placeholder: ({ editor, node, pos }) => {
          if (node.type.name === 'paragraph' && node.content.size === 0) {
            const $pos = editor.state.doc.resolve(pos)
            const parent = $pos.depth > 0 ? $pos.node($pos.depth - 1) : null
            if (parent?.type.name === 'toggle' && $pos.index($pos.depth - 1) === 0) {
              return 'Toggle heading'
            }
            if (editor.isEmpty) return "Type '/' for commands, or start writing…"
          }
          return ''
        }
      }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Table.configure({ resizable: false }),
      TableRow,
      TableCell,
      TableHeader,
      Link.configure({ openOnClick: false, autolink: true }),
      // html: true lets custom marks (text color) round-trip through the
      // markdown as <span style="color:…">. Plain markdown is unchanged.
      // breaks: a newline inside a paragraph is a real line break (see MarkdownFidelity).
      Markdown.configure({ html: true, breaks: true, transformPastedText: true, transformCopiedText: true }),
      MarkdownFidelity,
      CharacterCount,
      SlashMenu,
      TextColor,
      Underline,
      FindHighlight,
      BlockDrag,
      DateShortcut
    ],
    content: activeDocContent,
    editorProps: {
      attributes: { class: 'md-editor', spellcheck: 'false' }
    },
    // Word/character counts for the footer from the start, not only after the first edit.
    onCreate: ({ editor }) =>
      setStats({ words: editor.storage.characterCount.words(), chars: editor.storage.characterCount.characters() }),
    onUpdate: ({ editor }) => {
      const md = persist((editor.storage.markdown.getMarkdown() as string) ?? '')
      setStats({
        words: editor.storage.characterCount.words(),
        chars: editor.storage.characterCount.characters()
      })
      if (md === lastSavedRef.current) return
      pendingRef.current = md
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        void saveDoc(doc.id, md).then(() => {
          lastSavedRef.current = md
          if (pendingRef.current === md) pendingRef.current = null
        })
      }, 900)
    }
  })

  // Reset local state when switching docs (component is keyed by doc.id).
  useEffect(() => {
    setTitle(doc.title)
    setRenaming(false)
    setPendingTitle(null)
    setFindOpen(false)
    setFindQuery('')
    lastSavedRef.current = activeDocContent
    eolRef.current = lineEndingOf(activeDocContent)
    pendingRef.current = null
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (plainText) setRawText(activeDocContent)
    if (editor) {
      editor.commands.setContent(activeDocContent || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      if (rawTimerRef.current !== null) window.clearTimeout(rawTimerRef.current)
      // Flush instead of dropping: the debounce may not have fired yet.
      const pending = pendingRef.current
      if (pending !== null && pending !== lastSavedRef.current) void saveDoc(doc.id, pending)
    }
    // Mount-time closure on purpose: saveDoc must target this doc's workspace
    // even if the unmount was caused by switching to another one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Drop the optimistic title as soon as the tree reports it. The timeout is a
  // safety net: if the rename silently failed, stop lying about the name.
  useEffect(() => {
    if (pendingTitle === null) return
    if (doc.title === pendingTitle) {
      setPendingTitle(null)
      setTitle(pendingTitle)
      return
    }
    const t = window.setTimeout(() => setPendingTitle(null), 8000)
    return () => window.clearTimeout(t)
  }, [doc.title, pendingTitle])

  /** What the heading shows — the committed name wins while it is in flight. */
  const shownTitle = pendingTitle ?? doc.title

  const commitAlias = () => {
    setAliasing(false)
    if (aliasDraft.trim() === (doc.alias ?? '')) return
    void setDocAlias(doc.id, aliasDraft)
  }

  // Ctrl/Cmd+F opens the find bar instead of the browser's own, which cannot
  // see past the virtualised rich editor anyway.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f' || e.altKey) return
      e.preventDefault()
      setFindOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const docFolderIds = useMemo(
    () => memberships.filter((m) => m.item_id === doc.id).map((m) => m.folder_id),
    [memberships, doc.id]
  )
  const docFolders = useMemo(() => {
    const byId = new Map(folders.map((f) => [f.bit_id, f]))
    return docFolderIds.map((id) => byId.get(id)).filter((f): f is NonNullable<typeof f> => !!f)
  }, [folders, docFolderIds])

  if (!editor) {
    return <div className="editor-loading">Loading editor…</div>
  }

  const commitTitle = () => {
    if (!renaming) return
    setRenaming(false)
    const clean = title.replace(/[/\\]+/g, '-').trim()
    if (clean && clean !== doc.title) {
      // Keep showing what was typed until the refreshed tree agrees, so the
      // title never blinks through the server's "Untitled" fallback.
      setPendingTitle(clean)
      void renameDoc(doc.id, clean).catch(() => setPendingTitle(null))
    } else {
      setTitle(doc.title)
    }
  }

  const openFolderPicker = () => {
    const rect = addChipRef.current?.getBoundingClientRect()
    setPickerPos(rect ? { x: rect.left, y: rect.bottom + 6 } : null)
  }

  const setLink = () => {
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', previous ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const activeColor = (editor.getAttributes('textColor').color as string | undefined) ?? undefined

  const setTextColor = (color: string | null) => {
    if (color) {
      editor.chain().focus().extendMarkRange('textColor').setMark('textColor', { color }).run()
    } else {
      editor.chain().focus().extendMarkRange('textColor').unsetMark('textColor').run()
    }
    setColorPos(null)
  }

  const openColorPicker = (e: ReactMouseEvent<HTMLButtonElement>) => {
    const rect = e.currentTarget.getBoundingClientRect()
    setColorPos({ x: rect.left, y: rect.bottom + 6 })
  }

  // ---- find in page ----------------------------------------------------
  const rawMatches = useMemo(
    () => (rawView ? textMatches(rawText, findQuery) : []),
    [rawView, rawText, findQuery]
  )
  const richFind = editor ? findState(editor.state) : null
  const findCount = rawView ? rawMatches.length : (richFind?.matches.length ?? 0)
  const findIndex = rawView
    ? rawMatches.length === 0
      ? -1
      : Math.min(rawFindIndex, rawMatches.length - 1)
    : (richFind?.index ?? -1)

  // Push the query into the rich editor, which highlights the matches itself.
  useEffect(() => {
    if (!editor || rawView) return
    editor.commands.setFindQuery(findOpen ? findQuery : '')
  }, [editor, rawView, findOpen, findQuery])

  /** Bring match `i` into view: select it in the textarea, scroll to it in the rich editor. */
  const revealMatch = (i: number) => {
    if (rawView) {
      const hit = rawMatches[i]
      const el = rawRef.current
      if (!hit || !el) return
      el.focus()
      el.setSelectionRange(hit[0], hit[1])
      // The textarea grows with its content, so the page scrolls, not the box.
      const before = rawText.slice(0, hit[0]).split('\n').length - 1
      const lineHeight = parseFloat(getComputedStyle(el).lineHeight) || 24
      const scroller = el.closest('.main') as HTMLElement | null
      scroller?.scrollTo({ top: Math.max(0, el.offsetTop + before * lineHeight - 160), behavior: 'smooth' })
      return
    }
    if (!editor) return
    const hit = findState(editor.state).matches[i]
    if (!hit) return
    const dom = editor.view.domAtPos(hit.from).node
    const el = dom instanceof HTMLElement ? dom : dom.parentElement
    el?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const stepFind = (delta: 1 | -1) => {
    if (findCount === 0) return
    const next = ((findIndex + delta) % findCount + findCount) % findCount
    if (rawView) setRawFindIndex(next)
    else editor?.commands.setFindIndex(next)
    // The decoration/selection has to exist before it can be scrolled to.
    window.setTimeout(() => revealMatch(next), 0)
  }

  const closeFind = () => {
    setFindOpen(false)
    setFindQuery('')
    if (!rawView) editor?.commands.setFindQuery('')
  }

  const toggleRawView = () => {
    if (rawView) {
      // Exiting raw view: always push the edited markdown back into TipTap
      // and save, regardless of whether the auto-save timer already ran.
      if (editor) {
        editor.commands.setContent(rawText)
        const text = persist(rawText)
        pendingRef.current = text
        if (rawTimerRef.current !== null) window.clearTimeout(rawTimerRef.current)
        rawTimerRef.current = window.setTimeout(() => {
          void saveDoc(doc.id, text).then(() => {
            lastSavedRef.current = text
            if (pendingRef.current === text) pendingRef.current = null
          })
        }, 300)
      }
      setRawView(false)
    } else {
      // Entering raw view: extract the current markdown
      const md = (editor?.storage.markdown.getMarkdown() as string) ?? ''
      setRawText(md)
      setRawView(true)
    }
  }

  // Auto-save while typing in raw view
  const handleRawChange = (value: string) => {
    setRawText(value)
    const text = persist(value)
    pendingRef.current = text
    if (rawTimerRef.current !== null) window.clearTimeout(rawTimerRef.current)
    rawTimerRef.current = window.setTimeout(() => {
      void saveDoc(doc.id, text).then(() => {
        lastSavedRef.current = text
        if (pendingRef.current === text) pendingRef.current = null
      })
    }, 900)
  }

  return (
    <div className="doc-view">
      <div className="doc-toolbar">
        <div className="doc-toolbar-left">
          <ToolbarButton title="Back to workspace" onClick={() => closeDoc()}>
            <Home size={16} />
          </ToolbarButton>
          <span className="tb-sep" />
          {rawView ? (
            <span className="tb-mode">{plainText ? 'Plain text' : 'Raw markdown'}</span>
          ) : (
          <>
          <ToolbarButton title="Undo" onClick={() => editor.chain().focus().undo().run()} disabled={!editor.can().undo()}>
            <Undo2 size={16} />
          </ToolbarButton>
          <ToolbarButton title="Redo" onClick={() => editor.chain().focus().redo().run()} disabled={!editor.can().redo()}>
            <Redo2 size={16} />
          </ToolbarButton>
          <span className="tb-sep" />
          <ToolbarButton title="Heading 1" active={editor.isActive('heading', { level: 1 })} onClick={() => editor.chain().focus().toggleHeading({ level: 1 }).run()}>
            <Heading1 size={16} />
          </ToolbarButton>
          <ToolbarButton title="Heading 2" active={editor.isActive('heading', { level: 2 })} onClick={() => editor.chain().focus().toggleHeading({ level: 2 }).run()}>
            <Heading2 size={16} />
          </ToolbarButton>
          <ToolbarButton title="Heading 3" active={editor.isActive('heading', { level: 3 })} onClick={() => editor.chain().focus().toggleHeading({ level: 3 }).run()}>
            <Heading3 size={16} />
          </ToolbarButton>
          <span className="tb-sep" />
          <ToolbarButton title="Bold" active={editor.isActive('bold')} onClick={() => editor.chain().focus().toggleBold().run()}>
            <Bold size={16} />
          </ToolbarButton>
          <ToolbarButton title="Italic" active={editor.isActive('italic')} onClick={() => editor.chain().focus().toggleItalic().run()}>
            <Italic size={16} />
          </ToolbarButton>
          <ToolbarButton title="Underline (Ctrl+U)" active={editor.isActive('underline')} onClick={() => editor.chain().focus().toggleUnderline().run()}>
            <UnderlineIcon size={16} />
          </ToolbarButton>
          <ToolbarButton title="Strikethrough" active={editor.isActive('strike')} onClick={() => editor.chain().focus().toggleStrike().run()}>
            <Strikethrough size={16} />
          </ToolbarButton>
          <ToolbarButton title="Inline code" active={editor.isActive('code')} onClick={() => editor.chain().focus().toggleCode().run()}>
            <Braces size={16} />
          </ToolbarButton>
          <span className="tb-sep" />
          <ToolbarButton title="Bullet list" active={editor.isActive('bulletList')} onClick={() => editor.chain().focus().toggleBulletList().run()}>
            <List size={16} />
          </ToolbarButton>
          <ToolbarButton title="Numbered list" active={editor.isActive('orderedList')} onClick={() => editor.chain().focus().toggleOrderedList().run()}>
            <ListOrdered size={16} />
          </ToolbarButton>
          <ToolbarButton title="To-do list" active={editor.isActive('taskList')} onClick={() => editor.chain().focus().toggleTaskList().run()}>
            <ListChecks size={16} />
          </ToolbarButton>
          <ToolbarButton title="Toggle list" active={editor.isActive('toggle')} onClick={() => editor.chain().focus().setToggle().run()}>
            <ChevronDownSquare size={16} />
          </ToolbarButton>
          <ToolbarButton title="Quote" active={editor.isActive('blockquote')} onClick={() => editor.chain().focus().toggleBlockquote().run()}>
            <Quote size={16} />
          </ToolbarButton>
          <ToolbarButton title="Code block" active={editor.isActive('codeBlock')} onClick={() => editor.chain().focus().toggleCodeBlock().run()}>
            <Code2 size={16} />
          </ToolbarButton>
          <ToolbarButton title="Link" active={editor.isActive('link')} onClick={setLink}>
            <LinkIcon size={16} />
          </ToolbarButton>
          <ToolbarButton title="Text color" active={!!activeColor} onClick={openColorPicker}>
            <Palette size={16} />
            {activeColor && <span className="tb-color-dot" style={{ background: activeColor }} />}
          </ToolbarButton>
          </>
          )}
        </div>
        <div className="doc-toolbar-right">
          <ToolbarButton
            title={activeDocProtected ? 'Password-protected — click to remove' : 'Protect with a password'}
            active={activeDocProtected}
            onClick={() => setShowProtect(true)}
          >
            {activeDocProtected ? <Lock size={15} /> : <LockOpen size={15} />}
          </ToolbarButton>
          <ToolbarButton
            title="Folder options"
            active={showFolderChips}
            onClick={() => setShowFolderChips((v) => !v)}
          >
            {showFolderChips ? <FolderOpen size={15} /> : <FolderIcon size={15} />}
          </ToolbarButton>
          {!plainText && (
            <ToolbarButton
              title={rawView ? 'Rich view' : 'Raw markdown view'}
              active={rawView}
              onClick={toggleRawView}
            >
              <SquareCode size={15} />
            </ToolbarButton>
          )}
          <span className="tb-sep" />
          <span className={`save-status save-${saveStatus}`}>
            {saveStatus === 'saving' && (
              <>
                <Loader2 size={13} className="spin" /> Saving…
              </>
            )}
            {saveStatus === 'saved' && (
              <>
                <Check size={13} /> Saved
              </>
            )}
            {saveStatus === 'error' && (
              <>
                <AlertTriangle size={13} /> Couldn't save
              </>
            )}
            {saveStatus === 'idle' && (
              <>
                <CloudOff size={13} /> Not saved yet
              </>
            )}
          </span>
        </div>
      </div>

      <div className="doc-body">
        {showFolderChips && (
          <div className="doc-folders">
            {docFolders.map((f) => (
              <span key={f.bit_id} className="doc-folder-chip" style={{ borderColor: f.color_hex, color: f.color_hex }}>
                <span className="doc-folder-dot" style={{ background: f.color_hex }} />
                {f.name}
                <button
                  className="doc-folder-x"
                  title="Remove from folder"
                  onClick={() => void removeDocFromFolder(doc.id, f.bit_id)}
                >
                  <X size={11} />
                </button>
              </span>
            ))}
            <button ref={addChipRef} className="doc-folder-chip add" onClick={openFolderPicker}>
              <Plus size={11} /> Add to folder
            </button>
          </div>
        )}
        <FolderPicker docId={doc.id} position={pickerPos} onClose={() => setPickerPos(null)} />
        {showProtect && (
          <ProtectDialog
            markdown={persist(rawView ? rawText : ((editor?.storage.markdown.getMarkdown() as string) ?? ''))}
            onClose={() => setShowProtect(false)}
          />
        )}
        {colorPos && (
          <>
            <div className="color-backdrop" onClick={() => setColorPos(null)} />
            <div
              className="color-popover"
              style={{
                left: Math.min(colorPos.x, window.innerWidth - 236),
                top: Math.min(colorPos.y, window.innerHeight - 320)
              }}
            >
              <button type="button" className="color-item" onClick={() => setTextColor(null)}>
                <span className="color-swatch clear" />
                Default
              </button>
              {TEXT_COLORS.map((c) => (
                <button
                  key={c.value}
                  type="button"
                  className={`color-item${activeColor === c.value ? ' is-active' : ''}`}
                  onClick={() => setTextColor(c.value)}
                >
                  <span className="color-swatch" style={{ background: c.value }} />
                  {c.name}
                  {activeColor === c.value && <Check size={12} className="color-check" />}
                </button>
              ))}
            </div>
          </>
        )}
        <div className="doc-title-row">
          {renaming ? (
            <input
              className="doc-title-input"
              autoFocus
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitTitle()
                if (e.key === 'Escape') {
                  setTitle(doc.title)
                  setRenaming(false)
                }
              }}
            />
          ) : (
            <>
              <h1
                className="doc-title"
                onDoubleClick={() => setRenaming(true)}
                title="Double-click or click the pencil to rename"
              >
                {shownTitle}
              </h1>
              <button
                className="icon-btn doc-title-edit"
                title="Rename file"
                onClick={() => setRenaming(true)}
              >
                <Pencil size={15} />
              </button>
            </>
          )}
        </div>

        <div className="doc-alias-row">
          {aliasing ? (
            <input
              className="doc-alias-input"
              autoFocus
              placeholder="Second name (leave empty to clear)"
              aria-label="Second name"
              value={aliasDraft}
              onChange={(e) => setAliasDraft(e.target.value)}
              onBlur={commitAlias}
              onKeyDown={(e) => {
                if (e.key === 'Enter') commitAlias()
                if (e.key === 'Escape') setAliasing(false)
              }}
            />
          ) : (
            <button
              className={`doc-alias${doc.alias ? ' is-set' : ''}`}
              title="A second name for this page. The file keeps its own name."
              onClick={() => {
                setAliasDraft(doc.alias ?? '')
                setAliasing(true)
              }}
            >
              <Tag size={12} />
              {doc.alias ? doc.alias : 'Add a second name'}
            </button>
          )}
        </div>

        {findOpen && (
          <FindBar
            query={findQuery}
            onQuery={(q) => {
              setFindQuery(q)
              setRawFindIndex(0)
            }}
            count={findCount}
            current={findIndex}
            onNext={() => stepFind(1)}
            onPrev={() => stepFind(-1)}
            onClose={closeFind}
          />
        )}

        {rawView ? (
          <PlainTextArea
            innerRef={rawRef}
            className={plainText ? 'plain-editor' : 'raw-editor'}
            value={rawText}
            onChange={handleRawChange}
            tabText={plainText ? '\t' : '  '}
            placeholder={plainText ? 'Start writing…' : undefined}
          />
        ) : (
          <EditorContent editor={editor} />
        )}

        <div className="doc-footer">
          {rawView ? (
            <>
              <span>{plainText ? 'Plain text file' : 'Raw markdown view'}</span>
              <span className="dot">·</span>
              <span>{rawText === '' ? 0 : rawText.split('\n').length} lines</span>
              <span className="dot">·</span>
              <span>{rawText.length} characters</span>
            </>
          ) : (
            <>
              <span>{stats.words} words</span>
              <span className="dot">·</span>
              <span>{stats.chars} characters</span>
            </>
          )}
        </div>
      </div>
    </div>
  )
}

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
  ArrowLeft,
  Bold,
  Braces,
  Check,
  ChevronDownSquare,
  CloudOff,
  Code2,
  FileText,
  Folder as FolderIcon,
  FolderOpen,
  FolderPlus,
  Heading1,
  Heading2,
  Heading3,
  Italic,
  Link as LinkIcon,
  List,
  ListChecks,
  ListOrdered,
  Loader2,
  Palette,
  Plus,
  Quote,
  Redo2,
  Save,
  SquareCode,
  Strikethrough,
  Undo2,
  X
} from 'lucide-react'
import { Table } from '@tiptap/extension-table'
import { TableRow } from '@tiptap/extension-table-row'
import { TableCell } from '@tiptap/extension-table-cell'
import { TableHeader } from '@tiptap/extension-table-header'
import { SlashMenu } from './SlashMenu'
import { TextColor } from '../extensions/TextColor'
import { Underline } from '../extensions/Underline'
import { BlockDrag } from '../extensions/BlockDrag'
import { DateShortcut } from '../extensions/DateShortcut'
import { Toggle } from '../extensions/Toggle'
import { TaskBackspace } from '../extensions/TaskBackspace'
import { MarkdownFidelity } from '../extensions/MarkdownFidelity'
import { useApp } from '../state/AppContext'
import { PlainTextArea, isPlainTextPath, lineEndingOf, withLineEnding } from './PlainTextArea'
import { FindBar, textMatches } from './FindBar'
import { FindHighlight, findState } from '../extensions/FindHighlight'

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

export function QuickOpenEditor() {
  const {
    quickOpenFile,
    quickOpenTabs,
    switchQuickTab,
    closeQuickTab,
    saveQuickFile,
    closeQuickOpen,
    addToMultiFromQuick,
    saveStatus,
    workspaces,
    error
  } = useApp()

  const lastSavedRef = useRef<string>('')
  // Latest edit and the file it belongs to, so an unmount mid-debounce (e.g.
  // the user clicks a workspace page) can still flush the write to disk.
  const pendingRef = useRef<string | null>(null)
  const absPathRef = useRef<string | null>(null)
  // The file's own line-ending style (files opened from Explorer are often
  // CRLF), re-applied to everything written back.
  const eolRef = useRef(lineEndingOf(quickOpenFile?.content ?? ''))
  const persist = (text: string) => withLineEnding(text, eolRef.current)
  const timerRef = useRef<number | null>(null)
  const rawTimerRef = useRef<number | null>(null)
  // .txt files are edited as plain text and written back byte-for-byte.
  const plainText = isPlainTextPath(quickOpenFile?.fileName)
  const [rawView, setRawView] = useState(plainText)
  const [rawText, setRawText] = useState(plainText ? (quickOpenFile?.content ?? '') : '')
  const [stats, setStats] = useState({ words: 0, chars: 0 })
  const [showAddMenu, setShowAddMenu] = useState(false)
  const [colorPos, setColorPos] = useState<{ x: number; y: number } | null>(null)
  // Find-in-page (Ctrl+F) — same approach as the workspace editor: the query
  // is local state, the matches are decorations, nothing reaches the file.
  const [findOpen, setFindOpen] = useState(false)
  const [findQuery, setFindQuery] = useState('')
  const [rawFindIndex, setRawFindIndex] = useState(0)
  const rawRef = useRef<HTMLTextAreaElement | null>(null)

  const multiSpaces = useMemo(
    () => workspaces.filter((w) => w.type === 'multi'),
    [workspaces]
  )

  const editor = useEditor({
    extensions: [
      TaskBackspace,
      Toggle,
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
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
    content: quickOpenFile?.content ?? '',
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
        void saveQuickFile(md).then(() => {
          lastSavedRef.current = md
        })
      }, 900)
    }
  })


  // Load the file's content when a DIFFERENT file is opened. Keyed on the path,
  // not the file object: saveQuickFile updates quickOpenFile.content on every
  // save, and re-running this then would reset the editor (cursor jumping to
  // the top) about a second after each pause in typing.
  const openPath = quickOpenFile?.absPath ?? null
  useEffect(() => {
    if (!editor || !quickOpenFile) return
    editor.commands.setContent(quickOpenFile.content)
    lastSavedRef.current = quickOpenFile.content
    eolRef.current = lineEndingOf(quickOpenFile.content)
    pendingRef.current = null
    const plain = isPlainTextPath(quickOpenFile.fileName)
    setRawView(plain)
    if (plain) setRawText(quickOpenFile.content)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [editor, openPath])

  // Keep the path available to the unmount flush below, which runs after the
  // context has already cleared quickOpenFile.
  useEffect(() => {
    if (quickOpenFile) absPathRef.current = quickOpenFile.absPath
  }, [quickOpenFile])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      if (rawTimerRef.current !== null) window.clearTimeout(rawTimerRef.current)
      // Debounced save still in flight — write it straight to disk rather than
      // dropping the edit. Goes through the bridge directly because
      // saveQuickFile reads quickOpenFile, which is null by now.
      const pending = pendingRef.current
      const absPath = absPathRef.current
      if (pending !== null && absPath && pending !== lastSavedRef.current) {
        void window.moondash?.writeExternal(absPath, pending)
      }
    }
  }, [])

  if (!quickOpenFile) return null

  const handleAddToMulti = (multiWsId: number) => {
    setShowAddMenu(false)
    void addToMultiFromQuick(multiWsId)
  }

  const setLink = () => {
    if (!editor) return
    const previous = editor.getAttributes('link').href as string | undefined
    const url = window.prompt('Link URL', previous ?? 'https://')
    if (url === null) return
    if (url === '') {
      editor.chain().focus().extendMarkRange('link').unsetLink().run()
      return
    }
    editor.chain().focus().extendMarkRange('link').setLink({ href: url }).run()
  }

  const activeColor = editor ? ((editor.getAttributes('textColor').color as string | undefined) ?? undefined) : undefined

  const setTextColor = (color: string | null) => {
    if (!editor) return
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

  useEffect(() => {
    if (!editor || rawView) return
    editor.commands.setFindQuery(findOpen ? findQuery : '')
  }, [editor, rawView, findOpen, findQuery])

  const revealMatch = (i: number) => {
    if (rawView) {
      const hit = rawMatches[i]
      const el = rawRef.current
      if (!hit || !el) return
      el.focus()
      el.setSelectionRange(hit[0], hit[1])
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
    window.setTimeout(() => revealMatch(next), 0)
  }

  const closeFind = () => {
    setFindOpen(false)
    setFindQuery('')
    if (!rawView) editor?.commands.setFindQuery('')
  }

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey) || e.key.toLowerCase() !== 'f' || e.altKey) return
      e.preventDefault()
      setFindOpen(true)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const toggleRawView = () => {
    if (!editor) return
    if (rawView) {
      editor.commands.setContent(rawText)
      const text = persist(rawText)
      pendingRef.current = text
      if (rawTimerRef.current !== null) window.clearTimeout(rawTimerRef.current)
      rawTimerRef.current = window.setTimeout(() => {
        void saveQuickFile(text).then(() => {
          lastSavedRef.current = text
        })
      }, 300)
      setRawView(false)
    } else {
      const md = (editor.storage.markdown.getMarkdown() as string) ?? ''
      setRawText(md)
      setRawView(true)
    }
  }

  const handleRawChange = (value: string) => {
    setRawText(value)
    const text = persist(value)
    pendingRef.current = text
    if (rawTimerRef.current !== null) window.clearTimeout(rawTimerRef.current)
    rawTimerRef.current = window.setTimeout(() => {
      void saveQuickFile(text).then(() => {
        lastSavedRef.current = text
      })
    }, 900)
  }

  if (!editor) {
    return <div className="editor-loading">Loading editor…</div>
  }

  return (
    <div className="doc-view">
      <div className="doc-toolbar">
        <div className="doc-toolbar-left">
          <ToolbarButton title="Back" onClick={() => closeQuickOpen()}>
            <ArrowLeft size={16} />
          </ToolbarButton>
          <span className="tb-sep" />
          {/* Formatting acts on the rich editor, which is hidden in raw / plain
              mode — and its autosave would overwrite the text being edited. */}
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

      {/* Quick-open banner */}
      {quickOpenTabs.length > 1 && (
        <div className="quick-tabs" role="tablist" aria-label="Open files">
          {quickOpenTabs.map((tab) => {
            const active = tab.absPath === quickOpenFile.absPath
            return (
              <div
                key={tab.absPath}
                className={`quick-tab${active ? ' is-active' : ''}`}
                title={tab.absPath}
              >
                <button
                  type="button"
                  role="tab"
                  aria-selected={active}
                  className="quick-tab-name"
                  onClick={() => switchQuickTab(tab.absPath)}
                >
                  <FileText size={12} /> {tab.fileName}
                </button>
                <button
                  type="button"
                  className="quick-tab-close"
                  aria-label={`Close ${tab.fileName}`}
                  title="Close this file"
                  onClick={() => closeQuickTab(tab.absPath)}
                >
                  <X size={11} />
                </button>
              </div>
            )
          })}
        </div>
      )}

      <div className="quick-open-banner">
        <div className="quick-open-info">
          <FileText size={14} />
          <span className="quick-open-filename">{quickOpenFile.fileName}</span>
          <span className="quick-open-path" title={quickOpenFile.absPath}>
            {quickOpenFile.absPath}
          </span>
        </div>
        <div className="quick-open-actions">
          <button
            type="button"
            className="quick-open-btn save"
            onClick={() => {
              if (!editor) return
              const text = persist(
                rawView ? rawText : ((editor.storage.markdown.getMarkdown() as string) ?? '')
              )
              void saveQuickFile(text).then(() => {
                lastSavedRef.current = text
              })
            }}
            title="Save to disk"
          >
            <Save size={13} /> Save
          </button>
          <div className="quick-add-wrapper">
            <button
              type="button"
              className="quick-open-btn add"
              onClick={() => setShowAddMenu(!showAddMenu)}
              title="Add this file to a multi-space"
            >
              <FolderPlus size={13} /> Add to Space
            </button>
            {showAddMenu && (
              <div className="quick-add-menu">
                {multiSpaces.length === 0 ? (
                  <div className="quick-add-empty">
                    No multi-spaces yet. Create one first.
                  </div>
                ) : (
                  multiSpaces.map((ws) => (
                    <button
                      key={ws.id}
                      type="button"
                      className="quick-add-item"
                      onClick={() => handleAddToMulti(ws.id)}
                      style={{ color: ws.color_hex || undefined }}
                    >
                      {ws.icon_key ? ` ${ws.name}` : ws.name}
                    </button>
                  ))
                )}
              </div>
            )}
          </div>
          <button
            type="button"
            className="quick-open-btn close"
            onClick={closeQuickOpen}
            title="Close this file"
          >
            <X size={13} />
          </button>
        </div>
      </div>

      <div className="doc-body">
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

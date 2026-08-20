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
  Undo2,
  X
} from 'lucide-react'
import { SlashMenu } from './SlashMenu'
import { FolderPicker } from './FolderPicker'
import { TextColor } from '../extensions/TextColor'
import { BlockDrag } from '../extensions/BlockDrag'
import { DateShortcut } from '../extensions/DateShortcut'
import { Toggle } from '../extensions/Toggle'
import { TaskBackspace } from '../extensions/TaskBackspace'
import { emptyTaskListPlugin } from '../extensions/EmptyTaskList'
import { useApp } from '../state/AppContext'
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
  const { activeDocContent, saveDoc, saveStatus, renameDoc, folders, memberships, removeDocFromFolder, closeDoc } = useApp()
  const [rawView, setRawView] = useState(false)
  const [rawText, setRawText] = useState('')
  const rawTimerRef = useRef<number | null>(null)
  const lastSavedRef = useRef<string>('')
  const timerRef = useRef<number | null>(null)
  const [title, setTitle] = useState(doc.title)
  const [renaming, setRenaming] = useState(false)
  const [stats, setStats] = useState({ words: 0, chars: 0 })
  const [pickerPos, setPickerPos] = useState<{ x: number; y: number } | null>(null)
  const [showFolderChips, setShowFolderChips] = useState(false)
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
      Link.configure({ openOnClick: false, autolink: true }),
      // html: true lets custom marks (text color) round-trip through the
      // markdown as <span style="color:…">. Plain markdown is unchanged.
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true }),
      CharacterCount,
      SlashMenu,
      TextColor,
      BlockDrag,
      DateShortcut
    ],
    content: activeDocContent,
    editorProps: {
      attributes: { class: 'md-editor', spellcheck: 'false' }
    },
    onUpdate: ({ editor }) => {
      const md = (editor.storage.markdown.getMarkdown() as string) ?? ''
      setStats({
        words: editor.storage.characterCount.words(),
        chars: editor.storage.characterCount.characters()
      })
      if (md === lastSavedRef.current) return
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => {
        void saveDoc(doc.id, md).then(() => {
          lastSavedRef.current = md
        })
      }, 900)
    }
  })

  // Make bare `- [ ]` lines (empty task items) round-trip as real task items.
  // Registered once on the shared markdown-it instance; the doc.id effect below
  // (which re-parses the active content) then always parses through it.
  useEffect(() => {
    if (!editor) return
    const parser = (editor.storage.markdown as {
      parser?: { md?: { use: (p: unknown) => void; __emptyTaskListPatched?: boolean } }
    })?.parser
    const md = parser?.md
    if (md && !md.__emptyTaskListPatched) {
      md.__emptyTaskListPatched = true
      md.use(emptyTaskListPlugin)
    }
  }, [editor])

  // Reset local state when switching docs (component is keyed by doc.id).
  useEffect(() => {
    setTitle(doc.title)
    setRenaming(false)
    lastSavedRef.current = activeDocContent
    if (timerRef.current !== null) {
      window.clearTimeout(timerRef.current)
      timerRef.current = null
    }
    if (editor) {
      editor.commands.setContent(activeDocContent || '')
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [doc.id])

  useEffect(() => {
    return () => {
      if (timerRef.current !== null) window.clearTimeout(timerRef.current)
    }
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
      void renameDoc(doc.id, clean)
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

  const toggleRawView = () => {
    if (rawView) {
      // Exiting raw view: push the edited markdown back into TipTap
      if (editor && rawText !== lastSavedRef.current) {
        editor.commands.setContent(rawText)
        if (rawTimerRef.current !== null) window.clearTimeout(rawTimerRef.current)
        rawTimerRef.current = window.setTimeout(() => {
          void saveDoc(doc.id, rawText).then(() => {
            lastSavedRef.current = rawText
          })
        }, 600)
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
    if (rawTimerRef.current !== null) window.clearTimeout(rawTimerRef.current)
    rawTimerRef.current = window.setTimeout(() => {
      void saveDoc(doc.id, value).then(() => {
        lastSavedRef.current = value
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
        </div>
        <div className="doc-toolbar-right">
          <ToolbarButton
            title="Folder options"
            active={showFolderChips}
            onClick={() => setShowFolderChips((v) => !v)}
          >
            {showFolderChips ? <FolderOpen size={15} /> : <FolderIcon size={15} />}
          </ToolbarButton>
          <ToolbarButton
            title={rawView ? 'Rich view' : 'Raw markdown view'}
            active={rawView}
            onClick={toggleRawView}
          >
            <SquareCode size={15} />
          </ToolbarButton>
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
                {doc.title}
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

        {rawView ? (
          <textarea
            className="raw-editor"
            value={rawText}
            onChange={(e) => handleRawChange(e.target.value)}
            spellCheck={false}
            autoFocus
          />
        ) : (
          <EditorContent editor={editor} />
        )}

        <div className="doc-footer">
          {rawView ? (
            <>
              <span>Raw markdown view</span>
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

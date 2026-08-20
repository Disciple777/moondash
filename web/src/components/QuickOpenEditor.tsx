import { useEffect, useMemo, useRef, useState, type MouseEvent as ReactMouseEvent } from 'react'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import { Markdown } from 'tiptap-markdown'
import CharacterCount from '@tiptap/extension-character-count'
import {
  ArrowLeft,
  FileText,
  FolderPlus,
  Loader2,
  Save,
  X
} from 'lucide-react'
import { SlashMenu } from './SlashMenu'
import { TextColor } from '../extensions/TextColor'
import { BlockDrag } from '../extensions/BlockDrag'
import { DateShortcut } from '../extensions/DateShortcut'
import { Toggle } from '../extensions/Toggle'
import { TaskBackspace } from '../extensions/TaskBackspace'
import { emptyTaskListPlugin } from '../extensions/EmptyTaskList'
import { useApp } from '../state/AppContext'

export function QuickOpenEditor() {
  const {
    quickOpenFile,
    saveQuickFile,
    closeQuickOpen,
    addToMultiFromQuick,
    saveStatus,
    workspaces,
    error
  } = useApp()

  const lastSavedRef = useRef<string>('')
  const timerRef = useRef<number | null>(null)
  const [stats, setStats] = useState({ words: 0, chars: 0 })
  const [showAddMenu, setShowAddMenu] = useState(false)

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
      Link.configure({ openOnClick: false, autolink: true }),
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true }),
      CharacterCount,
      SlashMenu,
      TextColor,
      BlockDrag,
      DateShortcut
    ],
    content: quickOpenFile?.content ?? '',
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
        void saveQuickFile(md).then(() => {
          lastSavedRef.current = md
        })
      }, 900)
    }
  })

  // Register the empty-task-list md-it plugin once.
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

  // Sync content when quickOpenFile changes.
  useEffect(() => {
    if (!editor || !quickOpenFile) return
    if (editor.getText() === quickOpenFile.content) return
    editor.commands.setContent(quickOpenFile.content)
    lastSavedRef.current = quickOpenFile.content
  }, [editor, quickOpenFile])

  if (!quickOpenFile) return null

  const handleAddToMulti = (multiWsId: number) => {
    setShowAddMenu(false)
    void addToMultiFromQuick(multiWsId)
  }

  return (
    <div className="editor-shell">
      <div className="editor-toolbar">
        <div className="tb-group">
          <button
            type="button"
            className="tb-btn"
            title="Close file"
            onClick={closeQuickOpen}
          >
            <ArrowLeft size={15} />
          </button>
        </div>
        <div className="tb-group tb-spacer" />
        <div className="tb-group">
          <span className="tb-label" style={{ fontSize: '0.7rem', opacity: 0.6 }}>
            {saveStatus === 'saving' ? (
              <><Loader2 size={11} className="spin" /> Saving…</>
            ) : saveStatus === 'saved' ? (
              'Saved'
            ) : (
              'Unsaved changes'
            )}
          </span>
        </div>
      </div>

      {/* Quick-open banner */}
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
              if (editor) {
                const md = (editor.storage.markdown.getMarkdown() as string) ?? ''
                void saveQuickFile(md)
              }
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

      <div className="editor-body">
        <EditorContent editor={editor} />
        <div className="doc-footer">
          <span>{stats.words} words</span>
          <span className="dot">·</span>
          <span>{stats.chars} characters</span>
        </div>
      </div>
    </div>
  )
}

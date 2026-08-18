/**
 * Real-browser harness for list marker (bullet) rendering.
 * Mounts a TipTap editor with the app's real list extensions + the real
 * styles.css, loads a doc with bullet + ordered + task lists, and exposes the
 * editor for the puppeteer driver (scripts/drive-bullets.mjs).
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import '../src/styles.css'

const DOC = `# Heading

- Bullet one
- Bullet two
- Bullet three

1. Ordered one
1. Ordered two

- [ ] Task open
- [x] Task done
`

function Harness() {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true })
    ],
    content: DOC,
    editorProps: {
      attributes: { class: 'md-editor', spellcheck: 'false' }
    }
  })

  React.useEffect(() => {
    if (!editor) return
    window.__ed = editor
    window.__dump = () => editor.storage.markdown.getMarkdown()
  }, [editor])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 24 }}>
      <EditorContent editor={editor} />
    </div>
  )
}

declare global {
  interface Window {
    __ed: any
    __dump: () => string
  }
}

createRoot(document.getElementById('root')!).render(<Harness />)

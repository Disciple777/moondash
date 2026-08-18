/**
 * Real-browser harness for the BlockDrag drop-line + drop behavior.
 * Mounts a TipTap editor with the app's real BlockDrag + Toggle extensions
 * (plus StarterKit/TaskList for a faithful schema) and exposes:
 *   - window.__ed: the editor instance
 *   - window.__setDoc(md): load a markdown doc
 *   - window.__dump(): serialized markdown of the current doc
 *   - buttons: Reset / Dump
 *
 * Driven by scripts/drive-drag.mjs (puppeteer-core + installed Chrome).
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { BlockDrag } from '../src/extensions/BlockDrag'
import { Toggle } from '../src/extensions/Toggle'

const DOCS: Record<string, string> = {
  list_toggle: `- A
- B
- C

<details class="toggle"><p>T</p></details>`,
  list4: `- A
- B
- C
- D`,
  two_lists: `- A
- B

- C
- D`,
  long: Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join('\n')
}

function Harness() {
  const editor = useEditor({
    extensions: [
      Toggle,
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true }),
      BlockDrag
    ],
    content: DOCS.list_toggle,
    editorProps: {
      attributes: { class: 'md-editor', spellcheck: 'false' }
    },
    onUpdate: () => {
      const el = document.getElementById('harness-log')
      if (el && window.__ed) el.textContent = window.__ed.storage.markdown.getMarkdown()
    }
  })

  React.useEffect(() => {
    if (!editor) return
    window.__ed = editor
    window.__setDoc = (md: string) => editor.commands.setContent(md)
    window.__dump = () => editor.storage.markdown.getMarkdown()
  }, [editor])

  return (
    <div style={{ fontFamily: 'sans-serif', padding: 16 }}>
      <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
        <button type="button" id="btn-reset" onClick={() => editor?.commands.setContent(DOCS.list_toggle)}>
          Reset
        </button>
        <button type="button" id="btn-dump" onClick={() => alert(window.__dump())}>
          Dump
        </button>
      </div>
      <div
        id="hscroll"
        style={{ height: 340, overflowY: 'auto', border: '1px solid #444', borderRadius: 6 }}
      >
        <EditorContent editor={editor} />
      </div>
      <pre
        id="harness-log"
        style={{ marginTop: 16, background: '#111', color: '#7dff9b', padding: 12, fontSize: 12, whiteSpace: 'pre-wrap' }}
      />
    </div>
  )
}

declare global {
  interface Window {
    __ed: any
    __setDoc: (md: string) => void
    __dump: () => string
  }
}

createRoot(document.getElementById('root')!).render(<Harness />)

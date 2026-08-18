/**
 * Real-browser harness for NESTED / indented list rendering.
 * Mounts a TipTap editor with the app's real list + toggle extensions and the
 * real styles.css, loads a doc with nested bullets, ordered lists, task lists
 * and toggle-nested lists, and exposes the editor + a DOM/CSS probe for the
 * puppeteer driver (scripts/drive-nestedlists.mjs).
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import { Markdown } from 'tiptap-markdown'
import { Toggle } from '../src/extensions/Toggle'
import '../src/styles.css'

const DOC = `# Nested lists

- Level one A
  - Level two A1
    - Level three A1a
  - Level two A2
- Level one B

1. Ordered one
   1. Nested ordered A
   2. Nested ordered B
2. Ordered two

- [ ] Task one
  - [ ] Nested task A
  - [ ] Nested task B
- [x] Task two

1. Ordered with bullet child
   - Bullet inside ordered

- Bullet with ordered child
  1. Ordered inside bullet

<details class="toggle" open>
<summary>Toggle with list</summary>
<p>para inside toggle</p>
<ul>
<li><p>bullet in toggle</p>
<ul>
<li><p>nested bullet in toggle</p></li>
</ul>
</li>
</ul>
</details>
`

function Harness() {
  const editor = useEditor({
    extensions: [
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      TaskList,
      TaskItem.configure({ nested: true }),
      Toggle,
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

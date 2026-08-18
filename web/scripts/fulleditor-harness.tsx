/**
 * Real-browser harness with the app's FULL editor extension set (same lineup
 * as web/src/components/Editor.tsx) — verifies nested/indented list rendering
 * under the exact extension configuration users hit.
 */
import React from 'react'
import { createRoot } from 'react-dom/client'
import { EditorContent, useEditor } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Placeholder from '@tiptap/extension-placeholder'
import TaskList from '@tiptap/extension-task-list'
import TaskItem from '@tiptap/extension-task-item'
import Link from '@tiptap/extension-link'
import CharacterCount from '@tiptap/extension-character-count'
import { Markdown } from 'tiptap-markdown'
import { TaskBackspace } from '../src/extensions/TaskBackspace'
import { Toggle } from '../src/extensions/Toggle'
import { SlashMenu } from '../src/components/SlashMenu'
import { TextColor } from '../src/extensions/TextColor'
import { BlockDrag } from '../src/extensions/BlockDrag'
import { DateShortcut } from '../src/extensions/DateShortcut'
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
      TaskBackspace,
      Toggle,
      StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
      Placeholder.configure({
        placeholder: ({ editor, node, pos }) => {
          if (node.type.name === 'paragraph' && node.content.size === 0) {
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

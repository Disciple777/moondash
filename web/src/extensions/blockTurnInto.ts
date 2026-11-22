import type { Editor } from '@tiptap/core'
import type { EditorState } from '@tiptap/pm/state'
import { TextSelection } from '@tiptap/pm/state'

/**
 * "Turn into" for the block handle's right-click menu: convert a block (or
 * every block in a multi-block selection) to another type — text, heading,
 * list, quote, code, toggle — keeping its text.
 *
 * Each conversion first flattens the range to plain paragraphs with
 * `clearNodes()` (lifting it out of lists, quotes and toggles), then applies
 * the target type. That way any type converts to any other, e.g. a to-do item
 * straight into a heading.
 */

export type BlockTypeId =
  | 'paragraph'
  | 'h1'
  | 'h2'
  | 'h3'
  | 'bulletList'
  | 'orderedList'
  | 'taskList'
  | 'toggle'
  | 'blockquote'
  | 'codeBlock'

export interface BlockTypeDef {
  id: BlockTypeId
  label: string
  /** Same glyphs as the slash menu, so the two menus read as one system. */
  icon: string
  /** Schema node the type needs; the item is hidden when the editor lacks it. */
  requires: string
}

export const BLOCK_TYPES: BlockTypeDef[] = [
  { id: 'paragraph', label: 'Text', icon: 'Aa', requires: 'paragraph' },
  { id: 'h1', label: 'Heading 1', icon: 'H1', requires: 'heading' },
  { id: 'h2', label: 'Heading 2', icon: 'H2', requires: 'heading' },
  { id: 'h3', label: 'Heading 3', icon: 'H3', requires: 'heading' },
  { id: 'bulletList', label: 'Bullet list', icon: '•', requires: 'bulletList' },
  { id: 'orderedList', label: 'Numbered list', icon: '1.', requires: 'orderedList' },
  { id: 'taskList', label: 'To-do list', icon: '☑', requires: 'taskList' },
  { id: 'toggle', label: 'Toggle list', icon: '▸', requires: 'toggle' },
  { id: 'blockquote', label: 'Quote', icon: '❝', requires: 'blockquote' },
  { id: 'codeBlock', label: 'Code block', icon: '</>', requires: 'codeBlock' }
]

/** What the block starting at `pos` currently is, for the menu's checkmark. */
export function blockTypeAt(state: EditorState, pos: number, listTypeName: string | null): BlockTypeId | null {
  if (listTypeName === 'bulletList' || listTypeName === 'orderedList' || listTypeName === 'taskList') {
    return listTypeName
  }
  const node = state.doc.nodeAt(pos)
  if (!node) return null
  switch (node.type.name) {
    case 'paragraph':
      return 'paragraph'
    case 'heading': {
      const level = node.attrs.level as number
      return level === 1 ? 'h1' : level === 2 ? 'h2' : level === 3 ? 'h3' : null
    }
    case 'blockquote':
    case 'codeBlock':
    case 'toggle':
      return node.type.name
    default:
      return null
  }
}

/**
 * Wrap the top-level blocks the selection touches in a toggle; the first one
 * becomes the toggle's title (Notion's "turn into toggle").
 */
function wrapInToggle(editor: Editor): boolean {
  return editor.commands.command(({ tr, state, dispatch }) => {
    const toggleType = state.schema.nodes.toggle
    if (!toggleType) return false
    const { $from, $to } = tr.selection
    const range = $from.blockRange($to)
    if (!range) return false
    const blocks = tr.doc.slice(range.start, range.end).content
    const toggle = toggleType.createAndFill({ open: true }, blocks)
    if (!toggle) return false
    if (dispatch) {
      tr.replaceWith(range.start, range.end, toggle)
      // Cursor at the end of the new title.
      const titleEnd = range.start + 1 + (toggle.firstChild?.nodeSize ?? 2) - 1
      tr.setSelection(TextSelection.near(tr.doc.resolve(Math.min(titleEnd, tr.doc.content.size))))
    }
    return true
  })
}

/** Convert the blocks spanning [from, to] into `type`. */
export function turnInto(editor: Editor, from: number, to: number, type: BlockTypeId): void {
  const select = editor.commands.command(({ tr }) => {
    const size = tr.doc.content.size
    tr.setSelection(
      TextSelection.between(tr.doc.resolve(Math.max(0, Math.min(from, size))), tr.doc.resolve(Math.max(0, Math.min(to, size))))
    )
    return true
  })
  if (!select) return

  const chain = editor.chain().focus().clearNodes()
  switch (type) {
    case 'paragraph':
      chain.run()
      return
    case 'h1':
    case 'h2':
    case 'h3':
      chain.setHeading({ level: Number(type[1]) as 1 | 2 | 3 }).run()
      return
    case 'bulletList':
      chain.toggleBulletList().run()
      return
    case 'orderedList':
      chain.toggleOrderedList().run()
      return
    case 'taskList':
      chain.toggleTaskList().run()
      return
    case 'blockquote':
      chain.toggleBlockquote().run()
      return
    case 'codeBlock':
      chain.setCodeBlock().run()
      return
    case 'toggle':
      chain.run()
      wrapInToggle(editor)
      editor.commands.focus()
      return
  }
}

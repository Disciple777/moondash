import { Extension } from '@tiptap/core'
import { TextSelection } from '@tiptap/pm/state'

/**
 * Backspace refinement for task lists.
 *
 * Problem: pressing Backspace at the start of an EMPTY task item ("- [ ] ")
 * made PM's default joinBackward fold the item into the previous one as a
 * NESTED EMPTY PARAGRAPH — an invisible indented line with no checkbox, and a
 * second Backspace was needed to get rid of it ("the checkbox is erased but
 * the space where it was is left").
 *
 * This intercepts that exact case and removes the empty item in ONE press:
 *   - only item in its list → the list becomes a plain empty paragraph
 *   - item with a previous sibling → deleted, cursor at the end of its text
 *   - first item (list keeps others) → deleted, cursor at the next item's start
 *
 * Register BEFORE StarterKit so this runs before the base backspace keymap.
 * Every non-empty-item case returns false and falls through to normal behavior.
 */
export const TaskBackspace = Extension.create({
  name: 'taskBackspace',

  addKeyboardShortcuts() {
    return {
      Backspace: () => {
        const { state, dispatch } = this.editor.view
        const { $from, empty } = state.selection
        if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false

        // Nearest taskItem ancestor, and the cursor must sit in its FIRST
        // child (the empty paragraph at the top of the item).
        let itemDepth = $from.depth
        while (itemDepth > 1 && $from.node(itemDepth).type.name !== 'taskItem') itemDepth--
        if ($from.node(itemDepth).type.name !== 'taskItem') return false
        if ($from.index(itemDepth) !== 0) return false

        const item = $from.node(itemDepth)
        // Only when the item has NO meaningful content anywhere in it.
        if (item.textContent.trim() !== '') return false

        const listDepth = itemDepth - 1
        if (listDepth < 1 || $from.node(listDepth).type.name !== 'taskList') return false
        const list = $from.node(listDepth)
        const index = $from.index(listDepth)

        const itemStart = $from.before(itemDepth)
        const itemEnd = itemStart + item.nodeSize
        const tr = state.tr

        if (list.childCount === 1) {
          // Sole item → replace the whole list with an empty paragraph.
          const listStart = $from.before(listDepth)
          const para = state.schema.nodes.paragraph.create(null)
          tr.replaceWith(listStart, listStart + list.nodeSize, para)
          tr.setSelection(TextSelection.create(tr.doc, listStart + 1))
          dispatch(tr)
          return true
        }

        tr.deleteRange(itemStart, itemEnd)
        if (index > 0) {
          // Positions BEFORE the deleted range are unmoved: itemStart - 1 is
          // the previous item's close tag, so -2 is inside its last block,
          // right after the last character. near() guards against a previous
          // item that ends in a non-textblock (e.g. a nested list).
          tr.setSelection(TextSelection.near(tr.doc.resolve(Math.max(1, itemStart - 2))))
        } else {
          // Everything after the range shifted LEFT by its size, so the next
          // item now starts at itemStart; +2 is inside its first paragraph's
          // content (task items always open with a paragraph).
          tr.setSelection(TextSelection.create(tr.doc, itemStart + 2))
        }
        dispatch(tr)
        return true
      }
    }
  }
})

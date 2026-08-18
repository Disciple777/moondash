import { Node, mergeAttributes, type NodeViewProps } from '@tiptap/core'
import { NodeViewWrapper, NodeViewContent, ReactNodeViewRenderer } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import type { ResolvedPos } from '@tiptap/pm/model'
import { ChevronRight } from 'lucide-react'
import type { MouseEvent as ReactMouseEvent } from 'react'

/**
 * Notion-style toggle: a collapsible block. The FIRST block inside acts as the
 * title (bold-ish, with a "Toggle heading" ghost placeholder when empty),
 * everything after it is the collapsible content. Serialized to markdown as
 * `<details class="toggle">` (tiptap-markdown html mode), so it survives saves,
 * reloads, and the local .md files.
 *
 * Nesting (Notion-style):
 *   - Creating a toggle puts the cursor in the TITLE (empty, ghost placeholder).
 *   - Enter on an EMPTY title hops straight into the content (inside).
 *   - Enter at the end of a typed title splits a new content block inside.
 *   - Tab at the start of a block right after a toggle moves it INSIDE that
 *     toggle. Tab inside a toggle's content nests into a preceding sub-toggle.
 *   - Shift-Tab on the title converts the whole toggle back to plain blocks.
 *   - Shift-Tab on a content block pulls it back out, right after the toggle.
 *
 * IMPORTANT: register this extension BEFORE StarterKit so its Enter/Backspace/
 * Tab handlers run before the base keymap (StarterKit's splitBlock would
 * otherwise win for Enter).
 */
function ToggleNodeView({ node, updateAttributes }: NodeViewProps) {
  const open = node.attrs.open as boolean
  const toggle = (e: ReactMouseEvent) => {
    e.preventDefault()
    updateAttributes({ open: !open })
  }
  return (
    // draggable=false: only the BlockDrag grip moves blocks — PM's built-in
    // node drag would otherwise fight it with a second, line-less drag system.
    <NodeViewWrapper as="div" className="toggle" data-open={String(open)} draggable={false}>
      <button
        type="button"
        className="toggle-caret"
        contentEditable={false}
        onMouseDown={(e) => e.preventDefault()}
        onClick={toggle}
        title={open ? 'Collapse' : 'Expand'}
        aria-label={open ? 'Collapse toggle' : 'Expand toggle'}
      >
        <ChevronRight size={14} />
      </button>
      <div className="toggle-body">
        <NodeViewContent className="toggle-content-slot" />
      </div>
    </NodeViewWrapper>
  )
}

/** Depth of the nearest `toggle` ancestor of $pos, or 0 when there is none. */
function toggleDepth($pos: ResolvedPos): number {
  let depth = $pos.depth
  while (depth > 0 && $pos.node(depth).type.name !== 'toggle') depth--
  return depth
}

/**
 * The block container under a position: the innermost node whose parent is the
 * doc or a toggle. For a plain paragraph that's the paragraph itself; for a
 * list item it's the whole list — so list moves defer to the list keymap.
 */
function blockContainer(
  $pos: ResolvedPos
): { depth: number; start: number; end: number; isList: boolean } | null {
  if ($pos.depth < 1) return null
  let depth = $pos.depth
  while (depth > 1) {
    const parent = $pos.node(depth - 1)
    if (parent.type.name === 'doc' || parent.type.name === 'toggle') break
    depth--
  }
  const node = $pos.node(depth)
  return {
    depth,
    start: $pos.before(depth),
    end: $pos.before(depth) + node.nodeSize,
    isList: node.type.name === 'listItem' || node.type.name.endsWith('List')
  }
}

export const Toggle = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,

  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => (el as HTMLElement).hasAttribute('open'),
        renderHTML: (attrs) => (attrs.open ? { open: '' } : {})
      }
    }
  },

  parseHTML() {
    return [{ tag: 'details.toggle' }, { tag: 'details' }]
  },

  renderHTML({ HTMLAttributes }) {
    return ['details', mergeAttributes(HTMLAttributes, { class: 'toggle' }), 0]
  },

  addCommands() {
    return {
      setToggle:
        () =>
        ({ state, dispatch }) => {
          // Build the whole thing on the ONE transaction this command was
          // invoked with — never nest editor.chain() inside a command (the
          // outer wrapper would dispatch a stale snapshot → mismatch).
          //
          // The title starts EMPTY — no placeholder text baked into the node.
          // The "Toggle heading" ghost is drawn by the Placeholder extension,
          // so typing never collides with leftover text.
          const toggle = state.schema.nodes.toggle.createAndFill({ open: true }, [
            state.schema.nodes.paragraph.create(null)
          ])
          if (!toggle) return false
          const tr = state.tr
          const from = state.selection.from
          // PM's insert() places the toggle at `from` (splitting the surrounding
          // textblock only when `from` is mid-text).
          tr.insert(from, toggle)
          // Land the cursor in the TITLE (first child) — like Notion. Resolve
          // the toggle's actual position to cover both landing spots, then use
          // near() so the empty title is a valid inline position.
          const $pos = tr.doc.resolve(Math.min(from + 1, tr.doc.content.size))
          const depth = toggleDepth($pos)
          const titleStart = depth > 0 ? $pos.before(depth) + 2 : from + 2
          tr.setSelection(
            TextSelection.near(tr.doc.resolve(Math.min(titleStart, tr.doc.content.size)))
          )
          // dispatch may be undefined during a dry-run (can() check) — skip then.
          if (dispatch) dispatch(tr)
          return true
        }
    }
  },

  addNodeView() {
    return ReactNodeViewRenderer(ToggleNodeView)
  },

  addKeyboardShortcuts() {
    return {
      // Backspace at the very start of the toggle's title converts the toggle
      // into plain sibling blocks (children preserved) instead of deleting the
      // whole toggle — same feel as Notion, and no accidental data loss.
      Backspace: () => {
        const { state, dispatch } = this.editor.view
        const { $from, empty } = state.selection
        if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false
        const depth = toggleDepth($from)
        if (depth === 0) return false
        // Only when the cursor sits in the toggle's FIRST child (the title).
        if ($from.index(depth) !== 0) return false
        const toggle = $from.node(depth)
        const start = $from.before(depth)
        const tr = state.tr
        tr.replaceWith(start, start + toggle.nodeSize, toggle.content)
        tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(start) + 1))
        dispatch(tr)
        return true
      },

      // Enter on an EMPTY title: jump straight into a fresh content block
      // inside the toggle (instead of splitting a blank line before the
      // ghost). For a non-empty title the handler bails and the base keymap's
      // splitBlock takes over — which also lands inside the toggle (its
      // content is 'block+'), so typing after Enter is always nested.
      Enter: () => {
        const { state, dispatch } = this.editor.view
        const { $from, empty } = state.selection
        if (!empty || !$from.parent.isTextblock) return false
        const depth = toggleDepth($from)
        if (depth === 0 || $from.index(depth) !== 0) return false
        if ($from.parentOffset !== $from.parent.content.size) return false
        if ($from.parent.content.size !== 0) return false // only an EMPTY title
        const tr = state.tr
        // Insert a content paragraph right after the title (inside the toggle).
        tr.insert($from.pos + 1, state.schema.nodes.paragraph.create(null))
        tr.setSelection(TextSelection.create(tr.doc, $from.pos + 2))
        dispatch(tr)
        return true
      },

      // Tab at the start of a block that follows a toggle → nest it inside.
      // The preceding toggle ends exactly where the block starts, so the
      // insertion point (inside the toggle, at its end) is `start - 1` — and it
      // sits BEFORE the deleted range, so it survives the deletion unmoved.
      Tab: () => {
        const { state, dispatch } = this.editor.view
        const { $from, empty } = state.selection
        if (!empty || !$from.parent.isTextblock || $from.parentOffset !== 0) return false
        const cont = blockContainer($from)
        if (!cont || cont.isList) return false
        const parent = $from.node(cont.depth - 1)
        // index of the block WITHIN its parent (index(depth) in this PM build
        // answers for the child BELOW the given depth — hence depth - 1).
        const index = $from.index(cont.depth - 1)
        if (index <= 0) return false // nothing before it (also covers the title)
        const prev = parent.content.child(index - 1)
        if (prev.type.name !== 'toggle') return false
        const block = parent.content.child(index)
        const tr = state.tr
        const insertAt = cont.start - 1
        tr.deleteRange(cont.start, cont.end)
        tr.insert(insertAt, block)
        // Cursor into the freshly nested block.
        tr.setSelection(TextSelection.near(tr.doc.resolve(insertAt + 1)))
        dispatch(tr)
        return true
      },

      // Shift-Tab: title → un-toggle to plain blocks; content block → pull out.
      'Shift-Tab': () => {
        const { state, dispatch } = this.editor.view
        const { $from, empty } = state.selection
        if (!empty || !$from.parent.isTextblock) return false
        const depth = toggleDepth($from)
        if (depth === 0) return false
        const toggle = $from.node(depth)
        const tStart = $from.before(depth)
        const tEnd = tStart + toggle.nodeSize

        // In the title → convert the whole toggle into plain sibling blocks.
        if ($from.index(depth) === 0) {
          const tr = state.tr
          tr.replaceWith(tStart, tEnd, toggle.content)
          tr.setSelection(TextSelection.create(tr.doc, tr.mapping.map(tStart) + 1))
          dispatch(tr)
          return true
        }

        // In the content → pull just this block out, right after the toggle.
        const cont = blockContainer($from)
        if (!cont || cont.isList) return false
        const tr = state.tr
        const block = tr.doc.nodeAt(cont.start)
        if (!block) return false
        tr.deleteRange(cont.start, cont.end)
        let at = tr.mapping.map(tEnd)
        at = Math.max(0, Math.min(at, tr.doc.content.size))
        tr.insert(at, block)
        tr.setSelection(TextSelection.near(tr.doc.resolve(at + 1)))
        dispatch(tr)
        return true
      }
    }
  }
})

declare module '@tiptap/core' {
  interface Commands<ReturnType> {
    toggle: {
      setToggle: () => ReturnType
    }
  }
}

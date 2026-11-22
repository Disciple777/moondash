import { Extension } from '@tiptap/core'
import { Plugin, PluginKey, TextSelection, type Transaction, type EditorState } from '@tiptap/pm/state'
import { Fragment, type Node as PMNode, type ResolvedPos } from '@tiptap/pm/model'
import type { EditorView } from '@tiptap/pm/view'
import { BLOCK_TYPES, blockTypeAt, turnInto, type BlockTypeId } from './blockTurnInto'

const KEY = new PluginKey('blockDrag')
const MIME = 'application/x-moondash-block'
// The grip sits a few px below the block's top edge so it lines up with the
// block's first line of text instead of hovering above it.
const GRIP_TOP_OFFSET = 10
// Auto-scroll while dragging: how close (px) the pointer must be to the
// viewport's top/bottom edge to start scrolling, and the max scroll speed
// (px per animation frame — ramps up the closer the pointer gets to the edge).
const SCROLL_EDGE = 64
const SCROLL_MAX_SPEED = 14

export interface BlockInfo {
  start: number
  end: number
  node: PMNode | null
  kind: 'top' | 'item' | 'block'
  listStart: number | null
  listEnd: number | null
  listTypeName: string | null
  // For 'block' targets (content inside a toggle): the toggle that directly
  // contains the block — used to drop INSIDE it (and to detect dragging a
  // toggle over itself).
  toggleStart: number | null
  toggleEnd: number | null
}

/** Fragment.slice by child index (PM's internal cutByIndex, not in public types). */
function cutByIndex(frag: Fragment, from: number, to?: number): Fragment {
  return Fragment.from(frag.content.slice(from, to))
}

/** Depth of the innermost `toggle` ancestor of $pos, or 0 when there is none. */
export function toggleDepthOf($pos: ResolvedPos): number {
  let d = $pos.depth
  while (d > 0 && $pos.node(d).type.name !== 'toggle') d--
  return d
}

/**
 * The draggable block under a position:
 *  - a list item, always (dragging an item drags the item);
 *  - a toggle's TITLE drags the WHOLE toggle;
 *  - a toggle's CONTENT block is its own draggable block (kind 'block'),
 *    carrying the enclosing toggle's bounds so drops can land inside it.
 */
export function findBlock($pos: ResolvedPos): BlockInfo | null {
  if ($pos.depth < 1) return null

  // 1) List item (innermost wins).
  for (let d = $pos.depth; d >= 1; d--) {
    const node = $pos.node(d)
    if (node.type.name === 'listItem' || node.type.name === 'taskItem') {
      const start = $pos.before(d)
      const end = start + node.nodeSize
      const list = $pos.node(d - 1)
      const listStart = $pos.before(d - 1)
      return {
        start,
        end,
        node,
        kind: 'item',
        listStart,
        listEnd: listStart + list.nodeSize,
        listTypeName: list.type.name,
        toggleStart: null,
        toggleEnd: null
      }
    }
  }

  // 2) Inside a toggle.
  const toggleDepth = toggleDepthOf($pos)
  if (toggleDepth > 0) {
    const toggle = $pos.node(toggleDepth)
    const tStart = $pos.before(toggleDepth)
    const tEnd = tStart + toggle.nodeSize
    const innerDepth = toggleDepth + 1
    // index(toggleDepth) = index of the containing child WITHIN the toggle
    // (title is child 0) — NOT index(innerDepth), which is the index of the
    // position's child within the inner block itself (always 0 for text).
    if ($pos.depth >= innerDepth && $pos.index(toggleDepth) !== 0) {
      // A content block below the title → individually draggable.
      const inner = $pos.node(innerDepth)
      const innerStart = $pos.before(innerDepth)
      return {
        start: innerStart,
        end: innerStart + inner.nodeSize,
        node: inner,
        kind: 'block',
        listStart: null,
        listEnd: null,
        listTypeName: null,
        toggleStart: tStart,
        toggleEnd: tEnd
      }
    }
    // The title (or a degenerate position) → the whole toggle is the block.
    return {
      start: tStart,
      end: tEnd,
      node: toggle,
      kind: 'top',
      listStart: null,
      listEnd: null,
      listTypeName: null,
      toggleStart: null,
      toggleEnd: null
    }
  }

  // 3) Top-level block.
  const node = $pos.node(1)
  const start = $pos.before(1)
  return {
    start,
    end: start + node.nodeSize,
    node,
    kind: 'top',
    listStart: null,
    listEnd: null,
    listTypeName: null,
    toggleStart: null,
    toggleEnd: null
  }
}

/** True when the dragged payload covers the target's whole enclosing toggle. */
function wholeToggleInDrag(payload: BlockInfo, target: BlockInfo): boolean {
  return (
    target.toggleStart != null &&
    target.toggleEnd != null &&
    payload.start <= target.toggleStart &&
    target.toggleEnd <= payload.end
  )
}

/** Deletes the block; if it was a list item, also removes any parent list that emptied. */
export function removeBlock(tr: Transaction, info: BlockInfo): void {
  tr.deleteRange(info.start, info.end)
  if (info.kind !== 'item' || info.listStart == null) return
  // The item deletion shifts positions — map the list's start through it.
  let pos = tr.mapping.map(info.listStart)
  let guard = 0
  while (guard++ < 10) {
    const node = tr.doc.nodeAt(pos)
    if (!node || !node.type.name.endsWith('List')) break
    if (node.content.childCount > 0) break
    tr.deleteRange(pos, pos + node.nodeSize)
    // Re-resolve in the updated doc: if the removed list sat inside another
    // (empty) list, remove that one too.
    const $pos = tr.doc.resolve(pos)
    if ($pos.depth < 1) break
    const parent = $pos.node($pos.depth)
    if (parent.type.name.endsWith('List')) {
      pos = $pos.before($pos.depth)
      continue
    }
    break
  }
}

/** Deletes a [start, end] block range and sweeps away any list left empty. */
function removeRange(tr: Transaction, start: number, end: number): void {
  tr.deleteRange(start, end)
  let pos = tr.mapping.map(start)
  let guard = 0
  while (guard++ < 10) {
    const node = tr.doc.nodeAt(pos)
    if (!node || !node.type.name.endsWith('List') || node.content.childCount > 0) break
    tr.deleteRange(pos, pos + node.nodeSize)
  }
}

/** Computes the insertion point + optional list wrapper for a drop. */
function computeInsertAt(
  state: EditorState,
  payload: BlockInfo,
  target: BlockInfo | null,
  before: boolean
): { at: number; wrapList: string | null } {
  const docEnd = state.doc.content.size
  let at: number
  let wrapList: string | null = null

  if (payload.kind === 'item') {
    if (!target || target.kind !== 'item') {
      // Leave the list → place a new list (of the item's type) at the target.
      at = target ? (before ? target.start : target.end) : docEnd
      wrapList = payload.listTypeName
    } else if (target.listStart === payload.listStart || target.listTypeName === payload.listTypeName) {
      // Same list, or a type-compatible list → insert the item directly.
      at = before ? target.start : target.end
    } else {
      // Incompatible list type → place the item (wrapped in its own list) at
      // the ITEM boundary; movePayload splits the target list around it.
      at = before ? target.start : target.end
      wrapList = payload.listTypeName
    }
  } else {
    if (target?.kind === 'item') {
      // Toggle / multi-selection dropped on a list item → the ITEM's boundary.
      // The line tracks individual lines and movePayload merges (same-type
      // items) or splits the list around the insertion so the content lands
      // exactly where the drop line showed.
      at = before ? target.start : target.end
    } else if (target?.kind === 'block' && !wholeToggleInDrag(payload, target)) {
      // Drop INSIDE a toggle, next to the hovered content block.
      at = before ? target.start : target.end
    } else if (target?.kind === 'block') {
      // The dragged content IS (or contains) this toggle → drop outside it.
      at = before ? target.toggleStart! : target.toggleEnd!
    } else {
      at = target ? (before ? target.start : target.end) : docEnd
    }
  }

  return { at, wrapList }
}

/**
 * Moves a block (or a block range) to a drop target. All positions are in the
 * ORIGINAL doc's coordinates; the transaction's mapping translates the
 * insertion point through the removal step(s).
 */
export function movePayload(
  view: EditorView,
  payload: BlockInfo,
  target: BlockInfo | null,
  before: boolean
): void {
  const state = view.state
  const { at, wrapList } = computeInsertAt(state, payload, target, before)

  const tr = state.tr
  let frag: Fragment | null = null
  let captured: PMNode | null = null
  let node: PMNode | null = null

  const isRange = payload.node == null
  if (isRange) {
    frag = tr.doc.slice(payload.start, payload.end).content
    if (payload.listTypeName) {
      const listType = state.schema.nodes[payload.listTypeName]
      // A selection covering the ENTIRE list makes PM's slice() return the
      // whole list node (not raw items) — wrapping it again would nest a list
      // inside a list. Only wrap when the slice came back as raw items.
      const alreadyList =
        frag.childCount === 1 && frag.child(0).type.name === payload.listTypeName
      if (!alreadyList) {
        const wrapped = listType.createAndFill(null, frag) ?? listType.create(null, frag)
        frag = Fragment.from(wrapped)
      }
    } else {
      try {
        state.schema.nodes.doc.create(null, frag)
      } catch {
        return // defensive: range must be valid at doc level
      }
    }
  } else {
    captured = tr.doc.nodeAt(payload.start)
    // Defensive: if the doc changed between hover and drop (e.g. typing), the
    // node at the remembered position may no longer be the dragged block.
    if (!captured || !payload.node || !captured.eq(payload.node)) return
    node = captured
    if (wrapList) {
      const listType = state.schema.nodes[wrapList]
      node = listType.createAndFill(null, captured) ?? listType.create(null, captured)
    }
  }

  if (isRange) removeRange(tr, payload.start, payload.end)
  else removeBlock(tr, payload)

  let mapped = tr.mapping.map(at)
  // Positions are 0-based: 0 is the valid spot before the first block.
  mapped = Math.max(0, Math.min(mapped, tr.doc.content.size))
  const $m = tr.doc.resolve(mapped)

  // ---- dropping BETWEEN list items ---------------------------------------
  // A position inside a list sits between items (list content is item-only,
  // so the dragged content can't just be inserted there). Instead:
  //   - same-type items/lists MERGE into the target list (like copy-paste),
  //   - anything else SPLITS the list around the insertion, so it lands right
  //     where the drop line showed — between the hovered items.
  if ($m.depth > 0 && $m.parent.type.name.endsWith('List')) {
    const list = $m.parent
    const index = $m.index()

    // Same-type list fragment (item group or a dragged list) → join the items.
    if (frag && frag.childCount === 1 && frag.child(0).type.name === list.type.name) {
      tr.insert(mapped, frag.child(0).content)
      view.dispatch(tr)
      return
    }

    // Bare list item dropped into a compatible list → joins it directly.
    if (payload.kind === 'item' && captured && !wrapList) {
      tr.insert(mapped, captured)
      view.dispatch(tr)
      return
    }

    if (index === 0) {
      // Before the first item → place the content before the whole list.
      mapped = $m.before($m.depth)
    } else if (index >= list.childCount) {
      // After the last item → place the content after the whole list.
      mapped = $m.after($m.depth)
    } else {
      // Strictly between items → split the list around the insertion.
      const listStart = $m.before($m.depth)
      const listEnd = listStart + list.nodeSize
      const beforeItems = cutByIndex(list.content, 0, index)
      const afterItems = cutByIndex(list.content, index)
      const content = frag
        ? [list.copy(beforeItems), ...frag.content, list.copy(afterItems)]
        : [list.copy(beforeItems), node!, list.copy(afterItems)]
      tr.replaceWith(listStart, listEnd, content)
      view.dispatch(tr)
      return
    }
  }

  if (frag) {
    tr.insert(mapped, frag)
  } else if (node) {
    tr.insert(mapped, node)
  } else {
    return
  }

  view.dispatch(tr)
}

/**
 * When the editor has a multi-block text selection, capture it as a block
 * range. A selection over items of ONE list is kept as a precise item group
 * (so it can merge back into a compatible list or split one apart); any other
 * selection is snapped outward to whole lists so the fragment stays valid at
 * doc level. Returns null for single-block or empty selections.
 */
export function captureSelectionRange(state: EditorState): BlockInfo | null {
  const sel = state.selection
  if (sel.empty) return null
  const fromBlock = findBlock(state.doc.resolve(sel.from))
  const toBlock = findBlock(state.doc.resolve(sel.to))
  if (!fromBlock || !toBlock) return null
  if (fromBlock.start === toBlock.start && fromBlock.end === toBlock.end) return null

  const start = fromBlock.start
  const end = toBlock.end
  if (end <= start) return null

  // Selection over items of a SINGLE list → a precise item group. The slice of
  // whole items is raw (PM does NOT re-wrap it), so we carry the list type and
  // wrap it in movePayload when needed.
  if (
    fromBlock.kind === 'item' &&
    toBlock.kind === 'item' &&
    fromBlock.listStart != null &&
    fromBlock.listStart === toBlock.listStart
  ) {
    return {
      start,
      end,
      node: null,
      kind: 'top',
      listStart: fromBlock.listStart,
      listEnd: fromBlock.listEnd,
      listTypeName: fromBlock.listTypeName,
      toggleStart: null,
      toggleEnd: null
    }
  }

  // Otherwise snap outward to whole lists so the slice is valid at doc level.
  let s = start
  let e = end
  const validAtDoc = (a: number, b: number): boolean => {
    try {
      state.schema.nodes.doc.create(null, state.doc.slice(a, b).content)
      return true
    } catch {
      return false
    }
  }
  if (!validAtDoc(s, e)) {
    if (fromBlock.kind === 'item' && fromBlock.listStart != null && fromBlock.listStart < s) s = fromBlock.listStart
    if (toBlock.kind === 'item' && toBlock.listEnd != null && toBlock.listEnd > e) e = toBlock.listEnd
    if (!validAtDoc(s, e)) return null
  }

  return {
    start: s,
    end: e,
    node: null,
    kind: 'top',
    listStart: null,
    listEnd: null,
    listTypeName: null,
    toggleStart: null,
    toggleEnd: null
  }
}

export const BlockDrag = Extension.create({
  name: 'blockDrag',

  addProseMirrorPlugins() {
    const editor = this.editor
    return [
      new Plugin({
        key: KEY,
        view: (view) => {
          let grip: HTMLDivElement | null = null
          let dropLine: HTMLDivElement | null = null
          let dragInfo: BlockInfo | null = null
          let dropTarget: BlockInfo | null = null
          let dropBefore = true
          let dragging = false
          let lastRect: DOMRect | null = null
          let lastDropTargetStart: number | null = null
          let lastLineY = 0
          // Auto-scroll state: last pointer Y (from dragover), the scrollable
          // container to move, and the rAF loop id.
          let lastClientY = -1
          let scroller: HTMLElement | null = null
          let rafId: number | null = null

          const ensureUI = () => {
            if (!grip) {
              grip = document.createElement('div')
              grip.className = 'block-grip'
              grip.draggable = true
              grip.innerHTML =
                '<svg width="9" height="16" viewBox="0 0 9 16" fill="currentColor" aria-hidden="true">' +
                '<circle cx="2.2" cy="2" r="1.5"/><circle cx="6.8" cy="2" r="1.5"/>' +
                '<circle cx="2.2" cy="8" r="1.5"/><circle cx="6.8" cy="8" r="1.5"/>' +
                '<circle cx="2.2" cy="14" r="1.5"/><circle cx="6.8" cy="14" r="1.5"/></svg>'
              grip.title = 'Click to select · drag to move · right-click to turn into…'
              grip.addEventListener('dragstart', onDragStart)
              grip.addEventListener('dragend', onDragEnd)
              grip.addEventListener('click', onGripClick)
              grip.addEventListener('contextmenu', onGripContextMenu)
              document.body.appendChild(grip)
            }
            if (!dropLine) {
              dropLine = document.createElement('div')
              dropLine.className = 'block-drop-line'
              document.body.appendChild(dropLine)
            }
          }

          const hideUI = () => {
            grip?.classList.remove('is-visible')
            dropLine?.classList.remove('is-visible')
            lastRect = null
            dragInfo = null
          }

          const reset = () => {
            dragging = false
            dragInfo = null
            dropTarget = null
            grip?.classList.remove('is-dragging')
            stopAutoScroll()
            hideUI()
          }

          // ---- auto-scroll while dragging near the screen edges -----------
          // The app scrolls an inner container (`.main`), not the window, so
          // find the nearest scrollable ancestor of the editor once per drag.
          const findScroller = (): HTMLElement => {
            let el: HTMLElement | null = view.dom
            while (el) {
              const st = getComputedStyle(el)
              if (
                (st.overflowY === 'auto' || st.overflowY === 'scroll') &&
                el.scrollHeight > el.clientHeight
              ) {
                return el
              }
              el = el.parentElement
            }
            return (document.scrollingElement as HTMLElement) || document.documentElement
          }

          const scrollStep = () => {
            rafId = requestAnimationFrame(scrollStep)
            if (!dragging || !scroller || lastClientY < 0) return
            const vh = window.innerHeight
            let delta = 0
            if (lastClientY < SCROLL_EDGE) {
              // Near the top edge → scroll up (speed ramps with proximity).
              delta = -((SCROLL_EDGE - lastClientY) / SCROLL_EDGE) * SCROLL_MAX_SPEED
            } else if (lastClientY > vh - SCROLL_EDGE) {
              // Near the bottom edge → scroll down.
              delta = ((lastClientY - (vh - SCROLL_EDGE)) / SCROLL_EDGE) * SCROLL_MAX_SPEED
            }
            if (delta !== 0) scroller.scrollTop += delta
          }

          const startAutoScroll = () => {
            if (rafId != null) return
            scroller = findScroller()
            rafId = requestAnimationFrame(scrollStep)
          }

          const stopAutoScroll = () => {
            if (rafId != null) {
              cancelAnimationFrame(rafId)
              rafId = null
            }
            lastClientY = -1
          }

          // ---- hover: show the handle next to the block under the pointer --
          //
          // The handle must NEVER jump to a block the pointer isn't over. A wide
          // hover tolerance overlaps between neighbouring blocks, so crossing a
          // line boundary makes the handle ratchet up block-by-block ("it's
          // escaping!"). We follow with a tight vertical tolerance instead, and
          // keep the handle pinned while the pointer reaches for it (gutter or
          // gaps between blocks) or presses it (pre-dragstart wiggle).
          const onMouseMove = (e: MouseEvent) => {
            if (dragging) return
            if (e.target instanceof Node && grip && grip.contains(e.target)) return

            // RULE 1 — pointer near the current handle (grabbing / reaching
            // for it): keep it put so it can't slip away mid-grab.
            if (lastRect) {
              const hx = lastRect.left - 24
              const hy = lastRect.top + GRIP_TOP_OFFSET
              if (
                e.clientX >= hx - 10 &&
                e.clientX <= hx + 28 &&
                e.clientY >= hy - 10 &&
                e.clientY <= hy + 32
              ) {
                return
              }
            }

            // RULE 2 — pointer over a block: follow it (tight tolerance, no
            // overlap between neighbours).
            const coords = view.posAtCoords({ left: e.clientX, top: e.clientY })
            const info = coords ? findBlock(view.state.doc.resolve(coords.pos)) : null
            if (info) {
              const dom = view.nodeDOM(info.start) as HTMLElement | null
              if (dom) {
                const rect = dom.getBoundingClientRect()
                if (e.clientY >= rect.top - 2 && e.clientY <= rect.bottom + 2) {
                  lastRect = rect
                  dragInfo = info
                  grip!.style.left = `${Math.max(4, rect.left - 24)}px`
                  grip!.style.top = `${Math.max(4, rect.top + GRIP_TOP_OFFSET)}px`
                  grip!.classList.add('is-visible')
                  return
                }
              }
            }

            // RULE 3 — pointer in the gutter beside the block or in the gap
            // between blocks (margins aren't inside any block rect): keep the
            // handle where it is instead of hiding it.
            if (
              lastRect &&
              e.clientY >= lastRect.top - 30 &&
              e.clientY <= lastRect.bottom + 30 &&
              e.clientX >= lastRect.left - 40 &&
              e.clientX <= lastRect.right + 20
            ) {
              return
            }

            hideUI()
          }

          // ---- click: select the block -------------------------------------
          // A click that doesn't turn into a drag selects the whole block's
          // text (Shift extends the current selection to include it), so it can
          // then be dragged, copied, deleted or converted as one.
          const selectRange = (from: number, to: number) => {
            const { doc } = view.state
            const sel = TextSelection.between(doc.resolve(from), doc.resolve(to))
            view.dispatch(view.state.tr.setSelection(sel))
            view.focus()
          }

          const onGripClick = (e: MouseEvent) => {
            if (!dragInfo) return
            e.preventDefault()
            const { from, to } = view.state.selection
            if (e.shiftKey && !view.state.selection.empty) {
              selectRange(Math.min(from, dragInfo.start), Math.max(to, dragInfo.end))
            } else {
              selectRange(dragInfo.start, dragInfo.end)
            }
          }

          // ---- right-click: "Turn into" menu ------------------------------
          let menu: HTMLDivElement | null = null

          const closeMenu = () => {
            menu?.remove()
            menu = null
            document.removeEventListener('mousedown', onOutsideMenu, true)
            document.removeEventListener('keydown', onMenuKey, true)
            window.removeEventListener('blur', closeMenu)
            window.removeEventListener('resize', closeMenu)
          }
          const onOutsideMenu = (e: MouseEvent) => {
            if (menu && !menu.contains(e.target as Node)) closeMenu()
          }
          const onMenuKey = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
              e.preventDefault()
              closeMenu()
              view.focus()
            }
          }

          const onGripContextMenu = (e: MouseEvent) => {
            e.preventDefault()
            if (!dragInfo) return
            closeMenu()
            // Right-clicking a block that's part of a multi-block selection
            // converts the whole selection; otherwise just that block.
            const range = captureSelectionRange(view.state)
            const inRange = range && dragInfo.start >= range.start && dragInfo.end <= range.end
            const target = inRange ? range : dragInfo
            const current = inRange ? null : blockTypeAt(view.state, dragInfo.start, dragInfo.listTypeName)
            const schemaNodes = view.state.schema.nodes

            menu = document.createElement('div')
            menu.className = 'block-menu'
            menu.setAttribute('role', 'menu')
            const label = document.createElement('div')
            label.className = 'block-menu-label'
            label.textContent = inRange ? 'Turn selection into' : 'Turn into'
            menu.appendChild(label)

            for (const def of BLOCK_TYPES) {
              if (!schemaNodes[def.requires]) continue
              const item = document.createElement('button')
              item.type = 'button'
              item.className = `block-menu-item${current === def.id ? ' is-active' : ''}`
              item.setAttribute('role', 'menuitem')
              const icon = document.createElement('span')
              icon.className = 'block-menu-icon'
              icon.textContent = def.icon
              const text = document.createElement('span')
              text.textContent = def.label
              item.append(icon, text)
              // mousedown, not click: keeps the editor from blurring first.
              item.addEventListener('mousedown', (ev) => {
                ev.preventDefault()
                const id: BlockTypeId = def.id
                closeMenu()
                if (current !== id) turnInto(editor, target.start, target.end, id)
                else view.focus()
              })
              menu.appendChild(item)
            }

            document.body.appendChild(menu)
            const rect = menu.getBoundingClientRect()
            menu.style.left = `${Math.max(8, Math.min(e.clientX, window.innerWidth - rect.width - 8))}px`
            menu.style.top = `${Math.max(8, Math.min(e.clientY, window.innerHeight - rect.height - 8))}px`
            document.addEventListener('mousedown', onOutsideMenu, true)
            document.addEventListener('keydown', onMenuKey, true)
            window.addEventListener('blur', closeMenu)
            window.addEventListener('resize', closeMenu)
          }

          // ---- dragstart / dragend -----------------------------------------
          const onDragStart = (e: DragEvent) => {
            if (!dragInfo) {
              e.preventDefault()
              return
            }
            // If the user has a multi-block selection, drag the WHOLE
            // selection; otherwise drag the hovered block.
            const range = captureSelectionRange(view.state)
            const payload = range ?? dragInfo
            e.dataTransfer?.setData(MIME, String(payload.start))
            if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move'
            dragging = true
            dragInfo = payload
            grip?.classList.add('is-dragging')
            grip?.classList.remove('is-visible')
            lastClientY = e.clientY
            startAutoScroll()
            // Capture phase so our handlers run before the editor's own
            // drop logic and can stop it from seeing our drags.
            document.addEventListener('dragover', onDocDragOver, true)
            document.addEventListener('drop', onDocDrop, true)
          }

          const onDragEnd = () => {
            document.removeEventListener('dragover', onDocDragOver, true)
            document.removeEventListener('drop', onDocDrop, true)
            reset()
          }

          // ---- dragover: track the target + show the drop line -------------
          const onDocDragOver = (e: DragEvent) => {
            if (!dragging || !dragInfo) return
            if (!Array.from(e.dataTransfer?.types ?? []).includes(MIME)) return
            e.preventDefault()
            e.stopPropagation()
            if (e.dataTransfer) e.dataTransfer.dropEffect = 'move'

            // Track the pointer for edge auto-scroll (fires continuously
            // during a native drag, even when the mouse is stationary).
            lastClientY = e.clientY

            const coords = view.posAtCoords({ left: e.clientX, top: e.clientY })
            const target = coords ? findBlock(view.state.doc.resolve(coords.pos)) : null

            if (target) {
              const dom = view.nodeDOM(target.start) as HTMLElement | null
              if (dom) {
                const rect = dom.getBoundingClientRect()
                if (target.kind === 'block' && wholeToggleInDrag(dragInfo, target)) {
                  // Dragging this toggle over itself: flip the line at the
                  // TITLE boundary (title → before, content → after), so the
                  // line doesn't snap around while the pointer crosses the
                  // toggle's tall content area.
                  const titleRect = toggleTitleRect(view, target)
                  dropBefore = titleRect
                    ? e.clientY < titleRect.bottom
                    : e.clientY < rect.top + rect.height / 2
                } else {
                  dropBefore = e.clientY < rect.top + rect.height / 2
                }
              } else if (lastDropTargetStart !== target.start) {
                // No DOM for a fresh target — mirror the pointer relative to
                // the previously shown line so the line and the actual drop
                // stay in sync.
                dropBefore = e.clientY < lastLineY
              }
              lastDropTargetStart = target.start
              dropTarget = target
              showDropLine(target, dropBefore, e.clientY)
            } else {
              // Below the content / empty doc → append at the end.
              dropTarget = null
              dropBefore = true
              const ed = view.dom.getBoundingClientRect()
              showLineAt(ed.bottom)
            }
          }

          /** The title paragraph's rect for a 'block' target (or null). */
          const toggleTitleRect = (v: EditorView, target: BlockInfo): DOMRect | null => {
            if (target.toggleStart == null) return null
            const dom = v.nodeDOM(target.toggleStart + 1) as HTMLElement | null
            if (!dom) return null
            const r = dom.getBoundingClientRect()
            return r.height > 0 ? r : null
          }

          const showDropLine = (target: BlockInfo, before: boolean, fallbackY: number) => {
            // If the target's DOM can't be resolved, fall back to the pointer
            // position so the drop line never silently disappears.
            let y = fallbackY
            const dom = view.nodeDOM(target.start) as HTMLElement | null
            if (dom) {
              const rect = dom.getBoundingClientRect()
              if (target.kind === 'block' && wholeToggleInDrag(dragInfo!, target)) {
                // Line at the WHOLE toggle's edge (dropping outside it).
                const tDom = view.nodeDOM(target.toggleStart!) as HTMLElement | null
                const tRect = tDom ? tDom.getBoundingClientRect() : null
                y = before
                  ? tRect ? tRect.top : rect.top
                  : tRect ? tRect.bottom : rect.bottom
              } else {
                // The line tracks the hovered BLOCK (a list item included) so
                // multi-selections and toggles place precisely per line.
                y = before ? rect.top : rect.bottom
              }
            }
            showLineAt(y)
          }

          const showLineAt = (y: number) => {
            if (!dropLine) return
            lastLineY = y
            const ed = view.dom.getBoundingClientRect()
            dropLine.style.left = `${ed.left + 8}px`
            dropLine.style.width = `${Math.max(0, ed.width - 16)}px`
            dropLine.style.top = `${Math.max(0, y - 1)}px`
            dropLine.classList.add('is-visible')
          }

          // ---- drop: perform the move ---------------------------------------
          const onDocDrop = (e: DragEvent) => {
            if (!dragging || !dragInfo) {
              reset()
              return
            }
            if (!Array.from(e.dataTransfer?.types ?? []).includes(MIME)) {
              reset()
              return
            }
            e.preventDefault()
            e.stopPropagation()
            try {
              movePayload(view, dragInfo, dropTarget, dropBefore)
            } finally {
              // Always clear the drag state, even if the move threw.
              reset()
            }
          }

          ensureUI()
          document.addEventListener('mousemove', onMouseMove)

          return {
            destroy: () => {
              closeMenu()
              stopAutoScroll()
              document.removeEventListener('mousemove', onMouseMove)
              document.removeEventListener('dragover', onDocDragOver, true)
              document.removeEventListener('drop', onDocDrop, true)
              grip?.remove()
              dropLine?.remove()
              grip = null
              dropLine = null
            }
          }
        }
      })
    ]
  }
})

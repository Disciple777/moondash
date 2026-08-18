/**
 * Smoke test for the BlockDrag move algorithm (REAL code, bundled from
 * src/extensions/BlockDrag.ts). Drives findBlock / movePayload /
 * captureSelectionRange against a real ProseMirror schema that includes the
 * toggle node, and asserts the resulting document for the key drag scenarios:
 * single blocks, list items, toggles (whole-toggle vs inner content), and
 * multi-block selection ranges.
 *
 * Run:  npm run test:drag
 */
import { Schema, Fragment } from '@tiptap/pm/model'
import { EditorState, TextSelection } from '@tiptap/pm/state'
import { findBlock, movePayload, captureSelectionRange } from './.tmp-blockdrag.mjs'

const schema = new Schema({
  nodes: {
    doc: { content: 'block+' },
    paragraph: { content: 'inline*', group: 'block' },
    heading: { content: 'inline*', group: 'block', attrs: { level: { default: 1 } } },
    bulletList: { content: 'listItem+', group: 'block' },
    orderedList: { content: 'listItem+', group: 'block' },
    listItem: { content: 'paragraph block*', defining: true },
    taskList: { content: 'taskItem+', group: 'block' },
    taskItem: { content: 'paragraph block*', defining: true },
    toggle: { content: 'block+', group: 'block', attrs: { open: { default: true } } },
    text: { group: 'inline' }
  },
  marks: {}
})

/* ---------- builders ---------- */
const p = (t) => schema.nodes.paragraph.create(null, t ? schema.text(t) : null)
const h = (level, t) => schema.nodes.heading.create({ level }, schema.text(t))
const li = (...content) => schema.nodes.listItem.create(null, content)
const taskLi = (...content) => schema.nodes.taskItem.create(null, content)
const ul = (...items) => schema.nodes.bulletList.create(null, items)
const ol = (...items) => schema.nodes.orderedList.create(null, items)
const taskUl = (...items) => schema.nodes.taskList.create(null, items)
const toggle = (...content) => schema.nodes.toggle.create({ open: true }, content)
const doc = (...blocks) => schema.nodes.doc.create(null, blocks)

/* ---------- serializers ---------- */
function dumpList(list) {
  const items = []
  list.forEach((item) => {
    const parts = []
    item.forEach((c) => {
      if (c.type.name === 'paragraph') parts.push(c.textContent || '(empty)')
      else if (c.type.name.endsWith('List')) parts.push(dumpList(c))
    })
    items.push(parts.join(' '))
  })
  const kind = list.type.name === 'taskList' ? '☑' : list.type.name === 'orderedList' ? '1.' : '•'
  return `${kind}[${items.join(', ')}]`
}
function dumpNode(n) {
  if (n.type.name === 'paragraph') return `p(${n.textContent})`
  if (n.type.name === 'heading') return `h(${n.textContent})`
  if (n.type.name === 'toggle') return `toggle[${n.content.content.map(dumpNode).join(' ')}]`
  if (n.type.name.endsWith('List')) return dumpList(n)
  return n.type.name
}
function dump(docNode) {
  const parts = []
  docNode.forEach((n) => parts.push(dumpNode(n)))
  return parts.join(' | ')
}

/* ---------- harness ---------- */
let pass = 0
let fail = 0
function t(name, initial, dragText, targetText, before, expected) {
  const state = EditorState.create({ schema, doc: initial })
  const info = blockByText(state, dragText)
  const target = targetText ? blockByText(state, targetText) : null
  if (!info) {
    console.log(`FAIL ${name}: dragged block "${dragText}" not found`)
    fail++
    return
  }
  let next
  try {
    const fakeView = { state, dispatch: (tr) => (next = state.apply(tr)) }
    movePayload(fakeView, info, target, before)
  } catch (err) {
    console.log(`FAIL ${name}: threw ${err.message}`)
    fail++
    return
  }
  const got = dump(next.doc)
  if (got === expected) {
    pass++
  } else {
    console.log(`FAIL ${name}\n  expected: ${expected}\n  got:      ${got}`)
    fail++
  }
}

function blockByText(state, text) {
  let found = null
  state.doc.descendants((node, pos) => {
    if (found) return false
    if (
      ['listItem', 'taskItem', 'paragraph', 'heading', 'toggle'].includes(node.type.name) &&
      node.textContent === text
    ) {
      found = findBlock(state.doc.resolve(pos + 1))
      return false
    }
    return !found
  })
  return found
}

function blockStartByText(state, text) {
  let found = -1
  state.doc.descendants((node, pos) => {
    if (found >= 0) return false
    if (['paragraph', 'heading', 'toggle'].includes(node.type.name) && node.textContent === text) {
      found = pos
      return false
    }
    return found < 0
  })
  return found
}

function dragRange(state, fromText, toText) {
  const a = blockStartByText(state, fromText)
  const b = blockStartByText(state, toText)
  if (a < 0 || b < 0) throw new Error(`range blocks not found: ${fromText}..${toText}`)
  const from = a + 1
  const to = b + 1 + state.doc.nodeAt(b).content.size
  return captureSelectionRange({
    doc: state.doc,
    schema,
    selection: TextSelection.create(state.doc, from, to)
  })
}

/* ============ single blocks + lists (existing behavior) ============ */
t('reorder top-level', doc(p('One'), p('Two'), p('Three')), 'One', 'Three', false, 'p(Two) | p(Three) | p(One)')
t('reorder same list', doc(ul(li(p('A')), li(p('B')), li(p('C')))), 'A', 'C', false, '•[B, C, A]')
t('exit list to top', doc(ul(li(p('A')), li(p('B'))), p('X')), 'B', 'X', true, '•[A] | •[B] | p(X)')
t('cross-list same type', doc(ul(li(p('A')), li(p('B'))), ul(li(p('C')), li(p('D')))), 'A', 'C', false, '•[B] | •[C, A, D]')
t('single-item list cleanup', doc(p('One'), ul(li(p('A')))), 'A', 'One', true, '•[A] | p(One)')
t('top block onto list', doc(p('One'), ul(li(p('A')))), 'One', 'A', false, '•[A] | p(One)')
t('nested list reorder', doc(ul(li(p('A')), li(p('B'), ul(li(p('C')), li(p('D')))))), 'D', 'C', true, '•[A, B •[D, C]]')
t('task items reorder', doc(taskUl(taskLi(p('A')), taskLi(p('B')))), 'A', 'B', false, '☑[B, A]')
t('incompatible list types', doc(ul(li(p('A'))), ol(li(p('B')))), 'A', 'B', false, '1.[B] | •[A]')
t('drop on self no-op', doc(ul(li(p('A')), li(p('B')))), 'A', 'A', true, '•[A, B]')

/* ============ toggles ============ */
// The toggle TITLE drags the whole toggle.
t(
  'toggle title moves whole toggle',
  doc(p('One'), toggle(p('Title'), p('Body')), p('Three')),
  'Title',
  'Three',
  false,
  'p(One) | p(Three) | toggle[p(Title) p(Body)]'
)
// Dropping a paragraph INTO a toggle (before an inner content block).
t(
  'drop paragraph inside toggle',
  doc(p('One'), toggle(p('Title'), p('Body')), p('Three')),
  'One',
  'Body',
  true,
  'toggle[p(Title) p(One) p(Body)] | p(Three)'
)
// Dropping a paragraph into a toggle (after an inner content block).
t(
  'drop paragraph inside toggle after',
  doc(p('One'), toggle(p('Title'), p('Body')), p('Three')),
  'One',
  'Body',
  false,
  'toggle[p(Title) p(Body) p(One)] | p(Three)'
)
// Reordering WITHIN a toggle (content blocks are individually draggable).
t(
  'reorder inside toggle',
  doc(toggle(p('Title'), p('A'), p('B')), p('X')),
  'B',
  'A',
  true,
  'toggle[p(Title) p(B) p(A)] | p(X)'
)
// Dragging content OUT of a toggle to top level.
t(
  'drag content out of toggle',
  doc(toggle(p('Title'), p('Body')), p('Three')),
  'Body',
  'Three',
  false,
  'toggle[p(Title)] | p(Three) | p(Body)'
)
// Dragging a toggle and dropping INSIDE itself → stays outside (no-op-ish).
t(
  'toggle drop inside itself stays outside',
  doc(p('One'), toggle(p('Title'), p('Body')), p('Three')),
  'Title',
  'Body',
  true,
  'p(One) | toggle[p(Title) p(Body)] | p(Three)'
)
// Dropping a list item INTO a toggle wraps it in a list.
t(
  'drop list item inside toggle',
  doc(ul(li(p('A'))), toggle(p('Title'), p('Body'))),
  'A',
  'Body',
  true,
  'toggle[p(Title) •[A] p(Body)]'
)

/* ============ multi-block selection ranges ============ */
function tRange(name, initial, fromText, toText, targetText, before, expected) {
  const state = EditorState.create({ schema, doc: initial })
  let payload
  try {
    payload = dragRange(state, fromText, toText)
  } catch (err) {
    console.log(`FAIL ${name}: ${err.message}`)
    fail++
    return
  }
  if (!payload) {
    console.log(`FAIL ${name}: no range captured for "${fromText}..${toText}"`)
    fail++
    return
  }
  const target = targetText ? blockByText(state, targetText) : null
  let next
  try {
    const fakeView = { state, dispatch: (tr) => (next = state.apply(tr)) }
    movePayload(fakeView, payload, target, before)
  } catch (err) {
    console.log(`FAIL ${name}: threw ${err.message}`)
    fail++
    return
  }
  const got = dump(next.doc)
  if (got === expected) {
    pass++
  } else {
    console.log(`FAIL ${name}\n  expected: ${expected}\n  got:      ${got}`)
    fail++
  }
}

tRange('multi drag two paragraphs', doc(p('One'), p('Two'), p('Three'), p('Four')), 'One', 'Two', 'Four', false, 'p(Three) | p(Four) | p(One) | p(Two)')
tRange('multi drag into toggle', doc(p('One'), p('Two'), toggle(p('Title'), p('Body'))), 'One', 'Two', 'Body', true, 'toggle[p(Title) p(One) p(Two) p(Body)]')
// Selection over list items moves ONLY the selected items — PM's slice()
// re-wraps them in a fresh list; the rest of the list stays put.
tRange('multi drag partial list', doc(p('One'), ul(li(p('A')), li(p('B')), li(p('C'))), p('Two')), 'A', 'B', 'Two', false, 'p(One) | •[C] | p(Two) | •[A, B]')
// Selection ending mid-list: the selected item moves (re-wrapped) and the
// remaining item keeps its list.
tRange('multi drag mixed snap', doc(p('One'), ul(li(p('A')), li(p('B'))), p('Two')), 'B', 'Two', 'One', true, '•[B] | p(Two) | p(One) | •[A]')
// Dragging ALL items of a list moves the whole list (empty list swept away).
tRange('multi drag whole list', doc(ul(li(p('A')), li(p('B'))), p('One')), 'A', 'B', 'One', false, 'p(One) | •[A, B]')

/* ============ drop line precision: toggle / multi-selection INTO lists ============ */
// A toggle dropped between items SPLITS the list around it (line tracks items).
t('toggle splits list between items', doc(ul(li(p('A')), li(p('B')), li(p('C'))), toggle(p('T'))), 'T', 'C', true, '•[A, B] | toggle[p(T)] | •[C]')
// Toggle before the first item → placed before the whole list.
t('toggle before first item', doc(ul(li(p('A')), li(p('B')), li(p('C'))), toggle(p('T'))), 'T', 'A', true, 'toggle[p(T)] | •[A, B, C]')
// Toggle after the last item → placed after the whole list.
t('toggle after last item', doc(ul(li(p('A')), li(p('B')), li(p('C'))), toggle(p('T'))), 'T', 'C', false, '•[A, B, C] | toggle[p(T)]')

// Multi-selection of list items MERGES into the same-type list (reorder).
tRange('multi items reorder after last', doc(ul(li(p('A')), li(p('B')), li(p('C')), li(p('D')))), 'A', 'B', 'D', false, '•[C, D, A, B]')
tRange('multi items drop between', doc(ul(li(p('A')), li(p('B')), li(p('C')), li(p('D')))), 'A', 'B', 'D', true, '•[C, A, B, D]')
// Multi-selection dropped into ANOTHER same-type list merges there.
tRange('multi items merge into other list', doc(ul(li(p('A')), li(p('B'))), ul(li(p('C')), li(p('D')))), 'A', 'B', 'C', true, '•[A, B, C, D]')
// Different list type dropped between items → splits the target list.
tRange('multi different-type splits list', doc(ol(li(p('X')), li(p('Y')), li(p('Z'))), ul(li(p('A')), li(p('B')))), 'A', 'B', 'Y', true, '1.[X] | •[A, B] | 1.[Y, Z]')
// A single item dragged into an INCOMPATIBLE list splits it around the item.
t('item into incompatible list splits', doc(ul(li(p('A'))), ol(li(p('X')), li(p('Y')), li(p('Z')))), 'A', 'Y', true, '1.[X] | •[A] | 1.[Y, Z]')

console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)

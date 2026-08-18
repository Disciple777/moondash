/**
 * Interactive keyboard smoke test for the REAL Toggle extension.
 *
 * Bundles src/extensions/Toggle.tsx with esbuild (externalizing @tiptap/react
 * so it shares instances with this file's imports) and drives the actual
 * keyboard shortcuts — Enter / Tab / Shift-Tab — through ProseMirror in jsdom.
 *
 * Run:  npm run test:toggle-keys   (after `npm run build:toggle-test` or via
 * the combined script in package.json)
 */
import { JSDOM } from 'jsdom'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true
})
global.window = dom.window
global.document = dom.window.document
global.DOMParser = dom.window.DOMParser
global.Node = dom.window.Node
global.Element = dom.window.Element
global.HTMLElement = dom.window.HTMLElement
global.SVGElement = dom.window.SVGElement
global.getComputedStyle = dom.window.getComputedStyle
global.navigator = dom.window.navigator
global.requestAnimationFrame = dom.window.requestAnimationFrame?.bind(dom.window)
global.cancelAnimationFrame = dom.window.cancelAnimationFrame?.bind(dom.window)

const { Editor } = await import('@tiptap/react')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { Markdown } = await import('tiptap-markdown')
const { Toggle } = await import('./.tmp-toggle.mjs')
import assert from 'node:assert'

const editor = new Editor({
  element: document.getElementById('root'),
  extensions: [StarterKit, Markdown.configure({ html: true }), Toggle]
})

let failures = 0
function fail(msg) {
  failures++
  console.error('✗ FAIL:', msg)
}

/** Compact structural dump: p('text') | toggle[p('t'), p('')] ... */
function dump(doc) {
  const out = []
  doc.descendants((n, pos) => {
    if (n.type.name === 'text') return
    const kids = []
    n.descendants((c) => {
      if (c.type.name === 'text') kids.push(c.text)
    })
    const label = kids.length ? `'${kids.join(' ')}'` : ''
    out.push(`${n.type.name}(${label})@${pos}`)
  })
  return out.join(' | ')
}

/** Position of the block (at depth 1) whose textContent matches `text`. */
function findTopBlock(text) {
  let found = -1
  editor.state.doc.descendants((n, pos) => {
    if (found >= 0) return
    if (n.type.name !== 'text' && n.type.name !== 'toggle' && n.textContent === text) found = pos
  })
  return found
}

/** Put the cursor at the very start of a top-level block with `text`. */
function cursorAtStartOf(text) {
  const pos = findTopBlock(text)
  assert.notStrictEqual(pos, -1, `block '${text}' exists`)
  editor.commands.setTextSelection(pos + 1)
}

/** Put the cursor at the very END of a top-level block with `text`. */
function cursorAtEndOf(text) {
  const pos = findTopBlock(text)
  assert.notStrictEqual(pos, -1, `block '${text}' exists`)
  // First block starts at 0, so its text runs [1, 1 + content.size).
  editor.commands.setTextSelection(pos + 1 + editor.state.doc.nodeAt(pos).content.size)
}

function press(key, shiftKey = false) {
  const e = new dom.window.KeyboardEvent('keydown', { key, shiftKey, bubbles: true, cancelable: true })
  editor.view.dom.dispatchEvent(e)
}

const inToggle = (pos) => {
  let d = pos.depth
  while (d > 0 && pos.node(d).type.name !== 'toggle') d--
  return d
}

try {
  // ---- 1. setToggle lands the cursor in the TITLE ---------------------
  editor.commands.setContent('Before\n\nAfter')
  cursorAtEndOf('Before')
  editor.commands.setToggle()
  const d1 = editor.state.selection.$from
  const td1 = inToggle(d1)
  assert.ok(td1 > 0, 'cursor is inside a toggle after setToggle')
  assert.strictEqual(d1.index(td1), 0, 'cursor is in the FIRST child (title)')
  console.log('✓ 1. setToggle puts the cursor in the title')
  console.log('   ', dump(editor.state.doc))

  // ---- 2. Enter on the EMPTY title hops into the content paragraph -------
  // (the title starts empty now — the "Toggle heading" ghost is a CSS
  // placeholder, not baked-in text, so typing never collides with it)
  press('Enter')
  const d2 = editor.state.selection.$from
  const td2 = inToggle(d2)
  assert.ok(td2 > 0, 'still inside the toggle after Enter')
  assert.strictEqual(d2.index(td2), 1, 'cursor moved to the CONTENT (2nd child)')
  const t2 = d2.node(td2)
  assert.strictEqual(t2.childCount, 2, `toggle = title + content (got ${t2.childCount} children)`)
  assert.strictEqual(t2.child(0).content.size, 0, 'title stayed empty')
  assert.strictEqual(t2.child(1).type.name, 'paragraph', 'content block is a paragraph')
  console.log('✓ 2. Enter on the empty title hops into the content (inside)')

  // ---- 3. Tab on a paragraph right after a toggle nests it inside -----
  editor.commands.setContent(
    '<details class="toggle" open><p>Title</p></details>\n\nNest me\n\nAfter all'
  )
  cursorAtStartOf('Nest me')
  press('Tab')
  let doc = editor.state.doc
  const dump3 = dump(doc)
  let t3 = null
  doc.descendants((n) => {
    if (n.type.name === 'toggle') {
      t3 = n
      return false
    }
  })
  assert.ok(t3, 'toggle exists after Tab')
  assert.strictEqual(t3.childCount, 2, `toggle holds title + nested block (got: ${dump3.replace(/@\d+/g, '')})`)
  assert.strictEqual(t3.child(0).textContent, 'Title', 'title preserved')
  assert.strictEqual(t3.child(1).textContent, 'Nest me', `'Nest me' nested inside (got: ${dump3.replace(/@\d+/g, '')})`)
  const d3 = editor.state.selection.$from
  assert.ok(inToggle(d3) > 0, 'cursor is inside the toggle after nesting')
  assert.strictEqual(d3.parent.textContent, 'Nest me', 'cursor in the nested block')
  console.log('✓ 3. Tab nests a following paragraph into the toggle')
  console.log('   ', dump3)

  // ---- 4. Tab with no preceding toggle → no-op -------------------------
  editor.commands.setContent('Alpha\n\nBeta')
  cursorAtStartOf('Beta')
  const before4 = dump(editor.state.doc)
  press('Tab')
  const after4 = dump(editor.state.doc)
  assert.strictEqual(after4, before4, 'doc unchanged when there is no preceding toggle')
  console.log('✓ 4. Tab is a no-op without a preceding toggle')

  // ---- 5. Shift-Tab on the title converts the toggle to plain blocks ---
  editor.commands.setContent(
    '<details class="toggle" open><p>Title</p><p>Body inside</p></details>\n\nAfter'
  )
  cursorAtStartOf('Title')
  press('Tab', true) // Shift-Tab
  const dump5 = dump(editor.state.doc).replace(/@\d+/g, '')
  assert.strictEqual(
    dump5,
    "paragraph('Title') | paragraph('Body inside') | paragraph('After')",
    `toggle flattened (got: ${dump5})`
  )
  console.log('✓ 5. Shift-Tab on the title un-toggles the whole block')

  // ---- 6. Shift-Tab on a content block pulls it out after the toggle ---
  editor.commands.setContent(
    '<details class="toggle" open><p>Title</p><p>Pull me</p><p>Stay</p></details>'
  )
  cursorAtStartOf('Pull me')
  press('Tab', true) // Shift-Tab
  const dump6 = dump(editor.state.doc).replace(/@\d+/g, '')
  assert.strictEqual(
    dump6,
    "toggle('Title Stay') | paragraph('Title') | paragraph('Stay') | paragraph('Pull me')",
    `block pulled out of the toggle (got: ${dump6})`
  )
  console.log('✓ 6. Shift-Tab on content pulls the block out after the toggle')

  // ---- 7. Tab inside a toggle nests into a preceding SUB-toggle --------
  editor.commands.setContent(
    '<details class="toggle" open><p>Outer</p><details class="toggle"><p>Inner</p></details><p>Nest deeper</p></details>'
  )
  cursorAtStartOf('Nest deeper')
  press('Tab')
  const dump7 = dump(editor.state.doc)
  // Outer toggle → [p('Outer'), inner toggle]; inner toggle → [p('Inner'), p('Nest deeper')]
  const toggles7 = []
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'toggle') toggles7.push(n)
  })
  assert.strictEqual(toggles7.length, 2, `two toggles remain (got: ${dump7.replace(/@\d+/g, '')})`)
  const outer7 = toggles7[0]
  const inner7 = toggles7[1]
  assert.strictEqual(outer7.child(0).textContent, 'Outer', 'outer title')
  assert.strictEqual(inner7.child(0).textContent, 'Inner', 'inner title')
  assert.strictEqual(
    inner7.child(1).textContent,
    'Nest deeper',
    `'Nest deeper' nested into the inner toggle (got: ${dump7.replace(/@\d+/g, '')})`
  )
  console.log('✓ 7. Tab inside a toggle nests into a preceding sub-toggle')
  console.log('   ', dump7.replace(/@\d+/g, ''))

  // ---- 8. Tab is a no-op at the start of the title ---------------------
  editor.commands.setContent('<details class="toggle" open><p>Title</p><p>X</p></details>')
  cursorAtStartOf('Title')
  const before8 = dump(editor.state.doc)
  press('Tab')
  const after8 = dump(editor.state.doc)
  assert.strictEqual(after8, before8, 'Tab on the title does nothing')
  console.log('✓ 8. Tab on the title is a no-op')
} catch (err) {
  failures++
  console.error('✗ FAIL:', err.message)
  console.error(err.stack?.split('\n').slice(0, 5).join('\n'))
} finally {
  editor.destroy()
}

if (failures > 0) {
  console.error('--- toggle keys: FAILED ---')
  process.exit(1)
}
console.log('--- toggle keys: all assertions passed ---')

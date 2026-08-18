/**
 * Smoke test for the Toggle (Notion-style collapsible) markdown round-trip.
 * Runs the REAL tiptap-markdown pipeline (markdown-it + ProseMirror schema)
 * in jsdom and asserts that <details class="toggle"> survives parse → serialize
 * → parse without losing structure, open state, or text.
 *
 * The Toggle node spec is replicated here in JS because src/extensions/Toggle.tsx
 * can't be imported by plain Node; keep it in sync with that file.
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

const { Editor, Node } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { Markdown } = await import('tiptap-markdown')
import assert from 'node:assert'

// ---- replica of the Toggle node from src/extensions/Toggle.tsx ----
const ToggleSpec = Node.create({
  name: 'toggle',
  group: 'block',
  content: 'block+',
  defining: true,
  addAttributes() {
    return {
      open: {
        default: true,
        parseHTML: (el) => el.hasAttribute('open'),
        renderHTML: (attrs) => (attrs.open ? { open: '' } : {})
      }
    }
  },
  parseHTML() {
    return [{ tag: 'details.toggle' }, { tag: 'details' }]
  },
  renderHTML({ HTMLAttributes }) {
    return ['details', { ...HTMLAttributes, class: 'toggle' }, 0]
  }
})

const editor = new Editor({
  element: document.getElementById('root'),
  extensions: [StarterKit, Markdown.configure({ html: true }), ToggleSpec]
})

function toggles(doc) {
  const found = []
  doc.descendants((n) => {
    if (n.type.name === 'toggle') found.push(n)
  })
  return found
}

function expectToggle(mdInput, expected) {
  editor.commands.setContent(mdInput)
  const ts = toggles(editor.state.doc)
  assert.strictEqual(ts.length, expected.count, 'toggle count for: ' + mdInput.slice(0, 40))
  if (ts.length) {
    assert.strictEqual(ts[0].attrs.open, expected.open, 'open state')
    if (expected.children) {
      assert.strictEqual(ts[0].childCount, expected.children.length, 'child count')
      expected.children.forEach((text, i) => {
        assert.strictEqual(ts[0].child(i).textContent, text, `child ${i} text`)
      })
    }
  }
  return ts
}

let failures = 0
try {
  // 1. Open toggle with title + content paragraph
  expectToggle('<details class="toggle" open>\n<p>Title here</p>\n<p>Content here</p>\n</details>', {
    count: 1,
    open: true,
    children: ['Title here', 'Content here']
  })
  console.log('✓ 1. open toggle parses (title + content)')

  // 2. Closed toggle (no open attribute)
  expectToggle('<details class="toggle">\n<p>Closed</p>\n<p>Hidden</p>\n</details>', {
    count: 1,
    open: false,
    children: ['Closed', 'Hidden']
  })
  console.log('✓ 2. closed toggle parses (open=false)')

  // 3. Nested toggles (outer + inner = 2 toggle nodes)
  const nested = expectToggle(
    '<details class="toggle" open>\n<p>Outer</p>\n<details class="toggle">\n<p>Inner</p>\n<p>Deep</p>\n</details>\n</details>',
    { count: 2, open: true }
  )
  const outer = nested[0]
  const innerToggle = nested[1]
  assert.strictEqual(outer.childCount, 2, 'outer has title + inner toggle')
  assert.strictEqual(outer.child(0).textContent, 'Outer', 'outer title')
  assert.strictEqual(outer.child(1).type.name, 'toggle', 'nested toggle child')
  assert.strictEqual(innerToggle.child(0).textContent, 'Inner', 'inner title')
  assert.strictEqual(innerToggle.child(1).textContent, 'Deep', 'inner content')
  console.log('✓ 3. nested toggles parse')

  // 4. Toggle containing a bullet list
  const withList = expectToggle(
    '<details class="toggle" open>\n<p>Title</p>\n<ul>\n<li>a</li>\n<li>b</li>\n</ul>\n</details>',
    { count: 1, open: true }
  )
  assert.strictEqual(withList[0].child(1).type.name, 'bulletList', 'list kept inside toggle')
  console.log('✓ 4. lists inside toggles parse')

  // 5. Serialize back to markdown — structure + open state preserved
  editor.commands.setContent(
    '<details class="toggle" open>\n<p>Title here</p>\n<p>Content here</p>\n</details>\n\nAfter the toggle.'
  )
  const md = editor.storage.markdown.getMarkdown()
  assert.ok(md.includes('<details'), 'serialized markdown keeps <details>')
  assert.ok(md.includes('open'), 'serialized markdown keeps open attr')
  assert.ok(md.includes('Title here'), 'serialized markdown keeps title text')
  assert.ok(md.includes('Content here'), 'serialized markdown keeps content text')
  assert.ok(md.includes('After the toggle.'), 'sibling content preserved')
  console.log('✓ 5. open toggle serializes with <details open>')
  console.log('    md:', JSON.stringify(md))

  // 6. Closed toggle serializes WITHOUT the open attribute
  editor.commands.setContent('<details class="toggle">\n<p>Closed</p>\n<p>Hidden</p>\n</details>')
  const mdClosed = editor.storage.markdown.getMarkdown()
  assert.ok(!/\bopen\b/.test(mdClosed), 'closed toggle serializes without open attr')
  console.log('✓ 6. closed toggle serializes without open attr')
  console.log('    md:', JSON.stringify(mdClosed))

  // 7. Full round-trip: serialize → re-parse → same structure
  const parsed = expectToggle(md, { count: 1, open: true, children: ['Title here', 'Content here'] })
  assert.ok(parsed.length === 1, 're-parse finds the toggle')
  const mdAgain = editor.storage.markdown.getMarkdown()
  assert.ok(mdAgain.includes('Title here') && mdAgain.includes('Content here'), 're-serialize stable')
  console.log('✓ 7. serialize → parse → serialize is stable')
} catch (err) {
  failures++
  console.error('✗ FAIL:', err.message)
  console.error(err.stack?.split('\n').slice(0, 4).join('\n'))
} finally {
  editor.destroy()
}

if (failures > 0) {
  console.error('--- toggle round-trip: FAILED ---')
  process.exit(1)
}
console.log('--- toggle round-trip: all assertions passed ---')

/**
 * Smoke test for the table markdown round-trip.
 * Runs the REAL tiptap-markdown pipeline (markdown-it + ProseMirror schema)
 * in jsdom and asserts that a GFM table survives parse → serialize → parse
 * without losing its shape, header row, or cell text.
 *
 * Guards two things that silently break tables:
 *  - the Table extensions not being loaded (cells collapse into one paragraph)
 *  - tiptap-markdown serializing a table as anything but a GFM table
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
// defineProperty, not assignment: Node 22 ships `navigator` as a getter-only
// global, which a plain assignment throws on.
Object.defineProperty(global, 'navigator', {
  value: dom.window.navigator,
  writable: true,
  configurable: true
})
global.requestAnimationFrame = dom.window.requestAnimationFrame?.bind(dom.window)
global.cancelAnimationFrame = dom.window.cancelAnimationFrame?.bind(dom.window)

const { Editor } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { Markdown } = await import('tiptap-markdown')
const { Table } = await import('@tiptap/extension-table')
const { TableRow } = await import('@tiptap/extension-table-row')
const { TableCell } = await import('@tiptap/extension-table-cell')
const { TableHeader } = await import('@tiptap/extension-table-header')
import assert from 'node:assert'

const editor = new Editor({
  element: document.getElementById('root'),
  extensions: [
    StarterKit,
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    Markdown.configure({ html: true, transformPastedText: true, transformCopiedText: true })
  ]
})

const MD = [
  '| Zone | Folders | What it holds |',
  '| --- | --- | --- |',
  '| 1 | recup_dir.1 | source code and text |',
  '| 2 | recup_dir.152 | photos and videos |',
  ''
].join('\n')

/** Shape of the first table in the doc: [rowCount, colCount, headerCells, allText]. */
function tableShape(doc) {
  let table = null
  doc.descendants((n) => {
    if (n.type.name === 'table' && !table) table = n
  })
  if (!table) return null
  const rows = []
  let headerCells = 0
  table.forEach((row) => {
    const cells = []
    row.forEach((cell) => {
      cells.push(cell.textContent)
      if (cell.type.name === 'tableHeader') headerCells++
    })
    rows.push(cells)
  })
  return { rows, headerCells }
}

// ---- 1. A GFM table parses into a real table node ----
editor.commands.setContent(MD)
const parsed = tableShape(editor.state.doc)
assert.ok(parsed, 'markdown table should parse into a table node (are the Table extensions loaded?)')
assert.strictEqual(parsed.rows.length, 3, 'row count (1 header + 2 body)')
assert.deepStrictEqual(parsed.rows[0], ['Zone', 'Folders', 'What it holds'], 'header cells')
assert.deepStrictEqual(parsed.rows[1], ['1', 'recup_dir.1', 'source code and text'], 'first body row')
assert.strictEqual(parsed.headerCells, 3, 'header row should use tableHeader cells')

// ---- 2. It serializes back out as a GFM table, not HTML or flattened text ----
const out = editor.storage.markdown.getMarkdown()
assert.ok(out.includes('| Zone'), `serialized markdown should keep the pipe table, got:\n${out}`)
assert.ok(!out.includes('<table'), `serialized markdown should not fall back to HTML, got:\n${out}`)

// ---- 3. Round-trip is stable (parse → serialize → parse) ----
editor.commands.setContent(out)
const again = tableShape(editor.state.doc)
assert.ok(again, 'round-tripped markdown should still parse into a table')
assert.deepStrictEqual(again.rows, parsed.rows, 'cell text survives the round-trip')
assert.strictEqual(again.headerCells, parsed.headerCells, 'header row survives the round-trip')

// ---- 4. insertTable (what the /table slash command runs) builds a 3x3 ----
editor.commands.setContent('')
editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()
const inserted = tableShape(editor.state.doc)
assert.ok(inserted, 'insertTable should create a table node')
assert.strictEqual(inserted.rows.length, 3, 'insertTable row count')
assert.strictEqual(inserted.rows[0].length, 3, 'insertTable column count')
assert.strictEqual(inserted.headerCells, 3, 'insertTable should add a header row')

console.log('smoke-table: OK — parse, serialize, round-trip and insertTable all pass')

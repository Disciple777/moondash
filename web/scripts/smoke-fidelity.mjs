/**
 * Round-trip fidelity for notes: what is read from disk must be what gets
 * written back. Runs the REAL tiptap-markdown pipeline in jsdom with the same
 * extensions and options as the editor, and requires EXACT identity for a
 * corpus of documents (md -> editor -> md), plus identity for documents built
 * in the editor (editor -> md -> editor).
 *
 * Guards the losses that used to be autosaved back over people's files:
 * flattened line breaks, collapsed blank lines, deleted <angle brackets>,
 * doubled backslashes.
 */
import { JSDOM } from 'jsdom'
import assert from 'node:assert'

const dom = new JSDOM('<!doctype html><html><body><div id="root"></div></body></html>', {
  pretendToBeVisual: true
})
// defineProperty, not Object.assign: Node 22 ships its own `navigator` as a
// getter-only global, which a plain assignment throws on.
for (const [key, value] of Object.entries({
  window: dom.window,
  document: dom.window.document,
  DOMParser: dom.window.DOMParser,
  Node: dom.window.Node,
  Element: dom.window.Element,
  HTMLElement: dom.window.HTMLElement,
  SVGElement: dom.window.SVGElement,
  getComputedStyle: dom.window.getComputedStyle,
  navigator: dom.window.navigator
})) {
  Object.defineProperty(global, key, { value, writable: true, configurable: true })
}
global.requestAnimationFrame = (cb) => setTimeout(cb, 0)
global.cancelAnimationFrame = (id) => clearTimeout(id)

const { Editor, Node, Mark } = await import('@tiptap/core')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { Markdown } = await import('tiptap-markdown')
const { default: TaskList } = await import('@tiptap/extension-task-list')
const { default: TaskItem } = await import('@tiptap/extension-task-item')
const { default: Link } = await import('@tiptap/extension-link')
const { Table } = await import('@tiptap/extension-table')
const { TableRow } = await import('@tiptap/extension-table-row')
const { TableCell } = await import('@tiptap/extension-table-cell')
const { TableHeader } = await import('@tiptap/extension-table-header')
const { MarkdownFidelity } = await import('./.tmp-fidelity.mjs')
const { TextColor } = await import('./.tmp-textcolor.mjs')

// Replica of the Toggle node (src/extensions/Toggle.tsx has a React node view
// plain Node can't load) — same spec as scripts/smoke-toggle.mjs.
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
  parseHTML: () => [{ tag: 'details.toggle' }, { tag: 'details' }],
  renderHTML: ({ HTMLAttributes }) => ['details', { ...HTMLAttributes, class: 'toggle' }, 0]
})

const editor = new Editor({
  element: document.getElementById('root'),
  extensions: [
    ToggleSpec,
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Table.configure({ resizable: false }),
    TableRow,
    TableCell,
    TableHeader,
    Link.configure({ openOnClick: false, autolink: true }),
    // Same options as Editor.tsx / QuickOpenEditor.tsx.
    Markdown.configure({ html: true, breaks: true, transformPastedText: true, transformCopiedText: true }),
    MarkdownFidelity,
    TextColor
  ]
})

const B = String.fromCharCode(92) // one backslash, unambiguously
const md = () => editor.storage.markdown.getMarkdown()
const load = (src) => {
  editor.commands.setContent(src)
  return md()
}

let n = 0
let failures = 0
const check = (label, actual, expected) => {
  n++
  try {
    assert.strictEqual(actual, expected)
    console.log(`✓ ${n}. ${label}`)
  } catch {
    failures++
    console.log(`✗ ${n}. ${label}\n    expected: ${JSON.stringify(expected)}\n    actual:   ${JSON.stringify(actual)}`)
  }
}

// ── 1. md -> editor -> md must be byte-identical ───────────────────────────────
const IDENTITY = {
  'plain paragraph': 'Just a sentence.',
  'two paragraphs': 'First.\n\nSecond.',
  'line breaks inside a paragraph': 'line one\nline two\nline three',
  'two blank lines between blocks': 'a\n\n\nb',
  'four blank lines between blocks': 'a\n\n\n\n\nb',
  'leading blank line': '\nstarts after a gap',
  'trailing blank line': 'ends with a gap\n\n',
  'many trailing blank lines': 'ends\n\n\n\n',
  'angle brackets inline': 'use <something here> as a placeholder',
  'angle brackets on their own line': '<something here>',
  'angle brackets block, several lines': '<something here>\nand <another>',
  'generics': 'List<String> and Map<K, V>',
  'comparison': 'if a < b and c > d',
  'html comment kept as text': '<!-- keep me -->',
  'windows path': ['C:', 'Users', 'CPU', 'AppData', 'Local'].join(B),
  // In markdown SOURCE a doubled backslash is one literal backslash, so a
  // two-backslash UNC path is written as three.
  'UNC path': `${B}${B}${B}server${B}share`,
  'heading levels': '# One\n\n## Two\n\n### Three',
  'bullet list': '- apples\n- pears\n- plums',
  'nested list': '- parent\n  - child\n  - child two\n- next',
  'ordered list': '1. first\n2. second\n3. third',
  'task list': '- [ ] todo\n- [x] done',
  'empty task item': '- [ ] first\n- [ ] ',
  'blockquote': '> quoted line\n> second line',
  'fenced code with blanks and tags': '```\nconst x = <T>(a) => a\n\n\n// gap above\n```',
  'code keeps backslashes': '```\nprintf("C:' + B + B + 'n")\n```',
  'inline code keeps tags': 'call `render(<App />)` now',
  'bold and italic': 'some **bold** and *italic* text',
  'link': 'see [the docs](https://example.com)',
  'autolink': '<https://example.com>',
  'text colour span': 'a <span style="color: #e5484d">red</span> word',
  'table': '| A | B |\n| --- | --- |\n| 1 | 2 |\n',
  'horizontal rule': 'above\n\n---\n\nbelow',
  'ampersand': 'salt & pepper',
  'gap then list': 'intro\n\n\n- item',
  'gap then heading': 'intro\n\n\n# Heading'
}
for (const [label, src] of Object.entries(IDENTITY)) check(`identity: ${label}`, load(src), src)

// ── 1b. Known normalisations: the file changes once, then stays put ─────────
const NORMALIZE = {
  // Markdown entities in SOURCE mean the character; they're written back decoded.
  'entities are decoded': ['AT&amp;T and &copy;', 'AT&T and ©'],
  // tiptap-markdown ends a table with a newline.
  'table at end gains a final newline': ['| A |\n| --- |\n| 1 |', '| A |\n| --- |\n| 1 |\n'],
  // Alternative list / emphasis markers are written in their canonical form.
  'star bullets become dashes': ['* one\n* two', '- one\n- two'],
  'underscore bold becomes stars': ['__bold__', '**bold**']
}
for (const [label, [src, expected]] of Object.entries(NORMALIZE)) {
  check(`normalize: ${label}`, load(src), expected)
  check(`normalize is stable: ${label}`, load(expected), expected)
}

// ── 2. The same content must also be shown correctly in the editor ─────────────
const shown = (src) => {
  editor.commands.setContent(src)
  return editor.state.doc.textBetween(0, editor.state.doc.content.size, '\n', '\n')
}
check('shown: <something here> is visible text', shown('use <something here> now'), 'use <something here> now')
check('shown: <tag> on its own line is visible', shown('<something here>'), '<something here>')
check('shown: comment is visible text', shown('<!-- note -->'), '<!-- note -->')
check('shown: soft line breaks are real breaks', shown('one\ntwo'), 'one\ntwo')
check('shown: windows path has single backslashes', shown(`C:${B}Users`), `C:${B}Users`)

// ── 3. editor -> md -> editor must be identity (what the user typed) ───────────
const P = (text) => (text === undefined ? { type: 'paragraph' } : { type: 'paragraph', content: [{ type: 'text', text }] })
const docOf = (...blocks) => ({ type: 'doc', content: blocks })
const roundTripDoc = (doc) => {
  editor.commands.setContent(doc)
  const before = JSON.stringify(editor.getJSON())
  const saved = md()
  editor.commands.setContent(saved)
  return { before, after: JSON.stringify(editor.getJSON()), saved }
}
const DOCS = {
  'Enter pressed twice between lines': docOf(P('a'), P(), P(), P('b')),
  'empty line at the start': docOf(P(), P('b')),
  'empty lines at the end': docOf(P('a'), P(), P()),
  'only empty lines': docOf(P(), P(), P()),
  'typed angle brackets': docOf(P('<something here>'), P('x < y > z')),
  'typed html-looking text': docOf(P('write <span> or <br> literally')),
  'typed ampersand entity': docOf(P('type &amp; to get &')),
  'typed backslashes': docOf(P(`C:${B}Users${B}CPU`), P(`trailing${B}`)),
  'typed escape-looking sequences': docOf(P(`${B}n${B}t and ${B}*stars${B}*`), P(`mixed ${B}${B} and ${B}#`)),
  'typed UNC path': docOf(P(`${B}${B}server${B}share`)),
  'typed markdown characters': docOf(P('a *not bold* and [not a link] and # not heading')),
  'shift+enter line breaks': {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'one' }, { type: 'hardBreak' }, { type: 'text', text: 'two' }] }]
  },
  'line break before a dash': {
    type: 'doc',
    content: [{ type: 'paragraph', content: [{ type: 'text', text: 'a' }, { type: 'hardBreak' }, { type: 'text', text: '- not a list' }] }]
  }
}
for (const [label, doc] of Object.entries(DOCS)) {
  const { before, after, saved } = roundTripDoc(doc)
  check(`doc identity: ${label}  (saved as ${JSON.stringify(saved)})`, after, before)
}

// ── 4. Saving is stable: a second save never changes the file again ───────────
for (const [label, src] of Object.entries(IDENTITY)) {
  const once = load(src)
  check(`stable: ${label}`, load(once), once)
}

console.log(failures === 0 ? '--- fidelity: all assertions passed ---' : `--- fidelity: ${failures} FAILED ---`)
process.exit(failures === 0 ? 0 : 1)

/**
 * Task-list smoke test: one-press Backspace on an empty task item (no leftover
 * nested paragraph), and markdown round-trip of bare `- [ ]` lines as REAL
 * task items (via the emptyTaskListPlugin).
 *
 * Bundles src/extensions/TaskBackspace.ts + src/extensions/EmptyTaskList.ts
 * with esbuild and drives the real tiptap TaskList/TaskItem through jsdom.
 *
 * Run: npm run test:task
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

const { Editor } = await import('@tiptap/react')
const { default: StarterKit } = await import('@tiptap/starter-kit')
const { default: TaskList } = await import('@tiptap/extension-task-list')
const { default: TaskItem } = await import('@tiptap/extension-task-item')
const { Markdown } = await import('tiptap-markdown')
const { TaskBackspace } = await import('./.tmp-task.mjs')
const { emptyTaskListPlugin } = await import('./.tmp-tasklist.mjs')

const editor = new Editor({
  element: document.getElementById('root'),
  extensions: [
    // TaskBackspace first — same order as the app (before StarterKit).
    TaskBackspace,
    StarterKit.configure({ heading: { levels: [1, 2, 3] } }),
    TaskList,
    TaskItem.configure({ nested: true }),
    Markdown.configure({ html: true })
  ]
})

// Register the empty-task round-trip rule — same as Editor.tsx does.
editor.storage.markdown.parser.md.use(emptyTaskListPlugin)

let failures = 0
function fail(msg) {
  failures++
  console.error('✗ FAIL:', msg)
}
const md = () => editor.storage.markdown.getMarkdown()

function press(key) {
  const e = new dom.window.KeyboardEvent('keydown', { key, bubbles: true, cancelable: true })
  editor.view.dom.dispatchEvent(e)
}

/** taskItems in the doc: [{node, pos, checked, paras}] */
function tasks() {
  const out = []
  editor.state.doc.descendants((n, pos) => {
    if (n.type.name === 'taskItem') {
      out.push({ node: n, pos, checked: n.attrs.checked, paras: n.childCount })
    }
  })
  return out
}

/** Cursor at the end of the text in the LAST task item. */
function cursorAtEndOfLastItemText() {
  const ts = tasks()
  const last = ts[ts.length - 1]
  const para = last.node.firstChild
  editor.commands.setTextSelection(last.pos + 2 + para.content.size)
}

/** Cursor at the start of the task item with empty text (or the Nth empty one). */
function cursorAtStartOfEmptyItem(nth = 0) {
  let seen = 0
  for (const t of tasks()) {
    if (t.node.textContent.trim() === '') {
      if (seen === nth) {
        editor.commands.setTextSelection(t.pos + 2) // inside its first paragraph
        return true
      }
      seen++
    }
  }
  return false
}

try {
  // ---- 1. USER FLOW: item → Enter → ONE Backspace removes the empty item ----
  editor.commands.setContent('- [ ] First')
  cursorAtEndOfLastItemText()
  press('Enter') // new empty task item
  let ts = tasks()
  assert(ts.length === 2, `Enter creates a second (empty) item (got ${ts.length})`)
  press('Backspace')
  ts = tasks()
  assert(ts.length === 1, `one Backspace removes the empty item (got ${ts.length})`)
  assert(ts[0].paras === 1, `no leftover nested paragraph (got ${ts[0].paras} paras)`)
  assert(md() === '- [ ] First', `markdown is clean (got ${JSON.stringify(md())})`)
  console.log('✓ 1. Backspace removes an empty task item in one press (no leftover)')

  // ---- 2. Sole item → Backspace lifts it to a plain paragraph ---------------
  editor.commands.setContent('- [ ] solo')
  const solo = tasks()[0]
  editor.commands.setTextSelection(solo.pos + 2)
  press('Backspace')
  assert(md() === 'solo', `sole item becomes a plain paragraph (got ${JSON.stringify(md())})`)
  assert(tasks().length === 0, 'no task items remain')
  console.log('✓ 2. Backspace on a sole empty item lifts it out of the list')

  // ---- 3. ROUND-TRIP: bare `- [ ]` in the middle parses as a real task ------
  editor.commands.setContent('- [ ] one\n- [ ] \n- [ ] three')
  ts = tasks()
  assert(ts.length === 3, `three task items in one list (got ${ts.length})`)
  assert(ts[1].node.textContent === '', 'middle item is EMPTY (not "[ ]" text)')
  assert(!md().includes('\\['), `no escaped brackets (got ${JSON.stringify(md())})`)
  console.log('✓ 3. Bare `- [ ]` round-trips as a real (empty) task item')

  // ---- 4. ROUND-TRIP: empty LAST item ---------------------------------------
  editor.commands.setContent('- [ ] one\n- [ ] ')
  ts = tasks()
  assert(ts.length === 2, `empty last item parses as a task (got ${ts.length})`)
  assert(ts[1].node.textContent === '', 'last item is empty')
  console.log('✓ 4. Empty last item round-trips as a task')

  // ---- 5. ROUND-TRIP: empty CHECKED item ------------------------------------
  editor.commands.setContent('- [x]')
  ts = tasks()
  assert(ts.length === 1 && ts[0].checked === true, `- [x] parses checked (got ${ts[0]?.checked})`)
  console.log('✓ 5. Empty checked item (- [x]) parses as checked')

  // ---- 6. Backspace on an empty MIDDLE item joins to the neighbours ---------
  editor.commands.setContent('- [ ] one\n- [ ] \n- [ ] three')
  assert(cursorAtStartOfEmptyItem(), 'empty middle item found')
  press('Backspace')
  ts = tasks()
  assert(ts.length === 2, `middle empty item removed (got ${ts.length})`)
  assert(ts[0].node.textContent === 'one' && ts[1].node.textContent === 'three', 'neighbours kept')
  // Exactly ONE task list remains (no split), with the two items inside.
  const lists6 = []
  editor.state.doc.descendants((n) => {
    if (n.type.name === 'taskList') lists6.push(n)
  })
  assert(lists6.length === 1, `list NOT split into pieces (got ${lists6.length} taskLists)`)
  // Cursor should now be at the end of "one" — typing continues there.
  editor.commands.insertContent('X')
  ts = tasks()
  assert(ts[0].node.textContent === 'oneX' && ts[1].node.textContent === 'three', `cursor landed at end of previous text (got ${ts.map((t) => t.node.textContent).join(' / ')})`)
  console.log('✓ 6. Backspace on an empty middle item joins cleanly (cursor at previous text)')

  // ---- 7. Non-empty item backspace still uses normal PM behavior ------------
  editor.commands.setContent('- [ ] keep\n- [ ] me')
  const second = tasks()[1]
  editor.commands.setTextSelection(second.pos + 2)
  press('Backspace')
  ts = tasks()
  // PM joins the item into the previous one (nested block) — NOT force-removed.
  assert(ts.length === 1, `non-empty item NOT force-removed (got ${ts.length})`)
  const allText = editor.state.doc.textContent
  assert(allText.includes('keep') && allText.includes('me'), 'text preserved')
  console.log('✓ 7. Non-empty items keep normal backspace behavior')

  // ---- 8. Backspace on the FIRST empty item (list keeps others) -------------
  editor.commands.setContent('- [ ] \n- [ ] keep')
  const firstEmpty = tasks()[0]
  assert(firstEmpty.node.textContent === '', 'first item is the empty one')
  editor.commands.setTextSelection(firstEmpty.pos + 2)
  press('Backspace')
  ts = tasks()
  assert(ts.length === 1 && ts[0].node.textContent === 'keep', `first empty item removed (got ${ts.length})`)
  // Cursor lands at the START of the next item's text — typing continues there.
  editor.commands.insertContent('K')
  ts = tasks()
  assert(ts[0].node.textContent === 'Kkeep', `cursor landed at start of next item (got ${JSON.stringify(ts[0]?.node.textContent)})`)
  console.log('✓ 8. Backspace on a first empty item lands the cursor at the next item')
} catch (err) {
  failures++
  console.error('✗ FAIL:', err.message)
  console.error(err.stack?.split('\n').slice(0, 5).join('\n'))
} finally {
  editor.destroy()
}

function assert(cond, msg) {
  if (!cond) fail(msg)
}

if (failures > 0) {
  console.error('--- task: FAILED ---')
  process.exit(1)
}
console.log('--- task: all assertions passed ---')

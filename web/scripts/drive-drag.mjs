/**
 * Real-browser driver for the BlockDrag drop-line + drop behavior.
 * Loads scripts/drag-harness.html (served over HTTP), drives the REAL
 * BlockDrag extension with synthetic drag events, and asserts:
 *   A) a TOGGLE drag's drop line tracks individual list items (no whole-list
 *      snapping) and the drop splits the list at the hovered boundary;
 *   B) a MULTI-SELECTION drag's line tracks items and the drop merges the
 *      selected items into the list (reorder).
 */
import puppeteer from 'puppeteer-core'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8124
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(__dirname, url === '/' ? 'drag-harness.html' : url)
  if (!file.startsWith(__dirname)) { res.writeHead(403); res.end(); return }
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('not found'); return }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  })
})

await new Promise((r) => server.listen(PORT, r))
console.log(`serving harness on ${PORT}`)

const chromePath =
  fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
    ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
    : 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'

const browser = await puppeteer.launch({ headless: 'new', executablePath: chromePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 900, height: 700 })

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) { pass++; console.log(`  ✓ ${name}`) }
  else { fail++; console.log(`  ✗ ${name} — ${detail}`) }
}

page.on('console', (m) => { if (m.type() === 'error' && !m.text().includes('favicon')) console.log('  [console.error]', m.text()) })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

await page.goto(`http://localhost:${PORT}/drag-harness.html`, { waitUntil: 'networkidle0' })
// Wait for the editor + React mount (bundle is big).
await page.waitForFunction(() => window.__ed && document.querySelector('.md-editor'), { timeout: 20000 })
await new Promise((r) => setTimeout(r, 500))

// ---- helpers (run in page) ------------------------------------------------
const evalPage = (fn, ...args) => page.evaluate(fn, ...args)

const docDump = () => evalPage(() => window.__dump())

// Returns rects of every listItem paragraph (text) in order.
const itemRects = () =>
  evalPage(() => {
    const out = []
    document.querySelectorAll('.md-editor li p').forEach((p) => {
      const t = p.textContent.trim()
      if (t) out.push({ text: t, ...p.getBoundingClientRect().toJSON() })
    })
    return out
  })

const blockRect = (text) =>
  evalPage((t) => {
    // Toggle content renders as <div class="toggle"> (React node view), so
    // match ANY paragraph by exact text.
    const all = [...document.querySelectorAll('.md-editor p')]
    const el = all.find((p) => p.textContent.trim() === t)
    return el ? el.getBoundingClientRect().toJSON() : null
  }, text)

// Move the mouse over a block so the grip appears (dragInfo set).
const hover = (x, y) => evalPage((cx, cy) => {
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: cx, clientY: cy, bubbles: true }))
}, x, y)

const dragStart = () => evalPage(() => {
  const grip = document.querySelector('.block-grip')
  if (!grip) return false
  const dt = new DataTransfer()
  grip.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }))
  return true
})

const dragOver = (x, y) => evalPage((cx, cy) => {
  const dt = new DataTransfer()
  // Re-set the MIME type so the plugin's dragover guard passes.
  dt.setData('application/x-moondash-block', '1')
  document.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: cx, clientY: cy, bubbles: true, cancelable: true }))
}, x, y)

const drop = (x, y) => evalPage((cx, cy) => {
  const dt = new DataTransfer()
  dt.setData('application/x-moondash-block', '1')
  document.dispatchEvent(new DragEvent('drop', { dataTransfer: dt, clientX: cx, clientY: cy, bubbles: true, cancelable: true }))
}, x, y)

const lineTop = () => evalPage(() => {
  const el = document.querySelector('.block-drop-line')
  return el && el.classList.contains('is-visible') ? parseFloat(el.style.top) : null
})

const setSelection = (fromText, toText) => evalPage((a, b) => {
  const ed = window.__ed
  // Find block positions by walking the doc.
  let from = -1, to = -1
  ed.state.doc.descendants((node, pos) => {
    if (node.isTextblock && node.textContent === a && from < 0) from = pos + 1
    if (node.isTextblock && node.textContent === b && to < 0) to = pos + 1 + node.content.size
  })
  if (from < 0 || to < 0) return false
  ed.chain().focus().setTextSelection({ from, to }).run()
  return true
}, fromText, toText)

// ===========================================================================
console.log('\n=== A) TOGGLE drag over a list: line tracks items, drop splits ===')
await evalPage(() => window.__setDoc('- A\n- B\n- C\n\n<details class="toggle"><p>T</p></details>'))
await new Promise((r) => setTimeout(r, 200))

let tRect = await blockRect('T')
let bRect = await blockRect('B')
let cRect = await blockRect('C')

// A1: hover the toggle, dragstart, dragover upper half of B → line at B top.
await hover(tRect.left + 30, tRect.top + 8)
await new Promise((r) => setTimeout(r, 120))
const started = await dragStart()
check('A0 dragstart fired', started === true, 'grip not found')
await new Promise((r) => setTimeout(r, 80))
await dragOver(bRect.left + 30, bRect.top + 3)
await new Promise((r) => setTimeout(r, 80))
let line = await lineTop()
check('A1 line over B-upper ≈ B top', line != null && Math.abs(line - bRect.top) < 4, `line=${line} B.top=${bRect.top}`)

// A2: dragover lower half of B → line at B bottom (between B and C).
await dragOver(bRect.left + 30, bRect.bottom - 3)
await new Promise((r) => setTimeout(r, 80))
line = await lineTop()
check('A2 line over B-lower ≈ B bottom', line != null && Math.abs(line - bRect.bottom) < 4, `line=${line} B.bottom=${bRect.bottom}`)

// A3: dragover upper half of C → line at C top (between B and C — NOT list bottom).
await dragOver(cRect.left + 30, cRect.top + 3)
await new Promise((r) => setTimeout(r, 80))
line = await lineTop()
check('A3 line over C-upper ≈ C top (tracks items)', line != null && Math.abs(line - cRect.top) < 4, `line=${line} C.top=${cRect.top}`)

// A4: drop on B-upper → toggle lands between A and B (list splits).
await dragOver(bRect.left + 30, bRect.top + 3)
await new Promise((r) => setTimeout(r, 80))
await drop(bRect.left + 30, bRect.top + 3)
await new Promise((r) => setTimeout(r, 150))
let md = await docDump()
check('A4 drop split list around toggle', /^- A\n\n<details class="toggle">[\s\S]*T[\s\S]*<\/details>\n\n- B\n- C/.test(md), md.replace(/\n/g, '⏎'))

// ===========================================================================
console.log('\n=== B) MULTI-SELECTION drag over a list: line tracks items, drop merges ===')
await evalPage(() => window.__setDoc('- A\n- B\n- C\n- D'))
await new Promise((r) => setTimeout(r, 200))

const okSel = await setSelection('A', 'B')
check('B0 selection set', okSel === true, 'blocks A/B not found')

let aRect = await blockRect('A')
let dRect = await blockRect('D')

// Hover item A's grip, dragstart (should capture the A..B range).
await hover(aRect.left + 30, aRect.top + 8)
await new Promise((r) => setTimeout(r, 120))
await dragStart()
await new Promise((r) => setTimeout(r, 80))

// B1: line over upper half of C → C top.
let c2Rect = await blockRect('C')
await dragOver(c2Rect.left + 30, c2Rect.top + 3)
await new Promise((r) => setTimeout(r, 80))
line = await lineTop()
check('B1 multi line over C-upper ≈ C top', line != null && Math.abs(line - c2Rect.top) < 4, `line=${line} C.top=${c2Rect.top}`)

// B2: line over lower half of D → D bottom.
await dragOver(dRect.left + 30, dRect.bottom - 3)
await new Promise((r) => setTimeout(r, 80))
line = await lineTop()
check('B2 multi line over D-lower ≈ D bottom', line != null && Math.abs(line - dRect.bottom) < 4, `line=${line} D.bottom=${dRect.bottom}`)

// B3: drop after D → selected items A,B merge after C,D.
await drop(dRect.left + 30, dRect.bottom - 3)
await new Promise((r) => setTimeout(r, 150))
md = await docDump()
check('B3 multi drop merges after D', md.trim() === '- C\n- D\n- A\n- B', md.replace(/\n/g, '⏎'))

// ===========================================================================
// Two genuinely separate lists (bullet + ordered stay apart under markdown-it),
// multi-selection dragged from one list BETWEEN the items of the other → the
// target list SPLITS so the selection lands exactly where the line showed.
console.log('\n=== C) MULTI-SELECTION into a SECOND list (split between items) ===')
await evalPage(() => window.__setDoc('- A\n- B\n\n1. C\n1. D'))
await new Promise((r) => setTimeout(r, 200))
await setSelection('A', 'B')
await hover((await blockRect('A')).left + 30, (await blockRect('A')).top + 8)
await new Promise((r) => setTimeout(r, 120))
await dragStart()
await new Promise((r) => setTimeout(r, 80))
let c3Rect = await blockRect('C')
await dragOver(c3Rect.left + 30, c3Rect.bottom - 3)
await new Promise((r) => setTimeout(r, 80))
await drop(c3Rect.left + 30, c3Rect.bottom - 3)
await new Promise((r) => setTimeout(r, 150))
md = await docDump()
check('C multi splits target list between items', md.trim() === '1. C\n\n- A\n- B\n\n1. D', md.replace(/\n/g, '⏎'))

// ===========================================================================
console.log('\n=== D) TOGGLE before the FIRST item lands before the list ===')
await evalPage(() => window.__setDoc('- A\n- B\n\n<details class="toggle"><p>T</p></details>'))
await new Promise((r) => setTimeout(r, 200))
tRect = await blockRect('T')
aRect = await blockRect('A')
await hover(tRect.left + 30, tRect.top + 8)
await new Promise((r) => setTimeout(r, 120))
await dragStart()
await new Promise((r) => setTimeout(r, 80))
await dragOver(aRect.left + 30, aRect.top + 3)
await new Promise((r) => setTimeout(r, 80))
await drop(aRect.left + 30, aRect.top + 3)
await new Promise((r) => setTimeout(r, 150))
md = await docDump()
check('D toggle before first item', /^<details class="toggle">[\s\S]*T[\s\S]*<\/details>\n\n- A\n- B/.test(md), md.replace(/\n/g, '⏎'))

await browser.close()
server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)

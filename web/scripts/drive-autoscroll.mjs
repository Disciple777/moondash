/**
 * Real-browser driver for BlockDrag AUTO-SCROLL: while dragging, holding the
 * pointer near the viewport's top/bottom edge scrolls the editor's scroll
 * container up/down. Loads scripts/drag-harness.html (which now wraps the
 * editor in a 340px scrollable #hscroll container, like the app's .main),
 * drives the REAL BlockDrag extension with synthetic drag events, and asserts:
 *   A) dragover near the BOTTOM edge scrolls the container DOWN;
 *   B) dragover near the TOP edge scrolls it back UP;
 *   C) dragend stops the scrolling.
 */
import puppeteer from 'puppeteer-core'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8125
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
await page.waitForFunction(() => window.__ed && document.querySelector('.md-editor'), { timeout: 20000 })
await new Promise((r) => setTimeout(r, 500))

const evalPage = (fn, ...args) => page.evaluate(fn, ...args)

const scrollTop = () => evalPage(() => document.getElementById('hscroll').scrollTop)
const scrollInfo = () => evalPage(() => {
  const el = document.getElementById('hscroll')
  return { top: el.scrollTop, sh: el.scrollHeight, ch: el.clientHeight }
})

// Load a long doc so the container overflows (retry until it actually renders).
const longDoc = Array.from({ length: 40 }, (_, i) => `Line ${i + 1}`).join('\n\n')
let info = null
for (let i = 0; i < 5; i++) {
  await evalPage((md) => window.__setDoc(md), longDoc)
  await new Promise((r) => setTimeout(r, 300))
  info = await scrollInfo()
  const nParas = await evalPage(() => document.querySelectorAll('.md-editor p').length)
  if (info.sh > info.ch && nParas > 20) break
  console.log(`  retry ${i + 1}: sh=${info.sh} ch=${info.ch} nParas=${nParas}`)
}
check('container overflows (scrollHeight > clientHeight)', info.sh > info.ch, JSON.stringify(info))
check('long doc rendered (>= 20 paragraphs)', (await evalPage(() => document.querySelectorAll('.md-editor p').length)) > 20, 'few paragraphs')

// Hover a visible block (Line 3) so the grip appears, then dragstart.
const hoverLine = (n) => evalPage((ln) => {
  const ps = [...document.querySelectorAll('.md-editor p')]
  const el = ps.find((p) => p.textContent.trim() === ln)
  if (!el) return false
  const r = el.getBoundingClientRect()
  document.dispatchEvent(new MouseEvent('mousemove', { clientX: r.left + 30, clientY: r.top + 8, bubbles: true }))
  return true
}, n)

await hoverLine('Line 3')
await new Promise((r) => setTimeout(r, 150))

const dragStart = () => evalPage(() => {
  const grip = document.querySelector('.block-grip')
  if (!grip) return false
  const dt = new DataTransfer()
  grip.dispatchEvent(new DragEvent('dragstart', { dataTransfer: dt, bubbles: true, cancelable: true }))
  return true
})

const dragOver = (x, y) => evalPage((cx, cy) => {
  const dt = new DataTransfer()
  dt.setData('application/x-moondash-block', '1')
  document.dispatchEvent(new DragEvent('dragover', { dataTransfer: dt, clientX: cx, clientY: cy, bubbles: true, cancelable: true }))
}, x, y)

const dragEnd = () => evalPage(() => {
  const grip = document.querySelector('.block-grip')
  if (!grip) return false
  grip.dispatchEvent(new DragEvent('dragend', { bubbles: true, cancelable: true }))
  return true
})

console.log('\n=== A) pointer at the BOTTOM edge scrolls DOWN ===')
const started = await dragStart()
check('A0 dragstart fired', started === true, 'grip not found')
await new Promise((r) => setTimeout(r, 80))

const t0 = await scrollTop()
// Bottom edge of the 700px viewport (well below the 340px container) → the
// dragover handler still records the pointer Y and the rAF loop scrolls down.
await dragOver(450, 692)
await new Promise((r) => setTimeout(r, 650))
const t1 = await scrollTop()
check('A1 scrollTop increased while near bottom edge', t1 > t0 + 80, `t0=${t0} t1=${t1}`)

console.log('\n=== B) pointer at the TOP edge scrolls UP ===')
await dragOver(450, 8)
await new Promise((r) => setTimeout(r, 650))
const t2 = await scrollTop()
check('B1 scrollTop decreased while near top edge', t2 < t1 - 80, `t1=${t1} t2=${t2}`)

console.log('\n=== C) dragend stops the scrolling ===')
await dragEnd()
await new Promise((r) => setTimeout(r, 250))
const s1 = await scrollTop()
await new Promise((r) => setTimeout(r, 300))
const s2 = await scrollTop()
check('C1 scrollTop stable after dragend', Math.abs(s2 - s1) < 2, `s1=${s1} s2=${s2}`)

await browser.close()
server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)

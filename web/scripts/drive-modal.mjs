/**
 * Real-browser driver for the workspace dialog fixes. Measures, on the REAL
 * WorkspaceDialog under a dark theme:
 *   - modal height vs viewport, and whether the backdrop can scroll
 *   - the computed color of the icon-grid lucide icons (stroke)
 *   - whether the Create button is reachable (scroll the modal, then check)
 */
import puppeteer from 'puppeteer-core'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8130
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(__dirname, url === '/' ? 'modal-harness.html' : url)
  if (!file.startsWith(__dirname)) {
    res.writeHead(403)
    res.end()
    return
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404)
      res.end('not found')
      return
    }
    res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' })
    res.end(data)
  })
})

await new Promise((r) => server.listen(PORT, r))
console.log(`serving modal harness on ${PORT}`)

const chromePath = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'

// Small viewport to reproduce the user's overflow complaint.
const browser = await puppeteer.launch({ headless: 'new', executablePath: chromePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
await page.setViewport({ width: 420, height: 560 })
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

await page.goto(`http://localhost:${PORT}/modal-harness.html`, { waitUntil: 'networkidle0' })
await page.waitForFunction(() => document.querySelector('.modal'), { timeout: 20000 })
await new Promise((r) => setTimeout(r, 300))

const m = await page.evaluate(() => {
  const modal = document.querySelector('.modal')
  const backdrop = document.querySelector('.modal-backdrop')
  const actions = document.querySelector('.modal-actions')
  const btn = actions ? actions.querySelector('.btn.primary') : null
  const modalRect = modal.getBoundingClientRect()
  const btnRect = btn ? btn.getBoundingClientRect() : null
  return {
    vh: window.innerHeight,
    modalTop: modalRect.top,
    modalBottom: modalRect.bottom,
    modalHeight: modalRect.height,
    modalClientHeight: modal.clientHeight,
    modalScrollHeight: modal.scrollHeight,
    backdropScrollHeight: backdrop ? backdrop.scrollHeight : 0,
    backdropClientHeight: backdrop ? backdrop.clientHeight : 0,
    backdropOverflowY: backdrop ? getComputedStyle(backdrop).overflowY : null,
    btnBottom: btnRect ? btnRect.bottom : null,
    btnText: btn ? btn.textContent.trim() : null,
    iconStroke: (() => {
      const svg = modal.querySelector('.icon-choice svg')
      return svg ? getComputedStyle(svg).stroke : null
    })(),
    iconColor: (() => {
      const svg = modal.querySelector('.icon-choice svg')
      return svg ? getComputedStyle(svg).color : null
    })(),
    iconButtonColor: (() => {
      const b = modal.querySelector('.icon-choice')
      return b ? getComputedStyle(b).color : null
    })(),
    bodyColor: getComputedStyle(document.body).color,
    theme: document.documentElement.getAttribute('data-theme')
  }
})

console.log('=== measurements ===')
console.log(JSON.stringify(m, null, 2))

let pass = 0
let fail = 0
const check = (name, ok, detail) => {
  if (ok) {
    pass++
    console.log(`  ✓ ${name}`)
  } else {
    fail++
    console.log(`  ✗ ${name} — ${detail}`)
  }
}

// Overflow: either the modal itself scrolls internally, or the backdrop
// scrolls, and the Create button must be reachable (checked below).
const modalScrollable = m.modalScrollHeight > m.modalClientHeight
const backdropScrollable = m.backdropScrollHeight > m.backdropClientHeight && m.backdropOverflowY === 'auto'
check(
  'modal (or backdrop) is scrollable',
  modalScrollable || backdropScrollable,
  `modal ${m.modalScrollHeight}>${m.modalClientHeight} backdrop ${m.backdropScrollHeight}>${m.backdropClientHeight} overflow=${m.backdropOverflowY}`
)

// Reach the Create button: scroll the scrolling container to its bottom.
await page.evaluate(() => {
  const backdrop = document.querySelector('.modal-backdrop')
  const modal = document.querySelector('.modal')
  if (backdrop && getComputedStyle(backdrop).overflowY === 'auto') backdrop.scrollTop = backdrop.scrollHeight
  if (modal && modal.scrollHeight > modal.clientHeight) modal.scrollTop = modal.scrollHeight
})
await new Promise((r) => setTimeout(r, 150))
const after = await page.evaluate(() => {
  const modal = document.querySelector('.modal')
  const btn = document.querySelector('.modal-actions .btn.primary')
  const r = btn.getBoundingClientRect()
  return { top: r.top, bottom: r.bottom, vh: window.innerHeight, modalBottom: modal.getBoundingClientRect().bottom }
})
check(
  'Create button reachable after scrolling',
  after.top >= 0 && after.bottom <= after.vh,
  `btn top=${after.top.toFixed(0)} bottom=${after.bottom.toFixed(0)} vh=${after.vh}`
)

// Icon color: must be a light/visible color on a dark theme (not black).
const rgb = (m.iconStroke || m.iconColor || '').match(/\d+/g)
const luminance = rgb ? (0.2126 * +rgb[0] + 0.7152 * +rgb[1] + 0.0722 * +rgb[2]) / 255 : 0
check('icon stroke resolves to a visible (light) color on dark theme', luminance > 0.5, `stroke=${m.iconStroke} color=${m.iconColor} luminance=${luminance.toFixed(2)}`)

await page.screenshot({ path: path.join(__dirname, 'modal-harness.png') })
await browser.close()
server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)

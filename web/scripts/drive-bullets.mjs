/**
 * Real-browser driver for the list-marker (bullet) fix.
 * Serves scripts/bullets-harness.html, waits for the real editor + real
 * styles.css, then asserts the computed list-style-type of bullet lists,
 * ordered lists and task lists — plus the marker color — and saves a
 * screenshot to scripts/bullets-harness.png.
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
  let file = path.join(__dirname, url === '/' ? 'bullets-harness.html' : url)
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
console.log(`serving bullets harness on ${PORT}`)

const chromePath = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: chromePath,
  args: ['--no-sandbox']
})
const page = await browser.newPage()
await page.setViewport({ width: 720, height: 640 })

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

page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

await page.goto(`http://localhost:${PORT}/bullets-harness.html`, { waitUntil: 'networkidle0' })
await page.waitForFunction(() => window.__ed && document.querySelector('.md-editor ul'), {
  timeout: 20000
})
await new Promise((r) => setTimeout(r, 400))

const styles = await page.evaluate(() => {
  const ed = document.querySelector('.md-editor')
  const ul = ed.querySelector('ul')
  const ol = ed.querySelector('ol')
  const task = ed.querySelector('ul[data-type="taskList"]')
  const li = ed.querySelector('ul li')
  const read = (el, prop) => (el ? getComputedStyle(el)[prop] : null)
  return {
    ulType: read(ul, 'listStyleType'),
    ulPos: read(ul, 'listStylePosition'),
    olType: read(ol, 'listStyleType'),
    taskType: read(task, 'listStyleType'),
    liDisplay: read(li, 'display'),
    markerColor: li ? getComputedStyle(li, '::marker').color : null
  }
})

console.log('  computed styles:', JSON.stringify(styles))
check('bullet ul has list-style-type disc', styles.ulType === 'disc', `got ${styles.ulType}`)
check('ordered ol has list-style-type decimal', styles.olType === 'decimal', `got ${styles.olType}`)
check('task list keeps list-style none', styles.taskType === 'none', `got ${styles.taskType}`)
check('bullet li is block (not flex, so marker renders)', styles.liDisplay === 'block' || styles.liDisplay === 'list-item', `got ${styles.liDisplay}`)
check('marker has a color', !!styles.markerColor, `got ${styles.markerColor}`)

// The marker glyph only paints when list-style-type is not none, so the
// computed check above is the real signal. Capture proof for the user.
await page.screenshot({ path: path.join(__dirname, 'bullets-harness.png') })

await browser.close()
server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)

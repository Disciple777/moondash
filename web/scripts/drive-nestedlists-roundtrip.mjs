/**
 * Round-trip check: the harness doc -> markdown (getMarkdown) -> re-parse
 * (setContent) -> DOM. Verifies nested list structure survives the exact
 * markdown round-trip the app performs on every save/load.
 */
import puppeteer from 'puppeteer-core'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8127
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(__dirname, url === '/' ? 'nestedlists-harness.html' : url)
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
console.log(`serving round-trip harness on ${PORT}`)

const chromePath = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'

const browser = await puppeteer.launch({ headless: 'new', executablePath: chromePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

await page.goto(`http://localhost:${PORT}/nestedlists-harness.html`, { waitUntil: 'networkidle0' })
await page.waitForFunction(() => window.__ed && document.querySelector('.md-editor ul, .md-editor ol'), { timeout: 20000 })
await new Promise((r) => setTimeout(r, 400))

const before = await page.evaluate(() => window.__dump())
console.log('=== markdown after initial parse ===')
console.log(before)

await page.evaluate(() => {
  const md = window.__dump()
  window.__ed.commands.setContent(md)
})
await new Promise((r) => setTimeout(r, 300))

const after = await page.evaluate(() => {
  const ed = document.querySelector('.md-editor')
  const out = []
  const walk = (node, listDepth) => {
    for (const el of node.children || []) {
      const tag = el.tagName.toLowerCase()
      if (tag === 'ul' || tag === 'ol') {
        out.push({
          tag,
          depth: listDepth,
          type: el.getAttribute('data-type') || '',
          listStyleType: getComputedStyle(el).listStyleType,
          nItems: el.querySelectorAll(':scope > li').length,
          text: (el.querySelector(':scope > li')?.textContent || '').trim().slice(0, 25)
        })
        walk(el, listDepth + 1)
      } else walk(el, listDepth)
    }
  }
  walk(ed, 0)
  return out
})

console.log('=== lists after round-trip ===')
for (const l of after) {
  console.log(`  depth ${l.depth} <${l.tag}> type="${l.type}" list-style=${l.listStyleType} items=${l.nItems} first="${l.text}"`)
}

const nested = after.filter((l) => l.depth >= 1)
const markerOk = nested.filter((l) => l.listStyleType !== 'none')
console.log(`\nnested lists: ${nested.length}, with markers: ${markerOk.length}`)

await browser.close()
server.close()
process.exit(nested.length >= 5 && markerOk.length >= 5 ? 0 : 1)

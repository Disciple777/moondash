/**
 * Keyboard-path verification: focus the editor, TYPE a bullet list, press
 * Enter, Tab (sink) and type nested content — exactly how a user creates
 * indented bullets — then confirm the nested list renders with a visible
 * marker and survives the markdown round-trip.
 */
import puppeteer from 'puppeteer-core'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8129
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }

const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  let file = path.join(__dirname, url === '/' ? 'fulleditor-harness.html' : url)
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
console.log(`serving keyboard harness on ${PORT}`)

const chromePath = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'

const browser = await puppeteer.launch({ headless: 'new', executablePath: chromePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

await page.goto(`http://localhost:${PORT}/fulleditor-harness.html`, { waitUntil: 'networkidle0' })
await page.waitForFunction(() => window.__ed, { timeout: 20000 })
await new Promise((r) => setTimeout(r, 400))

// Start from a clean slate.
await page.evaluate(() => window.__ed.commands.setContent(''))
// Focus the editor.
await page.click('.md-editor')
await page.keyboard.type('- Level one')
await page.keyboard.press('Enter')
await page.keyboard.type('Level two')
await page.keyboard.press('Enter')
// Sink the empty item one level (Tab = indented bullet).
await page.keyboard.press('Tab')
await page.keyboard.type('Nested bullet A')
await page.keyboard.press('Enter')
await page.keyboard.type('Nested bullet B')
// Lift back out (Shift-Tab) and add a sibling at the top level.
await page.keyboard.down('Shift')
await page.keyboard.press('Tab')
await page.keyboard.up('Shift')
await page.keyboard.type('Level three')

await new Promise((r) => setTimeout(r, 400))

const md = await page.evaluate(() => window.__dump())
console.log('=== markdown typed by keyboard ===')
console.log(md)

const dom = await page.evaluate(() => {
  const ed = document.querySelector('.md-editor')
  const out = []
  const walk = (node, depth) => {
    for (const el of node.children || []) {
      const tag = el.tagName.toLowerCase()
      if (tag === 'ul' || tag === 'ol') {
        out.push({
          depth,
          tag,
          listStyleType: getComputedStyle(el).listStyleType,
          marker: (() => {
            const li = el.querySelector(':scope > li')
            return li ? getComputedStyle(li, '::marker').content : null
          })(),
          text: (el.querySelector(':scope > li')?.textContent || '').trim().slice(0, 20)
        })
        walk(el, depth + 1)
      } else walk(el, depth)
    }
  }
  walk(ed, 0)
  return out
})

console.log('=== DOM after keyboard typing ===')
for (const l of dom) {
  console.log(`  depth ${l.depth} <${l.tag}> list-style=${l.listStyleType} marker="${l.marker}" first="${l.text}"`)
}

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

const nested = dom.filter((l) => l.depth >= 1)
check('Tab created a real nested list', nested.length >= 1, `nested lists: ${nested.length}`)
check('nested list has a visible marker (disc)', nested.every((l) => l.listStyleType === 'disc'), JSON.stringify(nested.map((l) => l.listStyleType)))
check('markdown serializes the nesting', /Level two\n\s{2}- Nested bullet/.test(md), md)
check('3 top-level + nested items present', /Level one/.test(md) && /Nested bullet B/.test(md) && /Level three/.test(md), md)

// Round-trip: re-parse the typed markdown and confirm nesting persists.
await page.evaluate(() => window.__ed.commands.setContent(window.__dump()))
await new Promise((r) => setTimeout(r, 300))
const after = await page.evaluate(() => {
  const ed = document.querySelector('.md-editor')
  const nestedLists = []
  const walk = (node, depth) => {
    for (const el of node.children || []) {
      const tag = el.tagName.toLowerCase()
      if (tag === 'ul' || tag === 'ol') {
        if (depth >= 1) {
          nestedLists.push({
            listStyleType: getComputedStyle(el).listStyleType,
            text: (el.querySelector(':scope > li')?.textContent || '').trim().slice(0, 20)
          })
        }
        walk(el, depth + 1)
      } else walk(el, depth)
    }
  }
  walk(ed, 0)
  return nestedLists
})
check(
  'round-trip keeps nested list with marker',
  after.length >= 1 && after.every((l) => l.listStyleType === 'disc'),
  JSON.stringify(after)
)

await page.screenshot({ path: path.join(__dirname, 'keyboard-nested.png') })
await browser.close()
server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)

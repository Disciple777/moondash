/**
 * Real-browser driver for the full-editor harness. Confirms every nested list
 * type keeps a visible marker style with the app's real extension lineup,
 * and that the markdown round-trip preserves nesting.
 */
import puppeteer from 'puppeteer-core'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8128
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
console.log(`serving full-editor harness on ${PORT}`)

const chromePath = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'

const browser = await puppeteer.launch({ headless: 'new', executablePath: chromePath, args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('  [pageerror]', e.message))

await page.goto(`http://localhost:${PORT}/fulleditor-harness.html`, { waitUntil: 'networkidle0' })
await page.waitForFunction(() => window.__ed && document.querySelector('.md-editor ul, .md-editor ol'), { timeout: 20000 })
await new Promise((r) => setTimeout(r, 500))

const dump = () =>
  page.evaluate(() => {
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
            text: (el.querySelector(':scope > li')?.textContent || '').trim().slice(0, 22)
          })
          walk(el, listDepth + 1)
        } else walk(el, listDepth)
      }
    }
    walk(ed, 0)
    return out
  })

const before = await dump()
console.log('=== lists (full extension set) ===')
for (const l of before) {
  console.log(`  depth ${l.depth} <${l.tag}> type="${l.type}" list-style=${l.listStyleType} items=${l.nItems} first="${l.text}"`)
}

// Round-trip: serialize -> re-parse -> dump again
await page.evaluate(() => window.__ed.commands.setContent(window.__dump()))
await new Promise((r) => setTimeout(r, 300))
const after = await dump()

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

for (const [label, lists] of [['initial', before], ['round-trip', after]]) {
  const nonTask = lists.filter((l) => l.type !== 'taskList')
  const nestedNonTask = nonTask.filter((l) => l.depth >= 1)
  const nestedOk = nestedNonTask.filter((l) => l.listStyleType !== 'none')
  check(
    `${label}: every nested non-task list has a marker`,
    nestedOk.length === nestedNonTask.length,
    `${nestedOk.length}/${nestedNonTask.length} nested non-task lists have markers`
  )
  const nestedTask = lists.filter((l) => l.type === 'taskList' && l.depth >= 1)
  check(
    `${label}: nested task lists keep list-style none`,
    nestedTask.every((l) => l.listStyleType === 'none'),
    JSON.stringify(nestedTask.map((l) => l.listStyleType))
  )
  const counts = lists.filter((l) => l.depth >= 1).length
  check(`${label}: nesting survives (${counts} nested lists)`, counts >= 6, `got ${counts}`)
}

await page.screenshot({ path: path.join(__dirname, 'fulleditor-harness.png') })
await browser.close()
server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)

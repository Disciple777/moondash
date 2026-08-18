/**
 * Real-browser driver for the nested/indented list rendering check.
 * Serves scripts/nestedlists-harness.html, waits for the real editor + real
 * styles.css, walks every list element in the DOM and reports its depth,
 * computed list-style-type and ::marker state, then saves a screenshot.
 */
import puppeteer from 'puppeteer-core'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8126
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
console.log(`serving nested-lists harness on ${PORT}`)

const chromePath = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'

const browser = await puppeteer.launch({
  headless: 'new',
  executablePath: chromePath,
  args: ['--no-sandbox']
})
const page = await browser.newPage()
await page.setViewport({ width: 760, height: 1100 })

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

await page.goto(`http://localhost:${PORT}/nestedlists-harness.html`, { waitUntil: 'networkidle0' })
await page.waitForFunction(() => window.__ed && document.querySelector('.md-editor ul, .md-editor ol'), {
  timeout: 20000
})
await new Promise((r) => setTimeout(r, 500))

const lists = await page.evaluate(() => {
  const ed = document.querySelector('.md-editor')
  const out = []
  // Walk the whole tree; track list nesting depth by counting ancestor lists.
  const walk = (node, listDepth) => {
    for (const el of node.children || []) {
      const tag = el.tagName.toLowerCase()
      if (tag === 'ul' || tag === 'ol') {
        const items = el.querySelectorAll(':scope > li')
        const firstLi = items[0]
        const liStyle = firstLi ? getComputedStyle(firstLi) : null
        out.push({
          tag,
          depth: listDepth,
          type: el.getAttribute('data-type') || '',
          listStyleType: getComputedStyle(el).listStyleType,
          markerContent: firstLi
            ? getComputedStyle(firstLi, '::marker').content
            : null,
          markerColor: firstLi ? getComputedStyle(firstLi, '::marker').color : null,
          liDisplay: liStyle ? liStyle.display : null,
          nItems: items.length,
          text: (firstLi ? firstLi.textContent : '').trim().slice(0, 30)
        })
        walk(el, listDepth + 1)
      } else {
        walk(el, listDepth)
      }
    }
  }
  walk(ed, 0)
  return out
})

console.log('=== list elements found ===')
for (const l of lists) {
  console.log(
    `  depth ${l.depth} <${l.tag}> type="${l.type}" list-style=${l.listStyleType} marker="${l.markerContent}" markerColor=${l.markerColor} liDisplay=${l.liDisplay} items=${l.nItems} first="${l.text}"`
  )
}

// Every nested (depth>=1) bullet/ordered list must keep a visible marker style.
const nestedWithMarker = lists.filter((l) => l.depth >= 1 && l.listStyleType !== 'none' && l.markerContent !== 'none')
check(
  'every nested list keeps a visible marker style',
  nestedWithMarker.length === lists.filter((l) => l.depth >= 1).length,
  `${nestedWithMarker.length}/${lists.filter((l) => l.depth >= 1).length} nested lists have markers`
)
check('nested bullet list has disc', lists.some((l) => l.depth === 1 && l.tag === 'ul' && l.listStyleType === 'disc'), 'no nested ul with disc')
check('nested ordered list has decimal', lists.some((l) => l.depth === 1 && l.tag === 'ol' && l.listStyleType === 'decimal'), 'no nested ol with decimal')
check('3-level deep bullet renders', lists.some((l) => l.depth === 2 && l.tag === 'ul' && l.listStyleType === 'disc'), 'no depth-2 ul with disc')
check('nested task list keeps list-style none', lists.some((l) => l.type === 'taskList' && l.depth >= 1 && l.listStyleType === 'none'), 'nested task list lost list-style none')
const liInList = await page.evaluate(() => {
  const ed = document.querySelector('.md-editor')
  const uls = ed.querySelectorAll('ul, ol')
  let flexCount = 0
  uls.forEach((u) => {
    u.querySelectorAll(':scope > li').forEach((li) => {
      if (getComputedStyle(li).display === 'flex') flexCount++
    })
  })
  return flexCount
})
check(
  'regular (non-task) list items are not flex (so markers paint)',
  liInList === lists.filter((l) => l.type === 'taskList').length,
  `${liInList} flex li, expected ${lists.filter((l) => l.type === 'taskList').length}`
)

await page.screenshot({ path: path.join(__dirname, 'nestedlists-harness.png') })

await browser.close()
server.close()
console.log(`\n${pass} passed, ${fail} failed`)
process.exit(fail > 0 ? 1 : 0)

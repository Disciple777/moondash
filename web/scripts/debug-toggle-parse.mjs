import puppeteer from 'puppeteer-core'
import http from 'http'
import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const PORT = 8128
const server = http.createServer((req, res) => {
  const url = decodeURIComponent((req.url || '/').split('?')[0])
  const file = path.join(__dirname, url === '/' ? 'drag-harness.html' : url.slice(1))
  fs.readFile(file, (err, data) => {
    if (err) { res.writeHead(404); res.end('nf'); return }
    res.writeHead(200, { 'Content-Type': 'text/html' })
    res.end(data)
  })
})
await new Promise((r) => server.listen(PORT, r))
const browser = await puppeteer.launch({ headless: 'new', executablePath: 'C:/Program Files/Google/Chrome/Application/chrome.exe', args: ['--no-sandbox'] })
const page = await browser.newPage()
page.on('pageerror', (e) => console.log('[pageerror]', e.message))
page.on('console', (m) => { if (m.type() === 'error') console.log('[console.error]', m.text().slice(0, 200)) })
await page.goto(`http://localhost:${PORT}/drag-harness.html`, { waitUntil: 'networkidle0', timeout: 60000 })
await page.waitForFunction(() => window.__ed, { timeout: 60000 })
await new Promise((r) => setTimeout(r, 800))
const out = await page.evaluate(() => {
  const ed = window.__ed
  const md = '- A\n- B\n- C\n\n<details class="toggle"><p>T</p></details>'
  ed.commands.setContent(md)
  return new Promise((resolve) =>
    setTimeout(() => {
      let toggleCount = 0
      let json = ''
      try { json = JSON.stringify(ed.state.doc.toJSON()).slice(0, 400) } catch {}
      ed.state.doc.descendants((n) => { if (n.type.name === 'toggle') toggleCount++ })
      resolve({
        toggleCount,
        html: document.querySelector('.md-editor').innerHTML.slice(0, 500),
        markdown: ed.storage.markdown.getMarkdown().slice(0, 300),
        json
      })
    }, 400)
  )
})
console.log(JSON.stringify(out, null, 2))
await browser.close()
server.close()

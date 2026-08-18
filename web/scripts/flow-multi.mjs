import puppeteer from 'puppeteer-core'
import fs from 'fs'

const APP = 'http://localhost:5199/'
const EMAIL = process.env.MD_TEST_EMAIL || 'test-1787027377@moondash.test'
const PASSWORD = 'test-pass-123'
const chromePath = fs.existsSync('C:/Program Files/Google/Chrome/Application/chrome.exe')
  ? 'C:/Program Files/Google/Chrome/Application/chrome.exe'
  : 'C:/Program Files (x86)/Google/Chrome/Application/chrome.exe'

const browser = await puppeteer.launch({ executablePath: chromePath, headless: 'new' })
const page = await browser.newPage()
await page.setViewport({ width: 1400, height: 900 })
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const domClick = (sel) =>
  page.evaluate((s) => {
    const el = document.querySelector(s)
    if (el) el.click()
    return !!el
  }, sel)
const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}
const errors = []
page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()) })
page.on('pageerror', (e) => errors.push('PAGEERROR: ' + e.message))

try {
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('input[type=email]', { timeout: 15000 })
  await page.type('input[type=email]', EMAIL)
  await page.type('input[type=password]', PASSWORD)
  await page.click('.login-form button[type=submit]')
  await page.waitForSelector('.sidebar', { timeout: 20000 })
  await sleep(1500)

  const suffix = Date.now().toString().slice(-6)
  const folderName = 'Flw Folder ' + suffix
  const multiName = 'Flw Multi ' + suffix

  // 1) create folder workspace
  await domClick('.ws-select')
  await page.waitForSelector('.ws-popover', { timeout: 8000 })
  await domClick('.ws-popover-new')
  await page.waitForFunction(() => document.querySelector('.modal .modal-title')?.textContent?.includes('New workspace'), { timeout: 8000 })
  await page.type('.modal input[placeholder="Workspace name…"]', folderName)
  await domClick('.modal .modal-actions .btn.primary')
  await page.waitForFunction(
    (n) => document.querySelector('.ws-select-name')?.textContent?.includes(n),
    { timeout: 15000 }, folderName
  )
  check('1: folder workspace created', true)

  // 2) create multi-space
  await sleep(400)
  await domClick('.ws-select')
  await page.waitForSelector('.ws-popover', { timeout: 8000 })
  await domClick('.ws-popover-new')
  await page.waitForFunction(() => document.querySelector('.modal .modal-title')?.textContent?.includes('New workspace'), { timeout: 8000 })
  await sleep(200)
  await page.type('.modal input[placeholder="Workspace name…"]', multiName)
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.ws-type-card')]
    cards.find((c) => c.textContent.includes('Multi-space'))?.click()
  })
  await domClick('.modal .modal-actions .btn.primary')
  await page.waitForFunction(
    (n) => document.querySelector('.ws-select-name')?.textContent?.includes(n),
    { timeout: 15000 }, multiName
  )
  const isMulti = await page.evaluate(
    () => !!document.querySelector('.ws-select-name')?.parentElement?.querySelector('.ws-multi-badge')
  )
  check('2: multi-space created (badge shown)', isMulti)

  // 3) New page in multi-space -> picker modal with folder workspaces
  await domClick('.new-page')
  await page.waitForFunction(() => document.querySelector('.multi-modal .modal-title')?.textContent?.includes('New page'), { timeout: 8000 })
  await sleep(500)
  const items = await page.evaluate(() =>
    [...document.querySelectorAll('.multi-modal .picker-item')].map((i) => i.textContent.trim())
  )
  check('3: New page opens picker listing folder workspace', items.some((t) => t.includes(folderName)), items.join(' | '))
  await page.screenshot({ path: 'scripts/flow-multi-newpage.png' })

  // 4) create a doc via the picker -> linked + visible in the multi-space
  await page.evaluate((n) => {
    const item = [...document.querySelectorAll('.multi-modal .picker-item')].find((i) => i.textContent.includes(n))
    item?.click()
  }, folderName)
  await page.waitForFunction(() => !document.querySelector('.multi-modal'), { timeout: 15000 })
  await sleep(1500)
  const treeDocs = await page.evaluate(() =>
    [...document.querySelectorAll('.tree-row')]
      .map((d) => d.textContent.trim())
      .filter(Boolean)
      .slice(0, 12)
  )
  check('4: doc created & visible in multi-space tree', treeDocs.length > 0, treeDocs.join(' | '))
  await page.screenshot({ path: 'scripts/flow-multi-withdoc.png' })

  // 5) Add a document modal lists docs from the folder workspace
  const addBtn = await page.evaluate(() =>
    [...document.querySelectorAll('.tree-toolbar-btn')].some((b) => b.textContent.includes('Add a document'))
  )
  check('5: "Add a document" button present', addBtn)
  await page.evaluate(() =>
    [...document.querySelectorAll('.tree-toolbar-btn')].find((b) => b.textContent.includes('Add a document'))?.click()
  )
  await page.waitForFunction(() => document.querySelector('.multi-modal .modal-title')?.textContent?.includes('Add a document'), { timeout: 8000 })
  await sleep(800)
  const groups = await page.evaluate(() =>
    [...document.querySelectorAll('.multi-modal-group')].map((g) => g.textContent.trim())
  )
  const emptyMsg = await page.evaluate(
    () => document.querySelector('.multi-modal .picker-empty')?.textContent?.trim() ?? ''
  )
  check(
    '6: Add-document modal works (groups or correct empty state)',
    groups.length >= 1 || emptyMsg.includes('already here') || emptyMsg.includes('No matching'),
    (groups.join(' | ') || emptyMsg).slice(0, 80)
  )
  await page.screenshot({ path: 'scripts/flow-add-doc.png' })

  const realErrors = errors.filter((e) => !e.includes('favicon') && !e.includes('net::ERR') && !e.includes('DevTools'))
  check('7: no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' || '))
} catch (e) {
  check('UNEXPECTED ERROR', false, e.message)
  await page.screenshot({ path: 'scripts/flow-error.png' })
  try {
    const dump = await page.evaluate(() => ({
      modalTitle: document.querySelector('.modal .modal-title')?.textContent ?? null,
      modalBody: document.querySelector('.modal')?.textContent?.slice(0, 150) ?? null,
      toast: document.querySelector('.toast')?.textContent ?? null,
      wsName: document.querySelector('.ws-select-name')?.textContent ?? null,
      popover: !!document.querySelector('.ws-popover'),
      body: document.body.innerText.slice(0, 150)
    }))
    console.log('FAILURE STATE:', JSON.stringify(dump, null, 2))
  } catch {}
}

await browser.close()
const failed = results.filter((r) => !r.ok)
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`)
process.exit(failed.length ? 1 : 0)

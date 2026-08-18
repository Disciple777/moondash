/**
 * End-to-end driver for the user's three reported issues, run against the
 * CURRENT frontend (vite dev on :5199) + LIVE backend (guatermelon.com).
 *
 * Verifies:
 *   A. "New workspace" opens the FULL dialog (name, description, type cards,
 *      color swatches, icon choices, Create button) — not just a name input.
 *   B. Creating a folder workspace works, then creating a multi-space works.
 *   C. In a multi-space, "New page" opens the workspace picker modal (instead
 *      of doing nothing), and creating a doc links it into the multi-space.
 *   D. "Add a document" modal opens and lists docs from folder workspaces.
 *   E. No console errors during any of it.
 */
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

const consoleErrors = []
page.on('console', (m) => {
  if (m.type() === 'error') consoleErrors.push(m.text())
})
page.on('pageerror', (e) => consoleErrors.push('PAGEERROR: ' + e.message))

const results = []
const check = (name, ok, extra = '') => {
  results.push({ name, ok, extra })
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${extra ? ' — ' + extra : ''}`)
}
const shot = (n) => page.screenshot({ path: `scripts/userflow-${n}.png` })

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const $ = (sel) => page.$(sel)
const $$ = (sel) => page.$$(sel)
const text = async (sel) => {
  const el = await $(sel)
  return el ? (await el.evaluate((n) => n.textContent)).trim() : null
}
const click = async (sel) => {
  const ok = await page.evaluate((s) => {
    const el = document.querySelector(s)
    if (!el) return false
    el.click()
    return true
  }, sel)
  if (!ok) throw new Error(`click: not found ${sel}`)
}

try {
  // --- login ---
  await page.goto(APP, { waitUntil: 'networkidle2', timeout: 30000 })
  await page.waitForSelector('input[type=email]', { timeout: 15000 })
  await page.type('input[type=email]', EMAIL)
  await page.type('input[type=password]', PASSWORD)
  await click('.login-form button[type=submit]')
  await page.waitForSelector('.sidebar', { timeout: 20000 })
  await sleep(1500)
  check('A0: login works (sidebar visible)', true)
  await shot('login')

  // --- A: New workspace dialog ---
  await click('.ws-select')
  await page.waitForSelector('.ws-popover', { timeout: 8000 })
  await click('.ws-popover-new')
  await page.waitForFunction(
    () => document.querySelector('.modal .modal-title')?.textContent?.includes('New workspace'),
    { timeout: 8000 }
  )
  await sleep(400)

  const hasName = !!(await $('.modal input[placeholder="Workspace name…"]'))
  const hasDesc = !!(await $('.modal input[placeholder="What lives here?"]'))
  const typeCards = (await $$('.modal .ws-type-card')).length
  const swatches = (await $$('.modal .swatch')).length
  const icons = (await $$('.modal .icon-choice')).length
  const createBtn = await text('.modal .modal-actions .btn.primary')
  check('A1: name field present', hasName)
  check('A2: description field present', hasDesc)
  check('A3: type cards (Folder/Multi) present', typeCards === 2, `got ${typeCards}`)
  check('A4: color swatches present', swatches >= 8, `got ${swatches}`)
  check('A5: icon choices present', icons >= 5, `got ${icons}`)
  check('A6: Create button present', createBtn === 'Create', `got "${createBtn}"`)
  await shot('ws-dialog')

  // --- B: create folder workspace ---
  const suffix = Date.now().toString().slice(-6)
  const folderName = 'Test Folder ' + suffix
  const multiName = 'Test Multi ' + suffix
  await page.type('.modal input[placeholder="Workspace name…"]', folderName)
  await click('.modal .modal-actions .btn.primary')
  await page.waitForFunction(
    (n) => document.querySelector('.ws-select-name')?.textContent?.includes(n),
    { timeout: 15000 },
    folderName
  )
  check('B1: folder workspace created & active', true)

  // create multi-space
  await sleep(500)
  await page.evaluate(() => document.querySelector('.ws-select').click())
  await page.waitForSelector('.ws-popover', { timeout: 8000 })
  await click('.ws-popover-new')
  await page.waitForFunction(
    () => document.querySelector('.modal .modal-title')?.textContent?.includes('New workspace'),
    { timeout: 8000 }
  )
  await sleep(300)
  await shot('multi-dialog')
  await page.type('.modal input[placeholder="Workspace name…"]', multiName)
  // pick the Multi-space type card (the one with Layers icon)
  const multiCard = await page.evaluateHandle(() => {
    const cards = [...document.querySelectorAll('.ws-type-card')]
    return cards.find((c) => c.textContent.includes('Multi-space'))
  })
  await page.evaluate(() => {
    const cards = [...document.querySelectorAll('.ws-type-card')]
    cards.find((c) => c.textContent.includes('Multi-space')).click()
  })
  await click('.modal .modal-actions .btn.primary')
  await page.waitForFunction(
    (n) => document.querySelector('.ws-select-name')?.textContent?.includes(n),
    { timeout: 15000 },
    multiName
  )
  const multiBadge = await page.evaluate(
    () => !!document.querySelector('.ws-select-name')?.parentElement?.querySelector('.ws-multi-badge')
  )
  check('B2: multi-space created & active (badge shown)', multiBadge)
  await shot('multi-active')

  // --- C: New page in multi-space opens the picker ---
  await click('.new-page')
  await page.waitForSelector('.multi-modal', { timeout: 8000 })
  await sleep(400)
  const pickerItems = await $$('.multi-modal .picker-item')
  const itemTexts = []
  for (const it of pickerItems) itemTexts.push((await it.evaluate((n) => n.textContent)).trim())
  check('C1: New page opens picker modal (folder workspace listed)', itemTexts.length >= 1, itemTexts.join(' | '))
  await shot('multi-newpage')

  // create a doc in the folder workspace via the picker
  const folderItem = itemTexts.findIndex((t) => t.includes(folderName))
  check('C2: picker lists the folder workspace', folderItem >= 0, itemTexts.join(' | '))
  if (folderItem >= 0) {
    await pickerItems[folderItem].click()
    await page.waitForFunction(() => !document.querySelector('.multi-modal'), { timeout: 15000 })
    await sleep(1500)
    const treeDoc = await page.evaluate(() => {
      const docs = [...document.querySelectorAll('.tree-doc, .doc-item, .tree-item')]
      return docs.map((d) => d.textContent.trim()).filter(Boolean).slice(0, 10)
    })
    check('C3: doc created & visible in multi-space tree', treeDoc.length > 0, treeDoc.join(' | '))
    await shot('multi-with-doc')
  }

  // --- D: Add a document modal ---
  await page.waitForSelector('.tree-toolbar-btn', { timeout: 8000 })
  const addBtns = await page.evaluate(() =>
    [...document.querySelectorAll('.tree-toolbar-btn')].map((b) => b.textContent.trim())
  )
  const addBtn = await page.evaluateHandle(() =>
    [...document.querySelectorAll('.tree-toolbar-btn')].find((b) => b.textContent.includes('Add a document'))
  )
  check('D1: "Add a document" button present', !!addBtn, addBtns.join(' | '))
  if (addBtn) {
    await addBtn.asElement().click()
    await page.waitForSelector('.multi-modal', { timeout: 8000 })
    await sleep(600)
    const linkGroups = await page.evaluate(() =>
      [...document.querySelectorAll('.multi-modal-group')].map((g) => g.textContent.trim())
    )
    check('D2: Add-document modal lists workspace groups', linkGroups.length >= 1, linkGroups.join(' | '))
    await shot('add-doc-modal')
    // close it
    await click('.multi-modal .modal-actions .btn.ghost')
  }

  // --- E: console errors ---
  const realErrors = consoleErrors.filter(
    (e) => !e.includes('favicon') && !e.includes('DevTools') && !e.includes('net::ERR')
  )
  check('E1: no console errors', realErrors.length === 0, realErrors.slice(0, 3).join(' || '))
} catch (e) {
  check('UNEXPECTED ERROR', false, e.message)
  await shot('error')
  try {
    const dump = await page.evaluate(() => ({
      popover: !!document.querySelector('.ws-popover'),
      modal: !!document.querySelector('.modal'),
      toast: document.querySelector('.toast')?.textContent ?? null,
      wsName: document.querySelector('.ws-select-name')?.textContent ?? null,
      bodySnippet: document.body.innerText.slice(0, 200)
    }))
    console.log('FAILURE STATE:', JSON.stringify(dump, null, 2))
  } catch {}
}

await browser.close()

const failed = results.filter((r) => !r.ok)
console.log(`\n=== ${results.length - failed.length}/${results.length} checks passed ===`)
process.exit(failed.length ? 1 : 0)

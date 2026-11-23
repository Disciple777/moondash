// Post-build guard for the download page (runs as part of `npm run build`).
//
// The PWA service worker answers every navigation with the app shell unless the
// URL matches its navigateFallbackDenylist. If that rule ever stops matching,
// /download/ silently turns into the app again. This fails the build instead.
import { existsSync, readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import path from 'node:path'

const dist = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../dist')
const fail = (msg) => {
  console.error(`\n[check-download] ${msg}\n`)
  process.exit(1)
}

if (!existsSync(path.join(dist, 'download/index.html'))) {
  fail('dist/download/index.html is missing — web/public/download/index.html must be kept.')
}

const sw = readFileSync(path.join(dist, 'sw.js'), 'utf8')
const m = sw.match(/denylist:\[([^\]]*)\]/)
if (!m) fail('No navigation denylist found in dist/sw.js — the download page would be replaced by the app.')
// The denylist is emitted as a JS array of regex literals.
const denylist = new Function(`return [${m[1]}]`)()
const blocked = (p) => denylist.some((re) => re.test(p))

// Workbox tests url.pathname + url.search, so check with the real subfolder
// the app is deployed under as well as at the domain root.
const mustBypass = [
  '/download/',
  '/download',
  '/moondash/download/',
  '/moondash/download',
  '/moondash/download/index.html',
  '/moondash/download/Moondash-1.0.1-win32-x64.zip'
]
const mustServeApp = ['/', '/moondash/', '/moondash/index.html']

for (const p of mustBypass) {
  if (!blocked(p)) fail(`Service worker would serve the app instead of ${p}. Fix navigateFallbackDenylist in vite.config.ts.`)
}
for (const p of mustServeApp) {
  if (blocked(p)) fail(`Service worker denylist is too broad: it also skips ${p}.`)
}

console.log('[check-download] download page OK')

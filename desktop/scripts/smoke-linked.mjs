// Smoke test for the linked-file sync engine (docs linked in place by
// absolute path). Runs against a tiny mock API on localhost. Validates:
// first-time link, local edit push, remote edit pull, last-write-wins
// divergence (both directions), missing-file tolerance, and date inheritance.
// Run: node scripts/smoke-linked.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { LinkedFileEngine } = require('../src/linked-sync.js')

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

// ---- mock API ----------------------------------------------------------
// Entries keyed by local_path; mirror the shape of /api/sync/external.
const state = { workspace_id: 42, entries: {} } // local_path -> entry
let revisionCounter = 1
// The mock cloud clock starts ~1 year in the future so local test files
// (mtime = "now") always count as OLDER than freshly-uploaded remote docs.
let cloudClock = Date.now() + 1000 * 60 * 60 * 24 * 365
const mysqlTime = (ms) => new Date(ms).toISOString().slice(0, 19).replace('T', ' ')

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url, 'http://localhost')
  const send = (code, data) => {
    res.writeHead(code, { 'Content-Type': 'application/json' })
    res.end(JSON.stringify(data))
  }

  if (url.pathname === '/api/sync/external') {
    return send(200, {
      workspace_id: state.workspace_id,
      entries: Object.values(state.entries)
    })
  }

  if (url.pathname === '/api/sync/file') {
    const rel = url.searchParams.get('relative_path')
    const entry = Object.values(state.entries).find((e) => e.relative_path === rel)
    return entry && !entry.is_deleted
      ? send(200, { file: { title: 'x', content: entry.content, revision: entry.revision, updated_at: entry.updated_at } })
      : send(404, { message: 'nf' })
  }

  if (url.pathname === '/api/sync/push') {
    const body = JSON.parse(await readBody(req))
    const results = []
    for (const file of body.files) {
      const existing = Object.values(state.entries).find((e) => e.relative_path === file.relative_path)
      const revision = (existing?.revision ?? 0) + 1
      const parsed = file.mtime ? Date.parse(file.mtime) : NaN
      const entry = existing ?? {
        relative_path: file.relative_path,
        local_path: 'C:/test/' + file.relative_path,
        is_deleted: 0,
        bit_id: revisionCounter
      }
      entry.content = file.content
      entry.content_hash = file.hash
      entry.revision = revision
      entry.is_deleted = 0
      entry.updated_at = Number.isFinite(parsed) ? mysqlTime(parsed) : mysqlTime(cloudClock++)
      state.entries[entry.local_path] = entry
      results.push({ relative_path: file.relative_path, status: 'ok', revision, bit_id: revisionCounter++ })
    }
    return send(200, { results })
  }

  send(404, { message: 'not found: ' + url.pathname })
})

function readBody(req) {
  return new Promise((resolve) => {
    let data = ''
    req.on('data', (c) => (data += c))
    req.on('end', () => resolve(data))
  })
}

// ---- helpers -----------------------------------------------------------
let failures = 0
function assert(cond, label) {
  if (cond) console.log(`  ✓ ${label}`)
  else {
    failures++
    console.error(`  ✗ FAIL: ${label}`)
  }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moondash-linked-'))
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moondash-linked-manifest-'))
const write = (rel, content) => {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
  return abs
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const seed = (rel, content) => {
  const abs = write(rel, content)
  state.entries[abs] = {
    relative_path: rel,
    local_path: abs,
    content,
    content_hash: sha(content),
    revision: 1,
    is_deleted: 0,
    bit_id: revisionCounter++,
    updated_at: mysqlTime(cloudClock++)
  }
  return abs
}

async function run() {
  await new Promise((r) => server.listen(0, r))
  const port = server.address().port
  console.log(`Mock API on :${port}, linked files at ${root}\n`)

  const engine = new LinkedFileEngine({
    apiBase: `http://localhost:${port}`,
    getToken: () => 'test-token',
    storageDir,
    onStatus: () => {}
  })

  // 1. first-ever sync of an identical file counts as a divergence (no
  //    manifest yet), resolved LWW — remote is newer → pulled, same content,
  //    no data loss, no conflicted copy. Same policy as the folder engine.
  const sameAbs = seed('same.md', '# Same content')
  const first = await engine.syncNow()
  if (first.error) console.error('  [first sync error]', first.error)
  assert(!first.error && first.conflicts === 1 && first.pulled === 1, 'first sync of identical file → resolved divergence (remote newer)')
  assert(read('same.md') === '# Same content', 'content unchanged after first-sync resolution')

  // 2. remote-only doc (file missing on disk) → left alone, counted missing
  {
    const abs = path.join(root, 'gone.md')
    state.entries[abs] = {
      relative_path: 'gone.md',
      local_path: abs,
      content: '# Cloud only',
      content_hash: sha('# Cloud only'),
      revision: 1,
      is_deleted: 0,
      bit_id: revisionCounter++,
      updated_at: mysqlTime(cloudClock++)
    }
  }
  const second = await engine.syncNow()
  assert(second.missing === 1, 'missing local file counted, cloud copy untouched')

  // 3. local edit → pushed up (with mtime)
  write('same.md', '# Same content\n\nEdited locally')
  const third = await engine.syncNow()
  assert(third.pushed === 1, 'local edit pushed' )
  const sameEntry = Object.values(state.entries).find((e) => e.relative_path === 'same.md')
  assert(sameEntry.content.includes('Edited locally'), 'server received the new content')
  assert(
    sameEntry.updated_at === mysqlTime(fs.statSync(sameAbs).mtimeMs),
    'cloud updated_at inherits the local file mtime'
  )

  // 4. remote edit → pulled down to disk (and stamps the cloud date)
  const remoteRel = 'remote.md'
  const remoteAbs = seed(remoteRel, '# Old remote')
  state.entries[remoteAbs].content = '# New remote version'
  state.entries[remoteAbs].content_hash = sha('# New remote version')
  state.entries[remoteAbs].revision += 1
  state.entries[remoteAbs].updated_at = mysqlTime(cloudClock + 3600_000)
  const fourth = await engine.syncNow()
  assert(fourth.pulled === 1, 'remote edit pulled')
  assert(read('remote.md').includes('New remote version'), 'local file updated from cloud')
  assert(
    Math.abs(fs.statSync(remoteAbs).mtimeMs - Date.parse(state.entries[remoteAbs].updated_at + 'Z')) < 1000,
    'pulled file inherits the cloud date as its local mtime'
  )

  // 5. divergence, remote newer → remote wins, no conflicted copy
  const confRel = 'conflict.md'
  const confAbs = seed(confRel, '# Local version')
  // cloud moves ahead + is clearly newer
  state.entries[confAbs].content = '# Remote version'
  state.entries[confAbs].content_hash = sha('# Remote version')
  state.entries[confAbs].revision += 1
  state.entries[confAbs].updated_at = mysqlTime(cloudClock + 3600_000)
  write('conflict.md', '# Local edited again') // local also changed, but earlier
  const fifth = await engine.syncNow()
  assert(fifth.conflicts === 1, 'divergence detected (remote newer)')
  assert(fifth.pulled === 1, 'newer remote version pulled down')
  assert(read('conflict.md').includes('Remote version'), 'remote content wins locally')

  // 6. divergence, local newer → local wins
  const lwRel = 'localwins.md'
  const lwAbs = seed(lwRel, '# Local version')
  state.entries[lwAbs].content = '# Remote edit'
  state.entries[lwAbs].content_hash = sha('# Remote edit')
  state.entries[lwAbs].revision += 1 // remote moved ahead...
  state.entries[lwAbs].updated_at = '2020-01-01 00:00:00' // ...but long ago
  write('localwins.md', '# Local edited again') // local also changed, recently
  const sixth = await engine.syncNow()
  assert(sixth.conflicts === 1, 'divergence detected (local newer)')
  assert(sixth.pushed === 1, 'newer local version pushed up')
  assert(read('localwins.md').includes('Local edited again'), 'local content kept')
  assert(
    Object.values(state.entries).find((e) => e.relative_path === lwRel).content.includes('Local edited again'),
    'remote updated to the local version'
  )

  // 7. unchanged → no pushes/pulls (the intentionally-missing file still
  //    reports as missing, which is informational)
  const seventh = await engine.syncNow()
  assert(seventh.pushed === 0 && seventh.pulled === 0, 'no-op sync does nothing')

  // 8. no token → safe no-op, no throw
  const noToken = new LinkedFileEngine({
    apiBase: `http://localhost:${port}`,
    getToken: () => null,
    storageDir,
    onStatus: () => {}
  })
  const eighth = await noToken.syncNow()
  assert(eighth.error === null && eighth.pushed === 0, 'no token → safe no-op')

  console.log(failures === 0 ? '\nAll linked-sync smoke tests passed ✅' : `\n${failures} test(s) failed ❌`)
  engine.stop()
  noToken.stop()
  server.close()
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

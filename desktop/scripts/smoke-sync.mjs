// Smoke test for the sync engine, run against a tiny mock API on localhost.
// Validates: initial push, change push, remote pull, local deletion,
// remote deletion, last-write-wins divergence resolution (both directions,
// by modification time — no .conflicted copies), legacy conflicted-copy
// cleanup, and date inheritance (local mtime → cloud updated_at, cloud
// updated_at → local mtime on pull, plus the self-limiting stale-stamp
// repair).
// Run: node scripts/smoke-sync.mjs
import http from 'node:http'
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import crypto from 'node:crypto'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { SyncEngine } = require('../src/sync.js')

const sha = (s) => crypto.createHash('sha256').update(s, 'utf8').digest('hex')

// ---- mock API ----------------------------------------------------------
const state = { files: {} } // relative_path -> { content, hash, revision, is_deleted, updated_at }
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

  if (url.pathname === '/api/sync/manifest') {
    return send(200, {
      entries: Object.entries(state.files).map(([p, f]) => ({
        relative_path: p,
        content_hash: f.hash,
        revision: f.revision,
        is_deleted: f.is_deleted ? 1 : 0,
        bit_id: 1,
        updated_at: f.updated_at
      }))
    })
  }

  if (url.pathname === '/api/sync/file') {
    const f = state.files[url.searchParams.get('relative_path')]
    return f
      ? send(200, { file: { title: 'x', content: f.content, revision: f.revision, updated_at: f.updated_at } })
      : send(404, { message: 'nf' })
  }

  if (url.pathname === '/api/sync/push') {
    const body = JSON.parse(await readBody(req))
    const results = []
    for (const file of body.files) {
      const existing = state.files[file.relative_path]
      const revision = (existing?.revision ?? 0) + 1
      const parsed = file.mtime ? Date.parse(file.mtime) : NaN
      state.files[file.relative_path] = {
        content: file.content,
        hash: file.hash,
        revision,
        is_deleted: false,
        updated_at: Number.isFinite(parsed) ? mysqlTime(parsed) : mysqlTime(cloudClock++)
      }
      results.push({ relative_path: file.relative_path, status: 'ok', revision, bit_id: revisionCounter++ })
    }
    return send(200, { results })
  }

  if (url.pathname === '/api/sync/remove') {
    const body = JSON.parse(await readBody(req))
    const f = state.files[body.relative_path]
    if (f && !f.is_deleted) {
      f.is_deleted = true
      f.revision += 1
      f.updated_at = mysqlTime(cloudClock++)
      return send(200, { ok: true, revision: f.revision })
    }
    return send(200, { ok: false })
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

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moondash-smoke-'))
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moondash-manifest-'))
const write = (rel, content) => {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
}
const read = (rel) => fs.readFileSync(path.join(root, rel), 'utf8')
const noConflictedCopies = () => fs.readdirSync(root).filter((f) => f.includes('.conflicted-'))

async function run() {
  await new Promise((r) => server.listen(0, r))
  const port = server.address().port
  console.log(`Mock API on :${port}, synced folder at ${root}\n`)

  const engine = new SyncEngine({
    workspaceId: 7,
    root,
    apiBase: `http://localhost:${port}`,
    getToken: () => 'test-token',
    storageDir,
    onStatus: () => {},
    trash: null
  })

  // 0. fresh engine + pre-existing local file that ALSO exists remotely,
  //    differently, but the remote copy is ancient → local wins by mtime
  write('seed.md', '# Local seed')
  state.files['seed.md'] = {
    content: '# Remote seed',
    hash: sha('# Remote seed'),
    revision: 1,
    is_deleted: false,
    updated_at: '2020-01-01 00:00:00'
  }
  const zero = await engine.syncNow()
  assert(zero.conflicts === 1, 'never-synced local file vs remote is a divergence')
  assert(zero.pushed === 1, 'newer local version is pushed up')
  assert(read('seed.md').includes('Local seed'), 'local content kept (local wins)')
  assert(state.files['seed.md']?.content.includes('Local seed'), 'remote updated to the local version')
  assert(noConflictedCopies().length === 0, 'no conflicted copy created')

  // 1. initial push
  write('hello.md', '# Hello\n\nWorld')
  write('docs/notes.md', '## Notes\n\n- one\n- two')
  const first = await engine.syncNow()
  assert(first.pushed === 2 && first.pulled === 0, 'initial push uploads both files')
  assert(state.files['hello.md']?.hash === sha('# Hello\n\nWorld'), 'server stored hello.md hash')
  assert(state.files['docs/notes.md']?.revision === 1, 'server revision starts at 1')

  // 2. edit locally → push one
  write('hello.md', '# Hello\n\nWorld\n\nChanged!')
  const second = await engine.syncNow()
  assert(second.pushed === 1, 'edit pushes only the changed file')
  assert(state.files['hello.md']?.content.includes('Changed!'), 'server got the new content')
  assert(state.files['hello.md']?.revision === 2, 'revision bumped to 2')

  // 3. remote edit → pull downloads it
  state.files['docs/notes.md'].content = '## Notes\n\nEdited remotely'
  state.files['docs/notes.md'].hash = sha(state.files['docs/notes.md'].content)
  state.files['docs/notes.md'].revision += 1
  state.files['docs/notes.md'].updated_at = mysqlTime(cloudClock++)
  const third = await engine.syncNow()
  assert(third.pulled === 1, 'remote edit is pulled')
  assert(read('docs/notes.md').includes('Edited remotely'), 'local file updated from remote')
  assert(
    Math.abs(
      fs.statSync(path.join(root, 'docs/notes.md')).mtimeMs -
      Date.parse(state.files['docs/notes.md'].updated_at + 'Z')
    ) < 1000,
    'pulled file inherits the cloud date as its local mtime'
  )

  // 4. local deletion → remote soft-delete
  fs.unlinkSync(path.join(root, 'hello.md'))
  const fourth = await engine.syncNow()
  assert(fourth.pushed === 1, 'local deletion reported to server')
  assert(state.files['hello.md']?.is_deleted === true, 'server marked file deleted')

  // 5. remote deletion → local file removed
  write('todo.md', '- [ ] something')
  await engine.syncNow()
  state.files['todo.md'].is_deleted = true
  state.files['todo.md'].revision += 1
  state.files['todo.md'].updated_at = mysqlTime(cloudClock++)
  const fifth = await engine.syncNow()
  assert(fifth.pulled === 1, 'remote deletion pulled')
  assert(!fs.existsSync(path.join(root, 'todo.md')), 'local file removed after remote delete')

  // 6. divergence, remote newer → remote wins locally, no conflicted copy
  write('conflict.md', '# Local version')
  await engine.syncNow() // upload local (cloud time is ~1yr in the future)
  state.files['conflict.md'].content = '# Remote version'
  state.files['conflict.md'].hash = sha(state.files['conflict.md'].content)
  state.files['conflict.md'].revision += 1 // remote moved ahead
  state.files['conflict.md'].updated_at = mysqlTime(cloudClock + 3600_000) // ...and is clearly newer
  write('conflict.md', '# Local edited again') // local also changed, but earlier
  const sixth = await engine.syncNow()
  assert(sixth.conflicts === 1, 'divergence detected')
  assert(sixth.pulled === 1, 'newer remote version pulled down')
  assert(read('conflict.md').includes('Remote version'), 'remote content wins locally')
  assert(noConflictedCopies().length === 0, 'no conflicted copy created')

  // 6b. divergence, local newer → local wins, no conflicted copy
  write('localwins.md', '# Local version')
  await engine.syncNow() // upload local
  state.files['localwins.md'].content = '# Remote edit'
  state.files['localwins.md'].hash = sha(state.files['localwins.md'].content)
  state.files['localwins.md'].revision += 1 // remote moved ahead...
  state.files['localwins.md'].updated_at = '2020-01-01 00:00:00' // ...but long ago
  write('localwins.md', '# Local edited again') // local also changed, and recently
  const sixthB = await engine.syncNow()
  assert(sixthB.conflicts === 1, 'divergence detected')
  assert(sixthB.pushed === 1, 'newer local version pushed up')
  assert(read('localwins.md').includes('Local edited again'), 'local content kept (local wins)')
  assert(state.files['localwins.md']?.content.includes('Local edited again'), 'remote updated to the local version')
  assert(noConflictedCopies().length === 0, 'no conflicted copy created')

  // 7. legacy .conflicted-* copies are auto-resolved on sync
  write('notes.md', '# Old main content')
  fs.utimesSync(path.join(root, 'notes.md'), new Date(2020, 0, 1), new Date(2020, 0, 1)) // main is old
  write('notes.conflicted-2026-08-09T12-34-56.md', '# Newer conflicted content')
  write('orphan.conflicted-2026-08-09T12-34-56.md', '# Orphan content') // main never existed
  const seventh = await engine.syncNow()
  assert(seventh.cleaned === 2, 'cleanup count reported')
  assert(read('notes.md').includes('Newer conflicted content'), 'newer conflicted copy merged into the main file')
  assert(
    !fs.existsSync(path.join(root, 'notes.conflicted-2026-08-09T12-34-56.md')),
    'stale conflicted copy deleted'
  )
  assert(fs.existsSync(path.join(root, 'orphan.md')) && read('orphan.md').includes('Orphan content'),
    'orphaned conflicted copy renamed back to the main name')

  // 7b. orphan whose main exists ONLY on the cloud, and the cloud main is
  // newer → the stale orphan is dropped, not revived over the newer main
  write('cloudmain.md', '# Old local leftover') // will be deleted below
  await engine.syncNow() // seed a local main so the cloud knows the file
  fs.unlinkSync(path.join(root, 'cloudmain.md')) // main now missing locally
  state.files['cloudmain.md'].content = '# Newer cloud main'
  state.files['cloudmain.md'].hash = sha('# Newer cloud main')
  state.files['cloudmain.md'].revision += 1
  state.files['cloudmain.md'].updated_at = mysqlTime(cloudClock + 3600_000) // clearly newer
  write('cloudmain.conflicted-2026-08-09T12-34-56.md', '# Stale orphan')
  const seventhB = await engine.syncNow()
  assert(
    !fs.existsSync(path.join(root, 'cloudmain.conflicted-2026-08-09T12-34-56.md')),
    'stale orphan deleted when cloud main is newer'
  )
  assert(
    !fs.existsSync(path.join(root, 'cloudmain.md')) || read('cloudmain.md').includes('Newer cloud main'),
    'cloud main pulled down (stale orphan did not clobber it)'
  )

  // 8. unchanged → no-op sync
  const eighth = await engine.syncNow()
  assert(eighth.pushed === 0 && eighth.pulled === 0 && eighth.cleaned === 0, 'no-op sync does nothing')

  // 9. dates: a new local file's mtime is inherited by the cloud
  write('dated.md', '# Dated file')
  const datedAbs = path.join(root, 'dated.md')
  const oldDate = new Date(2023, 5, 15, 10, 30, 0) // June 2023
  fs.utimesSync(datedAbs, oldDate, oldDate)
  const ninth = await engine.syncNow()
  assert(ninth.pushed === 1, 'dated file pushed')
  assert(
    state.files['dated.md'].updated_at === mysqlTime(oldDate.getTime()),
    'cloud updated_at inherits the local file date'
  )

  // 9b. an existing cloud copy stamped with a newer sync date is repaired
  write('repair.md', '# Repaired file')
  await engine.syncNow() // upload → cloud date = local mtime
  const repairAbs = path.join(root, 'repair.md')
  const repairDate = new Date(Date.now() - 1000 * 60 * 60 * 24 * 30) // file last touched a month ago
  fs.utimesSync(repairAbs, repairDate, repairDate)
  state.files['repair.md'].updated_at = mysqlTime(Date.now() + 1000 * 60 * 60 * 24) // stale stamp (tomorrow)
  const ninthB = await engine.syncNow()
  assert(ninthB.pushed === 1, 'stale cloud stamp repaired via re-push')
  assert(
    state.files['repair.md'].updated_at === mysqlTime(repairDate.getTime()),
    'cloud date corrected to the real file date'
  )

  // 9c. the repair is self-limiting — no repeat pushes
  const ninthC = await engine.syncNow()
  assert(ninthC.pushed === 0, 'date repair is self-limiting (no repeat pushes)')

  console.log(failures === 0 ? '\nAll smoke tests passed ✅' : `\n${failures} test(s) failed ❌`)
  engine.stop()
  server.close()
  process.exit(failures === 0 ? 0 : 1)
}

run().catch((err) => {
  console.error(err)
  process.exit(1)
})

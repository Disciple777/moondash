// Live reproduction of the folder-sync scenario against the production API.
// Creates a throwaway account + workspace, seeds server docs, creates a local
// folder with pre-existing files (empty file, subfolder, name collision) and
// runs the real SyncEngine to see what happens in both directions.
//
// Usage: node scripts/repro-live-sync.mjs
// Env:   MOONDASH_API to override the API base.
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { createRequire } from 'node:module'

const require = createRequire(import.meta.url)
const { SyncEngine } = require('../src/sync.js')

const BASE = process.env.MOONDASH_API || 'https://guatermelon.com/moondash/backend/public'
const EMAIL = 'moondash-synctest@example.com'
const PASSWORD = 'Synctest123!'

async function api(method, p, body, token) {
  const headers = { 'Content-Type': 'application/json' }
  if (token) headers['Authorization'] = `Bearer ${token}`
  const res = await fetch(`${BASE}${p}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })
  const data = await res.json().catch(() => ({}))
  return { status: res.status, data }
}

const root = fs.mkdtempSync(path.join(os.tmpdir(), 'moondash-live-'))
const storageDir = fs.mkdtempSync(path.join(os.tmpdir(), 'moondash-live-manifest-'))
const write = (rel, content) => {
  const abs = path.join(root, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content, 'utf8')
}

// 1. throwaway account
let r = await api('POST', '/api/auth/register', { email: EMAIL, password: PASSWORD })
if (r.status === 422 && String(r.data.message).includes('already registered')) {
  r = await api('POST', '/api/auth/login', { email: EMAIL, password: PASSWORD })
}
const token = r.data.token
if (!token) {
  console.error('Could not get a token:', JSON.stringify(r.data))
  process.exit(1)
}
console.log('✓ registered/logged in')

// 2. workspace
r = await api('POST', '/api/workspaces', { name: 'Sync Live Test' }, token)
const wsId = r.data.workspace_id
console.log('✓ workspace', wsId)

// 3. seed server docs
await api('POST', '/api/docs', { workspace_id: wsId, relative_path: 'a.md', content: '# Server A' }, token)
await api('POST', '/api/docs', { workspace_id: wsId, relative_path: 'b.md', content: '## Server B' }, token)
console.log('✓ seeded server docs: a.md, b.md')

// 4. local folder with pre-existing files (not created in Moondash)
write('x-empty.md', '')
write('y.md', '# Local Y content')
write('a.md', '# Local A variant')
write('sub/nested.md', '- from a subfolder')
console.log('✓ local folder:', root)
console.log('  files: x-empty.md (empty), y.md, a.md (collides with server), sub/nested.md')

// 5. run the real engine
const engine = new SyncEngine({
  workspaceId: wsId,
  root,
  apiBase: BASE,
  getToken: () => token,
  storageDir,
  onStatus: (s) => console.log('  status:', s.state, '-', s.message),
  trash: null
})
const result = await engine.syncNow()
console.log('✓ syncNow result:', JSON.stringify(result))

// 6. server tree after sync
r = await api('GET', `/api/workspaces/tree?workspace_id=${wsId}`, undefined, token)
console.log('SERVER TREE AFTER SYNC:')
for (const d of r.data.docs) {
  console.log('   ', d.relative_path, 'rev=' + d.revision, JSON.stringify(d.content_preview))
}

// 7. local folder after sync
console.log('LOCAL FOLDER AFTER SYNC:')
for (const f of fs.readdirSync(root).sort()) console.log('   ', f)

// 8. cleanup workspace (docs cascade)
await api('DELETE', `/api/workspaces?workspace_id=${wsId}`, undefined, token)
console.log('✓ cleaned up workspace', wsId)

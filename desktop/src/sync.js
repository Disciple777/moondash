// Folder-sync engine.
//
// Model: the cloud is the source of truth. Each doc has a content hash and a
// monotonic revision. The engine keeps a local "last manifest" (per
// workspace + root folder) so it knows what it has already seen locally.
//
//   pull()  downloads remote changes and applies deletions
//   push()  uploads local new/changed files and reports deletions
//
// Divergences (both sides changed since the last sync) are resolved as
// last-write-wins by modification time: whichever side has the newer
// timestamp prevails and the other side is silently updated — no
// `.conflicted-*` copies are created anymore. Legacy `*.conflicted-*` files
// left behind by older versions are auto-resolved on the first sync (the
// newest copy wins, the stale one is deleted).
//
// Dates are inherited from the filesystem: every push carries the local
// mtime, which the cloud stores as the doc's updated_at (files that were
// never modified in the app keep their real disk date), and pulls stamp the
// cloud's updated_at onto the local file. A self-healing repair re-pushes
// unchanged files whose cloud date is a stale sync stamp newer than the
// real file date.
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const crypto = require('crypto')
const { resolveInRoot } = require('./paths')

const IGNORED_DIRS = new Set(['node_modules', '.git', '.svn', '.hg', '.moondash', '.DS_Store'])
const MARKDOWN_EXT = /\.(md|markdown|txt)$/i

// Files produced by pre-mtime engines: `name.conflicted-2026-08-09T12-34-56.md`
const CONFLICTED_FILE_RE = /^(.+)\.conflicted-\d{4}-\d{2}-\d{2}T\d{2}-\d{2}-\d{2}(\.(?:md|markdown|txt))$/i

function sha256(content) {
  return crypto.createHash('sha256').update(content, 'utf8').digest('hex')
}

/**
 * Parse a MySQL timestamp (`YYYY-MM-DD HH:MM:SS`, stored as UTC) into epoch ms.
 * Tolerates ISO strings and numbers too.
 */
function cloudTimeMs(value) {
  if (value === null || value === undefined || value === '') return 0
  if (typeof value === 'number') return value
  const s = String(value).trim().replace(' ', 'T')
  const iso = /(Z|[+-]\d{2}:?\d{2})$/i.test(s) ? s : `${s}Z`
  const ms = Date.parse(iso)
  return Number.isFinite(ms) ? ms : 0
}

/**
 * Does the local copy win the divergence? Cloud timestamps are whole-second
 * (MySQL TIMESTAMP, truncated DOWN), while local mtimes are
 * millisecond-precise. Compare whole seconds so a local edit that landed in
 * the same second as the cloud's recorded write gets the benefit of the
 * doubt (the cloud timestamp may have been truncated from up to ~1s later),
 * but a local file that is genuinely a second or more older never beats a
 * newer cloud write. Either way the result is stable: once resolved, both
 * sides agree on the hash.
 */
function localWins(localMs, remoteMs) {
  return Math.floor(localMs / 1000) >= Math.floor(remoteMs / 1000)
}

class SyncEngine {
  constructor({ workspaceId, root, apiBase, getToken, storageDir, onStatus, trash }) {
    this.workspaceId = workspaceId
    this.root = root
    this.apiBase = apiBase
    this.getToken = getToken
    this.onStatus = onStatus
    this.trash = trash
    // Manifest is keyed by both workspace AND root folder hash, so binding a
    // different folder to the same workspace starts fresh instead of treating
    // the previous folder's files as locally deleted.
    const rootKey = sha256(path.resolve(root)).slice(0, 10)
    this.manifestPath = path.join(storageDir, `manifest-${workspaceId}-${rootKey}.json`)
    this.lastManifest = this.loadManifest()
    this.running = false
    this.pollTimer = null
    this.watcher = null
    this.watchDebounce = null
    this.lastSync = null
  }

  // ---- lifecycle -----------------------------------------------------

  start() {
    if (this.running) return
    this.running = true
    this.pollTimer = setInterval(() => {
      if (this.running) this.syncNow().catch(() => {})
    }, 20000)
    try {
      this.watcher = fs.watch(this.root, { recursive: true }, () => {
        if (!this.running) return
        clearTimeout(this.watchDebounce)
        this.watchDebounce = setTimeout(() => {
          this.syncNow().catch(() => {})
        }, 1200)
      })
    } catch {
      // recursive watch unsupported → the 20s poll covers changes
    }
    this.emit({ state: 'idle', message: 'Watching folder…', lastSync: this.lastSync, counts: null })
    this.syncNow().catch(() => {})
  }

  stop() {
    this.running = false
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.watcher) {
      try {
        this.watcher.close()
      } catch {}
    }
    if (this.watchDebounce) clearTimeout(this.watchDebounce)
    this.watcher = null
    this.pollTimer = null
  }

  emit(status) {
    try {
      this.onStatus(status)
    } catch {}
  }

  // ---- persistence ---------------------------------------------------

  loadManifest() {
    try {
      return JSON.parse(fs.readFileSync(this.manifestPath, 'utf8'))
    } catch {
      // Migrate the legacy per-workspace manifest (pre multi-folder) so a
      // rebind/upgrade doesn't re-treat every differing file as a divergence.
      const legacy = path.join(path.dirname(this.manifestPath), `manifest-${this.workspaceId}.json`)
      try {
        const data = JSON.parse(fs.readFileSync(legacy, 'utf8'))
        if (data && typeof data === 'object') return data
      } catch {}
      return {}
    }
  }

  saveManifest() {
    try {
      fs.writeFileSync(this.manifestPath, JSON.stringify(this.lastManifest, null, 2))
    } catch {}
  }

  // ---- api -----------------------------------------------------------

  async api(method, apiPath, body) {
    const token = this.getToken()
    const headers = { 'Content-Type': 'application/json' }
    if (token) headers['Authorization'] = `Bearer ${token}`
    const res = await fetch(`${this.apiBase}${apiPath}`, {
      method,
      headers,
      body: body !== undefined ? JSON.stringify(body) : undefined
    })
    const data = await res.json().catch(() => ({}))
    if (!res.ok) throw new Error(data.message || `API error ${res.status}`)
    return data
  }

  // ---- local fs ------------------------------------------------------

  resolve(relativePath) {
    return resolveInRoot(this.root, relativePath)
  }

  async readLocal(relativePath) {
    try {
      return await fsp.readFile(this.resolve(relativePath), 'utf8')
    } catch {
      return null
    }
  }

  async statMtime(relativePath) {
    try {
      const st = await fsp.stat(this.resolve(relativePath))
      return st.mtimeMs
    } catch {
      return 0
    }
  }

  async writeLocal(relativePath, content, mtimeMs) {
    const abs = this.resolve(relativePath)
    await fsp.mkdir(path.dirname(abs), { recursive: true })
    await fsp.writeFile(abs, content, 'utf8')
    // Stamp the file's modification time so the local date mirrors the
    // cloud's updated_at (and LWW comparisons stay exact on later syncs).
    if (typeof mtimeMs === 'number' && mtimeMs > 0) {
      const t = new Date(mtimeMs)
      await fsp.utimes(abs, t, t).catch(() => {})
    }
  }

  async walkLocal() {
    const files = {}
    let skipped = 0
    const stack = ['']
    while (stack.length > 0) {
      const rel = stack.pop()
      const abs = rel === '' ? this.root : this.resolve(rel)
      let entries
      try {
        entries = await fsp.readdir(abs, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue
          stack.push(childRel)
        } else if (entry.isFile()) {
          if (MARKDOWN_EXT.test(entry.name)) {
            try {
              const absPath = this.resolve(childRel)
              const content = await fsp.readFile(absPath, 'utf8')
              const stat = await fsp.stat(absPath)
              files[childRel] = { hash: sha256(content), content, mtimeMs: stat.mtimeMs }
            } catch {
              // skip unreadable files
            }
          } else {
            skipped++
          }
        }
      }
    }
    return { files, skipped }
  }

  // ---- legacy conflicted-copy cleanup ---------------------------------

  /**
   * Older engine versions saved losing local versions as
   * `<name>.conflicted-<timestamp>.<ext>` (and synced them to the cloud as
   * separate docs). Resolve them in place by modification time:
   *   - main file exists  → keep whichever copy is newer, delete the other
   *   - main file missing → rename the conflicted copy back to the main name
   * Returns how many conflicted files were cleaned up.
   */
  async resolveConflictedFiles() {
    const found = []
    const stack = ['']
    while (stack.length > 0) {
      const rel = stack.pop()
      const abs = rel === '' ? this.root : this.resolve(rel)
      let entries
      try {
        entries = await fsp.readdir(abs, { withFileTypes: true })
      } catch {
        continue
      }
      for (const entry of entries) {
        const childRel = rel ? `${rel}/${entry.name}` : entry.name
        if (entry.isDirectory()) {
          if (IGNORED_DIRS.has(entry.name)) continue
          stack.push(childRel)
        } else if (entry.isFile() && CONFLICTED_FILE_RE.test(entry.name)) {
          const m = CONFLICTED_FILE_RE.exec(entry.name)
          found.push({ conflicted: childRel, main: `${rel ? rel + '/' : ''}${m[1]}${m[2]}` })
        }
      }
    }

    if (found.length === 0) return 0

    // Only reach for the cloud when a main file is missing locally (a rare,
    // one-time legacy case) so the common cleanup path stays network-free.
    let cloudMain = null
    const orphans = found.filter((f) => !fs.existsSync(this.resolve(f.main)))
    if (orphans.length > 0) {
      try {
        const { entries } = await this.api('GET', `/api/sync/manifest?workspace_id=${this.workspaceId}`)
        cloudMain = new Map(entries.map((e) => [e.relative_path, e]))
      } catch {
        cloudMain = new Map()
      }
    }

    let cleaned = 0
    for (const { conflicted, main } of found) {
      const mainAbs = this.resolve(main)
      const confAbs = this.resolve(conflicted)
      try {
        if (fs.existsSync(mainAbs)) {
          const [mainMs, confMs] = await Promise.all([
            fsp.stat(mainAbs).then((s) => s.mtimeMs).catch(() => 0),
            fsp.stat(confAbs).then((s) => s.mtimeMs).catch(() => 0)
          ])
          if (confMs > mainMs) {
            const content = await fsp.readFile(confAbs, 'utf8')
            await this.writeLocal(main, content, confMs)
          }
          // Both copies are gone after this; the sync engine no longer
          // creates .conflicted files, so this is a one-time cleanup.
          await fsp.unlink(confAbs).catch(() => {})
        } else {
          // Main is missing locally. Decide by mtime against the cloud so a
          // stale orphan can't clobber a newer live remote main on the next
          // push: cloud main newer → drop the orphan; otherwise revive it.
          const remote = cloudMain && cloudMain.get(main)
          if (remote && !remote.is_deleted && cloudTimeMs(remote.updated_at) > 0) {
            const confMs = await fsp.stat(confAbs).then((s) => s.mtimeMs).catch(() => 0)
            if (!localWins(confMs, cloudTimeMs(remote.updated_at))) {
              await fsp.unlink(confAbs).catch(() => {})
              cleaned++
              continue
            }
          }
          await fsp.mkdir(path.dirname(mainAbs), { recursive: true })
          await fsp.rename(confAbs, mainAbs)
        }
        cleaned++
      } catch {
        // leave it alone — the next sync will retry
      }
    }
    return cleaned
  }

  // ---- sync operations ----------------------------------------------

  async pull() {
    const { entries } = await this.api(
      'GET',
      `/api/sync/manifest?workspace_id=${this.workspaceId}`
    )
    let pulled = 0
    let pushed = 0
    let conflicts = 0

    for (const entry of entries) {
      const rel = entry.relative_path
      const last = this.lastManifest[rel]

      if (entry.is_deleted) {
        const local = await this.readLocal(rel)
        if (local !== null) {
          const abs = this.resolve(rel)
          if (this.trash) {
            await this.trash(abs).catch(() => fsp.unlink(abs).catch(() => {}))
          } else {
            await fsp.unlink(abs).catch(() => {})
          }
          pulled++
        }
        this.lastManifest[rel] = { hash: entry.content_hash, revision: entry.revision, deleted: true }
        continue
      }

      const remoteChanged = !last || last.deleted || last.hash !== entry.content_hash
      if (!remoteChanged) continue

      const local = await this.readLocal(rel)
      const localHash = local !== null ? sha256(local) : null
      if (localHash !== null && localHash !== entry.content_hash) {
        // Both sides differ. Treat it as a divergence when this side moved too:
        // - never seen this path before (fresh engine + pre-existing local file)
        // - local changed since last sync AND remote revision moved
        const localMoved = last ? !last.deleted && last.hash !== localHash : true
        const remoteMoved = last ? last.revision !== entry.revision : true
        if (localMoved && remoteMoved) {
          // Last-write-wins by modification time — no conflicted copy.
          conflicts++
          const localMs = await this.statMtime(rel)
          const remoteMs = cloudTimeMs(entry.updated_at)
          if (localWins(localMs, remoteMs)) {
            // Local copy is newer → push it up and keep it. The mtime goes
            // along so the cloud date inherits the real file date.
            const { results } = await this.api('POST', '/api/sync/push', {
              workspace_id: this.workspaceId,
              files: [{
                relative_path: rel,
                content: local,
                hash: localHash,
                mtime: new Date(localMs).toISOString()
              }]
            })
            const res = results && results[0]
            if (res && res.status === 'ok') {
              this.lastManifest[rel] = { hash: localHash, revision: res.revision, deleted: false }
              pushed++
              continue
            }
            // Push rejected (e.g. server hiccup) → keep the local copy
            // untouched; the next sync retries. Never overwrite local data.
            continue
          }
          // Remote copy is newer → fall through and take the remote.
        }
      }

      const { file } = await this.api(
        'GET',
        `/api/sync/file?workspace_id=${this.workspaceId}&relative_path=${encodeURIComponent(rel)}`
      )
      // Inherit the cloud date locally so the file's mtime mirrors the doc's
      // real last-modified time instead of the pull moment.
      await this.writeLocal(rel, file.content, cloudTimeMs(entry.updated_at))
      this.lastManifest[rel] = { hash: entry.content_hash, revision: entry.revision, deleted: false }
      pulled++
    }

    this.saveManifest()
    return { pulled, pushed, conflicts }
  }

  async push() {
    const { entries: remoteEntries } = await this.api(
      'GET',
      `/api/sync/manifest?workspace_id=${this.workspaceId}`
    )
    const remote = {}
    for (const e of remoteEntries) remote[e.relative_path] = e

    const { files: localFiles, skipped } = await this.walkLocal()
    const toPush = []
    let pushed = 0
    let conflicts = 0

    // Local deletions → tell the cloud (soft delete + revision bump).
    for (const rel of Object.keys(this.lastManifest)) {
      const last = this.lastManifest[rel]
      if (last.deleted) continue
      if (localFiles[rel]) continue
      const rem = remote[rel]
      if (rem && !rem.is_deleted) {
        await this.api('POST', '/api/sync/remove', {
          workspace_id: this.workspaceId,
          relative_path: rel
        })
        this.lastManifest[rel] = { hash: rem.content_hash, revision: rem.revision, deleted: true }
        pushed++
      } else if (!rem) {
        delete this.lastManifest[rel]
      }
    }

    // New/changed local files → upload (unless a divergence or remote delete).
    for (const [rel, file] of Object.entries(localFiles)) {
      const last = this.lastManifest[rel]
      const rem = remote[rel]

      if (rem && rem.is_deleted) continue // pull() will clean the local copy

      if (last && !last.deleted && last.hash === file.hash) {
        // Content is unchanged. Normally a no-op — but if the cloud's
        // updated_at is a sync stamp newer than the file's real date, re-push
        // with the local mtime so the date is inherited from the filesystem.
        // Self-limiting: after the repair the cloud date equals the mtime.
        const remoteMs = rem ? cloudTimeMs(rem.updated_at) : 0
        // Repair only when content genuinely matches the cloud — never over a
        // different remote version (pull() resolves those first anyway, but
        // this makes the guard airtight against future reordering).
        if (
          !rem ||
          remoteMs <= 0 ||
          rem.content_hash !== file.hash ||
          Math.floor(remoteMs / 1000) <= Math.floor(file.mtimeMs / 1000)
        ) {
          continue
        }
        // else fall through → repair push (content identical, date corrected)
      } else if (last && !last.deleted && rem && rem.revision !== last.revision && rem.content_hash !== file.hash) {
        // Diverged: remote moved ahead while we also changed.
        // Last-write-wins by modification time — no conflicted copy.
        conflicts++
        const localMs = file.mtimeMs
        const remoteMs = cloudTimeMs(rem.updated_at)
        if (!localWins(localMs, remoteMs)) {
          // Remote copy is newer → pull it down over the local copy.
          const { file: remoteFile } = await this.api(
            'GET',
            `/api/sync/file?workspace_id=${this.workspaceId}&relative_path=${encodeURIComponent(rel)}`
          )
          if (remoteFile && typeof remoteFile.content === 'string') {
            await this.writeLocal(rel, remoteFile.content, cloudTimeMs(rem.updated_at))
            this.lastManifest[rel] = { hash: rem.content_hash, revision: rem.revision, deleted: false }
            continue
          }
          // Download failed → fall through and push local (no data loss).
        }
        // Local copy is newer → fall through and upload it.
      }

      toPush.push({
        relative_path: rel,
        content: file.content,
        hash: file.hash,
        mtime: new Date(file.mtimeMs).toISOString()
      })
    }

    if (toPush.length > 0) {
      const { results } = await this.api('POST', '/api/sync/push', {
        workspace_id: this.workspaceId,
        files: toPush
      })
      const byPath = new Map(toPush.map((f) => [f.relative_path, f.hash]))
      for (const result of results) {
        if (result.status === 'ok') {
          this.lastManifest[result.relative_path] = {
            hash: byPath.get(result.relative_path) ?? '',
            revision: result.revision ?? 1,
            deleted: false
          }
          pushed++
        }
      }
    }

    this.saveManifest()
    return { pushed, conflicts, skipped }
  }

  async syncNow() {
    this.emit({ state: 'syncing', message: 'Syncing…', lastSync: this.lastSync, counts: null })
    try {
      const cleaned = await this.resolveConflictedFiles()
      const pullResult = await this.pull()
      const pushResult = await this.push()
      const pulled = pullResult.pulled
      const pushed = pullResult.pushed + pushResult.pushed
      const conflicts = pullResult.conflicts + pushResult.conflicts
      const skipped = pushResult.skipped ?? 0
      this.lastSync = new Date().toISOString()
      const parts = [`${pushed} up`, `${pulled} down`]
      if (conflicts > 0) parts.push(`${conflicts} resolved (latest wins)`)
      if (cleaned > 0) parts.push(`${cleaned} conflicted copies cleaned`)
      if (skipped > 0) parts.push(`${skipped} skipped (non-markdown)`)
      this.emit({
        state: 'idle',
        message: `Synced — ${parts.join(' · ')}`,
        lastSync: this.lastSync,
        counts: { pulled, pushed, conflicts, skipped, cleaned }
      })
      return { pulled, pushed, conflicts, skipped, cleaned }
    } catch (err) {
      this.emit({
        state: 'error',
        message: err.message || 'Sync failed',
        lastSync: this.lastSync,
        counts: null
      })
      return { pulled: 0, pushed: 0, conflicts: 0, skipped: 0, cleaned: 0, error: err.message }
    }
  }
}

module.exports = { SyncEngine, sha256, cloudTimeMs, localWins }

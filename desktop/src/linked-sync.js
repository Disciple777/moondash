// Linked-file sync engine.
//
// Docs linked into multi-spaces from the user's computer ("linked in place")
// have an absolute path (doc_files.local_path) and no synced folder root. This
// engine mirrors each of those files two-way with the cloud:
//
//   pull()  remote changed → write the file at its absolute path
//   push()  local changed  → upload with the file's mtime (LWW by date)
//
// The same last-write-wins-by-modification-time policy as the folder engine
// applies, and the manifest (keyed by local_path) tracks what has already been
// seen so unchanged files are never rewritten.
const fs = require('fs')
const fsp = fs.promises
const path = require('path')
const { sha256, cloudTimeMs, localWins } = require('./sync')

const TEXT_EXT = /\.(md|markdown|txt)$/i

class LinkedFileEngine {
  constructor({ apiBase, getToken, storageDir, onStatus }) {
    this.apiBase = apiBase
    this.getToken = getToken
    this.onStatus = onStatus
    this.manifestPath = path.join(storageDir, 'linked-manifest.json')
    this.lastManifest = this.loadManifest()
    this.running = false
    this.pollTimer = null
    this.lastSync = null
    this.lastError = null
  }

  // ---- lifecycle -----------------------------------------------------

  start() {
    if (this.running) return
    this.running = true
    this.pollTimer = setInterval(() => {
      if (this.running) this.syncNow().catch(() => {})
    }, 20000)
    this.syncNow().catch(() => {})
  }

  stop() {
    this.running = false
    if (this.pollTimer) clearInterval(this.pollTimer)
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

  async statMtime(absPath) {
    try {
      const st = await fsp.stat(absPath)
      return st.mtimeMs
    } catch {
      return 0
    }
  }

  async readLocal(absPath) {
    try {
      return await fsp.readFile(absPath, 'utf8')
    } catch {
      return null
    }
  }

  async writeLocal(absPath, content, mtimeMs) {
    await fsp.mkdir(path.dirname(absPath), { recursive: true })
    await fsp.writeFile(absPath, content, 'utf8')
    // Stamp the file's modification time so the local date mirrors the
    // cloud's updated_at (and LWW comparisons stay exact on later syncs).
    if (typeof mtimeMs === 'number' && mtimeMs > 0) {
      const t = new Date(mtimeMs)
      await fsp.utimes(absPath, t, t).catch(() => {})
    }
  }

  // ---- sync ----------------------------------------------------------

  async syncNow() {
    if (!this.getToken()) {
      this.emit({ state: 'idle', message: 'Waiting for sign-in…', lastSync: this.lastSync, counts: null, linked: true })
      return { pulled: 0, pushed: 0, conflicts: 0, missing: 0, error: null }
    }

    this.emit({ state: 'syncing', message: 'Syncing linked files…', lastSync: this.lastSync, counts: null, linked: true })
    try {
      const { workspace_id: workspaceId, entries } = await this.api('GET', '/api/sync/external')
      const result = await this.syncEntries(workspaceId, entries)
      this.lastSync = new Date().toISOString()
      const parts = [`${result.pushed} up`, `${result.pulled} down`]
      if (result.conflicts > 0) parts.push(`${result.conflicts} resolved (latest wins)`)
      if (result.missing > 0) parts.push(`${result.missing} missing locally`)
      this.emit({
        state: 'idle',
        message: `Linked files synced — ${parts.join(' · ')}`,
        lastSync: this.lastSync,
        counts: {
          pulled: result.pulled,
          pushed: result.pushed,
          conflicts: result.conflicts,
          skipped: result.missing,
          cleaned: 0
        },
        linked: true
      })
      return result
    } catch (err) {
      this.emit({
        state: 'error',
        message: err.message || 'Linked-files sync failed',
        lastSync: this.lastSync,
        counts: null,
        linked: true
      })
      return { pulled: 0, pushed: 0, conflicts: 0, missing: 0, error: err.message }
    }
  }

  async syncEntries(workspaceId, entries) {
    const result = { pulled: 0, pushed: 0, conflicts: 0, missing: 0 }
    for (const entry of entries) {
      const absPath = String(entry.local_path || '')
      if (!absPath) continue

      if (entry.is_deleted) {
        this.lastManifest[absPath] = { hash: entry.content_hash, revision: entry.revision, deleted: true }
        continue
      }

      const last = this.lastManifest[absPath]
      const remoteChanged = !last || last.deleted || last.hash !== entry.content_hash
      const localMs = await this.statMtime(absPath)
      if (localMs <= 0) {
        // File missing on disk — leave the cloud copy untouched; the link
        // stays valid and the file reappears if the user restores it.
        result.missing++
        continue
      }
      const local = await this.readLocal(absPath)
      if (local === null) {
        result.missing++
        continue
      }
      const localHash = sha256(local)
      const localChanged = last ? last.deleted || last.hash !== localHash : true
      const remoteMs = cloudTimeMs(entry.updated_at)

      if (remoteChanged && localChanged) {
        // Both sides moved → last-write-wins by modification time.
        result.conflicts++
        if (localWins(localMs, remoteMs)) {
          await this.pushFile(workspaceId, entry.relative_path, local, localMs)
          this.lastManifest[absPath] = { hash: localHash, revision: entry.revision, deleted: false }
          result.pushed++
        } else {
          await this.pullFile(workspaceId, entry.relative_path, absPath, remoteMs)
          this.lastManifest[absPath] = { hash: entry.content_hash, revision: entry.revision, deleted: false }
          result.pulled++
        }
        continue
      }

      if (remoteChanged) {
        await this.pullFile(workspaceId, entry.relative_path, absPath, remoteMs)
        this.lastManifest[absPath] = { hash: entry.content_hash, revision: entry.revision, deleted: false }
        result.pulled++
        continue
      }

      if (localChanged) {
        await this.pushFile(workspaceId, entry.relative_path, local, localMs)
        this.lastManifest[absPath] = { hash: localHash, revision: entry.revision, deleted: false }
        result.pushed++
        continue
      }

      // Content matches on both sides. Repair the cloud date when it is a
      // sync stamp newer than the file's real date (same self-healing as the
      // folder engine) so dates are inherited from the filesystem.
      if (remoteMs > 0 && entry.content_hash === localHash && Math.floor(remoteMs / 1000) > Math.floor(localMs / 1000)) {
        await this.pushFile(workspaceId, entry.relative_path, local, localMs)
        this.lastManifest[absPath] = { hash: localHash, revision: entry.revision, deleted: false }
        result.pushed++
      }
    }
    this.saveManifest()
    return result
  }

  async pushFile(workspaceId, relativePath, content, mtimeMs) {
    const { results } = await this.api('POST', '/api/sync/push', {
      workspace_id: workspaceId,
      files: [{
        relative_path: relativePath,
        content,
        hash: sha256(content),
        mtime: new Date(mtimeMs).toISOString()
      }]
    })
    const res = results && results[0]
    if (!res || res.status !== 'ok') {
      throw new Error((res && res.message) || 'Linked-file push failed')
    }
  }

  async pullFile(workspaceId, relativePath, absPath, remoteMs) {
    const { file } = await this.api(
      'GET',
      `/api/sync/file?workspace_id=${workspaceId}&relative_path=${encodeURIComponent(relativePath)}`
    )
    if (!file || typeof file.content !== 'string') {
      throw new Error('Linked-file download failed')
    }
    await this.writeLocal(absPath, file.content, remoteMs)
  }
}

module.exports = { LinkedFileEngine, TEXT_EXT }

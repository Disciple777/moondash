// Electron main process: window creation, scoped file IPC, the sync engine
// (one folder per workspace, many workspaces at once), Windows file
// association for .md/.markdown and "open with Moondash" handling.
const { app, BrowserWindow, ipcMain, dialog, shell } = require('electron')
const path = require('path')
const fs = require('fs')
const fsp = fs.promises
const { execFile } = require('child_process')
const { SyncEngine } = require('./src/sync')
const { LinkedFileEngine, TEXT_EXT } = require('./src/linked-sync')
const { resolveInRoot } = require('./src/paths')

const isDev = process.argv.includes('--dev') || Boolean(process.env.MOONDASH_DEV_URL)
const isWin = process.platform === 'win32'

let mainWindow = null
let engines = new Map() // binding.key -> SyncEngine
let linkedEngine = null // mirrors docs linked in place by absolute path
let token = null
let pendingOpenFiles = [] // file paths queued until the window finishes loading

// --------------------------------------------------------------------- //
// Settings (multi-binding)
// --------------------------------------------------------------------- //

const settingsFile = () => path.join(app.getPath('userData'), 'settings.json')

function loadSettings() {
  try {
    return JSON.parse(fs.readFileSync(settingsFile(), 'utf8'))
  } catch {
    return {}
  }
}

function saveSettings(settings) {
  try {
    fs.writeFileSync(settingsFile(), JSON.stringify(settings, null, 2))
  } catch {}
}

function defaultApiBase() {
  return process.env.MOONDASH_API_URL || 'http://localhost:8000'
}

function loadBindings() {
  const settings = loadSettings()
  let bindings = Array.isArray(settings.bindings) ? settings.bindings : []

  // Migrate the legacy single-binding shape.
  if (settings.binding) {
    const b = settings.binding
    if (b && b.root && !bindings.some((x) => x.workspaceId === b.workspaceId)) {
      bindings.push({
        key: String(Number(b.workspaceId)),
        workspaceId: Number(b.workspaceId),
        name: String(b.name || 'Workspace'),
        root: b.root
      })
    }
    delete settings.binding
    settings.bindings = bindings
    saveSettings(settings)
  }

  return bindings.filter((b) => b && b.root && b.workspaceId)
}

function saveBindings(bindings) {
  const settings = loadSettings()
  settings.bindings = bindings
  saveSettings(settings)
}

function bindingForWorkspace(workspaceId) {
  const id = Number(workspaceId)
  return loadBindings().find((b) => b.workspaceId === id) || null
}

function requireBinding(workspaceId) {
  const binding = bindingForWorkspace(workspaceId)
  if (!binding) throw new Error('No folder is bound to this workspace')
  return binding
}

// --------------------------------------------------------------------- //
// Sync engines
// --------------------------------------------------------------------- //

function statusToRenderer(binding) {
  return (status) => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('sync:status', {
        ...status,
        binding: {
          key: binding.key,
          workspaceId: binding.workspaceId,
          name: binding.name,
          root: binding.root
        }
      })
    }
  }
}

async function startEngines() {
  stopEngines()
  const apiBase = loadSettings().apiBase || defaultApiBase()
  const all = loadBindings()
  const valid = []
  for (const binding of all) {
    const stat = await fsp.stat(binding.root).catch(() => null)
    if (!stat || !stat.isDirectory()) {
      // Drop dead bindings so they don't pile up.
      continue
    }
    valid.push(binding)
    const engine = new SyncEngine({
      workspaceId: binding.workspaceId,
      root: binding.root,
      apiBase,
      getToken: () => token,
      storageDir: app.getPath('userData'),
      onStatus: statusToRenderer(binding),
      trash: (p) => shell.trashItem(p)
    })
    engines.set(binding.key, engine)
    engine.start()
  }
  if (valid.length !== all.length) saveBindings(valid)

  // The linked-file engine needs no binding — it mirrors docs linked in place
  // by absolute path. It no-ops until a token is set (sign-in).
  linkedEngine = new LinkedFileEngine({
    apiBase,
    getToken: () => token,
    storageDir: app.getPath('userData'),
    onStatus: (status) => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        mainWindow.webContents.send('sync:status', status)
      }
    }
  })
  linkedEngine.start()
}

function stopEngines() {
  for (const engine of engines.values()) engine.stop()
  engines.clear()
  if (linkedEngine) {
    linkedEngine.stop()
    linkedEngine = null
  }
}

// --------------------------------------------------------------------- //
// Windows file association (.md / .markdown → Moondash)
// --------------------------------------------------------------------- //

const ASSOC_EXTENSIONS = ['.md', '.markdown']
const ASSOC_PROG_ID = 'Moondash.Markdown'

function assocCommand() {
  // In dev the executable is electron.exe, which needs the app dir as the
  // first argument; packaged builds just take the file path.
  return app.isPackaged
    ? `"${process.execPath}" "%1"`
    : `"${process.execPath}" "${app.getAppPath()}" "%1"`
}

function runReg(args) {
  return new Promise((resolve) => {
    execFile('reg', args, { windowsHide: true }, (err) => resolve(!err))
  })
}

function fileAssocInstalled() {
  if (!isWin) return Promise.resolve(false)
  return new Promise((resolve) => {
    execFile(
      'reg',
      ['query', `HKCU\\Software\\Classes\\${ASSOC_PROG_ID}`, '/ve'],
      { windowsHide: true },
      (err) => resolve(!err)
    )
  })
}

function fileAssocPreference() {
  return loadSettings().fileAssoc !== false
}

async function installFileAssociations() {
  if (!isWin) return { ok: false, reason: 'Windows only' }
  const settings = loadSettings()
  settings.fileAssoc = true
  saveSettings(settings)
  const keys = [
    { key: `HKCU\\Software\\Classes\\${ASSOC_PROG_ID}`, value: 'Moondash Markdown' },
    { key: `HKCU\\Software\\Classes\\${ASSOC_PROG_ID}\\DefaultIcon`, value: `"${process.execPath}",0` },
    { key: `HKCU\\Software\\Classes\\${ASSOC_PROG_ID}\\shell\\open\\command`, value: assocCommand() }
  ]
  for (const ext of ASSOC_EXTENSIONS) {
    keys.push({ key: `HKCU\\Software\\Classes\\${ext}`, value: ASSOC_PROG_ID })
  }
  let ok = true
  for (const k of keys) {
    ok = (await runReg(['add', k.key, '/ve', '/d', k.value, '/f'])) && ok
  }
  if (ok) refreshShellAssociations()
  return { ok }
}

async function uninstallFileAssociations() {
  if (!isWin) return { ok: false, reason: 'Windows only' }
  const settings = loadSettings()
  settings.fileAssoc = false
  saveSettings(settings)
  const keys = [
    ...ASSOC_EXTENSIONS.map((e) => `HKCU\\Software\\Classes\\${e}`),
    `HKCU\\Software\\Classes\\${ASSOC_PROG_ID}`
  ]
  for (const key of keys) await runReg(['delete', key, '/f'])
  refreshShellAssociations()
  return { ok: true }
}

function refreshShellAssociations() {
  // Tell Explorer to re-read the association cache (best effort).
  const ps =
    'Add-Type -Namespace Win32 -Name Native -MemberDefinition "[DllImport(\\"shell32.dll\\")] public static extern void SHChangeNotify(int wEventId, int uFlags, IntPtr dwItem1, IntPtr dwItem2);"; ' +
    '[Win32.Native]::SHChangeNotify(0x08000000, 0, [IntPtr]::Zero, [IntPtr]::Zero)'
  execFile('powershell', ['-NoProfile', '-NonInteractive', '-Command', ps], { windowsHide: true }, () => {})
}

// --------------------------------------------------------------------- //
// "Open with Moondash" — collect .md/.markdown paths from argv
// --------------------------------------------------------------------- //

function openableFilesFrom(argv) {
  return (argv || []).slice(1).filter((a) => {
    if (typeof a !== 'string' || a.startsWith('-')) return false
    if (!/\.(md|markdown)$/i.test(a)) return false
    try {
      return fs.statSync(a).isFile()
    } catch {
      return false
    }
  })
}

function sendOpenFiles(files) {
  if (!files || files.length === 0) return
  if (mainWindow && !mainWindow.isDestroyed() && !mainWindow.webContents.isLoading()) {
    mainWindow.webContents.send('app:open-files', files)
  } else {
    pendingOpenFiles = pendingOpenFiles.concat(files)
  }
}

/** Renderer calls this after mounting to flush any files queued before React was ready. */
ipcMain.handle('app:pullOpenFiles', () => {
  const files = pendingOpenFiles.splice(0)
  return files
})

// --------------------------------------------------------------------- //
// Window
// --------------------------------------------------------------------- //

function createWindow() {
  const apiBase = loadSettings().apiBase || defaultApiBase()

  mainWindow = new BrowserWindow({
    width: 1280,
    height: 840,
    minWidth: 720,
    minHeight: 480,
    title: 'Moondash',
    backgroundColor: '#191919',
    icon: path.join(__dirname, 'build', 'icon.png'),
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      additionalArguments: [`--moondash-api-base=${encodeURIComponent(apiBase)}`]
    }
  })

  mainWindow.setMenuBarVisibility(false)

  // NOTE: we do NOT drain pendingOpenFiles here. React mounts after
  // did-finish-load, so the listener isn't registered yet. Instead,
  // the renderer calls app:pullOpenFiles after mounting to flush the queue.

  if (isDev) {
    mainWindow.loadURL(process.env.MOONDASH_DEV_URL || 'http://localhost:5173')
  } else {
    // Packaged: _web-dist is inside the ASAR (copied there by package.mjs).
    // Dev fallback: ../web/dist is the normal Vite output.
    const indexHtml =
      path.join(__dirname, '_web-dist/index.html') ||
      path.join(__dirname, '../web/dist/index.html')
    // Try each candidate in order
    const candidates = [
      path.join(__dirname, '_web-dist/index.html'),
      path.join(__dirname, '../web/dist/index.html')
    ]
    let loaded = false
    for (const candidate of candidates) {
      if (fs.existsSync(candidate)) {
        mainWindow.loadFile(candidate)
        loaded = true
        break
      }
    }
    if (!loaded) {
      mainWindow.loadURL('data:text/html;charset=utf-8,' + encodeURIComponent(
        '<body style="font-family:sans-serif;background:#191919;color:#eee;display:grid;place-items:center;height:100vh">' +
        '<div>Web app not built yet — run <code>npm run build:web</code> then <code>npm run package</code> from the <code>desktop</code> folder.</div></body>'
      ))
    }
  }
}

// --------------------------------------------------------------------- //
// IPC
// --------------------------------------------------------------------- //

ipcMain.handle('fs:getApiBase', () => loadSettings().apiBase || defaultApiBase())

ipcMain.handle('fs:pickFolder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Choose a folder to sync',
    properties: ['openDirectory', 'createDirectory']
  })
  return result.canceled ? null : result.filePaths[0]
})

ipcMain.handle('fs:getBindings', async () => {
  const bindings = []
  for (const binding of loadBindings()) {
    const stat = await fsp.stat(binding.root).catch(() => null)
    if (!stat || !stat.isDirectory()) continue
    bindings.push({ ...binding })
  }
  return bindings
})

/** Which bound folder (if any) contains the given absolute file path. */
ipcMain.handle('fs:whichBinding', async (_event, absPath) => {
  const target = String(absPath || '').replace(/\\/g, '/')
  const norm = (s) => (isWin ? s.toLowerCase() : s)
  for (const binding of loadBindings()) {
    const root = norm(path.resolve(binding.root).replace(/\\/g, '/'))
    const prefix = root.endsWith('/') ? root : root + '/'
    if (target === root || norm(target).startsWith(prefix)) {
      const relativePath = target.slice(root.length).replace(/^\/+/, '')
      return { binding: { ...binding }, relativePath }
    }
  }
  return null
})

/** Read an external file's text (only markdown/plain-text extensions). */
ipcMain.handle('fs:readExternal', async (_event, absPath) => {
  try {
    const p = String(absPath || '')
    if (!TEXT_EXT.test(p)) return null
    const stat = await fsp.stat(p)
    if (!stat.isFile()) return null
    return await fsp.readFile(p, 'utf8')
  } catch {
    return null
  }
})

/** Write a linked-in-place file at its absolute path (text extensions only). */
ipcMain.handle('fs:writeExternal', async (_event, payload) => {
  const { absPath, content } = payload || {}
  const p = String(absPath || '')
  if (!TEXT_EXT.test(p) || typeof content !== 'string') return { ok: false }
  // Recreate a missing file so the link heals itself after the file is moved
  // or deleted outside the app — the next engine round syncs the cloud copy.
  await fsp.mkdir(path.dirname(p), { recursive: true })
  await fsp.writeFile(p, content, 'utf8')
  return { ok: true }
})

ipcMain.handle('sync:bind', async (_event, payload) => {
  const { workspaceId, name, folder } = payload || {}
  if (!workspaceId || !folder) return { ok: false }
  const stat = await fsp.stat(folder).catch(() => null)
  if (!stat || !stat.isDirectory()) return { ok: false }
  const id = Number(workspaceId)
  const bindings = loadBindings().filter((b) => b.workspaceId !== id)
  bindings.push({ key: String(id), workspaceId: id, name: String(name || 'Workspace'), root: folder })
  saveBindings(bindings)
  await startEngines()
  return { ok: true }
})

ipcMain.handle('sync:unbind', async (_event, key) => {
  const k = String(key || '')
  const engine = engines.get(k)
  if (engine) {
    engine.stop()
    engines.delete(k)
  }
  saveBindings(loadBindings().filter((b) => b.key !== k))
  return { ok: true }
})

ipcMain.handle('sync:setToken', (_event, value) => {
  token = typeof value === 'string' && value !== '' ? value : null
  if (token) {
    for (const engine of engines.values()) engine.syncNow().catch(() => {})
    if (linkedEngine) linkedEngine.syncNow().catch(() => {})
  }
  return { ok: true }
})

ipcMain.handle('sync:setApiBase', async (_event, payload) => {
  const settings = loadSettings()
  const clean = String((payload && payload.url) || '').replace(/\/+$/, '')
  const silent = Boolean(payload && payload.silent)
  const changed = clean !== (settings.apiBase || '')
  settings.apiBase = clean
  saveSettings(settings)
  await startEngines()
  if (!silent && changed && mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents.reload()
  }
  return { ok: true }
})

ipcMain.handle('sync:now', async (_event, key) => {
  const target = key ? engines.get(String(key)) : null
  if (target) return target.syncNow()
  if (engines.size === 0 && !linkedEngine) return { pulled: 0, pushed: 0, conflicts: 0, cleaned: 0, error: 'No folder is bound' }
  const results = []
  for (const engine of engines.values()) results.push(await engine.syncNow())
  if (linkedEngine) results.push(await linkedEngine.syncNow())
  return results.reduce(
    (acc, r) => ({
      pulled: acc.pulled + (r.pulled || 0),
      pushed: acc.pushed + (r.pushed || 0),
      conflicts: acc.conflicts + (r.conflicts || 0),
      cleaned: (acc.cleaned || 0) + (r.cleaned || 0),
      skipped: (acc.skipped || 0) + (r.skipped || 0),
      error: acc.error || r.error
    }),
    { pulled: 0, pushed: 0, conflicts: 0, cleaned: 0, skipped: 0 }
  )
})

ipcMain.handle('fs:read', async (_event, payload) => {
  const { workspaceId, relativePath } = payload || {}
  try {
    const binding = requireBinding(workspaceId)
    return await fsp.readFile(resolveInRoot(binding.root, relativePath), 'utf8')
  } catch {
    return null
  }
})

ipcMain.handle('fs:write', async (_event, payload) => {
  const { workspaceId, relativePath, content } = payload || {}
  const binding = requireBinding(workspaceId)
  const abs = resolveInRoot(binding.root, relativePath)
  await fsp.mkdir(path.dirname(abs), { recursive: true })
  await fsp.writeFile(abs, content, 'utf8')
  return { ok: true }
})

ipcMain.handle('fs:rename', async (_event, payload) => {
  const { workspaceId, from, to } = payload || {}
  const binding = requireBinding(workspaceId)
  const fromAbs = resolveInRoot(binding.root, from)
  const toAbs = resolveInRoot(binding.root, to)
  await fsp.mkdir(path.dirname(toAbs), { recursive: true })
  await fsp.rename(fromAbs, toAbs)
  return { ok: true }
})

ipcMain.handle('fs:delete', async (_event, payload) => {
  const { workspaceId, relativePath } = payload || {}
  const binding = requireBinding(workspaceId)
  const abs = resolveInRoot(binding.root, relativePath)
  await shell.trashItem(abs)
  return { ok: true }
})

ipcMain.handle('fs:exists', async (_event, payload) => {
  try {
    const { workspaceId, relativePath } = payload || {}
    const binding = requireBinding(workspaceId)
    await fsp.access(resolveInRoot(binding.root, relativePath))
    return true
  } catch {
    return false
  }
})

ipcMain.handle('fileassoc:status', () => fileAssocInstalled())
ipcMain.handle('fileassoc:install', () => installFileAssociations())
ipcMain.handle('fileassoc:uninstall', () => uninstallFileAssociations())

// --------------------------------------------------------------------- //
// App lifecycle — single instance so double-clicked files reach the window
// --------------------------------------------------------------------- //

const gotLock = app.requestSingleInstanceLock()

if (!gotLock) {
  app.quit()
} else {
  app.on('second-instance', (_event, argv) => {
    const files = openableFilesFrom(argv)
    if (files.length > 0) sendOpenFiles(files)
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore()
      mainWindow.focus()
    }
  })

  app.whenReady().then(async () => {
    createWindow()
    await startEngines()

    // Best-effort, idempotent: keep the .md/.markdown association registered
    // unless the user explicitly turned it off.
    if (isWin && fileAssocPreference()) installFileAssociations().catch(() => {})

    const startupFiles = openableFilesFrom(process.argv)
    if (startupFiles.length > 0) pendingOpenFiles = pendingOpenFiles.concat(startupFiles)

    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) createWindow()
    })
  })
}

app.on('window-all-closed', () => {
  stopEngines()
  if (process.platform !== 'darwin') app.quit()
})

app.on('before-quit', () => {
  stopEngines()
})

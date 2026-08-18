// Preload bridge: exposes the desktop API to the renderer as window.moondash.
const { contextBridge, ipcRenderer, webUtils } = require('electron')

// Absolute path of a picked/dropped file. webUtils.getPathForFile is the
// supported API (Electron ≥ 29); older builds fall back to the legacy
// File.path property.
function pathForFile(file) {
  if (!file) return ''
  try {
    if (webUtils && typeof webUtils.getPathForFile === 'function') {
      return webUtils.getPathForFile(file)
    }
  } catch {}
  return typeof file.path === 'string' ? file.path : ''
}

function readApiBase() {
  const arg = process.argv.find((a) => a.startsWith('--moondash-api-base='))
  if (!arg) return ''
  try {
    return decodeURIComponent(arg.slice('--moondash-api-base='.length))
  } catch {
    return ''
  }
}

contextBridge.exposeInMainWorld('moondash', {
  isDesktop: true,
  apiBase: readApiBase(),
  getApiBase: () => ipcRenderer.invoke('fs:getApiBase'),
  pickFolder: () => ipcRenderer.invoke('fs:pickFolder'),
  getBindings: () => ipcRenderer.invoke('fs:getBindings'),
  bind: (workspaceId, name, folder) => ipcRenderer.invoke('sync:bind', { workspaceId, name, folder }),
  unbind: (key) => ipcRenderer.invoke('sync:unbind', key),
  setToken: (value) => ipcRenderer.invoke('sync:setToken', value),
  setApiBase: (url, opts) => ipcRenderer.invoke('sync:setApiBase', { url, silent: opts?.silent }),
  syncNow: (key) => ipcRenderer.invoke('sync:now', key),
  onStatus: (cb) => {
    const listener = (_event, status) => cb(status)
    ipcRenderer.on('sync:status', listener)
    return () => ipcRenderer.removeListener('sync:status', listener)
  },
  whichBinding: (absPath) => ipcRenderer.invoke('fs:whichBinding', absPath),
  pathForFile: (file) => pathForFile(file),
  readExternalFile: (absPath) => ipcRenderer.invoke('fs:readExternal', absPath),
  writeExternal: (absPath, content) => ipcRenderer.invoke('fs:writeExternal', { absPath, content }),
  onOpenFiles: (cb) => {
    const listener = (_event, files) => cb(files)
    ipcRenderer.on('app:open-files', listener)
    return () => ipcRenderer.removeListener('app:open-files', listener)
  },
  fileAssocStatus: () => ipcRenderer.invoke('fileassoc:status'),
  fileAssocInstall: () => ipcRenderer.invoke('fileassoc:install'),
  fileAssocUninstall: () => ipcRenderer.invoke('fileassoc:uninstall'),
  readLocal: (workspaceId, relativePath) => ipcRenderer.invoke('fs:read', { workspaceId, relativePath }),
  writeLocal: (workspaceId, relativePath, content) =>
    ipcRenderer.invoke('fs:write', { workspaceId, relativePath, content }),
  renameLocal: (workspaceId, from, to) => ipcRenderer.invoke('fs:rename', { workspaceId, from, to }),
  deleteLocal: (workspaceId, relativePath) => ipcRenderer.invoke('fs:delete', { workspaceId, relativePath }),
  localExists: (workspaceId, relativePath) => ipcRenderer.invoke('fs:exists', { workspaceId, relativePath })
})

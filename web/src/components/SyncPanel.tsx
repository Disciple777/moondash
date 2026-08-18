import { useCallback, useEffect, useState } from 'react'
import {
  ChevronDown,
  ChevronRight,
  CloudUpload,
  Folder,
  FolderSync,
  FileText,
  HardDrive,
  Layers,
  RefreshCw,
  Settings2,
  Unlink
} from 'lucide-react'
import { useApp } from '../state/AppContext'
import type { Binding, SyncStatus } from '../moondash'

export function SyncPanel() {
  const { activeWorkspace } = useApp()
  const bridge = window.moondash

  const [bindings, setBindings] = useState<Binding[]>([])
  const [statuses, setStatuses] = useState<Record<string, SyncStatus>>({})
  const [linkedStatus, setLinkedStatus] = useState<SyncStatus | null>(null)
  const [busyKey, setBusyKey] = useState<string | null>(null)
  const [connecting, setConnecting] = useState(false)
  const [expanded, setExpanded] = useState(false)
  const [showSettings, setShowSettings] = useState(false)
  const [apiUrl, setApiUrl] = useState(bridge?.apiBase ?? '')
  const [fileAssoc, setFileAssoc] = useState<boolean | null>(null)

  const reload = useCallback(() => {
    if (!bridge) return
    void bridge.getBindings().then(setBindings)
  }, [bridge])

  useEffect(() => {
    if (!bridge) return
    reload()
    void bridge.fileAssocStatus().then(setFileAssoc)
    const off = bridge.onStatus((s) => {
      if (s.linked) {
        setLinkedStatus(s)
        return
      }
      const b = s.binding
      if (b) setStatuses((prev) => ({ ...prev, [b.key]: s }))
    })
    return off
  }, [bridge, reload])

  if (!bridge) return null

  const connect = async () => {
    if (!activeWorkspace) return
    const folder = await bridge.pickFolder()
    if (!folder) return
    setConnecting(true)
    try {
      await bridge.bind(activeWorkspace.id, activeWorkspace.name, folder)
      reload()
    } finally {
      setConnecting(false)
    }
  }

  const syncOne = async (key: string) => {
    setBusyKey(key)
    try {
      await bridge.syncNow(key)
    } finally {
      setBusyKey(null)
    }
  }

  const syncAll = async () => {
    setBusyKey('linked')
    try {
      await bridge.syncNow()
    } finally {
      setBusyKey(null)
    }
  }

  const unlink = async (key: string) => {
    await bridge.unbind(key)
    setStatuses((prev) => {
      const next = { ...prev }
      delete next[key]
      return next
    })
    reload()
  }

  const saveApi = async () => {
    await bridge.setApiBase(apiUrl.trim() || 'http://localhost:8000')
  }

  const toggleFileAssoc = async () => {
    const on = fileAssoc
    if (on === null) return
    if (on) {
      await bridge.fileAssocUninstall()
    } else {
      await bridge.fileAssocInstall()
    }
    setFileAssoc(await bridge.fileAssocStatus())
  }

  // Collapsed view: only the CURRENT workspace's status.
  const activeBinding = activeWorkspace
    ? bindings.find((b) => b.workspaceId === activeWorkspace.id)
    : undefined
  const activeStatus = activeBinding ? statuses[activeBinding.key] : undefined

  const isMultiSpace = activeWorkspace?.type === 'multi'

  let summary = 'Not connected'
  let dotClass = 'sync-dot-idle'
  if (!activeWorkspace) {
    summary = 'No workspace'
  } else if (isMultiSpace) {
    summary = 'Multi-space (no folder)'
  } else if (activeBinding) {
    if (activeStatus?.state === 'syncing') {
      summary = 'Syncing…'
      dotClass = 'sync-dot-syncing'
    } else if (activeStatus?.state === 'error') {
      summary = activeStatus.message ?? 'Sync error'
      dotClass = 'sync-dot-error'
    } else if (activeStatus) {
      summary = 'Synced'
    } else {
      summary = 'Watching…'
    }
  }

  const counts = activeStatus?.counts

  // Multi-spaces never bind to a folder — they aggregate docs from other
  // workspaces — so treat them as "bound" to keep the connect buttons hidden.
  const activeWorkspaceBound = activeWorkspace
    ? isMultiSpace || bindings.some((b) => b.workspaceId === activeWorkspace.id)
    : true

  return (
    <div className="sync-card">
      <button
        className="sync-mini-head"
        onClick={() => setExpanded((v) => !v)}
        title={
          activeBinding
            ? activeStatus?.message ?? activeBinding.root
            : 'No folder is bound to this workspace'
        }
      >
        <span className={`sync-dot ${dotClass}`} />
        <FolderSync size={13} className="sync-mini-icon" />
        <span className="sync-mini-title">Local sync</span>
        <span className="sync-mini-status">
          {summary}
          {counts && activeStatus?.state === 'idle' && (
            <span className="sync-mini-counts">
              {counts.pushed > 0 && <span>{counts.pushed}↑</span>}
              {counts.pulled > 0 && <span>{counts.pulled}↓</span>}
              {counts.conflicts > 0 && (
                <span className="sync-conflicts">{counts.conflicts} conflicts</span>
              )}
            </span>
          )}
        </span>
        <span className="sync-mini-chevron">
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </span>
      </button>

      {expanded && (
        <div className="sync-mini-body">
          <div className="sync-mini-listhead">
            <span className="sync-mini-listlabel">Synced folders</span>
            <button
              className="icon-btn"
              title="Settings"
              onClick={() => setShowSettings((v) => !v)}
            >
              <Settings2 size={12} />
            </button>
          </div>

          {showSettings && (
            <div className="sync-settings">
              <label className="sync-settings-label">Server URL</label>
              <div className="sync-settings-row">
                <input
                  value={apiUrl}
                  onChange={(e) => setApiUrl(e.target.value)}
                  placeholder="https://your-host.com/moondash-api"
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void saveApi()
                  }}
                />
                <button className="btn ghost sync-now" onClick={() => void saveApi()}>
                  Save
                </button>
              </div>
              <div className="sync-fileassoc">
                <span className="sync-fileassoc-label">
                  <FileText size={12} />
                  Open .md files with Moondash
                </span>
                <button
                  className={`switch${fileAssoc ? ' is-on' : ''}`}
                  onClick={() => void toggleFileAssoc()}
                  disabled={fileAssoc === null}
                  title={
                    fileAssoc
                      ? 'Double-clicking .md/.markdown files opens Moondash'
                      : 'Register Moondash as the .md/.markdown handler'
                  }
                >
                  <span className="switch-knob" />
                </button>
              </div>
              <p className="sync-settings-hint">
                {fileAssoc
                  ? 'Windows: .md and .markdown files open in Moondash on double-click.'
                  : 'Windows: make Moondash the app that opens .md/.markdown files.'}
              </p>
            </div>
          )}

          {linkedStatus && (
            <div className="sync-binding">
              <div className="sync-binding-row">
                <div className="sync-binding-info">
                  <span className="sync-binding-name" title="Docs linked in place from your computer">
                    <HardDrive size={13} />
                    Linked files
                  </span>
                  <span className="sync-binding-path">
                    Docs linked by their exact location on disk
                  </span>
                </div>
                <div className="sync-binding-actions">
                  <button
                    className="icon-btn"
                    title="Sync linked files now"
                    onClick={() => void syncAll()}
                    disabled={busyKey === 'linked'}
                  >
                    <RefreshCw size={13} className={busyKey === 'linked' ? 'spin' : ''} />
                  </button>
                </div>
              </div>
              <div className="sync-status">
                <span className={`sync-dot sync-dot-${linkedStatus.state ?? 'idle'}`} />
                <span className="sync-msg">{linkedStatus.message ?? 'Waiting…'}</span>
              </div>
            </div>
          )}

          {bindings.length === 0 ? (
            isMultiSpace ? (
              <div className="sync-hint" style={{ padding: '2px 0' }}>
                <Layers size={12} />
                Multi-spaces gather docs from your other workspaces — no folder to sync.
              </div>
            ) : (
              <button
                className="btn ghost sync-now"
                onClick={() => void connect()}
                disabled={connecting}
              >
                <Folder size={13} /> Connect a folder
              </button>
            )
          ) : (
            <>
              {bindings.map((b) => {
                const st = statuses[b.key]
                return (
                  <div key={b.key} className="sync-binding">
                    <div className="sync-binding-row">
                      <div className="sync-binding-info">
                        <span
                          className="sync-binding-name"
                          title={`Synced to workspace #${b.workspaceId}`}
                        >
                          <HardDrive size={13} />
                          {b.name}
                        </span>
                        <span className="sync-binding-path" title={b.root}>
                          {b.root}
                        </span>
                      </div>
                      <div className="sync-binding-actions">
                        <button
                          className="icon-btn"
                          title="Sync now"
                          onClick={() => void syncOne(b.key)}
                          disabled={busyKey === b.key}
                        >
                          <RefreshCw size={13} className={busyKey === b.key ? 'spin' : ''} />
                        </button>
                        <button
                          className="icon-btn danger"
                          title="Unlink this folder"
                          onClick={() => void unlink(b.key)}
                        >
                          <Unlink size={13} />
                        </button>
                      </div>
                    </div>
                    <div className="sync-status">
                      <span className={`sync-dot sync-dot-${st?.state ?? 'idle'}`} />
                      <span className="sync-msg">{st?.message ?? 'Waiting…'}</span>
                    </div>
                    {st?.counts && (
                      <div className="sync-counts">
                        <span>{st.counts.pushed} up</span>
                        <span>{st.counts.pulled} down</span>
                        {st.counts.conflicts > 0 && (
                          <span className="sync-conflicts">{st.counts.conflicts} conflicts</span>
                        )}
                        {st.counts.skipped > 0 && <span>{st.counts.skipped} skipped</span>}
                      </div>
                    )}
                  </div>
                )
              })}
              {!activeWorkspaceBound && activeWorkspace && (
                <button
                  className="btn ghost sync-now"
                  onClick={() => void connect()}
                  disabled={connecting}
                >
                  <Folder size={13} /> Connect a folder for “{activeWorkspace.name}”
                </button>
              )}
            </>
          )}
          <div className="sync-hint">
            <CloudUpload size={12} />
            Folders are watched and mirrored to their workspaces
          </div>
        </div>
      )}
    </div>
  )
}

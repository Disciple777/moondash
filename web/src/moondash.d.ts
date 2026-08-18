export interface SyncCounts {
  pulled: number
  pushed: number
  conflicts: number
  skipped: number
}

export interface SyncStatus {
  state: 'idle' | 'syncing' | 'error'
  message: string
  lastSync: string | null
  counts: SyncCounts | null
  binding?: {
    key: string
    workspaceId: number
    name: string
    root: string
  }
  /** Status from the linked-file engine (docs linked in place by path). */
  linked?: boolean
}

export interface SyncResult {
  pulled: number
  pushed: number
  conflicts: number
  skipped?: number
  error?: string
}

export interface Binding {
  key: string
  workspaceId: number
  name: string
  root: string
}

export interface BindingHit {
  binding: Binding
  relativePath: string
}

/** Bridge exposed by the Electron desktop app (preload) as window.moondash. */
export interface MoondashBridge {
  isDesktop: boolean
  apiBase: string
  getApiBase(): Promise<string>
  pickFolder(): Promise<string | null>
  getBindings(): Promise<Binding[]>
  bind(workspaceId: number, name: string, folder: string): Promise<{ ok: boolean }>
  unbind(key: string): Promise<{ ok: boolean }>
  setToken(token: string | null): void
  setApiBase(url: string, opts?: { silent?: boolean }): Promise<{ ok: boolean }>
  syncNow(key?: string): Promise<SyncResult>
  onStatus(cb: (s: SyncStatus) => void): () => void
  whichBinding(absPath: string): Promise<BindingHit | null>
  /** Absolute path of a picked/dropped file (desktop only). */
  pathForFile(file: File): string
  readExternalFile(absPath: string): Promise<string | null>
  writeExternal(absPath: string, content: string): Promise<{ ok: boolean }>
  onOpenFiles(cb: (files: string[]) => void): () => void
  fileAssocStatus(): Promise<boolean>
  fileAssocInstall(): Promise<{ ok: boolean }>
  fileAssocUninstall(): Promise<{ ok: boolean }>
  readLocal(workspaceId: number, relativePath: string): Promise<string | null>
  writeLocal(workspaceId: number, relativePath: string, content: string): Promise<{ ok: boolean }>
  renameLocal(workspaceId: number, from: string, to: string): Promise<{ ok: boolean }>
  deleteLocal(workspaceId: number, relativePath: string): Promise<{ ok: boolean }>
  localExists(workspaceId: number, relativePath: string): Promise<boolean>
}

declare global {
  interface Window {
    moondash?: MoondashBridge
  }
}

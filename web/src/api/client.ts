import type { DocDetail, DocNode, SyncEntry, SyncPushResult, TreeResponse, Workspace } from '../types'

const API_BASE_KEY = 'moondash.apiBase'

/**
 * Resolution order: localStorage override (no rebuild needed) → Electron
 * bridge → VITE_API_URL at build time → same-origin fallback derived from
 * the page URL (the backend ships as <webroot>/backend/public alongside the
 * app). The last-resort derivation keeps fresh devices working even if a
 * build was produced without the env var baked in.
 */
function defaultApiBase(): string {
  const stored = localStorage.getItem(API_BASE_KEY)
  if (stored) return stored
  if (window.moondash?.apiBase) return window.moondash.apiBase
  const baked = import.meta.env.VITE_API_URL
  if (baked) return baked
  // Electron resolves the live base via getApiBase() in resolveApiBase() —
  // never derive from the file:// path.
  if (window.moondash?.isDesktop) return ''
  try {
    // Assumes the app is served from a subfolder with the backend at
    // <subfolder>/backend/public — e.g. https://guatermelon.com/moondash/
    // → https://guatermelon.com/moondash/backend/public. Serving from the
    // domain root falls back to '' (same as no derivation).
    const url = new URL(window.location.href)
    const first = url.pathname.split('/').filter(Boolean)[0]
    if (first) return `${url.origin}/${first}/backend/public`
  } catch {
    // unparsable URL — leave empty
  }
  return ''
}

export let API_BASE = defaultApiBase()

/** Set/override the API server at runtime (persisted in localStorage). */
export function setApiBase(url: string): void {
  const clean = url.trim().replace(/\/+$/, '')
  if (!clean) return
  localStorage.setItem(API_BASE_KEY, clean)
  API_BASE = clean
}

/**
 * Resolve the API base before the first request. Desktop (Electron) reads it
 * live from the main process so changing the server URL survives reloads.
 */
export async function resolveApiBase(): Promise<void> {
  // Keep the desktop sync engine's token in sync on every boot. The engine
  // only learns the token through setToken (normally fired on login/logout),
  // so after a restart it would otherwise hit the API unauthenticated and
  // report "Authentication required" forever.
  const existing = getToken()
  if (existing) window.moondash?.setToken?.(existing)
  if (localStorage.getItem(API_BASE_KEY)) return
  if (window.moondash?.getApiBase) {
    try {
      const live = await window.moondash.getApiBase()
      if (!live) return
      const baked = import.meta.env.VITE_API_URL ?? ''
      if (live === 'http://localhost:8000' && baked) {
        // Desktop hasn't been pointed at a server yet — use the build-time URL
        // and persist it silently so the sync engine uses it too.
        API_BASE = baked
        void window.moondash.setApiBase?.(baked, { silent: true })
      } else {
        API_BASE = live
      }
    } catch {
      // keep the static value
    }
  }
}

const TOKEN_KEY = 'moondash.token'

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY)
}

export function setToken(token: string | null): void {
  if (token) {
    localStorage.setItem(TOKEN_KEY, token)
  } else {
    localStorage.removeItem(TOKEN_KEY)
  }
  window.moondash?.setToken?.(token)
}

export class ApiError extends Error {
  status: number
  constructor(message: string, status: number) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const headers: Record<string, string> = {}
  if (body !== undefined) headers['Content-Type'] = 'application/json'
  const token = getToken()
  if (token) headers['Authorization'] = `Bearer ${token}`

  const res = await fetch(`${API_BASE}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined
  })

  if (res.status === 401 && !path.includes('/auth/')) {
    setToken(null)
    window.dispatchEvent(new CustomEvent('moondash:unauthorized'))
  }

  const data = (await res.json().catch(() => ({}))) as Record<string, unknown> & { message?: string }

  if (!res.ok) {
    throw new ApiError(data.message ?? `Request failed (${res.status})`, res.status)
  }

  return data as T
}

export interface PushPayloadFile {
  relative_path: string
  content: string
  hash: string
  /** Local file modification time (ISO 8601, UTC) — the cloud stores it as the doc's updated_at. */
  mtime?: string
}

export const api = {
  register: (email: string, password: string) =>
    request<{ user_id: number; token: string }>('POST', '/api/auth/register', { email, password }),
  login: (email: string, password: string) =>
    request<{ user_id: number; token: string }>('POST', '/api/auth/login', { email, password }),
  logout: () => request<{ ok: boolean }>('POST', '/api/auth/logout'),

  listWorkspaces: () => request<{ workspaces: Workspace[] }>('GET', '/api/workspaces'),
  createWorkspace: (
    name: string,
    opts?: { description?: string; type?: 'folder' | 'multi'; color_hex?: string; icon_key?: string }
  ) =>
    request<{ workspace_id: number }>('POST', '/api/workspaces', {
      name,
      description: opts?.description,
      type: opts?.type,
      color_hex: opts?.color_hex,
      icon_key: opts?.icon_key
    }),
  updateWorkspace: (
    workspace_id: number,
    patch: {
      name?: string
      description?: string
      type?: 'folder' | 'multi'
      color_hex?: string
      icon_key?: string
    }
  ) => request<{ ok: boolean }>('PATCH', '/api/workspaces', { workspace_id, ...patch }),
  deleteWorkspace: (workspace_id: number) =>
    request<{ ok: boolean }>('DELETE', `/api/workspaces?workspace_id=${workspace_id}`),
  linkDoc: (workspace_id: number, doc_id: number) =>
    request<{ ok: boolean }>('POST', '/api/workspaces/links', { workspace_id, doc_id }),
  unlinkDoc: (workspace_id: number, doc_id: number) =>
    request<{ ok: boolean }>(
      'DELETE',
      `/api/workspaces/links?workspace_id=${workspace_id}&doc_id=${doc_id}`
    ),

  tree: (workspace_id: number) =>
    request<TreeResponse>('GET', `/api/workspaces/tree?workspace_id=${workspace_id}`),
  createDoc: (
    workspace_id: number,
    relative_path: string,
    content: string,
    local_path?: string
  ) =>
    request<{ bit_id: number }>('POST', '/api/docs', {
      workspace_id,
      relative_path,
      content,
      local_path: local_path ?? null
    }),
  docDetail: (doc_id: number) =>
    request<{ doc: DocDetail }>('GET', `/api/docs/detail?doc_id=${doc_id}`),
  updateDoc: (
    doc_id: number,
    patch: { title?: string; content?: string; relative_path?: string }
  ) => request<{ ok: boolean; revision: number }>('PATCH', '/api/docs', { doc_id, ...patch }),
  deleteDoc: (doc_id: number) =>
    request<{ ok: boolean; revision: number }>('DELETE', `/api/docs?doc_id=${doc_id}`),

  createFolder: (
    workspace_id: number,
    name: string,
    color_hex: string,
    icon_key: string | null,
    parent_folder_id?: number | null
  ) =>
    request<{ folder_id: number }>('POST', '/api/folders', {
      workspace_id,
      name,
      color_hex,
      icon_key,
      parent_folder_id: parent_folder_id ?? null
    }),
  updateFolder: (
    folder_id: number,
    patch: { name?: string; color_hex?: string; icon_key?: string }
  ) => request<{ ok: boolean }>('PATCH', '/api/folders', { folder_id, ...patch }),
  deleteFolder: (folder_id: number) =>
    request<{ ok: boolean }>('DELETE', `/api/folders?folder_id=${folder_id}`),
  addFolderMember: (folder_id: number, doc_id: number) =>
    request<{ ok: boolean }>('POST', '/api/folders/members', { folder_id, doc_id }),
  removeFolderMember: (folder_id: number, doc_id: number) =>
    request<{ ok: boolean }>(
      'DELETE',
      `/api/folders/members?folder_id=${folder_id}&doc_id=${doc_id}`
    ),
  moveFolder: (folder_id: number, parent_folder_id: number | null) =>
    request<{ ok: boolean }>('POST', '/api/folders/move', { folder_id, parent_folder_id }),
  reorderFolderMembers: (folder_id: number, item_ids: number[]) =>
    request<{ ok: boolean }>('PATCH', '/api/folders/members/order', { folder_id, item_ids }),
  reorderFolders: (workspace_id: number, folder_ids: number[], parent_folder_id?: number | null) =>
    request<{ ok: boolean }>('PATCH', '/api/folders/reorder', {
      workspace_id,
      folder_ids,
      parent_folder_id: parent_folder_id ?? null
    }),

  manifest: (workspace_id: number) =>
    request<{ entries: SyncEntry[] }>('GET', `/api/sync/manifest?workspace_id=${workspace_id}`),
  syncPush: (workspace_id: number, files: PushPayloadFile[]) =>
    request<{ results: SyncPushResult[] }>('POST', '/api/sync/push', { workspace_id, files }),
  syncRemove: (workspace_id: number, relative_path: string) =>
    request<{ ok: boolean; revision: number }>('POST', '/api/sync/remove', { workspace_id, relative_path }),
  syncFile: (workspace_id: number, relative_path: string) =>
    request<{ file: { title: string; content: string; revision: number; updated_at: string } }>(
      'GET',
      `/api/sync/file?workspace_id=${workspace_id}&relative_path=${encodeURIComponent(relative_path)}`
    ),
  /** Linked-in-place docs (local_path) across all workspaces + the hidden external workspace id. */
  externalSync: () =>
    request<{ workspace_id: number; entries: SyncEntry[] }>('GET', '/api/sync/external')
}

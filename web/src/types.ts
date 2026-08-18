export interface Workspace {
  id: number
  name: string
  description: string | null
  /** 'folder' = a synced folder root; 'multi' = cloud-only aggregation space. */
  type: 'folder' | 'multi'
  color_hex: string
  icon_key: string | null
  created_at: string
  updated_at: string
}

export interface FolderInfo {
  bit_id: number
  name: string
  color_hex: string
  icon_key: string | null
}

export interface FolderMembership {
  folder_id: number
  item_id: number
  position: number
}

export interface TreeResponse {
  docs: DocNode[]
  folders: FolderInfo[]
  memberships: FolderMembership[]
}

export interface DocNode {
  id: number
  relative_path: string
  /** Absolute disk path for docs linked in place (desktop); null otherwise. */
  local_path?: string | null
  content_hash: string
  revision: number
  is_deleted: boolean | number
  title: string
  content_preview: string | null
  created_at: string
  updated_at: string
  /** Only present in multi-space trees: the workspace that owns this doc. */
  source_workspace_id?: number
  source_workspace_name?: string
}

export interface DocDetail {
  id: number
  bit_type: string
  title: string
  content_preview: string | null
  created_at: string
  updated_at: string
  content: string | null
  workspace_id: number | null
  relative_path: string | null
  local_path?: string | null
  revision: number | null
  is_deleted: boolean | number
}

export interface SyncEntry {
  relative_path: string
  local_path?: string | null
  content_hash: string
  revision: number
  is_deleted: boolean | number
  bit_id: number
  updated_at: string
}

export interface SyncPushResult {
  relative_path: string
  status: 'ok' | 'invalid' | 'error'
  bit_id?: number
  revision?: number
  message?: string
}

import { useCallback, useMemo, useRef, useState, type DragEvent, type ReactNode } from 'react'
import {
  ArrowUpAZ,
  CalendarClock,
  Check,
  ChevronDown,
  ChevronRight,
  FileText,
  FolderPlus,
  HardDrive,
  Layers,
  Link2,
  LogOut,
  Moon,
  Pencil,
  Plus,
  Search,
  Settings,
  Trash2,
  Upload,
  X
} from 'lucide-react'
import { useApp } from '../state/AppContext'
import type { DocNode, FolderInfo, FolderMembership, Workspace } from '../types'
import { SyncPanel } from './SyncPanel'
import { FolderDialog } from './FolderDialog'
import { FolderGlyph } from './FolderGlyph'
import { SettingsModal } from './SettingsModal'
import { WorkspaceDialog } from './WorkspaceDialog'

type SortBy = 'name' | 'date'

const SORT_STORAGE_KEY = 'moondash.sortBy'

function loadSort(): SortBy {
  try {
    return localStorage.getItem(SORT_STORAGE_KEY) === 'date' ? 'date' : 'name'
  } catch {
    return 'name'
  }
}

interface FolderNode {
  info: FolderInfo
  children: FolderNode[]
  docs: DocNode[]
}

type DragItem =
  | { type: 'doc'; id: number; fromFolderId?: number }
  | { type: 'folder'; id: number }

/** Where a dragged item will land relative to a target folder. */
type DropZone = 'above' | 'inside' | 'below'

/** Resolved drag-over target: a folder id + zone, or 'root'. */
interface DragOverTarget {
  folderId: number
  zone: DropZone
}

interface TreeData {
  folders: FolderNode[]
  unfiled: DocNode[]
  docFolderIds: Map<number, number[]>
}

/** Folders with a folder parent → they are nested (not roots). */
function buildTree(
  docs: DocNode[],
  folders: FolderInfo[],
  memberships: FolderMembership[]
): TreeData {
  const liveDocs = docs.filter((d) => !d.is_deleted)
  const folderIds = new Set(folders.map((f) => f.bit_id))

  // folder_id -> child folder ids, folder_id -> child doc ids, doc_id -> folder ids
  const folderChildren = new Map<number, number[]>()
  const folderDocs = new Map<number, number[]>()
  const docFolderIds = new Map<number, number[]>()

  for (const m of memberships) {
    const f = m.folder_id
    const item = m.item_id
    if (folderIds.has(item)) {
      const list = folderChildren.get(f) ?? []
      list.push(item)
      folderChildren.set(f, list)
    } else if (liveDocs.some((d) => d.id === item)) {
      const list = folderDocs.get(f) ?? []
      list.push(item)
      folderDocs.set(f, list)
      const df = docFolderIds.get(item) ?? []
      df.push(f)
      docFolderIds.set(item, df)
    }
  }

  const byId = new Map<number, FolderInfo>(folders.map((f) => [f.bit_id, f]))
  const docById = new Map<number, DocNode>(liveDocs.map((d) => [d.id, d]))

  const buildNode = (id: number): FolderNode => ({
    info: byId.get(id)!,
    children: (folderChildren.get(id) ?? []).map(buildNode),
    docs: (folderDocs.get(id) ?? [])
      .map((docId) => docById.get(docId))
      .filter((d): d is DocNode => d !== undefined)
  })

  const roots = folders
    .filter((f) => !memberships.some((m) => m.item_id === f.bit_id && folderIds.has(m.folder_id)))
    .map((f) => buildNode(f.bit_id))

  const unfiled = liveDocs.filter((d) => !docFolderIds.has(d.id))

  return { folders: roots, unfiled, docFolderIds }
}

export function Sidebar({
  mobileOpen = false,
  onNavigate
}: {
  mobileOpen?: boolean
  onNavigate?: () => void
}) {
  const {
    userEmail,
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    selectWorkspace,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    unlinkDocFromWorkspace,
    openMultiModal,
    docs,
    folders,
    memberships,
    activeDocId,
    openDoc,
    renameDoc,
    deleteDoc,
    createDoc,
    moveDocToFolder,
    unfileDoc,
    moveFolder,
    reorderFolders,
    createFolder,
    updateFolder,
    deleteFolder,
    logout
  } = useApp()

  const [filter, setFilter] = useState('')
  const [sortBy, setSortBy] = useState<SortBy>(loadSort)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [wsPickerOpen, setWsPickerOpen] = useState(false)
  const [wsDialog, setWsDialog] = useState<{ mode: 'create' | 'edit'; workspaceId?: number } | null>(
    null
  )
  const [expanded, setExpanded] = useState<Set<number>>(new Set())
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const [renameDraft, setRenameDraft] = useState('')
  const [dialog, setDialog] = useState<
    { mode: 'create'; parentId: number | null } | { mode: 'edit'; folder: FolderInfo } | null
  >(null)
  const [dragItem, setDragItem] = useState<DragItem | null>(null)
  const [dragOver, setDragOver] = useState<'root' | DragOverTarget | null>(null)
  const [fileDragOver, setFileDragOver] = useState(false)

  const tree = useMemo(() => {
    const base = buildTree(docs, folders, memberships)
    const q = filter.trim().toLowerCase()
    const filtering = q !== ''

    // Name: case-insensitive, numeric-aware. Date: newest modified first
    // (updated_at is a timestamp on every write), ties fall back to name.
    // The backend returns MySQL 'YYYY-MM-DD HH:MM:SS' (UTC, no zone marker)
    // while local edits set ISO '...Z' — normalize both to UTC before
    // comparing so mixed formats never misorder.
    const timeOf = (d: DocNode) => {
      const s = d.updated_at.replace(' ', 'T')
      const hasZone = /Z$|[+-]\d{2}:?\d{2}$/.test(s)
      return Date.parse(hasZone ? s : `${s}Z`) || 0
    }
    const cmp =
      sortBy === 'name'
        ? (a: DocNode, b: DocNode) =>
            a.title.localeCompare(b.title, undefined, { sensitivity: 'base', numeric: true })
        : (a: DocNode, b: DocNode) => timeOf(b) - timeOf(a) || a.title.localeCompare(b.title)
    const sorted = (list: DocNode[]) => [...list].sort(cmp)

    // While searching: keep a folder only if its own name matches or it
    // contains a matching descendant; matching folders show all their docs.
    const prune = (node: FolderNode): FolderNode | null => {
      if (!filtering) return { ...node, docs: sorted(node.docs) }
      const nameMatch = node.info.name.toLowerCase().includes(q)
      const children = node.children
        .map(prune)
        .filter((c): c is FolderNode => c !== null)
      const docs = sorted(
        nameMatch ? node.docs : node.docs.filter((d) => d.title.toLowerCase().includes(q))
      )
      if (nameMatch || children.length > 0 || docs.length > 0) {
        return { ...node, children, docs }
      }
      return null
    }

    return {
      folders: base.folders.map(prune).filter((f): f is FolderNode => f !== null),
      unfiled: sorted(
        filtering
          ? base.unfiled.filter((d) => d.title.toLowerCase().includes(q))
          : base.unfiled
      ),
      docFolderIds: base.docFolderIds
    }
  }, [docs, folders, memberships, filter, sortBy])

  const isFiltering = filter.trim() !== ''

  const changeSort = (next: SortBy) => {
    setSortBy(next)
    try {
      localStorage.setItem(SORT_STORAGE_KEY, next)
    } catch {}
  }

  const toggleFolder = (id: number) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }

  const commitRename = (id: number) => {
    setRenamingId(null)
    if (renameDraft.trim() && renameDraft.trim() !== docs.find((d) => d.id === id)?.title) {
      void renameDoc(id, renameDraft.trim())
    }
  }

  const isMultiSpace = activeWorkspace?.type === 'multi'

  const activeWs = workspaces.find((w) => w.id === activeWorkspaceId) ?? null

  const confirmDeleteWorkspace = (w: Workspace) => {
    const isMulti = w.type === 'multi'
    const prompt = isMulti
      ? `Delete “${w.name}”? The documents stay in their original workspaces.`
      : `Delete “${w.name}” and all its docs?`
    if (window.confirm(prompt)) void deleteWorkspace(w.id)
  }

  // ---- drag & drop -------------------------------------------------- //

  /** True when moving a folder onto one of its own descendants would cycle. */
  const isFolderDescendant = (folderId: number, maybeDescendant: number): boolean => {
    const stack = [maybeDescendant]
    while (stack.length > 0) {
      const cur = stack.pop()!
      if (cur === folderId) return true
      for (const m of memberships) {
        if (m.folder_id === cur) stack.push(m.item_id)
      }
    }
    return false
  }

  /** Get the folder info for computing drop zone parent. */
  const getFolderParent = useCallback((folderId: number): number | null => {
    for (const m of memberships) {
      if (m.item_id === folderId) return m.folder_id
    }
    return null
  }, [memberships])

  /** Get the ordered sibling folder IDs for the same parent. */
  const getSiblingFolderIds = useCallback((parentId: number | null): number[] => {
    if (parentId !== null) {
      // Folders nested under parentId, ordered by position
      return memberships
        .filter((m) => m.folder_id === parentId && folders.some((f) => f.bit_id === m.item_id))
        .sort((a, b) => a.position - b.position)
        .map((m) => m.item_id)
    }
    // Root-level folders — return in order of `folders` array (backend sorts by position)
    const nested = new Set(memberships.filter((m) => folders.some((f) => f.bit_id === m.item_id)).map((m) => m.item_id))
    return folders.filter((f) => !nested.has(f.bit_id)).map((f) => f.bit_id)
  }, [memberships, folders])

  const startDrag = (item: DragItem) => (e: DragEvent) => {
    e.dataTransfer.setData('text/plain', JSON.stringify(item))
    e.dataTransfer.effectAllowed = 'move'
    setDragItem(item)
    setDragOver(null)
  }

  /** Compute the drop zone from the mouse Y position within the element. */
  const onDragOverFolder = (folderId: number) => (e: DragEvent) => {
    if (!dragItem) return
    // Don't allow dropping a folder onto itself or its descendants
    if (dragItem.type === 'folder' && (dragItem.id === folderId || isFolderDescendant(dragItem.id, folderId))) {
      return
    }
    e.preventDefault()
    e.stopPropagation()
    e.dataTransfer.dropEffect = 'move'

    const rect = (e.currentTarget as HTMLElement).getBoundingClientRect()
    const y = e.clientY - rect.top
    const h = rect.height
    let zone: DropZone
    if (y < h * 0.3) zone = 'above'
    else if (y > h * 0.7) zone = 'below'
    else zone = 'inside'

    setDragOver((prev) => {
      if (prev && typeof prev === 'object' && prev.folderId === folderId && prev.zone === zone) return prev
      return { folderId, zone }
    })
  }

  const onDragLeave = () => {
    if (dragItem) setDragOver(null)
  }

  const onDropRoot = (e: DragEvent) => {
    e.preventDefault()
    const item = dragItem
    setDragItem(null)
    setDragOver(null)
    if (!item) return

    if (item.type === 'doc') {
      void unfileDoc(item.id)
    } else {
      void moveFolder(item.id, null)
    }
  }

  const onDropFolder = (target: number) => (e: DragEvent) => {
    e.preventDefault()
    const item = dragItem
    const zone = typeof dragOver === 'object' ? dragOver?.zone ?? 'inside' : 'inside'
    setDragItem(null)
    setDragOver(null)
    if (!item) return

    if (item.type === 'doc') {
      if (zone === 'inside') {
        void moveDocToFolder(item.id, target, item.fromFolderId)
      }
      // For 'above'/'below', docs don't have position tracking — move into the target folder
      else void moveDocToFolder(item.id, target, item.fromFolderId)
      return
    }

    // Folder drag
    if (target === item.id) return
    if (isFolderDescendant(item.id, target)) return

    if (zone === 'inside') {
      // Nest inside the target
      void moveFolder(item.id, target)
    } else {
      // Reorder: place above or below the target among siblings
      const parentOfTarget = getFolderParent(target)
      const siblings = getSiblingFolderIds(parentOfTarget)
      const targetIdx = siblings.indexOf(target)
      if (targetIdx === -1) return

      // Remove dragged item from siblings (it may be elsewhere)
      const without = siblings.filter((id) => id !== item.id)
      const insertIdx = zone === 'above' ? targetIdx : targetIdx + 1
      without.splice(insertIdx, 0, item.id)

      // If moving within the same parent, just reorder
      const parentOfDragged = getFolderParent(item.id)
      if (parentOfDragged === parentOfTarget) {
        void reorderFolders(without, parentOfTarget)
      } else {
        // Move to the same parent first, then reorder
        void (async () => {
          await moveFolder(item.id, parentOfTarget)
          // After move, re-fetch siblings and reorder
          const newSiblings = getSiblingFolderIds(parentOfTarget)
          const without2 = newSiblings.filter((id) => id !== item.id)
          without2.splice(insertIdx, 0, item.id)
          await reorderFolders(without2, parentOfTarget)
        })()
      }
    }
  }

  // ---- render ------------------------------------------------------- //

  const renderDoc = (doc: DocNode, depth: number, fromFolderId?: number): ReactNode => {
    const active = activeDocId === doc.id
    const folderCount = tree.docFolderIds.get(doc.id)?.length ?? 0
    const dragging = dragItem?.type === 'doc' && dragItem.id === doc.id
    const key = fromFolderId !== undefined ? `${fromFolderId}:${doc.id}` : `root:${doc.id}`
    return (
      <div
        key={key}
        className={`tree-row${active ? ' is-active' : ''}${dragging ? ' is-dragging' : ''}`}
        style={{ paddingLeft: 8 + depth * 14 }}
        draggable
        onDragStart={startDrag({ type: 'doc', id: doc.id, fromFolderId })}
        onClick={() => {
          onNavigate?.()
          void openDoc(doc.id)
        }}
      >
        <FileText size={14} className="tree-icon" />
        {renamingId === doc.id ? (
          <input
            className="tree-rename"
            autoFocus
            value={renameDraft}
            onChange={(e) => setRenameDraft(e.target.value)}
            onBlur={() => commitRename(doc.id)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') commitRename(doc.id)
              if (e.key === 'Escape') setRenamingId(null)
            }}
            onClick={(e) => e.stopPropagation()}
          />
        ) : (
          <span className="tree-label">
            {doc.title}
            {folderCount > 1 && (
              <span className="tree-multi" title="In multiple folders">
                · {folderCount}
              </span>
            )}
          </span>
        )}
        <span className="tree-actions">
          {!renamingId && (
            <>
              <button
                className="icon-btn"
                title="Rename"
                onClick={(e) => {
                  e.stopPropagation()
                  setRenamingId(doc.id)
                  setRenameDraft(doc.title)
                }}
              >
                <Pencil size={12} />
              </button>
              <button
                className="icon-btn danger"
                title={isMultiSpace ? 'Remove from this space' : 'Delete'}
                onClick={(e) => {
                  e.stopPropagation()
                  if (isMultiSpace) {
                    if (
                      window.confirm(
                        `Remove “${doc.title}” from this space? The file stays in its workspace.`
                      )
                    ) {
                      void unlinkDocFromWorkspace(activeWorkspaceId!, doc.id)
                    }
                  } else if (window.confirm(`Delete “${doc.title}”?`)) {
                    void deleteDoc(doc.id)
                  }
                }}
              >
                <Trash2 size={12} />
              </button>
            </>
          )}
        </span>
      </div>
    )
  }

  // Multi-spaces show their top-level links grouped under the workspace each
  // document actually lives in, so provenance stays obvious. Docs linked in
  // place from the computer (local_path set) get their own "Linked files"
  // group instead of the hidden external workspace's name.
  const renderMultiUnfiled = (): ReactNode => {
    const LINKED_GROUP = -1
    const groups = new Map<
      number,
      { name: string; icon: string | null; color: string; docs: DocNode[] }
    >()
    for (const d of tree.unfiled) {
      const linked = Boolean(d.local_path)
      const wsId = linked ? LINKED_GROUP : (d.source_workspace_id ?? 0)
      const ws = workspaces.find((w) => w.id === wsId)
      let g = groups.get(wsId)
      if (!g) {
        g = linked
          ? {
              name: 'Linked files',
              icon: null,
              color: 'var(--text-3)',
              docs: []
            }
          : {
              name: d.source_workspace_name ?? ws?.name ?? 'Other workspace',
              icon: ws?.icon_key ?? null,
              color: ws?.color_hex ?? 'var(--text-3)',
              docs: []
            }
        groups.set(wsId, g)
      }
      g.docs.push(d)
    }
    return [...groups.entries()].map(([wsId, g]) => (
      <div key={wsId} className="multi-source-group">
        <div className="multi-source-head">
          <span className="folder-icon">
            {wsId === LINKED_GROUP ? (
              <HardDrive size={13} />
            ) : (
              <FolderGlyph iconKey={g.icon} color={g.color} size={13} />
            )}
          </span>
          <span className="tree-label">{g.name}</span>
          <span className="tree-section-count">{g.docs.length}</span>
        </div>
        {g.docs.map((d) => renderDoc(d, 1))}
      </div>
    ))
  }

  const renderFolder = (node: FolderNode, depth: number): ReactNode => {
    const { info, children } = node
    const open = isFiltering || expanded.has(info.bit_id)
    const dragging = dragItem?.type === 'folder' && dragItem.id === info.bit_id
    const dropTarget = dragOver && typeof dragOver === 'object' && dragOver.folderId === info.bit_id ? dragOver : null
    const isDropInside = dropTarget?.zone === 'inside'
    const isDropAbove = dropTarget?.zone === 'above'
    const isDropBelow = dropTarget?.zone === 'below'

    return (
      <div key={info.bit_id}>
        {isDropAbove && <div className="drag-indicator drag-above" />}
        <div
          className={`tree-row tree-dir${isDropInside ? ' is-drop-inside' : ''}${dragging ? ' is-dragging' : ''}`}
          style={{ paddingLeft: 8 + depth * 14 }}
          draggable
          onDragStart={startDrag({ type: 'folder', id: info.bit_id })}
          onDragOver={onDragOverFolder(info.bit_id)}
          onDragLeave={onDragLeave}
          onDrop={onDropFolder(info.bit_id)}
          onClick={() => {
            onNavigate?.()
            toggleFolder(info.bit_id)
          }}
        >
          {open ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
          <span className="folder-icon">
            <FolderGlyph iconKey={info.icon_key} color={info.color_hex} />
          </span>
          <span className="tree-label" style={{ color: info.color_hex }}>
            {info.name}
          </span>
          <span className="tree-actions">
            {!renamingId && (
              <>
                <button
                  className="icon-btn"
                  title={isMultiSpace ? 'New page here' : 'New page here'}
                  onClick={(e) => {
                    e.stopPropagation()
                    void createDoc(info.bit_id)
                  }}
                >
                  <Plus size={12} />
                </button>
                <button
                  className="icon-btn"
                  title="New subfolder"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDialog({ mode: 'create', parentId: info.bit_id })
                  }}
                >
                  <FolderPlus size={12} />
                </button>
                <button
                  className="icon-btn"
                  title="Edit folder"
                  onClick={(e) => {
                    e.stopPropagation()
                    setDialog({ mode: 'edit', folder: info })
                  }}
                >
                  <Pencil size={12} />
                </button>
                <button
                  className="icon-btn danger"
                  title="Delete folder"
                  onClick={(e) => {
                    e.stopPropagation()
                    if (window.confirm(`Delete folder “${info.name}” and its subfolders?`))
                      void deleteFolder(info.bit_id)
                  }}
                >
                  <Trash2 size={12} />
                </button>
              </>
            )}
          </span>
        </div>
        {open && (
          <>
            {children.map((c) => renderFolder(c, depth + 1))}
            {node.docs.map((d) => renderDoc(d, depth + 1, info.bit_id))}
          </>
        )}
        {isDropBelow && <div className="drag-indicator drag-below" />}
      </div>
    )
  }

  return (
    <aside className={`sidebar${mobileOpen ? ' is-open' : ''}`}>
      <div className="sidebar-brand">
        <span className="brand-logo">
          <Moon size={16} />
        </span>
        <span className="brand-name">Moondash</span>
        <button
          className="icon-btn sidebar-close-btn"
          title="Close menu"
          aria-label="Close navigation menu"
          onClick={onNavigate}
        >
          <X size={14} />
        </button>
        <button
          className="icon-btn sidebar-settings-btn"
          title="Settings"
          onClick={() => setSettingsOpen(true)}
        >
          <Settings size={14} />
        </button>
      </div>

      <div className="ws-row">
        <div className="ws-picker">
          <button
            type="button"
            className="ws-select"
            onClick={() => setWsPickerOpen((v) => !v)}
            title={activeWs?.name ?? 'Select workspace'}
          >
            <span className="ws-select-glyph">
              <FolderGlyph iconKey={activeWs?.icon_key} color={activeWs?.color_hex} size={15} />
            </span>
            <span className="ws-select-name">
              {activeWs?.name ?? (workspaces.length === 0 ? 'No workspace' : 'Select…')}
            </span>
            {activeWs?.type === 'multi' && <Layers size={11} className="ws-multi-badge" />}
            <ChevronDown size={13} className="ws-select-chevron" />
          </button>

          {wsPickerOpen && (
            <>
              <div className="ws-backdrop" onClick={() => setWsPickerOpen(false)} />
              <div className="ws-popover">
                <div className="ws-popover-title">Workspaces</div>
                {workspaces.length === 0 && (
                  <div className="picker-empty">No workspaces yet</div>
                )}
                {workspaces.map((w) => (
                  <div
                    key={w.id}
                    className={`ws-popover-row${w.id === activeWorkspaceId ? ' is-active' : ''}`}
                  >
                    <button
                      type="button"
                      className="ws-popover-select"
                      onClick={() => {
                        setWsPickerOpen(false)
                        onNavigate?.()
                        void selectWorkspace(w.id)
                      }}
                    >
                      <span className="ws-select-glyph">
                        <FolderGlyph iconKey={w.icon_key} color={w.color_hex} size={15} />
                      </span>
                      <span className="ws-select-name">{w.name}</span>
                      {w.type === 'multi' && <Layers size={11} className="ws-multi-badge" />}
                      {w.id === activeWorkspaceId && (
                        <Check size={14} className="ws-popover-check" />
                      )}
                    </button>
                    <span className="ws-popover-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        title="Edit workspace"
                        onClick={() => {
                          setWsPickerOpen(false)
                          setWsDialog({ mode: 'edit', workspaceId: w.id })
                        }}
                      >
                        <Pencil size={12} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn danger"
                        title="Delete workspace"
                        onClick={() => {
                          setWsPickerOpen(false)
                          confirmDeleteWorkspace(w)
                        }}
                      >
                        <Trash2 size={12} />
                      </button>
                    </span>
                  </div>
                ))}
                <button
                  type="button"
                  className="ws-popover-new"
                  onClick={() => {
                    setWsPickerOpen(false)
                    setWsDialog({ mode: 'create' })
                  }}
                >
                  <Plus size={14} /> New workspace
                </button>
              </div>
            </>
          )}
        </div>
      </div>

      <div className="search-box">
        <Search size={13} className="search-icon" />
        <input
          placeholder="Search pages…"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
        />
      </div>

      <div
        className="tree-scroll"
        onDragOver={(e) => {
          // Only intercept OS file drags (never block-move drags).
          if (isMultiSpace && e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setFileDragOver(true)
          }
        }}
        onDragLeave={(e) => {
          if (e.target === e.currentTarget) setFileDragOver(false)
        }}
        onDrop={(e) => {
          if (isMultiSpace && e.dataTransfer.types.includes('Files')) {
            e.preventDefault()
            setFileDragOver(false)
            const file = e.dataTransfer.files?.[0]
            if (file) openMultiModal('link', undefined, file)
          }
        }}
      >
        {fileDragOver && (
          <div className="drop-import-overlay">
            <Upload size={22} />
            <span>Drop to import into “{activeWorkspace?.name}”</span>
          </div>
        )}
        {!isFiltering && (
          <div className="tree-toolbar">
            <button
              className="btn ghost tree-toolbar-btn"
              onClick={() => setDialog({ mode: 'create', parentId: null })}
            >
              <FolderPlus size={14} /> New folder
            </button>
            {isMultiSpace && (
              <button
                className="btn ghost tree-toolbar-btn"
                onClick={() => openMultiModal('link')}
              >
                <Link2 size={14} /> Add a document
              </button>
            )}
            <div className="sort-toggle" role="radiogroup" aria-label="Sort pages">
              <button
                role="radio"
                aria-checked={sortBy === 'name'}
                className={sortBy === 'name' ? 'is-active' : ''}
                title="Sort by name"
                onClick={() => changeSort('name')}
              >
                <ArrowUpAZ size={14} />
              </button>
              <button
                role="radio"
                aria-checked={sortBy === 'date'}
                className={sortBy === 'date' ? 'is-active' : ''}
                title="Sort by last modified"
                onClick={() => changeSort('date')}
              >
                <CalendarClock size={14} />
              </button>
            </div>
          </div>
        )}

        {tree.folders.length === 0 && tree.unfiled.length === 0 ? (
          <div className="tree-empty">
            {isFiltering
              ? 'No matching pages'
              : 'No pages yet — create a folder or a page below.'}
          </div>
        ) : (
          <>
            {tree.folders.map((f) => renderFolder(f, 0))}
            {(tree.unfiled.length > 0 || !isFiltering) && (
              <div className="tree-section">
                <div
                  className={`tree-section-head${dragOver === 'root' ? ' is-drop' : ''}`}
                  onDragOver={(e) => {
                    if (!dragItem) return
                    e.preventDefault()
                    e.dataTransfer.dropEffect = 'move'
                    setDragOver('root')
                  }}
                  onDragLeave={onDragLeave}
                  onDrop={onDropRoot}
                >
                  <span className="tree-section-label">
                    {isMultiSpace ? 'Documents' : 'Unfiled'}
                  </span>
                  {tree.unfiled.length > 0 && (
                    <span className="tree-section-count">{tree.unfiled.length}</span>
                  )}
                </div>
                {tree.unfiled.length === 0 ? (
                  <div className="tree-empty-sub">
                    {isMultiSpace ? 'Nothing here yet' : 'Drag pages here to unfile them'}
                  </div>
                ) : isMultiSpace ? (
                  renderMultiUnfiled()
                ) : (
                  tree.unfiled.map((d) => renderDoc(d, 0))
                )}
              </div>
            )}
          </>
        )}
      </div>

      <div className="sidebar-bottom">
        {window.moondash?.isDesktop && <SyncPanel />}
        <button
          className="btn primary new-page"
          onClick={() => {
            onNavigate?.()
            if (isMultiSpace) openMultiModal('create')
            else void createDoc()
          }}
        >
          <Plus size={15} /> New page
        </button>
        <div className="user-row">
          <span className="user-avatar">{userEmail?.[0]?.toUpperCase() ?? '?'}</span>
          <span className="user-email" title={userEmail ?? ''}>
            {userEmail}
          </span>
          <button className="icon-btn" title="Log out" onClick={() => void logout()}>
            <LogOut size={15} />
          </button>
        </div>
      </div>

      <SettingsModal open={settingsOpen} onClose={() => setSettingsOpen(false)} />

      {wsDialog && (
        <WorkspaceDialog
          open
          mode={wsDialog.mode}
          initial={
            wsDialog.mode === 'edit'
              ? (() => {
                  const ws = workspaces.find((w) => w.id === wsDialog.workspaceId) ?? null
                  return ws
                    ? {
                        name: ws.name,
                        description: ws.description ?? '',
                        type: ws.type,
                        color_hex: ws.color_hex,
                        icon_key: ws.icon_key
                      }
                    : undefined
                })()
              : undefined
          }
          onSave={async (draft) => {
            if (wsDialog.mode === 'edit') {
              if (wsDialog.workspaceId === undefined) return
              await updateWorkspace(wsDialog.workspaceId, {
                name: draft.name,
                description: draft.description,
                type: draft.type,
                color_hex: draft.color_hex,
                icon_key: draft.icon_key ?? undefined
              })
            } else {
              await createWorkspace(draft.name, {
                description: draft.description || undefined,
                type: draft.type,
                color_hex: draft.color_hex,
                icon_key: draft.icon_key ?? undefined
              })
            }
          }}
          onClose={() => setWsDialog(null)}
        />
      )}

      {dialog && (
        <FolderDialog
          open
          mode={dialog.mode}
          initialName={dialog.mode === 'edit' ? dialog.folder.name : ''}
          initialColor={dialog.mode === 'edit' ? dialog.folder.color_hex : undefined}
          initialIcon={dialog.mode === 'edit' ? (dialog.folder.icon_key ?? undefined) : undefined}
          onSave={async (name, colorHex, iconKey) => {
            if (dialog.mode === 'edit') {
              await updateFolder(dialog.folder.bit_id, {
                name,
                color_hex: colorHex,
                icon_key: iconKey ?? undefined
              })
            } else {
              await createFolder(name, colorHex, iconKey, dialog.parentId)
            }
          }}
          onClose={() => setDialog(null)}
        />
      )}
    </aside>
  )
}

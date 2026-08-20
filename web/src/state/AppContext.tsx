import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode
} from 'react'
import { api, getToken, resolveApiBase, setToken } from '../api/client'
import type { DocNode, FolderInfo, FolderMembership, Workspace } from '../types'

const EXTERNAL_DOCS_KEY = 'moondash.externalDocs'

function titleFromRel(rel: string): string {
  const base = rel.split('/').pop() || ''
  const clean = base.replace(/\.(md|markdown|txt)$/i, '')
  return clean || 'Untitled'
}

export type SaveStatus = 'idle' | 'saving' | 'saved' | 'error'

/** A file opened directly from disk, not linked to any workspace. */
export interface QuickOpenFile {
  absPath: string
  content: string
  fileName: string
}

interface AppContextValue {
  ready: boolean
  userEmail: string | null
  workspaces: Workspace[]
  activeWorkspaceId: number | null
  activeWorkspace: Workspace | null
  docs: DocNode[]
  folders: FolderInfo[]
  memberships: FolderMembership[]
  activeDocId: number | null
  activeDoc: DocNode | null
  activeDocContent: string
  saveStatus: SaveStatus
  error: string | null
  login: (email: string, password: string) => Promise<void>
  register: (email: string, password: string) => Promise<void>
  logout: () => Promise<void>
  createWorkspace: (
    name: string,
    opts?: { description?: string; type?: 'folder' | 'multi'; color_hex?: string; icon_key?: string }
  ) => Promise<void>
  updateWorkspace: (
    id: number,
    patch: {
      name?: string
      description?: string
      type?: 'folder' | 'multi'
      color_hex?: string
      icon_key?: string
    }
  ) => Promise<void>
  deleteWorkspace: (id: number) => Promise<void>
  selectWorkspace: (id: number) => Promise<void>
  linkDocToWorkspace: (workspaceId: number, docId: number) => Promise<void>
  unlinkDocFromWorkspace: (workspaceId: number, docId: number) => Promise<void>
  /** Create a page inside a (folder) workspace, then link it into the active multi-space. */
  createDocInWorkspace: (workspaceId: number, folderId?: number | null) => Promise<void>
  /** Import a file from the user's computer into the active multi-space. */
  importFileIntoMulti: (
    workspaceId: number,
    fileName: string,
    content: string,
    folderId?: number | null
  ) => Promise<void>
  /** Link a file IN PLACE (desktop): keeps its absolute path, no copy into a workspace. */
  importLinkedFileIntoMulti: (
    fileName: string,
    absPath: string,
    content: string,
    folderId?: number | null
  ) => Promise<void>
  /** Multi-space modals: 'link' = add an existing doc, 'create' = pick where to create a new one. */
  multiModal: 'link' | 'create' | null
  /** When creating from a multi-space folder, the folder to file the new doc into. */
  multiModalFolderId: number | null
  /** A file dropped/picked outside the modal (sidebar/home) to preload for import. */
  multiModalFile: File | null
  openMultiModal: (mode: 'link' | 'create', folderId?: number, file?: File) => void
  closeMultiModal: () => void
  createDoc: (folderId?: number) => Promise<void>
  openDoc: (id: number) => Promise<void>
  closeDoc: () => void
  saveDoc: (id: number, markdown: string) => Promise<void>
  renameDoc: (id: number, newTitle: string) => Promise<void>
  deleteDoc: (id: number) => Promise<void>
  createFolder: (
    name: string,
    colorHex: string,
    iconKey: string | null,
    parentFolderId?: number | null
  ) => Promise<void>
  updateFolder: (
    folderId: number,
    patch: { name?: string; color_hex?: string; icon_key?: string }
  ) => Promise<void>
  deleteFolder: (folderId: number) => Promise<void>
  addDocToFolder: (docId: number, folderId: number) => Promise<void>
  removeDocFromFolder: (docId: number, folderId: number) => Promise<void>
  moveDocToFolder: (docId: number, targetFolderId: number, fromFolderId?: number) => Promise<void>
  unfileDoc: (docId: number) => Promise<void>
  moveFolder: (folderId: number, parentFolderId: number | null) => Promise<void>
  reorderFolders: (folderIds: number[], parentFolderId?: number | null) => Promise<void>
  refreshTree: () => Promise<void>
  dismissError: () => void
  /** A file opened directly from disk (not in any workspace). null = none. */
  quickOpenFile: QuickOpenFile | null
  /** Save content back to the quick-opened file on disk. */
  saveQuickFile: (content: string) => Promise<void>
  /** Close the quick-opened file (back to workspace view). */
  closeQuickOpen: () => void
  /** Add the quick-opened file to a multi-space. */
  addToMultiFromQuick: (multiWsId: number) => Promise<void>
}

const AppContext = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [ready, setReady] = useState(false)
  const [userEmail, setUserEmail] = useState<string | null>(null)
  const [workspaces, setWorkspaces] = useState<Workspace[]>([])
  const [activeWorkspaceId, setActiveWorkspaceId] = useState<number | null>(null)
  const [docs, setDocs] = useState<DocNode[]>([])
  const [folders, setFolders] = useState<FolderInfo[]>([])
  const [memberships, setMemberships] = useState<FolderMembership[]>([])
  const [activeDocId, setActiveDocId] = useState<number | null>(null)
  const [activeDocContent, setActiveDocContent] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [quickOpenFile, setQuickOpenFile] = useState<QuickOpenFile | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [multiModal, setMultiModal] = useState<'link' | 'create' | null>(null)
  const [multiModalFolderId, setMultiModalFolderId] = useState<number | null>(null)
  const [multiModalFile, setMultiModalFile] = useState<File | null>(null)

  const docsRef = useRef<DocNode[]>([])
  docsRef.current = docs

  const membershipsRef = useRef<FolderMembership[]>([])
  membershipsRef.current = memberships

  const currentEmailRef = useRef<string | null>(null)
  const externalDocsRef = useRef<Set<number>>(new Set())
  const openFilesQueueRef = useRef<string[]>([])

  // Docs opened "in place" from disk (not inside any synced folder) keep their
  // saves cloud-only — we never materialize a stray local copy for them.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(EXTERNAL_DOCS_KEY)
      if (raw) externalDocsRef.current = new Set<number>(JSON.parse(raw))
    } catch {
      // ignore corrupt storage
    }
  }, [])

  const markExternalDoc = useCallback((id: number) => {
    externalDocsRef.current.add(id)
    try {
      localStorage.setItem(EXTERNAL_DOCS_KEY, JSON.stringify([...externalDocsRef.current]))
    } catch {}
  }, [])

  const isExternalDoc = useCallback((id: number) => externalDocsRef.current.has(id), [])

  const applyTree = useCallback((tree: { docs: DocNode[]; folders: FolderInfo[]; memberships: FolderMembership[] }) => {
    setDocs(tree.docs)
    setFolders(tree.folders)
    setMemberships(tree.memberships)
  }, [])

  const loadWorkspaces = useCallback(async (): Promise<void> => {
    const { workspaces: list } = await api.listWorkspaces()
    setWorkspaces(list)
    if (list.length > 0) {
      const preferred = list[0]
      setActiveWorkspaceId(preferred.id)
      applyTree(await api.tree(preferred.id))
    } else {
      setDocs([])
      setFolders([])
      setMemberships([])
    }
  }, [applyTree])

  const handleUnauthorized = useCallback(() => {
    setUserEmail(null)
    setActiveDocId(null)
    setDocs([])
    setFolders([])
    setMemberships([])
  }, [])

  useEffect(() => {
    window.addEventListener('moondash:unauthorized', handleUnauthorized)
    return () => window.removeEventListener('moondash:unauthorized', handleUnauthorized)
  }, [handleUnauthorized])

  // Keep the tree live: poll, refresh on focus, and refresh right after a
  // desktop sync round completes — so files added by the sync engine (or other
  // devices) show up without reloading the app.
  useEffect(() => {
    if (!userEmail || activeWorkspaceId === null) return
    let cancelled = false
    const refresh = () => {
      api
        .tree(activeWorkspaceId)
        .then((tree) => {
          if (!cancelled) applyTree(tree)
        })
        .catch(() => {})
    }
    const interval = window.setInterval(refresh, 20000)
    const onFocus = () => refresh()
    window.addEventListener('focus', onFocus)
    const offStatus = window.moondash?.onStatus?.((s) => {
      if (
        s.state === 'idle' &&
        s.counts &&
        (s.counts.pushed > 0 || s.counts.pulled > 0 || s.counts.conflicts > 0)
      ) {
        refresh()
      }
    })
    return () => {
      cancelled = true
      window.clearInterval(interval)
      window.removeEventListener('focus', onFocus)
      offStatus?.()
    }
  }, [userEmail, activeWorkspaceId, applyTree])

  useEffect(() => {
    void resolveApiBase()
    const token = getToken()
    if (!token) {
      setReady(true)
      return
    }
    loadWorkspaces()
      .then(() => {
        currentEmailRef.current = localStorage.getItem('moondash.email')
        setUserEmail(currentEmailRef.current)
      })
      .catch(() => {
        setToken(null)
      })
      .finally(() => setReady(true))
  }, [loadWorkspaces])

  const login = useCallback(
    async (email: string, password: string) => {
      const result = await api.login(email, password)
      setToken(result.token)
      localStorage.setItem('moondash.email', email)
      currentEmailRef.current = email
      setUserEmail(email)
      await loadWorkspaces()
    },
    [loadWorkspaces]
  )

  const register = useCallback(
    async (email: string, password: string) => {
      const result = await api.register(email, password)
      setToken(result.token)
      localStorage.setItem('moondash.email', email)
      currentEmailRef.current = email
      setUserEmail(email)
      await loadWorkspaces()
    },
    [loadWorkspaces]
  )

  const logout = useCallback(async () => {
    try {
      await api.logout()
    } catch {
      // token is discarded regardless
    }
    setToken(null)
    setUserEmail(null)
    setWorkspaces([])
    setDocs([])
    setFolders([])
    setMemberships([])
    setActiveDocId(null)
    setActiveWorkspaceId(null)
  }, [])

  const selectWorkspace = useCallback(
    async (id: number) => {
      setActiveWorkspaceId(id)
      setActiveDocId(null)
      setActiveDocContent('')
      applyTree(await api.tree(id))
    },
    [applyTree]
  )

  const refreshTree = useCallback(async () => {
    if (activeWorkspaceId === null) return
    applyTree(await api.tree(activeWorkspaceId))
  }, [activeWorkspaceId, applyTree])

  const activeWorkspace = workspaces.find((w) => w.id === activeWorkspaceId) ?? null
  const activeDoc = docs.find((d) => d.id === activeDocId && !d.is_deleted) ?? null

  const loadContent = useCallback(
    async (doc: DocNode): Promise<string> => {
      const bridge = window.moondash
      if (bridge?.isDesktop) {
        // Linked-in-place docs: read the real file at its absolute path.
        if (doc.local_path) {
          const local = await bridge.readExternalFile(doc.local_path)
          if (local !== null) return local
        }
        // Synced folder docs: read the file inside the bound folder.
        if (activeWorkspaceId !== null) {
          try {
            const bindings = await bridge.getBindings()
            const binding = bindings.find((b) => b.workspaceId === activeWorkspaceId)
            if (binding) {
              const local = await bridge.readLocal(binding.workspaceId, doc.relative_path)
              if (local !== null) return local
            }
          } catch {
            // fall through to the cloud copy
          }
        }
      }
      const { doc: detail } = await api.docDetail(doc.id)
      return detail.content ?? ''
    },
    [activeWorkspaceId]
  )

  const openDoc = useCallback(
    async (id: number) => {
      const doc = docsRef.current.find((d) => d.id === id)
      if (!doc) return
      setSaveStatus('idle')
      const content = await loadContent(doc)
      setActiveDocContent(content)
      setActiveDocId(id)
    },
    [loadContent]
  )

  // Back to the workspace home view (activeDoc === null renders WorkspaceHome).
  const closeDoc = useCallback(() => {
    setActiveDocId(null)
    setActiveDocContent('')
  }, [])

  const saveDoc = useCallback(
    async (id: number, markdown: string) => {
      const doc = docsRef.current.find((d) => d.id === id)
      if (!doc) return
      setSaveStatus('saving')
      try {
        const bridge = window.moondash
        // Linked-in-place docs: write the file at its absolute path
        // (offline-first), then mirror to the cloud. If either fails the
        // linked-file engine catches up on its next round (disk change pushed,
        // or cloud change pulled).
        if (bridge?.isDesktop && doc.local_path) {
          try {
            await bridge.writeExternal(doc.local_path, markdown)
          } catch {
            // cloud-only save below still applies
          }
          try {
            await api.updateDoc(id, { content: markdown })
          } catch {
            // engine will catch up
          }
        } else {
          const localBinding = bridge?.isDesktop
            ? (await bridge.getBindings()).find((b) => b.workspaceId === activeWorkspaceId)
            : undefined
          if (bridge?.isDesktop && doc.relative_path && localBinding && !isExternalDoc(id)) {
            // Desktop + synced folder: write the local file (offline-first). The
            // folder watcher + sync engine pushes it to the cloud automatically.
            await bridge.writeLocal(localBinding.workspaceId, doc.relative_path, markdown)
          } else {
            await api.updateDoc(id, { content: markdown })
          }
        }
        setSaveStatus('saved')
        setDocs((prev) =>
          prev.map((d) => (d.id === id ? { ...d, updated_at: new Date().toISOString() } : d))
        )
      } catch (e) {
        setSaveStatus('error')
        setError(e instanceof Error ? e.message : 'Could not save')
      }
    },
    [activeWorkspaceId, isExternalDoc]
  )

  const createDoc = useCallback(
    async (folderId?: number) => {
      try {
        // Multi-spaces don't own files — a new page must be created in a
        // folder workspace first, then linked. Route through the picker.
        if (activeWorkspace?.type === 'multi') {
          openMultiModal('create', folderId ?? undefined)
          return
        }
        // First page ever → create a default workspace so the button always works.
        let wsId = activeWorkspaceId
        if (wsId === null) {
          const { workspace_id } = await api.createWorkspace('My Workspace')
          wsId = workspace_id
          await loadWorkspaces()
        }

        const taken = new Set(docsRef.current.map((d) => d.relative_path))
        let name = 'Untitled.md'
        let counter = 1
        while (taken.has(name)) {
          name = `Untitled-${counter}.md`
          counter++
        }
        const { bit_id } = await api.createDoc(wsId, name, '# Untitled\n')
        if (folderId) {
          await api.addFolderMember(folderId, bit_id)
        }
        const bridge = window.moondash
        if (bridge?.isDesktop) {
          try {
            const bindings = await bridge.getBindings()
            const binding = bindings.find((b) => b.workspaceId === wsId)
            if (binding) {
              await bridge.writeLocal(binding.workspaceId, name, '# Untitled\n')
            }
          } catch {
            // cloud-only is fine
          }
        }
        await refreshTree()
        await openDoc(bit_id)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not create the page')
      }
    },
    [activeWorkspace, activeWorkspaceId, loadWorkspaces, openDoc, refreshTree]
  )

  const renameDoc = useCallback(
    async (id: number, newTitle: string) => {
      const doc = docsRef.current.find((d) => d.id === id)
      if (!doc || !newTitle.trim()) return
      // Linked-in-place docs keep their file path frozen (the file lives at an
      // absolute path on disk) — only the display title may change.
      if (doc.local_path) {
        if (doc.title === newTitle.trim()) return
        await api.updateDoc(id, { title: newTitle.trim() })
        await refreshTree()
        return
      }
      const dir = doc.relative_path.includes('/')
        ? doc.relative_path.slice(0, doc.relative_path.lastIndexOf('/') + 1)
        : ''
      // Keep the file's actual extension (.md, .markdown, .txt, …).
      const base = doc.relative_path.slice(doc.relative_path.lastIndexOf('/') + 1)
      const dot = base.lastIndexOf('.')
      const ext = dot > 0 ? base.slice(dot) : ''
      const newPath = `${dir}${newTitle.trim()}${ext}`
      if (newPath === doc.relative_path) return
      await api.updateDoc(id, { relative_path: newPath, title: newTitle.trim() })
      const bridge = window.moondash
      const localBinding = bridge?.isDesktop
        ? (await bridge.getBindings()).find((b) => b.workspaceId === activeWorkspaceId)
        : undefined
      if (bridge?.isDesktop && localBinding && !isExternalDoc(id)) {
        try {
          await bridge.renameLocal(localBinding.workspaceId, doc.relative_path, newPath)
        } catch {
          // cloud rename still applies
        }
      }
      await refreshTree()
    },
    [activeWorkspaceId, isExternalDoc, refreshTree]
  )

  const deleteDoc = useCallback(
    async (id: number) => {
      const doc = docsRef.current.find((d) => d.id === id)
      await api.deleteDoc(id)
      const bridge = window.moondash
      const localBinding = bridge?.isDesktop
        ? (await bridge.getBindings()).find((b) => b.workspaceId === activeWorkspaceId)
        : undefined
      if (bridge?.isDesktop && doc?.relative_path && localBinding && !isExternalDoc(id)) {
        try {
          await bridge.deleteLocal(localBinding.workspaceId, doc.relative_path)
        } catch {
          // cloud delete still applies
        }
      }
      if (isExternalDoc(id)) {
        externalDocsRef.current.delete(id)
        try {
          localStorage.setItem(EXTERNAL_DOCS_KEY, JSON.stringify([...externalDocsRef.current]))
        } catch {}
      }
      if (activeDocId === id) {
        setActiveDocId(null)
        setActiveDocContent('')
      }
      await refreshTree()
    },
    [activeDocId, activeWorkspaceId, isExternalDoc, refreshTree]
  )

  const createWorkspace = useCallback(
    async (
      name: string,
      opts?: { description?: string; type?: 'folder' | 'multi'; color_hex?: string; icon_key?: string }
    ) => {
      const { workspace_id } = await api.createWorkspace(name, opts)
      await loadWorkspaces()
      await selectWorkspace(workspace_id)
    },
    [loadWorkspaces, selectWorkspace]
  )

  const deleteWorkspace = useCallback(
    async (id: number) => {
      await api.deleteWorkspace(id)
      if (activeWorkspaceId === id) {
        setActiveDocId(null)
        setActiveDocContent('')
      }
      await loadWorkspaces()
    },
    [activeWorkspaceId, loadWorkspaces]
  )

  const run = useCallback(async (fn: () => Promise<void>) => {
    try {
      await fn()
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Something went wrong')
    }
  }, [])

  const updateWorkspace = useCallback(
    async (
      id: number,
      patch: { name?: string; description?: string; color_hex?: string; icon_key?: string }
    ) => {
      await run(async () => {
        await api.updateWorkspace(id, patch)
        // JSON serialization drops undefined fields before they hit the wire,
        // so mirror that here — otherwise a cleared name would blank the
        // workspace locally while the server keeps the old value.
        const clean = Object.fromEntries(
          Object.entries(patch).filter(([, v]) => v !== undefined)
        )
        setWorkspaces((prev) =>
          prev.map((w) =>
            w.id === id ? { ...w, ...clean, updated_at: new Date().toISOString() } : w
          )
        )
      })
    },
    [run]
  )

  const linkDocToWorkspace = useCallback(
    async (workspaceId: number, docId: number) => {
      await run(async () => {
        await api.linkDoc(workspaceId, docId)
        await refreshTree()
      })
    },
    [refreshTree, run]
  )

  const unlinkDocFromWorkspace = useCallback(
    async (workspaceId: number, docId: number) => {
      await run(async () => {
        await api.unlinkDoc(workspaceId, docId)
        await refreshTree()
      })
    },
    [refreshTree, run]
  )

  // "New page" inside a multi-space: create the file in the chosen (folder)
  // workspace — so it has a real home and syncs to disk there — then link the
  // new bit into the active multi-space (optionally filing it into a
  // multi-space folder) and open it.
  const createDocInWorkspace = useCallback(
    async (workspaceId: number, folderId?: number | null) => {
      if (activeWorkspaceId === null) return
      await run(async () => {
        const tree = await api.tree(workspaceId)
        const taken = new Set(tree.docs.filter((d) => !d.is_deleted).map((d) => d.relative_path))
        let name = 'Untitled.md'
        let counter = 1
        while (taken.has(name)) {
          name = `Untitled-${counter}.md`
          counter++
        }
        const { bit_id } = await api.createDoc(workspaceId, name, '# Untitled\n')
        const bridge = window.moondash
        if (bridge?.isDesktop) {
          try {
            const bindings = await bridge.getBindings()
            const binding = bindings.find((b) => b.workspaceId === workspaceId)
            if (binding) await bridge.writeLocal(binding.workspaceId, name, '# Untitled\n')
          } catch {
            // cloud-only is fine
          }
        }
        if (folderId != null) await api.addFolderMember(folderId, bit_id)
        await api.linkDoc(activeWorkspaceId, bit_id)
        await refreshTree()
        await openDoc(bit_id)
      })
    },
    [activeWorkspaceId, openDoc, refreshTree, run]
  )

  // "Add a document" → import a file from the user's computer: the content is
  // read client-side, the doc gets a real home in the chosen (folder) workspace
  // (written to disk too when that workspace is bound to a local folder), then
  // it's linked into the active multi-space and filed into the folder the modal
  // was opened from (if any).
  const importFileIntoMulti = useCallback(
    async (workspaceId: number, fileName: string, content: string, folderId?: number | null) => {
      if (activeWorkspaceId === null) return
      await run(async () => {
        const tree = await api.tree(workspaceId)
        const taken = new Set(tree.docs.filter((d) => !d.is_deleted).map((d) => d.relative_path))
        const dot = fileName.lastIndexOf('.')
        const stem = dot > 0 ? fileName.slice(0, dot) : fileName
        const ext = dot > 0 ? fileName.slice(dot) : ''
        let name = fileName
        let counter = 1
        while (taken.has(name)) {
          name = `${stem}-${counter}${ext}`
          counter++
        }
        const { bit_id } = await api.createDoc(workspaceId, name, content)
        const bridge = window.moondash
        if (bridge?.isDesktop) {
          try {
            const bindings = await bridge.getBindings()
            const binding = bindings.find((b) => b.workspaceId === workspaceId)
            if (binding) await bridge.writeLocal(binding.workspaceId, name, content)
          } catch {
            // cloud-only is fine
          }
        }
        if (folderId != null) await api.addFolderMember(folderId, bit_id)
        await api.linkDoc(activeWorkspaceId, bit_id)
        await refreshTree()
        await openDoc(bit_id)
      })
    },
    [activeWorkspaceId, openDoc, refreshTree, run]
  )

  // "Add a document" → link a file IN PLACE (desktop only): the doc is created
  // in the user's hidden external workspace with its absolute path recorded, so
  // it stays exactly where it lives on disk. Edits in the app write straight to
  // that file, and the desktop linked-file engine mirrors disk changes back.
  const importLinkedFileIntoMulti = useCallback(
    async (fileName: string, absPath: string, content: string, folderId?: number | null) => {
      if (activeWorkspaceId === null) return
      await run(async () => {
        const { workspace_id: externalWsId, entries } = await api.externalSync()
        const taken = new Set(
          entries.filter((e) => !e.is_deleted).map((e) => e.relative_path)
        )
        const dot = fileName.lastIndexOf('.')
        const stem = dot > 0 ? fileName.slice(0, dot) : fileName
        const ext = dot > 0 ? fileName.slice(dot) : ''
        let name = fileName
        let counter = 1
        while (taken.has(name)) {
          name = `${stem}-${counter}${ext}`
          counter++
        }
        const { bit_id } = await api.createDoc(externalWsId, name, content, absPath)
        if (folderId != null) await api.addFolderMember(folderId, bit_id)
        await api.linkDoc(activeWorkspaceId, bit_id)
        await refreshTree()
        await openDoc(bit_id)
      })
    },
    [activeWorkspaceId, openDoc, refreshTree, run]
  )

  const openMultiModal = useCallback(
    (mode: 'link' | 'create', folderId?: number, file?: File) => {
      setMultiModalFolderId(folderId ?? null)
      setMultiModalFile(file ?? null)
      setMultiModal(mode)
    },
    []
  )
  const closeMultiModal = useCallback(() => {
    setMultiModal(null)
    setMultiModalFolderId(null)
    setMultiModalFile(null)
  }, [])

  const createFolder = useCallback(
    async (name: string, colorHex: string, iconKey: string | null, parentFolderId?: number | null) => {
      await run(async () => {
        let wsId = activeWorkspaceId
        if (wsId === null) {
          const { workspace_id } = await api.createWorkspace('My Workspace')
          wsId = workspace_id
          await loadWorkspaces()
        }
        await api.createFolder(wsId, name, colorHex, iconKey, parentFolderId ?? null)
        await refreshTree()
      })
    },
    [activeWorkspaceId, loadWorkspaces, refreshTree, run]
  )

  const updateFolder = useCallback(
    async (folderId: number, patch: { name?: string; color_hex?: string; icon_key?: string }) => {
      await run(async () => {
        await api.updateFolder(folderId, patch)
        await refreshTree()
      })
    },
    [refreshTree, run]
  )

  const deleteFolder = useCallback(
    async (folderId: number) => {
      await run(async () => {
        await api.deleteFolder(folderId)
        await refreshTree()
      })
    },
    [refreshTree, run]
  )

  const addDocToFolder = useCallback(
    async (docId: number, folderId: number) => {
      await run(async () => {
        await api.addFolderMember(folderId, docId)
        await refreshTree()
      })
    },
    [refreshTree, run]
  )

  const removeDocFromFolder = useCallback(
    async (docId: number, folderId: number) => {
      await run(async () => {
        await api.removeFolderMember(folderId, docId)
        await refreshTree()
      })
    },
    [refreshTree, run]
  )

  const moveDocToFolder = useCallback(
    async (docId: number, targetFolderId: number, fromFolderId?: number) => {
      await run(async () => {
        // Add first so a failure never leaves the doc stranded outside its
        // original folder (remove is the safe second step).
        await api.addFolderMember(targetFolderId, docId)
        if (fromFolderId && fromFolderId !== targetFolderId) {
          await api.removeFolderMember(fromFolderId, docId)
        }
        await refreshTree()
      })
    },
    [refreshTree, run]
  )

  const unfileDoc = useCallback(
    async (docId: number) => {
      await run(async () => {
        const rels = membershipsRef.current.filter((m) => m.item_id === docId)
        for (const rel of rels) {
          await api.removeFolderMember(rel.folder_id, docId)
        }
        await refreshTree()
      })
    },
    [refreshTree, run]
  )

  const moveFolder = useCallback(
    async (folderId: number, parentFolderId: number | null) => {
      await run(async () => {
        await api.moveFolder(folderId, parentFolderId)
        await refreshTree()
      })
    },
    [refreshTree, run]
  )

  const reorderFolders = useCallback(
    async (folderIds: number[], parentFolderId?: number | null) => {
      if (activeWorkspaceId === null) return
      await run(async () => {
        await api.reorderFolders(activeWorkspaceId, folderIds, parentFolderId ?? null)
        await refreshTree()
      })
    },
    [activeWorkspaceId, refreshTree, run]
  )

  const openFileFromDisk = useCallback(
    async (absPath: string) => {
      const bridge = window.moondash
      if (!bridge) return
      const content = await bridge.readExternalFile(absPath)
      if (content === null) {
        setError('Could not read that file')
        return
      }
      try {
        const hit = await bridge.whichBinding(absPath)
        const base = absPath.split(/[\\/]/).pop() || 'Untitled.md'

        // If the file lives inside a bound workspace folder, open it
        // through the normal workspace/doc flow.
        if (hit) {
          const wsId = hit.binding.workspaceId
          const rel = hit.relativePath
          if (activeWorkspaceId !== wsId) await selectWorkspace(wsId)
          let tree = await api.tree(wsId)
          const existing = tree.docs.find((d) => !d.is_deleted && d.relative_path === rel)
          let bitId: number
          if (existing) {
            bitId = existing.id
          } else {
            const { bit_id } = await api.createDoc(wsId, rel, content)
            bitId = bit_id
          }
          tree = await api.tree(wsId)
          const finalDoc = tree.docs.find((d) => d.id === bitId)
          applyTree(tree)
          if (!finalDoc) {
            const node: DocNode = {
              id: bitId,
              relative_path: rel,
              content_hash: '',
              revision: 1,
              is_deleted: 0,
              title: titleFromRel(rel),
              content_preview: null,
              created_at: new Date().toISOString(),
              updated_at: new Date().toISOString()
            }
            setDocs((prev) => (prev.some((d) => d.id === bitId) ? prev : [...prev, node]))
          }
          setActiveDocContent(content)
          setActiveDocId(bitId)
          return
        }

        // ── Quick-open mode ──
        // The file is NOT inside any bound workspace.  Open it for
        // reading/editing directly from disk without creating a server-side
        // doc.  The user can later add it to a multi-space from the banner.
        setQuickOpenFile({ absPath, content, fileName: base })
        setActiveDocContent(content)
        // Clear any active workspace doc so the editor renders the
        // quick-open view instead of the normal doc view.
        setActiveDocId(null)
      } catch (e) {
        setError(e instanceof Error ? e.message : 'Could not open the file')
      }
    },
    [activeWorkspaceId, applyTree, selectWorkspace]
  )

  // ── Quick-open helpers ──────────────────────────────────────────
  const saveQuickFile = useCallback(
    async (content: string) => {
      const qf = quickOpenFile
      if (!qf) return
      const bridge = window.moondash
      if (!bridge) {
        setError('Cannot save — not running in Electron')
        return
      }
      await bridge.writeExternal(qf.absPath, content)
      setQuickOpenFile((prev) => (prev ? { ...prev, content } : null))
    },
    [quickOpenFile]
  )

  const closeQuickOpen = useCallback(() => {
    setQuickOpenFile(null)
    setActiveDocContent('')
  }, [])

  const addToMultiFromQuick = useCallback(
    async (multiWsId: number) => {
      const qf = quickOpenFile
      if (!qf) return
      await run(async () => {
        const { workspace_id: externalWsId } = await api.externalSync()
        const base = qf.fileName
        const dot = base.lastIndexOf('.')
        const stem = dot > 0 ? base.slice(0, dot) : base
        const ext = dot > 0 ? base.slice(dot) : ''
        // Check for name collision in the external workspace
        const extTree = await api.tree(externalWsId)
        const taken = new Set(extTree.docs.filter((d) => !d.is_deleted).map((d) => d.relative_path))
        let name = base
        let counter = 1
        while (taken.has(name)) {
          name = `${stem}-${counter}${ext}`
          counter++
        }
        const { bit_id } = await api.createDoc(externalWsId, name, qf.content, qf.absPath)
        await api.linkDoc(multiWsId, bit_id)
        // Switch to the multi-space and open the new doc
        await selectWorkspace(multiWsId)
        await refreshTree()
        await openDoc(bit_id)
        setQuickOpenFile(null)
      })
    },
    [quickOpenFile, openDoc, refreshTree, run, selectWorkspace]
  )

  // "Open with Moondash": a .md/.markdown file was double-clicked in Windows.
  // Process it now, or queue it until the user is signed in.
  useEffect(() => {
    const runFiles = (files: string[]) => {
      void (async () => {
        for (const f of files) {
          try {
            await openFileFromDisk(f)
          } catch {
            // openFileFromDisk surfaces its own error toast
          }
        }
      })()
    }
    if (!window.moondash) return
    if (userEmail) {
      if (openFilesQueueRef.current.length > 0) runFiles(openFilesQueueRef.current.splice(0))
      // Flush any files the main process queued before React was ready.
      window.moondash.pullOpenFiles().then((files) => {
        if (files.length > 0) runFiles(files)
      })
      const off = window.moondash.onOpenFiles(runFiles)
      return () => off()
    }
    const off = window.moondash.onOpenFiles((files) => {
      openFilesQueueRef.current.push(...files)
    })
    return () => off()
  }, [userEmail, openFileFromDisk])

  const dismissError = useCallback(() => setError(null), [])

  const value: AppContextValue = {
    ready,
    userEmail,
    workspaces,
    activeWorkspaceId,
    activeWorkspace,
    docs,
    folders,
    memberships,
    activeDocId,
    activeDoc,
    activeDocContent,
    saveStatus,
    error,
    login,
    register,
    logout,
    createWorkspace,
    updateWorkspace,
    deleteWorkspace,
    selectWorkspace,
    linkDocToWorkspace,
    unlinkDocFromWorkspace,
    createDocInWorkspace,
    importFileIntoMulti,
    importLinkedFileIntoMulti,
    multiModal,
    multiModalFolderId,
    multiModalFile,
    openMultiModal,
    closeMultiModal,
    createDoc,
    openDoc,
    closeDoc,
    saveDoc,
    renameDoc,
    deleteDoc,
    createFolder,
    updateFolder,
    deleteFolder,
    addDocToFolder,
    removeDocFromFolder,
    moveDocToFolder,
    unfileDoc,
    moveFolder,
    reorderFolders,
    refreshTree,
    dismissError,
    quickOpenFile,
    saveQuickFile,
    closeQuickOpen,
    addToMultiFromQuick
  }

  return <AppContext.Provider value={value}>{children}</AppContext.Provider>
}

export function useApp(): AppContextValue {
  const ctx = useContext(AppContext)
  if (!ctx) throw new Error('useApp must be used inside AppProvider')
  return ctx
}

import { invoke } from '@tauri-apps/api/core'
import { useEffect, useMemo, useState, type ChangeEvent } from 'react'

import './App.css'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: unknown
    }
  }
}

const folders = [
  { name: 'Inbox', count: 14, active: true },
  { name: 'Projects', count: 8 },
  { name: 'Topics', count: 23 },
  { name: 'Archive', count: 41 },
]

const tags = ['#design-system', '#nas-sync', '#vibe-coding', '#weekly-review']

const backlinks = ['[[Desktop MVP]]', '[[Storage Strategy]]', '[[Editor Benchmarks]]']

const outgoingLinks = ['[[Knowledge Base Shape]]', '[[UGREEN NAS Flow]]', '[[Search Experience]]']

const STORAGE_KEY = 'notebase:nas-profile'
const MOUNT_STATE_KEY = 'notebase:mount-state'
const LIBRARY_OVERVIEW_KEY = 'notebase:library-overview'
const KNOWLEDGE_BASE_INDEX_KEY = 'notebase:knowledge-base-index'
const SELECTED_NOTE_KEY = 'notebase:selected-note-id'
const INVOKE_TIMEOUT_MS = 12000

type MountStatus = 'checking' | 'mounting' | 'mounted' | 'degraded' | 'failed'

type NasProfile = {
  profileName: string
  protocol: 'http' | 'https'
  publicHost: string
  publicPort: string
  username: string
  password: string
  remotePath: string
  libraryPath: string
}

type MountResponse = {
  status: MountStatus
  mounted: boolean
  mountPoint: string
  resolvedStoragePath: string
  webdavUrl: string
  message: string
  profileName: string
}

type LibraryOverview = {
  resolvedStoragePath: string
  exists: boolean
  readable: boolean
  directoryCount: number
  fileCount: number
  sampleEntries: string[]
  message: string
}

type RealNoteSummary = {
  id: string
  title: string
  relativePath: string
  folder: string
  summary: string
  updatedAtMs: number | null
  tags: string[]
  format: string
}

type KnowledgeBaseIndex = {
  rootPath: string
  notesRoot: string
  assetsRoot: string
  hiddenRoot: string
  initializedNewKnowledgeBase: boolean
  notes: RealNoteSummary[]
  message: string
}

type CreateNoteResponse = {
  note: RealNoteSummary
  message: string
}

type NoteDocument = {
  note: RealNoteSummary
  rawContent: string
  frontmatter: string | null
  body: string
  message: string
}

const defaultNasProfile: NasProfile = {
  profileName: 'UGREEN home data',
  protocol: 'http',
  publicHost: '47.103.114.153',
  publicPort: '',
  username: '',
  password: '',
  remotePath: '//home/data',
  libraryPath: 'notes/notebase',
}

const statusLabels: Record<MountStatus, string> = {
  checking: 'Checking mount',
  mounting: 'Reconnecting storage',
  mounted: 'Storage mounted',
  degraded: 'Mounted with missing library path',
  failed: 'Storage unavailable',
}

const normalizeLibraryPath = (libraryPath: string) => libraryPath.replace(/^\/+|\/+$/g, '')
const formatRelativeDate = (updatedAtMs: number | null) => {
  if (!updatedAtMs) {
    return 'No timestamp'
  }

  return new Intl.DateTimeFormat('en', {
    month: 'short',
    day: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(new Date(updatedAtMs))
}

const normalizeRemotePath = (remotePath: string) => {
  const trimmed = remotePath.trim()
  if (!trimmed) {
    return '//'
  }

  return `//${trimmed.replace(/^\/+/, '')}`
}

const deriveMountedVolumeName = (remotePath: string) => {
  const trimmed = normalizeRemotePath(remotePath).replace(/^\/+/, '')
  const segments = trimmed.split('/').filter(Boolean)
  return segments.at(-1) ?? 'WebDAV'
}

const buildMountPoint = (remotePath: string) => `/Volumes/${deriveMountedVolumeName(remotePath)}`

const buildResolvedStoragePath = (remotePath: string, libraryPath: string) => {
  const mountPoint = buildMountPoint(remotePath)
  const normalizedLibraryPath = normalizeLibraryPath(libraryPath)

  return normalizedLibraryPath ? `${mountPoint}/${normalizedLibraryPath}` : mountPoint
}

const buildWebdavUrl = (profile: NasProfile) => {
  const protocol = profile.protocol === 'https' ? 'https' : 'http'
  const credentials = profile.username
    ? `${profile.username}${profile.password ? `:${profile.password}` : ''}@`
    : ''
  const portSegment = profile.publicPort.trim() ? `:${profile.publicPort.trim()}` : ''

  return `${protocol}://${credentials}${profile.publicHost.trim()}${portSegment}${normalizeRemotePath(profile.remotePath)}`
}

const buildMaskedWebdavUrl = (profile: NasProfile) => {
  const protocol = profile.protocol === 'https' ? 'https' : 'http'
  const username = profile.username.trim()
  const credentials = username ? `${username}:••••@` : ''
  const portSegment = profile.publicPort.trim() ? `:${profile.publicPort.trim()}` : ''

  return `${protocol}://${credentials}${profile.publicHost.trim()}${portSegment}${normalizeRemotePath(profile.remotePath)}`
}

const isTauriRuntime = () =>
  typeof window !== 'undefined' &&
  typeof window.__TAURI_INTERNALS__?.invoke === 'function'

const loadStoredValue = <T,>(key: string, fallback: T): T => {
  if (typeof window === 'undefined') {
    return fallback
  }

  const raw = window.localStorage.getItem(key)
  if (!raw) {
    return fallback
  }

  try {
    return JSON.parse(raw) as T
  } catch {
    return fallback
  }
}

const invokeWithTimeout = async <T,>(command: string, payload: Record<string, unknown>) =>
  await Promise.race([
    invoke<T>(command, payload),
    new Promise<T>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(`Timed out while waiting for ${command}.`))
      }, INVOKE_TIMEOUT_MS)
    }),
  ])

const loadStoredProfile = (): NasProfile => {
  if (typeof window === 'undefined') {
    return defaultNasProfile
  }

  const raw = window.localStorage.getItem(STORAGE_KEY)
  if (!raw) {
    return defaultNasProfile
  }

  try {
    const parsed = JSON.parse(raw) as Partial<NasProfile>
    return {
      ...defaultNasProfile,
      ...parsed,
      protocol: parsed.protocol === 'https' ? 'https' : 'http',
    }
  } catch {
    return defaultNasProfile
  }
}

function App() {
  const [nasConfig, setNasConfig] = useState<NasProfile>(() => loadStoredProfile())
  const [mountState, setMountState] = useState<MountResponse>(() =>
    loadStoredValue(MOUNT_STATE_KEY, {
    status: 'checking',
    mounted: false,
    mountPoint: buildMountPoint(defaultNasProfile.remotePath),
    resolvedStoragePath: buildResolvedStoragePath(defaultNasProfile.remotePath, defaultNasProfile.libraryPath),
    webdavUrl: buildWebdavUrl(defaultNasProfile),
    message: 'Checking mount state for the current NAS profile.',
    profileName: defaultNasProfile.profileName,
  }))
  const [libraryOverview, setLibraryOverview] = useState<LibraryOverview>(() =>
    loadStoredValue(LIBRARY_OVERVIEW_KEY, {
    resolvedStoragePath: buildResolvedStoragePath(defaultNasProfile.remotePath, defaultNasProfile.libraryPath),
    exists: false,
    readable: false,
    directoryCount: 0,
    fileCount: 0,
    sampleEntries: [],
    message: 'Waiting for a mounted knowledge base path before reading the directory.',
  }))
  const [knowledgeBaseIndex, setKnowledgeBaseIndex] = useState<KnowledgeBaseIndex>(() =>
    loadStoredValue(KNOWLEDGE_BASE_INDEX_KEY, {
    rootPath: buildResolvedStoragePath(defaultNasProfile.remotePath, defaultNasProfile.libraryPath),
    notesRoot: `${buildResolvedStoragePath(defaultNasProfile.remotePath, defaultNasProfile.libraryPath)}/notes`,
    assetsRoot: `${buildResolvedStoragePath(defaultNasProfile.remotePath, defaultNasProfile.libraryPath)}/assets`,
    hiddenRoot: `${buildResolvedStoragePath(defaultNasProfile.remotePath, defaultNasProfile.libraryPath)}/.notebase`,
    initializedNewKnowledgeBase: false,
    notes: [],
    message: 'Waiting for a reachable knowledge base before indexing notes.',
  }))
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(() =>
    loadStoredValue<string | null>(SELECTED_NOTE_KEY, null),
  )
  const [selectedNoteDocument, setSelectedNoteDocument] = useState<NoteDocument | null>(null)

  const normalizedLibraryPath = useMemo(
    () => normalizeLibraryPath(nasConfig.libraryPath),
    [nasConfig.libraryPath],
  )
  const resolvedStoragePath = useMemo(
    () => buildResolvedStoragePath(nasConfig.remotePath, nasConfig.libraryPath),
    [nasConfig.remotePath, nasConfig.libraryPath],
  )
  const webdavUrl = useMemo(() => buildWebdavUrl(nasConfig), [nasConfig])
  const maskedWebdavUrl = useMemo(() => buildMaskedWebdavUrl(nasConfig), [nasConfig])
  const derivedMountPoint = useMemo(() => buildMountPoint(nasConfig.remotePath), [nasConfig.remotePath])
  const runningInTauri = useMemo(() => isTauriRuntime(), [])

  useEffect(() => {
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify(nasConfig))
  }, [nasConfig])

  useEffect(() => {
    window.localStorage.setItem(MOUNT_STATE_KEY, JSON.stringify(mountState))
  }, [mountState])

  useEffect(() => {
    window.localStorage.setItem(LIBRARY_OVERVIEW_KEY, JSON.stringify(libraryOverview))
  }, [libraryOverview])

  useEffect(() => {
    window.localStorage.setItem(KNOWLEDGE_BASE_INDEX_KEY, JSON.stringify(knowledgeBaseIndex))
  }, [knowledgeBaseIndex])

  useEffect(() => {
    window.localStorage.setItem(SELECTED_NOTE_KEY, JSON.stringify(selectedNoteId))
  }, [selectedNoteId])

  const handleConfigChange =
    (field: keyof NasProfile) => (event: ChangeEvent<HTMLInputElement>) => {
      setNasConfig((current) => ({
        ...current,
        [field]: event.target.value,
      }))
    }

  const handleProtocolChange = (protocol: NasProfile['protocol']) => {
    setNasConfig((current) => ({
      ...current,
      protocol,
    }))
  }

  const syncMountState = async (mode: 'check' | 'mount', withTransition = true) => {
    const nextStatus: MountStatus = mode === 'mount' ? 'mounting' : 'checking'

    if (!runningInTauri) {
      setMountState({
        status: 'failed',
        mounted: false,
        mountPoint: derivedMountPoint,
        resolvedStoragePath,
        webdavUrl,
        profileName: nasConfig.profileName,
        message:
          mode === 'mount'
            ? 'Reconnect needs the Tauri desktop runtime. This browser preview cannot call the macOS system WebDAV mount flow.'
            : 'Check needs the Tauri desktop runtime. This browser preview cannot test the mounted path or native WebDAV mount.',
      })
      return
    }

    if (withTransition) {
      setMountState((current) => ({
        ...current,
        status: nextStatus,
        mounted: false,
        message:
          mode === 'mount'
            ? 'Trying the system WebDAV mount flow on macOS.'
            : 'Checking whether the mounted knowledge base path is reachable.',
        mountPoint: derivedMountPoint,
        resolvedStoragePath,
        webdavUrl,
        profileName: nasConfig.profileName,
      }))
    }

    try {
      const response = await invokeWithTimeout<MountResponse>(
        mode === 'mount' ? 'attempt_webdav_mount' : 'check_mount_status',
        {
          profile: {
            ...nasConfig,
            remotePath: normalizeRemotePath(nasConfig.remotePath),
            libraryPath: normalizedLibraryPath,
          },
        },
      )

      setMountState(response)
    } catch (error) {
      setMountState({
        status: 'failed',
        mounted: false,
        mountPoint: derivedMountPoint,
        resolvedStoragePath,
        webdavUrl,
        profileName: nasConfig.profileName,
        message: error instanceof Error ? error.message : 'Failed to reach the Tauri mount command.',
      })
    }
  }

  const refreshLibraryOverview = async (profile: NasProfile = nasConfig) => {
    if (!runningInTauri) {
      setLibraryOverview({
        resolvedStoragePath: buildResolvedStoragePath(profile.remotePath, profile.libraryPath),
        exists: false,
        readable: false,
        directoryCount: 0,
        fileCount: 0,
        sampleEntries: [],
        message: 'Directory inspection only works inside the Tauri desktop runtime.',
      })
      return
    }

    try {
      const response = await invokeWithTimeout<LibraryOverview>('inspect_knowledge_base', {
        profile: {
          ...profile,
          remotePath: normalizeRemotePath(profile.remotePath),
          libraryPath: normalizeLibraryPath(profile.libraryPath),
        },
      })

      setLibraryOverview(response)
    } catch (error) {
      setLibraryOverview({
        resolvedStoragePath: buildResolvedStoragePath(profile.remotePath, profile.libraryPath),
        exists: false,
        readable: false,
        directoryCount: 0,
        fileCount: 0,
        sampleEntries: [],
        message:
          error instanceof Error
            ? error.message
            : 'Failed to inspect the current knowledge base directory.',
      })
    }
  }

  const refreshNotesIndex = async (profile: NasProfile = nasConfig) => {
    if (!runningInTauri) {
      setKnowledgeBaseIndex({
        rootPath: buildResolvedStoragePath(profile.remotePath, profile.libraryPath),
        notesRoot: `${buildResolvedStoragePath(profile.remotePath, profile.libraryPath)}/notes`,
        assetsRoot: `${buildResolvedStoragePath(profile.remotePath, profile.libraryPath)}/assets`,
        hiddenRoot: `${buildResolvedStoragePath(profile.remotePath, profile.libraryPath)}/.notebase`,
        initializedNewKnowledgeBase: false,
        notes: [],
        message: 'Note indexing only works inside the Tauri desktop runtime.',
      })
      return
    }

    try {
      const response = await invokeWithTimeout<KnowledgeBaseIndex>('load_knowledge_base_index', {
        profile: {
          ...profile,
          remotePath: normalizeRemotePath(profile.remotePath),
          libraryPath: normalizeLibraryPath(profile.libraryPath),
        },
      })

      setKnowledgeBaseIndex(response)
      setSelectedNoteId((current) => {
        if (current && response.notes.some((note) => note.id === current)) {
          return current
        }

        return response.notes[0]?.id ?? null
      })
    } catch (error) {
      setKnowledgeBaseIndex({
        rootPath: buildResolvedStoragePath(profile.remotePath, profile.libraryPath),
        notesRoot: `${buildResolvedStoragePath(profile.remotePath, profile.libraryPath)}/notes`,
        assetsRoot: `${buildResolvedStoragePath(profile.remotePath, profile.libraryPath)}/assets`,
        hiddenRoot: `${buildResolvedStoragePath(profile.remotePath, profile.libraryPath)}/.notebase`,
        initializedNewKnowledgeBase: false,
        notes: [],
        message:
          error instanceof Error
            ? error.message
            : 'Failed to load the current knowledge base note index.',
      })
    }
  }

  const loadSelectedNoteDocument = async (noteId: string, profile: NasProfile = nasConfig) => {
    if (!runningInTauri) {
      setSelectedNoteDocument(null)
      return
    }

    try {
      const response = await invokeWithTimeout<NoteDocument>('load_note_document', {
        profile: {
          ...profile,
          remotePath: normalizeRemotePath(profile.remotePath),
          libraryPath: normalizeLibraryPath(profile.libraryPath),
        },
        noteId,
      })

      setSelectedNoteDocument(response)
    } catch (error) {
      setSelectedNoteDocument({
        note: {
          id: noteId,
          title: 'Unable to load note',
          relativePath: noteId,
          folder: 'unknown',
          summary: error instanceof Error ? error.message : 'Failed to load the selected note.',
          updatedAtMs: null,
          tags: [],
          format: 'markdown',
        },
        rawContent: '',
        frontmatter: null,
        body: '',
        message:
          error instanceof Error ? error.message : 'Failed to load the selected note content.',
      })
    }
  }

  const handleCreateNote = async () => {
    if (!runningInTauri) {
      setMountState((current) => ({
        ...current,
        status: 'failed',
        mounted: false,
        message: 'Creating a note needs the Tauri desktop runtime. The browser preview cannot write files.',
      }))
      return
    }

    try {
      const response = await invokeWithTimeout<CreateNoteResponse>('create_note', {
        profile: {
          ...nasConfig,
          remotePath: normalizeRemotePath(nasConfig.remotePath),
          libraryPath: normalizedLibraryPath,
        },
      })

      setSelectedNoteId(response.note.id)
      await loadSelectedNoteDocument(response.note.id)
      setMountState((current) => ({
        ...current,
        status: 'mounted',
        mounted: true,
        message: response.message,
      }))
      await Promise.all([refreshLibraryOverview(), refreshNotesIndex()])
    } catch (error) {
      setMountState((current) => ({
        ...current,
        status: 'failed',
        mounted: false,
        message:
          error instanceof Error ? error.message : 'Failed to create a new note in the knowledge base.',
      }))
    }
  }

  useEffect(() => {
    let cancelled = false

    const checkInitialMountState = async () => {
      if (!runningInTauri) {
        if (!cancelled) {
          setMountState({
            status: 'failed',
            mounted: false,
            mountPoint: derivedMountPoint,
            resolvedStoragePath,
            webdavUrl,
            profileName: nasConfig.profileName,
            message:
              'Browser preview detected. Native mount checks are unavailable here; open the Tauri desktop window to test WebDAV.',
          })
        }
        return
      }

      try {
        const response = await invokeWithTimeout<MountResponse>('check_mount_status', {
          profile: {
            ...nasConfig,
            remotePath: normalizeRemotePath(nasConfig.remotePath),
            libraryPath: normalizedLibraryPath,
          },
        })

        if (!cancelled) {
          setMountState(response)
          if (response.status === 'mounted' || response.status === 'degraded') {
            void refreshLibraryOverview(nasConfig)
          }
        }
      } catch (error) {
        if (!cancelled) {
          setMountState({
            status: 'failed',
            mounted: false,
            mountPoint: derivedMountPoint,
            resolvedStoragePath,
            webdavUrl,
            profileName: nasConfig.profileName,
            message:
              error instanceof Error
                ? error.message
                : 'Failed to reach the Tauri mount command.',
          })
        }
      }
    }

    void checkInitialMountState()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  useEffect(() => {
    let cancelled = false

    if (mountState.status === 'mounted' || mountState.status === 'degraded') {
      const inspectCurrentLibrary = async () => {
        try {
          const [overviewResponse, indexResponse] = await Promise.all([
            invokeWithTimeout<LibraryOverview>('inspect_knowledge_base', {
              profile: {
                ...nasConfig,
                remotePath: normalizeRemotePath(nasConfig.remotePath),
                libraryPath: normalizeLibraryPath(nasConfig.libraryPath),
              },
            }),
            invokeWithTimeout<KnowledgeBaseIndex>('load_knowledge_base_index', {
              profile: {
                ...nasConfig,
                remotePath: normalizeRemotePath(nasConfig.remotePath),
                libraryPath: normalizeLibraryPath(nasConfig.libraryPath),
              },
            }),
          ])

          if (!cancelled) {
            setLibraryOverview(overviewResponse)
            setKnowledgeBaseIndex(indexResponse)
            setSelectedNoteId((current) => {
              if (current && indexResponse.notes.some((note) => note.id === current)) {
                return current
              }

              return indexResponse.notes[0]?.id ?? null
            })
          }
        } catch (error) {
          if (!cancelled) {
            setLibraryOverview({
              resolvedStoragePath: buildResolvedStoragePath(
                nasConfig.remotePath,
                nasConfig.libraryPath,
              ),
              exists: false,
              readable: false,
              directoryCount: 0,
              fileCount: 0,
              sampleEntries: [],
              message:
                error instanceof Error
                  ? error.message
                  : 'Failed to inspect the current knowledge base directory.',
            })
            setKnowledgeBaseIndex({
              rootPath: buildResolvedStoragePath(nasConfig.remotePath, nasConfig.libraryPath),
              notesRoot: `${buildResolvedStoragePath(nasConfig.remotePath, nasConfig.libraryPath)}/notes`,
              assetsRoot: `${buildResolvedStoragePath(nasConfig.remotePath, nasConfig.libraryPath)}/assets`,
              hiddenRoot: `${buildResolvedStoragePath(nasConfig.remotePath, nasConfig.libraryPath)}/.notebase`,
              initializedNewKnowledgeBase: false,
              notes: [],
              message:
                error instanceof Error
                  ? error.message
                  : 'Failed to load the current knowledge base note index.',
            })
          }
        }
      }

      void inspectCurrentLibrary()
    }

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mountState.status, mountState.resolvedStoragePath])

  useEffect(() => {
    if (!selectedNoteId || mountState.status === 'failed' || mountState.status === 'checking' || mountState.status === 'mounting') {
      setSelectedNoteDocument(null)
      return
    }

    void loadSelectedNoteDocument(selectedNoteId)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [selectedNoteId, mountState.status, mountState.resolvedStoragePath])

  const statusTone = mountState.status
  const isBusy = mountState.status === 'checking' || mountState.status === 'mounting'
  const statusPath = mountState.resolvedStoragePath || resolvedStoragePath
  const statusMountPoint = mountState.mountPoint || derivedMountPoint
  const displayedLibraryOverview =
    mountState.status === 'mounted' || mountState.status === 'degraded'
      ? libraryOverview
      : {
          resolvedStoragePath: statusPath,
          exists: false,
          readable: false,
          directoryCount: 0,
          fileCount: 0,
          sampleEntries: [],
          message: 'Knowledge base directory inspection is waiting for a reachable mount.',
        }
  const displayedKnowledgeBaseIndex =
    mountState.status === 'mounted' || mountState.status === 'degraded'
      ? knowledgeBaseIndex
      : {
          rootPath: statusPath,
          notesRoot: `${statusPath}/notes`,
          assetsRoot: `${statusPath}/assets`,
          hiddenRoot: `${statusPath}/.notebase`,
          initializedNewKnowledgeBase: false,
          notes: [],
          message: 'Note indexing is waiting for a reachable knowledge base.',
        }
  const storageExplanation = [
    {
      label: 'Resolved storage target',
      value: statusPath,
      detail: 'This is the local knowledge base root the app will read after the NAS is mounted.',
    },
    {
      label: 'Mount point',
      value: statusMountPoint,
      detail:
        'This is the local macOS folder where WebDAV is expected to appear. It is derived from the last segment of the WebDAV path, and the system may still choose a slightly different final volume name.',
    },
    {
      label: 'WebDAV target',
      value: maskedWebdavUrl,
      detail:
        'This is the remote NAS address used for the native mount attempt. The password is masked in the UI.',
    },
  ]
  const selectedNote =
    displayedKnowledgeBaseIndex.notes.find((note) => note.id === selectedNoteId) ??
    displayedKnowledgeBaseIndex.notes[0] ??
    null
  const selectedNoteBody = selectedNoteDocument?.body.trim() || 'No note body loaded yet.'
  const folderCounts = folders.map((folder) => ({
    ...folder,
    count: displayedKnowledgeBaseIndex.notes.filter((note) =>
      note.folder.toLowerCase().startsWith(folder.name.toLowerCase()),
    ).length,
  }))

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="traffic-lights" aria-hidden="true">
          <span className="traffic red" />
          <span className="traffic yellow" />
          <span className="traffic green" />
        </div>
        <div className="workspace-meta">
          <p className="eyebrow">Personal knowledge base</p>
          <h1>NoteBase</h1>
        </div>
        <label className="search-field" htmlFor="global-search">
          <span>Search notes, tags, links</span>
          <input id="global-search" defaultValue="NAS + editor + backlinks" />
          <kbd>Cmd K</kbd>
        </label>
        <div className={`status-panel status-panel-${statusTone}`}>
          <span className={`status-dot status-dot-${statusTone}`} />
          <div>
            <p className="status-label">{statusLabels[mountState.status]}</p>
            <strong>{mountState.profileName}</strong>
            <span className="status-meta">{statusPath}</span>
          </div>
        </div>
      </header>

      <main className="workspace-grid">
        <aside className="sidebar">
          <button type="button" className="primary-action" onClick={() => void handleCreateNote()}>
            + New note
          </button>

          <section className="nav-section">
            <p className="section-label">Library</p>
            <button type="button" className="nav-item active">
              <span>All notes</span>
              <strong>{displayedKnowledgeBaseIndex.notes.length}</strong>
            </button>
            <button type="button" className="nav-item">
              <span>Recent</span>
              <strong>12</strong>
            </button>
            <button type="button" className="nav-item">
              <span>Favorites</span>
              <strong>9</strong>
            </button>
          </section>

          <section className="nav-section">
            <div className="section-heading">
              <p className="section-label">Folders</p>
              <button type="button" className="ghost-action">
                Manage
              </button>
            </div>
            <div className="stack-list">
              {folderCounts.map((folder) => (
                <button
                  key={folder.name}
                  type="button"
                  className={`stack-item ${folder.active ? 'selected' : ''}`}
                >
                  <span>{folder.name}</span>
                  <strong>{folder.count}</strong>
                </button>
              ))}
            </div>
          </section>

          <section className="nav-section">
            <div className="section-heading">
              <p className="section-label">Tags</p>
              <button type="button" className="ghost-action">
                Merge
              </button>
            </div>
            <div className="tag-cloud">
              {tags.map((tag) => (
                <button key={tag} type="button" className="tag-chip">
                  {tag}
                </button>
              ))}
            </div>
          </section>
        </aside>

        <section className="note-list-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Inbox</p>
              <h2>Knowledge base notes</h2>
            </div>
            <button type="button" className="ghost-action" onClick={() => void refreshNotesIndex()}>
              Refresh index
            </button>
          </div>

          <div className="note-list">
            {displayedKnowledgeBaseIndex.notes.length > 0 ? (
              displayedKnowledgeBaseIndex.notes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={`note-card ${selectedNote?.id === note.id ? 'active' : ''}`}
                  onClick={() => setSelectedNoteId(note.id)}
                >
                  <div className="note-card-top">
                    <strong>{note.title}</strong>
                    <span>{formatRelativeDate(note.updatedAtMs)}</span>
                  </div>
                  <p>{note.summary}</p>
                </button>
              ))
            ) : (
              <div className="empty-note-state">
                <strong>
                  {displayedKnowledgeBaseIndex.initializedNewKnowledgeBase
                    ? 'New knowledge base created'
                    : 'No markdown notes yet'}
                </strong>
                <p>{displayedKnowledgeBaseIndex.message}</p>
                <span>
                  Notes should live under <code>{displayedKnowledgeBaseIndex.notesRoot}</code>.
                </span>
                {displayedKnowledgeBaseIndex.initializedNewKnowledgeBase ? (
                  <span>
                    This folder was empty, so NoteBase initialized a fresh knowledge base here. The
                    next step is to create your first note.
                  </span>
                ) : null}
              </div>
            )}
          </div>
        </section>

        <section className="editor-panel">
          <div className="editor-header">
            <div>
              <p className="section-label">Draft</p>
              <h2>{selectedNote?.title ?? 'No note selected'}</h2>
            </div>
            <div className="view-switcher" role="tablist" aria-label="Editor mode">
              <button type="button" className="view-pill active">
                Markdown
              </button>
              <button type="button" className="view-pill">
                Rich text
              </button>
              <button type="button" className="view-pill">
                Preview
              </button>
            </div>
          </div>

          <div className="toolbar">
            {['H1', 'H2', 'Bold', 'List', 'Quote', 'Code', 'Link', 'Image'].map((item) => (
              <button key={item} type="button" className="tool-button">
                {item}
              </button>
            ))}
          </div>

          <div className="editor-body">
            <article className="editor-surface">
              <p className="meta-line">
                {selectedNote
                  ? `${selectedNote.relativePath} • ${selectedNote.format} • storage target ${statusPath}`
                  : `Knowledge base root • storage target ${statusPath}`}
              </p>
              <div className="writing-block">
                {selectedNote ? (
                  <>
                    <p>## Indexed note overview</p>
                    <p>{selectedNoteDocument?.message ?? selectedNote.summary}</p>
                    <p>- Relative path: {selectedNote.relativePath}</p>
                    <p>- Folder: {selectedNote.folder}</p>
                    <p>- Updated: {formatRelativeDate(selectedNote.updatedAtMs)}</p>
                    <p>
                      - Tags:{' '}
                      {selectedNote.tags.length > 0 ? selectedNote.tags.join(', ') : 'No tags yet'}
                    </p>
                    <p>### Storage model</p>
                    <p>
                      Markdown files are the source of truth. Rich text stays as an editor-layer
                      model, while images and attachments live under the assets directory and are
                      referenced by indexable paths.
                    </p>
                    <p>### Current markdown body</p>
                    <pre className="note-body-preview">{selectedNoteBody}</pre>
                  </>
                ) : (
                  <>
                    <p>## Knowledge base layout</p>
                    <p>{displayedKnowledgeBaseIndex.message}</p>
                    <p>- Knowledge base root: {displayedKnowledgeBaseIndex.rootPath}</p>
                    <p>- Notes root: {displayedKnowledgeBaseIndex.notesRoot}</p>
                    <p>- Assets root: {displayedKnowledgeBaseIndex.assetsRoot}</p>
                    <p>- App metadata: {displayedKnowledgeBaseIndex.hiddenRoot}</p>
                  </>
                )}
              </div>
              <div className="code-block">
                <div className="code-block-top">
                  <span>ts</span>
                  <button type="button">Copy</button>
                </div>
                <pre>{`const knowledgeBase = {\n  rootPath: "${displayedKnowledgeBaseIndex.rootPath}",\n  notesRoot: "${displayedKnowledgeBaseIndex.notesRoot}",\n  assetsRoot: "${displayedKnowledgeBaseIndex.assetsRoot}",\n  hiddenRoot: "${displayedKnowledgeBaseIndex.hiddenRoot}",\n  indexedNotes: ${displayedKnowledgeBaseIndex.notes.length},\n  selectedNote: "${selectedNote?.relativePath ?? '(none)'}",\n}`}</pre>
              </div>
            </article>

            <aside className="preview-surface">
              <p className="section-label">Preview snapshot</p>
              <div className="preview-card">
                <h3>Desktop MVP priorities</h3>
                <ul>
                  <li>Fast local note creation</li>
                  <li>Markdown and rich text in one workspace</li>
                  <li>Backlinks and search that stay visible</li>
                </ul>
              </div>
              <div className={`preview-card soft status-card status-card-${statusTone}`}>
                <p className="section-label">Storage health</p>
                <strong>{statusLabels[mountState.status]}</strong>
                <span>{mountState.message}</span>
              </div>
              <div className="preview-card">
                <p className="section-label">Knowledge base directory</p>
                <strong>
                  {displayedLibraryOverview.readable
                    ? `${displayedLibraryOverview.directoryCount} folders • ${displayedLibraryOverview.fileCount} files`
                    : 'Directory unavailable'}
                </strong>
                <span>{displayedLibraryOverview.message}</span>
              </div>
              <div className="preview-card">
                <p className="section-label">Indexed markdown notes</p>
                <strong>{displayedKnowledgeBaseIndex.notes.length}</strong>
                <span>{displayedKnowledgeBaseIndex.message}</span>
                {displayedKnowledgeBaseIndex.initializedNewKnowledgeBase ? (
                  <span>A fresh knowledge base was initialized in this folder.</span>
                ) : null}
              </div>
            </aside>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Context</p>
              <h2>Linked knowledge</h2>
            </div>
            <button type="button" className="ghost-action">
              Expand
            </button>
          </div>

          <section className="inspector-section">
            <div className="section-heading">
              <p className="section-label">NAS connection</p>
              <div className="inline-actions">
                <button type="button" className="ghost-action" onClick={() => void syncMountState('check')}>
                  Check
                </button>
                <button
                  type="button"
                  className="ghost-action"
                  disabled={isBusy}
                  onClick={() => void syncMountState('mount')}
                >
                  Reconnect
                </button>
              </div>
            </div>
            <div className="nas-config-card">
              <div className="protocol-switcher" role="tablist" aria-label="WebDAV protocol">
                <button
                  type="button"
                  className={`view-pill ${nasConfig.protocol === 'http' ? 'active' : ''}`}
                  onClick={() => handleProtocolChange('http')}
                >
                  HTTP
                </button>
                <button
                  type="button"
                  className={`view-pill ${nasConfig.protocol === 'https' ? 'active' : ''}`}
                  onClick={() => handleProtocolChange('https')}
                >
                  HTTPS
                </button>
              </div>

              <div className="field-grid">
                <label className="config-field">
                  <span>Profile</span>
                  <input
                    value={nasConfig.profileName}
                    onChange={handleConfigChange('profileName')}
                  />
                </label>
                <label className="config-field">
                  <span>Public IP</span>
                  <input value={nasConfig.publicHost} onChange={handleConfigChange('publicHost')} />
                </label>
                <label className="config-field">
                  <span>Port</span>
                  <input value={nasConfig.publicPort} onChange={handleConfigChange('publicPort')} />
                </label>
                <label className="config-field">
                  <span>Username</span>
                  <input value={nasConfig.username} onChange={handleConfigChange('username')} />
                </label>
                <label className="config-field">
                  <span>Password</span>
                  <input
                    type="password"
                    value={nasConfig.password}
                    onChange={handleConfigChange('password')}
                  />
                </label>
                <label className="config-field full-span">
                  <span>Remote WebDAV path</span>
                  <input
                    value={nasConfig.remotePath}
                    onChange={handleConfigChange('remotePath')}
                    placeholder="//home/data"
                  />
                </label>
                <label className="config-field full-span">
                  <span>Knowledge base path</span>
                  <input
                    value={nasConfig.libraryPath}
                    onChange={handleConfigChange('libraryPath')}
                  />
                </label>
                <div className="config-field full-span derived-field">
                  <span>Derived mount point</span>
                  <strong>{derivedMountPoint}</strong>
                </div>
              </div>

              <div className="resolved-path-card">
                {storageExplanation.map((item) => (
                  <div key={item.label} className="storage-explanation-row">
                    <p className="section-label">{item.label}</p>
                    <strong>{item.value}</strong>
                    <span>{item.detail}</span>
                  </div>
                ))}
                <span>{mountState.message}</span>
                {!runningInTauri ? (
                  <span>
                    You are viewing the Vite browser preview. Native WebDAV actions only work in the
                    Tauri desktop runtime.
                  </span>
                ) : null}
              </div>
            </div>
          </section>

          <section className="inspector-section">
            <div className="section-heading">
              <p className="section-label">Knowledge base directory</p>
              <button
                type="button"
                className="ghost-action"
                disabled={mountState.status !== 'mounted' && mountState.status !== 'degraded'}
                onClick={() => void refreshLibraryOverview()}
              >
                Refresh
              </button>
            </div>
            <div className="kb-directory-card">
              <strong>{displayedLibraryOverview.resolvedStoragePath}</strong>
              <p>{displayedLibraryOverview.message}</p>
              <div className="directory-stats">
                <span>Folders {displayedLibraryOverview.directoryCount}</span>
                <span>Files {displayedLibraryOverview.fileCount}</span>
              </div>
              <div className="stack-list compact">
                {displayedLibraryOverview.sampleEntries.length > 0 ? (
                  displayedLibraryOverview.sampleEntries.map((entry) => (
                    <button key={entry} type="button" className="stack-item subtle">
                      {entry}
                    </button>
                  ))
                ) : (
                  <div className="empty-directory-state">No sample entries yet.</div>
                )}
              </div>
            </div>
          </section>

          <section className="inspector-section">
            <div className="section-heading">
              <p className="section-label">Indexed notes</p>
              <button
                type="button"
                className="ghost-action"
                disabled={mountState.status !== 'mounted' && mountState.status !== 'degraded'}
                onClick={() => void refreshNotesIndex()}
              >
                Reindex
              </button>
            </div>
            <div className="kb-directory-card">
              <strong>{displayedKnowledgeBaseIndex.notesRoot}</strong>
              <p>{displayedKnowledgeBaseIndex.message}</p>
              <div className="directory-stats">
                <span>Markdown notes {displayedKnowledgeBaseIndex.notes.length}</span>
                <span>Assets root {displayedKnowledgeBaseIndex.assetsRoot}</span>
              </div>
              <div className="stack-list compact">
                {displayedKnowledgeBaseIndex.notes.length > 0 ? (
                  displayedKnowledgeBaseIndex.notes.slice(0, 6).map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      className="stack-item subtle"
                      onClick={() => setSelectedNoteId(note.id)}
                    >
                      {note.relativePath}
                    </button>
                  ))
                ) : (
                  <div className="empty-directory-state">No markdown notes indexed yet.</div>
                )}
              </div>
            </div>
          </section>

          <section className="inspector-section">
            <p className="section-label">Backlinks</p>
            <div className="stack-list">
              {backlinks.map((item) => (
                <button key={item} type="button" className="stack-item subtle">
                  {item}
                </button>
              ))}
            </div>
          </section>

          <section className="inspector-section">
            <p className="section-label">Outgoing links</p>
            <div className="stack-list">
              {outgoingLinks.map((item) => (
                <button key={item} type="button" className="stack-item subtle">
                  {item}
                </button>
              ))}
            </div>
          </section>

          <section className="inspector-section">
            <p className="section-label">Knowledge base shape</p>
            <div className="kb-card">
              <strong>Stage 1</strong>
              <p>Inbox + folders + tags + backlinks before graph and automation.</p>
            </div>
          </section>
        </aside>
      </main>
    </div>
  )
}

export default App

import { invoke } from '@tauri-apps/api/core'
import { useCallback, useEffect, useMemo, useState, type ChangeEvent } from 'react'

import './App.css'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: unknown
    }
  }
}

const folders = [
  { name: 'Inbox', active: true },
  { name: 'Projects' },
  { name: 'Topics' },
  { name: 'Archive' },
]

const tags = ['#offline-first', '#sync', '#markdown', '#knowledge-base']
const backlinks = ['[[Desktop MVP]]', '[[Storage Strategy]]', '[[Editor Benchmarks]]']
const outgoingLinks = ['[[Knowledge Base Shape]]', '[[Sync Flow]]', '[[Search Experience]]']

const SYNC_CONFIG_KEY = 'notebase:sync-config'
const SELECTED_NOTE_KEY = 'notebase:selected-note-id'
const INVOKE_TIMEOUT_MS = 12000
const BROWSER_LOCAL_PATH_PLACEHOLDER = '~/Documents/NoteBase'

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
type SyncButtonTone = 'idle' | 'warning' | 'active' | 'busy'

type SyncConfig = {
  profileName: string
  protocol: 'http' | 'https'
  publicHost: string
  publicPort: string
  username: string
  password: string
  remotePath: string
  remoteLibraryPath: string
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

type DefaultLocalLibraryResponse = {
  rootPath: string
  message: string
}

type LibrarySnapshot = {
  rootPath: string
  noteCount: number
  assetFileCount: number
  latestUpdatedAtMs: number | null
  hasContent: boolean
  message: string
}

type SyncStatusResponse = {
  status: string
  configured: boolean
  reachable: boolean
  mountPoint: string
  remoteRootPath: string
  webdavUrl: string
  message: string
  requiresInitialDecision: boolean
  suggestedDirection: string
  localSnapshot: LibrarySnapshot | null
  remoteSnapshot: LibrarySnapshot | null
  copiedCount: number
  skippedCount: number
  conflictCount: number
  conflicts: string[]
}

const emptySyncConfig: SyncConfig = {
  profileName: 'My NAS sync target',
  protocol: 'http',
  publicHost: '',
  publicPort: '',
  username: '',
  password: '',
  remotePath: '//home/data',
  remoteLibraryPath: 'NoteBase',
}

const emptySyncStatus = (message: string): SyncStatusResponse => ({
  status: 'not_configured',
  configured: false,
  reachable: false,
  mountPoint: '',
  remoteRootPath: '',
  webdavUrl: '',
  message,
  requiresInitialDecision: false,
  suggestedDirection: 'none',
  localSnapshot: null,
  remoteSnapshot: null,
  copiedCount: 0,
  skippedCount: 0,
  conflictCount: 0,
  conflicts: [],
})

const isTauriRuntime = () =>
  typeof window !== 'undefined' && typeof window.__TAURI_INTERNALS__?.invoke === 'function'

const invokeWithTimeout = async <T,>(command: string, payload?: Record<string, unknown>) =>
  await Promise.race([
    invoke<T>(command, payload),
    new Promise<T>((_, reject) => {
      window.setTimeout(() => {
        reject(new Error(`Timed out while waiting for ${command}.`))
      }, INVOKE_TIMEOUT_MS)
    }),
  ])

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

const loadStoredSyncConfig = (): SyncConfig | null => {
  if (typeof window === 'undefined') {
    return null
  }

  const raw = window.localStorage.getItem(SYNC_CONFIG_KEY)
  if (!raw) {
    return null
  }

  try {
    const parsed = JSON.parse(raw) as Partial<SyncConfig>
    return {
      ...emptySyncConfig,
      ...parsed,
      protocol: parsed.protocol === 'https' ? 'https' : 'http',
    }
  } catch {
    return null
  }
}

const syncToneFromStatus = (status: SyncStatusResponse, busy: boolean): SyncButtonTone => {
  if (busy) {
    return 'busy'
  }

  if (
    !status.configured ||
    status.status === 'failed' ||
    status.status === 'decision_required' ||
    status.status === 'conflicted'
  ) {
    return 'warning'
  }

  if (status.status === 'connected' || status.status === 'synced') {
    return 'active'
  }

  return 'idle'
}

const buildSyncButtonLabel = (status: SyncStatusResponse, busy: boolean) => {
  if (busy) {
    return 'Syncing...'
  }

  if (!status.configured) {
    return 'Sync !'
  }

  if (status.status === 'failed') {
    return 'Sync !'
  }

  if (status.status === 'conflicted') {
    return 'Conflicts !'
  }

  if (status.status === 'decision_required') {
    return 'Resolve sync'
  }

  return 'Sync'
}

function App() {
  const [localRootPath, setLocalRootPath] = useState(BROWSER_LOCAL_PATH_PLACEHOLDER)
  const [localLibraryMessage, setLocalLibraryMessage] = useState(
    'Preparing the default offline knowledge base path.',
  )
  const [libraryOverview, setLibraryOverview] = useState<LibraryOverview>({
    resolvedStoragePath: BROWSER_LOCAL_PATH_PLACEHOLDER,
    exists: false,
    readable: false,
    directoryCount: 0,
    fileCount: 0,
    sampleEntries: [],
    message: 'Waiting for the offline knowledge base path.',
  })
  const [knowledgeBaseIndex, setKnowledgeBaseIndex] = useState<KnowledgeBaseIndex>({
    rootPath: BROWSER_LOCAL_PATH_PLACEHOLDER,
    notesRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/notes`,
    assetsRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/assets`,
    hiddenRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/.notebase`,
    initializedNewKnowledgeBase: false,
    notes: [],
    message: 'Waiting for the offline knowledge base path.',
  })
  const [selectedNoteId, setSelectedNoteId] = useState<string | null>(() => {
    if (typeof window === 'undefined') {
      return null
    }

    const raw = window.localStorage.getItem(SELECTED_NOTE_KEY)
    return raw ? (JSON.parse(raw) as string | null) : null
  })
  const [selectedNoteDocument, setSelectedNoteDocument] = useState<NoteDocument | null>(null)
  const [editorBody, setEditorBody] = useState('')
  const [lastSavedBody, setLastSavedBody] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveMessage, setSaveMessage] = useState('Select a note to start editing.')
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(() => loadStoredSyncConfig())
  const [draftSyncConfig, setDraftSyncConfig] = useState<SyncConfig>(() => loadStoredSyncConfig() ?? emptySyncConfig)
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse>(
    emptySyncStatus('Sync has not been configured. Offline mode is active.'),
  )
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [decisionPanelOpen, setDecisionPanelOpen] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)

  const runningInTauri = useMemo(() => isTauriRuntime(), [])
  const hasUnsavedChanges = selectedNoteDocument ? editorBody !== lastSavedBody : false
  const syncButtonTone = syncToneFromStatus(syncStatus, syncBusy)
  const syncButtonLabel = buildSyncButtonLabel(syncStatus, syncBusy)
  const selectedNote =
    knowledgeBaseIndex.notes.find((note) => note.id === selectedNoteId) ??
    knowledgeBaseIndex.notes[0] ??
    null

  useEffect(() => {
    window.localStorage.setItem(SELECTED_NOTE_KEY, JSON.stringify(selectedNoteId))
  }, [selectedNoteId])

  useEffect(() => {
    if (syncConfig) {
      window.localStorage.setItem(SYNC_CONFIG_KEY, JSON.stringify(syncConfig))
    } else {
      window.localStorage.removeItem(SYNC_CONFIG_KEY)
    }
  }, [syncConfig])

  const refreshLocalWorkspace = useCallback(async (rootPath: string) => {
    if (!runningInTauri) {
      setLibraryOverview({
        resolvedStoragePath: BROWSER_LOCAL_PATH_PLACEHOLDER,
        exists: false,
        readable: false,
        directoryCount: 0,
        fileCount: 0,
        sampleEntries: [],
        message: 'Browser preview detected. Offline path scanning runs in the Tauri desktop app.',
      })
      setKnowledgeBaseIndex({
        rootPath: BROWSER_LOCAL_PATH_PLACEHOLDER,
        notesRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/notes`,
        assetsRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/assets`,
        hiddenRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/.notebase`,
        initializedNewKnowledgeBase: false,
        notes: [],
        message: 'Browser preview detected. Offline indexing runs in the Tauri desktop app.',
      })
      return
    }

    const [overviewResponse, indexResponse] = await Promise.all([
      invokeWithTimeout<LibraryOverview>('inspect_library', { rootPath }),
      invokeWithTimeout<KnowledgeBaseIndex>('load_library_index', { rootPath }),
    ])

    setLibraryOverview(overviewResponse)
    setKnowledgeBaseIndex(indexResponse)
    setSelectedNoteId((current) => {
      if (current && indexResponse.notes.some((note) => note.id === current)) {
        return current
      }

      return indexResponse.notes[0]?.id ?? null
    })
    if (indexResponse.notes.length === 0) {
      setSelectedNoteDocument(null)
      setEditorBody('')
      setLastSavedBody('')
      setSaveStatus('idle')
      setSaveMessage('Select a note to start editing.')
    }
  }, [runningInTauri])

  const loadSelectedNoteDocument = useCallback(async (noteId: string, rootPath: string) => {
    if (!runningInTauri) {
      setSelectedNoteDocument(null)
      setEditorBody('')
      setLastSavedBody('')
      setSaveStatus('error')
      setSaveMessage('Editing note content requires the Tauri desktop runtime.')
      return
    }

    try {
      const response = await invokeWithTimeout<NoteDocument>('load_note_document', {
        rootPath,
        noteId,
      })
      setSelectedNoteDocument(response)
      setEditorBody(response.body)
      setLastSavedBody(response.body)
      setSaveStatus('idle')
      setSaveMessage(response.message)
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load the selected note content.'
      setSelectedNoteDocument(null)
      setEditorBody('')
      setLastSavedBody('')
      setSaveStatus('error')
      setSaveMessage(message)
    }
  }, [runningInTauri])

  const assessSyncReadiness = useCallback(
    async (rootPath: string, nextConfig: SyncConfig) => {
      if (!runningInTauri) {
        setSyncStatus(
          emptySyncStatus(
            'Browser preview detected. Sync checks only run inside the Tauri desktop runtime.',
          ),
        )
        return
      }

      setSyncBusy(true)
      try {
        const response = await invokeWithTimeout<SyncStatusResponse>('prepare_sync', {
          localRootPath: rootPath,
          config: nextConfig,
        })
        setSyncStatus(response)
        setDecisionPanelOpen(response.requiresInitialDecision)
      } catch (error) {
        setSyncStatus({
          ...emptySyncStatus(
            error instanceof Error ? error.message : 'Failed to inspect the remote sync target.',
          ),
          configured: true,
          status: 'failed',
          webdavUrl: '',
        })
      } finally {
        setSyncBusy(false)
      }
    },
    [runningInTauri],
  )

  useEffect(() => {
    let cancelled = false

    const initializeApp = async () => {
      if (!runningInTauri) {
        setLocalRootPath(BROWSER_LOCAL_PATH_PLACEHOLDER)
        setLocalLibraryMessage(
          'Browser preview detected. The desktop app will scan the default offline path on launch.',
        )
        return
      }

      try {
        const response = await invokeWithTimeout<DefaultLocalLibraryResponse>(
          'get_default_local_library',
        )
        if (cancelled) {
          return
        }

        setLocalRootPath(response.rootPath)
        setLocalLibraryMessage(response.message)
        await refreshLocalWorkspace(response.rootPath)

        if (syncConfig) {
          await assessSyncReadiness(response.rootPath, syncConfig)
        } else {
          setSyncStatus(
            emptySyncStatus(
              'Offline library loaded. Configure sync only when you want to connect a NAS target.',
            ),
          )
        }
      } catch (error) {
        if (!cancelled) {
          const message =
            error instanceof Error
              ? error.message
              : 'Failed to prepare the default local knowledge base path.'
          setLocalLibraryMessage(message)
          setSaveStatus('error')
          setSaveMessage(message)
        }
      }
    }

    void initializeApp()

    return () => {
      cancelled = true
    }
  }, [assessSyncReadiness, refreshLocalWorkspace, runningInTauri, syncConfig])

  useEffect(() => {
    if (!selectedNoteId) {
      return
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSelectedNoteDocument(selectedNoteId, localRootPath)
  }, [selectedNoteId, localRootPath, loadSelectedNoteDocument])

  const handleEditorBodyChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    const nextBody = event.target.value
    setEditorBody(nextBody)

    if (!selectedNoteDocument) {
      setSaveStatus('idle')
      setSaveMessage('Select a note to start editing.')
      return
    }

    if (nextBody === lastSavedBody) {
      setSaveStatus('idle')
      setSaveMessage('No unsaved changes.')
      return
    }

    setSaveStatus('dirty')
    setSaveMessage('Unsaved markdown changes.')
  }

  const handleSaveNote = useCallback(
    async (mode: 'manual' | 'autosave' = 'manual') => {
      if (!selectedNoteId || !selectedNoteDocument) {
        if (mode === 'manual') {
          setSaveStatus('idle')
          setSaveMessage('Select a note before saving.')
        }
        return
      }

      if (!runningInTauri) {
        if (mode === 'manual') {
          setSaveStatus('error')
          setSaveMessage(
            'Saving requires the Tauri desktop runtime. The browser preview cannot write files.',
          )
        }
        return
      }

      if (!hasUnsavedChanges) {
        if (mode === 'manual') {
          setSaveStatus('saved')
          setSaveMessage('No changes to save.')
        }
        return
      }

      setSaveStatus('saving')
      setSaveMessage(
        mode === 'autosave'
          ? 'Autosaving note to the local offline library...'
          : 'Saving note to the local offline library...',
      )

      try {
        const response = await invokeWithTimeout<NoteDocument>('save_note_document', {
          rootPath: localRootPath,
          payload: {
            noteId: selectedNoteId,
            body: editorBody,
          },
        })
        setSelectedNoteDocument(response)
        setEditorBody(response.body)
        setLastSavedBody(response.body)
        setSaveStatus('saved')
        setSaveMessage(
          mode === 'autosave'
            ? `Autosaved note content to ${response.note.relativePath}.`
            : response.message,
        )
        await refreshLocalWorkspace(localRootPath)
      } catch (error) {
        setSaveStatus('error')
        setSaveMessage(
          error instanceof Error ? error.message : 'Failed to save the current note to disk.',
        )
      }
    },
    [
      editorBody,
      hasUnsavedChanges,
      localRootPath,
      refreshLocalWorkspace,
      runningInTauri,
      selectedNoteDocument,
      selectedNoteId,
    ],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSaveNote('manual')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [handleSaveNote])

  useEffect(() => {
    if (!selectedNoteId || !hasUnsavedChanges || saveStatus === 'saving') {
      return
    }

    const timeoutId = window.setTimeout(() => {
      void handleSaveNote('autosave')
    }, 1500)

    return () => {
      window.clearTimeout(timeoutId)
    }
  }, [handleSaveNote, hasUnsavedChanges, saveStatus, selectedNoteId])

  useEffect(() => {
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      if (!hasUnsavedChanges) {
        return
      }

      event.preventDefault()
      event.returnValue = ''
    }

    window.addEventListener('beforeunload', handleBeforeUnload)
    return () => {
      window.removeEventListener('beforeunload', handleBeforeUnload)
    }
  }, [hasUnsavedChanges])

  const handleSelectNote = (noteId: string) => {
    if (noteId === selectedNoteId) {
      return
    }

    if (
      hasUnsavedChanges &&
      !window.confirm('You have unsaved changes in the current note. Switch notes anyway?')
    ) {
      return
    }

    setSelectedNoteId(noteId)
  }

  const handleCreateNote = async () => {
    if (
      hasUnsavedChanges &&
      !window.confirm('You have unsaved changes in the current note. Create a new note anyway?')
    ) {
      return
    }

    if (!runningInTauri) {
      setSaveStatus('error')
      setSaveMessage('Creating a note needs the Tauri desktop runtime. The browser preview cannot write files.')
      return
    }

    try {
      const response = await invokeWithTimeout<CreateNoteResponse>('create_note', {
        rootPath: localRootPath,
      })
      await refreshLocalWorkspace(localRootPath)
      setSelectedNoteId(response.note.id)
      setSaveStatus('saved')
      setSaveMessage(response.message)
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(
        error instanceof Error ? error.message : 'Failed to create a new note in the offline library.',
      )
    }
  }

  const handleSyncConfigChange =
    (field: keyof SyncConfig) => (event: ChangeEvent<HTMLInputElement>) => {
      setDraftSyncConfig((current) => ({
        ...current,
        [field]: event.target.value,
      }))
    }

  const handleProtocolChange = (protocol: SyncConfig['protocol']) => {
    setDraftSyncConfig((current) => ({
      ...current,
      protocol,
    }))
  }

  const handleConnectSync = async () => {
    setSyncConfig(draftSyncConfig)
    await assessSyncReadiness(localRootPath, draftSyncConfig)
    setSyncPanelOpen(false)
  }

  const handleRunSyncWithOptions = async (
    direction = 'push_local_to_remote',
    allowInitialOverride = false,
  ) => {
    if (!syncConfig) {
      setSyncPanelOpen(true)
      return
    }

    setSyncBusy(true)
    try {
      const response = await invokeWithTimeout<SyncStatusResponse>('sync_libraries', {
        payload: {
          localRootPath,
          config: syncConfig,
          direction,
          allowInitialOverride,
        },
      })
      setSyncStatus(response)
      setDecisionPanelOpen(false)
      await refreshLocalWorkspace(localRootPath)
    } catch (error) {
      setSyncStatus({
        ...emptySyncStatus(
          error instanceof Error ? error.message : 'Failed to run the requested sync action.',
        ),
        configured: true,
        status: 'failed',
      })
    } finally {
      setSyncBusy(false)
    }
  }

  const handleResolveConflict = async (
    relativePath: string,
    resolution: 'keep_local' | 'keep_remote',
  ) => {
    if (!syncConfig) {
      return
    }

    setSyncBusy(true)
    try {
      const response = await invokeWithTimeout<SyncStatusResponse>('resolve_sync_conflict', {
        payload: {
          localRootPath,
          config: syncConfig,
          relativePath,
          resolution,
        },
      })
      setSyncStatus(response)
      await refreshLocalWorkspace(localRootPath)
    } catch (error) {
      setSyncStatus({
        ...emptySyncStatus(
          error instanceof Error ? error.message : 'Failed to resolve the selected conflict.',
        ),
        configured: true,
        status: 'failed',
      })
    } finally {
      setSyncBusy(false)
    }
  }

  const handleSyncButtonClick = () => {
    if (!syncConfig) {
      setDraftSyncConfig(syncConfig ?? emptySyncConfig)
      setSyncPanelOpen(true)
      return
    }

    if (syncStatus.status === 'failed') {
      setDraftSyncConfig(syncConfig)
      setSyncPanelOpen(true)
      return
    }

    void handleRunSyncWithOptions('push_local_to_remote', false)
  }

  const handleDisconnectSync = () => {
    setSyncConfig(null)
    setDraftSyncConfig(emptySyncConfig)
    setSyncStatus(
      emptySyncStatus(
        'Remote sync configuration was removed. The app will continue scanning the local offline library.',
      ),
    )
    setSyncPanelOpen(false)
    setDecisionPanelOpen(false)
  }

  const folderCounts = folders.map((folder) => ({
    ...folder,
    count: knowledgeBaseIndex.notes.filter((note) =>
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
          <p className="eyebrow">Local-first personal knowledge base</p>
          <h1>NoteBase</h1>
        </div>
        <label className="search-field" htmlFor="global-search">
          <span>Search notes, tags, links</span>
          <input id="global-search" defaultValue="offline sync markdown" />
          <kbd>Cmd K</kbd>
        </label>
        <div className="topbar-actions">
          <button
            type="button"
            className={`sync-entry sync-entry-${syncButtonTone}`}
            onClick={handleSyncButtonClick}
          >
            <span className="sync-entry-icon" aria-hidden="true">
              {syncButtonTone === 'warning' ? '!' : syncBusy ? '…' : '↻'}
            </span>
            <span>{syncButtonLabel}</span>
          </button>
          <div className="status-panel">
            <span className="status-dot status-dot-mounted" />
            <div>
              <p className="status-label">Offline library</p>
              <strong>Default local path</strong>
              <span className="status-meta">{localRootPath}</span>
            </div>
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
              <strong>{knowledgeBaseIndex.notes.length}</strong>
            </button>
            <button type="button" className="nav-item">
              <span>Recent</span>
              <strong>{Math.min(knowledgeBaseIndex.notes.length, 12)}</strong>
            </button>
            <button type="button" className="nav-item">
              <span>Offline mode</span>
              <strong>On</strong>
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
              <h2>Offline knowledge base</h2>
            </div>
            <button
              type="button"
              className="ghost-action"
              onClick={() => void refreshLocalWorkspace(localRootPath)}
            >
              Refresh
            </button>
          </div>

          <div className="note-list">
            {knowledgeBaseIndex.notes.length > 0 ? (
              knowledgeBaseIndex.notes.map((note) => (
                <button
                  key={note.id}
                  type="button"
                  className={`note-card ${selectedNote?.id === note.id ? 'active' : ''}`}
                  onClick={() => handleSelectNote(note.id)}
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
                  {knowledgeBaseIndex.initializedNewKnowledgeBase
                    ? 'New local knowledge base created'
                    : 'No markdown notes yet'}
                </strong>
                <p>{knowledgeBaseIndex.message}</p>
                <span>
                  The app always scans the default offline path first: <code>{localRootPath}</code>.
                </span>
                <span>
                  If this folder started empty, NoteBase already initialized the local knowledge
                  base shape for you.
                </span>
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
            <div className="editor-actions">
              <div className={`save-indicator save-indicator-${saveStatus}`}>
                <strong>
                  {saveStatus === 'saving'
                    ? 'Saving'
                    : saveStatus === 'saved'
                      ? 'Saved'
                      : saveStatus === 'dirty'
                        ? 'Unsaved'
                        : saveStatus === 'error'
                          ? 'Save issue'
                          : 'Ready'}
                </strong>
                <span>{saveMessage}</span>
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
              <button
                type="button"
                className="save-action"
                disabled={!selectedNote || saveStatus === 'saving' || !hasUnsavedChanges}
                onClick={() => void handleSaveNote('manual')}
              >
                Save
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
                  ? `${selectedNote.relativePath} • ${selectedNote.format} • local root ${localRootPath}`
                  : `Offline knowledge base root • ${localRootPath}`}
              </p>
              <div className="writing-block">
                {selectedNote ? (
                  <>
                    <p>## Offline editing flow</p>
                    <p>{saveMessage || selectedNoteDocument?.message || selectedNote.summary}</p>
                    <p>- Relative path: {selectedNote.relativePath}</p>
                    <p>- Folder: {selectedNote.folder}</p>
                    <p>- Updated: {formatRelativeDate(selectedNote.updatedAtMs)}</p>
                    <p>
                      - Tags:{' '}
                      {selectedNote.tags.length > 0 ? selectedNote.tags.join(', ') : 'No tags yet'}
                    </p>
                    <p>### Storage model</p>
                    <p>
                      The local offline library is the primary working copy. Sync only moves notes
                      and assets between the local library and the remote target when you ask for it.
                    </p>
                    <div className="editor-caption-row">
                      <p>### Markdown body</p>
                      <span>{hasUnsavedChanges ? 'Cmd/Ctrl+S to save locally' : 'Saved locally'}</span>
                    </div>
                    <textarea
                      className="markdown-editor"
                      value={editorBody}
                      onChange={handleEditorBodyChange}
                      placeholder="Start writing in Markdown..."
                      spellCheck={false}
                    />
                  </>
                ) : (
                  <>
                    <p>## Default offline path</p>
                    <p>{localLibraryMessage}</p>
                    <p>- Knowledge base root: {knowledgeBaseIndex.rootPath}</p>
                    <p>- Notes root: {knowledgeBaseIndex.notesRoot}</p>
                    <p>- Assets root: {knowledgeBaseIndex.assetsRoot}</p>
                    <p>- App metadata: {knowledgeBaseIndex.hiddenRoot}</p>
                  </>
                )}
              </div>
              <div className="code-block">
                <div className="code-block-top">
                  <span>ts</span>
                  <button type="button">Copy</button>
                </div>
                <pre>{`const workspace = {\n  localRootPath: "${knowledgeBaseIndex.rootPath}",\n  notesRoot: "${knowledgeBaseIndex.notesRoot}",\n  assetsRoot: "${knowledgeBaseIndex.assetsRoot}",\n  syncConfigured: ${syncConfig ? 'true' : 'false'},\n  syncState: "${syncStatus.status}",\n  selectedNote: "${selectedNote?.relativePath ?? '(none)'}",\n}`}</pre>
              </div>
            </article>

            <aside className="preview-surface">
              <p className="section-label">Preview snapshot</p>
              <div className="preview-card">
                <h3>Default local behavior</h3>
                <ul>
                  <li>Open the offline library first</li>
                  <li>Keep editing available even when the NAS is unavailable</li>
                  <li>Use sync only when you intentionally connect a remote target</li>
                </ul>
              </div>
              <div className={`preview-card soft sync-preview-card sync-preview-card-${syncButtonTone}`}>
                <p className="section-label">Sync state</p>
                <strong>{syncConfig ? syncConfig.profileName : 'Not configured'}</strong>
                <span>{syncStatus.message}</span>
                {syncStatus.conflictCount > 0 ? (
                  <span>{syncStatus.conflictCount} conflicts need a manual decision before those files can sync.</span>
                ) : null}
              </div>
              <div className="preview-card">
                <p className="section-label">Offline library directory</p>
                <strong>
                  {libraryOverview.readable
                    ? `${libraryOverview.directoryCount} folders • ${libraryOverview.fileCount} files`
                    : 'Directory unavailable'}
                </strong>
                <span>{libraryOverview.message}</span>
              </div>
              <div className="preview-card">
                <p className="section-label">Indexed markdown notes</p>
                <strong>{knowledgeBaseIndex.notes.length}</strong>
                <span>{knowledgeBaseIndex.message}</span>
                {knowledgeBaseIndex.initializedNewKnowledgeBase ? (
                  <span>The app initialized a new offline library in the default path.</span>
                ) : null}
              </div>
            </aside>
          </div>
        </section>

        <aside className="inspector-panel">
          <div className="panel-heading">
            <div>
              <p className="section-label">Context</p>
              <h2>Local + sync overview</h2>
            </div>
            <button type="button" className="ghost-action" onClick={() => setSyncPanelOpen(true)}>
              Sync settings
            </button>
          </div>

          <section className="inspector-section">
            <p className="section-label">Default offline path</p>
            <div className="kb-directory-card">
              <strong>{localRootPath}</strong>
              <p>{localLibraryMessage}</p>
              <div className="directory-stats">
                <span>Notes root {knowledgeBaseIndex.notesRoot}</span>
                <span>Assets root {knowledgeBaseIndex.assetsRoot}</span>
              </div>
            </div>
          </section>

          <section className="inspector-section">
            <div className="section-heading">
              <p className="section-label">Remote sync</p>
              <button
                type="button"
                className="ghost-action"
                onClick={() => {
                  if (syncConfig) {
                    setDraftSyncConfig(syncConfig)
                  }
                  setSyncPanelOpen(true)
                }}
              >
                {syncConfig ? 'Manage' : 'Configure'}
              </button>
            </div>
            <div className="kb-directory-card">
              <strong>{syncConfig ? syncConfig.profileName : 'Remote sync not configured'}</strong>
              <p>{syncStatus.message}</p>
              <div className="directory-stats">
                <span>{syncStatus.mountPoint || 'No mount point yet'}</span>
                <span>{syncStatus.remoteRootPath || 'No remote library path yet'}</span>
              </div>
              {syncStatus.localSnapshot ? (
                <div className="sync-snapshot-grid">
                  <div className="sync-snapshot-card">
                    <strong>Local</strong>
                    <span>{syncStatus.localSnapshot.noteCount} notes</span>
                    <span>{syncStatus.localSnapshot.assetFileCount} assets</span>
                  </div>
                  <div className="sync-snapshot-card">
                    <strong>Remote</strong>
                    <span>{syncStatus.remoteSnapshot?.noteCount ?? 0} notes</span>
                    <span>{syncStatus.remoteSnapshot?.assetFileCount ?? 0} assets</span>
                  </div>
                </div>
              ) : null}
              {syncStatus.conflicts.length > 0 ? (
                <div className="sync-conflict-list">
                  <strong>Conflicts</strong>
                  {syncStatus.conflicts.slice(0, 6).map((path) => (
                    <div key={path} className="sync-conflict-item">
                      <span>{path}</span>
                      <div className="sync-conflict-actions">
                        <button
                          type="button"
                          className="ghost-action"
                          onClick={() => void handleResolveConflict(path, 'keep_local')}
                        >
                          Keep local
                        </button>
                        <button
                          type="button"
                          className="ghost-action"
                          onClick={() => void handleResolveConflict(path, 'keep_remote')}
                        >
                          Keep remote
                        </button>
                      </div>
                    </div>
                  ))}
                </div>
              ) : null}
            </div>
          </section>

          <section className="inspector-section">
            <div className="section-heading">
              <p className="section-label">Indexed notes</p>
              <button
                type="button"
                className="ghost-action"
                onClick={() => void refreshLocalWorkspace(localRootPath)}
              >
                Reindex
              </button>
            </div>
            <div className="kb-directory-card">
              <strong>{knowledgeBaseIndex.notesRoot}</strong>
              <p>{knowledgeBaseIndex.message}</p>
              <div className="directory-stats">
                <span>Markdown notes {knowledgeBaseIndex.notes.length}</span>
                <span>Assets root {knowledgeBaseIndex.assetsRoot}</span>
              </div>
              <div className="stack-list compact">
                {knowledgeBaseIndex.notes.length > 0 ? (
                  knowledgeBaseIndex.notes.slice(0, 6).map((note) => (
                    <button
                      key={note.id}
                      type="button"
                      className="stack-item subtle"
                      onClick={() => handleSelectNote(note.id)}
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
              <strong>Stage 2</strong>
              <p>Offline-first notes with an optional remote sync target and a first-pass sync flow.</p>
            </div>
          </section>
        </aside>
      </main>

      {syncPanelOpen ? (
        <div className="modal-shell" role="presentation">
          <div className="modal-card">
            <div className="panel-heading">
              <div>
                <p className="section-label">Remote sync</p>
                <h2>Configure optional NAS sync</h2>
              </div>
              <button type="button" className="ghost-action" onClick={() => setSyncPanelOpen(false)}>
                Close
              </button>
            </div>
            <p className="modal-copy">
              NoteBase always starts from the default offline path. Only configure this section if
              you want to sync the local library with a remote WebDAV target.
            </p>
            <div className="protocol-switcher" role="tablist" aria-label="WebDAV protocol">
              <button
                type="button"
                className={`view-pill ${draftSyncConfig.protocol === 'http' ? 'active' : ''}`}
                onClick={() => handleProtocolChange('http')}
              >
                HTTP
              </button>
              <button
                type="button"
                className={`view-pill ${draftSyncConfig.protocol === 'https' ? 'active' : ''}`}
                onClick={() => handleProtocolChange('https')}
              >
                HTTPS
              </button>
            </div>
            <div className="field-grid">
              <label className="config-field">
                <span>Profile</span>
                <input value={draftSyncConfig.profileName} onChange={handleSyncConfigChange('profileName')} />
              </label>
              <label className="config-field">
                <span>Public IP</span>
                <input value={draftSyncConfig.publicHost} onChange={handleSyncConfigChange('publicHost')} />
              </label>
              <label className="config-field">
                <span>Port</span>
                <input value={draftSyncConfig.publicPort} onChange={handleSyncConfigChange('publicPort')} />
              </label>
              <label className="config-field">
                <span>Username</span>
                <input value={draftSyncConfig.username} onChange={handleSyncConfigChange('username')} />
              </label>
              <label className="config-field">
                <span>Password</span>
                <input
                  type="password"
                  value={draftSyncConfig.password}
                  onChange={handleSyncConfigChange('password')}
                />
              </label>
              <label className="config-field full-span">
                <span>Remote WebDAV path</span>
                <input
                  value={draftSyncConfig.remotePath}
                  onChange={handleSyncConfigChange('remotePath')}
                  placeholder="//home/data"
                />
              </label>
              <label className="config-field full-span">
                <span>Remote knowledge base path</span>
                <input
                  value={draftSyncConfig.remoteLibraryPath}
                  onChange={handleSyncConfigChange('remoteLibraryPath')}
                  placeholder="NoteBase"
                />
              </label>
            </div>
            <div className="modal-actions">
              {syncConfig ? (
                <button type="button" className="ghost-danger" onClick={handleDisconnectSync}>
                  Remove sync config
                </button>
              ) : (
                <span className="modal-hint">Offline mode will continue even if you skip this.</span>
              )}
              <button type="button" className="save-action" onClick={() => void handleConnectSync()}>
                Save and test connection
              </button>
            </div>
          </div>
        </div>
      ) : null}

      {decisionPanelOpen && syncStatus.localSnapshot && syncStatus.remoteSnapshot ? (
        <div className="modal-shell" role="presentation">
          <div className="modal-card decision-card">
            <div className="panel-heading">
              <div>
                <p className="section-label">First sync decision</p>
                <h2>Choose how to align local and remote</h2>
              </div>
            </div>
            <p className="modal-copy">
              Both the local offline library and the remote sync target already contain content.
              Choose which side should become the source for this sync step.
            </p>
            <div className="sync-choice-grid">
              <button
                type="button"
                className="sync-choice-card"
                onClick={() => void handleRunSyncWithOptions('pull_remote_to_local', true)}
              >
                <strong>Pull remote to local</strong>
                <span>{syncStatus.remoteSnapshot.noteCount} remote notes</span>
                <span>Use the remote library as the source.</span>
              </button>
              <button
                type="button"
                className="sync-choice-card"
                onClick={() => void handleRunSyncWithOptions('push_local_to_remote', true)}
              >
                <strong>Push local to remote</strong>
                <span>{syncStatus.localSnapshot.noteCount} local notes</span>
                <span>Use the offline library as the source.</span>
              </button>
            </div>
            <div className="modal-actions">
              <span className="modal-hint">Suggested: {syncStatus.suggestedDirection}</span>
              <button
                type="button"
                className="ghost-action"
                onClick={() => setDecisionPanelOpen(false)}
              >
                Decide later
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export default App

import { convertFileSrc, invoke } from '@tauri-apps/api/core'
import {
  Fragment,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ChangeEvent,
} from 'react'

import './App.css'

declare global {
  interface Window {
    __TAURI_INTERNALS__?: {
      invoke?: unknown
    }
  }
}

const SYNC_CONFIG_KEY = 'notebase:sync-config'
const SELECTED_NOTE_KEY = 'notebase:selected-note-id'
const NOTEBOOKS_KEY = 'notebase:notebooks'
const COMMAND_PALETTE_DOCUMENT_FILTER_KEY = 'notebase:command-palette-document-filter'
const COMMAND_PALETTE_NOTEBOOK_FILTER_KEY = 'notebase:command-palette-notebook-filter'
const COMMAND_PALETTE_TAG_FILTER_KEY = 'notebase:command-palette-tag-filter'
const INVOKE_TIMEOUT_MS = 12000
const MIN_SAVE_SPINNER_MS = 450
const BROWSER_LOCAL_PATH_PLACEHOLDER = '~/Documents/NoteBase'
const DEFAULT_NOTE_TITLE = 'Untitled note'

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
type SyncButtonTone = 'idle' | 'warning' | 'active' | 'busy'
type EditorViewMode = 'markdown' | 'rich-text' | 'preview'
type MarkdownSnippetKind = 'h1' | 'h2' | 'bold' | 'list' | 'quote' | 'code' | 'link'
type AssetImportKind = 'image' | 'file'
type PreviewBlockType = 'h1' | 'h2' | 'paragraph' | 'quote' | 'list' | 'checklist' | 'code'
type PreviewBlock = { type: PreviewBlockType; content: string; language?: string }
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

type DocumentType = 'todo' | 'note' | 'journal'

type RealNoteSummary = {
  id: string
  title: string
  relativePath: string
  folder: string
  documentType: DocumentType
  notebook: string | null
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
  legacyMigration: LegacyMigrationReport
  notes: RealNoteSummary[]
  message: string
}

type LegacyMigrationReport = {
  migratedNoteCount: number
  sources: Array<{
    source: string
    target: string
    count: number
  }>
}

type LegacyMigrationLogEntry = {
  migratedAtMs: number
  migratedNoteCount: number
  sources: LegacyMigrationReport['sources']
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

type NotebookMutationResponse = {
  message: string
  notebookName: string | null
  affectedNoteIds: string[]
  renamedNoteIds: Record<string, string>
}

type ImportAssetResponse = {
  relativeAssetPath: string
  markdownSnippet: string
  message: string
}

type OpenPathResponse = {
  path: string
  message: string
}

type NoteLinkReference = {
  title: string
  noteId: string
  relativePath: string
}

type NoteConnections = {
  outgoingLinks: NoteLinkReference[]
  backlinks: NoteLinkReference[]
  unresolvedLinks: string[]
  message: string
}

type SearchLibraryResult = {
  note: RealNoteSummary
  snippet: string
  matchKind: string
  score: number
}

type KnowledgeGraphNode = {
  id: string
  title: string
  kind: 'note' | 'tag'
  documentType: DocumentType | null
  notebook: string | null
  relativePath: string | null
  tags: string[]
}

type KnowledgeGraphEdge = {
  id: string
  source: string
  target: string
  kind: 'wikilink' | 'tag'
}

type KnowledgeGraphResponse = {
  nodes: KnowledgeGraphNode[]
  edges: KnowledgeGraphEdge[]
  message: string
}

type WorkspaceView = 'notes' | 'graph' | 'media'
type MediaFilter = 'all' | 'image' | 'pdf' | 'video' | 'file' | 'unlinked'
type MediaSort = 'newest' | 'oldest' | 'name' | 'largest'
type GraphScope = 'focused' | 'full'
type SettingsTab = 'general' | 'sync'

type MediaAssetRecord = {
  id: string
  fileName: string
  relativeAssetPath: string
  absolutePath: string
  kind: 'image' | 'pdf' | 'video' | 'audio' | 'file'
  sizeBytes: number
  updatedAtMs: number | null
  linkedNotes: NoteLinkReference[]
}

type DeleteLibraryAssetResponse = {
  deletedRelativePaths: string[]
  deletedCount: number
  message: string
}

type WikilinkDraft = {
  query: string
  start: number
  end: number
}

type CommandPaletteItem = {
  id: string
  group: 'search_results' | 'recent_notes' | 'tags' | 'actions'
  title: string
  subtitle?: string
  meta?: string
  run: () => void | Promise<void>
}

type InspectorTab = 'backlinks' | 'outgoing' | 'tags'
type LibrarySectionKey = 'todo' | 'note' | 'journal' | 'notebooks'
type ActiveDirectorySelection =
  | { kind: 'type'; value: DocumentType }
  | { kind: 'notebook'; value: string }

type NotePointerDragState = {
  noteId: string
  title: string
  originNotebook: string | null
  startX: number
  startY: number
  x: number
  y: number
  hasMoved: boolean
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

const formatFileSize = (sizeBytes: number) => {
  if (sizeBytes >= 1024 * 1024) {
    return `${(sizeBytes / (1024 * 1024)).toFixed(1)} MB`
  }

  if (sizeBytes >= 1024) {
    return `${Math.round(sizeBytes / 1024)} KB`
  }

  return `${sizeBytes} B`
}

const escapeRegExp = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

const renderHighlightedText = (text: string, query: string) => {
  const normalizedQuery = query.trim()
  if (!normalizedQuery) {
    return text
  }

  const matcher = new RegExp(`(${escapeRegExp(normalizedQuery)})`, 'ig')
  const parts = text.split(matcher)

  return parts.map((part, index) =>
    part.toLowerCase() === normalizedQuery.toLowerCase() ? (
      <mark key={`${part}-${index}`} className="command-palette-highlight">
        {part}
      </mark>
    ) : (
      <Fragment key={`${part}-${index}`}>{part}</Fragment>
    ),
  )
}

const mediaSortLabel = (sort: MediaSort) => {
  switch (sort) {
    case 'oldest':
      return 'Oldest'
    case 'name':
      return 'Name'
    case 'largest':
      return 'Largest'
    case 'newest':
    default:
      return 'Newest'
  }
}

const loadStoredCommandPaletteFilter = (key: string, fallback = 'all') => {
  if (typeof window === 'undefined') {
    return fallback
  }

  const value = window.localStorage.getItem(key)?.trim()
  return value ? value : fallback
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

const loadStoredNotebooks = () => {
  if (typeof window === 'undefined') {
    return [] as string[]
  }

  const raw = window.localStorage.getItem(NOTEBOOKS_KEY)
  if (!raw) {
    return [] as string[]
  }

  try {
    const parsed = JSON.parse(raw) as string[]
    return parsed
      .map((value) => value.trim())
      .filter(Boolean)
      .filter((value, index, values) => values.indexOf(value) === index)
      .sort((left, right) => left.localeCompare(right))
  } catch {
    return [] as string[]
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

const collectLibraryTags = (notes: RealNoteSummary[]) => {
  const seen = new Set<string>()

  for (const note of notes) {
    for (const tag of note.tags) {
      const normalized = tag.trim()
      if (normalized) {
        seen.add(normalized)
      }
    }
  }

  return Array.from(seen).sort((left, right) => left.localeCompare(right))
}

const splitEditableNoteContent = (rawBody: string, fallbackTitle = DEFAULT_NOTE_TITLE) => {
  const normalizedBody = rawBody.replace(/\r\n/g, '\n')
  const titleMatch = normalizedBody.match(/^#\s+(.+?)(?:\n|$)/)

  if (!titleMatch) {
    return {
      title: fallbackTitle,
      body: normalizedBody,
    }
  }

  const title = titleMatch[1].trim() || fallbackTitle
  let body = stripLeadingTitleHeadings(normalizedBody.slice(titleMatch[0].length), title)
  if (title === DEFAULT_NOTE_TITLE && body.trim() === 'Start writing...') {
    body = ''
  }

  return { title, body }
}

const stripLeadingTitleHeadings = (body: string, title: string) => {
  let nextBody = body.replace(/\r\n/g, '\n').replace(/^\n+/, '')
  const normalizedTitle = title.trim().toLowerCase()
  if (!normalizedTitle) {
    return nextBody
  }

  while (true) {
    const match = nextBody.match(/^#\s+(.+?)(?:\n|$)/)
    if (!match || match[1].trim().toLowerCase() !== normalizedTitle) {
      break
    }

    nextBody = nextBody.slice(match[0].length).replace(/^\n+/, '')
  }

  return nextBody
}

const composeEditableNoteContent = (title: string, body: string) => {
  const normalizedTitle = title.trim() || DEFAULT_NOTE_TITLE
  const normalizedBody = stripLeadingTitleHeadings(body, normalizedTitle)

  if (!normalizedBody) {
    return `# ${normalizedTitle}`
  }

  return `# ${normalizedTitle}\n\n${normalizedBody}`
}

const formattingTools: Array<{
  label: string
  kind: MarkdownSnippetKind | AssetImportKind
  shortcut: string
}> = [
  { label: 'H1', kind: 'h1', shortcut: 'Cmd/Ctrl+Opt+1' },
  { label: 'H2', kind: 'h2', shortcut: 'Cmd/Ctrl+Opt+2' },
  { label: 'Bold', kind: 'bold', shortcut: 'Cmd/Ctrl+B' },
  { label: 'List', kind: 'list', shortcut: 'Cmd/Ctrl+Shift+7' },
  { label: 'Quote', kind: 'quote', shortcut: 'Cmd/Ctrl+Shift+.' },
  { label: 'Code', kind: 'code', shortcut: 'Cmd/Ctrl+Opt+C' },
  { label: 'Link', kind: 'link', shortcut: 'Cmd/Ctrl+K' },
  { label: 'Image', kind: 'image', shortcut: 'Cmd/Ctrl+Shift+I' },
  { label: 'File', kind: 'file', shortcut: 'Cmd/Ctrl+Shift+F' },
]

const commonCodeLanguages = ['plain text', 'ts', 'tsx', 'js', 'jsx', 'rust', 'bash', 'json', 'md']

const documentTypeMeta: Array<{ key: DocumentType; label: string; createLabel: string; icon: string }> = [
  { key: 'todo', label: 'Todo Lists', createLabel: 'New Todo', icon: 'list' },
  { key: 'note', label: 'Notes', createLabel: 'New Note', icon: 'notes' },
  { key: 'journal', label: 'Journal', createLabel: 'New Journal', icon: 'today' },
]

const documentTypeLabel = (documentType: DocumentType) =>
  documentTypeMeta.find((item) => item.key === documentType)?.label ?? 'Notes'

const searchMatchKindLabel = (matchKind: string) => {
  switch (matchKind) {
    case 'title':
      return 'Title match'
    case 'tag':
      return 'Tag match'
    case 'path':
      return 'Path match'
    case 'summary':
      return 'Summary match'
    case 'body':
      return 'Body match'
    default:
      return 'Recent note'
  }
}

const navItems = [
  { key: 'notes', label: 'Notes', shortLabel: 'Notes', icon: 'notes' },
  { key: 'graph', label: 'Graph', shortLabel: 'Graph', icon: 'graph' },
  { key: 'media', label: 'Media', shortLabel: 'Media', icon: 'media' },
] as const

const toolbarIconMap: Record<(typeof formattingTools)[number]['kind'], string> = {
  h1: 'heading1',
  h2: 'heading2',
  bold: 'bold',
  list: 'list',
  quote: 'quote',
  code: 'code',
  link: 'link',
  image: 'image',
  file: 'file',
}

function AppIcon({ name, className }: { name: string; className?: string }) {
  const commonProps = {
    viewBox: '0 0 20 20',
    fill: 'none',
    stroke: 'currentColor',
    strokeWidth: '1.7',
    strokeLinecap: 'round' as const,
    strokeLinejoin: 'round' as const,
    className,
    'aria-hidden': true,
  }

  switch (name) {
    case 'plus':
      return (
        <svg {...commonProps}>
          <path d="M10 4.5v11" />
          <path d="M4.5 10h11" />
        </svg>
      )
    case 'inbox':
      return (
        <svg {...commonProps}>
          <path d="M3.5 7.5h13v7a2 2 0 0 1-2 2h-9a2 2 0 0 1-2-2z" />
          <path d="M3.5 9.5h3l1.5 2h4l1.5-2h3" />
        </svg>
      )
    case 'notes':
      return (
        <svg {...commonProps}>
          <rect x="4" y="3.8" width="12" height="12.4" rx="2.4" />
          <path d="M7 7.2h6" />
          <path d="M7 10h6" />
          <path d="M7 12.8h4.2" />
        </svg>
      )
    case 'notebook':
      return (
        <svg {...commonProps}>
          <path d="M5 4.5h8.5a2 2 0 0 1 2 2v8.8H7a2 2 0 0 0-2 2z" />
          <path d="M5 4.5v13" />
          <path d="M7 7.5h5.5" />
          <path d="M7 10.5h4.5" />
        </svg>
      )
    case 'folderPlus':
      return (
        <svg {...commonProps}>
          <path d="M3.8 6.4h4l1.2 1.4h7.2v6.6a1.9 1.9 0 0 1-1.9 1.9H5.7a1.9 1.9 0 0 1-1.9-1.9z" />
          <path d="M10.8 10.2v4" />
          <path d="M8.8 12.2h4" />
        </svg>
      )
    case 'today':
      return (
        <svg {...commonProps}>
          <rect x="3.5" y="5" width="13" height="11" rx="2" />
          <path d="M6.5 3.5v3" />
          <path d="M13.5 3.5v3" />
          <path d="M3.5 8.5h13" />
        </svg>
      )
    case 'favorite':
      return (
        <svg {...commonProps}>
          <path d="m10 3.5 1.9 3.9 4.3.6-3.1 3 0.7 4.3-3.8-2-3.8 2 .7-4.3-3.1-3 4.3-.6z" />
        </svg>
      )
    case 'tag':
      return (
        <svg {...commonProps}>
          <path d="M3.5 10.5 10 4h5.5v5.5L9 16z" />
          <circle cx="12.75" cy="7.25" r="0.8" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'backlink':
      return (
        <svg {...commonProps}>
          <path d="M8.2 11.8 5.1 8.7a2.4 2.4 0 0 1 3.4-3.4l2.1 2.1" />
          <path d="M9.7 14.7h3.1a2.3 2.3 0 0 0 0-4.6H10" />
          <path d="M13.2 10.1 11 8" />
          <path d="M13.2 10.1h-3" />
        </svg>
      )
    case 'outgoing':
      return (
        <svg {...commonProps}>
          <path d="M11.8 8.2 14.9 11.3a2.4 2.4 0 1 1-3.4 3.4l-2.1-2.1" />
          <path d="M10.3 5.3H7.2a2.3 2.3 0 1 0 0 4.6H10" />
          <path d="M6.8 9.9 9 12" />
          <path d="M6.8 9.9h3" />
        </svg>
      )
    case 'graph':
      return (
        <svg {...commonProps}>
          <circle cx="5" cy="10" r="1.5" />
          <circle cx="10" cy="5" r="1.5" />
          <circle cx="15" cy="11.5" r="1.5" />
          <path d="M6.2 9 8.8 6.2" />
          <path d="M11.2 6 13.8 10.2" />
        </svg>
      )
    case 'media':
      return (
        <svg {...commonProps}>
          <rect x="3.5" y="4.5" width="13" height="11" rx="2" />
          <circle cx="8" cy="8" r="1.2" />
          <path d="m6 13 2.5-2.5 2 2 2.5-3 1.5 1.5" />
        </svg>
      )
    case 'settings':
      return (
        <svg {...commonProps}>
          <circle cx="10" cy="10" r="2.3" />
          <path d="M10 3.5v1.5" />
          <path d="M10 15v1.5" />
          <path d="M15 10h1.5" />
          <path d="M3.5 10H5" />
          <path d="m14.4 5.6 1 1" />
          <path d="m4.6 15.4 1-1" />
          <path d="m14.4 14.4 1 1" />
          <path d="m4.6 4.6 1 1" />
        </svg>
      )
    case 'trash':
      return (
        <svg {...commonProps}>
          <path d="M5.5 6.5h9" />
          <path d="M8 6.5V5a1 1 0 0 1 1-1h2a1 1 0 0 1 1 1v1.5" />
          <path d="m6.5 6.5.7 8a1 1 0 0 0 1 .9h3.6a1 1 0 0 0 1-.9l.7-8" />
        </svg>
      )
    case 'search':
      return (
        <svg {...commonProps}>
          <circle cx="8.5" cy="8.5" r="4.5" />
          <path d="m12 12 3.5 3.5" />
        </svg>
      )
    case 'write':
      return (
        <svg {...commonProps}>
          <path d="M4.8 14.8 14.2 5.4a1.6 1.6 0 1 1 2.3 2.3l-9.4 9.4-3 .7z" />
          <path d="m12.8 6.8 2.4 2.4" />
        </svg>
      )
    case 'preview':
      return (
        <svg {...commonProps}>
          <path d="M2.8 10s2.6-4.6 7.2-4.6 7.2 4.6 7.2 4.6-2.6 4.6-7.2 4.6S2.8 10 2.8 10z" />
          <circle cx="10" cy="10" r="2.2" />
        </svg>
      )
    case 'chevronLeft':
      return (
        <svg {...commonProps}>
          <path d="m11.8 4.8-5.3 5.2 5.3 5.2" />
        </svg>
      )
    case 'chevronRight':
      return (
        <svg {...commonProps}>
          <path d="m8.2 4.8 5.3 5.2-5.3 5.2" />
        </svg>
      )
    case 'sync':
      return (
        <svg {...commonProps}>
          <path d="M15 7.5A5 5 0 0 0 6.2 6" />
          <path d="M15 4.8v2.7h-2.7" />
          <path d="M5 12.5A5 5 0 0 0 13.8 14" />
          <path d="M5 15.2v-2.7h2.7" />
        </svg>
      )
    case 'heading1':
      return (
        <svg {...commonProps}>
          <path d="M4.5 5v10" />
          <path d="M10 5v10" />
          <path d="M4.5 10h5.5" />
          <path d="M14.5 7.5h1.8v8" />
        </svg>
      )
    case 'heading2':
      return (
        <svg {...commonProps}>
          <path d="M4.5 5v10" />
          <path d="M10 5v10" />
          <path d="M4.5 10h5.5" />
          <path d="M13.8 8.2a1.8 1.8 0 0 1 3.2 1.1c0 2-3.2 2.3-3.2 4.7h3.2" />
        </svg>
      )
    case 'bold':
      return (
        <svg {...commonProps}>
          <path d="M6 4.5h4a2.5 2.5 0 1 1 0 5H6z" />
          <path d="M6 9.5h4.7a2.7 2.7 0 1 1 0 5.5H6z" />
        </svg>
      )
    case 'list':
      return (
        <svg {...commonProps}>
          <path d="M7 6h8" />
          <path d="M7 10h8" />
          <path d="M7 14h8" />
          <circle cx="4.5" cy="6" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="10" r="0.7" fill="currentColor" stroke="none" />
          <circle cx="4.5" cy="14" r="0.7" fill="currentColor" stroke="none" />
        </svg>
      )
    case 'quote':
      return (
        <svg {...commonProps}>
          <path d="M6 8h3v3H6z" />
          <path d="M11 8h3v3h-3z" />
          <path d="M6 11.5c0 2 .8 3 2.5 3" />
          <path d="M11 11.5c0 2 .8 3 2.5 3" />
        </svg>
      )
    case 'code':
      return (
        <svg {...commonProps}>
          <path d="m7.5 6-3 4 3 4" />
          <path d="m12.5 6 3 4-3 4" />
        </svg>
      )
    case 'link':
      return (
        <svg {...commonProps}>
          <path d="M8 12 6.5 13.5a2.2 2.2 0 1 1-3.1-3.1L5 8.8" />
          <path d="M12 8 13.5 6.5a2.2 2.2 0 1 1 3.1 3.1L15 11.2" />
          <path d="m7 13 6-6" />
        </svg>
      )
    case 'image':
      return (
        <svg {...commonProps}>
          <rect x="3.5" y="4.5" width="13" height="11" rx="2" />
          <circle cx="8" cy="8" r="1.2" />
          <path d="m6 13 2.5-2.5 2 2 2.5-3 1.5 1.5" />
        </svg>
      )
    case 'file':
      return (
        <svg {...commonProps}>
          <path d="M6 3.5h5l3 3V16.5h-8a2 2 0 0 1-2-2v-9a2 2 0 0 1 2-2z" />
          <path d="M11 3.5v3h3" />
        </svg>
      )
    default:
      return null
  }
}

const detectOpenWikilink = (body: string, cursor: number) => {
  const leadingText = body.slice(0, cursor)
  const start = leadingText.lastIndexOf('[[')
  if (start === -1) {
    return null
  }

  const draft = leadingText.slice(start + 2)
  if (draft.includes(']]') || draft.includes('\n') || draft.includes('[')) {
    return null
  }

  return {
    query: draft.trim(),
    start,
    end: cursor,
  } satisfies WikilinkDraft
}

const renderPreviewBlocks = (body: string) => {
  const lines = body.replace(/\r\n/g, '\n').split('\n')
  const blocks: PreviewBlock[] = []
  let index = 0

  while (index < lines.length) {
    const line = lines[index]
    const trimmed = line.trim()

    if (!trimmed) {
      index += 1
      continue
    }

    if (trimmed.startsWith('```')) {
      const language = trimmed.slice(3).trim()
      const codeLines: string[] = []
      index += 1
      while (index < lines.length && !lines[index].trim().startsWith('```')) {
        codeLines.push(lines[index])
        index += 1
      }
      index += 1
      blocks.push({ type: 'code', content: codeLines.join('\n'), language })
      continue
    }

    if (trimmed.startsWith('# ')) {
      blocks.push({ type: 'h1', content: trimmed.slice(2).trim() })
      index += 1
      continue
    }

    if (trimmed.startsWith('## ')) {
      blocks.push({ type: 'h2', content: trimmed.slice(3).trim() })
      index += 1
      continue
    }

    if (trimmed.startsWith('> ')) {
      blocks.push({ type: 'quote', content: trimmed.slice(2).trim() })
      index += 1
      continue
    }

    if (trimmed.startsWith('- ')) {
      const checklistItems: string[] = []
      const items: string[] = []
      while (index < lines.length && lines[index].trim().startsWith('- ')) {
        const item = lines[index].trim().slice(2).trim()
        const checklistMatch = item.match(/^\[( |x|X)\]\s+(.*)$/)
        if (checklistMatch) {
          checklistItems.push(`${checklistMatch[1].toLowerCase() === 'x' ? '1' : '0'}|${checklistMatch[2]}`)
        } else {
          items.push(item)
        }
        index += 1
      }

      if (items.length > 0) {
        blocks.push({ type: 'list', content: items.join('\n') })
      }
      if (checklistItems.length > 0) {
        blocks.push({ type: 'checklist', content: checklistItems.join('\n') })
      }
      continue
    }

    const paragraphLines: string[] = []
    while (index < lines.length && lines[index].trim()) {
      paragraphLines.push(lines[index].trim())
      index += 1
    }
    blocks.push({ type: 'paragraph', content: paragraphLines.join(' ') })
  }

  return blocks
}

const renderInlinePreview = (content: string) => {
  const pattern = /(!?\[[^\]]+\]\([^)]+\)|\*\*[^*]+\*\*|`[^`]+`)/g
  const tokens = content.split(pattern).filter(Boolean)

  return tokens.map((token, index) => {
    const imageMatch = token.match(/^!\[([^\]]+)\]\(([^)]+)\)$/)
    if (imageMatch) {
      const [, alt, src] = imageMatch
      return (
        <span key={`img-${index}`} className="preview-inline-image">
          <strong>{alt}</strong>
          <span>{src}</span>
        </span>
      )
    }

    const linkMatch = token.match(/^\[([^\]]+)\]\(([^)]+)\)$/)
    if (linkMatch) {
      const [, label, href] = linkMatch
      return (
        <a key={`link-${index}`} href={href} target="_blank" rel="noreferrer">
          {label}
        </a>
      )
    }

    const boldMatch = token.match(/^\*\*([^*]+)\*\*$/)
    if (boldMatch) {
      return <strong key={`strong-${index}`}>{boldMatch[1]}</strong>
    }

    const codeMatch = token.match(/^`([^`]+)`$/)
    if (codeMatch) {
      return (
        <code key={`code-${index}`} className="preview-inline-code">
          {codeMatch[1]}
        </code>
      )
    }

    return <Fragment key={`text-${index}`}>{token}</Fragment>
  })
}

const escapeHtml = (value: string) =>
  value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;')

const renderInlineRichTextHtml = (content: string) => {
  const escaped = escapeHtml(content)
  return escaped
    .replace(/!\[([^\]]*)\]\(([^)]+)\)/g, '<img alt="$1" src="$2" data-note-asset="image" />')
    .replace(/\[([^\]]+)\]\(([^)]+)\)/g, '<a href="$2">$1</a>')
    .replace(/\*\*([^*]+)\*\*/g, '<strong>$1</strong>')
    .replace(/`([^`]+)`/g, '<code>$1</code>')
}

const markdownToRichTextHtml = (body: string) => {
  const blocks = renderPreviewBlocks(body)
  if (blocks.length === 0) {
    return '<p></p>'
  }

  return blocks
    .map((block) => {
      if (block.type === 'h1') {
        return `<h1>${renderInlineRichTextHtml(block.content)}</h1>`
      }
      if (block.type === 'h2') {
        return `<h2>${renderInlineRichTextHtml(block.content)}</h2>`
      }
      if (block.type === 'quote') {
        return `<blockquote>${renderInlineRichTextHtml(block.content)}</blockquote>`
      }
      if (block.type === 'list') {
        const items = block.content
          .split('\n')
          .map((item) => `<li>${renderInlineRichTextHtml(item)}</li>`)
          .join('')
        return `<ul>${items}</ul>`
      }
      if (block.type === 'checklist') {
        const items = block.content
          .split('\n')
          .map((item) => {
            const [checkedFlag, label] = item.split('|')
            const checked = checkedFlag === '1' ? ' checked' : ''
            return `<li><input type="checkbox"${checked} disabled /><span>${renderInlineRichTextHtml(label ?? '')}</span></li>`
          })
          .join('')
        return `<ul data-checklist="true">${items}</ul>`
      }
      if (block.type === 'code') {
        const languageAttribute = block.language
          ? ` data-language="${escapeHtml(block.language)}"`
          : ''
        return `<pre${languageAttribute}><code>${escapeHtml(block.content)}</code></pre>`
      }
      return `<p>${renderInlineRichTextHtml(block.content)}</p>`
    })
    .join('')
}

const extractInlineMarkdownFromNode = (node: ChildNode): string => {
  if (node.nodeType === Node.TEXT_NODE) {
    return node.textContent ?? ''
  }

  if (!(node instanceof HTMLElement)) {
    return ''
  }

  const content = Array.from(node.childNodes).map(extractInlineMarkdownFromNode).join('')
  const tagName = node.tagName.toLowerCase()

  if (tagName === 'strong' || tagName === 'b') {
    return `**${content}**`
  }
  if (tagName === 'code' && node.parentElement?.tagName.toLowerCase() !== 'pre') {
    return `\`${content}\``
  }
  if (tagName === 'a') {
    const href = node.getAttribute('href') ?? '#'
    return `[${content || href}](${href})`
  }
  if (tagName === 'img') {
    const alt = node.getAttribute('alt') ?? 'image'
    const src = node.getAttribute('src') ?? ''
    return `![${alt}](${src})`
  }
  if (tagName === 'br') {
    return '\n'
  }

  return content
}

const htmlToMarkdown = (html: string) => {
  if (typeof window === 'undefined') {
    return html
  }

  const parser = new window.DOMParser()
  const documentNode = parser.parseFromString(html, 'text/html')
  const lines: string[] = []

  const normalizeBlock = (value: string) =>
    value
      .replace(/\u00a0/g, ' ')
      .split('\n')
      .map((line) => line.replace(/\s+$/g, ''))
      .join('\n')
      .trim()

  for (const node of Array.from(documentNode.body.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE) {
      const text = normalizeBlock(node.textContent ?? '')
      if (text) {
        lines.push(text)
      }
      continue
    }

    if (!(node instanceof HTMLElement)) {
      continue
    }

    const tagName = node.tagName.toLowerCase()

    if (tagName === 'h1') {
      lines.push(`# ${normalizeBlock(Array.from(node.childNodes).map(extractInlineMarkdownFromNode).join(''))}`)
      continue
    }
    if (tagName === 'h2') {
      lines.push(`## ${normalizeBlock(Array.from(node.childNodes).map(extractInlineMarkdownFromNode).join(''))}`)
      continue
    }
    if (tagName === 'blockquote') {
      const text = normalizeBlock(Array.from(node.childNodes).map(extractInlineMarkdownFromNode).join(''))
      lines.push(
        text
          .split('\n')
          .map((line) => `> ${line}`)
          .join('\n'),
      )
      continue
    }
    if (tagName === 'ul') {
      const isChecklist = node.dataset.checklist === 'true'
      const items = Array.from(node.children)
        .filter((child) => child.tagName.toLowerCase() === 'li')
        .map((child) => {
          if (isChecklist) {
            const checked = child.querySelector('input')?.checked ?? false
            const text = normalizeBlock(
              Array.from(child.childNodes)
                .filter((childNode) => !(childNode instanceof HTMLInputElement))
                .map(extractInlineMarkdownFromNode)
                .join(''),
            )
            return `- [${checked ? 'x' : ' '}] ${text}`
          }

          const text = normalizeBlock(Array.from(child.childNodes).map(extractInlineMarkdownFromNode).join(''))
          return `- ${text}`
        })
      lines.push(items.join('\n'))
      continue
    }
    if (tagName === 'pre') {
      const code = node.textContent?.replace(/\u00a0/g, ' ') ?? ''
      const language = node.getAttribute('data-language')?.trim() ?? ''
      const openingFence = language ? `\`\`\`${language}` : '```'
      lines.push(`${openingFence}\n${code.trimEnd()}\n\`\`\``)
      continue
    }
    if (tagName === 'div' || tagName === 'p') {
      const text = normalizeBlock(Array.from(node.childNodes).map(extractInlineMarkdownFromNode).join(''))
      if (text) {
        lines.push(text)
      }
      continue
    }

    const text = normalizeBlock(Array.from(node.childNodes).map(extractInlineMarkdownFromNode).join(''))
    if (text) {
      lines.push(text)
    }
  }

  return lines.join('\n\n').trimEnd()
}

const detectCodeFenceContext = (body: string, selectionStart: number, selectionEnd: number) => {
  const textBeforeSelection = body.slice(0, selectionStart)
  const openingFences = textBeforeSelection.match(/^```.*$/gm) ?? []
  const closingFences = textBeforeSelection.match(/^```\s*$/gm) ?? []
  const insideFence = openingFences.length > closingFences.length
  const lineStart = body.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1
  const nextBreak = body.indexOf('\n', selectionEnd)
  const lineEnd = nextBreak === -1 ? body.length : nextBreak

  return {
    insideFence,
    lineStart,
    lineEnd,
  }
}

const indentSelectedLines = (body: string, selectionStart: number, selectionEnd: number) => {
  const lineStart = body.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1
  const nextBreak = body.indexOf('\n', selectionEnd)
  const lineEnd = nextBreak === -1 ? body.length : nextBreak
  const target = body.slice(lineStart, lineEnd)
  const lines = target.split('\n')
  const nextBlock = lines.map((line) => `  ${line}`).join('\n')
  const nextBody = body.slice(0, lineStart) + nextBlock + body.slice(lineEnd)

  return {
    nextBody,
    selectionStart: selectionStart + 2,
    selectionEnd: selectionEnd + lines.length * 2,
  }
}

const unindentSelectedLines = (body: string, selectionStart: number, selectionEnd: number) => {
  const lineStart = body.lastIndexOf('\n', Math.max(selectionStart - 1, 0)) + 1
  const nextBreak = body.indexOf('\n', selectionEnd)
  const lineEnd = nextBreak === -1 ? body.length : nextBreak
  const target = body.slice(lineStart, lineEnd)
  const lines = target.split('\n')
  let removedSpaces = 0
  const nextBlock = lines
    .map((line) => {
      if (line.startsWith('  ')) {
        removedSpaces += 2
        return line.slice(2)
      }
      if (line.startsWith('\t')) {
        removedSpaces += 1
        return line.slice(1)
      }
      return line
    })
    .join('\n')
  const nextBody = body.slice(0, lineStart) + nextBlock + body.slice(lineEnd)

  return {
    nextBody,
    selectionStart: Math.max(lineStart, selectionStart - 2),
    selectionEnd: Math.max(lineStart, selectionEnd - removedSpaces),
  }
}

function App() {
  const [localRootPath, setLocalRootPath] = useState('')
  const [localLibraryMessage, setLocalLibraryMessage] = useState(
    'Preparing the default offline knowledge base path.',
  )
  const [libraryNotice, setLibraryNotice] = useState<string | null>(null)
  const [migrationLog, setMigrationLog] = useState<LegacyMigrationLogEntry[]>([])
  const [knowledgeBaseIndex, setKnowledgeBaseIndex] = useState<KnowledgeBaseIndex>({
    rootPath: BROWSER_LOCAL_PATH_PLACEHOLDER,
    notesRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/notes`,
    assetsRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/assets`,
    hiddenRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/.notebase`,
    initializedNewKnowledgeBase: false,
    legacyMigration: { migratedNoteCount: 0, sources: [] },
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
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('notes')
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')
  const [graphZoom, setGraphZoom] = useState(1)
  const [expandedSections, setExpandedSections] = useState<Record<LibrarySectionKey, boolean>>({
    todo: true,
    note: true,
    journal: true,
    notebooks: true,
  })
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('backlinks')
  const [activeDirectorySelection, setActiveDirectorySelection] = useState<ActiveDirectorySelection>({
    kind: 'type',
    value: 'note',
  })
  const [pendingTags, setPendingTags] = useState('')
  const [noteMenuState, setNoteMenuState] = useState<{
    noteId: string
    x: number
    y: number
  } | null>(null)
  const [notebookMenuState, setNotebookMenuState] = useState<{
    notebook: string
    x: number
    y: number
  } | null>(null)
  const [noteTitleDraft, setNoteTitleDraft] = useState('')
  const [menuNotebookDraft, setMenuNotebookDraft] = useState('')
  const [notebookNameDraft, setNotebookNameDraft] = useState('')
  const [wikilinkDraft, setWikilinkDraft] = useState<WikilinkDraft | null>(null)
  const [wikilinkIndex, setWikilinkIndex] = useState(0)
  const [editorTitle, setEditorTitle] = useState(DEFAULT_NOTE_TITLE)
  const [editorBody, setEditorBody] = useState('')
  const [lastSavedTitle, setLastSavedTitle] = useState(DEFAULT_NOTE_TITLE)
  const [lastSavedBody, setLastSavedBody] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveMessage, setSaveMessage] = useState('Select a note to start editing.')
  const [editorViewMode, setEditorViewMode] = useState<EditorViewMode>('markdown')
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(() => loadStoredSyncConfig())
  const [draftSyncConfig, setDraftSyncConfig] = useState<SyncConfig>(() => loadStoredSyncConfig() ?? emptySyncConfig)
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse>(
    emptySyncStatus('Sync has not been configured. Offline mode is active.'),
  )
  const [decisionPanelOpen, setDecisionPanelOpen] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [resolvingConflictPath, setResolvingConflictPath] = useState<string | null>(null)
  const [isDragActive, setIsDragActive] = useState(false)
  const [codeLanguageMenuOpen, setCodeLanguageMenuOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0)
  const [commandPaletteDocumentTypeFilter, setCommandPaletteDocumentTypeFilter] = useState<DocumentType | 'all'>(
    () => {
      const value = loadStoredCommandPaletteFilter(COMMAND_PALETTE_DOCUMENT_FILTER_KEY)
      return value === 'todo' || value === 'note' || value === 'journal' ? value : 'all'
    },
  )
  const [commandPaletteNotebookFilter, setCommandPaletteNotebookFilter] = useState(() =>
    loadStoredCommandPaletteFilter(COMMAND_PALETTE_NOTEBOOK_FILTER_KEY),
  )
  const [commandPaletteTagFilter, setCommandPaletteTagFilter] = useState(() =>
    loadStoredCommandPaletteFilter(COMMAND_PALETTE_TAG_FILTER_KEY),
  )
  const [searchResults, setSearchResults] = useState<SearchLibraryResult[]>([])
  const [searchBusy, setSearchBusy] = useState(false)
  const [settingsPanelOpen, setSettingsPanelOpen] = useState(false)
  const [settingsTab, setSettingsTab] = useState<SettingsTab>('general')
  const [storedNotebooks, setStoredNotebooks] = useState<string[]>(() => loadStoredNotebooks())
  const [creatingNotebook, setCreatingNotebook] = useState(false)
  const [newNotebookName, setNewNotebookName] = useState('')
  const [dragTargetNotebook, setDragTargetNotebook] = useState<string | null>(null)
  const [notePointerDrag, setNotePointerDrag] = useState<NotePointerDragState | null>(null)
  const [noteConnections, setNoteConnections] = useState<NoteConnections>({
    outgoingLinks: [],
    backlinks: [],
    unresolvedLinks: [],
    message: 'Select a note to inspect links.',
  })
  const [knowledgeGraph, setKnowledgeGraph] = useState<KnowledgeGraphResponse>({
    nodes: [],
    edges: [],
    message: 'Open Graph to build the local note graph.',
  })
  const [graphBusy, setGraphBusy] = useState(false)
  const [graphScope, setGraphScope] = useState<GraphScope>('focused')
  const [graphQuery, setGraphQuery] = useState('')
  const [mediaAssets, setMediaAssets] = useState<MediaAssetRecord[]>([])
  const [selectedMediaAssetId, setSelectedMediaAssetId] = useState<string | null>(null)
  const [mediaActionBusy, setMediaActionBusy] = useState(false)
  const [mediaSort, setMediaSort] = useState<MediaSort>('newest')
  const [mediaSelectionMode, setMediaSelectionMode] = useState(false)
  const [selectedMediaAssetIds, setSelectedMediaAssetIds] = useState<string[]>([])

  const runningInTauri = useMemo(() => isTauriRuntime(), [])
  const hasUnsavedChanges = selectedNoteDocument
    ? editorTitle !== lastSavedTitle || editorBody !== lastSavedBody
    : false
  const syncButtonTone = syncToneFromStatus(syncStatus, syncBusy)
  const editorTitleRef = useRef<HTMLInputElement | null>(null)
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const richTextEditorRef = useRef<HTMLDivElement | null>(null)
  const assetPickerRef = useRef<HTMLInputElement | null>(null)
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null)
  const commandPaletteItemsRef = useRef<CommandPaletteItem[]>([])
  const pendingSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  const notePointerDragRef = useRef<NotePointerDragState | null>(null)
  const suppressNextNoteClickRef = useRef(false)
  const notebookDropTargetsRef = useRef<Map<string, HTMLElement>>(new Map())
  const notesByType = useMemo(() => {
    const groups: Record<DocumentType, RealNoteSummary[]> = {
      todo: [],
      note: [],
      journal: [],
    }
    for (const note of knowledgeBaseIndex.notes) {
      if (note.notebook?.trim()) {
        continue
      }
      groups[note.documentType ?? 'note'].push(note)
    }
    return groups
  }, [knowledgeBaseIndex.notes])
  const notebookList = useMemo(() => {
    const counts = new Map<string, number>()

    for (const note of knowledgeBaseIndex.notes) {
      const notebookName = note.notebook?.trim()
      if (notebookName) {
        counts.set(notebookName, (counts.get(notebookName) ?? 0) + 1)
      }
    }

    for (const notebookName of storedNotebooks) {
      counts.set(notebookName, counts.get(notebookName) ?? 0)
    }

    return Array.from(counts.entries())
      .map(([name, count]) => ({ name, count }))
      .sort((left, right) => left.name.localeCompare(right.name))
  }, [knowledgeBaseIndex.notes, storedNotebooks])
  const visibleNotes = useMemo(() => {
    if (activeDirectorySelection.kind === 'type') {
      return notesByType[activeDirectorySelection.value]
    }

    return knowledgeBaseIndex.notes.filter((note) => note.notebook === activeDirectorySelection.value)
  }, [activeDirectorySelection, knowledgeBaseIndex.notes, notesByType])
  const selectedNote = selectedNoteId
    ? knowledgeBaseIndex.notes.find((note) => note.id === selectedNoteId) ?? null
    : null
  const selectedMediaAsset =
    mediaAssets.find((asset) => asset.id === selectedMediaAssetId) ?? mediaAssets[0] ?? null
  const selectedMediaAssets = useMemo(
    () => mediaAssets.filter((asset) => selectedMediaAssetIds.includes(asset.id)),
    [mediaAssets, selectedMediaAssetIds],
  )
  const unlinkedMediaAssets = useMemo(
    () => mediaAssets.filter((asset) => asset.linkedNotes.length === 0),
    [mediaAssets],
  )
  const selectedUnlinkedMediaAssets = useMemo(
    () => selectedMediaAssets.filter((asset) => asset.linkedNotes.length === 0),
    [selectedMediaAssets],
  )
  const filteredMediaAssets = useMemo(() => {
    if (mediaFilter === 'all') {
      return mediaAssets
    }

    return mediaAssets.filter((asset) => {
      if (mediaFilter === 'unlinked') {
        return asset.linkedNotes.length === 0
      }
      if (mediaFilter === 'file') {
        return !['image', 'pdf', 'video'].includes(asset.kind)
      }

      return asset.kind === mediaFilter
    })
  }, [mediaAssets, mediaFilter])
  const sortedMediaAssets = useMemo(() => {
    const assets = [...filteredMediaAssets]

    assets.sort((left, right) => {
      if (mediaSort === 'oldest') {
        return (left.updatedAtMs ?? 0) - (right.updatedAtMs ?? 0) || left.fileName.localeCompare(right.fileName)
      }

      if (mediaSort === 'name') {
        return left.fileName.localeCompare(right.fileName) || (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0)
      }

      if (mediaSort === 'largest') {
        return right.sizeBytes - left.sizeBytes || left.fileName.localeCompare(right.fileName)
      }

      return (right.updatedAtMs ?? 0) - (left.updatedAtMs ?? 0) || left.fileName.localeCompare(right.fileName)
    })

    return assets
  }, [filteredMediaAssets, mediaSort])
  const wikilinkSuggestions = useMemo(() => {
    if (!wikilinkDraft || editorViewMode !== 'markdown' || workspaceView !== 'notes') {
      return []
    }

    const query = wikilinkDraft.query.toLowerCase()
    return knowledgeBaseIndex.notes
      .filter((note) => note.id !== selectedNoteId)
      .filter(
        (note) =>
          !query ||
          note.title.toLowerCase().includes(query) ||
          note.relativePath.toLowerCase().includes(query) ||
          note.tags.some((tag) => tag.toLowerCase().includes(query)),
      )
      .slice(0, 6)
  }, [editorViewMode, knowledgeBaseIndex.notes, selectedNoteId, wikilinkDraft, workspaceView])
  const previewBlocks = useMemo(
    () => renderPreviewBlocks(composeEditableNoteContent(editorTitle, editorBody)),
    [editorBody, editorTitle],
  )
  const [assetPickerKind, setAssetPickerKind] = useState<AssetImportKind>('image')
  const libraryTags = useMemo(() => collectLibraryTags(knowledgeBaseIndex.notes), [knowledgeBaseIndex.notes])
  const hasSearchFilters =
    commandPaletteDocumentTypeFilter !== 'all' ||
    commandPaletteNotebookFilter !== 'all' ||
    commandPaletteTagFilter !== 'all'
  const searchModeActive = commandPaletteQuery.trim().length > 0 || hasSearchFilters
  const noteConnectionsStatusMessage = !selectedNote
    ? 'Select a note to inspect links.'
    : !runningInTauri
      ? 'Link inspection requires the Tauri desktop runtime.'
      : noteConnections.message
  const graphQueryLower = graphQuery.trim().toLowerCase()
  const graphViewport = useMemo(() => {
    const matchedNodeIds = new Set(
      knowledgeGraph.nodes
        .filter((node) => {
          if (!graphQueryLower) {
            return true
          }
          const haystacks = [
            node.title,
            node.relativePath ?? '',
            node.notebook ?? '',
            node.documentType ?? '',
            node.tags.join(' '),
          ]
          return haystacks.some((value) => value.toLowerCase().includes(graphQueryLower))
        })
        .map((node) => node.id),
    )
    const fallbackNodeId = graphQueryLower
      ? knowledgeGraph.nodes.find((node) => matchedNodeIds.has(node.id))?.id ?? null
      : knowledgeGraph.nodes.find((node) => node.kind === 'note')?.id ?? null
    const selectedNodeId =
      selectedNoteId && (!graphQueryLower || matchedNodeIds.has(selectedNoteId))
        ? selectedNoteId
        : fallbackNodeId
    const visibleNodeIds = new Set<string>()

    if (graphScope === 'focused' && selectedNodeId) {
      visibleNodeIds.add(selectedNodeId)
      for (const edge of knowledgeGraph.edges) {
        if (edge.source === selectedNodeId) {
          visibleNodeIds.add(edge.target)
        }
        if (edge.target === selectedNodeId) {
          visibleNodeIds.add(edge.source)
        }
      }
    }

    if (graphScope === 'full' || visibleNodeIds.size <= 1) {
      for (const node of knowledgeGraph.nodes) {
        if (!matchedNodeIds.has(node.id)) {
          continue
        }
        if (visibleNodeIds.size >= (graphScope === 'full' ? 48 : 36)) {
          break
        }
        visibleNodeIds.add(node.id)
      }
    }

    const visibleNodes = knowledgeGraph.nodes
      .filter((node) => visibleNodeIds.has(node.id) && matchedNodeIds.has(node.id))
      .slice(0, graphScope === 'full' ? 48 : 36)
    const visibleIdSet = new Set(visibleNodes.map((node) => node.id))
    const visibleEdges = knowledgeGraph.edges.filter(
      (edge) => visibleIdSet.has(edge.source) && visibleIdSet.has(edge.target),
    )
    const centerNode = selectedNodeId ? visibleNodes.find((node) => node.id === selectedNodeId) ?? null : null
    const orbitNodes = visibleNodes.filter((node) => node.id !== centerNode?.id)
    const layout = new Map<string, { x: number; y: number }>()

    if (centerNode) {
      layout.set(centerNode.id, { x: 50, y: 50 })
    }

    const radius = orbitNodes.length > 12 ? 36 : 30
    orbitNodes.forEach((node, index) => {
      const angle = (Math.PI * 2 * index) / Math.max(orbitNodes.length, 1) - Math.PI / 2
      layout.set(node.id, {
        x: 50 + Math.cos(angle) * radius,
        y: 50 + Math.sin(angle) * radius,
      })
    })

    if (!centerNode) {
      visibleNodes.forEach((node, index) => {
        const angle = (Math.PI * 2 * index) / Math.max(visibleNodes.length, 1) - Math.PI / 2
        layout.set(node.id, {
          x: 50 + Math.cos(angle) * 34,
          y: 50 + Math.sin(angle) * 34,
        })
      })
    }

    return { nodes: visibleNodes, edges: visibleEdges, layout, centerNode }
  }, [graphQueryLower, graphScope, knowledgeGraph, selectedNoteId])
  const noteMenuTarget =
    noteMenuState
      ? knowledgeBaseIndex.notes.find((note) => note.id === noteMenuState.noteId) ?? null
      : null
  const notebookMenuTarget =
    notebookMenuState
      ? notebookList.find((notebook) => notebook.name === notebookMenuState.notebook) ?? null
      : null

  const syncRichTextEditorFromMarkdown = useCallback(
    (markdownBody: string) => {
      if (editorViewMode !== 'rich-text') {
        return
      }

      const richTextEditor = richTextEditorRef.current
      if (!richTextEditor) {
        return
      }

      const nextHtml = markdownToRichTextHtml(markdownBody)
      if (richTextEditor.innerHTML !== nextHtml) {
        richTextEditor.innerHTML = nextHtml
      }
    },
    [editorViewMode],
  )

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

  useEffect(() => {
    window.localStorage.setItem(NOTEBOOKS_KEY, JSON.stringify(storedNotebooks))
  }, [storedNotebooks])

  useEffect(() => {
    window.localStorage.setItem(COMMAND_PALETTE_DOCUMENT_FILTER_KEY, commandPaletteDocumentTypeFilter)
  }, [commandPaletteDocumentTypeFilter])

  useEffect(() => {
    window.localStorage.setItem(COMMAND_PALETTE_NOTEBOOK_FILTER_KEY, commandPaletteNotebookFilter)
  }, [commandPaletteNotebookFilter])

  useEffect(() => {
    window.localStorage.setItem(COMMAND_PALETTE_TAG_FILTER_KEY, commandPaletteTagFilter)
  }, [commandPaletteTagFilter])

  const refreshLocalWorkspace = useCallback(async (rootPath: string) => {
    if (!runningInTauri) {
      setKnowledgeBaseIndex({
        rootPath: BROWSER_LOCAL_PATH_PLACEHOLDER,
        notesRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/notes`,
        assetsRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/assets`,
        hiddenRoot: `${BROWSER_LOCAL_PATH_PLACEHOLDER}/.notebase`,
        initializedNewKnowledgeBase: false,
        legacyMigration: { migratedNoteCount: 0, sources: [] },
        notes: [],
        message: 'Browser preview detected. Offline indexing runs in the Tauri desktop app.',
      })
      setLibraryNotice(null)
      return
    }

    const indexResponse = await invokeWithTimeout<KnowledgeBaseIndex>('load_library_index', { rootPath })

    setKnowledgeBaseIndex(indexResponse)
    setLocalLibraryMessage(indexResponse.message)
    setLibraryNotice(
      indexResponse.legacyMigration.migratedNoteCount > 0 ? indexResponse.message : null,
    )
    setSelectedNoteId((current) => {
      if (current && indexResponse.notes.some((note) => note.id === current)) {
        return current
      }

      return indexResponse.notes[0]?.id ?? null
    })
    if (indexResponse.notes.length === 0) {
      setSelectedNoteDocument(null)
      setEditorTitle(DEFAULT_NOTE_TITLE)
      setEditorBody('')
      setLastSavedTitle(DEFAULT_NOTE_TITLE)
      setLastSavedBody('')
      setSaveStatus('idle')
      setSaveMessage('Select a note to start editing.')
    }
  }, [runningInTauri])

  const refreshMediaAssets = useCallback(async (rootPath: string) => {
    if (!runningInTauri) {
      setMediaAssets([])
      setSelectedMediaAssetId(null)
      return
    }

    try {
      const assets = await invokeWithTimeout<MediaAssetRecord[]>('list_library_assets', { rootPath })
      setMediaAssets(assets)
      setSelectedMediaAssetId((current) =>
        current && assets.some((asset) => asset.id === current) ? current : assets[0]?.id ?? null,
      )
    } catch {
      setMediaAssets([])
      setSelectedMediaAssetId(null)
    }
  }, [runningInTauri])

  const refreshMigrationLog = useCallback(async (rootPath: string) => {
    if (!runningInTauri) {
      setMigrationLog([])
      return
    }

    try {
      const entries = await invokeWithTimeout<LegacyMigrationLogEntry[]>('list_migration_log', { rootPath })
      setMigrationLog(entries.slice().sort((left, right) => right.migratedAtMs - left.migratedAtMs))
    } catch {
      setMigrationLog([])
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
      const editableNote = splitEditableNoteContent(response.body, response.note.title || DEFAULT_NOTE_TITLE)
      setSelectedNoteDocument(response)
      setEditorTitle(editableNote.title)
      setEditorBody(editableNote.body)
      setLastSavedTitle(editableNote.title)
      setLastSavedBody(editableNote.body)
      setPendingTags(response.note.tags.join(', '))
      setSaveStatus('idle')
      setSaveMessage(response.message)
      if (
        response.note.title === DEFAULT_NOTE_TITLE ||
        response.note.title === 'Untitled todo' ||
        response.note.title === 'Journal entry'
      ) {
        window.requestAnimationFrame(() => editorTitleRef.current?.select())
      }
    } catch (error) {
      const message =
        error instanceof Error ? error.message : 'Failed to load the selected note content.'
      setSelectedNoteDocument(null)
      setEditorTitle(DEFAULT_NOTE_TITLE)
      setEditorBody('')
      setLastSavedTitle(DEFAULT_NOTE_TITLE)
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
        await refreshMediaAssets(response.rootPath)
        await refreshMigrationLog(response.rootPath)

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
  }, [assessSyncReadiness, refreshLocalWorkspace, refreshMediaAssets, refreshMigrationLog, runningInTauri, syncConfig])

  useEffect(() => {
    if (!selectedNoteId || !localRootPath) {
      return
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSelectedNoteDocument(selectedNoteId, localRootPath)
  }, [selectedNoteId, localRootPath, loadSelectedNoteDocument])

  useEffect(() => {
    if (!selectedNoteId || !runningInTauri || !localRootPath) {
      return
    }

    let cancelled = false

    const loadConnections = async () => {
      setNoteConnections({
        outgoingLinks: [],
        backlinks: [],
        unresolvedLinks: [],
        message: 'Inspecting wikilinks in the local knowledge base...',
      })
      try {
        const response = await invokeWithTimeout<NoteConnections>('inspect_note_connections', {
          rootPath: localRootPath,
          noteId: selectedNoteId,
        })
        if (!cancelled) {
          setNoteConnections(response)
        }
      } catch (error) {
        if (!cancelled) {
          setNoteConnections({
            outgoingLinks: [],
            backlinks: [],
            unresolvedLinks: [],
            message:
              error instanceof Error
                ? error.message
                : 'Failed to inspect note links in the local knowledge base.',
          })
        }
      }
    }

    void loadConnections()

    return () => {
      cancelled = true
    }
  }, [localRootPath, runningInTauri, selectedNoteId])

  useEffect(() => {
    if (workspaceView !== 'graph' || !runningInTauri || !localRootPath) {
      return
    }

    let cancelled = false
    setGraphBusy(true)
    void invokeWithTimeout<KnowledgeGraphResponse>('load_knowledge_graph', { rootPath: localRootPath })
      .then((response) => {
        if (!cancelled) {
          setKnowledgeGraph(response)
        }
      })
      .catch((error) => {
        if (!cancelled) {
          setKnowledgeGraph({
            nodes: [],
            edges: [],
            message: error instanceof Error ? error.message : 'Failed to build the knowledge graph.',
          })
        }
      })
      .finally(() => {
        if (!cancelled) {
          setGraphBusy(false)
        }
      })

    return () => {
      cancelled = true
    }
  }, [localRootPath, runningInTauri, workspaceView])

  useEffect(() => {
    syncRichTextEditorFromMarkdown(editorBody)
  }, [editorBody, syncRichTextEditorFromMarkdown])

  const applyEditorBody = useCallback(
    (nextBody: string) => {
      setEditorBody(nextBody)

      if (!selectedNoteDocument) {
        setSaveStatus('idle')
        setSaveMessage('Select a note to start editing.')
        return
      }

      if (editorTitle === lastSavedTitle && nextBody === lastSavedBody) {
        setSaveStatus('idle')
        setSaveMessage('No unsaved changes.')
        return
      }

      setSaveStatus('dirty')
      setSaveMessage('Unsaved changes.')
    },
    [editorTitle, lastSavedBody, lastSavedTitle, selectedNoteDocument],
  )

  const handleEditorTitleChange = useCallback(
    (nextTitle: string) => {
      setEditorTitle(nextTitle)

      if (!selectedNoteDocument) {
        setSaveStatus('idle')
        setSaveMessage('Select a note to start editing.')
        return
      }

      if (nextTitle === lastSavedTitle && editorBody === lastSavedBody) {
        setSaveStatus('idle')
        setSaveMessage('No unsaved changes.')
        return
      }

      setSaveStatus('dirty')
      setSaveMessage('Unsaved changes.')
    },
    [editorBody, lastSavedBody, lastSavedTitle, selectedNoteDocument],
  )

  const applyTextSelection = useCallback((selectionStart: number, selectionEnd: number) => {
    const textarea = editorTextareaRef.current
    if (!textarea) {
      return
    }

    window.requestAnimationFrame(() => {
      textarea.focus()
      textarea.setSelectionRange(selectionStart, selectionEnd)
    })
  }, [])

  const syncWikilinkDraft = useCallback(
    (nextBody: string, selectionStart: number, selectionEnd = selectionStart) => {
      if (
        editorViewMode !== 'markdown' ||
        workspaceView !== 'notes' ||
        !selectedNoteId ||
        selectionStart !== selectionEnd
      ) {
        setWikilinkDraft(null)
        setWikilinkIndex(0)
        return
      }

      const nextDraft = detectOpenWikilink(nextBody, selectionStart)
      setWikilinkDraft(nextDraft)
      setWikilinkIndex(0)
    },
    [editorViewMode, selectedNoteId, workspaceView],
  )

  const insertWikilinkSuggestion = useCallback(
    (note: RealNoteSummary) => {
      if (!wikilinkDraft) {
        return
      }

      const replacement = `[[${note.title}]]`
      const nextText =
        editorBody.slice(0, wikilinkDraft.start) + replacement + editorBody.slice(wikilinkDraft.end)
      applyEditorBody(nextText)
      setWikilinkDraft(null)
      setWikilinkIndex(0)
      const nextCursor = wikilinkDraft.start + replacement.length
      applyTextSelection(nextCursor, nextCursor)
    },
    [applyEditorBody, applyTextSelection, editorBody, wikilinkDraft],
  )

  const syncMarkdownFromRichTextEditor = useCallback(() => {
    const richTextEditor = richTextEditorRef.current
    if (!richTextEditor) {
      return
    }

    const nextMarkdown = htmlToMarkdown(richTextEditor.innerHTML)
    applyEditorBody(nextMarkdown)
  }, [applyEditorBody])

  const promptForCodeLanguage = useCallback(() => {
    const language = window.prompt('Code block language', 'ts') ?? ''
    return language.trim()
  }, [])

  const normalizeCodeLanguage = useCallback(
    (language: string) => {
      const trimmed = language.trim()
      return trimmed === 'plain text' ? '' : trimmed
    },
    [],
  )

  const insertCodeBlock = useCallback(
    (language: string) => {
      const normalizedLanguage = normalizeCodeLanguage(language)

      if (editorViewMode === 'rich-text') {
        const richTextEditor = richTextEditorRef.current
        if (!richTextEditor) {
          return
        }

        richTextEditor.focus()
        const selection = window.getSelection()
        const selectedText = selection?.toString() || 'code'
        const escapedCode = escapeHtml(selectedText)
        const languageAttribute = normalizedLanguage
          ? ` data-language="${escapeHtml(normalizedLanguage)}"`
          : ''
        document.execCommand(
          'insertHTML',
          false,
          `<pre${languageAttribute}><code>${escapedCode}</code></pre>`,
        )
        syncMarkdownFromRichTextEditor()
        return
      }

      const textarea = editorTextareaRef.current
      if (!textarea) {
        return
      }

      const selectionStart = textarea.selectionStart
      const selectionEnd = textarea.selectionEnd
      const selectedText = editorBody.slice(selectionStart, selectionEnd)
      const openingFence = normalizedLanguage ? `\`\`\`${normalizedLanguage}` : '```'
      const replacement = selectedText
        ? `${openingFence}\n${selectedText}\n\`\`\``
        : `${openingFence}\ncode\n\`\`\``
      const nextText =
        editorBody.slice(0, selectionStart) + replacement + editorBody.slice(selectionEnd)

      applyEditorBody(nextText)
      const nextCursor = selectionStart + replacement.length
      applyTextSelection(nextCursor, nextCursor)
    },
    [
      applyEditorBody,
      applyTextSelection,
      editorBody,
      editorViewMode,
      normalizeCodeLanguage,
      syncMarkdownFromRichTextEditor,
    ],
  )

  const applyRichTextCommand = useCallback(
    (kind: MarkdownSnippetKind) => {
      const richTextEditor = richTextEditorRef.current
      if (!richTextEditor) {
        return
      }

      richTextEditor.focus()

      if (kind === 'link') {
        const href = window.prompt('Link URL', 'https://example.com')
        if (!href) {
          return
        }
        document.execCommand('createLink', false, href)
      } else if (kind === 'list') {
        document.execCommand('insertUnorderedList')
      } else if (kind === 'bold') {
        document.execCommand('bold')
      } else if (kind === 'h1') {
        document.execCommand('formatBlock', false, 'h1')
      } else if (kind === 'h2') {
        document.execCommand('formatBlock', false, 'h2')
      } else if (kind === 'quote') {
        document.execCommand('formatBlock', false, 'blockquote')
      }

      syncMarkdownFromRichTextEditor()
    },
    [syncMarkdownFromRichTextEditor],
  )

  const insertMarkdownSnippet = useCallback(
    (kind: MarkdownSnippetKind) => {
      const textarea = editorTextareaRef.current
      if (!textarea) {
        return
      }

      const selectionStart = textarea.selectionStart
      const selectionEnd = textarea.selectionEnd
      const selectedText = editorBody.slice(selectionStart, selectionEnd)
      let replacement = selectedText
      let selectionOffset = 0

      switch (kind) {
        case 'h1':
          replacement = `# ${selectedText || 'Heading'}`
          selectionOffset = replacement.length
          break
        case 'h2':
          replacement = `## ${selectedText || 'Section'}`
          selectionOffset = replacement.length
          break
        case 'bold':
          replacement = `**${selectedText || 'bold text'}**`
          selectionOffset = replacement.length
          break
        case 'list':
          replacement = selectedText
            ? selectedText
                .split('\n')
                .map((line) => `- ${line}`)
                .join('\n')
            : '- List item'
          selectionOffset = replacement.length
          break
        case 'quote':
          replacement = selectedText
            ? selectedText
                .split('\n')
                .map((line) => `> ${line}`)
                .join('\n')
            : '> Quote'
          selectionOffset = replacement.length
          break
        case 'link':
          replacement = `[${selectedText || 'link text'}](https://example.com)`
          selectionOffset = replacement.length
          break
      }

      const nextText =
        editorBody.slice(0, selectionStart) + replacement + editorBody.slice(selectionEnd)
      applyEditorBody(nextText)

      const nextCursor = selectionStart + selectionOffset
      applyTextSelection(nextCursor, nextCursor)
    },
    [applyEditorBody, applyTextSelection, editorBody],
  )

  const triggerAssetPicker = useCallback((kind: AssetImportKind) => {
    if (!selectedNoteId) {
      setSaveStatus('idle')
      setSaveMessage('Select a note before importing an asset.')
      return
    }

    if (!runningInTauri) {
      setSaveStatus('error')
      setSaveMessage('Importing assets into the local library requires the Tauri desktop runtime.')
      return
    }

    const textarea = editorTextareaRef.current
    if (textarea) {
      pendingSelectionRef.current = {
        start: textarea.selectionStart,
        end: textarea.selectionEnd,
      }
    } else {
      pendingSelectionRef.current = {
        start: editorBody.length,
        end: editorBody.length,
      }
    }

    setAssetPickerKind(kind)
    assetPickerRef.current?.click()
  }, [editorBody.length, runningInTauri, selectedNoteId])

  const readFileAsBase64 = (file: File) =>
    new Promise<string>((resolve, reject) => {
      const reader = new FileReader()
      reader.onload = () => {
        const result = reader.result
        if (typeof result !== 'string') {
          reject(new Error(`Failed to read ${file.name}.`))
          return
        }

        const [, base64Payload = ''] = result.split(',', 2)
        resolve(base64Payload)
      }
      reader.onerror = () => reject(reader.error ?? new Error(`Failed to read ${file.name}.`))
      reader.readAsDataURL(file)
    })

  const handleAssetPicked = async (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]
    event.target.value = ''

    if (!file || !selectedNoteId) {
      return
    }

    if (!runningInTauri) {
      setSaveStatus('error')
      setSaveMessage('Importing assets into the local library requires the Tauri desktop runtime.')
      return
    }
    await importAssetFiles([file])
  }

  const importAssetFiles = useCallback(
    async (files: File[]) => {
      if (files.length === 0 || !selectedNoteId) {
        return
      }

      if (!runningInTauri) {
        setSaveStatus('error')
        setSaveMessage('Importing assets into the local library requires the Tauri desktop runtime.')
        return
      }

      setSaveStatus('saving')
      setSaveMessage(
        files.length === 1
          ? `Importing ${files[0].name} into the local knowledge base...`
          : `Importing ${files.length} files into the local knowledge base...`,
      )

      try {
        const selection = pendingSelectionRef.current
        const snippets: string[] = []
        const importedPaths: string[] = []

        for (const file of files) {
          const kind: AssetImportKind = file.type.startsWith('image/') ? 'image' : 'file'
          const base64Data = await readFileAsBase64(file)
          const response = await invokeWithTimeout<ImportAssetResponse>('import_asset', {
            rootPath: localRootPath,
            payload: {
              noteId: selectedNoteId,
              fileName: file.name,
              base64Data,
              kind,
            },
          })
          snippets.push(response.markdownSnippet)
          importedPaths.push(response.relativeAssetPath)
        }

        const insertedSnippet = snippets.join('\n')
        if (editorViewMode === 'rich-text' && richTextEditorRef.current) {
          const insertedHtml = markdownToRichTextHtml(insertedSnippet)
          richTextEditorRef.current.focus()
          document.execCommand('insertHTML', false, insertedHtml)
          syncMarkdownFromRichTextEditor()
        } else {
          const nextText =
            editorBody.slice(0, selection.start) + insertedSnippet + editorBody.slice(selection.end)
          applyEditorBody(nextText)
          const nextCursor = selection.start + insertedSnippet.length
          applyTextSelection(nextCursor, nextCursor)
        }
        setSaveMessage(
          files.length === 1
            ? `Imported ${files[0].name} into ${importedPaths[0]}.`
            : `Imported ${files.length} files into the local asset library.`,
        )
        await refreshMediaAssets(localRootPath)
      } catch (error) {
        setSaveStatus('error')
        setSaveMessage(
          error instanceof Error ? error.message : 'Failed to import one or more selected assets.',
        )
      }
    },
    [
      applyEditorBody,
      applyTextSelection,
      editorBody,
      editorViewMode,
      localRootPath,
      refreshMediaAssets,
      runningInTauri,
      selectedNoteId,
      syncMarkdownFromRichTextEditor,
    ],
  )

  const handleOpenLocalPath = async (path: string, mode: 'open' | 'reveal') => {
    if (!runningInTauri) {
      setSaveStatus('error')
      setSaveMessage('Opening local files requires the Tauri desktop runtime.')
      return
    }

    try {
      const command = mode === 'open' ? 'open_local_path' : 'reveal_local_path'
      const response = await invokeWithTimeout<OpenPathResponse>(command, { path })
      setSaveStatus('saved')
      setSaveMessage(response.message)
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(
        error instanceof Error ? error.message : 'Failed to open the requested local file path.',
      )
    }
  }

  const handleDeleteMediaAsset = useCallback(
    async (asset: MediaAssetRecord) => {
      if (!runningInTauri) {
        setSaveStatus('error')
        setSaveMessage('Deleting local assets requires the Tauri desktop runtime.')
        return
      }

      if (!localRootPath) {
        setSaveStatus('error')
        setSaveMessage('The offline knowledge base path is still loading.')
        return
      }

      if (asset.linkedNotes.length > 0) {
        setSaveStatus('error')
        setSaveMessage('Only unlinked assets can be deleted from the media library right now.')
        return
      }

      const confirmed = window.confirm(`Delete unlinked asset ${asset.fileName}? This cannot be undone.`)
      if (!confirmed) {
        return
      }

      setMediaActionBusy(true)
      try {
        const response = await invokeWithTimeout<DeleteLibraryAssetResponse>('delete_library_asset', {
          payload: {
            rootPath: localRootPath,
            relativeAssetPath: asset.relativeAssetPath,
          },
        })
        await refreshLocalWorkspace(localRootPath)
        await refreshMediaAssets(localRootPath)
        setSaveStatus('saved')
        setSaveMessage(response.message)
      } catch (error) {
        setSaveStatus('error')
        setSaveMessage(error instanceof Error ? error.message : 'Failed to delete the selected asset.')
      } finally {
        setMediaActionBusy(false)
      }
    },
    [localRootPath, refreshLocalWorkspace, refreshMediaAssets, runningInTauri],
  )

  const handleDeleteAllUnlinkedAssets = useCallback(async () => {
    if (!runningInTauri) {
      setSaveStatus('error')
      setSaveMessage('Deleting local assets requires the Tauri desktop runtime.')
      return
    }

    if (!localRootPath) {
      setSaveStatus('error')
      setSaveMessage('The offline knowledge base path is still loading.')
      return
    }

    if (unlinkedMediaAssets.length === 0) {
      setSaveStatus('saved')
      setSaveMessage('There are no unlinked assets to delete.')
      return
    }

    const confirmed = window.confirm(
      `Delete ${unlinkedMediaAssets.length} unlinked asset${unlinkedMediaAssets.length === 1 ? '' : 's'}? This cannot be undone.`,
    )
    if (!confirmed) {
      return
    }

    setMediaActionBusy(true)
    let deletedCount = 0

    try {
      for (const asset of unlinkedMediaAssets) {
        await invokeWithTimeout<DeleteLibraryAssetResponse>('delete_library_asset', {
          payload: {
            rootPath: localRootPath,
            relativeAssetPath: asset.relativeAssetPath,
          },
        })
        deletedCount += 1
      }

      await refreshLocalWorkspace(localRootPath)
      await refreshMediaAssets(localRootPath)
      setSaveStatus('saved')
      setSaveMessage(
        `Deleted ${deletedCount} unlinked asset${deletedCount === 1 ? '' : 's'} from the offline library.`,
      )
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(
        error instanceof Error
          ? error.message
          : `Stopped after deleting ${deletedCount} unlinked asset${deletedCount === 1 ? '' : 's'}.`,
      )
      await refreshLocalWorkspace(localRootPath)
      await refreshMediaAssets(localRootPath)
    } finally {
      setMediaActionBusy(false)
    }
  }, [localRootPath, refreshLocalWorkspace, refreshMediaAssets, runningInTauri, unlinkedMediaAssets])

  const handleDeleteSelectedMediaAssets = useCallback(async () => {
    if (!runningInTauri) {
      setSaveStatus('error')
      setSaveMessage('Deleting local assets requires the Tauri desktop runtime.')
      return
    }

    if (!localRootPath) {
      setSaveStatus('error')
      setSaveMessage('The offline knowledge base path is still loading.')
      return
    }

    if (selectedUnlinkedMediaAssets.length === 0) {
      setSaveStatus('saved')
      setSaveMessage('Select one or more unlinked assets to delete.')
      return
    }

    const confirmed = window.confirm(
      `Delete ${selectedUnlinkedMediaAssets.length} selected unlinked asset${selectedUnlinkedMediaAssets.length === 1 ? '' : 's'}? This cannot be undone.`,
    )
    if (!confirmed) {
      return
    }

    setMediaActionBusy(true)
    let deletedCount = 0

    try {
      for (const asset of selectedUnlinkedMediaAssets) {
        await invokeWithTimeout<DeleteLibraryAssetResponse>('delete_library_asset', {
          payload: {
            rootPath: localRootPath,
            relativeAssetPath: asset.relativeAssetPath,
          },
        })
        deletedCount += 1
      }

      await refreshLocalWorkspace(localRootPath)
      await refreshMediaAssets(localRootPath)
      setSelectedMediaAssetIds([])
      setMediaSelectionMode(false)
      setSaveStatus('saved')
      setSaveMessage(
        `Deleted ${deletedCount} selected unlinked asset${deletedCount === 1 ? '' : 's'} from the offline library.`,
      )
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(
        error instanceof Error
          ? error.message
          : `Stopped after deleting ${deletedCount} selected unlinked asset${deletedCount === 1 ? '' : 's'}.`,
      )
      await refreshLocalWorkspace(localRootPath)
      await refreshMediaAssets(localRootPath)
    } finally {
      setMediaActionBusy(false)
    }
  }, [localRootPath, refreshLocalWorkspace, refreshMediaAssets, runningInTauri, selectedUnlinkedMediaAssets])

  const handleToggleMediaSelectionMode = useCallback(() => {
    setMediaSelectionMode((current) => {
      if (current) {
        setSelectedMediaAssetIds([])
      }
      return !current
    })
  }, [])

  const handleSelectAllVisibleMediaAssets = useCallback(() => {
    setSelectedMediaAssetIds(sortedMediaAssets.map((asset) => asset.id))
  }, [sortedMediaAssets])

  const handleClearMediaSelection = useCallback(() => {
    setSelectedMediaAssetIds([])
  }, [])

  const handleMediaCardClick = useCallback((assetId: string) => {
    setSelectedMediaAssetId(assetId)

    if (!mediaSelectionMode) {
      return
    }

    setSelectedMediaAssetIds((current) =>
      current.includes(assetId) ? current.filter((id) => id !== assetId) : [...current, assetId],
    )
  }, [mediaSelectionMode])

  const handleInsertCodeWithLanguage = useCallback(
    (language: string) => {
      insertCodeBlock(language)
      setCodeLanguageMenuOpen(false)
    },
    [insertCodeBlock],
  )

  const handleInsertCodeWithCustomLanguage = useCallback(() => {
    const language = promptForCodeLanguage()
    handleInsertCodeWithLanguage(language)
  }, [handleInsertCodeWithLanguage, promptForCodeLanguage])

  const handleCopyText = async (content: string, label: string) => {
    try {
      await navigator.clipboard.writeText(content)
      setSaveStatus('saved')
      setSaveMessage(`Copied ${label} to the clipboard.`)
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(
        error instanceof Error ? error.message : `Failed to copy ${label} to the clipboard.`,
      )
    }
  }

  const handleEditorBodyChange = (event: ChangeEvent<HTMLTextAreaElement>) => {
    applyEditorBody(event.target.value)
    syncWikilinkDraft(event.target.value, event.target.selectionStart, event.target.selectionEnd)
  }

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (wikilinkDraft && wikilinkSuggestions.length > 0) {
      if (event.key === 'ArrowDown') {
        event.preventDefault()
        setWikilinkIndex((current) => (current + 1) % wikilinkSuggestions.length)
        return
      }

      if (event.key === 'ArrowUp') {
        event.preventDefault()
        setWikilinkIndex((current) =>
          current === 0 ? wikilinkSuggestions.length - 1 : current - 1,
        )
        return
      }

      if (event.key === 'Enter' || event.key === 'Tab') {
        event.preventDefault()
        insertWikilinkSuggestion(wikilinkSuggestions[wikilinkIndex] ?? wikilinkSuggestions[0])
        return
      }
    }

    if (wikilinkDraft && event.key === 'Escape') {
      event.preventDefault()
      setWikilinkDraft(null)
      setWikilinkIndex(0)
      return
    }

    if (event.key === 'Tab') {
      event.preventDefault()
      const textarea = event.currentTarget
      const selectionStart = textarea.selectionStart
      const selectionEnd = textarea.selectionEnd
      const codeFenceContext = detectCodeFenceContext(editorBody, selectionStart, selectionEnd)

      if (
        codeFenceContext.insideFence &&
        selectionStart === selectionEnd &&
        !event.shiftKey
      ) {
        const nextText =
          editorBody.slice(0, selectionStart) + '  ' + editorBody.slice(selectionEnd)
        applyEditorBody(nextText)
        applyTextSelection(selectionStart + 2, selectionStart + 2)
        syncWikilinkDraft(nextText, selectionStart + 2, selectionStart + 2)
        return
      }

      const nextSelection = event.shiftKey
        ? unindentSelectedLines(editorBody, selectionStart, selectionEnd)
        : indentSelectedLines(editorBody, selectionStart, selectionEnd)

      applyEditorBody(nextSelection.nextBody)
      applyTextSelection(nextSelection.selectionStart, nextSelection.selectionEnd)
      syncWikilinkDraft(
        nextSelection.nextBody,
        nextSelection.selectionStart,
        nextSelection.selectionEnd,
      )
    }
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
      const saveStartedAt = Date.now()

      try {
        const composedBody = composeEditableNoteContent(editorTitle, editorBody)
        const response = await invokeWithTimeout<NoteDocument>('save_note_document', {
          rootPath: localRootPath,
          payload: {
            noteId: selectedNoteId,
            body: composedBody,
          },
        })
        const elapsedMs = Date.now() - saveStartedAt
        if (elapsedMs < MIN_SAVE_SPINNER_MS) {
          await new Promise((resolve) => window.setTimeout(resolve, MIN_SAVE_SPINNER_MS - elapsedMs))
        }
        const editableNote = splitEditableNoteContent(response.body, response.note.title || DEFAULT_NOTE_TITLE)
        setSelectedNoteDocument(response)
        setEditorTitle(editableNote.title)
        setEditorBody(editableNote.body)
        setLastSavedTitle(editableNote.title)
        setLastSavedBody(editableNote.body)
        setSaveStatus('saved')
        setSaveMessage(
          mode === 'autosave'
            ? `Autosaved note content to ${response.note.relativePath}.`
            : response.message,
        )
        await refreshLocalWorkspace(localRootPath)
        await refreshMediaAssets(localRootPath)
      } catch (error) {
        setSaveStatus('error')
        setSaveMessage(
          error instanceof Error ? error.message : 'Failed to save the current note to disk.',
        )
      }
    },
    [
      editorTitle,
      editorBody,
      hasUnsavedChanges,
      localRootPath,
      refreshLocalWorkspace,
      refreshMediaAssets,
      runningInTauri,
      selectedNoteDocument,
      selectedNoteId,
    ],
  )

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setCommandPaletteOpen(true)
        setCommandPaletteIndex(0)
        return
      }

      if (commandPaletteOpen) {
        if (event.key === 'Escape') {
          event.preventDefault()
          setCommandPaletteOpen(false)
          setCommandPaletteQuery('')
          setCommandPaletteIndex(0)
          return
        }

        if (commandPaletteItemsRef.current.length > 0 && event.key === 'ArrowDown') {
          event.preventDefault()
          setCommandPaletteIndex((current) => (current + 1) % commandPaletteItemsRef.current.length)
          return
        }

        if (commandPaletteItemsRef.current.length > 0 && event.key === 'ArrowUp') {
          event.preventDefault()
          setCommandPaletteIndex((current) =>
            current === 0 ? commandPaletteItemsRef.current.length - 1 : current - 1,
          )
          return
        }

        if (commandPaletteItemsRef.current.length > 0 && event.key === 'Enter') {
          event.preventDefault()
          void commandPaletteItemsRef.current[commandPaletteIndex]?.run()
          return
        }
      }

      if (!selectedNoteId) {
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 's') {
        event.preventDefault()
        void handleSaveNote('manual')
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'b') {
        event.preventDefault()
        if (editorViewMode === 'rich-text') {
          applyRichTextCommand('bold')
        } else if (editorViewMode === 'markdown') {
          void insertMarkdownSnippet('bold')
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        if (editorViewMode === 'rich-text') {
          applyRichTextCommand('link')
        } else if (editorViewMode === 'markdown') {
          void insertMarkdownSnippet('link')
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === '1') {
        event.preventDefault()
        if (editorViewMode === 'rich-text') {
          applyRichTextCommand('h1')
        } else if (editorViewMode === 'markdown') {
          void insertMarkdownSnippet('h1')
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.altKey && event.key === '2') {
        event.preventDefault()
        if (editorViewMode === 'rich-text') {
          applyRichTextCommand('h2')
        } else if (editorViewMode === 'markdown') {
          void insertMarkdownSnippet('h2')
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.altKey && event.key.toLowerCase() === 'c') {
        event.preventDefault()
        setCodeLanguageMenuOpen((current) => !current)
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === '7') {
        event.preventDefault()
        if (editorViewMode === 'rich-text') {
          applyRichTextCommand('list')
        } else if (editorViewMode === 'markdown') {
          void insertMarkdownSnippet('list')
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key === '>') {
        event.preventDefault()
        if (editorViewMode === 'rich-text') {
          applyRichTextCommand('quote')
        } else if (editorViewMode === 'markdown') {
          void insertMarkdownSnippet('quote')
        }
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'i') {
        event.preventDefault()
        triggerAssetPicker('image')
        return
      }

      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === 'f') {
        event.preventDefault()
        triggerAssetPicker('file')
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => {
      window.removeEventListener('keydown', handleKeyDown)
    }
  }, [
    applyRichTextCommand,
    commandPaletteIndex,
    commandPaletteOpen,
    editorViewMode,
    handleSaveNote,
    insertMarkdownSnippet,
    selectedNoteId,
    triggerAssetPicker,
  ])

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

  const handleSelectNote = useCallback((noteId: string) => {
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
  }, [hasUnsavedChanges, selectedNoteId])

  const handleDirectoryNoteClick = useCallback((noteId: string) => {
    if (suppressNextNoteClickRef.current) {
      suppressNextNoteClickRef.current = false
      return
    }

    handleSelectNote(noteId)
  }, [handleSelectNote])

  const handleCreateNote = useCallback(async (documentType: DocumentType = 'note', notebook?: string | null) => {
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
    if (!localRootPath) {
      setSaveStatus('error')
      setSaveMessage('The offline knowledge base path is still loading.')
      return
    }

    try {
      const response = await invokeWithTimeout<CreateNoteResponse>('create_note', {
        rootPath: localRootPath,
        documentType,
        notebook: notebook ?? null,
      })
      await refreshLocalWorkspace(localRootPath)
      await refreshMediaAssets(localRootPath)
      if (notebook) {
        setStoredNotebooks((current) =>
          current.includes(notebook) ? current : [...current, notebook].sort((a, b) => a.localeCompare(b)),
        )
        setExpandedSections((current) => ({ ...current, notebooks: true }))
        setActiveDirectorySelection({ kind: 'notebook', value: notebook })
      } else {
        setActiveDirectorySelection({ kind: 'type', value: documentType })
      }
      setSelectedNoteId(response.note.id)
      setSaveStatus('saved')
      setSaveMessage(response.message)
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(
        error instanceof Error ? error.message : 'Failed to create a new note in the offline library.',
      )
    }
  }, [hasUnsavedChanges, localRootPath, refreshLocalWorkspace, refreshMediaAssets, runningInTauri])

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
    setSettingsPanelOpen(false)
  }

  const handleRunSyncWithOptions = useCallback(async (
    direction = 'push_local_to_remote',
    allowInitialOverride = false,
  ) => {
    if (!syncConfig) {
      setSettingsTab('sync')
      setSettingsPanelOpen(true)
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
      if (response.conflictCount > 0) {
        setSettingsTab('sync')
        setSettingsPanelOpen(true)
      }
      await refreshLocalWorkspace(localRootPath)
      await refreshMediaAssets(localRootPath)
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
  }, [localRootPath, refreshLocalWorkspace, refreshMediaAssets, syncConfig])

  const handleResolveSyncConflict = useCallback(async (
    relativePath: string,
    resolution: 'keep_local' | 'keep_remote',
  ) => {
    if (!syncConfig) {
      setSettingsTab('sync')
      setSettingsPanelOpen(true)
      return
    }

    setResolvingConflictPath(relativePath)
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
      await refreshMediaAssets(localRootPath)
      setSaveStatus('saved')
      setSaveMessage(response.message)
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(error instanceof Error ? error.message : 'Failed to resolve the selected sync conflict.')
    } finally {
      setResolvingConflictPath(null)
    }
  }, [localRootPath, refreshLocalWorkspace, refreshMediaAssets, syncConfig])

  const handleSyncButtonClick = useCallback(() => {
    if (!syncConfig) {
      setDraftSyncConfig(syncConfig ?? emptySyncConfig)
      setSettingsTab('sync')
      setSettingsPanelOpen(true)
      return
    }

    if (syncStatus.status === 'failed') {
      setDraftSyncConfig(syncConfig)
      setSettingsTab('sync')
      setSettingsPanelOpen(true)
      return
    }

    if (syncStatus.status === 'conflicted' || syncStatus.conflictCount > 0) {
      setDraftSyncConfig(syncConfig)
      setSettingsTab('sync')
      setSettingsPanelOpen(true)
      return
    }

    void handleRunSyncWithOptions('push_local_to_remote', false)
  }, [handleRunSyncWithOptions, syncConfig, syncStatus.conflictCount, syncStatus.status])

  const handleDisconnectSync = () => {
    setSyncConfig(null)
    setDraftSyncConfig(emptySyncConfig)
    setSyncStatus(
      emptySyncStatus(
        'Remote sync configuration was removed. The app will continue scanning the local offline library.',
      ),
    )
    setSettingsPanelOpen(false)
    setDecisionPanelOpen(false)
  }

  const openSettingsPanel = useCallback((tab: SettingsTab = 'general') => {
    setSettingsTab(tab)
    setSettingsPanelOpen(true)
  }, [])

  const closeNoteMenu = useCallback(() => {
    setNoteMenuState(null)
    setNoteTitleDraft('')
    setMenuNotebookDraft('')
  }, [])

  const closeNotebookMenu = useCallback(() => {
    setNotebookMenuState(null)
    setNotebookNameDraft('')
  }, [])

  const handleCreateNotebook = useCallback((notebookName: string) => {
    const normalizedName = notebookName.trim()
    if (!normalizedName) {
      setSaveStatus('error')
      setSaveMessage('Notebook name cannot be empty.')
      return false
    }

    const alreadyExists = storedNotebooks.some((item) => item.toLowerCase() === normalizedName.toLowerCase())
    if (alreadyExists) {
      setExpandedSections((current) => ({ ...current, notebooks: true }))
      setActiveDirectorySelection({ kind: 'notebook', value: normalizedName })
      setSelectedNoteId(null)
      setCreatingNotebook(false)
      setNewNotebookName('')
      setSaveStatus('saved')
      setSaveMessage(`Notebook ${normalizedName} already exists.`)
      return true
    }

    setStoredNotebooks((current) => [...current, normalizedName].sort((a, b) => a.localeCompare(b)))
    setWorkspaceView('notes')
    setExpandedSections((current) => ({ ...current, notebooks: true }))
    setActiveDirectorySelection({ kind: 'notebook', value: normalizedName })
    setSelectedNoteId(null)
    setCreatingNotebook(false)
    setNewNotebookName('')
    setSaveStatus('saved')
    setSaveMessage(`Created notebook ${normalizedName}.`)
    return true
  }, [storedNotebooks])

  const openNotebookCreator = useCallback(() => {
    setWorkspaceView('notes')
    setExpandedSections((current) => ({ ...current, notebooks: true }))
    setCreatingNotebook(true)
  }, [])

  const registerNotebookDropTarget = useCallback(
    (notebookName: string) => (node: HTMLDivElement | null) => {
      if (node) {
        notebookDropTargetsRef.current.set(notebookName, node)
        return
      }

      notebookDropTargetsRef.current.delete(notebookName)
    },
    [],
  )

  const resolveNotebookDropTarget = useCallback((x: number, y: number) => {
    for (const [notebookName, element] of notebookDropTargetsRef.current.entries()) {
      const rect = element.getBoundingClientRect()
      if (x >= rect.left && x <= rect.right && y >= rect.top && y <= rect.bottom) {
        return notebookName
      }
    }

    return null
  }, [])

  const handleNotePointerDown = useCallback((event: React.PointerEvent<HTMLElement>, note: RealNoteSummary) => {
    if (event.button !== 0) {
      return
    }

    const nextDrag: NotePointerDragState = {
      noteId: note.id,
      title: note.title,
      originNotebook: note.notebook,
      startX: event.clientX,
      startY: event.clientY,
      x: event.clientX,
      y: event.clientY,
      hasMoved: false,
    }

    notePointerDragRef.current = nextDrag
    setNotePointerDrag(nextDrag)
  }, [])

  const handleNotebookCreatorSubmit = useCallback(() => {
    void handleCreateNotebook(newNotebookName)
  }, [handleCreateNotebook, newNotebookName])

  const toggleSection = useCallback((section: LibrarySectionKey) => {
    setExpandedSections((current) => ({
      ...current,
      [section]: !current[section],
    }))
  }, [])

  const handleMoveNoteToNotebook = useCallback(async (noteId: string, notebook: string | null) => {
    if (!runningInTauri) {
      return
    }

    try {
      const currentNote = knowledgeBaseIndex.notes.find((note) => note.id === noteId) ?? null
      if (notebook) {
        setStoredNotebooks((current) =>
          current.includes(notebook) ? current : [...current, notebook].sort((a, b) => a.localeCompare(b)),
        )
      }
      const response = await invokeWithTimeout<NoteDocument>('move_note_to_notebook', {
        rootPath: localRootPath,
        payload: {
          noteId,
          notebook,
        },
      })
      await refreshLocalWorkspace(localRootPath)
      closeNoteMenu()
      notePointerDragRef.current = null
      setNotePointerDrag(null)
      setDragTargetNotebook(null)
      if (notebook) {
        setExpandedSections((current) => ({ ...current, notebooks: true }))
        setActiveDirectorySelection({ kind: 'notebook', value: notebook })
        setSelectedNoteId(response.note.id)
      } else {
        setActiveDirectorySelection({ kind: 'type', value: currentNote?.documentType ?? 'note' })
        setSelectedNoteId(response.note.id)
      }
      setSaveStatus('saved')
      setSaveMessage(notebook ? `Moved note into ${notebook}.` : 'Moved note back to its primary list.')
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(error instanceof Error ? error.message : 'Failed to update the selected notebook.')
    }
  }, [closeNoteMenu, knowledgeBaseIndex.notes, localRootPath, refreshLocalWorkspace, runningInTauri])

  useEffect(() => {
    const handlePointerMove = (event: PointerEvent) => {
      const currentDrag = notePointerDragRef.current
      if (!currentDrag) {
        return
      }

      const distanceX = Math.abs(event.clientX - currentDrag.startX)
      const distanceY = Math.abs(event.clientY - currentDrag.startY)
      const hasMoved = currentDrag.hasMoved || distanceX > 5 || distanceY > 5
      const nextDrag = {
        ...currentDrag,
        x: event.clientX,
        y: event.clientY,
        hasMoved,
      }

      notePointerDragRef.current = nextDrag
      setNotePointerDrag(nextDrag)

      if (hasMoved) {
        event.preventDefault()
        setDragTargetNotebook(resolveNotebookDropTarget(event.clientX, event.clientY))
      }
    }

    const handlePointerUp = (event: PointerEvent) => {
      const currentDrag = notePointerDragRef.current
      if (!currentDrag) {
        return
      }

      const targetNotebook = currentDrag.hasMoved
        ? resolveNotebookDropTarget(event.clientX, event.clientY)
        : null
      const shouldMove = Boolean(targetNotebook && targetNotebook !== currentDrag.originNotebook)

      if (currentDrag.hasMoved) {
        event.preventDefault()
        suppressNextNoteClickRef.current = true
      }

      notePointerDragRef.current = null
      setNotePointerDrag(null)
      setDragTargetNotebook(null)

      if (shouldMove && targetNotebook) {
        void handleMoveNoteToNotebook(currentDrag.noteId, targetNotebook)
      }
    }

    const cancelPointerDrag = () => {
      notePointerDragRef.current = null
      setNotePointerDrag(null)
      setDragTargetNotebook(null)
    }

    window.addEventListener('pointermove', handlePointerMove)
    window.addEventListener('pointerup', handlePointerUp)
    window.addEventListener('pointercancel', cancelPointerDrag)
    window.addEventListener('blur', cancelPointerDrag)
    return () => {
      window.removeEventListener('pointermove', handlePointerMove)
      window.removeEventListener('pointerup', handlePointerUp)
      window.removeEventListener('pointercancel', cancelPointerDrag)
      window.removeEventListener('blur', cancelPointerDrag)
    }
  }, [handleMoveNoteToNotebook, resolveNotebookDropTarget])

  const handleRenameNote = useCallback(async () => {
    if (!noteMenuState || !runningInTauri) {
      return
    }

    const nextTitle = noteTitleDraft.trim()
    if (!nextTitle) {
      setSaveStatus('error')
      setSaveMessage('Note title cannot be empty.')
      return
    }

    try {
      const response = await invokeWithTimeout<NoteDocument>('rename_note', {
        rootPath: localRootPath,
        payload: {
          noteId: noteMenuState.noteId,
          title: nextTitle,
        },
      })
      await refreshLocalWorkspace(localRootPath)
      setSelectedNoteDocument(response)
      const editableNote = splitEditableNoteContent(response.body, response.note.title || DEFAULT_NOTE_TITLE)
      setEditorTitle(editableNote.title)
      setEditorBody(editableNote.body)
      setLastSavedTitle(editableNote.title)
      setLastSavedBody(editableNote.body)
      setSelectedNoteId(response.note.id)
      closeNoteMenu()
      setSaveStatus('saved')
      setSaveMessage(`Renamed note to ${response.note.title}.`)
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(error instanceof Error ? error.message : 'Failed to rename the selected note.')
    }
  }, [closeNoteMenu, localRootPath, noteMenuState, noteTitleDraft, refreshLocalWorkspace, runningInTauri])

  const handleDeleteNote = useCallback(async () => {
    if (!noteMenuState || !runningInTauri) {
      return
    }

    const noteToDelete = noteMenuTarget?.title ?? 'this note'
    const confirmed = window.confirm(`Delete ${noteToDelete}? This cannot be undone.`)
    if (!confirmed) {
      return
    }

    try {
      const response = await invokeWithTimeout<DefaultLocalLibraryResponse>('delete_note', {
        rootPath: localRootPath,
        payload: {
          noteId: noteMenuState.noteId,
        },
      })
      await refreshLocalWorkspace(localRootPath)
      if (selectedNoteId === noteMenuState.noteId) {
        setSelectedNoteDocument(null)
        setEditorTitle(DEFAULT_NOTE_TITLE)
        setEditorBody('')
        setLastSavedTitle(DEFAULT_NOTE_TITLE)
        setLastSavedBody('')
        setSelectedNoteId(null)
      }
      closeNoteMenu()
      setSaveStatus('saved')
      setSaveMessage(response.message)
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(error instanceof Error ? error.message : 'Failed to delete the selected note.')
    }
  }, [closeNoteMenu, localRootPath, noteMenuState, noteMenuTarget?.title, refreshLocalWorkspace, runningInTauri, selectedNoteId])

  const handleRenameNotebook = useCallback(async () => {
    if (!notebookMenuState || !runningInTauri) {
      return
    }

    const nextName = notebookNameDraft.trim()
    if (!nextName) {
      setSaveStatus('error')
      setSaveMessage('Notebook name cannot be empty.')
      return
    }

    try {
      const response = await invokeWithTimeout<NotebookMutationResponse>('rename_notebook', {
        rootPath: localRootPath,
        payload: {
          notebook: notebookMenuState.notebook,
          nextName,
        },
      })
      await refreshLocalWorkspace(localRootPath)
      setStoredNotebooks((current) =>
        current
          .filter((name) => name !== notebookMenuState.notebook)
          .concat(response.notebookName ? [response.notebookName] : [])
          .filter((value, index, values) => values.indexOf(value) === index)
          .sort((a, b) => a.localeCompare(b)),
      )
      if (activeDirectorySelection.kind === 'notebook' && activeDirectorySelection.value === notebookMenuState.notebook && response.notebookName) {
        setActiveDirectorySelection({ kind: 'notebook', value: response.notebookName })
      }
      setSelectedNoteId((current) => (current && response.renamedNoteIds[current] ? response.renamedNoteIds[current] : current))
      closeNotebookMenu()
      setSaveStatus('saved')
      setSaveMessage(response.message)
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(error instanceof Error ? error.message : 'Failed to rename the selected notebook.')
    }
  }, [activeDirectorySelection, closeNotebookMenu, localRootPath, notebookMenuState, notebookNameDraft, refreshLocalWorkspace, runningInTauri])

  const handleDeleteNotebook = useCallback(async () => {
    if (!notebookMenuState || !runningInTauri) {
      return
    }

    const confirmed = window.confirm(`Delete notebook ${notebookMenuState.notebook} and all notes inside it? This cannot be undone.`)
    if (!confirmed) {
      return
    }

    try {
      const response = await invokeWithTimeout<NotebookMutationResponse>('delete_notebook', {
        rootPath: localRootPath,
        payload: {
          notebook: notebookMenuState.notebook,
        },
      })
      await refreshLocalWorkspace(localRootPath)
      setStoredNotebooks((current) => current.filter((name) => name !== notebookMenuState.notebook))
      if (activeDirectorySelection.kind === 'notebook' && activeDirectorySelection.value === notebookMenuState.notebook) {
        setActiveDirectorySelection({ kind: 'type', value: 'note' })
      }
      if (selectedNoteId && response.affectedNoteIds.includes(selectedNoteId)) {
        setSelectedNoteDocument(null)
        setEditorTitle(DEFAULT_NOTE_TITLE)
        setEditorBody('')
        setLastSavedTitle(DEFAULT_NOTE_TITLE)
        setLastSavedBody('')
        setSelectedNoteId(null)
      }
      closeNotebookMenu()
      setSaveStatus('saved')
      setSaveMessage(response.message)
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(error instanceof Error ? error.message : 'Failed to delete the selected notebook.')
    }
  }, [activeDirectorySelection, closeNotebookMenu, localRootPath, notebookMenuState, refreshLocalWorkspace, runningInTauri, selectedNoteId])

  const handleSaveTags = useCallback(async () => {
    if (!selectedNote || !runningInTauri) {
      return
    }

    const tags = pendingTags
      .split(',')
      .map((tag) => tag.trim())
      .filter(Boolean)

    try {
      const response = await invokeWithTimeout<NoteDocument>('update_note_tags', {
        rootPath: localRootPath,
        payload: {
          noteId: selectedNote.id,
          tags,
        },
      })
      setSelectedNoteDocument(response)
      setPendingTags(response.note.tags.join(', '))
      await refreshLocalWorkspace(localRootPath)
      setSaveStatus('saved')
      setSaveMessage(response.message)
    } catch (error) {
      setSaveStatus('error')
      setSaveMessage(error instanceof Error ? error.message : 'Failed to update note tags.')
    }
  }, [localRootPath, pendingTags, refreshLocalWorkspace, runningInTauri, selectedNote])

  const openCommandPalette = useCallback(() => {
    setCommandPaletteOpen(true)
    setCommandPaletteIndex(0)
  }, [])

  const closeCommandPalette = useCallback(() => {
    setCommandPaletteOpen(false)
    setCommandPaletteQuery('')
    setCommandPaletteIndex(0)
  }, [])

  const navigateToView = useCallback((view: WorkspaceView) => {
    setWorkspaceView(view)
  }, [])

  const commandPaletteItems = useMemo<CommandPaletteItem[]>(() => {
    const query = commandPaletteQuery.trim().toLowerCase()
    const matches = (...parts: Array<string | undefined>) =>
      !query || parts.some((part) => part?.toLowerCase().includes(query))

    const searchItems: CommandPaletteItem[] = searchModeActive
      ? searchResults.map((result) => ({
          id: `search:${result.note.id}`,
          group: 'search_results' as const,
          title: result.note.title,
          subtitle: result.snippet,
          meta: `${searchMatchKindLabel(result.matchKind)} • ${documentTypeLabel(result.note.documentType)}${result.note.notebook ? ` • ${result.note.notebook}` : ''}`,
          run: () => {
            handleSelectNote(result.note.id)
            closeCommandPalette()
          },
        }))
      : []

    const recentNotes: CommandPaletteItem[] = knowledgeBaseIndex.notes
      .slice(0, 8)
      .filter((note) => matches(note.title, note.summary, note.relativePath, note.tags.join(' ')))
      .map((note) => ({
        id: `note:${note.id}`,
        group: 'recent_notes' as const,
        title: note.title,
        subtitle: note.summary,
        meta: note.relativePath,
        run: () => {
          handleSelectNote(note.id)
          closeCommandPalette()
        },
      }))

    const tagItems: CommandPaletteItem[] = libraryTags
      .filter((tag) => matches(tag))
      .slice(0, 6)
      .map((tag) => ({
        id: `tag:${tag}`,
        group: 'tags' as const,
        title: tag,
        subtitle: commandPaletteTagFilter === tag ? 'Current tag filter' : 'Filter search by this tag',
        run: () => {
          setCommandPaletteTagFilter((current) => (current === tag ? 'all' : tag))
          setCommandPaletteIndex(0)
        },
      }))

    const actionItems: CommandPaletteItem[] = [
      {
        id: 'action:new-note',
        group: 'actions' as const,
        title: 'Create New Note',
        subtitle: 'Create a fresh markdown note in the local library',
        meta: 'N',
        run: async () => {
          closeCommandPalette()
          await handleCreateNote()
        },
      },
      {
        id: 'action:sync',
        group: 'actions' as const,
        title: syncConfig ? 'Run Sync' : 'Configure Sync',
        subtitle: syncConfig
          ? 'Open the remote sync workflow for the offline library'
          : 'Set up an optional NAS / WebDAV sync target',
        meta: syncConfig ? 'S' : '!',
        run: () => {
          closeCommandPalette()
          if (syncConfig) {
            handleSyncButtonClick()
          } else {
            setDraftSyncConfig(emptySyncConfig)
            openSettingsPanel('sync')
          }
        },
      },
      {
        id: 'action:graph',
        group: 'actions' as const,
        title: 'Open Knowledge Graph',
        subtitle: 'Switch to the graph workspace',
        meta: 'G',
        run: () => {
          closeCommandPalette()
          navigateToView('graph')
        },
      },
      {
        id: 'action:media',
        group: 'actions' as const,
        title: 'Open Media Library',
        subtitle: 'Switch to the asset browser workspace',
        meta: 'M',
        run: () => {
          closeCommandPalette()
          navigateToView('media')
        },
      },
      {
        id: 'action:notes',
        group: 'actions' as const,
        title: 'Return to Notes',
        subtitle: 'Go back to the main writing workspace',
        meta: '⌘',
        run: () => {
          closeCommandPalette()
          navigateToView('notes')
        },
      },
    ].filter((item) => matches(item.title, item.subtitle))

    return [...searchItems, ...recentNotes, ...tagItems, ...actionItems]
  }, [
    closeCommandPalette,
    commandPaletteQuery,
    commandPaletteTagFilter,
    handleCreateNote,
    handleSelectNote,
    handleSyncButtonClick,
    knowledgeBaseIndex.notes,
    libraryTags,
    navigateToView,
    openSettingsPanel,
    searchModeActive,
    searchResults,
    syncConfig,
  ])

  useEffect(() => {
    if (!commandPaletteOpen) {
      return
    }

    window.setTimeout(() => {
      commandPaletteInputRef.current?.focus()
      commandPaletteInputRef.current?.select()
    }, 0)
  }, [commandPaletteOpen])

  useEffect(() => {
    commandPaletteItemsRef.current = commandPaletteItems
  }, [commandPaletteItems])

  useEffect(() => {
    if (!commandPaletteOpen || !runningInTauri || !localRootPath || !searchModeActive) {
      setSearchResults([])
      setSearchBusy(false)
      return
    }

    let cancelled = false
    setSearchBusy(true)
    const timer = window.setTimeout(() => {
      void invokeWithTimeout<SearchLibraryResult[]>('search_library', {
        rootPath: localRootPath,
        payload: {
          query: commandPaletteQuery,
          documentType: commandPaletteDocumentTypeFilter,
          notebook: commandPaletteNotebookFilter,
          tag: commandPaletteTagFilter,
          limit: 24,
        },
      })
        .then((results) => {
          if (!cancelled) {
            setSearchResults(results)
          }
        })
        .catch(() => {
          if (!cancelled) {
            setSearchResults([])
          }
        })
        .finally(() => {
          if (!cancelled) {
            setSearchBusy(false)
          }
        })
    }, 160)

    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [
    commandPaletteDocumentTypeFilter,
    commandPaletteNotebookFilter,
    commandPaletteOpen,
    commandPaletteQuery,
    commandPaletteTagFilter,
    localRootPath,
    runningInTauri,
    searchModeActive,
  ])

  const groupedCommandPaletteItems = useMemo(
    () => [
      {
        key: 'search_results',
        label: searchBusy ? 'SEARCHING' : 'SEARCH RESULTS',
        items: commandPaletteItems.filter((item) => item.group === 'search_results'),
      },
      {
        key: 'recent_notes',
        label: searchModeActive ? 'RECENT MATCHES' : 'RECENT NOTES',
        items: commandPaletteItems.filter((item) => item.group === 'recent_notes'),
      },
      {
        key: 'tags',
        label: 'TAGS',
        items: commandPaletteItems.filter((item) => item.group === 'tags'),
      },
      {
        key: 'actions',
        label: 'ACTIONS',
        items: commandPaletteItems.filter((item) => item.group === 'actions'),
      },
    ],
    [commandPaletteItems, searchBusy, searchModeActive],
  )

  const viewMeta = {
    notes: {
      title:
        activeDirectorySelection.kind === 'type'
          ? documentTypeMeta.find((item) => item.key === activeDirectorySelection.value)?.label ?? 'Notes'
          : activeDirectorySelection.value,
      subtitle: selectedNote ? selectedNote.relativePath : 'Offline knowledge base',
      searchPlaceholder: 'Search notes, tags, links',
    },
    graph: {
      title: 'Knowledge Graph',
      subtitle: 'Explore note relationships',
      searchPlaceholder: 'Search knowledge...',
    },
    media: {
      title: 'Media & Assets',
      subtitle: selectedMediaAsset ? selectedMediaAsset.fileName : 'Asset library',
      searchPlaceholder: 'Search assets...',
    },
  } as const

  const activeCommandPaletteItem = commandPaletteItems[commandPaletteIndex] ?? null
  const selectedNoteTags = selectedNote?.tags.slice(0, 6) ?? []

  return (
    <div className="app-shell">
      <div className="workspace-shell">
        <aside className="sidebar shell-sidebar shell-sidebar-collapsed">
          <div className="shell-sidebar-top">
            <div className="sidebar-brand">
              <div className="sidebar-brand-mark">N</div>
            </div>

            <nav className="nav-section shell-nav-section" aria-label="Create document types">
              {documentTypeMeta.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className="nav-item nav-item-collapsed"
                  onClick={() => void handleCreateNote(item.key)}
                  title={item.createLabel}
                  aria-label={item.createLabel}
                >
                  <span className="nav-item-main">
                    <AppIcon name={item.icon} className="nav-icon" />
                  </span>
                </button>
              ))}
              <button
                type="button"
                className="nav-item nav-item-collapsed"
                onClick={openNotebookCreator}
                title="New Folder"
                aria-label="New Folder"
              >
                <span className="nav-item-main">
                  <AppIcon name="folderPlus" className="nav-icon" />
                </span>
              </button>
            </nav>

            <nav className="nav-section shell-nav-section" aria-label="Primary navigation">
              {navItems.map((item) => {
                const isActive =
                  (item.key === 'notes' && workspaceView === 'notes') ||
                  (item.key === 'graph' && workspaceView === 'graph') ||
                  (item.key === 'media' && workspaceView === 'media')
                const handleClick =
                  item.key === 'notes'
                    ? () => navigateToView('notes')
                    : item.key === 'graph'
                      ? () => navigateToView('graph')
                      : item.key === 'media'
                        ? () => navigateToView('media')
                        : undefined

                return (
                  <button
                    key={item.key}
                    type="button"
                    className={`nav-item nav-item-collapsed ${isActive ? 'active' : ''}`}
                    onClick={handleClick}
                    title={item.label}
                    aria-label={item.label}
                  >
                    <span className="nav-item-main">
                      <AppIcon name={item.icon} className="nav-icon" />
                    </span>
                  </button>
                )
              })}
            </nav>
          </div>

          <div className="shell-sidebar-bottom">
            <button
              type="button"
              className="nav-item nav-item-collapsed"
              onClick={() => openSettingsPanel('general')}
              title="Settings"
              aria-label="Settings"
            >
              <span className="nav-item-main">
                <AppIcon name="settings" className="nav-icon" />
              </span>
            </button>
            <button
              type="button"
              className="nav-item nav-item-collapsed"
              title="Trash"
              aria-label="Trash"
            >
              <span className="nav-item-main">
                <AppIcon name="trash" className="nav-icon" />
              </span>
            </button>
            <div className="sidebar-user-row sidebar-user-row-collapsed">
              <div className="sidebar-user-avatar" aria-hidden="true">
                N
              </div>
            </div>
          </div>
        </aside>

        <section className="workspace-main">
          <header className="workspace-topbar">
            <div className="workspace-topbar-primary">
              <div className="workspace-title-block">
                <h2>{viewMeta[workspaceView].title}</h2>
                <p>{viewMeta[workspaceView].subtitle}</p>
              </div>
            </div>

            <div className="workspace-topbar-actions">
              <label
                className="search-field search-field-compact search-field-button"
                htmlFor="global-search"
                onClick={openCommandPalette}
              >
                <AppIcon name="search" className="search-field-icon" />
                <input
                  id="global-search"
                  placeholder={viewMeta[workspaceView].searchPlaceholder}
                  readOnly
                  onFocus={openCommandPalette}
                />
                <kbd>⌘K</kbd>
              </label>
              <button
                type="button"
                className={`sync-entry sync-entry-${syncButtonTone}`}
                onClick={handleSyncButtonClick}
                title={syncStatus.message}
              >
                <span className="sync-entry-icon-wrap" aria-hidden="true">
                  <AppIcon name="sync" className={`sync-entry-icon ${syncBusy ? 'sync-entry-icon-spinning' : ''}`} />
                  {syncButtonTone === 'warning' ? <span className="sync-entry-badge">!</span> : null}
                </span>
              </button>
              <div className="workspace-status">
                <strong>
                  {saveStatus === 'saved'
                    ? 'Saved locally'
                    : saveStatus === 'saving'
                      ? 'Saving'
                      : hasUnsavedChanges
                        ? 'Unsaved changes'
                        : 'Offline library'}
                </strong>
                <span>{selectedNote ? formatRelativeDate(selectedNote.updatedAtMs) : localLibraryMessage}</span>
              </div>
            </div>
          </header>

          {libraryNotice ? (
            <div className="library-notice">
              <span>{libraryNotice}</span>
              <button type="button" onClick={() => setLibraryNotice(null)} aria-label="Dismiss library notice">
                ×
              </button>
            </div>
          ) : null}

          {workspaceView === 'notes' ? (
            <div className="workspace-grid">
              <section className="note-list-panel">
                <div className="directory-tree">
                  {documentTypeMeta.map((section) => {
                    const notes = notesByType[section.key]
                    const isExpanded = expandedSections[section.key]
                    const isActiveSection =
                      activeDirectorySelection.kind === 'type' && activeDirectorySelection.value === section.key

                    return (
                      <div key={section.key} className="directory-section">
                        <button
                          type="button"
                          className={`directory-section-toggle ${isActiveSection ? 'directory-section-toggle-active' : ''}`}
                          onClick={() => {
                            setActiveDirectorySelection({ kind: 'type', value: section.key })
                            toggleSection(section.key)
                          }}
                        >
                          <span className="directory-section-main">
                            <AppIcon name={section.icon} className="stack-item-icon" />
                            <span>{section.label}</span>
                          </span>
                          <span className="directory-section-meta">{isExpanded ? '−' : notes.length}</span>
                        </button>
                        {isExpanded ? (
                          <div className="directory-entry-list">
                            {notes.length > 0 ? (
                              notes.map((note) => (
                                <button
                                  key={note.id}
                                  type="button"
                                  className={`directory-entry ${selectedNote?.id === note.id ? 'directory-entry-active' : ''}`}
                                  onClick={() => handleDirectoryNoteClick(note.id)}
                                  onPointerDown={(event) => handleNotePointerDown(event, note)}
                                  onContextMenu={(event) => {
                                    event.preventDefault()
                                    closeNotebookMenu()
                                    setNoteMenuState({
                                      noteId: note.id,
                                      x: event.clientX,
                                      y: event.clientY,
                                    })
                                    setNoteTitleDraft(note.title)
                                  }}
                                >
                                  <span>{note.title}</span>
                                </button>
                              ))
                            ) : (
                              <div className="empty-directory-state">No {section.label.toLowerCase()} yet.</div>
                            )}
                          </div>
                        ) : null}
                      </div>
                    )
                  })}

                  <div className="directory-section">
                    <button
                      type="button"
                      className={`directory-section-toggle ${
                        activeDirectorySelection.kind === 'notebook' ? 'directory-section-toggle-active' : ''
                      }`}
                      onClick={() => toggleSection('notebooks')}
                    >
                      <span className="directory-section-main">
                        <AppIcon name="notebook" className="stack-item-icon" />
                        <span>Notebooks</span>
                      </span>
                      <span className="directory-section-meta">
                        {expandedSections.notebooks ? '−' : notebookList.length}
                      </span>
                    </button>
                    {expandedSections.notebooks ? (
                      <div className="directory-entry-list">
                        {creatingNotebook ? (
                          <div className="directory-inline-creator">
                            <input
                              value={newNotebookName}
                              onChange={(event) => setNewNotebookName(event.target.value)}
                              onKeyDown={(event) => {
                                if (event.key === 'Enter') {
                                  event.preventDefault()
                                  handleNotebookCreatorSubmit()
                                }
                                if (event.key === 'Escape') {
                                  setCreatingNotebook(false)
                                  setNewNotebookName('')
                                }
                              }}
                              className="directory-inline-input"
                              placeholder="New notebook"
                              autoFocus
                            />
                            <button
                              type="button"
                              className="directory-inline-action"
                              onClick={handleNotebookCreatorSubmit}
                            >
                              Add
                            </button>
                          </div>
                        ) : null}
                        {notebookList.length > 0 ? (
                          notebookList.map((notebook) => (
                            <div
                              key={notebook.name}
                              ref={registerNotebookDropTarget(notebook.name)}
                              className={`directory-notebook-block ${
                                dragTargetNotebook === notebook.name ? 'directory-entry-drop-target' : ''
                              }`}
                            >
                              <button
                                type="button"
                                className={`directory-entry ${
                                  activeDirectorySelection.kind === 'notebook' &&
                                  activeDirectorySelection.value === notebook.name
                                    ? 'directory-entry-active'
                                    : ''
                                }`}
                                onClick={() => {
                                  setActiveDirectorySelection({ kind: 'notebook', value: notebook.name })
                                  setSelectedNoteId(null)
                                }}
                                onContextMenu={(event) => {
                                  event.preventDefault()
                                  closeNoteMenu()
                                  setNotebookMenuState({
                                    notebook: notebook.name,
                                    x: event.clientX,
                                    y: event.clientY,
                                  })
                                  setNotebookNameDraft(notebook.name)
                                }}
                              >
                                <span>{notebook.name}</span>
                                <strong>{notebook.count}</strong>
                              </button>
                              {activeDirectorySelection.kind === 'notebook' &&
                              activeDirectorySelection.value === notebook.name ? (
                                <div className="directory-entry-sublist">
                                  {visibleNotes.map((note) => (
                                    <button
                                      key={note.id}
                                      type="button"
                                      className={`directory-entry directory-entry-leaf ${
                                        selectedNote?.id === note.id ? 'directory-entry-active' : ''
                                      }`}
                                      onClick={() => handleDirectoryNoteClick(note.id)}
                                      onPointerDown={(event) => handleNotePointerDown(event, note)}
                                      onContextMenu={(event) => {
                                        event.preventDefault()
                                        closeNotebookMenu()
                                        setNoteMenuState({
                                          noteId: note.id,
                                          x: event.clientX,
                                          y: event.clientY,
                                        })
                                        setNoteTitleDraft(note.title)
                                      }}
                                    >
                                      <span>{note.title}</span>
                                    </button>
                                  ))}
                                </div>
                              ) : null}
                            </div>
                          ))
                        ) : (
                          <div className="empty-directory-state">No notebooks assigned yet.</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                </div>
              </section>

              <section className="editor-panel">
                <div className="toolbar">
                  {formattingTools.map((tool) => (
                    <button
                      key={tool.label}
                      type="button"
                      className="tool-button"
                      title={`${tool.label} • ${tool.shortcut}`}
                      aria-label={tool.label}
                      disabled={!selectedNote || editorViewMode === 'preview'}
                      onClick={() => {
                        if (tool.kind === 'image' || tool.kind === 'file') {
                          triggerAssetPicker(tool.kind)
                          return
                        }

                        if (tool.kind === 'code') {
                          setCodeLanguageMenuOpen((current) => !current)
                          return
                        }

                        if (editorViewMode === 'rich-text') {
                          applyRichTextCommand(tool.kind)
                          return
                        }

                        void insertMarkdownSnippet(tool.kind)
                      }}
                    >
                      <AppIcon name={toolbarIconMap[tool.kind]} className="tool-icon" />
                    </button>
                  ))}
                  <div className="toolbar-spacer" />
                  <button
                    type="button"
                    className={`tool-button ${editorViewMode === 'preview' ? 'tool-button-active' : ''}`}
                    title={editorViewMode === 'preview' ? 'Write' : 'Preview'}
                    aria-label={editorViewMode === 'preview' ? 'Write' : 'Preview'}
                    onClick={() =>
                      setEditorViewMode((current) => (current === 'preview' ? 'markdown' : 'preview'))
                    }
                  >
                    <AppIcon
                      name={editorViewMode === 'preview' ? 'write' : 'preview'}
                      className="tool-icon"
                    />
                  </button>
                  <button
                    type="button"
                    className="tool-button"
                    title={saveMessage}
                    aria-label="Save"
                    disabled={!selectedNote || saveStatus === 'saving' || !hasUnsavedChanges}
                    onClick={() => void handleSaveNote('manual')}
                  >
                    <AppIcon name="sync" className={`tool-icon ${saveStatus === 'saving' ? 'sync-entry-icon-spinning' : ''}`} />
                  </button>
                </div>
                {codeLanguageMenuOpen ? (
                  <div className="code-language-card">
                    <div className="code-language-header">
                      <strong>Insert code block</strong>
                      <span>Pick a language for the fence.</span>
                    </div>
                    <div className="code-language-grid">
                      {commonCodeLanguages.map((language) => (
                        <button
                          key={language}
                          type="button"
                          className="code-language-chip"
                          onClick={() => handleInsertCodeWithLanguage(language)}
                        >
                          {language}
                        </button>
                      ))}
                      <button
                        type="button"
                        className="code-language-chip code-language-chip-secondary"
                        onClick={handleInsertCodeWithCustomLanguage}
                      >
                        Custom...
                      </button>
                    </div>
                  </div>
                ) : null}
                <input
                  ref={assetPickerRef}
                  type="file"
                  className="hidden-file-input"
                  accept={assetPickerKind === 'image' ? 'image/*' : undefined}
                  onChange={(event) => void handleAssetPicked(event)}
                />

                <div className="editor-body">
                  <article className="editor-surface editor-surface-writing">
                    {selectedNote ? (
                      editorViewMode === 'preview' ? (
                        <div className="markdown-preview">
                          {previewBlocks.length > 0 ? (
                            previewBlocks.map((block, index) => {
                              if (block.type === 'h1') {
                                return <h1 key={`${block.type}-${index}`}>{renderInlinePreview(block.content)}</h1>
                              }
                              if (block.type === 'h2') {
                                return <h2 key={`${block.type}-${index}`}>{renderInlinePreview(block.content)}</h2>
                              }
                              if (block.type === 'quote') {
                                return (
                                  <blockquote key={`${block.type}-${index}`}>
                                    {renderInlinePreview(block.content)}
                                  </blockquote>
                                )
                              }
                              if (block.type === 'list') {
                                return (
                                  <ul key={`${block.type}-${index}`}>
                                    {block.content.split('\n').map((item) => (
                                      <li key={item}>{renderInlinePreview(item)}</li>
                                    ))}
                                  </ul>
                                )
                              }
                              if (block.type === 'checklist') {
                                return (
                                  <ul key={`${block.type}-${index}`} className="preview-checklist">
                                    {block.content.split('\n').map((item) => {
                                      const [checkedFlag, label] = item.split('|')
                                      return (
                                        <li key={item}>
                                          <input type="checkbox" checked={checkedFlag === '1'} readOnly />
                                          <span>{renderInlinePreview(label)}</span>
                                        </li>
                                      )
                                    })}
                                  </ul>
                                )
                              }
                              if (block.type === 'code') {
                                return (
                                  <div key={`${block.type}-${index}`} className="preview-code-block">
                                    <div className="preview-code-header">
                                      <span>{block.language || 'plain text'}</span>
                                      <button
                                        type="button"
                                        className="ghost-action"
                                        onClick={() => void handleCopyText(block.content, 'code block')}
                                      >
                                        Copy
                                      </button>
                                    </div>
                                    <pre>{block.content}</pre>
                                  </div>
                                )
                              }
                              return <p key={`${block.type}-${index}`}>{renderInlinePreview(block.content)}</p>
                            })
                          ) : (
                            <p className="preview-empty">Nothing to preview yet.</p>
                          )}
                        </div>
                      ) : (
                        <div className="writer-stack">
                          <input
                            ref={editorTitleRef}
                            className="editor-title-field"
                            value={editorTitle}
                            onChange={(event) => handleEditorTitleChange(event.target.value)}
                            placeholder={DEFAULT_NOTE_TITLE}
                          />
                          <textarea
                            ref={editorTextareaRef}
                            className={`markdown-editor ${isDragActive ? 'drag-active' : ''}`}
                            value={editorBody}
                            placeholder="Start writing..."
                            onChange={handleEditorBodyChange}
                            onKeyDown={handleEditorKeyDown}
                            onClick={(event) =>
                              syncWikilinkDraft(
                                event.currentTarget.value,
                                event.currentTarget.selectionStart,
                                event.currentTarget.selectionEnd,
                              )
                            }
                            onKeyUp={(event) =>
                              syncWikilinkDraft(
                                event.currentTarget.value,
                                event.currentTarget.selectionStart,
                                event.currentTarget.selectionEnd,
                              )
                            }
                            onDragOver={(event) => {
                              const hasFiles = Array.from(event.dataTransfer.types).includes('Files')
                              if (!hasFiles) {
                                return
                              }
                              event.preventDefault()
                              setIsDragActive(true)
                            }}
                            onDragLeave={(event) => {
                              if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
                                return
                              }
                              setIsDragActive(false)
                            }}
                            onDrop={(event) => {
                              const hasFiles = Array.from(event.dataTransfer.types).includes('Files')
                              if (!hasFiles) {
                                return
                              }
                              event.preventDefault()
                              setIsDragActive(false)
                              pendingSelectionRef.current = {
                                start: event.currentTarget.selectionStart,
                                end: event.currentTarget.selectionEnd,
                              }
                              const files = Array.from(event.dataTransfer.files)
                              if (files.length > 0) {
                                void importAssetFiles(files)
                              }
                            }}
                            spellCheck={false}
                          />
                          {wikilinkDraft && wikilinkSuggestions.length > 0 ? (
                            <div className="wikilink-card">
                              <div className="wikilink-card-header">
                                <strong>Link a note</strong>
                                <span>
                                  {wikilinkDraft.query
                                    ? `Matches for "${wikilinkDraft.query}"`
                                    : 'Type to narrow the local note list'}
                                </span>
                              </div>
                              <div className="wikilink-list">
                                {wikilinkSuggestions.map((note, index) => (
                                  <button
                                    key={note.id}
                                    type="button"
                                    className={`wikilink-item ${index === wikilinkIndex ? 'active' : ''}`}
                                    onMouseEnter={() => setWikilinkIndex(index)}
                                    onMouseDown={(event) => {
                                      event.preventDefault()
                                      insertWikilinkSuggestion(note)
                                    }}
                                  >
                                    <strong>{note.title}</strong>
                                    <span>{note.relativePath}</span>
                                  </button>
                                ))}
                              </div>
                              <p className="wikilink-footnote">Enter or Tab inserts the selected note.</p>
                            </div>
                          ) : null}
                        </div>
                      )
                    ) : (
                      <div className="editor-empty-state">
                        <strong>No note selected</strong>
                        <p>
                          {activeDirectorySelection.kind === 'notebook'
                            ? `Choose a note from ${activeDirectorySelection.value} to start editing.`
                            : 'Choose a document from the directory tree to start editing.'}
                        </p>
                        <button
                          type="button"
                          className="empty-state-action"
                          onClick={() =>
                            activeDirectorySelection.kind === 'notebook'
                              ? void handleCreateNote('note', activeDirectorySelection.value)
                              : void handleCreateNote(activeDirectorySelection.value)
                          }
                        >
                          {activeDirectorySelection.kind === 'notebook'
                            ? 'Create note in this notebook'
                            : `Create ${documentTypeMeta
                                .find((item) => item.key === activeDirectorySelection.value)
                                ?.createLabel.toLowerCase() ?? 'note'}`}
                        </button>
                      </div>
                    )}
                  </article>
                </div>
              </section>

              <aside className="inspector-panel">
                <div className="panel-heading">
                  <div>
                    <p className="section-label">Knowledge graph</p>
                    <h2>{selectedNote ? 'Note map' : 'Graph view'}</h2>
                  </div>
                </div>

                <section className="inspector-section">
                  <div className="connection-graph-card">
                    <div className="connection-graph-center" />
                    <div className="connection-graph-node node-a" />
                    <div className="connection-graph-node node-b" />
                    <div className="connection-graph-node node-c" />
                    <div className="connection-graph-node node-d" />
                    <div className="connection-graph-line line-a" />
                    <div className="connection-graph-line line-b" />
                    <div className="connection-graph-line line-c" />
                    <span className="connection-graph-label">Interactive Graph</span>
                  </div>
                </section>

                <section className="inspector-section">
                  <div className="inspector-tab-row" role="tablist" aria-label="Knowledge graph context">
                    <button
                      type="button"
                      className={`inspector-tab ${inspectorTab === 'backlinks' ? 'inspector-tab-active' : ''}`}
                      onClick={() => setInspectorTab('backlinks')}
                      title="Backlinks"
                      aria-label="Backlinks"
                    >
                      <AppIcon name="backlink" className="tool-icon" />
                    </button>
                    <button
                      type="button"
                      className={`inspector-tab ${inspectorTab === 'outgoing' ? 'inspector-tab-active' : ''}`}
                      onClick={() => setInspectorTab('outgoing')}
                      title="Outgoing links"
                      aria-label="Outgoing links"
                    >
                      <AppIcon name="outgoing" className="tool-icon" />
                    </button>
                    <button
                      type="button"
                      className={`inspector-tab ${inspectorTab === 'tags' ? 'inspector-tab-active' : ''}`}
                      onClick={() => setInspectorTab('tags')}
                      title="Tags"
                      aria-label="Tags"
                    >
                      <AppIcon name="tag" className="tool-icon" />
                    </button>
                  </div>
                  {inspectorTab === 'backlinks' ? (
                    <div className="inspector-tab-panel">
                      <div className="inspector-subsection">
                        <p className="section-label inspector-section-label-with-icon">
                          <AppIcon name="backlink" className="tool-icon" />
                          <span>Backlinks</span>
                        </p>
                        <div className="connection-card-list">
                          {noteConnections.backlinks.length > 0 ? (
                            noteConnections.backlinks.map((item) => (
                              <button
                                key={item.noteId}
                                type="button"
                                className="connection-card"
                                onClick={() => handleSelectNote(item.noteId)}
                              >
                                <strong>{item.title}</strong>
                                <span>{item.relativePath}</span>
                              </button>
                            ))
                          ) : (
                            <div className="empty-directory-state">{noteConnectionsStatusMessage}</div>
                          )}
                        </div>
                      </div>
                    </div>
                  ) : inspectorTab === 'outgoing' ? (
                    <div className="inspector-tab-panel">
                      <div className="inspector-subsection">
                        <p className="section-label inspector-section-label-with-icon">
                          <AppIcon name="outgoing" className="tool-icon" />
                          <span>Outgoing Links</span>
                        </p>
                        <div className="connection-card-list">
                          {noteConnections.outgoingLinks.length > 0 ? (
                            noteConnections.outgoingLinks.map((item) => (
                              <button
                                key={item.noteId}
                                type="button"
                                className="connection-card"
                                onClick={() => handleSelectNote(item.noteId)}
                              >
                                <strong>{item.title}</strong>
                                <span>{item.relativePath}</span>
                              </button>
                            ))
                          ) : (
                            <div className="empty-directory-state">No resolved wikilinks in this note yet.</div>
                          )}
                          {noteConnections.unresolvedLinks.length > 0 ? (
                            <div className="link-callout">
                              <strong>Unresolved</strong>
                              {noteConnections.unresolvedLinks.map((item) => (
                                <span key={item}>[[{item}]]</span>
                              ))}
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ) : (
                    <div className="inspector-tab-panel">
                      <div className="inspector-subsection">
                        <p className="section-label inspector-section-label-with-icon">
                          <AppIcon name="tag" className="tool-icon" />
                          <span>Tags</span>
                        </p>
                        {selectedNote ? (
                          <>
                            {selectedNoteTags.length > 0 ? (
                              <div className="related-tag-list">
                                {selectedNoteTags.map((tag) => (
                                  <span key={tag} className="related-tag-chip">
                                    {tag}
                                  </span>
                                ))}
                              </div>
                            ) : (
                              <div className="empty-directory-state">No tags on this note yet.</div>
                            )}
                            <label className="config-field full-span">
                              <span>Edit tags</span>
                              <input
                                className="tag-editor-input"
                                value={pendingTags}
                                onChange={(event) => setPendingTags(event.target.value)}
                                placeholder="design, reference, weekly"
                              />
                            </label>
                            <div className="inline-actions tag-editor-actions">
                              <button type="button" className="save-action tag-save-action" onClick={() => void handleSaveTags()}>
                                Save Tags
                              </button>
                            </div>
                          </>
                        ) : (
                          <div className="empty-directory-state">Select a note to manage tags.</div>
                        )}
                      </div>
                    </div>
                  )}
                </section>
              </aside>
            </div>
          ) : workspaceView === 'graph' ? (
            <section className="graph-workspace">
              <div className="graph-canvas">
                <div className="graph-scene" style={{ transform: `scale(${graphZoom})` }}>
                  <svg className="graph-edge-layer" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden="true">
                    {graphViewport.edges.map((edge) => {
                      const source = graphViewport.layout.get(edge.source)
                      const target = graphViewport.layout.get(edge.target)
                      if (!source || !target) {
                        return null
                      }

                      return (
                        <line
                          key={edge.id}
                          className={`graph-edge graph-edge-${edge.kind}`}
                          x1={source.x}
                          y1={source.y}
                          x2={target.x}
                          y2={target.y}
                        />
                      )
                    })}
                  </svg>
                  {graphViewport.nodes.length > 0 ? (
                    graphViewport.nodes.map((node) => {
                      const position = graphViewport.layout.get(node.id) ?? { x: 50, y: 50 }
                      const isActive = node.id === selectedNoteId
                      return (
                        <button
                          key={node.id}
                          type="button"
                          className={`graph-node graph-node-${node.kind} ${isActive ? 'graph-node-active' : ''}`}
                          style={{ left: `${position.x}%`, top: `${position.y}%` }}
                          title={node.relativePath ?? `#${node.title}`}
                          onClick={() => {
                            if (node.kind === 'note') {
                              setSelectedNoteId(node.id)
                              navigateToView('notes')
                            } else {
                              setCommandPaletteTagFilter(node.title)
                              openCommandPalette()
                            }
                          }}
                        >
                          <strong>{node.kind === 'tag' ? `#${node.title}` : node.title}</strong>
                          <span>
                            {node.kind === 'tag'
                              ? 'tag'
                              : node.notebook ?? documentTypeMeta.find((item) => item.key === node.documentType)?.label ?? 'note'}
                          </span>
                        </button>
                      )
                    })
                  ) : (
                    <div className="graph-empty-state">
                      <strong>{graphBusy ? 'Building graph...' : 'No graph data yet'}</strong>
                      <span>{knowledgeGraph.message}</span>
                    </div>
                  )}
                </div>

                <div className="graph-floating-controls">
                  <button
                    type="button"
                    className="graph-control-button"
                    onClick={() => setGraphZoom((current) => Math.min(1.6, Number((current + 0.1).toFixed(2))))}
                  >
                    +
                  </button>
                  <button
                    type="button"
                    className="graph-control-button"
                    onClick={() => setGraphZoom((current) => Math.max(0.75, Number((current - 0.1).toFixed(2))))}
                  >
                    −
                  </button>
                  <button type="button" className="graph-control-button" onClick={() => setGraphZoom(1)}>
                    ⟲
                  </button>
                </div>

                <div className="graph-filter-card">
                  <div className="section-heading">
                    <strong>Knowledge Graph</strong>
                    <button type="button" className="ghost-action" onClick={() => navigateToView('notes')}>
                      Notes
                    </button>
                  </div>
                  <div className="graph-mode-row">
                    <button
                      type="button"
                      className={`graph-mode-chip ${graphScope === 'focused' ? 'active' : ''}`}
                      onClick={() => setGraphScope('focused')}
                    >
                      Focused
                    </button>
                    <button
                      type="button"
                      className={`graph-mode-chip ${graphScope === 'full' ? 'active' : ''}`}
                      onClick={() => setGraphScope('full')}
                    >
                      Full
                    </button>
                  </div>
                  <label className="graph-search-field">
                    <input
                      value={graphQuery}
                      onChange={(event) => setGraphQuery(event.target.value)}
                      placeholder="Find note or tag"
                    />
                  </label>
                  <div className="graph-filter-row">
                    <span className="graph-filter-dot blue" />
                    <span>Note nodes</span>
                    <strong>{knowledgeGraph.nodes.filter((node) => node.kind === 'note').length}</strong>
                  </div>
                  <div className="graph-filter-row">
                    <span className="graph-filter-dot violet" />
                    <span>Wikilinks</span>
                    <strong>{knowledgeGraph.edges.filter((edge) => edge.kind === 'wikilink').length}</strong>
                  </div>
                  <div className="graph-filter-row">
                    <span className="graph-filter-dot orange" />
                    <span>Tags</span>
                    <strong>{knowledgeGraph.nodes.filter((node) => node.kind === 'tag').length}</strong>
                  </div>
                </div>
              </div>
              <div className="graph-status-bar">
                <span>VISIBLE NODES: {graphViewport.nodes.length}</span>
                <span>VISIBLE LINKS: {graphViewport.edges.length}</span>
                <span className="graph-status-live">{graphBusy ? 'BUILDING GRAPH' : knowledgeGraph.message}</span>
              </div>
            </section>
          ) : (
            <div className="media-workspace">
              <section className="media-main-panel">
                <div className="media-toolbar">
                  <div className="media-filter-bar">
                    {[
                      ['all', 'All'],
                      ['image', 'Images'],
                      ['pdf', 'PDFs'],
                      ['video', 'Videos'],
                      ['file', 'Files'],
                      ['unlinked', 'Unlinked'],
                    ].map(([filterKey, label]) => (
                      <button
                        key={filterKey}
                        type="button"
                        className={`media-filter-chip ${mediaFilter === filterKey ? 'active' : ''}`}
                        onClick={() => setMediaFilter(filterKey as MediaFilter)}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                  <div className="media-toolbar-meta">
                    <span>{sortedMediaAssets.length} items</span>
                    <span>{unlinkedMediaAssets.length} unlinked</span>
                    {mediaSelectionMode ? (
                      <span>{selectedMediaAssetIds.length} selected</span>
                    ) : null}
                    <label className="media-sort-control">
                      <span>Sort</span>
                      <select value={mediaSort} onChange={(event) => setMediaSort(event.target.value as MediaSort)}>
                        <option value="newest">{mediaSortLabel('newest')}</option>
                        <option value="oldest">{mediaSortLabel('oldest')}</option>
                        <option value="name">{mediaSortLabel('name')}</option>
                        <option value="largest">{mediaSortLabel('largest')}</option>
                      </select>
                    </label>
                    <button
                      type="button"
                      className="ghost-action"
                      disabled={mediaActionBusy}
                      onClick={() => void refreshMediaAssets(localRootPath)}
                    >
                      Refresh
                    </button>
                    <button
                      type="button"
                      className="ghost-action"
                      disabled={mediaActionBusy || sortedMediaAssets.length === 0}
                      onClick={handleToggleMediaSelectionMode}
                    >
                      {mediaSelectionMode ? 'Done Selecting' : 'Select'}
                    </button>
                    {mediaSelectionMode ? (
                      <>
                        <button
                          type="button"
                          className="ghost-action"
                          disabled={mediaActionBusy || sortedMediaAssets.length === 0}
                          onClick={handleSelectAllVisibleMediaAssets}
                        >
                          Select Visible
                        </button>
                        <button
                          type="button"
                          className="ghost-action"
                          disabled={mediaActionBusy || selectedMediaAssetIds.length === 0}
                          onClick={handleClearMediaSelection}
                        >
                          Clear
                        </button>
                        <button
                          type="button"
                          className="ghost-danger"
                          disabled={mediaActionBusy || selectedUnlinkedMediaAssets.length === 0}
                          onClick={() => void handleDeleteSelectedMediaAssets()}
                        >
                          {mediaActionBusy
                            ? 'Deleting…'
                            : `Delete Selected Unlinked (${selectedUnlinkedMediaAssets.length})`}
                        </button>
                      </>
                    ) : null}
                    <button
                      type="button"
                      className="ghost-danger"
                      disabled={mediaActionBusy || unlinkedMediaAssets.length === 0}
                      onClick={() => void handleDeleteAllUnlinkedAssets()}
                    >
                      {mediaActionBusy ? 'Cleaning…' : `Delete Unlinked (${unlinkedMediaAssets.length})`}
                    </button>
                  </div>
                </div>

                <div className="media-grid">
                  {sortedMediaAssets.length > 0 ? (
                    sortedMediaAssets.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        className={`media-card ${selectedMediaAsset?.id === asset.id ? 'active' : ''} ${selectedMediaAssetIds.includes(asset.id) ? 'media-card-selected' : ''}`}
                        onClick={() => handleMediaCardClick(asset.id)}
                      >
                        {mediaSelectionMode ? (
                          <span className={`media-card-check ${selectedMediaAssetIds.includes(asset.id) ? 'checked' : ''}`}>
                            {selectedMediaAssetIds.includes(asset.id) ? '✓' : ''}
                          </span>
                        ) : null}
                        {asset.kind === 'image' ? (
                          <img className="media-card-thumb" src={convertFileSrc(asset.absolutePath)} alt={asset.fileName} />
                        ) : (
                          <div className="media-card-placeholder">{asset.kind.toUpperCase()}</div>
                        )}
                        <strong>{asset.fileName}</strong>
                        <span>{`${formatFileSize(asset.sizeBytes)} • ${formatRelativeDate(asset.updatedAtMs)}`}</span>
                        <span>{asset.linkedNotes.length > 0 ? `${asset.linkedNotes.length} linked note${asset.linkedNotes.length === 1 ? '' : 's'}` : 'Unlinked asset'}</span>
                      </button>
                    ))
                  ) : (
                    <div className="empty-note-state">
                      <strong>{mediaAssets.length > 0 ? 'No assets match this filter' : 'No assets imported yet'}</strong>
                      <p>
                        {mediaAssets.length > 0
                          ? 'Try another filter or import more files from the editor.'
                          : 'Imported images, PDFs, videos, and files will appear here.'}
                      </p>
                    </div>
                  )}
                </div>
              </section>

              <aside className="media-sidebar">
                <div className="panel-heading">
                  <div>
                    <p className="section-label">Metadata</p>
                    <h2>Asset Info</h2>
                  </div>
                </div>
                {selectedMediaAsset ? (
                  <div className="media-sidebar-body">
                    {selectedMediaAsset.kind === 'image' ? (
                      <img
                        className="media-sidebar-preview"
                        src={convertFileSrc(selectedMediaAsset.absolutePath)}
                        alt={selectedMediaAsset.fileName}
                      />
                    ) : selectedMediaAsset.kind === 'video' ? (
                      <video
                        className="media-sidebar-preview"
                        src={convertFileSrc(selectedMediaAsset.absolutePath)}
                        controls
                        preload="metadata"
                      />
                    ) : selectedMediaAsset.kind === 'pdf' ? (
                      <iframe
                        className="media-sidebar-preview media-sidebar-preview-document"
                        src={convertFileSrc(selectedMediaAsset.absolutePath)}
                        title={selectedMediaAsset.fileName}
                      />
                    ) : selectedMediaAsset.kind === 'audio' ? (
                      <div className="media-audio-preview">
                        <div className="media-sidebar-preview media-sidebar-preview-placeholder">AUDIO</div>
                        <audio
                          className="media-audio-player"
                          src={convertFileSrc(selectedMediaAsset.absolutePath)}
                          controls
                          preload="metadata"
                        />
                      </div>
                    ) : (
                      <div className="media-sidebar-preview media-sidebar-preview-placeholder">
                        {selectedMediaAsset.kind.toUpperCase()}
                      </div>
                    )}
                    <strong className="media-sidebar-title">{selectedMediaAsset.fileName}</strong>
                    <div className="media-meta-grid">
                      <span>TYPE</span>
                      <strong>{selectedMediaAsset.kind.toUpperCase()}</strong>
                      <span>SIZE</span>
                      <strong>{formatFileSize(selectedMediaAsset.sizeBytes)}</strong>
                      <span>UPDATED</span>
                      <strong>{formatRelativeDate(selectedMediaAsset.updatedAtMs)}</strong>
                      <span>PATH</span>
                      <strong>{selectedMediaAsset.relativeAssetPath}</strong>
                      <span>STATUS</span>
                      <strong>
                        {selectedMediaAsset.linkedNotes.length > 0
                          ? `${selectedMediaAsset.linkedNotes.length} linked note${selectedMediaAsset.linkedNotes.length === 1 ? '' : 's'}`
                          : 'Unlinked'}
                      </strong>
                    </div>
                    <div className="media-linked-notes">
                      <p className="section-label">Linked notes</p>
                      {selectedMediaAsset.linkedNotes.length > 0 ? (
                        selectedMediaAsset.linkedNotes.map((item) => (
                          <button
                            key={item.noteId}
                            type="button"
                            className="connection-card"
                            onClick={() => {
                              setSelectedNoteId(item.noteId)
                              navigateToView('notes')
                            }}
                          >
                            <strong>{item.title}</strong>
                            <span>{item.relativePath}</span>
                          </button>
                        ))
                      ) : (
                        <div className="empty-directory-state">No linked notes found for this asset yet.</div>
                      )}
                    </div>
                    <div className="media-sidebar-actions">
                      <button
                        type="button"
                        className="ghost-action media-side-action"
                        disabled={mediaActionBusy}
                        onClick={() => void handleOpenLocalPath(selectedMediaAsset.absolutePath, 'reveal')}
                      >
                        Open in Finder
                      </button>
                      <button
                        type="button"
                        className="ghost-action media-side-action"
                        disabled={mediaActionBusy}
                        onClick={() => void handleOpenLocalPath(selectedMediaAsset.absolutePath, 'open')}
                      >
                        Open Asset
                      </button>
                      <button
                        type="button"
                        className="ghost-danger media-side-action"
                        disabled={mediaActionBusy || selectedMediaAsset.linkedNotes.length > 0}
                        onClick={() => void handleDeleteMediaAsset(selectedMediaAsset)}
                      >
                        {mediaActionBusy ? 'Deleting…' : 'Delete Unlinked Asset'}
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="empty-directory-state">Select an asset to inspect it.</div>
                )}
              </aside>
            </div>
          )}
        </section>
      </div>

      {notePointerDrag?.hasMoved ? (
        <div
          className="note-drag-ghost"
          style={{
            transform: `translate3d(${notePointerDrag.x + 10}px, ${notePointerDrag.y + 10}px, 0)`,
          }}
        >
          {notePointerDrag.title}
        </div>
      ) : null}

      {commandPaletteOpen ? (
        <div className="modal-shell" role="presentation" onClick={closeCommandPalette}>
          <div
            className="modal-card command-palette-card"
            role="dialog"
            aria-modal="true"
            aria-label="Search notes, tags, or commands"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="command-palette-input-row">
              <span className="command-palette-search-icon" aria-hidden="true">
                ⌕
              </span>
              <input
                ref={commandPaletteInputRef}
                value={commandPaletteQuery}
                onChange={(event) => {
                  setCommandPaletteQuery(event.target.value)
                  setCommandPaletteIndex(0)
                }}
                placeholder="Search notes, tags, or commands..."
              />
            </div>
            <div className="command-palette-filter-row" aria-label="Search filters">
              <button
                type="button"
                className={`command-palette-filter ${commandPaletteDocumentTypeFilter === 'all' ? 'active' : ''}`}
                onClick={() => setCommandPaletteDocumentTypeFilter('all')}
              >
                All
              </button>
              {documentTypeMeta.map((item) => (
                <button
                  key={item.key}
                  type="button"
                  className={`command-palette-filter ${commandPaletteDocumentTypeFilter === item.key ? 'active' : ''}`}
                  onClick={() => setCommandPaletteDocumentTypeFilter(item.key)}
                >
                  {item.label}
                </button>
              ))}
              <select
                value={commandPaletteNotebookFilter}
                onChange={(event) => setCommandPaletteNotebookFilter(event.target.value)}
                className="command-palette-select"
                aria-label="Notebook filter"
              >
                <option value="all">All notebooks</option>
                {notebookList.map((notebook) => (
                  <option key={notebook.name} value={notebook.name}>
                    {notebook.name}
                  </option>
                ))}
              </select>
              <select
                value={commandPaletteTagFilter}
                onChange={(event) => setCommandPaletteTagFilter(event.target.value)}
                className="command-palette-select"
                aria-label="Tag filter"
              >
                <option value="all">All tags</option>
                {libraryTags.map((tag) => (
                  <option key={tag} value={tag}>
                    #{tag}
                  </option>
                ))}
              </select>
              {hasSearchFilters ? (
                <button
                  type="button"
                  className="command-palette-filter-clear"
                  onClick={() => {
                    setCommandPaletteDocumentTypeFilter('all')
                    setCommandPaletteNotebookFilter('all')
                    setCommandPaletteTagFilter('all')
                  }}
                >
                  Clear
                </button>
              ) : null}
            </div>
            <div className="command-palette-results">
              {groupedCommandPaletteItems.some((group) => group.items.length > 0) ? (
                groupedCommandPaletteItems.map((group) =>
                  group.items.length > 0 ? (
                    <section key={group.key} className="command-palette-group">
                      <p className="command-palette-group-label">{group.label}</p>
                      <div className="command-palette-group-items">
                        {group.items.map((item) => {
                          const itemIndex = commandPaletteItems.findIndex(
                            (candidate) => candidate.id === item.id,
                          )

                          return (
                            <button
                              key={item.id}
                              type="button"
                              className={`command-palette-item ${
                                activeCommandPaletteItem?.id === item.id ? 'active' : ''
                              }`}
                              onMouseEnter={() => setCommandPaletteIndex(itemIndex)}
                              onClick={() => void item.run()}
                            >
                              <div className="command-palette-item-main">
                                <strong>{renderHighlightedText(item.title, commandPaletteQuery)}</strong>
                                {item.subtitle ? (
                                  <span>{renderHighlightedText(item.subtitle, commandPaletteQuery)}</span>
                                ) : null}
                              </div>
                              <div className="command-palette-item-meta">
                                {item.meta ? <span>{item.meta}</span> : null}
                              </div>
                            </button>
                          )
                        })}
                      </div>
                    </section>
                  ) : null,
                )
              ) : (
                <div className="empty-directory-state">
                  No notes, tags, or actions match <code>{commandPaletteQuery}</code>.
                </div>
              )}
            </div>
            <div className="command-palette-footer">
              <div className="command-palette-shortcuts">
                <span>
                  <kbd>↑</kbd>
                  <kbd>↓</kbd>
                  Navigate
                </span>
                <span>
                  <kbd>Enter</kbd>
                  Open
                </span>
                <span>
                  <kbd>Esc</kbd>
                  Close
                </span>
              </div>
              <span className="command-palette-footnote">Powered by local knowledge base</span>
            </div>
          </div>
        </div>
      ) : null}

      {noteMenuState ? (
        <div className="context-menu-shell" role="presentation" onClick={closeNoteMenu}>
          <div
            className="note-context-menu"
            role="menu"
            style={{ top: noteMenuState.y, left: noteMenuState.x }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="note-context-menu-header">
              <p className="section-label">Note</p>
              <strong>{noteMenuTarget?.title ?? 'Selected note'}</strong>
              <span>{noteMenuTarget?.relativePath ?? 'Local knowledge base note'}</span>
            </div>

            <div className="note-context-menu-create">
              <input
                value={noteTitleDraft}
                onChange={(event) => setNoteTitleDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleRenameNote()
                  }
                  if (event.key === 'Escape') {
                    closeNoteMenu()
                  }
                }}
                className="note-context-menu-input"
                placeholder="Rename note"
                autoFocus
              />
              <button type="button" className="note-context-menu-action" onClick={() => void handleRenameNote()}>
                Rename
              </button>
            </div>

            {notebookList.length > 0 ? (
              <div className="note-context-menu-list">
                {notebookList.map((notebook) => (
                  <button
                    key={notebook.name}
                    type="button"
                    className={`context-menu-item ${
                      noteMenuTarget?.notebook === notebook.name ? 'context-menu-item-active' : ''
                    }`}
                    onClick={() => void handleMoveNoteToNotebook(noteMenuState.noteId, notebook.name)}
                  >
                    <span>{notebook.name}</span>
                    <span className="context-menu-item-meta">{notebook.count}</span>
                  </button>
                ))}
              </div>
            ) : (
              <span className="context-menu-empty">No notebooks yet. Create the first one below.</span>
            )}

            <div className="note-context-menu-create">
              <input
                value={menuNotebookDraft}
                onChange={(event) => setMenuNotebookDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    const notebookName = menuNotebookDraft.trim()
                    if (!notebookName) {
                      return
                    }
                    void handleMoveNoteToNotebook(noteMenuState.noteId, notebookName)
                  }
                  if (event.key === 'Escape') {
                    closeNoteMenu()
                  }
                }}
                className="note-context-menu-input"
                placeholder="New notebook"
                autoFocus
              />
              <button
                type="button"
                className="note-context-menu-action"
                onClick={() => {
                  const notebookName = menuNotebookDraft.trim()
                  if (!notebookName) {
                    return
                  }
                  void handleMoveNoteToNotebook(noteMenuState.noteId, notebookName)
                }}
              >
                Add
              </button>
            </div>

            {noteMenuTarget?.notebook ? (
              <button
                type="button"
                className="context-menu-item context-menu-item-secondary"
                onClick={() => void handleMoveNoteToNotebook(noteMenuState.noteId, null)}
              >
                Remove from notebook
              </button>
            ) : null}
            <button
              type="button"
              className="context-menu-item context-menu-item-danger"
              onClick={() => void handleDeleteNote()}
            >
              Delete note
            </button>
          </div>
        </div>
      ) : null}

      {notebookMenuState ? (
        <div className="context-menu-shell" role="presentation" onClick={closeNotebookMenu}>
          <div
            className="note-context-menu"
            role="menu"
            style={{ top: notebookMenuState.y, left: notebookMenuState.x }}
            onClick={(event) => event.stopPropagation()}
          >
            <div className="note-context-menu-header">
              <p className="section-label">Notebook</p>
              <strong>{notebookMenuTarget?.name ?? notebookMenuState.notebook}</strong>
              <span>
                {notebookMenuTarget ? `${notebookMenuTarget.count} note${notebookMenuTarget.count === 1 ? '' : 's'}` : 'Notebook'}
              </span>
            </div>

            <div className="note-context-menu-create">
              <input
                value={notebookNameDraft}
                onChange={(event) => setNotebookNameDraft(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') {
                    event.preventDefault()
                    void handleRenameNotebook()
                  }
                  if (event.key === 'Escape') {
                    closeNotebookMenu()
                  }
                }}
                className="note-context-menu-input"
                placeholder="Rename notebook"
                autoFocus
              />
              <button type="button" className="note-context-menu-action" onClick={() => void handleRenameNotebook()}>
                Rename
              </button>
            </div>

            <button
              type="button"
              className="context-menu-item context-menu-item-danger"
              onClick={() => void handleDeleteNotebook()}
            >
              Delete notebook
            </button>
          </div>
        </div>
      ) : null}

      {settingsPanelOpen ? (
        <div className="modal-shell" role="presentation" onClick={() => setSettingsPanelOpen(false)}>
          <div className="modal-card settings-card" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
            <div className="panel-heading">
              <div>
                <p className="section-label">Settings</p>
                <h2>Workspace preferences</h2>
              </div>
              <button type="button" className="ghost-action" onClick={() => setSettingsPanelOpen(false)}>
                Close
              </button>
            </div>
            <div className="settings-layout">
              <div className="settings-sidebar">
                <button
                  type="button"
                  className={`settings-nav-item ${settingsTab === 'general' ? 'settings-nav-item-active' : ''}`}
                  onClick={() => setSettingsTab('general')}
                >
                  General
                </button>
                <button
                  type="button"
                  className={`settings-nav-item ${settingsTab === 'sync' ? 'settings-nav-item-active' : ''}`}
                  onClick={() => setSettingsTab('sync')}
                >
                  Sync
                </button>
              </div>
              <div className="settings-content">
                {settingsTab === 'general' ? (
                  <>
                    <p className="modal-copy">
                      NoteBase works from a local-first library. Each notebook maps to a folder and
                      drives the note list in the main workspace.
                    </p>
                    <div className="resolved-path-card">
                      <div className="storage-explanation-row">
                        <span>Offline knowledge base</span>
                        <strong>{localRootPath || 'Preparing local library...'}</strong>
                      </div>
                      <div className="storage-explanation-row">
                        <span>Notebooks</span>
                        <strong>
                          {notebookList.length > 0
                            ? notebookList.map((item) => item.name).join(', ')
                            : 'No notebooks yet'}
                        </strong>
                      </div>
                    </div>
                    <div className="migration-log-card">
                      <div className="migration-log-header">
                        <strong>Migration log</strong>
                        <span>{migrationLog.length} event{migrationLog.length === 1 ? '' : 's'}</span>
                      </div>
                      {migrationLog.length > 0 ? (
                        <div className="migration-log-list">
                          {migrationLog.slice(0, 4).map((entry) => (
                            <div key={`${entry.migratedAtMs}-${entry.migratedNoteCount}`} className="migration-log-item">
                              <strong>
                                {entry.migratedNoteCount} note{entry.migratedNoteCount === 1 ? '' : 's'} migrated
                              </strong>
                              <span>{formatRelativeDate(entry.migratedAtMs)}</span>
                              <p>
                                {entry.sources
                                  .map((source) => `${source.count} from ${source.source} to ${source.target}`)
                                  .join(', ')}
                              </p>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="migration-log-empty">No legacy migrations have run for this library.</p>
                      )}
                    </div>
                  </>
                ) : (
                  <>
                    <p className="modal-copy">
                      Configure WebDAV only when you want the offline library to sync with a remote
                      target.
                    </p>
                    <div className={`sync-summary-card sync-summary-card-${syncButtonTone}`}>
                      <strong>{syncStatus.message}</strong>
                      <span>
                        {syncStatus.conflictCount > 0
                          ? `${syncStatus.conflictCount} conflict${syncStatus.conflictCount === 1 ? '' : 's'} need a decision.`
                          : syncStatus.copiedCount > 0 || syncStatus.skippedCount > 0
                            ? `${syncStatus.copiedCount} copied • ${syncStatus.skippedCount} unchanged`
                            : syncStatus.configured
                              ? 'Sync target is configured.'
                              : 'Sync is not configured yet.'}
                      </span>
                    </div>
                    {syncStatus.localSnapshot || syncStatus.remoteSnapshot ? (
                      <div className="sync-snapshot-grid">
                        {syncStatus.localSnapshot ? (
                          <div className="sync-snapshot-card">
                            <strong>Local offline library</strong>
                            <span>{syncStatus.localSnapshot.noteCount} notes</span>
                            <span>{syncStatus.localSnapshot.assetFileCount} assets</span>
                            <span>{syncStatus.localSnapshot.message}</span>
                          </div>
                        ) : null}
                        {syncStatus.remoteSnapshot ? (
                          <div className="sync-snapshot-card">
                            <strong>Remote sync target</strong>
                            <span>{syncStatus.remoteSnapshot.noteCount} notes</span>
                            <span>{syncStatus.remoteSnapshot.assetFileCount} assets</span>
                            <span>{syncStatus.remoteSnapshot.message}</span>
                          </div>
                        ) : null}
                      </div>
                    ) : null}
                    {syncStatus.conflicts.length > 0 ? (
                      <div className="sync-conflict-list">
                        <strong>Resolve sync conflicts</strong>
                        <span>Choose whether each file should keep the local version or the remote version.</span>
                        {syncStatus.conflicts.map((relativePath) => {
                          const busy = resolvingConflictPath === relativePath
                          return (
                            <div key={relativePath} className="sync-conflict-item">
                              <span>{relativePath}</span>
                              <div className="sync-conflict-actions">
                                <button
                                  type="button"
                                  className="ghost-action"
                                  disabled={syncBusy || Boolean(resolvingConflictPath)}
                                  onClick={() => void handleResolveSyncConflict(relativePath, 'keep_local')}
                                >
                                  {busy ? 'Resolving…' : 'Keep local'}
                                </button>
                                <button
                                  type="button"
                                  className="ghost-action"
                                  disabled={syncBusy || Boolean(resolvingConflictPath)}
                                  onClick={() => void handleResolveSyncConflict(relativePath, 'keep_remote')}
                                >
                                  {busy ? 'Resolving…' : 'Keep remote'}
                                </button>
                              </div>
                            </div>
                          )
                        })}
                      </div>
                    ) : null}
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
                    <div className="resolved-path-card">
                      <div className="storage-explanation-row">
                        <span>Derived mount point</span>
                        <strong>{draftSyncConfig.remotePath.trim() ? `/Volumes/${draftSyncConfig.remotePath.trim().split('/').filter(Boolean).at(-1) ?? 'WebDAV'}` : '/Volumes/WebDAV'}</strong>
                      </div>
                      <div className="storage-explanation-row">
                        <span>WebDAV target</span>
                        <strong>
                          {draftSyncConfig.protocol}://
                          {draftSyncConfig.username ? `${draftSyncConfig.username}:${draftSyncConfig.password ? '••••••' : ''}@` : ''}
                          {draftSyncConfig.publicHost}
                          {draftSyncConfig.publicPort ? `:${draftSyncConfig.publicPort}` : ''}
                          {draftSyncConfig.remotePath || '//'}
                        </strong>
                      </div>
                    </div>
                  </>
                )}
              </div>
            </div>
            <div className="modal-actions">
              {settingsTab === 'sync' && syncConfig ? (
                <button type="button" className="ghost-danger" onClick={handleDisconnectSync}>
                  Remove sync config
                </button>
              ) : (
                <span className="modal-hint">{settingsTab === 'sync' ? syncStatus.message : localLibraryMessage}</span>
              )}
              <div className="inline-actions">
                {settingsTab === 'sync' ? (
                  <button type="button" className="save-action" onClick={() => void handleConnectSync()}>
                    Save and test connection
                  </button>
                ) : null}
              </div>
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

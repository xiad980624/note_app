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

const folders = [
  { name: 'Inbox', active: true },
  { name: 'Projects' },
  { name: 'Topics' },
  { name: 'Archive' },
]

const SYNC_CONFIG_KEY = 'notebase:sync-config'
const SELECTED_NOTE_KEY = 'notebase:selected-note-id'
const INVOKE_TIMEOUT_MS = 12000
const BROWSER_LOCAL_PATH_PLACEHOLDER = '~/Documents/NoteBase'

type SaveStatus = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'
type SyncButtonTone = 'idle' | 'warning' | 'active' | 'busy'
type EditorViewMode = 'markdown' | 'rich-text' | 'preview'
type MarkdownSnippetKind = 'h1' | 'h2' | 'bold' | 'list' | 'quote' | 'code' | 'link'
type AssetImportKind = 'image' | 'file'
type PreviewBlockType = 'h1' | 'h2' | 'paragraph' | 'quote' | 'list' | 'checklist' | 'code'
type PreviewBlock = { type: PreviewBlockType; content: string; language?: string }
type ReferencedAsset = {
  label: string
  path: string
  kind: AssetImportKind
}

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

type WorkspaceView = 'notes' | 'graph' | 'media'
type MediaFilter = 'all' | 'image' | 'pdf' | 'video' | 'file'

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

type CommandPaletteItem = {
  id: string
  group: 'recent_notes' | 'tags' | 'actions'
  title: string
  subtitle?: string
  meta?: string
  run: () => void | Promise<void>
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

const deriveEditableTitle = (body: string) => {
  for (const line of body.split('\n')) {
    const trimmed = line.trim()
    if (trimmed.startsWith('# ')) {
      return trimmed.slice(2).trim() || 'Untitled note'
    }
  }

  return 'Untitled note'
}

const updateBodyTitle = (body: string, nextTitle: string) => {
  const safeTitle = nextTitle.trim() || 'Untitled note'
  const lines = body.split('\n')
  const headingIndex = lines.findIndex((line) => line.trim().startsWith('# '))

  if (headingIndex >= 0) {
    lines[headingIndex] = `# ${safeTitle}`
    return lines.join('\n')
  }

  const normalizedBody = body.trim()
  if (!normalizedBody) {
    return `# ${safeTitle}\n\n`
  }

  return `# ${safeTitle}\n\n${body}`
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

const extractReferencedAssets = (body: string): ReferencedAsset[] => {
  const pattern = /(!)?\[([^\]]*)\]\(([^)]+)\)/g
  const assets: ReferencedAsset[] = []
  const seen = new Set<string>()

  for (const match of body.matchAll(pattern)) {
    const isImage = Boolean(match[1])
    const label = match[2]?.trim() || 'Attachment'
    const rawPath = match[3]?.trim() || ''
    if (
      !rawPath ||
      rawPath.startsWith('http://') ||
      rawPath.startsWith('https://') ||
      rawPath.startsWith('mailto:')
    ) {
      continue
    }

    const uniqueKey = `${isImage ? 'image' : 'file'}:${rawPath}`
    if (seen.has(uniqueKey)) {
      continue
    }

    seen.add(uniqueKey)
    assets.push({
      label,
      path: rawPath,
      kind: isImage ? 'image' : 'file',
    })
  }

  return assets
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

const joinPathSegments = (...segments: string[]) =>
  segments
    .filter(Boolean)
    .join('/')
    .replace(/\/+/g, '/')

const dirnameOfPath = (path: string) => {
  const normalized = path.replace(/\/+/g, '/').replace(/\/$/, '')
  const lastSlashIndex = normalized.lastIndexOf('/')
  if (lastSlashIndex <= 0) {
    return ''
  }
  return normalized.slice(0, lastSlashIndex)
}

const resolveRelativeAssetPath = (basePath: string, relativePath: string) => {
  if (!relativePath || relativePath.startsWith('http://') || relativePath.startsWith('https://')) {
    return relativePath
  }

  const baseSegments = basePath.split('/').filter(Boolean)
  const relativeSegments = relativePath.split('/').filter(Boolean)
  const outputSegments = [...baseSegments]

  for (const segment of relativeSegments) {
    if (segment === '.') {
      continue
    }
    if (segment === '..') {
      outputSegments.pop()
      continue
    }
    outputSegments.push(segment)
  }

  return `/${outputSegments.join('/')}`
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
  const [workspaceView, setWorkspaceView] = useState<WorkspaceView>('notes')
  const [mediaFilter, setMediaFilter] = useState<MediaFilter>('all')
  const [graphZoom, setGraphZoom] = useState(1)
  const [editorBody, setEditorBody] = useState('')
  const [lastSavedBody, setLastSavedBody] = useState('')
  const [saveStatus, setSaveStatus] = useState<SaveStatus>('idle')
  const [saveMessage, setSaveMessage] = useState('Select a note to start editing.')
  const [editorViewMode, setEditorViewMode] = useState<EditorViewMode>('markdown')
  const [syncConfig, setSyncConfig] = useState<SyncConfig | null>(() => loadStoredSyncConfig())
  const [draftSyncConfig, setDraftSyncConfig] = useState<SyncConfig>(() => loadStoredSyncConfig() ?? emptySyncConfig)
  const [syncStatus, setSyncStatus] = useState<SyncStatusResponse>(
    emptySyncStatus('Sync has not been configured. Offline mode is active.'),
  )
  const [syncPanelOpen, setSyncPanelOpen] = useState(false)
  const [decisionPanelOpen, setDecisionPanelOpen] = useState(false)
  const [syncBusy, setSyncBusy] = useState(false)
  const [isDragActive, setIsDragActive] = useState(false)
  const [codeLanguageMenuOpen, setCodeLanguageMenuOpen] = useState(false)
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false)
  const [commandPaletteQuery, setCommandPaletteQuery] = useState('')
  const [commandPaletteIndex, setCommandPaletteIndex] = useState(0)
  const [noteConnections, setNoteConnections] = useState<NoteConnections>({
    outgoingLinks: [],
    backlinks: [],
    unresolvedLinks: [],
    message: 'Select a note to inspect links.',
  })
  const [mediaAssets, setMediaAssets] = useState<MediaAssetRecord[]>([])
  const [selectedMediaAssetId, setSelectedMediaAssetId] = useState<string | null>(null)

  const runningInTauri = useMemo(() => isTauriRuntime(), [])
  const hasUnsavedChanges = selectedNoteDocument ? editorBody !== lastSavedBody : false
  const syncButtonTone = syncToneFromStatus(syncStatus, syncBusy)
  const syncButtonLabel = buildSyncButtonLabel(syncStatus, syncBusy)
  const editorTextareaRef = useRef<HTMLTextAreaElement | null>(null)
  const richTextEditorRef = useRef<HTMLDivElement | null>(null)
  const assetPickerRef = useRef<HTMLInputElement | null>(null)
  const commandPaletteInputRef = useRef<HTMLInputElement | null>(null)
  const commandPaletteItemsRef = useRef<CommandPaletteItem[]>([])
  const pendingSelectionRef = useRef<{ start: number; end: number }>({ start: 0, end: 0 })
  const selectedNote =
    knowledgeBaseIndex.notes.find((note) => note.id === selectedNoteId) ??
    knowledgeBaseIndex.notes[0] ??
    null
  const selectedMediaAsset =
    mediaAssets.find((asset) => asset.id === selectedMediaAssetId) ?? mediaAssets[0] ?? null
  const filteredMediaAssets = useMemo(() => {
    if (mediaFilter === 'all') {
      return mediaAssets
    }

    return mediaAssets.filter((asset) => {
      if (mediaFilter === 'file') {
        return !['image', 'pdf', 'video'].includes(asset.kind)
      }

      return asset.kind === mediaFilter
    })
  }, [mediaAssets, mediaFilter])
  const editableTitle = useMemo(() => deriveEditableTitle(editorBody), [editorBody])
  const previewBlocks = useMemo(() => renderPreviewBlocks(editorBody), [editorBody])
  const referencedAssets = useMemo(() => extractReferencedAssets(editorBody), [editorBody])
  const noteAssetPreviewItems = useMemo(() => {
    if (!selectedNote) {
      return []
    }

    const noteRootRelativePath = joinPathSegments('notes', selectedNote.relativePath)
    const noteDirectoryRelativePath = dirnameOfPath(noteRootRelativePath)

    return referencedAssets.map((asset) => {
      const resolvedRootRelativePath = resolveRelativeAssetPath(noteDirectoryRelativePath, asset.path)
      const absolutePath = resolvedRootRelativePath
        ? joinPathSegments(localRootPath, resolvedRootRelativePath)
        : ''

      return {
        ...asset,
        absolutePath,
        previewUrl:
          runningInTauri && asset.kind === 'image' && absolutePath
            ? convertFileSrc(absolutePath)
            : null,
      }
    })
  }, [localRootPath, referencedAssets, runningInTauri, selectedNote])
  const [assetPickerKind, setAssetPickerKind] = useState<AssetImportKind>('image')
  const libraryTags = useMemo(() => collectLibraryTags(knowledgeBaseIndex.notes), [knowledgeBaseIndex.notes])
  const noteConnectionsStatusMessage = !selectedNote
    ? 'Select a note to inspect links.'
    : !runningInTauri
      ? 'Link inspection requires the Tauri desktop runtime.'
      : noteConnections.message

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
        await refreshMediaAssets(response.rootPath)

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
  }, [assessSyncReadiness, refreshLocalWorkspace, refreshMediaAssets, runningInTauri, syncConfig])

  useEffect(() => {
    if (!selectedNoteId) {
      return
    }

    // eslint-disable-next-line react-hooks/set-state-in-effect
    void loadSelectedNoteDocument(selectedNoteId, localRootPath)
  }, [selectedNoteId, localRootPath, loadSelectedNoteDocument])

  useEffect(() => {
    if (!selectedNoteId || !runningInTauri) {
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

      if (nextBody === lastSavedBody) {
        setSaveStatus('idle')
        setSaveMessage('No unsaved changes.')
        return
      }

      setSaveStatus('dirty')
      setSaveMessage('Unsaved markdown changes.')
    },
    [lastSavedBody, selectedNoteDocument],
  )

  const handleTitleChange = (event: ChangeEvent<HTMLInputElement>) => {
    applyEditorBody(updateBodyTitle(editorBody, event.target.value))
  }

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

  const handleEditorDragOver = (event: React.DragEvent<HTMLTextAreaElement>) => {
    if (editorViewMode !== 'markdown' || !selectedNote) {
      return
    }

    event.preventDefault()
    setIsDragActive(true)
  }

  const handleEditorDragLeave = (event: React.DragEvent<HTMLTextAreaElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }

    setIsDragActive(false)
  }

  const handleEditorDrop = async (event: React.DragEvent<HTMLTextAreaElement>) => {
    if (editorViewMode !== 'markdown' || !selectedNote) {
      return
    }

    event.preventDefault()
    setIsDragActive(false)

    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) {
      return
    }

    pendingSelectionRef.current = {
      start: event.currentTarget.selectionStart,
      end: event.currentTarget.selectionEnd,
    }
    await importAssetFiles(files)
  }

  const handleRichTextInput = () => {
    syncMarkdownFromRichTextEditor()
  }

  const handleRichTextKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== 'Tab') {
      return
    }

    const selection = window.getSelection()
    const anchorNode = selection?.anchorNode
    const parentElement =
      anchorNode instanceof HTMLElement ? anchorNode : anchorNode?.parentElement ?? null
    const preElement = parentElement?.closest('pre')

    if (!preElement || event.shiftKey) {
      return
    }

    event.preventDefault()
    document.execCommand('insertText', false, '  ')
    syncMarkdownFromRichTextEditor()
  }

  const handleRichTextDrop = async (event: React.DragEvent<HTMLDivElement>) => {
    if (editorViewMode !== 'rich-text' || !selectedNote) {
      return
    }

    event.preventDefault()
    setIsDragActive(false)

    const files = Array.from(event.dataTransfer.files)
    if (files.length === 0) {
      return
    }

    await importAssetFiles(files)
  }

  const handleRichTextDragOver = (event: React.DragEvent<HTMLDivElement>) => {
    if (editorViewMode !== 'rich-text' || !selectedNote) {
      return
    }

    event.preventDefault()
    setIsDragActive(true)
  }

  const handleRichTextDragLeave = (event: React.DragEvent<HTMLDivElement>) => {
    if (event.currentTarget.contains(event.relatedTarget as Node | null)) {
      return
    }

    setIsDragActive(false)
  }

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
  }

  const handleEditorKeyDown = (event: React.KeyboardEvent<HTMLTextAreaElement>) => {
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
        return
      }

      const nextSelection = event.shiftKey
        ? unindentSelectedLines(editorBody, selectionStart, selectionEnd)
        : indentSelectedLines(editorBody, selectionStart, selectionEnd)

      applyEditorBody(nextSelection.nextBody)
      applyTextSelection(nextSelection.selectionStart, nextSelection.selectionEnd)
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
        await refreshMediaAssets(localRootPath)
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

  const handleCreateNote = useCallback(async () => {
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
      await refreshMediaAssets(localRootPath)
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
    setSyncPanelOpen(false)
  }

  const handleRunSyncWithOptions = useCallback(async (
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

  const handleSyncButtonClick = useCallback(() => {
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
  }, [handleRunSyncWithOptions, syncConfig, syncStatus.status])

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
        subtitle: 'Tag filter coming next',
        run: () => {
          closeCommandPalette()
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
            setSyncPanelOpen(true)
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

    return [...recentNotes, ...tagItems, ...actionItems]
  }, [
    closeCommandPalette,
    commandPaletteQuery,
    handleCreateNote,
    handleSelectNote,
    handleSyncButtonClick,
    knowledgeBaseIndex.notes,
    libraryTags,
    navigateToView,
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

  const groupedCommandPaletteItems = useMemo(
    () => [
      {
        key: 'recent_notes',
        label: 'RECENT NOTES',
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
    [commandPaletteItems],
  )

  const viewMeta = {
    notes: {
      title: 'Recent Notes',
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

  const folderCounts = folders.map((folder) => ({
    ...folder,
    count: knowledgeBaseIndex.notes.filter((note) =>
      note.folder.toLowerCase().startsWith(folder.name.toLowerCase()),
    ).length,
  }))
  const activeCommandPaletteItem = commandPaletteItems[commandPaletteIndex] ?? null
  const selectedNoteTags = selectedNote?.tags.slice(0, 6) ?? []

  return (
    <div className="app-shell">
      <div className="workspace-shell">
        <aside className="sidebar shell-sidebar">
          <div className="shell-sidebar-top">
            <div className="traffic-lights" aria-hidden="true">
              <span className="traffic red" />
              <span className="traffic yellow" />
              <span className="traffic green" />
            </div>

            <div className="sidebar-brand">
              <div className="sidebar-brand-mark">N</div>
              <div className="workspace-meta">
                <h1>NoteBase</h1>
                <p>Personal Vault</p>
              </div>
            </div>

            <button type="button" className="primary-action" onClick={() => void handleCreateNote()}>
              + New note
            </button>

            <nav className="nav-section shell-nav-section" aria-label="Primary navigation">
              <button
                type="button"
                className={`nav-item ${workspaceView === 'notes' ? 'active' : ''}`}
                onClick={() => navigateToView('notes')}
              >
                <span>Inbox</span>
                <strong>{knowledgeBaseIndex.notes.length}</strong>
              </button>
              <button type="button" className="nav-item">
                <span>Today</span>
              </button>
              <button type="button" className="nav-item">
                <span>Favorites</span>
              </button>
              <button type="button" className="nav-item">
                <span>Tags</span>
              </button>
              <button
                type="button"
                className={`nav-item ${workspaceView === 'graph' ? 'active' : ''}`}
                onClick={() => navigateToView('graph')}
              >
                <span>Graph</span>
              </button>
              <button
                type="button"
                className={`nav-item ${workspaceView === 'media' ? 'active' : ''}`}
                onClick={() => navigateToView('media')}
              >
                <span>Media</span>
              </button>
            </nav>

            <section className="nav-section notebook-nav-section">
              <div className="section-heading">
                <p className="section-label">Notebooks</p>
                <button type="button" className="ghost-action">
                  Manage
                </button>
              </div>
              <div className="stack-list notebook-stack-list">
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
          </div>

          <div className="shell-sidebar-bottom">
            <button type="button" className="nav-item">
              <span>Settings</span>
            </button>
            <button type="button" className="nav-item">
              <span>Trash</span>
            </button>
            <div className="sidebar-user-row">
              <div className="sidebar-user-avatar" aria-hidden="true">
                N
              </div>
              <div>
                <strong>Local-first</strong>
                <span>{localRootPath}</span>
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
              <nav className="workspace-tabs" aria-label="Workspace views">
                <button
                  type="button"
                  className={`workspace-tab ${workspaceView === 'notes' ? 'workspace-tab-active' : ''}`}
                  onClick={() => navigateToView('notes')}
                >
                  Notes
                </button>
                <button
                  type="button"
                  className={`workspace-tab ${workspaceView === 'graph' ? 'workspace-tab-active' : ''}`}
                  onClick={() => navigateToView('graph')}
                >
                  Graph
                </button>
                <button
                  type="button"
                  className={`workspace-tab ${workspaceView === 'media' ? 'workspace-tab-active' : ''}`}
                  onClick={() => navigateToView('media')}
                >
                  Media
                </button>
              </nav>
            </div>

            <div className="workspace-topbar-actions">
              <label
                className="search-field search-field-compact search-field-button"
                htmlFor="global-search"
                onClick={openCommandPalette}
              >
                <span>{viewMeta[workspaceView].searchPlaceholder}</span>
                <input
                  id="global-search"
                  placeholder={viewMeta[workspaceView].searchPlaceholder}
                  readOnly
                  onFocus={openCommandPalette}
                />
                <kbd>Cmd K</kbd>
              </label>
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

          {workspaceView === 'notes' ? (
            <div className="workspace-grid">
              <section className="note-list-panel">
                <div className="panel-heading">
                  <div>
                    <p className="section-label">Notes</p>
                    <h2>Recent Notes</h2>
                  </div>
                  <button
                    type="button"
                    className="ghost-action"
                    onClick={() => void refreshLocalWorkspace(localRootPath)}
                  >
                    Refresh
                  </button>
                </div>
                <div className="note-list-subheading">
                  <span>{knowledgeBaseIndex.notes.length} indexed notes</span>
                  <span>Offline-first local library</span>
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
                        </div>
                        <p className="note-card-summary">{note.summary || 'No summary yet.'}</p>
                        <div className="note-card-footer">
                          <span className="note-chip">{note.tags[0] ?? note.folder.toUpperCase()}</span>
                          <span className="note-time">{formatRelativeDate(note.updatedAtMs)}</span>
                        </div>
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
                    {selectedNote ? (
                      <input
                        className="editor-title-input"
                        value={editableTitle}
                        onChange={handleTitleChange}
                        placeholder="Untitled note"
                      />
                    ) : (
                      <h2>No note selected</h2>
                    )}
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
                      <button
                        type="button"
                        className={`view-pill ${editorViewMode === 'markdown' ? 'active' : ''}`}
                        onClick={() => setEditorViewMode('markdown')}
                      >
                        Markdown
                      </button>
                      <button
                        type="button"
                        className={`view-pill ${editorViewMode === 'rich-text' ? 'active' : ''}`}
                        onClick={() => setEditorViewMode('rich-text')}
                      >
                        Rich text
                      </button>
                      <button
                        type="button"
                        className={`view-pill ${editorViewMode === 'preview' ? 'active' : ''}`}
                        onClick={() => setEditorViewMode('preview')}
                      >
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
                  {formattingTools.map((tool) => (
                    <button
                      key={tool.label}
                      type="button"
                      className="tool-button"
                      title={tool.shortcut}
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
                      <span>{tool.label}</span>
                      <kbd>{tool.shortcut}</kbd>
                    </button>
                  ))}
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
                            <p>
                              {editorViewMode === 'preview'
                                ? '### Markdown preview'
                                : editorViewMode === 'rich-text'
                                  ? '### Rich text mode'
                                  : '### Markdown body'}
                            </p>
                            <span>
                              {editorViewMode === 'preview'
                                ? 'Preview updates from the current local draft'
                                : hasUnsavedChanges
                                  ? 'Cmd/Ctrl+S to save locally'
                                  : 'Saved locally'}
                            </span>
                          </div>
                          {editorViewMode === 'preview' ? (
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
                          ) : editorViewMode === 'rich-text' ? (
                            <div
                              ref={richTextEditorRef}
                              className={`rich-text-editor ${isDragActive ? 'drag-active' : ''}`}
                              contentEditable
                              suppressContentEditableWarning
                              onInput={handleRichTextInput}
                              onKeyDown={handleRichTextKeyDown}
                              onDragOver={handleRichTextDragOver}
                              onDragLeave={handleRichTextDragLeave}
                              onDrop={(event) => void handleRichTextDrop(event)}
                            />
                          ) : (
                            <textarea
                              ref={editorTextareaRef}
                              className={`markdown-editor ${isDragActive ? 'drag-active' : ''}`}
                              value={editorBody}
                              onChange={handleEditorBodyChange}
                              onKeyDown={handleEditorKeyDown}
                              onDragOver={handleEditorDragOver}
                              onDragLeave={handleEditorDragLeave}
                              onDrop={(event) => void handleEditorDrop(event)}
                              placeholder="Start writing in Markdown..."
                              spellCheck={false}
                            />
                          )}
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
                      <p className="section-label">Note assets</p>
                      <strong>
                        {selectedNote ? `${noteAssetPreviewItems.length} linked assets` : 'No note selected'}
                      </strong>
                      <span>
                        {selectedNote
                          ? 'Drag files into the editor or use the toolbar to import them.'
                          : 'Select a note to inspect its linked images and attachments.'}
                      </span>
                    </div>
                  </aside>
                </div>
              </section>

              <aside className="inspector-panel">
                <div className="panel-heading">
                  <div>
                    <p className="section-label">Connections</p>
                    <h2>{selectedNote ? 'Note context' : 'Connections'}</h2>
                  </div>
                  <button type="button" className="ghost-action" onClick={() => setSyncPanelOpen(true)}>
                    Sync settings
                  </button>
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
                  <p className="section-label">Backlinks</p>
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
                </section>

                <section className="inspector-section">
                  <p className="section-label">Outgoing links</p>
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
                </section>

                <section className="inspector-section">
                  <p className="section-label">Related tags</p>
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
                </section>

                <section className="inspector-section">
                  <div className={`sync-summary-card sync-summary-card-${syncButtonTone}`}>
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
                    <strong>{syncConfig ? syncConfig.profileName : 'Remote sync not configured'}</strong>
                    <p>{syncStatus.message}</p>
                    <div className="directory-stats">
                      <span>{syncStatus.localSnapshot?.noteCount ?? knowledgeBaseIndex.notes.length} local notes</span>
                      <span>{syncStatus.remoteSnapshot?.noteCount ?? 0} remote notes</span>
                    </div>
                  </div>
                </section>
              </aside>
            </div>
          ) : workspaceView === 'graph' ? (
            <section className="graph-workspace">
              <div className="graph-canvas">
                <div className="graph-scene" style={{ transform: `scale(${graphZoom})` }}>
                  <div className="graph-orbit orbit-large" />
                  <div className="graph-orbit orbit-small" />
                  <button
                    type="button"
                    className="graph-node graph-node-center"
                    onClick={() => navigateToView('notes')}
                  >
                    N
                  </button>
                  <button
                    type="button"
                    className="graph-node graph-node-blue"
                    onClick={() => navigateToView('notes')}
                  >
                    {Math.max(noteConnections.outgoingLinks.length, 1)}
                  </button>
                  <button
                    type="button"
                    className="graph-node graph-node-violet"
                    onClick={() => navigateToView('notes')}
                  >
                    {Math.max(noteConnections.backlinks.length, 1)}
                  </button>
                  <button
                    type="button"
                    className="graph-node graph-node-orange"
                    onClick={() => navigateToView('notes')}
                  >
                    {Math.max(selectedNoteTags.length, 1)}
                  </button>
                  <button
                    type="button"
                    className="graph-node graph-node-slate"
                    onClick={() => navigateToView('notes')}
                  >
                    {Math.max(noteConnections.unresolvedLinks.length, 1)}
                  </button>

                  <div className="graph-link graph-link-a" />
                  <div className="graph-link graph-link-b" />
                  <div className="graph-link graph-link-c" />
                  <div className="graph-link graph-link-d" />
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
                    <strong>Graph Filters</strong>
                    <button type="button" className="ghost-action" onClick={() => navigateToView('notes')}>
                      Notes
                    </button>
                  </div>
                  <div className="graph-filter-row">
                    <span className="graph-filter-dot blue" />
                    <span>Outgoing links</span>
                    <strong>{noteConnections.outgoingLinks.length}</strong>
                  </div>
                  <div className="graph-filter-row">
                    <span className="graph-filter-dot violet" />
                    <span>Backlinks</span>
                    <strong>{noteConnections.backlinks.length}</strong>
                  </div>
                  <div className="graph-filter-row">
                    <span className="graph-filter-dot orange" />
                    <span>Tags</span>
                    <strong>{selectedNoteTags.length}</strong>
                  </div>
                </div>
              </div>
              <div className="graph-status-bar">
                <span>ACTIVE NODES: {1 + noteConnections.outgoingLinks.length + noteConnections.backlinks.length}</span>
                <span>CONNECTIONS: {noteConnections.outgoingLinks.length + noteConnections.backlinks.length}</span>
                <span className="graph-status-live">LIVE GRAPH SYNC: OK</span>
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
                    <span>{filteredMediaAssets.length} items</span>
                    <button type="button" className="ghost-action" onClick={() => void refreshMediaAssets(localRootPath)}>
                      Refresh
                    </button>
                    <button type="button" className="ghost-action">
                      Sort by Date
                    </button>
                  </div>
                </div>

                <div className="media-grid">
                  {filteredMediaAssets.length > 0 ? (
                    filteredMediaAssets.map((asset) => (
                      <button
                        key={asset.id}
                        type="button"
                        className={`media-card ${selectedMediaAsset?.id === asset.id ? 'active' : ''}`}
                        onClick={() => setSelectedMediaAssetId(asset.id)}
                      >
                        {asset.kind === 'image' ? (
                          <img className="media-card-thumb" src={convertFileSrc(asset.absolutePath)} alt={asset.fileName} />
                        ) : (
                          <div className="media-card-placeholder">{asset.kind.toUpperCase()}</div>
                        )}
                        <strong>{asset.fileName}</strong>
                        <span>{`${formatFileSize(asset.sizeBytes)} • ${formatRelativeDate(asset.updatedAtMs)}`}</span>
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
                        onClick={() => void handleOpenLocalPath(selectedMediaAsset.absolutePath, 'reveal')}
                      >
                        Open in Finder
                      </button>
                      <button
                        type="button"
                        className="ghost-danger media-side-action"
                        onClick={() => void handleOpenLocalPath(selectedMediaAsset.absolutePath, 'open')}
                      >
                        Open Asset
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
                                <strong>{item.title}</strong>
                                {item.subtitle ? <span>{item.subtitle}</span> : null}
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

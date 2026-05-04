import './App.css'

const folders = [
  { name: 'Inbox', count: 14, active: true },
  { name: 'Projects', count: 8 },
  { name: 'Topics', count: 23 },
  { name: 'Archive', count: 41 },
]

const tags = ['#design-system', '#nas-sync', '#vibe-coding', '#weekly-review']

const notes = [
  {
    title: 'Vibe coding setup notes',
    summary: 'Tauri 2 + React + TipTap + SQLite FTS5, with UGREEN NAS mounted as a local path.',
    updatedAt: 'Today 00:15',
    active: true,
  },
  {
    title: 'Knowledge base structure',
    summary: 'Inbox, Projects, Topics, backlinks, and MOC notes as the first-level system.',
    updatedAt: 'Yesterday 22:41',
  },
  {
    title: 'Editor interaction ideas',
    summary: 'Dual-mode writing with markdown, rich text, code blocks, and quick references.',
    updatedAt: 'Yesterday 18:09',
  },
  {
    title: 'NAS conflict handling',
    summary: 'Read-only fallback, conflict copies, and index rebuild after reconnect.',
    updatedAt: 'Apr 29',
  },
]

const backlinks = [
  '[[Desktop MVP]]',
  '[[Storage Strategy]]',
  '[[Editor Benchmarks]]',
]

const outgoingLinks = [
  '[[Knowledge Base Shape]]',
  '[[UGREEN NAS Flow]]',
  '[[Search Experience]]',
]

function App() {
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
        <div className="status-panel">
          <span className="status-dot" />
          <div>
            <p className="status-label">Storage</p>
            <strong>UGREEN NAS mounted</strong>
          </div>
        </div>
      </header>

      <main className="workspace-grid">
        <aside className="sidebar">
          <button type="button" className="primary-action">
            + New note
          </button>

          <section className="nav-section">
            <p className="section-label">Library</p>
            <button type="button" className="nav-item active">
              <span>All notes</span>
              <strong>86</strong>
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
              {folders.map((folder) => (
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
              <h2>Captured notes</h2>
            </div>
            <button type="button" className="ghost-action">
              Sort by recent
            </button>
          </div>

          <div className="note-list">
            {notes.map((note) => (
              <button
                key={note.title}
                type="button"
                className={`note-card ${note.active ? 'active' : ''}`}
              >
                <div className="note-card-top">
                  <strong>{note.title}</strong>
                  <span>{note.updatedAt}</span>
                </div>
                <p>{note.summary}</p>
              </button>
            ))}
          </div>
        </section>

        <section className="editor-panel">
          <div className="editor-header">
            <div>
              <p className="section-label">Draft</p>
              <h2>Vibe coding setup notes</h2>
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
              <p className="meta-line">Linked note template • autosave on • synced to mounted NAS path</p>
              <div className="writing-block">
                <p>## Why this stack</p>
                <p>
                  We are starting with a desktop-first foundation so the file model, editor behavior,
                  search, and backlinks feel stable before mobile arrives.
                </p>
                <p>- Desktop shell: Tauri 2 + React + TypeScript</p>
                <p>- Editor: TipTap for rich text, remark for markdown transforms</p>
                <p>- Search: SQLite FTS5 rebuilt from note files when needed</p>
                <p>- Storage: mounted UGREEN NAS path treated like a local knowledge base folder</p>
                <p>### Reference flow</p>
                <p>Type [[ to link another note and keep the right panel open for backlinks.</p>
              </div>
              <div className="code-block">
                <div className="code-block-top">
                  <span>ts</span>
                  <button type="button">Copy</button>
                </div>
                <pre>{`const knowledgeBase = {\n  storage: "mounted-ugreen-nas",\n  editor: ["markdown", "rich-text", "code-blocks"],\n  search: "sqlite-fts5",\n}`}</pre>
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
              <div className="preview-card soft">
                <p className="section-label">Storage health</p>
                <strong>Mounted path reachable</strong>
                <span>Last index refresh 2 min ago</span>
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

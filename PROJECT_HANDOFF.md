# PROJECT HANDOFF

## 1. Current project snapshot

Project:
- NoteBase

Workspace root:
- `/Users/xd/llm_develop/note_app`

App root:
- `/Users/xd/llm_develop/note_app/app/notebase`

Current active branch:
- `feature/p1-media-cleanup`

Latest committed HEAD on this branch:
- `f428eb5`
- `feat: improve media asset linkage`

Primary product docs:
- [PRD.md](/Users/xd/llm_develop/note_app/docs/PRD.md)
- [UCD.md](/Users/xd/llm_develop/note_app/docs/UCD.md)
- [TECH_STACK_DECISION.md](/Users/xd/llm_develop/note_app/docs/TECH_STACK_DECISION.md)
- [VIBE_CODING_PLAN.md](/Users/xd/llm_develop/note_app/docs/VIBE_CODING_PLAN.md)

## 2. Product direction

Current direction is now clear:
- local-first knowledge base
- NAS / WebDAV is an optional sync layer, not the primary storage entry
- editing is Markdown-first
- UI is a quiet desktop workbench, not a card-heavy prototype

The app is no longer organized around:
- inbox
- projects
- topics
- exposed “Markdown / Rich text” mode choices in the main writing flow

The app is now organized around:
- document types
- notebooks
- backlinks / outgoing links / tags
- top-level sync entry

## 3. Current UI model

The current desktop shell is:
- left icon rail
- middle directory tree
- main editor
- right relations sidebar

### Left icon rail
- create `Todo`
- create `Note`
- create `Journal`
- create `Notebook`
- search
- sync
- settings
- trash

### Directory tree
- `Todo Lists`
- `Notes`
- `Journal`
- `Notebooks`

Rules:
- the first three groups show only unassigned documents
- `Notebooks` shows archived/assigned documents

### Editor
- separate title field
- markdown-first body editor
- preview mode
- save button with autosave spinner feedback

### Right sidebar
- `Backlinks`
- `Outgoing links`
- `Tags`

It should not contain:
- sync configuration
- general system explanation panels

## 4. Current document model

Every document now has two important properties:

1. `documentType`
- `note`
- `todo`
- `journal`

2. `notebook`
- `null` means unassigned
- non-null means assigned to a notebook

These two properties are independent:
- `documentType` describes what kind of note it is
- `notebook` describes where it is organized

Important rule:
- assigning a note to a notebook is treated as a real move, not just metadata tagging

## 5. Current storage model

Target knowledge base layout:

```text
KnowledgeBase/
  notes/
    note/
    todo/
    journal/
    notebooks/
      Product/
      Research/
  assets/
    images/
    files/
  .notebase/
    index.db
    settings.json
    sync-manifest.json
```

Rules:
- unassigned `note` documents live in `notes/note/`
- unassigned `todo` documents live in `notes/todo/`
- unassigned `journal` documents live in `notes/journal/`
- assigned documents move into `notes/notebooks/<Notebook Name>/`
- moving a note must preserve its relative asset links

Legacy compatibility:
- older test libraries may still contain legacy directories such as `inbox/`, `projects/`, and `topics/`
- the Tauri backend now migrates markdown files during library load:
  - `inbox/` -> `notes/note/`
  - `projects/` -> `notes/notebooks/Projects/`
  - `topics/` -> `notes/notebooks/Topics/`
- migration also rewrites relative markdown links when a document moves folders
- `load_library_index` returns a migration report so the UI can show a dismissible migration notice

## 6. Implemented capabilities

Implemented and working at a meaningful first pass:
- default local knowledge base path under `~/Documents/NoteBase`
- local knowledge base initialization
- markdown note indexing
- note creation by document type
- note body loading
- title + body editing
- autosave
- save spinner feedback
- code block insertion with language
- local asset import
- backlinks / outgoing links / tags sidebar
- command palette
- command palette backed by local full-text search
- search filters for document type, notebook, and tag
- real graph view backed by note/tag/wikilink relationships
- media library linked-note backtracking based on real markdown asset paths
- media library `Unlinked` filter for orphan attachment review
- media library safe delete flow for unlinked assets only
- media library sorting and richer sidebar previews for image/video/pdf/audio
- sync settings now surface conflict summaries and per-file keep-local / keep-remote actions
- command palette search now highlights hits and remembers the last filters
- sync entry and first-pass sync workflow
- notebook creation
- notebook assignment UI
- pointer-based notebook drag and drop with target highlighting
- persistent legacy migration log in `.notebase/migration-log.json`
- empty directory/editor actions for creating the next note in place
- minimum Todo and Journal creation templates

## 7. Important current behavior

### Editing
- current stable writing path is markdown-first
- title is edited separately from body
- save composes title + body back into markdown
- duplicate leading `# title` headings are stripped from the body so the title bar is the single source of truth
- preview renders from the composed markdown
- new notes focus the title when they still use the default title

### Notebook assignment
- notes shown in `Todo Lists / Notes / Journal` are intended to be only unassigned notes
- notes shown under `Notebooks` are assigned notes
- notebook assignment is true file movement semantics

### Sync
- local library is always primary
- sync is optional
- sync configuration is behind the sync entry, not in the editor workflow
- when a sync run finds conflicts, the sync entry now routes the user into the sync settings view instead of retrying blindly
- the sync settings view shows local/remote snapshots plus per-file resolution actions

### Media
- asset linkage is resolved from real markdown link targets, not filename substring matching
- the media library can distinguish linked vs unlinked assets
- unlinked assets are surfaced explicitly so cleanup work can happen later
- unlinked assets can now be deleted from the media view, while linked assets stay protected
- media assets can be sorted by newest, oldest, name, or size
- sidebar preview now supports image, video, pdf, and audio without leaving the workspace

## 8. P0 status

P0 is intended to be closed after this branch is verified in the running Tauri desktop app.

Remaining validation:
1. run the desktop app and verify note creation, editing, autosave, notebook drag-and-drop, and settings migration log
2. fix only regressions found during that pass

## 9. Recommended next work

P1:
1. improve search ranking beyond the current highlighting and saved filters
2. continue graph polish and media library batch operations / bulk selection
3. improve sync conflict UX beyond the current per-file resolution list
4. move credentials into safer storage

## 10. Environment and verification

Current baseline checks used during this phase:
- `npm run lint`
- `npm run build`
- `cargo check`

The app has been developed against:
- Tauri 2
- React + TypeScript
- Vite

## 11. Git workflow rule from user

This workflow is now explicit:
1. do a focused chunk of work
2. commit it
3. push it
4. open or hand off PR
5. user merges PR
6. switch back to `main`
7. pull latest
8. create a fresh branch for the next chunk

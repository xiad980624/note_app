# PROJECT HANDOFF

## 1. Project overview

Project name:
- NoteBase

Workspace root:
- `/Users/xd/llm_develop/note_app`

Code directory:
- `/Users/xd/llm_develop/note_app/app/notebase`

Current branch at handoff creation time:
- `feature/nas-connection-config`

Latest committed base:
- `main` commit `3d6d645`
- commit message: `Initial note app prototype`

Current repository status as of 2026-05-05 after merge:
- `main` includes merge commit `5882b6f`
- merged PR: `feature/nas-connection-config`
- current follow-up branch for implementation: `feature/macos-auto-webdav-mount`

Current editor branch as of 2026-05-07:
- `feature/editor-experience`

Current UI redesign pass as of 2026-05-08:
- recent UI work has moved through:
  - `feature/editor-experience`
  - `feature/ui-command-palette`
  - `feature/ui-notes-and-connections`
- begin converging the product UI toward the standardized Figma desktop shell
- primary Figma references confirmed in file `s7rHo6PN9iYDmZyqqsJ2st`:
  - `4:567` main workbench / editor shell
  - `4:376` knowledge graph view
  - `4:2` media and assets view
  - `4:226` omni-search / command palette

## 2. Product direction

This project is a personal note-taking and knowledge base app for:
- macOS
- iPhone
- Windows

Core product goals:
- Markdown editing and preview
- Rich text editing
- Code block editing
- Quiet, native-feeling desktop UI with a continuous multi-column shell
- Local-first knowledge base
- Optional NAS-backed sync
- Search, links, backlinks, and long-term knowledge accumulation

Existing requirements and design docs:
- [PRD.md](/Users/xd/llm_develop/note_app/docs/PRD.md)
- [UCD.md](/Users/xd/llm_develop/note_app/docs/UCD.md)
- [TECH_STACK_DECISION.md](/Users/xd/llm_develop/note_app/docs/TECH_STACK_DECISION.md)
- [VIBE_CODING_PLAN.md](/Users/xd/llm_develop/note_app/docs/VIBE_CODING_PLAN.md)

## 3. Confirmed technical decisions

Confirmed stack:
- Tauri 2
- React + TypeScript
- Vite
- Future editor direction: TipTap + remark/unified
- Future local index/search: SQLite + FTS5

Current desktop prototype status:
- React app scaffolded and customized
- Tauri shell files created under `src-tauri`
- Frontend build works
- Frontend lint works
- Tauri environment check works

Important Git workflow rule from user:
- Every new task should use a new branch
- Branch names should clearly indicate `feature/...` or `bugfix/...`
- Commit messages should clearly describe what changed

## 4. Storage strategy: latest state

Latest product direction after discussion:
- the local offline library is the default and primary working copy
- macOS default offline path is `~/Documents/NoteBase`
- app startup should always scan the local offline path first
- NAS / WebDAV should move from “main storage entry” to an optional sync feature
- users only see sync configuration when they explicitly choose to enable sync
- if sync is configured and the remote target is reachable, app should compare local and remote before the first sync decision
- goal is still not to implement a full custom WebDAV client first
- better mac direction remains calling macOS system mount capability for WebDAV, then using the mounted path as a remote sync target

Current recommendation:

### macOS
- Default knowledge base:
  - `~/Documents/NoteBase`
- Remote sync profile:
  - host or public IP
  - port
  - username
  - password
  - protocol
  - remote WebDAV path
  - remote knowledge base relative path
- WebDAV remote path should preserve the NAS path form used by the server.
  Current known example:
  - `http://47.103.114.153//home/data`
  - note the double slash before `home/data`
- App should:
  1. always scan the local offline library on launch
  2. only open sync configuration when user clicks sync
  3. if sync is configured, test remote reachability and mount when needed
  4. compare local and remote when both contain content
  5. ask user whether to pull remote down or push local up before the first alignment step
  6. keep local editing available even if remote sync is unavailable

### iPhone
- iPhone should not be treated like mac Finder mount
- recommended MVP direction:
  - use Files / Document Picker first
  - do not try to mirror `/Volumes/...`
- if later full automation is required on iPhone:
  - likely need app-managed remote access layer
  - or eventually a File Provider based approach

Important product insight:
- The real desired capability is automatic mount recovery on mac
- It is not necessary to build a full custom WebDAV file client first

## 4.1 UI redesign direction: latest state

Standardized Figma direction now confirmed:
- the product should move away from the earlier “rounded card prototype” look
- the app should feel closer to a native desktop workbench
- the layout should use a continuous shell with column dividers instead of large floating panels
- page sections should be visually quieter, denser, and more task-oriented

Shared shell pattern across the confirmed Figma views:
- left navigation rail:
  - brand
  - primary `New Note` action
  - main navigation items
  - notebooks / collections
  - footer actions such as settings and trash
- top app bar inside the content area:
  - page title
  - view tabs such as `Notes / Graph / Media`
  - search / sync / utility actions
- main working area:
  - note list
  - editor or graph or media grid
  - right contextual sidebar when needed

Confirmed UI implementation principles:
1. use continuous column layout before polishing component details
2. prefer borders and spacing over heavy blur, deep shadows, and oversized rounded corners
3. reserve card surfaces for repeated list items, modals, floating controls, and focused metadata blocks
4. keep labels compact and information dense enough for repeated daily use
5. move global actions into app-bar or modal flows instead of inline explanatory panels

Immediate UI refactor sequence:
1. reshape the main editor page to match the shell from node `4:567`
2. preserve current editor, sync, and asset features while changing layout
3. add a real omni-search / command palette flow based on node `4:226`
4. then build graph and media views inside the same shell using nodes `4:376` and `4:2`

Current UI progress after the first shell pass:
- done:
  - main editor workspace shell now follows the standardized continuous-column desktop layout direction
  - first-pass omni-search / command palette is now in place
  - note list density and the right-side connections panel now more closely follow the `4:567` editor layout
  - graph and media views now live inside the same shell:
    - `Graph` has a first-pass interactive canvas, filter card, and zoom controls
    - `Media` has a first-pass asset library grid, metadata sidebar, and note linkage panel
  - sidebar and top tabs now switch between `Notes`, `Graph`, and `Media`
- next:
  - keep polishing the graph and media visual fidelity toward the Figma references
  - add richer graph behaviors and stronger media filtering / sorting

## 5. Current code status

Main app files:
- [App.tsx](/Users/xd/llm_develop/note_app/app/notebase/src/App.tsx)
- [App.css](/Users/xd/llm_develop/note_app/app/notebase/src/App.css)
- [index.css](/Users/xd/llm_develop/note_app/app/notebase/src/index.css)

Tauri shell files:
- [Cargo.toml](/Users/xd/llm_develop/note_app/app/notebase/src-tauri/Cargo.toml)
- [lib.rs](/Users/xd/llm_develop/note_app/app/notebase/src-tauri/src/lib.rs)
- [main.rs](/Users/xd/llm_develop/note_app/app/notebase/src-tauri/src/main.rs)
- [tauri.conf.json](/Users/xd/llm_develop/note_app/app/notebase/src-tauri/tauri.conf.json)

Implemented already:
- mac-style three-column note workspace prototype
- note list, editor area, backlinks panel, search bar
- default local offline knowledge base path initialization
- local path scanning on launch
- real markdown note indexing from the local offline library
- first-note creation flow in the local offline library
- full note body loading and save-back to local markdown files
- remote sync entry moved behind a dedicated sync button
- sync configuration stored separately from the main editor workflow
- remote WebDAV path handling with automatic mount-point derivation
- first-pass sync readiness check:
  - local snapshot
  - remote snapshot
  - initial sync direction decision when both sides contain content
- first-pass incremental sync:
  - push local offline library to remote
  - pull remote library to local
  - skip unchanged files
  - stop on file-level conflicts instead of silently overwriting newer destination files
  - persist local sync manifest metadata for stronger incremental comparisons
  - allow per-file conflict resolution:
    - keep local
    - keep remote
- Tauri commands added:
  - `get_default_local_library`
  - `inspect_library`
  - `load_library_index`
  - `create_note`
  - `load_note_document`
  - `save_note_document`
  - `list_library_assets`
  - `prepare_sync`
  - `sync_libraries`

Current implementation detail:
- frontend saves the optional sync profile locally and restores it on app reload
- frontend always opens into the local offline library, even with no remote target configured
- frontend editor now:
  - loads the selected markdown note into an editable textarea
  - tracks dirty state
  - saves with a button or `Cmd/Ctrl + S`
  - autosaves after a short idle period
  - warns before switching notes or creating a new note while edits are unsaved
  - supports inline title editing by syncing the first Markdown `# ` heading
  - supports formatting helpers for:
    - H1
    - H2
    - bold
    - list
    - quote
    - code block
    - link
    - image reference
    - file attachment reference
  - supports keyboard shortcuts for common markdown actions:
    - save
    - bold
    - link
    - heading insertion
    - list insertion
    - quote insertion
    - code block insertion
    - image reference insertion
  - supports `Tab` / `Shift+Tab` indentation inside the markdown editor
  - treats `Tab` inside fenced code blocks as code indentation
  - supports a richer preview mode for:
    - headings
    - paragraphs
    - lists
    - task lists
    - quotes
    - fenced code blocks
    - code block language labels
    - inline bold
    - inline code
    - links
    - image references
  - supports importing local files into the knowledge base asset folders:
    - images go to `assets/images/`
    - non-image attachments go to `assets/files/`
    - inserted markdown uses note-relative paths automatically
  - supports drag-and-drop asset import directly into the Markdown editor
  - shows the current note's linked local assets in the right-side preview snapshot
  - renders local image references as thumbnail cards when running in the Tauri desktop app
  - supports opening an asset directly or revealing it in Finder from the asset card
  - rich text mode now uses an editable content layer while still syncing back into Markdown as the source of truth
  - code block insertion now prompts for an optional language and preserves it through preview and save
  - code block insertion now also supports a quick language picker with common presets
  - preview code blocks expose a direct copy action
  - backlinks and outgoing wikilinks now resolve from real `[[...]]` note references instead of placeholder UI data
  - a first-pass omni-search / command palette now exists:
    - opens from `Cmd/Ctrl + K`
    - opens from the top search field
    - groups recent notes, tags, and actions
    - supports arrow-key navigation, enter-to-open, and escape-to-close
- sync UI now:
  - lives behind the top-right sync button
  - shows a warning state when remote sync is missing or unhealthy
  - opens a dedicated modal for sync configuration
  - opens a dedicated decision modal when local and remote both contain content
- browser preview now explicitly reports that filesystem and sync actions require the Tauri desktop runtime
- macOS Tauri layer now:
  - prepares the default local knowledge base path under `~/Documents/NoteBase`
  - ensures the knowledge base layout:
    - `notes/`
    - `assets/images/`
    - `assets/files/`
    - `.notebase/`
  - indexes markdown notes from the local library
  - loads and saves markdown notes in the local library
  - checks remote WebDAV availability when sync is configured
  - attempts macOS Finder-style `mount volume` mounting for remote sync
  - compares local and remote snapshots before the first sync alignment
  - compares file-level state for `notes/` and `assets/` during the first-pass sync implementation
  - copies changed files incrementally
  - reports conflicts when the destination version is newer and different
  - stores sync metadata in `.notebase/sync-manifest.json`
  - resolves individual conflicted files by explicitly choosing local or remote

Current limitation:
- automatic mount is still a first-pass prototype
- no secure credential storage yet
- current sync is still directional and user-triggered, not a full automatic two-way merge engine
- current sync does not delete extra destination files
- conflict resolution currently supports “keep local” or “keep remote”, but not inline diff/merge editing
- attachment insertion flow is not wired yet
- browser preview can explain mount and sync actions, but it cannot execute native filesystem or WebDAV commands
- the macOS-mounted volume name may still differ from the path-derived expectation and should always prefer the actual system mount result

## 6. Environment status

Installed and verified:
- Xcode available
- Homebrew Node installed
- Homebrew Rust installed
- `npm run build` passes
- `npm run lint` passes
- `npm exec tauri info` runs successfully

Known issue encountered:
- earlier local `rustup` workspace install path became inconsistent
- switched to Homebrew Rust for reliable `rustc` and `cargo`
- cargo network-based checks may still need a stable crates.io fetch path when doing first real Rust compilation

Frontend dev server was previously started successfully at:
- `http://localhost:1420/`

No assumption should be made that it is still running now.

## 7. Recommended next implementation steps

Recommended next branch after this work is committed:
- `feature/knowledge-base-directory-access`

Recommended next coding steps:
1. Move sync credentials from plain local storage to a safer desktop storage path
2. Replace the rich-text placeholder with a real editing surface
3. Add attachment insertion and local asset-path linking flow
4. Add delete propagation and tombstone strategy for sync
5. Add inline diff/merge UI on top of the current per-file conflict resolution actions
6. Add sync history, retry queue, and clearer failure recovery UX
7. Refine Finder-style macOS mount flow and volume-name reconciliation for more edge cases

Optimization backlog:
- configurable local offline path selection instead of only the default path
- markdown preview with richer inline rendering and checklist support
- richer Markdown editing helpers that can toggle existing syntax, not only insert snippets
- attachment rename, dedupe, and replace behavior should become more deliberate
- asset preview should eventually render true image thumbnails and openable file actions
- non-image attachments still need explicit open / reveal actions
- rich text conversion still covers a practical subset of Markdown, not every edge case
- selection-aware formatting toggles instead of insertion-only helpers
- slash commands or quick insert menu for common blocks
- background sync and scheduled sync policies
- sync progress per file, not just whole-task status
- richer diff UI before the first sync decision
- secure credential storage and possibly keychain integration
- cross-device conflict merge helpers
- persisted sync metadata / manifests to support stronger incremental decisions
- remote-side manifest or ETag support to reduce redundant remote comparisons

Sync remaining work checklist:
- add delete propagation and tombstone handling
- add inline diff preview before resolving a conflicted file
- allow "keep both" by writing a duplicated conflict copy instead of forcing one side
- persist richer sync history for troubleshooting and rollback confidence
- add retry queue and resumable sync after network interruption
- support background / scheduled sync without blocking local editing
- move sync credentials to safer desktop storage
- evaluate remote-side metadata support such as ETag or manifest files

Editing readiness checkpoint:
- done:
  - default local offline path initialization
  - real markdown note indexing
  - first-note creation flow
  - selected note full-body loading
  - editable markdown buffer
  - save-to-disk command
  - dirty-state and save-status UX
  - title/frontmatter timestamp refresh on save
  - optional remote sync entry and first-pass sync direction flow
  - first-pass incremental sync with file-level conflict detection
  - persisted sync manifest metadata
  - per-file conflict resolution actions
- still missing before real editing:
  - attachment insertion flow
  - richer sync conflict recovery flow

## 8. Suggested architecture note

The project should likely separate these concerns:

- connection profile:
  remote endpoint and mount instructions

- storage resolution:
  mounted local path and directory existence

- knowledge base path:
  actual notes root inside mounted storage

- cache/session state:
  last opened notes, unsaved edits, degraded mode view

This will matter later when supporting both:
- mac automatic mount flow
- iPhone Files-based or remote-based flow

## 9. Git notes

Branch history note:
- `feature/nas-connection-config` was merged into `main`
- current implementation continues on `feature/macos-auto-webdav-mount`

Suggested commit after review for current branch:
- `feat: add macos webdav mount status flow`

## 10. Short continuity summary

If resuming this project in a new Codex Project/thread, the fastest starting prompt is:

```text
Please continue the NoteBase project from /Users/xd/llm_develop/note_app.
Read PROJECT_HANDOFF.md first, then continue from the latest feature branch.
The next goal is to implement macOS automatic WebDAV mount recovery through system mount capability, not a full custom WebDAV client.
```

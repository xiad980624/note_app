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

## 2. Product direction

This project is a personal note-taking and knowledge base app for:
- macOS
- iPhone
- Windows

Core product goals:
- Markdown editing and preview
- Rich text editing
- Code block editing
- Simple mac-style UI
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
2. Add attachment insertion and local asset-path linking flow
3. Add delete propagation and tombstone strategy for sync
4. Add inline diff/merge UI on top of the current per-file conflict resolution actions
5. Add sync history, retry queue, and clearer failure recovery UX
6. Refine Finder-style macOS mount flow and volume-name reconciliation for more edge cases

Optimization backlog:
- configurable local offline path selection instead of only the default path
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

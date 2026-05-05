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
- NAS-backed storage
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

## 4. NAS strategy: latest state

Initial assumption:
- UGREEN NAS is already mounted in Finder
- First prototype treated mounted NAS as a local path under `/Volumes/...`

New product direction after discussion:
- mac should not rely on users manually reconnecting every time
- app should attempt to recover access automatically
- goal is not to implement a full WebDAV client first
- better mac direction is to call macOS system mount capability for WebDAV, then access mounted files locally

Current recommendation:

### macOS
- Save connection profile:
  - host or public IP
  - port
  - username
  - password
  - protocol
  - mount name
  - remote path
  - knowledge base relative path
- WebDAV remote path should preserve the NAS path form used by the server.
  Current known example:
  - `http://47.103.114.153//home/data`
  - note the double slash before `home/data`
- App should:
  1. check whether mounted path already exists
  2. if yes, read files directly
  3. if not, attempt automatic WebDAV mount through macOS system capability
  4. if mount succeeds, continue using mounted local path
  5. if mount fails, keep cached/open content visible and show degraded state

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
- NAS configuration UI prototype with:
  - profile name
  - protocol
  - public IP
  - port
  - username
  - password
  - remote WebDAV path
  - knowledge base path
- derived mount point from the WebDAV path
- resolved storage path preview
- WebDAV URL preview
- persisted NAS profile in frontend local storage
- frontend mount state flow:
  - checking
  - mounting
  - mounted
  - degraded
  - failed
- frontend persists:
  - NAS profile
  - last mount result
  - last library overview
  - last note index summary
  - selected note id
- when the chosen folder is empty, the app initializes a fresh knowledge base layout and explicitly tells the user to create the first note
- Tauri commands added:
  - `create_note`
  - `load_note_document`
  - `load_knowledge_base_index`
  - `inspect_knowledge_base`
  - `check_mount_status`
  - `attempt_webdav_mount`

Current implementation detail:
- frontend saves the NAS profile locally and restores it on app reload
- frontend can manually trigger:
  - mount availability check
  - reconnect attempt
- browser preview now explicitly reports that native mount actions require the Tauri desktop runtime
- macOS Tauri layer now:
  - checks `/Volumes/<mount name>`
  - derives the expected mount point from the last segment of the WebDAV path
  - computes the resolved knowledge base path
  - ensures the knowledge base layout:
    - `notes/`
    - `assets/images/`
    - `assets/files/`
    - `.notebase/`
  - inspects whether the resolved knowledge base directory is readable
  - returns sample directory entries for quick validation
  - recursively indexes markdown notes from `notes/**/*.md`
  - creates a first markdown note directly under `notes/inbox/`
  - loads full markdown note content for the selected note
  - checks remote WebDAV availability when the local volume is missing
  - attempts macOS Finder-style `mount volume` mounting for reconnect

Current limitation:
- automatic mount is still a first-pass prototype
- no secure credential storage yet
- full note body loading exists and is shown in the editor panel, but editing and save-back are not wired yet
- mount success still depends on local macOS permissions and environment
- browser preview can explain mount actions, but it cannot execute native WebDAV mount commands
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
1. Move NAS credentials from plain local storage to a safer desktop storage path
2. Wire editable markdown state in the editor panel for the selected note
3. Add a save command that writes note body and frontmatter updates back to disk
4. Keep last opened note content in memory/cache while remote storage is unavailable
5. Add a clearer degraded-mode UX for:
   - local mount exists and the app created a brand-new knowledge base layout
   - automatic mount failed
6. Refine the Finder-style macOS mount flow and volume-name reconciliation for more edge cases

Editing readiness checkpoint:
- done:
  - WebDAV reachability check
  - reconnect attempt through macOS native mount flow
  - derived mount point and resolved storage path
  - automatic knowledge base directory initialization
  - real markdown note indexing
  - first-note creation flow
  - selected note full-body loading
- still missing before real editing:
  - editable markdown buffer
  - save / autosave flow
  - dirty-state and save-status UX
  - title/frontmatter update rules
  - attachment insertion flow

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

# PROJECT HANDOFF

## 1. Project overview

Project name:
- NoteBase

Workspace root:
- `/Users/xd/llm_develop/note_app`

Code directory:
- `/Users/xd/llm_develop/note_app/app/notebase`

Current branch:
- `feature/nas-connection-config`

Latest committed base:
- `main` commit `3d6d645`
- commit message: `Initial note app prototype`

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
  - public IP
  - port
  - mounted volume
  - knowledge base path
- resolved storage path preview

Current uncommitted work:
- modified `App.tsx`
- modified `App.css`

These changes add NAS config fields into the prototype UI, but do not yet implement automatic mount behavior.

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

Recommended next branch after current work is committed:
- `feature/macos-auto-webdav-mount`

Recommended next coding steps:
1. Persist NAS connection profile locally in the desktop app
2. Add mount status state machine in frontend:
   - mounted
   - checking
   - mounting
   - degraded
   - failed
3. Add Tauri commands for macOS:
   - check if mount path exists
   - attempt WebDAV mount using system capability
   - return mount result and resolved local path
4. Keep last opened note content in memory/cache while remote storage is unavailable
5. Connect resolved local path to actual knowledge base directory selection and reading flow

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

Current branch:
- `feature/nas-connection-config`

Working tree before this handoff:
- modified `app/notebase/src/App.tsx`
- modified `app/notebase/src/App.css`

Suggested commit after review:
- `feat: add NAS connection profile fields to desktop prototype`

## 10. Short continuity summary

If resuming this project in a new Codex Project/thread, the fastest starting prompt is:

```text
Please continue the NoteBase project from /Users/xd/llm_develop/note_app.
Read PROJECT_HANDOFF.md first, then continue from the current feature branch.
The next goal is to implement macOS automatic WebDAV mount recovery through system mount capability, not a full custom WebDAV client.
```

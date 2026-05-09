# AGENTS.md

## Purpose
This file defines the default engineering workflow that should apply across projects unless a repository-specific rule explicitly overrides it.

## Branch Strategy
- Never work directly on `main` for non-trivial changes.
- Every meaningful task starts from the latest `main`.
- Before starting a new task:
  1. switch to `main`
  2. pull the latest changes
  3. create a fresh branch
- Branch names should be explicit and task-oriented.
- Prefer branch names in one of these forms:
  - `feature/<topic>`
  - `fix/<topic>`
  - `refactor/<topic>`
  - `docs/<topic>`
- Keep one branch focused on one coherent chunk of work.
- Do not mix unrelated changes into the same branch.
- After a PR is merged, do not keep building on the old branch.
- After merge, always return to `main`, update it, and create a new branch for the next task.

## Commit Rhythm
- Commit in small, reviewable steps.
- Do not wait until a large batch of unrelated edits accumulates.
- After finishing a meaningful chunk:
  1. stage the intended files
  2. create a focused commit
  3. push the branch
- Commit messages should use conventional commit style, for example:
  - `feat: add notebook assignment flow`
  - `fix: stabilize markdown autosave`
  - `refactor: align notebook model and docs`

## PR Rhythm
- After a meaningful chunk is committed and pushed, open or hand off a PR immediately.
- Notify the user to review and merge the PR before starting the next branch.
- Do not continue stacking large amounts of new work on top of an unmerged branch unless the user explicitly wants that.
- After the PR is merged:
  1. switch back to `main`
  2. pull latest
  3. create a new branch
  4. continue with the next chunk

## Documentation Sync
- Update project documents whenever implementation changes the actual product behavior, storage model, interaction model, or technical direction.
- Product-specific docs such as `PRD.md`, `UCD.md`, `TECH_STACK_DECISION.md`, and `PROJECT_HANDOFF.md` belong to the repository.
- Cross-project workflow rules belong in the global `AGENTS.md`.

## Collaboration Default
- Prefer stable, incremental delivery over large rewrites.
- Keep the user informed when a task changes branch state, commit state, or PR state.
- If a workflow rule in a repository conflicts with the global file, call out the conflict explicitly and follow the repository-specific rule for that repo.

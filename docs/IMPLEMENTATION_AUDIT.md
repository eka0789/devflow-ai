# Implementation Audit — DevFlow AI

Date: 2026-11-01 · Auditor: build session (pre-implementation discovery + post-implementation review)

## 1. Repository discovery (first action, per master prompt §3)

The workspace `C:\Users\LENOVO\devflow-ai` was **empty** (no files, not a git repository) at session start. Per the master prompt: *"If the repository is empty, initialize the recommended monorepo architecture."*

### Environment probe results

| Tool | Result | Decision |
|---|---|---|
| Node.js | v24.13.0 | Use built-in `node:sqlite` (zero native-compile risk on Windows) |
| npm | 11.12.1 | npm workspaces monorepo |
| Git | 2.54.0 | Structured commit workflow |
| Flutter | **not installed** | Cannot build/verify a Flutter app → web-first client + identical REST contract; documented, not faked |
| Docker | **not installed** | Runner implemented with runtime probing; executions run in API mode; test step reports `skipped` honestly |
| Firebase CLI/credentials | none | SQLite default store; `firebase/` rules + emulator config prepared for the Firebase path |

## 2. Architecture decisions

1. **Monorepo**: `apps/api` (Express + TS), `apps/web` (React 18 + Vite), `packages/shared` (types + zod contracts). Shared package is consumed as TypeScript source by both sides — one source of truth for domain shapes.
2. **SQLite over Firestore for v1**: real database, WAL, `PRAGMA user_version` migrations, synchronous driver → safe transactions for the state machine and draft-approval flows. Firestore path documented (see `docs/SETUP_FIREBASE.md`).
3. **State machine as a service**: `transitionEntity()` is the only path that changes story/task status; it enforces `VALID_TRANSITIONS` and dependency gates and records `status_events` — the single source for burndown/velocity.
4. **Drafts before data**: every AI planning output lands in `drafts` with `status='draft'`; approval (with confirmation dialog in the UI) materializes epics/stories/tasks in one transaction with dependency resolution by title and duplicate-epic reuse.
5. **Execution without a clone**: the pipeline uses the GitHub Git Data API (tree → blobs → tree → commit → ref) so code generation works without local clones and without exposing the host to repo code. Docker is used only for the *optional* test step, fully isolated.
6. **Secrets**: AES-256-GCM at rest keyed from `APP_SECRET` (scrypt-derived); JWT HS256 hand-rolled (no dependency); scrypt password hashing.

## 3. Existing-code constraints

Not applicable — empty repository. Nothing was overwritten or deleted.

## 4. Technical debt / known limitations (recorded, not hidden)

- Single-process rate limiting (in-memory) and in-process background workflows (agent runs, executions) — horizontal scaling requires moving to Cloud Tasks/Queues (documented in `docs/DEPLOYMENT.md`).
- Sprints: metrics snapshot frozen at completion; re-planning a completed sprint's stories does not rewrite history (by design, documented).
- MockProvider exists for tests/offline demos; it is only selected when no provider is configured and is always labeled (`Mock AI response…` / usage rows `kind='agent'`).
- Flutter client not implemented (toolchain absent) — REST contract + Firebase rules prepared so it can be added without backend changes.

## 5. Post-implementation audit (2026-11-01)

Verified during the same session:

- `tsc --noEmit` clean for `packages/shared`, `apps/api`, `apps/web` (strict + `noUncheckedIndexedAccess`).
- 49/49 vitest tests passing (`docs/TEST_REPORT.md`).
- `vite build` production bundle: 88 modules, 383 kB JS (108 kB gzip), 44.8 kB CSS.
- Live browser smoke test (Chromium against dev servers): register → login → 401-recovery → create project → project overview → AI planning workflow (PM → Architect → Scrum Master, 1,152 tokens) → 6 drafts → approve with confirmation → **1 epic, 2 stories, 2 tasks materialized** → backlog tree with enforced transitions → kanban board with drag-drop columns → chat honest "not configured" error with retry → notifications unread badge → dark premium UI confirmed via screenshots.
- Bugs found & fixed during the smoke test (root causes recorded):
  1. `GET /api/projects/:id` returned the raw DB row (snake_case) → added `getProject()` mapper.
  2. Auth routes were missing the `/auth` prefix → fell through to `requireAuth` and 401'd.
  3. `transitionEntity` interpolated `story`/`task` as table names → mapped to `stories`/`tasks`.
  4. `startWorkflow` returned a raw row (`steps` as JSON string) → now returns the serialized `AgentRun`.
  5. Sprint completion computed metrics *after* the carry-over wiped assignments → snapshot is taken first.
  6. React render crashes rendered a blank page → added a top-level `ErrorBoundary` (also served as the diagnostic tool for fixes 1 & 4).

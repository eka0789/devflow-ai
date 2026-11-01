# Implementation Plan — DevFlow AI

Delivered across the dependency order required by the master prompt. Each phase below records what shipped, the key files, and how acceptance was checked.

## Phase 1 — Foundation ✅
- npm-workspaces monorepo; `packages/shared` consumed as TS source by both apps (one contract source).
- Strict TypeScript (`strict` + `noUncheckedIndexedAccess`) across all packages; `tsconfig.base.json`.
- Zero-native-dependency persistence choice: `node:sqlite` (Node ≥ 22.5) with WAL + `user_version` migrations (`apps/api/src/db/`).
- Structured JSON logging, request ids, centralized error envelope (`{error:{code,message,details}}`).
- Vite proxy (`/api → :4310`), custom dark-first CSS design system with light theme tokens.

## Phase 2 — Auth & Workspace ✅
- scrypt password hashing, HS256 JWT (constant-time verify), 12 h tokens.
- Workspace auto-created per user; every project-scoped query ownership-checked (`requireProject`); foreign ids → 404.
- Rate limiting on auth (fixed-window, per-IP) and AI chat (per-user).
- Files: `services/auth.service.ts`, `util/crypto.ts`, `util/jwt.ts`, `middleware/*`.

## Phase 3 — Project Management ✅
- Projects CRUD with status/tech-stack, dashboard aggregates computed live from SQL, global + per-project activity feeds.
- Files: `services/projects.service.ts`, `services/analytics.service.ts`, `routes/projects.routes.ts`.

## Phase 4 — GitHub Integration ✅ (awaiting token)
- PAT stored AES-256-GCM encrypted; validated against `GET /user/repos` before storage.
- Client: repos/branches/commits/PRs/PR-files/combined-status; merge; Git Data API commit builder.
- Webhook receiver: raw body + HMAC-SHA256 + delivery dedupe → activity + notifications.
- Files: `services/github/{client,webhooks,merge}.service.ts`.

## Phase 5 — Agile Scrum ✅
- Epics → stories (points 0–13, priority, acceptance criteria) → tasks → subtasks.
- Dependencies with transitive cycle detection and forward-progress gates (`DEPENDENCY_BLOCKED`).
- Centralized `transitionEntity()` — the only status mutation path; records `status_events`.
- Sprints: plan → activate (guards: non-empty, single active) → complete (carry-over, frozen metrics snapshot); velocity from snapshots; burndown from real events.
- Board: kanban payload grouped by column with story/epic context.
- Files: `services/backlog.service.ts`, `services/sprints.service.ts`.

## Phase 6 — AI API Integration ✅ (awaiting provider)
- `AIProvider` interface; `OpenAICompatibleProvider` (chat + SSE streaming, retries on 429/5xx, timeouts, usage extraction) and a clearly-labeled `MockProvider` (schema-valid outputs, used only when unconfigured).
- Streaming chat over POST-SSE with manual frame parsing client-side; conversations/messages persisted; usage_events per request; provider "Test connection" with latency.
- Files: `services/ai/provider.ts`, `services/ai/chat.service.ts`, `lib/api.ts` (client SSE reader).

## Phase 7 — AI Multi-Agent ✅
- Registry of 7 agents with role prompts; workflows `full_planning | prd_only | tech_plan_only | backlog_only`.
- Guards: max 3–4 steps, per-step timeout, one running workflow per project, zod-validated structured outputs (retry-free fail-fast), fire-and-forget with crash capture, stale-run repair on boot.
- Files: `services/ai/agents.service.ts`.

## Phase 8 — AI Planning Engine ✅
- PRD / tech plan (markdown) and backlog (strict JSON) drafts; drafts require approval; backlog approval runs one transaction that dedupes epics by title, resolves story dependencies by title, and creates stories/tasks/subtasks.
- Files: `services/drafts.service.ts`.

## Phase 9 — Docker Execution Runner ✅ (code) / ⏳ (live verification)
- `isDockerAvailable()` probe (cached 60 s); image + test-command detection (node/python/go/rust).
- Isolation: `--network none --cap-drop ALL --security-opt no-new-privileges --memory 1g --cpus 1.5 --read-only --tmpfs /tmp`, repo copied to a temp dir (never the real checkout), cleanup on exit, 10 min ceiling.
- Files: `services/execution/docker.executor.ts`.

## Phase 10 — AI Code Generation ✅ (awaiting credentials for a live run)
- Pipeline: precheck (honest `EXECUTION_NOT_READY` list) → repo tree relevance analysis → developer-agent JSON codegen (path-safety refined) → unified diff (LCS, size-capped) → optional isolated test run → Git Data API commit on `devflow/task-*` branch → draft PR (ready only if tests passed) → task synced to `in_review` → activity + notification. Cancel-aware between steps; every step logged and pollable.
- Files: `services/execution/pipeline.ts`, `util/diff.ts`.

## Phase 11 — GitHub PR Workflow ✅ (awaiting token)
- PR list/detail with per-file patches; merge requires typed `MERGE` confirmation; server-side checks (open, not draft, mergeable, CI not failing) → `PR_NOT_MERGEABLE` with reasons; immutable `audit_log` record + notification.
- Files: `services/github/merge.service.ts`, `routes/github.routes.ts`.

## Phase 12 — Analytics & Notifications ✅
- Dashboard stats, velocity, burndown, completion rate, AI usage (per-day tokens/requests), execution stats incl. failures — all from real tables.
- Notifications with unread badge, mark one/all read.
- Files: `services/analytics.service.ts`, `services/events.service.ts`.

## Phase 13 — Production Readiness ✅ (scope documented)
- Regression suite 49/49, security write-up, deployment guide (dev/staging/prod incl. Cloud Run notes), CI workflow, Firestore rules + emulator config for the prepared Firebase path.

## Follow-on backlog (explicitly out of this delivery)
1. Flutter Android/desktop client on the existing REST contract.
2. Firestore-backed store option (rules prepared) for Firebase-native deployments.
3. Cloud Tasks/Queues for multi-instance execution and rate limiting.
4. Live verification passes for GitHub/AI/Docker once credentials/engines exist (steps scripted in `docs/SETUP_*.md`).

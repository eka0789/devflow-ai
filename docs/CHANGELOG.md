# Changelog — DevFlow AI

## 0.2.0 — 2026-11-01 (review pass + feature wave 2)

### Added
- **Global search**: `GET /api/search` (ownership-scoped, wildcard-escaped) wired into the Ctrl+K command palette with debounce — finds projects, stories and tasks across the workspace.
- **Task comments**: discussion threads on tasks (schema v3), available in the kanban task drawer; author-only delete; activity feed integration.
- **Sprint review & retrospective**: new `sprint_review` agent workflow grounded in the completed sprint's frozen metrics (points, carried-over stories, AI execution outcomes); one-click generation from the Sprints page; lands as an approvable draft (master prompt Phase 5 ceremonies).
- **Project export**: `GET /projects/:id/export` (`devflow-project/v1`, secret-free) + one-click JSON download in project settings.
- **Execution retry**: re-run failed/awaiting-review/cancelled executions with full requirement re-validation (task-status gate intentionally relaxed).
- New tests: webhook HMAC real-signature path, complete merge guard (draft/conflict/CI/audit), execution cross-tenant isolation, auth rate limiting (429), cross-user project write protection, search/comments/sprint-review/export behavior — suite grew 49 → 64.

### Security (fleet review findings, all fixed)
- `GET agent-runs` endpoints now enforce project ownership + user scoping (cross-tenant read).
- `GET /executions/stats` rejects foreign project ids instead of silently scoping.
- Git clone stderr is redacted before persistence/logging so the GitHub PAT can never land in `executions.logs` or server logs.
- SSRF guard on the AI provider base URL: private/loopback/link-local hosts rejected unless `ALLOW_PRIVATE_AI_HOSTS=true` (local LLM opt-in); redirects no longer followed.
- AI-generated changes can no longer touch CI/CD, credential or container files (`.github/workflows`, `.gitlab-ci.yml`, `Dockerfile*`, `.env*`, keys/certs, pubxml).
- `trust proxy` is now opt-in via `TRUST_PROXY=true` (prevents X-Forwarded-For spoofing against the rate limiter).
- GitHub routes actually rate-limited (limiter was previously created but never mounted).

### Fixed
- `GET /api/projects/:projectId/executions/:id` verified `row.project_id === projectId` (cross-tenant read via a foreign project id — found empirically by the testing reviewer).
- Sprint metrics snapshot migration restored as its own version (fresh databases now get `metrics_snapshot`).

## 0.1.0 — 2026-11-01 (initial delivery)

### Added
- Monorepo (`apps/api`, `apps/web`, `packages/shared`) with strict TypeScript and shared zod contracts.
- Auth: register/login (scrypt + HS256 JWT), workspaces, per-user ownership isolation, rate limiting.
- Projects: CRUD, status, tech stack, activity feeds, real dashboard analytics.
- Backlog: epics/stories/tasks/subtasks, priorities, story points, acceptance criteria, dependencies with cycle detection, centralized status state machine with `status_events` history.
- Sprints: lifecycle (plan→activate→complete), story assignment, carry-over on completion, frozen metrics snapshots, velocity, burndown from real events.
- Kanban board with drag & drop through the transition service.
- AI: OpenAI-compatible provider adapter with SSE streaming, per-user encrypted credentials, streaming chat with project context, usage tracking, one-click connection test; clearly-labeled mock provider for offline/testing.
- Multi-agent planning: 7-agent registry, workflows with step/token guards, zod-validated structured outputs, draft → approval → real backlog records.
- GitHub: encrypted PAT storage, repo connect, branches/commits/PR views, HMAC-validated webhook receiver with dedupe, merge with server-side checks, typed confirmation and immutable audit log.
- Execution pipeline: honest prechecks, repo analysis, AI code generation, unified diff, isolated Docker test runs (when available), Git Data API commits to feature branches, draft-vs-ready PR policy, task synchronization, step logs, cancellation.
- Analytics: velocity, burndown, completion, AI usage, execution/failure stats — all computed from application data.
- Notifications, command palette (Ctrl+K), dark/light themes, loading/empty/error states everywhere, top-level ErrorBoundary.
- Docs: audit, plan, status, test report, API reference, deployment, security, integration setup guides.
- CI workflow (install → typecheck → test → build), Firestore rules + emulator config for the prepared Firebase path.

### Fixed during delivery (found via live browser smoke test)
- Singular project endpoint returned raw DB row instead of the API shape.
- Auth route prefix missing (`/auth/...`), causing 401s on register/login.
- State machine interpolated wrong table names for tasks.
- Workflow start returned a raw DB row instead of the serialized `AgentRun`.
- Sprint completion computed metrics after story carry-over (totals shrank); snapshot now precedes carry-over.
- Render errors produced a blank screen; ErrorBoundary now renders a diagnostic panel.

# Changelog — DevFlow AI

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

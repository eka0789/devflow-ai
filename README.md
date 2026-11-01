# DevFlow AI

**Personal AI Software Engineering Workspace** — plan with AI agents, manage an agile backlog, run AI code executions against your GitHub repositories, and ship through human-approved Pull Requests.

![status](https://img.shields.io/badge/tests-49%2F49%20passing-brightgreen) ![build](https://img.shields.io/badge/web%20build-passing-brightgreen) ![node](https://img.shields.io/badge/node-%E2%89%A522.5-blue)

## What it does

- **Projects & workspaces** — ownership-isolated workspaces with real activity feeds.
- **AI planning agents** — 7-agent registry (PM, Architect, Scrum Master, Developer, Code Reviewer, QA, Tech Writer). Multi-step workflows produce a PRD, technical plan and structured backlog proposal — always saved as **drafts** that require your approval before touching real data.
- **Agile scrum** — epics → stories → tasks → subtasks, story points, priorities, dependencies with cycle detection, sprints with activate/complete lifecycle, kanban board with drag & drop, velocity and burndown computed from real status events.
- **Centralized state machine** — stories/tasks can only move through valid transitions; dependency gates block forward progress.
- **AI chat** — streaming (SSE) conversations with project context, persisted history and token usage tracking. Works with any OpenAI-compatible provider configured per-user.
- **GitHub integration** — PAT-based (encrypted at rest), repository connection, branches/commits/PR views, webhook receiver with HMAC validation and delivery deduplication, PR merge with server-side verification and an immutable audit log.
- **AI code execution** — pick a task → the pipeline analyzes the repo, generates changes, builds a unified diff, runs tests in an **isolated Docker container** (network-disabled, capability-dropped, read-only rootfs) when Docker is available, commits to a feature branch via the GitHub API, and opens a **draft PR** unless tests pass. Merge always requires explicit human confirmation.

## Monorepo layout

```
apps/api        Express + TypeScript API (SQLite via node:sqlite, zero native deps)
apps/web        React 18 + Vite client (dark-first design system, no UI framework)
packages/shared Domain types, error codes, zod contracts shared by both sides
docs/           Audit, plan, status, test report, deployment & security docs
firebase/       Firestore rules & emulator config (prepared Firebase path)
```

## Quick start

Requirements: **Node.js ≥ 22.5** (uses the built-in `node:sqlite`). No Docker, no Firebase account and no API keys are needed to run the core app.

```bash
npm install
cp .env.example .env        # then set APP_SECRET (any 32+ char random string)
npm run dev                 # API on :4310, web on :5173
```

Open **http://localhost:5173**, register, and you are in.

| Command | Purpose |
|---|---|
| `npm run dev` | API + web with hot reload |
| `npm test` | API test suite (vitest, 49 tests) |
| `npm run typecheck` | Strict TS across all workspaces |
| `npm run build` | Production web build |

## External integrations (all optional, all honest)

| Integration | Status without config | How to enable |
|---|---|---|
| AI provider | Chat/agents run on a **clearly-labeled mock**; chat shows an actionable "not configured" error with retry | Settings → AI Provider (any OpenAI-compatible base URL + key + model). Test the connection with one click. |
| GitHub | Execution precheck refuses with a precise list of what's missing | Settings → GitHub (PAT with repo scope; validated before storing) |
| Docker | Tests inside executions are marked `skipped` and PRs are created as drafts | Install Docker Desktop; the runner probes availability at runtime |
| Firebase | Not required — SQLite is the default store. Firestore rules for a future Flutter client are prepared in `firebase/` | See `docs/SETUP_FIREBASE.md` |

The UI never fakes success: unconfigured integrations surface `AI_NOT_CONFIGURED`, `GITHUB_NOT_CONFIGURED`, `EXECUTION_NOT_READY` (with the exact missing items) and `DOCKER_UNAVAILABLE`-style results instead of pretend data.

## Security posture (summary)

- Passwords: scrypt with per-user salt; JWT HS256 (12 h) via a constant-time verify.
- Stored secrets (GitHub PATs, AI keys): AES-256-GCM encrypted with a key derived from `APP_SECRET`; never returned to clients.
- Every project-scoped resource is ownership-checked; foreign IDs yield `404` (no existence leak).
- Webhooks: HMAC-SHA256 signature validation + delivery deduplication, raw-body only for that route.
- Untrusted repo code never touches the host: the Docker runner uses `--network none --cap-drop ALL --security-opt no-new-privileges --read-only` with temp-workspace bind mounts and cleanup.
- Merges require typed confirmation (`MERGE`), pass server-side checks and land in an immutable audit log.
- Full details: [`docs/SECURITY.md`](docs/SECURITY.md).

## Documentation

- [`docs/IMPLEMENTATION_AUDIT.md`](docs/IMPLEMENTATION_AUDIT.md) — environment audit and architectural decisions
- [`docs/IMPLEMENTATION_PLAN.md`](docs/IMPLEMENTATION_PLAN.md) — phase-by-phase plan and delivery record
- [`docs/PROJECT_STATUS.md`](docs/PROJECT_STATUS.md) — per-module status (what works, what awaits credentials)
- [`docs/TEST_REPORT.md`](docs/TEST_REPORT.md) — executed tests and results
- [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md) — dev/staging/production deployment
- [`docs/API.md`](docs/API.md) — complete REST reference
- [`docs/CHANGELOG.md`](docs/CHANGELOG.md)

## Known scope decisions (no silent pretend)

1. **Web-first client.** The master prompt requested Flutter; this machine has no Flutter toolchain, so the product ships as a production-grade web client speaking the same REST contract (`docs/API.md`). A Flutter Android/desktop client can be built against it without backend changes (`firebase/` + contract docs prepared).
2. **SQLite instead of Firebase/Firestore.** Zero-credential real database with WAL, migrations and transactional domain logic. The Firestore rules + emulator config for the Firebase path are included and documented.
3. **Docker runner is fully implemented but unverified on this machine** (no Docker installed). Availability probing is honest; tests are skipped and PRs become drafts rather than pretending verification happened.

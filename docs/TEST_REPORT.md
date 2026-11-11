# Test Report — DevFlow AI

Environment: Windows 10 (10.0.26200), Node v24.13.0, vitest 3.x, tsx watch dev servers.
All results below are from **actually executed** runs on 2026-11-01.

## 1. Automated suite — `npm test` (vitest, apps/api)

**Result (latest full run): 11 files, 101 tests — 101 passed, 0 failed.**

| File | Tests | Covers |
|---|---|---|
| `test/crypto-jwt.test.ts` | 10 | scrypt hash/verify, AES-256-GCM roundtrip + tamper, JWT sign/verify/expiry/tamper, unified diff (add/modify/delete/identical) |
| `test/auth.test.ts` | 7 | register→login→me over HTTP, bad credentials (401), duplicate email (409), weak password (422), bearer enforcement, tampered token, ownership isolation (404 not 403) |
| `test/state-machine.test.ts` | 5 | valid transitions + status events, invalid transition 409 `INVALID_TRANSITION`, same-status no-op, dependency gating (`DEPENDENCY_BLOCKED`), self-dependency & cycle rejection, same rules for tasks |
| `test/sprints.test.ts` | 6 | empty-sprint activation guard, single-active-sprint guard, activation moves backlog→todo, completion (carry-over, frozen snapshot, 5/13 = 38%), unassign, board payload, dashboard stats from real data |
| `test/webhooks.test.ts` | 5 | signature rejected without secret, delivery dedupe, PR event → activity + notification, push → activity, HTTP 401 on bad signature, missing headers 400 |
| `test/agents.test.ts` | 8 | 7-agent registry, full planning workflow → succeeded (3 steps) → 3 drafts → approve creates real records, concurrent-run guard, double-approve rejected, mock provider schema validity + labeling, OpenAI-compatible completion parse, SSE stream parse + usage, provider error mapping, AI settings resolution |
| `test/chat-execution.test.ts` | 8 | SSE chat end-to-end over HTTP (deltas + done + persistence), `AI_NOT_CONFIGURED` structured stream error, conversation ownership, execution prechecks (all missing items), done-task refusal |
| `test/review-fixes.test.ts` | 8 | Fleet-review regressions: real-HMAC webhook acceptance, merge guard (draft/CI-fail/happy+audit), execution cross-tenant isolation, auth rate limiting (429), cross-user project PATCH/DELETE |
| `test/features.test.ts` | 11 | Wave 2–3: global search (incl. wildcard escaping + HTTP scoping), task comments (add/list/delete/author-only), sprint review workflow from frozen metrics, project export snapshot, retry prechecks, dependency/sprint guards, deleteStory cascade |
| `test/wave3.test.ts` | 15 | Wave 3: workspace roles (viewer 403, stranger 404), invite activation on register, roster, assignee workspace validation, my-work, labels round-trip, @mentions, task timeline, import round-trip + malformed 422, roadmap, outgoing webhooks (fan-out, HMAC signature, honest test endpoint) |
| `test/ai-parsing.test.ts` | 18 | Provider response parsing: multi-shape completions (canonical/Anthropic/Responses-API/reasoning_content), delta shapes, usage dialects, base-URL normalization |

## 2. Static verification (executed)

| Check | Result |
|---|---|
| `tsc --noEmit` — packages/shared | ✅ 0 errors |
| `tsc --noEmit` — apps/api (strict + noUncheckedIndexedAccess) | ✅ 0 errors |
| `tsc --noEmit` — apps/web | ✅ 0 errors |
| `vite build` (production) | ✅ 88 modules, 383 kB JS (108 kB gzip), 44.8 kB CSS |

## 3. Live browser smoke test (Chromium, dev servers, executed)

Flow: register → dashboard (real zeros, empty states) → create project (validated form) → project overview (settings form, activity feed) → **AI Planning: full workflow** (PM → Architect → Scrum Master, status Succeeded, 1,152 tokens) → 6 drafts listed → open backlog draft (structured viewer) → **Approve & create** (confirmation dialog) → toast "created 1 epics, 2 stories, 2 tasks" → **Backlog** shows epic + stories with points/priority and transition dropdowns limited to valid states → status change backlog→todo → **Board** shows kanban columns with task cards → **Chat** honest `AI_NOT_CONFIGURED` inline error with Retry → notifications unread badge increments → screenshots confirm premium dark UI.

Defects discovered live and fixed (re-tested after each fix):
1. `GET /api/projects/:id` returned raw DB row → added `getProject()` mapping (`techStack` etc.).
2. Auth routes lacked `/auth` prefix → 401 on register/login.
3. `transitionEntity` used singular table names → mapped to `stories`/`tasks`.
4. `startWorkflow` returned raw row (steps as string) → serialized `AgentRun`.
5. Sprint completion snapshotted metrics after carry-over → snapshot moved before carry-over.
6. Render crashes yielded a blank page → top-level `ErrorBoundary` added (readable error panel).

## 4. Platform builds

| Platform | Status |
|---|---|
| Web (production build) | ✅ verified |
| Android / Windows / Linux native (Flutter) | ⏳ **not built** — Flutter toolchain absent from this machine; documented in `PROJECT_STATUS.md`, REST contract prepared |

## 5. Remaining issues / awaiting external verification

| Item | Blocker | Verification step once unblocked |
|---|---|---|
| Live AI provider chat & agent generation | No API key on this machine | Settings → AI Provider → "Test connection"; run a real planning workflow |
| Live GitHub flows (connect, webhooks, execution→PR, merge) | No PAT/repo | `docs/SETUP_GITHUB.md` checklist |
| Docker test runs inside executions | Docker Desktop absent | `docker --version` then trigger an execution; expect `testResult.status='passed'` on a healthy repo |
| Firestore rules against the emulator | Firebase CLI absent | `docs/SETUP_FIREBASE.md` |

No test was reported passing without being executed; features depending on unavailable external services are marked as awaiting configuration rather than assumed working.

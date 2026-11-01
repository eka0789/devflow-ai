# Security Audit — DevFlow AI

Scope: code shipped in this repository, audited 2026-11-01. Live penetration testing against external services (GitHub/AI providers) was **not** possible without credentials; findings below are from code review + automated tests.

## Authentication & sessions
- Passwords: `scrypt` (N=default, 64-byte key) with 16-byte random salt; constant-time compare. ✅ tested.
- JWT: HS256, 12 h expiry, `timingSafeEqual` MAC check, alg pinned to HS256, expiry enforced. Tampered/expired/short tokens rejected. ✅ tested.
- `APP_SECRET` short/missing → ephemeral secret + loud warning (dev-only convenience, never silent).

## Secrets at rest
- GitHub PATs and AI API keys are encrypted with AES-256-GCM (key = scrypt(APP_SECRET, fixed salt, 32)). Auth-tag tampering fails decryption → `null`. ✅ tested.
- Secrets are never returned by any endpoint (settings endpoints expose only `configured`, `baseUrl`, `model`). Webhook payloads are stored truncated (200 kB) and never include request headers.

## Authorization / isolation
- Every project-scoped service call goes through `requireProject(projectId, userId)`; mismatch → `404` (no existence leak). ✅ tested (`auth.test.ts`).
- Conversations, drafts, agent runs, executions, notifications: all ownership-scoped in SQL. Webhook events are matched to projects by `repo_full_name` before any effect.
- Merge endpoint requires: bearer auth, project ownership, typed `confirmation === "MERGE"`, then server-side PR state checks. ✅ guard logic implemented; live merge path awaits a real PAT (see TEST_REPORT).

## Webhooks
- HMAC-SHA256 over the **raw** body (`express.text` mounted before `express.json` — only for that route), constant-time compare, 401 on mismatch/absence, delivery-id dedupe. ✅ tested.
- Without `GITHUB_WEBHOOK_SECRET` configured the endpoint rejects everything (fails closed). ✅ tested.

## Untrusted code isolation (execution runner)
- Control plane talks to GitHub via HTTPS API only; repo code is never executed on the host.
- Optional test runs: repository is copied into a fresh temp dir, bind-mounted into a container with `--network none`, `--cap-drop ALL`, `--security-opt no-new-privileges`, `--memory 1g`, `--cpus 1.5`, `--read-only` rootfs + `--tmpfs /tmp`, auto-remove, hard timeout, and temp-dir cleanup. The host Docker socket, cloud credentials, and the real checkout are never mounted. Privileged mode is never used.
- ⚠️ **Unverified live**: Docker was unavailable on the audit machine. The flags above follow Docker's standard isolation guidance but have not been exercised here (explicitly recorded in `TEST_REPORT.md` / `PROJECT_STATUS.md`).

## Injection & input handling
- All SQL uses prepared statements with bound parameters (no string-built values; the only interpolated identifiers are hardcoded table names).
- All request bodies validated with zod schemas; 422 with issue details on failure.
- AI codegen output paths are rejected unless relative, no `..`, no backslashes; change actions constrained by zod enum.
- Markdown rendering on the web is a React-element renderer (no `dangerouslySetInnerHTML`, https-only links).
- Express body limits (1–2 MB) and `x-powered-by` disabled; security headers set (`nosniff`, `DENY`, referrer-policy, HSTS in prod).

## Rate limiting & abuse
- Auth endpoints: 30 req / 15 min / IP. AI chat: 20 req / min / user. GitHub reads: 60/min/user.
- In-memory fixed window — resets on restart; acceptable for single-instance dev/staging (multi-instance requires a shared limiter, documented in DEPLOYMENT.md).

## Audit trail
- `audit_log` records merge actions (actor, target, method, sha) and is append-only by convention (no API writes or deletes it).
- `status_events`, `activities`, `executions.logs` provide full workflow history.

## Known gaps (recorded, prioritized)
1. **Genuinely live** GitHub/AI/Docker verification pending credentials (TEST_REPORT §5).
2. JWT revocation: stateless tokens; logout is client-side. Add a denylist/short TTL+refresh if token theft matters to your threat model.
3. Webhook replay: dedupe prevents double-processing, but signatures are not timestamp-checked (GitHub does not sign timestamps); delivery retention window is unbounded — consider pruning `webhook_events`.
4. No CSRF surface (Bearer-token API, no cookies) — keep it that way if cookie auth is ever added.
5. Dependency audit shows dev-tool advisories (npm audit); none in the runtime-critical path — re-run `npm audit` before each release.

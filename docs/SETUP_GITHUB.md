# Setup: GitHub Integration

DevFlow AI integrates with GitHub through a **Personal Access Token (fine-grained or classic)** stored encrypted per user. No GitHub App registration is required to start.

## 1. Create a token

GitHub → Settings → Developer settings → Personal access tokens:

- **Classic**: scopes `repo` (full control of private repositories) and, if you want workflow status reads, `workflow`.
- **Fine-grained**: repository access = the repos you plan to connect; permissions: Contents (R/W), Pull requests (R/W), Metadata (R), Commit statuses (R), Webhooks (R/W if you will manage them via API).

## 2. Connect in the app

1. Sign in → **Settings → GitHub** → paste the token → Save.
   The server validates it against `GET /user/repos` **before** storing; an invalid token is rejected with a clear message and nothing is persisted.
2. Open a project → **GitHub** tab → pick a repository → **Connect**.
   The server verifies access to that repo and stores `owner/name` + default branch on the project.

## 3. Webhooks (recommended)

For push/PR events to flow into activity & notifications:

1. Generate a webhook secret: add `GITHUB_WEBHOOK_SECRET=<random hex>` to `.env` and restart the API.
2. GitHub repo → Settings → Webhooks → Add webhook:
   - Payload URL: `http(s)://<your-api-host>/api/webhooks/github`
   - Content type: `application/json`
   - Secret: the same value
   - Events: Push, Pull requests (add Issues if you want issue activity)
3. Use "Redeliver" on a recent delivery to test — the app logs processed events to project activity.

Signatures are validated (HMAC-SHA256, constant-time) and deliveries are deduplicated by `X-GitHub-Delivery`.

## 4. Verification checklist (live)

- [ ] Settings shows GitHub as connected
- [ ] Project → GitHub → repository picker lists your repos
- [ ] Branches and commits tabs show real data
- [ ] Open a PR → files + diff render → Merge (type `MERGE`) executes and lands in the audit log
- [ ] Push a commit → project activity shows "N commit(s) pushed"

Without a token, every GitHub feature answers `GITHUB_NOT_CONFIGURED` and execution prechecks list it as a missing requirement — nothing pretends to work.

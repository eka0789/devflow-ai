# Deployment Guide — DevFlow AI

## Environments

### Development (this machine, verified)
```bash
npm install
cp .env.example .env       # set APP_SECRET (32+ random chars)
npm run dev                # api :4310 (tsx watch) + web :5173 (vite)
```
- Database: SQLite at `DB_PATH` (default `./data/devflow.db`, auto-created, WAL).
- `APP_SECRET` unset → ephemeral secret with a loud warning (sessions reset each restart). Always set it, even locally.

### Production (single VM / container)
```bash
npm ci
npm run build              # builds apps/web/dist (API runs via tsx)
NODE_ENV=production npm start
```
Serve `apps/web/dist` with any static host/CDN and reverse-proxy `/api` to the API process (nginx/Caddy example in `docs/DEPLOYMENT.md` §Reverse proxy). Required env: `PORT`, `APP_SECRET`, `CLIENT_ORIGIN` (your web origin), `DB_PATH` (persistent volume!), optional `GITHUB_WEBHOOK_SECRET`.

Checklist:
- [ ] `APP_SECRET` ≥ 32 random chars (regenerating it invalidates JWTs **and** stored encrypted secrets — users must re-enter PAT/AI keys)
- [ ] Persistent disk for the SQLite file (back it up: `sqlite3 data/devflow.db ".backup backup.db"`)
- [ ] `CLIENT_ORIGIN` matches the deployed web origin exactly (CORS)
- [ ] HTTPS termination in front of both web and API
- [ ] `LOG_LEVEL=info` (JSON logs are stdout/stderr ready for any collector)

### Staging / Cloud Run (Google Cloud)
The API is a stateless-in-front, stateful-at-the-disk Node service. For Cloud Run:
1. Build a container from the repo (any Node ≥ 22.5 base; `npm ci --omit=dev && npm run build`).
2. Mount Cloud SQL / Filestore for the SQLite file **or** switch the store to Postgres/Firestore (see limitation below).
3. Deploy: `gcloud run deploy devflow-api --source . --set-env-vars APP_SECRET=…,CLIENT_ORIGIN=…` and set `GITHUB_WEBHOOK_SECRET` in Secret Manager.
4. Webhooks need a public URL: configure the GitHub webhook to `https://<run-url>/api/webhooks/github` with the same secret.

**Scaling limitation (honest):** in-memory rate limits, in-process workflow runners, and SQLite assume a single API instance. Multi-instance deployment requires moving executions/agent runs to a queue (Cloud Tasks) and the DB to a shared store. This is listed in `docs/IMPLEMENTATION_PLAN.md` → Follow-on backlog; do not scale to N instances without it.

### Firebase path (prepared, optional)
`firebase/firestore.rules` implements the ownership-isolation model for a Firebase-native deployment (mobile/Flutter client reading Firestore directly). Enable with:
```bash
firebase deploy --only firestore:rules,firestore:indexes
```
See `docs/SETUP_FIREBASE.md`. The current API uses SQLite; the rules are provided so the Flutter client track can ship without redesigning authorization.

## Reverse proxy example (Caddy)
```
app.example.com {
  root * /srv/devflow/apps/web/dist
  try_files {path} /index.html
  file_server
  handle /api/* {
    reverse_proxy 127.0.0.1:4310
  }
}
```

## Database migrations
Applied automatically on boot (`PRAGMA user_version`-gated, sequential). Never edit an applied migration; append a new one in `apps/api/src/db/schema.ts`.

## Backups & monitoring
- Backup: nightly `sqlite3 .backup` to durable storage (SQLite is a single file while WAL is checkpointed).
- Logs: structured JSON on stdout — ship to your aggregator; `request` lines include `reqId`, `userId`, `status`, `durationMs`.
- Health: `GET /api/health`.

## Rollback
Deploy previous tag; migrations are forward-only — if a rollback needs an older schema, restore the DB backup taken before the deploy.

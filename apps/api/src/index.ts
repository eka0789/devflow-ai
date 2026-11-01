/**
 * DevFlow AI API server entrypoint.
 * Opens the database, applies migrations, repairs stale in-flight records
 * left by previous processes, then starts listening.
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { config } from './config.js';
import { logger, setLogLevel } from './util/logger.js';
import { openDatabase, getDb } from './db/database.js';
import { runMigrations } from './db/schema.js';
import { createApp } from './app.js';
import { nowIso } from './db/database.js';

setLogLevel(config.logLevel);
logger.info('starting devflow-ai api', {
  port: config.port,
  db: config.dbPath,
  ephemeralSecret: config.appSecretEphemeral,
  webhookSecretConfigured: config.webhookSecret != null,
  envAIConfigured: config.envAI != null,
});

const db = openDatabase(config.dbPath);
runMigrations(db);

// repair stale in-flight records (process restarts)
const staleRuns = db
  .prepare("UPDATE agent_runs SET status = 'failed', error = 'interrupted by server restart', finished_at = ? WHERE status = 'running'")
  .run(nowIso());
const staleExecs = db
  .prepare("UPDATE executions SET status = 'failed', error = 'interrupted by server restart', finished_at = ?, updated_at = ? WHERE status IN ('queued','running')")
  .run(nowIso(), nowIso());
if (Number(staleRuns.changes) + Number(staleExecs.changes) > 0) {
  logger.warn('repaired stale records after restart', {
    agentRuns: staleRuns.changes,
    executions: staleExecs.changes,
  });
}

// sweep orphaned execution temp workspaces from previous runs (process kill/OOM)
try {
  const tmp = tmpdir();
  const cutoff = Date.now() - 24 * 60 * 60 * 1000;
  for (const entry of readdirSync(tmp)) {
    if (entry.startsWith('devflow-clone-') || entry.startsWith('devflow-run-')) {
      const full = join(tmp, entry);
      try {
        if (statSync(full).mtimeMs < cutoff) {
          rmSync(full, { recursive: true, force: true });
          logger.info('swept stale execution workspace', { dir: entry });
        }
      } catch {
        // per-entry failures are non-fatal
      }
    }
  }
} catch {
  // tmpdir sweep is best-effort
}

const app = createApp();

const server = app.listen(config.port, () => {
  logger.info(`devflow-ai api listening on http://localhost:${config.port}`);
  void getDb(); // ensure connection is warm
});

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    logger.info(`${signal} received — shutting down`);
    server.close(() => process.exit(0));
    setTimeout(() => process.exit(0), 3000).unref();
  });
}

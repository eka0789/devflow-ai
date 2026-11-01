/**
 * GitHub webhook receiver: HMAC-SHA256 signature validation, delivery
 * deduplication, and event → activity/notification mapping.
 */
import { createHmac, timingSafeEqual } from 'node:crypto';
import { getDb, newId, nowIso } from '../../db/database.js';
import { config } from '../../config.js';
import { recordActivity, notify } from '../events.service.js';
import { logger } from '../../util/logger.js';

export function verifySignature(rawBody: string, signature: string | undefined): boolean {
  if (!config.webhookSecret) return false;
  if (!signature || !signature.startsWith('sha256=')) return false;
  const expected = createHmac('sha256', config.webhookSecret).update(rawBody, 'utf8').digest('hex');
  const given = signature.slice('sha256='.length);
  const a = Buffer.from(expected, 'hex');
  const b = Buffer.from(given, 'hex');
  return a.length === b.length && timingSafeEqual(a, b);
}

interface WebhookRow {
  id: string;
  delivery_id: string;
  project_id: string | null;
  event: string;
  payload: string;
  processed_at: string | null;
}

function findProjectByRepo(fullName: string): { id: string; owner_user_id: string } | null {
  const row = getDb()
    .prepare('SELECT id, owner_user_id FROM projects WHERE repo_full_name = ?')
    .get(fullName) as { id: string; owner_user_id: string } | undefined;
  return row ?? null;
}

export function processWebhook(event: string, deliveryId: string, payload: unknown): { ok: boolean; note: string } {
  const db = getDb();

  // dedupe by delivery id
  try {
    db.prepare(
      'INSERT INTO webhook_events (id, delivery_id, project_id, event, payload, processed_at) VALUES (?, ?, NULL, ?, ?, ?)'
    ).run(newId(), deliveryId, event, JSON.stringify(payload).slice(0, 200000), nowIso());
  } catch {
    return { ok: true, note: 'duplicate delivery ignored' };
  }

  try {
    applyEvent(event, payload);
  } catch (err) {
    logger.warn('webhook processing failed', { event, err: err instanceof Error ? err.message : String(err) });
  }
  db.prepare('UPDATE webhook_events SET processed_at = ? WHERE delivery_id = ?').run(nowIso(), deliveryId);
  return { ok: true, note: 'processed' };
}

function applyEvent(event: string, payload: unknown): void {
  const p = payload as {
    repository?: { full_name?: string };
    action?: string;
    pull_request?: { number: number; title: string; merged: boolean; html_url: string; state: string };
    commits?: Array<{ message: string }>;
    ref?: string;
    pusher?: { name?: string };
  };
  const repo = p.repository?.full_name;
  if (!repo) return;
  const project = findProjectByRepo(repo);
  if (!project) return;

  if (event === 'push' && Array.isArray(p.commits)) {
    const count = p.commits.length;
    recordActivity(project.id, null, 'github.push', `${count} commit(s) pushed to ${p.ref?.replace('refs/heads/', '') ?? 'repository'}`);
  } else if (event === 'pull_request' && p.pull_request && p.action) {
    const pr = p.pull_request;
    recordActivity(project.id, null, 'github.pull_request', `PR #${pr.number} "${pr.title}" ${p.action}`);
    if (p.action === 'opened') {
      notify(project.owner_user_id, 'github.pr_opened', 'Pull request opened', `PR #${pr.number} "${pr.title}" was opened on ${repo}.`);
    } else if (p.action === 'closed' && pr.merged) {
      notify(project.owner_user_id, 'github.pr_merged', 'Pull request merged', `PR #${pr.number} "${pr.title}" was merged into ${repo}.`);
    }
  } else if (event === 'issues' && p.action) {
    recordActivity(project.id, null, 'github.issue', `Issue ${p.action}`);
  }
}

export function recentWebhookEvents(limit: number): Array<{ id: string; event: string; deliveryId: string; processedAt: string | null }> {
  const rows = getDb()
    .prepare('SELECT * FROM webhook_events ORDER BY rowid DESC LIMIT ?')
    .all(limit) as unknown as WebhookRow[];
  return rows.map((r) => ({ id: r.id, event: r.event, deliveryId: r.delivery_id, processedAt: r.processed_at }));
}

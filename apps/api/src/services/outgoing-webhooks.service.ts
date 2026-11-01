/** Outgoing webhooks — user-configured notification fan-out (generic/Slack/Discord). */
import { createHmac } from 'node:crypto';
import { getDb, newId, nowIso } from '../db/database.js';
import { config } from '../config.js';
import { decryptSecret, encryptSecret } from '../util/crypto.js';
import { logger } from '../util/logger.js';
import type { OutgoingWebhook, OutgoingWebhookFormat } from '@devflow/shared';

interface WebhookRow {
  id: string;
  user_id: string;
  url: string;
  secret_enc: string | null;
  format: string;
  events: string;
  active: number;
  created_at: string;
}

function toWebhook(row: WebhookRow): OutgoingWebhook {
  return {
    id: row.id,
    userId: row.user_id,
    url: row.url,
    format: row.format as OutgoingWebhookFormat,
    events: JSON.parse(row.events) as string[],
    active: row.active === 1,
    createdAt: row.created_at,
  };
}

export function listWebhooks(userId: string): OutgoingWebhook[] {
  const rows = getDb()
    .prepare('SELECT * FROM outgoing_webhooks WHERE user_id = ? ORDER BY created_at DESC')
    .all(userId) as unknown as WebhookRow[];
  return rows.map(toWebhook);
}

export function createWebhook(
  userId: string,
  input: { url: string; format: OutgoingWebhookFormat; events: string[]; secret?: string }
): OutgoingWebhook {
  const id = newId();
  getDb()
    .prepare(
      'INSERT INTO outgoing_webhooks (id, user_id, url, secret_enc, format, events, active, created_at) VALUES (?, ?, ?, ?, ?, ?, 1, ?)'
    )
    .run(
      id,
      userId,
      input.url,
      input.secret ? encryptSecret(input.secret, config.appSecret) : null,
      input.format,
      JSON.stringify(input.events),
      nowIso()
    );
  return toWebhook(getDb().prepare('SELECT * FROM outgoing_webhooks WHERE id = ?').get(id) as unknown as WebhookRow);
}

export function updateWebhook(
  userId: string,
  id: string,
  input: { active?: boolean; events?: string[] }
): OutgoingWebhook {
  const row = getDb().prepare('SELECT * FROM outgoing_webhooks WHERE id = ? AND user_id = ?').get(id, userId) as
    | WebhookRow
    | undefined;
  if (!row) throw new Error('Webhook not found');
  getDb()
    .prepare('UPDATE outgoing_webhooks SET active = ?, events = ? WHERE id = ?')
    .run((input.active ?? row.active === 1) ? 1 : 0, JSON.stringify(input.events ?? (JSON.parse(row.events) as string[])), id);
  return toWebhook(getDb().prepare('SELECT * FROM outgoing_webhooks WHERE id = ?').get(id) as unknown as WebhookRow);
}

export function deleteWebhook(userId: string, id: string): void {
  const res = getDb().prepare('DELETE FROM outgoing_webhooks WHERE id = ? AND user_id = ?').run(id, userId);
  if (res.changes === 0) throw new Error('Webhook not found');
}

function formatPayload(
  format: OutgoingWebhookFormat,
  event: string,
  title: string,
  body: string
): Record<string, unknown> {
  switch (format) {
    case 'discord':
      return { content: `**${title}**\n${body}`.slice(0, 1900) };
    case 'slack':
      return { text: `*${title}*\n${body}`.slice(0, 1900) };
    default:
      return { type: event, title, body, timestamp: nowIso() };
  }
}

/** Sends a test ping so users can verify the endpoint from Settings. */
export async function testWebhook(userId: string, id: string): Promise<{ ok: boolean; status?: number; error?: string }> {
  const row = getDb().prepare('SELECT * FROM outgoing_webhooks WHERE id = ? AND user_id = ?').get(id, userId) as
    | WebhookRow
    | undefined;
  if (!row) throw new Error('Webhook not found');
  const secret = row.secret_enc ? decryptSecret(row.secret_enc, config.appSecret) : null;
  return postToEndpoint(row.url, row.format as OutgoingWebhookFormat, 'webhook.test', 'DevFlow AI test ping', 'If you can read this, the webhook works.', secret);
}

async function postToEndpoint(
  url: string,
  format: OutgoingWebhookFormat,
  event: string,
  title: string,
  body: string,
  secret: string | null
): Promise<{ ok: boolean; status?: number; error?: string }> {
  const payload = formatPayload(format, event, title, body);
  const raw = JSON.stringify(payload);
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), 10000);
  try {
    const headers: Record<string, string> = {
      'Content-Type': 'application/json',
      'X-DevFlow-Event': event,
    };
    if (secret) {
      headers['X-DevFlow-Signature'] = `sha256=${createHmac('sha256', secret).update(raw, 'utf8').digest('hex')}`;
    }
    const res = await fetch(url, { method: 'POST', headers, body: raw, signal: controller.signal });
    return { ok: res.ok, status: res.status };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : String(err) };
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Fire-and-forget fan-out for notification events. Called from events.notify();
 * never throws into the caller's flow.
 */
export function deliverEvent(userId: string, event: string, title: string, body: string): void {
  void (async () => {
    let rows: WebhookRow[] = [];
    try {
      rows = getDb()
        .prepare('SELECT * FROM outgoing_webhooks WHERE user_id = ? AND active = 1')
        .all(userId) as unknown as WebhookRow[];
    } catch {
      return;
    }
    for (const row of rows) {
      let events: string[] = [];
      try {
        events = JSON.parse(row.events) as string[];
      } catch {
        events = ['*'];
      }
      if (!events.includes('*') && !events.includes(event)) continue;
      const secret = row.secret_enc ? decryptSecret(row.secret_enc, config.appSecret) : null;
      const result = await postToEndpoint(
        row.url,
        row.format as OutgoingWebhookFormat,
        event,
        title,
        body,
        secret
      );
      if (!result.ok) {
        logger.warn('outgoing webhook delivery failed', { webhookId: row.id, event, status: result.status, error: result.error });
      }
    }
  })().catch((err) => {
    logger.warn('outgoing webhook fan-out crashed', { err: err instanceof Error ? err.message : String(err) });
  });
}

/** Cross-cutting event helpers: activity feed, notifications, audit log, usage metering. */
import { getDb, newId, nowIso } from '../db/database.js';
import type { Notification } from '@devflow/shared';

export function recordActivity(
  projectId: string,
  userId: string | null,
  type: string,
  message: string
): void {
  getDb()
    .prepare(
      'INSERT INTO activities (id, project_id, user_id, type, message, created_at) VALUES (?, ?, ?, ?, ?, ?)'
    )
    .run(newId(), projectId, userId, type, message, nowIso());
}

export function recordAudit(
  userId: string,
  action: string,
  targetType: string,
  targetId: string,
  meta: Record<string, unknown> = {}
): void {
  getDb()
    .prepare(
      'INSERT INTO audit_log (id, user_id, action, target_type, target_id, meta, created_at) VALUES (?, ?, ?, ?, ?, ?, ?)'
    )
    .run(newId(), userId, action, targetType, targetId, JSON.stringify(meta), nowIso());
}

/** Single metering path for AI token usage (chat | agent | execution). */
export type UsageKind = 'chat' | 'agent' | 'execution';

export function recordUsage(
  userId: string,
  projectId: string | null,
  kind: UsageKind,
  model: string,
  tokensIn: number,
  tokensOut: number
): void {
  getDb()
    .prepare(
      'INSERT INTO usage_events (id, user_id, project_id, kind, model, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
    )
    .run(newId(), userId, projectId, kind, model, tokensIn, tokensOut, nowIso());
}

export function listNotifications(userId: string, limit: number): Notification[] {
  const rows = getDb()
    .prepare('SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(userId, limit) as unknown as Array<{
    id: string;
    user_id: string;
    type: string;
    title: string;
    body: string;
    read: number;
    created_at: string;
  }>;
  return rows.map((r) => ({
    id: r.id,
    userId: r.user_id,
    type: r.type,
    title: r.title,
    body: r.body,
    read: r.read === 1,
    createdAt: r.created_at,
  }));
}

export function markNotificationRead(userId: string, notificationId: string): void {
  getDb().prepare('UPDATE notifications SET read = 1 WHERE id = ? AND user_id = ?').run(notificationId, userId);
}

export function markAllNotificationsRead(userId: string): void {
  getDb().prepare('UPDATE notifications SET read = 1 WHERE user_id = ?').run(userId);
}

export function notify(
  userId: string,
  type: string,
  title: string,
  body: string
): void {
  getDb()
    .prepare(
      'INSERT INTO notifications (id, user_id, type, title, body, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)'
    )
    .run(newId(), userId, type, title, body, nowIso());
}

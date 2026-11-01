/** Cross-cutting event helpers: activity feed, notifications, audit log. */
import { getDb, newId, nowIso } from '../db/database.js';

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

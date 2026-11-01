/** Analytics computed from real application data (no hardcoded numbers). */
import { getDb } from '../db/database.js';
import { requireProject } from './projects.service.js';
import { getVelocity, computeSprintMetrics } from './sprints.service.js';
import type {
  AIUsageStats,
  DashboardStats,
  ExecutionStats,
  SprintMetrics,
} from '@devflow/shared';

function countRow(sql: string, ...params: (string | number)[]): number {
  const row = getDb().prepare(sql).get(...params) as { c: number };
  return row.c;
}

function monthStart(): string {
  const d = new Date();
  return new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), 1)).toISOString();
}

export function getDashboardStats(userId: string): DashboardStats {
  const db = getDb();
  const month = monthStart();

  const projects = db
    .prepare("SELECT id FROM projects WHERE owner_user_id = ? AND status != 'archived'")
    .all(userId) as Array<{ id: string }>;
  const projectIds = projects.map((p) => p.id);

  let openStories = 0;
  let doneStories = 0;
  let openTasks = 0;
  let activeSprints = 0;
  for (const pid of projectIds) {
    openStories += countRow(
      "SELECT COUNT(*) AS c FROM stories WHERE project_id = ? AND status NOT IN ('done', 'cancelled')",
      pid
    );
    doneStories += countRow(
      "SELECT COUNT(*) AS c FROM stories WHERE project_id = ? AND status = 'done'",
      pid
    );
    openTasks += countRow(
      "SELECT COUNT(*) AS c FROM tasks WHERE project_id = ? AND status NOT IN ('done', 'cancelled')",
      pid
    );
    activeSprints += countRow(
      "SELECT COUNT(*) AS c FROM sprints WHERE project_id = ? AND status = 'active'",
      pid
    );
  }

  const placeholders = projectIds.length > 0 ? `(${projectIds.map(() => '?').join(',')})` : '(NULL)';
  const executionsThisMonth = countRow(
    `SELECT COUNT(*) AS c FROM executions WHERE project_id IN ${placeholders} AND created_at >= ?`,
    ...projectIds,
    month
  );
  const tokens = db
    .prepare('SELECT COALESCE(SUM(tokens_in + tokens_out), 0) AS c FROM usage_events WHERE user_id = ? AND created_at >= ?')
    .get(userId, month) as { c: number };
  // delivery-based approximation: opened minus closed pull_request events
  // (webhook deliveries now carry project_id, populated by the webhook receiver)
  const prOpened = countRow(
    `SELECT COUNT(*) AS c FROM webhook_events WHERE project_id IN ${placeholders} AND event = 'pull_request' AND payload LIKE '%"action":"opened"%'`,
    ...projectIds
  );
  const prClosed = countRow(
    `SELECT COUNT(*) AS c FROM webhook_events WHERE project_id IN ${placeholders} AND event = 'pull_request' AND payload LIKE '%"action":"closed"%'`,
    ...projectIds
  );
  const prsOpen = Math.max(0, prOpened - prClosed);

  return {
    projectsTotal: projectIds.length,
    projectsActive: countRow(
      "SELECT COUNT(*) AS c FROM projects WHERE owner_user_id = ? AND status = 'active'",
      userId
    ),
    openStories,
    doneStories,
    openTasks,
    activeSprints,
    executionsThisMonth,
    tokensThisMonth: tokens.c,
    prsOpen,
  };
}

export function getAIUsage(userId: string, days: number): AIUsageStats {
  const since = new Date(Date.now() - days * 86400000).toISOString();
  const db = getDb();
  const totals = db
    .prepare(
      'SELECT COALESCE(SUM(tokens_in),0) AS ti, COALESCE(SUM(tokens_out),0) AS to_, COUNT(*) AS c FROM usage_events WHERE user_id = ? AND created_at >= ?'
    )
    .get(userId, since) as { ti: number; to_: number; c: number };
  const byDayRows = db
    .prepare(
      `SELECT substr(created_at, 1, 10) AS day, COALESCE(SUM(tokens_in + tokens_out),0) AS tokens, COUNT(*) AS requests
       FROM usage_events WHERE user_id = ? AND created_at >= ? GROUP BY day ORDER BY day`
    )
    .all(userId, since) as Array<{ day: string; tokens: number; requests: number }>;

  return {
    tokensIn: totals.ti,
    tokensOut: totals.to_,
    requests: totals.c,
    byDay: byDayRows.map((r) => ({ date: r.day, tokens: r.tokens, requests: r.requests })),
  };
}

export function getExecutionStats(userId: string, projectId: string | null): ExecutionStats {
  const db = getDb();
  // ownership: foreign project ids are rejected, never silently scoped
  if (projectId) requireProject(projectId, userId);
  const scope = projectId ? 'AND e.project_id = ?' : 'AND p.owner_user_id = ?';
  const scopeParam = projectId ?? userId;

  const totals = db
    .prepare(
      `SELECT COUNT(*) AS total,
              SUM(CASE WHEN e.status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded,
              SUM(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) AS failed,
              SUM(CASE WHEN e.status IN ('queued','running','awaiting_review') THEN 1 ELSE 0 END) AS inFlight
       FROM executions e JOIN projects p ON p.id = e.project_id WHERE 1=1 ${scope}`
    )
    .get(scopeParam) as { total: number; succeeded: number | null; failed: number | null; inFlight: number | null };

  const byDay = db
    .prepare(
      `SELECT substr(e.created_at, 1, 10) AS day, COUNT(*) AS total,
              SUM(CASE WHEN e.status = 'failed' THEN 1 ELSE 0 END) AS failed
       FROM executions e JOIN projects p ON p.id = e.project_id
       WHERE 1=1 ${scope} AND e.created_at >= ?
       GROUP BY day ORDER BY day LIMIT 60`
    )
    .all(scopeParam, new Date(Date.now() - 30 * 86400000).toISOString()) as Array<{ day: string; total: number; failed: number }>;

  return {
    total: totals.total,
    succeeded: totals.succeeded ?? 0,
    failed: totals.failed ?? 0,
    awaitingReview: totals.inFlight ?? 0,
    byDay: byDay.map((r) => ({ date: r.day, total: r.total, failed: r.failed })),
  };
}

export function getProjectAnalytics(
  projectId: string,
  userId: string
): { velocity: ReturnType<typeof getVelocity>; activeSprint: SprintMetrics | null } {
  requireProject(projectId, userId);
  const db = getDb();
  const active = db
    .prepare("SELECT * FROM sprints WHERE project_id = ? AND status = 'active' LIMIT 1")
    .get(projectId) as unknown as Parameters<typeof computeSprintMetrics>[0] | undefined;
  return {
    velocity: getVelocity(projectId, userId),
    activeSprint: active ? computeSprintMetrics(active) : null,
  };
}

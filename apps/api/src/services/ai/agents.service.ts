/**
 * Multi-agent orchestration: agent registry, planning workflows with strict
 * step limits, validated structured outputs, and draft persistence.
 *
 * Guards: max 3 steps per workflow, per-step timeout, one running workflow
 * per project, outputs always saved as drafts requiring human approval.
 */
import { z } from 'zod';
import { getDb, newId, nowIso } from '../../db/database.js';
import { AppError } from '../../util/appError.js';
import { ErrorCodes } from '@devflow/shared';
import { estimateTokens, MockProvider, OpenAICompatibleProvider, type AIProvider, type ChatRequest } from './provider.js';
import { resolveAI } from '../settings.service.js';
import { recordActivity, notify, recordUsage } from '../events.service.js';
import { createDraft } from '../drafts.service.js';
import { readSprintSnapshot } from '../mappers.js';
import type { DraftType } from '@devflow/shared';
import { requireProject } from '../projects.service.js';
import { logger } from '../../util/logger.js';
import type { AgentRun } from '@devflow/shared';

// ---------- agent registry ----------

export interface AgentDescriptor {
  role: string;
  name: string;
  description: string;
  system: string;
}

const BASE_RULES = [
  'You are part of DevFlow AI, a software engineering workspace.',
  'Be concrete and actionable. No filler. Respect the project vision.',
  'Never invent requirements that contradict the vision.',
].join(' ');

export const AGENTS: Record<string, AgentDescriptor> = {
  product_manager: {
    role: 'product_manager',
    name: 'Product Manager',
    description: 'Turns the vision into a Product Requirements Document.',
    system: `${BASE_RULES} You are a Principal Product Manager. Write a tight PRD in markdown with sections: Vision, Problem, Goals, Non-goals, Users, Scope (must-have / should-have), Success metrics.`,
  },
  architect: {
    role: 'architect',
    name: 'System Architect',
    description: 'Produces a technical architecture and milestone plan.',
    system: `${BASE_RULES} You are a Principal Software Architect. Write a technical plan in markdown with sections: Architecture overview, Components, Data model outline, API surface outline, Key risks, Milestones (numbered, each with scope summary).`,
  },
  scrum_master: {
    role: 'scrum_master',
    name: 'Scrum Master',
    description: 'Breaks the plan into epics, stories and tasks (strict JSON).',
    system: `${BASE_RULES} You are a Scrum Master. You MUST respond with ONLY a JSON object, no markdown fences, no commentary, matching exactly:
{"epics":[{"title":string,"description":string,"stories":[{"title":string,"description":string,"points":number,"priority":"low"|"medium"|"high"|"critical","acceptanceCriteria":string[],"dependencies":string[],"tasks":[{"title":string,"description":string,"subtasks":string[]}]}]}]}
Rules: points in {1,2,3,5,8,13}; every story has 1-6 tasks; "dependencies" lists titles of prerequisite stories (may be empty); produce 2-4 epics with 2-5 stories each.`,
  },
  developer: {
    role: 'developer',
    name: 'Developer',
    description: 'Implements task scope as code changes.',
    system: `${BASE_RULES} You are a Senior Software Engineer. Implement ONLY the given task scope. Respect existing conventions. Never touch unrelated files.`,
  },
  code_reviewer: {
    role: 'code_reviewer',
    name: 'Code Reviewer',
    description: 'Reviews changes for correctness, security and scope.',
    system: `${BASE_RULES} You are a Staff Code Reviewer. Evaluate correctness, security, maintainability, performance, test coverage and scope compliance. Be specific.`,
  },
  qa_engineer: {
    role: 'qa_engineer',
    name: 'QA Engineer',
    description: 'Validates acceptance criteria.',
    system: `${BASE_RULES} You are a QA Engineer. Map each acceptance criterion to a verification approach and verdict.`,
  },
  technical_writer: {
    role: 'technical_writer',
    name: 'Technical Writer',
    description: 'Writes and improves documentation.',
    system: `${BASE_RULES} You are a Technical Writer. Produce clear, structured documentation in markdown.`,
  },
};

export function listAgents(): Array<{ role: string; name: string; description: string }> {
  return Object.values(AGENTS).map(({ role, name, description }) => ({ role, name, description }));
}

// ---------- structured output schema ----------
// the contract itself lives in @devflow/shared (single source of truth)
import { backlogProposalSchema } from '@devflow/shared';
export { backlogProposalSchema };

function parseJsonLoose(raw: string): unknown {
  let text = raw.trim();
  const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
  if (fence) text = fence[1]!.trim();
  const firstBrace = text.indexOf('{');
  const lastBrace = text.lastIndexOf('}');
  if (firstBrace > 0 || lastBrace < text.length - 1) {
    if (firstBrace >= 0 && lastBrace > firstBrace) text = text.slice(firstBrace, lastBrace + 1);
  }
  return JSON.parse(text);
}

// ---------- workflow runner ----------

export type WorkflowId = 'full_planning' | 'prd_only' | 'tech_plan_only' | 'backlog_only' | 'sprint_review';

interface WorkflowSpec {
  steps: Array<{ agent: string; action: string; mockKind: 'prd' | 'tech_plan' | 'backlog' | 'sprint_review' }>;
  draftType: 'prd' | 'tech_plan' | 'backlog' | 'sprint_review';
}

const WORKFLOWS: Record<WorkflowId, WorkflowSpec> = {
  full_planning: {
    steps: [
      { agent: 'product_manager', action: 'Draft PRD from vision', mockKind: 'prd' },
      { agent: 'architect', action: 'Derive technical plan from PRD', mockKind: 'tech_plan' },
      { agent: 'scrum_master', action: 'Generate backlog proposal from PRD + plan', mockKind: 'backlog' },
    ],
    draftType: 'backlog',
  },
  prd_only: { steps: [{ agent: 'product_manager', action: 'Draft PRD from vision', mockKind: 'prd' }], draftType: 'prd' },
  tech_plan_only: { steps: [{ agent: 'architect', action: 'Derive technical plan from vision', mockKind: 'tech_plan' }], draftType: 'tech_plan' },
  backlog_only: { steps: [{ agent: 'scrum_master', action: 'Generate backlog proposal from vision', mockKind: 'backlog' }], draftType: 'backlog' },
  sprint_review: {
    steps: [{ agent: 'technical_writer', action: 'Generate sprint review & retrospective from real metrics', mockKind: 'sprint_review' }],
    draftType: 'sprint_review',
  },
};

const MAX_STEPS = 4;
const STEP_TIMEOUT_MS = 180000;

interface RunRow {
  id: string;
  project_id: string;
  user_id: string;
  workflow: string;
  status: string;
  steps: string;
  tokens_in: number;
  tokens_out: number;
}

function getRunRow(runId: string): RunRow {
  const row = getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(runId) as unknown as unknown as RunRow | undefined;
  if (!row) throw AppError.notFound('Agent run');
  return row;
}

/**
 * Sprint review & retrospective grounded in the completed sprint's frozen
 * metrics snapshot plus execution outcomes during the sprint window.
 */
export function startSprintReview(projectId: string, sprintId: string, userId: string): AgentRun {
  requireProject(projectId, userId);
  const db = getDb();
  const sprint = db
    .prepare('SELECT * FROM sprints WHERE id = ? AND project_id = ?')
    .get(sprintId, projectId) as
    | { id: string; name: string; goal: string; status: string; completed_at: string | null; starts_at: string | null; metrics_snapshot: string | null }
    | undefined;
  if (!sprint) throw AppError.notFound('Sprint');
  if (sprint.status !== 'completed') {
    throw AppError.conflict(ErrorCodes.CONFLICT, 'Sprint reviews are generated for completed sprints only');
  }

  // stories carried over at completion are visible as backlog transitions in the window
  const carriedOver = (
    db
      .prepare(
        "SELECT COUNT(*) AS c FROM status_events WHERE project_id = ? AND entity_type = 'story' AND to_status = 'backlog' AND created_at >= COALESCE(?, '1970-01-01') AND created_at <= COALESCE(?, '9999-12-31')"
      )
      .get(projectId, sprint.starts_at, sprint.completed_at) as { c: number }
  ).c;

  const snap = readSprintSnapshot(sprint);
  const metrics = {
    totalPoints: snap?.totalPoints ?? 0,
    donePoints: snap?.donePoints ?? 0,
    completionRate: snap?.completionRate ?? 0,
    totalStories: snap?.totalStories ?? 0,
    doneStories: snap?.doneStories ?? 0,
  };

  const executions = db
    .prepare(
      "SELECT COUNT(*) AS total, SUM(CASE WHEN status = 'succeeded' THEN 1 ELSE 0 END) AS succeeded, SUM(CASE WHEN status = 'failed' THEN 1 ELSE 0 END) AS failed FROM executions WHERE project_id = ? AND created_at >= COALESCE(?, '1970-01-01') AND created_at <= COALESCE(?, '9999-12-31')"
    )
    .get(projectId, sprint.starts_at, sprint.completed_at) as { total: number; succeeded: number | null; failed: number | null };

  const vision = [
    'Sprint: "' + sprint.name + '"' + (sprint.goal ? ' — goal: ' + sprint.goal : ''),
    'Window: ' + (sprint.starts_at ?? 'unknown') + ' → ' + (sprint.completed_at ?? 'now'),
    'Committed: ' + metrics.totalPoints + ' pts across ' + metrics.totalStories + ' stories',
    'Completed: ' + metrics.donePoints + ' pts across ' + metrics.doneStories + ' stories (' + metrics.completionRate + '% completion)',
    'Stories carried over to the next sprint: ' + carriedOver,
    'AI executions during the sprint: ' + executions.total + ' total (' + (executions.succeeded ?? 0) + ' succeeded, ' + (executions.failed ?? 0) + ' failed)',
  ].join('\n');

  return startWorkflow(projectId, userId, 'sprint_review', vision);
}

/** A2: run reads live in the domain module, not in routes. */
export function getAgentRun(projectId: string, userId: string, runId: string): AgentRun {
  requireProject(projectId, userId);
  const row = getDb()
    .prepare('SELECT * FROM agent_runs WHERE id = ? AND project_id = ? AND user_id = ?')
    .get(runId, projectId, userId) as Record<string, unknown> | undefined;
  if (!row) throw AppError.notFound('Agent run');
  return serializeRun(row);
}

export function listAgentRuns(projectId: string, userId: string, limit: number): AgentRun[] {
  requireProject(projectId, userId);
  const rows = getDb()
    .prepare('SELECT * FROM agent_runs WHERE project_id = ? AND user_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, userId, limit) as Array<Record<string, unknown>>;
  return rows.map(serializeRun);
}

/** DB row (or generic record) → AgentRun API shape. */
export function serializeRun(row: Record<string, unknown>): AgentRun {
  return {
    id: String(row.id),
    projectId: String(row.project_id),
    userId: String(row.user_id),
    workflow: String(row.workflow),
    status: String(row.status) as AgentRun['status'],
    steps: JSON.parse(String(row.steps ?? '[]')) as AgentRun['steps'],
    tokensIn: Number(row.tokens_in ?? 0),
    tokensOut: Number(row.tokens_out ?? 0),
    error: (row.error as string | null) ?? null,
    createdAt: String(row.created_at),
    finishedAt: (row.finished_at as string | null) ?? null,
  };
}

export function startWorkflow(
  projectId: string,
  userId: string,
  workflow: WorkflowId,
  vision: string
): AgentRun {
  requireProject(projectId, userId);
  const db = getDb();
  const running = db
    .prepare("SELECT id FROM agent_runs WHERE project_id = ? AND status = 'running'")
    .get(projectId) as { id: string } | undefined;
  if (running) {
    throw AppError.conflict(ErrorCodes.CONFLICT, 'A planning workflow is already running for this project');
  }

  const id = newId();
  db.prepare(
    "INSERT INTO agent_runs (id, project_id, user_id, workflow, status, steps, created_at) VALUES (?, ?, ?, ?, 'running', '[]', ?)"
  ).run(id, projectId, userId, workflow, nowIso());

  // fire-and-forget with explicit error capture; route returns the run immediately
  void executeWorkflow(id, projectId, userId, workflow, vision).catch((err) => {
    logger.error('workflow crashed', { runId: id, err: err instanceof Error ? err.stack : String(err) });
    db.prepare("UPDATE agent_runs SET status = 'failed', error = ?, finished_at = ? WHERE id = ?").run(
      err instanceof Error ? err.message : String(err),
      nowIso(),
      id
    );
  });

  return serializeRun(getRunRow(id) as unknown as Record<string, unknown>);
}

async function executeWorkflow(
  runId: string,
  projectId: string,
  userId: string,
  workflow: WorkflowId,
  vision: string
): Promise<void> {
  const db = getDb();
  const spec = WORKFLOWS[workflow];
  if (!spec || spec.steps.length > MAX_STEPS) {
    db.prepare("UPDATE agent_runs SET status = 'failed', error = 'Unknown workflow', finished_at = ? WHERE id = ?").run(nowIso(), runId);
    return;
  }

  const aiConfig = resolveAI(userId);
  const provider: AIProvider = aiConfig
    ? new OpenAICompatibleProvider(aiConfig.baseUrl, aiConfig.apiKey)
    : new MockProvider();
  const model = aiConfig?.model ?? 'mock-1';
  const projectName = (
    db.prepare('SELECT name FROM projects WHERE id = ?').get(projectId) as { name: string }
  ).name;

  const steps: Array<{
    agent: string;
    action: string;
    status: 'ok' | 'failed' | 'skipped';
    tokensIn: number;
    tokensOut: number;
    detail: string;
    durationMs: number;
  }> = [];
  let tokensIn = 0;
  let tokensOut = 0;
  let prdContent = '';
  let planContent = '';
  let reviewContent = '';
  let backlogJson = '';
  let failed = false;
  let errorMessage: string | null = null;

  for (const step of spec.steps) {
    const startedAt = Date.now();
    const agent = AGENTS[step.agent]!;
    try {
      const messages: ChatRequest['messages'] = [
        { role: 'system', content: agent.system },
      ];
      let userPrompt = `Project: ${projectName}\n\nVision from the user:\n${vision}`;
      if (step.mockKind === 'tech_plan' && prdContent) {
        userPrompt += `\n\nApproved PRD context:\n${prdContent.slice(0, 8000)}`;
      }
      if (step.mockKind === 'backlog') {
        userPrompt += `\n\n${prdContent ? `PRD:\n${prdContent.slice(0, 6000)}\n\n` : ''}${planContent ? `Technical plan:\n${planContent.slice(0, 6000)}` : ''}`;
      }
      if (step.mockKind === 'sprint_review') {
        // userPrompt already carries the rendered sprint metrics from startSprintReview
        userPrompt += 'Produce a sprint review (what was delivered, demo notes) and a retrospective (what went well, what to improve, concrete actions) as two markdown sections.';
      }
      messages.push({ role: 'user', content: userPrompt });

      const result = await provider.complete(
        { messages, model, temperature: 0.3, maxTokens: 6000, mockKind: step.mockKind },
        STEP_TIMEOUT_MS
      );
      tokensIn += result.tokensIn;
      tokensOut += result.tokensOut;
      recordUsage(userId, projectId, 'agent', model, result.tokensIn, result.tokensOut);

      let detail = '';
      if (step.mockKind === 'prd') {
        prdContent = result.content;
        detail = `${estimateTokens(prdContent)} tokens of PRD drafted`;
      } else if (step.mockKind === 'tech_plan') {
        planContent = result.content;
        detail = 'Technical plan drafted';
      } else if (step.mockKind === 'sprint_review') {
        reviewContent = result.content;
        detail = 'Sprint review & retrospective drafted';
      } else {
        const parsed = backlogProposalSchema.safeParse(parseJsonLoose(result.content));
        if (!parsed.success) {
          throw new AppError(502, ErrorCodes.AI_BAD_RESPONSE, `Backlog JSON failed validation: ${parsed.error.issues[0]?.message ?? 'invalid structure'}`);
        }
        backlogJson = JSON.stringify(parsed.data);
        const storyCount = parsed.data.epics.reduce((n, e) => n + e.stories.length, 0);
        detail = `Proposal: ${parsed.data.epics.length} epics, ${storyCount} stories`;
      }

      steps.push({ agent: step.agent, action: step.action, status: 'ok', tokensIn: result.tokensIn, tokensOut: result.tokensOut, detail, durationMs: Date.now() - startedAt });
    } catch (err) {
      failed = true;
      errorMessage = err instanceof Error ? err.message : String(err);
      steps.push({ agent: step.agent, action: step.action, status: 'failed', tokensIn: 0, tokensOut: 0, detail: errorMessage, durationMs: Date.now() - startedAt });
      break;
    }

    db.prepare('UPDATE agent_runs SET steps = ?, tokens_in = ?, tokens_out = ? WHERE id = ?').run(
      JSON.stringify(steps),
      tokensIn,
      tokensOut,
      runId
    );
  }

  // persist drafts for whatever completed successfully
  const drafts: Array<{ type: string; title: string; content: string }> = [];
  if (prdContent) drafts.push({ type: 'prd', title: 'Product Requirements Document', content: prdContent });
  if (planContent) drafts.push({ type: 'tech_plan', title: 'Technical Plan', content: planContent });
  if (reviewContent) drafts.push({ type: 'sprint_review', title: 'Sprint Review & Retrospective', content: reviewContent });
  if (backlogJson) drafts.push({ type: 'backlog', title: 'Backlog Proposal', content: backlogJson });

  for (const d of drafts) {
    createDraft(projectId, userId, d.type as DraftType, d.title, d.content);
  }

  db.prepare('UPDATE agent_runs SET status = ?, steps = ?, tokens_in = ?, tokens_out = ?, error = ?, finished_at = ? WHERE id = ?').run(
    failed ? 'failed' : 'succeeded',
    JSON.stringify(steps),
    tokensIn,
    tokensOut,
    errorMessage,
    nowIso(),
    runId
  );

  recordActivity(projectId, userId, 'workflow.finished', failed ? `Planning workflow failed: ${errorMessage}` : `Planning workflow completed (${drafts.length} draft(s))`);
  if (!failed && drafts.length > 0) {
    notify(userId, 'workflow.completed', 'Planning workflow finished', `${drafts.length} draft(s) are ready for your review.`);
  }
}

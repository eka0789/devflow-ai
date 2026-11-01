/**
 * Task execution pipeline (control plane).
 *
 * Flow: validate → analyze repo → AI generates changes → diff → run tests
 * (isolated container when Docker is available) → commit to a feature branch
 * → open a Pull Request → hand over to human review.
 *
 * Safety properties:
 *  - changes are never merged automatically; PRs are draft unless tests pass
 *  - untrusted code only ever runs inside the Docker executor's isolation
 *  - every step is logged and persisted so the UI can poll progress
 */
import { z } from 'zod';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync, existsSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { getDb, newId, nowIso } from '../../db/database.js';
import { AppError } from '../../util/appError.js';
import { ErrorCodes, type Execution, type ExecutionFileChange, type ExecutionStepLog } from '@devflow/shared';
import { GitHubClient } from '../github/client.js';
import { getGitHubToken, resolveAI } from '../settings.service.js';
import { requireProject } from '../projects.service.js';
import { OpenAICompatibleProvider, MockProvider, type AIProvider } from '../ai/provider.js';
import { unifiedDiff } from '../../util/diff.js';
import { isDockerAvailable, detectImage, detectTestCommand, runInContainer } from './docker.executor.js';
import { recordActivity, notify } from '../events.service.js';
import { logger } from '../../util/logger.js';

// ---------- persistence helpers ----------

interface ExecutionRow {
  id: string;
  project_id: string;
  task_id: string;
  user_id: string;
  status: string;
  mode: string;
  summary: string | null;
  branch: string | null;
  pr_number: number | null;
  pr_url: string | null;
  changes: string;
  logs: string;
  test_result: string | null;
  diff: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  finished_at: string | null;
}

function toExecution(row: ExecutionRow): Execution {
  return {
    id: row.id,
    projectId: row.project_id,
    taskId: row.task_id,
    userId: row.user_id,
    status: row.status as Execution['status'],
    mode: row.mode as Execution['mode'],
    summary: row.summary,
    branch: row.branch,
    prNumber: row.pr_number,
    prUrl: row.pr_url,
    changes: JSON.parse(row.changes) as ExecutionFileChange[],
    logs: JSON.parse(row.logs) as ExecutionStepLog[],
    testResult: row.test_result ? (JSON.parse(row.test_result) as Execution['testResult']) : null,
    error: row.error,
    createdAt: row.created_at,
    finishedAt: row.finished_at,
  };
}

function getExecutionRow(executionId: string): ExecutionRow {
  const row = getDb().prepare('SELECT * FROM executions WHERE id = ?').get(executionId) as unknown as unknown as ExecutionRow | undefined;
  if (!row) throw AppError.notFound('Execution');
  return row;
}

export function listExecutions(projectId: string, userId: string, limit: number): Execution[] {
  requireProject(projectId, userId);
  const rows = getDb()
    .prepare('SELECT * FROM executions WHERE project_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(projectId, limit) as unknown as ExecutionRow[];
  return rows.map(toExecution);
}

export function getExecution(projectId: string, executionId: string, userId: string): Execution {
  requireProject(projectId, userId);
  const row = getExecutionRow(executionId);
  if (row.project_id !== projectId) throw AppError.notFound('Execution');
  return toExecution(row);
}

export function getExecutionDiff(projectId: string, executionId: string, userId: string): string {
  requireProject(projectId, userId);
  const row = getExecutionRow(executionId);
  if (row.project_id !== projectId) throw AppError.notFound('Execution');
  return row.diff ?? '';
}

export function cancelExecution(executionId: string, userId: string): Execution {
  const row = getExecutionRow(executionId);
  requireProject(row.project_id, userId);
  if (row.status !== 'queued' && row.status !== 'running') {
    throw AppError.conflict(ErrorCodes.CONFLICT, `Execution is already ${row.status}`);
  }
  getDb().prepare("UPDATE executions SET status = 'cancelled', finished_at = ?, updated_at = ? WHERE id = ?").run(nowIso(), nowIso(), executionId);
  return toExecution(getExecutionRow(executionId));
}

// ---------- validation & start ----------

export interface StartChecks {
  ai: boolean;
  repo: boolean;
  githubToken: boolean;
  taskStatus: boolean;
  noInFlight: boolean;
}

export function precheckTaskExecution(taskId: string, userId: string): { projectId: string; checks: StartChecks } {
  const db = getDb();
  const task = db
    .prepare(
      `SELECT t.id, t.status, t.project_id, p.owner_user_id, p.repo_full_name, p.repo_default_branch
       FROM tasks t JOIN projects p ON p.id = t.project_id WHERE t.id = ?`
    )
    .get(taskId) as { id: string; status: string; project_id: string; owner_user_id: string; repo_full_name: string | null; repo_default_branch: string | null } | undefined;
  if (!task || task.owner_user_id !== userId) throw AppError.notFound('Task');

  const checks: StartChecks = {
    ai: resolveAI(userId) !== null,
    repo: task.repo_full_name != null,
    githubToken: getGitHubToken(userId) !== null,
    taskStatus: task.status === 'todo' || task.status === 'in_progress',
    noInFlight:
      (db
        .prepare("SELECT COUNT(*) AS c FROM executions WHERE task_id = ? AND status IN ('queued','running','awaiting_review')")
        .get(taskId) as { c: number }).c === 0,
  };
  return { projectId: task.project_id, checks };
}

export function startExecution(taskId: string, userId: string, createPR: boolean): Execution {
  const db = getDb();
  const { projectId, checks } = precheckTaskExecution(taskId, userId);
  requireProject(projectId, userId);

  const missing: string[] = [];
  if (!checks.ai) missing.push('AI provider is not configured (Settings → AI Provider)');
  if (!checks.repo) missing.push('no GitHub repository connected to the project');
  if (!checks.githubToken) missing.push('GitHub token is not configured (Settings → GitHub)');
  if (!checks.taskStatus) missing.push('task must be in "todo" or "in_progress"');
  if (!checks.noInFlight) missing.push('an execution is already in flight for this task');
  if (missing.length > 0) {
    throw new AppError(409, ErrorCodes.EXECUTION_NOT_READY, 'Task execution requirements not met', { missing });
  }

  return launchExecution(projectId, taskId, userId, createPR);
}

/** Re-runs a terminal execution's task. Skips the task-status gate (the task
 *  may legitimately sit in "in_review" after a previous attempt) but still
 *  refuses while another execution is in flight. */
export function retryExecution(executionId: string, userId: string, createPR: boolean): Execution {
  const row = getExecutionRow(executionId);
  requireProject(row.project_id, userId);
  const retryable = row.status === 'failed' || row.status === 'awaiting_review' || row.status === 'cancelled';
  if (!retryable) {
    throw AppError.conflict(ErrorCodes.CONFLICT, `Only failed or awaiting-review executions can be retried (current: ${row.status})`);
  }
  const { checks } = precheckTaskExecution(row.task_id, userId);
  const missing: string[] = [];
  if (!checks.ai) missing.push('AI provider is not configured (Settings → AI Provider)');
  if (!checks.repo) missing.push('no GitHub repository connected to the project');
  if (!checks.githubToken) missing.push('GitHub token is not configured (Settings → GitHub)');
  if (!checks.noInFlight) missing.push('an execution is already in flight for this task');
  if (missing.length > 0) {
    throw new AppError(409, ErrorCodes.EXECUTION_NOT_READY, 'Retry requirements not met', { missing });
  }
  return launchExecution(row.project_id, row.task_id, userId, createPR);
}

function launchExecution(projectId: string, taskId: string, userId: string, createPR: boolean): Execution {
  const db = getDb();
  const id = newId();
  const ts = nowIso();
  db.prepare(
    "INSERT INTO executions (id, project_id, task_id, user_id, status, mode, created_at, updated_at) VALUES (?, ?, ?, ?, 'queued', 'api', ?, ?)"
  ).run(id, projectId, taskId, userId, ts, ts);

  void runPipeline(id, createPR).catch((err) => {
    logger.error('execution crashed', { executionId: id, err: err instanceof Error ? err.stack : String(err) });
    db.prepare("UPDATE executions SET status = 'failed', error = ?, finished_at = ?, updated_at = ? WHERE id = ?").run(
      err instanceof Error ? err.message : String(err),
      nowIso(),
      nowIso(),
      id
    );
  });

  return toExecution(getExecutionRow(id));
}

// ---------- pipeline ----------

/** AI-generated changes must never touch CI/CD, credential or container files. */
const SENSITIVE_PATH =
  /(^|\/)(\.github\/workflows\/|\.gitlab-ci\.yml|Dockerfile[^/]*|\.dockerignore|\.env(\.|$)|[^/]*\.pem$|[^/]*\.key$|id_rsa[^/]*$|[^/]*\.pubxml$)/;

const codegenSchema = z.object({
  summary: z.string().min(1).max(4000),
  files: z
    .array(
      z.object({
        path: z
          .string()
          .min(1)
          .max(400)
          .refine((p) => !p.startsWith('/') && !p.includes('..') && !p.includes('\\'), 'path must be relative and safe')
          .refine((p) => !SENSITIVE_PATH.test(p), 'path targets a protected file (CI/CD, credentials, container config)'),
        action: z.enum(['add', 'modify', 'delete']),
        content: z.string().max(200000),
      })
    )
    .min(1)
    .max(15),
});

interface TaskContext {
  taskTitle: string;
  taskDescription: string;
  storyTitle: string;
  acceptanceCriteria: string[];
}

async function step<T>(executionId: string, logs: ExecutionStepLog[], name: string, fn: () => Promise<string>): Promise<T | null> {
  const db = getDb();
  const status = (db.prepare('SELECT status FROM executions WHERE id = ?').get(executionId) as { status: string }).status;
  if (status === 'cancelled') return null;
  const started = Date.now();
  try {
    const detail = await fn();
    logs.push({ step: name, status: 'ok', detail, durationMs: Date.now() - started, at: nowIso() });
  } catch (err) {
    const detail = err instanceof Error ? err.message : String(err);
    logs.push({ step: name, status: 'failed', detail, durationMs: Date.now() - started, at: nowIso() });
    db.prepare('UPDATE executions SET logs = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(logs), nowIso(), executionId);
    throw err;
  }
  db.prepare('UPDATE executions SET logs = ?, updated_at = ? WHERE id = ?').run(JSON.stringify(logs), nowIso(), executionId);
  return null;
}

function cloneRepo(fullName: string, branch: string, token: string): Promise<string> {
  const dir = mkdtempSync(path.join(tmpdir(), 'devflow-clone-'));
  const url = `https://x-access-token:${token}@github.com/${fullName}.git`;
  return new Promise<string>((resolve, reject) => {
    const child = spawn('git', ['clone', '--depth', '1', '--branch', branch, url, dir], { windowsHide: true });
    let stderr = '';
    child.stderr?.on('data', (d: Buffer) => {
      stderr += d.toString();
    });
    const timer = setTimeout(() => child.kill('SIGKILL'), 120000);
    child.on('error', (err) => {
      clearTimeout(timer);
      reject(err);
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (code === 0) resolve(dir);
      else {
        // git echoes the credentialed URL in several failure modes — never persist it
        const safe = stderr.slice(-300).replaceAll(token, '***');
        reject(new Error(`git clone failed: ${safe}`));
      }
    });
  }).catch((err) => {
    rmSync(dir, { recursive: true, force: true });
    throw err;
  });
}

async function runPipeline(executionId: string, createPR: boolean): Promise<void> {
  const db = getDb();
  const row = getExecutionRow(executionId);
  const project = requireProject(row.project_id, row.user_id);
  const logs: ExecutionStepLog[] = [];

  db.prepare("UPDATE executions SET status = 'running', updated_at = ? WHERE id = ?").run(nowIso(), executionId);

  const task = db
    .prepare(
      `SELECT t.title, t.description, t.status AS task_status, s.title AS story_title, s.acceptance_criteria
       FROM tasks t JOIN stories s ON s.id = t.story_id WHERE t.id = ?`
    )
    .get(row.task_id) as { title: string; description: string; task_status: string; story_title: string; acceptance_criteria: string } | undefined;
  if (!task) throw new Error('task vanished');

  const taskContext: TaskContext = {
    taskTitle: task.title,
    taskDescription: task.description,
    storyTitle: task.story_title,
    acceptanceCriteria: JSON.parse(task.acceptance_criteria) as string[],
  };

  const token = getGitHubToken(row.user_id);
  if (!token || !project.repo_full_name || !project.repo_default_branch) throw new Error('repo/token missing after precheck');
  const gh = new GitHubClient(token);

  const aiConfig = resolveAI(row.user_id);
  const provider: AIProvider = aiConfig ? new OpenAICompatibleProvider(aiConfig.baseUrl, aiConfig.apiKey) : new MockProvider();
  const model = aiConfig?.model ?? 'mock-1';

  // ---- 1. analyze repository ----
  const relevantFiles: Array<{ path: string; content: string }> = [];
  let conventions = '';
  await step(executionId, logs, 'analyze_repository', async () => {
    const tree = await gh.request<{ tree: Array<{ path: string; type: string; size?: number }> }>(
      'GET',
      `/repos/${project.repo_full_name}/git/trees/${encodeURIComponent(project.repo_default_branch!)}?recursive=1`
    );
    const blobs = tree.tree.filter(
      (f) =>
        f.type === 'blob' &&
        (f.size ?? 0) < 200_000 &&
        !/(^|\/)(node_modules|\.git|dist|build|vendor|__pycache__|target)(\/|$)/.test(f.path)
    );

    const keywords = `${taskContext.taskTitle} ${taskContext.taskDescription}`
      .toLowerCase()
      .split(/[^a-z0-9]+/)
      .filter((w) => w.length > 3);
    const scored = blobs
      .map((f) => {
        const p = f.path.toLowerCase();
        let score = 0;
        for (const k of keywords) if (p.includes(k)) score += 10;
        if (p === 'readme.md') score += 8;
        if (p === 'package.json') score += 8;
        if (p.endsWith('.md')) score += 2;
        return { path: f.path, score };
      })
      .filter((f) => f.score > 0)
      .sort((x, y) => y.score - x.score)
      .slice(0, 12);

    if (scored.length === 0 && blobs.length > 0) {
      scored.push({ path: blobs[0]!.path, score: 1 });
    }

    for (const f of scored.slice(0, 8)) {
      try {
        const data = await gh.request<{ content: string; encoding: string }>(
          'GET',
          `/repos/${project.repo_full_name}/contents/${encodeURIComponent(f.path).replace(/%2F/g, '/')}?ref=${encodeURIComponent(project.repo_default_branch!)}`
        );
        if (data.encoding === 'base64') {
          relevantFiles.push({ path: f.path, content: Buffer.from(data.content, 'base64').toString('utf8') });
        }
      } catch {
        // skip unreadable file; do not fail the run for context gaps
      }
    }
    const readme = relevantFiles.find((f) => f.path.toLowerCase() === 'readme.md');
    conventions = readme ? readme.content.slice(0, 2000) : '';
    return `${blobs.length} files indexed, ${relevantFiles.length} fetched for context`;
  });

  // ---- 2. generate implementation ----
  const generated = await (async (): Promise<z.infer<typeof codegenSchema>> => {
    let parsed: z.infer<typeof codegenSchema> | null = null;
    await step(executionId, logs, 'generate_code', async () => {
      const system = [
        'You are a Senior Software Engineer implementing a single task on a repository.',
        'You MUST respond with ONLY a JSON object (no markdown fences, no commentary):',
        '{"summary":string,"files":[{"path":string,"action":"add"|"modify"|"delete","content":string}]}',
        'Rules: paths are repo-relative POSIX paths without leading slash. "content" is the COMPLETE new file content for add/modify (empty string for delete).',
        'Implement ONLY the requested task scope. Respect the existing conventions. Keep changes minimal and focused.',
      ].join('\n');
      const user = [
        `Story: ${taskContext.storyTitle}`,
        `Task: ${taskContext.taskTitle}`,
        `Task details: ${taskContext.taskDescription || '(none)'}`,
        taskContext.acceptanceCriteria.length > 0
          ? `Acceptance criteria:\n${taskContext.acceptanceCriteria.map((a) => `- ${a}`).join('\n')}`
          : 'Acceptance criteria: (none provided)',
        conventions ? `\nRepository conventions (README excerpt):\n${conventions}` : '',
        '\nRepository files for context:',
        ...relevantFiles.map((f) => `\n--- FILE: ${f.path} ---\n${f.content.slice(0, 12000)}`),
      ].join('\n');

      const result = await provider.complete(
        { model, messages: [{ role: 'system', content: system }, { role: 'user', content: user }], temperature: 0.2, maxTokens: 8000, mockKind: 'chat' },
        240000
      );
      db.prepare(
        'INSERT INTO usage_events (id, user_id, project_id, kind, model, tokens_in, tokens_out, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)'
      ).run(newId(), row.user_id, row.project_id, 'execution', model, result.tokensIn, result.tokensOut, nowIso());

      let text = result.content.trim();
      const fence = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(text);
      if (fence) text = fence[1]!.trim();
      const first = text.indexOf('{');
      const last = text.lastIndexOf('}');
      if (first >= 0 && last > first) text = text.slice(first, last + 1);
      const check = codegenSchema.safeParse(JSON.parse(text));
      if (!check.success) {
        throw new AppError(502, ErrorCodes.AI_BAD_RESPONSE, `Generated changes failed validation: ${check.error.issues[0]?.message}`);
      }
      parsed = check.data;
      return `${parsed.files.length} file change(s): ${parsed.summary.slice(0, 200)}`;
    });
    if (!parsed) throw new Error('code generation produced no result');
    return parsed;
  })();

  // ---- 3. build diff ----
  const changes: ExecutionFileChange[] = [];
  let diffText = '';
  await step(executionId, logs, 'build_diff', async () => {
    for (const f of generated.files) {
      const existing = relevantFiles.find((r) => r.path === f.path);
      const before = f.action === 'add' ? '' : (existing?.content ?? '');
      const after = f.action === 'delete' ? '' : f.content;
      changes.push({ path: f.path, action: f.action, before, after });
      const d = unifiedDiff(f.path, before, after);
      if (d) diffText += (diffText ? '\n' : '') + d;
    }
    db.prepare('UPDATE executions SET changes = ?, diff = ?, updated_at = ? WHERE id = ?').run(
      JSON.stringify(changes),
      diffText,
      nowIso(),
      executionId
    );
    return `${changes.length} change(s), diff ${diffText.length} chars`;
  });

  // ---- 4. tests (isolated, best effort) ----
  let testsPassed = false;
  let testsSkipped = true;
  await step(executionId, logs, 'run_tests', async () => {
    const dockerAvailable = await isDockerAvailable();
    if (!dockerAvailable) {
      db.prepare('UPDATE executions SET test_result = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify({ status: 'skipped', detail: 'Docker engine unavailable — tests were NOT executed. PR will be created as draft.' }),
        nowIso(),
        executionId
      );
      return 'skipped: Docker engine unavailable';
    }
    testsSkipped = false;
    let repoDir: string | null = null;
    try {
      repoDir = await cloneRepo(project.repo_full_name!, project.repo_default_branch!, token!);
      const image = detectImage(repoDir);
      const command = detectTestCommand(repoDir);
      if (!image || !command) {
        db.prepare('UPDATE executions SET test_result = ?, updated_at = ? WHERE id = ?').run(
          JSON.stringify({ status: 'skipped', detail: 'No recognized test toolchain in the repository' }),
          nowIso(),
          executionId
        );
        return 'skipped: no recognized test toolchain';
      }
      const result = await runInContainer({ repoDir, image, command, timeoutMs: 600000 });
      testsPassed = result.exitCode === 0;
      const detail = result.ran
        ? `exit=${result.exitCode} in ${Math.round(result.durationMs / 1000)}s\n${(result.stderr || result.stdout).slice(0, 4000)}`
        : (result.reason ?? 'container run failed');
      db.prepare('UPDATE executions SET test_result = ?, updated_at = ? WHERE id = ?').run(
        JSON.stringify({ status: testsPassed ? 'passed' : 'failed', detail }),
        nowIso(),
        executionId
      );
      return `exit=${result.exitCode}`;
    } finally {
      if (repoDir && !repoDir.includes('..')) rmSync(repoDir, { recursive: true, force: true });
    }
  });

  // ---- 5. commit to feature branch ----
  const branch = `devflow/task-${row.task_id.slice(0, 8)}-${Date.now().toString(36)}`;
  let commitSha = '';
  await step(executionId, logs, 'commit_branch', async () => {
    const message = `feat: ${taskContext.taskTitle}\n\nImplemented by DevFlow AI for task ${row.task_id}.\nStory: ${taskContext.storyTitle}`;
    const result = await gh.createCommitWithFiles(
      project.repo_full_name!,
      project.repo_default_branch!,
      branch,
      message,
      generated.files.map((f) => ({ path: f.path, content: f.action === 'delete' ? null : f.content, action: f.action }))
    );
    commitSha = result.commitSha;
    db.prepare('UPDATE executions SET branch = ?, updated_at = ? WHERE id = ?').run(branch, nowIso(), executionId);
    return `branch ${branch} @ ${commitSha.slice(0, 8)}`;
  });

  // ---- 6. pull request ----
  if (createPR) {
    await step(executionId, logs, 'create_pull_request', async () => {
      const body = [
        `Closes task \`${row.task_id}\` — story: **${taskContext.storyTitle}**`,
        '',
        '## Summary',
        generated.summary,
        '',
        '## Changes',
        ...generated.files.map((f) => `- \`${f.action}\` \`${f.path}\``),
        '',
        '## Acceptance criteria',
        taskContext.acceptanceCriteria.length > 0
          ? taskContext.acceptanceCriteria.map((a) => `- [ ] ${a}`).join('\n')
          : '- [ ] (none defined)',
        '',
        '## Automated tests',
        testsPassed ? '✅ Passed inside an isolated container.' : testsSkipped ? '⚠️ NOT executed (no Docker engine / no test toolchain). This PR is a draft — verify manually.' : '❌ FAILED. This PR is a draft — fix before merging.',
        '',
        '---',
        '_Generated by DevFlow AI. Human review is required before merge._',
      ].join('\n');
      const pr = await gh.createPR(project.repo_full_name!, {
        title: `feat: ${taskContext.taskTitle}`,
        head: branch,
        base: project.repo_default_branch!,
        body,
        draft: !testsPassed,
      });
      db.prepare('UPDATE executions SET pr_number = ?, pr_url = ?, updated_at = ? WHERE id = ?').run(pr.number, pr.url, nowIso(), executionId);
      return `PR #${pr.number} ${pr.url}`;
    });
  }

  // ---- 7. synchronize task status ----
  await step(executionId, logs, 'sync_task', async () => {
    const transitions = db.prepare('SELECT status FROM tasks WHERE id = ?').get(row.task_id) as { status: string };
    const toReview = (async () => {
      if (transitions.status === 'todo') {
        await import('../backlog.service.js').then((m) => m.transitionEntity('task', row.project_id, row.task_id, row.user_id, { status: 'in_progress' }));
      }
      await import('../backlog.service.js').then((m) => m.transitionEntity('task', row.project_id, row.task_id, row.user_id, { status: 'in_review' }));
    })();
    try {
      await toReview;
      return 'task moved to in_review';
    } catch (err) {
      return `task status unchanged (${err instanceof Error ? err.message : String(err)})`;
    }
  });

  // ---- 8. finalize ----
  const finalStatus = testsPassed ? 'succeeded' : 'awaiting_review';
  const ts = nowIso();
  db.prepare('UPDATE executions SET status = ?, finished_at = ?, updated_at = ? WHERE id = ?').run(finalStatus, ts, ts, executionId);
  recordActivity(
    row.project_id,
    row.user_id,
    'execution.finished',
    `Execution ${finalStatus.replace('_', ' ')} — branch ${branch}${createPR && getExecutionRow(executionId).pr_number ? `, PR #${getExecutionRow(executionId).pr_number}` : ''}`
  );
  notify(
    row.user_id,
    testsPassed ? 'execution.succeeded' : 'execution.needs_review',
    testsPassed ? 'AI execution succeeded' : 'AI execution needs your review',
    testsPassed
      ? `Task "${taskContext.taskTitle}" was implemented and tests passed.${createPR && getExecutionRow(executionId).pr_url ? ` Review PR: ${getExecutionRow(executionId).pr_url}` : ''}`
      : `Task "${taskContext.taskTitle}" was implemented but tests did not run or failed. Review before merging.`
  );
}

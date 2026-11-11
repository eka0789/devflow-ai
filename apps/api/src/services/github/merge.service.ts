/**
 * Pull request merge flow — guarded, audited, human-confirmed.
 * The client must send confirmation === 'MERGE'. Server-side checks:
 * PR open, not draft, not already merged, mergeable !== false, CI not failing.
 */
import { AppError } from '../../util/appError.js';
import { ErrorCodes } from '@devflow/shared';
import { getDb, nowIso } from '../../db/database.js';
import { GitHubClient } from './client.js';
import { getGitHubToken } from '../settings.service.js';
import { requireProject, requireProjectWrite } from '../projects.service.js';
import { recordAudit, recordActivity, notify } from '../events.service.js';
import type { GitHubPR, GitHubPRFile } from '@devflow/shared';

export interface MergeResult {
  merged: true;
  sha: string;
  pr: GitHubPR;
}

function requireToken(userId: string): GitHubClient {
  const token = getGitHubToken(userId);
  if (!token) {
    throw new AppError(400, ErrorCodes.GITHUB_NOT_CONFIGURED, 'GitHub token is not configured. Add one in Settings → GitHub.');
  }
  return new GitHubClient(token);
}

export async function mergePullRequest(
  projectId: string,
  userId: string,
  prNumber: number,
  confirmation: 'MERGE',
  mergeMethod: 'merge' | 'squash' | 'rebase'
): Promise<MergeResult> {
  if (confirmation !== 'MERGE') {
    throw AppError.badRequest(ErrorCodes.VALIDATION_FAILED, 'Merge requires confirmation === "MERGE"');
  }
  const project = requireProjectWrite(projectId, userId);
  if (!project.repo_full_name) {
    throw new AppError(400, ErrorCodes.REPO_NOT_CONNECTED, 'No GitHub repository is connected to this project.');
  }
  const client = requireToken(userId);

  // ---- pre-merge verification ----
  const pr = await client.getPR(project.repo_full_name, prNumber);
  const problems: string[] = [];
  if (pr.state !== 'open') problems.push(`PR is ${pr.state}`);
  if (pr.merged) problems.push('PR is already merged');
  if (pr.draft) problems.push('PR is a draft — mark it ready for review first');
  if (pr.mergeable === false) problems.push('PR has merge conflicts (mergeable=false)');
  if (pr.ciStatus === 'failure') problems.push('CI status is failing');
  if (problems.length > 0) {
    throw new AppError(409, ErrorCodes.PR_NOT_MERGEABLE, `Merge refused: ${problems.join('; ')}`, { problems });
  }

  const result = await client.mergePR(project.repo_full_name, prNumber, mergeMethod);
  if (!result.merged) {
    throw new AppError(409, ErrorCodes.PR_NOT_MERGEABLE, 'GitHub refused the merge (check branch protection rules)');
  }

  // ---- immutable audit + notifications ----
  recordAudit(userId, 'pr.merge', 'pull_request', `${project.repo_full_name}#${prNumber}`, {
    method: mergeMethod,
    sha: result.sha,
    projectId,
    title: pr.title,
  });
  recordActivity(projectId, userId, 'github.pr_merged', `PR #${prNumber} "${pr.title}" merged (${mergeMethod})`);
  notify(userId, 'github.pr_merged', 'Pull request merged', `PR #${prNumber} "${pr.title}" was merged with method ${mergeMethod}.`);

  return { merged: true, sha: result.sha, pr: { ...pr, merged: true, state: 'closed' } };
}

export async function getPRDetail(
  projectId: string,
  userId: string,
  prNumber: number
): Promise<{ pr: GitHubPR; files: GitHubPRFile[] }> {
  const project = requireProject(projectId, userId);
  if (!project.repo_full_name) {
    throw new AppError(400, ErrorCodes.REPO_NOT_CONNECTED, 'No GitHub repository is connected to this project.');
  }
  const client = requireToken(userId);
  const pr = await client.getPR(project.repo_full_name, prNumber);
  const files = await client.getPRFiles(project.repo_full_name, prNumber);
  return { pr, files };
}

export async function listPRs(projectId: string, userId: string): Promise<GitHubPR[]> {
  const project = requireProject(projectId, userId);
  if (!project.repo_full_name) {
    throw new AppError(400, ErrorCodes.REPO_NOT_CONNECTED, 'No GitHub repository is connected to this project.');
  }
  const client = requireToken(userId);
  return client.listPRs(project.repo_full_name);
}

export function lastAuditFor(userId: string, targetType: string, targetId: string): { action: string; createdAt: string; meta: string } | null {
  const row = getDb()
    .prepare(
      'SELECT action, created_at, meta FROM audit_log WHERE user_id = ? AND target_type = ? AND target_id = ? ORDER BY created_at DESC LIMIT 1'
    )
    .get(userId, targetType, targetId) as { action: string; created_at: string; meta: string } | undefined;
  return row ? { action: row.action, createdAt: row.created_at, meta: row.meta } : null;
}


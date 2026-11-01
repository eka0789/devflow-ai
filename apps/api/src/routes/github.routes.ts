import { Router } from 'express';
import { z } from 'zod';
import { connectRepoSchema, githubTokenSchema, mergePRSchema } from '@devflow/shared';
import { asyncHandler, parseBody, send } from '../util/http.js';
import { requireAuth } from '../middleware/auth.js';
import { rateLimit } from '../middleware/rateLimit.js';
import * as settings from '../services/settings.service.js';
import { GitHubClient } from '../services/github/client.js';
import * as merge from '../services/github/merge.service.js';
import { requireProject } from '../services/projects.service.js';
import { AppError } from '../util/appError.js';
import { ErrorCodes } from '@devflow/shared';

export const githubRouter = Router();
const githubLimiter = rateLimit({ windowMs: 60 * 1000, max: 60, keyOf: (req) => req.userId ?? req.ip ?? 'anon' });
githubRouter.use(requireAuth);
githubRouter.use(githubLimiter);
const projectIdParam = z.object({ projectId: z.string().uuid() });
const prNumberParams = z.object({ projectId: z.string().uuid(), number: z.coerce.number().int().positive() });

function clientOrThrow(userId: string, repoFullName: string | null | undefined): { client: GitHubClient; repo: string } {
  const token = settings.getGitHubToken(userId);
  if (!token) {
    throw new AppError(400, ErrorCodes.GITHUB_NOT_CONFIGURED, 'GitHub token is not configured. Add one in Settings → GitHub.');
  }
  if (!repoFullName) {
    throw new AppError(400, ErrorCodes.REPO_NOT_CONNECTED, 'No GitHub repository is connected to this project.');
  }
  return { client: new GitHubClient(token), repo: repoFullName };
}


githubRouter.get(
  '/github/status',
  asyncHandler(async (req, res) => {
    send(res, { connected: settings.hasGitHubToken(req.userId!) });
  })
);

githubRouter.put(
  '/github/token',
  asyncHandler(async (req, res) => {
    const input = parseBody(githubTokenSchema, req.body);
    // validate the token against GitHub before storing
    const client = new GitHubClient(input.token);
    try {
      await client.listUserRepos();
    } catch {
      throw AppError.badRequest(ErrorCodes.GITHUB_API_ERROR, 'GitHub rejected this token. Create a token with repo and workflow scopes.');
    }
    settings.setGitHubToken(req.userId!, input.token);
    send(res, { connected: true });
  })
);

githubRouter.delete(
  '/github/token',
  asyncHandler(async (req, res) => {
    settings.clearGitHubToken(req.userId!);
    send(res, { connected: false });
  })
);

githubRouter.get(
  '/github/repos',
  asyncHandler(async (req, res) => {
    const token = settings.getGitHubToken(req.userId!);
    if (!token) throw new AppError(400, ErrorCodes.GITHUB_NOT_CONFIGURED, 'GitHub token is not configured.');
    send(res, await new GitHubClient(token).listUserRepos());
  })
);

githubRouter.post(
  '/projects/:projectId/github/connect',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const input = parseBody(connectRepoSchema, req.body);
    const project = requireProject(req.params.projectId!, req.userId!);
    const token = settings.getGitHubToken(req.userId!);
    if (!token) throw new AppError(400, ErrorCodes.GITHUB_NOT_CONFIGURED, 'GitHub token is not configured.');
    const client = new GitHubClient(token);
    const repo = await client.getRepo(input.repoFullName);
    void project;
    send(res, await import('../services/projects.service.js').then((m) => m.setRepo(req.params.projectId!, req.userId!, repo.fullName, repo.defaultBranch)));
  })
);

githubRouter.post(
  '/projects/:projectId/github/disconnect',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    requireProject(req.params.projectId!, req.userId!);
    send(res, await import('../services/projects.service.js').then((m) => m.setRepo(req.params.projectId!, req.userId!, null, null)));
  })
);

githubRouter.get(
  '/projects/:projectId/github/branches',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const project = requireProject(req.params.projectId!, req.userId!);
    const { client, repo } = clientOrThrow(req.userId!, project.repo_full_name);
    send(res, await client.listBranches(repo));
  })
);

githubRouter.get(
  '/projects/:projectId/github/commits',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    const project = requireProject(req.params.projectId!, req.userId!);
    const { client, repo } = clientOrThrow(req.userId!, project.repo_full_name);
    const branch = typeof req.query.branch === 'string' && req.query.branch ? req.query.branch : project.repo_default_branch;
    send(res, await client.listCommits(repo, branch));
  })
);

githubRouter.get(
  '/projects/:projectId/github/prs',
  asyncHandler(async (req, res) => {
    parseBody(projectIdParam, req.params);
    send(res, await merge.listPRs(req.params.projectId!, req.userId!));
  })
);

githubRouter.get(
  '/projects/:projectId/github/prs/:number',
  asyncHandler(async (req, res) => {
    const params = parseBody(prNumberParams, req.params);
    send(res, await merge.getPRDetail(params.projectId, req.userId!, params.number));
  })
);

githubRouter.post(
  '/projects/:projectId/github/prs/:number/merge',
  asyncHandler(async (req, res) => {
    const params = parseBody(prNumberParams, req.params);
    const input = parseBody(mergePRSchema, req.body);
    send(
      res,
      await merge.mergePullRequest(params.projectId, req.userId!, params.number, input.confirmation, input.mergeMethod)
    );
  })
);

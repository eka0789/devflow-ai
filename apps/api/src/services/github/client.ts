/**
 * GitHub REST adapter (PAT-authenticated). Thin, typed, real — every method
 * hits api.github.com. Errors are mapped to structured AppErrors.
 */
import { AppError } from '../../util/appError.js';
import { ErrorCodes } from '@devflow/shared';
import type { GitHubBranch, GitHubCommit, GitHubPR, GitHubPRFile, GitHubRepoSummary } from '@devflow/shared';
import { logger } from '../../util/logger.js';

const API_ROOT = 'https://api.github.com';
const TIMEOUT_MS = 30000;

export class GitHubClient {
  constructor(private readonly token: string) {}

  async request<T>(
    method: string,
    path: string,
    body?: unknown,
    accept = 'application/vnd.github+json'
  ): Promise<T> {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
    let res: Response;
    try {
      res = await fetch(path.startsWith('http') ? path : `${API_ROOT}${path}`, {
        method,
        headers: {
          Authorization: `Bearer ${this.token}`,
          Accept: accept,
          'X-GitHub-Api-Version': '2022-11-28',
          'User-Agent': 'DevFlow-AI',
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: controller.signal,
      });
    } catch (err) {
      throw new AppError(502, ErrorCodes.GITHUB_API_ERROR, `GitHub request failed: ${err instanceof Error ? err.message : String(err)}`);
    } finally {
      clearTimeout(timer);
    }

    if (!res.ok) {
      let detail = '';
      try {
        const parsed = (await res.json()) as { message?: string };
        detail = parsed.message ?? '';
      } catch {
        detail = res.statusText;
      }
      if (res.status === 401) {
        throw new AppError(401, ErrorCodes.GITHUB_API_ERROR, 'GitHub rejected the token (401). Update it in Settings → GitHub.');
      }
      if (res.status === 404) {
        throw new AppError(404, ErrorCodes.GITHUB_API_ERROR, `GitHub resource not found (404): ${path}`);
      }
      logger.warn('github api error', { status: res.status, path, detail });
      throw new AppError(502, ErrorCodes.GITHUB_API_ERROR, `GitHub API ${res.status}: ${detail}`);
    }

    if (res.status === 204) return undefined as T;
    return (await res.json()) as T;
  }

  // ---------- repos ----------

  async listUserRepos(): Promise<GitHubRepoSummary[]> {
    const data = await this.request<Array<{
      full_name: string;
      private: boolean;
      default_branch: string;
      description: string | null;
      updated_at: string;
      permissions?: { push?: boolean };
    }>>('GET', '/user/repos?per_page=100&sort=updated&affiliation=owner,collaborator');
    return data.map((r) => ({
      fullName: r.full_name,
      private: r.private,
      defaultBranch: r.default_branch,
      description: r.description,
      updatedAt: r.updated_at,
    }));
  }

  async getRepo(fullName: string): Promise<{ fullName: string; defaultBranch: string; private: boolean }> {
    const r = await this.request<{ full_name: string; default_branch: string; private: boolean }>(
      'GET',
      `/repos/${fullName}`
    );
    return { fullName: r.full_name, defaultBranch: r.default_branch, private: r.private };
  }

  async listBranches(fullName: string): Promise<GitHubBranch[]> {
    const data = await this.request<Array<{ name: string; commit: { sha: string } }>>(
      'GET',
      `/repos/${fullName}/branches?per_page=100`
    );
    return data.map((b) => ({ name: b.name, sha: b.commit.sha }));
  }

  async listCommits(fullName: string, branch: string | null): Promise<GitHubCommit[]> {
    const query = branch ? `?sha=${encodeURIComponent(branch)}&per_page=30` : '?per_page=30';
    const data = await this.request<Array<{
      sha: string;
      commit: { message: string; author: { name: string; date: string } | null };
      html_url: string;
    }>>('GET', `/repos/${fullName}/commits${query}`);
    return data.map((c) => ({
      sha: c.sha,
      message: c.commit.message.split('\n')[0] ?? '',
      author: c.commit.author?.name ?? 'unknown',
      date: c.commit.author?.date ?? '',
      url: c.html_url,
    }));
  }

  // ---------- pull requests ----------

  private static toPR(p: {
    number: number;
    title: string;
    state: string;
    draft: boolean;
    merged: boolean;
    head: { ref: string };
    base: { ref: string };
    html_url: string;
    mergeable: boolean | null;
    created_at: string;
    updated_at: string;
  }): GitHubPR {
    return {
      number: p.number,
      title: p.title,
      state: p.state as 'open' | 'closed',
      draft: p.draft,
      merged: p.merged,
      headBranch: p.head.ref,
      baseBranch: p.base.ref,
      url: p.html_url,
      ciStatus: 'none',
      mergeable: p.mergeable,
      createdAt: p.created_at,
      updatedAt: p.updated_at,
    };
  }

  async listPRs(fullName: string): Promise<GitHubPR[]> {
    const data = await this.request<Array<Parameters<typeof GitHubClient.toPR>[0]>>(
      'GET',
      `/repos/${fullName}/pulls?state=all&per_page=50&sort=updated`
    );
    const prs = data.map(GitHubClient.toPR);
    // enrich CI status for open PRs (head sha combined status)
    for (const pr of prs.filter((p) => p.state === 'open').slice(0, 10)) {
      pr.ciStatus = await this.getCiStatus(fullName, pr.headBranch).catch(() => 'none' as const);
    }
    return prs;
  }

  async getPR(fullName: string, number: number): Promise<GitHubPR> {
    const data = await this.request<Parameters<typeof GitHubClient.toPR>[0]>('GET', `/repos/${fullName}/pulls/${number}`);
    const pr = GitHubClient.toPR(data);
    pr.ciStatus = await this.getCiStatus(fullName, pr.headBranch).catch(() => 'none' as const);
    return pr;
  }

  async getPRFiles(fullName: string, number: number): Promise<GitHubPRFile[]> {
    const data = await this.request<Array<{
      filename: string;
      status: string;
      additions: number;
      deletions: number;
      patch: string | null;
    }>>('GET', `/repos/${fullName}/pulls/${number}/files?per_page=100`);
    return data.map((f) => ({
      filename: f.filename,
      status: f.status,
      additions: f.additions,
      deletions: f.deletions,
      patch: f.patch,
    }));
  }

  async getCiStatus(fullName: string, ref: string): Promise<GitHubPR['ciStatus']> {
    try {
      const status = await this.request<{ state: string }>(
        'GET',
        `/repos/${fullName}/commits/${encodeURIComponent(ref)}/status`
      );
      if (status.state === 'success') return 'success';
      if (status.state === 'failure' || status.state === 'error') return 'failure';
      if (status.state === 'pending') return 'pending';
      return 'none';
    } catch {
      return 'none';
    }
  }

  // ---------- commits & PR creation (used by the execution pipeline) ----------

  async getRefSha(fullName: string, ref: string): Promise<string> {
    const data = await this.request<{ object: { sha: string } }>(
      'GET',
      `/repos/${fullName}/git/ref/heads/${encodeURIComponent(ref)}`
    );
    return data.object.sha;
  }

  async createBranch(fullName: string, fromBranch: string, newBranch: string): Promise<string> {
    const sha = await this.getRefSha(fullName, fromBranch);
    await this.request('POST', `/repos/${fullName}/git/refs`, { ref: `refs/heads/${newBranch}`, sha });
    return sha;
  }

  async createCommitWithFiles(
    fullName: string,
    baseBranch: string,
    newBranch: string,
    message: string,
    files: Array<{ path: string; content: string | null; action: 'add' | 'modify' | 'delete' }>
  ): Promise<{ commitSha: string }> {
    const baseSha = await this.getRefSha(fullName, baseBranch);
    const baseCommit = await this.request<{ tree: { sha: string } }>(
      'GET',
      `/repos/${fullName}/git/commits/${baseSha}`
    );

    // build tree entries
    const tree: Array<{ path: string; mode: '100644'; type: 'blob'; sha?: string; sha_new?: string }> = [];
    for (const file of files) {
      if (file.action === 'delete' || file.content === null) {
        tree.push({ path: file.path, mode: '100644', type: 'blob', sha: null as unknown as string });
        continue;
      }
      const blob = await this.request<{ sha: string }>('POST', `/repos/${fullName}/git/blobs`, {
        content: Buffer.from(file.content, 'utf8').toString('base64'),
        encoding: 'base64',
      });
      tree.push({ path: file.path, mode: '100644', type: 'blob', sha: blob.sha });
    }

    const newTree = await this.request<{ sha: string }>('POST', `/repos/${fullName}/git/trees`, {
      base_tree: baseCommit.tree.sha,
      tree: tree.map((t) => ({ path: t.path, mode: t.mode, type: t.type, sha: t.sha })),
    });

    const commit = await this.request<{ sha: string }>('POST', `/repos/${fullName}/git/commits`, {
      message,
      tree: newTree.sha,
      parents: [baseSha],
    });

    // point the feature branch at the new commit (branch must exist)
    let branchExists = true;
    try {
      await this.getRefSha(fullName, newBranch);
    } catch {
      branchExists = false;
    }
    if (!branchExists) {
      await this.request('POST', `/repos/${fullName}/git/refs`, { ref: `refs/heads/${newBranch}`, sha: commit.sha });
    } else {
      await this.request('PATCH', `/repos/${fullName}/git/refs/heads/${encodeURIComponent(newBranch)}`, {
        sha: commit.sha,
        force: false,
      });
    }
    return { commitSha: commit.sha };
  }

  async createPR(
    fullName: string,
    input: { title: string; head: string; base: string; body: string; draft: boolean }
  ): Promise<{ number: number; url: string }> {
    const data = await this.request<{ number: number; html_url: string }>(
      'POST',
      `/repos/${fullName}/pulls`,
      {
        title: input.title,
        head: input.head,
        base: input.base,
        body: input.body,
        draft: input.draft,
      }
    );
    return { number: data.number, url: data.html_url };
  }

  async mergePR(
    fullName: string,
    number: number,
    mergeMethod: 'merge' | 'squash' | 'rebase'
  ): Promise<{ sha: string; merged: boolean }> {
    return this.request<{ sha: string; merged: boolean }>(
      'PUT',
      `/repos/${fullName}/pulls/${number}/merge`,
      { merge_method: mergeMethod }
    );
  }
}

/**
 * Tests added from the fleet review (security + testing strategy findings):
 * webhook HMAC real-signature path, merge guard, execution cross-tenant
 * isolation, rate limiting, and cross-user project write protection.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHmac } from 'node:crypto';
import request from 'supertest';
import { app, authed, freshDb, getDb, makeProject, makeUser } from './helpers.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';
import { config } from '../src/config.js';
import { setGitHubToken, setAISettings } from '../src/services/settings.service.js';
import { createStory, createTask } from '../src/services/backlog.service.js';
import { startExecution } from '../src/services/execution/pipeline.js';

beforeEach(() => {
  freshDb();
  resetRateLimits();
});
afterEach(() => vi.unstubAllGlobals());

describe('webhook HMAC signature (real secret configured)', () => {
  it('accepts a correctly signed delivery and rejects a forged one', async () => {
    config.webhookSecret = 'whsec_test_secret';
    try {
      const a = app();
      const body = JSON.stringify({ repository: { full_name: 'o/r' } });
      const sig = 'sha256=' + createHmac('sha256', 'whsec_test_secret').update(body, 'utf8').digest('hex');

      const ok = await request(a)
        .post('/api/webhooks/github')
        .set({
          'Content-Type': 'text/plain',
          'X-GitHub-Event': 'push',
          'X-GitHub-Delivery': 'd-good-1',
          'X-Hub-Signature-256': sig,
        })
        .send(body);
      expect(ok.status).toBe(200);
      expect(ok.body.data.ok).toBe(true);

      const forged = await request(a)
        .post('/api/webhooks/github')
        .set({
          'Content-Type': 'text/plain',
          'X-GitHub-Event': 'push',
          'X-GitHub-Delivery': 'd-bad-1',
          'X-Hub-Signature-256': 'sha256=' + '0'.repeat(64),
        })
        .send(body);
      expect(forged.status).toBe(401);
    } finally {
      config.webhookSecret = null;
    }
  });
});

describe('PR merge guard', () => {
  function stubGitHub(pr: Record<string, unknown>, statusState: string, mergeResponse?: Record<string, unknown>) {
    const calls: Array<{ method: string; url: string }> = [];
    const fetchMock = vi.fn(async (input: string | URL, init?: RequestInit) => {
      const url = String(input);
      const method = (init?.method ?? 'GET').toUpperCase();
      calls.push({ method, url });
      if (url.includes('/pulls/7') && method === 'GET') {
        return new Response(JSON.stringify(pr), { status: 200 });
      }
      if (url.includes('/status') && method === 'GET') {
        return new Response(JSON.stringify({ state: statusState }), { status: 200 });
      }
      if (url.includes('/merge') && method === 'PUT') {
        return new Response(JSON.stringify(mergeResponse ?? { sha: 'deadbeef', merged: true }), { status: 200 });
      }
      return new Response(JSON.stringify({ message: 'not found' }), { status: 404 });
    });
    vi.stubGlobal('fetch', fetchMock);
    return calls;
  }

  const basePR = {
    number: 7,
    title: 'Add feature',
    state: 'open',
    draft: false,
    merged: false,
    head: { ref: 'feature' },
    base: { ref: 'main' },
    html_url: 'https://github.com/acme/widget/pull/7',
    mergeable: true,
    created_at: new Date().toISOString(),
    updated_at: new Date().toISOString(),
  };

  function setupProject(): { projectId: string; userId: string; token: string } {
    const user = makeUser('merger');
    const projectId = makeProject(user.id, 'Mergeable').id;
    getDb().prepare('UPDATE projects SET repo_full_name = ? WHERE id = ?').run('acme/widget', projectId);
    setGitHubToken(user.id, 'ghp_test_token_value');
    return { projectId, userId: user.id, token: 'ghp_test_token_value' };
  }

  it('refuses a draft PR with PR_NOT_MERGEABLE', async () => {
    const { projectId, userId } = setupProject();
    stubGitHub({ ...basePR, draft: true }, 'success');
    const { mergePullRequest } = await import('../src/services/github/merge.service.js');
    try {
      await mergePullRequest(projectId, userId, 7, 'MERGE', 'squash');
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as { code: string }).code).toBe('PR_NOT_MERGEABLE');
    }
  });

  it('merges a clean PR, records the audit entry, and requires exact confirmation', async () => {
    const { projectId, userId } = setupProject();
    const calls = stubGitHub(basePR, 'success');
    const { mergePullRequest } = await import('../src/services/github/merge.service.js');

    // wrong confirmation is rejected before any network call
    await expect(mergePullRequest(projectId, userId, 7, 'NOPE' as 'MERGE', 'squash')).rejects.toThrowError();
    expect(calls.filter((c) => c.method === 'PUT')).toHaveLength(0);

    const result = await mergePullRequest(projectId, userId, 7, 'MERGE', 'squash');
    expect(result.merged).toBe(true);
    expect(calls.some((c) => c.method === 'PUT' && c.url.includes('/merge'))).toBe(true);

    const audit = getDb()
      .prepare('SELECT * FROM audit_log WHERE user_id = ? AND action = ?')
      .all(userId, 'pr.merge') as unknown as Array<{ target_id: string }>;
    expect(audit.length).toBe(1);
    expect(audit[0]!.target_id).toBe('acme/widget#7');
  });

  it('refuses when CI is failing', async () => {
    const { projectId, userId } = setupProject();
    stubGitHub(basePR, 'failure');
    const { mergePullRequest } = await import('../src/services/github/merge.service.js');
    await expect(mergePullRequest(projectId, userId, 7, 'MERGE', 'merge')).rejects.toThrowError(/failing/);
  });
});

describe('execution cross-tenant isolation', () => {
  it('another user cannot read an execution via their own project id', async () => {
    const alice = makeUser('alice3');
    const mallory = makeUser('mallory3');
    setAISettings(alice.id, { baseUrl: 'https://fake.example/v1', apiKey: 'sk-test', model: 'm' });
    const projectId = makeProject(alice.id, 'AliceSecret').id;
    getDb().prepare('UPDATE projects SET repo_full_name = ?, repo_default_branch = ? WHERE id = ?').run('acme/secret', 'main', projectId);
    setGitHubToken(alice.id, 'ghp_alice_token');
    const story = createStory(projectId, alice.id, { title: 'S', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });
    const task = createTask(projectId, alice.id, { storyId: story.id, title: 'T', description: '', priority: 'high' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    const execution = startExecution(task.id, alice.id, true);
    expect(['queued', 'running']).toContain(execution.status);

    const a = app();
    // mallory pairs HER project id with alice's execution id
    const malloryProject = makeProject(mallory.id, 'MalloryOwn').id;
    const stolen = await request(a)
      .get(`/api/projects/${malloryProject}/executions/${execution.id}`)
      .set(authed(mallory.token));
    expect(stolen.status).toBe(404);

    const owner = await request(a)
      .get(`/api/projects/${projectId}/executions/${execution.id}`)
      .set(authed(alice.token));
    expect(owner.status).toBe(200);
  });

  it('retrying an awaiting_review execution does not count itself as in-flight', async () => {
    const alice = makeUser('retrier2');
    setAISettings(alice.id, { baseUrl: 'https://fake.example/v1', apiKey: 'sk-test', model: 'm' });
    const projectId = makeProject(alice.id, 'Retryable').id;
    getDb()
      .prepare('UPDATE projects SET repo_full_name = ?, repo_default_branch = ? WHERE id = ?')
      .run('acme/widget', 'main', projectId);
    setGitHubToken(alice.id, 'ghp_alice_retry');
    const story = createStory(projectId, alice.id, { title: 'S', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });
    const task = createTask(projectId, alice.id, { storyId: story.id, title: 'T', description: '', priority: 'high' });

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('offline');
      })
    );
    const first = startExecution(task.id, alice.id, true);
    // force the terminal state the pipeline would reach without Docker
    getDb()
      .prepare("UPDATE executions SET status = 'awaiting_review', finished_at = ? WHERE id = ?")
      .run(new Date().toISOString(), first.id);

    const { retryExecution } = await import('../src/services/execution/pipeline.js');
    const second = retryExecution(first.id, alice.id, true);
    expect(['queued', 'running']).toContain(second.status);
    expect(second.id).not.toBe(first.id);
  });
});

describe('auth rate limiting', () => {
  it('returns 429 after the configured burst', async () => {
    const a = app();
    let lastStatus = 0;
    for (let i = 0; i < 31; i++) {
      const res = await request(a)
        .post('/api/auth/login')
        .send({ email: 'nobody@example.com', password: 'wrong-password' });
      lastStatus = res.status;
      if (i < 29) expect(res.status).toBe(401);
    }
    expect(lastStatus).toBe(429);
    const res = await request(a).post('/api/auth/login').send({ email: 'nobody@example.com', password: 'wrong-password' });
    expect(res.body.error.code).toBe('RATE_LIMITED');
  });
});

describe('project write protection (PATCH/DELETE cross-user)', () => {
  it('other users get 404 on PATCH and DELETE; owner can delete', async () => {
    const alice = makeUser('owner1');
    const mallory = makeUser('mallory4');
    const projectId = makeProject(alice.id, 'DeleteMe').id;
    const a = app();

    const patch = await request(a)
      .patch(`/api/projects/${projectId}`)
      .set(authed(mallory.token))
      .send({ name: 'Hacked Name' });
    expect(patch.status).toBe(404);

    const del = await request(a).delete(`/api/projects/${projectId}`).set(authed(mallory.token));
    expect(del.status).toBe(404);

    const delOwner = await request(a).delete(`/api/projects/${projectId}`).set(authed(alice.token));
    expect(delOwner.status).toBe(200);
    const gone = await request(a).get(`/api/projects/${projectId}`).set(authed(alice.token));
    expect(gone.status).toBe(404);
  });
});

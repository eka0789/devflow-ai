import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, freshDb, makeProject, makeUser } from './helpers.js';
import { verifySignature, processWebhook } from '../src/services/github/webhooks.service.js';
import { getDb } from '../src/db/database.js';

beforeEach(() => freshDb());

describe('webhook signature validation', () => {
  it('rejects when the webhook secret is not configured', () => {
    // config loads GITHUB_WEBHOOK_SECRET at import time; test setup unsets it
    expect(verifySignature('{}', 'sha256=abc')).toBe(false);
    expect(verifySignature('{}', undefined)).toBe(false);
  });
});

describe('webhook processing', () => {
  it('deduplicates deliveries by id', () => {
    const payload = { repository: { full_name: 'o/r' } };
    const first = processWebhook('push', 'delivery-1', payload);
    expect(first.ok).toBe(true);
    const second = processWebhook('push', 'delivery-1', payload);
    expect(second.note).toMatch(/duplicate/);
  });

  it('maps pull_request events to activity and notifications', () => {
    const user = makeUser('hook');
    const project = makeProject(user.id, 'Hooked');
    const db = getDb();
    db.prepare('UPDATE projects SET repo_full_name = ? WHERE id = ?').run('acme/widget', project.id);

    processWebhook('pull_request', 'd-2', {
      action: 'opened',
      repository: { full_name: 'acme/widget' },
      pull_request: { number: 7, title: 'Add feature', merged: false, html_url: 'https://github.com/acme/widget/pull/7', state: 'open' },
    });

    const activity = db
      .prepare('SELECT * FROM activities WHERE project_id = ? ORDER BY rowid DESC')
      .all(project.id) as unknown as Array<{ type: string; message: string }>;
    expect(activity[0]!.type).toBe('github.pull_request');

    const notifications = db.prepare('SELECT * FROM notifications WHERE user_id = ?').all(user.id) as unknown as Array<{ type: string }>;
    expect(notifications.some((n) => n.type === 'github.pr_opened')).toBe(true);
  });

  it('records push commits into the project activity feed', () => {
    const user = makeUser('push');
    const project = makeProject(user.id, 'Pushed');
    const db = getDb();
    db.prepare('UPDATE projects SET repo_full_name = ? WHERE id = ?').run('acme/widget', project.id);

    processWebhook('push', 'd-3', {
      ref: 'refs/heads/main',
      repository: { full_name: 'acme/widget' },
      commits: [{ message: 'fix: a' }, { message: 'fix: b' }],
    });
    const activity = db
      .prepare('SELECT * FROM activities WHERE project_id = ? ORDER BY rowid DESC')
      .all(project.id) as unknown as Array<{ type: string; message: string }>;
    expect(activity[0]!.type).toBe('github.push');
    expect(activity[0]!.message).toContain('2 commit(s)');
  });
});

describe('webhook HTTP endpoint', () => {
  it('401s on an invalid signature (no secret configured → nothing verifies)', async () => {
    const a = app();
    const res = await request(a)
      .post('/api/webhooks/github')
      .set('X-GitHub-Event', 'push')
      .set('X-GitHub-Delivery', 'd-10')
      .set('X-Hub-Signature-256', 'sha256=deadbeef')
      .send({ repository: { full_name: 'o/r' } });
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('FORBIDDEN');
  });

  it('rejects missing event headers', async () => {
    const a = app();
    const res = await request(a).post('/api/webhooks/github').send('{}');
    expect(res.status).toBe(400);
  });
});

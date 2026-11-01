import { beforeEach, describe, expect, it } from 'vitest';
import request from 'supertest';
import { app, authed, freshDb, makeProject, makeUser, type TestUser } from './helpers.js';
import { resetRateLimits } from '../src/middleware/rateLimit.js';

beforeEach(() => {
  freshDb();
  resetRateLimits();
});

describe('auth flow over HTTP', () => {
  it('registers, logs in and reads the session', async () => {
    const a = app();
    const reg = await request(a)
      .post('/api/auth/register')
      .send({ name: 'Ada Lovelace', email: 'ada@example.com', password: 'password-123' });
    expect(reg.status).toBe(200);
    expect(reg.body.data.token).toBeTruthy();
    expect(reg.body.data.workspace.name).toContain('Ada');

    const login = await request(a)
      .post('/api/auth/login')
      .send({ email: 'ada@example.com', password: 'password-123' });
    expect(login.status).toBe(200);

    const me = await request(a).get('/api/auth/me').set(authed(login.body.data.token));
    expect(me.body.data.user.email).toBe('ada@example.com');
  });

  it('rejects bad credentials, duplicate email and weak passwords', async () => {
    const a = app();
    await request(a).post('/api/auth/register').send({ name: 'Bob', email: 'bob@example.com', password: 'password-123' });

    const bad = await request(a).post('/api/auth/login').send({ email: 'bob@example.com', password: 'nope-nope' });
    expect(bad.status).toBe(401);
    expect(bad.body.error.code).toBe('UNAUTHENTICATED');

    const dup = await request(a).post('/api/auth/register').send({ name: 'Bob 2', email: 'bob@example.com', password: 'password-123' });
    expect(dup.status).toBe(409);

    const weak = await request(a).post('/api/auth/register').send({ name: 'Cara', email: 'c@example.com', password: 'short' });
    expect(weak.status).toBe(422);
    expect(weak.body.error.code).toBe('VALIDATION_FAILED');
  });

  it('requires a bearer token for protected routes', async () => {
    const a = app();
    const res = await request(a).get('/api/projects');
    expect(res.status).toBe(401);
    expect(res.body.error.code).toBe('UNAUTHENTICATED');
  });

  it('rejects tampered tokens', async () => {
    const a = app();
    const u = makeUser('tamper');
    const res = await request(a).get('/api/projects').set(authed(u.token + 'x'));
    expect(res.status).toBe(401);
  });
});

describe('ownership isolation', () => {
  it('hides other users projects (404, not 403)', async () => {
    const alice: TestUser = makeUser('alice');
    const mallory: TestUser = makeUser('mallory');
    const project = makeProject(alice.id);

    const a = app();
    const ok = await request(a).get(`/api/projects/${project.id}`).set(authed(alice.token));
    expect(ok.status).toBe(200);

    const denied = await request(a).get(`/api/projects/${project.id}`).set(authed(mallory.token));
    expect(denied.status).toBe(404);

    const listMallory = await request(a).get('/api/projects').set(authed(mallory.token));
    expect(listMallory.body.data).toHaveLength(0);
  });
});

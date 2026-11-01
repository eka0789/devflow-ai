import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, authed, freshDb, makeProject, makeUser } from './helpers.js';
import { setAISettings } from '../src/services/settings.service.js';
import { createStory, createTask, transitionEntity } from '../src/services/backlog.service.js';
import { precheckTaskExecution, startExecution } from '../src/services/execution/pipeline.js';

beforeEach(() => {
  freshDb();
  vi.unstubAllGlobals();
});

describe('chat streaming over HTTP', () => {
  it('streams SSE deltas and persists both messages', async () => {
    const user = makeUser('chatter');
    setAISettings(user.id, { baseUrl: 'https://fake.example/v1', apiKey: 'sk-test', model: 'test-model' });

    const sse = [
      ': ping',
      'data: {"choices":[{"delta":{"content":"Hello "}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"world"}}]}',
      '',
      'data: {"usage":{"prompt_tokens":9,"completion_tokens":2}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => new Response(sse, { status: 200 }))
    );

    const a = app();
    const conv = await request(a).post('/api/conversations').set(authed(user.token)).send({});
    expect(conv.status).toBe(200);
    const convId = conv.body.data.id as string;

    const stream = await request(a)
      .post(`/api/conversations/${convId}/chat`)
      .set({ ...authed(user.token), Accept: 'text/event-stream' })
      .send({ content: 'Say hello' });
    expect(stream.status).toBe(200);
    expect(stream.text).toContain('event: delta');
    expect(stream.text).toContain('Hello ');
    expect(stream.text).toContain('event: done');

    const history = await request(a).get(`/api/conversations/${convId}`).set(authed(user.token));
    const messages = history.body.data.messages as Array<{ role: string; content: string; model: string | null }>;
    expect(messages).toHaveLength(2);
    expect(messages[0]!.role).toBe('user');
    expect(messages[1]!.content).toBe('Hello world');
    expect(messages[1]!.model).toBe('test-model');
  });

  it('returns a structured error when no AI provider is configured', async () => {
    const user = makeUser('noai');
    const a = app();
    const conv = await request(a).post('/api/conversations').set(authed(user.token)).send({});
    const stream = await request(a)
      .post(`/api/conversations/${conv.body.data.id}/chat`)
      .set(authed(user.token))
      .send({ content: 'hi' });
    expect(stream.status).toBe(200);
    expect(stream.text).toContain('AI_NOT_CONFIGURED');
    expect(stream.text).toContain('event: error');
  });

  it('conversation ownership is enforced', async () => {
    const alice = makeUser('alice2');
    const mallory = makeUser('mallory2');
    const a = app();
    const conv = await request(a).post('/api/conversations').set(authed(alice.token)).send({});
    const res = await request(a).get(`/api/conversations/${conv.body.data.id}`).set(authed(mallory.token));
    expect(res.status).toBe(404);
  });
});

describe('execution prechecks', () => {
  it('lists every missing requirement honestly', () => {
    const user = makeUser('exec');
    const projectId = makeProject(user.id, 'Exec').id;
    const story = createStory(projectId, user.id, { title: 'S', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });
    const task = createTask(projectId, user.id, { storyId: story.id, title: 'Do work', description: '', priority: 'high' });

    const { checks } = precheckTaskExecution(task.id, user.id);
    expect(checks.ai).toBe(false);
    expect(checks.repo).toBe(false);
    expect(checks.githubToken).toBe(false);
    expect(checks.taskStatus).toBe(true); // tasks start in todo
    expect(checks.noInFlight).toBe(true);

    expect(() => startExecution(task.id, user.id, true)).toThrowError(/requirements not met/);
  });

  it('refuses a task that is done', () => {
    const user = makeUser('exec2');
    const projectId = makeProject(user.id).id;
    const story = createStory(projectId, user.id, { title: 'S', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });
    const task = createTask(projectId, user.id, { storyId: story.id, title: 'T', description: '', priority: 'high' });
    const { checks } = precheckTaskExecution(task.id, user.id);
    expect(checks.taskStatus).toBe(true);
    // move to done via the legal path
    for (const status of ['in_progress', 'in_review', 'done'] as const) {
      transitionEntity('task', projectId, task.id, user.id, { status });
    }
    const after = precheckTaskExecution(task.id, user.id);
    expect(after.checks.taskStatus).toBe(false);
  });
});

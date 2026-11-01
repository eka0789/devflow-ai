import { beforeEach, describe, expect, it } from 'vitest';
import { getDb } from '../src/db/database.js';
import { freshDb, makeProject, makeUser } from './helpers.js';
import {
  backlogProposalSchema,
  serializeRun,
  startWorkflow,
  AGENTS,
} from '../src/services/ai/agents.service.js';
import { approveDraft, listDrafts } from '../src/services/drafts.service.js';
import { getBacklogTree } from '../src/services/backlog.service.js';
import { MockProvider, OpenAICompatibleProvider } from '../src/services/ai/provider.js';
import { resolveAI, setAISettings } from '../src/services/settings.service.js';

beforeEach(() => freshDb());

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('agent registry', () => {
  it('defines all seven required agents', () => {
    const roles = Object.keys(AGENTS);
    expect(roles).toEqual(
      expect.arrayContaining([
        'product_manager',
        'architect',
        'scrum_master',
        'developer',
        'code_reviewer',
        'qa_engineer',
        'technical_writer',
      ])
    );
  });
});

describe('planning workflow (mock provider, no credentials)', () => {
  it('runs the full planning workflow, produces drafts and materializes approved backlog', async () => {
    const user = makeUser('pm');
    const projectId = makeProject(user.id, 'Orchestrated').id;

    const run = startWorkflow(projectId, user.id, 'full_planning', 'Build a habit tracker with streak analytics');
    expect(run.status).toBe('running');

    // wait for the fire-and-forget workflow to settle (mock provider is fast)
    let row = serializeRun(getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(run.id) as unknown as Record<string, unknown>);
    for (let i = 0; i < 100 && row.status === 'running'; i++) {
      await wait(20);
      row = serializeRun(getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(run.id) as unknown as Record<string, unknown>);
    }
    expect(row.status).toBe('succeeded');
    expect(row.steps.length).toBe(3);
    expect(row.steps.every((s) => s.status === 'ok')).toBe(true);

    const drafts = listDrafts(projectId, user.id, null);
    const types = drafts.map((d) => d.type).sort();
    expect(types).toEqual(['backlog', 'prd', 'tech_plan']);

    // backlog draft validates against the strict schema
    const backlogDraft = drafts.find((d) => d.type === 'backlog')!;
    const parsed = backlogProposalSchema.safeParse(JSON.parse(backlogDraft.content));
    expect(parsed.success).toBe(true);

    // approval creates REAL records
    const before = getBacklogTree(projectId, user.id);
    expect(before.stories).toHaveLength(0);
    const result = approveDraft(projectId, backlogDraft.id, user.id, true);
    expect(result.created).toBeDefined();
    expect(result.created!.stories).toBeGreaterThan(0);
    expect(result.created!.tasks).toBeGreaterThan(0);

    const after = getBacklogTree(projectId, user.id);
    expect(after.epics.length).toBeGreaterThan(0);
    expect(after.stories.length).toBe(result.created!.stories);
    expect(after.tasks.length).toBe(result.created!.tasks);
  });

  it('rejects a second workflow while one is running', () => {
    const user = makeUser('pm2');
    const projectId = makeProject(user.id).id;
    // deterministic: simulate an in-flight run
    getDb()
      .prepare("INSERT INTO agent_runs (id, project_id, user_id, workflow, status, steps, created_at) VALUES (?, ?, ?, ?, 'running', '[]', ?)")
      .run('11111111-1111-4111-8111-111111111111', projectId, user.id, 'prd_only', new Date().toISOString());
    expect(() => startWorkflow(projectId, user.id, 'prd_only', 'Another vision long enough')).toThrowError(/already running/);
  });

  it('approval is idempotent-safe: approving twice is rejected', async () => {
    const user = makeUser('pm3');
    const projectId = makeProject(user.id).id;
    startWorkflow(projectId, user.id, 'backlog_only', 'Vision for backlog generation test');
    await wait(300);
    const drafts = listDrafts(projectId, user.id, 'backlog');
    expect(drafts.length).toBeGreaterThan(0);
    approveDraft(projectId, drafts[0]!.id, user.id, true);
    expect(() => approveDraft(projectId, drafts[0]!.id, user.id, true)).toThrowError(/already/);
  });
});

describe('mock provider is clearly labeled and schema-valid', () => {
  it('returns structured backlog JSON for the backlog kind', async () => {
    const provider = new MockProvider();
    const result = await provider.complete({
      model: 'mock-1',
      mockKind: 'backlog',
      messages: [{ role: 'user', content: 'vision here' }],
    });
    const parsed = backlogProposalSchema.safeParse(JSON.parse(result.content));
    expect(parsed.success).toBe(true);
  });

  it('chat output discloses mock mode', async () => {
    const provider = new MockProvider();
    const result = await provider.complete({ model: 'mock', messages: [{ role: 'user', content: 'hi' }] });
    expect(result.content).toMatch(/Mock AI response/);
  });
});

describe('openai-compatible provider', () => {
  it('parses completions and reports usage', async () => {
    const fetchMock = async (url: string | URL): Promise<Response> => {
      expect(String(url)).toContain('/chat/completions');
      return new Response(
        JSON.stringify({
          choices: [{ message: { content: 'Hello from fake provider' } }],
          usage: { prompt_tokens: 12, completion_tokens: 7 },
        }),
        { status: 200, headers: { 'Content-Type': 'application/json' } }
      );
    };
    vi_global(fetchMock);
    const provider = new OpenAICompatibleProvider('https://fake.example/v1', 'sk-test');
    const result = await provider.complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] });
    expect(result.content).toBe('Hello from fake provider');
    expect(result.tokensIn).toBe(12);
    expect(result.tokensOut).toBe(7);
    vi_restore();
  });

  it('streams SSE deltas and finalizes with usage', async () => {
    const sse = [
      'data: {"choices":[{"delta":{"content":"Hel"}}]}',
      '',
      'data: {"choices":[{"delta":{"content":"lo"}}]}',
      '',
      'data: {"choices":[{"delta":{}}],"usage":{"prompt_tokens":5,"completion_tokens":2}}',
      '',
      'data: [DONE]',
      '',
    ].join('\n');
    vi_global(async () => new Response(sse, { status: 200 }));
    const provider = new OpenAICompatibleProvider('https://fake.example/v1', 'sk-test');
    let text = '';
    let usage: { tokensIn: number; tokensOut: number } | null = null;
    for await (const chunk of provider.stream({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })) {
      if (chunk.delta) text += chunk.delta;
      if (chunk.usage) usage = chunk.usage;
    }
    expect(text).toBe('Hello');
    expect(usage).toEqual({ tokensIn: 5, tokensOut: 2 });
    vi_restore();
  });

  it('maps provider errors to structured AppError', async () => {
    vi_global(async () => new Response(JSON.stringify({ error: { message: 'quota exceeded' } }), { status: 429 }));
    const provider = new OpenAICompatibleProvider('https://fake.example/v1', 'sk-test');
    await expect(provider.complete({ model: 'm', messages: [{ role: 'user', content: 'hi' }] })).rejects.toThrowError(/quota|429/);
    vi_restore();
  });
});

// --- fetch stub helpers (vitest globals are not enabled in this config) ---
import { vi } from 'vitest';
function vi_global(fn: (input: string | URL, init?: RequestInit) => Promise<Response>): void {
  vi.stubGlobal('fetch', vi.fn(fn));
}
function vi_restore(): void {
  vi.unstubAllGlobals();
}

describe('AI settings resolution', () => {
  it('reports unconfigured without env or user settings', () => {
    const user = makeUser('cfg');
    // freshDb ensures no user settings; env vars removed in test setup
    expect(resolveAI(user.id)).toBeNull();
  });

  it('resolves user settings after they are saved', () => {
    const user = makeUser('cfg2');
    setAISettings(user.id, { baseUrl: 'https://api.example.com/v1', apiKey: 'sk-live-xyz', model: 'model-x' });
    const resolved = resolveAI(user.id);
    expect(resolved).not.toBeNull();
    expect(resolved!.apiKey).toBe('sk-live-xyz');
    expect(resolved!.model).toBe('model-x');
  });
});

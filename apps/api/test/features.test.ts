/**
 * Tests for the v2 feature set: global search, task comments, sprint review
 * workflow, project export, and execution retry prechecks.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';
import request from 'supertest';
import { app, authed, freshDb, getDb, makeProject, makeUser } from './helpers.js';
import { createStory, createTask, transitionEntity } from '../src/services/backlog.service.js';
import { activateSprint, assignStory, completeSprint, createSprint } from '../src/services/sprints.service.js';
import { searchAll } from '../src/services/search.service.js';
import * as comments from '../src/services/comments.service.js';
import { exportProject } from '../src/services/projects.service.js';
import { startSprintReview } from '../src/services/ai/agents.service.js';
import { precheckTaskExecution, startExecution } from '../src/services/execution/pipeline.js';
import { addStoryDependency, getBacklogTree, removeStoryDependency, updateStory, deleteStory } from '../src/services/backlog.service.js';
import { AppError } from '../src/util/appError.js';

beforeEach(() => {
  freshDb();
  vi.unstubAllGlobals();
});

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('global search', () => {
  it('finds projects, stories and tasks owned by the user only', () => {
    const alice = makeUser('searcher');
    const mallory = makeUser('hider');
    const pA = makeProject(alice.id, 'Aurora Platform');
    const pM = makeProject(mallory.id, 'Mallory Secret Aurora');
    const story = createStory(pA.id, alice.id, {
      title: 'Implement authentication flow',
      description: '',
      points: 5,
      priority: 'high',
      acceptanceCriteria: [],
    });
    createTask(pA.id, alice.id, { storyId: story.id, title: 'Build login screen', description: '', priority: 'high' });
    createStory(pM.id, mallory.id, {
      title: 'Aurora hidden story',
      description: '',
      points: 1,
      priority: 'low',
      acceptanceCriteria: [],
    });

    const results = searchAll(alice.id, 'aurora');
    expect(results.projects.map((p) => p.id)).toEqual([pA.id]); // mallory's project excluded
    const auth = searchAll(alice.id, 'authentication');
    expect(auth.stories).toHaveLength(1);
    expect(auth.stories[0]!.id).toBe(story.id);
    // contract shape: camelCase + parsed arrays (correctness review, verified repro)
    expect(auth.stories[0]!.projectId).toBe(pA.id);
    expect(auth.stories[0]!.acceptanceCriteria).toEqual([]);
    expect(auth.tasks).toHaveLength(0); // the task title does not contain the query
    const byTask = searchAll(alice.id, 'login screen');
    expect(byTask.tasks).toHaveLength(1);
    expect(byTask.tasks[0]!.storyId).toBe(story.id);
    expect(byTask.tasks[0]!.projectId).toBe(pA.id);

    // LIKE wildcards in user input are matched literally
    const literal = searchAll(alice.id, '%aurora%');
    expect(literal.projects).toHaveLength(0);
    expect(literal.stories).toHaveLength(0);
  });

  it('serves the HTTP endpoint with ownership scoping', async () => {
    const alice = makeUser('searchhttp');
    makeProject(alice.id, 'Findable Project');
    const mallory = makeUser('searchhttp2');
    makeProject(mallory.id, 'Findable Hidden');
    const a = app();
    const res = await request(a).get('/api/search?q=findable').set(authed(alice.token));
    expect(res.status).toBe(200);
    expect(res.body.data.projects).toHaveLength(1);
  });
});

describe('task comments', () => {
  it('adds, lists and deletes comments; non-authors cannot delete', async () => {
    const alice = makeUser('commenter');
    const bob = makeUser('bystander');
    const projectId = makeProject(alice.id).id;
    const story = createStory(projectId, alice.id, { title: 'S', description: '', points: 2, priority: 'medium', acceptanceCriteria: [] });
    const task = createTask(projectId, alice.id, { storyId: story.id, title: 'T', description: '', priority: 'medium' });

    const c1 = comments.addComment(projectId, task.id, alice.id, 'First observation');
    comments.addComment(projectId, task.id, alice.id, 'Second note');

    const list = comments.listComments(projectId, task.id, alice.id);
    expect(list).toHaveLength(2);
    expect(list[0]!.body).toBe('First observation');
    expect(list[0]!.userName).toBe('commenter');

    // bob is not the author: deletion is refused without revealing the comment
    expect(() => comments.deleteComment(projectId, task.id, c1.id, bob.id)).toThrowError(AppError);

    comments.deleteComment(projectId, task.id, c1.id, alice.id);
    expect(comments.listComments(projectId, task.id, alice.id)).toHaveLength(1);
  });

  it('comments appear in the task detail payload over HTTP', async () => {
    const alice = makeUser('detailc');
    const projectId = makeProject(alice.id).id;
    const story = createStory(projectId, alice.id, { title: 'S', description: '', points: 2, priority: 'medium', acceptanceCriteria: [] });
    const task = createTask(projectId, alice.id, { storyId: story.id, title: 'T', description: '', priority: 'medium' });
    comments.addComment(projectId, task.id, alice.id, 'From the HTTP test');

    const a = app();
    const res = await request(a)
      .post(`/api/projects/${projectId}/tasks/${task.id}/comments`)
      .set(authed(alice.token))
      .send({ body: 'Posted via HTTP' });
    expect(res.status).toBe(200);

    const detail = await request(a).get(`/api/projects/${projectId}/tasks/${task.id}`).set(authed(alice.token));
    const bodies = (detail.body.data.comments as Array<{ body: string }>).map((c) => c.body);
    expect(bodies).toContain('From the HTTP test');
    expect(bodies).toContain('Posted via HTTP');
  });
});

describe('sprint review & retrospective', () => {
  it('refuses reviews for sprints that are not completed', async () => {
    const user = makeUser('reviewer1');
    const projectId = makeProject(user.id).id;
    const sprint = createSprint(projectId, user.id, { name: 'S1', goal: '' });
    expect(() => startSprintReview(projectId, sprint.id, user.id)).toThrowError(/completed sprints only/);
  });

  it('generates a review draft from the frozen snapshot of a completed sprint', async () => {
    const user = makeUser('reviewer2');
    const projectId = makeProject(user.id, 'Reviewed').id;
    const sprint = createSprint(projectId, user.id, { name: 'Sprint Zero', goal: 'prove the loop' });
    const s1 = createStory(projectId, user.id, { title: 'Done story', description: '', points: 5, priority: 'high', acceptanceCriteria: [] });
    const s2 = createStory(projectId, user.id, { title: 'Pending story', description: '', points: 3, priority: 'low', acceptanceCriteria: [] });
    assignStory(projectId, sprint.id, s1.id, user.id);
    assignStory(projectId, sprint.id, s2.id, user.id);
    for (const status of ['todo', 'in_progress', 'in_review', 'done'] as const) {
      await import('../src/services/backlog.service.js').then((m) => m.transitionEntity('story', projectId, s1.id, user.id, { status }));
    }
    activateSprint(projectId, sprint.id, user.id);
    completeSprint(projectId, sprint.id, user.id);

    const run = startSprintReview(projectId, sprint.id, user.id);
    expect(run.workflow).toBe('sprint_review');

    let row = getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(run.id) as unknown as Record<string, unknown>;
    for (let i = 0; i < 150 && String(row.status) === 'running'; i++) {
      await wait(20);
      row = getDb().prepare('SELECT * FROM agent_runs WHERE id = ?').get(run.id) as unknown as Record<string, unknown>;
    }
    expect(row.status).toBe('succeeded');

    const drafts = getDb()
      .prepare("SELECT * FROM drafts WHERE project_id = ? AND type = 'sprint_review'")
      .all(projectId) as unknown as Array<{ content: string }>;
    expect(drafts.length).toBe(1);
    // the draft is grounded in real numbers, not invented ones
    expect(drafts[0]!.content).toContain('5 pts');
    expect(drafts[0]!.content).toContain('8 pts');
  });
});

describe('project export', () => {
  it('exports a complete, secret-free snapshot', async () => {
    const user = makeUser('exporter');
    const projectId = makeProject(user.id, 'Exported', ).id;
    void makeProject;
    const story = createStory(projectId, user.id, {
      title: 'Exported story',
      description: 'desc',
      points: 3,
      priority: 'high',
      acceptanceCriteria: ['works', 'tested'],
    });
    const task = createTask(projectId, user.id, { storyId: story.id, title: 'Exported task', description: '', priority: 'low' });
    const sprint = createSprint(projectId, user.id, { name: 'S1', goal: '' });
    assignStory(projectId, sprint.id, story.id, user.id);

    const data = exportProject(projectId, user.id);
    expect(data.format).toBe('devflow-project/v1');
    expect(data.project.name).toBe('Exported');
    expect(data.stories[0]!.acceptanceCriteria).toEqual(['works', 'tested']);
    expect(data.tasks[0]!.id).toBe(task.id);
    expect(data.sprints[0]!.name).toBe('S1');
    expect(data.dependencies.stories).toHaveLength(0);
    // no secret material ever leaks into an export
    const serialized = JSON.stringify(data);
    expect(serialized).not.toContain('token');
    expect(serialized).not.toContain('apiKey');

    const a = app();
    const res = await request(a).get(`/api/projects/${projectId}/export`).set(authed(user.token));
    expect(res.status).toBe(200);
    expect(res.body.data.stories).toHaveLength(1);
  });
});

describe('dependency & sprint guards (correctness review)', () => {
  it('rejects cross-tenant dependency removal', () => {
    const alice = makeUser('depa');
    const mallory = makeUser('depb');
    const pA = makeProject(alice.id).id;
    const sA = createStory(pA, alice.id, { title: 'SA', description: '', points: 1, priority: 'low', acceptanceCriteria: [] });
    const sB = createStory(pA, alice.id, { title: 'SB', description: '', points: 1, priority: 'low', acceptanceCriteria: [] });
    addStoryDependency(pA, sA.id, sB.id, alice.id);

    const pM = makeProject(mallory.id).id;
    expect(() => removeStoryDependency(pM, sA.id, sB.id, mallory.id)).toThrowError(AppError);
    // the dependency is untouched
    const tree = getBacklogTree(pA, alice.id);
    expect(tree.dependencies.stories).toHaveLength(1);
  });

  it('refuses sprint assignment for a done story via PATCH (mirrors assignStory)', () => {
    const user = makeUser('doneguard');
    const projectId = makeProject(user.id).id;
    const story = createStory(projectId, user.id, { title: 'Will finish', description: '', points: 2, priority: 'medium', acceptanceCriteria: [] });
    for (const status of ['todo', 'in_progress', 'in_review', 'done'] as const) {
      transitionEntity('story', projectId, story.id, user.id, { status });
    }
    const sprint = createSprint(projectId, user.id, { name: 'S', goal: '' });
    expect(() =>
      updateStory(projectId, story.id, user.id, { sprintId: sprint.id })
    ).toThrowError(/completed story/);
  });

  it('deleteStory cascades tasks (FK enforcement on)', () => {
    const user = makeUser('cascader');
    const projectId = makeProject(user.id).id;
    const story = createStory(projectId, user.id, { title: 'S', description: '', points: 2, priority: 'medium', acceptanceCriteria: [] });
    const task = createTask(projectId, user.id, { storyId: story.id, title: 'T', description: '', priority: 'low' });
    comments.addComment(projectId, task.id, user.id, 'will vanish with the task');
    deleteStory(projectId, story.id, user.id);
    const left = getDb().prepare('SELECT COUNT(*) AS c FROM tasks WHERE id = ?').get(task.id) as { c: number };
    expect(left.c).toBe(0);
  });
});

describe('execution retry prechecks', () => {
  it('refuses retry while requirements are missing', async () => {
    const user = makeUser('retrier');
    const projectId = makeProject(user.id).id;
    const story = createStory(projectId, user.id, { title: 'S', description: '', points: 2, priority: 'medium', acceptanceCriteria: [] });
    const task = createTask(projectId, user.id, { storyId: story.id, title: 'T', description: '', priority: 'high' });
    const { checks } = precheckTaskExecution(task.id, user.id);
    expect(checks.ai).toBe(false);
    // retry shares the same requirement enforcement
    expect(() => startExecution(task.id, user.id, true)).toThrowError(/requirements not met/);
  });
});

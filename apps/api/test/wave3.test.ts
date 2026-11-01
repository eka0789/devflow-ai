/**
 * Wave 3 feature tests: workspace membership & roles, assignee/due dates,
 * labels, mentions, my-work, import round-trip, roadmap, outgoing webhooks.
 */
import { beforeEach, describe, expect, it, vi, afterEach } from 'vitest';
import request from 'supertest';
import { app, authed, freshDb, getDb, makeProject, makeUser } from './helpers.js';
import {
  createEpic,
  createStory,
  createTask,
  updateStory,
  updateTask,
  transitionEntity,
} from '../src/services/backlog.service.js';
import { createLabel, setStoryLabels, labelsForStory } from '../src/services/labels.service.js';
import * as workspace from '../src/services/workspace.service.js';
import { importProject } from '../src/services/import.service.js';
import { getRoadmap } from '../src/services/sprints.service.js';
import { getMyWork } from '../src/services/analytics.service.js';
import { exportProject } from '../src/services/projects.service.js';
import * as outgoing from '../src/services/outgoing-webhooks.service.js';
import { addComment } from '../src/services/comments.service.js';
import * as events from '../src/services/events.service.js';

beforeEach(() => {
  freshDb();
  vi.unstubAllGlobals();
});
afterEach(() => vi.unstubAllGlobals());

function wait(ms: number): Promise<void> {
  return new Promise((r) => setTimeout(r, ms));
}

describe('workspace membership & roles', () => {
  it('owner invites an existing user → member gains access; viewer is read-only', async () => {
    const owner = makeUser('wowner');
    const member = makeUser('wmember');
    const wsId = owner.workspaceId;

    workspace.inviteMember(wsId, owner.id, member.email, 'viewer');

    const projectId = makeProject(owner.id, 'Shared').id;
    // viewer can READ
    const a = app();
    const read = await request(a).get(`/api/projects/${projectId}`).set(authed(member.token));
    expect(read.status).toBe(200);
    // viewer cannot WRITE (403, not 404 — they are a member)
    const write = await request(a)
      .patch(`/api/projects/${projectId}`)
      .set(authed(member.token))
      .send({ name: 'Renamed by viewer' });
    expect(write.status).toBe(403);
    expect(write.body.error.code).toBe('FORBIDDEN');

    // promote to maintainer → write allowed
    workspace.updateMemberRole(wsId, member.id, 'maintainer', owner.id);
    const write2 = await request(a)
      .patch(`/api/projects/${projectId}`)
      .set(authed(member.token))
      .send({ name: 'Renamed by maintainer' });
    expect(write2.status).toBe(200);

    // strangers still get 404
    const stranger = makeUser('stranger1');
    const denied = await request(a).get(`/api/projects/${projectId}`).set(authed(stranger.token));
    expect(denied.status).toBe(404);
  });

  it('invites for unknown emails activate on registration/login with that email', async () => {
    const owner = makeUser('inviter');
    const wsId = owner.workspaceId;
    workspace.inviteMember(wsId, owner.id, 'future.member@example.com', 'maintainer');

    // the future member registers with the invited email
    const a = app();
    const reg = await request(a)
      .post('/api/auth/register')
      .send({ name: 'Future Member', email: 'future.member@example.com', password: 'password-123' });
    expect(reg.status).toBe(200);
    const newUserId = reg.body.data.user.id as string;

    const roster = workspace.getRoster(wsId, owner.id);
    expect(roster.members.some((m) => m.userId === newUserId && m.role === 'maintainer')).toBe(true);
    expect(roster.invites.some((i) => i.email === 'future.member@example.com' && i.acceptedAt)).toBe(false);
  });

  it('owner cannot be removed and cannot remove themselves as owner-entry', () => {
    const owner = makeUser('ownercannot');
    const wsId = owner.workspaceId;
    expect(() => workspace.removeMember(wsId, owner.id, owner.id)).toThrowError(/owner cannot be removed/);
  });

  it('roster requires membership; project list includes shared workspaces', async () => {
    const owner = makeUser('rosterowner');
    const member = makeUser('rostermember');
    workspace.inviteMember(owner.workspaceId, owner.id, member.email, 'viewer');
    makeProject(owner.id, 'OwnerOnly');

    const memberList = await request(app()).get('/api/workspace/roster').set(authed(member.token));
    expect(memberList.status).toBe(200);
    expect(memberList.body.data.members.some((m: { userId: string }) => m.userId === owner.id)).toBe(true);

    const list = await request(app()).get('/api/projects').set(authed(member.token));
    expect(list.body.data.some((p: { name: string }) => p.name === 'OwnerOnly')).toBe(true);
  });
});

describe('assignee + due date', () => {
  it('assigns workspace members; rejects strangers', () => {
    const owner = makeUser('assigner');
    const member = makeUser('assignee1');
    workspace.inviteMember(owner.workspaceId, owner.id, member.email, 'maintainer');
    const projectId = makeProject(owner.id).id;

    const story = createStory(projectId, owner.id, {
      title: 'Assigned story',
      description: '',
      points: 3,
      priority: 'high',
      acceptanceCriteria: [],
      assigneeUserId: member.id,
      dueDate: '2026-12-01',
    });
    expect(story.assigneeUserId).toBe(member.id);
    expect(story.assigneeName).toBe('assignee1');
    expect(story.dueDate).toBe('2026-12-01');

    const stranger = makeUser('stranger2');
    expect(() =>
      updateStory(projectId, story.id, owner.id, { assigneeUserId: stranger.id })
    ).toThrowError(/member of this workspace/);

    // unassign
    const cleared = updateStory(projectId, story.id, owner.id, { assigneeUserId: null });
    expect(cleared.assigneeUserId).toBeNull();
  });

  it('my-work lists assigned open items with project context, excluding done', () => {
    const owner = makeUser('myworker');
    const projectId = makeProject(owner.id, 'Mine').id;
    const open = createStory(projectId, owner.id, {
      title: 'Open assignment',
      description: '',
      points: 2,
      priority: 'high',
      acceptanceCriteria: [],
      assigneeUserId: owner.id,
    });
    const task = createTask(projectId, owner.id, {
      storyId: open.id,
      title: 'Open task',
      description: '',
      priority: 'high',
      assigneeUserId: owner.id,
      dueDate: '2026-11-15',
    });
    const doneStory = createStory(projectId, owner.id, {
      title: 'Finished assignment',
      description: '',
      points: 2,
      priority: 'low',
      acceptanceCriteria: [],
      assigneeUserId: owner.id,
    });
    for (const status of ['todo', 'in_progress', 'in_review', 'done'] as const) {
      transitionEntity('story', projectId, doneStory.id, owner.id, { status });
    }

    const work = getMyWork(owner.id);
    expect(work.stories.map((s) => s.id)).toEqual([open.id]); // done excluded
    expect(work.tasks.map((t) => t.id)).toEqual([task.id]);
    expect(work.tasks[0]!.projectName).toBe('Mine');
    expect(work.tasks[0]!.storyTitle).toBe('Open assignment');
    expect(work.tasks[0]!.dueDate).toBe('2026-11-15');
  });
});

describe('labels', () => {
  it('creates, attaches to stories, and filters round-trip', () => {
    const user = makeUser('labeler');
    const projectId = makeProject(user.id).id;
    const bug = createLabel(projectId, user.id, 'bug', '#e5484d');
    const ux = createLabel(projectId, user.id, 'ux', '#4cc2ff');

    const story = createStory(projectId, user.id, {
      title: 'Labeled story',
      description: '',
      points: 2,
      priority: 'medium',
      acceptanceCriteria: [],
      labelIds: [bug.id],
    });
    expect(labelsForStory(story.id).map((l) => l.name)).toEqual(['bug']);

    setStoryLabels(projectId, story.id, [bug.id, ux.id]);
    expect(labelsForStory(story.id).map((l) => l.name)).toEqual(['bug', 'ux']);

    // duplicate name rejected
    expect(() => createLabel(projectId, user.id, 'BUG', '#000000')).toThrowError(/already exists/);
  });

  it('labels appear in the backlog tree over HTTP', async () => {
    const user = makeUser('treelabel');
    const projectId = makeProject(user.id).id;
    const label = createLabel(projectId, user.id, 'infra', '#3fb68b');
    const story = createStory(projectId, user.id, {
      title: 'Tree story',
      description: '',
      points: 1,
      priority: 'low',
      acceptanceCriteria: [],
    });
    setStoryLabels(projectId, story.id, [label.id]);

    const res = await request(app()).get(`/api/projects/${projectId}/backlog`).set(authed(user.token));
    expect(res.body.data.labels).toHaveLength(1);
    expect(res.body.data.storyLabels[0]?.labelId).toBe(label.id);
  });
});

describe('mentions in comments', () => {
  it('notifies mentioned workspace members only', async () => {
    const owner = makeUser('mentioner');
    const member = makeUser('mentioned');
    workspace.inviteMember(owner.workspaceId, owner.id, member.email, 'viewer');
    const outsider = makeUser('outsider');
    const projectId = makeProject(owner.id).id;
    const story = createStory(projectId, owner.id, { title: 'S', description: '', points: 1, priority: 'low', acceptanceCriteria: [] });
    const task = createTask(projectId, owner.id, { storyId: story.id, title: 'T', description: '', priority: 'low' });

    addComment(projectId, task.id, owner.id, `ping @mentioned and @outsider and @ownercase`);

    const notes = getDb()
      .prepare('SELECT * FROM notifications WHERE user_id = ?')
      .all(member.id) as unknown as Array<{ type: string }>;
    expect(notes.some((n) => n.type === 'mention')).toBe(true);

    const outsiderNotes = getDb()
      .prepare('SELECT COUNT(*) AS c FROM notifications WHERE user_id = ?')
      .get(outsider.id) as { c: number };
    expect(outsiderNotes.c).toBe(0);
  });
});

describe('task timeline', () => {
  it('composes status events, executions and comments chronologically', async () => {
    const user = makeUser('timeliner');
    const projectId = makeProject(user.id).id;
    const story = createStory(projectId, user.id, { title: 'S', description: '', points: 1, priority: 'low', acceptanceCriteria: [] });
    const task = createTask(projectId, user.id, { storyId: story.id, title: 'T', description: '', priority: 'low' });
    transitionEntity('task', projectId, task.id, user.id, { status: 'in_progress' });
    addComment(projectId, task.id, user.id, 'working on it');

    const detail = await request(app()).get(`/api/projects/${projectId}/tasks/${task.id}`).set(authed(user.token));
    const timeline = detail.body.data.timeline as Array<{ kind: string; label: string }>;
    expect(timeline.some((t) => t.kind === 'status' && t.label.includes('in_progress'))).toBe(true);
    expect(timeline.some((t) => t.kind === 'comment')).toBe(true);
  });
});

describe('project import (round-trip with export)', () => {
  it('imports an exported snapshot with remapped references', () => {
    const owner = makeUser('importer');
    const sourceId = makeProject(owner.id, 'Source').id;
    const label = createLabel(sourceId, owner.id, 'keep', '#3fb68b');
    const story = createStory(sourceId, owner.id, {
      title: 'Exported story',
      description: 'd',
      points: 5,
      priority: 'high',
      acceptanceCriteria: ['works'],
      labelIds: [label.id],
    });
    createTask(sourceId, owner.id, { storyId: story.id, title: 'Exported task', description: '', priority: 'high' });
    const snapshot = exportProject(sourceId, owner.id);

    const result = importProject(owner.id, owner.workspaceId, { name: 'Imported Copy', data: snapshot });
    expect(result.counts.stories).toBe(1);
    expect(result.counts.tasks).toBe(1);

    const tree = getDb().prepare('SELECT * FROM stories WHERE project_id = ?').all(result.projectId) as unknown as Array<{
      id: string;
      title: string;
      project_id: string;
    }>;
    expect(tree[0]!.title).toBe('Exported story');
    expect(tree[0]!.project_id).toBe(result.projectId);
    // new project → fresh activity
    const activity = getDb()
      .prepare('SELECT * FROM activities WHERE project_id = ? AND type = ?')
      .get(result.projectId, 'project.imported') as unknown | undefined;
    expect(activity).toBeDefined();
  });

  it('rejects malformed import files with 422', async () => {
    const user = makeUser('badimport');
    const res = await request(app())
      .post('/api/projects/import')
      .set(authed(user.token))
      .send({ data: { format: 'nope' } });
    expect(res.status).toBe(422);
  });
});

describe('roadmap', () => {
  it('computes epic/sprint spans from real dates only', () => {
    const user = makeUser('planner');
    const projectId = makeProject(user.id, 'Roadmapped').id;
    const epic = createEpic(projectId, user.id, { title: 'Delivery', description: '', color: '#6E7BFF' });
    const story = createStory(projectId, user.id, {
      title: 'S',
      description: '',
      points: 3,
      priority: 'medium',
      acceptanceCriteria: [],
      dueDate: '2026-12-20',
      epicId: epic.id,
    });
    for (const status of ['todo', 'in_progress', 'in_review', 'done'] as const) {
      transitionEntity('story', projectId, story.id, user.id, { status });
    }

    const roadmap = getRoadmap(projectId, user.id);
    expect(roadmap.items).toHaveLength(1); // epic, no sprints yet
    expect(roadmap.items[0]!.totalPoints).toBe(3);
    expect(roadmap.items[0]!.donePoints).toBe(3);
    expect(roadmap.maxDate).toBe('2026-12-20');
    // dates are never invented beyond the data
    expect(new Date(roadmap.minDate).toString()).not.toBe('Invalid Date');
  });
});

describe('outgoing webhooks', () => {
  it('fans out matching events with HMAC signature; skips non-matching', async () => {
    const user = makeUser('hookuser');
    let captured: { url: string; headers: Record<string, string>; body: string } | null = null;
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL, init?: RequestInit) => {
        captured = {
          url: String(input),
          headers: Object.fromEntries(Object.entries(init?.headers ?? {})),
          body: String(init?.body ?? ''),
        };
        return new Response('{}', { status: 200 });
      })
    );

    outgoing.createWebhook(user.id, {
      url: 'https://hooks.example/devflow',
      format: 'discord',
      events: ['execution.succeeded'],
      secret: 'whsec_super_secret',
    });

    // non-matching event → no HTTP call
    events.notify(user.id, 'github.pr_merged', 'PR merged', 'details');
    await wait(80);
    expect(captured).toBeNull();

    events.notify(user.id, 'execution.succeeded', 'Execution succeeded', 'all green');
    await wait(120);
    expect(captured).not.toBeNull();
    expect((captured as unknown as { url: string }).url).toBe('https://hooks.example/devflow');
    const body = JSON.parse((captured as unknown as { body: string }).body);
    expect(body.content).toContain('Execution succeeded'); // discord format
    expect((captured as unknown as { headers: Record<string, string> }).headers['X-DevFlow-Signature']).toMatch(/^sha256=/);
  });

  it('test endpoint reports success/failure honestly', async () => {
    const user = makeUser('hooktest');
    const hook = outgoing.createWebhook(user.id, {
      url: 'https://hooks.example/ping',
      format: 'generic',
      events: ['*'],
    });
    vi.stubGlobal('fetch', vi.fn(async () => new Response('{}', { status: 200 })));
    const ok = await outgoing.testWebhook(user.id, hook.id);
    expect(ok.ok).toBe(true);
    expect(ok.status).toBe(200);

    vi.stubGlobal(
      'fetch',
      vi.fn(async () => {
        throw new Error('connection refused');
      })
    );
    const fail = await outgoing.testWebhook(user.id, hook.id);
    expect(fail.ok).toBe(false);
    expect(fail.error).toContain('connection refused');
  });
});

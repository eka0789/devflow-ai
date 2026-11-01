import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStory,
  createTask,
  transitionEntity,
  addStoryDependency,
  addTaskDependency,
  getBacklogTree,
} from '../src/services/backlog.service.js';
import { freshDb, makeProject, makeUser } from './helpers.js';
import { AppError } from '../src/util/appError.js';

beforeEach(() => freshDb());

function setup() {
  const user = makeUser('sm');
  const project = makeProject(user.id);
  return { user, projectId: project.id };
}

describe('centralized state machine', () => {
  it('allows valid transitions and records status events', () => {
    const { user, projectId } = setup();
    const story = createStory(projectId, user.id, { title: 'S1', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });

    const s = transitionEntity('story', projectId, story.id, user.id, { status: 'todo' });
    expect(s.status).toBe('todo');
    const s2 = transitionEntity('story', projectId, story.id, user.id, { status: 'in_progress' });
    expect(s2.status).toBe('in_progress');

    const tree = getBacklogTree(projectId, user.id);
    expect(tree.stories[0]!.status).toBe('in_progress');
    void tree;
  });

  it('rejects arbitrary invalid transitions', () => {
    const { user, projectId } = setup();
    const story = createStory(projectId, user.id, { title: 'S1', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });
    // backlog → done is invalid
    expect(() => transitionEntity('story', projectId, story.id, user.id, { status: 'done' })).toThrowError(AppError);
    try {
      transitionEntity('story', projectId, story.id, user.id, { status: 'done' });
    } catch (err) {
      expect((err as AppError).code).toBe('INVALID_TRANSITION');
      expect((err as AppError).status).toBe(409);
    }
  });

  it('treats same-status transitions as no-ops', () => {
    const { user, projectId } = setup();
    const story = createStory(projectId, user.id, { title: 'S1', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });
    const s = transitionEntity('story', projectId, story.id, user.id, { status: 'backlog' });
    expect(s.status).toBe('backlog');
  });
});

describe('dependency gating', () => {
  it('blocks forward progress while dependencies are unresolved', () => {
    const { user, projectId } = setup();
    const dep = createStory(projectId, user.id, { title: 'Dep', description: '', points: 2, priority: 'high', acceptanceCriteria: [] });
    const main = createStory(projectId, user.id, { title: 'Main', description: '', points: 5, priority: 'high', acceptanceCriteria: [] });
    addStoryDependency(projectId, main.id, dep.id, user.id);

    transitionEntity('story', projectId, main.id, user.id, { status: 'todo' });
    try {
      transitionEntity('story', projectId, main.id, user.id, { status: 'in_progress' });
      expect.fail('should have thrown');
    } catch (err) {
      expect((err as AppError).code).toBe('DEPENDENCY_BLOCKED');
    }

    // finish the dependency through the legal path
    for (const status of ['todo', 'in_progress', 'in_review', 'done'] as const) {
      transitionEntity('story', projectId, dep.id, user.id, { status });
    }
    const moved = transitionEntity('story', projectId, main.id, user.id, { status: 'in_progress' });
    expect(moved.status).toBe('in_progress');
  });

  it('rejects self-dependencies and cycles', () => {
    const { user, projectId } = setup();
    const a = createStory(projectId, user.id, { title: 'A', description: '', points: 1, priority: 'low', acceptanceCriteria: [] });
    const b = createStory(projectId, user.id, { title: 'B', description: '', points: 1, priority: 'low', acceptanceCriteria: [] });

    expect(() => addStoryDependency(projectId, a.id, a.id, user.id)).toThrowError();
    addStoryDependency(projectId, a.id, b.id, user.id);
    expect(() => addStoryDependency(projectId, b.id, a.id, user.id)).toThrowError(/cycle/);
  });

  it('applies the same rules to tasks', () => {
    const { user, projectId } = setup();
    const story = createStory(projectId, user.id, { title: 'S', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });
    const t1 = createTask(projectId, user.id, { storyId: story.id, title: 'T1', description: '', priority: 'medium' });
    const t2 = createTask(projectId, user.id, { storyId: story.id, title: 'T2', description: '', priority: 'medium' });
    addTaskDependency(projectId, t2.id, t1.id, user.id);

    expect(() => transitionEntity('task', projectId, t2.id, user.id, { status: 'in_progress' })).toThrowError(/DEPENDENCY_BLOCKED|Blocked/);
    transitionEntity('task', projectId, t1.id, user.id, { status: 'in_progress' });
    transitionEntity('task', projectId, t1.id, user.id, { status: 'in_review' });
    transitionEntity('task', projectId, t1.id, user.id, { status: 'done' });
    expect(transitionEntity('task', projectId, t2.id, user.id, { status: 'in_progress' }).status).toBe('in_progress');
  });
});

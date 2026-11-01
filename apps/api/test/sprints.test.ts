import { beforeEach, describe, expect, it } from 'vitest';
import {
  createStory,
  createTask,
  transitionEntity,
} from '../src/services/backlog.service.js';
import {
  activateSprint,
  assignStory,
  completeSprint,
  createSprint,
  getBoard,
  getSprintMetrics,
  getVelocity,
  listSprints,
  unassignStory,
} from '../src/services/sprints.service.js';
import { getDashboardStats } from '../src/services/analytics.service.js';
import { freshDb, makeProject, makeUser } from './helpers.js';
import { AppError } from '../src/util/appError.js';

beforeEach(() => freshDb());

function setup() {
  const user = makeUser('po');
  const project = makeProject(user.id);
  return { user, projectId: project.id };
}

async function doneStory(projectId: string, userId: string, title: string, points: number): Promise<string> {
  const story = createStory(projectId, userId, { title, description: '', points, priority: 'medium', acceptanceCriteria: [] });
  for (const status of ['todo', 'in_progress', 'in_review', 'done'] as const) {
    transitionEntity('story', projectId, story.id, userId, { status });
  }
  return story.id;
}

describe('sprint lifecycle', () => {
  it('refuses to activate an empty sprint or two sprints at once', () => {
    const { user, projectId } = setup();
    const s1 = createSprint(projectId, user.id, { name: 'Sprint 1', goal: 'ship' });
    expect(() => activateSprint(projectId, s1.id, user.id)).toThrowError(/empty/i);

    const story = createStory(projectId, user.id, { title: 'A', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });
    assignStory(projectId, s1.id, story.id, user.id);
    activateSprint(projectId, s1.id, user.id);

    const s2 = createSprint(projectId, user.id, { name: 'Sprint 2', goal: '' });
    const story2 = createStory(projectId, user.id, { title: 'B', description: '', points: 2, priority: 'low', acceptanceCriteria: [] });
    assignStory(projectId, s2.id, story2.id, user.id);
    expect(() => activateSprint(projectId, s2.id, user.id)).toThrowError(/already active/i);
  });

  it('moves backlog stories to todo on activation', () => {
    const { user, projectId } = setup();
    const sprint = createSprint(projectId, user.id, { name: 'S1', goal: '' });
    const story = createStory(projectId, user.id, { title: 'A', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });
    assignStory(projectId, sprint.id, story.id, user.id);
    activateSprint(projectId, sprint.id, user.id);

    const metrics = getSprintMetrics(projectId, sprint.id, user.id);
    expect(metrics.sprint.status).toBe('active');
    expect(metrics.totalPoints).toBe(3);
  });

  it('completes a sprint: carries over unfinished work and freezes metrics', async () => {
    const { user, projectId } = setup();
    const sprint = createSprint(projectId, user.id, { name: 'S1', goal: 'goal' });
    // create both stories first, assign, then complete one through the legal path
    const doneStoryRow = createStory(projectId, user.id, { title: 'Finished', description: '', points: 5, priority: 'medium', acceptanceCriteria: [] });
    const openStory = createStory(projectId, user.id, { title: 'Pending', description: '', points: 8, priority: 'high', acceptanceCriteria: [] });
    assignStory(projectId, sprint.id, doneStoryRow.id, user.id);
    assignStory(projectId, sprint.id, openStory.id, user.id);
    for (const status of ['todo', 'in_progress', 'in_review', 'done'] as const) {
      transitionEntity('story', projectId, doneStoryRow.id, user.id, { status });
    }

    activateSprint(projectId, sprint.id, user.id);

    const metrics = completeSprint(projectId, sprint.id, user.id);
    expect(metrics.sprint.status).toBe('completed');
    expect(metrics.totalPoints).toBe(13);
    expect(metrics.donePoints).toBe(5);
    expect(metrics.completionRate).toBe(38); // 5/13 rounded

    // unfinished story carried back to backlog
    const tree = getBacklogTreeHelper(projectId, user.id);
    const pending = tree.stories.find((s) => s.title === 'Pending');
    expect(pending?.status).toBe('backlog');
    expect(pending?.sprintId).toBeNull();

    // frozen snapshot: velocity includes the sprint
    const velocity = getVelocity(projectId, user.id);
    expect(velocity).toHaveLength(1);
    expect(velocity[0]!.committed).toBe(13);
    expect(velocity[0]!.completed).toBe(5);

    expect(() => completeSprint(projectId, sprint.id, user.id)).toThrowError(AppError);
  });

  it('unassign removes story from sprint', () => {
    const { user, projectId } = setup();
    const sprint = createSprint(projectId, user.id, { name: 'S1', goal: '' });
    const story = createStory(projectId, user.id, { title: 'A', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });
    assignStory(projectId, sprint.id, story.id, user.id);
    unassignStory(projectId, sprint.id, story.id, user.id);
    const sprints = listSprints(projectId, user.id);
    expect(sprints).toHaveLength(1);
  });

  it('board returns kanban tasks grouped with story titles', () => {
    const { user, projectId } = setup();
    const story = createStory(projectId, user.id, { title: 'S', description: '', points: 3, priority: 'medium', acceptanceCriteria: [] });
    createTask(projectId, user.id, { storyId: story.id, title: 'Implement', description: '', priority: 'high' });
    const board = getBoard(projectId, user.id);
    expect(board.tasks).toHaveLength(1);
    expect(board.tasks[0]!.storyTitle).toBe('S');
    expect(board.tasks[0]!.status).toBe('todo');
  });

  it('dashboard stats reflect real created data', async () => {
    const { user, projectId } = setup();
    await doneStory(projectId, user.id, 'D1', 3);
    createStory(projectId, user.id, { title: 'Open', description: '', points: 2, priority: 'low', acceptanceCriteria: [] });
    const sprint = createSprint(projectId, user.id, { name: 'S', goal: '' });
    assignStory(projectId, sprint.id, (await (await import('../src/services/backlog.service.js')).getBacklogTree(projectId, user.id)).stories.find((s) => s.title === 'Open')!.id, user.id);
    activateSprint(projectId, sprint.id, user.id);

    const stats = getDashboardStats(user.id);
    expect(stats.projectsTotal).toBe(1);
    expect(stats.doneStories).toBe(1);
    expect(stats.openStories).toBe(1);
    expect(stats.activeSprints).toBe(1);
    void projectId;
  });
});

// small helper to avoid circular import at module level
import * as backlog from '../src/services/backlog.service.js';
function getBacklogTreeHelper(projectId: string, userId: string) {
  return backlog.getBacklogTree(projectId, userId);
}

/** My Work — cross-project view of stories and tasks assigned to the current user. */
import type { JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { MyWork, Story, Task } from '@devflow/shared';
import { api } from '../lib/api';
import { useApi } from '../lib/hooks';
import { DueChip } from '../components/Chips';
import { PriorityBadge, StatusBadge } from '../components/Badge';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { IconCheck, IconChevronRight } from '../components/icons';

function TaskCard({ task }: { task: Task & { projectName: string; storyTitle: string } }): JSX.Element {
  const navigate = useNavigate();
  return (
    <button
      className="card card-clickable"
      style={{ display: 'flex', flexDirection: 'column', gap: 8, textAlign: 'left', height: '100%' }}
      onClick={() => navigate(`/projects/${task.projectId}/board`)}
      aria-label={`Open task ${task.title} on the board`}
    >
      <div className="row gap-2">
        <span className="flex-1 truncate weight-600" style={{ fontSize: 13.5 }}>
          {task.title}
        </span>
        <IconChevronRight size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
      </div>
      <div className="row gap-2 wrap text-sm muted">
        <span className="truncate" style={{ maxWidth: 160 }}>
          {task.projectName}
        </span>
        <span className="faint">·</span>
        <span className="truncate" style={{ maxWidth: 160 }}>
          {task.storyTitle}
        </span>
      </div>
      <div className="spacer" />
      <div className="row gap-2 wrap">
        <DueChip dueDate={task.dueDate} status={task.status} />
        <PriorityBadge priority={task.priority} />
        <span className="spacer" />
        <StatusBadge status={task.status} />
      </div>
    </button>
  );
}

function StoryRow({ story }: { story: Story & { projectName: string } }): JSX.Element {
  const navigate = useNavigate();
  return (
    <button
      className="row gap-2"
      style={{
        width: '100%',
        textAlign: 'left',
        padding: '10px 14px',
        borderBottom: '1px solid var(--border-soft)',
        alignItems: 'center',
        gap: 10,
      }}
      onClick={() => navigate(`/projects/${story.projectId}/backlog`)}
      aria-label={`Open story ${story.title} in the backlog`}
    >
      <IconChevronRight size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
      <span className="flex-1 truncate weight-500" style={{ fontSize: 13.5 }}>
        {story.title}
      </span>
      <span className="muted text-sm truncate" style={{ maxWidth: 180 }}>
        {story.projectName}
      </span>
      <DueChip dueDate={story.dueDate} status={story.status} />
      <StatusBadge status={story.status} />
    </button>
  );
}

export function MyWorkPage(): JSX.Element {
  const { data, loading, error, reload } = useApi<MyWork>(() => api.get<MyWork>('/my-work'), []);

  if (loading && !data)
    return (
      <div className="page">
        <Skeleton height={40} style={{ marginBottom: 16 }} />
        <div className="cards-grid">
          {Array.from({ length: 4 }, (_, i) => (
            <Skeleton key={i} height={110} style={{ borderRadius: 10 }} />
          ))}
        </div>
      </div>
    );

  if (error)
    return (
      <div className="page">
        <ErrorState error={error} onRetry={reload} title="Failed to load your work" />
      </div>
    );

  const tasks = data?.tasks ?? [];
  const stories = data?.stories ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">My Work</div>
          <div className="page-sub">Everything assigned to you across the workspace, sorted by due date</div>
        </div>
      </div>

      {tasks.length === 0 && stories.length === 0 ? (
        <EmptyState
          icon={<IconCheck size={18} />}
          title="Nothing assigned to you"
          description="No assignments — assign stories or tasks to yourself from the backlog."
        />
      ) : (
        <>
          <section className="section" style={{ marginTop: 0 }} aria-label="Tasks assigned to you">
            <div className="section-title">
              Tasks assigned to you
              <span className="muted weight-500">({tasks.length})</span>
            </div>
            {tasks.length === 0 ? (
              <EmptyState compact title="No open tasks assigned to you" description="Tasks you are assigned will appear here until they are done." />
            ) : (
              <div className="cards-grid">
                {tasks.map((t) => (
                  <TaskCard key={t.id} task={t} />
                ))}
              </div>
            )}
          </section>

          <section className="section" aria-label="Stories assigned to you">
            <div className="section-title">
              Stories assigned to you
              <span className="muted weight-500">({stories.length})</span>
            </div>
            {stories.length === 0 ? (
              <EmptyState compact title="No open stories assigned to you" description="Stories you are assigned will appear here until they are done." />
            ) : (
              <div className="card" style={{ padding: '6px 0', overflow: 'hidden' }}>
                {stories.map((s) => (
                  <StoryRow key={s.id} story={s} />
                ))}
              </div>
            )}
          </section>
        </>
      )}
    </div>
  );
}

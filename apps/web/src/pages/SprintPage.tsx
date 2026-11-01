import { useState, type JSX } from 'react';
import type { Sprint, SprintMetrics, Story, VelocityPoint } from '@devflow/shared';
import { api } from '../lib/api';
import { formatDate, useApi, useProjectRequired, useToast } from '../lib/hooks';
import { BarChart, LineChart } from '../components/Charts';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Field, Input, Select, Textarea } from '../components/Field';
import { Modal } from '../components/Modal';
import { Skeleton } from '../components/Skeleton';
import { StatCard } from '../components/StatCard';
import { StatusBadge } from '../components/Badge';
import { IconChevronRight, IconPlus, IconTrash } from '../components/icons';

function toIso(localValue: string): string | null {
  if (!localValue) return null;
  const d = new Date(localValue);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

function CreateSprintModal({
  open,
  projectId,
  onClose,
  onCreated,
}: {
  open: boolean;
  projectId: string;
  onClose: () => void;
  onCreated: () => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [goal, setGoal] = useState('');
  const [startsAt, setStartsAt] = useState('');
  const [endsAt, setEndsAt] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  if (open && !wasOpen) {
    setWasOpen(true);
    setName('');
    setGoal('');
    setStartsAt('');
    setEndsAt('');
    setError(null);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/sprints`, {
        name: name.trim(),
        goal: goal.trim(),
        startsAt: toIso(startsAt),
        endsAt: toIso(endsAt),
      });
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create sprint');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New sprint"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || name.trim().length < 2}>
            Create sprint
          </button>
        </>
      }
    >
      <div className="stack gap-3">
        {error ? <div className="form-error">{error}</div> : null}
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Sprint 1" autoFocus maxLength={120} />
        </Field>
        <Field label="Goal" hint="What should this sprint achieve?">
          <Textarea value={goal} onChange={(e) => setGoal(e.target.value)} maxLength={2000} />
        </Field>
        <div className="grid grid-2">
          <Field label="Starts at">
            <Input type="datetime-local" value={startsAt} onChange={(e) => setStartsAt(e.target.value)} />
          </Field>
          <Field label="Ends at">
            <Input type="datetime-local" value={endsAt} onChange={(e) => setEndsAt(e.target.value)} />
          </Field>
        </div>
      </div>
    </Modal>
  );
}

function SprintStories({
  sprint,
  stories,
  onChanged,
}: {
  sprint: Sprint;
  stories: Story[];
  onChanged: () => void;
}): JSX.Element {
  const projectId = sprint.projectId;
  const toast = useToast();
  const [addStoryId, setAddStoryId] = useState('');

  const assigned = stories.filter((s) => s.sprintId === sprint.id);
  const unassigned = stories.filter((s) => s.sprintId !== sprint.id);

  const assign = async (): Promise<void> => {
    if (!addStoryId) return;
    try {
      await api.post(`/projects/${projectId}/sprints/${sprint.id}/stories`, { storyId: addStoryId });
      setAddStoryId('');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to assign story');
    }
  };

  const remove = async (storyId: string): Promise<void> => {
    try {
      await api.del(`/projects/${projectId}/sprints/${sprint.id}/stories/${storyId}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove story');
    }
  };

  return (
    <div className="stack gap-3">
      <div className="uppercase-label">Assigned stories ({assigned.length})</div>
      {assigned.length === 0 ? (
        <div className="faint text-sm">No stories assigned yet. A sprint must have stories before it can be activated.</div>
      ) : (
        <div className="stack gap-1">
          {assigned.map((s) => (
            <div key={s.id} className="task-row">
              <StatusBadge status={s.status} />
              <span className="flex-1 truncate">{s.title}</span>
              <span className="points-pill" title="Points">
                {s.points}
              </span>
              <button className="btn btn-ghost btn-sm btn-icon" onClick={() => void remove(s.id)} aria-label={`Remove ${s.title}`}>
                <IconTrash size={12} />
              </button>
            </div>
          ))}
          <div className="muted text-sm tabular">
            {assigned.reduce((sum, s) => sum + s.points, 0)} points committed
          </div>
        </div>
      )}
      {unassigned.length > 0 ? (
        <div className="row gap-2">
          <Select value={addStoryId} onChange={(e) => setAddStoryId(e.target.value)} style={{ maxWidth: 340 }}>
            <option value="">Assign a story to this sprint…</option>
            {unassigned.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title} ({s.points} pts{s.sprintId ? ', in another sprint' : ''})
              </option>
            ))}
          </Select>
          <button className="btn btn-sm" onClick={() => void assign()} disabled={!addStoryId}>
            <IconPlus size={13} />
            Assign
          </button>
        </div>
      ) : null}
    </div>
  );
}

function SprintMetricsCard({ sprintId, projectId }: { sprintId: string; projectId: string }): JSX.Element {
  const { data, loading, error, reload } = useApi<SprintMetrics>(
    () => api.get<SprintMetrics>(`/projects/${projectId}/sprints/${sprintId}/metrics`),
    [sprintId, projectId],
  );

  if (loading)
    return (
      <div className="stack gap-2">
        <Skeleton height={70} />
        <Skeleton height={200} />
      </div>
    );
  if (error) return <ErrorState error={error} onRetry={reload} compact title="Failed to load metrics" />;
  if (!data) return <div />;

  return (
    <div className="stack gap-3">
      <div className="grid grid-4">
        <StatCard label="Committed" value={data.totalPoints} hint={`${data.totalStories} stories`} />
        <StatCard label="Completed" value={data.donePoints} hint={`${data.doneStories} stories`} accent="success" />
        <StatCard
          label="Completion"
          value={`${Math.round(data.completionRate * 100)}%`}
          accent={data.completionRate >= 0.8 ? 'success' : data.completionRate >= 0.5 ? 'warning' : 'danger'}
        />
        <StatCard label="Open tasks" value={data.openTasks} accent="warning" />
      </div>
      <div>
        <div className="uppercase-label" style={{ marginBottom: 6 }}>
          Burndown
        </div>
        {data.burndown.length === 0 ? (
          <div className="chart-empty">No burndown data yet</div>
        ) : (
          <LineChart
            points={data.burndown.map((p) => ({ label: formatDate(p.date), value: p.remaining }))}
            ideal={data.burndown.map((p) => p.ideal)}
          />
        )}
      </div>
    </div>
  );
}

export function SprintPage(): JSX.Element {
  const ctx = useProjectRequired();
  const projectId = ctx.projectId;
  const toast = useToast();

  const sprints = useApi<Sprint[]>(() => api.get<Sprint[]>(`/projects/${projectId}/sprints`), [projectId]);
  const velocity = useApi<VelocityPoint[]>(() => api.get<VelocityPoint[]>(`/projects/${projectId}/velocity`), [projectId]);
  const backlogStories = useApi<{ stories: Story[] }>(
    () => api.get<{ stories: Story[] }>(`/projects/${projectId}/backlog`) as Promise<{ stories: Story[] }>,
    [projectId],
  );

  const [creating, setCreating] = useState(false);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [activating, setActivating] = useState<Sprint | null>(null);
  const [completing, setCompleting] = useState<Sprint | null>(null);
  const [busySprint, setBusySprint] = useState<string | null>(null);

  const generateReview = async (sprint: Sprint): Promise<void> => {
    setBusySprint(sprint.id);
    try {
      await api.post(`/projects/${projectId}/sprints/${sprint.id}/review`);
      toast.success(`Sprint review draft for "${sprint.name}" is ready — open AI Planning to view and approve`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to generate sprint review');
    } finally {
      setBusySprint(null);
    }
  };

  const activate = async (sprint: Sprint): Promise<void> => {
    setBusySprint(sprint.id);
    try {
      await api.post(`/projects/${projectId}/sprints/${sprint.id}/activate`);
      toast.success(`Sprint "${sprint.name}" is now active`);
      setActivating(null);
      void sprints.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to activate sprint');
    } finally {
      setBusySprint(null);
    }
  };

  const complete = async (sprint: Sprint): Promise<void> => {
    setBusySprint(sprint.id);
    try {
      const metrics = await api.post<SprintMetrics>(`/projects/${projectId}/sprints/${sprint.id}/complete`);
      toast.success(
        `Sprint completed — ${metrics.donePoints}/${metrics.totalPoints} points done. Incomplete stories were returned to the backlog.`,
      );
      setCompleting(null);
      void sprints.reload();
      void backlogStories.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to complete sprint');
    } finally {
      setBusySprint(null);
    }
  };

  const list = sprints.data ?? [];
  const velocityPoints = velocity.data ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Sprints</div>
          <div className="page-sub">Plan iterations, commit stories and track burndown</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setCreating(true)}>
            <IconPlus size={14} />
            New sprint
          </button>
        </div>
      </div>

      {velocityPoints.length > 0 ? (
        <section className="card" style={{ marginBottom: 20 }}>
          <div className="card-header">
            <div className="card-title">Velocity</div>
            <span className="faint text-sm">points per sprint</span>
          </div>
          <BarChart
            data={velocityPoints.map((v) => ({ label: v.sprint, value: v.committed, value2: v.completed }))}
            series1Label="Committed"
            series2Label="Completed"
            height={190}
          />
        </section>
      ) : null}

      {sprints.loading ? (
        <div className="stack gap-3">
          {Array.from({ length: 2 }, (_, i) => (
            <Skeleton key={i} height={150} style={{ borderRadius: 10 }} />
          ))}
        </div>
      ) : sprints.error ? (
        <ErrorState error={sprints.error} onRetry={sprints.reload} title="Failed to load sprints" />
      ) : list.length === 0 ? (
        <EmptyState
          title="No sprints yet"
          description="Create a sprint, assign stories from the backlog, then activate it to start tracking progress."
          action={
            <button className="btn btn-primary" onClick={() => setCreating(true)}>
              <IconPlus size={14} />
              Create your first sprint
            </button>
          }
        />
      ) : (
        <div className="stack gap-3">
          {list.map((sprint) => {
            const isOpen = expanded === sprint.id;
            return (
              <div key={sprint.id} className="sprint-card">
                <div className="sprint-header">
                  <div className="stack gap-1" style={{ gap: 3, minWidth: 0 }}>
                    <div className="row gap-2 wrap">
                      <span className="weight-600" style={{ fontSize: 15 }}>
                        {sprint.name}
                      </span>
                      <StatusBadge status={sprint.status} />
                    </div>
                    {sprint.goal ? (
                      <div className="muted text-sm" style={{ maxWidth: 560 }}>
                        {sprint.goal}
                      </div>
                    ) : null}
                    <div className="faint text-sm">
                      {sprint.startsAt ? `${formatDate(sprint.startsAt)} → ${sprint.endsAt ? formatDate(sprint.endsAt) : 'open'}` : 'No dates set'}
                      {sprint.completedAt ? ` · completed ${formatDate(sprint.completedAt)}` : ''}
                    </div>
                  </div>
                  <div className="row gap-2">
                    {sprint.status === 'planned' ? (
                      <button className="btn btn-primary btn-sm" onClick={() => setActivating(sprint)}>
                        Activate
                      </button>
                    ) : null}
                    {sprint.status === 'active' ? (
                      <button className="btn btn-sm" style={{ borderColor: 'var(--success)', color: 'var(--success)' }} onClick={() => setCompleting(sprint)}>
                        Complete sprint
                      </button>
                    ) : null}
                    {sprint.status === 'completed' ? (
                      <button
                        className="btn btn-sm"
                        disabled={busySprint === sprint.id}
                        onClick={() => void generateReview(sprint)}
                        title="Generate a review & retrospective draft from this sprint's real metrics"
                      >
                        AI sprint review
                      </button>
                    ) : null}
                    <button
                      className="btn btn-ghost btn-sm"
                      onClick={() => setExpanded(isOpen ? null : sprint.id)}
                      aria-expanded={isOpen}
                    >
                      <IconChevronRight size={13} style={{ transform: isOpen ? 'rotate(90deg)' : 'none', transition: 'transform 140ms' }} />
                      {isOpen ? 'Hide details' : 'Details'}
                    </button>
                  </div>
                </div>

                {isOpen ? (
                  <div className="stack gap-4" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
                    <SprintStories sprint={sprint} stories={backlogStories.data?.stories ?? []} onChanged={() => void backlogStories.reload()} />
                    {sprint.status !== 'planned' ? (
                      <SprintMetricsCard sprintId={sprint.id} projectId={projectId} />
                    ) : (
                      <div className="faint text-sm">Metrics become available once the sprint is activated.</div>
                    )}
                  </div>
                ) : null}
              </div>
            );
          })}
        </div>
      )}

      <CreateSprintModal open={creating} projectId={projectId} onClose={() => setCreating(false)} onCreated={sprints.reload} />

      <ConfirmDialog
        open={activating !== null}
        title="Activate sprint"
        message={
          activating ? (
            <>
              Activate <strong>{activating.name}</strong>? Only one sprint can be active at a time — activating this one
              requires it to have at least one assigned story.
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Activate"
        busy={busySprint === activating?.id}
        onConfirm={() => activating && void activate(activating)}
        onCancel={() => setActivating(null)}
      />

      <ConfirmDialog
        open={completing !== null}
        title="Complete sprint"
        message={
          completing ? (
            <>
              Complete <strong>{completing.name}</strong>? Stories that are not done will be carried over back to the
              backlog so they can be planned into a future sprint.
            </>
          ) : (
            ''
          )
        }
        confirmLabel="Complete sprint"
        busy={busySprint === completing?.id}
        onConfirm={() => completing && void complete(completing)}
        onCancel={() => setCompleting(null)}
      />
    </div>
  );
}

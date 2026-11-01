import { useEffect, useState, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Activity, BacklogStatus, Project, ProjectStatus, Sprint, Story } from '@devflow/shared';
import { api } from '../lib/api';
import { formatRelative, titleCase, useApi, useProjectRequired, useToast } from '../lib/hooks';
import { normalizeBacklogTree, type BacklogTree } from '../lib/types';
import { Badge, StatusBadge } from '../components/Badge';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { Field, Input, Select, Textarea } from '../components/Field';
import { PageLoader, Skeleton } from '../components/Skeleton';
import { StatCard } from '../components/StatCard';
import { IconBranch, IconX } from '../components/icons';

const PROJECT_STATUSES: ProjectStatus[] = ['planning', 'active', 'paused', 'archived'];

/** Editable project settings — reused by ProjectOverview and ProjectSettings. */
export function ProjectSettingsForm({
  project,
  onSaved,
  compact,
}: {
  project: Project;
  onSaved: (p: Project) => void;
  compact?: boolean;
}): JSX.Element {
  const [name, setName] = useState(project.name);
  const [description, setDescription] = useState(project.description);
  const [status, setStatus] = useState<ProjectStatus>(project.status);
  const [stack, setStack] = useState<string[]>(project.techStack);
  const [newTech, setNewTech] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  useEffect(() => {
    setName(project.name);
    setDescription(project.description);
    setStatus(project.status);
    setStack(project.techStack);
  }, [project]);

  const addTech = (): void => {
    const t = newTech.trim();
    if (t && !stack.includes(t) && stack.length < 20) setStack([...stack, t]);
    setNewTech('');
  };

  const save = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const updated = await api.patch<Project>(`/projects/${project.id}`, {
        name: name.trim(),
        description: description.trim(),
        status,
        techStack: stack,
      });
      onSaved(updated);
      toast.success('Project settings saved');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save settings');
    } finally {
      setBusy(false);
    }
  };

  return (
    <form
      className="stack gap-3"
      onSubmit={(e) => {
        e.preventDefault();
        void save();
      }}
    >
      {error ? <div className="form-error">{error}</div> : null}
      <div className={compact ? 'stack gap-3' : 'grid grid-2'}>
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} minLength={2} maxLength={120} required />
        </Field>
        <Field label="Status">
          <Select value={status} onChange={(e) => setStatus(e.target.value as ProjectStatus)}>
            {PROJECT_STATUSES.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
      <Field label="Description">
        <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
      </Field>
      <Field label="Tech stack" hint="Press Enter to add a chip (max 20)">
        <div className="stack gap-2">
          <div className="row gap-2 wrap">
            {stack.map((t) => (
              <span key={t} className="chip">
                {t}
                <button
                  type="button"
                  className="chip-remove"
                  onClick={() => setStack(stack.filter((x) => x !== t))}
                  aria-label={`Remove ${t}`}
                >
                  <IconX size={9} />
                </button>
              </span>
            ))}
            {stack.length === 0 ? <span className="faint text-sm">No technologies added</span> : null}
          </div>
          <div className="row gap-2">
            <Input
              value={newTech}
              onChange={(e) => setNewTech(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  addTech();
                }
              }}
              placeholder="e.g. TypeScript"
              maxLength={40}
            />
            <button type="button" className="btn" onClick={addTech} disabled={!newTech.trim()}>
              Add
            </button>
          </div>
        </div>
      </Field>
      <div className="row justify-end">
        <button type="submit" className="btn btn-primary" disabled={busy || name.trim().length < 2}>
          {busy ? <span className="spinner" /> : null}
          Save changes
        </button>
      </div>
    </form>
  );
}

export function ProjectOverview(): JSX.Element {
  const ctx = useProjectRequired();
  const { project, setProject } = ctx;

  const tree = useApi<BacklogTree>(
    () => api.get<unknown>(`/projects/${ctx.projectId}/backlog`).then(normalizeBacklogTree),
    [ctx.projectId],
  );
  const sprints = useApi<Sprint[]>(() => api.get<Sprint[]>(`/projects/${ctx.projectId}/sprints`), [ctx.projectId]);
  const activity = useApi<Activity[]>(
    () => api.get<Activity[]>(`/projects/${ctx.projectId}/activity?limit=15`),
    [ctx.projectId],
  );

  if (ctx.loading && !ctx.project) return <PageLoader />;
  if (ctx.error)
    return (
      <div className="page">
        <ErrorState
          error={ctx.error}
          onRetry={ctx.reload}
          title="Failed to load project"
        />
        <div className="row justify-center" style={{ marginTop: 12 }}>
          <Link to="/" className="btn">
            Back to dashboard
          </Link>
        </div>
      </div>
    );
  if (!project) return <PageLoader />;

  const stories: Story[] = tree.data?.stories ?? [];
  const tasks = tree.data?.tasks ?? [];
  const statusCounts = new Map<BacklogStatus, number>();
  for (const s of stories) statusCounts.set(s.status, (statusCounts.get(s.status) ?? 0) + 1);
  const openStories = stories.filter((s) => s.status !== 'done' && s.status !== 'cancelled').length;
  const doneStories = stories.filter((s) => s.status === 'done').length;
  const openTasks = tasks.filter((t) => t.status !== 'done' && t.status !== 'cancelled').length;
  const totalPoints = stories.reduce((sum, s) => sum + s.points, 0);
  const donePoints = stories.filter((s) => s.status === 'done').reduce((sum, s) => sum + s.points, 0);
  const activeSprint = (sprints.data ?? []).find((s) => s.status === 'active');

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <div className="row gap-3 wrap">
            <div className="page-title">{project.name}</div>
            <Badge className={`proj-${project.status}`} dot large>
              {titleCase(project.status)}
            </Badge>
          </div>
          <div className="page-sub clamp-2" style={{ maxWidth: 640 }}>
            {project.description || 'No description yet — add one from settings.'}
          </div>
        </div>
        <div className="page-actions">
          <Link className="btn" to={`/projects/${project.id}/board`}>
            Open board
          </Link>
          <Link className="btn btn-primary" to={`/projects/${project.id}/planning`}>
            AI Planning
          </Link>
        </div>
      </div>

      <div className="grid grid-4">
        <StatCard label="Stories" value={openStories} hint={`${doneStories} done · ${totalPoints} pts total`} />
        <StatCard
          label="Completion"
          value={`${totalPoints > 0 ? Math.round((donePoints / totalPoints) * 100) : 0}%`}
          hint={`${donePoints}/${totalPoints} points done`}
          accent="success"
        />
        <StatCard label="Open tasks" value={openTasks} hint={`${tasks.length} total`} accent="warning" />
        <StatCard
          label="Active sprint"
          value={activeSprint ? activeSprint.name : '—'}
          hint={activeSprint ? 'View sprints to manage it' : 'No sprint activated'}
          accent="accent"
        />
      </div>

      <div className="grid grid-2" style={{ marginTop: 24, alignItems: 'start' }}>
        <section className="card">
          <div className="card-header">
            <div className="card-title">Repository</div>
            <Link to={`/projects/${project.id}/github`} className="text-sm inline-link">
              Manage
            </Link>
          </div>
          {project.repoFullName ? (
            <div className="stack gap-2">
              <div className="row gap-2">
                <span className="faint">
                  <IconBranch size={15} />
                </span>
                <span className="mono weight-600">{project.repoFullName}</span>
              </div>
              <div className="row gap-2 text-sm muted">
                <span className="chip">{project.repoDefaultBranch ?? 'main'}</span>
                <span>Connected — executions can open branches and PRs.</span>
              </div>
            </div>
          ) : (
            <EmptyState
              compact
              title="No repository connected"
              description="Connect a GitHub repository to enable AI code executions and pull request reviews."
              action={
                <Link to={`/projects/${project.id}/github`} className="btn btn-primary btn-sm">
                  Connect repository
                </Link>
              }
            />
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div className="card-title">Story status breakdown</div>
          </div>
          {tree.loading ? (
            <Skeleton height={120} />
          ) : stories.length === 0 ? (
            <EmptyState
              compact
              title="No stories yet"
              description="Add stories in the backlog or let the AI agents draft them."
              action={
                <Link to={`/projects/${project.id}/backlog`} className="btn btn-sm">
                  Go to backlog
                </Link>
              }
            />
          ) : (
            <div className="stack gap-2">
              {(['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'] as BacklogStatus[])
                .filter((st) => (statusCounts.get(st) ?? 0) > 0)
                .map((st) => {
                  const count = statusCounts.get(st) ?? 0;
                  return (
                    <div key={st} className="row gap-3">
                      <div style={{ width: 110 }}>
                        <StatusBadge status={st} />
                      </div>
                      <div className="progress flex-1">
                        <div
                          className="progress-bar"
                          style={{ width: `${Math.max(4, (count / stories.length) * 100)}%` }}
                        />
                      </div>
                      <span className="tabular muted" style={{ width: 26, textAlign: 'right' }}>
                        {count}
                      </span>
                    </div>
                  );
                })}
            </div>
          )}
        </section>
      </div>

      <section className="section">
        <div className="section-title">Project settings</div>
        <div className="card card-pad-lg">
          <ProjectSettingsForm
            project={project}
            onSaved={(p) => {
              setProject(p);
              void sprints.reload();
            }}
          />
        </div>
      </section>

      <section className="section">
        <div className="section-title">Activity</div>
        {activity.loading ? (
          <Skeleton height={180} style={{ borderRadius: 10 }} />
        ) : activity.error ? (
          <ErrorState error={activity.error} onRetry={activity.reload} compact />
        ) : !activity.data || activity.data.length === 0 ? (
          <EmptyState compact title="No activity yet" description="Project events will appear here." />
        ) : (
          <div className="card" style={{ padding: '6px 16px' }}>
            <div className="feed">
              {activity.data.map((a) => (
                <div key={a.id} className="feed-item">
                  <span className="feed-dot" />
                  <div className="flex-1 feed-msg">{a.message}</div>
                  <span className="feed-time">{formatRelative(a.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>
    </div>
  );
}

import { useState, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Activity, DashboardStats, Project } from '@devflow/shared';
import { api } from '../lib/api';
import { formatCompact, formatRelative, useApi, useToast } from '../lib/hooks';
import { CreateProjectModal } from '../components/ProjectSwitcher';
import { Badge } from '../components/Badge';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { Skeleton, SkeletonStats } from '../components/Skeleton';
import { StatCard } from '../components/StatCard';
import { colorFor } from '../components/ProjectSwitcher';
import { IconFolder, IconPlus, IconZap } from '../components/icons';

export function Dashboard(): JSX.Element {
  const navigate = useNavigate();
  const toast = useToast();
  const stats = useApi<DashboardStats>(() => api.get<DashboardStats>('/dashboard'), []);
  const projects = useApi<Project[]>(() => api.get<Project[]>('/projects'), []);
  const activity = useApi<Activity[]>(() => api.get<Activity[]>('/activity?limit=20'), []);
  const [creating, setCreatingFlag] = useState(false);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Dashboard</div>
          <div className="page-sub">Your AI engineering workspace at a glance</div>
        </div>
        <div className="page-actions">
          <button className="btn btn-primary" onClick={() => setCreatingFlag(true)}>
            <IconPlus size={14} />
            New project
          </button>
        </div>
      </div>

      <section aria-label="Workspace stats">
        {stats.loading ? (
          <SkeletonStats count={4} />
        ) : stats.error ? (
          <ErrorState error={stats.error} onRetry={stats.reload} />
        ) : stats.data ? (
          <div className="grid grid-4">
            <StatCard
              label="Projects"
              value={stats.data.projectsTotal}
              hint={`${stats.data.projectsActive} active`}
              accent="accent"
              icon={<IconFolder size={14} />}
            />
            <StatCard
              label="Open stories"
              value={stats.data.openStories}
              hint={`${stats.data.doneStories} done`}
              accent="info"
            />
            <StatCard
              label="Open tasks"
              value={stats.data.openTasks}
              hint={`${stats.data.activeSprints} active sprint${stats.data.activeSprints === 1 ? '' : 's'}`}
              accent="warning"
            />
            <StatCard
              label="Executions (30d)"
              value={stats.data.executionsThisMonth}
              hint={`${formatCompact(stats.data.tokensThisMonth)} tokens · ${stats.data.prsOpen} open PRs`}
              accent="success"
              icon={<IconZap size={14} />}
            />
          </div>
        ) : null}
      </section>

      <section className="section" aria-label="Projects">
        <div className="section-title">
          Projects
          {projects.data ? <span className="muted weight-500">({projects.data.length})</span> : null}
        </div>
        {projects.loading ? (
          <div className="cards-grid">
            {Array.from({ length: 3 }, (_, i) => (
              <Skeleton key={i} height={140} style={{ borderRadius: 10 }} />
            ))}
          </div>
        ) : projects.error ? (
          <ErrorState error={projects.error} onRetry={projects.reload} />
        ) : !projects.data || projects.data.length === 0 ? (
          <EmptyState
            title="No projects yet"
            description="Create your first project to start planning with AI agents, managing a backlog and shipping via automated executions."
            action={
              <button className="btn btn-primary" onClick={() => setCreatingFlag(true)}>
                <IconPlus size={14} />
                New project
              </button>
            }
          />
        ) : (
          <div className="cards-grid">
            {projects.data.map((p) => (
              <Link key={p.id} to={`/projects/${p.id}`} style={{ color: 'inherit', textDecoration: 'none' }}>
                <div className="card card-clickable" style={{ height: '100%', display: 'flex', flexDirection: 'column', gap: 10 }}>
                  <div className="row gap-3">
                    <span
                      className="ps-avatar"
                      style={{ width: 30, height: 30, borderRadius: 8, background: colorFor(p.name) }}
                    >
                      {p.name.slice(0, 1).toUpperCase()}
                    </span>
                    <div className="flex-1 truncate weight-600" style={{ fontSize: 14 }}>
                      {p.name}
                    </div>
                    <Badge className={`proj-${p.status}`} dot>
                      {p.status}
                    </Badge>
                  </div>
                  {p.description ? (
                    <div className="muted clamp-2" style={{ fontSize: 12.5, lineHeight: 1.5 }}>
                      {p.description}
                    </div>
                  ) : (
                    <div className="faint" style={{ fontSize: 12.5, fontStyle: 'italic' }}>
                      No description
                    </div>
                  )}
                  <div className="spacer" />
                  <div className="row gap-2 wrap" style={{ minHeight: 22 }}>
                    {p.techStack.slice(0, 4).map((t) => (
                      <span key={t} className="chip">
                        {t}
                      </span>
                    ))}
                    {p.techStack.length > 4 ? <span className="faint text-sm">+{p.techStack.length - 4}</span> : null}
                  </div>
                  <div className="row gap-2 text-sm faint">
                    {p.repoFullName ? <span className="mono truncate">{p.repoFullName}</span> : <span>Repository not connected</span>}
                    <span className="spacer" />
                    <span>{formatRelative(p.updatedAt)}</span>
                  </div>
                </div>
              </Link>
            ))}
          </div>
        )}
      </section>

      <section className="section" aria-label="Recent activity">
        <div className="section-title">Recent activity</div>
        {activity.loading ? (
          <Skeleton height={220} style={{ borderRadius: 10 }} />
        ) : activity.error ? (
          <ErrorState error={activity.error} onRetry={activity.reload} compact />
        ) : !activity.data || activity.data.length === 0 ? (
          <EmptyState
            compact
            title="No activity yet"
            description="Status changes, sprint events and AI agent runs will show up here."
          />
        ) : (
          <div className="card" style={{ padding: '6px 16px' }}>
            <div className="feed">
              {activity.data.map((a) => (
                <div key={a.id} className="feed-item">
                  <span className="feed-dot" />
                  <div className="flex-1" style={{ minWidth: 0 }}>
                    <div className="feed-msg">{a.message}</div>
                  </div>
                  <span className="feed-time">{formatRelative(a.createdAt)}</span>
                </div>
              ))}
            </div>
          </div>
        )}
      </section>

      <CreateProjectModal
        open={creating}
        onClose={() => setCreatingFlag(false)}
        onCreated={(project) => {
          setCreatingFlag(false);
          toast.success(`Project "${project.name}" created`);
          void projects.reload();
          void stats.reload();
          navigate(`/projects/${project.id}`);
        }}
        onImported={(projectId) => {
          setCreatingFlag(false);
          void projects.reload();
          void stats.reload();
          navigate(`/projects/${projectId}`);
        }}
      />
    </div>
  );
}

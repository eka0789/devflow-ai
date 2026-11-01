import { useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import type { AIUsageStats, ExecutionStats, Project, Sprint, SprintMetrics, VelocityPoint } from '@devflow/shared';
import { api } from '../lib/api';
import { formatCompact, formatDate, useApi } from '../lib/hooks';
import { BarChart, Donut, LineChart } from '../components/Charts';
import { ErrorState } from '../components/ErrorState';
import { Select } from '../components/Field';
import { Skeleton } from '../components/Skeleton';
import { StatCard } from '../components/StatCard';
import { IconChart, IconZap } from '../components/icons';

export function AnalyticsPage(): JSX.Element {
  const params = useParams();
  const paramProjectId = params.projectId;
  const [selected, setSelected] = useState<string>('');

  const isProjectScope = paramProjectId !== undefined;
  const projectId = isProjectScope ? paramProjectId : selected || null;

  // Global scope needs a project list to pick from.
  const projects = useApi<Project[] | null>(
    () => (isProjectScope ? Promise.resolve(null) : api.get<Project[]>('/projects')),
    [isProjectScope],
  );

  const effectiveProjectId = projectId ?? (projects.data && projects.data.length > 0 ? projects.data[0]!.id : null);

  const velocity = useApi<VelocityPoint[]>(
    () => (effectiveProjectId ? api.get<VelocityPoint[]>(`/projects/${effectiveProjectId}/velocity`) : Promise.resolve([])),
    [effectiveProjectId],
  );
  const sprints = useApi<Sprint[]>(
    () => (effectiveProjectId ? api.get<Sprint[]>(`/projects/${effectiveProjectId}/sprints`) : Promise.resolve([])),
    [effectiveProjectId],
  );
  const activeSprintId = (sprints.data ?? []).find((s) => s.status === 'active')?.id ?? null;
  const metrics = useApi<SprintMetrics | null>(
    () =>
      effectiveProjectId && activeSprintId
        ? api.get<SprintMetrics>(`/projects/${effectiveProjectId}/sprints/${activeSprintId}/metrics`)
        : Promise.resolve(null),
    [effectiveProjectId, activeSprintId],
  );
  const aiUsage = useApi<AIUsageStats>(() => api.get<AIUsageStats>('/ai/usage?days=30'), []);
  const execStats = useApi<ExecutionStats | null>(
    () => (effectiveProjectId ? api.get<ExecutionStats>(`/executions/stats?projectId=${effectiveProjectId}`) : api.get<ExecutionStats>('/executions/stats')),
    [effectiveProjectId],
  );

  const velocityPoints = velocity.data ?? [];
  const usage = aiUsage.data;
  const stats = execStats.data;

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">{isProjectScope ? 'Project analytics' : 'Analytics'}</div>
          <div className="page-sub">Velocity, burndown and AI usage across your workspace</div>
        </div>
        {!isProjectScope ? (
          <div className="page-actions">
            <Select value={selected} onChange={(e) => setSelected(e.target.value)} style={{ width: 230 }} aria-label="Select project">
              <option value="">{projects.data && projects.data.length > 0 ? 'First project' : 'No projects'}</option>
              {(projects.data ?? []).map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </Select>
          </div>
        ) : null}
      </div>

      {!isProjectScope && projects.error ? <ErrorState error={projects.error} onRetry={projects.reload} /> : null}
      {!isProjectScope && projects.data && projects.data.length === 0 ? (
        <div className="empty-state">
          <div className="empty-icon">
            <IconChart size={18} />
          </div>
          <div className="empty-title">No projects to analyze yet</div>
          <div className="empty-desc">Create a project and start planning to see analytics here.</div>
        </div>
      ) : null}

      {stats ? (
        <div className="grid grid-4" style={{ marginBottom: 22 }}>
          <StatCard label="AI executions" value={stats.total} hint={`${stats.succeeded} succeeded`} icon={<IconZap size={14} />} />
          <StatCard label="Success rate" value={`${stats.total > 0 ? Math.round((stats.succeeded / stats.total) * 100) : 0}%`} accent="success" />
          <StatCard label="Failed" value={stats.failed} accent="danger" />
          <StatCard label="Awaiting review" value={stats.awaitingReview} accent="warning" />
        </div>
      ) : null}

      <div className="grid grid-2" style={{ alignItems: 'start' }}>
        <section className="card">
          <div className="card-header">
            <div className="card-title">Velocity</div>
            <span className="faint text-sm">points committed vs completed</span>
          </div>
          {velocity.loading ? (
            <Skeleton height={200} />
          ) : velocityPoints.length === 0 ? (
            <div className="chart-empty">Complete a sprint to see velocity</div>
          ) : (
            <BarChart
              data={velocityPoints.map((v) => ({ label: v.sprint, value: v.committed, value2: v.completed }))}
              series1Label="Committed"
              series2Label="Completed"
              height={220}
            />
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div className="card-title">Active sprint burndown</div>
            {metrics.data ? <span className="chip">{metrics.data.sprint.name}</span> : null}
          </div>
          {sprints.loading || metrics.loading ? (
            <Skeleton height={200} />
          ) : !metrics.data ? (
            <div className="chart-empty">No active sprint — activate one to track burndown</div>
          ) : metrics.data.burndown.length === 0 ? (
            <div className="chart-empty">No burndown data yet</div>
          ) : (
            <LineChart
              points={metrics.data.burndown.map((p) => ({ label: formatDate(p.date), value: p.remaining }))}
              ideal={metrics.data.burndown.map((p) => p.ideal)}
              height={220}
            />
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div className="card-title">Sprint completion</div>
          </div>
          {metrics.loading ? (
            <Skeleton height={160} />
          ) : !metrics.data ? (
            <div className="chart-empty">No active sprint</div>
          ) : (
            <Donut
              segments={[
                { label: 'Done', value: metrics.data.donePoints, color: 'success' },
                { label: 'Remaining', value: Math.max(0, metrics.data.totalPoints - metrics.data.donePoints), color: 'accent' },
              ]}
              centerLabel={`${Math.round(metrics.data.completionRate * 100)}%`}
              centerSub="complete"
            />
          )}
        </section>

        <section className="card">
          <div className="card-header">
            <div className="card-title">AI token usage</div>
            <span className="faint text-sm">last 30 days</span>
          </div>
          {aiUsage.loading ? (
            <Skeleton height={200} />
          ) : aiUsage.error ? (
            <ErrorState error={aiUsage.error} onRetry={aiUsage.reload} compact title="Failed to load AI usage" />
          ) : !usage || usage.byDay.length === 0 ? (
            <div className="chart-empty">No AI usage in the last 30 days</div>
          ) : (
            <>
              <div className="row gap-4 muted text-sm" style={{ marginBottom: 10 }}>
                <span>
                  <strong style={{ color: 'var(--text)' }}>{formatCompact(usage.tokensIn)}</strong> tokens in
                </span>
                <span>
                  <strong style={{ color: 'var(--text)' }}>{formatCompact(usage.tokensOut)}</strong> tokens out
                </span>
                <span>
                  <strong style={{ color: 'var(--text)' }}>{usage.requests.toLocaleString('en-US')}</strong> requests
                </span>
              </div>
              <BarChart
                data={usage.byDay.map((d) => ({ label: formatDate(d.date), value: d.tokens }))}
                formatValue={formatCompact}
                height={200}
                color="info"
              />
            </>
          )}
        </section>

        {stats && stats.byDay.length > 0 ? (
          <section className="card" style={{ gridColumn: '1 / -1' }}>
            <div className="card-header">
              <div className="card-title">Executions per day</div>
              <span className="faint text-sm">last 30 days</span>
            </div>
            <BarChart
              data={stats.byDay.map((d) => ({ label: formatDate(d.date), value: d.total, value2: d.failed }))}
              series1Label="Runs"
              series2Label="Failed"
              color="accent"
              color2="danger"
              height={180}
            />
          </section>
        ) : null}
      </div>
    </div>
  );
}

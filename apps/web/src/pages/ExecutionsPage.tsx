import { useState, type JSX } from 'react';
import { useParams } from 'react-router-dom';
import type { Execution, ExecutionStats, ExecutionStatus, Project } from '@devflow/shared';
import { api } from '../lib/api';
import { formatDateTime, formatDuration, formatRelative, titleCase, useApi, usePolling, useToast } from '../lib/hooks';
import { Badge, StatusBadge } from '../components/Badge';
import { DiffViewer } from '../components/DiffViewer';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Select } from '../components/Field';
import { Skeleton } from '../components/Skeleton';
import { StatCard } from '../components/StatCard';
import { IconBranch, IconGitPR, IconX, IconZap } from '../components/icons';

interface ExecRow extends Execution {
  projectName?: string;
}

const STATUS_FILTERS: ExecutionStatus[] = ['queued', 'running', 'awaiting_review', 'succeeded', 'failed', 'cancelled'];
const ACTIVE: ExecutionStatus[] = ['queued', 'running'];

function StepTimeline({ execution }: { execution: Execution }): JSX.Element {
  if (execution.logs.length === 0) {
    return <div className="faint text-sm">No step logs recorded.</div>;
  }
  return (
    <div className="timeline">
      {execution.logs.map((log, i) => (
        <div key={i} className="timeline-item">
          <div className={`timeline-marker ${log.status}`}>
            {log.status === 'ok' ? '✓' : log.status === 'failed' ? '!' : '–'}
          </div>
          <div className="timeline-content">
            <div className="timeline-title">
              {titleCase(log.step.replace(/[_-]/g, ' '))}
              <span className="faint text-sm tabular">{formatDuration(log.durationMs)}</span>
              <span className="faint text-sm">{formatRelative(log.at)}</span>
            </div>
            {log.detail ? <div className="timeline-detail">{log.detail}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function ExecutionDrawer({
  row,
  onClose,
  onChanged,
}: {
  row: ExecRow | null;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const pid = row?.projectId ?? '';
  const detail = useApi<Execution | null>(
    () => (row ? api.get<Execution>(`/projects/${pid}/executions/${row.id}`) : Promise.resolve(null)),
    [row?.id, pid],
  );
  const diff = useApi<{ diff: string } | null>(
    () =>
      row && detail.data && detail.data.changes.length > 0
        ? api.get<{ diff: string }>(`/projects/${pid}/executions/${row.id}/diff`)
        : Promise.resolve(null),
    [row?.id, pid, detail.data?.changes.length],
  );
  const [cancelling, setCancelling] = useState(false);

  const exec = detail.data;
  const isActive = exec ? ACTIVE.includes(exec.status) : false;
  usePolling(detail.reload, 3000, Boolean(row) && isActive);

  const cancel = async (): Promise<void> => {
    if (!exec) return;
    setCancelling(true);
    try {
      await api.post(`/executions/${exec.id}/cancel`);
      toast.info('Execution cancelled');
      detail.reload();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to cancel');
    } finally {
      setCancelling(false);
    }
  };

  const retryable = exec ? ['failed', 'awaiting_review', 'cancelled'].includes(exec.status) : false;
  const [retrying, setRetrying] = useState(false);
  const retry = async (): Promise<void> => {
    if (!exec) return;
    setRetrying(true);
    try {
      await api.post<Execution>(`/executions/${exec.id}/retry`, { createPR: true });
      toast.success('Execution re-queued — the pipeline is running again');
      onChanged();
      onClose();
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Failed to retry execution';
      toast.error(message);
    } finally {
      setRetrying(false);
    }
  };

  return (
    <Drawer
      open={row !== null}
      onClose={onClose}
      title={exec?.summary || 'AI Execution'}
      subtitle={exec ? `${exec.mode === 'docker' ? 'Docker sandbox' : 'API mode'} · started ${formatDateTime(exec.createdAt)}` : undefined}
      footer={
        exec ? (
          <>
            {exec.prUrl ? (
              <a className="btn btn-ghost" href={exec.prUrl} target="_blank" rel="noreferrer noopener">
                <IconGitPR size={13} />
                View pull request
              </a>
            ) : null}
            <div className="spacer" />
            {isActive ? (
              <button className="btn btn-danger" onClick={() => void cancel()} disabled={cancelling}>
                {cancelling ? <span className="spinner" /> : <IconX size={13} />}
                Cancel execution
              </button>
            ) : null}
            {retryable ? (
              <button className="btn btn-primary" onClick={() => void retry()} disabled={retrying}>
                {retrying ? <span className="spinner" /> : null}
                Retry execution
              </button>
            ) : null}
          </>
        ) : null
      }
    >
      {!exec ? (
        detail.error ? (
          <ErrorState error={detail.error} onRetry={detail.reload} compact />
        ) : (
          <Skeleton height={260} />
        )
      ) : (
        <>
          <div className="row gap-2 wrap">
            <StatusBadge status={exec.status} large />
            <Badge className="badge-outline">{exec.mode === 'docker' ? 'Docker' : 'API'}</Badge>
            {exec.branch ? (
              <span className="chip mono">
                <IconBranch size={11} />
                {exec.branch}
              </span>
            ) : null}
            {exec.prNumber !== null && exec.prUrl ? (
              <a className="chip mono inline-link" href={exec.prUrl} target="_blank" rel="noreferrer noopener">
                <IconGitPR size={11} />#{exec.prNumber}
              </a>
            ) : null}
          </div>

          {exec.error ? <div className="form-error">{exec.error}</div> : null}
          {exec.summary ? <div className="muted" style={{ fontSize: 13.5, lineHeight: 1.6, whiteSpace: 'pre-wrap' }}>{exec.summary}</div> : null}

          {exec.testResult ? (
            <div className={`card ${exec.testResult.status === 'passed' ? '' : ''}`} style={{ borderColor: exec.testResult.status === 'passed' ? 'rgba(63,182,139,.4)' : exec.testResult.status === 'failed' ? 'rgba(229,72,77,.4)' : undefined }}>
              <div className="row gap-2">
                <Badge className={exec.testResult.status === 'passed' ? 'badge-success' : exec.testResult.status === 'failed' ? 'badge-danger' : 'badge-outline'}>
                  Tests {exec.testResult.status}
                </Badge>
              </div>
              {exec.testResult.detail ? (
                <div className="muted text-sm mono" style={{ marginTop: 8, whiteSpace: 'pre-wrap', maxHeight: 200, overflowY: 'auto' }}>
                  {exec.testResult.detail}
                </div>
              ) : null}
            </div>
          ) : null}

          <div className="stack gap-2">
            <div className="uppercase-label">Agent steps</div>
            <StepTimeline execution={exec} />
          </div>

          <div className="stack gap-2">
            <div className="uppercase-label">Changed files ({exec.changes.length})</div>
            {exec.changes.length === 0 ? (
              <div className="faint text-sm">No file changes.</div>
            ) : (
              <div className="file-list">
                {exec.changes.map((c) => (
                  <div key={c.path} className="file-row" style={{ cursor: 'default' }}>
                    <span className="mono flex-1 truncate" style={{ fontSize: 12.5 }}>
                      {c.path}
                    </span>
                    <span className={`file-action ${c.action}`}>{c.action}</span>
                  </div>
                ))}
              </div>
            )}
          </div>

          <div className="stack gap-2">
            <div className="uppercase-label">Diff</div>
            {diff.loading ? (
              <Skeleton height={160} />
            ) : diff.error ? (
              <div className="faint text-sm">Diff unavailable: {diff.error.message}</div>
            ) : diff.data ? (
              <DiffViewer diff={diff.data.diff} />
            ) : (
              <div className="faint text-sm">No diff available for this execution.</div>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}

export function ExecutionsPage(): JSX.Element {
  const params = useParams();
  const projectId = params.projectId; // undefined on the global page
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [openRow, setOpenRow] = useState<ExecRow | null>(null);

  const executions = useApi<ExecRow[]>(
    () =>
      (async (): Promise<ExecRow[]> => {
        if (projectId) {
          const list = await api.get<Execution[]>(`/projects/${projectId}/executions?limit=50`);
          return list.map((e) => ({ ...e }));
        }
        const projects = await api.get<Project[]>('/projects');
        const perProject = await Promise.all(
          projects.map(async (p): Promise<ExecRow[]> => {
            try {
              const list = await api.get<Execution[]>(`/projects/${p.id}/executions?limit=20`);
              return list.map((e) => ({ ...e, projectName: p.name }));
            } catch {
              return [];
            }
          }),
        );
        return perProject.flat().sort((a, b) => b.createdAt.localeCompare(a.createdAt));
      })(),
    [projectId],
  );

  const stats = useApi<ExecutionStats | null>(
    () => (projectId ? api.get<ExecutionStats>(`/executions/stats?projectId=${projectId}`) : api.get<ExecutionStats>('/executions/stats')),
    [projectId],
  );

  const list = executions.data ?? [];
  const hasActive = list.some((e) => ACTIVE.includes(e.status));
  usePolling(executions.reload, 3000, hasActive);
  usePolling(stats.reload, 15_000, true);

  const filtered = statusFilter === 'all' ? list : list.filter((e) => e.status === statusFilter);

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">{projectId ? 'Project executions' : 'Executions'}</div>
          <div className="page-sub">AI developer runs — implementation, tests, branches and pull requests</div>
        </div>
        <div className="page-actions">
          <Select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} style={{ width: 170 }} aria-label="Filter by status">
            <option value="all">All statuses</option>
            {STATUS_FILTERS.map((s) => (
              <option key={s} value={s}>
                {titleCase(s)}
              </option>
            ))}
          </Select>
        </div>
      </div>

      {stats.data ? (
        <div className="grid grid-4" style={{ marginBottom: 20 }}>
          <StatCard label="Total runs" value={stats.data.total} />
          <StatCard label="Succeeded" value={stats.data.succeeded} accent="success" />
          <StatCard label="Failed" value={stats.data.failed} accent="danger" />
          <StatCard label="Awaiting review" value={stats.data.awaitingReview} accent="warning" />
        </div>
      ) : null}

      {executions.loading && !executions.data ? (
        <Skeleton height={320} style={{ borderRadius: 10 }} />
      ) : executions.error ? (
        <ErrorState error={executions.error} onRetry={executions.reload} title="Failed to load executions" />
      ) : filtered.length === 0 ? (
        list.length === 0 ? (
          <EmptyState
            title="No executions yet"
            description="Open a task on the sprint board and run the AI developer agent — its runs appear here with logs, diffs and pull requests."
            icon={<IconZap size={18} />}
          />
        ) : (
          <EmptyState compact title="No executions match this filter" description="Try a different status filter." />
        )
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead>
              <tr>
                <th>Status</th>
                {projectId ? null : <th>Project</th>}
                <th>Summary</th>
                <th>Branch / PR</th>
                <th>Started</th>
                <th>Finished</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filtered.map((e) => (
                <tr key={e.id} className="table-click" onClick={() => setOpenRow(e)}>
                  <td>
                    <StatusBadge status={e.status} dot />
                  </td>
                  {projectId ? null : <td className="muted truncate" style={{ maxWidth: 140 }}>{e.projectName ?? '—'}</td>}
                  <td className="truncate" style={{ maxWidth: 300 }}>
                    {e.summary ?? <span className="faint">Running…</span>}
                    {e.error && !e.summary ? <span className="text-sm" style={{ color: 'var(--danger)' }}>{e.error}</span> : null}
                  </td>
                  <td>
                    <span className="row gap-2">
                      {e.branch ? <span className="mono text-sm muted truncate" style={{ maxWidth: 130 }}>{e.branch}</span> : <span className="faint">—</span>}
                      {e.prUrl ? (
                        <a
                          href={e.prUrl}
                          target="_blank"
                          rel="noreferrer noopener"
                          className="btn btn-ghost btn-sm"
                          onClick={(ev) => ev.stopPropagation()}
                          aria-label="Open pull request"
                        >
                          <IconGitPR size={12} />
                          {e.prNumber !== null ? `#${e.prNumber}` : ''}
                        </a>
                      ) : null}
                    </span>
                  </td>
                  <td className="muted">{formatRelative(e.createdAt)}</td>
                  <td className="muted">{e.finishedAt ? formatRelative(e.finishedAt) : '—'}</td>
                  <td style={{ width: 90 }} onClick={(ev) => ev.stopPropagation()}>
                    {ACTIVE.includes(e.status) ? (
                      <button
                        className="btn btn-ghost btn-sm"
                        onClick={async () => {
                          try {
                            await api.post(`/executions/${e.id}/cancel`);
                          } catch {
                            /* reload shows real state */
                          }
                          executions.reload();
                        }}
                        title="Cancel execution"
                      >
                        <IconX size={12} />
                      </button>
                    ) : (
                      <button className="btn btn-ghost btn-sm" onClick={() => setOpenRow(e)}>
                        View
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {hasActive ? (
        <div className="row gap-2 muted text-sm" style={{ marginTop: 12 }}>
          <span className="spinner" style={{ width: 12, height: 12 }} />
          Live — refreshing every 3s while executions are in flight
        </div>
      ) : null}

      <ExecutionDrawer row={openRow} onClose={() => setOpenRow(null)} onChanged={executions.reload} />
    </div>
  );
}

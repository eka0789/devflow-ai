import { useEffect, useState, type JSX } from 'react';
import type { AgentRole, AgentRun, AgentRunStep, BacklogProposal, Draft } from '@devflow/shared';
import { api } from '../lib/api';
import { formatDuration, formatRelative, titleCase, useApi, useProjectRequired, useToast } from '../lib/hooks';
import { MarkdownView } from '../components/MarkdownView';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Field, Textarea } from '../components/Field';
import { Skeleton } from '../components/Skeleton';
import { StatusBadge } from '../components/Badge';
import { IconAlert, IconCheck, IconChevronRight, IconX, IconZap } from '../components/icons';

const WORKFLOWS = [
  { id: 'full_planning', label: 'Full planning', hint: 'PRD → tech plan → backlog draft, end to end' },
  { id: 'prd_only', label: 'PRD only', hint: 'Product requirements document from your vision' },
  { id: 'tech_plan_only', label: 'Tech plan only', hint: 'Architecture & implementation plan' },
  { id: 'backlog_only', label: 'Backlog only', hint: 'Epics, stories and tasks draft' },
] as const;

type WorkflowId = (typeof WORKFLOWS)[number]['id'];

const AGENT_COLORS: Record<AgentRole, string> = {
  product_manager: '#6e7bff',
  architect: '#9b6eff',
  scrum_master: '#4cc2ff',
  developer: '#3fb68b',
  code_reviewer: '#e0a458',
  qa_engineer: '#f171a1',
  technical_writer: '#8a9099',
};

function StepIcon({ status }: { status: AgentRunStep['status'] | 'running' }): JSX.Element {
  if (status === 'ok') return <span className="step-icon ok"><IconCheck size={14} /></span>;
  if (status === 'failed') return <span className="step-icon failed"><IconAlert size={14} /></span>;
  if (status === 'skipped') return <span className="step-icon skipped"><IconX size={14} /></span>;
  return <span className="step-icon running spinner" style={{ width: 13, height: 13, borderWidth: 2 }} />;
}

function RunStepsView({ run }: { run: AgentRun }): JSX.Element {
  return (
    <div className="card" style={{ padding: '8px 16px' }}>
      {run.steps.length === 0 ? (
        <div className="row gap-2" style={{ padding: '12px 0' }}>
          <span className="spinner" />
          <span className="muted text-sm">Agents are warming up…</span>
        </div>
      ) : (
        run.steps.map((step, i) => (
          <div key={i} className="run-step">
            <StepIcon status={step.status} />
            <div className="flex-1" style={{ minWidth: 0 }}>
              <div className="row gap-2">
                <span
                  className="ps-avatar"
                  style={{ width: 18, height: 18, fontSize: 8, borderRadius: 4, background: AGENT_COLORS[step.agent] }}
                >
                  {step.agent.slice(0, 1).toUpperCase()}
                </span>
                <span className="weight-600">{titleCase(step.agent)}</span>
                <span className="muted text-sm truncate">{step.action}</span>
              </div>
              {step.detail ? <div className="muted text-sm clamp-2" style={{ marginTop: 2 }}>{step.detail}</div> : null}
            </div>
            <div className="faint text-sm tabular" style={{ whiteSpace: 'nowrap' }}>
              {formatDuration(step.durationMs)}
              {step.tokensOut > 0 ? ` · ${step.tokensOut} tok` : ''}
            </div>
          </div>
        ))
      )}
      {run.status === 'running' ? (
        <div className="row gap-2" style={{ padding: '10px 0 6px' }}>
          <span className="spinner" />
          <span className="muted text-sm">Workflow running — this panel updates live…</span>
        </div>
      ) : null}
      {run.status === 'failed' && run.error ? <div className="form-error">{run.error}</div> : null}
    </div>
  );
}

function DraftViewer({
  draftId,
  projectId,
  onClose,
  onChanged,
}: {
  draftId: string | null;
  projectId: string;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const { data: draft, loading, error, reload } = useApi<Draft | null>(
    () => (draftId ? api.get<Draft>(`/projects/${projectId}/drafts/${draftId}`) : Promise.resolve(null)),
    [draftId, projectId],
  );
  const [busy, setBusy] = useState(false);
  const [confirmApprove, setConfirmApprove] = useState(false);

  const approve = async (): Promise<void> => {
    if (!draft) return;
    setBusy(true);
    try {
      const res = await api.post<{ draft: Draft; created?: { epics: number; stories: number; tasks: number } }>(
        `/projects/${projectId}/drafts/${draft.id}/approve`,
        { createRecords: true },
      );
      if (res.created) {
        toast.success(`Approved — created ${res.created.epics} epics, ${res.created.stories} stories, ${res.created.tasks} tasks`);
      } else {
        toast.success('Draft approved');
      }
      setConfirmApprove(false);
      onClose();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to approve draft');
    } finally {
      setBusy(false);
    }
  };

  const reject = async (): Promise<void> => {
    if (!draft) return;
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/drafts/${draft.id}/reject`);
      toast.info('Draft rejected');
      onClose();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to reject draft');
    } finally {
      setBusy(false);
    }
  };

  const proposal = (() => {
    if (!draft || draft.type !== 'backlog') return null;
    try {
      return JSON.parse(draft.content) as BacklogProposal;
    } catch {
      return null;
    }
  })();

  return (
    <Drawer
      open={draftId !== null}
      onClose={onClose}
      title={draft?.title ?? 'Draft'}
      subtitle={draft ? `${titleCase(draft.type)} · updated ${formatRelative(draft.updatedAt)}` : undefined}
      footer={
        draft && draft.status === 'draft' ? (
          <>
            <button className="btn" onClick={() => void reject()} disabled={busy}>
              Reject
            </button>
            <div className="spacer" />
            <button className="btn btn-primary" onClick={() => setConfirmApprove(true)} disabled={busy}>
              Approve
            </button>
          </>
        ) : draft ? (
          <span className="muted text-sm">
            {draft.status === 'approved' ? 'This draft was approved.' : 'This draft was rejected.'}
          </span>
        ) : null
      }
    >
      {error ? <ErrorState error={error} onRetry={reload} compact /> : null}
      {loading && !draft ? <Skeleton height={300} /> : null}
      {draft ? (
        <>
          <StatusBadge status={draft.status === 'draft' ? 'planned' : draft.status === 'approved' ? 'done' : 'cancelled'} />
          {draft.type === 'backlog' && proposal ? (
            <div className="stack gap-3">
              {proposal.epics.map((epic, ei) => (
                <div key={ei} className="epic-block">
                  <div className="epic-header">
                    <span className="epic-dot" style={{ background: epic.color ?? 'var(--accent)' }} />
                    <span className="epic-title flex-1">{epic.title}</span>
                    <span className="faint text-sm">{epic.stories.length} stories</span>
                  </div>
                  <div className="story-list" style={{ padding: '10px 14px', rowGap: 10, display: 'flex', flexDirection: 'column' }}>
                    {epic.description ? <div className="muted text-sm">{epic.description}</div> : null}
                    {epic.stories.map((story, si) => (
                      <div key={si} className="card" style={{ padding: 12 }}>
                        <div className="row gap-2 wrap">
                          <span className="weight-600 flex-1">{story.title}</span>
                          <span className="points-pill">{story.points}</span>
                          <span className={`badge priority-${story.priority}`}>{titleCase(story.priority)}</span>
                        </div>
                        {story.description ? <div className="muted text-sm" style={{ marginTop: 4 }}>{story.description}</div> : null}
                        {story.acceptanceCriteria.length > 0 ? (
                          <ul className="ac-list" style={{ marginTop: 8 }}>
                            {story.acceptanceCriteria.map((ac, ai) => (
                              <li key={ai} className="ac-item">
                                <span className="ac-check">✓</span>
                                <span>{ac}</span>
                              </li>
                            ))}
                          </ul>
                        ) : null}
                        {story.tasks.length > 0 ? (
                          <div className="stack gap-1" style={{ marginTop: 8 }}>
                            <div className="uppercase-label">Tasks</div>
                            {story.tasks.map((t, ti) => (
                              <div key={ti} className="task-row" style={{ padding: '5px 8px' }}>
                                <IconChevronRight size={12} style={{ color: 'var(--text-faint)' }} />
                                <span className="flex-1 truncate">{t.title}</span>
                              </div>
                            ))}
                          </div>
                        ) : null}
                      </div>
                    ))}
                  </div>
                </div>
              ))}
            </div>
          ) : (
            <MarkdownView source={draft.content} />
          )}
        </>
      ) : null}

      <ConfirmDialog
        open={confirmApprove}
        title="Approve draft"
        message={
          <>
            Approving this draft{draft?.type === 'backlog' ? ' creates the epics, stories and tasks in your real backlog' : ''}.
            The draft becomes read-only afterwards. Continue?
          </>
        }
        confirmLabel="Approve & create"
        busy={busy}
        onConfirm={() => void approve()}
        onCancel={() => setConfirmApprove(false)}
      />
    </Drawer>
  );
}

export function PlanningPage(): JSX.Element {
  const ctx = useProjectRequired();
  const projectId = ctx.projectId;
  const toast = useToast();

  const agents = useApi<{ agents: Array<{ role: AgentRole; name: string; description: string }> }>(
    () => api.get<{ agents: Array<{ role: AgentRole; name: string; description: string }> }>('/agents'),
    [],
  );
  const runs = useApi<AgentRun[]>(() => api.get<AgentRun[]>(`/projects/${projectId}/agent-runs?limit=10`), [projectId]);
  const drafts = useApi<Draft[]>(() => api.get<Draft[]>(`/projects/${projectId}/drafts`), [projectId]);

  const [workflow, setWorkflow] = useState<WorkflowId>('full_planning');
  const [vision, setVision] = useState('');
  const [launching, setLaunching] = useState(false);
  const [currentRun, setCurrentRun] = useState<AgentRun | null>(null);
  const [openDraftId, setOpenDraftId] = useState<string | null>(null);

  // Poll the active run every 2s until it finishes.
  useEffect(() => {
    if (!currentRun || currentRun.status !== 'running') return;
    let cancelled = false;
    const id = window.setInterval(() => {
      api
        .get<AgentRun>(`/projects/${projectId}/agent-runs/${currentRun.id}`)
        .then((fresh) => {
          if (cancelled) return;
          setCurrentRun(fresh);
          if (fresh.status !== 'running') {
            if (fresh.status === 'succeeded') toast.success('Workflow finished');
            if (fresh.status === 'failed') toast.error(`Workflow failed: ${fresh.error ?? 'unknown error'}`);
            void runs.reload();
            void drafts.reload();
          }
        })
        .catch(() => undefined);
    }, 2000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentRun?.id, currentRun?.status, projectId]);

  const launch = async (): Promise<void> => {
    setLaunching(true);
    try {
      const run = await api.post<AgentRun>(`/projects/${projectId}/workflows`, {
        workflow,
        vision: vision.trim(),
      });
      setCurrentRun(run);
      setVision('');
      toast.info('Workflow launched — agents are working');
      void runs.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to launch workflow');
    } finally {
      setLaunching(false);
    }
  };

  const draftList = drafts.data ?? [];
  const openDrafts = draftList.filter((d) => d.status === 'draft');
  const pastDrafts = draftList.filter((d) => d.status !== 'draft');
  const runList = runs.data ?? [];

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">AI Planning</div>
          <div className="page-sub">Agent team that turns a vision into a PRD, tech plan and backlog</div>
        </div>
      </div>

      <section className="card">
        <div className="card-header">
          <div className="card-title">Launch a workflow</div>
        </div>
        <div className="stack gap-3">
          <div className="grid grid-2">
            {WORKFLOWS.map((wf) => (
              <label key={wf.id} className={`radio-card ${workflow === wf.id ? 'selected' : ''}`}>
                <input
                  type="radio"
                  name="workflow"
                  checked={workflow === wf.id}
                  onChange={() => setWorkflow(wf.id)}
                />
                <div className="stack gap-1" style={{ gap: 2 }}>
                  <span className="weight-600">{wf.label}</span>
                  <span className="muted text-sm">{wf.hint}</span>
                </div>
              </label>
            ))}
          </div>
          <Field label="Product vision" required hint="Describe what you want to build — the more context, the better the plan.">
            <Textarea
              value={vision}
              onChange={(e) => setVision(e.target.value)}
              rows={5}
              maxLength={8000}
              placeholder="e.g. A habit tracker for remote teams with Slack check-ins, streaks and a weekly digest…"
            />
          </Field>
          <div className="row justify-end">
            <button
              className="btn btn-primary"
              onClick={() => void launch()}
              disabled={launching || vision.trim().length < 10 || currentRun?.status === 'running'}
            >
              {launching ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : <IconZap size={14} />}
              Run workflow
            </button>
          </div>
        </div>
      </section>

      {currentRun ? (
        <section className="section">
          <div className="section-title row gap-2">
            Current run
            <StatusBadge status={currentRun.status === 'running' ? 'running' : currentRun.status === 'succeeded' ? 'succeeded' : currentRun.status === 'failed' ? 'failed' : 'cancelled'} />
            <span className="faint text-sm">{titleCase(currentRun.workflow.replace(/_/g, ' '))}</span>
          </div>
          <RunStepsView run={currentRun} />
        </section>
      ) : null}

      <section className="section">
        <div className="section-title">Agent team</div>
        {agents.loading ? (
          <Skeleton height={120} style={{ borderRadius: 10 }} />
        ) : agents.error ? (
          <ErrorState error={agents.error} onRetry={agents.reload} compact />
        ) : (
          <div className="agent-grid">
            {(agents.data?.agents ?? []).map((a) => (
              <div key={a.role} className="agent-card">
                <span
                  className="agent-avatar"
                  style={{ background: AGENT_COLORS[a.role] }}
                >
                  {a.name.slice(0, 1).toUpperCase()}
                </span>
                <div className="stack gap-1" style={{ gap: 2, minWidth: 0 }}>
                  <span className="weight-600 truncate">{a.name}</span>
                  <span className="muted text-sm" style={{ lineHeight: 1.45 }}>
                    {a.description}
                  </span>
                </div>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="section">
        <div className="section-title">Drafts</div>
        {drafts.loading ? (
          <Skeleton height={120} style={{ borderRadius: 10 }} />
        ) : drafts.error ? (
          <ErrorState error={drafts.error} onRetry={drafts.reload} compact />
        ) : draftList.length === 0 ? (
          <EmptyState
            compact
            title="No drafts yet"
            description="Run a planning workflow above — the PRD, tech plan and backlog it produces land here for your review."
          />
        ) : (
          <div className="stack gap-2">
            {openDrafts.length > 0 ? (
              <>
                <div className="uppercase-label">Awaiting review ({openDrafts.length})</div>
                {openDrafts.map((d) => (
                  <button key={d.id} className="card card-clickable row gap-3" style={{ textAlign: 'left' }} onClick={() => setOpenDraftId(d.id)}>
                    <span className="badge badge-accent">{titleCase(d.type)}</span>
                    <span className="weight-600 flex-1 truncate">{d.title}</span>
                    <span className="faint text-sm">{formatRelative(d.updatedAt)}</span>
                    <IconChevronRight size={14} style={{ color: 'var(--text-faint)' }} />
                  </button>
                ))}
              </>
            ) : null}
            {pastDrafts.length > 0 ? (
              <>
                <div className="uppercase-label">Decided</div>
                {pastDrafts.map((d) => (
                  <button key={d.id} className="card card-clickable row gap-3" style={{ textAlign: 'left', opacity: 0.85 }} onClick={() => setOpenDraftId(d.id)}>
                    <span className="badge badge-outline">{titleCase(d.type)}</span>
                    <span className="flex-1 truncate muted">{d.title}</span>
                    <span className={`badge ${d.status === 'approved' ? 'badge-success' : 'badge-danger'}`}>{titleCase(d.status)}</span>
                    <span className="faint text-sm">{formatRelative(d.updatedAt)}</span>
                  </button>
                ))}
              </>
            ) : null}
          </div>
        )}
      </section>

      {runList.length > 0 ? (
        <section className="section">
          <div className="section-title">Recent runs</div>
          <div className="table-wrap">
            <table className="table">
              <thead>
                <tr>
                  <th>Workflow</th>
                  <th>Status</th>
                  <th>Steps</th>
                  <th>Tokens</th>
                  <th>Started</th>
                  <th />
                </tr>
              </thead>
              <tbody>
                {runList.map((r) => (
                  <tr key={r.id}>
                    <td className="weight-600">{titleCase(r.workflow.replace(/_/g, ' '))}</td>
                    <td>
                      <StatusBadge status={r.status === 'running' ? 'running' : r.status === 'succeeded' ? 'succeeded' : r.status === 'failed' ? 'failed' : 'cancelled'} />
                    </td>
                    <td className="tabular">{r.steps.length}</td>
                    <td className="tabular muted">{(r.tokensIn + r.tokensOut).toLocaleString('en-US')}</td>
                    <td className="muted">{formatRelative(r.createdAt)}</td>
                    <td style={{ width: 40 }}>
                      <button className="btn btn-ghost btn-sm" onClick={() => setCurrentRun(r)} title="View run">
                        <IconChevronRight size={13} />
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      ) : null}

      <DraftViewer draftId={openDraftId} projectId={projectId} onClose={() => setOpenDraftId(null)} onChanged={() => void drafts.reload()} />
    </div>
  );
}

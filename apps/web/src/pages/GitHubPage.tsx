import { useState, type JSX } from 'react';
import type { GitHubBranch, GitHubCommit, GitHubPR, GitHubPRFile, GitHubRepoSummary } from '@devflow/shared';
import { api, ApiError } from '../lib/api';
import { formatDateTime, formatRelative, useApi, useProjectRequired, useToast } from '../lib/hooks';
import { Badge, CiBadge, StatusBadge } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { DiffViewer } from '../components/DiffViewer';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Field, Input, Select } from '../components/Field';
import { Skeleton } from '../components/Skeleton';
import { Tabs } from '../components/Tabs';
import { IconBranch, IconExternal, IconGitPR, IconGitHub, IconLock, IconPlus, IconX } from '../components/icons';

function ConnectTokenForm({ onConnected }: { onConnected: () => void }): JSX.Element {
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const toast = useToast();

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.put('/github/token', { token: token.trim() });
      toast.success('GitHub token saved');
      setToken('');
      onConnected();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="card card-pad-lg" style={{ maxWidth: 520, margin: '0 auto' }}>
      <div className="stack gap-3">
        <div className="row gap-2 justify-center">
          <span className="empty-icon" style={{ width: 44, height: 44 }}>
            <IconGitHub size={20} />
          </span>
        </div>
        <div className="weight-600" style={{ fontSize: 16, textAlign: 'center' }}>
          Connect GitHub
        </div>
        <div className="muted text-sm" style={{ textAlign: 'center' }}>
          DevFlow needs a personal access token (classic, with <span className="mono">repo</span> scope) to read
          repositories, open pull requests and push AI-generated branches on your behalf.
        </div>
        {error ? <div className="form-error">{error}</div> : null}
        <Field label="Personal access token" required>
          <Input
            type="password"
            value={token}
            onChange={(e) => setToken(e.target.value)}
            placeholder="ghp_…"
            autoComplete="off"
            maxLength={200}
          />
        </Field>
        <div className="row gap-2 muted text-sm">
          <IconLock size={13} />
          Encrypted at rest — the token is never returned by the API after saving.
        </div>
        <button className="btn btn-primary btn-lg btn-block" onClick={() => void submit()} disabled={busy || token.trim().length < 20}>
          {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : null}
          Connect GitHub
        </button>
      </div>
    </div>
  );
}

function RepoPicker({ projectId }: { projectId: string }): JSX.Element {
  const repos = useApi<GitHubRepoSummary[]>(() => api.get<GitHubRepoSummary[]>('/github/repos'), []);
  const toast = useToast();
  const [busyRepo, setBusyRepo] = useState<string | null>(null);

  const connect = async (repoFullName: string): Promise<void> => {
    setBusyRepo(repoFullName);
    try {
      await api.post(`/projects/${projectId}/github/connect`, { repoFullName });
      toast.success(`Connected ${repoFullName}`);
      window.location.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to connect repository');
      setBusyRepo(null);
    }
  };

  return (
    <div className="stack gap-3">
      <div className="muted text-sm">
        Pick which repository this project should work against. AI executions will branch from its default branch.
      </div>
      {repos.loading ? (
        <Skeleton height={220} style={{ borderRadius: 10 }} />
      ) : repos.error ? (
        <ErrorState error={repos.error} onRetry={repos.reload} title="Failed to load repositories" />
      ) : !repos.data || repos.data.length === 0 ? (
        <EmptyState compact title="No repositories found" description="The token can't see any repositories. Check its scopes." />
      ) : (
        <div className="file-list">
          {repos.data.map((repo) => (
            <div key={repo.fullName} className="file-row">
              <span className="faint">
                <IconGitHub size={15} />
              </span>
              <span className="mono weight-600 flex-1 truncate">{repo.fullName}</span>
              {repo.private ? <Badge className="badge-outline">private</Badge> : null}
              <span className="faint text-sm">{formatRelative(repo.updatedAt)}</span>
              <button className="btn btn-sm btn-primary" onClick={() => void connect(repo.fullName)} disabled={busyRepo === repo.fullName}>
                {busyRepo === repo.fullName ? <span className="spinner" /> : <IconPlus size={12} />}
                Connect
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

function PrDetailDrawer({
  prNumber,
  projectId,
  onClose,
  onChanged,
}: {
  prNumber: number | null;
  projectId: string;
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<{ pr: GitHubPR; files: GitHubPRFile[] } | null>(
    () => (prNumber !== null ? api.get(`/projects/${projectId}/github/prs/${prNumber}`) : Promise.resolve(null)),
    [prNumber, projectId],
  );
  const [confirmMerge, setConfirmMerge] = useState(false);
  const [busy, setBusy] = useState(false);
  const [openFile, setOpenFile] = useState<string | null>(null);

  const pr = data?.pr;
  const files = data?.files ?? [];

  const merge = async (): Promise<void> => {
    if (!pr) return;
    setBusy(true);
    try {
      await api.post(`/projects/${projectId}/github/prs/${pr.number}/merge`, { confirmation: 'MERGE', mergeMethod: 'squash' });
      toast.success(`PR #${pr.number} merged`);
      setConfirmMerge(false);
      onClose();
      onChanged();
    } catch (err) {
      const message = err instanceof ApiError ? err.message : 'Merge failed';
      toast.error(message);
      setConfirmMerge(false);
      reload();
    } finally {
      setBusy(false);
    }
  };

  const canMerge = pr ? pr.state === 'open' && !pr.draft && pr.mergeable !== false && pr.ciStatus !== 'failure' : false;

  return (
    <Drawer
      open={prNumber !== null}
      onClose={onClose}
      title={pr ? `#${pr.number} — ${pr.title}` : 'Pull request'}
      subtitle={pr ? `${pr.headBranch} → ${pr.baseBranch}` : undefined}
      footer={
        pr ? (
          <>
            <a className="btn btn-ghost" href={pr.url} target="_blank" rel="noreferrer noopener">
              <IconExternal size={13} />
              View on GitHub
            </a>
            <div className="spacer" />
            <button className="btn btn-primary" onClick={() => setConfirmMerge(true)} disabled={!canMerge || busy} title={canMerge ? 'Merge pull request' : 'Not mergeable (draft, closed, conflicts or failing CI)'}>
              Merge pull request
            </button>
          </>
        ) : null
      }
    >
      {error ? <ErrorState error={error} onRetry={reload} compact /> : null}
      {loading && !pr ? <Skeleton height={260} /> : null}
      {pr ? (
        <>
          <div className="row gap-2 wrap">
            <StatusBadge status={pr.merged ? 'done' : pr.state === 'open' ? 'in_review' : 'cancelled'} />
            {pr.draft ? <Badge className="badge-outline">Draft</Badge> : null}
            {pr.merged ? <Badge className="badge-success">Merged</Badge> : null}
            <CiBadge ci={pr.ciStatus} />
            {pr.mergeable === false ? <Badge className="badge-danger">Conflicts</Badge> : null}
          </div>

          <div className="stack gap-2">
            <div className="uppercase-label">Changes ({files.length} files)</div>
            {files.length === 0 ? (
              <div className="faint text-sm">No file changes in this PR.</div>
            ) : (
              <div className="file-list">
                {files.map((f) => (
                  <div key={f.filename}>
                    <button
                      className="file-row"
                      onClick={() => setOpenFile(openFile === f.filename ? null : f.filename)}
                      aria-expanded={openFile === f.filename}
                    >
                      <span className="mono flex-1 truncate" style={{ fontSize: 12.5 }}>
                        {f.filename}
                      </span>
                      <span className={`file-action ${f.status === 'added' ? 'add' : f.status === 'removed' ? 'delete' : 'changed'}`}>
                        {f.status}
                      </span>
                      <span className="diffstat-add">+{f.additions}</span>
                      <span className="diffstat-del">-{f.deletions}</span>
                    </button>
                    {openFile === f.filename ? (
                      <div style={{ padding: 8 }}>
                        {f.patch ? (
                          <DiffViewer diff={f.patch} emptyMessage="No patch available" />
                        ) : (
                          <div className="chart-empty">Binary or too large to display</div>
                        )}
                      </div>
                    ) : null}
                  </div>
                ))}
              </div>
            )}
          </div>
        </>
      ) : null}

      <ConfirmDialog
        open={confirmMerge}
        title={`Merge PR #${pr?.number ?? ''}`}
        message={
          <>
            This squash-merges <strong>{pr?.title}</strong> into <span className="mono">{pr?.baseBranch}</span> on GitHub.
            This action is recorded in the audit log and cannot be undone from DevFlow.
          </>
        }
        confirmLabel="Merge"
        danger
        requireText="MERGE"
        busy={busy}
        onConfirm={() => void merge()}
        onCancel={() => setConfirmMerge(false)}
      />
    </Drawer>
  );
}

export function GitHubPage(): JSX.Element {
  const ctx = useProjectRequired();
  const projectId = ctx.projectId;
  const project = ctx.project;
  const toast = useToast();

  const status = useApi<{ connected: boolean }>(() => api.get<{ connected: boolean }>('/github/status'), []);
  const [tab, setTab] = useState('prs');
  const [openPr, setOpenPr] = useState<number | null>(null);
  const [selectedBranch, setSelectedBranch] = useState<string | null>(null);
  const [disconnecting, setDisconnecting] = useState(false);

  const connected = status.data?.connected ?? false;
  const repoConnected = Boolean(project?.repoFullName);

  const branches = useApi<GitHubBranch[]>(
    () => (repoConnected ? api.get<GitHubBranch[]>(`/projects/${projectId}/github/branches`) : Promise.resolve([])),
    [projectId, repoConnected],
  );
  const branchList = branches.data ?? [];
  const effectiveBranch = selectedBranch ?? project?.repoDefaultBranch ?? branchList[0]?.name ?? null;

  const commits = useApi<GitHubCommit[]>(
    () =>
      repoConnected && effectiveBranch
        ? api.get<GitHubCommit[]>(`/projects/${projectId}/github/commits?branch=${encodeURIComponent(effectiveBranch)}`)
        : Promise.resolve([]),
    [projectId, effectiveBranch, repoConnected],
  );
  const prs = useApi<GitHubPR[]>(
    () => (repoConnected ? api.get<GitHubPR[]>(`/projects/${projectId}/github/prs`) : Promise.resolve([])),
    [projectId, repoConnected],
  );
  const prList = prs.data ?? [];

  const disconnect = async (): Promise<void> => {
    try {
      await api.post(`/projects/${projectId}/github/disconnect`);
      toast.info('Repository disconnected');
      setDisconnecting(false);
      void ctx.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to disconnect');
    }
  };

  if (status.loading || (ctx.loading && !ctx.project)) {
    return (
      <div className="page">
        <Skeleton height={300} style={{ borderRadius: 10 }} />
      </div>
    );
  }

  if (ctx.error) {
    return (
      <div className="page">
        <ErrorState error={ctx.error} onRetry={ctx.reload} title="Failed to load project" />
      </div>
    );
  }

  if (status.error) {
    return (
      <div className="page">
        <ErrorState error={status.error} onRetry={status.reload} title="Failed to load GitHub status" />
      </div>
    );
  }

  if (!connected) {
    return (
      <div className="page">
        <div className="page-header">
          <div>
            <div className="page-title">GitHub</div>
            <div className="page-sub">Connect your account to enable repository-aware AI executions</div>
          </div>
        </div>
        <ConnectTokenForm onConnected={status.reload} />
      </div>
    );
  }

  return (
    <div className="page">
      <div className="page-header">
        <div style={{ minWidth: 0 }}>
          <div className="page-title">GitHub</div>
          <div className="page-sub row gap-2">
            {repoConnected ? (
              <>
                <IconGitHub size={14} />
                <span className="mono">{project?.repoFullName}</span>
                <span className="chip">{project?.repoDefaultBranch ?? 'main'}</span>
              </>
            ) : (
              'Account connected — choose a repository for this project below.'
            )}
          </div>
        </div>
        {repoConnected ? (
          <div className="page-actions">
            <button className="btn" onClick={() => setDisconnecting(true)}>
              <IconX size={13} />
              Disconnect repo
            </button>
          </div>
        ) : null}
      </div>

      {!repoConnected ? (
        <RepoPicker projectId={projectId} />
      ) : (
        <>
          <Tabs
            tabs={[
              { id: 'branches', label: 'Branches', count: branches.data?.length },
              { id: 'commits', label: 'Commits' },
              { id: 'prs', label: 'Pull requests', count: prList.length },
            ]}
            active={tab}
            onChange={setTab}
          />

          {tab === 'branches' ? (
            branches.loading ? (
              <Skeleton height={220} style={{ borderRadius: 10 }} />
            ) : branches.error ? (
              <ErrorState error={branches.error} onRetry={branches.reload} />
            ) : branchList.length === 0 ? (
              <EmptyState compact title="No branches found" />
            ) : (
              <div className="table-wrap">
                <table className="table">
                  <thead>
                    <tr>
                      <th>Branch</th>
                      <th>Latest commit</th>
                      <th />
                    </tr>
                  </thead>
                  <tbody>
                    {branchList.map((b) => (
                      <tr key={b.name}>
                        <td>
                          <span className="row gap-2">
                            <IconBranch size={13} style={{ color: 'var(--text-faint)' }} />
                            <span className="mono weight-600">{b.name}</span>
                            {b.name === project?.repoDefaultBranch ? <Badge className="badge-accent">default</Badge> : null}
                          </span>
                        </td>
                        <td className="mono muted text-sm">{b.sha.slice(0, 7)}</td>
                        <td style={{ width: 110 }}>
                          <button
                            className="btn btn-ghost btn-sm"
                            onClick={() => {
                              setSelectedBranch(b.name);
                              setTab('commits');
                            }}
                          >
                            Commits
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )
          ) : null}

          {tab === 'commits' ? (
            <div className="stack gap-3">
              <div className="row gap-2">
                <span className="text-sm muted">Branch</span>
                <Select
                  value={effectiveBranch ?? ''}
                  onChange={(e) => setSelectedBranch(e.target.value)}
                  style={{ width: 240 }}
                  aria-label="Select branch"
                >
                  {branchList.length === 0 ? <option value="">{effectiveBranch ?? 'main'}</option> : null}
                  {branchList.map((b) => (
                    <option key={b.name} value={b.name}>
                      {b.name}
                    </option>
                  ))}
                </Select>
              </div>
              {commits.loading ? (
                <Skeleton height={260} style={{ borderRadius: 10 }} />
              ) : commits.error ? (
                <ErrorState error={commits.error} onRetry={commits.reload} />
              ) : !commits.data || commits.data.length === 0 ? (
                <EmptyState compact title="No commits on this branch" />
              ) : (
                <div className="card" style={{ padding: '6px 16px' }}>
                  <div className="feed">
                    {commits.data.map((c) => (
                      <div key={c.sha} className="feed-item" style={{ alignItems: 'flex-start' }}>
                        <span className="feed-dot" style={{ background: 'var(--text-faint)' }} />
                        <div className="flex-1" style={{ minWidth: 0 }}>
                          <div className="feed-msg weight-500">{c.message.split('\n')[0]}</div>
                          <div className="faint text-sm">
                            <span className="mono">{c.sha.slice(0, 7)}</span> · {c.author} · {formatDateTime(c.date)}
                          </div>
                        </div>
                        <a href={c.url} target="_blank" rel="noreferrer noopener" className="btn btn-ghost btn-sm" aria-label="View commit on GitHub">
                          <IconExternal size={12} />
                        </a>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : null}

          {tab === 'prs' ? (
            prs.loading ? (
              <Skeleton height={260} style={{ borderRadius: 10 }} />
            ) : prs.error ? (
              <ErrorState error={prs.error} onRetry={prs.reload} />
            ) : prList.length === 0 ? (
              <EmptyState
                compact
                title="No pull requests"
                description="Run an AI execution on a task — successful runs open a PR automatically."
              />
            ) : (
              <div className="stack gap-2">
                {prList.map((pr) => (
                  <button
                    key={pr.number}
                    className="card card-clickable row gap-3 wrap"
                    style={{ textAlign: 'left' }}
                    onClick={() => setOpenPr(pr.number)}
                  >
                    <IconGitPR size={15} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
                    <span className="mono faint">#{pr.number}</span>
                    <span className="weight-600 flex-1 truncate" style={{ minWidth: 160 }}>
                      {pr.title}
                    </span>
                    {pr.draft ? <Badge className="badge-outline">Draft</Badge> : null}
                    {pr.merged ? <Badge className="badge-success">Merged</Badge> : null}
                    <CiBadge ci={pr.ciStatus} />
                    <StatusBadge status={pr.state === 'open' ? 'in_review' : 'cancelled'} />
                    <span className="faint text-sm">{formatRelative(pr.updatedAt)}</span>
                  </button>
                ))}
              </div>
            )
          ) : null}
        </>
      )}

      <PrDetailDrawer prNumber={openPr} projectId={projectId} onClose={() => setOpenPr(null)} onChanged={() => void prs.reload()} />

      <ConfirmDialog
        open={disconnecting}
        title="Disconnect repository"
        message={<>AI executions will be unavailable for this project until you connect a repository again.</>}
        confirmLabel="Disconnect"
        danger
        onConfirm={() => void disconnect()}
        onCancel={() => setDisconnecting(false)}
      />
    </div>
  );
}

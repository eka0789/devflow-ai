import { useState, type JSX } from 'react';
import type {
  AISettingsPublic,
  OutgoingWebhook,
  OutgoingWebhookFormat,
  User,
  WorkspaceInvite,
  WorkspaceMember,
  WorkspaceRoster,
  WorkspaceRole,
} from '@devflow/shared';
import { api } from '../lib/api';
import { formatDate, initialsOf, titleCase, useApi, useAuth, useTheme, useToast } from '../lib/hooks';
import { Badge } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Field, Input, Select } from '../components/Field';
import { Skeleton } from '../components/Skeleton';
import {
  IconCheck,
  IconGitHub,
  IconInfo,
  IconLock,
  IconMoon,
  IconPlus,
  IconSend,
  IconSun,
  IconTrash,
  IconUser,
  IconZap,
} from '../components/icons';

function ProfileSection(): JSX.Element {
  const { user, updateUser } = useAuth();
  const toast = useToast();
  const [name, setName] = useState(user?.name ?? '');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const me = await api.patch<{ user: User }>('/auth/me', { name: name.trim() });
      updateUser(me.user);
      toast.success('Profile updated');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update profile');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-pad-lg">
      <div className="card-header">
        <div className="card-title row gap-2">
          <IconUser size={15} />
          Profile
        </div>
      </div>
      <div className="stack gap-3" style={{ maxWidth: 420 }}>
        <Field label="Display name">
          <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
        </Field>
        <Field label="Email" hint="Email is your login and cannot be changed.">
          <Input value={user?.email ?? ''} disabled />
        </Field>
        <div className="row justify-end">
          <button className="btn btn-primary" onClick={() => void save()} disabled={busy || name.trim().length < 2 || name === user?.name}>
            {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : null}
            Save profile
          </button>
        </div>
      </div>
    </section>
  );
}

function AIProviderSection(): JSX.Element {
  const settings = useApi<AISettingsPublic>(() => api.get<AISettingsPublic>('/ai/settings'), []);
  const toast = useToast();
  const [baseUrl, setBaseUrl] = useState('');
  const [model, setModel] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [verifying, setVerifying] = useState(false);
  const [verifyResult, setVerifyResult] = useState<string | null>(null);
  const [seededFor, setSeededFor] = useState<string>('');

  const data = settings.data;
  if (data && seededFor !== 'seeded') {
    setSeededFor('seeded');
    setBaseUrl(data.baseUrl ?? '');
    setModel(data.model ?? '');
  }

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      const updated = await api.put<AISettingsPublic>('/ai/settings', {
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim() === '' ? null : apiKey.trim(),
        model: model.trim(),
      });
      settings.setData(updated);
      setApiKey('');
      toast.success('AI provider settings saved');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save AI settings');
    } finally {
      setBusy(false);
    }
  };

  const verify = async (): Promise<void> => {
    setVerifying(true);
    setVerifyResult(null);
    try {
      const res = await api.post<{ ok: boolean; model?: string; latencyMs?: number; error?: string }>('/ai/verify');
      if (res.ok) {
        setVerifyResult(`Connected — ${res.model ?? model} responded in ${res.latencyMs ?? '?'}ms`);
      } else {
        setVerifyResult(`Failed: ${res.error ?? 'unknown error'}`);
      }
    } catch (err) {
      setVerifyResult(`Failed: ${err instanceof Error ? err.message : 'unknown error'}`);
    } finally {
      setVerifying(false);
    }
  };

  return (
    <section className="card card-pad-lg">
      <div className="card-header">
        <div className="card-title row gap-2">
          <IconZap size={15} />
          AI provider
          {settings.data ? (
            <Badge className={settings.data.configured ? 'badge-success' : 'badge-warning'} dot>
              {settings.data.configured ? (settings.data.source === 'env' ? 'Configured via environment' : 'Configured') : 'Not configured'}
            </Badge>
          ) : null}
        </div>
      </div>
      {settings.loading ? (
        <Skeleton height={220} />
      ) : settings.error ? (
        <ErrorState error={settings.error} onRetry={settings.reload} compact />
      ) : (
        <div className="stack gap-3" style={{ maxWidth: 480 }}>
          <Field label="Base URL" hint="Your provider chat-completions base, e.g. https://api.openai.com/v1 - /chat/completions is appended automatically">
            <Input value={baseUrl} onChange={(e) => setBaseUrl(e.target.value)} placeholder="https://api.openai.com/v1" />
          </Field>
          <Field label="Model">
            <Input value={model} onChange={(e) => setModel(e.target.value)} placeholder="gpt-4o" />
          </Field>
          <Field
            label="API key"
            hint={data?.configured && data.source === 'user' ? 'Leave blank to keep the stored key.' : 'Stored encrypted at rest; never displayed again.'}
          >
            <Input
              type="password"
              value={apiKey}
              onChange={(e) => setApiKey(e.target.value)}
              placeholder={data?.configured && data.source === 'user' ? '••• stored' : 'sk-…'}
              autoComplete="off"
            />
          </Field>
          {verifyResult ? (
            <div className={verifyResult.startsWith('Connected') ? 'form-success' : 'form-error'}>{verifyResult}</div>
          ) : null}
          <div className="row gap-2 justify-end">
            <button className="btn" onClick={() => void verify()} disabled={verifying}>
              {verifying ? <span className="spinner" /> : <IconCheck size={14} />}
              Test connection
            </button>
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy || !baseUrl.trim() || !model.trim()}>
              {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : null}
              Save provider
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

function GitHubSection(): JSX.Element {
  const status = useApi<{ connected: boolean }>(() => api.get<{ connected: boolean }>('/github/status'), []);
  const toast = useToast();
  const [token, setToken] = useState('');
  const [busy, setBusy] = useState(false);

  const save = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.put('/github/token', { token: token.trim() });
      toast.success('GitHub token saved');
      setToken('');
      status.setData({ connected: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to save token');
    } finally {
      setBusy(false);
    }
  };

  const remove = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.del('/github/token');
      toast.info('GitHub token removed');
      status.setData({ connected: false });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove token');
    } finally {
      setBusy(false);
    }
  };

  return (
    <section className="card card-pad-lg">
      <div className="card-header">
        <div className="card-title row gap-2">
          <IconGitHub size={15} />
          GitHub
          {status.data ? (
            <Badge className={status.data.connected ? 'badge-success' : 'badge-warning'} dot>
              {status.data.connected ? 'Connected' : 'Not connected'}
            </Badge>
          ) : null}
        </div>
      </div>
      {status.loading ? (
        <Skeleton height={140} />
      ) : status.error ? (
        <ErrorState error={status.error} onRetry={status.reload} compact />
      ) : (
        <div className="stack gap-3" style={{ maxWidth: 480 }}>
          <Field label="Personal access token" hint="Classic token with repo scope. Used to read repos, push branches and manage PRs.">
            <Input
              type="password"
              value={token}
              onChange={(e) => setToken(e.target.value)}
              placeholder={status.data?.connected ? '••• stored' : 'ghp_…'}
              autoComplete="off"
              maxLength={200}
            />
          </Field>
          <div className="row gap-2 muted text-sm">
            <IconLock size={13} />
            Tokens are encrypted at rest and never returned by the API after saving.
          </div>
          <div className="row gap-2 justify-end">
            {status.data?.connected ? (
              <button className="btn btn-danger" onClick={() => void remove()} disabled={busy}>
                Remove token
              </button>
            ) : null}
            <button className="btn btn-primary" onClick={() => void save()} disabled={busy || token.trim().length < 20}>
              {busy ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : null}
              {status.data?.connected ? 'Replace token' : 'Save token'}
            </button>
          </div>
        </div>
      )}
    </section>
  );
}

// ---------- workspace team ----------

const ROLE_CLASS: Record<WorkspaceRole, string> = {
  owner: 'badge-accent',
  maintainer: 'badge-info',
  viewer: 'badge-outline',
};

function memberDisplayName(member: WorkspaceMember): string {
  return member.userName ?? member.userEmail ?? 'Unknown';
}

function WorkspaceTeamSection(): JSX.Element {
  const { user } = useAuth();
  const toast = useToast();
  const roster = useApi<WorkspaceRoster>(() => api.get<WorkspaceRoster>('/workspace/roster'), []);
  const [email, setEmail] = useState('');
  const [role, setRole] = useState<'maintainer' | 'viewer'>('maintainer');
  const [inviting, setInviting] = useState(false);
  const [busyKey, setBusyKey] = useState<string | null>(null);
  const [memberToRemove, setMemberToRemove] = useState<WorkspaceMember | null>(null);

  const members = roster.data?.members ?? [];
  const invites = roster.data?.invites ?? [];
  const isOwner = !!user && !!roster.data && roster.data.workspace.ownerId === user.id;

  const sendInvite = async (): Promise<void> => {
    setInviting(true);
    try {
      await api.post<WorkspaceInvite>('/workspace/invites', { email: email.trim(), role });
      toast.success(`Invite sent to ${email.trim()}`);
      setEmail('');
      roster.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to send invite');
    } finally {
      setInviting(false);
    }
  };

  const changeRole = async (member: WorkspaceMember, next: WorkspaceRole): Promise<void> => {
    setBusyKey(member.userId);
    try {
      await api.patch(`/workspace/members/${member.userId}/role`, { role: next });
      toast.success(`${memberDisplayName(member)} is now ${next}`);
      roster.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to change role');
      roster.reload();
    } finally {
      setBusyKey(null);
    }
  };

  const removeMember = async (): Promise<void> => {
    if (!memberToRemove) return;
    setBusyKey(memberToRemove.userId);
    try {
      await api.del(`/workspace/members/${memberToRemove.userId}`);
      toast.info(`${memberDisplayName(memberToRemove)} removed from the workspace`);
      setMemberToRemove(null);
      roster.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove member');
    } finally {
      setBusyKey(null);
    }
  };

  const revokeInvite = async (invite: WorkspaceInvite): Promise<void> => {
    setBusyKey(invite.id);
    try {
      await api.del(`/workspace/invites/${invite.id}`);
      toast.info(`Invite to ${invite.email} revoked`);
      roster.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to revoke invite');
    } finally {
      setBusyKey(null);
    }
  };

  return (
    <section className="card card-pad-lg">
      <div className="card-header">
        <div className="card-title row gap-2">
          <IconUser size={15} />
          Workspace team
          {roster.data ? <span className="muted weight-500">({members.length} member{members.length === 1 ? '' : 's'})</span> : null}
        </div>
      </div>
      {roster.loading ? (
        <Skeleton height={220} />
      ) : roster.error ? (
        <ErrorState error={roster.error} onRetry={roster.reload} compact />
      ) : (
        <div className="stack gap-3">
          <div className="stack gap-0">
            {members.map((m) => (
              <div key={m.id} className="row gap-2" style={{ padding: '9px 0', borderBottom: '1px solid var(--border-soft)' }}>
                <span className="initials-chip" aria-hidden="true">
                  {initialsOf(m.userName ?? m.userEmail)}
                </span>
                <div className="stack" style={{ gap: 0, minWidth: 0 }}>
                  <span className="weight-600 text-sm truncate">{memberDisplayName(m)}</span>
                  <span className="faint text-sm truncate">{m.userEmail ?? '—'}</span>
                </div>
                <span className="spacer" />
                <Badge className={ROLE_CLASS[m.role]} dot>
                  {m.role}
                </Badge>
                {isOwner && m.role !== 'owner' ? (
                  <>
                    <Select
                      value={m.role}
                      disabled={busyKey === m.userId}
                      onChange={(e) => void changeRole(m, e.target.value as WorkspaceRole)}
                      style={{ width: 132 }}
                      aria-label={`Role for ${memberDisplayName(m)}`}
                    >
                      <option value="maintainer">Maintainer</option>
                      <option value="viewer">Viewer</option>
                    </Select>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => setMemberToRemove(m)}
                      aria-label={`Remove ${memberDisplayName(m)}`}
                      title="Remove member"
                    >
                      <IconTrash size={13} />
                    </button>
                  </>
                ) : null}
              </div>
            ))}
          </div>

          <div className="row gap-2 muted text-sm">
            <IconInfo size={13} />
            Viewers have read-only access to all projects in this workspace.
          </div>

          {isOwner ? (
            <div className="row gap-2 wrap" style={{ alignItems: 'flex-end', borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
              <Field label="Invite by email" hint="They receive an email with a join link.">
                <Input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="teammate@company.com"
                  style={{ width: 240 }}
                  maxLength={200}
                />
              </Field>
              <Field label="Role">
                <Select value={role} onChange={(e) => setRole(e.target.value as 'maintainer' | 'viewer')} style={{ width: 140 }}>
                  <option value="maintainer">Maintainer</option>
                  <option value="viewer">Viewer</option>
                </Select>
              </Field>
              <button className="btn btn-primary" onClick={() => void sendInvite()} disabled={inviting || !/^\S+@\S+\.\S+$/.test(email.trim())}>
                {inviting ? <span className="spinner" /> : <IconPlus size={13} />}
                Invite
              </button>
            </div>
          ) : null}

          {invites.length > 0 ? (
            <div className="stack gap-1">
              <div className="uppercase-label">Pending invites</div>
              {invites.map((inv) => (
                <div key={inv.id} className="row gap-2" style={{ padding: '7px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <span className="flex-1 truncate text-sm">{inv.email}</span>
                  <Badge className={ROLE_CLASS[inv.role]}>{inv.role}</Badge>
                  <span className="faint text-sm">invited {formatDate(inv.createdAt)}</span>
                  {isOwner ? (
                    <button className="btn btn-ghost btn-sm" onClick={() => void revokeInvite(inv)} disabled={busyKey === inv.id}>
                      Revoke
                    </button>
                  ) : null}
                </div>
              ))}
            </div>
          ) : null}
        </div>
      )}

      <ConfirmDialog
        open={memberToRemove !== null}
        title="Remove member"
        message={
          <>
            Remove <strong>{memberToRemove ? memberDisplayName(memberToRemove) : ''}</strong> from this workspace? They will
            lose access to all projects in it.
          </>
        }
        confirmLabel="Remove member"
        danger
        onConfirm={() => void removeMember()}
        onCancel={() => setMemberToRemove(null)}
      />
    </section>
  );
}

// ---------- outgoing webhooks ----------

const WEBHOOK_FORMATS: OutgoingWebhookFormat[] = ['generic', 'discord', 'slack'];
const WEBHOOK_EVENTS: string[] = [
  'execution.succeeded',
  'execution.needs_review',
  'github.pr_merged',
  'github.pr_opened',
  'sprint.completed',
  'workflow.completed',
  'mention',
  'workspace.*',
];

const WEBHOOK_FORMAT_CLASS: Record<OutgoingWebhookFormat, string> = {
  generic: 'badge-neutral',
  discord: 'badge-info',
  slack: 'badge-success',
};

function webhookEventsLabel(events: string[]): string {
  return events.includes('*') ? 'All events (*)' : events.join(', ');
}

function OutgoingWebhooksSection(): JSX.Element {
  const toast = useToast();
  const hooks = useApi<OutgoingWebhook[]>(() => api.get<OutgoingWebhook[]>('/webhooks/outgoing'), []);
  const [url, setUrl] = useState('');
  const [format, setFormat] = useState<OutgoingWebhookFormat>('generic');
  const [events, setEvents] = useState<string[]>(['*']);
  const [secret, setSecret] = useState('');
  const [creating, setCreating] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [toDelete, setToDelete] = useState<OutgoingWebhook | null>(null);

  const list = hooks.data ?? [];

  const toggleEvent = (ev: string): void => {
    setEvents((prev) => {
      if (ev === '*') return prev.includes('*') ? [] : ['*'];
      const rest = prev.filter((e) => e !== '*');
      return rest.includes(ev) ? rest.filter((e) => e !== ev) : [...rest, ev];
    });
  };

  const create = async (): Promise<void> => {
    setCreating(true);
    try {
      await api.post<OutgoingWebhook>('/webhooks/outgoing', {
        url: url.trim(),
        format,
        events: events.length > 0 ? events : ['*'],
        ...(secret.trim() ? { secret: secret.trim() } : {}),
      });
      toast.success('Webhook created');
      setUrl('');
      setEvents(['*']);
      setSecret('');
      hooks.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to create webhook');
    } finally {
      setCreating(false);
    }
  };

  const toggleActive = async (hook: OutgoingWebhook): Promise<void> => {
    setBusyId(hook.id);
    try {
      const updated = await api.patch<OutgoingWebhook>(`/webhooks/outgoing/${hook.id}`, { active: !hook.active });
      hooks.setData((prev) => (prev ? prev.map((w) => (w.id === hook.id ? updated : w)) : prev));
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update webhook');
      hooks.reload();
    } finally {
      setBusyId(null);
    }
  };

  const test = async (hook: OutgoingWebhook): Promise<void> => {
    setBusyId(hook.id);
    try {
      const res = await api.post<{ ok: boolean; status?: number; error?: string }>(`/webhooks/outgoing/${hook.id}/test`);
      if (res.ok) toast.success(`Test delivery succeeded${res.status ? ` (HTTP ${res.status})` : ''}`);
      else toast.error(`Test delivery failed${res.error ? `: ${res.error}` : ''}`);
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Test delivery failed');
    } finally {
      setBusyId(null);
    }
  };

  const remove = async (): Promise<void> => {
    if (!toDelete) return;
    setBusyId(toDelete.id);
    try {
      await api.del(`/webhooks/outgoing/${toDelete.id}`);
      toast.info('Webhook deleted');
      setToDelete(null);
      hooks.reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete webhook');
    } finally {
      setBusyId(null);
    }
  };

  return (
    <section className="card card-pad-lg">
      <div className="card-header">
        <div className="card-title row gap-2">
          <IconSend size={15} />
          Outgoing webhooks
          {hooks.data ? <span className="muted weight-500">({list.length})</span> : null}
        </div>
      </div>
      {hooks.loading ? (
        <Skeleton height={180} />
      ) : hooks.error ? (
        <ErrorState error={hooks.error} onRetry={hooks.reload} compact />
      ) : (
        <div className="stack gap-3">
          {list.length === 0 ? (
            <EmptyState
              compact
              title="No outgoing webhooks"
              description="Forward DevFlow events like execution.succeeded or github.pr_merged to Discord, Slack or any HTTP endpoint."
            />
          ) : (
            <div className="stack gap-0">
              {list.map((hook) => (
                <div key={hook.id} className="stack gap-1" style={{ padding: '10px 0', borderBottom: '1px solid var(--border-soft)' }}>
                  <div className="row gap-2 wrap">
                    <span className="mono text-sm truncate flex-1" style={{ minWidth: 160 }} title={hook.url}>
                      {hook.url}
                    </span>
                    <Badge className={WEBHOOK_FORMAT_CLASS[hook.format]}>{hook.format}</Badge>
                    <label className="row gap-2 text-sm" style={{ cursor: 'pointer' }}>
                      <input
                        type="checkbox"
                        className="checkbox"
                        checked={hook.active}
                        disabled={busyId === hook.id}
                        onChange={() => void toggleActive(hook)}
                        aria-label={`Toggle webhook ${hook.url}`}
                      />
                      Active
                    </label>
                    <button className="btn btn-sm" onClick={() => void test(hook)} disabled={busyId === hook.id}>
                      {busyId === hook.id ? <span className="spinner" /> : <IconZap size={12} />}
                      Test
                    </button>
                    <button
                      className="btn btn-ghost btn-sm btn-icon"
                      style={{ color: 'var(--danger)' }}
                      onClick={() => setToDelete(hook)}
                      aria-label={`Delete webhook ${hook.url}`}
                      title="Delete webhook"
                    >
                      <IconTrash size={12} />
                    </button>
                  </div>
                  <div className="faint text-sm">{webhookEventsLabel(hook.events)}</div>
                </div>
              ))}
            </div>
          )}

          <div className="stack gap-2" style={{ borderTop: '1px solid var(--border-soft)', paddingTop: 14 }}>
            <div className="uppercase-label">Add webhook</div>
            <div className="row gap-2 wrap">
              <div className="field" style={{ flex: '2 1 260px' }}>
                <Input
                  value={url}
                  onChange={(e) => setUrl(e.target.value)}
                  placeholder="https://hooks.example.com/devflow"
                  maxLength={500}
                />
              </div>
              <div className="field" style={{ flex: '0 0 120px' }}>
                <Select value={format} onChange={(e) => setFormat(e.target.value as OutgoingWebhookFormat)} aria-label="Payload format">
                  {WEBHOOK_FORMATS.map((f) => (
                    <option key={f} value={f}>
                      {titleCase(f)}
                    </option>
                  ))}
                </Select>
              </div>
              <div className="field" style={{ flex: '1 1 170px' }}>
                <Input
                  type="password"
                  value={secret}
                  onChange={(e) => setSecret(e.target.value)}
                  placeholder="Signing secret (optional)"
                  autoComplete="new-password"
                  maxLength={200}
                />
              </div>
              <button className="btn btn-primary" onClick={() => void create()} disabled={creating || !/^https?:\/\//.test(url.trim())}>
                {creating ? <span className="spinner" /> : <IconPlus size={13} />}
                Add webhook
              </button>
            </div>
            <div>
              <div className="uppercase-label" style={{ marginBottom: 6 }}>
                Events
              </div>
              <div className="row gap-3 wrap">
                {['*', ...WEBHOOK_EVENTS].map((ev) => (
                  <label key={ev} className="row gap-2 text-sm" style={{ cursor: 'pointer' }}>
                    <input type="checkbox" className="checkbox" checked={events.includes(ev)} onChange={() => toggleEvent(ev)} />
                    {ev === '*' ? 'All events (*)' : ev}
                  </label>
                ))}
              </div>
              {events.length === 0 ? <div className="field-hint">No events selected — the webhook will receive no deliveries.</div> : null}
            </div>
            <div className="row gap-2 muted text-sm">
              <IconInfo size={13} />
              The secret signs each delivery (HMAC) and is only sent on create — it cannot be viewed or changed later.
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={toDelete !== null}
        title="Delete webhook"
        message={
          <>
            Delete the webhook pointing to <strong className="mono">{toDelete?.url}</strong>? It will stop receiving events
            immediately.
          </>
        }
        confirmLabel="Delete webhook"
        danger
        onConfirm={() => void remove()}
        onCancel={() => setToDelete(null)}
      />
    </section>
  );
}

function AppearanceSection(): JSX.Element {
  const { theme, toggle } = useTheme();
  return (
    <section className="card card-pad-lg">
      <div className="card-header">
        <div className="card-title">Appearance</div>
      </div>
      <div className="row gap-3 justify-between wrap">
        <div className="stack gap-1" style={{ gap: 2 }}>
          <div className="weight-600">Theme</div>
          <div className="muted text-sm">Currently using the {theme} theme. Preference is saved in this browser.</div>
        </div>
        <button className="btn" onClick={toggle}>
          {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
          Switch to {theme === 'dark' ? 'light' : 'dark'}
        </button>
      </div>
    </section>
  );
}

export function SettingsPage(): JSX.Element {
  return (
    <div className="page" style={{ maxWidth: 860 }}>
      <div className="page-header">
        <div>
          <div className="page-title">Settings</div>
          <div className="page-sub">Profile, AI provider, team, integrations, webhooks and appearance</div>
        </div>
      </div>
      <div className="stack gap-4">
        <ProfileSection />
        <AIProviderSection />
        <WorkspaceTeamSection />
        <GitHubSection />
        <OutgoingWebhooksSection />
        <AppearanceSection />
      </div>
    </div>
  );
}

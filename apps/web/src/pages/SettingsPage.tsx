import { useState, type JSX } from 'react';
import type { AISettingsPublic, User } from '@devflow/shared';
import { api } from '../lib/api';
import { useApi, useAuth, useTheme, useToast } from '../lib/hooks';
import { Badge } from '../components/Badge';
import { ErrorState } from '../components/ErrorState';
import { Field, Input } from '../components/Field';
import { Skeleton } from '../components/Skeleton';
import { IconCheck, IconGitHub, IconLock, IconMoon, IconSun, IconUser, IconZap } from '../components/icons';

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
          <Field label="Base URL" hint="OpenAI-compatible endpoint, e.g. https://api.openai.com/v1">
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
          <div className="page-sub">Profile, AI provider, integrations and appearance</div>
        </div>
      </div>
      <div className="stack gap-4">
        <ProfileSection />
        <AIProviderSection />
        <GitHubSection />
        <AppearanceSection />
      </div>
    </div>
  );
}

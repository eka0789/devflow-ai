/** Sidebar project switcher: pick a project, create a new one, or go to all projects. */
import { useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@devflow/shared';
import { api } from '../lib/api';
import { useApi, useClickOutside, useToast, type ProjectCtx } from '../lib/hooks';
import { Badge } from './Badge';
import { Field, Input, Textarea } from './Field';
import { Modal } from './Modal';
import { Skeleton } from './Skeleton';
import { IconChevronDown, IconFolder, IconPlus } from './icons';

function colorFor(name: string): string {
  const palette = ['#6e7bff', '#9b6eff', '#4cc2ff', '#3fb68b', '#e0a458', '#e5484d', '#f171a1'];
  let hash = 0;
  for (let i = 0; i < name.length; i++) hash = (hash * 31 + name.charCodeAt(i)) >>> 0;
  return palette[hash % palette.length]!;
}

function ProjectAvatar({ name, size = 24 }: { name: string; size?: number }): JSX.Element {
  return (
    <span
      className="ps-avatar"
      style={{ width: size, height: size, background: colorFor(name), fontSize: size <= 24 ? 10 : 12 }}
      aria-hidden="true"
    >
      {name.slice(0, 1).toUpperCase()}
    </span>
  );
}

export function ProjectSwitcher({ current }: { current: ProjectCtx | null }): JSX.Element {
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [query, setQuery] = useState('');
  const navigate = useNavigate();
  const toast = useToast();
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);

  const { data: projects, loading, error, reload } = useApi<Project[]>(() => api.get<Project[]>('/projects'), []);

  const filtered = (projects ?? []).filter((p) => p.name.toLowerCase().includes(query.toLowerCase()));

  return (
    <div className="project-switcher" ref={ref}>
      <button className="ps-trigger" onClick={() => setOpen((o) => !o)} aria-expanded={open} aria-haspopup="listbox">
        {current?.project ? (
          <>
            <ProjectAvatar name={current.project.name} />
            <span className="stack gap-0" style={{ gap: 0, minWidth: 0 }}>
              <span className="ps-name">{current.project.name}</span>
              <span className="ps-sub">{current.project.status}</span>
            </span>
          </>
        ) : (
          <>
            <span className="ps-avatar" style={{ background: 'var(--panel-2)', color: 'var(--text-muted)', border: '1px solid var(--border)' }}>
              <IconFolder size={12} />
            </span>
            <span className="ps-name">Projects</span>
          </>
        )}
        <span className="ps-chevron">
          <IconChevronDown size={13} />
        </span>
      </button>

      {open ? (
        <div className="dropdown-menu menu-left" style={{ left: 8, right: 8, top: '100%' }}>
          <input
            className="input"
            placeholder="Search projects…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            autoFocus
            style={{ marginBottom: 6 }}
          />
          <div className="ps-list" role="listbox">
            {loading ? (
              <div className="stack gap-2" style={{ padding: '6px 4px' }}>
                <Skeleton height={26} />
                <Skeleton height={26} />
              </div>
            ) : error ? (
              <div className="muted" style={{ padding: '8px 10px', fontSize: 12.5 }}>
                Failed to load projects.{' '}
                <span className="inline-link" onClick={() => reload()}>
                  Retry
                </span>
              </div>
            ) : filtered.length === 0 ? (
              <div className="muted" style={{ padding: '8px 10px', fontSize: 12.5 }}>
                {projects && projects.length > 0 ? 'No matches' : 'No projects yet'}
              </div>
            ) : (
              filtered.map((p) => (
                <button
                  key={p.id}
                  className="menu-item"
                  onClick={() => {
                    setOpen(false);
                    setQuery('');
                    navigate(`/projects/${p.id}`);
                  }}
                >
                  <ProjectAvatar name={p.name} />
                  <span className="truncate">{p.name}</span>
                  <span style={{ marginLeft: 'auto' }}>
                    <Badge className={`proj-${p.status}`} dot>
                      {p.status}
                    </Badge>
                  </span>
                </button>
              ))
            )}
          </div>
          <div className="menu-sep" />
          <button
            className="menu-item"
            onClick={() => {
              setOpen(false);
              navigate('/');
            }}
          >
            <IconFolder size={14} />
            All projects
          </button>
          <button
            className="menu-item"
            style={{ color: 'var(--accent-strong)' }}
            onClick={() => {
              setOpen(false);
              setCreating(true);
            }}
          >
            <IconPlus size={14} />
            New project
          </button>
        </div>
      ) : null}

      <CreateProjectModal
        open={creating}
        onClose={() => setCreating(false)}
        onCreated={(project) => {
          setCreating(false);
          toast.success(`Project "${project.name}" created`);
          navigate(`/projects/${project.id}`);
        }}
      />
    </div>
  );
}

export function CreateProjectModal({
  open,
  onClose,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  onCreated: (project: Project) => void;
}): JSX.Element {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [techStack, setTechStack] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      const project = await api.post<Project>('/projects', {
        name: name.trim(),
        description: description.trim(),
        techStack: techStack
          .split(',')
          .map((t) => t.trim())
          .filter(Boolean)
          .slice(0, 20),
      });
      setName('');
      setDescription('');
      setTechStack('');
      onCreated(project);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New project"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || name.trim().length < 2}>
            {busy ? <span className="spinner" /> : <IconPlus size={14} />}
            Create project
          </button>
        </>
      }
    >
      <form
        className="stack gap-3"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        {error ? <div className="form-error">{error}</div> : null}
        <Field label="Name" required>
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="My SaaS app" autoFocus maxLength={120} />
        </Field>
        <Field label="Description" hint="What are you building?">
          <Textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="A short pitch for the project…"
            maxLength={4000}
          />
        </Field>
        <Field label="Tech stack" hint="Comma-separated, e.g. React, Node.js, PostgreSQL">
          <Input value={techStack} onChange={(e) => setTechStack(e.target.value)} placeholder="React, Node.js, PostgreSQL" />
        </Field>
        <button type="submit" style={{ display: 'none' }} aria-hidden="true" tabIndex={-1} />
      </form>
    </Modal>
  );
}

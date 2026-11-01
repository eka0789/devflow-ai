import { useMemo, useState, type JSX } from 'react';
import type { BacklogStatus, Epic, Priority, Story, Subtask, Task } from '@devflow/shared';
import { VALID_TRANSITIONS } from '@devflow/shared';
import { api } from '../lib/api';
import { titleCase, useApi, useProjectRequired, useToast } from '../lib/hooks';
import { normalizeBacklogTree, type BacklogTree } from '../lib/types';
import { PriorityBadge } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState } from '../components/ErrorState';
import { EmptyState } from '../components/EmptyState';
import { Field, Input, Select, Textarea } from '../components/Field';
import { Modal } from '../components/Modal';
import { Skeleton } from '../components/Skeleton';
import {
  IconChevronRight,
  IconEdit,
  IconPlus,
  IconSearch,
  IconTrash,
  IconX,
} from '../components/icons';

const POINTS = [0, 1, 2, 3, 5, 8, 13];
const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];
const STATUSES: BacklogStatus[] = ['backlog', 'todo', 'in_progress', 'in_review', 'blocked', 'done', 'cancelled'];

// ---------- status dropdown ----------

function StatusSelect({
  value,
  onChange,
  disabled,
}: {
  value: BacklogStatus;
  onChange: (next: BacklogStatus) => void;
  disabled?: boolean;
}): JSX.Element {
  const options = Array.from(new Set<BacklogStatus>([value, ...(VALID_TRANSITIONS[value] ?? [])]));
  return (
    <select
      className="status-select"
      value={value}
      disabled={disabled}
      onChange={(e) => onChange(e.target.value as BacklogStatus)}
      aria-label="Change status"
    >
      {options.map((s) => (
        <option key={s} value={s}>
          {titleCase(s)}
        </option>
      ))}
    </select>
  );
}

// ---------- epics ----------

function EpicModal({
  open,
  onClose,
  projectId,
  onCreated,
}: {
  open: boolean;
  onClose: () => void;
  projectId: string;
  onCreated: () => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [color, setColor] = useState('#6E7BFF');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/epics`, { title: title.trim(), description: description.trim(), color });
      setTitle('');
      setDescription('');
      onCreated();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create epic');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New epic"
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || title.trim().length < 2}>
            Create epic
          </button>
        </>
      }
    >
      <div className="stack gap-3">
        {error ? <div className="form-error">{error}</div> : null}
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={160} placeholder="e.g. Authentication" />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={4000} />
        </Field>
        <Field label="Color">
          <input
            type="color"
            value={color}
            onChange={(e) => setColor(e.target.value)}
            style={{ width: 44, height: 30, border: '1px solid var(--border)', borderRadius: 6, background: 'transparent', cursor: 'pointer' }}
          />
        </Field>
      </div>
    </Modal>
  );
}

// ---------- stories ----------

function StoryModal({
  open,
  story,
  initialEpicId,
  epics,
  projectId,
  onClose,
  onSaved,
}: {
  open: boolean;
  story: Story | null;
  initialEpicId: string | null;
  epics: Epic[];
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [title, setTitle] = useState('');
  const [epicId, setEpicId] = useState<string>('');
  const [description, setDescription] = useState('');
  const [points, setPoints] = useState(3);
  const [priority, setPriority] = useState<Priority>('medium');
  const [criteria, setCriteria] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loadedFor, setLoadedFor] = useState<string | null>(null);

  // Re-seed the form whenever the target story changes.
  const seedKey = open ? (story?.id ?? 'new') : null;
  if (seedKey && seedKey !== loadedFor) {
    setLoadedFor(seedKey);
    setTitle(story?.title ?? '');
    setEpicId(story?.epicId ?? initialEpicId ?? '');
    setDescription(story?.description ?? '');
    setPoints(story?.points ?? 3);
    setPriority(story?.priority ?? 'medium');
    setCriteria(story?.acceptanceCriteria ?? []);
    setError(null);
  }

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    const body = {
      epicId: epicId || null,
      title: title.trim(),
      description: description.trim(),
      points,
      priority,
      acceptanceCriteria: criteria.map((c) => c.trim()).filter(Boolean),
    };
    try {
      if (story) {
        await api.patch(`/projects/${projectId}/stories/${story.id}`, body);
      } else {
        await api.post(`/projects/${projectId}/stories`, body);
      }
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save story');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title={story ? 'Edit story' : 'New story'}
      size="lg"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button className="btn btn-primary" onClick={() => void submit()} disabled={busy || title.trim().length < 2}>
            {busy ? <span className="spinner" /> : null}
            {story ? 'Save story' : 'Create story'}
          </button>
        </>
      }
    >
      <div className="stack gap-3">
        {error ? <div className="form-error">{error}</div> : null}
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} maxLength={200} placeholder="As a user, I want to…" />
        </Field>
        <div className="grid grid-2">
          <Field label="Epic">
            <Select value={epicId} onChange={(e) => setEpicId(e.target.value)}>
              <option value="">No epic</option>
              {epics.map((ep) => (
                <option key={ep.id} value={ep.id}>
                  {ep.title}
                </option>
              ))}
            </Select>
          </Field>
          <div className="grid grid-2" style={{ gap: 12 }}>
            <Field label="Points">
              <Select value={String(points)} onChange={(e) => setPoints(Number(e.target.value))}>
                {POINTS.map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Priority">
              <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
                {PRIORITIES.map((p) => (
                  <option key={p} value={p}>
                    {titleCase(p)}
                  </option>
                ))}
              </Select>
            </Field>
          </div>
        </div>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} maxLength={8000} />
        </Field>
        <Field label="Acceptance criteria" hint="One criterion per row">
          <div className="stack gap-2">
            {criteria.map((c, i) => (
              <div key={i} className="row gap-2">
                <Input
                  value={c}
                  onChange={(e) => setCriteria(criteria.map((x, xi) => (xi === i ? e.target.value : x)))}
                  placeholder={`Criterion ${i + 1}`}
                  maxLength={500}
                />
                <button
                  type="button"
                  className="btn btn-ghost btn-icon"
                  onClick={() => setCriteria(criteria.filter((_, xi) => xi !== i))}
                  aria-label="Remove criterion"
                >
                  <IconTrash size={13} />
                </button>
              </div>
            ))}
            <button type="button" className="btn btn-sm" onClick={() => setCriteria([...criteria, ''])} disabled={criteria.length >= 20}>
              <IconPlus size={13} />
              Add criterion
            </button>
          </div>
        </Field>
      </div>
    </Modal>
  );
}

// ---------- tasks ----------

function TaskModal({
  open,
  stories,
  fixedStoryId,
  projectId,
  onClose,
  onSaved,
}: {
  open: boolean;
  stories: Story[];
  fixedStoryId: string | null;
  projectId: string;
  onClose: () => void;
  onSaved: () => void;
}): JSX.Element {
  const [storyId, setStoryId] = useState('');
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [priority, setPriority] = useState<Priority>('medium');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [wasOpen, setWasOpen] = useState(false);

  if (open && !wasOpen) {
    setWasOpen(true);
    setStoryId(fixedStoryId ?? '');
    setTitle('');
    setDescription('');
    setPriority('medium');
    setError(null);
  } else if (!open && wasOpen) {
    setWasOpen(false);
  }

  const submit = async (): Promise<void> => {
    setBusy(true);
    setError(null);
    try {
      await api.post(`/projects/${projectId}/tasks`, {
        storyId,
        title: title.trim(),
        description: description.trim(),
        priority,
      });
      onSaved();
      onClose();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to create task');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Modal
      open={open}
      onClose={onClose}
      title="New task"
      size="sm"
      footer={
        <>
          <button className="btn" onClick={onClose} disabled={busy}>
            Cancel
          </button>
          <button
            className="btn btn-primary"
            onClick={() => void submit()}
            disabled={busy || title.trim().length < 2 || !storyId}
          >
            Create task
          </button>
        </>
      }
    >
      <div className="stack gap-3">
        {error ? <div className="form-error">{error}</div> : null}
        <Field label="Story" required>
          <Select value={storyId} onChange={(e) => setStoryId(e.target.value)} disabled={fixedStoryId !== null}>
            <option value="">Select a story…</option>
            {stories.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
        </Field>
        <Field label="Title" required>
          <Input value={title} onChange={(e) => setTitle(e.target.value)} autoFocus maxLength={200} />
        </Field>
        <Field label="Description">
          <Textarea value={description} onChange={(e) => setDescription(e.target.value)} maxLength={8000} />
        </Field>
        <Field label="Priority">
          <Select value={priority} onChange={(e) => setPriority(e.target.value as Priority)}>
            {PRIORITIES.map((p) => (
              <option key={p} value={p}>
                {titleCase(p)}
              </option>
            ))}
          </Select>
        </Field>
      </div>
    </Modal>
  );
}

// ---------- dependency editor ----------

function StoryDependencies({
  story,
  allStories,
  tree,
  projectId,
  onChanged,
}: {
  story: Story;
  allStories: Story[];
  tree: BacklogTree;
  projectId: string;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const [adding, setAdding] = useState('');
  const deps = tree.dependencies.stories.filter(([sid]) => sid === story.id).map(([, depId]) => depId);
  const nameOf = (id: string): string => allStories.find((s) => s.id === id)?.title ?? 'Unknown story';
  const candidates = allStories.filter((s) => s.id !== story.id && !deps.includes(s.id));

  const add = async (): Promise<void> => {
    if (!adding) return;
    try {
      await api.post(`/projects/${projectId}/stories/${story.id}/dependencies`, { dependsOnId: adding });
      setAdding('');
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add dependency');
    }
  };

  const remove = async (depId: string): Promise<void> => {
    try {
      await api.del(`/projects/${projectId}/stories/${story.id}/dependencies/${depId}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to remove dependency');
    }
  };

  return (
    <div className="stack gap-2">
      <div className="uppercase-label">Blocked by</div>
      {deps.length === 0 ? <div className="faint text-sm">No dependencies — this story can start anytime.</div> : null}
      <div className="row gap-2 wrap">
        {deps.map((depId) => {
          const dep = allStories.find((s) => s.id === depId);
          return (
            <span key={depId} className="dep-tag">
              <span className="truncate" style={{ maxWidth: 220 }}>
                {nameOf(depId)}
              </span>
              {dep && dep.status !== 'done' ? (
                <span className="faint" title="Not done yet">
                  ·
                </span>
              ) : null}
              <button onClick={() => void remove(depId)} aria-label="Remove dependency">
                <IconX size={10} />
              </button>
            </span>
          );
        })}
      </div>
      {candidates.length > 0 ? (
        <div className="row gap-2">
          <Select value={adding} onChange={(e) => setAdding(e.target.value)} style={{ maxWidth: 280 }}>
            <option value="">Add a blocking story…</option>
            {candidates.map((s) => (
              <option key={s.id} value={s.id}>
                {s.title}
              </option>
            ))}
          </Select>
          <button className="btn btn-sm" onClick={() => void add()} disabled={!adding}>
            Add
          </button>
        </div>
      ) : null}
    </div>
  );
}

// ---------- tasks & subtasks under a story ----------

function TaskBlock({
  task,
  subtasks,
  tree,
  projectId,
  onChanged,
  onTransition,
}: {
  task: Task;
  subtasks: Subtask[];
  tree: BacklogTree;
  projectId: string;
  onChanged: () => void;
  onTransition: (task: Task, next: BacklogStatus) => void;
}): JSX.Element {
  const toast = useToast();
  const [newSub, setNewSub] = useState('');
  const [addingSub, setAddingSub] = useState(false);

  const toggleSub = async (sub: Subtask): Promise<void> => {
    try {
      await api.patch(`/projects/${projectId}/tasks/${task.id}/subtasks/${sub.id}`, { done: !sub.done });
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update subtask');
    }
  };

  const addSub = async (): Promise<void> => {
    const t = newSub.trim();
    if (t.length < 2) return;
    try {
      await api.post(`/projects/${projectId}/tasks/${task.id}/subtasks`, { title: t });
      setNewSub('');
      setAddingSub(false);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add subtask');
    }
  };

  const deleteSub = async (subId: string): Promise<void> => {
    try {
      await api.del(`/projects/${projectId}/tasks/${task.id}/subtasks/${subId}`);
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete subtask');
    }
  };

  const doneCount = subtasks.filter((s) => s.done).length;

  return (
    <div className="stack gap-1" style={{ gap: 6 }}>
      <div className="task-row">
        <IconChevronRight size={13} style={{ color: 'var(--text-faint)', flexShrink: 0 }} />
        <span className="flex-1 truncate">{task.title}</span>
        <PriorityBadge priority={task.priority} />
        <StatusSelect value={task.status} onChange={(next) => onTransition(task, next)} />
        <button
          className="btn btn-ghost btn-sm btn-icon"
          onClick={async () => {
            try {
              await api.del(`/projects/${projectId}/tasks/${task.id}`);
              onChanged();
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Failed to delete task');
            }
          }}
          aria-label={`Delete task ${task.title}`}
          title="Delete task"
        >
          <IconTrash size={12} />
        </button>
      </div>
      {subtasks.length > 0 || addingSub ? (
        <div style={{ paddingLeft: 22 }}>
          {subtasks.map((sub) => (
            <div key={sub.id} className={`subtask-row ${sub.done ? 'done' : ''}`}>
              <input
                type="checkbox"
                className="checkbox"
                checked={sub.done}
                onChange={() => void toggleSub(sub)}
                aria-label={sub.title}
              />
              <span className="subtask-title flex-1">{sub.title}</span>
              <button className="chip-remove" onClick={() => void deleteSub(sub.id)} aria-label="Delete subtask">
                <IconX size={9} />
              </button>
            </div>
          ))}
          {subtasks.length > 0 ? (
            <div className="faint text-sm" style={{ marginTop: 2 }}>
              {doneCount}/{subtasks.length} subtasks done
            </div>
          ) : null}
        </div>
      ) : null}
      {addingSub ? (
        <div className="row gap-2" style={{ paddingLeft: 22 }}>
          <Input
            value={newSub}
            onChange={(e) => setNewSub(e.target.value)}
            placeholder="Subtask title"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === 'Enter') void addSub();
              if (e.key === 'Escape') setAddingSub(false);
            }}
            maxLength={200}
          />
          <button className="btn btn-sm btn-primary" onClick={() => void addSub()} disabled={newSub.trim().length < 2}>
            Add
          </button>
          <button className="btn btn-sm btn-ghost" onClick={() => setAddingSub(false)}>
            Cancel
          </button>
        </div>
      ) : (
        <button className="btn btn-ghost btn-sm" style={{ alignSelf: 'flex-start', marginLeft: 22 }} onClick={() => setAddingSub(true)}>
          <IconPlus size={12} />
          Add subtask
        </button>
      )}
      {tree.dependencies.tasks.some(([tid]) => tid === task.id) ? (
        <div className="faint text-sm" style={{ paddingLeft: 22 }}>
          Depends on {tree.dependencies.tasks.filter(([tid]) => tid === task.id).length} task(s)
        </div>
      ) : null}
    </div>
  );
}

// ---------- main page ----------

export function ProjectBacklog(): JSX.Element {
  const ctx = useProjectRequired();
  const projectId = ctx.projectId;
  const toast = useToast();

  const { data: tree, loading, error, reload } = useApi<BacklogTree>(
    () => api.get<unknown>(`/projects/${projectId}/backlog`).then(normalizeBacklogTree),
    [projectId],
  );

  const [epicModal, setEpicModal] = useState(false);
  const [storyModal, setStoryModal] = useState<{ open: boolean; story: Story | null; epicId: string | null }>({
    open: false,
    story: null,
    epicId: null,
  });
  const [taskModal, setTaskModal] = useState<{ open: boolean; storyId: string | null }>({ open: false, storyId: null });
  const [epicToDelete, setEpicToDelete] = useState<Epic | null>(null);
  const [storyToDelete, setStoryToDelete] = useState<Story | null>(null);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [filters, setFilters] = useState({ epic: 'all', status: 'all', priority: 'all', query: '' });

  const toggleExpanded = (id: string): void => {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const transition = async (kind: 'stories' | 'tasks', id: string, next: BacklogStatus): Promise<void> => {
    try {
      await api.post(`/projects/${projectId}/${kind}/${id}/transition`, { status: next });
      toast.success(`Moved to ${titleCase(next)}`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Transition failed');
      reload();
    }
  };

  const filtered = useMemo(() => {
    if (!tree) return tree;
    const q = filters.query.trim().toLowerCase();
    const stories = tree.stories.filter((s) => {
      if (filters.epic !== 'all' && filters.epic !== 'none' && s.epicId !== filters.epic) return false;
      if (filters.epic === 'none' && s.epicId !== null) return false;
      if (filters.status !== 'all' && s.status !== filters.status) return false;
      if (filters.priority !== 'all' && s.priority !== filters.priority) return false;
      if (q && !s.title.toLowerCase().includes(q)) return false;
      return true;
    });
    const epics = tree.epics.filter((e) => (filters.epic === 'all' || filters.epic === 'none' ? true : e.id === filters.epic));
    return { ...tree, stories, epics };
  }, [tree, filters]);

  const groups = useMemo(() => {
    if (!filtered) return [];
    const byEpic = new Map<string, Story[]>();
    for (const s of filtered.stories) {
      const key = s.epicId ?? 'none';
      const list = byEpic.get(key) ?? [];
      list.push(s);
      byEpic.set(key, list);
    }
    const groups: Array<{ epic: Epic | null; stories: Story[] }> = [];
    if (filters.epic !== 'none') {
      for (const epic of filtered.epics) {
        const list = byEpic.get(epic.id) ?? [];
        byEpic.delete(epic.id);
        if (list.length > 0 || filtered.epics.length === 1) groups.push({ epic, stories: list });
      }
    }
    if (filters.epic === 'all' || filters.epic === 'none') {
      const orphaned = byEpic.get('none') ?? [];
      byEpic.delete('none');
      const leftovers = filters.epic === 'all' ? Array.from(byEpic.values()).flat() : [];
      const rest = [...orphaned, ...leftovers];
      if (rest.length > 0) groups.push({ epic: null, stories: rest });
    }
    return groups;
  }, [filtered, filters.epic]);

  if (loading && !tree)
    return (
      <div className="page">
        <Skeleton height={40} style={{ marginBottom: 16 }} />
        {Array.from({ length: 3 }, (_, i) => (
          <Skeleton key={i} height={120} style={{ borderRadius: 10, marginBottom: 12 }} />
        ))}
      </div>
    );

  if (error)
    return (
      <div className="page">
        <ErrorState error={error} onRetry={reload} title="Failed to load backlog" />
      </div>
    );

  const epics = tree?.epics ?? [];
  const allStories = tree?.stories ?? [];
  const subtasksByTask = new Map<string, Subtask[]>();
  for (const sub of tree?.subtasks ?? []) {
    const list = subtasksByTask.get(sub.taskId) ?? [];
    list.push(sub);
    subtasksByTask.set(sub.taskId, list);
  }

  return (
    <div className="page">
      <div className="page-header">
        <div>
          <div className="page-title">Backlog</div>
          <div className="page-sub">
            {allStories.length} stories · {tree?.tasks.length ?? 0} tasks
          </div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => setEpicModal(true)}>
            <IconPlus size={14} />
            New epic
          </button>
          <button className="btn btn-primary" onClick={() => setStoryModal({ open: true, story: null, epicId: null })}>
            <IconPlus size={14} />
            New story
          </button>
        </div>
      </div>

      <div className="card row gap-2 wrap" style={{ padding: '10px 12px', marginBottom: 16 }}>
        <div className="row gap-2" style={{ minWidth: 200, flex: '1 1 200px' }}>
          <span className="faint">
            <IconSearch size={14} />
          </span>
          <input
            className="input"
            placeholder="Search stories…"
            value={filters.query}
            onChange={(e) => setFilters((f) => ({ ...f, query: e.target.value }))}
            style={{ border: 'none', background: 'transparent', padding: '2px 0', height: 26 }}
            aria-label="Search stories"
          />
        </div>
        <Select
          value={filters.epic}
          onChange={(e) => setFilters((f) => ({ ...f, epic: e.target.value }))}
          style={{ width: 160 }}
          aria-label="Filter by epic"
        >
          <option value="all">All epics</option>
          {epics.map((e) => (
            <option key={e.id} value={e.id}>
              {e.title}
            </option>
          ))}
          <option value="none">No epic</option>
        </Select>
        <Select
          value={filters.status}
          onChange={(e) => setFilters((f) => ({ ...f, status: e.target.value }))}
          style={{ width: 140 }}
          aria-label="Filter by status"
        >
          <option value="all">All statuses</option>
          {STATUSES.map((s) => (
            <option key={s} value={s}>
              {titleCase(s)}
            </option>
          ))}
        </Select>
        <Select
          value={filters.priority}
          onChange={(e) => setFilters((f) => ({ ...f, priority: e.target.value }))}
          style={{ width: 140 }}
          aria-label="Filter by priority"
        >
          <option value="all">All priorities</option>
          {PRIORITIES.map((p) => (
            <option key={p} value={p}>
              {titleCase(p)}
            </option>
          ))}
        </Select>
      </div>

      {!tree || tree.stories.length === 0 ? (
        <EmptyState
          title="The backlog is empty"
          description="Create your first epic and story manually, or launch the AI planning workflow to draft a full backlog from a product vision."
          action={
            <div className="row gap-2">
              <button className="btn btn-primary" onClick={() => setStoryModal({ open: true, story: null, epicId: null })}>
                <IconPlus size={14} />
                New story
              </button>
            </div>
          }
        />
      ) : groups.length === 0 ? (
        <EmptyState compact title="No stories match the current filters" description="Try clearing the search or filters." />
      ) : (
        groups.map(({ epic, stories }) => {
          const doneCount = stories.filter((s) => s.status === 'done').length;
          return (
            <div key={epic?.id ?? 'none'} className="epic-block">
              <div className="epic-header">
                <span className="epic-dot" style={{ background: epic?.color ?? 'var(--text-faint)' }} />
                <span className="epic-title flex-1 truncate">{epic ? epic.title : 'No epic'}</span>
                <span className="faint text-sm tabular">
                  {doneCount}/{stories.length} done
                </span>
                <button
                  className="btn btn-ghost btn-sm"
                  onClick={() => setStoryModal({ open: true, story: null, epicId: epic?.id ?? null })}
                  title={`Add story to ${epic ? epic.title : 'no epic'}`}
                >
                  <IconPlus size={12} />
                  Story
                </button>
                {epic ? (
                  <button className="btn btn-ghost btn-sm btn-icon" onClick={() => setEpicToDelete(epic)} aria-label={`Delete epic ${epic.title}`}>
                    <IconTrash size={12} />
                  </button>
                ) : null}
              </div>
              {stories.length === 0 ? (
                <div className="muted text-sm" style={{ padding: '12px 14px' }}>
                  No stories match the filters in this epic.
                </div>
              ) : (
                <div className="story-list">
                  {stories.map((story) => {
                    const storyTasks = (tree?.tasks ?? []).filter((t) => t.storyId === story.id);
                    const isOpen = expanded.has(story.id);
                    return (
                      <div key={story.id} className="story-row">
                        <div className="story-main">
                          <button
                            className={`story-expand ${isOpen ? 'open' : ''}`}
                            onClick={() => toggleExpanded(story.id)}
                            aria-expanded={isOpen}
                            aria-label={isOpen ? 'Collapse story' : 'Expand story'}
                          >
                            <IconChevronRight size={13} />
                          </button>
                          <span
                            className="story-title flex-1"
                            onClick={() => toggleExpanded(story.id)}
                            role="button"
                            tabIndex={0}
                            onKeyDown={(e) => {
                              if (e.key === 'Enter') toggleExpanded(story.id);
                            }}
                          >
                            {story.title}
                          </span>
                          {storyTasks.length > 0 ? (
                            <span className="faint text-sm">
                              {storyTasks.filter((t) => t.status === 'done').length}/{storyTasks.length} tasks
                            </span>
                          ) : null}
                          <span className="points-pill" title="Story points">
                            {story.points}
                          </span>
                          <PriorityBadge priority={story.priority} />
                          <StatusSelect value={story.status} onChange={(next) => void transition('stories', story.id, next)} />
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            onClick={() => setStoryModal({ open: true, story, epicId: null })}
                            aria-label={`Edit story ${story.title}`}
                          >
                            <IconEdit size={12} />
                          </button>
                          <button
                            className="btn btn-ghost btn-sm btn-icon"
                            onClick={() => setStoryToDelete(story)}
                            aria-label={`Delete story ${story.title}`}
                          >
                            <IconTrash size={12} />
                          </button>
                        </div>
                        {isOpen ? (
                          <div className="story-detail">
                            {story.description ? (
                              <div className="muted" style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.55 }}>
                                {story.description}
                              </div>
                            ) : null}
                            {story.acceptanceCriteria.length > 0 ? (
                              <div className="stack gap-1">
                                <div className="uppercase-label">Acceptance criteria</div>
                                <ul className="ac-list">
                                  {story.acceptanceCriteria.map((ac, i) => (
                                    <li key={i} className="ac-item">
                                      <span className="ac-check">✓</span>
                                      <span>{ac}</span>
                                    </li>
                                  ))}
                                </ul>
                              </div>
                            ) : null}
                            <StoryDependencies
                              story={story}
                              allStories={allStories}
                              tree={tree!}
                              projectId={projectId}
                              onChanged={reload}
                            />
                            <div className="stack gap-2">
                              <div className="row justify-between">
                                <div className="uppercase-label">Tasks</div>
                                <button
                                  className="btn btn-ghost btn-sm"
                                  onClick={() => setTaskModal({ open: true, storyId: story.id })}
                                >
                                  <IconPlus size={12} />
                                  Add task
                                </button>
                              </div>
                              {storyTasks.length === 0 ? (
                                <div className="faint text-sm">No tasks yet — break the story down before pulling it into a sprint.</div>
                              ) : (
                                <div className="stack gap-2">
                                  {storyTasks.map((task) => (
                                    <TaskBlock
                                      key={task.id}
                                      task={task}
                                      subtasks={subtasksByTask.get(task.id) ?? []}
                                      tree={tree!}
                                      projectId={projectId}
                                      onChanged={reload}
                                      onTransition={(t, next) => void transition('tasks', t.id, next)}
                                    />
                                  ))}
                                </div>
                              )}
                            </div>
                          </div>
                        ) : null}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          );
        })
      )}

      <EpicModal open={epicModal} onClose={() => setEpicModal(false)} projectId={projectId} onCreated={reload} />

      <StoryModal
        open={storyModal.open}
        story={storyModal.story}
        initialEpicId={storyModal.epicId}
        epics={epics}
        projectId={projectId}
        onClose={() => setStoryModal({ open: false, story: null, epicId: null })}
        onSaved={reload}
      />

      <TaskModal
        open={taskModal.open}
        stories={allStories}
        fixedStoryId={taskModal.storyId}
        projectId={projectId}
        onClose={() => setTaskModal({ open: false, storyId: null })}
        onSaved={reload}
      />

      <ConfirmDialog
        open={epicToDelete !== null}
        title="Delete epic"
        message={
          <>
            Delete epic <strong>{epicToDelete?.title}</strong>? Stories in it are kept but become unassigned.
          </>
        }
        confirmLabel="Delete epic"
        danger
        onConfirm={async () => {
          if (!epicToDelete) return;
          try {
            await api.del(`/projects/${projectId}/epics/${epicToDelete.id}`);
            setEpicToDelete(null);
            reload();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete epic');
          }
        }}
        onCancel={() => setEpicToDelete(null)}
      />

      <ConfirmDialog
        open={storyToDelete !== null}
        title="Delete story"
        message={
          <>
            Delete story <strong>{storyToDelete?.title}</strong> with all of its tasks and subtasks? This cannot be
            undone.
          </>
        }
        confirmLabel="Delete story"
        danger
        onConfirm={async () => {
          if (!storyToDelete) return;
          try {
            await api.del(`/projects/${projectId}/stories/${storyToDelete.id}`);
            setStoryToDelete(null);
            reload();
          } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to delete story');
          }
        }}
        onCancel={() => setStoryToDelete(null)}
      />
    </div>
  );
}

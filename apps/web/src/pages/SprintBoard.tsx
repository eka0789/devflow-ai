import { useState, type JSX } from 'react';
import type { BacklogStatus, Priority, Sprint, Subtask, Task } from '@devflow/shared';
import { VALID_TRANSITIONS } from '@devflow/shared';
import { api } from '../lib/api';
import { titleCase, useApi, useProjectRequired, useToast } from '../lib/hooks';
import { normalizeTaskDetail, type BoardPayload, type BoardTask, type TaskDetailPayload } from '../lib/types';
import { PriorityBadge, StatusBadge } from '../components/Badge';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { Drawer } from '../components/Drawer';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Field, Input, Select, Textarea } from '../components/Field';
import { Skeleton } from '../components/Skeleton';
import { IconPlus, IconX, IconZap } from '../components/icons';

const COLUMNS: Array<{ status: BacklogStatus; dot: string }> = [
  { status: 'backlog', dot: 'var(--text-faint)' },
  { status: 'todo', dot: 'var(--info)' },
  { status: 'in_progress', dot: 'var(--accent)' },
  { status: 'in_review', dot: 'var(--warning)' },
  { status: 'blocked', dot: 'var(--danger)' },
  { status: 'done', dot: 'var(--success)' },
];

const PRIORITIES: Priority[] = ['low', 'medium', 'high', 'critical'];

// ---------- task drawer ----------

function TaskDrawer({
  taskId,
  projectId,
  boardTasks,
  onClose,
  onChanged,
}: {
  taskId: string | null;
  projectId: string;
  boardTasks: BoardTask[];
  onClose: () => void;
  onChanged: () => void;
}): JSX.Element {
  const toast = useToast();
  const { data, loading, error, reload } = useApi<TaskDetailPayload | null>(
    () => (taskId ? api.get<unknown>(`/projects/${projectId}/tasks/${taskId}`).then(normalizeTaskDetail) : Promise.resolve(null)),
    [taskId, projectId],
  );
  const [editingDesc, setEditingDesc] = useState(false);
  const [desc, setDesc] = useState('');
  const [newSub, setNewSub] = useState('');
  const [executing, setExecuting] = useState(false);
  const [confirmExecute, setConfirmExecute] = useState(false);

  const task = data?.task;
  const story = data?.story;
  const subtasks: Subtask[] = data?.subtasks ?? [];

  const patchTask = async (body: Record<string, unknown>): Promise<void> => {
    if (!task) return;
    try {
      await api.patch(`/projects/${projectId}/tasks/${task.id}`, body);
      reload();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update task');
    }
  };

  const transition = async (next: BacklogStatus): Promise<void> => {
    if (!task) return;
    try {
      await api.post(`/projects/${projectId}/tasks/${task.id}/transition`, { status: next });
      toast.success(`Moved to ${titleCase(next)}`);
      reload();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Transition failed');
      reload();
    }
  };

  const addSub = async (): Promise<void> => {
    const t = newSub.trim();
    if (!task || t.length < 2) return;
    try {
      await api.post(`/projects/${projectId}/tasks/${task.id}/subtasks`, { title: t });
      setNewSub('');
      reload();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to add subtask');
    }
  };

  const toggleSub = async (sub: Subtask): Promise<void> => {
    if (!task) return;
    try {
      await api.patch(`/projects/${projectId}/tasks/${task.id}/subtasks/${sub.id}`, { done: !sub.done });
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to update subtask');
    }
  };

  const deleteSub = async (subId: string): Promise<void> => {
    if (!task) return;
    try {
      await api.del(`/projects/${projectId}/tasks/${task.id}/subtasks/${subId}`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete subtask');
    }
  };

  const execute = async (): Promise<void> => {
    if (!task) return;
    setExecuting(true);
    try {
      await api.post(`/tasks/${task.id}/execute`, { createPR: true });
      toast.success('AI execution queued — follow it in the executions page');
      setExecuting(false);
      onClose();
      onChanged();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to start execution');
      setExecuting(false);
    }
  };

  const depNames = (data?.dependencies ?? [])
    .map(([, depId]) => boardTasks.find((t) => t.id === depId)?.title ?? 'Unknown task')
    .filter(Boolean);

  return (
    <Drawer
      open={taskId !== null}
      onClose={onClose}
      title={loading && !task ? 'Loading task…' : (task?.title ?? 'Task')}
      subtitle={story ? `Story: ${story.title}` : undefined}
      footer={
        task ? (
          <>
            <button className="btn btn-ghost" onClick={onClose}>
              Close
            </button>
            <div className="spacer" />
            <button className="btn btn-primary" onClick={() => setConfirmExecute(true)} disabled={executing}>
              {executing ? <span className="spinner" style={{ borderTopColor: '#fff' }} /> : <IconZap size={14} />}
              Run AI execution
            </button>
          </>
        ) : null
      }
    >
      {error ? <ErrorState error={error} onRetry={reload} compact /> : null}
      {!error && loading && !task ? <Skeleton height={200} /> : null}
      {task ? (
        <>
          <div className="row gap-2 wrap">
            <StatusBadge status={task.status} />
            <PriorityBadge priority={task.priority} />
          </div>

          <div className="row gap-2 wrap">
            <Select
              value={task.status}
              onChange={(e) => void transition(e.target.value as BacklogStatus)}
              style={{ width: 170 }}
              aria-label="Change task status"
            >
              {Array.from(new Set<BacklogStatus>([task.status, ...(VALID_TRANSITIONS[task.status] ?? [])])).map((s) => (
                <option key={s} value={s}>
                  {titleCase(s)}
                </option>
              ))}
            </Select>
            <Select
              value={task.priority}
              onChange={(e) => void patchTask({ priority: e.target.value })}
              style={{ width: 150 }}
              aria-label="Change task priority"
            >
              {PRIORITIES.map((p) => (
                <option key={p} value={p}>
                  {titleCase(p)}
                </option>
              ))}
            </Select>
          </div>

          <Field label="Title">
            <Input
              defaultValue={task.title}
              key={`title-${task.id}`}
              onBlur={(e) => {
                const v = e.target.value.trim();
                if (v && v !== task.title) void patchTask({ title: v });
              }}
              maxLength={200}
            />
          </Field>

          <Field label="Description">
            {editingDesc ? (
              <div className="stack gap-2">
                <Textarea
                  value={desc}
                  onChange={(e) => setDesc(e.target.value)}
                  rows={5}
                  autoFocus
                  maxLength={8000}
                />
                <div className="row gap-2">
                  <button
                    className="btn btn-primary btn-sm"
                    onClick={() => {
                      void patchTask({ description: desc.trim() });
                      setEditingDesc(false);
                    }}
                  >
                    Save
                  </button>
                  <button className="btn btn-sm" onClick={() => setEditingDesc(false)}>
                    Cancel
                  </button>
                </div>
              </div>
            ) : (
              <div
                className="muted clickable"
                style={{ whiteSpace: 'pre-wrap', fontSize: 13, lineHeight: 1.6, minHeight: 40 }}
                onClick={() => {
                  setDesc(task.description);
                  setEditingDesc(true);
                }}
                role="button"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    setDesc(task.description);
                    setEditingDesc(true);
                  }
                }}
                title="Click to edit"
              >
                {task.description || 'No description — click to add one.'}
              </div>
            )}
          </Field>

          <div className="stack gap-2">
            <div className="uppercase-label">Subtasks</div>
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
            <div className="row gap-2">
              <Input
                value={newSub}
                onChange={(e) => setNewSub(e.target.value)}
                placeholder="Add a subtask…"
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void addSub();
                }}
                maxLength={200}
              />
              <button className="btn btn-sm" onClick={() => void addSub()} disabled={newSub.trim().length < 2}>
                <IconPlus size={13} />
              </button>
            </div>
          </div>

          <div className="stack gap-2">
            <div className="uppercase-label">Depends on</div>
            {depNames.length === 0 ? (
              <div className="faint text-sm">No task dependencies.</div>
            ) : (
              <div className="row gap-2 wrap">
                {depNames.map((name, i) => (
                  <span key={i} className="dep-tag">
                    <span className="truncate" style={{ maxWidth: 240 }}>
                      {name}
                    </span>
                  </span>
                ))}
              </div>
            )}
          </div>

        </>
      ) : null}
      <ConfirmDialog
        open={confirmExecute}
        title="Run AI execution"
        message={
          <>
            The AI developer agent will attempt to implement <strong>{task?.title}</strong>: it plans the change, edits
            the code in the connected repository, runs tests, and — if everything passes — pushes a branch and opens a
            pull request for your review. You can cancel while it is queued or running.
          </>
        }
        confirmLabel="Start execution"
        busy={executing}
        onConfirm={() => void execute()}
        onCancel={() => setConfirmExecute(false)}
      />
    </Drawer>
  );
}

// ---------- board ----------

export function SprintBoard(): JSX.Element {
  const ctx = useProjectRequired();
  const projectId = ctx.projectId;
  const toast = useToast();
  const { data, loading, error, reload } = useApi<BoardPayload>(
    () => api.get<unknown>(`/projects/${projectId}/board`) as Promise<BoardPayload>,
    [projectId],
  );
  const [dragTaskId, setDragTaskId] = useState<string | null>(null);
  const [dragOverCol, setDragOverCol] = useState<BacklogStatus | null>(null);
  const [openTaskId, setOpenTaskId] = useState<string | null>(null);

  const tasks = data?.tasks ?? [];
  const activeSprint: Sprint | null = data?.activeSprint ?? null;

  const drop = async (status: BacklogStatus): Promise<void> => {
    setDragOverCol(null);
    const id = dragTaskId;
    setDragTaskId(null);
    if (!id) return;
    const task = tasks.find((t) => t.id === id);
    if (!task || task.status === status) return;
    try {
      await api.post(`/projects/${projectId}/tasks/${id}/transition`, { status });
      toast.success(`"${task.title}" moved to ${titleCase(status)}`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Transition failed');
    }
  };

  if (loading && !data)
    return (
      <div className="page" style={{ maxWidth: 'none' }}>
        <Skeleton height={40} style={{ marginBottom: 16 }} />
        <div className="kanban-board">
          {COLUMNS.map((c) => (
            <div key={c.status} className="kanban-column">
              <Skeleton height={200} style={{ margin: 10, borderRadius: 8 }} />
            </div>
          ))}
        </div>
      </div>
    );

  if (error)
    return (
      <div className="page">
        <ErrorState error={error} onRetry={reload} title="Failed to load board" />
      </div>
    );

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Sprint Board</div>
          <div className="page-sub">
            {activeSprint ? (
              <span className="row gap-2">
                Active sprint: <strong>{activeSprint.name}</strong>
              </span>
            ) : (
              'No active sprint — activate one from the Sprints page.'
            )}
          </div>
        </div>
      </div>

      {tasks.length === 0 ? (
        <EmptyState
          title="No tasks on the board"
          description="Create stories and break them down into tasks in the backlog, then drag cards between columns here."
        />
      ) : (
        <div className="kanban-board">
          {COLUMNS.map((col) => {
            const colTasks = tasks.filter((t) => t.status === col.status);
            return (
              <div
                key={col.status}
                className={`kanban-column ${dragOverCol === col.status ? 'drag-over' : ''}`}
                onDragOver={(e) => {
                  e.preventDefault();
                  setDragOverCol(col.status);
                }}
                onDragLeave={(e) => {
                  if (!(e.currentTarget instanceof Element) || !e.currentTarget.contains(e.relatedTarget as Node)) {
                    setDragOverCol(null);
                  }
                }}
                onDrop={(e) => {
                  e.preventDefault();
                  void drop(col.status);
                }}
              >
                <div className="kanban-column-header">
                  <span className="kanban-dot" style={{ background: col.dot }} />
                  <span>{titleCase(col.status)}</span>
                  <span className="spacer" />
                  <span className="kanban-count">{colTasks.length}</span>
                </div>
                <div className="kanban-cards">
                  {colTasks.length === 0 ? (
                    <div className="kanban-empty">Drop tasks here</div>
                  ) : (
                    colTasks.map((task) => (
                      <div
                        key={task.id}
                        className={`kanban-card ${dragTaskId === task.id ? 'dragging' : ''}`}
                        draggable
                        onDragStart={(e) => {
                          setDragTaskId(task.id);
                          e.dataTransfer.effectAllowed = 'move';
                          e.dataTransfer.setData('text/plain', task.id);
                        }}
                        onDragEnd={() => {
                          setDragTaskId(null);
                          setDragOverCol(null);
                        }}
                        onClick={() => setOpenTaskId(task.id)}
                        role="button"
                        tabIndex={0}
                        onKeyDown={(e) => {
                          if (e.key === 'Enter') setOpenTaskId(task.id);
                        }}
                        aria-label={`Task: ${task.title}`}
                      >
                        <div className="kanban-card-title">{task.title}</div>
                        <div className="kanban-card-meta">
                          <PriorityBadge priority={task.priority} />
                          <span className="faint text-sm truncate" style={{ maxWidth: 160 }}>
                            {task.storyTitle}
                          </span>
                        </div>
                      </div>
                    ))
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}

      <TaskDrawer
        taskId={openTaskId}
        projectId={projectId}
        boardTasks={tasks}
        onClose={() => setOpenTaskId(null)}
        onChanged={reload}
      />
    </div>
  );
}

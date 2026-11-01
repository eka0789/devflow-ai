import { useState, type JSX } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import type { Project } from '@devflow/shared';
import { api } from '../lib/api';
import { formatDate, useProjectRequired, useToast } from '../lib/hooks';
import { ConfirmDialog } from '../components/ConfirmDialog';
import { ErrorState } from '../components/ErrorState';
import { PageLoader } from '../components/Skeleton';
import { ProjectSettingsForm } from './ProjectOverview';
import { IconTrash } from '../components/icons';

export function ProjectSettings(): JSX.Element {
  const ctx = useProjectRequired();
  const { project, setProject } = ctx;
  const navigate = useNavigate();
  const toast = useToast();
  const [deleting, setDeleting] = useState(false);
  const [busy, setBusy] = useState(false);

  if (ctx.loading && !ctx.project) return <PageLoader />;
  if (ctx.error)
    return (
      <div className="page">
        <ErrorState error={ctx.error} onRetry={ctx.reload} title="Failed to load project" />
      </div>
    );
  if (!project) return <PageLoader />;

  const doDelete = async (): Promise<void> => {
    setBusy(true);
    try {
      await api.del(`/projects/${project.id}`);
      toast.success(`Project "${project.name}" deleted`);
      navigate('/', { replace: true });
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to delete project');
      setBusy(false);
    }
  };

  const doExport = async (): Promise<void> => {
    setBusy(true);
    try {
      const data = await api.get<unknown>(`/projects/${project.id}/export`);
      const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = `${project.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}-${new Date().toISOString().slice(0, 10)}.json`;
      document.body.appendChild(link);
      link.click();
      link.remove();
      URL.revokeObjectURL(url);
      toast.success('Project exported as JSON');
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to export project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="page" style={{ maxWidth: 760 }}>
      <div className="page-header">
        <div>
          <div className="page-title">Project settings</div>
          <div className="page-sub">Created {formatDate(project.createdAt)}</div>
        </div>
        <div className="page-actions">
          <button className="btn" onClick={() => void doExport()} disabled={busy}>
            Export project (JSON)
          </button>
        </div>
      </div>

      <div className="card card-pad-lg">
        <ProjectSettingsForm project={project} onSaved={setProject} />
      </div>

      <section className="section">
        <div className="section-title" style={{ color: 'var(--danger)' }}>
          Danger zone
        </div>
        <div
          className="card"
          style={{ borderColor: 'rgba(229,72,77,.4)', display: 'flex', gap: 16, alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap' }}
        >
          <div className="stack gap-1" style={{ gap: 4 }}>
            <div className="weight-600">Delete this project</div>
            <div className="muted text-sm" style={{ maxWidth: 480 }}>
              Permanently removes the project with all epics, stories, tasks, sprints, conversations, drafts and
              execution history. This cannot be undone.
            </div>
          </div>
          <button className="btn btn-danger" onClick={() => setDeleting(true)}>
            <IconTrash size={14} />
            Delete project
          </button>
        </div>
      </section>

      <div className="row justify-end" style={{ marginTop: 20 }}>
        <Link to={`/projects/${project.id}`} className="btn btn-ghost">
          Back to overview
        </Link>
      </div>

      <ConfirmDialog
        open={deleting}
        title="Delete project"
        message={
          <>
            This will permanently delete <strong>{project.name}</strong> and everything in it. This action cannot be
            undone.
          </>
        }
        confirmLabel="Delete project"
        danger
        requireText={project.name}
        busy={busy}
        onConfirm={() => void doDelete()}
        onCancel={() => setDeleting(false)}
      />
    </div>
  );
}

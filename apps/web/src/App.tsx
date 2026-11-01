import { useMemo, type JSX, type ReactNode } from 'react';
import { Navigate, Outlet, Route, Routes, useLocation, matchPath, useParams } from 'react-router-dom';
import type { Project } from '@devflow/shared';
import { api } from './lib/api';
import { ProjectContext, useApi, useAuth, type ProjectCtx } from './lib/hooks';
import { CommandPalette } from './components/CommandPalette';
import { PageLoader } from './components/Skeleton';
import { Sidebar } from './components/Sidebar';
import { Topbar } from './components/Topbar';
import { Dashboard } from './pages/Dashboard';
import { ChatPage } from './pages/ChatPage';
import { ExecutionsPage } from './pages/ExecutionsPage';
import { AnalyticsPage } from './pages/AnalyticsPage';
import { SettingsPage } from './pages/SettingsPage';
import { GitHubPage } from './pages/GitHubPage';
import { Login } from './pages/Login';
import { PlanningPage } from './pages/PlanningPage';
import { ProjectBacklog } from './pages/ProjectBacklog';
import { ProjectOverview } from './pages/ProjectOverview';
import { ProjectSettings } from './pages/ProjectSettings';
import { Register } from './pages/Register';
import { SprintBoard } from './pages/SprintBoard';
import { SprintPage } from './pages/SprintPage';

/** Fetches the current project (when on a /projects/:projectId/* route) and provides it app-wide. */
function ProjectProvider({ children }: { children: ReactNode }): JSX.Element {
  const location = useLocation();
  const match = matchPath('/projects/:projectId/*', location.pathname);
  const projectId = match?.params.projectId ?? null;

  const fetcher = useMemo(
    () => (projectId ? () => api.get<Project>(`/projects/${projectId}`) : () => Promise.resolve<Project | null>(null)),
    [projectId],
  );
  const { data, loading, error, reload, setData } = useApi<Project | null>(fetcher, [projectId]);

  const ctx = useMemo<ProjectCtx | null>(
    () =>
      projectId
        ? {
            projectId,
            project: data,
            loading,
            error,
            reload,
            setProject: (p: Project) => setData(p),
          }
        : null,
    [projectId, data, loading, error, reload, setData],
  );

  return <ProjectContext.Provider value={ctx}>{children}</ProjectContext.Provider>;
}

function Layout(): JSX.Element {
  return (
    <div className="app-shell">
      <ProjectProvider>
        <Sidebar />
        <div className="app-main">
          <Topbar />
          <main className="app-content">
            <Outlet />
          </main>
        </div>
        <CommandPalette />
      </ProjectProvider>
    </div>
  );
}

function AuthGate(): JSX.Element {
  const { user, initializing } = useAuth();
  const location = useLocation();

  if (initializing) {
    return (
      <div className="auth-shell">
        <PageLoader label="Loading workspace" />
      </div>
    );
  }
  if (!user) {
    return <Navigate to="/login" replace state={{ from: location.pathname }} />;
  }
  return <Outlet />;
}

function RedirectToProject(): JSX.Element {
  const { projectId } = useParams();
  return <Navigate to={`/projects/${projectId ?? ''}`} replace />;
}

export default function App(): JSX.Element {
  return (
    <Routes>
      <Route path="/login" element={<Login />} />
      <Route path="/register" element={<Register />} />

      <Route element={<AuthGate />}>
        <Route element={<Layout />}>
          <Route path="/" element={<Dashboard />} />

          <Route path="/projects/:projectId">
            <Route index element={<ProjectOverview />} />
            <Route path="backlog" element={<ProjectBacklog />} />
            <Route path="board" element={<SprintBoard />} />
            <Route path="sprints" element={<SprintPage />} />
            <Route path="planning" element={<PlanningPage />} />
            <Route path="github" element={<GitHubPage />} />
            <Route path="executions" element={<ExecutionsPage />} />
            <Route path="analytics" element={<AnalyticsPage />} />
            <Route path="settings" element={<ProjectSettings />} />
            <Route path="*" element={<RedirectToProject />} />
          </Route>

          <Route path="/chat" element={<ChatPage />} />
          <Route path="/analytics" element={<AnalyticsPage />} />
          <Route path="/executions" element={<ExecutionsPage />} />
          <Route path="/settings" element={<SettingsPage />} />
        </Route>
      </Route>

      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}

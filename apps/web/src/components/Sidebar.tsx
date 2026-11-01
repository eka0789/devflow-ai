/** App sidebar: brand, project switcher, workspace & project navigation. */
import type { JSX } from 'react';
import { NavLink } from 'react-router-dom';
import { useProject } from '../lib/hooks';
import { ProjectSwitcher } from './ProjectSwitcher';
import {
  IconChart,
  IconChat,
  IconCommand,
  IconDashboard,
  IconGitHub,
  IconKanban,
  IconList,
  IconSettings,
  IconSprint,
  IconSparkles,
  IconZap,
} from './icons';

const COMMAND_PALETTE_EVENT = 'devflow:open-command-palette';

export function openCommandPalette(): void {
  window.dispatchEvent(new CustomEvent(COMMAND_PALETTE_EVENT));
}

export const COMMAND_PALETTE_EVENT_NAME = COMMAND_PALETTE_EVENT;

interface NavEntry {
  to: string;
  label: string;
  icon: JSX.Element;
  end?: boolean;
}

export function Sidebar(): JSX.Element {
  const project = useProject();

  const workspaceNav: NavEntry[] = [
    { to: '/', label: 'Dashboard', icon: <IconDashboard size={15} />, end: true },
    { to: '/chat', label: 'AI Chat', icon: <IconChat size={15} />, end: true },
    { to: '/analytics', label: 'Analytics', icon: <IconChart size={15} />, end: true },
    { to: '/executions', label: 'Executions', icon: <IconZap size={15} />, end: true },
    { to: '/settings', label: 'Settings', icon: <IconSettings size={15} />, end: true },
  ];

  const projectId = project?.projectId ?? '';
  const projectNav: NavEntry[] = project
    ? [
        { to: `/projects/${projectId}`, label: 'Overview', icon: <IconDashboard size={15} />, end: true },
        { to: `/projects/${projectId}/backlog`, label: 'Backlog', icon: <IconList size={15} /> },
        { to: `/projects/${projectId}/board`, label: 'Board', icon: <IconKanban size={15} /> },
        { to: `/projects/${projectId}/sprints`, label: 'Sprints', icon: <IconSprint size={15} /> },
        { to: `/projects/${projectId}/planning`, label: 'AI Planning', icon: <IconSparkles size={15} /> },
        { to: `/projects/${projectId}/github`, label: 'GitHub', icon: <IconGitHub size={15} /> },
        { to: `/projects/${projectId}/executions`, label: 'Executions', icon: <IconZap size={15} /> },
        { to: `/projects/${projectId}/analytics`, label: 'Analytics', icon: <IconChart size={15} /> },
        { to: `/projects/${projectId}/settings`, label: 'Settings', icon: <IconSettings size={15} /> },
      ]
    : [];

  const renderNav = (entries: NavEntry[]): JSX.Element[] =>
    entries.map((entry) => (
      <NavLink
        key={entry.to}
        to={entry.to}
        end={entry.end}
        className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}
      >
        {entry.icon}
        {entry.label}
      </NavLink>
    ));

  return (
    <aside className="app-sidebar">
      <NavLink to="/" className="sidebar-logo" end>
        <span className="logo-mark">DF</span>
        <span className="logo-name">
          DevFlow<span> AI</span>
        </span>
      </NavLink>

      <ProjectSwitcher current={project} />

      {project ? (
        <nav className="nav-section" aria-label="Project">
          <div className="nav-section-label">Project</div>
          {renderNav(projectNav)}
        </nav>
      ) : null}

      <nav className="nav-section" aria-label="Workspace">
        <div className="nav-section-label">{project ? 'Workspace' : 'Navigate'}</div>
        {renderNav(workspaceNav)}
      </nav>

      <div className="sidebar-footer">
        <button className="menu-item" onClick={openCommandPalette} style={{ width: '100%' }}>
          <IconCommand size={14} />
          Command palette
          <kbd style={{ marginLeft: 'auto' }}>Ctrl K</kbd>
        </button>
      </div>
    </aside>
  );
}

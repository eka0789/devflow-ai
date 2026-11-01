/** Topbar: page title, command palette trigger, notifications, theme toggle, user menu. */
import { useState, type JSX } from 'react';
import { NavLink, useLocation } from 'react-router-dom';
import type { Notification } from '@devflow/shared';
import { api } from '../lib/api';
import { formatRelative, useApi, useAuth, useClickOutside, usePolling, useProject, useTheme, useToast } from '../lib/hooks';
import { openCommandPalette } from './Sidebar';
import {
  IconBell,
  IconCheck,
  IconCommand,
  IconLogout,
  IconMoon,
  IconSearch,
  IconSettings,
  IconSun,
} from './icons';

const SECTION_TITLES: Array<[RegExp, string]> = [
  [/\/projects\/[^/]+\/backlog/, 'Backlog'],
  [/\/projects\/[^/]+\/board/, 'Sprint Board'],
  [/\/projects\/[^/]+\/roadmap/, 'Roadmap'],
  [/\/projects\/[^/]+\/sprints/, 'Sprints'],
  [/\/projects\/[^/]+\/planning/, 'AI Planning'],
  [/\/projects\/[^/]+\/github/, 'GitHub'],
  [/\/projects\/[^/]+\/executions/, 'Executions'],
  [/\/projects\/[^/]+\/analytics/, 'Analytics'],
  [/\/projects\/[^/]+\/settings/, 'Project Settings'],
  [/\/projects\/[^/]+$/, 'Project Overview'],
  [/^\/chat/, 'AI Chat'],
  [/^\/my-work/, 'My Work'],
  [/^\/analytics/, 'Analytics'],
  [/^\/executions/, 'Executions'],
  [/^\/settings/, 'Settings'],
  [/^\/$/, 'Dashboard'],
];

function initials(name: string): string {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0]!.toUpperCase())
    .join('')
    .toUpperCase();
}

function NotificationsBell(): JSX.Element {
  const [open, setOpen] = useState(false);
  const toast = useToast();
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);
  const { data, loading, reload } = useApi<Notification[]>(() => api.get<Notification[]>('/notifications'), []);
  usePolling(reload, 30_000);

  const notifications = data ?? [];
  const unread = notifications.filter((n) => !n.read).length;

  const markRead = async (id: string): Promise<void> => {
    try {
      await api.post(`/notifications/${id}/read`);
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark as read');
    }
  };

  const markAll = async (): Promise<void> => {
    try {
      await api.post('/notifications/read-all');
      reload();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Failed to mark all as read');
    }
  };

  return (
    <div className="dropdown" ref={ref}>
      <button
        className={`icon-btn ${open ? 'active' : ''}`}
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${unread > 0 ? ` (${unread} unread)` : ''}`}
        aria-expanded={open}
      >
        <IconBell size={16} />
        {unread > 0 ? <span className="bell-badge">{unread > 9 ? '9+' : unread}</span> : null}
      </button>
      {open ? (
        <div className="dropdown-menu notif-list">
          <div className="menu-header row">
            <span className="flex-1">Notifications</span>
            {unread > 0 ? (
              <button className="inline-link text-sm" onClick={() => void markAll()}>
                Mark all read
              </button>
            ) : null}
          </div>
          <div className="menu-sep" />
          <div className="menu-scroll">
            {loading && notifications.length === 0 ? (
              <div className="muted" style={{ padding: '14px', fontSize: 13 }}>
                Loading…
              </div>
            ) : notifications.length === 0 ? (
              <div className="muted" style={{ padding: '18px 14px', fontSize: 13, textAlign: 'center' }}>
                You're all caught up.
              </div>
            ) : (
              notifications.map((n) => (
                <div
                  key={n.id}
                  className={`notif-item ${n.read ? '' : 'unread'}`}
                  onClick={() => {
                    if (!n.read) void markRead(n.id);
                  }}
                  role="button"
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && !n.read) void markRead(n.id);
                  }}
                >
                  <span className={`notif-dot ${n.read ? 'read' : ''}`} />
                  <div className="stack gap-1" style={{ gap: 2, minWidth: 0 }}>
                    <div className="text-sm weight-600 truncate">{n.title}</div>
                    <div className="text-sm muted" style={{ lineHeight: 1.4 }}>
                      {n.body}
                    </div>
                    <div className="faint" style={{ fontSize: 11 }}>
                      {formatRelative(n.createdAt)}
                    </div>
                  </div>
                  {!n.read ? (
                    <span className="faint" title="Mark read">
                      <IconCheck size={13} />
                    </span>
                  ) : null}
                </div>
              ))
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function UserMenu(): JSX.Element {
  const [open, setOpen] = useState(false);
  const { user, logout } = useAuth();
  const { theme, toggle } = useTheme();
  const ref = useClickOutside<HTMLDivElement>(() => setOpen(false), open);

  return (
    <div className="dropdown" ref={ref}>
      <button
        className="ps-avatar"
        style={{ background: 'linear-gradient(135deg, var(--accent), #9b6eff)', width: 28, height: 28, borderRadius: 8 }}
        onClick={() => setOpen((o) => !o)}
        aria-label="Account menu"
        aria-expanded={open}
      >
        {initials(user?.name ?? '?')}
      </button>
      {open ? (
        <div className="dropdown-menu">
          <div className="menu-header" style={{ textTransform: 'none', letterSpacing: 0 }}>
            <div className="weight-600" style={{ fontSize: 13, color: 'var(--text)' }}>
              {user?.name}
            </div>
            <div style={{ fontSize: 12, fontWeight: 400 }}>{user?.email}</div>
          </div>
          <div className="menu-sep" />
          <NavLink to="/settings" className="menu-item" onClick={() => setOpen(false)}>
            <IconSettings size={14} />
            Settings
          </NavLink>
          <button className="menu-item" onClick={toggle}>
            {theme === 'dark' ? <IconSun size={14} /> : <IconMoon size={14} />}
            {theme === 'dark' ? 'Light theme' : 'Dark theme'}
          </button>
          <div className="menu-sep" />
          <button
            className="menu-item danger"
            onClick={() => {
              setOpen(false);
              void logout();
            }}
          >
            <IconLogout size={14} />
            Log out
          </button>
        </div>
      ) : null}
    </div>
  );
}

export function Topbar(): JSX.Element {
  const location = useLocation();
  const project = useProject();

  const section = SECTION_TITLES.find(([re]) => re.test(location.pathname))?.[1] ?? 'DevFlow AI';

  return (
    <header className="app-topbar">
      <div className="topbar-title row gap-2">
        {project?.project ? (
          <>
            <span className="topbar-crumb truncate" style={{ maxWidth: 220 }}>
              {project.project.name}
            </span>
            <span className="faint">/</span>
          </>
        ) : null}
        <span className="truncate">{section}</span>
      </div>
      <div className="spacer" />
      <button className="icon-btn" onClick={openCommandPalette} aria-label="Open command palette">
        <IconSearch size={15} />
      </button>
      <NotificationsBell />
      <button
        className="icon-btn"
        onClick={openCommandPalette}
        aria-label="Command palette"
        title="Command palette (Ctrl+K)"
      >
        <IconCommand size={15} />
      </button>
      <UserMenu />
    </header>
  );
}

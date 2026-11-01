/** Ctrl+K command palette: fuzzy navigation + project switching. */
import { useCallback, useEffect, useMemo, useRef, useState, type JSX } from 'react';
import { useNavigate } from 'react-router-dom';
import type { Project } from '@devflow/shared';
import { api } from '../lib/api';
import { useProject } from '../lib/hooks';
import { colorFor } from './ProjectSwitcher';
import {
  IconChart,
  IconChat,
  IconCornerDownLeft,
  IconDashboard,
  IconGitHub,
  IconKanban,
  IconList,
  IconSettings,
  IconSprint,
  IconSparkles,
  IconZap,
} from './icons';

const PALETTE_EVENT = 'devflow:open-command-palette';

interface Command {
  id: string;
  label: string;
  group: string;
  icon: JSX.Element;
  sub?: string;
  run: () => void;
}

/** Subsequence fuzzy match; returns score (higher = better) or -1. */
function fuzzyScore(query: string, target: string): number {
  if (!query) return 1;
  const q = query.toLowerCase();
  const t = target.toLowerCase();
  const direct = t.indexOf(q);
  if (direct >= 0) return 100 - direct;
  let qi = 0;
  let score = 0;
  let lastHit = -2;
  for (let ti = 0; ti < t.length && qi < q.length; ti++) {
    if (t[ti] === q[qi]) {
      score += ti - lastHit === 1 ? 3 : 1;
      lastHit = ti;
      qi += 1;
    }
  }
  return qi === q.length ? score : -1;
}

export function CommandPalette(): JSX.Element {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [activeIdx, setActiveIdx] = useState(0);
  const [projects, setProjects] = useState<Project[] | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const navigate = useNavigate();
  const project = useProject();

  const openPalette = useCallback(() => {
    setQuery('');
    setActiveIdx(0);
    setOpen(true);
    api
      .get<Project[]>('/projects')
      .then(setProjects)
      .catch(() => setProjects([]));
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k') {
        e.preventDefault();
        setOpen((o) => {
          if (o) return false;
          openPalette();
          return true;
        });
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [openPalette]);

  useEffect(() => {
    const handler = (): void => openPalette();
    window.addEventListener(PALETTE_EVENT, handler);
    return () => window.removeEventListener(PALETTE_EVENT, handler);
  }, [openPalette]);

  useEffect(() => {
    if (open) inputRef.current?.focus();
  }, [open]);

  const go = useCallback(
    (path: string) => {
      setOpen(false);
      navigate(path);
    },
    [navigate],
  );

  const commands = useMemo<Command[]>(() => {
    const base: Command[] = [
      { id: 'dashboard', label: 'Dashboard', group: 'Navigate', icon: <IconDashboard size={15} />, run: () => go('/') },
      { id: 'chat', label: 'AI Chat', group: 'Navigate', icon: <IconChat size={15} />, run: () => go('/chat') },
      { id: 'analytics', label: 'Analytics', group: 'Navigate', icon: <IconChart size={15} />, run: () => go('/analytics') },
      { id: 'executions', label: 'Executions', group: 'Navigate', icon: <IconZap size={15} />, run: () => go('/executions') },
      { id: 'settings', label: 'Settings', group: 'Navigate', icon: <IconSettings size={15} />, run: () => go('/settings') },
    ];

    const pid = project?.projectId;
    if (pid) {
      base.push(
        { id: 'p-overview', label: 'Project Overview', group: 'This project', icon: <IconDashboard size={15} />, run: () => go(`/projects/${pid}`) },
        { id: 'p-backlog', label: 'Backlog', group: 'This project', icon: <IconList size={15} />, run: () => go(`/projects/${pid}/backlog`) },
        { id: 'p-board', label: 'Sprint Board', group: 'This project', icon: <IconKanban size={15} />, run: () => go(`/projects/${pid}/board`) },
        { id: 'p-sprints', label: 'Sprints', group: 'This project', icon: <IconSprint size={15} />, run: () => go(`/projects/${pid}/sprints`) },
        { id: 'p-planning', label: 'AI Planning', group: 'This project', icon: <IconSparkles size={15} />, run: () => go(`/projects/${pid}/planning`) },
        { id: 'p-github', label: 'GitHub', group: 'This project', icon: <IconGitHub size={15} />, run: () => go(`/projects/${pid}/github`) },
        { id: 'p-executions', label: 'Project Executions', group: 'This project', icon: <IconZap size={15} />, run: () => go(`/projects/${pid}/executions`) },
        { id: 'p-analytics', label: 'Project Analytics', group: 'This project', icon: <IconChart size={15} />, run: () => go(`/projects/${pid}/analytics`) },
      );
    }

    for (const p of projects ?? []) {
      base.push({
        id: `proj-${p.id}`,
        label: p.name,
        group: 'Projects',
        icon: (
          <span className="ps-avatar" style={{ width: 16, height: 16, fontSize: 8, background: colorFor(p.name) }}>
            {p.name.slice(0, 1).toUpperCase()}
          </span>
        ),
        sub: p.status,
        run: () => go(`/projects/${p.id}`),
      });
    }
    return base;
  }, [go, project?.projectId, projects]);

  const filtered = useMemo(() => {
    return commands
      .map((c) => ({ c, score: Math.max(fuzzyScore(query, c.label), fuzzyScore(query, c.group) - 10) }))
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 24)
      .map((x) => x.c);
  }, [commands, query]);

  useEffect(() => {
    setActiveIdx(0);
  }, [query]);

  useEffect(() => {
    const el = listRef.current?.querySelector(`[data-idx="${activeIdx}"]`);
    el?.scrollIntoView({ block: 'nearest' });
  }, [activeIdx]);

  if (!open) return <div />;

  const execute = (cmd: Command): void => {
    setOpen(false);
    cmd.run();
  };

  let lastGroup = '';

  return (
    <>
      <div
        className="cp-overlay"
        onClick={() => setOpen(false)}
        onKeyDown={(e) => {
          if (e.key === 'Escape') setOpen(false);
        }}
      />
      <div className="command-palette" role="dialog" aria-modal="true" aria-label="Command palette">
        <input
          ref={inputRef}
          className="cp-input"
          placeholder="Type a command or search projects…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'ArrowDown') {
              e.preventDefault();
              setActiveIdx((i) => Math.min(i + 1, filtered.length - 1));
            } else if (e.key === 'ArrowUp') {
              e.preventDefault();
              setActiveIdx((i) => Math.max(i - 1, 0));
            } else if (e.key === 'Enter') {
              e.preventDefault();
              const cmd = filtered[activeIdx];
              if (cmd) execute(cmd);
            } else if (e.key === 'Escape') {
              setOpen(false);
            }
          }}
        />
        <div className="cp-list" ref={listRef}>
          {filtered.length === 0 ? (
            <div className="cp-empty">No matching commands</div>
          ) : (
            filtered.map((cmd, idx) => {
              const showGroup = cmd.group !== lastGroup;
              lastGroup = cmd.group;
              return (
                <div key={cmd.id}>
                  {showGroup ? <div className="cp-group-label">{cmd.group}</div> : null}
                  <button
                    data-idx={idx}
                    className={`cp-item ${idx === activeIdx ? 'active' : ''}`}
                    onMouseEnter={() => setActiveIdx(idx)}
                    onClick={() => execute(cmd)}
                  >
                    <span className="cp-icon">{cmd.icon}</span>
                    <span className="truncate">{cmd.label}</span>
                    {cmd.sub ? <span className="cp-item-sub">{cmd.sub}</span> : null}
                  </button>
                </div>
              );
            })
          )}
        </div>
        <div className="cp-hint">
          <span className="row gap-1">
            <kbd>↑</kbd>
            <kbd>↓</kbd> navigate
          </span>
          <span className="row gap-1">
            <IconCornerDownLeft size={12} /> select
          </span>
          <span className="row gap-1">
            <kbd>Esc</kbd> close
          </span>
        </div>
      </div>
    </>
  );
}

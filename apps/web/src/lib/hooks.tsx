/**
 * App-wide hooks & contexts: data fetching, toasts, theme, auth, formatters.
 */
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type Dispatch,
  type ReactNode,
  type RefObject,
  type SetStateAction,
} from 'react';
import { useNavigate } from 'react-router-dom';
import type { AuthSession, Project, User, Workspace } from '@devflow/shared';
import { ApiError, api, clearToken, getToken, setUnauthorizedHandler } from './api';

// ================= useApi =================

export interface UseApiResult<T> {
  data: T | null;
  loading: boolean;
  refreshing: boolean;
  error: ApiError | null;
  reload: () => void;
  setData: Dispatch<SetStateAction<T | null>>;
}

/**
 * Fetches on mount and whenever `deps` change. Exposes reload() for
 * refetching (keeps stale data visible) and setData for local mutations.
 */
export function useApi<T>(fn: () => Promise<T>, deps: readonly unknown[]): UseApiResult<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<ApiError | null>(null);
  const [tick, setTick] = useState(0);

  const fnRef = useRef(fn);
  fnRef.current = fn;
  const dataRef = useRef<T | null>(null);
  dataRef.current = data;

  const depsKey = JSON.stringify(deps);
  const lastDepsKey = useRef(depsKey);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  // Reset data when the identity of the query changes (not on poll reloads).
  useEffect(() => {
    if (lastDepsKey.current !== depsKey) {
      lastDepsKey.current = depsKey;
      dataRef.current = null;
      setData(null);
      setError(null);
      setLoading(true);
    }
  }, [depsKey]);

  useEffect(() => {
    let cancelled = false;
    if (dataRef.current !== null) setRefreshing(true);
    fnRef
      .current()
      .then((result) => {
        if (cancelled) return;
        dataRef.current = result;
        setData(result);
        setError(null);
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        if (err instanceof DOMException && err.name === 'AbortError') return;
        setError(
          err instanceof ApiError
            ? err
            : new ApiError(0, 'INTERNAL', err instanceof Error ? err.message : 'Unexpected error'),
        );
      })
      .finally(() => {
        if (cancelled) return;
        setLoading(false);
        setRefreshing(false);
      });
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, tick]);

  return { data, loading, refreshing, error, reload, setData };
}

/** Calls `reload` every `ms` while `active`. */
export function usePolling(reload: () => void, ms: number, active = true): void {
  const reloadRef = useRef(reload);
  reloadRef.current = reload;
  useEffect(() => {
    if (!active) return;
    const id = window.setInterval(() => reloadRef.current(), ms);
    return () => window.clearInterval(id);
  }, [ms, active]);
}

/** Runs `cb` when Escape is pressed while `active`. */
export function useEscape(cb: () => void, active = true): void {
  const cbRef = useRef(cb);
  cbRef.current = cb;
  useEffect(() => {
    if (!active) return;
    const handler = (e: KeyboardEvent) => {
      if (e.key === 'Escape') cbRef.current();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [active]);
}

// ================= Toasts =================

export type ToastKind = 'success' | 'error' | 'info' | 'warning';

export interface ToastItem {
  id: number;
  kind: ToastKind;
  message: string;
}

export interface ToastApi {
  toasts: ToastItem[];
  dismiss: (id: number) => void;
  push: (kind: ToastKind, message: string) => void;
  success: (message: string) => void;
  error: (message: string) => void;
  info: (message: string) => void;
  warning: (message: string) => void;
}

const ToastContext = createContext<ToastApi | null>(null);

let toastSeq = 0;

export function ToastProvider({ children }: { children: ReactNode }): JSX.Element {
  const [toasts, setToasts] = useState<ToastItem[]>([]);

  const dismiss = useCallback((id: number) => {
    setToasts((list) => list.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: ToastKind, message: string) => {
      const id = ++toastSeq;
      setToasts((list) => [...list.slice(-4), { id, kind, message }]);
      window.setTimeout(() => {
        setToasts((list) => list.filter((t) => t.id !== id));
      }, 5200);
    },
    [],
  );

  const apiValue = useMemo<ToastApi>(
    () => ({
      toasts,
      dismiss,
      push,
      success: (m) => push('success', m),
      error: (m) => push('error', m),
      info: (m) => push('info', m),
      warning: (m) => push('warning', m),
    }),
    [toasts, dismiss, push],
  );

  return <ToastContext.Provider value={apiValue}>{children}</ToastContext.Provider>;
}

export function useToast(): ToastApi {
  const ctx = useContext(ToastContext);
  if (!ctx) throw new Error('useToast must be used within ToastProvider');
  return ctx;
}

// ================= Theme =================

export type Theme = 'dark' | 'light';

export interface ThemeApi {
  theme: Theme;
  toggle: () => void;
}

const ThemeContext = createContext<ThemeApi | null>(null);

export function ThemeProvider({ children }: { children: ReactNode }): JSX.Element {
  const [theme, setTheme] = useState<Theme>(() => {
    const stored = localStorage.getItem('devflow_theme');
    return stored === 'light' ? 'light' : 'dark';
  });

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
    localStorage.setItem('devflow_theme', theme);
  }, [theme]);

  const toggle = useCallback(() => setTheme((t) => (t === 'dark' ? 'light' : 'dark')), []);

  const value = useMemo(() => ({ theme, toggle }), [theme, toggle]);
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>;
}

export function useTheme(): ThemeApi {
  const ctx = useContext(ThemeContext);
  if (!ctx) throw new Error('useTheme must be used within ThemeProvider');
  return ctx;
}

// ================= Auth =================

export interface AuthApi {
  user: User | null;
  workspace: Workspace | null;
  initializing: boolean;
  login: (email: string, password: string) => Promise<void>;
  register: (name: string, email: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  updateUser: (user: User) => void;
}

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: ReactNode }): JSX.Element {
  const [user, setUser] = useState<User | null>(null);
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [initializing, setInitializing] = useState(() => getToken() !== null);
  const navigate = useNavigate();

  // 401 anywhere in the app => wipe session, go to login.
  useEffect(() => {
    setUnauthorizedHandler(() => {
      setUser(null);
      setWorkspace(null);
      const path = window.location.pathname;
      if (path !== '/login' && path !== '/register') {
        navigate('/login', { replace: true });
      }
    });
    return () => setUnauthorizedHandler(null);
  }, [navigate]);

  useEffect(() => {
    if (!getToken()) {
      setInitializing(false);
      return;
    }
    let cancelled = false;
    api
      .get<{ user: User; workspace: Workspace }>('/auth/me')
      .then((me) => {
        if (cancelled) return;
        setUser(me.user);
        setWorkspace(me.workspace);
      })
      .catch(() => {
        if (cancelled) return;
        clearToken();
        setUser(null);
        setWorkspace(null);
      })
      .finally(() => {
        if (!cancelled) setInitializing(false);
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const applySession = useCallback((session: AuthSession) => {
    localStorage.setItem('devflow_token', session.token);
    setUser(session.user);
    setWorkspace(session.workspace);
  }, []);

  const login = useCallback(
    async (email: string, password: string) => {
      const session = await api.post<AuthSession>('/auth/login', { email, password });
      applySession(session);
    },
    [applySession],
  );

  const register = useCallback(
    async (name: string, email: string, password: string) => {
      const session = await api.post<AuthSession>('/auth/register', { name, email, password });
      applySession(session);
    },
    [applySession],
  );

  const logout = useCallback(async () => {
    try {
      await api.post('/auth/logout');
    } catch {
      /* best effort */
    }
    clearToken();
    setUser(null);
    setWorkspace(null);
    navigate('/login', { replace: true });
  }, [navigate]);

  const updateUser = useCallback((u: User) => setUser(u), []);

  const value = useMemo<AuthApi>(
    () => ({ user, workspace, initializing, login, register, logout, updateUser }),
    [user, workspace, initializing, login, register, logout, updateUser],
  );

  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthApi {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// ================= Project context (provided by App's ProjectProvider) =================

export interface ProjectCtx {
  projectId: string;
  project: Project | null;
  loading: boolean;
  error: ApiError | null;
  reload: () => void;
  setProject: (p: Project) => void;
}

export const ProjectContext = createContext<ProjectCtx | null>(null);

/** Project context, or null outside project routes. */
export function useProject(): ProjectCtx | null {
  return useContext(ProjectContext);
}

export function useProjectRequired(): ProjectCtx {
  const ctx = useContext(ProjectContext);
  if (!ctx) throw new Error('useProjectRequired must be used within a project route');
  return ctx;
}

// ================= Click outside =================

/** Returns a ref; calls `onOutside` on mousedown outside the referenced element. */
export function useClickOutside<T extends HTMLElement>(onOutside: () => void, active = true): RefObject<T> {
  const ref = useRef<T>(null);
  const cbRef = useRef(onOutside);
  cbRef.current = onOutside;
  useEffect(() => {
    if (!active) return;
    const handler = (e: MouseEvent) => {
      if (ref.current && e.target instanceof Node && !ref.current.contains(e.target)) {
        cbRef.current();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [active]);
  return ref;
}

// ================= Formatters =================

export function titleCase(value: string): string {
  return value
    .split(/[\s_]+/)
    .map((word) => (word ? word[0]!.toUpperCase() + word.slice(1) : word))
    .join(' ');
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
    hour: '2-digit',
    minute: '2-digit',
  });
}

export function formatDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  const now = new Date();
  const sameYear = d.getFullYear() === now.getFullYear();
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    ...(sameYear ? {} : { year: 'numeric' }),
  });
}

export function formatRelative(iso: string | null | undefined): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const diff = Date.now() - then;
  const future = diff < 0;
  const abs = Math.abs(diff);
  const suffix = future ? 'from now' : 'ago';

  const minute = 60_000;
  const hour = 60 * minute;
  const day = 24 * hour;
  const week = 7 * day;

  if (abs < 45_000) return 'just now';
  if (abs < hour) return `${Math.round(abs / minute)}m ${suffix}`;
  if (abs < day) return `${Math.round(abs / hour)}h ${suffix}`;
  if (abs < week) return `${Math.round(abs / day)}d ${suffix}`;
  if (abs < 5 * week) return `${Math.round(abs / week)}w ${suffix}`;
  return formatDate(iso);
}

/** True when `dueDate` (YYYY-MM-DD or ISO timestamp) falls before today; done/cancelled items are never overdue. */
export function isOverdue(dueDate: string | null | undefined, status?: string): boolean {
  if (!dueDate) return false;
  if (status === 'done' || status === 'cancelled') return false;
  const parts = dueDate.slice(0, 10).split('-');
  if (parts.length !== 3) return false;
  const y = Number(parts[0]);
  const m = Number(parts[1]);
  const d = Number(parts[2]);
  if (!Number.isFinite(y) || !Number.isFinite(m) || !Number.isFinite(d)) return false;
  const now = new Date();
  const due = new Date(y, m - 1, d).getTime();
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return due < startOfToday;
}

/** First letters of the first two words of `name`, uppercased; "?" when empty. */
export function initialsOf(name: string | null | undefined): string {
  const words = (name ?? '').trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  return words
    .slice(0, 2)
    .map((w) => w[0]!.toUpperCase())
    .join('');
}

export function formatNumber(value: number): string {
  return value.toLocaleString('en-US');
}

export function formatCompact(value: number): string {
  if (Math.abs(value) >= 1_000_000) return `${(value / 1_000_000).toFixed(value % 1_000_000 === 0 ? 0 : 1)}M`;
  if (Math.abs(value) >= 10_000) return `${Math.round(value / 1000)}k`;
  if (Math.abs(value) >= 1_000) return `${(value / 1000).toFixed(1)}k`;
  return String(value);
}

export function formatDuration(ms: number): string {
  if (ms < 1000) return `${Math.round(ms)}ms`;
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)}s`;
  const min = Math.floor(ms / 60_000);
  const sec = Math.round((ms % 60_000) / 1000);
  return `${min}m ${sec}s`;
}

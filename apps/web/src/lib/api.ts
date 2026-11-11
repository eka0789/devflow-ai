/**
 * API client — single fetch wrapper for the whole app.
 * Adds the Bearer token, unwraps the {data} envelope, and throws
 * a structured ApiError from the {error:{code,message,details}} envelope.
 */
import type { ApiErrorBody } from '@devflow/shared';

export const TOKEN_KEY = 'devflow_token';
export const THEME_KEY = 'devflow_theme';

export class ApiError extends Error {
  status: number;
  code: string;
  details?: unknown;

  constructor(status: number, code: string, message: string, details?: unknown) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

/** Registered by the auth layer; invoked when a 401 UNAUTHENTICATED arrives. */
let unauthorizedHandler: (() => void) | null = null;

export function setUnauthorizedHandler(fn: (() => void) | null): void {
  unauthorizedHandler = fn;
}

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function clearToken(): void {
  localStorage.removeItem(TOKEN_KEY);
}

export interface ApiFetchOptions {
  method?: string;
  body?: unknown;
  signal?: AbortSignal;
}

export async function apiFetch<T>(path: string, opts: ApiFetchOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  const token = getToken();
  if (token) headers.Authorization = `Bearer ${token}`;
  if (opts.body !== undefined) headers['Content-Type'] = 'application/json';

  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: opts.method ?? 'GET',
      headers,
      body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
      signal: opts.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') throw err;
    throw new ApiError(0, 'NETWORK_ERROR', 'Network request failed. Check your connection and try again.');
  }

  let json: unknown = null;
  const text = await res.text();
  if (text) {
    try {
      json = JSON.parse(text);
    } catch {
      json = null;
    }
  }

  if (!res.ok) {
    const errBody = (json as ApiErrorBody | null)?.error;
    const code = errBody?.code ?? 'INTERNAL';
    // a 5xx whose body is not our error envelope means the hop between the
    // browser and the API failed (proxy down, server restarting) — say so
    const message =
      errBody?.message ??
      (res.status >= 500
        ? `Cannot reach the server (HTTP ${res.status}) — it may be restarting. Try again shortly.`
        : `Request failed with status ${res.status}`);
    if (res.status === 401 && code === 'UNAUTHENTICATED') {
      clearToken();
      unauthorizedHandler?.();
    }
    throw new ApiError(res.status, code, message, errBody?.details);
  }

  if (json !== null && typeof json === 'object' && 'data' in (json as Record<string, unknown>)) {
    return (json as { data: T }).data;
  }
  return json as T;
}

/** Convenience verbs. All return the unwrapped `data` payload. */
export const api = {
  get: <T>(path: string, signal?: AbortSignal) => apiFetch<T>(path, { signal }),
  post: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'POST', body }),
  put: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PUT', body }),
  patch: <T>(path: string, body?: unknown) => apiFetch<T>(path, { method: 'PATCH', body }),
  del: <T>(path: string) => apiFetch<T>(path, { method: 'DELETE' }),
};

// ---------- SSE streaming (chat) ----------

export interface StreamHandlers {
  onDelta: (text: string) => void;
  onDone: (data: unknown) => void;
  onError: (e: { code: string; message: string }) => void;
  signal?: AbortSignal;
}

/**
 * POST-based SSE reader. The chat endpoint streams `event:`/`data:` frames
 * separated by blank lines; EventSource cannot POST so we parse manually.
 */
export async function apiStream(path: string, body: unknown, handlers: StreamHandlers): Promise<void> {
  let res: Response;
  try {
    res = await fetch(`/api${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${getToken() ?? ''}`,
      },
      body: JSON.stringify(body),
      signal: handlers.signal,
    });
  } catch (err) {
    if (err instanceof DOMException && err.name === 'AbortError') return;
    handlers.onError({ code: 'NETWORK_ERROR', message: 'Network request failed. Check your connection and try again.' });
    return;
  }

  if (!res.ok || !res.body) {
    let code = 'INTERNAL';
    let message = `Request failed with status ${res.status}`;
    try {
      const text = await res.text();
      const parsed = JSON.parse(text) as ApiErrorBody | null;
      if (parsed?.error) {
        code = parsed.error.code;
        message = parsed.error.message;
      }
    } catch {
      /* keep defaults */
    }
    if (res.status === 401 && code === 'UNAUTHENTICATED') {
      clearToken();
      unauthorizedHandler?.();
    }
    handlers.onError({ code, message });
    return;
  }

  const reader = res.body.getReader();
  const dec = new TextDecoder();
  let buf = '';

  for (;;) {
    let read: ReadableStreamReadResult<Uint8Array>;
    try {
      read = await reader.read();
    } catch {
      if (handlers.signal?.aborted) return; // user pressed stop — not an error
      handlers.onError({ code: 'NETWORK_ERROR', message: 'Stream interrupted. Try sending the message again.' });
      return;
    }
    const { done, value } = read;
    if (done) break;
    buf += dec.decode(value, { stream: true });

    let idx: number;
    while ((idx = buf.indexOf('\n\n')) >= 0) {
      const chunk = buf.slice(0, idx);
      buf = buf.slice(idx + 2);
      const ev = /^event: (.*)$/m.exec(chunk)?.[1];
      const data = /^data: (.*)$/m.exec(chunk)?.[1];
      if (!ev || !data) continue;
      let payload: unknown;
      try {
        payload = JSON.parse(data);
      } catch {
        continue;
      }
      if (ev === 'delta') {
        const text = (payload as { text?: string }).text ?? '';
        handlers.onDelta(text);
      } else if (ev === 'done') {
        handlers.onDone(payload);
      } else if (ev === 'error') {
        const p = payload as { code?: string; message?: string };
        handlers.onError({ code: p.code ?? 'INTERNAL', message: p.message ?? 'Stream error' });
      }
    }
  }
}

// ---------- helpers ----------

export function qs(params: Record<string, string | number | undefined>): string {
  const search = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value !== undefined && value !== '') search.set(key, String(value));
  }
  const s = search.toString();
  return s ? `?${s}` : '';
}

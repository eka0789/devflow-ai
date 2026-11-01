/** Status & priority badges with consistent theming. */
import type { JSX } from 'react';
import { titleCase } from '../lib/hooks';

export function Badge({
  className,
  children,
  dot = false,
  large = false,
  title,
}: {
  className?: string;
  children: React.ReactNode;
  dot?: boolean;
  large?: boolean;
  title?: string;
}): JSX.Element {
  return (
    <span className={`badge ${dot ? 'badge-dot' : ''} ${large ? 'badge-lg' : ''} ${className ?? ''}`} title={title}>
      {children}
    </span>
  );
}

const STATUS_CLASS: Record<string, string> = {
  backlog: 'status-backlog',
  todo: 'status-todo',
  in_progress: 'status-in_progress',
  in_review: 'status-in_review',
  blocked: 'status-blocked',
  done: 'status-done',
  cancelled: 'status-cancelled',
  planned: 'status-planned',
  active: 'status-active',
  completed: 'status-completed',
  queued: 'status-queued',
  running: 'status-running',
  awaiting_review: 'status-awaiting_review',
  succeeded: 'status-succeeded',
  failed: 'status-failed',
};

export function StatusBadge({ status, large, dot }: { status: string; large?: boolean; dot?: boolean }): JSX.Element {
  return (
    <Badge className={STATUS_CLASS[status] ?? 'badge-neutral'} large={large} dot={dot}>
      {titleCase(status)}
    </Badge>
  );
}

export function PriorityBadge({ priority, large }: { priority: string; large?: boolean }): JSX.Element {
  return (
    <Badge className={`priority-${priority}`} large={large}>
      {titleCase(priority)}
    </Badge>
  );
}

export function CiBadge({ ci }: { ci: string }): JSX.Element {
  const map: Record<string, { cls: string; label: string }> = {
    success: { cls: 'badge-success', label: 'CI passed' },
    failure: { cls: 'badge-danger', label: 'CI failed' },
    pending: { cls: 'badge-warning', label: 'CI pending' },
    none: { cls: 'badge-outline', label: 'No CI' },
  };
  const info = map[ci] ?? map.none!;
  return <Badge className={info.cls}>{info.label}</Badge>;
}

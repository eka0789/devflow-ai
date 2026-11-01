/** Small inline chips shared by backlog rows, kanban cards and My Work. */
import type { JSX } from 'react';
import type { LabelAssignment } from '@devflow/shared';
import { formatDate, initialsOf, isOverdue } from '../lib/hooks';
import { IconClock, IconUser } from './icons';

/** Assignee name chip; renders nothing when unassigned. */
export function AssigneeChip({ name }: { name: string | null | undefined }): JSX.Element | null {
  if (!name) return null;
  return (
    <span className="chip" title={`Assigned to ${name}`}>
      <IconUser size={11} />
      {name}
    </span>
  );
}

/** Round initials avatar for kanban cards. */
export function InitialsChip({ name }: { name: string | null | undefined }): JSX.Element | null {
  if (!name) return null;
  return (
    <span className="initials-chip" title={`Assigned to ${name}`} aria-label={`Assigned to ${name}`}>
      {initialsOf(name)}
    </span>
  );
}

/** Due-date chip; red when the date is past and the item is not done. */
export function DueChip({ dueDate, status }: { dueDate: string | null | undefined; status?: string }): JSX.Element | null {
  if (!dueDate) return null;
  const overdue = isOverdue(dueDate, status);
  return (
    <span className={`chip ${overdue ? 'chip-danger' : ''}`} title={overdue ? 'Overdue' : 'Due date'}>
      <IconClock size={11} />
      {formatDate(dueDate)}
    </span>
  );
}

/** Colored dots for the labels attached to a story or task. */
export function LabelDots({ labels }: { labels: LabelAssignment[] }): JSX.Element | null {
  if (labels.length === 0) return null;
  return (
    <span className="label-dots">
      {labels.map((l) => (
        <span key={l.labelId} className="chip-dot" style={{ background: l.color }} title={l.name} />
      ))}
    </span>
  );
}

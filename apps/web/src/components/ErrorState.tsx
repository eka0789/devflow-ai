import type { JSX } from 'react';
import type { ApiError } from '../lib/api';
import { IconAlert } from './icons';

export function ErrorState({
  error,
  onRetry,
  compact,
  title = 'Something went wrong',
}: {
  error: ApiError | null;
  onRetry?: () => void;
  compact?: boolean;
  title?: string;
}): JSX.Element {
  const message = error ? `${error.code === 'NETWORK_ERROR' ? '' : `${error.code}: `}${error.message}` : 'Unknown error';
  return (
    <div className={`error-state ${compact ? 'compact' : ''}`} role="alert">
      <div className="error-icon">
        <IconAlert size={18} />
      </div>
      <div className="empty-title">{title}</div>
      <div className="error-desc">{message}</div>
      {onRetry ? (
        <button className="btn" onClick={onRetry}>
          Retry
        </button>
      ) : null}
    </div>
  );
}

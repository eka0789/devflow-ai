/** Shimmering skeleton placeholders. */
import type { CSSProperties, JSX } from 'react';

export function Skeleton({
  width,
  height = 14,
  style,
  className,
}: {
  width?: number | string;
  height?: number | string;
  style?: CSSProperties;
  className?: string;
}): JSX.Element {
  return (
    <div
      className={`skeleton ${className ?? ''}`}
      style={{ width: width ?? '100%', height, ...style }}
      aria-hidden="true"
    />
  );
}

export function SkeletonText({ lines = 3, width }: { lines?: number; width?: number | string }): JSX.Element {
  return (
    <div style={{ width: width ?? '100%' }}>
      {Array.from({ length: lines }, (_, i) => (
        <Skeleton key={i} className="skeleton-text" width={i === lines - 1 ? '60%' : '100%'} />
      ))}
    </div>
  );
}

export function SkeletonCard({ height = 90 }: { height?: number }): JSX.Element {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 10, height }}>
      <Skeleton width="40%" height={11} />
      <Skeleton width="70%" height={22} />
      <Skeleton width="55%" height={11} />
    </div>
  );
}

export function SkeletonStats({ count = 4 }: { count?: number }): JSX.Element {
  return (
    <div className="grid grid-4">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} height={86} />
      ))}
    </div>
  );
}

export function SkeletonRows({ rows = 5 }: { rows?: number }): JSX.Element {
  return (
    <div className="card" style={{ display: 'flex', flexDirection: 'column', gap: 0 }}>
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="row gap-3" style={{ padding: '11px 2px', borderBottom: '1px solid var(--border-soft)' }}>
          <Skeleton width={10} height={10} style={{ borderRadius: 999 }} />
          <Skeleton width={`${30 + ((i * 17) % 45)}%`} height={13} />
          <div className="spacer" />
          <Skeleton width={56} height={20} style={{ borderRadius: 999 }} />
        </div>
      ))}
    </div>
  );
}

export function PageLoader({ label = 'Loading' }: { label?: string }): JSX.Element {
  return (
    <div className="loading-center" role="status">
      <div className="spinner spinner-lg" />
      <span className="muted">{label}…</span>
    </div>
  );
}

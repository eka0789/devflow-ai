/** Roadmap — lightweight SVG Gantt of epics and sprints for the current project. */
import { useMemo, type JSX } from 'react';
import type { Roadmap, RoadmapItem } from '@devflow/shared';
import { api } from '../lib/api';
import { formatDate, titleCase, useApi, useProjectRequired } from '../lib/hooks';
import { EmptyState } from '../components/EmptyState';
import { ErrorState } from '../components/ErrorState';
import { Skeleton } from '../components/Skeleton';
import { IconSprint } from '../components/icons';

const AXIS_H = 28; // top band with month labels
const ROW_H = 40; // height of one roadmap row
const BAR_H = 18;
const DAY_MS = 86_400_000;

function sortRows(items: RoadmapItem[]): RoadmapItem[] {
  const byStart = (a: RoadmapItem, b: RoadmapItem): number => a.start.localeCompare(b.start);
  return [...items.filter((i) => i.kind === 'epic').sort(byStart), ...items.filter((i) => i.kind === 'sprint').sort(byStart)];
}

export function RoadmapPage(): JSX.Element {
  const ctx = useProjectRequired();
  const projectId = ctx.projectId;
  const { data, loading, error, reload } = useApi<Roadmap>(() => api.get<Roadmap>(`/projects/${projectId}/roadmap`), [projectId]);

  const rows = useMemo(() => sortRows(data?.items ?? []), [data]);

  // Time window: minDate→maxDate from the API. A real range is padded so
  // single-day items stay visible; only a missing/unusable range falls back.
  const { t0, t1 } = useMemo(() => {
    const min = Date.parse(data?.minDate ?? '');
    const max = Date.parse(data?.maxDate ?? '');
    if (Number.isFinite(min) && Number.isFinite(max)) {
      const span = max - min;
      const pad = span < 14 * DAY_MS ? 7 * DAY_MS : 0; // keep 1-day epics visible
      return { t0: min - pad, t1: Math.max(max, min) + pad };
    }
    const now = Date.now();
    return { t0: now - 30 * DAY_MS, t1: now + 30 * DAY_MS };
  }, [data]);

  const pctOf = (ms: number): number => Math.min(100, Math.max(0, ((ms - t0) / (t1 - t0)) * 100));

  // First-of-month boundaries inside the window → gridlines + labels.
  const ticks = useMemo(() => {
    const out: Array<{ pct: number; label: string }> = [];
    const cursor = new Date(t0);
    cursor.setDate(1);
    cursor.setHours(0, 0, 0, 0);
    cursor.setMonth(cursor.getMonth() + 1);
    while (cursor.getTime() <= t1) {
      out.push({
        pct: pctOf(cursor.getTime()),
        label: cursor.toLocaleDateString(undefined, { month: 'short' }) + (cursor.getMonth() === 0 ? ` ${cursor.getFullYear()}` : ''),
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [t0, t1]);

  const todayPct = pctOf(Date.now());
  const totalHeight = AXIS_H + rows.length * ROW_H + 8;

  if (loading && !data)
    return (
      <div className="page" style={{ maxWidth: 'none' }}>
        <Skeleton height={40} style={{ marginBottom: 16 }} />
        <Skeleton height={320} style={{ borderRadius: 10 }} />
      </div>
    );

  if (error)
    return (
      <div className="page">
        <ErrorState error={error} onRetry={reload} title="Failed to load roadmap" />
      </div>
    );

  return (
    <div className="page" style={{ maxWidth: 'none' }}>
      <div className="page-header">
        <div>
          <div className="page-title">Roadmap</div>
          <div className="page-sub">
            Epics and sprints on a timeline
            {data && data.items.length > 0
              ? data.minDate === data.maxDate
                ? ` · ${formatDate(data.minDate)}`
                : ` · ${formatDate(data.minDate)} → ${formatDate(data.maxDate)}`
              : ''}
          </div>
        </div>
      </div>

      {rows.length === 0 ? (
        <EmptyState
          icon={<IconSprint size={18} />}
          title="No epics or sprints yet"
          description="Create epics and stories in the backlog, or plan sprints, and they will appear here on a timeline."
        />
      ) : (
        <div className="gantt">
          <div className="gantt-labels">
            {rows.map((item) => (
              <div key={item.id} className="gantt-label" title={`${item.title} · ${titleCase(item.status)}`}>
                <span
                  className={item.kind === 'epic' ? 'epic-dot' : 'chip-dot'}
                  style={{ background: item.kind === 'epic' ? 'var(--accent)' : 'var(--info)' }}
                />
                <span className="truncate">{item.title}</span>
              </div>
            ))}
          </div>
          <div className="gantt-chart">
            <svg width="100%" height={totalHeight} role="img" aria-label="Roadmap timeline">
              {/* month gridlines + labels */}
              {ticks.map((t, i) => (
                <line key={i} className="gantt-gridline" x1={`${t.pct}%`} x2={`${t.pct}%`} y1={AXIS_H} y2={totalHeight - 8} />
              ))}
              {ticks.map((t, i) => (
                <text
                  key={i}
                  className="gantt-axis-label"
                  x={`${Math.min(96, Math.max(4, t.pct))}%`}
                  y={17}
                  textAnchor="middle"
                >
                  {t.label}
                </text>
              ))}
              {/* row separators */}
              {rows.map((item, i) => (
                <line
                  key={item.id}
                  className="gantt-rowline"
                  x1="0"
                  x2="100%"
                  y1={AXIS_H + (i + 1) * ROW_H}
                  y2={AXIS_H + (i + 1) * ROW_H}
                />
              ))}
              {/* today marker */}
              <line className="gantt-today" x1={`${todayPct}%`} x2={`${todayPct}%`} y1={AXIS_H - 6} y2={totalHeight - 8} />
              <text
                className="gantt-today-label"
                x={`${Math.min(97, Math.max(3, todayPct))}%`}
                y={16}
                textAnchor={todayPct > 88 ? 'end' : todayPct < 12 ? 'start' : 'middle'}
              >
                Today
              </text>
              {/* bars */}
              {rows.map((item, i) => {
                const s = Date.parse(item.start);
                const e = Date.parse(item.end);
                if (!Number.isFinite(s) || !Number.isFinite(e)) return null;
                const left = pctOf(s);
                const width = Math.max(1.2, Math.min(100 - left, pctOf(e) - left));
                const y = AXIS_H + i * ROW_H + (ROW_H - BAR_H) / 2;
                const progress = item.totalPoints > 0 ? Math.min(1, item.donePoints / item.totalPoints) : 0;
                const tooltip = `${item.title} — ${titleCase(item.status)} · ${item.donePoints}/${item.totalPoints} pts · ${formatDate(item.start)} → ${formatDate(item.end)}`;
                return (
                  <g key={item.id}>
                    <title>{tooltip}</title>
                    <rect
                      x={`${left}%`}
                      y={y}
                      width={`${width}%`}
                      height={BAR_H}
                      rx={4}
                      fill={item.kind === 'epic' ? 'var(--accent)' : 'var(--info)'}
                    />
                    {item.kind === 'epic' && progress > 0 ? (
                      <rect
                        x={`${left}%`}
                        y={y}
                        width={`${width * progress}%`}
                        height={BAR_H}
                        rx={4}
                        fill="rgba(255, 255, 255, 0.42)"
                      />
                    ) : null}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}
    </div>
  );
}

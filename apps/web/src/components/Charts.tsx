/**
 * Hand-rolled SVG charts: BarChart (1-2 series), LineChart (with optional
 * ideal line), Donut. Responsive width via ResizeObserver.
 */
import { useEffect, useRef, useState, type JSX } from 'react';

function useContainerWidth<T extends HTMLElement>(): [React.RefObject<T | null>, number] {
  const ref = useRef<T | null>(null);
  const [width, setWidth] = useState(0);
  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      setWidth(Math.round(w));
    });
    ro.observe(el);
    setWidth(Math.round(el.getBoundingClientRect().width));
    return () => ro.disconnect();
  }, []);
  return [ref, width];
}

function niceMax(value: number): number {
  if (value <= 0) return 1;
  const exp = Math.floor(Math.log10(value));
  const base = Math.pow(10, exp);
  const scaled = value / base;
  let nice: number;
  if (scaled <= 1) nice = 1;
  else if (scaled <= 2) nice = 2;
  else if (scaled <= 5) nice = 5;
  else nice = 10;
  return nice * base;
}

function ticksFor(max: number): number[] {
  return [0, 0.25, 0.5, 0.75, 1].map((f) => max * f);
}

export interface BarDatum {
  label: string;
  value: number;
  value2?: number;
}

const PALETTE = {
  accent: 'var(--accent)',
  success: 'var(--success)',
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
};

export type ChartColor = keyof typeof PALETTE;

export function BarChart({
  data,
  height = 200,
  color = 'accent',
  color2 = 'success',
  series1Label,
  series2Label,
  formatValue = (v) => String(v),
  maxWidth,
}: {
  data: BarDatum[];
  height?: number;
  color?: ChartColor;
  color2?: ChartColor;
  series1Label?: string;
  series2Label?: string;
  formatValue?: (v: number) => string;
  maxWidth?: number;
}): JSX.Element {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const w = maxWidth ? Math.min(width, maxWidth) : width;
  const pad = { top: 18, right: 8, bottom: 26, left: 40 };
  const innerW = Math.max(10, w - pad.left - pad.right);
  const innerH = Math.max(10, height - pad.top - pad.bottom);
  const hasSecond = data.some((d) => d.value2 !== undefined);
  const max = niceMax(Math.max(1, ...data.map((d) => Math.max(d.value, d.value2 ?? 0))));
  const ticks = ticksFor(max);
  const slot = data.length > 0 ? innerW / data.length : innerW;
  const barW = hasSecond ? Math.min(20, slot / 2.8) : Math.min(34, slot * 0.6);

  const labelEvery = Math.max(1, Math.ceil(data.length / Math.max(2, Math.floor(innerW / 64))));

  if (data.length === 0) return <div className="chart-empty">No data yet</div>;

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label="Bar chart">
          {ticks.map((t, i) => {
            const y = pad.top + innerH - (t / max) * innerH;
            return (
              <g key={i}>
                <line x1={pad.left} x2={pad.left + innerW} y1={y} y2={y} stroke="var(--border-soft)" strokeWidth={1} />
                <text x={pad.left - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--text-faint)">
                  {formatValue(t)}
                </text>
              </g>
            );
          })}
          {data.map((d, i) => {
            const cx = pad.left + slot * i + slot / 2;
            const h1 = (d.value / max) * innerH;
            const x1 = hasSecond ? cx - barW - 1.5 : cx - barW / 2;
            const h2 = ((d.value2 ?? 0) / max) * innerH;
            const x2 = cx + 1.5;
            return (
              <g key={i}>
                <rect
                  x={x1}
                  y={pad.top + innerH - h1}
                  width={barW}
                  height={Math.max(0, h1)}
                  rx={3}
                  fill={PALETTE[color]}
                  opacity={0.92}
                >
                  <title>{`${d.label}: ${formatValue(d.value)}`}</title>
                </rect>
                {hasSecond ? (
                  <rect
                    x={x2}
                    y={pad.top + innerH - h2}
                    width={barW}
                    height={Math.max(0, h2)}
                    rx={3}
                    fill={PALETTE[color2]}
                    opacity={0.92}
                  >
                    <title>{`${d.label}: ${formatValue(d.value2 ?? 0)}`}</title>
                  </rect>
                ) : null}
                {i % labelEvery === 0 ? (
                  <text
                    x={cx}
                    y={height - 8}
                    textAnchor="middle"
                    fontSize={10}
                    fill="var(--text-faint)"
                  >
                    {d.label.length > 12 ? `${d.label.slice(0, 11)}…` : d.label}
                  </text>
                ) : null}
              </g>
            );
          })}
        </svg>
      )}
      {hasSecond && (series1Label || series2Label) ? (
        <div className="chart-legend">
          {series1Label ? (
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: PALETTE[color] }} />
              {series1Label}
            </span>
          ) : null}
          {series2Label ? (
            <span className="legend-item">
              <span className="legend-swatch" style={{ background: PALETTE[color2] }} />
              {series2Label}
            </span>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

export function LineChart({
  points,
  ideal,
  height = 220,
  color = 'accent',
  formatValue = (v) => String(Math.round(v)),
}: {
  points: Array<{ label: string; value: number }>;
  /** Optional ideal/baseline series aligned index-wise with `points`. */
  ideal?: number[];
  height?: number;
  color?: ChartColor;
  formatValue?: (v: number) => string;
}): JSX.Element {
  const [ref, width] = useContainerWidth<HTMLDivElement>();
  const w = width;
  const pad = { top: 16, right: 12, bottom: 26, left: 44 };
  const innerW = Math.max(10, w - pad.left - pad.right);
  const innerH = Math.max(10, height - pad.top - pad.bottom);
  const max = niceMax(Math.max(1, ...points.map((p) => p.value), ...(ideal ?? [0])));
  const ticks = ticksFor(max);

  const xFor = (i: number): number =>
    points.length <= 1 ? pad.left + innerW / 2 : pad.left + (innerW * i) / (points.length - 1);
  const yFor = (v: number): number => pad.top + innerH - (v / max) * innerH;

  const path = points.map((p, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(p.value)}`).join(' ');
  const area = `${path} L${xFor(points.length - 1)},${pad.top + innerH} L${xFor(0)},${pad.top + innerH} Z`;
  const idealPath = ideal
    ? ideal.map((v, i) => `${i === 0 ? 'M' : 'L'}${xFor(i)},${yFor(v)}`).join(' ')
    : '';
  const labelEvery = Math.max(1, Math.ceil(points.length / Math.max(2, Math.floor(innerW / 60))));

  if (points.length === 0) return <div className="chart-empty">No data yet</div>;

  return (
    <div ref={ref} style={{ width: '100%' }}>
      {w > 0 && (
        <svg width={w} height={height} role="img" aria-label="Line chart">
          <defs>
            <linearGradient id="lineAreaFill" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor={PALETTE[color]} stopOpacity={0.22} />
              <stop offset="100%" stopColor={PALETTE[color]} stopOpacity={0} />
            </linearGradient>
          </defs>
          {ticks.map((t, i) => {
            const y = yFor(t);
            return (
              <g key={i}>
                <line x1={pad.left} x2={pad.left + innerW} y1={y} y2={y} stroke="var(--border-soft)" />
                <text x={pad.left - 6} y={y + 3.5} textAnchor="end" fontSize={10} fill="var(--text-faint)">
                  {formatValue(t)}
                </text>
              </g>
            );
          })}
          {ideal ? <path d={idealPath} fill="none" stroke="var(--text-faint)" strokeWidth={1.5} strokeDasharray="5 4" /> : null}
          <path d={area} fill="url(#lineAreaFill)" />
          <path d={path} fill="none" stroke={PALETTE[color]} strokeWidth={2} strokeLinejoin="round" strokeLinecap="round" />
          {points.map((p, i) => (
            <g key={i}>
              <circle cx={xFor(i)} cy={yFor(p.value)} r={3} fill={PALETTE[color]}>
                <title>{`${p.label}: ${formatValue(p.value)}`}</title>
              </circle>
              {i % labelEvery === 0 ? (
                <text x={xFor(i)} y={height - 8} textAnchor="middle" fontSize={10} fill="var(--text-faint)">
                  {p.label.length > 12 ? `${p.label.slice(0, 11)}…` : p.label}
                </text>
              ) : null}
            </g>
          ))}
        </svg>
      )}
      {ideal ? (
        <div className="chart-legend">
          <span className="legend-item">
            <span className="legend-swatch" style={{ background: PALETTE[color] }} />
            Remaining
          </span>
          <span className="legend-item">
            <span className="legend-swatch" style={{ background: 'var(--text-faint)' }} />
            Ideal
          </span>
        </div>
      ) : null}
    </div>
  );
}

export interface DonutSegment {
  label: string;
  value: number;
  color: ChartColor | string;
}

export function Donut({
  segments,
  size = 150,
  thickness = 16,
  centerLabel,
  centerSub,
}: {
  segments: DonutSegment[];
  size?: number;
  thickness?: number;
  centerLabel?: string;
  centerSub?: string;
}): JSX.Element {
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const r = (size - thickness) / 2;
  const c = 2 * Math.PI * r;
  let offset = 0;

  return (
    <div className="row gap-5 wrap">
      <svg width={size} height={size} role="img" aria-label="Donut chart" style={{ flexShrink: 0 }}>
        <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="var(--border-soft)" strokeWidth={thickness} />
        {total > 0 &&
          segments.map((seg, i) => {
            const frac = seg.value / total;
            const dash = frac * c;
            const el = (
              <circle
                key={i}
                cx={size / 2}
                cy={size / 2}
                r={r}
                fill="none"
                stroke={seg.color.startsWith('--') ? `var(${seg.color})` : seg.color}
                strokeWidth={thickness}
                strokeDasharray={`${dash} ${c - dash}`}
                strokeDashoffset={-offset}
                transform={`rotate(-90 ${size / 2} ${size / 2})`}
                strokeLinecap="butt"
              >
                <title>{`${seg.label}: ${seg.value}`}</title>
              </circle>
            );
            offset += dash;
            return el;
          })}
        {centerLabel ? (
          <text
            x={size / 2}
            y={centerSub ? size / 2 - 2 : size / 2 + 5}
            textAnchor="middle"
            fontSize={22}
            fontWeight={650}
            fill="var(--text)"
          >
            {centerLabel}
          </text>
        ) : null}
        {centerSub ? (
          <text x={size / 2} y={size / 2 + 18} textAnchor="middle" fontSize={10} fill="var(--text-faint)">
            {centerSub}
          </text>
        ) : null}
      </svg>
      <div className="stack gap-2" style={{ minWidth: 140 }}>
        {segments.map((seg, i) => (
          <div key={i} className="row gap-2" style={{ fontSize: 12.5 }}>
            <span
              className="legend-swatch"
              style={{ background: seg.color.startsWith('--') ? `var(${seg.color})` : seg.color }}
            />
            <span className="muted flex-1">{seg.label}</span>
            <span className="weight-600 tabular">{seg.value.toLocaleString('en-US')}</span>
            {total > 0 ? <span className="faint tabular" style={{ width: 42, textAlign: 'right' }}>{Math.round((seg.value / total) * 100)}%</span> : null}
          </div>
        ))}
      </div>
    </div>
  );
}

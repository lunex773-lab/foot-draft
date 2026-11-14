import { useId, useState, type ReactNode } from 'react';

/**
 * Small chart kit for the admin site (dark surface only).
 * Colors: validated dark steps of the reference palette (slot 1 blue, slot 2
 * orange) and the blue sequential ramp for heat cells. Text never wears the
 * series color; every chart has a hover / focus tooltip and a table view.
 */
export const SERIES = ['#3987e5', '#d95926'] as const;
const SEQ = ['#104281', '#184f95', '#1c5cab', '#256abf', '#2a78d6', '#3987e5', '#5598e7', '#6da7ec', '#86b6ef', '#9ec5f4'];

export const fmtInt = (n: number) => n.toLocaleString('ja-JP');
export const fmtCompact = (n: number) => (Math.abs(n) >= 10_000 ? `${(n / 1000).toLocaleString('ja-JP', { maximumFractionDigits: 1 })}K` : fmtInt(n));
export const fmtPct = (r: number | null | undefined, digits = 1) => (r === null || r === undefined ? '—' : `${(r * 100).toFixed(digits)}%`);
export const fmtDuration = (ms: number | null | undefined) => {
  if (ms === null || ms === undefined) return '—';
  const m = Math.round(ms / 60000);
  return m >= 60 ? `${Math.floor(m / 60)}時間${m % 60}分` : `${m}分`;
};

/** clean axis maximum and ticks */
function niceTicks(max: number, count = 4): number[] {
  if (max <= 0) return [0, 1];
  const raw = max / count;
  const mag = 10 ** Math.floor(Math.log10(raw));
  const step = [1, 2, 2.5, 5, 10].map((m) => m * mag).find((s) => s >= raw) ?? raw;
  const top = Math.ceil(max / step) * step;
  const out: number[] = [];
  for (let v = 0; v <= top + step / 2; v += step) out.push(Math.round(v * 1000) / 1000);
  return out;
}

export interface Point {
  label: string;
  value: number;
}

/** single-series column chart (the title names the series, so no legend box) */
export function ColumnChart({ title, data, format = fmtInt, height = 180, note }: { title: string; data: Point[]; format?: (n: number) => string; height?: number; note?: ReactNode }) {
  const id = useId();
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  const W = 640;
  const pad = { l: 44, r: 8, t: 10, b: 26 };
  const ticks = niceTicks(Math.max(0, ...data.map((d) => d.value)));
  const top = ticks[ticks.length - 1] || 1;
  const band = (W - pad.l - pad.r) / Math.max(1, data.length);
  const bw = Math.min(24, Math.max(4, band - 4));
  const y = (v: number) => pad.t + (height - pad.t - pad.b) * (1 - v / top);
  const every = Math.ceil(data.length / 8);
  const hp = hover !== null ? data[hover] : null;
  return (
    <figure className="chart" aria-labelledby={`${id}-t`}>
      <div className="spread">
        <figcaption id={`${id}-t`} className="chart-title">
          {title}
        </figcaption>
        <button type="button" className="link-btn tiny" onClick={() => setTable((t) => !t)}>
          {table ? 'グラフで見る' : '表で見る'}
        </button>
      </div>
      {table ? (
        <div className="scroll-x" style={{ maxHeight: height + 40 }}>
          <table className="tbl tiny">
            <tbody>
              {data.map((d) => (
                <tr key={d.label}>
                  <td>{d.label}</td>
                  <td className="num">{format(d.value)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <div className="chart-box">
          <svg viewBox={`0 0 ${W} ${height}`} width="100%" role="img" aria-label={title} onMouseLeave={() => setHover(null)}>
            {ticks.map((t) => (
              <g key={t}>
                <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="#262b38" strokeWidth={1} />
                <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" className="axis">
                  {fmtCompact(t)}
                </text>
              </g>
            ))}
            {data.map((d, i) => {
              const x = pad.l + band * i + (band - bw) / 2;
              const h = Math.max(0, y(0) - y(d.value));
              const r = Math.min(4, h);
              const path =
                h > 0
                  ? `M${x},${y(0)} L${x},${y(d.value) + r} Q${x},${y(d.value)} ${x + r},${y(d.value)} L${x + bw - r},${y(d.value)} Q${x + bw},${y(d.value)} ${x + bw},${y(d.value) + r} L${x + bw},${y(0)} Z`
                  : '';
              return (
                <g key={d.label}>
                  {path && <path d={path} fill={SERIES[0]} opacity={hover === null || hover === i ? 1 : 0.55} />}
                  {/* hit target: the whole band, bigger than the mark */}
                  <rect
                    x={pad.l + band * i}
                    y={pad.t}
                    width={band}
                    height={height - pad.t - pad.b}
                    fill="transparent"
                    tabIndex={0}
                    aria-label={`${d.label} ${format(d.value)}`}
                    onMouseEnter={() => setHover(i)}
                    onFocus={() => setHover(i)}
                    onBlur={() => setHover(null)}
                  />
                  {i % every === 0 && (
                    <text x={pad.l + band * i + band / 2} y={height - 8} textAnchor="middle" className="axis">
                      {d.label.slice(5)}
                    </text>
                  )}
                </g>
              );
            })}
            <line x1={pad.l} x2={W - pad.r} y1={y(0)} y2={y(0)} stroke="#3a4152" strokeWidth={1} />
          </svg>
          {hp && hover !== null && (
            <div className="tip" style={{ left: `${((pad.l + band * hover + band / 2) / W) * 100}%` }}>
              <b>{format(hp.value)}</b>
              <span>{hp.label}</span>
            </div>
          )}
        </div>
      )}
      {note && <div className="tiny muted">{note}</div>}
    </figure>
  );
}

/** horizontal bars for a ranking (single hue: magnitude) */
export function BarList({ title, data, format = fmtInt }: { title: string; data: Point[]; format?: (n: number) => string }) {
  const max = Math.max(1, ...data.map((d) => d.value));
  return (
    <figure className="chart">
      <figcaption className="chart-title">{title}</figcaption>
      {data.length === 0 && <div className="small muted">データがありません</div>}
      <div className="barlist">
        {data.map((d) => (
          <div key={d.label} className="barlist-row" tabIndex={0} title={`${d.label}：${format(d.value)}`}>
            <span className="barlist-label">{d.label}</span>
            <span className="barlist-track">
              <span className="barlist-bar" style={{ width: `${(d.value / max) * 100}%`, background: SERIES[0] }} />
            </span>
            <span className="barlist-value">{format(d.value)}</span>
          </div>
        ))}
      </div>
    </figure>
  );
}

/** heat cell for retention (sequential blue; text white or near-black by the fill) */
export function HeatCell({ rate, count }: { rate: number | null; count?: number | null }) {
  if (rate === null) return <td className="heat empty">—</td>;
  const i = Math.min(SEQ.length - 1, Math.floor(rate * SEQ.length));
  const fill = SEQ[i];
  return (
    <td className="heat" style={{ background: fill, color: i >= 7 ? '#0b0d12' : '#ffffff' }} title={count !== undefined && count !== null ? `${count}人` : undefined}>
      {fmtPct(rate, 0)}
    </td>
  );
}

/**
 * stat tile: label, value, change vs the previous period. `upIsGood` sets the
 * direction meaning; the arrow and the sign carry it, color only supports it.
 */
export function StatTile({ label, value, prev, format = fmtInt, upIsGood = true, sub }: { label: string; value: number | null; prev?: number | null; format?: (n: number) => string; upIsGood?: boolean; sub?: ReactNode }) {
  let delta: ReactNode = null;
  if (value !== null && prev !== undefined && prev !== null) {
    const d = value - prev;
    const good = d === 0 ? null : d > 0 === upIsGood;
    delta = (
      <span className={`delta ${good === null ? '' : good ? 'up' : 'down'}`}>
        {d > 0 ? '▲' : d < 0 ? '▼' : '±'} {format(Math.abs(d))} <span className="muted">前の期間 {format(prev)}</span>
      </span>
    );
  }
  return (
    <div className="stat-tile">
      <div className="label">{label}</div>
      <div className="value">{value === null ? '—' : format(value)}</div>
      {delta}
      {sub && <div className="tiny muted">{sub}</div>}
    </div>
  );
}

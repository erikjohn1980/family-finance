import { formatCents } from "@/lib/money";

export const SERIES = ["var(--series-1)", "var(--series-2)", "var(--series-3)", "var(--series-4)", "var(--series-5)", "var(--series-6)"];

export type PieDatum = { label: string; cents: number };

/** Donut chart with an accessible legend/table. Negative or zero slices are omitted. */
export function Pie({ data, title }: { data: PieDatum[]; title: string }) {
  const pos = data.filter((d) => d.cents > 0);
  const top = pos.slice(0, 5);
  const rest = pos.slice(5).reduce((s, d) => s + d.cents, 0);
  const slices = rest > 0 ? [...top, { label: "Other", cents: rest }] : top;
  const total = slices.reduce((s, d) => s + d.cents, 0);
  const r = 60;
  const c = 2 * Math.PI * r;
  let acc = 0;
  return (
    <div className="pie-wrap">
      <svg className="chart" viewBox="0 0 160 160" role="img" aria-label={`${title}: ${slices.map((s) => `${s.label} ${formatCents(s.cents, { whole: true })}`).join(", ")}`} style={{ maxWidth: 160 }}>
        <circle cx="80" cy="80" r={r} fill="none" stroke="var(--elevated-2)" strokeWidth="22" />
        {total > 0 &&
          slices.map((s, i) => {
            const len = (s.cents / total) * c;
            const el = (
              <circle
                key={s.label}
                cx="80"
                cy="80"
                r={r}
                fill="none"
                stroke={SERIES[i % SERIES.length]}
                strokeWidth="22"
                strokeDasharray={`${Math.max(0, len - 2)} ${c}`}
                strokeDashoffset={-acc}
                transform="rotate(-90 80 80)"
              />
            );
            acc += len;
            return el;
          })}
        <text x="80" y="76" textAnchor="middle" fill="var(--muted)" fontSize="11">
          Total
        </text>
        <text x="80" y="94" textAnchor="middle" fill="var(--text)" fontSize="15" fontWeight="700">
          {formatCents(total, { whole: true })}
        </text>
      </svg>
      <ul className="legend" style={{ listStyle: "none", margin: 0, padding: 0 }}>
        {slices.map((s, i) => (
          <li key={s.label} className="legend-item">
            <span className="dot" style={{ background: SERIES[i % SERIES.length] }} />
            <span className="cell-main">{s.label}</span>
            <span className="muted num">{total ? Math.round((s.cents / total) * 100) : 0}%</span>
            <span className="num">{formatCents(s.cents, { whole: true })}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

export type BarSeries = { label: string; color: string; values: number[] };

/** Grouped bar chart (cents). Supports negative values (e.g. net). */
export function Bars({ labels, series, title }: { labels: string[]; series: BarSeries[]; title: string }) {
  const W = 640;
  const H = 220;
  const pad = { l: 56, r: 8, t: 10, b: 28 };
  const all = series.flatMap((s) => s.values);
  const max = Math.max(0, ...all);
  const min = Math.min(0, ...all);
  const span = max - min || 1;
  const y = (v: number) => pad.t + ((max - v) / span) * (H - pad.t - pad.b);
  const groupW = (W - pad.l - pad.r) / Math.max(1, labels.length);
  const barW = Math.max(3, Math.min(22, (groupW - 8) / series.length));
  const ticks = [max, (max + min) / 2, min].filter((v, i, a) => a.indexOf(v) === i);
  return (
    <figure style={{ margin: 0 }}>
      <svg className="chart" viewBox={`0 0 ${W} ${H}`} role="img" aria-label={title}>
        {ticks.map((t) => (
          <g key={t}>
            <line x1={pad.l} x2={W - pad.r} y1={y(t)} y2={y(t)} stroke="var(--border)" strokeDasharray={t === 0 ? undefined : "3 4"} />
            <text x={pad.l - 6} y={y(t) + 4} textAnchor="end" fontSize="10" fill="var(--muted)">
              {formatCents(Math.round(t), { whole: true })}
            </text>
          </g>
        ))}
        {labels.map((lab, gi) => (
          <g key={lab}>
            {series.map((s, si) => {
              const v = s.values[gi] ?? 0;
              const x = pad.l + gi * groupW + (groupW - barW * series.length) / 2 + si * barW;
              return (
                <rect key={s.label} x={x} width={barW - 2} y={Math.min(y(v), y(0))} height={Math.max(1, Math.abs(y(v) - y(0)))} rx="2" fill={s.color}>
                  <title>{`${s.label} ${lab}: ${formatCents(v)}`}</title>
                </rect>
              );
            })}
            <text x={pad.l + gi * groupW + groupW / 2} y={H - 8} textAnchor="middle" fontSize="10" fill="var(--muted)">
              {lab}
            </text>
          </g>
        ))}
      </svg>
      <figcaption className="form-actions small" style={{ marginTop: 8 }}>
        {series.map((s) => (
          <span key={s.label} style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span className="dot" style={{ background: s.color }} />
            {s.label}
          </span>
        ))}
      </figcaption>
      <table className="sr-only">
        <caption>{title}</caption>
        <thead>
          <tr>
            <th>Month</th>
            {series.map((s) => (
              <th key={s.label}>{s.label}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {labels.map((l, i) => (
            <tr key={l}>
              <td>{l}</td>
              {series.map((s) => (
                <td key={s.label}>{formatCents(s.values[i] ?? 0)}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </figure>
  );
}

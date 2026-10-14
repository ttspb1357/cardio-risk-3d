// Dependency-free charts for the Validation page. One mark spec: 2px lines, >= 8px points, hairline grid,
// a single axis per chart, hover tooltips with generous hit areas, and a data table behind every chart.
import { useState, type CSSProperties, type PointerEvent } from "react";
import { clamp01, pct } from "../lib/format";
import { tip } from "../lib/tooltip";

const W = 340, H = 300, M = { l: 48, r: 14, t: 12, b: 46 };
const PW = W - M.l - M.r, PH = H - M.t - M.b;
const X = (v: number) => M.l + v * PW;
const Y = (v: number) => M.t + (1 - v) * PH;

function Frame({ xLabel, yLabel, fmt }: { xLabel: string; yLabel: string; fmt: (v: number) => string }) {
  const ticks = [0, 0.2, 0.4, 0.6, 0.8, 1];
  return (
    <g className="frame">
      {ticks.map((v) => (
        <g key={v}>
          <line x1={X(0)} x2={X(1)} y1={Y(v)} y2={Y(v)} className={v === 0 ? "axis" : "grid"} />
          <line x1={X(v)} x2={X(v)} y1={Y(0)} y2={Y(1)} className={v === 0 ? "axis" : "grid"} />
          <text x={X(v)} y={Y(0) + 17} textAnchor="middle" className="tick">{fmt(v)}</text>
          <text x={X(0) - 8} y={Y(v) + 4} textAnchor="end" className="tick">{fmt(v)}</text>
        </g>
      ))}
      <text x={X(0.5)} y={H - 6} textAnchor="middle" className="axis-label">{xLabel}</text>
      <text x={13} y={Y(0.5)} textAnchor="middle" className="axis-label" transform={`rotate(-90 13 ${Y(0.5)})`}>{yLabel}</text>
      <line x1={X(0)} y1={Y(0)} x2={X(1)} y2={Y(1)} className="reference" />
    </g>
  );
}

const toPlot = (e: PointerEvent<SVGElement>) => {
  const r = (e.currentTarget.ownerSVGElement ?? (e.currentTarget as unknown as SVGSVGElement)).getBoundingClientRect();
  return clamp01((((e.clientX - r.left) / r.width) * W - M.l) / PW);
};

export function RocChart({ points, auc }: { points: [number, number][]; auc: number }) {
  const [hover, setHover] = useState<[number, number] | null>(null);
  const d = points.map(([x, y], i) => `${i ? "L" : "M"}${X(x).toFixed(1)},${Y(y).toFixed(1)}`).join("");
  const nearest = (fx: number) => points.reduce((b, p) => (Math.abs(p[0] - fx) < Math.abs(b[0] - fx) ? p : b), points[0]);
  const show = (p: [number, number], cx: number, cy: number) => {
    setHover(p);
    tip.show(cx, cy, `Sensitivity ${pct(p[1])}`, `Specificity ${pct(1 - p[0])}`, `False-positive rate ${pct(p[0])}`);
  };
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label={`ROC curve, area under curve ${auc.toFixed(3)}`}>
      <defs>
        <linearGradient id="roc-fill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0" style={{ stopColor: "var(--s1)", stopOpacity: 0.32 }} />
          <stop offset="1" style={{ stopColor: "var(--s1)", stopOpacity: 0 }} />
        </linearGradient>
      </defs>
      <Frame xLabel="False-positive rate (1 − specificity)" yLabel="Sensitivity" fmt={(v) => v.toFixed(1)} />
      <text x={X(0.6)} y={Y(0.52)} className="ref-label">chance</text>
      <path d={`${d}L${X(1)},${Y(0)}L${X(0)},${Y(0)}Z`} fill="url(#roc-fill)" />
      <path d={d} className="series series-glow" />
      <path d={d} className="series" />
      <text x={X(0.52)} y={Y(0.14)} className="direct-label">AUC {auc.toFixed(3)}</text>
      {hover && (
        <>
          <line x1={X(hover[0])} x2={X(hover[0])} y1={Y(0)} y2={Y(1)} className="crosshair" />
          <circle cx={X(hover[0])} cy={Y(hover[1])} r={5} className="focus-dot" />
        </>
      )}
      <rect x={X(0)} y={Y(1)} width={PW} height={PH} className="hit" tabIndex={0}
        onPointerMove={(e) => show(nearest(toPlot(e)), e.clientX, e.clientY)}
        onPointerLeave={() => { setHover(null); tip.hide(); }}
        onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); show(nearest(0.2), r.left + r.width * 0.2, r.top + 30); }}
        onBlur={() => { setHover(null); tip.hide(); }} />
    </svg>
  );
}

export function CalibrationChart({ bins }: { bins: { pred: number; obs: number; n: number }[] }) {
  const d = bins.map((b, i) => `${i ? "L" : "M"}${X(b.pred).toFixed(1)},${Y(b.obs).toFixed(1)}`).join("");
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="chart" role="img" aria-label="Calibration plot: predicted risk against observed rate">
      <Frame xLabel="Predicted risk" yLabel="Observed rate" fmt={(v) => `${Math.round(v * 100)}%`} />
      <text x={X(0.6)} y={Y(0.7)} className="ref-label" transform={`rotate(-40 ${X(0.6)} ${Y(0.7)})`}>perfect calibration</text>
      <path d={d} className="series" />
      {bins.map((b, i) => {
        const show = (x: number, y: number) => tip.show(x, y, `Observed ${pct(b.obs)}`, `Predicted ${pct(b.pred)}`, `${b.n} predictions in this group`);
        return (
          <g key={i} className="point" tabIndex={0} onPointerMove={(e) => show(e.clientX, e.clientY)} onPointerLeave={tip.hide}
            onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); show(r.right, r.top); }} onBlur={tip.hide}>
            <circle cx={X(b.pred)} cy={Y(b.obs)} r={14} className="hit" />
            <circle cx={X(b.pred)} cy={Y(b.obs)} r={5} className="dot" />
          </g>
        );
      })}
    </svg>
  );
}

export function ConfusionMatrix({ cm, positive, negative }: { cm: { tn: number; fp: number; fn: number; tp: number }; positive: string; negative: string }) {
  const max = Math.max(cm.tn, cm.fp, cm.fn, cm.tp, 1);
  const neg = cm.tn + cm.fp, pos = cm.fn + cm.tp;
  const cell = (n: number, total: number, label: string, good: boolean) => (
    <td className={`cm-cell${good ? " good" : ""}`} style={{ "--t": (n / max).toFixed(3) } as CSSProperties} title={label}>
      <strong>{n}</strong><small>{label} · {total ? pct(n / total) : "–"}</small>
    </td>
  );
  return (
    <table className="cm">
      <thead><tr><th /><th scope="col">Predicted {negative}</th><th scope="col">Predicted {positive}</th></tr></thead>
      <tbody>
        <tr><th scope="row">Actual {negative}</th>{cell(cm.tn, neg, "true negative", true)}{cell(cm.fp, neg, "false positive", false)}</tr>
        <tr><th scope="row">Actual {positive}</th>{cell(cm.fn, pos, "false negative", false)}{cell(cm.tp, pos, "true positive", true)}</tr>
      </tbody>
    </table>
  );
}

export function BarList({ rows, format }: { rows: { label: string; value: number }[]; format: (v: number) => string }) {
  const max = Math.max(...rows.map((r) => r.value), 1e-9);
  return (
    <div className="barlist">
      {rows.map((r, i) => (
        <div key={r.label} className="barlist-row">
          <span className="barlist-label">{r.label}</span>
          <span className="barlist-track"><span className="barlist-bar" style={{ width: `${(r.value / max) * 100}%`, animationDelay: `${i * 30}ms` }} /></span>
          <span className="barlist-val">{format(r.value)}</span>
        </div>
      ))}
    </div>
  );
}

export interface Series { name: string; color: string }

/** Mean ± SD dot plot: one row per target, one dot per series. */
export function DotPlot({ rows, series, domain, format }: {
  rows: { label: string; values: { mean: number; sd: number }[] }[]; series: Series[]; domain: [number, number]; format: (v: number) => string;
}) {
  const x = (v: number) => ((Math.min(domain[1], Math.max(domain[0], v)) - domain[0]) / (domain[1] - domain[0])) * 100;
  const ticks = Array.from({ length: 6 }, (_, i) => domain[0] + ((domain[1] - domain[0]) * i) / 5);
  return (
    <div className="dotplot">
      {rows.map((r) => (
        <div key={r.label} className="dp-row">
          <span className="dp-label">{r.label}</span>
          <div className="dp-track">
            {ticks.map((t) => <span key={t} className="dp-grid" style={{ left: `${x(t)}%` }} />)}
            {r.values.map((v, i) => (
              <span key={series[i].name} className="dp-item" style={{ top: `${22 + i * 28}%`, "--c": series[i].color } as CSSProperties}
                onPointerMove={(e) => tip.show(e.clientX, e.clientY, `${format(v.mean)} ± ${format(v.sd)}`, `${series[i].name} · ${r.label}`)}
                onPointerLeave={tip.hide}>
                <span className="dp-whisker" style={{ left: `${x(v.mean - v.sd)}%`, width: `${x(v.mean + v.sd) - x(v.mean - v.sd)}%` }} />
                <span className="dp-dot" style={{ left: `${x(v.mean)}%` }} />
              </span>
            ))}
          </div>
        </div>
      ))}
      <div className="dp-row dp-axis" aria-hidden="true">
        <span />
        <div className="dp-track">{ticks.map((t) => <span key={t} className="dp-tick" style={{ left: `${x(t)}%` }}>{format(t)}</span>)}</div>
      </div>
    </div>
  );
}

/** Grouped horizontal bars (lower is better), value labelled at the bar end. */
export function GroupedBars({ rows, series, format }: {
  rows: { label: string; values: number[] }[]; series: Series[]; format: (v: number) => string;
}) {
  const max = Math.max(...rows.flatMap((r) => r.values), 1e-9) * 1.1;
  return (
    <div className="gbars">
      {rows.map((r) => (
        <div key={r.label} className="gb-row">
          <span className="gb-label">{r.label}</span>
          <div className="gb-bars">
            {r.values.map((v, i) => (
              <div key={series[i].name} className="gb-bar-row" onPointerMove={(e) => tip.show(e.clientX, e.clientY, format(v), `${series[i].name} · ${r.label}`)} onPointerLeave={tip.hide}>
                <span className="gb-bar" style={{ width: `${(v / max) * 100}%`, "--c": series[i].color } as CSSProperties} />
                <span className="gb-val">{format(v)}</span>
              </div>
            ))}
          </div>
        </div>
      ))}
    </div>
  );
}

export function Legend({ series }: { series: Series[] }) {
  return (
    <div className="legend-row">
      {series.map((s) => <span key={s.name} className="legend-item"><i style={{ background: s.color }} />{s.name}</span>)}
    </div>
  );
}

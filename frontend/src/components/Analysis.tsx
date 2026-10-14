// Explanation section: risk waterfall (SHAP), key drivers + what-if card, and the physiological breakdown table.
import { Pin, PinOff, Search, TrendingDown, TrendingUp } from "lucide-react";
import { useState, type CSSProperties } from "react";
import { TARGETS, TARGET_LONG, TARGET_SHORT, displayValue, pct, pp, refText, riskColor, status } from "../lib/format";
import { tip } from "../lib/tooltip";
import type { Feature, Prediction, Schema, Target, Values } from "../types";
import { Delta, Eyebrow, Segmented } from "./ui";

const TOP = 8;
const riskOf = (r: Prediction, t: Target) => (t === "cad" ? r.cad : r.vessels[t]);

interface Step {
  key: string;
  label: string;
  value: string;
  desc?: string | null;
  start: number;
  end: number;
}

export function Waterfall({ result, target, setTarget, byName }: {
  result: Prediction; target: Target; setTarget: (t: Target) => void; byName: Record<string, Feature>;
}) {
  const [view, setView] = useState<"chart" | "table">("chart");
  const risk = riskOf(result, target);
  const rows = result.explanations[target];
  const steps: Step[] = [];
  let cum = risk.baseline;
  for (const r of rows.slice(0, TOP)) {
    const f = byName[r.feature];
    steps.push({ key: r.feature, label: f?.label ?? r.feature, value: displayValue(f, r.value), desc: f?.desc, start: cum, end: cum + r.contribution });
    cum += r.contribution;
  }
  const rest = rows.slice(TOP);
  if (rest.length) {
    const sum = rest.reduce((a, r) => a + r.contribution, 0);
    steps.push({ key: "_rest", label: `${rest.length} other factors`, value: "combined", start: cum, end: cum + sum });
  }
  const all = steps.flatMap((s) => [s.start, s.end]).concat(risk.baseline, risk.probability);
  const lo = Math.min(0, ...all);
  const hi = Math.max(1, ...all);
  const x = (v: number) => ((v - lo) / (hi - lo)) * 100;
  const ticks = [0, 0.25, 0.5, 0.75, 1];
  const Ticks = () => <>{ticks.map((t) => <span key={t} className="wf-tick" style={{ left: `${x(t)}%` }} />)}</>;
  const final = riskColor(risk.probability);

  return (
    <section className="panel waterfall">
      <header className="panel-head wrap">
        <div>
          <Eyebrow>What drives this risk</Eyebrow>
          <h2>{TARGET_LONG[target]}: from baseline to this patient</h2>
        </div>
        <div className="head-controls">
          <Segmented options={TARGETS} value={target} onChange={setTarget} ariaLabel="Explain which prediction"
            label={(t) => `${TARGET_SHORT[t]} ${pct(riskOf(result, t).probability)}`} />
          <Segmented options={["chart", "table"] as const} value={view} onChange={setView} ariaLabel="View" size="sm"
            label={(v) => (v === "chart" ? "Chart" : "Table")} />
        </div>
      </header>

      {view === "chart" ? (
        <div className="wf" role="img" aria-label={`Risk moves from a baseline of ${pct(risk.baseline)} to ${pct(risk.probability)}`}>
          <div className="wf-row wf-base" onPointerMove={(e) => tip.show(e.clientX, e.clientY, `Baseline ${pct(risk.baseline)}`, "The model's risk for a patient whose every measurement is the training-set average.")} onPointerLeave={tip.hide}>
            <div className="wf-label"><span>Baseline</span><small>average inputs</small></div>
            <div className="wf-track"><Ticks /><span className="wf-bar base" style={{ left: `${x(lo)}%`, width: `${x(risk.baseline) - x(lo)}%` }} /><span className="wf-link" style={{ left: `${x(risk.baseline)}%` }} /></div>
            <div className="wf-val">{pct(risk.baseline)}</div>
          </div>
          {steps.map((s) => {
            const up = s.end >= s.start;
            return (
              <div key={s.key} className="wf-row" tabIndex={0}
                onPointerMove={(e) => tip.show(e.clientX, e.clientY, `${pp(s.end - s.start)} ${up ? "raises" : "lowers"} the risk`, `${s.label}: ${s.value}`, s.desc)}
                onPointerLeave={tip.hide}>
                <div className="wf-label"><span>{s.label}</span><small>{s.value}</small></div>
                <div className="wf-track">
                  <Ticks />
                  <span className={`wf-bar ${up ? "up" : "down"}`} style={{ left: `${x(Math.min(s.start, s.end))}%`, width: `max(2px, ${Math.abs(x(s.end) - x(s.start))}%)` }} />
                  <span className="wf-link" style={{ left: `${x(s.end)}%` }} />
                </div>
                <div className="wf-val"><i className={up ? "up" : "down"} aria-hidden="true">{up ? "▲" : "▼"}</i>{pp(s.end - s.start)}</div>
              </div>
            );
          })}
          <div className="wf-row wf-final">
            <div className="wf-label"><span>This patient</span><small>{TARGET_SHORT[target]} risk</small></div>
            <div className="wf-track"><Ticks /><span className="wf-bar final" style={{ left: `${x(lo)}%`, width: `${x(risk.probability) - x(lo)}%`, "--fc": final } as CSSProperties} /></div>
            <div className="wf-val strong">{pct(risk.probability)}</div>
          </div>
          <div className="wf-row wf-axis" aria-hidden="true">
            <div />
            <div className="wf-track">{ticks.map((t) => <span key={t} className="wf-axis-label" style={{ left: `${x(t)}%` }}>{t * 100}%</span>)}</div>
            <div />
          </div>
        </div>
      ) : (
        <div className="table-wrap">
          <table className="table">
            <thead><tr><th>Measurement</th><th>Value</th><th className="num">Contribution</th></tr></thead>
            <tbody>
              <tr><td>Baseline (average inputs)</td><td>–</td><td className="num">{pct(risk.baseline, 1)}</td></tr>
              {rows.map((r) => (
                <tr key={r.feature}><td>{byName[r.feature]?.label ?? r.feature}</td><td>{displayValue(byName[r.feature], r.value)}</td><td className="num">{pp(r.contribution, 2)}</td></tr>
              ))}
              <tr className="total"><td>This patient</td><td>–</td><td className="num">{pct(risk.probability, 1)}</td></tr>
            </tbody>
          </table>
        </div>
      )}
      <p className="note">
        SHAP values in percentage points (pp). Baseline plus every bar equals the final risk exactly. Explanations show how the
        model uses each measurement; they are associations, not causes.
      </p>
    </section>
  );
}

export function Insights({ result, target, byName, pinned, onPin, changed }: {
  result: Prediction; target: Target; byName: Record<string, Feature>;
  pinned: Prediction | null; onPin: () => void; changed: number;
}) {
  const rows = result.explanations[target];
  const up = rows.filter((r) => r.contribution > 0.002).slice(0, 3);
  const down = rows.filter((r) => r.contribution < -0.002).slice(0, 3);
  const item = (r: (typeof rows)[number], dir: "up" | "down") => (
    <li key={r.feature} className={`driver ${dir}`}>
      <span className="driver-icon" aria-hidden="true">{dir === "up" ? <TrendingUp size={15} /> : <TrendingDown size={15} />}</span>
      <span className="driver-text"><b>{byName[r.feature]?.label ?? r.feature}</b><small>{displayValue(byName[r.feature], r.value)}</small></span>
      <span className="driver-val">{pp(r.contribution)}</span>
    </li>
  );
  return (
    <section className="panel insights">
      <header className="panel-head"><Eyebrow>Key drivers · {TARGET_SHORT[target]}</Eyebrow></header>
      <h3 className="drivers-title">Raising the risk</h3>
      <ul className="drivers">{up.length ? up.map((r) => item(r, "up")) : <li className="muted small">Nothing raises it noticeably</li>}</ul>
      <h3 className="drivers-title">Lowering the risk</h3>
      <ul className="drivers">{down.length ? down.map((r) => item(r, "down")) : <li className="muted small">Nothing lowers it noticeably</li>}</ul>
      {result.imputed_features.length > 0 && (
        <p className="imputed">{result.imputed_features.length} input{result.imputed_features.length > 1 ? "s" : ""} not provided: typical values used, so treat this result with extra caution.</p>
      )}

      <div className="whatif">
        <div className="whatif-head">
          <Eyebrow>What-if mode</Eyebrow>
          <button type="button" className={`btn btn-sm${pinned ? " btn-ghost" : " btn-primary"}`} onClick={onPin}>
            {pinned ? <><PinOff size={14} /> Unpin</> : <><Pin size={14} /> Pin this result</>}
          </button>
        </div>
        {pinned ? (
          <>
            <p className="muted small">{changed} input{changed === 1 ? "" : "s"} changed since pinning.</p>
            <ul className="whatif-list">
              {TARGETS.map((t) => (
                <li key={t}><span>{TARGET_SHORT[t]}</span><span className="muted">{pct(riskOf(pinned, t).probability)} → {pct(riskOf(result, t).probability)}</span><Delta d={riskOf(result, t).probability - riskOf(pinned, t).probability} suffix="" /></li>
              ))}
            </ul>
          </>
        ) : (
          <p className="muted small">Pin the current result, then change any input (for example stop smoking or lower LDL) to see exactly how each risk moves.</p>
        )}
      </div>
    </section>
  );
}

type Filter = "all" | "flag" | "top";

export function Breakdown({ schema, values, result }: { schema: Schema; values: Values; result: Prediction }) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const contrib = Object.fromEntries(result.explanations.cad.map((r) => [r.feature, r.contribution]));
  const top = new Set(result.explanations.cad.slice(0, 10).map((r) => r.feature));
  const max = Math.max(...Object.values(contrib).map(Math.abs), 1e-9);
  const flaggedCount = schema.features.filter((f) => status(f, values[f.name]).key === "flag").length;
  const q = query.trim().toLowerCase();
  const keep = (f: Feature) =>
    (filter === "all" || (filter === "flag" ? status(f, values[f.name]).key === "flag" : top.has(f.name))) &&
    (!q || `${f.label} ${f.name}`.toLowerCase().includes(q));
  const labels: Record<Filter, string> = { all: `All ${schema.features.length}`, flag: `Flagged ${flaggedCount}`, top: "Top 10 drivers" };

  return (
    <section className="panel breakdown">
      <header className="panel-head wrap">
        <div>
          <Eyebrow>Physiological breakdown</Eyebrow>
          <h2>Every measurement, its reference range and its effect</h2>
        </div>
        <div className="head-controls">
          <label className="search sm"><Search size={14} aria-hidden="true" /><input placeholder="Filter" value={query} onChange={(e) => setQuery(e.target.value)} aria-label="Filter measurements" /></label>
          <Segmented options={["all", "flag", "top"] as const} value={filter} onChange={setFilter} ariaLabel="Show" size="sm" label={(k) => labels[k]} />
        </div>
      </header>
      <div className="table-wrap">
        <table className="table breakdown-table">
          <thead>
            <tr><th>Measurement</th><th>Value</th><th>Reference</th><th>Status</th><th className="effect-col">Effect on CAD risk</th></tr>
          </thead>
          {schema.groups.map((g) => {
            const fs = schema.features.filter((f) => f.group === g && keep(f));
            if (!fs.length) return null;
            return (
              <tbody key={g}>
                <tr className="group-row"><th colSpan={5} scope="rowgroup">{g}</th></tr>
                {fs.map((f) => {
                  const v = values[f.name];
                  const st = status(f, v);
                  const c = contrib[f.name] ?? 0;
                  return (
                    <tr key={f.name}>
                      <th scope="row" title={f.desc ?? undefined}>{f.label}</th>
                      <td>{displayValue(f, v)}</td>
                      <td className="muted">{refText(f) || "–"}</td>
                      <td>{st.text ? <span className={`status status-${st.key}`}><i />{st.dir === "up" ? "↑ " : st.dir === "down" ? "↓ " : ""}{st.text}</span> : <span className="muted">–</span>}</td>
                      <td className="effect">
                        <span className="effect-track"><span className={`effect-bar ${c >= 0 ? "up" : "down"}`} style={{ width: `${(Math.abs(c) / max) * 50}%` }} /></span>
                        <span className="effect-val">{Math.abs(c) < 0.0005 ? "≈ 0" : pp(c)}</span>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            );
          })}
        </table>
      </div>
      <p className="note">Reference ranges are general adult guidance; laboratories and guidelines differ.</p>
    </section>
  );
}

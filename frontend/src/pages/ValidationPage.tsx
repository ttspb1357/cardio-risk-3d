// Validation lab: nested-CV performance, the honest baseline check, and per-target deep dives.
import { useState } from "react";
import { BarList, CalibrationChart, ConfusionMatrix, DotPlot, GroupedBars, Legend, RocChart, type Series } from "../components/charts";
import { AnimatedNumber, Eyebrow, Segmented } from "../components/ui";
import { TARGETS, TARGET_LONG, TARGET_SHORT, pct } from "../lib/format";
import type { MetricKey, Metrics, Schema, Target, TargetMetrics } from "../types";

const SERIES_COLORS = ["var(--s1)", "var(--s2)", "var(--s3)"];
const METRICS: [MetricKey, string, (v: number) => string][] = [
  ["roc_auc", "ROC-AUC", (v) => v.toFixed(3)],
  ["sensitivity", "Sensitivity", (v) => pct(v)],
  ["specificity", "Specificity", (v) => pct(v)],
  ["precision", "Precision", (v) => pct(v)],
  ["f1", "F1-score", (v) => v.toFixed(3)],
  ["accuracy", "Accuracy", (v) => pct(v)],
  ["brier", "Brier score (lower is better)", (v) => v.toFixed(3)],
];

function Tile({ t, m }: { t: Target; m: TargetMetrics }) {
  const n = m.nested!;
  const a = n.pooled.roc_auc;
  const x = (v: number) => ((v - 0.5) / 0.5) * 100;
  return (
    <div className="panel tile">
      <Eyebrow>{TARGET_LONG[t]}</Eyebrow>
      <div className="tile-num"><AnimatedNumber value={a.value} from={0.5} format={(v) => v.toFixed(3)} /><span>AUC</span></div>
      <div className="ci" title={`95% CI ${a.lo.toFixed(3)}–${a.hi.toFixed(3)}`}>
        <span className="ci-range" style={{ left: `${x(a.lo)}%`, width: `${x(a.hi) - x(a.lo)}%` }} />
        <span className="ci-dot" style={{ left: `${x(a.value)}%` }} />
      </div>
      <div className="ci-axis"><span>0.5</span><span>95% CI {a.lo.toFixed(2)}–{a.hi.toFixed(2)}</span><span>1.0</span></div>
      <div className="tile-stats">
        <div><b>{pct(n.pooled.sensitivity.value)}</b><small>sensitivity</small></div>
        <div><b>{pct(n.pooled.specificity.value)}</b><small>specificity</small></div>
        <div><b>{n.calibration_error !== undefined ? pct(n.calibration_error, 1) : "–"}</b><small>calib. error</small></div>
      </div>
    </div>
  );
}

export function ValidationPage({ metrics, schema }: { metrics: Metrics; schema: Schema }) {
  const [target, setTarget] = useState<Target>("cad");
  const T = metrics.targets;
  const proto = metrics.protocol;
  if (!T.cad.nested || !proto.nested) {
    return <div className="panel empty">No evaluation results yet. Run <code>python ml/evaluate.py</code> and <code>python ml/train.py</code>.</div>;
  }
  const label = Object.fromEntries(schema.features.map((f) => [f.name, f.label]));
  const baselineNames = Object.keys(T.cad.nested.baselines);
  const short = (b: string) => b.split(" (")[0].replace(/^./, (c) => c.toUpperCase());
  const series: Series[] = [{ name: "Our pipeline", color: SERIES_COLORS[0] }, ...baselineNames.map((b, i) => ({ name: short(b), color: SERIES_COLORS[i + 1] }))];
  const ours = T.cad.nested.calibration_error ?? 0;
  const rf = T.cad.nested.baselines[baselineNames[1]]?.calibration_error;
  const n = T[target].nested!;
  const m = T[target];

  return (
    <div className="validation">
      <header className="hero">
        <Eyebrow>Validation lab</Eyebrow>
        <h1>Honest numbers, measured the hard way</h1>
        <p className="lede">{proto.summary}</p>
        <div className="hero-stats">
          <div><b>{proto.nested.n_patients}</b><span>patients</span></div>
          <div><b>{proto.nested.n_outer_folds}</b><span>outer folds</span></div>
          <div><b>1,000</b><span>bootstrap resamples</span></div>
          <div><b>0</b><span>peeks at test patients</span></div>
        </div>
      </header>

      <div className="tiles">{TARGETS.map((t) => <Tile key={t} t={t} m={T[t]} />)}</div>

      <section className="panel">
        <header className="panel-head wrap">
          <div>
            <Eyebrow>Baseline check</Eyebrow>
            <h2>Does the full pipeline beat simple models?</h2>
          </div>
          <Legend series={series} />
        </header>
        <p className="lede small-lede">
          On ranking (AUC) it is a tie: every decent model reaches the same ceiling, which is set by the data, not the model.
          The pipeline wins on <b>calibration</b>, meaning its percentages match what really happened
          {rf !== undefined && <> (overall CAD: {pct(ours, 1)} calibration error vs {pct(rf, 1)} for a plain random forest)</>}.
          That matters here, because the 3D arteries are coloured by exactly these percentages.
        </p>
        <div className="compare">
          <div>
            <h3>ROC-AUC per outer fold <small>mean ± SD · higher is better</small></h3>
            <DotPlot series={series} domain={[0.5, 1]} format={(v) => v.toFixed(2)}
              rows={TARGETS.map((t) => ({ label: TARGET_SHORT[t], values: [T[t].nested!.per_fold.roc_auc, ...baselineNames.map((b) => T[t].nested!.baselines[b].roc_auc)] }))} />
          </div>
          <div>
            <h3>Calibration error <small>lower is better</small></h3>
            <GroupedBars series={series} format={(v) => pct(v, 1)}
              rows={TARGETS.map((t) => ({ label: TARGET_SHORT[t], values: [T[t].nested!.calibration_error ?? 0, ...baselineNames.map((b) => T[t].nested!.baselines[b].calibration_error ?? 0)] }))} />
          </div>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head wrap">
          <div>
            <Eyebrow>Deep dive</Eyebrow>
            <h2>{TARGET_LONG[target]}</h2>
          </div>
          <Segmented options={TARGETS} value={target} onChange={setTarget} ariaLabel="Target" label={(t) => TARGET_SHORT[t]} />
        </header>
        <div className="deep">
          <figure className="chart-card">
            <figcaption>ROC curve</figcaption>
            <RocChart points={n.roc} auc={n.pooled.roc_auc.value} />
            <p className="note">Out-of-fold predictions pooled over the three repeats. Up and to the left is better; the diagonal is a coin flip.</p>
          </figure>
          <figure className="chart-card">
            <figcaption>Calibration</figcaption>
            <CalibrationChart bins={n.calibration} />
            <details className="data"><summary>Show data</summary>
              <table className="table"><thead><tr><th className="num">Predicted</th><th className="num">Observed</th><th className="num">n</th></tr></thead>
                <tbody>{n.calibration.map((b, i) => <tr key={i}><td className="num">{pct(b.pred)}</td><td className="num">{pct(b.obs)}</td><td className="num">{b.n}</td></tr>)}</tbody></table>
            </details>
          </figure>
          <figure className="chart-card">
            <figcaption>Confusion matrix</figcaption>
            <ConfusionMatrix cm={n.confusion_repeat1} positive={target === "cad" ? "CAD" : "stenosis"} negative="normal" />
            <p className="note">First repeat: each of the {proto.nested.n_patients} patients predicted once by a model that never saw them. Deployed threshold {pct(m.threshold)}.</p>
          </figure>
          <figure className="chart-card">
            <figcaption>Most influential measurements</figcaption>
            <BarList rows={m.importance.slice(0, 12).map((r) => ({ label: label[r.feature] ?? r.feature, value: r.mean_abs }))} format={(v) => `${(v * 100).toFixed(1)} pp`} />
            <p className="note">Average size of each measurement's SHAP contribution across patients.</p>
          </figure>
        </div>
      </section>

      <section className="panel">
        <header className="panel-head"><div><Eyebrow>All metrics</Eyebrow><h2>Pooled nested cross-validation with 95% confidence intervals</h2></div></header>
        <div className="table-wrap">
          <table className="table metrics-table">
            <thead><tr><th>Metric</th>{TARGETS.map((t) => <th key={t} className="num">{TARGET_SHORT[t]}</th>)}</tr></thead>
            <tbody>
              {METRICS.map(([k, name, f]) => (
                <tr key={k}>
                  <th scope="row">{name}</th>
                  {TARGETS.map((t) => { const c = T[t].nested!.pooled[k]; return <td key={t} className="num">{f(c.value)} <span className="ci-text">{f(c.lo)}–{f(c.hi)}</span></td>; })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="panel">
        <details className="hood">
          <summary><Eyebrow>Under the hood</Eyebrow><span>Deployed recipe, selection stability and leaderboard for {TARGET_SHORT[target]}</span></summary>
          <dl className="facts">
            <dt>Recipe</dt><dd>{m.description}</dd>
            <dt>Calibration</dt><dd>{m.calibrated ? "Platt scaling (it lowered the cross-validated Brier score)" : "None (Platt scaling did not help)"}</dd>
            <dt>Decision threshold</dt><dd>{pct(m.threshold)} (maximises sensitivity + specificity)</dd>
            <dt>SHAP baseline</dt><dd>{pct(m.baseline_risk)} (risk at average measurements; not the share of patients positive, {pct(m.positive_rate)})</dd>
            <dt>Configurations compared</dt><dd>{m.n_configs_tried}</dd>
          </dl>
          <h3 className="sub-title">Recipe chosen in each outer fold</h3>
          <table className="table"><thead><tr><th>Recipe</th><th className="num">Folds</th></tr></thead>
            <tbody>{n.selected_configs.map((c) => <tr key={c.config}><td>{c.description}</td><td className="num">{c.folds} / {proto.nested!.n_outer_folds}</td></tr>)}</tbody></table>
          <h3 className="sub-title">Final selection leaderboard (cross-validated)</h3>
          <table className="table"><thead><tr><th>Configuration</th><th className="num">AUC</th><th className="num">± SE</th><th className="num">Brier</th></tr></thead>
            <tbody>{m.leaderboard.map((r) => <tr key={r.config}><td><code>{r.config}</code></td><td className="num">{r.auc.toFixed(3)}</td><td className="num">{r.auc_se.toFixed(3)}</td><td className="num">{r.brier.toFixed(3)}</td></tr>)}</tbody></table>
        </details>
      </section>
    </div>
  );
}

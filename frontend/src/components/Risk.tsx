// Risk column: stat cards for overall CAD and the three arteries, and the ground-truth comparison.
import { Activity, Check, Droplet, HeartPulse, Waves, X } from "lucide-react";
import { motion } from "motion/react";
import type { CSSProperties } from "react";
import { TARGETS, VESSELS, VESSEL_FULL, bandOf, pct, riskColor } from "../lib/format";
import type { Prediction, Sample, Target } from "../types";
import { AnimatedNumber, BandPill, Delta, Eyebrow } from "./ui";

const EASE = [0.22, 1, 0.36, 1] as const;
const ICON: Record<Target, typeof HeartPulse> = { cad: HeartPulse, LAD: Activity, LCX: Waves, RCA: Droplet };
const SUB: Record<Target, string> = { cad: "≥ 50% narrowing, any artery", ...VESSEL_FULL };

/** Vertical capsule meter (the spatial layout's "heart rate" pill): fills up to the probability; the white line
 *  is the decision threshold. */
function Capsule({ p, threshold }: { p: number; threshold: number }) {
  return (
    <span className="capsule" aria-hidden="true">
      <motion.span className="capsule-fill" initial={{ height: 0 }} animate={{ height: `${Math.max(4, p * 100)}%` }} transition={{ duration: 0.8, ease: EASE }} />
      <span className="capsule-thr" style={{ bottom: `${threshold * 100}%` }} />
    </span>
  );
}

/** "My heart condition" grid: overall CAD and the three arteries as selectable stat cards. */
export function StatGrid({ result, target, onSelect, pinned }: {
  result: Prediction; target: Target; onSelect: (t: Target) => void; pinned: Prediction | null;
}) {
  return (
    <section className="stats" aria-label="Predicted risks">
      <header className="section-head">
        <span className="section-icon" aria-hidden="true"><HeartPulse size={14} /></span>
        <h2>Risk overview</h2>
        <span className={`verdict verdict-${result.cad.label === "CAD" ? "pos" : "neg"}`}>
          {result.cad.label === "CAD" ? "Classified: CAD" : "Classified: no CAD"}
        </span>
      </header>
      <div className="stat-grid">
        {TARGETS.map((t) => {
          const r = t === "cad" ? result.cad : result.vessels[t];
          const before = pinned ? (t === "cad" ? pinned.cad : pinned.vessels[t]).probability : null;
          const active = target === t;
          const Icon = ICON[t];
          return (
            <button key={t} type="button" className={`stat${active ? " active" : ""}`} aria-pressed={active}
              style={{ "--vc": riskColor(r.probability) } as CSSProperties}
              title={`${SUB[t]} · decision threshold ${pct(r.threshold)}`}
              onClick={() => onSelect(active && t !== "cad" ? "cad" : t)}>
              <span className="stat-main">
                <span className="stat-head">
                  <span className="stat-icon" aria-hidden="true"><Icon size={14} /></span>
                  <span className="stat-label">{t === "cad" ? "Overall CAD" : t}</span>
                </span>
                <span className="stat-sub">{SUB[t]}</span>
                <span className="stat-num">
                  <AnimatedNumber value={r.probability * 100} from={0} format={(n) => Math.round(n).toString()} /><small>%</small>
                </span>
                <span className="stat-foot">
                  <BandPill band={bandOf(r.probability)} />
                  {before !== null && <Delta d={r.probability - before} suffix="" />}
                </span>
              </span>
              <Capsule p={r.probability} threshold={r.threshold} />
            </button>
          );
        })}
      </div>
    </section>
  );
}

export function TruthCard({ sample, result }: { sample: Sample; result: Prediction }) {
  const rows = [
    { name: "CAD", actual: sample.truth.cad, positive: "CAD", p: result.cad.probability, thr: result.cad.threshold },
    ...VESSELS.map((v) => ({ name: v, actual: sample.truth[v], positive: "Stenotic", p: result.vessels[v].probability, thr: result.vessels[v].threshold })),
  ];
  const hits = rows.filter((r) => (r.actual === r.positive) === (r.p >= r.thr)).length;
  return (
    <section className="panel truth-card">
      <header className="panel-head">
        <Eyebrow>Ground truth</Eyebrow>
        <span className="muted small">{hits}/4 agree</span>
      </header>
      <p className="muted small truth-sub">Recorded angiography for this demo patient. The model never saw it.</p>
      <ul className="truth-list">
        {rows.map((r) => {
          const ok = (r.actual === r.positive) === (r.p >= r.thr);
          return (
            <li key={r.name} className={ok ? "ok" : "miss"}>
              <b>{r.name}</b>
              <span>{r.actual}</span>
              <span className="muted">model {pct(r.p)}</span>
              <span className="truth-mark" aria-label={ok ? "agrees" : "disagrees"}>{ok ? <Check size={14} /> : <X size={14} />}</span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

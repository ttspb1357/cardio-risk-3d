// AHA 17-segment bullseye (polar map of the left ventricle, viewed from the apex): anterior at the top, septum on
// the left, inferior at the bottom, lateral on the right. Each segment is coloured by the predicted risk of the
// artery that typically supplies it (Cerqueira et al., Circulation 2002). Hovering or clicking a segment
// highlights it on the 3D heart.
import type { CSSProperties } from "react";
import { VESSELS, pct, riskColor } from "../lib/format";
import { tip } from "../lib/tooltip";
import type { Prediction, Vessel } from "../types";
import { Eyebrow } from "./ui";

interface Segment { id: number; name: string; artery: Vessel; r0: number; r1: number; a0: number; a1: number }

const RINGS = { basal: [66, 92], mid: [42, 66], apical: [20, 42] } as const;
const SIX = ["anterior", "anteroseptal", "inferoseptal", "inferior", "inferolateral", "anterolateral"];
const SIX_ANGLES: [number, number][] = [[60, 120], [120, 180], [180, 240], [240, 300], [300, 360], [0, 60]];
const SIX_ARTERY: Vessel[] = ["LAD", "LAD", "RCA", "RCA", "LCX", "LCX"];
const FOUR = [
  { id: 13, name: "apical anterior", a: [45, 135], artery: "LAD" },
  { id: 14, name: "apical septal", a: [135, 225], artery: "LAD" },
  { id: 15, name: "apical inferior", a: [225, 315], artery: "RCA" },
  { id: 16, name: "apical lateral", a: [315, 405], artery: "LCX" },
] as const;

export const SEGMENTS: Segment[] = [
  ...SIX.map((n, i) => ({ id: i + 1, name: `basal ${n}`, artery: SIX_ARTERY[i], r0: RINGS.basal[0], r1: RINGS.basal[1], a0: SIX_ANGLES[i][0], a1: SIX_ANGLES[i][1] })),
  ...SIX.map((n, i) => ({ id: i + 7, name: `mid ${n}`, artery: SIX_ARTERY[i], r0: RINGS.mid[0], r1: RINGS.mid[1], a0: SIX_ANGLES[i][0], a1: SIX_ANGLES[i][1] })),
  ...FOUR.map((s) => ({ id: s.id, name: s.name, artery: s.artery as Vessel, r0: RINGS.apical[0], r1: RINGS.apical[1], a0: s.a[0], a1: s.a[1] })),
  { id: 17, name: "apex", artery: "LAD", r0: 0, r1: 20, a0: 0, a1: 360 },
];
/** Septal segments lie inside the heart (between the ventricles), so they never appear on the 3D surface. */
export const SEPTAL = new Set([2, 3, 8, 9, 14]);
export const TERRITORY_TEXT: Record<Vessel, string> = {
  LAD: "front wall, front of the septum and the apex",
  LCX: "side (lateral) wall of the left ventricle",
  RCA: "bottom (inferior) wall, back of the septum and the right ventricle",
};

const C = 100;
const pt = (r: number, deg: number) => {
  const a = (deg * Math.PI) / 180;
  return `${(C + r * Math.cos(a)).toFixed(2)},${(C - r * Math.sin(a)).toFixed(2)}`;
};

function sectorPath({ r0, r1, a0, a1 }: Segment): string {
  if (r0 === 0) return `M ${C - r1},${C} a ${r1},${r1} 0 1,0 ${2 * r1},0 a ${r1},${r1} 0 1,0 ${-2 * r1},0 Z`;
  const steps = Math.max(8, Math.round((a1 - a0) / 4));
  const outer = Array.from({ length: steps + 1 }, (_, i) => pt(r1, a0 + ((a1 - a0) * i) / steps));
  const inner = Array.from({ length: steps + 1 }, (_, i) => pt(r0, a1 - ((a1 - a0) * i) / steps));
  return `M ${outer.join(" L ")} L ${inner.join(" L ")} Z`;
}

function labelPos({ r0, r1, a0, a1 }: Segment): [number, number] {
  if (r0 === 0) return [C, C];
  const r = (r0 + r1) / 2, a = (((a0 + a1) / 2) * Math.PI) / 180;
  return [C + r * Math.cos(a), C - r * Math.sin(a)];
}

interface Props {
  result: Prediction;
  highlighted: number | null;
  onHover: (id: number | null) => void;
  onPick: (segment: Segment) => void;
}

export function Bullseye({ result, highlighted, onHover, onPick }: Props) {
  return (
    <section className="panel bullseye-card">
      <header className="panel-head">
        <Eyebrow>Heart-muscle territories</Eyebrow>
        <span className="muted small">AHA 17-segment</span>
      </header>
      <div className="bullseye-wrap">
        <svg viewBox="-14 -14 228 228" className="bullseye" role="img"
          aria-label="Left-ventricle bullseye: 17 segments coloured by the predicted risk of their supplying artery">
          {SEGMENTS.map((s) => {
            const p = result.vessels[s.artery].probability;
            const on = highlighted === s.id;
            const [lx, ly] = labelPos(s);
            const show = (x: number, y: number) => tip.show(x, y, `Segment ${s.id} · ${s.name}`,
              `Typically supplied by the ${s.artery}: ${pct(p)} stenosis risk`,
              SEPTAL.has(s.id) ? "Septal wall: inside the heart, between the ventricles" : "Click to show it on the 3D heart");
            return (
              <g key={s.id} className={`seg-cell${on ? " on" : ""}${SEPTAL.has(s.id) ? " septal" : ""}`} tabIndex={0} role="button"
                aria-label={`Segment ${s.id}, ${s.name}, ${s.artery} ${pct(p)}`}
                style={{ "--fill": riskColor(p) } as CSSProperties}
                onPointerEnter={() => onHover(s.id)}
                onPointerMove={(e) => show(e.clientX, e.clientY)}
                onPointerLeave={() => { onHover(null); tip.hide(); }}
                onFocus={(e) => { const r = e.currentTarget.getBoundingClientRect(); onHover(s.id); show(r.right, r.top); }}
                onBlur={() => { onHover(null); tip.hide(); }}
                onClick={() => onPick(s)}
                onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); onPick(s); } }}>
                <path d={sectorPath(s)} />
                <text x={lx} y={ly + 3}>{s.id}</text>
              </g>
            );
          })}
          <text className="be-dir" x={C} y={-4} textAnchor="middle">ANTERIOR</text>
          <text className="be-dir" x={C} y={210} textAnchor="middle">INFERIOR</text>
          <text className="be-dir" x={-8} y={C} textAnchor="middle" transform={`rotate(-90 -8 ${C})`}>SEPTAL</text>
          <text className="be-dir" x={208} y={C} textAnchor="middle" transform={`rotate(90 208 ${C})`}>LATERAL</text>
        </svg>
        <ul className="be-legend">
          {VESSELS.map((v) => (
            <li key={v}>
              <i style={{ background: riskColor(result.vessels[v].probability) }} aria-hidden="true" />
              <b>{v}</b>
              <span>{pct(result.vessels[v].probability)}</span>
              <small>{TERRITORY_TEXT[v]}</small>
            </li>
          ))}
        </ul>
      </div>
      <p className="note">
        Standard coronary supply of each left-ventricle segment. Individual anatomy varies (for example which artery is
        dominant), and the data do not say where a narrowing is.
      </p>
    </section>
  );
}

// Hero stage: the 3D heart on a glass orb, with overlays (headline, tool buttons, floating CAD card, guided tour,
// camera views, legend).
import { Activity, HeartPulse, Layers, Play, Rotate3d, RotateCcw, ScanEye, Square } from "lucide-react";
import { useEffect, useRef, useState, type CSSProperties } from "react";
import { BAND_TEXT, VESSEL_FULL, bandOf, pct, riskColor } from "../lib/format";
import { tip } from "../lib/tooltip";
import { createHeart, type HeartApi, type ViewName } from "../three/heart";
import type { Prediction, Target, Vessel } from "../types";
import { TERRITORY_TEXT } from "./Bullseye";
import { AnimatedNumber, BandPill, Delta, Segmented } from "./ui";

interface Props {
  result: Prediction;
  target: Target;
  onSelect: (t: Target) => void;
  segment: number | null;
  loading: boolean;
  error: string | null;
  latency: number | null;
  pinned: Prediction | null;
}

const VIEW_OPTIONS = ["front", "left", "back", "below"] as const;
const VIEW_LABEL: Record<(typeof VIEW_OPTIONS)[number], string> = { front: "Front", left: "Left", back: "Back", below: "Below" };
const TOUR: { view: ViewName; target: Target; seconds: number }[] = [
  { view: "front", target: "cad", seconds: 3.2 },
  { view: "LAD", target: "LAD", seconds: 5 },
  { view: "LCX", target: "LCX", seconds: 5 },
  { view: "RCA", target: "RCA", seconds: 5 },
  { view: "front", target: "cad", seconds: 2.5 },
];

export function HeartStage({ result, target, onSelect, segment, loading, error, latency, pinned }: Props) {
  const mount = useRef<HTMLDivElement>(null);
  const heart = useRef<HeartApi | null>(null);
  const [failed, setFailed] = useState(false);
  const [ready, setReady] = useState(false);
  const [spin, setSpin] = useState(false);
  const [beat, setBeat] = useState(true);
  const [xray, setXray] = useState(false);
  const [allTerritories, setAllTerritories] = useState(false);
  const [view, setView] = useState<(typeof VIEW_OPTIONS)[number] | null>("front");
  const [tourStep, setTourStep] = useState<number | null>(null);
  const latest = useRef({ result, onSelect });
  latest.current = { result, onSelect };

  useEffect(() => {
    if (!mount.current) return;
    try {
      const h = createHeart(mount.current, {
        onSelect: (name) => latest.current.onSelect(name ?? "cad"),
        onHover: (name, x, y) => {
          if (!name) return tip.hide();
          const v = latest.current.result.vessels[name];
          tip.show(x, y, `${name} · ${pct(v.probability)}`, VESSEL_FULL[name], BAND_TEXT[v.risk]);
        },
        onLoad: () => setReady(true),
        onError: () => setFailed(true),
        onUserInteract: () => { setTourStep(null); setView(null); },
      });
      heart.current = h;
      return () => {
        h.dispose();
        heart.current = null;
      };
    } catch (e) {
      console.error(e);
      setFailed(true);
    }
  }, []);

  useEffect(() => {
    heart.current?.setRisks({ LAD: result.vessels.LAD.probability, LCX: result.vessels.LCX.probability, RCA: result.vessels.RCA.probability });
  }, [result]);
  useEffect(() => {
    heart.current?.select(target === "cad" ? null : target);
  }, [target]);
  useEffect(() => {
    heart.current?.highlightSegment(segment);
  }, [segment]);
  useEffect(() => {
    heart.current?.setAutoRotate(spin);
  }, [spin]);
  useEffect(() => {
    heart.current?.setBeating(beat);
  }, [beat]);
  useEffect(() => {
    heart.current?.setXray(xray);
  }, [xray]);
  useEffect(() => {
    heart.current?.setTerritoryMode(allTerritories ? "all" : "auto");
  }, [allTerritories]);

  // Guided tour: fly to each artery in turn, selecting it so the side panels follow.
  useEffect(() => {
    if (tourStep === null) return;
    const step = TOUR[tourStep];
    heart.current?.flyTo(step.view, 1.6);
    latest.current.onSelect(step.target);
    setView(step.view === "front" ? "front" : null);
    const timer = window.setTimeout(() => setTourStep(tourStep + 1 < TOUR.length ? tourStep + 1 : null), step.seconds * 1000);
    return () => window.clearTimeout(timer);
  }, [tourStep]);

  const goTo = (v: (typeof VIEW_OPTIONS)[number]) => {
    setTourStep(null);
    setView(v);
    heart.current?.flyTo(v);
  };

  const touring = tourStep !== null;
  const tourTarget = touring ? TOUR[tourStep].target : null;
  const caption = tourTarget && tourTarget !== "cad"
    ? { title: `${tourTarget} · ${VESSEL_FULL[tourTarget as Vessel]}`, risk: result.vessels[tourTarget as Vessel], text: TERRITORY_TEXT[tourTarget as Vessel] }
    : null;
  const state = error ? "offline" : loading ? "busy" : "live";

  return (
    <section className="stage" aria-label="3D coronary risk map">
      <div className="stage-orb" aria-hidden="true" />
      <div ref={mount} className="stage-mount" />
      <div className="hud hud-tl">
        <h1 className="stage-title">Coronary risk<br />overview</h1>
        <span className="hud-title"><i style={{ background: target === "cad" ? "var(--accent)" : riskColor(result.vessels[target].probability) }} aria-hidden="true" />
          {target === "cad" ? "All three arteries" : `${target} · ${VESSEL_FULL[target]}`}</span>
        <span className="hud-sub">Drag to rotate · click a dot or artery</span>
      </div>
      {/* Left icon column (the spatial layout's tool rail) */}
      <div className="hud hud-tools">
        <button type="button" className={`icon-btn${touring ? " on" : ""}`} aria-pressed={touring} title={touring ? "Stop the tour" : "Guided tour of the three arteries"}
          aria-label="Guided tour" onClick={() => setTourStep(touring ? null : 0)}>{touring ? <Square size={15} /> : <Play size={16} />}</button>
        <button type="button" className={`icon-btn${allTerritories ? " on" : ""}`} aria-pressed={allTerritories} title="Show every artery's heart-muscle territory"
          aria-label="Show all territories" onClick={() => setAllTerritories(!allTerritories)}><Layers size={16} /></button>
        <button type="button" className={`icon-btn${xray ? " on" : ""}`} aria-pressed={xray} title="X-ray: see all arteries through the heart wall"
          aria-label="X-ray mode" onClick={() => setXray(!xray)}><ScanEye size={16} /></button>
        <button type="button" className={`icon-btn${spin ? " on" : ""}`} aria-pressed={spin} title="Auto-rotate" aria-label="Auto-rotate" onClick={() => setSpin(!spin)}><Rotate3d size={16} /></button>
        <button type="button" className={`icon-btn${beat ? " on" : ""}`} aria-pressed={beat} title="Heartbeat" aria-label="Heartbeat animation" onClick={() => setBeat(!beat)}><Activity size={16} /></button>
      </div>
      <div className="hud hud-power">
        <button type="button" className="icon-btn" title="Reset view" aria-label="Reset view" onClick={() => { setTourStep(null); setView("front"); heart.current?.resetView(); }}><RotateCcw size={16} /></button>
      </div>

      {caption && (
        <div className="tour-caption" role="status" key={tourTarget}>
          <span className="eyebrow">Guided tour · {tourStep}/{TOUR.length - 2}</span>
          <strong>{caption.title}</strong>
          <span><b>{pct(caption.risk.probability)}</b> {BAND_TEXT[caption.risk.risk].toLowerCase()} · supplies the {caption.text}</span>
        </div>
      )}

      <div className="hud float-card" style={{ "--vc": riskColor(result.cad.probability) } as CSSProperties}>
        <span className="float-head">
          <span className="float-icon" aria-hidden="true"><HeartPulse size={12} /></span>
          <span>CAD risk</span>
          <span className={`live live-${state}`} title={state === "offline" ? error ?? "Model offline" : state === "busy" ? "Updating…" : `Model live${latency ? ` · ${Math.round(latency)} ms` : ""}`}
            aria-label={state === "offline" ? "Model offline" : state === "busy" ? "Updating" : "Model live"}><i /></span>
        </span>
        <span className="float-num"><AnimatedNumber value={result.cad.probability * 100} from={0} format={(n) => Math.round(n).toString()} /><small>%</small>
          {pinned && <Delta d={result.cad.probability - pinned.cad.probability} suffix="" />}</span>
        <svg className={`ecg${beat ? " on" : ""}`} viewBox="0 0 120 28" aria-hidden="true">
          <path d="M0 16 H34 L39 16 L43 6 L48 25 L53 11 L57 16 H74 L78 13 L82 16 H120" />
        </svg>
        <BandPill band={bandOf(result.cad.probability)} />
      </div>
      <div className="hud hud-bc">
        <Segmented options={VIEW_OPTIONS} value={view ?? undefined} onChange={goTo} ariaLabel="Camera view" size="sm" label={(v) => VIEW_LABEL[v]} />
      </div>
      <div className="hud hud-br">
        <div className="legend" aria-label="Colour scale: predicted probability of stenosis">
          <span className="legend-title">Stenosis probability</span>
          <span className="legend-bar" />
          <span className="legend-scale"><span>0</span><span>50</span><span>100%</span></span>
        </div>
        <a className="credit" href="http://lifesciencedb.jp/bp3d/" target="_blank" rel="noreferrer"
          title="BodyParts3D, © The Database Center for Life Science, licensed under CC Attribution-Share Alike 2.1 Japan">
          Anatomy: BodyParts3D © DBCLS · CC BY-SA 2.1 JP
        </a>
      </div>
      {!ready && !failed && <div className="stage-loading"><span className="spinner" />Loading anatomy…</div>}
      {failed && <div className="stage-error">The 3D view could not start (WebGL or model unavailable). All predictions still work.</div>}
      {error && <div className="stage-error">Prediction failed: {error}</div>}
    </section>
  );
}

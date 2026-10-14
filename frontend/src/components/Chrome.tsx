// App chrome: the always-visible clinical disclaimer and the top bar (brand, page tabs, search, actions).
import { BookOpen, Database, FlaskConical, HeartPulse, Printer, Search, TriangleAlert } from "lucide-react";
import { motion } from "motion/react";
import type { Route } from "../lib/hooks";
import { Logo } from "./ui";

/** Fired by the top bar's search pill; the assessment page opens the all-inputs drawer. */
export const OPEN_INPUTS = "cr3d:open-inputs";

export function Disclaimer() {
  return (
    <div className="disclaimer" role="note">
      <TriangleAlert size={14} aria-hidden="true" />
      <span>
        <strong>Educational decision-support prototype.</strong> Not a diagnosis, and not a substitute for formal
        diagnostic imaging (such as coronary angiography) or clinical judgement.
      </span>
    </div>
  );
}

const NAV = [
  { route: "assess", href: "#/", label: "Assessment", Icon: HeartPulse },
  { route: "validation", href: "#/validation", label: "Validation", Icon: FlaskConical },
  { route: "method", href: "#/method", label: "Method & limits", Icon: BookOpen },
] as const;

export function TopBar({ route }: { route: Route }) {
  const openInputs = () => {
    if (route !== "assess") window.location.hash = "#/";
    window.dispatchEvent(new Event(OPEN_INPUTS));
  };
  return (
    <header className="topbar">
      <a className="brand" href="#/" aria-label="CardioRisk 3D home">
        <span className="brand-logo"><Logo size={22} /></span>
        <span className="brand-name">Cardio<span>Risk</span></span>
      </a>
      <nav className="tabs" aria-label="Main">
        {NAV.map(({ route: r, href, label, Icon }) => (
          <a key={r} href={href} className={`tab${route === r ? " active" : ""}`} aria-current={route === r ? "page" : undefined}>
            {route === r && <motion.span layoutId="tab-pill" className="tab-pill" transition={{ type: "spring", bounce: 0.2, duration: 0.5 }} />}
            <i className="tab-dot" aria-hidden="true" />
            <Icon size={15} aria-hidden="true" className="tab-icon" />
            <span className="tab-text">{label}</span>
          </a>
        ))}
      </nav>
      <div className="topbar-tools">
        <button type="button" className="search-pill" onClick={openInputs}>
          <span>Search patient inputs…</span>
          <Search size={15} aria-hidden="true" />
        </button>
        <button type="button" className="round-btn" title="Print report" aria-label="Print report" onClick={() => window.print()}>
          <Printer size={16} />
        </button>
        <span className="round-btn ghost meta" title="Z-Alizadeh Sani dataset · 303 patients" aria-label="Z-Alizadeh Sani dataset, 303 patients">
          <Database size={16} aria-hidden="true" /><i className="dot" />
        </span>
      </div>
    </header>
  );
}

export function Splash({ error }: { error?: string }) {
  return (
    <div className="splash">
      <div className="splash-logo"><Logo size={64} /></div>
      {error ? (
        <>
          <h1>Can't reach the model server</h1>
          <p className="muted">{error}</p>
          <p className="muted">Start it with <code>python -m uvicorn backend.app:app --port 8000</code>, then reload.</p>
        </>
      ) : (
        <p className="splash-text">Loading models…</p>
      )}
    </div>
  );
}

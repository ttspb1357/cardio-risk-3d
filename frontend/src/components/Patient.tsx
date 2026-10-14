// Patient column (identity, flagged findings, key-factor sliders), the demo-patient strip and the drawer with all inputs.
import { ArrowRight, Check, ChevronLeft, ChevronRight, Search, Sigma, SlidersHorizontal, UserRound, Users, X } from "lucide-react";
import { AnimatePresence, motion } from "motion/react";
import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { fmtNumber, status } from "../lib/format";
import type { Feature, Sample, Schema, Values } from "../types";
import { InputControl, type OnInput } from "./InputControl";
import { Eyebrow } from "./ui";

/** "Patient #41 · no stenosis" -> { name: "Patient #41", finding: "no stenosis" } */
function splitLabel(label: string) {
  const [name, finding = ""] = label.split(/\s+[·–—-]\s+/);
  return { name, finding };
}

interface PanelProps {
  schema: Schema;
  byName: Record<string, Feature>;
  samples: Sample[];
  sampleKey: string;
  onSample: (key: string) => void;
  values: Values;
  onChange: OnInput;
  edited: boolean;
  openDrawer: () => void;
}

export function PatientPanel({ schema, byName, samples, sampleKey, onSample, values, onChange, edited, openDrawer }: PanelProps) {
  const flagged = schema.features.filter((f) => f.type !== "number" && status(f, values[f.name]).key === "flag");
  const num = (k: string) => (values[k] === undefined ? "–" : fmtNumber(Number(values[k])));
  const keys = [...samples.map((_, i) => String(i)), "typical"];
  const at = Math.max(0, keys.indexOf(sampleKey));
  const current = sampleKey === "typical" ? "Typical patient" : splitLabel(samples[Number(sampleKey)].label).name;
  return (
    <aside className="panel patient" aria-label="Patient">
      <header className="section-head">
        <span className="section-icon" aria-hidden="true"><UserRound size={14} /></span>
        <h2>Patient</h2>
        <span className={`tag${edited ? " tag-edit" : ""}`}>{edited ? "Edited" : sampleKey === "typical" ? "Median" : "Unseen"}</span>
      </header>

      <div className="patient-id">
        <div className="avatar" aria-hidden="true">{values.Sex === "Female" ? "F" : "M"}</div>
        <div className="patient-meta">
          <span className="muted small">Current patient</span>
          <strong>{String(values.Sex ?? "–")}, {num("Age")} years</strong>
          <span className="muted small">BMI {num("BMI")} · BP {num("BP")} mmHg</span>
        </div>
      </div>

      {/* Patient switcher (the "< 24 March 25 >" row of the spatial layout) */}
      <div className="switcher">
        <button type="button" className="round-btn sm ghost" aria-label="Previous patient" onClick={() => onSample(keys[(at - 1 + keys.length) % keys.length])}><ChevronLeft size={15} /></button>
        <span className="switcher-label">{current}</span>
        <button type="button" className="round-btn sm ghost" aria-label="Next patient" onClick={() => onSample(keys[(at + 1) % keys.length])}><ChevronRight size={15} /></button>
      </div>

      <div className="conditions" aria-label="Flagged findings">
        {flagged.length === 0 && <span className="muted small">No flagged history, symptom or ECG findings</span>}
        {flagged.slice(0, 9).map((f) => <span key={f.name} className="cond">{f.label}</span>)}
        {flagged.length > 9 && <span className="cond more">+{flagged.length - 9}</span>}
      </div>

      <div className="sub-head">
        <Eyebrow>Key factors</Eyebrow>
        <span className="muted small">drag to explore</span>
      </div>
      <div className="key-factors">
        {schema.key_inputs.filter((n) => byName[n]).map((n) => <InputControl key={n} f={byName[n]} value={values[n]} onChange={onChange} />)}
      </div>

      <button type="button" className="btn btn-primary btn-pill btn-wide" onClick={openDrawer}>
        <SlidersHorizontal size={16} aria-hidden="true" /> All {schema.features.length} inputs <ArrowRight size={15} aria-hidden="true" />
      </button>
    </aside>
  );
}

/** "Demo patients" carousel: one card per unseen demo patient, plus the typical (median) patient. */
export function PatientStrip({ samples, sampleKey, onSample }: { samples: Sample[]; sampleKey: string; onSample: (key: string) => void }) {
  const row = useRef<HTMLDivElement>(null);
  const scroll = (dir: number) => row.current?.scrollBy({ left: dir * 260, behavior: "smooth" });
  const cards = [
    ...samples.map((s, i) => {
      const { name, finding } = splitLabel(s.label);
      return { key: String(i), name, finding, sex: s.values.Sex, age: s.values.Age, cad: s.truth.cad === "CAD" };
    }),
    { key: "typical", name: "Typical patient", finding: "median values", sex: undefined, age: undefined, cad: null },
  ];
  return (
    <section className="panel strip" aria-label="Demo patients">
      <header className="section-head">
        <span className="section-icon" aria-hidden="true"><Users size={14} /></span>
        <h2>Demo patients</h2>
        <span className="muted small strip-sub">unseen by the model</span>
        <span className="strip-arrows">
          <button type="button" className="round-btn sm ghost" aria-label="Scroll left" onClick={() => scroll(-1)}><ChevronLeft size={16} /></button>
          <button type="button" className="round-btn sm ghost" aria-label="Scroll right" onClick={() => scroll(1)}><ChevronRight size={16} /></button>
        </span>
      </header>
      <div className="strip-row" ref={row} role="radiogroup" aria-label="Choose a patient">
        {cards.map((c) => {
          const on = c.key === sampleKey;
          return (
            <button key={c.key} type="button" role="radio" aria-checked={on} className={`pcard${on ? " on" : ""}`} onClick={() => onSample(c.key)}
              title={`${c.name}${c.finding ? ` · ${c.finding}` : ""}`}>
              {c.cad !== null && <span className={`pcard-truth${c.cad ? " pos" : ""}`}>{c.cad ? "CAD" : "Normal"}</span>}
              <span className={`pcard-orb${c.cad === null ? " typical" : ""}`} aria-hidden="true">
                {c.cad === null ? <Sigma size={22} /> : c.sex === "Female" ? "F" : "M"}
              </span>
              <span className="pcard-name">
                <b>{c.name.replace("Patient ", "")}</b>
                {on && <span className="pcard-badge" aria-hidden="true"><Check size={10} strokeWidth={3.5} /></span>}
              </span>
              <small className="pcard-sub">{c.age !== undefined ? `${c.age} y · ` : ""}{c.finding}</small>
            </button>
          );
        })}
      </div>
    </section>
  );
}

interface DrawerProps {
  open: boolean;
  onClose: () => void;
  schema: Schema;
  values: Values;
  onChange: OnInput;
  onTypical: () => void;
}

export function InputsDrawer({ open, onClose, schema, values, onChange, onTypical }: DrawerProps) {
  const [query, setQuery] = useState("");
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);

  const q = query.trim().toLowerCase();
  const match = (f: Feature) => !q || `${f.label} ${f.desc ?? ""} ${f.name} ${f.group}`.toLowerCase().includes(q);
  const flagged = schema.features.filter((f) => status(f, values[f.name]).key === "flag").length;
  const empty = schema.features.filter((f) => values[f.name] === undefined).length;

  return createPortal(
    <AnimatePresence>
      {open && (
        <>
          <motion.div key="scrim" className="scrim" onClick={onClose} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} />
          <motion.aside key="drawer" className="drawer" role="dialog" aria-modal="true" aria-label="All patient inputs"
            initial={{ x: "100%" }} animate={{ x: 0 }} exit={{ x: "100%" }} transition={{ type: "spring", bounce: 0, duration: 0.45 }}>
            <header className="drawer-head">
              <div>
                <Eyebrow>Patient record</Eyebrow>
                <h2>All {schema.features.length} inputs</h2>
              </div>
              <button type="button" className="icon-btn" aria-label="Close" onClick={onClose}><X size={18} /></button>
            </header>
            <label className="search">
              <Search size={15} aria-hidden="true" />
              <input autoFocus placeholder="Search inputs, e.g. cholesterol" value={query} onChange={(e) => setQuery(e.target.value)} />
            </label>
            <div className="drawer-body">
              {schema.groups.map((g) => {
                const fs = schema.features.filter((f) => f.group === g && match(f));
                if (!fs.length) return null;
                const n = fs.filter((f) => status(f, values[f.name]).key === "flag").length;
                return (
                  <section key={g} className="drawer-group">
                    <h3>{g}{n > 0 && <span className="count">{n} flagged</span>}</h3>
                    <div className="drawer-fields">
                      {fs.map((f) => <InputControl key={f.name} f={f} value={values[f.name]} onChange={onChange} />)}
                    </div>
                  </section>
                );
              })}
              {schema.features.every((f) => !match(f)) && <p className="muted">No input matches “{query}”.</p>}
            </div>
            <footer className="drawer-foot">
              <span className="muted small">{flagged} flagged · {empty} using typical values</span>
              <button type="button" className="btn btn-ghost" onClick={onTypical}>Typical values</button>
              <button type="button" className="btn btn-primary" onClick={onClose}>Done</button>
            </footer>
          </motion.aside>
        </>
      )}
    </AnimatePresence>,
    document.body,
  );
}

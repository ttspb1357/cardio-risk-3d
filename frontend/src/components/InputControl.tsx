// One patient input: a range slider (numbers, with the reference range drawn on the track) or a segmented
// control (yes/no findings and categorical choices).
import { CircleAlert } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { fmtNumber, optionText, outsideTraining, refText, status } from "../lib/format";
import type { Feature, Value } from "../types";
import { Segmented } from "./ui";

export type OnInput = (name: string, v: Value | undefined) => void;

export function InputControl({ f, value, onChange }: { f: Feature; value: Value | undefined; onChange: OnInput }) {
  if (f.type === "number") return <NumberControl f={f} value={value === undefined ? undefined : Number(value)} onChange={onChange} />;
  const st = status(f, value);
  return (
    <div className={`ctl ctl-choice${st.key === "flag" ? " is-flag" : ""}`}>
      <span className="ctl-label" title={f.desc ?? undefined}>{f.label}</span>
      <Segmented options={f.options ?? []} value={value} size="sm" ariaLabel={f.label}
        label={(o) => optionText(f, o)} danger={(o) => status(f, o).key === "flag"} onChange={(v) => onChange(f.name, v)} />
    </div>
  );
}

function NumberControl({ f, value, onChange }: { f: Feature; value: number | undefined; onChange: OnInput }) {
  const min = f.min ?? 0;
  const max = f.max ?? 100;
  const shown = value ?? Number(f.default);
  const frac = (x: number) => Math.min(1, Math.max(0, (x - min) / (max - min || 1)));
  const st = status(f, value);
  const warn = outsideTraining(f, value);
  const band = f.ref ? { left: frac(f.ref[0] ?? min), right: frac(f.ref[1] ?? max) } : null;
  const hint = warn
    ? `Outside the training data (${fmtNumber(min)}–${fmtNumber(max)}): less reliable`
    : value === undefined ? "Not provided: the typical value is used"
    : f.ref ? `Reference ${refText(f)}` : "";
  const cls = ["ctl", "ctl-number", st.key === "flag" && "is-flag", value === undefined && "is-empty", warn && "is-warn"].filter(Boolean).join(" ");
  return (
    <div className={cls}>
      <div className="ctl-head">
        <label className="ctl-label" htmlFor={`in-${f.name}`} title={f.desc ?? undefined}>{f.label}</label>
        {st.key === "flag" && <span className="ctl-flag">{st.dir === "up" ? "↑" : "↓"} {st.text}</span>}
        <span className="ctl-num">
          <NumberField id={`in-${f.name}`} value={value} onChange={(v) => onChange(f.name, v)} />
          {f.unit && <span className="ctl-unit">{f.unit}</span>}
        </span>
      </div>
      <div className="range">
        <div className="range-track" />
        {band && <div className="range-ref" style={{ left: `${band.left * 100}%`, width: `max(3px, ${(band.right - band.left) * 100}%)` }} />}
        <div className="range-fill" style={{ width: `${frac(shown) * 100}%` }} />
        <input type="range" min={min} max={max} step={f.integer ? 1 : 0.1} value={Math.min(max, Math.max(min, shown))}
          aria-label={f.label} onChange={(e) => onChange(f.name, Number(e.target.value))} />
      </div>
      {hint && <div className="ctl-hint">{warn && <CircleAlert size={12} aria-hidden="true" />}{hint}</div>}
    </div>
  );
}

/** Text box that tolerates half-typed numbers ("1.") and treats empty as "not provided". */
function NumberField({ id, value, onChange }: { id: string; value: number | undefined; onChange: (v: number | undefined) => void }) {
  const show = (v: number | undefined) => (v === undefined ? "" : String(Math.round(v * 100) / 100));
  const [text, setText] = useState(show(value));
  const focused = useRef(false);
  useEffect(() => {
    if (!focused.current) setText(show(value));
  }, [value]);
  return (
    <input id={id} className="num-input" type="text" inputMode="decimal" autoComplete="off" value={text} placeholder="auto"
      onFocus={() => { focused.current = true; }}
      onBlur={() => { focused.current = false; setText(show(value)); }}
      onChange={(e) => {
        const t = e.target.value;
        setText(t);
        if (t.trim() === "") return onChange(undefined);
        const n = Number(t);
        if (Number.isFinite(n) && n >= 0) onChange(n);
      }} />
  );
}

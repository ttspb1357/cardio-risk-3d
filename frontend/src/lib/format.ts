import type { Band, Feature, Target, Value, Vessel } from "../types";

export const TARGETS: Target[] = ["cad", "LAD", "LCX", "RCA"];
export const VESSELS: Vessel[] = ["LAD", "LCX", "RCA"];
export const VESSEL_FULL: Record<Vessel, string> = {
  LAD: "Left anterior descending",
  LCX: "Left circumflex",
  RCA: "Right coronary artery",
};
export const TARGET_SHORT: Record<Target, string> = { cad: "Overall", LAD: "LAD", LCX: "LCX", RCA: "RCA" };
export const TARGET_LONG: Record<Target, string> = {
  cad: "Coronary artery disease",
  LAD: "LAD stenosis",
  LCX: "LCX stenosis",
  RCA: "RCA stenosis",
};

export const pct = (p: number, digits = 0) => `${(p * 100).toFixed(digits)}%`;
export const pp = (x: number, digits = 1) => `${x >= 0 ? "+" : "−"}${Math.abs(x * 100).toFixed(digits)} pp`;
export const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export const bandOf = (p: number): Band => (p < 0.35 ? "low" : p <= 0.65 ? "medium" : "high");
export const BAND_TEXT: Record<Band, string> = { low: "Low risk", medium: "Moderate risk", high: "High risk" };

// One risk colour scale for the gauge, vessel bars and the 3D arteries: emerald -> amber -> rose.
const STOPS: [number, [number, number, number]][] = [
  [0, [52, 211, 153]],
  [0.5, [251, 191, 36]],
  [1, [244, 63, 94]],
];
export function riskColor(p: number): string {
  const x = clamp01(p);
  let i = 1;
  while (i < STOPS.length - 1 && x > STOPS[i][0]) i++;
  const [a, ca] = STOPS[i - 1];
  const [b, cb] = STOPS[i];
  const t = (x - a) / (b - a);
  return "#" + ca.map((c, j) => Math.round(c + (cb[j] - c) * t).toString(16).padStart(2, "0")).join("");
}

export function fmtNumber(x: number): string {
  return Number.isInteger(x) ? x.toLocaleString("en-US") : x.toLocaleString("en-US", { maximumFractionDigits: 2 });
}

const CHOICE_TEXT: Record<string, Record<string, string>> = {
  BBB: { N: "None", LBBB: "Left", RBBB: "Right" },
  VHD: { N: "None", mild: "Mild", Moderate: "Moderate", Severe: "Severe" },
};

export function optionText(f: Feature, o: Value): string {
  if (f.type === "yesno") return o === "Y" ? "Yes" : "No";
  if (f.type === "binary") return Number(o) === 1 ? "Yes" : "No";
  return CHOICE_TEXT[f.name]?.[String(o)] ?? String(o);
}

export function displayValue(f: Feature | undefined, v: Value | null | undefined): string {
  if (v === null || v === undefined || v === "") return "not provided";
  if (!f) return String(v);
  if (f.type === "number") return `${fmtNumber(Number(v))}${f.unit ? ` ${f.unit}` : ""}`;
  return optionText(f, v);
}

export function refText(f: Feature): string {
  if (!f.ref) return "";
  const [lo, hi] = f.ref;
  const u = f.unit ? ` ${f.unit}` : "";
  if (lo === null && hi !== null) return `≤ ${fmtNumber(hi)}${u}`;
  if (hi === null && lo !== null) return `≥ ${fmtNumber(lo)}${u}`;
  if (lo !== null && lo === hi) return `${fmtNumber(lo)}${u}`;
  return `${fmtNumber(lo ?? 0)}–${fmtNumber(hi ?? 0)}${u}`;
}

export interface Status {
  key: "flag" | "ok" | "none" | "missing";
  text: string;
  dir?: "up" | "down";
}

// Clinical status of one measurement against its reference range (or presence of a finding).
export function status(f: Feature, v: Value | null | undefined): Status {
  if (v === null || v === undefined || v === "") return { key: "missing", text: "Not provided" };
  if (f.type === "number") {
    if (!f.ref) return { key: "none", text: "" };
    const [lo, hi] = f.ref;
    const x = Number(v);
    if (lo !== null && x < lo) return { key: "flag", text: "Low", dir: "down" };
    if (hi !== null && x > hi) return { key: "flag", text: "High", dir: "up" };
    return { key: "ok", text: "Normal" };
  }
  if (f.type === "yesno" || f.type === "binary") {
    if (!f.flag_if_present) return { key: "none", text: "" };
    return v === "Y" || Number(v) === 1 ? { key: "flag", text: "Present" } : { key: "ok", text: "Absent" };
  }
  if (f.name === "BBB" || f.name === "VHD") {
    return v === "N" ? { key: "ok", text: "None" } : { key: "flag", text: optionText(f, v) };
  }
  return { key: "none", text: "" };
}

export const outsideTraining = (f: Feature, v: Value | undefined) =>
  f.type === "number" && v !== undefined && f.min !== undefined && f.max !== undefined && (Number(v) < f.min || Number(v) > f.max);

// Small shared UI pieces: logo, animated numbers, segmented control, risk pill, delta chip.
import { CircleAlert, ShieldCheck, TriangleAlert } from "lucide-react";
import { animate, motion } from "motion/react";
import { type ReactNode, useId, useLayoutEffect, useRef } from "react";
import { BAND_TEXT, pp } from "../lib/format";
import type { Band } from "../types";

export function Logo({ size = 30 }: { size?: number }) {
  return (
    <svg className="logo" width={size} height={size} viewBox="0 0 32 32" aria-hidden="true">
      <defs>
        <linearGradient id="logo-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="#fb7185" />
          <stop offset="1" stopColor="#e11d48" />
        </linearGradient>
      </defs>
      <path className="logo-heart" fill="url(#logo-grad)" d="M16 28s-11-7-11-15a6 6 0 0 1 11-3.3A6 6 0 0 1 27 13c0 8-11 15-11 15z" />
      <path className="logo-ecg" d="M5.5 16h5l2-4.5 3 9 2.2-4.5h8.8" fill="none" stroke="#fff" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

const EASE = [0.22, 1, 0.36, 1] as const;

/** Number that counts smoothly to each new value (text is written directly, no re-render per frame). */
export function AnimatedNumber({ value, format, from }: { value: number; format: (v: number) => string; from?: number }) {
  const ref = useRef<HTMLSpanElement>(null);
  const prev = useRef(from ?? value);
  const fmt = useRef(format);
  fmt.current = format;
  useLayoutEffect(() => {
    const node = ref.current;
    if (!node) return;
    const start = prev.current;
    prev.current = value;
    if (start === value || window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
      node.textContent = fmt.current(value);
      return;
    }
    const controls = animate(start, value, { duration: 0.75, ease: EASE, onUpdate: (v) => { node.textContent = fmt.current(v); } });
    return () => controls.stop();
  }, [value]);
  return <span ref={ref} className="anum" />;
}

interface SegmentedProps<T extends string | number> {
  options: readonly T[];
  value: T | undefined;
  onChange: (v: T) => void;
  label: (v: T) => string;
  ariaLabel: string;
  danger?: (v: T) => boolean;
  size?: "sm" | "md";
}

/** Radio group with a sliding highlight. */
export function Segmented<T extends string | number>({ options, value, onChange, label, ariaLabel, danger, size = "md" }: SegmentedProps<T>) {
  const id = useId();
  return (
    <div className={`seg seg-${size}`} role="radiogroup" aria-label={ariaLabel}>
      {options.map((o) => {
        const on = o === value;
        return (
          <button key={String(o)} type="button" role="radio" aria-checked={on}
            className={`seg-opt${on ? " on" : ""}${on && danger?.(o) ? " danger" : ""}`} onClick={() => onChange(o)}>
            {on && <motion.span layoutId={`seg-${id}`} className="seg-thumb" transition={{ type: "spring", bounce: 0.18, duration: 0.38 }} />}
            <span className="seg-text">{label(o)}</span>
          </button>
        );
      })}
    </div>
  );
}

const BAND_ICON = { low: ShieldCheck, medium: CircleAlert, high: TriangleAlert };

export function BandPill({ band }: { band: Band }) {
  const Icon = BAND_ICON[band];
  return (
    <span className={`band band-${band}`}>
      <Icon size={13} aria-hidden="true" />
      {BAND_TEXT[band]}
    </span>
  );
}

export function Delta({ d, suffix = "vs pinned" }: { d: number; suffix?: string }) {
  const kind = d > 0.005 ? "up" : d < -0.005 ? "down" : "flat";
  return (
    <span className={`delta delta-${kind}`}>
      <i aria-hidden="true">{kind === "up" ? "▲" : kind === "down" ? "▼" : "="}</i>
      {pp(d)} <em>{suffix}</em>
    </span>
  );
}

export function Eyebrow({ children }: { children: ReactNode }) {
  return <span className="eyebrow">{children}</span>;
}

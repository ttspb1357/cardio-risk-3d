// Assessment cockpit: 3D heart | risk overview | patient, with the demo-patient strip below, then the explanation
// and breakdown sections.
import { useCallback, useEffect, useMemo, useState } from "react";
import { Breakdown, Insights, Waterfall } from "../components/Analysis";
import { Bullseye, SEGMENTS } from "../components/Bullseye";
import { HeartStage } from "../components/HeartStage";
import { OPEN_INPUTS } from "../components/Chrome";
import { InputsDrawer, PatientPanel, PatientStrip } from "../components/Patient";
import { StatGrid, TruthCard } from "../components/Risk";
import { Logo } from "../components/ui";
import { usePrediction } from "../lib/hooks";
import type { Feature, Prediction, Sample, Schema, Target, Value, Values } from "../types";

export function AssessPage({ schema, samples }: { schema: Schema; samples: Sample[] }) {
  const byName = useMemo(() => Object.fromEntries(schema.features.map((f) => [f.name, f])) as Record<string, Feature>, [schema]);
  const defaults = useMemo(() => Object.fromEntries(schema.features.map((f) => [f.name, f.default])) as Values, [schema]);
  const [sampleKey, setSampleKey] = useState("0");
  const [values, setValues] = useState<Values>(() => ({ ...samples[0].values }));
  const [edited, setEdited] = useState(false);
  const [target, setTarget] = useState<Target>("cad");
  const [pinned, setPinned] = useState<{ result: Prediction; values: Values } | null>(null);
  const [drawer, setDrawer] = useState(false);
  const [pickedSegment, setPickedSegment] = useState<number | null>(null);
  const [hoverSegment, setHoverSegment] = useState<number | null>(null);
  const { result, loading, error, latency } = usePrediction(values);

  const loadSample = (key: string) => {
    setSampleKey(key);
    setValues(key === "typical" ? { ...defaults } : { ...samples[Number(key)].values });
    setEdited(false);
    setTarget("cad");
  };
  const onChange = useCallback((name: string, v: Value | undefined) => {
    setValues((prev) => {
      const next = { ...prev };
      if (v === undefined) delete next[name];
      else next[name] = v;
      return next;
    });
    setEdited(true);
  }, []);
  const closeDrawer = useCallback(() => setDrawer(false), []);
  useEffect(() => {
    const open = () => setDrawer(true);
    window.addEventListener(OPEN_INPUTS, open);
    return () => window.removeEventListener(OPEN_INPUTS, open);
  }, []);

  if (!result) {
    return (
      <div className="splash">
        <div className="splash-logo"><Logo size={56} /></div>
        <p className="splash-text">{error ? `Prediction failed: ${error}` : "Scoring patient…"}</p>
      </div>
    );
  }

  const sample = sampleKey === "typical" ? null : samples[Number(sampleKey)];
  const changed = pinned ? schema.features.filter((f) => pinned.values[f.name] !== values[f.name]).length : 0;
  const pinnedResult = pinned?.result ?? null;
  // A segment picked on the bullseye stays highlighted only while its artery is the selected one.
  const picked = pickedSegment !== null && SEGMENTS.find((s) => s.id === pickedSegment)?.artery === target ? pickedSegment : null;
  const highlighted = hoverSegment ?? picked;

  return (
    <div className="assess">
      <div className="cockpit">
        <HeartStage result={result} target={target} onSelect={setTarget} segment={highlighted}
          loading={loading} error={error} latency={latency} pinned={pinnedResult} />
        <div className="risk-col">
          <StatGrid result={result} target={target} onSelect={setTarget} pinned={pinnedResult} />
          <Bullseye result={result} highlighted={highlighted} onHover={setHoverSegment}
            onPick={(s) => {
              const again = picked === s.id;
              setPickedSegment(again ? null : s.id);
              setTarget(again ? "cad" : s.artery);
            }} />
          {sample && !edited && <TruthCard sample={sample} result={result} />}
        </div>
        <PatientPanel schema={schema} byName={byName} samples={samples} sampleKey={sampleKey} onSample={loadSample}
          values={values} onChange={onChange} edited={edited} openDrawer={() => setDrawer(true)} />
        <PatientStrip samples={samples} sampleKey={sampleKey} onSample={loadSample} />
      </div>

      <div className="analysis">
        <Waterfall result={result} target={target} setTarget={setTarget} byName={byName} />
        <Insights result={result} target={target} byName={byName} pinned={pinnedResult} changed={changed}
          onPin={() => setPinned(pinned ? null : { result, values })} />
      </div>

      <Breakdown schema={schema} values={values} result={result} />

      <InputsDrawer open={drawer} onClose={closeDrawer} schema={schema} values={values} onChange={onChange}
        onTypical={() => loadSample("typical")} />
    </div>
  );
}

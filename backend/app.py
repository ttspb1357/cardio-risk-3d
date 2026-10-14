"""FastAPI backend: predictions with explanations, model metrics, and the static frontend."""
import json
import math
import sys
from pathlib import Path

import joblib
import numpy as np
import pandas as pd
from fastapi import Body, FastAPI, HTTPException
from fastapi.responses import HTMLResponse
from fastapi.staticfiles import StaticFiles

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT / "ml"))

from data import encode  # noqa: E402

ARTIFACTS = ROOT / "ml" / "artifacts"
DISCLAIMER = "For decision support / educational use only. Not a substitute for diagnostic imaging."
TARGETS = ["cad", "LAD", "LCX", "RCA"]
VESSELS = TARGETS[1:]

if not (ARTIFACTS / "models.joblib").exists():
    raise SystemExit("Model artifacts missing. Run: python ml/evaluate.py && python ml/train.py")

bundle = joblib.load(ARTIFACTS / "models.joblib")
MODELS = bundle["models"]
SCHEMA = json.loads((ARTIFACTS / "features.json").read_text())
# Display metadata (labels, units, groups, reference ranges) is read live from ml/feature_meta.json,
# so wording fixes never require retraining. Types, options and ranges come from training (features.json).
_META = json.loads((ROOT / "ml" / "feature_meta.json").read_text(encoding="utf-8"))
SCHEMA["groups"] = _META["groups"]
for _f in SCHEMA["features"]:
    _m = _META["features"].get(_f["name"], {})
    _f.update(label=_m.get("label", _f["name"]), unit=_m.get("unit"), group=_m.get("group", "Other"),
              ref=_m.get("ref"), desc=_m.get("desc"), flag_if_present=_m.get("flag_if_present", False))
FEATURES = {f["name"]: f for f in SCHEMA["features"]}
METRICS = json.loads((ARTIFACTS / "metrics.json").read_text())
SAMPLES = json.loads((ARTIFACTS / "samples.json").read_text())
# Evaluation results are read straight from evaluate.py's output, so re-summarising them needs no retraining.
if (ARTIFACTS / "nested_cv.json").exists():
    _nested = json.loads((ARTIFACTS / "nested_cv.json").read_text())
    METRICS["protocol"]["nested"] = _nested["protocol"]
    for _t in TARGETS:
        METRICS["targets"][_t]["nested"] = _nested["targets"][_t]
FRONTEND = ROOT / "frontend" / "dist"

app = FastAPI(title="Cardio Risk 3D", description=DISCLAIMER)


def risk_band(p: float) -> str:
    return "low" if p < 0.35 else "medium" if p <= 0.65 else "high"


def validate(patient: dict) -> dict:
    """Reject unknown keys and out-of-domain values; blanks become None (imputed by the model)."""
    unknown = [k for k in patient if k not in FEATURES]
    if unknown:
        raise HTTPException(422, f"Unknown or disallowed features: {unknown}")
    clean, errors = {}, []
    for k, v in patient.items():
        f = FEATURES[k]
        if v is None or v == "":
            clean[k] = None
        elif f["type"] == "number":
            try:
                x = float(v)
            except (TypeError, ValueError):
                errors.append(f"{k}: expected a number")
                continue
            if not math.isfinite(x) or x < 0:
                errors.append(f"{k}: must be a non-negative number")
                continue
            clean[k] = x
        else:
            opts = f["options"]
            match = next((o for o in opts if str(o) == str(v)), None)
            if match is None:
                errors.append(f"{k}: must be one of {opts}")
            clean[k] = match
    if errors:
        raise HTTPException(422, "; ".join(errors))
    return clean


def contributions(phi_row: np.ndarray, columns, shown: dict):
    per = {}
    for name, v in zip(columns, phi_row):
        key = "BBB" if name.startswith("BBB_") else name
        per[key] = per.get(key, 0.0) + float(v)
    rows = [{"feature": k, "value": shown.get(k), "contribution": round(v, 5)} for k, v in per.items()]
    return sorted(rows, key=lambda r: abs(r["contribution"]), reverse=True)


@app.post("/predict")
def predict(patient: dict = Body(...)):
    clean = validate(patient)
    X = encode(pd.DataFrame([{k: v for k, v in clean.items() if v is not None}] or [{}]))
    shown = {k: v for k, v in clean.items() if v is not None}
    out = {}
    for t in TARGETS:
        m = MODELS[t]
        p, p0, phi = m["model"].explain(X)
        out[t] = {"probability": float(p[0]), "baseline": float(p0), "risk": risk_band(float(p[0])),
                  "explanation": contributions(phi[0], X.columns, shown)}
    cad = out["cad"]
    thr = MODELS["cad"]["threshold"]
    return {
        "cad": {"probability": cad["probability"], "baseline": cad["baseline"], "risk": cad["risk"],
                "threshold": thr, "label": "CAD" if cad["probability"] >= thr else "Normal"},
        "vessels": {v: {k: out[v][k] for k in ("probability", "baseline", "risk")} | {"threshold": MODELS[v]["threshold"]}
                    for v in VESSELS},
        "explanations": {t: out[t]["explanation"] for t in TARGETS},
        "imputed_features": [n for n in FEATURES if clean.get(n) is None],
        "disclaimer": DISCLAIMER,
    }


@app.get("/features")
def features():
    return SCHEMA


@app.get("/metrics")
def metrics():
    return METRICS


@app.get("/samples")
def samples():
    return SAMPLES


@app.get("/health")
def health():
    return {"status": "ok", "targets": TARGETS}


# Warm up the models (first SHAP calls are slow) so the first real request is fast.
predict({})

# Frontend: the production build of frontend/ (cd frontend && npm ci && npm run build).
# Mounted last so the API routes above take precedence.
if FRONTEND.exists():
    app.mount("/", StaticFiles(directory=FRONTEND, html=True), name="frontend")
else:
    @app.get("/", response_class=HTMLResponse)
    def frontend_missing():
        return ("<h1>Frontend not built</h1><p>Run <code>cd frontend</code>, <code>npm ci</code>, "
                "<code>npm run build</code>, then restart the server. The API is running.</p>")

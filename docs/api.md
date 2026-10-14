# API contract

The backend, ML and frontend all rely on this shape. Change it only by agreement.

## POST /predict

Request: JSON of patient inputs, keyed by dataset column name (see `GET /features`). Any input can be
left out or sent as `null`/`""`; the model imputes it and lists it in `imputed_features`.
Unknown keys (including the targets `LAD`, `LCX`, `RCA`, `Cath`) and out-of-domain values return **422**.

```json
{ "Age": 55, "Sex": "Male", "BP": 140, "Typical Chest Pain": 1, "DLP": "Y", "VHD": "mild" }
```

Response (probabilities are 0 to 1; `contribution` is in probability units, so 0.042 = +4.2 percentage points):

```json
{
  "cad": { "probability": 0.82, "baseline": 0.70, "risk": "high", "threshold": 0.62, "label": "CAD" },
  "vessels": {
    "LAD": { "probability": 0.78, "baseline": 0.55, "risk": "high", "threshold": 0.45 },
    "LCX": { "probability": 0.31, "baseline": 0.38, "risk": "low", "threshold": 0.40 },
    "RCA": { "probability": 0.55, "baseline": 0.37, "risk": "medium", "threshold": 0.38 }
  },
  "explanations": {
    "cad": [ { "feature": "Typical Chest Pain", "value": 1, "contribution": 0.091 } ],
    "LAD": [], "LCX": [], "RCA": []
  },
  "imputed_features": [],
  "disclaimer": "For decision support / educational use only. Not a substitute for diagnostic imaging."
}
```

- `baseline` is the average patient's risk; `baseline + sum(contribution) == probability` for every target.
- `explanations[target]` lists every input, sorted by absolute contribution.
- Risk bands: low < 0.35, medium 0.35 to 0.65, high > 0.65. `label` uses the tuned decision `threshold`.

## GET /features
`{ "groups": [...], "key_inputs": [...], "features": [ {name, type, options|min/max, default, label, unit, group, ref, desc, flag_if_present} ] }`.
`type` is one of `number`, `choice`, `yesno` (`"Y"`/`"N"`), `binary` (`1`/`0`). Display metadata comes from `ml/feature_meta.json`.

## GET /metrics
Per target: deployed model description, threshold, calibration, feature importance, the final selection
leaderboard, and `nested` (repeated nested-CV results: pooled metrics with 95% CIs, per-fold mean ± SD, ROC points,
calibration bins and calibration error, confusion matrix, selection stability, baselines with AUC, Brier and calibration
error). `nested` is read live from `ml/artifacts/nested_cv.json`.

## GET /samples
Six demo patients (excluded from the deployed model's training data) with their recorded angiography results.

## GET /health
`{ "status": "ok" }`

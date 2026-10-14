"""Train the deployed models and write every artifact the app needs.

- Runs the selection procedure (selection.py, 5x5 repeated CV) on all patients except the six demo
  patients, fits the chosen recipes, and saves them.
- Performance numbers shown in the app come from evaluate.py (repeated nested CV of this exact
  procedure) and are merged into metrics.json here. Run evaluate.py first.

Usage:  python ml/evaluate.py   (slow, ~25 min on 20 cores)
        python ml/train.py      (~3 min)
"""
import json
import warnings

import joblib
import numpy as np

from data import ARTIFACTS, BBB_VALUES, VHD_LEVELS, YES_NO_COLUMNS, demo_indices, load_xy, strata
from recipes import readable
from selection import TARGETS, fit_final, select

warnings.filterwarnings("ignore")
META = json.loads((ARTIFACTS.parent / "feature_meta.json").read_text(encoding="utf-8"))
NON_INPUTS = ("Cath", "LAD", "LCX", "RCA", "Exertional CP")


def collapse_bbb(names, phi):
    """Sum the one-hot BBB columns back into the original 'BBB' feature."""
    out = {}
    for j, n in enumerate(names):
        key = "BBB" if n.startswith("BBB_") else n
        out[key] = out.get(key, 0) + phi[:, j]
    return out


def main():
    raw, X, ys = load_xy()
    demo = demo_indices(ys)
    idx = np.setdiff1d(np.arange(len(X)), demo)
    nested_path = ARTIFACTS / "nested_cv.json"
    nested = json.loads(nested_path.read_text()) if nested_path.exists() else None
    if nested is None:
        print("WARNING: nested_cv.json missing; run ml/evaluate.py for performance numbers")

    sel = select(X, ys, idx)
    models, report = {}, {}
    for t in TARGETS:
        model = fit_final(sel[t], t, X, ys, idx)
        _, p0, phi = model.explain(X.iloc[idx])
        imp = collapse_bbb(X.columns, phi)
        importance = sorted(({"feature": k, "mean_abs": float(np.mean(np.abs(v)))} for k, v in imp.items()),
                            key=lambda r: r["mean_abs"], reverse=True)
        models[t] = {"model": model, "threshold": sel[t]["threshold"], "baseline": float(p0)}
        report[t] = {
            "config": sel[t]["chosen"], "description": readable(sel[t]["chosen"], t),
            "calibrated": sel[t]["calibrated"], "threshold": sel[t]["threshold"], "baseline_risk": float(p0),
            "positive_rate": float(ys[t][idx].mean()), "selection_cv": sel[t]["cv"],
            "leaderboard": sel[t]["leaderboard"][:10], "n_configs_tried": sel[t]["n_configs"],
            "importance": importance[:15],
            "nested": nested["targets"][t] if nested else None,
        }
        print(f"{t:4s} {sel[t]['chosen']:60s} cal={sel[t]['calibrated']!s:5s} thr={sel[t]['threshold']:.2f} "
              f"selection-CV AUC {sel[t]['cv']['roc_auc']:.3f}")

    joblib.dump({"models": models, "feature_names": list(X.columns)}, ARTIFACTS / "models.joblib")
    (ARTIFACTS / "metrics.json").write_text(json.dumps({
        "protocol": {
            "n_total": len(X), "n_deploy_train": len(idx), "n_demo": len(demo),
            "nested": nested["protocol"] if nested else None,
            "summary": ("Performance is estimated with repeated nested cross-validation: the entire pipeline "
                        "(model selection, calibration and threshold) is re-run inside every outer fold, so each "
                        "patient is scored by a model that never saw them. The deployed model is the same "
                        "pipeline fitted on all patients except the six demo patients."),
        },
        "targets": report}, indent=2))
    write_feature_schema(raw, report["cad"]["importance"])
    write_samples(raw, ys, demo)
    print("saved artifacts to", ARTIFACTS)


def write_feature_schema(raw, cad_importance):
    """Input schema + display metadata for the frontend (single source of truth: feature_meta.json)."""
    features = []
    for col in raw.columns:
        if col in NON_INPUTS:
            continue
        s, meta = raw[col], META["features"].get(col, {})
        if col == "Sex":
            spec = {"type": "choice", "options": ["Male", "Female"], "default": "Male"}
        elif col in YES_NO_COLUMNS:
            spec = {"type": "yesno", "options": ["N", "Y"], "default": s.mode()[0]}
        elif col == "VHD":
            spec = {"type": "choice", "options": list(VHD_LEVELS), "default": s.mode()[0]}
        elif col == "BBB":
            spec = {"type": "choice", "options": BBB_VALUES, "default": s.mode()[0]}
        elif set(s.unique()) <= {0, 1}:
            spec = {"type": "binary", "options": [0, 1], "default": int(s.mode()[0])}
        else:
            spec = {"type": "number", "min": float(s.min()), "max": float(s.max()), "default": float(s.median()),
                    "integer": bool((s % 1 == 0).all())}
        features.append({"name": col, **spec, "label": meta.get("label", col), "unit": meta.get("unit"),
                         "group": meta.get("group", "Other"), "ref": meta.get("ref"), "desc": meta.get("desc"),
                         "flag_if_present": meta.get("flag_if_present", False)})
    key_inputs = [r["feature"] for r in cad_importance[:8]]
    (ARTIFACTS / "features.json").write_text(json.dumps(
        {"groups": META["groups"], "key_inputs": key_inputs, "features": features}, indent=2))


def write_samples(raw, ys, demo):
    inputs = [c for c in raw.columns if c not in NON_INPUTS]
    names = {0: "no stenosis", 1: "1-vessel disease", 2: "2-vessel disease", 3: "3-vessel disease"}
    n_vessels = strata(ys)
    samples = []
    for i in sorted(demo, key=lambda i: (n_vessels[i], i)):
        row = {c: (v.item() if hasattr(v, "item") else v) for c, v in raw.loc[i, inputs].items()}
        row["Sex"] = "Female" if row["Sex"] == "Fmale" else row["Sex"]
        samples.append({"id": int(i), "label": f"Patient #{i} · {names[n_vessels[i]]}", "values": row,
                        "truth": {"cad": raw.loc[i, "Cath"], "LAD": raw.loc[i, "LAD"],
                                  "LCX": raw.loc[i, "LCX"], "RCA": raw.loc[i, "RCA"]}})
    (ARTIFACTS / "samples.json").write_text(json.dumps(samples, indent=2))


if __name__ == "__main__":
    main()

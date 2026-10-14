"""Repeated nested cross-validation of the WHOLE pipeline (selection + calibration + threshold).

Outer loop: 5-fold x 3 repeats over all 303 patients. In every outer fold the complete selection
procedure (selection.select) runs on the outer-training patients only; the resulting model is then
scored on the outer-test patients it never saw. Every patient is therefore predicted out-of-sample
once per repeat, and no modelling decision ever sees the patients it is scored on.

Two fixed baselines are scored in exactly the same outer folds for comparison.

Output: ml/artifacts/nested_cv.json (+ nested_cv_preds.joblib with the raw predictions).
"""
import json
import sys
import time
import warnings

import joblib
import numpy as np
from sklearn.metrics import brier_score_loss
from sklearn.model_selection import RepeatedStratifiedKFold

from data import ARTIFACTS, load_xy, strata
from models import BASELINES, CANDIDATES, SEED
from recipes import readable
from scoring import calibration_bins, calibration_error, roc_points, threshold_metrics
from selection import TARGETS, fit_final, select

OUTER_SPLITS, OUTER_REPEATS = 5, 3
INNER_SPLITS, INNER_REPEATS = 5, 2
N_BOOT = 1000


def bootstrap_ci(y, p, pred, patient, n=N_BOOT, seed=SEED):
    """Patient-level stratified bootstrap over pooled out-of-fold predictions (all repeats of a patient move together)."""
    rng = np.random.default_rng(seed)
    ids = np.unique(patient)
    label = {i: y[patient == i][0] for i in ids}
    pos = np.array([i for i in ids if label[i] == 1])
    neg = np.array([i for i in ids if label[i] == 0])
    rows_of = {i: np.where(patient == i)[0] for i in ids}
    draws = []
    for _ in range(n):
        chosen = np.concatenate([rng.choice(pos, len(pos)), rng.choice(neg, len(neg))])
        r = np.concatenate([rows_of[i] for i in chosen])
        draws.append(threshold_metrics(y[r], p[r], pred[r]))
    point = threshold_metrics(y, p, pred)
    return {k: {"value": float(point[k]), "lo": float(np.percentile([d[k] for d in draws], 2.5)),
                "hi": float(np.percentile([d[k] for d in draws], 97.5))} for k in point}


def run(X, ys, t0):
    outer = list(RepeatedStratifiedKFold(n_splits=OUTER_SPLITS, n_repeats=OUTER_REPEATS,
                                         random_state=SEED).split(X, strata(ys)))
    rec = {t: {"p": [], "pred": [], "y": [], "patient": [], "repeat": [], "chosen": [], "fold_metrics": []} for t in TARGETS}
    base = {name: {t: {"p": [], "y": [], "fold_auc": []} for t in TARGETS} for name in BASELINES}

    for k, (tr, te) in enumerate(outer):
        sel = select(X, ys, tr, INNER_SPLITS, INNER_REPEATS, seed=SEED + k + 1)
        for t in TARGETS:
            model = fit_final(sel[t], t, X, ys, tr)
            p = model.predict(X.iloc[te])
            pred = (p >= sel[t]["threshold"]).astype(int)
            r = rec[t]
            r["p"].append(p); r["pred"].append(pred); r["y"].append(ys[t][te]); r["patient"].append(te)
            r["repeat"].append(np.full(len(te), k // OUTER_SPLITS)); r["chosen"].append(sel[t]["chosen"])
            r["fold_metrics"].append(threshold_metrics(ys[t][te], p, pred))
            for name, cfg in BASELINES.items():
                bp = CANDIDATES[cfg]().fit(X.iloc[tr], ys[t][tr]).predict_proba(X.iloc[te])[:, 1]
                b = base[name][t]
                b["p"].append(bp); b["y"].append(ys[t][te])
                b["fold_auc"].append(threshold_metrics(ys[t][te], bp, (bp >= 0.5).astype(int))["roc_auc"])
        print(f"outer fold {k + 1}/{len(outer)} done ({time.time() - t0:.0f}s): "
              + ", ".join(f"{t}={rec[t]['fold_metrics'][-1]['roc_auc']:.3f}" for t in TARGETS), flush=True)
    return rec, base, outer


def summarize(rec, base, n_patients, n_outer):
    summary = {"protocol": {
        "outer": f"{OUTER_SPLITS}-fold x {OUTER_REPEATS}-repeat stratified CV over all {n_patients} patients",
        "inner": f"{INNER_SPLITS}-fold x {INNER_REPEATS}-repeat stratified CV inside each outer training set",
        "n_patients": n_patients, "n_outer_folds": n_outer}, "targets": {}}
    for t in TARGETS:
        r = {k: (np.concatenate(v) if k in ("p", "pred", "y", "patient", "repeat") else v) for k, v in rec[t].items()}
        fm = r["fold_metrics"]
        per_fold = {k: {"mean": float(np.mean([m[k] for m in fm])), "sd": float(np.std([m[k] for m in fm]))} for k in fm[0]}
        first = r["repeat"] == 0
        cm = {"tn": int(((r["y"] == 0) & (r["pred"] == 0) & first).sum()), "fp": int(((r["y"] == 0) & (r["pred"] == 1) & first).sum()),
              "fn": int(((r["y"] == 1) & (r["pred"] == 0) & first).sum()), "tp": int(((r["y"] == 1) & (r["pred"] == 1) & first).sum())}
        chosen, counts = np.unique(r["chosen"], return_counts=True)
        baselines = {}
        for name in BASELINES:
            b = base[name][t]
            yb, pb = np.concatenate(b["y"]), np.concatenate(b["p"])
            baselines[name] = {"roc_auc": {"mean": float(np.mean(b["fold_auc"])), "sd": float(np.std(b["fold_auc"]))},
                               "brier": float(brier_score_loss(yb, pb)), "calibration_error": calibration_error(yb, pb)}
        summary["targets"][t] = {
            "pooled": bootstrap_ci(r["y"], r["p"], r["pred"], r["patient"]),
            "per_fold": per_fold,
            "roc": roc_points(r["y"], r["p"]),
            "calibration": calibration_bins(r["y"], r["p"], 10),
            "calibration_error": calibration_error(r["y"], r["p"]),
            "confusion_repeat1": cm,
            "selected_configs": sorted(({"config": c, "description": readable(c, t), "folds": int(n)}
                                        for c, n in zip(chosen, counts)), key=lambda d: -d["folds"]),
            "baselines": baselines,
        }
        pa = summary["targets"][t]["pooled"]["roc_auc"]
        print(f"{t:4s} nested AUC {per_fold['roc_auc']['mean']:.3f} ± {per_fold['roc_auc']['sd']:.3f} "
              f"(pooled {pa['value']:.3f} [{pa['lo']:.3f}-{pa['hi']:.3f}])  "
              + "  ".join(f"{n.split(' (')[0]} {v['roc_auc']['mean']:.3f}" for n, v in baselines.items()))
    return summary


def main():
    """python ml/evaluate.py [--quick | --summarize]
    --quick      tiny fold counts, smoke test only (numbers are not meaningful)
    --summarize  rebuild nested_cv.json from the saved predictions without refitting anything
    """
    global OUTER_SPLITS, OUTER_REPEATS, INNER_SPLITS, INNER_REPEATS, N_BOOT
    if "--quick" in sys.argv:
        OUTER_SPLITS, OUTER_REPEATS, INNER_SPLITS, INNER_REPEATS, N_BOOT = 3, 1, 3, 1, 50
    warnings.filterwarnings("ignore")
    t0 = time.time()
    _, X, ys = load_xy()
    preds_path = ARTIFACTS / "nested_cv_preds.joblib"
    if "--summarize" in sys.argv:
        saved = joblib.load(preds_path)
        rec, base, outer = saved["records"], saved["baselines"], saved["outer"]
    else:
        rec, base, outer = run(X, ys, t0)
        joblib.dump({"records": rec, "baselines": base, "outer": outer}, preds_path)
    summary = summarize(rec, base, len(X), len(outer))
    (ARTIFACTS / "nested_cv.json").write_text(json.dumps(summary, indent=2))
    print(f"done in {time.time() - t0:.0f}s")


if __name__ == "__main__":
    main()

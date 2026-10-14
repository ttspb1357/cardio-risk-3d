"""The model-selection procedure, runnable on any subset of patients.

Given training rows `idx`, it:
  1. scores every candidate in models.CANDIDATES with repeated stratified K-fold CV, for
       cad, LAD/LCX/RCA directly, and LAD/LCX/RCA given CAD (trained on CAD patients only);
  2. also scores factorised vessels, P(CAD) x P(vessel | CAD), and soft-voting ensembles
     (both computed from the stored fold predictions, no refitting);
  3. picks one configuration per target with the one-standard-error rule, preferring simpler
     configurations (single < factorised < ensemble) among those within 1 SE of the best AUC;
  4. decides on Platt calibration (kept only if it lowers the cross-fitted Brier score) and a
     decision threshold (Youden's J), both from the same out-of-fold predictions.

evaluate.py runs this inside every outer fold of nested CV; train.py runs it once on the
deployment data.
"""
import itertools
import warnings

import numpy as np
from joblib import Parallel, delayed
from sklearn.metrics import brier_score_loss, roc_auc_score
from sklearn.model_selection import RepeatedStratifiedKFold

from composite import Calibrated, apply_platt, fit_platt
from data import strata
from models import CANDIDATES, SEED
from recipes import build, stored_fold_preds
from scoring import cross_fitted_platt, threshold_metrics, youden_threshold

TARGETS = ["cad", "LAD", "LCX", "RCA"]
VESSELS = TARGETS[1:]


def _fold_job(name, tr, te, X, ys):
    warnings.filterwarnings("ignore")
    make = CANDIDATES[name]
    out = {t: make().fit(X.iloc[tr], ys[t][tr]).predict_proba(X.iloc[te])[:, 1] for t in TARGETS}
    cad_pos = tr[ys["cad"][tr] == 1]
    for v in VESSELS:
        out[f"{v}|cad"] = make().fit(X.iloc[cad_pos], ys[v][cad_pos]).predict_proba(X.iloc[te])[:, 1]
    return name, out


def candidate_predictions(X, ys, idx, n_splits, n_repeats, seed):
    cv = RepeatedStratifiedKFold(n_splits=n_splits, n_repeats=n_repeats, random_state=seed)
    folds = [(idx[a], idx[b]) for a, b in cv.split(idx, strata(ys)[idx])]
    jobs = [delayed(_fold_job)(n, tr, te, X, ys) for n in CANDIDATES for tr, te in folds]
    preds = {n: {} for n in CANDIDATES}
    for name, out in Parallel(n_jobs=-1)(jobs):  # results come back in job order
        for k, p in out.items():
            preds[name].setdefault(k, []).append(p)
    return preds, folds


def _scores(fold_p, folds, y):
    aucs = [roc_auc_score(y[te], p) for (_, te), p in zip(folds, fold_p)]
    return {"auc": float(np.mean(aucs)), "auc_se": float(np.std(aucs) / np.sqrt(len(aucs))),
            "brier": float(np.mean([brier_score_loss(y[te], p) for (_, te), p in zip(folds, fold_p)]))}


def _complexity(config):
    return 2 if config.startswith("ensemble") else 1 if config.startswith("factorised") else 0


def _family(part):
    return part.split(":")[-1].split("*")[0].split("_")[0]


def score_configs(preds, folds, ys):
    board = {t: {} for t in TARGETS}
    for n in CANDIDATES:
        board["cad"][n] = _scores(preds[n]["cad"], folds, ys["cad"])
        for v in VESSELS:
            board[v][f"direct:{n}"] = _scores(preds[n][v], folds, ys[v])
    top = lambda scores, k: sorted(scores, key=lambda c: scores[c]["auc"], reverse=True)[:k]
    for v in VESSELS:
        for c in top(board["cad"], 5):
            for n in CANDIDATES:
                cfg = f"factorised:{c}*{n}"
                board[v][cfg] = _scores(stored_fold_preds(preds, v, cfg), folds, ys[v])
    for t in TARGETS:
        singles = top(board[t], 8)
        for k in (2, 3):
            for combo in itertools.combinations(singles, k):
                if len({_family(m) for m in combo}) == k:
                    cfg = "ensemble:" + "+".join(combo)
                    board[t][cfg] = _scores(stored_fold_preds(preds, t, cfg), folds, ys[t])
    return board


def choose(scores):
    ranked = sorted(scores, key=lambda c: scores[c]["auc"], reverse=True)
    best = scores[ranked[0]]
    within = [c for c in ranked if scores[c]["auc"] >= best["auc"] - best["auc_se"]]
    return min(within, key=lambda c: (_complexity(c), -scores[c]["auc"])), ranked


def postprocess(fold_p, folds, y):
    """Calibration decision, Platt parameters and threshold from out-of-fold predictions."""
    oof_p = np.concatenate(fold_p)
    oof_y = np.concatenate([y[te] for _, te in folds])
    brier_raw = brier_score_loss(oof_y, oof_p)
    brier_cal = brier_score_loss(oof_y, cross_fitted_platt(oof_p, oof_y))
    calibrate = bool(brier_cal < brier_raw)
    platt = fit_platt(oof_p, oof_y) if calibrate else (1.0, 0.0)
    oof_cal = apply_platt(oof_p, *platt) if calibrate else oof_p
    thr = youden_threshold(oof_y, oof_cal)
    folds_m = []
    start = 0
    for (_, te), p in zip(folds, fold_p):
        q = oof_cal[start:start + len(p)]
        start += len(p)
        folds_m.append(threshold_metrics(y[te], q, (q >= thr).astype(int)))
    cv = {k: float(np.mean([m[k] for m in folds_m])) for k in folds_m[0]}
    cv["roc_auc_sd"] = float(np.std([m["roc_auc"] for m in folds_m]))
    return {"calibrated": calibrate, "platt": [float(x) for x in platt], "threshold": thr, "cv": cv,
            "brier_oof_raw": float(brier_raw), "brier_oof_calibrated": float(brier_cal)}


def select(X, ys, idx, n_splits=5, n_repeats=5, seed=SEED):
    warnings.filterwarnings("ignore")
    preds, folds = candidate_predictions(X, ys, idx, n_splits, n_repeats, seed)
    board = score_configs(preds, folds, ys)
    out = {}
    for t in TARGETS:
        chosen, ranked = choose(board[t])
        out[t] = {"chosen": chosen, "n_configs": len(board[t]),
                  "leaderboard": [{"config": c, **{k: round(v, 4) for k, v in board[t][c].items()}} for c in ranked[:15]],
                  **postprocess(stored_fold_preds(preds, t, chosen), folds, ys[t])}
    return out


def fit_final(sel_t, target, X, ys, idx):
    """Fit the chosen recipe on rows `idx` and wrap it with the chosen calibration."""
    model = build(sel_t["chosen"], target, X, ys, idx)
    return Calibrated(model, *sel_t["platt"]) if sel_t["calibrated"] else model

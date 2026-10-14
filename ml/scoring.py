"""Metric helpers shared by selection, evaluation and training."""
import numpy as np
from sklearn.metrics import (accuracy_score, brier_score_loss, f1_score, precision_score, recall_score,
                             roc_auc_score, roc_curve)
from sklearn.model_selection import StratifiedKFold

from composite import apply_platt, fit_platt

SEED = 42


def threshold_metrics(y, p, pred):
    """Classification metrics given probabilities `p` and binary decisions `pred`."""
    return {"roc_auc": roc_auc_score(y, p), "brier": brier_score_loss(y, p),
            "accuracy": accuracy_score(y, pred), "sensitivity": recall_score(y, pred, zero_division=0),
            "specificity": recall_score(1 - y, 1 - pred, zero_division=0),
            "precision": precision_score(y, pred, zero_division=0), "f1": f1_score(y, pred, zero_division=0)}


def youden_threshold(y, p):
    """Threshold maximising sensitivity + specificity - 1."""
    fpr, tpr, thr = roc_curve(y, p)
    return float(np.clip(thr[np.argmax(tpr - fpr)], 0.01, 0.99))


def cross_fitted_platt(p, y, seed=SEED):
    """Out-of-sample Platt-calibrated probabilities (used only to decide whether calibration helps)."""
    out = np.empty_like(p)
    for tr, te in StratifiedKFold(5, shuffle=True, random_state=seed).split(p, y):
        out[te] = apply_platt(p[te], *fit_platt(p[tr], y[tr]))
    return out


def roc_points(y, p, max_points=80):
    fpr, tpr, _ = roc_curve(y, p)
    keep = np.unique(np.linspace(0, len(fpr) - 1, min(max_points, len(fpr))).round().astype(int))
    return [[round(float(fpr[i]), 4), round(float(tpr[i]), 4)] for i in keep]


def calibration_error(y, p, n_bins=10):
    """Expected calibration error: |mean predicted - observed rate| per quantile bin, weighted by bin size."""
    bins = calibration_bins(y, p, n_bins)
    return float(sum(abs(b["pred"] - b["obs"]) * b["n"] for b in bins) / len(y))


def calibration_bins(y, p, n_bins=10):
    """Quantile bins: mean predicted risk vs observed rate per bin."""
    edges = np.unique(np.quantile(p, np.linspace(0, 1, n_bins + 1)))
    ids = np.clip(np.searchsorted(edges[1:-1], p, side="right"), 0, len(edges) - 2)
    return [{"pred": round(float(p[ids == b].mean()), 4), "obs": round(float(y[ids == b].mean()), 4),
             "n": int((ids == b).sum())} for b in range(len(edges) - 1) if (ids == b).any()]

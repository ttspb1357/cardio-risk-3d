"""Turn a configuration string chosen by experiments.py into predictions or a fitted model.

Config grammar (per target):
    <model>                                 single model (CAD target)
    direct:<model>                          vessel label modelled directly
    factorised:<cad_model>*<cond_model>     P(CAD) x P(vessel | CAD)
    ensemble:<part>+<part>[+<part>]         mean of parts
where <model> is a key of models.CANDIDATES.
"""
import numpy as np

from composite import Ensemble, Factorised, Member
from models import CANDIDATES

NAMES = {"logreg": "logistic regression", "svm": "SVM", "rf": "random forest", "extratrees": "extra trees",
         "xgb": "XGBoost", "histgb": "hist. gradient boosting", "catboost": "CatBoost"}


def parts(config):
    body = config.split(":", 1)[1] if config.startswith("ensemble:") else config
    return body.split("+") if config.startswith("ensemble:") else [config]


def _split(part):
    """-> ('single', model) | ('factorised', cad_model, cond_model)"""
    kind, _, rest = part.partition(":") if ":" in part else ("direct", "", part)
    if kind == "factorised":
        cad, cond = rest.split("*")
        return ("factorised", cad, cond)
    return ("single", rest)


def stored_fold_preds(preds, target, config):
    """Recombine the per-fold test predictions saved by experiments.py for any config."""
    out = []
    for p in parts(config):
        s = _split(p)
        if s[0] == "factorised":
            out.append([a * b for a, b in zip(preds[s[1]]["cad"], preds[s[2]][f"{target}|cad"])])
        else:
            out.append(preds[s[1]][target])
    return [np.mean(f, axis=0) for f in zip(*out)]


def build(config, target, X, ys, idx):
    """Fit the recipe on rows `idx`; returns a composite model with predict()/explain()."""
    Xb = X.iloc[idx]
    fitted = []
    for p in parts(config):
        s = _split(p)
        if s[0] == "factorised":
            cad = Member(CANDIDATES[s[1]]().fit(Xb, ys["cad"][idx]), Xb)
            pos = idx[ys["cad"][idx] == 1]
            cond = Member(CANDIDATES[s[2]]().fit(X.iloc[pos], ys[target][pos]), X.iloc[pos])
            fitted.append(Factorised(cad, cond))
        else:
            fitted.append(Member(CANDIDATES[s[1]]().fit(Xb, ys[target][idx]), Xb))
    return fitted[0] if len(fitted) == 1 else Ensemble(fitted)


TOKENS = [("leaf", "min leaf "), ("mf", "max features "), ("C", "C="), ("d", "depth ")]


def readable(config, target):
    def model(name):
        fam, *rest = name.split("_")
        words = []
        for tok in rest:
            if tok in ("l1", "l2"):
                words.append(tok.upper())
                continue
            for pre, rep in TOKENS:
                if tok.startswith(pre) and tok[len(pre):][:1].isdigit():
                    words.append(rep + tok[len(pre):])
                    break
            else:
                words.append(tok)
        return f"{NAMES.get(fam, fam)} ({', '.join(words)})" if words else NAMES.get(fam, fam)

    def part(p):
        s = _split(p)
        if s[0] == "factorised":
            return f"P(CAD) by {model(s[1])} × P({target} | CAD) by {model(s[2])}"
        return model(s[1])

    ps = parts(config)
    return part(ps[0]) if len(ps) == 1 else "Average of: " + "; ".join(part(p) for p in ps)

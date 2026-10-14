"""Deployable risk models with exact, additive explanations in probability units.

Every model here exposes:
    predict(X)  -> probabilities, shape (n,)
    explain(X)  -> (p, p0, phi) where phi has shape (n, n_features) and
                   p = p0 + phi.sum(axis=1)   (exactly, up to float error)
p0 is the risk of the "average patient" (the model's baseline) and phi[i, j] is how many probability
points feature j moved patient i away from that baseline.

Building blocks
- Member:     one fitted sklearn pipeline + exact SHAP (TreeExplainer / LinearExplainer). SHAP values
              computed in log-odds are rescaled to probability points so they sum to p - p0.
- Ensemble:   mean of models -> mean of explanations (SHAP is linear).
- Factorised: P(vessel) = P(CAD) * P(vessel | CAD). The product is split between the two factors with
              the exact two-player Shapley rule, then passed down to features.
- Calibrated: Platt scaling on the logit of the raw probability; explanations rescaled so they still
              sum to the calibrated probability.
"""
import numpy as np
import shap

EPS = 1e-6


def _sigmoid(z):
    return 1.0 / (1.0 + np.exp(-z))


def _logit(p):
    p = np.clip(p, EPS, 1 - EPS)
    return np.log(p / (1 - p))


def _rescale(phi, new_delta, old_delta, slope):
    """Rescale contributions from one scale to another so they sum to new_delta (monotone transforms only)."""
    safe = np.abs(old_delta) > 1e-9
    ratio = np.where(safe, new_delta / np.where(safe, old_delta, 1.0), slope)
    return phi * ratio[:, None]


def _positive_class(values):
    if isinstance(values, list):
        values = values[-1]
    values = np.asarray(values, dtype=float)
    return values[:, :, -1] if values.ndim == 3 else values


class Member:
    def __init__(self, pipeline, X_background):
        self.pipeline = pipeline
        # Linear SHAP needs the background data; tree SHAP (path-dependent) does not.
        self.background = pipeline[:-1].transform(X_background) if hasattr(pipeline[-1], "coef_") else None
        self._build_explainer()
        # Detect whether SHAP explains the probability directly (random forests) or the log-odds.
        sample = X_background.iloc[:5]
        p = self.predict(sample)
        vals, base = self._raw(sample)
        self.margin = not np.allclose(base + vals.sum(1), p, atol=1e-3)
        if self.margin:
            assert np.allclose(base + vals.sum(1), _logit(p), atol=1e-2), "SHAP output is neither prob nor log-odds"

    def _build_explainer(self):
        clf = self.pipeline[-1]
        self.explainer = shap.LinearExplainer(clf, self.background) if hasattr(clf, "coef_") else shap.TreeExplainer(clf)

    # SHAP explainers contain numba-compiled functions whose pickles embed Python bytecode, which only loads on the
    # exact Python version that wrote it. Save everything except the explainer and rebuild it on load (it is fully
    # determined by the fitted model and the background), so the model file works on any supported Python version.
    def __getstate__(self):
        state = self.__dict__.copy()
        state.pop("explainer", None)
        return state

    def __setstate__(self, state):
        self.__dict__.update(state)
        self._build_explainer()

    def _raw(self, X):
        vals = _positive_class(self.explainer.shap_values(self.pipeline[:-1].transform(X)))
        base = np.atleast_1d(np.asarray(self.explainer.expected_value, dtype=float))[-1]
        return vals, float(base)

    def predict(self, X):
        return self.pipeline.predict_proba(X)[:, 1]

    def explain(self, X):
        vals, base = self._raw(X)
        p = self.predict(X)
        if not self.margin:
            return p, base, vals
        p0 = _sigmoid(base)
        m = base + vals.sum(1)
        return p, p0, _rescale(vals, p - p0, m - base, p * (1 - p))


class Ensemble:
    def __init__(self, members):
        self.members = members

    def predict(self, X):
        return np.mean([m.predict(X) for m in self.members], axis=0)

    def explain(self, X):
        parts = [m.explain(X) for m in self.members]
        return (np.mean([p for p, _, _ in parts], axis=0), float(np.mean([b for _, b, _ in parts])),
                np.mean([phi for _, _, phi in parts], axis=0))


class Factorised:
    def __init__(self, cad, conditional):
        self.cad, self.conditional = cad, conditional

    def predict(self, X):
        return self.cad.predict(X) * self.conditional.predict(X)

    def explain(self, X):
        a, a0, phi_a = self.cad.explain(X)
        b, b0, phi_b = self.conditional.explain(X)
        # Two-player Shapley split of a*b - a0*b0 between factor a and factor b.
        share_a = (a - a0) * (b + b0) / 2
        share_b = (b - b0) * (a + a0) / 2
        phi = _rescale(phi_a, share_a, a - a0, (b + b0) / 2) + _rescale(phi_b, share_b, b - b0, (a + a0) / 2)
        return a * b, a0 * b0, phi


class Calibrated:
    def __init__(self, inner, a, b):
        self.inner, self.a, self.b = inner, float(a), float(b)

    def _cal(self, p):
        return _sigmoid(self.a * _logit(p) + self.b)

    def predict(self, X):
        return self._cal(self.inner.predict(X))

    def explain(self, X):
        p, p0, phi = self.inner.explain(X)
        q, q0 = self._cal(p), float(self._cal(np.array([p0]))[0])
        slope = self.a * q * (1 - q) / np.clip(p * (1 - p), EPS, None)
        return q, q0, _rescale(phi, q - q0, p - p0, slope)


def fit_platt(p_raw, y):
    """Fit q = sigmoid(a * logit(p) + b) by (nearly unregularised) logistic regression."""
    from sklearn.linear_model import LogisticRegression
    lr = LogisticRegression(C=1e4, max_iter=1000).fit(_logit(np.asarray(p_raw)).reshape(-1, 1), y)
    return float(lr.coef_[0, 0]), float(lr.intercept_[0])


def apply_platt(p_raw, a, b):
    return _sigmoid(a * _logit(np.asarray(p_raw)) + b)

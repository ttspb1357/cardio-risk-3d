"""Candidate model zoo used for model selection.

Every candidate is a full sklearn pipeline (imputation -> optional scaling -> classifier), so the same
object handles training rows and partially filled patients sent by the API.
"""
from catboost import CatBoostClassifier
from sklearn.ensemble import ExtraTreesClassifier, HistGradientBoostingClassifier, RandomForestClassifier
from sklearn.impute import SimpleImputer
from sklearn.linear_model import LogisticRegression
from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from xgboost import XGBClassifier

SEED = 42


def _pipe(clf, scale=False):
    steps = [("imp", SimpleImputer(strategy="median"))]
    if scale:
        steps.append(("scale", StandardScaler()))
    return Pipeline(steps + [("clf", clf)])


def logreg(C, penalty="l2"):
    solver = "liblinear" if penalty == "l1" else "lbfgs"
    return lambda: _pipe(LogisticRegression(C=C, penalty=penalty, solver=solver, max_iter=5000,
                                            random_state=SEED), scale=True)


def forest(leaf, max_features="sqrt", extra=False):
    cls = ExtraTreesClassifier if extra else RandomForestClassifier
    return lambda: _pipe(cls(n_estimators=500, min_samples_leaf=leaf, max_features=max_features,
                             random_state=SEED, n_jobs=1))


def xgb(depth):
    return lambda: _pipe(XGBClassifier(n_estimators=300, max_depth=depth, learning_rate=0.03, subsample=0.8,
                                       colsample_bytree=0.6, min_child_weight=2, eval_metric="logloss",
                                       random_state=SEED, n_jobs=1))


def hgb():
    return lambda: _pipe(HistGradientBoostingClassifier(max_depth=3, learning_rate=0.05, max_iter=200,
                                                        l2_regularization=1.0, random_state=SEED))


def catboost(depth):
    return lambda: _pipe(CatBoostClassifier(iterations=500, depth=depth, learning_rate=0.03, random_seed=SEED,
                                            verbose=False, thread_count=1, allow_writing_files=False))


# Only models with exact, fast SHAP explanations are eligible (SVMs were tried and dropped for that reason).
CANDIDATES = {
    "logreg_l2_C0.03": logreg(0.03), "logreg_l2_C0.1": logreg(0.1),
    "logreg_l2_C0.3": logreg(0.3), "logreg_l2_C1": logreg(1.0),
    "logreg_l1_C0.1": logreg(0.1, "l1"), "logreg_l1_C0.3": logreg(0.3, "l1"), "logreg_l1_C1": logreg(1.0, "l1"),
    "rf_leaf1": forest(1), "rf_leaf3": forest(3), "rf_leaf5": forest(5), "rf_leaf3_mf0.3": forest(3, 0.3),
    "extratrees_leaf2": forest(2, extra=True), "extratrees_leaf5": forest(5, extra=True),
    "xgb_d2": xgb(2), "xgb_d3": xgb(3),
    "histgb_d3": hgb(),
    "catboost_d4": catboost(4),
}

# Fixed simple baselines, scored in the same nested-CV folds to show what model selection adds.
BASELINES = {"logistic regression (L2, C=0.1)": "logreg_l2_C0.1", "random forest (min leaf 3)": "rf_leaf3"}

"""Loading, cleaning and encoding of the extended Z-Alizadeh Sani dataset.

The same encoding is used at training time and at prediction time, so the API
can accept human-readable values ("Male", "Y", "mild", ...).
"""
from functools import lru_cache
from pathlib import Path

import numpy as np
import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
DATA_FILE = ROOT / "data" / "z_alizadeh_sani_extended.xlsx"
ARTIFACTS = Path(__file__).resolve().parent / "artifacts"

# Targets are the only columns that may never be model inputs (target leakage).
TARGET_COLUMNS = ["Cath", "LAD", "LCX", "RCA"]
TARGETS = {
    "cad": ("Cath", "CAD"),
    "LAD": ("LAD", "Stenotic"),
    "LCX": ("LCX", "Stenotic"),
    "RCA": ("RCA", "Stenotic"),
}

YES_NO = {"Y": 1, "N": 0}
VHD_LEVELS = {"N": 0, "mild": 1, "Moderate": 2, "Severe": 3}
YES_NO_COLUMNS = [
    "Obesity", "CRF", "CVA", "Airway disease", "Thyroid Disease", "CHF", "DLP",
    "Weak Peripheral Pulse", "Lung rales", "Systolic Murmur", "Diastolic Murmur",
    "Dyspnea", "Atypical", "Nonanginal", "LowTH Ang", "LVH", "Poor R Progression",
]
BBB_VALUES = ["N", "LBBB", "RBBB"]
# Constant in the dataset (always 'N'), carries no information.
DROPPED_CONSTANT = ["Exertional CP"]


def load_raw() -> pd.DataFrame:
    return pd.read_excel(DATA_FILE, sheet_name="Sheet 1 - Table 1")


def encode(df: pd.DataFrame) -> pd.DataFrame:
    """Encode raw (or partial, human-readable) patient rows into numeric model inputs.

    Columns missing from `df` become NaN and are imputed inside the model pipeline.
    """
    out = pd.DataFrame(index=df.index)
    for col in df.columns:
        if col in TARGET_COLUMNS or col in DROPPED_CONSTANT:
            continue
        s = df[col]
        if col == "Sex":
            out[col] = s.map({"Male": 1, "Fmale": 0, "Female": 0, 1: 1, 0: 0})
        elif col in YES_NO_COLUMNS:
            out[col] = s.map({**YES_NO, 1: 1, 0: 0})
        elif col == "VHD":
            out[col] = s.map({**VHD_LEVELS, 0: 0, 1: 1, 2: 2, 3: 3})
        elif col == "BBB":
            for v in BBB_VALUES[1:]:
                out[f"BBB_{v}"] = (s == v).astype(float)
        else:
            out[col] = pd.to_numeric(s, errors="coerce")
    return out.reindex(columns=feature_names(), fill_value=np.nan).astype(float)


@lru_cache(maxsize=1)
def feature_names() -> list[str]:
    raw = load_raw()
    cols = []
    for c in raw.columns:
        if c in TARGET_COLUMNS or c in DROPPED_CONSTANT:
            continue
        if c == "BBB":
            cols += [f"BBB_{v}" for v in BBB_VALUES[1:]]
        else:
            cols.append(c)
    return cols


def load_xy():
    raw = load_raw()
    X = encode(raw)
    ys = {name: (raw[col] == pos).astype(int).to_numpy() for name, (col, pos) in TARGETS.items()}
    assert not set(TARGET_COLUMNS) & set(X.columns), "target leakage: target column in inputs"
    return raw, X, ys


def strata(ys) -> np.ndarray:
    """Number of stenotic vessels (0-3): one stratification label that balances all four targets."""
    return ys["LAD"] + ys["LCX"] + ys["RCA"]


DEMO_PER_VESSEL_COUNT = {0: 2, 1: 1, 2: 1, 3: 2}


def demo_indices(ys, seed=42):
    """Six demo patients (picked at random within each vessel count, never by prediction quality).
    They are excluded from the deployed model's training data, so the demo shows genuinely unseen patients."""
    rng = np.random.default_rng(seed)
    s = strata(ys)
    picks = [rng.choice(np.where(s == k)[0], n, replace=False) for k, n in DEMO_PER_VESSEL_COUNT.items()]
    return np.sort(np.concatenate(picks))

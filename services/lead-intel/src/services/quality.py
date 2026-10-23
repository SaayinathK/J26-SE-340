# services/lead-intel/src/services/quality.py — how accurate is the scoring model? (O2, validation)
# Measured on the TEST split: the 15% of leads the model never saw while training (same split as
# ml/lead-intel/training/train.py and evaluate.py), so the numbers are honest, not optimistic.
import pandas as pd
from sklearn.metrics import brier_score_loss, confusion_matrix, roc_auc_score

from config import settings
from services.features import CATEGORICAL, NUMERIC, split
from services.scoring import B, LEADS, MODEL_VERSION, segment

THRESHOLD = 0.5                # "will buy" when the chance is 50% or more
_TEST: pd.DataFrame | None = None


def held_out_leads() -> pd.DataFrame:
    """The held-out test leads with the model's chance (p), score (0-100) and group."""
    global _TEST
    if _TEST is None:
        t = split(LEADS)[2].copy()
        t["p"] = B["calibrated"].predict_proba(t[NUMERIC + CATEGORICAL])[:, 1]
        t["score"] = (t.p * 100).round().astype(int)
        t["segment"] = t.score.map(segment)
        _TEST = t
    return _TEST


def metrics(d: pd.DataFrame) -> dict:
    y, p = d.converted.to_numpy().astype(int), d.p.to_numpy()
    pred = (p >= THRESHOLD).astype(int)
    tn, fp, fn, tp = confusion_matrix(y, pred, labels=[0, 1]).ravel()
    return {
        "leads": int(len(d)),
        "bought_rate": round(float(y.mean()), 3),
        "auc": round(float(roc_auc_score(y, p)), 3) if len(set(y)) == 2 else None,
        "accuracy": round(float((pred == y).mean()), 3),
        "precision": round(float(tp / max(1, tp + fp)), 3),
        "recall": round(float(tp / max(1, tp + fn)), 3),
        "brier": round(float(brier_score_loss(y, p)), 4),
        "confusion": {"bought_and_predicted": int(tp), "bought_but_missed": int(fn),
                      "not_bought_but_predicted": int(fp), "not_bought_and_not_predicted": int(tn)},
        "segments": {s: {"leads": int((d.segment == s).sum()),
                         "avg_score": round(float(d[d.segment == s].score.mean()), 1),
                         "bought_rate": round(float(d[d.segment == s].converted.mean()), 3)}
                     for s in ("hot", "warm", "cold") if (d.segment == s).any()},
    }


def _rule_baseline_auc() -> float | None:
    f = settings.REPORTS_DIR / "c3-03_baseline.csv"
    try:
        return float(pd.read_csv(f).auc_test.iloc[0])
    except (OSError, ValueError, AttributeError, IndexError):
        return None


def model_quality(tenant: str) -> dict:
    t = held_out_leads()
    own = t[t.tenant == tenant]
    return {"model_version": MODEL_VERSION, "threshold": THRESHOLD,
            "tested_on": "test split: leads never used for training (15% of the CRM data)",
            "all_tenants": metrics(t),
            "this_tenant": metrics(own) if len(own) else None,
            "rule_baseline_auc": _rule_baseline_auc(),
            "targets": {"auc": 0.80, "calibration_gap": 0.15}}

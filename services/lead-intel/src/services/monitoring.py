# services/lead-intel/src/services/monitoring.py  — FR7 Track prediction outcomes (feeds Continuous Learning)
# Every score is saved in the lead history (services/alerts.py). When the sales team closes a lead,
# POST /leads/{id}/outcome saves won/lost next to the score the model gave (history, never overwritten).
# GET /leads/monitoring then checks, per tenant, whether the model is still accurate and calibrated,
# and flags when retraining is needed (the signal Component 2 uses).
import numpy as np
from sklearn.metrics import brier_score_loss, roc_auc_score

from repositories import get_repo

AUC_ALERT = 0.80             # proposal target (O2); below this on real outcomes -> retrain
CALIBRATION_ALERT = 0.15     # segment's real win rate differs from its average score by > 15 points


def record(tenant: str, lead_id: str, outcome: str, score: int, segment: str, model_version: str) -> dict:
    row = get_repo().add_outcome(tenant, lead_id, {"outcome": outcome, "score": score, "segment": segment,
                                                   "model_version": model_version})
    return {"lead_id": lead_id, "outcome": outcome, "score": score, "segment": segment,
            "model_version": model_version, "recorded_at": row["created_at"]}


def latest_per_lead(rows: list[dict]) -> list[dict]:
    """If a result was corrected, only the newest answer for each lead counts (rows are oldest -> newest)."""
    return list({r["lead_id"]: r for r in rows}.values())


def summary(tenant: str) -> dict:
    rows = latest_per_lead(get_repo().outcomes(tenant))
    out = {"tenant_outcomes": len(rows)}
    if not rows:
        return {**out, "status": "no outcomes recorded yet"}
    y = np.array([1 if r["outcome"] == "won" else 0 for r in rows])
    p = np.array([r["score"] / 100 for r in rows])
    seg = {}
    for s in ("hot", "warm", "cold"):
        m = np.array([r["segment"] == s for r in rows])
        if m.any():
            seg[s] = {"leads": int(m.sum()), "avg_score": round(float(p[m].mean() * 100), 1),
                      "won_rate": round(float(y[m].mean()), 3)}
    out.update({"won_rate": round(float(y.mean()), 3), "segments": seg,
                "brier": round(float(brier_score_loss(y, p)), 4)})
    out["auc"] = round(float(roc_auc_score(y, p)), 3) if len(set(y)) == 2 and len(y) >= 10 else None
    reasons = []
    if out["auc"] is not None and out["auc"] < AUC_ALERT:
        reasons.append(f"AUC {out['auc']} below {AUC_ALERT}")
    for s, v in seg.items():
        if v["leads"] >= 10 and abs(v["won_rate"] - v["avg_score"] / 100) > CALIBRATION_ALERT:
            reasons.append(f"{s}: won rate {v['won_rate']:.0%} vs average score {v['avg_score']:.0f}")
    out["retrain_recommended"] = bool(reasons)
    out["reasons"] = reasons
    return out
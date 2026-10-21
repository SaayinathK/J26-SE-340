# services/lead-intel/monitoring.py  — FR7 Track prediction outcomes (feeds Continuous Learning)
# Every /leads/score call already remembers the latest score per lead (C3-11 history).
# When the sales team closes a lead, POST /leads/{id}/outcome records won/lost next to that score.
# GET /leads/monitoring then checks, per tenant, whether the model is still accurate and calibrated,
# and flags when retraining is needed.
import json
import os
from datetime import datetime, timezone
from pathlib import Path

import numpy as np
from sklearn.metrics import brier_score_loss, roc_auc_score

AUC_ALERT = 0.80             # proposal target (O2); below this on real outcomes -> retrain
CALIBRATION_ALERT = 0.15     # segment's real win rate differs from its average score by > 15 points


def _path() -> Path:
    return Path(os.getenv("C3_OUTCOMES", "data/processed/outcomes.json"))


def _load() -> dict:
    p = _path()
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def record(tenant: str, lead_id: str, outcome: str, score: int, segment: str, model_version: str) -> dict:
    data = _load()
    entry = {"outcome": outcome, "score": score, "segment": segment, "model_version": model_version,
             "recorded_at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    data[f"{tenant}:{lead_id}"] = entry
    p = _path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(data), encoding="utf-8")
    return {"lead_id": lead_id, **entry}


def summary(tenant: str) -> dict:
    rows = [v for k, v in _load().items() if k.startswith(f"{tenant}:")]
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
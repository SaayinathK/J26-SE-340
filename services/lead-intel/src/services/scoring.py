# services/lead-intel/src/services/scoring.py — C3-05/C3-06 lead scoring + C3-11 confidence (FR9)
# Loads the trained model (made by ml/lead-intel/training/calibrate.py) and the CRM leads
# (made by ml/lead-intel/training/prepare_data.py) once, when the service starts.
import joblib
import pandas as pd
import shap

from config import settings
from services.features import CATEGORICAL, NUMERIC, add_features

# ---------- the trained model ----------
B = joblib.load(settings.MODEL_PATH)
PREP = B["explainer_pipe"].named_steps["prep"]
EXPLAINER = shap.TreeExplainer(B["explainer_pipe"].named_steps["model"])
NAMES = PREP.get_feature_names_out()
MODEL_VERSION = B["model_version"]

# ---------- the CRM leads (GoHighLevel format) ----------
LEADS = add_features(pd.read_json(settings.LEADS_PATH, lines=True))
TENANTS = set(LEADS.tenant.unique())

# ---------- how often each segment really converted (validation set, C3-05) ----------
SEGMENT_STATS = pd.read_csv(settings.SEGMENTS_CSV, index_col="segment").to_dict("index")
BOUNDARIES = (40, 70)          # cold < 40 <= warm < 70 <= hot
RANK = {"cold": 0, "warm": 1, "hot": 2}


def segment(score: int) -> str:
    return "hot" if score >= BOUNDARIES[1] else "warm" if score >= BOUNDARIES[0] else "cold"


def score_lead(lead: dict) -> dict:
    X = add_features(pd.DataFrame([lead]))[NUMERIC + CATEGORICAL]
    score = int(round(B["calibrated"].predict_proba(X)[0, 1] * 100))
    sv = EXPLAINER.shap_values(PREP.transform(X))[0]
    top = sorted(zip(NAMES, sv), key=lambda t: abs(t[1]), reverse=True)[:3]
    return {"lead_id": lead["lead_id"], "score": score, "segment": segment(score),
            "top_factors": [{"feature": f, "impact": round(float(v), 3)} for f, v in top],
            "model_version": MODEL_VERSION}


def confidence(score: int, seg: str) -> dict:
    """How much to trust the segment: real conversion rate of the segment on the
    validation set, and how close the score is to a segment boundary."""
    gap = min(abs(score - b) for b in BOUNDARIES)
    level = "low" if gap < 5 else "medium" if gap < 15 else "high"
    s = SEGMENT_STATS.get(seg, {})
    return {"level": level, "points_from_boundary": gap,
            "segment_conversion_rate": s.get("conversion_rate"),
            "segment_validation_leads": int(s["leads"]) if "leads" in s else None,
            "note": f"In validation, {s.get('conversion_rate', 0):.0%} of {seg} leads converted."}


def find_lead(tenant: str, lead_id: str) -> dict | None:
    """The CRM record of this lead, only if it belongs to this tenant."""
    rows = LEADS[(LEADS.tenant == tenant) & (LEADS.contact_id == lead_id)]
    return None if rows.empty else {**rows.iloc[0].to_dict(), "lead_id": lead_id}

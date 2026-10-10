# services/lead-intel/app.py  — C3 Lead Intelligence Agent API
# C3-06: POST /leads/score      (I-04)
# C3-10: GET  /leads/analytics  (behavioural analytics)
import joblib
import pandas as pd
import shap
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel
from features import add_features, NUMERIC, CATEGORICAL
from analytics import insights

# ---------- Load the trained model (from calibrate.py, C3-05) ----------
B = joblib.load("models/lead_scorer.joblib")
PREP = B["explainer_pipe"].named_steps["prep"]
EXPLAINER = shap.TreeExplainer(B["explainer_pipe"].named_steps["model"])
NAMES = PREP.get_feature_names_out()

# ---------- Load the ingested CRM leads (from ingest.py, C3-01) ----------
LEADS = add_features(pd.read_json("data/processed/leads_ghl.jsonl", lines=True))
TENANTS = set(LEADS.tenant.unique())

app = FastAPI(title="C3 Lead Intelligence Agent")


class Lead(BaseModel):
    lead_id: str
    source: str | None = None
    lead_origin: str | None = None
    last_activity: str | None = None
    occupation: str | None = None
    specialization: str | None = None
    total_visits: float | None = None
    time_on_site_sec: float = 0
    pages_per_visit: float | None = None


def segment(score: int) -> str:
    return "hot" if score >= 70 else "warm" if score >= 40 else "cold"


def score_lead(lead: dict) -> dict:
    X = add_features(pd.DataFrame([lead]))[NUMERIC + CATEGORICAL]
    score = int(round(B["calibrated"].predict_proba(X)[0, 1] * 100))
    sv = EXPLAINER.shap_values(PREP.transform(X))[0]
    top = sorted(zip(NAMES, sv), key=lambda t: abs(t[1]), reverse=True)[:3]
    return {"lead_id": lead["lead_id"], "score": score, "segment": segment(score),
            "top_factors": [{"feature": f, "impact": round(float(v), 3)} for f, v in top],
            "model_version": B["model_version"]}


@app.get("/health")
def health():
    return {"ok": True, "model_version": B["model_version"], "leads_loaded": len(LEADS)}


# ---------- C3-06: lead scoring ----------
@app.post("/leads/score")
def score(lead: Lead, x_tenant_id: str = Header(...)):   # tenant comes only from the gateway
    return score_lead(lead.model_dump())


# ---------- C3-10: behavioural analytics ----------
@app.get("/leads/analytics")
def analytics(x_tenant_id: str = Header(...)):
    if x_tenant_id not in TENANTS:
        raise HTTPException(404, "Unknown tenant")
    return insights(LEADS[LEADS.tenant == x_tenant_id])

# Run:  uvicorn app:app --port 3001 --reload
# services/lead-intel/app.py  — C3 Lead Intelligence Agent API (port 3001, behind the C4 gateway)
# C3-06: POST /leads/score                     (I-04)  + C3-11 alert + confidence
# C3-08: GET  /leads/{lead_id}/recommendation  (I-05)  RAG + Mistral 7B, grounded only
# C3-10: GET  /leads/analytics                         behavioural analytics
# C3-12: GET  /leads/dashboard                         top-10 hottest leads + segment mix + weekly trend
# FR7:   POST /leads/{lead_id}/outcome + GET /leads/monitoring   outcome tracking for continuous learning
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Literal

import joblib
import pandas as pd
import requests
import shap
from fastapi import FastAPI, Header, HTTPException
from pydantic import BaseModel

import monitoring
from analytics import insights
from features import add_features, NUMERIC, CATEGORICAL
from rag import recommend

# ---------- Load the trained model (from calibrate.py, C3-05) ----------
B = joblib.load("models/lead_scorer.joblib")
PREP = B["explainer_pipe"].named_steps["prep"]
EXPLAINER = shap.TreeExplainer(B["explainer_pipe"].named_steps["model"])
NAMES = PREP.get_feature_names_out()

# ---------- Load the ingested CRM leads (from ingest.py, C3-01) ----------
LEADS = add_features(pd.read_json("data/processed/leads_ghl.jsonl", lines=True))
TENANTS = set(LEADS.tenant.unique())

# ---------- C3-11: how often each segment really converted (validation set, C3-05) ----------
SEGMENT_STATS = pd.read_csv("reports/c3-05_segments.csv", index_col="segment").to_dict("index")
BOUNDARIES = (40, 70)          # cold < 40 <= warm < 70 <= hot
RANK = {"cold": 0, "warm": 1, "hot": 2}

app = FastAPI(title="C3 Lead Intelligence Agent")
CACHE: dict = {}               # (tenant, lead_id) -> grounded recommendation
DASH_CACHE: dict = {}          # tenant -> scored leads


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
    return "hot" if score >= BOUNDARIES[1] else "warm" if score >= BOUNDARIES[0] else "cold"


def score_lead(lead: dict) -> dict:
    X = add_features(pd.DataFrame([lead]))[NUMERIC + CATEGORICAL]
    score = int(round(B["calibrated"].predict_proba(X)[0, 1] * 100))
    sv = EXPLAINER.shap_values(PREP.transform(X))[0]
    top = sorted(zip(NAMES, sv), key=lambda t: abs(t[1]), reverse=True)[:3]
    return {"lead_id": lead["lead_id"], "score": score, "segment": segment(score),
            "top_factors": [{"feature": f, "impact": round(float(v), 3)} for f, v in top],
            "model_version": B["model_version"]}


# ---------- C3-11: confidence indicator (FR9) ----------
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


# ---------- C3-11: hot -> cold alert (FR8) ----------
def _history_path() -> Path:
    return Path(os.getenv("C3_HISTORY", "data/processed/score_history.json"))


def _load_history() -> dict:
    p = _history_path()
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}


def check_alert(tenant: str, result: dict) -> dict | None:
    """Compare with the last score of the same lead (same tenant only) and remember this one."""
    hist, key = _load_history(), f"{tenant}:{result['lead_id']}"
    prev = hist.get(key)
    if prev and prev["score"] == result["score"]:
        return prev.get("alert")                  # same score again -> same answer (deterministic)
    alert = None
    if prev and RANK[result["segment"]] < RANK[prev["segment"]]:
        alert = {"type": "segment_drop", "from": prev["segment"], "to": result["segment"],
                 "previous_score": prev["score"], "score": result["score"],
                 "previous_scored_at": prev["at"],
                 "message": f"Lead dropped from {prev['segment']} to {result['segment']} "
                            f"({prev['score']} -> {result['score']}). Follow up before it goes cold."}
    hist[key] = {"score": result["score"], "segment": result["segment"], "alert": alert,
                 "at": datetime.now(timezone.utc).isoformat(timespec="seconds")}
    p = _history_path()
    p.parent.mkdir(parents=True, exist_ok=True)
    p.write_text(json.dumps(hist), encoding="utf-8")
    return alert


@app.get("/health")
def health():
    return {"ok": True, "model_version": B["model_version"], "leads_loaded": len(LEADS)}


# ---------- C3-06 + C3-11: lead scoring ----------
@app.post("/leads/score")
def score(lead: Lead, x_tenant_id: str = Header(...)):   # tenant comes only from the gateway
    result = score_lead(lead.model_dump())
    result["confidence"] = confidence(result["score"], result["segment"])
    result["alert"] = check_alert(x_tenant_id, result)
    return result


# ---------- C3-08: grounded recommendation ----------
@app.get("/leads/{lead_id}/recommendation")
def recommendation(lead_id: str, x_tenant_id: str = Header(...)):
    key = (x_tenant_id, lead_id)
    if key in CACHE:
        return {**CACHE[key], "cached": True}
    rows = LEADS[(LEADS.tenant == x_tenant_id) & (LEADS.contact_id == lead_id)]
    if rows.empty:                                    # unknown lead OR another tenant's lead
        raise HTTPException(404, "Lead not found for this tenant")
    lead = {**rows.iloc[0].to_dict(), "lead_id": lead_id}
    try:
        out = recommend(x_tenant_id, lead, score_lead(lead))
    except requests.RequestException:
        raise HTTPException(503, "LLM service (Ollama) not reachable")
    if out["grounded"]:                               # never cache a blocked answer
        CACHE[key] = out
    return {**out, "cached": False}


# ---------- C3-10: behavioural analytics ----------
@app.get("/leads/analytics")
def analytics(x_tenant_id: str = Header(...)):
    if x_tenant_id not in TENANTS:
        raise HTTPException(404, "Unknown tenant")
    return insights(LEADS[LEADS.tenant == x_tenant_id])


# ---------- FR7: outcome tracking (feeds continuous learning) ----------
class Outcome(BaseModel):
    outcome: Literal["won", "lost"]


@app.post("/leads/{lead_id}/outcome")
def record_outcome(lead_id: str, body: Outcome, x_tenant_id: str = Header(...)):
    """Store the real result next to the score the model gave (same tenant only)."""
    last = _load_history().get(f"{x_tenant_id}:{lead_id}")
    if last:
        score_, seg = last["score"], last["segment"]
    else:                                            # never scored through the API: score the CRM record now
        rows = LEADS[(LEADS.tenant == x_tenant_id) & (LEADS.contact_id == lead_id)]
        if rows.empty:
            raise HTTPException(404, "Lead not scored for this tenant - call /leads/score first")
        s = score_lead({**rows.iloc[0].to_dict(), "lead_id": lead_id})
        score_, seg = s["score"], s["segment"]
    return monitoring.record(x_tenant_id, lead_id, body.outcome, score_, seg, B["model_version"])


@app.get("/leads/monitoring")
def model_monitoring(x_tenant_id: str = Header(...)):
    """Is the model still accurate on real outcomes for this tenant? (AUC, Brier, per-segment win rate)"""
    return monitoring.summary(x_tenant_id)


# ---------- C3-12: dashboard data ----------
def scored_leads(tenant: str) -> pd.DataFrame:
    if tenant not in DASH_CACHE:
        t = LEADS[LEADS.tenant == tenant].copy()
        t["score"] = (B["calibrated"].predict_proba(t[NUMERIC + CATEGORICAL])[:, 1] * 100).round().astype(int)
        t["segment"] = t.score.map(segment)
        DASH_CACHE[tenant] = t
    return DASH_CACHE[tenant]


@app.get("/leads/dashboard")
def dashboard(x_tenant_id: str = Header(...)):
    if x_tenant_id not in TENANTS:
        raise HTTPException(404, "Unknown tenant")
    t = scored_leads(x_tenant_id)
    top = t.sort_values(["score", "contact_id"], ascending=[False, True]).head(10)
    week = pd.to_datetime(t.date_added).dt.to_period("W").dt.start_time.dt.date.astype(str)
    trend = t.groupby(week).agg(leads=("converted", "size"), conversion_rate=("converted", "mean"),
                                avg_score=("score", "mean")).round(3)
    seg = t.groupby("segment").agg(leads=("converted", "size"), conversion_rate=("converted", "mean")).round(3)
    return {
        "tenant_leads": int(len(t)),
        "segments": seg.reindex(["hot", "warm", "cold"]).fillna(0).reset_index().to_dict("records"),
        "top_10_hottest": [{"lead_id": r.contact_id, "score": int(r.score), "segment": r.segment,
                            "source": r.source if pd.notna(r.source) else None,
                            "last_activity": r.last_activity if pd.notna(r.last_activity) else None}
                           for r in top.itertuples()],
        "weekly_trend": trend.reset_index(names="week_start").to_dict("records"),
        "dates_are_synthetic": bool(t.date_is_synthetic.all()),
        "note": "Scores use the C3 model on the tenant's historical CRM leads. "
                "Lead dates are synthetic (the dataset has none), so the trend shows the method, not real seasonality.",
    }

# Run:  uvicorn app:app --port 3001 --reload
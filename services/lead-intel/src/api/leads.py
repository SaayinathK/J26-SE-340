# services/lead-intel/src/api/leads.py — the C3 Lead Intelligence API (behind the C4 gateway)
# C3-06: POST /leads/score                     (I-04)  + C3-11 alert + confidence
# C3-08: GET  /leads/{lead_id}/recommendation  (I-05)  RAG + fine-tuned Mistral 7B, grounded only
# C3-10: GET  /leads/analytics                         behavioural analytics
# C3-12: GET  /leads/dashboard                         top-10 hottest leads + segment mix + weekly trend
# FR7:   POST /leads/{lead_id}/outcome + GET /leads/monitoring   outcome tracking for continuous learning
# FR10:  GET  /leads/history + GET /leads/{lead_id}/history     output history (scores, advice, outcomes)
#        GET  /leads/{lead_id}/profile                 the CRM record of one lead (Check-a-lead form)
# O2:    GET  /leads/model-quality                    accuracy on leads the model never saw (validation)
# The tenant always comes from the X-Tenant-Id header, which only the gateway sets (from the JWT).
import logging

import requests
from fastapi import APIRouter, Header, HTTPException

from agent.personalise import talking_points
from agent.rag import recommend
from models.schemas import Lead, Outcome
from repositories import RepoUnavailable, get_repo
from services import history, monitoring, quality
from services.alerts import check_alert
from services.analytics import insights
from services.crm_match import NUMBERS, _number, compare_with_crm
from services.dashboard import dashboard_data, lead_profile
from services.scoring import LEADS, MODEL_VERSION, TENANTS, confidence, find_lead, score_lead

log = logging.getLogger("c3.api")
router = APIRouter(prefix="/leads")
CACHE: dict = {}               # (tenant, lead_id) -> grounded recommendation


def _known_tenant(tenant: str):
    if tenant not in TENANTS:
        raise HTTPException(404, "Unknown tenant")


def _db_down(e: RepoUnavailable):
    log.error("history store unavailable: %s", e)
    return HTTPException(503, "Lead history database not reachable")


# ---------- C3-06 + C3-11: lead scoring ----------
@router.post("/score")
def score(lead: Lead, x_tenant_id: str = Header(...)):
    data = lead.model_dump()
    result = score_lead(data)
    result["confidence"] = confidence(result["score"], result["segment"])
    crm = compare_with_crm(x_tenant_id, data)          # None = a new lead (not in this tenant's CRM)
    result["crm"] = crm
    result["what_if"] = bool(crm and crm["changed"])
    # a what-if (CRM lead with changed details) is not the real lead: no history row, no alert
    result["alert"] = None if result["what_if"] else check_alert(x_tenant_id, result, result["confidence"])
    return result


# ---------- the CRM record of one lead (fills the "Check a lead" form) ----------
@router.get("/{lead_id}/profile")
def profile(lead_id: str, x_tenant_id: str = Header(...)):
    _known_tenant(x_tenant_id)
    p = lead_profile(x_tenant_id, lead_id)
    if p is None:                                     # unknown lead OR another tenant's lead
        raise HTTPException(404, "Lead not found for this tenant")
    raw = find_lead(x_tenant_id, lead_id)             # exact numbers (the list rounds them for display)
    return {**p, **{k: _number(raw[k]) for k in NUMBERS}}


# ---------- FR10: output history (registered before /{lead_id}/... routes) ----------
@router.get("/history")
def history_overview(x_tenant_id: str = Header(...)):
    _known_tenant(x_tenant_id)
    try:
        return history.overview(x_tenant_id)
    except RepoUnavailable as e:
        raise _db_down(e)


@router.get("/{lead_id}/history")
def lead_history(lead_id: str, x_tenant_id: str = Header(...)):
    _known_tenant(x_tenant_id)
    try:
        h = history.for_lead(x_tenant_id, lead_id)
    except RepoUnavailable as e:
        raise _db_down(e)
    if h is None:                                     # unknown lead OR another tenant's lead
        raise HTTPException(404, "Lead not found for this tenant")
    return h


# ---------- C3-08: grounded recommendation ----------
@router.get("/{lead_id}/recommendation")
def recommendation(lead_id: str, x_tenant_id: str = Header(...)):
    key = (x_tenant_id, lead_id)
    if key in CACHE:
        return {**CACHE[key], "cached": True}
    lead = find_lead(x_tenant_id, lead_id)
    if lead is None:                                  # unknown lead OR another tenant's lead
        raise HTTPException(404, "Lead not found for this tenant")
    scored = score_lead(lead)
    try:
        out = recommend(x_tenant_id, lead, scored)
    except requests.RequestException:
        raise HTTPException(503, "LLM service (Ollama) not reachable")
    out["talking_points"] = talking_points(lead)      # personal points from this lead's own CRM record
    check_alert(x_tenant_id, scored, confidence(scored["score"], scored["segment"]), source="recommendation")
    try:
        get_repo().add_recommendation(x_tenant_id, lead_id, out)   # blocked answers are saved too (audit)
    except RepoUnavailable as e:
        log.warning("recommendation not saved to history: %s", e)
    if out["grounded"]:                               # never cache a blocked answer
        CACHE[key] = out
    return {**out, "cached": False}


# ---------- C3-10: behavioural analytics ----------
@router.get("/analytics")
def analytics(x_tenant_id: str = Header(...)):
    _known_tenant(x_tenant_id)
    return insights(LEADS[LEADS.tenant == x_tenant_id])


# ---------- FR7: outcome tracking (feeds continuous learning) ----------
@router.post("/{lead_id}/outcome")
def record_outcome(lead_id: str, body: Outcome, x_tenant_id: str = Header(...)):
    """Store the real result next to the score the model gave (same tenant only)."""
    try:
        last = get_repo().last_score(x_tenant_id, lead_id)
        if last:
            score_, seg = last["score"], last["segment"]
        else:                                        # never scored through the API: score the CRM record now
            lead = find_lead(x_tenant_id, lead_id)
            if lead is None:
                raise HTTPException(404, "Lead not scored for this tenant - call /leads/score first")
            s = score_lead(lead)
            check_alert(x_tenant_id, s, confidence(s["score"], s["segment"]), source="outcome")
            score_, seg = s["score"], s["segment"]
        return monitoring.record(x_tenant_id, lead_id, body.outcome, score_, seg, MODEL_VERSION)
    except RepoUnavailable as e:
        raise _db_down(e)


@router.get("/monitoring")
def model_monitoring(x_tenant_id: str = Header(...)):
    """Is the model still accurate on real outcomes for this tenant? (AUC, Brier, per-segment win rate)"""
    try:
        return monitoring.summary(x_tenant_id)
    except RepoUnavailable as e:
        raise _db_down(e)


# ---------- O2: model accuracy on unseen leads ----------
@router.get("/model-quality")
def model_quality(x_tenant_id: str = Header(...)):
    _known_tenant(x_tenant_id)
    return quality.model_quality(x_tenant_id)


# ---------- C3-12: dashboard data ----------
@router.get("/dashboard")
def dashboard(x_tenant_id: str = Header(...)):
    _known_tenant(x_tenant_id)
    return dashboard_data(x_tenant_id)

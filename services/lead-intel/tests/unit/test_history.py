# services/lead-intel/tests/unit/test_history.py — FR10 output history per lead (scores, advice, outcomes)
from fastapi.testclient import TestClient

import api.leads
from main import app
from services.scoring import LEADS

client = TestClient(app)
A = {"X-Tenant-Id": "tenant_a"}
HOT = {"lead_id": "L-histtest1", "source": "Reference", "lead_origin": "Lead Add Form",
       "last_activity": "SMS Sent", "occupation": "Working Professional",
       "total_visits": 6, "time_on_site_sec": 1500, "pages_per_visit": 3}
COLD = {**HOT, "source": "Olark Chat", "lead_origin": "API", "last_activity": "Olark Chat Conversation",
        "occupation": None, "total_visits": 0, "time_on_site_sec": 0, "pages_per_visit": 0}


def test_every_score_is_kept_not_overwritten():
    first = client.post("/leads/score", json=HOT, headers=A).json()
    second = client.post("/leads/score", json=COLD, headers=A).json()
    h = client.get("/leads/L-histtest1/history", headers=A).json()
    assert [p["score"] for p in h["score_series"]] == [first["score"], second["score"]]   # oldest first
    assert h["events"][0]["type"] == "score" and h["events"][0]["alert"]["type"] == "segment_drop"
    assert h["profile"] is None                       # typed in by hand, not a CRM lead


def test_same_score_twice_is_saved_once():
    lead = {**HOT, "lead_id": "L-histtest2"}
    client.post("/leads/score", json=lead, headers=A)
    client.post("/leads/score", json=lead, headers=A)
    assert client.get("/leads/L-histtest2/history", headers=A).json()["counts"]["scores"] == 1


def test_advice_and_outcome_appear_in_the_timeline(monkeypatch):
    lead_id = LEADS[LEADS.tenant == "tenant_a"].contact_id.iloc[5]
    fake = {"next_best_action": "Call today", "message_draft": "Hi!", "grounded": True, "confidence": 0.8,
            "sources": [{"id": "tenant_a:1", "label": "S1", "type": "pattern", "text": "Pattern A"}],
            "policy_check": "consistent", "llm_model": "test-model", "retrieval_method": "hybrid",
            "latency_sec": 1.0}
    monkeypatch.setattr(api.leads, "recommend", lambda t, lead, s: {**fake, "lead_id": lead["lead_id"],
                                                                     "score": s["score"], "segment": s["segment"]})
    api.leads.CACHE.pop(("tenant_a", lead_id), None)
    assert client.get(f"/leads/{lead_id}/recommendation", headers=A).status_code == 200
    assert client.post(f"/leads/{lead_id}/outcome", json={"outcome": "won"}, headers=A).status_code == 200
    h = client.get(f"/leads/{lead_id}/history", headers=A).json()
    assert [e["type"] for e in h["events"]][:2] == ["outcome", "recommendation"]
    rec = next(e for e in h["events"] if e["type"] == "recommendation")
    assert rec["next_best_action"] == "Call today" and rec["sources"][0]["label"] == "S1"
    assert h["profile"]["lead_id"] == lead_id and h["counts"] == {"scores": 1, "recommendations": 1, "outcomes": 1}
    overview = client.get("/leads/history", headers=A).json()
    row = next(x for x in overview["leads"] if x["lead_id"] == lead_id)
    assert row["last_outcome"] == "won" and overview["storage"] == "file"


def test_history_is_per_tenant():
    client.post("/leads/score", json={**HOT, "lead_id": "L-histtest3"}, headers=A)
    assert client.get("/leads/L-histtest3/history", headers={"X-Tenant-Id": "tenant_b"}).status_code == 404
    ids = {x["lead_id"] for x in client.get("/leads/history", headers={"X-Tenant-Id": "tenant_b"}).json()["leads"]}
    assert "L-histtest3" not in ids
    other = LEADS[LEADS.tenant == "tenant_b"].contact_id.iloc[0]
    assert client.get(f"/leads/{other}/history", headers=A).status_code == 404


def test_unknown_tenant_gets_404():
    assert client.get("/leads/history", headers={"X-Tenant-Id": "tenant_x"}).status_code == 404

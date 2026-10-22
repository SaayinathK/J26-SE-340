# services/lead-intel/tests/unit/test_monitoring.py — FR7 outcome tracking and model monitoring
from fastapi.testclient import TestClient
from main import app
from services.scoring import LEADS

client = TestClient(app)

def test_outcomes_are_stored_with_the_score_and_summarised_per_tenant():
    t = "tenant_c"
    leads = LEADS[LEADS.tenant == t].head(40)
    for r in leads.itertuples():
        r1 = client.post(f"/leads/{r.contact_id}/outcome", json={"outcome": "won" if r.converted else "lost"},
                         headers={"X-Tenant-Id": t})
        assert r1.status_code == 200 and 0 <= r1.json()["score"] <= 100
    m = client.get("/leads/monitoring", headers={"X-Tenant-Id": t}).json()
    assert m["tenant_outcomes"] == 40 and m["auc"] is not None and 0 <= m["brier"] <= 1
    assert set(m) >= {"won_rate", "segments", "retrain_recommended", "reasons"}

def test_outcome_uses_the_last_api_score():
    lead = {"lead_id": "L-fr7test01", "source": "Google", "occupation": "Working Professional",
            "time_on_site_sec": 1240, "total_visits": 5}
    s = client.post("/leads/score", json=lead, headers={"X-Tenant-Id": "tenant_a"}).json()
    o = client.post("/leads/L-fr7test01/outcome", json={"outcome": "won"}, headers={"X-Tenant-Id": "tenant_a"}).json()
    assert o["score"] == s["score"] and o["segment"] == s["segment"]

def test_unknown_or_other_tenant_lead_is_rejected():
    other = LEADS[LEADS.tenant == "tenant_b"].contact_id.iloc[0]
    r = client.post(f"/leads/{other}/outcome", json={"outcome": "won"}, headers={"X-Tenant-Id": "tenant_a"})
    assert r.status_code == 404
    assert client.post("/leads/L-x/outcome", json={"outcome": "maybe"}, headers={"X-Tenant-Id": "tenant_a"}).status_code == 422
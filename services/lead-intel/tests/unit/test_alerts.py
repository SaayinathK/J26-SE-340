# services/lead-intel/tests/unit/test_alerts.py — C3-11 hot->cold alert (FR8) + confidence (FR9)
from fastapi.testclient import TestClient
from main import app

client = TestClient(app)
HOT = {"lead_id": "L-alerttest1", "source": "Reference", "lead_origin": "Lead Add Form",
       "last_activity": "SMS Sent", "occupation": "Working Professional",
       "total_visits": 6, "time_on_site_sec": 1500, "pages_per_visit": 3}
COLD = {**HOT, "source": "Olark Chat", "lead_origin": "API", "last_activity": "Olark Chat Conversation",
        "occupation": None, "total_visits": 0, "time_on_site_sec": 0, "pages_per_visit": 0}

def post(lead, tenant="tenant_a"):
    return client.post("/leads/score", json=lead, headers={"X-Tenant-Id": tenant}).json()

def test_drop_from_hot_to_cold_raises_an_alert():
    first = post(HOT)
    assert first["segment"] == "hot" and first["alert"] is None
    second = post(COLD)
    assert second["segment"] == "cold"
    assert second["alert"]["type"] == "segment_drop"
    assert (second["alert"]["from"], second["alert"]["to"]) == ("hot", "cold")

def test_history_is_kept_per_tenant():
    lead = {**HOT, "lead_id": "L-alerttest2"}
    post(lead, "tenant_a")
    assert post({**COLD, "lead_id": "L-alerttest2"}, "tenant_b")["alert"] is None   # tenant_b never saw it hot

def test_confidence_explains_the_segment():
    c = post({**HOT, "lead_id": "L-alerttest3"})["confidence"]
    assert c["level"] in {"low", "medium", "high"}
    assert 0 <= c["segment_conversion_rate"] <= 1 and c["segment_validation_leads"] > 0
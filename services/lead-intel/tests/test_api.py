# services/lead-intel/tests/test_api.py  — contract + determinism (NFR5)
from fastapi.testclient import TestClient
from app import app

client = TestClient(app)
H = {"X-Tenant-Id": "tenant_a"}
LEAD = {"lead_id": "L-test000001", "source": "Google", "lead_origin": "Landing Page Submission",
        "last_activity": "Email Opened", "occupation": "Working Professional",
        "total_visits": 5, "time_on_site_sec": 1240, "pages_per_visit": 2.5}

def test_contract_fields():
    body = client.post("/leads/score", json=LEAD, headers=H).json()
    assert set(body) == {"lead_id", "score", "segment", "top_factors", "model_version"}
    assert 0 <= body["score"] <= 100 and body["segment"] in {"hot", "warm", "cold"}

def test_same_input_gives_same_output():
    results = [client.post("/leads/score", json=LEAD, headers=H).json() for _ in range(20)]
    assert all(r == results[0] for r in results)

def test_missing_tenant_is_rejected():
    assert client.post("/leads/score", json=LEAD).status_code == 422
    
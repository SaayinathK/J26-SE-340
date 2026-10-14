# services/lead-intel/tests/test_analytics.py  — C3-10
from fastapi.testclient import TestClient
from app import app, LEADS

client = TestClient(app)
KEYS = {"tenant_leads", "conversion_rate", "top_sources", "funnel", "drop_off_rates",
        "biggest_drop_off", "common_objections", "contact_problems", "note"}

def test_analytics_contract():
    body = client.get("/leads/analytics", headers={"X-Tenant-Id": "tenant_a"}).json()
    assert set(body) == KEYS

def test_analytics_uses_only_own_tenant():
    for t in ["tenant_a", "tenant_b", "tenant_c"]:
        body = client.get("/leads/analytics", headers={"X-Tenant-Id": t}).json()
        assert body["tenant_leads"] == int((LEADS.tenant == t).sum())
        assert body["funnel"]["Captured"] == body["tenant_leads"]

def test_unknown_tenant_gets_404():
    assert client.get("/leads/analytics", headers={"X-Tenant-Id": "tenant_x"}).status_code == 404
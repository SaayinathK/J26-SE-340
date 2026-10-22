# services/lead-intel/tests/unit/test_dashboard.py — C3-12 dashboard data
from fastapi.testclient import TestClient
from main import app
from services.scoring import LEADS

client = TestClient(app)

def test_dashboard_top10_is_sorted_and_from_this_tenant_only():
    d = client.get("/leads/dashboard", headers={"X-Tenant-Id": "tenant_a"}).json()
    scores = [x["score"] for x in d["top_10_hottest"]]
    assert len(scores) == 10 and scores == sorted(scores, reverse=True)
    own = set(LEADS[LEADS.tenant == "tenant_a"].contact_id)
    assert all(x["lead_id"] in own for x in d["top_10_hottest"])
    assert sum(s["leads"] for s in d["segments"]) == d["tenant_leads"]
    assert d["dates_are_synthetic"] is True                 # never present synthetic dates as real

def test_dashboard_unknown_tenant():
    assert client.get("/leads/dashboard", headers={"X-Tenant-Id": "tenant_x"}).status_code == 404


def test_dashboard_lead_list_has_every_segment_and_no_outcome():
    d = client.get("/leads/dashboard", headers={"X-Tenant-Id": "tenant_b"}).json()
    segs = {x["segment"] for x in d["leads"]}
    assert segs == {"hot", "warm", "cold"}
    assert all(sum(x["segment"] == s for x in d["leads"]) <= 50 for s in segs)
    own = set(LEADS[LEADS.tenant == "tenant_b"].contact_id)
    assert all(x["lead_id"] in own for x in d["leads"])
    assert not any(k in d["leads"][0] for k in ("converted", "tags", "opportunity_status"))

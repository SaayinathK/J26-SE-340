# services/lead-intel/tests/test_performance.py — C3-13 latency (NFR1) and consistency (NFR5)
import time
import numpy as np
from fastapi.testclient import TestClient
from app import app, B, LEADS
from features import NUMERIC, CATEGORICAL

client = TestClient(app)
H = {"X-Tenant-Id": "tenant_a"}

def _leads(n=50):
    rows = LEADS[LEADS.tenant == "tenant_a"].head(n)
    keep = ["source", "lead_origin", "last_activity", "occupation", "specialization",
            "total_visits", "time_on_site_sec", "pages_per_visit"]
    out = []
    for r in rows.to_dict("records"):
        lead = {k: (None if isinstance(r[k], float) and np.isnan(r[k]) else r[k]) for k in keep}
        lead["time_on_site_sec"] = lead["time_on_site_sec"] or 0
        out.append({"lead_id": r["contact_id"], **lead})
    return out

def test_scoring_p95_latency_under_1_second():
    times = []
    for lead in _leads():
        t0 = time.perf_counter()
        assert client.post("/leads/score", json=lead, headers=H).status_code == 200
        times.append(time.perf_counter() - t0)
    assert np.percentile(times, 95) < 1.0

def test_same_leads_same_scores_on_repeat():
    leads = _leads(20)
    a = [client.post("/leads/score", json=l, headers=H).json()["score"] for l in leads]
    b = [client.post("/leads/score", json=l, headers=H).json()["score"] for l in leads]
    assert a == b

def test_score_does_not_depend_on_tenant_header():
    lead = _leads(1)[0]
    s = {t: client.post("/leads/score", json=lead, headers={"X-Tenant-Id": t}).json()["score"]
         for t in ["tenant_a", "tenant_b", "tenant_c"]}
    assert len(set(s.values())) == 1              # same model for all tenants in v1

def test_10000_leads_can_be_scored_quickly():              # NFR2
    big = LEADS.sample(10_000, replace=True, random_state=42)[NUMERIC + CATEGORICAL]
    t0 = time.perf_counter()
    p = B["calibrated"].predict_proba(big)[:, 1]
    assert len(p) == 10_000 and ((p >= 0) & (p <= 1)).all()
    assert time.perf_counter() - t0 < 30
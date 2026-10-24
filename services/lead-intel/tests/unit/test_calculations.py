# services/lead-intel/tests/unit/test_calculations.py — every number on the screens equals a plain pandas recompute
import numpy as np
import pytest
from fastapi.testclient import TestClient
from sklearn.metrics import brier_score_loss, roc_auc_score

from main import app
from services import monitoring
from services.features import CATEGORICAL, NUMERIC
from services.scoring import B, LEADS, segment

client = TestClient(app)
T = "tenant_b"
H = {"X-Tenant-Id": T}


@pytest.fixture(scope="module")
def crm():
    t = LEADS[LEADS.tenant == T].copy()
    t["score"] = (B["calibrated"].predict_proba(t[NUMERIC + CATEGORICAL])[:, 1] * 100).round().astype(int)
    t["segment"] = t.score.map(segment)
    return t


def test_dashboard_numbers(crm):
    d = client.get("/leads/dashboard", headers=H).json()
    assert d["tenant_leads"] == len(crm)
    for s in d["segments"]:
        part = crm[crm.segment == s["segment"]]
        assert s["leads"] == len(part) and s["conversion_rate"] == round(part.converted.mean(), 3)
    top = crm.sort_values(["score", "contact_id"], ascending=[False, True]).head(10)
    assert [x["lead_id"] for x in d["top_10_hottest"]] == list(top.contact_id)


def test_analytics_numbers(crm):
    a = client.get("/leads/analytics", headers=H).json()
    assert a["conversion_rate"] == round(crm.converted.mean(), 3)
    by = crm.groupby("source").converted.agg(["size", "mean"])
    by = by[by["size"] >= 30].sort_values("mean", ascending=False).head(3)
    assert [(x["source"], round(x["conversion_rate"], 3)) for x in a["top_sources"]] == \
           [(i, round(r["mean"], 3)) for i, r in by.iterrows()]
    f = a["funnel"]
    assert f["Captured"] >= f["Engaged (visited site)"] >= f["Contacted"] >= f["Won"] == int(crm.converted.sum())


def test_monitoring_math_on_known_outcomes(monkeypatch):
    rows = [{"lead_id": f"L{i}", "outcome": o, "score": s, "segment": segment(s)}
            for i, (o, s) in enumerate([("won", 90), ("won", 80), ("lost", 20), ("lost", 10), ("won", 75),
                                        ("lost", 30), ("won", 85), ("lost", 15), ("won", 95), ("lost", 5)])]

    class Fake:
        def outcomes(self, tenant):
            return rows
    monkeypatch.setattr(monitoring, "get_repo", lambda: Fake())
    m = monitoring.summary("t")
    y = np.array([r["outcome"] == "won" for r in rows], dtype=int)
    p = np.array([r["score"] / 100 for r in rows])
    assert m["tenant_outcomes"] == 10 and m["won_rate"] == 0.5
    assert m["auc"] == round(roc_auc_score(y, p), 3) == 1.0
    assert m["brier"] == round(brier_score_loss(y, p), 4)
    assert m["retrain_recommended"] is False


def test_monitoring_flags_retraining_when_scores_are_wrong(monkeypatch):
    rows = [{"lead_id": f"L{i}", "outcome": "lost" if i % 2 else "won", "score": 90 if i % 2 else 10,
             "segment": segment(90 if i % 2 else 10)} for i in range(20)]

    class Fake:
        def outcomes(self, tenant):
            return rows
    monkeypatch.setattr(monitoring, "get_repo", lambda: Fake())
    m = monitoring.summary("t")
    assert m["auc"] < 0.8 and m["retrain_recommended"] is True and m["reasons"]


def test_a_corrected_result_counts_once():
    rows = [{"lead_id": "L1", "outcome": "lost"}, {"lead_id": "L2", "outcome": "won"}, {"lead_id": "L1", "outcome": "won"}]
    latest = monitoring.latest_per_lead(rows)
    assert len(latest) == 2 and {r["lead_id"]: r["outcome"] for r in latest}["L1"] == "won"

# services/lead-intel/tests/test_rag.py — C3-08 grounding rules (no LLM needed)
from fastapi.testclient import TestClient
from app import app, LEADS
from rag import ground, _labels, query_text

HITS = [{"label": "S1", "id": "tenant_a:1", "type": "pattern", "text": "Pattern A", "score": 0.8},
        {"label": "S2", "id": "tenant_a:7", "type": "business_context", "text": "Policy", "score": 0.6}]

def test_invented_sources_are_removed():
    out = ground({"sources": ["S1", "S9"], "next_best_action": "Call today"}, HITS)
    assert out["grounded"] and [s["label"] for s in out["sources"]] == ["S1"]

def test_label_formats_are_understood():
    assert _labels(["[S1]", "s2", 3, {"id": "S4"}, "S1"]) == ["S1", "S2", "S3", "S4"]

def test_answer_without_a_real_source_is_blocked():
    for raw in ({"sources": [], "next_best_action": "Call"},
                {"sources": ["tenant_a:1"], "next_best_action": "Call"},      # doc id, not a label
                {"sources": ["S1"]}):                                          # no action at all
        out = ground(raw, HITS)
        assert out["grounded"] is False and out["next_best_action"] is None

def test_query_hides_outcome_and_tags():
    lead = {"source": "Google", "lead_origin": "API", "occupation": "Student", "specialization": None,
            "total_visits": 2, "time_on_site_sec": 100, "pages_per_visit": 2, "last_activity": "Email Opened",
            "tags": ["Will revert after reading the email"], "converted": 1}
    q = query_text(lead)
    assert "Outcome" not in q and "revert" not in q

def test_other_tenants_lead_is_not_found():
    other = LEADS[LEADS.tenant == "tenant_b"].contact_id.iloc[0]
    r = TestClient(app).get(f"/leads/{other}/recommendation", headers={"X-Tenant-Id": "tenant_a"})
    assert r.status_code == 404
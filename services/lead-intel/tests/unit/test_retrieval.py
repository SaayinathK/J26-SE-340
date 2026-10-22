# services/lead-intel/tests/unit/test_retrieval.py — C3-09 retrieval methods + evaluation metrics
import numpy as np
import pytest
from agent import kb
from retrieval_eval import precision_at_k, recall_at_k, reciprocal_rank, make_queries
from tests.fakes import use_fake_kb

def test_metrics():
    assert precision_at_k(["a", "x", "b", "y", "z"], {"a", "b"}) == 0.4
    assert reciprocal_rank(["x", "y", "a"], {"a"}) == pytest.approx(1 / 3)
    assert reciprocal_rank(["x"], {"a"}) == 0.0
    assert recall_at_k(["a", "x", "b", "y", "z"], {"a", "b", "c", "d"}) == 0.5

def test_all_methods_score_every_document_and_stay_in_one_tenant(monkeypatch, tmp_path):
    use_fake_kb(monkeypatch, tmp_path, tenants=("tenant_a", "tenant_b"))
    docs_a, _ = kb._open("tenant_a")
    for m in kb.RETRIEVAL_METHODS:
        s = kb.scores("tenant_a", "working professional from Google", m)
        assert len(s) == len(docs_a) and np.isfinite(s).all()
        hits = kb.search("tenant_a", "follow-up policy for hot leads", k=5, method=m)
        assert all(h["id"].startswith("tenant_a:") for h in hits)

def test_bm25_finds_the_exact_policy_paragraph(monkeypatch, tmp_path):
    use_fake_kb(monkeypatch, tmp_path)
    top = kb.search("tenant_a", "follow-up policy hot leads", k=1, types=["business_context"], method="bm25")
    assert "Follow-up policy" in top[0]["text"]

def test_query_set_has_50_labelled_queries(monkeypatch, tmp_path):
    use_fake_kb(monkeypatch, tmp_path)
    qs = make_queries("tenant_a")
    assert len(qs) == 50 and all(q["relevant"] for q in qs)
    assert {q["type"] for q in qs} == {"lead_similarity", "pattern", "business_context"}
    assert all("Outcome" not in q["query"] for q in qs)
    assert len(make_queries("tenant_a", 100)) == 100               # O3: >= 100 test queries

def test_rag_retrieve_works_with_every_method(monkeypatch, tmp_path):
    from agent import rag
    small = use_fake_kb(monkeypatch, tmp_path)
    lead = {**small[small.tenant == "tenant_a"].iloc[0].to_dict()}
    lead["lead_id"] = lead["contact_id"]
    for m in kb.RETRIEVAL_METHODS:
        hits = rag.retrieve("tenant_a", lead, method=m)
        assert any("follow-up policy" in h["text"].lower() for h in hits)
        assert all(h.get("contact_id") != lead["lead_id"] for h in hits)
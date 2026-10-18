"""Phase 0: a tenant must never be able to read or change another tenant's rows."""
from __future__ import annotations

import inspect

from strategy_agent.db.tenant_store import TenantRepo

from .conftest import ctx


def _seed(repo, tag: str) -> dict:
    repo.upsert_profile({"industry": "retail", "brand_names": [f"Brand{tag}"]})
    cid = repo.add_campaign(industry="retail", region="Sri Lanka", objective="sales", monthly_budget=5000,
                            channel_mix={"meta_ads": 0.6, "email": 0.4}, outcome={"roi": 2.0})
    repo.save_recommendation(recommendation_id=f"rec-{tag}", request={"x": 1}, strategies=[{"s": 1}], model_version="v", adapter_id="none",
                             generator_used="template", evidence={}, prompt_hash="h", prompt_text=f"prompt-{tag}", ranking={})
    repo.add_feedback(recommendation_id=f"rec-{tag}", decision="accepted", strategy_id=None, edited_version=None, rating=5, comment="")
    repo.add_outcome(recommendation_id=f"rec-{tag}", metrics={"roi": 2}, primary_metric="roi", baseline=1.0, uplift=1.0, period="2026-Q3")
    repo.upsert_reward(f"rec-{tag}", 0.5, {})
    repo.set_consent(opted_in=True, scopes=["channel_mix"], consent_version="v1", granted_by="u", granted_at="2026-01-01", revoked_at=None)
    repo.add_ledger(f"contrib-{tag}", cid)
    repo.add_pair(recommendation_id=f"rec-{tag}", pair_kind="k", prompt="p", chosen="c", rejected="r", reward_chosen=1, reward_rejected=0)
    return {"campaign_id": cid}


def test_tenant_cannot_read_another_tenants_rows(tenant_store):
    a, b = tenant_store.scoped(ctx("tenant-a")), tenant_store.scoped(ctx("tenant-b"))
    ids_a = _seed(a, "A")
    assert a.list_campaigns() and a.get_recommendation("rec-A") and a.get_profile()

    # tenant B sees nothing of tenant A's
    assert b.list_campaigns() == []
    assert b.get_campaign(ids_a["campaign_id"]) is None
    assert b.get_recommendation("rec-A") is None
    assert b.list_feedback() == [] and b.get_outcome("rec-A") is None and b.get_reward("rec-A") is None
    assert b.get_profile() is None and b.ledger_contribution_ids() == [] and b.list_pairs() == []
    assert b.get_consent()["opted_in"] is False


def test_tenant_cannot_modify_or_delete_another_tenants_rows(tenant_store):
    a, b = tenant_store.scoped(ctx("tenant-a")), tenant_store.scoped(ctx("tenant-b"))
    ids_a = _seed(a, "A")
    _seed(b, "B")

    b.set_share_status(ids_a["campaign_id"], "shared")      # tries to touch A's campaign by id
    assert a.get_campaign(ids_a["campaign_id"])["share_status"] == "pending"
    assert b.clear_ledger() == 1                              # only B's own ledger row
    assert a.ledger_contribution_ids() == ["contrib-A"]
    assert b.delete_pairs_for("rec-A") == 0                   # A's pair is untouched
    assert len(a.list_pairs()) == 1


def test_same_ids_in_two_tenants_do_not_collide_in_reads(tenant_store):
    a, b = tenant_store.scoped(ctx("tenant-a")), tenant_store.scoped(ctx("tenant-b"))
    a.upsert_profile({"industry": "x"})
    b.upsert_profile({"industry": "y"})
    assert a.get_profile() == {"industry": "x"} and b.get_profile() == {"industry": "y"}
    assert a.get_or_create_contributor_token() != b.get_or_create_contributor_token()


def test_tenant_id_cannot_be_overridden_through_values(tenant_store):
    a, b = tenant_store.scoped(ctx("tenant-a")), tenant_store.scoped(ctx("tenant-b"))
    a._insert("feedback", {"id": "f1", "tenant_id": "tenant-b", "recommendation_id": "r", "decision": "accepted", "created_at": "t"})
    assert b.list_feedback() == [] and len(a.list_feedback()) == 1


def test_no_repo_method_accepts_a_tenant_id_parameter():
    for name, fn in inspect.getmembers(TenantRepo, inspect.isfunction):
        assert "tenant_id" not in inspect.signature(fn).parameters, f"{name} accepts tenant_id"


def test_only_opted_in_unrevoked_tenants_are_listed_for_batch(tenant_store):
    a, b = tenant_store.scoped(ctx("tenant-a")), tenant_store.scoped(ctx("tenant-b"))
    a.set_consent(opted_in=True, scopes=[], consent_version="v1", granted_by="u", granted_at="t", revoked_at=None)
    b.set_consent(opted_in=True, scopes=[], consent_version="v1", granted_by="u", granted_at="t", revoked_at="t2")
    assert tenant_store.list_tenants_with_active_consent() == ["tenant-a"]

"""Phase 1: the core novelty. The three tests the brief requires come first, then supporting tests."""
from __future__ import annotations

import sqlite3

import numpy as np
import pytest

from strategy_agent.eval.attacks import appears as _appears
from strategy_agent.eval.fixtures import seed_world
from strategy_agent.privacy.anonymizer import (Anonymizer, abstract_angle, budget_band, duration_bucket, industry_bucket, period_bucket,
                                               region_bucket, tenant_terms)
from strategy_agent.privacy.consent import update_consent
from strategy_agent.privacy.k_anonymity import METRIC_BOUNDS
from strategy_agent.schemas import ConsentUpdate

from .conftest import ctx, opt_in, opt_out

G1 = ("shop", 4, {"industry": "retail", "region": "Colombo, Sri Lanka", "objective": "sales", "monthly_budget": 4237.0})   # 4 tenants: passes k=3
G2 = ("saas", 2, {"industry": "SaaS", "region": "London, UK", "objective": "lead_gen", "monthly_budget": 31850.0})         # 2 tenants: below k=3


def _needles(ids: dict) -> list[tuple[str, str]]:
    """Everything that identifies a tenant, split into units that can be searched for without coincidental matches."""
    out = [("tenant_id", ids["tenant_id"]), ("email", ids["email"]), ("url", ids["url"].split("/")[2]), ("phone", ids["phone"]),
           ("budget", ids["budget"])]
    for kind in ("business", "brand", "product", "competitor", "person"):
        out.extend((kind, w) for w in ids[kind].split() if len(w) >= 4)
    out.append(("email_local", ids["email"].split("@")[0]))
    return out


def _share_everything(pipeline, world):
    for tid in world:
        opt_in(pipeline, tid)
    return pipeline.run_batch()


# ======================================================================== REQUIRED TEST 1
def test_no_identifying_data_survives_in_the_shared_store(tenant_store, shared_store, pipeline):
    world = seed_world(tenant_store, [G1, G2])
    summary = _share_everything(pipeline, world)
    assert summary["published_contribution"] > 0

    text = shared_store.dump_all_text()
    leaks = [(tid, kind, needle) for tid, ids in world.items() for kind, needle in _needles(ids) if _appears(needle, text)]
    assert leaks == [], f"identifying data reached the shared store: {leaks}"

    # structurally: no tenant / brand / contact column exists anywhere in the shared DB
    with sqlite3.connect(shared_store.path) as conn:
        for table in ("contributions", "insights"):
            cols = [r[1].lower() for r in conn.execute(f"PRAGMA table_info({table})")]
            assert not any(bad in c for c in cols for bad in ("tenant_id", "brand", "email", "phone", "business", "campaign")), cols


def test_free_text_never_reaches_the_shared_store_only_an_abstract_angle(tenant_store, shared_store, pipeline):
    world = seed_world(tenant_store, [G1])
    _share_everything(pipeline, world)
    from strategy_agent.privacy.anonymizer import ANGLE_TAXONOMY
    for c in shared_store.list_contributions():
        assert c["angle"] in ANGLE_TAXONOMY
        assert set(c["channel_mix"]) <= {"meta_ads", "google_ads", "email", "social", "seo", "content_marketing", "influencer", "sms", "other_channel"}


# ======================================================================== REQUIRED TEST 2
def test_k_anonymity_blocks_small_groups(tenant_store, shared_store, pipeline, settings):
    world = seed_world(tenant_store, [G1, G2], seed=3)
    summary = _share_everything(pipeline, world)

    insights = shared_store.query_insights()
    published = {(i["industry_bucket"], i["objective"]) for i in insights}
    assert ("retail_ecommerce", "sales") in published                 # 4 distinct tenants >= k=3
    assert ("technology", "lead_gen") not in published                # 2 distinct tenants < k=3
    assert summary["held_back_below_k"] >= 1
    assert all(i["support_count"] >= settings.k_anonymity for i in insights)

    # the contributions of the small group DO exist in staging, which proves it is the k-gate that held them back
    assert any(c["industry_bucket"] == "technology" for c in shared_store.list_contributions())


def test_many_campaigns_from_one_tenant_do_not_satisfy_k(tenant_store, shared_store, pipeline):
    world = seed_world(tenant_store, [("solo", 1, {"industry": "retail", "region": "Colombo", "objective": "sales", "n_campaigns": 12})])
    _share_everything(pipeline, world)
    assert shared_store.count_contributions() == 12 and shared_store.query_insights() == []   # 12 contributions, 1 distinct tenant


def test_group_becomes_publishable_when_it_reaches_k(tenant_store, shared_store, pipeline):
    world = seed_world(tenant_store, [("saas", 2, G2[2])])
    _share_everything(pipeline, world)
    assert shared_store.query_insights() == []
    more = seed_world(tenant_store, [("saas-late", 1, G2[2])], seed=11)
    opt_in(pipeline, "saas-late-1")
    pipeline.run_batch()
    assert len(shared_store.query_insights()) == 1 and shared_store.query_insights()[0]["support_count"] == 3


# ======================================================================== REQUIRED TEST 3
def test_revocation_removes_all_of_a_tenants_contributions(tenant_store, shared_store, pipeline):
    world = seed_world(tenant_store, [G1])
    _share_everything(pipeline, world)
    repo1 = tenant_store.scoped(ctx("shop-1"))
    mine = set(repo1.ledger_contribution_ids())
    assert mine and mine <= {c["contribution_id"] for c in shared_store.list_contributions()}
    before = shared_store.count_contributions()
    assert len(shared_store.query_insights()) == 1                    # 4 tenants >= k

    out = opt_out(pipeline, "shop-1")                                  # the tenant admin revokes
    assert out.opted_in is False and out.revoked_at is not None

    remaining = {c["contribution_id"] for c in shared_store.list_contributions()}
    assert not (mine & remaining), "revoked contributions are still in the shared store"
    assert shared_store.count_contributions() == before - len(mine)
    assert repo1.ledger_contribution_ids() == []
    assert len(shared_store.query_insights()) == 1                    # 3 tenants left, still >= k

    opt_out(pipeline, "shop-2")                                        # a second tenant leaves: only 2 remain, below k
    assert shared_store.query_insights() == [], "an insight stayed published after support fell below k"
    assert "shop-1" not in shared_store.dump_all_text()


def test_re_opting_in_shares_again_with_a_new_token(tenant_store, shared_store, pipeline):
    world = seed_world(tenant_store, [("shop", 1, G1[2])])
    opt_in(pipeline, "shop-1"); pipeline.run_batch()
    repo = tenant_store.scoped(ctx("shop-1"))
    first_tokens = {c["contributor_token"] for c in shared_store.list_contributions()}
    opt_out(pipeline, "shop-1")
    assert shared_store.count_contributions() == 0
    assert {c["id"] for c in repo.list_pending_share_campaigns()}        # campaigns are shareable again
    opt_in(pipeline, "shop-1"); pipeline.run_batch()
    second_tokens = {c["contributor_token"] for c in shared_store.list_contributions()}
    assert shared_store.count_contributions() > 0 and first_tokens.isdisjoint(second_tokens)


# ======================================================================== consent behaviour
def test_no_consent_means_no_contribution(tenant_store, shared_store, pipeline):
    seed_world(tenant_store, [("shop", 2, G1[2])])
    opt_in(pipeline, "shop-1")                                         # shop-2 never opts in
    pipeline.run_batch()
    assert shared_store.count_contributions() == len(tenant_store.scoped(ctx("shop-1")).ledger_contribution_ids())
    c = tenant_store.scoped(ctx("shop-2")).list_pending_share_campaigns()[0]
    assert pipeline.process_campaign(ctx("shop-2"), c).status == "skipped_no_consent"


def test_only_granted_scopes_are_shared(tenant_store, shared_store, pipeline):
    seed_world(tenant_store, [("shop", 1, G1[2])])
    opt_in(pipeline, "shop-1", scopes=["channel_mix"])
    pipeline.run_batch()
    for c in shared_store.list_contributions():
        assert c["outcome_metrics"] == {} and c["angle"] is None and c["duration_bucket"] is None
        assert c["budget_band"] == "undisclosed"
        shares = list(c["channel_mix"].values())
        assert max(shares) - min(shares) < 0.01          # budget_split withheld -> even split, not the real shares


def test_only_ratio_metrics_are_ever_shared(tenant_store, shared_store, pipeline):
    seed_world(tenant_store, [("shop", 1, G1[2])])
    opt_in(pipeline, "shop-1"); pipeline.run_batch()
    for c in shared_store.list_contributions():
        assert set(c["outcome_metrics"]) <= {"ctr", "conversion_rate", "cpl", "roi", "uplift"}      # never spend / impressions


def test_narrowing_scopes_purges_what_was_shared_under_the_broader_consent(tenant_store, shared_store, pipeline):
    seed_world(tenant_store, [("shop", 1, G1[2])])
    opt_in(pipeline, "shop-1"); pipeline.run_batch()
    assert any(c["outcome_metrics"] for c in shared_store.list_contributions())
    opt_in(pipeline, "shop-1", scopes=["channel_mix"])                 # narrower than before
    assert shared_store.count_contributions() == 0                     # purged immediately
    pipeline.run_batch()
    assert all(c["outcome_metrics"] == {} for c in shared_store.list_contributions())


def test_only_a_tenant_admin_can_change_consent(tenant_store, pipeline):
    marketer = ctx("shop-1", roles=("marketer",))
    with pytest.raises(PermissionError):
        update_consent(tenant_store.scoped(marketer), marketer, ConsentUpdate(opted_in=True, scopes=["channel_mix"]), pipeline)


def test_opting_in_needs_a_scope(tenant_store, pipeline):
    admin = ctx("shop-1")
    with pytest.raises(ValueError):
        update_consent(tenant_store.scoped(admin), admin, ConsentUpdate(opted_in=True, scopes=[]), pipeline)


# ======================================================================== anonymiser
def test_structured_identifiers_and_tenant_names_are_always_redacted(anonymizer):
    assert "presidio" in anonymizer.engine
    text = "Call on +94 77 123 4567 or mail priya@zephyrmail.com, see https://www.zephyr-shop.com. Zephyr Gold beats RivalCorp."
    out = anonymizer.redact(text, ["Zephyr", "Zephyr Gold", "RivalCorp"])
    for secret in ("123 4567", "priya@", "zephyr-shop", "Zephyr", "RivalCorp"):
        assert secret.lower() not in out.lower(), (secret, out)


def test_person_names_are_detected_by_the_ner_model_on_a_best_effort_basis(anonymizer):
    # en_core_web_sm is a small model: names are caught in clear sentences but not guaranteed in every context.
    # That is acceptable ONLY because free text is never stored; the shared store keeps an abstract angle from a fixed list.
    assert "PERSON" in anonymizer.entities_in("Please contact John Smith for details.", [])
    assert "John" not in anonymizer.redact("Please contact John Smith for details.", [])


def test_regex_fallback_works_without_presidio():
    a = Anonymizer(use_presidio=False)
    assert a.engine == "regex"
    out = a.redact("mail bob@acme.com or +1 (415) 555-0199, https://acme.io/x, host 10.0.0.12, Acme rocks", ["Acme"])
    for secret in ("bob@", "555-0199", "acme.io", "10.0.0.12", "Acme"):
        assert secret.lower() not in out.lower(), (secret, out)


def test_entities_in_returns_types_not_values(anonymizer):
    found = anonymizer.entities_in("write to jane@corp.com", [])
    assert "EMAIL_ADDRESS" in found and all("@" not in f for f in found)


def test_tenant_terms_adds_variants_without_legal_suffix():
    terms = tenant_terms({"business_name": "Zephyr Holdings Pvt Ltd", "brand_names": ["Zephyr"], "competitor_names": ["Rival Corp"]})
    assert {"Zephyr Holdings Pvt Ltd", "Zephyr Holdings", "Zephyr", "Rival Corp", "Rival"} <= set(terms)


def _rec(**over):
    rec = {"industry_bucket": "retail_ecommerce", "region": "south_asia", "budget_band": "1k_5k", "objective": "sales",
           "angle": "price_value", "duration_bucket": None, "period": None, "channel_mix": {"email": 1.0}}
    rec.update(over)
    return rec


def test_validator_accepts_a_clean_record_and_refuses_anything_outside_the_vocabularies(pipeline):
    assert pipeline._validate_record(_rec(), []) == ""
    assert pipeline._validate_record(_rec(angle="write to bob@acme.com"), []).startswith("not_in_vocabulary:angle")
    assert pipeline._validate_record(_rec(region="Colombo"), []).startswith("not_in_vocabulary:region")
    assert pipeline._validate_record(_rec(channel_mix={"AcmeNewsletter": 1.0}), []).startswith("not_in_vocabulary:channel_mix")
    assert pipeline._validate_record(_rec(period="2026-08-14"), []).startswith("not_in_vocabulary:period")
    assert pipeline._validate_record({**_rec(), "tenant_id": "x"}, []).startswith("forbidden_keys:")


def test_second_layer_pii_scan_catches_names_even_if_a_value_were_in_vocabulary(pipeline):
    # the scan layer on its own: a string that contains a tenant's brand name is flagged
    assert pipeline._pii_problems(_rec(angle="acme deal"), ["Acme"]).startswith("pii_remaining:")
    assert pipeline._pii_problems(_rec(), ["Acme"]) == ""


# ======================================================================== generalisation, noise
def test_generalisers():
    assert industry_bucket("SaaS platform") == "technology" and industry_bucket("Organic tea exporter") == "hospitality_travel"
    assert industry_bucket("Underwater basket weaving") == "other"
    assert region_bucket("Colombo, Sri Lanka") == "south_asia" and region_bucket("Berlin, Germany") == "europe" and region_bucket("Narnia") == "other"
    assert [budget_band(x) for x in (500, 4999, 5000, 99_999, 100_000)] == ["under_1k", "1k_5k", "5k_20k", "20k_100k", "over_100k"]
    assert period_bucket("2026-08-14") == "2026-Q3" and period_bucket(None) == "unknown"
    assert [duration_bucket(w) for w in (2, 8, 20, None)] == ["short", "medium", "long", "unknown"]
    assert abstract_angle("20% discount, limited time") == "urgency_scarcity" and abstract_angle("nothing special") == "general_value"


def test_laplace_noise_changes_aggregates_but_keeps_them_valid(tenant_store, shared_store, anonymizer, settings):
    from strategy_agent.privacy.pipeline import ConsentGatedPipeline
    world = seed_world(tenant_store, [G1])

    plain = ConsentGatedPipeline(tenant_store, shared_store, anonymizer, settings, noise_seed=5)
    _share_everything(plain, world)
    base = shared_store.query_insights()[0]

    noisy_settings = settings.model_copy(update={"enable_laplace_noise": True, "laplace_epsilon": 0.5})
    noisy = ConsentGatedPipeline(tenant_store, shared_store, anonymizer, noisy_settings, noise_seed=5)
    noisy.rebuild_insights()
    out = shared_store.query_insights()[0]

    assert out["outcome_metrics"] != base["outcome_metrics"] or out["channel_mix"] != base["channel_mix"]
    assert abs(sum(out["channel_mix"].values()) - 1.0) < 0.01
    for name, value in out["outcome_metrics"].items():
        lo, hi = METRIC_BOUNDS[name]
        assert lo <= value <= hi
    assert out["contribution_id"] == base["contribution_id"]                       # ids are stable across rebuilds


def test_campaigns_without_outcomes_are_not_shared(tenant_store, shared_store, pipeline):
    repo = tenant_store.scoped(ctx("t1"))
    repo.add_campaign(industry="retail", region="Colombo", objective="sales", monthly_budget=1000, channel_mix={"email": 1.0}, outcome=None)
    opt_in(pipeline, "t1"); pipeline.run_batch()
    assert shared_store.count_contributions() == 0


def test_negative_control_the_leak_check_really_catches_a_planted_leak(tenant_store, shared_store, pipeline):
    """If this test ever passes while the leak check is broken, the headline privacy test would be meaningless."""
    world = seed_world(tenant_store, [G1])
    _share_everything(pipeline, world)
    ids = world["shop-1"]
    assert not any(_appears(n, shared_store.dump_all_text()) for _, n in _needles(ids))           # clean to start with
    for kind, planted in (("brand", ids["brand"]), ("email", ids["email"]), ("phone", ids["phone"]), ("person", ids["person"].split()[0]),
                          ("tenant_id", ids["tenant_id"]), ("budget", ids["budget"])):
        shared_store.add_contribution({
            "contribution_id": f"planted-{kind}", "contributor_token": "t", "industry_bucket": "other", "region": "other",
            "budget_band": "1k_5k", "objective": "sales", "channel_mix": {"email": 1.0}, "outcome_metrics": {}, "angle": f"x {planted} y",
        })
        assert any(_appears(n, shared_store.dump_all_text()) for k, n in _needles(ids) if k.startswith(kind) or (kind == "email" and k == "email")), kind
        shared_store.delete_contributions([f"planted-{kind}"])

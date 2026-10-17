"""Phase 2: generation, validation, fallback, RAG, ranking and the /generate endpoint."""
from __future__ import annotations

import copy
import json

import pytest
from fastapi.testclient import TestClient

from strategy_agent.api.main import create_app
from strategy_agent.eval.fixtures import seed_world
from strategy_agent.generation.generator import (GenerationError, Generator, LLMGenerator, TemplateGenerator, build_generators, extract_json,
                                                 normalise_strategy_dict, parse_and_validate, validate_strategy)
from strategy_agent.generation.prompt import build_prompt
from strategy_agent.generation.rag import Retriever, retrieve_shared, retrieve_tenant
from strategy_agent.generation.ranking import compliance_violations, constraint_fit, historical_uplift_similarity, rank_strategies
from strategy_agent.generation.service import InfeasibleRequest, StrategyService
from strategy_agent.schemas import GenerateRequest, Strategy

from .conftest import ctx, opt_in

ADMIN = lambda t: {"X-Dev-Tenant": t, "X-Dev-Roles": "tenant_admin", "X-Dev-User": f"admin-{t}"}  # noqa: E731
BASE = {
    "business_profile": {"industry": "retail", "business_model": "B2C", "target_audience": "young professionals in Colombo",
                         "region": "Colombo, Sri Lanka", "brand_tone": "friendly", "monthly_budget": 5000,
                         "business_name": "Zephyr Holdings Pvt Ltd", "brand_names": ["Zephyr"], "competitor_names": ["RivalCo"]},
    "objective": {"type": "sales", "target_kpi": "roi", "target_value": 2.5, "time_horizon": "8 weeks"},
    "constraints": {},
}


def make_req(**over) -> GenerateRequest:
    d = copy.deepcopy(BASE)
    for k, v in over.items():
        if isinstance(v, dict) and isinstance(d.get(k), dict):
            d[k].update(v)
        else:
            d[k] = v
    return GenerateRequest(**d)


def bundle_for(req, n=3, tenant_ev=(), shared_ev=()):
    return build_prompt(req, n, list(tenant_ev), list(shared_ev))


class ScriptedGen(Generator):
    """Returns pre-programmed raw outputs, one per call (the last one repeats)."""
    def __init__(self, outputs, name="fake"):
        self.outputs, self.calls, self.name = outputs, 0, name

    def generate(self, bundle):
        out = self.outputs[min(self.calls, len(self.outputs) - 1)]
        self.calls += 1
        if isinstance(out, Exception):
            raise out
        return out(bundle) if callable(out) else out


def make_service(settings, tenant_store, shared_store, primary=None):
    return StrategyService(settings, tenant_store, shared_store, primary, TemplateGenerator(), Retriever("tfidf"))


# ============================================================================================ template generator
@pytest.mark.parametrize("model", ["B2B", "B2C"])
@pytest.mark.parametrize("objective", ["lead_gen", "awareness", "retention", "sales"])
def test_template_output_is_valid_for_every_objective_and_business_model(model, objective):
    req = make_req(business_profile={"business_model": model}, objective={"type": objective, "target_kpi": "ctr", "target_value": 0.03})
    raw = TemplateGenerator().generate(bundle_for(req, n=5))
    strategies = parse_and_validate(raw, req)
    assert len(strategies) == 5
    for s in strategies:
        assert abs(sum(c.budget_share for c in s.channels) - 1.0) <= 0.02
        assert s.timeline and s.kpis and 0 <= s.confidence <= 1 and s.expected_uplift.low <= s.expected_uplift.high
    assert len({s.strategy_id for s in strategies}) == 5 and len({s.title for s in strategies}) == 5


def test_template_respects_blocked_and_allowed_channels_and_is_deterministic():
    req = make_req(constraints={"channels_blocked": ["Meta Ads", "sms"]})
    s1 = parse_and_validate(TemplateGenerator().generate(bundle_for(req)), req)
    assert all(c.channel not in {"meta_ads", "sms"} for s in s1 for c in s.channels)
    req2 = make_req(constraints={"channels_allowed": ["email", "seo"]})
    s2 = parse_and_validate(TemplateGenerator().generate(bundle_for(req2)), req2)
    assert all(c.channel in {"email", "seo"} for s in s2 for c in s.channels)
    assert TemplateGenerator().generate(bundle_for(req)) == TemplateGenerator().generate(bundle_for(req))


def test_template_uses_the_objective_target_as_the_first_kpi_and_the_requested_horizon():
    req = make_req(objective={"type": "lead_gen", "target_kpi": "cost_per_lead", "target_value": 9.5, "time_horizon": "2 months"})
    s = parse_and_validate(TemplateGenerator().generate(bundle_for(req, 1)), req)[0]
    assert s.kpis[0].name == "cost_per_lead" and s.kpis[0].target == 9.5
    assert max(t.week for t in s.timeline) == 8 and min(t.week for t in s.timeline) == 1


# ============================================================================================ parsing / validation
def test_extract_json_handles_fences_prose_and_wrapped_objects():
    obj = {"title": "t"}
    assert extract_json("Sure! Here you go:\n```json\n[{\"title\": \"t\"}]\n```\nHope it helps") == [obj]
    assert extract_json('{"strategies": [{"title": "t"}]}') == [obj]
    assert extract_json('{"title": "t"}') == [obj]
    for bad in ("no json here", "[1, 2, 3]", "[]", "{broken"):
        with pytest.raises(GenerationError):
            extract_json(bad)


def _one_valid_dict():
    return json.loads(TemplateGenerator().generate(bundle_for(make_req(), 1)))[0]


def test_close_budget_shares_are_repaired_but_nonsense_is_not():
    d = _one_valid_dict()
    for c in d["channels"]:
        c["budget_share"] = round(c["budget_share"] * 0.8, 4)            # now sums to ~0.8
    warnings: list[str] = []
    s = validate_strategy(d, make_req(), warnings)
    assert abs(sum(c.budget_share for c in s.channels) - 1.0) <= 0.02 and warnings
    d2 = _one_valid_dict()
    for c in d2["channels"]:
        c["budget_share"] = 0.9                                          # sums to far more than 1.5
    with pytest.raises(GenerationError):
        validate_strategy(d2, make_req())


def test_unknown_keys_are_dropped_and_channel_aliases_canonicalised():
    d = _one_valid_dict()
    d["invented_field"] = 1
    d["channels"][0]["channel"] = "Facebook"
    s = validate_strategy(d, make_req())
    assert s.channels[0].channel == "meta_ads"


def test_blocked_channels_in_model_output_are_rejected():
    d = _one_valid_dict()
    req = make_req(constraints={"channels_blocked": [d["channels"][0]["channel"]]})
    with pytest.raises(GenerationError, match="constraint violation"):
        validate_strategy(d, req)


def test_missing_required_fields_fail_schema_validation():
    d = _one_valid_dict()
    del d["kpis"]
    with pytest.raises(GenerationError, match="schema validation failed"):
        validate_strategy(d, make_req())


# ============================================================================================ service: never crashes
@pytest.mark.parametrize("bad", ["I cannot help with that.", "[{\"title\": \"only a title\"}]", RuntimeError("boom"), ""])
def test_unusable_model_output_falls_back_to_the_template_without_crashing(settings, tenant_store, shared_store, bad):
    gen = ScriptedGen([bad])
    svc = make_service(settings, tenant_store, shared_store, gen)
    res = svc.generate(ctx("t1"), make_req())
    assert res.generator_used == "template" and len(res.strategies) == 3 and gen.calls == 2   # tried twice, then fell back
    assert any("unusable" in w for w in res.warnings) and any("fell back" in w for w in res.warnings)
    assert res.model_version == "template-rules-v1" and res.adapter_id == "none"


def test_invalid_first_attempt_then_valid_second_attempt_is_used(settings, tenant_store, shared_store):
    good = lambda b: TemplateGenerator().generate(b)  # noqa: E731
    gen = ScriptedGen(["garbage", good])
    res = make_service(settings, tenant_store, shared_store, gen).generate(ctx("t1"), make_req())
    assert gen.calls == 2 and res.generator_used == "fake" and len(res.strategies) == 3


def test_partial_model_output_is_topped_up_from_the_template(settings, tenant_store, shared_store):
    one = lambda b: json.dumps(json.loads(TemplateGenerator().generate(b))[:1])  # noqa: E731
    res = make_service(settings, tenant_store, shared_store, ScriptedGen([one])).generate(ctx("t1"), make_req())
    assert res.generator_used == "fake+template" and len(res.strategies) == 3 and any("1/3" in w for w in res.warnings)


def test_impossible_constraints_are_reported_not_crashed(settings, tenant_store, shared_store):
    req = make_req(constraints={"channels_allowed": ["tiktok_ads"], "channels_blocked": ["tiktok_ads"]})
    with pytest.raises(InfeasibleRequest):
        make_service(settings, tenant_store, shared_store).generate(ctx("t1"), req)


def test_local_llm_is_reported_unavailable_when_weights_are_not_cached_and_factory_falls_back():
    assert LLMGenerator("no-such-org/no-such-model").available() is False
    primary, fallback = build_generators("template", "x", 100)
    assert primary is None and isinstance(fallback, TemplateGenerator)
    primary, _ = build_generators("auto", "no-such-org/no-such-model", 100)
    assert primary is None


# ============================================================================================ prompt
def test_prompt_has_all_sections_labels_cross_tenant_evidence_and_is_deterministic():
    req = make_req()
    b1, b2 = bundle_for(req), bundle_for(req)
    for section in ("## Business context", "## Objective", "## Constraints", "## Evidence from this business's own past campaigns",
                    "## Cross-business evidence", "## Output"):
        assert section in b1.text
    assert "NOT this business" in b1.text and b1.prompt_hash == b2.prompt_hash and len(b1.prompt_hash) == 32
    assert "Zephyr" not in b1.text and "RivalCo" not in b1.text      # brand / competitor names are not sent to the model
    assert [m["role"] for m in b1.messages] == ["system", "user"]


# ============================================================================================ RAG
def test_tenant_retrieval_is_scoped_to_the_calling_tenant(tenant_store):
    seed_world(tenant_store, [("a", 1, {"industry": "retail", "objective": "sales", "n_campaigns": 4}), ("b", 1, {"industry": "retail", "objective": "sales", "n_campaigns": 4})])
    repo_a, repo_b = tenant_store.scoped(ctx("a-1")), tenant_store.scoped(ctx("b-1"))
    ids_a = {c["id"] for c in repo_a.list_campaigns()}
    ids_b = {c["id"] for c in repo_b.list_campaigns()}
    ev_a = retrieve_tenant(repo_a, make_req(), 3, Retriever("tfidf"))
    assert ev_a and {e.campaign_id for e in ev_a} <= ids_a and not ({e.campaign_id for e in ev_a} & ids_b)
    assert retrieve_tenant(tenant_store.scoped(ctx("nobody")), make_req(), 3, Retriever("tfidf")) == []


def test_shared_retrieval_filters_by_industry_bucket_and_objective_and_contains_no_tenant_data(tenant_store, shared_store, pipeline):
    world = seed_world(tenant_store, [("shop", 3, {"industry": "retail", "region": "Colombo, Sri Lanka", "objective": "sales"})])
    for t in world:
        opt_in(pipeline, t)
    pipeline.run_batch()
    hit = retrieve_shared(shared_store, make_req(), 3, Retriever("tfidf"))
    assert len(hit) == 1 and hit[0].support_count == 3
    assert retrieve_shared(shared_store, make_req(objective={"type": "lead_gen", "target_kpi": "ctr", "target_value": 1}), 3, Retriever("tfidf")) == []
    assert retrieve_shared(shared_store, make_req(business_profile={"industry": "SaaS"}), 3, Retriever("tfidf")) == []
    blob = json.dumps([e.__dict__ for e in hit]).lower()
    assert "shop-" not in blob and "tenant" not in blob


# ============================================================================================ ranking
def _strategy_with(mix: dict[str, float], confidence=0.7, title="s") -> Strategy:
    return Strategy(title=title, summary="s", channels=[{"channel": c, "budget_share": v} for c, v in mix.items()], audience_segments=["a"],
                    messaging_angles=["m"], timeline=[{"week": 1, "actions": ["x"]}], kpis=[{"name": "roi", "target": 2}],
                    expected_uplift={"metric": "roi", "low": .1, "high": .2}, rationale="r", confidence=confidence)


def test_score_is_the_documented_weighted_sum_and_is_logged(settings):
    req = make_req()
    a, b = _strategy_with({"meta_ads": .5, "google_ads": .5}, 0.9, "a"), _strategy_with({"influencer": .5, "events": .5}, 0.4, "b")
    ranked, breakdown = rank_strategies([b, a], req, [], [], settings.rank_weights)
    assert [s.rank for s in ranked] == [1, 2] and ranked[0].title == "a"
    w = settings.rank_weights
    for s in ranked:
        sc = breakdown["scores"][s.strategy_id]
        assert sc["score"] == pytest.approx(w["confidence"] * sc["confidence"] + w["uplift"] * sc["uplift"] + w["constraint"] * sc["constraint"] + w["shared"] * sc["shared"], abs=1e-3)
    assert breakdown["weights"] == w and "formula" in breakdown


def test_blocked_channel_gets_zero_constraint_fit_and_ranks_last(settings):
    req = make_req(constraints={"channels_blocked": ["sms"]})
    ok, bad = _strategy_with({"email": 1.0}, 0.6, "ok"), _strategy_with({"sms": 1.0}, 0.99, "bad")
    assert constraint_fit(bad, req) == 0.0 and constraint_fit(ok, req) == 1.0 and compliance_violations(bad, req)
    ranked, _ = rank_strategies([bad, ok], req, [], [], settings.rank_weights)
    assert ranked[0].title == "ok"


def test_strategies_resembling_the_tenants_best_campaigns_score_higher_on_historical_uplift():
    hist = [{"objective": "sales", "outcome": {"roi": 4.0}, "channel_mix": {"meta_ads": .5, "google_ads": .5}},
            {"objective": "sales", "outcome": {"roi": 3.5}, "channel_mix": {"meta_ads": .6, "google_ads": .4}},
            {"objective": "sales", "outcome": {"roi": 0.8}, "channel_mix": {"influencer": .5, "events": .5}}]
    like_winners = _strategy_with({"meta_ads": .55, "google_ads": .45})
    like_loser = _strategy_with({"influencer": .5, "events": .5})
    assert historical_uplift_similarity(like_winners, hist, "sales") > historical_uplift_similarity(like_loser, hist, "sales") + 0.4
    assert historical_uplift_similarity(like_winners, [], "sales") == 0.5      # no history -> neutral, not zero


# ============================================================================================ API
@pytest.fixture
def client(settings):
    return TestClient(create_app(settings, use_default_generators=False))


def test_generate_endpoint_returns_valid_ranked_strategies_and_persists_provenance(client):
    r = client.post("/v1/strategy/generate", json=BASE, headers=ADMIN("t1"))
    assert r.status_code == 200, r.text
    body = r.json()
    assert len(body["strategies"]) == 3 and [s["rank"] for s in body["strategies"]] == [1, 2, 3]
    for s in body["strategies"]:
        Strategy.model_validate(s)
    repo = client.app.state.tenant_store.scoped(ctx("t1"))
    rec = repo.get_recommendation(body["recommendation_id"])
    assert rec["model_version"] == "template-rules-v1" and rec["adapter_id"] == "none" and len(rec["prompt_hash"]) == 32
    assert rec["generator_used"] == "template" and rec["ranking"]["weights"] and rec["strategies"][0]["rank"] == 1
    assert repo.get_profile()["brand_names"] == ["Zephyr"]                      # names stored for the PII recognisers
    # another tenant cannot see this recommendation
    assert client.app.state.tenant_store.scoped(ctx("t2")).get_recommendation(body["recommendation_id"]) is None


def test_generate_refuses_tenant_id_requires_auth_and_validates_the_body(client):
    assert client.post("/v1/strategy/generate", json={**BASE, "tenant_id": "evil"}, headers=ADMIN("t1")).status_code == 400
    assert client.post("/v1/strategy/generate", json=BASE).status_code == 401
    bad = copy.deepcopy(BASE); bad["objective"]["type"] = "world_domination"
    assert client.post("/v1/strategy/generate", json=bad, headers=ADMIN("t1")).status_code == 422
    bad = copy.deepcopy(BASE); bad["business_profile"]["monthly_budget"] = -5
    assert client.post("/v1/strategy/generate", json=bad, headers=ADMIN("t1")).status_code == 422
    infeasible = copy.deepcopy(BASE); infeasible["constraints"] = {"channels_allowed": ["sms"], "channels_blocked": ["sms"]}
    assert client.post("/v1/strategy/generate", json=infeasible, headers=ADMIN("t1")).status_code == 422


def test_n_strategies_is_honoured(client):
    for n in (1, 5):
        r = client.post("/v1/strategy/generate", json={**BASE, "n_strategies": n}, headers=ADMIN("t1"))
        assert len(r.json()["strategies"]) == n


def test_shared_insights_change_the_output_only_when_requested(client, settings):
    app = client.app
    world = seed_world(app.state.tenant_store, [("shop", 3, {"industry": "retail", "region": "Colombo, Sri Lanka", "objective": "sales"})])
    for t in world:
        client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": ["channel_mix", "budget_split", "outcome_metrics", "messaging_angles", "timeline"]}, headers=ADMIN(t))
    app.state.pipeline.run_batch()

    on = client.post("/v1/strategy/generate", json={**BASE, "use_shared_insights": True}, headers=ADMIN("newcomer")).json()
    off = client.post("/v1/strategy/generate", json={**BASE, "use_shared_insights": False}, headers=ADMIN("newcomer")).json()
    assert len(on["evidence_ids"]["shared_insights"]) == 1 and off["evidence_ids"]["shared_insights"] == []
    assert "anonymised cross-business" in on["strategies"][0]["rationale"] and "anonymised cross-business" not in off["strategies"][0]["rationale"]
    mix = lambda body: {c["channel"]: c["budget_share"] for c in body["strategies"][0]["channels"]}  # noqa: E731
    assert mix(on) != mix(off)                                                    # the cross-tenant evidence really influenced the plan
    assert on["strategies"][0]["evidence"]["shared_insights"] == on["evidence_ids"]["shared_insights"]
    assert "shop-" not in json.dumps(on)                                          # and nothing identifying came with it


def test_own_campaign_history_is_used_as_evidence(client):
    seed_world(client.app.state.tenant_store, [("own", 1, {"industry": "retail", "objective": "sales", "n_campaigns": 5})])
    r = client.post("/v1/strategy/generate", json=BASE, headers=ADMIN("own-1")).json()
    assert len(r["evidence_ids"]["tenant_sources"]) == 3 and r["evidence_ids"]["shared_insights"] == []


def test_health_reports_the_generator(client):
    assert client.get("/health").json()["generator"] == "template"


def test_llm_availability_requires_the_weights_not_just_the_config(tmp_path, monkeypatch):
    import huggingface_hub
    snap = tmp_path / "snap"
    snap.mkdir()
    (snap / "config.json").write_text("{}")
    (snap / "tokenizer.json").write_text("{}")
    monkeypatch.setattr(huggingface_hub, "snapshot_download", lambda *a, **k: str(snap))
    g = LLMGenerator("org/model")
    assert g._weights_cached() is False and g.available() is False          # config + tokenizer only (the bug we hit)
    (snap / "model.safetensors").write_bytes(b"x")
    assert g._weights_cached() is True
    # sharded model: all listed shards must exist
    (snap / "model.safetensors").unlink()
    (snap / "model.safetensors.index.json").write_text(json.dumps({"weight_map": {"a": "m-1.safetensors", "b": "m-2.safetensors"}}))
    (snap / "m-1.safetensors").write_bytes(b"x")
    assert g._weights_cached() is False
    (snap / "m-2.safetensors").write_bytes(b"x")
    assert g._weights_cached() is True

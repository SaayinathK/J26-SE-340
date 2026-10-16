"""Phase 3: feedback, outcomes, the reward formula, preference pairs, and the loop back into the consent-gated pipeline."""
from __future__ import annotations

import copy
import json

import pytest
from fastapi.testclient import TestClient

from strategy_agent.api.main import create_app
from strategy_agent.eval.fixtures import seed_world
from strategy_agent.learning.feedback import compute_reward, explicit_feedback_score, primary_metric, uplift_from
from strategy_agent.learning.preference import export_pairs_jsonl, messages_from_prompt_text

from .conftest import ctx
from .helpers import fb, out
from .test_generation import BASE

H = lambda t, roles="tenant_admin": {"X-Dev-Tenant": t, "X-Dev-Roles": roles, "X-Dev-User": f"u-{t}"}  # noqa: E731
W = {"outcome": 0.6, "feedback": 0.4}
ALL_SCOPES = ["channel_mix", "budget_split", "outcome_metrics", "messaging_angles", "timeline"]


# ============================================================================================ reward math (pure)
def test_uplift_direction_depends_on_the_metric():
    assert uplift_from(3.0, 2.0, lower_is_better=False) == 0.5          # roi up 50%
    assert uplift_from(8.0, 10.0, lower_is_better=True) == 0.2          # cpl down 20% is an improvement
    assert uplift_from(12.0, 10.0, lower_is_better=True) == -0.2
    assert uplift_from(None, 2.0, False) is None and uplift_from(1.0, None, False) is None and uplift_from(1.0, 0.0, False) is None


def test_primary_metric_per_objective():
    assert primary_metric("lead_gen") == ("cpl", True) and primary_metric("sales") == ("roi", False)
    assert primary_metric("awareness")[1] is False and primary_metric("retention")[0] == "conversion_rate"


def test_explicit_feedback_score():
    assert explicit_feedback_score("accepted", 5) == 1.0 and explicit_feedback_score("rejected", 1) == -1.0
    assert explicit_feedback_score("edited", None) == 0.5 and explicit_feedback_score(None, 4) == 0.5 and explicit_feedback_score(None, None) is None


def test_reward_is_the_documented_weighted_combination_and_renormalises_missing_signals():
    r, comps = compute_reward(0.5, 1.0, W)
    assert r == pytest.approx(0.6 * 0.5 + 0.4 * 1.0)
    assert compute_reward(0.5, None, W)[0] == pytest.approx(0.5)            # outcome only -> its weight becomes 1, not 0.6
    assert compute_reward(None, -1.0, W)[0] == pytest.approx(-1.0)          # feedback only
    assert compute_reward(5.0, 1.0, W)[0] == pytest.approx(1.0)             # uplift is clipped to [-1, 1] first
    assert compute_reward(None, None, W) is None


# ============================================================================================ API flow
@pytest.fixture
def client(settings):
    return TestClient(create_app(settings, use_default_generators=False))


def _generate(client, tenant="t1", **over) -> dict:
    body = {**copy.deepcopy(BASE), **over}
    r = client.post("/v1/strategy/generate", json=body, headers=H(tenant))
    assert r.status_code == 200, r.text
    return r.json()


def _history(client, tenant, objective="sales", metric="roi", values=(1.5, 2.5)):
    repo = client.app.state.tenant_store.scoped(ctx(tenant))
    for v in values:
        repo.add_campaign(industry="retail", region="Colombo", objective=objective, monthly_budget=5000, channel_mix={"email": 1.0}, outcome={metric: v})


def test_accepting_the_top_strategy_records_feedback_a_positive_reward_and_a_preference_pair(client):
    reco = _generate(client)
    r = client.post(f"/v1/strategy/{reco['recommendation_id']}/feedback", json=fb({"decision": "accepted", "rating": 5, "comment": "great"}), headers=H("t1"))
    assert r.status_code == 200 and r.json()["reward"] == pytest.approx(1.0) and r.json()["preference_pairs_created"] == 1
    repo = client.app.state.tenant_store.scoped(ctx("t1"))
    pair = repo.list_pairs()[0]
    top, last = reco["strategies"][0], reco["strategies"][-1]
    assert json.loads(pair["chosen"])[0]["strategy_id"] == top["strategy_id"] and json.loads(pair["rejected"])[0]["strategy_id"] == last["strategy_id"]
    assert pair["pair_kind"] == "accepted_vs_other" and "exactly 1 strategy" in pair["prompt"]


def test_rejecting_prefers_the_best_other_strategy(client):
    reco = _generate(client)
    r = client.post(f"/v1/strategy/{reco['recommendation_id']}/feedback", json=fb({"decision": "rejected", "strategy_id": reco["strategies"][0]["strategy_id"], "rating": 1}), headers=H("t1"))
    assert r.json()["reward"] == pytest.approx(-1.0)
    pair = client.app.state.tenant_store.scoped(ctx("t1")).list_pairs()[0]
    assert json.loads(pair["chosen"])[0]["strategy_id"] == reco["strategies"][1]["strategy_id"]       # rank 2 becomes the chosen one
    assert json.loads(pair["rejected"])[0]["strategy_id"] == reco["strategies"][0]["strategy_id"]


def test_an_edit_makes_the_edited_version_chosen_and_the_original_rejected(client):
    reco = _generate(client)
    edited = copy.deepcopy(reco["strategies"][0])
    edited["title"] = "My own improved title"
    edited["strategy_id"] = "edited-1"
    r = client.post(f"/v1/strategy/{reco['recommendation_id']}/feedback", json=fb({"decision": "edited", "edited_version": edited}), headers=H("t1"))
    assert r.status_code == 200 and r.json()["preference_pairs_created"] == 1
    pair = client.app.state.tenant_store.scoped(ctx("t1")).list_pairs()[0]
    assert pair["pair_kind"] == "edit" and "improved title" in pair["chosen"] and "improved title" not in pair["rejected"]
    assert json.loads(pair["rejected"])[0]["strategy_id"] == reco["strategies"][0]["strategy_id"]


def test_pairs_are_rebuilt_not_duplicated_when_more_feedback_arrives(client):
    reco = _generate(client); rid = reco["recommendation_id"]
    for _ in range(3):
        client.post(f"/v1/strategy/{rid}/feedback", json=fb({"decision": "accepted", "rating": 4}), headers=H("t1"))
    assert len(client.app.state.tenant_store.scoped(ctx("t1")).list_pairs()) == 1


def test_feedback_validation_and_isolation(client):
    reco = _generate(client); rid = reco["recommendation_id"]
    assert client.post(f"/v1/strategy/{rid}/feedback", json=fb({"decision": "accepted", "strategy_id": "nope"}), headers=H("t1")).status_code == 422
    assert client.post(f"/v1/strategy/{rid}/feedback", json=fb({"decision": "edited"}), headers=H("t1")).status_code == 422       # needs edited_version
    assert client.post(f"/v1/strategy/{rid}/feedback", json=fb({"decision": "accepted", "rating": 9}), headers=H("t1")).status_code == 422
    assert client.post(f"/v1/strategy/{rid}/feedback", json=fb({"decision": "accepted", "tenant_id": "evil"}), headers=H("t1")).status_code == 400
    assert client.post(f"/v1/strategy/{rid}/feedback", json=fb({"decision": "accepted"}), headers=H("t2")).status_code == 404   # someone else's recommendation
    assert client.post("/v1/strategy/does-not-exist/feedback", json=fb({"decision": "accepted"}), headers=H("t1")).status_code == 404
    assert client.post(f"/v1/strategy/{rid}/feedback", json=fb({"decision": "accepted"})).status_code == 401


def test_outcome_computes_uplift_against_the_tenants_own_baseline(client):
    _history(client, "t1", "sales", "roi", (1.5, 2.5))                       # baseline roi = 2.0
    reco = _generate(client)
    r = client.post(f"/v1/strategy/{reco['recommendation_id']}/outcome", json=out({"roi": 3.0, "ctr": 0.03, "spend": 4800, "period": "2026-Q3"}), headers=H("t1"))
    body = r.json()
    assert r.status_code == 200 and body["primary_metric"] == "roi" and body["baseline"] == 2.0 and body["uplift"] == 0.5
    assert body["reward"] == pytest.approx(0.5)                              # outcome only so far
    client.post(f"/v1/strategy/{reco['recommendation_id']}/feedback", json=fb({"decision": "accepted", "rating": 5}), headers=H("t1"))
    reward = client.app.state.tenant_store.scoped(ctx("t1")).get_reward(reco["recommendation_id"])
    assert reward["reward"] == pytest.approx(0.6 * 0.5 + 0.4 * 1.0)          # now combined with the explicit feedback


def test_a_strong_real_world_result_creates_a_high_reward_pair_and_a_poor_one_a_low_reward_pair(client):
    _history(client, "t1", "sales", "roi", (2.0, 2.0))
    good, bad = _generate(client), _generate(client)
    client.post(f"/v1/strategy/{good['recommendation_id']}/outcome", json=out({"roi": 6.0}), headers=H("t1"))     # +200% -> reward clipped to 1.0
    client.post(f"/v1/strategy/{bad['recommendation_id']}/outcome", json=out({"roi": 0.5}), headers=H("t1"))      # -75%
    pairs = {p["recommendation_id"]: p for p in client.app.state.tenant_store.scoped(ctx("t1")).list_pairs()}
    hi, lo = pairs[good["recommendation_id"]], pairs[bad["recommendation_id"]]
    assert hi["pair_kind"] == "high_reward" and json.loads(hi["chosen"])[0]["strategy_id"] == good["strategies"][0]["strategy_id"]
    assert lo["pair_kind"] == "low_reward" and json.loads(lo["rejected"])[0]["strategy_id"] == bad["strategies"][0]["strategy_id"]
    assert json.loads(lo["chosen"])[0]["strategy_id"] == bad["strategies"][1]["strategy_id"]               # the best OTHER strategy is preferred


def test_lower_is_better_for_cost_per_lead(client):
    _history(client, "t1", "lead_gen", "cpl", (10.0, 10.0))
    reco = _generate(client, objective={"type": "lead_gen", "target_kpi": "cpl", "target_value": 8})
    body = client.post(f"/v1/strategy/{reco['recommendation_id']}/outcome", json=out({"cpl": 8.0}), headers=H("t1")).json()
    assert body["primary_metric"] == "cpl" and body["uplift"] == 0.2


def test_no_history_means_no_uplift_and_the_reward_comes_from_feedback_alone(client):
    reco = _generate(client)
    body = client.post(f"/v1/strategy/{reco['recommendation_id']}/outcome", json=out({"roi": 3.0}), headers=H("t1")).json()
    assert body["baseline"] is None and body["uplift"] is None and body["reward"] is None
    res = client.post(f"/v1/strategy/{reco['recommendation_id']}/feedback", json=fb({"decision": "accepted", "rating": 5}), headers=H("t1")).json()
    assert res["reward"] == pytest.approx(1.0)


def test_the_baseline_excludes_campaigns_the_agent_itself_recommended(client):
    _history(client, "t1", "sales", "roi", (2.0, 2.0))
    r1 = _generate(client)
    client.post(f"/v1/strategy/{r1['recommendation_id']}/outcome", json=out({"roi": 6.0}), headers=H("t1"))      # becomes a campaign in the history
    r2 = _generate(client)
    body = client.post(f"/v1/strategy/{r2['recommendation_id']}/outcome", json=out({"roi": 3.0}), headers=H("t1")).json()
    assert body["baseline"] == 2.0                                                                            # not dragged up by the 6.0


def test_outcome_adds_the_executed_plan_to_the_tenants_history_and_it_becomes_evidence(client):
    reco = _generate(client)
    result = client.post(f"/v1/strategy/{reco['recommendation_id']}/outcome", json=out({"roi": 3.0}), headers=H("t1")).json()
    repo = client.app.state.tenant_store.scoped(ctx("t1"))
    camp = repo.get_campaign(result["campaign_id"])
    assert camp["recommendation_id"] == reco["recommendation_id"] and camp["outcome"]["roi"] == 3.0
    assert set(camp["channel_mix"]) == {c["channel"] for c in reco["strategies"][0]["channels"]}
    again = _generate(client)
    assert result["campaign_id"] in again["evidence_ids"]["tenant_sources"]                                       # the loop closes


def test_outcome_validation_isolation_and_auth(client):
    reco = _generate(client); rid = reco["recommendation_id"]
    assert client.post(f"/v1/strategy/{rid}/outcome", json=out({"ctr": 1.5}), headers=H("t1")).status_code == 422
    assert client.post(f"/v1/strategy/{rid}/outcome", json=out({"roi": 1, "tenant_id": "x"}), headers=H("t1")).status_code == 400
    assert client.post(f"/v1/strategy/{rid}/outcome", json=out({"roi": 1}), headers=H("t2")).status_code == 404
    assert client.post(f"/v1/strategy/{rid}/outcome", json=out({"roi": 1})).status_code == 401


# ============================================================================================ the loop into the privacy pipeline
def test_outcomes_flow_into_shared_insights_only_for_consenting_tenants_and_only_once_k_is_met(client):
    app = client.app
    names = [f"loop-{i}" for i in range(1, 4)]
    for t in names:
        _history(client, t, "sales", "roi", (1.0, 3.0))
    statuses = {}
    for i, t in enumerate(names):
        if t != "loop-3":                                                                   # loop-3 never consents
            assert client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": ALL_SCOPES}, headers=H(t)).status_code == 200
        reco = _generate(client, tenant=t)
        statuses[t] = client.post(f"/v1/strategy/{reco['recommendation_id']}/outcome", json=out({"roi": 3.5, "ctr": 0.03, "conversion_rate": 0.04, "cpl": 9.0, "spend": 4300.0}), headers=H(t)).json()["contribution_status"]
    assert statuses["loop-1"] == statuses["loop-2"] == "published_contribution" and statuses["loop-3"] == "skipped_no_consent"
    assert client.get("/v1/strategy/shared-insights", headers=H("anyone")).json() == []        # only 2 distinct contributors: below k=3

    client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": ALL_SCOPES}, headers=H("loop-3"))
    app.state.pipeline.run_batch()                                                              # the nightly job picks up loop-3's earlier campaign
    rows = client.get("/v1/strategy/shared-insights", headers=H("anyone")).json()
    assert len(rows) == 1 and rows[0]["support_count"] == 3 and "spend" not in rows[0]["outcome_metrics"] and "impressions" not in rows[0]["outcome_metrics"]


# ============================================================================================ export
def test_preference_pairs_export_in_trl_conversational_format_for_this_tenant_only(client, tmp_path):
    for t in ("e1", "e2"):
        reco = _generate(client, tenant=t)
        client.post(f"/v1/strategy/{reco['recommendation_id']}/feedback", json=fb({"decision": "accepted", "rating": 5}), headers=H(t))
    out = tmp_path / "pairs.jsonl"
    n = export_pairs_jsonl(client.app.state.tenant_store.scoped(ctx("e1")), out)
    rows = [json.loads(line) for line in out.read_text().splitlines()]
    assert n == len(rows) == 1
    row = rows[0]
    assert [m["role"] for m in row["prompt"]] == ["system", "user"] and row["chosen"][0]["role"] == "assistant" and row["rejected"][0]["role"] == "assistant"
    assert json.loads(row["chosen"][0]["content"])[0]["title"]
    assert messages_from_prompt_text("[system]\nS\n[user]\nU")[1] == {"role": "user", "content": "U"}


# ============================================================================================ the brief lists these fields as required
def test_rating_and_every_outcome_field_are_required(client):
    reco = _generate(client); rid = reco["recommendation_id"]
    assert client.post(f"/v1/strategy/{rid}/feedback", json={"decision": "accepted"}, headers=H("t1")).status_code == 422          # no rating
    for missing in ("impressions", "ctr", "cpl", "conversion_rate", "roi", "spend", "period"):
        body = out({"roi": 3.0}); del body[missing]
        r = client.post(f"/v1/strategy/{rid}/outcome", json=body, headers=H("t1"))
        assert r.status_code == 422, f"{missing} should be required"
    assert client.post(f"/v1/strategy/{rid}/outcome", json=out({"period": ""}), headers=H("t1")).status_code == 422
    assert client.post(f"/v1/strategy/{rid}/outcome", json=out({}), headers=H("t1")).status_code == 200                              # complete payload works


def test_published_insights_carry_a_median_uplift_and_the_brief_field_name(client):
    for t in ("u-1", "u-2", "u-3"):
        _history(client, t, "sales", "roi", (1.0, 3.0))
        client.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": ALL_SCOPES}, headers=H(t))
    client.app.state.pipeline.run_batch()
    row = client.get("/v1/strategy/shared-insights", headers=H("anyone")).json()[0]
    assert "contribution_id" in row and "insight_id" not in row                       # the brief's name for the opaque id
    assert "uplift" in row["outcome_metrics"] and -1 <= row["outcome_metrics"]["uplift"] <= 1 and "median uplift" in row["summary"]

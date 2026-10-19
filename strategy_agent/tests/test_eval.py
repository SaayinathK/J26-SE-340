"""Phase 5: the evaluation code itself (matchers, simulator, statistics, attacks, rubric, report). Small sizes so the suite stays fast."""
from __future__ import annotations

import json

import numpy as np
import pytest

from strategy_agent.eval import attacks, report
from strategy_agent.eval.attacks import appears
from strategy_agent.eval.compare import boot_ci, make_briefs, paired
from strategy_agent.eval.population import build_population
from strategy_agent.eval.quality import rubric
from strategy_agent.eval.run import run
from strategy_agent.eval.structural import structural_eval
from strategy_agent.eval.simulator import CHANNEL_VOCAB, Context, OutcomeSimulator, World
from strategy_agent.generation.generator import TemplateGenerator
from strategy_agent.generation.prompt import build_prompt
from strategy_agent.generation.generator import parse_and_validate
from strategy_agent.schemas import Strategy

from .test_generation import ScriptedGen, bundle_for, make_req


# ============================================================================================ the leak matcher (regression: the false positives we hit)
@pytest.mark.parametrize("needle,text,expected", [
    ("+94 77 186 1618", 'x "+94 77 186 1618" y', True), ("+94 77 186 1618", "call 94771861618 now", True), ("+94 77 186 1618", "0094-77-186-1618", True),
    ("2673", "budget: 2673", True), ("2673", "spend 2673.0 usd", True), ("2673", '"x": 2673,', True), ("Zephyr", "the Zephyr deal", True),
    ("2673", '"email": 0.2673', False),             # decimals of another number: the false positive in the first evaluation run
    ("2673", "fa5b2697b8df", False),                # inside a random hex id
    ("2673", "x3.2673", False), ("Zephyr", "zephyrine", False), ("+94 77 186 1618", "0.2704 0.1618 94 77 186", False),
])
def test_leak_matcher_matches_real_leaks_and_ignores_coincidences(needle, text, expected):
    assert appears(needle, text) is expected


# ============================================================================================ statistics
def test_paired_comparison_and_bootstrap():
    a, b = [1.0, 2.0, 3.0, 4.0, 5.0, 6.0], [0.5, 1.5, 2.5, 3.5, 4.5, 5.5]
    r = paired(a, b)
    assert r["mean_diff"] == 0.5 and r["a_wins"] == 6 and r["b_wins"] == 0 and r["wilcoxon_p"] < 0.05
    assert paired(a, a)["wilcoxon_p"] == 1.0
    lo, hi = boot_ci([1, 2, 3, 4, 5])
    assert lo < 3 < hi


# ============================================================================================ world and simulator
@pytest.fixture(scope="module")
def sim():
    return OutcomeSimulator(World(3), seed=3, n_train=2500)


def test_the_world_has_a_consistent_direction_and_the_simulator_learns_it(sim):
    w = sim.world
    ctx = Context("B2C", "sales", "retail_ecommerce", "south_asia", 5000.0)
    eff = w.effectiveness(ctx)
    best = [CHANNEL_VOCAB[i] for i in np.argsort(-eff)[:3]]
    worst = [CHANNEL_VOCAB[i] for i in np.argsort(eff)[:3]]
    good, bad = {c: 1 / 3 for c in best}, {c: 1 / 3 for c in worst}
    assert sim.true_uplift(good, bad, ctx) > 0.2                              # the hidden world says the good mix is clearly better
    assert sim.uplift(good, bad, ctx) > 0.1                                   # the learned model agrees
    assert min(sim.r2.values()) > 0.4                                         # even the small test simulator beats chance by a wide margin


def test_lower_is_better_is_handled_for_cost_per_lead(sim):
    ctx = Context("B2B", "lead_gen", "technology", "europe", 20000.0)
    eff = sim.world.effectiveness(ctx)
    good = {CHANNEL_VOCAB[i]: 1 / 3 for i in np.argsort(-eff)[:3]}
    bad = {CHANNEL_VOCAB[i]: 1 / 3 for i in np.argsort(eff)[:3]}
    assert sim.world.metric(good, ctx) < sim.world.metric(bad, ctx)           # cpl is lower for the better mix
    assert sim.true_uplift(good, bad, ctx) > 0                               # and that counts as a positive uplift


# ============================================================================================ rubric
def _template_strategy(req=None):
    req = req or make_req()
    return req, parse_and_validate(TemplateGenerator().generate(bundle_for(req, 1)), req)[0]


def test_rubric_rates_a_good_plan_high_and_a_degenerate_plan_low():
    req, good = _template_strategy()
    assert rubric(good, req)["overall"] >= 4.0
    bad = Strategy(title="x", summary="y", channels=[{"channel": "pr", "budget_share": 1.0}], audience_segments=["a"], messaging_angles=["m"], timeline=[],
                   kpis=[], expected_uplift={"metric": "magic", "low": 0.1, "high": 0.9}, rationale="r", confidence=0.99)
    r = rubric(bad, req)
    assert r["overall"] < 3.0 and all(1.0 <= v <= 5.0 for v in r.values())


# ============================================================================================ structural
def test_structural_eval_flags_a_broken_generator_and_passes_the_template():
    briefs = [make_req() for _ in range(3)]
    ok = structural_eval(TemplateGenerator(), briefs)
    assert ok["schema_validity_rate"] == 1.0 and ok["constraint_compliance_rate"] == 1.0 and ok["generator_failures"] == 0
    broken = structural_eval(ScriptedGen(["not json at all"]), briefs)
    assert broken["json_parse_rate"] == 0.0 and broken["generator_failures"] == 3 and broken["schema_validity_rate"] == 0.0
    raising = structural_eval(ScriptedGen([RuntimeError("x")]), briefs)
    assert raising["generator_failures"] == 3


# ============================================================================================ attacks on a small population
@pytest.fixture(scope="module")
def small_world(tmp_path_factory, anonymizer):
    from strategy_agent.config import Settings
    from strategy_agent.db.shared_store import SharedStore
    from strategy_agent.db.tenant_store import TenantStore
    from strategy_agent.privacy.pipeline import ConsentGatedPipeline
    d = tmp_path_factory.mktemp("pop")
    settings = Settings(tenant_db_path=str(d / "t.sqlite"), shared_db_path=str(d / "s.sqlite"), k_anonymity=4, generator_backend="template", rag_backend="tfidf")
    tenants, shared = TenantStore(settings.tenant_db_path), SharedStore(settings.shared_db_path)
    pop = build_population(tenants, World(1), n_tenants=70, seed=1)
    ConsentGatedPipeline(tenants, shared, anonymizer, settings, noise_seed=1).run_batch()
    return settings, tenants, shared, pop


def test_pii_scan_finds_nothing_in_a_properly_built_store(small_world, anonymizer):
    _, _, shared, pop = small_world
    res = attacks.pii_leakage_scan(shared, pop, anonymizer)
    assert res["tenants_checked"] == 70 and res["tenants_with_any_leak"] == 0 and res["structured_pii_findings"] == 0 and res["opaque_ids_are_random_hex"]


def test_pii_scan_catches_a_leak_it_is_given(small_world, anonymizer):
    _, _, shared, pop = small_world
    victim = next(iter(pop.identifiers.values()))
    shared.add_contribution({"contribution_id": "p" * 32, "contributor_token": "t" * 32, "industry_bucket": "other", "region": "other", "budget_band": "1k_5k",
                             "objective": "sales", "channel_mix": {"email": 1.0}, "outcome_metrics": {}, "angle": f"call {victim['person']} on {victim['phone']}"})
    try:
        res = attacks.pii_leakage_scan(shared, pop, anonymizer)
        assert res["tenants_with_any_leak"] >= 1 and res["leakage_rate"] > 0
    finally:
        shared.delete_contributions(["p" * 32])


def test_k_audit_passes_and_would_fail_if_a_small_group_were_published(small_world):
    settings, _, shared, pop = small_world
    audit = attacks.k_anonymity_audit(shared, settings.k_anonymity)
    assert audit["all_published_groups_have_at_least_k"] and audit["below_k_groups_published"] == 0 and audit["insights_published"] >= 1
    # negative control: an insight published for a group with a single contributor must be flagged
    shared.add_contribution({"contribution_id": "q" * 32, "contributor_token": "solo", "industry_bucket": "nonprofit", "region": "other", "budget_band": "under_1k",
                             "objective": "awareness", "channel_mix": {"pr": 1.0}, "outcome_metrics": {}, "angle": None})
    before = shared.query_insights(limit=1000)
    shared.replace_insights(before + [{"insight_id": "z" * 32, "industry_bucket": "nonprofit", "region": "other", "budget_band": "under_1k", "objective": "awareness",
                                       "channel_mix": {"pr": 1.0}, "outcome_metrics": {}, "support_count": 1, "angle": None, "summary": "s"}])
    try:
        bad = attacks.k_anonymity_audit(shared, settings.k_anonymity)
        assert bad["all_published_groups_have_at_least_k"] is False and bad["below_k_groups_published"] == 1
    finally:
        shared.delete_contributions(["q" * 32])
        shared.replace_insights(before)


def test_attack_outputs_are_well_formed_and_never_identify_a_single_candidate(small_world):
    settings, tenants, shared, pop = small_world
    a = attacks.qi_reidentification(shared, pop)
    assert a["insights_where_participation_is_certain"] >= 0 and a["min_candidate_set"] >= settings.k_anonymity and 0 <= a["mean_p_target_contributed"] <= 1
    assert a["min_contributors_behind_an_insight"] >= settings.k_anonymity
    b = attacks.aggregate_membership_inference(shared, pop, tenants)
    assert b["auc"] is None or 0.0 <= b["auc"] <= 1.0


def test_briefs_are_built_from_published_groups(small_world):
    _, _, shared, _ = small_world
    insights = shared.query_insights(limit=100)
    briefs = make_briefs(insights, 8, seed=2)
    assert len(briefs) == 8 and {b.objective.type for b in briefs} <= {i["objective"] for i in insights}


# ============================================================================================ end to end (tiny)
def test_the_cli_run_writes_a_complete_report(tmp_path):
    R = run(model="template", n_briefs=6, n_tenants=70, seed=5, out_dir=str(tmp_path), simulator_samples=1500, k=4)
    md, html = (tmp_path / "eval_report.md").read_text(), (tmp_path / "eval_report.html").read_text()
    for heading in ("Read this first", "Key findings", "1. Structural", "2. Quality rubric", "3. Simulated A/B", "4. Privacy", "5. Ablations"):
        assert heading in md and heading in html
    assert "NOT RUN" in md and "local LLM" in md                                   # honest about what was not evaluated
    data = json.loads((tmp_path / "eval_results.json").read_text())
    assert data["privacy"]["pii"]["tenants_with_any_leak"] == 0 and data["privacy"]["k_audit"]["all_published_groups_have_at_least_k"]
    assert {r["k"] for r in data["privacy"]["sweep"]} == {2, 3, 5, 8} and all("utility" in r for r in data["privacy"]["sweep"])
    assert report.render_markdown(R) == md

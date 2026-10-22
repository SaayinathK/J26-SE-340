"""The brief, as executable checks: its repository layout (section 4), data models (5), API surface (7) and settings (6.1).

If this file passes, every file, endpoint and field the brief names exists. It does not (and cannot) check behaviour: the other tests do.
"""
from __future__ import annotations

from pathlib import Path

import pytest

from strategy_agent.api.main import create_app
from strategy_agent.config import Settings
from strategy_agent.schemas import (BusinessProfile, ConsentSettings, Constraints, FeedbackRequest, GenerateRequest, Objective, OutcomeRequest,
                                    SharedInsight, Strategy)

ROOT = Path(__file__).resolve().parents[2]

# section 4, "Repository layout (create this)"
LAYOUT = """
strategy_agent/__init__.py strategy_agent/config.py strategy_agent/auth.py strategy_agent/schemas.py
strategy_agent/db/tenant_store.py strategy_agent/db/shared_store.py strategy_agent/db/models.py
strategy_agent/generation/generator.py strategy_agent/generation/prompt.py strategy_agent/generation/ranking.py strategy_agent/generation/rag.py
strategy_agent/privacy/consent.py strategy_agent/privacy/anonymizer.py strategy_agent/privacy/k_anonymity.py strategy_agent/privacy/pipeline.py
strategy_agent/learning/feedback.py strategy_agent/learning/preference.py
strategy_agent/api/main.py strategy_agent/api/routes/generate.py strategy_agent/api/routes/feedback.py strategy_agent/api/routes/consent.py strategy_agent/api/routes/insights.py
strategy_agent/eval/run.py strategy_agent/eval/simulator.py strategy_agent/eval/attacks.py
strategy_agent/data/seed_generator.py
strategy_agent/training/sft_qlora.py strategy_agent/training/dpo.py
strategy_agent/tests
docs/strategy_agent.md requirements.txt .env.example README_strategy_agent.md
""".split()


@pytest.mark.parametrize("path", LAYOUT)
def test_the_file_named_in_the_briefs_layout_exists(path):
    assert (ROOT / path).exists(), f"missing {path}"


def test_every_module_named_in_the_layout_has_a_test_file_that_covers_it():
    tests = " ".join(p.read_text() for p in (ROOT / "strategy_agent" / "tests").glob("test_*.py"))
    for module in ("tenant_store", "shared_store", "generator", "prompt", "ranking", "rag", "consent", "anonymizer", "k_anonymity", "pipeline",
                   "feedback", "preference", "seed_generator", "sft_qlora", "dpo", "attacks", "simulator", "run"):
        assert module in tests, f"no test mentions {module}"


# section 7, "API surface"
def test_the_api_surface_is_exactly_the_briefs(settings):
    app = create_app(settings, use_default_generators=False)
    got = {(m.upper(), path) for path, methods in app.openapi()["paths"].items() for m in methods}      # OpenAPI: every route, whatever the router nesting
    assert got == {("POST", "/v1/strategy/generate"), ("POST", "/v1/strategy/{recommendation_id}/feedback"), ("POST", "/v1/strategy/{recommendation_id}/outcome"),
                   ("GET", "/v1/strategy/sharing/consent"), ("PUT", "/v1/strategy/sharing/consent"), ("GET", "/v1/strategy/shared-insights"), ("GET", "/health")}


# section 5, "Data models"
def test_business_profile_objective_constraints_and_generate_request_fields():
    assert {"industry", "business_model", "target_audience", "region", "brand_tone", "monthly_budget"} <= set(BusinessProfile.model_fields)
    assert {"type", "target_kpi", "target_value", "time_horizon"} <= set(Objective.model_fields)
    assert {"channels_allowed", "channels_blocked", "budget_cap", "compliance_notes"} <= set(Constraints.model_fields)
    assert {"business_profile", "objective", "constraints", "use_shared_insights"} <= set(GenerateRequest.model_fields)
    assert GenerateRequest.model_fields["use_shared_insights"].default is True and "tenant_id" not in GenerateRequest.model_fields
    assert set(Objective.model_fields["type"].annotation.__args__) == {"lead_gen", "awareness", "retention", "sales"}
    assert set(BusinessProfile.model_fields["business_model"].annotation.__args__) == {"B2B", "B2C"}


BRIEF_STRATEGY = {
    "strategy_id": "5b1c7b52-3f6a-4d0e-8a3f-0a9e3c1d2b44", "title": "t", "summary": "s",
    "channels": [{"channel": "meta_ads", "budget_share": 0.6}, {"channel": "email", "budget_share": 0.4}],
    "audience_segments": ["a"], "messaging_angles": ["m"], "timeline": [{"week": 1, "actions": ["x"]}], "kpis": [{"name": "ctr", "target": 0.02}],
    "expected_uplift": {"metric": "roi", "low": 0.1, "high": 0.2}, "rationale": "r", "evidence": {"tenant_sources": ["c1"], "shared_insights": ["i1"]},
    "confidence": 0.7, "rank": 1,
}


def test_strategy_schema_is_exactly_the_briefs_and_its_example_validates():
    assert set(Strategy.model_fields) == set(BRIEF_STRATEGY)
    assert set(Strategy.model_fields["channels"].annotation.__args__[0].model_fields) == {"channel", "budget_share"}
    assert set(Strategy.model_fields["evidence"].annotation.model_fields) == {"tenant_sources", "shared_insights"}
    assert set(Strategy.model_fields["expected_uplift"].annotation.model_fields) == {"metric", "low", "high"}
    Strategy.model_validate(BRIEF_STRATEGY)
    with pytest.raises(Exception):
        Strategy.model_validate({**BRIEF_STRATEGY, "tenant_id": "x"})                                     # exact schema: no extras


def test_consent_shared_insight_feedback_and_outcome_models():
    assert set(ConsentSettings.model_fields) == {"opted_in", "scopes", "consent_version", "granted_by", "granted_at", "revoked_at"}
    assert set(ConsentSettings.model_fields["scopes"].annotation.__args__[0].__args__) == {"channel_mix", "budget_split", "timeline", "messaging_angles", "outcome_metrics"}
    assert {"contribution_id", "industry_bucket", "region", "budget_band", "objective", "channel_mix", "outcome_metrics"} <= set(SharedInsight.model_fields)
    assert not any("tenant" in f for f in SharedInsight.model_fields)                                     # never any tenant id
    assert {"decision", "edited_version", "rating", "comment"} <= set(FeedbackRequest.model_fields)
    assert set(FeedbackRequest.model_fields["decision"].annotation.__args__) == {"accepted", "rejected", "edited"}
    assert FeedbackRequest.model_fields["rating"].is_required() and not FeedbackRequest.model_fields["edited_version"].is_required()
    assert set(OutcomeRequest.model_fields) == {"impressions", "ctr", "cpl", "conversion_rate", "roi", "spend", "period"}
    assert all(f.is_required() for f in OutcomeRequest.model_fields.values())


# section 6.1, "Config & auth": typed settings with the named knobs
def test_settings_expose_the_knobs_the_brief_names():
    s = Settings()
    assert s.k_anonymity == 5                                                                             # "k value default 5"
    assert set(s.rank_weights) == {"confidence", "uplift", "constraint", "shared"} and set(s.reward_weights) == {"outcome", "feedback"}
    assert s.llm_model_name == "Qwen/Qwen2.5-1.5B-Instruct" and s.tenant_db_path and s.shared_db_path and s.laplace_epsilon > 0
    assert "adapter_id" in Settings.model_fields and "model_version" in Settings.model_fields


def test_the_production_base_model_is_mistral_in_the_training_scripts():
    from strategy_agent.training import dpo, sft_qlora
    assert sft_qlora.parse([]).base_model == "mistralai/Mistral-7B-Instruct-v0.3" == dpo.parse(["--pairs", "p"]).base_model


def test_the_eval_cli_accepts_a_model_alias():
    import subprocess, sys
    out = subprocess.run([sys.executable, "-m", "strategy_agent.eval.run", "--help"], capture_output=True, text=True, cwd=ROOT).stdout
    assert "--model" in out and "template" in out and "mistral" in out and "--adapter" in out

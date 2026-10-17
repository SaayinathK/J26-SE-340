"""Direct tests for modules that were only covered indirectly: channels, the read-only shared reader, chat helpers, the Mistral prompt,
the budget validation, adapter provenance and the demo."""
from __future__ import annotations

import json

import pytest

from strategy_agent.api.main import create_app
from strategy_agent.channels import CHANNEL_VOCAB, OTHER, canonical_channel, canonical_mix
from strategy_agent.db.shared_store import SharedReader, SharedStore
from strategy_agent.generation.chat import accepts_system_role, merge_system_into_user, normalise_messages, render_chat
from strategy_agent.generation.generator import TemplateGenerator
from strategy_agent.generation.prompt import build_prompt, mistral_instruct_prompt
from strategy_agent.generation.ranking import compliance_violations, effective_budget, implied_spend
from strategy_agent.generation.rag import Retriever
from strategy_agent.generation.service import StrategyService
from strategy_agent.schemas import Strategy

from .conftest import ctx
from .test_generation import ScriptedGen, bundle_for, make_req


# ----------------------------------------------------------------------------------------------------- channels
def test_channel_vocabulary_aliases_and_unknown_names():
    assert canonical_channel("Facebook Ads") == "meta_ads" and canonical_channel("Google") == "google_ads" and canonical_channel("  EMAIL ") == "email"
    assert canonical_channel("ZephyrNewsletter") == OTHER and canonical_channel("sms") in CHANNEL_VOCAB
    mix = canonical_mix({"facebook": 0.3, "instagram": 0.3, "ZephyrNewsletter": 0.2, "email": 0.2})
    assert mix == {"email": 0.2, "meta_ads": 0.6, OTHER: 0.2} and abs(sum(mix.values()) - 1) < 1e-3


# ----------------------------------------------------------------------------------------------------- shared store separation
def test_the_api_gets_a_reader_that_cannot_write(settings):
    app = create_app(settings, use_default_generators=False)
    reader = app.state.shared_reader
    assert isinstance(reader, SharedReader) and not isinstance(reader, SharedStore)
    for writer_method in ("add_contribution", "delete_contributions", "replace_insights", "list_contributions", "dump_all_text"):
        assert not hasattr(reader, writer_method), f"the read-only reader exposes {writer_method}"
    assert hasattr(reader, "query_insights")


# ----------------------------------------------------------------------------------------------------- chat helpers
class _NoSystemTokenizer:
    """Behaves like an older Mistral template: it raises on a system message."""
    def apply_chat_template(self, messages, tokenize=False, add_generation_prompt=False):
        if any(m["role"] == "system" for m in messages):
            raise ValueError("Conversation roles must alternate user/assistant")
        return "[INST] " + " ".join(m["content"] for m in messages if m["role"] == "user") + " [/INST]"


def test_system_role_is_folded_into_the_user_turn_for_templates_that_reject_it():
    msgs = [{"role": "system", "content": "SYS"}, {"role": "user", "content": "USER"}]
    assert merge_system_into_user(msgs) == [{"role": "user", "content": "SYS\n\nUSER"}]
    tok = _NoSystemTokenizer()
    assert accepts_system_role(tok) is False and normalise_messages(tok, msgs) == [{"role": "user", "content": "SYS\n\nUSER"}]
    assert render_chat(tok, msgs) == "[INST] SYS\n\nUSER [/INST]"


def test_mistral_instruct_prompt_format():
    b = bundle_for(make_req())
    text = mistral_instruct_prompt(b.messages)
    assert text.startswith("<s>[INST] ") and text.endswith(" [/INST]") and b.messages[0]["content"] in text and "## Objective" in text
    assert b.mistral_text == text and mistral_instruct_prompt([{"role": "user", "content": "hi"}]) == "<s>[INST] hi [/INST]"


def test_our_mistral_prompt_matches_the_real_mistral_tokenizers_own_template():
    try:
        from transformers import AutoTokenizer
        tok = AutoTokenizer.from_pretrained("mistralai/Mistral-7B-Instruct-v0.3", local_files_only=True)
    except Exception:
        pytest.skip("Mistral tokenizer not cached locally")
    b = bundle_for(make_req())
    assert accepts_system_role(tok)
    squash = lambda t: "".join(t.replace("<s>", "").split())  # noqa: E731  (ignore BOS and whitespace differences)
    assert squash(b.mistral_text) == squash(render_chat(tok, b.messages))


# ----------------------------------------------------------------------------------------------------- budget validation
def test_implied_spend_is_checked_against_the_budget_and_the_cap():
    req = make_req(constraints={"budget_cap": 3000})
    s = Strategy.model_validate(json.loads(TemplateGenerator().generate(bundle_for(req, 1)))[0])
    assert effective_budget(req) == 3000 and implied_spend(s, req) == pytest.approx(3000, rel=0.02) and not compliance_violations(s, req)
    over = Strategy.model_construct(**{**s.model_dump(), "channels": [{"channel": "email", "budget_share": 1.5}]})   # bypass the model validator on purpose
    over.channels = [type("C", (), {"channel": "email", "budget_share": 1.5})()]
    assert any("exceeds the budget" in v for v in compliance_violations(over, req))


# ----------------------------------------------------------------------------------------------------- provenance
def _llm_named(outputs):
    g = ScriptedGen(outputs, name="llm")
    return g


def test_adapter_id_is_recorded_only_when_an_adapter_is_actually_configured(settings, tenant_store, shared_store):
    good = lambda b: TemplateGenerator().generate(b)  # noqa: E731
    with_adapter = settings.model_copy(update={"adapter_id": "sft-v1", "adapter_path": "/models/sft"})
    res = StrategyService(with_adapter, tenant_store, shared_store, _llm_named([good]), TemplateGenerator(), Retriever("tfidf")).generate(ctx("t1"), make_req())
    assert res.generator_used == "llm" and res.adapter_id == "sft-v1" and res.model_version == settings.llm_model_name
    no_adapter = settings.model_copy(update={"adapter_id": "sft-v1", "adapter_path": ""})
    res = StrategyService(no_adapter, tenant_store, shared_store, _llm_named([good]), TemplateGenerator(), Retriever("tfidf")).generate(ctx("t2"), make_req())
    assert res.adapter_id == "none"                                          # an id without an adapter is never claimed
    fallback = StrategyService(with_adapter, tenant_store, shared_store, _llm_named(["garbage"]), TemplateGenerator(), Retriever("tfidf")).generate(ctx("t3"), make_req())
    assert fallback.generator_used == "template" and fallback.adapter_id == "none" and fallback.model_version == "template-rules-v1"


# ----------------------------------------------------------------------------------------------------- the demo
def test_the_demo_runs_end_to_end(capsys):
    from strategy_agent import demo
    demo.main()
    out = capsys.readouterr().out
    assert "marketer -> HTTP 403" in out and "HTTP 400" in out and "planted identifiers found in the shared store: 0" in out
    assert "after shop-3 revoked: 0 insight(s) published" in out and "generator=template" in out


def test_4bit_loading_reports_itself_unavailable_without_a_cuda_gpu_instead_of_failing():
    """A 7B model needs 4-bit on a 16 GB GPU. On a machine with no NVIDIA GPU (or no bitsandbytes) the generator must say it is unavailable."""
    from strategy_agent.generation.generator import LLMGenerator, build_generators
    g = LLMGenerator("mistralai/Mistral-7B-Instruct-v0.3", load_4bit=True)
    assert g.load_4bit is True and g.available() is False
    primary, fallback = build_generators("auto", "mistralai/Mistral-7B-Instruct-v0.3", 100, "", True)
    assert primary is None and fallback is not None                                  # `auto` falls back to the template

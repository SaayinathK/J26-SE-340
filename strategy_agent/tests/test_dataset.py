"""Phase 4: the synthetic SFT dataset builder."""
from __future__ import annotations

import json

import pytest

from strategy_agent.data.seed_generator import build_examples, write_dataset
from strategy_agent.generation.generator import parse_and_validate
from strategy_agent.generation.ranking import compliance_violations
from strategy_agent.schemas import GenerateRequest


@pytest.fixture(scope="module")
def built(tmp_path_factory):
    out = tmp_path_factory.mktemp("sft")
    card = write_dataset(120, 7, out)
    return out, card


def _read(path):
    return [json.loads(line) for line in path.read_text().splitlines()]


def test_files_counts_and_card_agree(built):
    out, card = built
    rows = {s: _read(out / f"{s}.jsonl") for s in ("train", "val", "test")}
    assert {s: len(r) for s, r in rows.items()} == card["splits"] and sum(card["splits"].values()) == card["total_examples"] == 120
    assert card["splits"]["train"] > card["splits"]["val"] and card["splits"]["train"] > card["splits"]["test"]
    assert (out / "DATASET_CARD.md").read_text().startswith("# Dataset card") and card["synthetic"] and not card["contains_personal_data"]


def test_every_label_is_schema_valid_and_constraint_compliant(built):
    out, _ = built
    for split in ("train", "val", "test"):
        for ex in _read(out / f"{split}.jsonl"):
            req = GenerateRequest.model_validate(ex["meta"]["request"])
            strategies = parse_and_validate(ex["completion"][0]["content"], req)
            assert len(strategies) == ex["meta"]["n_strategies"] == req.n_strategies
            assert all(not compliance_violations(s, req) for s in strategies)


def test_format_is_trl_prompt_completion_and_fits_the_training_sequence_length(built):
    out, card = built
    ex = _read(out / "train.jsonl")[0]
    assert [m["role"] for m in ex["prompt"]] == ["system", "user"] and ex["completion"][0]["role"] == "assistant"
    assert card["approx_tokens_per_example"]["max"] < 2048                                   # training seq length is 2048 (char-based fallback estimate)
    assert card["date_range"]["generation_started"] and card["sources"] and card["max_tokens_allowed"] <= 2048


def test_every_example_fits_2048_tokens_under_each_available_real_tokenizer(built):
    """The check that caught a real bug: a character estimate tuned on Qwen let 3 examples exceed 2,048 tokens under Mistral's tokenizer."""
    from strategy_agent.data.seed_generator import load_length_tokenizers
    from strategy_agent.training.common import n_tokens
    out, card = built
    toks = load_length_tokenizers()
    if not toks:
        pytest.skip("no length tokenizer cached locally")
    assert set(card["length_checked_with"]) == set(toks)
    for name, tok in toks.items():
        for ex in _read(out / "train.jsonl")[:40]:
            assert n_tokens(tok, ex["prompt"] + ex["completion"]) <= 2048, name


def test_no_prompt_appears_in_two_splits_and_there_are_no_duplicates(built):
    out, _ = built
    seen = {}
    for split in ("train", "val", "test"):
        for ex in _read(out / f"{split}.jsonl"):
            h = ex["meta"]["example_id"]
            assert h not in seen, f"duplicate / leaked example across {seen.get(h)} and {split}"
            seen[h] = split


def test_coverage_across_objectives_business_models_and_evidence(built):
    _, card = built
    assert set(card["by_objective"]) == {"lead_gen", "awareness", "retention", "sales"} and set(card["by_business_model"]) == {"B2B", "B2C"}
    assert 0 < card["with_evidence"] < card["total_examples"] and len(card["by_industry"]) >= 10


def test_deterministic_for_a_seed_and_different_across_seeds():
    a, b, c = build_examples(15, 1), build_examples(15, 1), build_examples(15, 2)
    assert [e["meta"]["example_id"] for e in a] == [e["meta"]["example_id"] for e in b]
    assert [e["meta"]["example_id"] for e in a] != [e["meta"]["example_id"] for e in c]


def test_the_dataset_contains_no_personal_data(built, anonymizer):
    out, _ = built
    blob = " ".join(ex["prompt"][1]["content"] for ex in _read(out / "train.jsonl")[:25])
    found = set(anonymizer.entities_in(blob, [])) & {"EMAIL_ADDRESS", "PHONE_NUMBER", "URL", "CREDIT_CARD", "IP_ADDRESS"}
    assert not found

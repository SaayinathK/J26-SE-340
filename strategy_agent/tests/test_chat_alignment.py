"""Regression tests for the bug the first real Colab run exposed.

Mistral-7B-Instruct-v0.3's chat template accepts a system message but DROPS it from the rendering once an assistant answer is present. The tokenized
prompt is then not a prefix of prompt+answer: TRL treats only `<s>[INST]` as the prompt, trains the loss on the brief too, and the model sees a context at
training that differs from inference. Every training example was affected. These tests pin the detection, the fix and the guard.
"""
from __future__ import annotations

import json

import pytest

from strategy_agent.generation.chat import merge_system_into_user, needs_system_merge, normalise_messages, render_chat, system_role_is_consistent
from strategy_agent.training import dpo, sft_qlora
from strategy_agent.training.common import adapt_rows, alignment_report

MSGS = [{"role": "system", "content": "SYS"}, {"role": "user", "content": "USER"}]
ANSWER = [{"role": "assistant", "content": "ANSWER"}]


class _FakeTokenizer:
    """A tokenizer with a configurable chat template, tokenising on spaces (enough to test prefix alignment)."""
    def __init__(self, behaviour: str):
        self.behaviour = behaviour

    def apply_chat_template(self, messages, tokenize=False, add_generation_prompt=False):
        has_answer = any(m["role"] == "assistant" for m in messages)
        system = next((m["content"] for m in messages if m["role"] == "system"), None)
        if system is not None and self.behaviour == "rejects":
            raise ValueError("Conversation roles must alternate user/assistant")
        out = "<s>"
        for m in messages:
            if m["role"] == "system":
                continue
            if m["role"] == "user":
                shown = f"{system} {m['content']}" if (system is not None and (self.behaviour == "consistent" or not has_answer)) else m["content"]  # "drops" -> hidden once an answer follows
                out += f" [INST] {shown} [/INST]"
            else:
                out += f" {m['content']} </s>"
        return out

    def __call__(self, text, add_special_tokens=False):
        return {"input_ids": text.split()}


@pytest.mark.parametrize("behaviour,consistent", [("consistent", True), ("drops_system_with_answer", False), ("rejects", False)])
def test_the_probe_distinguishes_templates_that_render_the_system_text_consistently(behaviour, consistent):
    tok = _FakeTokenizer(behaviour)
    assert system_role_is_consistent(tok) is consistent and needs_system_merge(tok) is (not consistent)


def test_folding_makes_the_prompt_a_prefix_of_prompt_plus_answer():
    tok = _FakeTokenizer("drops_system_with_answer")
    rows = [{"prompt": MSGS, "completion": ANSWER}] * 3
    assert alignment_report(tok, rows, "sft")["prompt_prefix_mismatches"] == 3              # the bug
    fixed = adapt_rows(tok, rows)
    assert all(r["prompt"] == [{"role": "user", "content": "SYS\n\nUSER"}] for r in fixed)
    assert alignment_report(tok, fixed, "sft") == {"examples_checked": 3, "prompt_prefix_mismatches": 0, "first_bad_example": None, "aligned": True}
    assert normalise_messages(tok, MSGS) == merge_system_into_user(MSGS) and render_chat(tok, MSGS, True).count("SYS") == 1


def test_a_consistent_template_is_left_untouched():
    tok = _FakeTokenizer("consistent")
    rows = [{"prompt": MSGS, "completion": ANSWER}]
    assert adapt_rows(tok, rows)[0]["prompt"] == MSGS and alignment_report(tok, rows, "sft")["aligned"]


def test_dpo_alignment_checks_both_answers():
    tok = _FakeTokenizer("drops_system_with_answer")
    pairs = [{"prompt": MSGS, "chosen": ANSWER, "rejected": [{"role": "assistant", "content": "OTHER"}]}]
    assert alignment_report(tok, pairs, "dpo")["prompt_prefix_mismatches"] == 1
    assert alignment_report(tok, adapt_rows(tok, pairs), "dpo")["aligned"]


# ---------------------------------------------------------------------------------------------------- the REAL tokenizers
def _tok(name):
    try:
        from transformers import AutoTokenizer
        return AutoTokenizer.from_pretrained(name, local_files_only=True)
    except Exception:
        return None


MISTRAL, QWEN = "mistralai/Mistral-7B-Instruct-v0.3", "Qwen/Qwen2.5-1.5B-Instruct"


@pytest.mark.skipif(_tok(MISTRAL) is None, reason="Mistral tokenizer not cached locally")
def test_real_mistral_drops_the_system_message_and_the_fix_restores_alignment():
    tok = _tok(MISTRAL)
    rows = [json.loads(line) for line in open("data/strategy_sft/v1/train.jsonl")][:40]
    full = tok.apply_chat_template(rows[0]["prompt"] + rows[0]["completion"], tokenize=False)
    assert "You are a senior marketing strategist" not in full                                  # the system text vanishes from the training rendering
    assert needs_system_merge(tok) is True
    assert alignment_report(tok, rows, "sft")["prompt_prefix_mismatches"] == 40                 # every example misaligned (what the first Colab run trained on)
    fixed = alignment_report(tok, adapt_rows(tok, rows), "sft")
    assert fixed["aligned"] and fixed["examples_checked"] == 40


@pytest.mark.skipif(_tok(QWEN) is None, reason="Qwen tokenizer not cached locally")
def test_real_qwen_was_never_affected():
    tok = _tok(QWEN)
    rows = [json.loads(line) for line in open("data/strategy_sft/v1/train.jsonl")][:40]
    assert needs_system_merge(tok) is False and alignment_report(tok, rows, "sft")["aligned"]


@pytest.mark.skipif(_tok(MISTRAL) is None, reason="Mistral tokenizer not cached locally")
def test_the_whole_shipped_dataset_is_aligned_and_fits_under_mistral():
    tok = _tok(MISTRAL)
    for split in ("train", "val"):
        rows = adapt_rows(tok, [json.loads(line) for line in open(f"data/strategy_sft/v1/{split}.jsonl")])
        assert alignment_report(tok, rows, "sft")["aligned"], split


# ---------------------------------------------------------------------------------------------------- the guard
@pytest.mark.skipif(_tok(MISTRAL) is None, reason="Mistral tokenizer not cached locally")
def test_sft_refuses_to_train_when_the_prompt_is_not_a_prefix(monkeypatch, tmp_path, capsys):
    """If the folding were ever skipped, the script must stop BEFORE loading the model, not waste hours of GPU time."""
    monkeypatch.setattr(sft_qlora, "adapt_rows", lambda tok, rows, fields=(): rows)
    with pytest.raises(SystemExit, match="refusing to train"):
        sft_qlora.main(["--base-model", MISTRAL, "--data-dir", "data/strategy_sft/v1", "--out", str(tmp_path / "o"), "--experiment-log", str(tmp_path / "r.jsonl")])
    sft_qlora.main(["--dry-run", "--base-model", MISTRAL, "--data-dir", "data/strategy_sft/v1", "--experiment-log", str(tmp_path / "r.jsonl")])
    assert "WARNING" in capsys.readouterr().out                                                    # a dry run only warns


@pytest.mark.skipif(_tok(MISTRAL) is None, reason="Mistral tokenizer not cached locally")
def test_sft_dry_run_reports_alignment_for_the_production_model(tmp_path):
    s = sft_qlora.main(["--dry-run", "--base-model", MISTRAL, "--data-dir", "data/strategy_sft/v1", "--experiment-log", str(tmp_path / "r.jsonl")])
    for split in ("train", "val"):
        assert s["data"][split]["alignment"]["aligned"] and s["data"][split]["fits"]

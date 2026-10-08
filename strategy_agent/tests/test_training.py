"""Phase 6: the GPU training scripts. Their GPU parts cannot run here, so we test everything that can: imports, data validation, dry runs."""
from __future__ import annotations

import copy
import json
import subprocess
import sys

import pytest
from fastapi.testclient import TestClient

from strategy_agent.api.main import create_app
from strategy_agent.data.seed_generator import write_dataset
from strategy_agent.learning.preference import export_pairs_jsonl
from strategy_agent.training import dpo, sft_qlora
from strategy_agent.training.common import LORA_TARGETS, supported_kwargs

from .conftest import ctx
from .helpers import fb, out
from .test_generation import BASE

QWEN = "Qwen/Qwen2.5-1.5B-Instruct"


def _tokenizer_cached() -> bool:
    try:
        from transformers import AutoTokenizer
        AutoTokenizer.from_pretrained(QWEN, local_files_only=True)
        return True
    except Exception:
        return False


needs_tokenizer = pytest.mark.skipif(not _tokenizer_cached(), reason="Qwen tokenizer not cached locally")


def test_the_scripts_import_without_a_gpu_or_the_gpu_libraries():
    code = "import sys, strategy_agent.training.sft_qlora, strategy_agent.training.dpo; assert not {'peft', 'trl', 'bitsandbytes'} & set(sys.modules), 'heavy import at module level'"
    assert subprocess.run([sys.executable, "-c", code], capture_output=True).returncode == 0


def test_recipe_constants_match_the_brief():
    assert set(LORA_TARGETS) == {"q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"}     # attention + MLP projections
    a = sft_qlora.parse([])
    assert (a.lora_r, a.lora_alpha, a.lora_dropout, a.seq_len, a.epochs) == (16, 32, 0.05, 2048, 3.0)
    assert dpo.parse(["--pairs", "x"]).beta == 0.1
    assert "Mistral" in sft_qlora.DEFAULT_BASE


def test_supported_kwargs_drops_unknown_arguments_but_refuses_to_drop_a_critical_one():
    class Cfg:
        def __init__(self, a=1, b=2): ...
    assert supported_kwargs(Cfg, a=1, b=2, c=3, max_seq_length=9) == {"a": 1, "b": 2}
    with pytest.raises(RuntimeError, match="refusing to train"):                       # the failure mode we nearly shipped: silently training something else
        supported_kwargs(Cfg, required=("completion_only_loss",), a=1, completion_only_loss=True)


@needs_tokenizer
def test_sft_dry_run_validates_the_dataset_with_the_real_tokenizer(tmp_path):
    write_dataset(40, 3, tmp_path)
    s = sft_qlora.main(["--dry-run", "--base-model", QWEN, "--data-dir", str(tmp_path), "--experiment-log", str(tmp_path / "runs.jsonl")])
    assert s["data"]["train"]["examples"] > 20 and s["data"]["train"]["fits"] and s["data"]["train"]["max_tokens"] <= 2048
    assert s["recipe"]["loss"] == "completion-only" and s["recipe"]["lora"]["r"] == 16 and s["recipe"]["effective_batch"] == 16


@needs_tokenizer
def test_sft_dry_run_flags_examples_that_exceed_the_sequence_length(tmp_path, capsys):
    write_dataset(20, 3, tmp_path)
    s = sft_qlora.main(["--dry-run", "--base-model", QWEN, "--data-dir", str(tmp_path), "--seq-len", "300", "--experiment-log", str(tmp_path / "runs.jsonl")])
    assert s["data"]["train"]["fits"] is False and "exceed the sequence length" in capsys.readouterr().out


@pytest.fixture
def pairs_file(settings, tmp_path):
    client = TestClient(create_app(settings, use_default_generators=False))
    h = {"X-Dev-Tenant": "dpo-1", "X-Dev-Roles": "tenant_admin"}
    for _ in range(2):
        reco = client.post("/v1/strategy/generate", json=copy.deepcopy(BASE), headers=h).json()
        client.post(f"/v1/strategy/{reco['recommendation_id']}/feedback", json=fb({"decision": "accepted", "rating": 5}), headers=h)
        reco2 = client.post("/v1/strategy/generate", json=copy.deepcopy(BASE), headers=h).json()
        client.post(f"/v1/strategy/{reco2['recommendation_id']}/feedback", json=fb({"decision": "rejected", "strategy_id": reco2["strategies"][0]["strategy_id"]}), headers=h)
    path = tmp_path / "pairs.jsonl"
    n = export_pairs_jsonl(client.app.state.tenant_store.scoped(ctx("dpo-1")), path)
    assert n >= 2
    return path


@needs_tokenizer
def test_dpo_dry_run_validates_exported_pairs_and_warns_when_there_are_few(pairs_file, capsys):
    s = dpo.main(["--dry-run", "--base-model", QWEN, "--pairs", str(pairs_file), "--experiment-log", str(pairs_file.parent / "runs.jsonl")])
    assert s["data"]["examples"] >= 2 and s["data"]["fits"] and sum(s["data"]["by_kind"].values()) == s["data"]["examples"]
    assert s["recipe"]["beta"] == 0.1 and "SFT adapter" in s["recipe"]["reference"]
    assert "unreliable" in capsys.readouterr().out                                   # fewer than 50 pairs


def test_dpo_rejects_malformed_or_degenerate_pairs(tmp_path):
    bad = tmp_path / "bad.jsonl"
    bad.write_text(json.dumps({"prompt": "not a list", "chosen": [{"role": "assistant", "content": "a"}], "rejected": [{"role": "assistant", "content": "a"}]}) + "\n")
    with pytest.raises(SystemExit, match="invalid preference data"):
        dpo.main(["--dry-run", "--base-model", QWEN, "--pairs", str(bad), "--experiment-log", str(tmp_path / "runs.jsonl")])
    same = [{"prompt": [{"role": "user", "content": "q"}], "chosen": [{"role": "assistant", "content": "a"}], "rejected": [{"role": "assistant", "content": "a"}]}]
    assert any("identical" in p for p in dpo.validate_pairs(same))

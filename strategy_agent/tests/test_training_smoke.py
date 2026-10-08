"""The training scripts' REAL code path, run end to end on CPU with a tiny local model (no GPU, no 4-bit).

This executes the actual TRL + PEFT calls in sft_qlora.py and dpo.py: dataset building, completion-only labels, LoRA, optimiser steps,
adapter saving, the DPO reference mechanism, and loading the trained adapter through the pipeline's generator. It does NOT exercise
the 4-bit NF4 / CUDA branch (that needs an NVIDIA GPU).
"""
from __future__ import annotations

import copy
import json

import pytest
from fastapi.testclient import TestClient

pytest.importorskip("trl")
pytest.importorskip("peft")
from strategy_agent.api.main import create_app  # noqa: E402
from strategy_agent.auth import TenantContext  # noqa: E402
from strategy_agent.data.seed_generator import write_dataset  # noqa: E402
from strategy_agent.experiments import ExperimentLog  # noqa: E402
from strategy_agent.generation.generator import LLMGenerator, TemplateGenerator  # noqa: E402
from strategy_agent.generation.prompt import build_prompt  # noqa: E402
from strategy_agent.generation.rag import Retriever  # noqa: E402
from strategy_agent.generation.service import StrategyService  # noqa: E402
from strategy_agent.learning.preference import export_pairs_jsonl  # noqa: E402
from strategy_agent.training import dpo, sft_qlora  # noqa: E402

from .helpers import fb  # noqa: E402
from .test_generation import BASE, make_req  # noqa: E402

QWEN = "Qwen/Qwen2.5-1.5B-Instruct"


def _tokenizer():
    try:
        from transformers import AutoTokenizer
        return AutoTokenizer.from_pretrained(QWEN, local_files_only=True)
    except Exception:
        return None


pytestmark = pytest.mark.skipif(_tokenizer() is None, reason="Qwen tokenizer is not cached locally")


@pytest.fixture(scope="module")
def trained(tmp_path_factory, request):
    """A tiny random Qwen2 model (real Qwen tokenizer) -> SFT adapter -> DPO adapter, all produced by the production scripts."""
    import torch
    from transformers import Qwen2Config, Qwen2ForCausalLM

    from strategy_agent.config import Settings
    w = tmp_path_factory.mktemp("smoke")
    tok = _tokenizer()
    cfg = Qwen2Config(vocab_size=len(tok), hidden_size=64, intermediate_size=128, num_hidden_layers=2, num_attention_heads=4, num_key_value_heads=2,
                      max_position_embeddings=4096, tie_word_embeddings=True)
    torch.manual_seed(0)
    Qwen2ForCausalLM(cfg).save_pretrained(w / "tiny")
    tok.save_pretrained(w / "tiny")
    write_dataset(24, 5, w / "data")

    log = str(w / "runs.jsonl")
    sft_qlora.main(["--no-quantize", "--max-steps", "2", "--base-model", str(w / "tiny"), "--data-dir", str(w / "data"), "--out", str(w / "sft"),
                    "--seq-len", "512", "--grad-accum", "1", "--experiment-log", log])

    settings = Settings(tenant_db_path=str(w / "t.sqlite"), shared_db_path=str(w / "s.sqlite"), generator_backend="template", rag_backend="tfidf")
    client = TestClient(create_app(settings, use_default_generators=False))
    h = {"X-Dev-Tenant": "smoke", "X-Dev-Roles": "tenant_admin"}
    for i in range(4):
        r = client.post("/v1/strategy/generate", json=copy.deepcopy(BASE), headers=h).json()
        body = {"decision": "accepted", "rating": 5} if i % 2 == 0 else {"decision": "rejected", "strategy_id": r["strategies"][0]["strategy_id"], "rating": 1}
        client.post(f"/v1/strategy/{r['recommendation_id']}/feedback", json=fb(body), headers=h)
    export_pairs_jsonl(client.app.state.tenant_store.scoped(TenantContext("smoke", "u", ("tenant_admin",))), w / "pairs.jsonl")

    dpo.main(["--no-quantize", "--max-steps", "2", "--base-model", str(w / "tiny"), "--sft-adapter", str(w / "sft"), "--pairs", str(w / "pairs.jsonl"),
              "--out", str(w / "dpo"), "--seq-len", "512", "--grad-accum", "1", "--experiment-log", log])
    return w, log


def test_sft_trains_and_saves_an_adapter_only(trained):
    w, _ = trained
    files = {p.name for p in (w / "sft").iterdir()}
    assert {"adapter_config.json", "adapter_model.safetensors", "training_card.json"} <= files
    assert not any(f.startswith("model") and f.endswith(".safetensors") for f in files)               # adapter only, never the base weights
    cfgj = json.loads((w / "sft" / "adapter_config.json").read_text())
    assert cfgj["r"] == 16 and cfgj["lora_alpha"] == 32 and cfgj["lora_dropout"] == 0.05
    assert set(cfgj["target_modules"]) == {"q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"}
    card = json.loads((w / "sft" / "training_card.json").read_text())
    assert card["final_train_loss"] > 0 and card["recipe"]["loss"] == "completion-only" and card["versions"]["trl"]


def test_dpo_trains_from_the_sft_adapter_and_starts_at_the_reference_loss(trained):
    w, _ = trained
    assert (w / "dpo" / "adapter_model.safetensors").exists()
    card = json.loads((w / "dpo" / "training_card.json").read_text())
    assert card["final_train_loss"] == pytest.approx(0.6931, abs=0.01)       # policy == reference at the start: loss = ln 2 and rewards ~ 0


def test_trl_keeps_a_frozen_ref_copy_of_the_sft_adapter_as_the_dpo_reference(trained):
    """The mechanism dpo.py relies on (trl >= 1.0): a pretrained adapter + ref_model=None -> TRL adds a frozen "ref" adapter."""
    import torch
    from datasets import Dataset
    from peft import PeftModel
    from transformers import AutoModelForCausalLM, AutoTokenizer
    from trl import DPOConfig, DPOTrainer
    w, _ = trained
    base = AutoModelForCausalLM.from_pretrained(str(w / "tiny"), dtype=torch.float32)
    model = PeftModel.from_pretrained(base, str(w / "sft"), is_trainable=True)
    pairs = [json.loads(line) for line in (w / "pairs.jsonl").read_text().splitlines()]
    ds = Dataset.from_list([{k: r[k] for k in ("prompt", "chosen", "rejected")} for r in pairs])
    tok = AutoTokenizer.from_pretrained(str(w / "tiny"))
    trainer = DPOTrainer(model=model, ref_model=None, args=DPOConfig(output_dir=str(w / "x"), max_steps=1, max_length=512, report_to="none", use_cpu=True), train_dataset=ds, processing_class=tok)
    assert "ref" in trainer.model.peft_config and "default" in trainer.model.peft_config


def test_experiment_log_records_both_training_runs(trained):
    _, log = trained
    runs = ExperimentLog(log).list()
    assert [r["kind"] for r in runs] == ["sft", "dpo"] and all(r["status"] == "finished" for r in runs)
    assert runs[0]["metrics"]["final_train_loss"] > 0 and runs[1]["params"]["beta"] == 0.1 and runs[0]["artifacts"]


def test_a_trained_adapter_loads_through_the_pipelines_generator(trained):
    """The fine-tuned model plugs into the same generator interface. A random tiny model cannot write valid JSON, so the service falls back."""
    w, _ = trained
    gen = LLMGenerator(str(w / "tiny"), max_new_tokens=12, adapter_path=str(w / "sft"))
    assert gen.available() is True
    text = gen.generate(build_prompt(make_req(), 1, [], []))
    assert isinstance(text, str)
    assert LLMGenerator(str(w / "tiny"), adapter_path=str(w / "no-such-adapter")).available() is False          # never serve the base while claiming an adapter
    from strategy_agent.config import Settings
    st = Settings(tenant_db_path=str(w / "t2.sqlite"), shared_db_path=str(w / "s2.sqlite"), generator_backend="template", rag_backend="tfidf")
    from strategy_agent.db.shared_store import SharedReader
    from strategy_agent.db.tenant_store import TenantStore
    svc = StrategyService(st, TenantStore(st.tenant_db_path), SharedReader(st.shared_db_path), LLMGenerator(str(w / "tiny"), 12, str(w / "sft")), TemplateGenerator(), Retriever("tfidf"))
    res = svc.generate(TenantContext("t", "u", ("tenant_admin",)), make_req())
    assert res.generator_used == "template" and len(res.strategies) == 3 and any("fell back" in x for x in res.warnings)


def test_the_eval_cli_path_for_a_finetuned_adapter_runs_and_reports_when_the_model_falls_back(trained, tmp_path):
    """--model llm --adapter PATH: the fine-tuned system joins the comparison. A random tiny model cannot write JSON, so every request
    falls back to the template, and the report must SAY SO (otherwise the 'fine-tuned' numbers would really be the template's)."""
    from strategy_agent.eval.run import run
    w, _ = trained
    log = ExperimentLog(tmp_path / "runs.jsonl")
    R = run(model="llm", llm_name=str(w / "tiny"), adapter=str(w / "sft"), n_briefs=4, n_tenants=70, seed=3, out_dir=str(tmp_path), n_llm_briefs=2,
            simulator_samples=1200, k=4, experiment_log=log, llm_max_new_tokens=8)
    assert R["ablations"]["finetuned"]["status"] == "run" and R["ablations"]["template_vs_llm"]["status"] == "run"
    systems = R["ablations"]["template_vs_llm"]["systems"]
    assert "agent_finetuned_cold_start" in systems and systems["agent_finetuned_cold_start"]["fell_back_to_template_rate"] == 1.0
    md = (tmp_path / "eval_report.md").read_text()
    assert "Fine-tuned model vs template vs rule baseline: run" in md and "Read the last column first" in md and "fell back to the template" in md
    rec = log.list("eval")[-1]
    assert rec["status"] == "finished" and rec["metrics"]["finetuned_status"] == "run" and rec["params"]["adapter"].endswith("sft")


def test_the_eval_cli_reports_a_missing_adapter_as_not_run_instead_of_serving_the_base_model(trained, tmp_path):
    from strategy_agent.eval.run import run
    w, _ = trained
    R = run(model="llm", llm_name=str(w / "tiny"), adapter=str(w / "does-not-exist"), n_briefs=3, n_tenants=70, seed=3, out_dir=str(tmp_path),
            simulator_samples=1200, k=4)
    assert R["ablations"]["finetuned"]["status"] == "not_run" and "was not found" in R["ablations"]["finetuned"]["reason"]


def test_resume_continues_from_the_latest_checkpoint_after_a_disconnect(trained, tmp_path, capsys):
    """Colab sessions drop. --resume must continue from the newest checkpoint (kept on Drive) instead of starting over."""
    w, _ = trained
    out, log = tmp_path / "sft_resume", str(tmp_path / "runs.jsonl")
    common = ["--no-quantize", "--base-model", str(w / "tiny"), "--data-dir", str(w / "data"), "--out", str(out), "--seq-len", "512", "--grad-accum", "1", "--experiment-log", log, "--save-every", "5"]
    sft_qlora.main(common + ["--epochs", "1"])
    first = sorted(p.name for p in out.glob("checkpoint-*"))
    assert first, "no checkpoint was written during the epoch"
    capsys.readouterr()
    sft_qlora.main(common + ["--epochs", "2", "--resume"])
    assert f"resuming from {out / first[-1]}" in capsys.readouterr().out
    steps = [r["metrics"]["steps"] for r in ExperimentLog(log).list("sft")]
    assert steps[1] > steps[0] and len(sorted(out.glob("checkpoint-*"))) >= 2          # trained the second epoch on top of the first, not from scratch


def test_resume_without_a_checkpoint_starts_fresh():
    from strategy_agent.training.common import latest_checkpoint
    assert latest_checkpoint("/no/such/dir", resume=True) is None and latest_checkpoint(".", resume=False) is None


MISTRAL = "mistralai/Mistral-7B-Instruct-v0.3"


def _mistral_tokenizer():
    try:
        from transformers import AutoTokenizer
        return AutoTokenizer.from_pretrained(MISTRAL, local_files_only=True)
    except Exception:
        return None


@pytest.mark.skipif(_mistral_tokenizer() is None, reason="Mistral tokenizer not cached locally")
def test_sft_and_dpo_run_with_the_real_mistral_tokenizer_and_chat_template(trained, tmp_path):
    """What changes on Colab is only the 7B weights and 4-bit. The tokenizer, chat template, TRL's completion-only masking and the DPO reference
    mechanism are exercised here with a tiny Mistral-architecture model and Mistral's REAL tokenizer."""
    import torch
    from transformers import MistralConfig, MistralForCausalLM
    w, _ = trained
    tok = _mistral_tokenizer()
    cfg = MistralConfig(vocab_size=len(tok), hidden_size=64, intermediate_size=128, num_hidden_layers=2, num_attention_heads=4, num_key_value_heads=2, max_position_embeddings=4096)
    torch.manual_seed(0)
    MistralForCausalLM(cfg).save_pretrained(tmp_path / "tiny")
    tok.save_pretrained(tmp_path / "tiny")
    log = str(tmp_path / "runs.jsonl")
    sft_qlora.main(["--no-quantize", "--max-steps", "2", "--base-model", str(tmp_path / "tiny"), "--data-dir", str(w / "data"), "--out", str(tmp_path / "sft"),
                    "--seq-len", "2048", "--grad-accum", "1", "--experiment-log", log])
    card = json.loads((tmp_path / "sft" / "training_card.json").read_text())
    assert card["data"]["train"]["fits"] and card["final_train_loss"] == pytest.approx(10.4, abs=0.3)         # ln(32768) = 10.40 for a random model
    dpo.main(["--no-quantize", "--max-steps", "2", "--base-model", str(tmp_path / "tiny"), "--sft-adapter", str(tmp_path / "sft"), "--pairs", str(w / "pairs.jsonl"),
              "--out", str(tmp_path / "dpo"), "--seq-len", "2048", "--grad-accum", "1", "--experiment-log", log])
    assert json.loads((tmp_path / "dpo" / "training_card.json").read_text())["final_train_loss"] == pytest.approx(0.6931, abs=0.01)
    assert [r["status"] for r in ExperimentLog(log).list()] == ["finished", "finished"]


@pytest.fixture(scope="module")
def tiny_mistral(tmp_path_factory):
    import torch
    from transformers import MistralConfig, MistralForCausalLM
    tok = _mistral_tokenizer()
    if tok is None:
        pytest.skip("Mistral tokenizer not cached locally")
    d = tmp_path_factory.mktemp("tiny_mistral")
    cfg = MistralConfig(vocab_size=len(tok), hidden_size=64, intermediate_size=128, num_hidden_layers=2, num_attention_heads=4, num_key_value_heads=2, max_position_embeddings=4096)
    torch.manual_seed(0)
    MistralForCausalLM(cfg).save_pretrained(d)
    tok.save_pretrained(d)
    return d


def test_trl_prints_no_prefix_warning_for_mistral_after_the_fix_and_does_print_it_without(tiny_mistral, tmp_path):
    """The exact symptom from the first Colab run, checked on the WHOLE log (an earlier local check missed it because the log was filtered)."""
    import subprocess, sys
    from pathlib import Path
    root = Path(__file__).resolve().parents[2]
    fixed = subprocess.run([sys.executable, "-m", "strategy_agent.training.sft_qlora", "--no-quantize", "--max-steps", "1", "--base-model", str(tiny_mistral), "--data-dir",
                            "data/strategy_sft/v1", "--out", str(tmp_path / "sft"), "--seq-len", "2048", "--grad-accum", "1", "--experiment-log", str(tmp_path / "r.jsonl")],
                           capture_output=True, text=True, cwd=root)
    assert fixed.returncode == 0, fixed.stderr[-800:]
    assert "not a prefix" not in fixed.stdout + fixed.stderr

    snippet = (
        "import json\nfrom datasets import Dataset\nfrom transformers import AutoModelForCausalLM, AutoTokenizer\nfrom trl import SFTConfig, SFTTrainer\n"
        f"tok = AutoTokenizer.from_pretrained({str(tiny_mistral)!r}); model = AutoModelForCausalLM.from_pretrained({str(tiny_mistral)!r})\n"
        "rows = [json.loads(l) for l in open('data/strategy_sft/v1/train.jsonl')][:3]\n"                                    # RAW rows: the system role left in place
        "ds = Dataset.from_list([{'prompt': r['prompt'], 'completion': r['completion']} for r in rows])\n"
        f"SFTTrainer(model=model, args=SFTConfig(output_dir={str(tmp_path / 'old')!r}, max_steps=1, per_device_train_batch_size=1, completion_only_loss=True, max_length=2048, report_to='none', use_cpu=True), train_dataset=ds, processing_class=tok)\n")
    unfixed = subprocess.run([sys.executable, "-c", snippet], capture_output=True, text=True, cwd=root)
    assert "not a prefix" in unfixed.stdout + unfixed.stderr                                                                     # negative control: the log does show the bug

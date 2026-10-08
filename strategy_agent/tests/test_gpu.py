"""A T4 (compute capability 7.5) reports bf16 as 'supported' through emulation, and TRL's chunked loss kernel then fails with
"gemm input type BFloat16 and output type float is only supported for CUDA devices with compute capability 8.0 or higher".
These tests pin the capability-based choice. They simulate GPUs, so they run on any machine."""
from __future__ import annotations

import re
from pathlib import Path

import pytest

torch = pytest.importorskip("torch")          # optional extra (requirements-llm.txt): skip, do not fail, without it

from strategy_agent import gpu  # noqa: E402
from strategy_agent.training.common import bf16_ok  # noqa: E402

PKG = Path(gpu.__file__).resolve().parent


def fake_gpu(monkeypatch, capability, emulated_bf16=True):
    monkeypatch.setattr(torch.cuda, "is_available", lambda: capability is not None)
    monkeypatch.setattr(torch.cuda, "get_device_capability", lambda *_: capability)
    monkeypatch.setattr(torch.cuda, "is_bf16_supported", lambda *a, **k: emulated_bf16)


def test_t4_is_not_bf16_even_though_torch_says_supported(monkeypatch):
    fake_gpu(monkeypatch, (7, 5), emulated_bf16=True)
    assert torch.cuda.is_bf16_supported() is True          # the misleading answer
    assert gpu.native_bf16() is False and bf16_ok() is False


@pytest.mark.parametrize("cc", [(8, 0), (8, 6), (8, 9), (9, 0)])
def test_ampere_and_newer_use_bf16(monkeypatch, cc):
    fake_gpu(monkeypatch, cc)
    assert gpu.native_bf16() is True and bf16_ok() is True


def test_no_gpu_means_no_bf16(monkeypatch):
    fake_gpu(monkeypatch, None, emulated_bf16=False)
    assert gpu.compute_capability() is None and gpu.native_bf16() is False


def kernel_modules():
    return [m for m in (pytest.importorskip("trl.kernels.chunked_logprob"),)]


def test_pre_ampere_switches_the_mixed_precision_matmul_off(monkeypatch):
    (mod,) = kernel_modules()
    monkeypatch.setattr(mod, "_MM_OUT_DTYPE", True)
    fake_gpu(monkeypatch, (7, 5))
    assert gpu.prepare_pre_ampere() is True
    assert mod._MM_OUT_DTYPE is False


def test_ampere_leaves_the_kernel_alone(monkeypatch):
    (mod,) = kernel_modules()
    monkeypatch.setattr(mod, "_MM_OUT_DTYPE", True)
    fake_gpu(monkeypatch, (8, 0))
    assert gpu.prepare_pre_ampere() is False and mod._MM_OUT_DTYPE is True


def test_cpu_is_a_no_op(monkeypatch):
    fake_gpu(monkeypatch, None)
    assert gpu.prepare_pre_ampere() is False


def test_the_fallback_matmul_gives_the_same_numbers(monkeypatch):
    """With the flag off the kernel accumulates in fp32 from upcast inputs; it must equal the plain fp32 product."""
    (mod,) = kernel_modules()
    monkeypatch.setattr(mod, "_MM_OUT_DTYPE", False)
    torch.manual_seed(0)
    a, b = torch.randn(8, 16, dtype=torch.float16), torch.randn(16, 5, dtype=torch.float16)
    acc = torch.zeros(8, 5)
    mod._addmm_fp32(acc, a, b)
    assert torch.allclose(acc, a.float() @ b.float(), atol=1e-5)


def test_nothing_else_asks_torch_whether_bf16_is_supported():
    """The wrong question must not come back: only the hardware-capability helper decides the compute dtype."""
    offenders = [str(p.relative_to(PKG)) for p in PKG.rglob("*.py")
                 if "tests" not in p.parts and re.search(r"is_bf16_supported", p.read_text()) and p.name != "gpu.py"]
    assert offenders == [], f"use strategy_agent.gpu.native_bf16 instead in: {offenders}"


# ---------------------------------------------------------------------------------------------------- fp16 needs fp32 trainable weights
QWEN = "Qwen/Qwen2.5-1.5B-Instruct"


def test_trl_casts_a_4bit_models_adapter_to_bf16_and_the_helper_undoes_it(monkeypatch):
    """The second T4 failure: with fp16 training the gradient scaler raised NotImplementedError for BFloat16 gradients, because TRL's SFTTrainer
    casts every trainable tensor of a 4-bit model to bf16. A tiny CPU model with the '4-bit' flag set shows both the cast and the fix."""
    pytest.importorskip("trl")
    pytest.importorskip("peft")
    from datasets import Dataset
    from peft import LoraConfig
    from transformers import AutoTokenizer, Qwen2Config, Qwen2ForCausalLM
    from trl import SFTConfig, SFTTrainer

    from strategy_agent.training.common import LORA_TARGETS, keep_trainable_in_fp32

    try:
        tok = AutoTokenizer.from_pretrained(QWEN, local_files_only=True)
    except Exception:
        pytest.skip("Qwen tokenizer is not cached locally")
    cfg = Qwen2Config(vocab_size=len(tok), hidden_size=64, intermediate_size=128, num_hidden_layers=2, num_attention_heads=4,
                      num_key_value_heads=2, max_position_embeddings=512, tie_word_embeddings=True)
    monkeypatch.setattr(Qwen2ForCausalLM, "is_loaded_in_4bit", True, raising=False)       # what SFTTrainer reads to detect QLoRA
    ds = Dataset.from_list([{"prompt": [{"role": "user", "content": "hi"}], "completion": [{"role": "assistant", "content": "hello"}]}] * 2)
    trainer = SFTTrainer(model=Qwen2ForCausalLM(cfg), train_dataset=ds, processing_class=tok,
                         args=SFTConfig(output_dir="/tmp/_unused", report_to="none", use_cpu=True, max_length=64, completion_only_loss=True),
                         peft_config=LoraConfig(r=4, target_modules=LORA_TARGETS, task_type="CAUSAL_LM"))
    trainable = lambda: {p.dtype for p in trainer.model.parameters() if p.requires_grad}  # noqa: E731
    frozen = {p.dtype for p in trainer.model.parameters() if not p.requires_grad}
    assert trainable() == {torch.bfloat16}                      # TRL's cast (negative control: without the helper fp16 training fails)
    assert keep_trainable_in_fp32(trainer.model) > 0
    assert trainable() == {torch.float32}
    assert {p.dtype for p in trainer.model.parameters() if not p.requires_grad} == frozen   # the frozen base is left alone
    assert keep_trainable_in_fp32(trainer.model) == 0           # idempotent


def test_both_training_scripts_apply_the_fp32_fix_for_fp16_runs():
    for script in ("sft_qlora.py", "dpo.py"):
        text = (PKG / "training" / script).read_text()
        assert "keep_trainable_in_fp32(trainer.model)" in text and "prepare_pre_ampere()" in text, script

"""Helpers shared by the GPU training scripts. Importing this module needs NO GPU and none of peft / trl / bitsandbytes."""
from __future__ import annotations

import inspect
import json
import platform
from pathlib import Path
from typing import Any, Iterable, Optional

DEFAULT_BASE = "mistralai/Mistral-7B-Instruct-v0.3"      # production target (single 24 GB GPU, 4-bit QLoRA)
LORA_TARGETS = ["q_proj", "k_proj", "v_proj", "o_proj", "gate_proj", "up_proj", "down_proj"]   # attention + MLP projections


def load_jsonl(path: Path) -> list[dict]:
    with open(path, encoding="utf-8") as f:
        return [json.loads(line) for line in f if line.strip()]


def n_tokens(tokenizer, messages: list[dict]) -> int:
    from ..generation.chat import render_chat

    return len(tokenizer(render_chat(tokenizer, messages), add_special_tokens=False)["input_ids"])


def adapt_rows(tokenizer, rows: list[dict], fields: tuple[str, ...] = ("prompt",)) -> list[dict]:
    """Make every prompt render identically for inference and training under this tokenizer's chat template (folds `system` into `user` where needed)."""
    from ..generation.chat import needs_system_merge, merge_system_into_user

    merge = needs_system_merge(tokenizer)
    out = []
    for r in rows:
        r = dict(r)
        if merge:
            r["prompt"] = merge_system_into_user(r["prompt"])
        out.append(r)
    return out


def alignment_report(tokenizer, rows: Iterable[dict], kind: str) -> dict:
    """The check TRL performs: the tokens of the prompt alone must be a PREFIX of the tokens of prompt + answer. If not, TRL treats only the common start as the
    prompt and the loss covers the brief too (so it is no longer completion-only) and the model trains on a context it never sees at inference."""
    bad, first, n = 0, None, 0
    for i, r in enumerate(rows):          # the tokenizer's template is called DIRECTLY, exactly as TRL does (no folding helper in between)
        n += 1
        prompt_ids = tokenizer(tokenizer.apply_chat_template(r["prompt"], tokenize=False, add_generation_prompt=True), add_special_tokens=False)["input_ids"]
        for answer in ([r["completion"]] if kind == "sft" else [r["chosen"], r["rejected"]]):
            full_ids = tokenizer(tokenizer.apply_chat_template(r["prompt"] + answer, tokenize=False), add_special_tokens=False)["input_ids"]
            if full_ids[: len(prompt_ids)] != prompt_ids:
                bad += 1
                first = i if first is None else first
                break
    return {"examples_checked": n, "prompt_prefix_mismatches": bad, "first_bad_example": first, "aligned": bad == 0}


def length_report(tokenizer, rows: Iterable[dict], seq_len: int, kind: str) -> dict:
    """Token-length statistics of the full training sequences (prompt + completion). Anything over seq_len would be truncated."""
    lens: list[int] = []
    for r in rows:
        if kind == "sft":
            lens.append(n_tokens(tokenizer, r["prompt"] + r["completion"]))
        else:  # dpo: the longer of the two completions decides
            lens.append(max(n_tokens(tokenizer, r["prompt"] + r["chosen"]), n_tokens(tokenizer, r["prompt"] + r["rejected"])))
    over = sum(1 for n in lens if n > seq_len)
    return {"examples": len(lens), "mean_tokens": round(sum(lens) / len(lens), 1) if lens else 0, "max_tokens": max(lens) if lens else 0,
            "seq_len": seq_len, "examples_over_seq_len": over, "fits": over == 0}


def supported_kwargs(cls: type, required: tuple[str, ...] = (), **kwargs: Any) -> dict:
    """Pass only the arguments this installed library version understands (trl / transformers rename arguments between releases).

    Arguments named in `required` change what training MEANS (for example completion-only loss); if the installed version lacks
    one, we stop with an error instead of silently training something different."""
    names = set(inspect.signature(cls).parameters)
    for base in cls.__mro__[1:]:
        try:
            names |= set(inspect.signature(base).parameters)
        except (TypeError, ValueError):
            pass
    missing = [r for r in required if r not in names]
    if missing:
        raise RuntimeError(f"{cls.__name__} in the installed library does not support {missing}; refusing to train without them. Upgrade trl / transformers.")
    return {k: v for k, v in kwargs.items() if k in names}


def latest_checkpoint(out_dir: str | Path, resume: bool) -> Optional[str]:
    """The newest `checkpoint-N` folder in out_dir when --resume is set and one exists (otherwise training starts fresh)."""
    if not resume or not Path(out_dir).is_dir():
        return None
    from transformers.trainer_utils import get_last_checkpoint

    return get_last_checkpoint(str(out_dir))


def bf16_ok() -> bool:
    """bf16 in hardware only (see `gpu.native_bf16`: a T4 reports bf16 as supported through emulation, and TRL's loss kernel then fails)."""
    from ..gpu import native_bf16

    return native_bf16()


def keep_trainable_in_fp32(model) -> int:
    """Put every trainable tensor (the LoRA adapter) back in fp32; returns how many were changed.

    fp16 mixed precision needs fp32 trainable weights: its gradient scaler cannot unscale bf16 gradients ("_amp_foreach_non_finite_check_and_unscale_
    not implemented for 'BFloat16'"). TRL's SFTTrainer casts the adapter of any 4-bit model to bf16, whatever precision is requested, which is
    right on Ampere or newer (bf16 training) and wrong on a T4 (fp16 training). Call this after the trainer is built and before `train()`."""
    import torch

    changed = 0
    for param in model.parameters():
        if param.requires_grad and param.dtype in (torch.float16, torch.bfloat16):
            param.data = param.data.float()
            changed += 1
    return changed


def write_training_card(out_dir: Path, args: dict, extra: dict) -> None:
    import importlib.metadata as md
    versions = {}
    for pkg in ("torch", "transformers", "peft", "trl", "bitsandbytes", "datasets", "accelerate"):
        try:
            versions[pkg] = md.version(pkg)
        except md.PackageNotFoundError:
            versions[pkg] = None
    out_dir.mkdir(parents=True, exist_ok=True)
    (out_dir / "training_card.json").write_text(json.dumps({"args": args, **extra, "versions": versions, "python": platform.python_version()}, indent=2, default=str))

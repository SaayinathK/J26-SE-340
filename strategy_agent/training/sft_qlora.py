"""QLoRA supervised fine-tuning of the strategy generator.   Production target: ONE 24 GB GPU (or a Kaggle / Colab T4).

    # real run (GPU, 4-bit NF4):
    python -m strategy_agent.training.sft_qlora --data-dir data/strategy_sft/v1 --out outputs/sft_adapter
    # checks that need no GPU:
    python -m strategy_agent.training.sft_qlora --dry-run --base-model Qwen/Qwen2.5-1.5B-Instruct
    python -m strategy_agent.training.sft_qlora --no-quantize --max-steps 2 --base-model <tiny local model>     # CPU smoke test of the training code path

Recipe: base loaded in 4-bit NF4 (double quantisation); LoRA r=16, alpha=32, dropout=0.05 on the attention and MLP projections;
completion-only loss (prompt tokens are not trained on); sequence length 2048; 2-3 epochs; cosine schedule; gradient checkpointing.
Only the ADAPTER is saved. Production base: Mistral-7B-Instruct. For a 16 GB T4 use --base-model Qwen/Qwen2.5-1.5B-Instruct.

WHAT HAS AND HAS NOT BEEN RUN (be precise about this when presenting it):
  * `--dry-run` and the CPU smoke test (`--no-quantize --max-steps N` on a tiny local model) HAVE been executed and are tested, against trl 1.16 / peft 0.21.
  * The 4-bit NF4 + CUDA path (bitsandbytes) has NOT been executed: it needs an NVIDIA GPU, which the development machine does not have.
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path
from typing import Optional

from ..experiments import ExperimentLog, default_log
from ..gpu import compute_capability, prepare_pre_ampere
from .common import DEFAULT_BASE, latest_checkpoint, LORA_TARGETS, adapt_rows, alignment_report, bf16_ok, keep_trainable_in_fp32, length_report, load_jsonl, supported_kwargs, write_training_card


def parse(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base-model", default=DEFAULT_BASE)
    ap.add_argument("--data-dir", default="data/strategy_sft/v1")
    ap.add_argument("--out", default="outputs/sft_adapter")
    ap.add_argument("--epochs", type=float, default=3.0)
    ap.add_argument("--lr", type=float, default=2e-4)
    ap.add_argument("--seq-len", type=int, default=2048)
    ap.add_argument("--batch-size", type=int, default=1)
    ap.add_argument("--grad-accum", type=int, default=16)
    ap.add_argument("--lora-r", type=int, default=16)
    ap.add_argument("--lora-alpha", type=int, default=32)
    ap.add_argument("--lora-dropout", type=float, default=0.05)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--max-steps", type=int, default=-1, help="stop after N optimiser steps (smoke tests); -1 = train for --epochs")
    ap.add_argument("--no-quantize", action="store_true", help="skip 4-bit quantisation and the CUDA requirement (CPU smoke tests ONLY)")
    ap.add_argument("--save-every", type=int, default=20, help="save a resumable checkpoint every N optimiser steps (0 = only at the end of each epoch); the newest 2 are kept")
    ap.add_argument("--resume", action="store_true", help="continue from the latest checkpoint in --out (use after a Colab disconnect)")
    ap.add_argument("--dry-run", action="store_true", help="validate the data and tokenizer on CPU; do not load the model or train")
    ap.add_argument("--experiment-log", default=None, help="path of the JSONL experiment log (default: from settings)")
    return ap.parse_args(argv)


def prepare(args: argparse.Namespace):
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(args.base_model)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    data = Path(args.data_dir)
    train, val = adapt_rows(tok, load_jsonl(data / "train.jsonl"), ("prompt",)), adapt_rows(tok, load_jsonl(data / "val.jsonl"), ("prompt",))
    report = {"train": length_report(tok, train, args.seq_len, "sft"), "val": length_report(tok, val, args.seq_len, "sft")}
    report["train"]["alignment"], report["val"]["alignment"] = alignment_report(tok, train, "sft"), alignment_report(tok, val, "sft")
    return tok, train, val, report


def main(argv=None) -> dict:
    args = parse(argv)
    log = ExperimentLog(args.experiment_log) if args.experiment_log else default_log()
    with log.run("sft", {k: v for k, v in vars(args).items() if k != "experiment_log"}) as run:
        summary = _run(args, run)
    return summary


def _run(args: argparse.Namespace, run) -> dict:
    tok, train, val, report = prepare(args)
    quantize = not args.no_quantize
    recipe = {"base_model": args.base_model, "quantisation": "4-bit NF4 + double quant" if quantize else "none (CPU smoke test)",
              "lora": {"r": args.lora_r, "alpha": args.lora_alpha, "dropout": args.lora_dropout, "target_modules": LORA_TARGETS},
              "loss": "completion-only", "seq_len": args.seq_len, "epochs": args.epochs, "max_steps": args.max_steps, "lr": args.lr, "scheduler": "cosine",
              "effective_batch": args.batch_size * args.grad_accum, "gradient_checkpointing": quantize}
    summary = {"recipe": recipe, "data": report}
    run.metrics.update({"train_examples": report["train"]["examples"], "max_tokens": report["train"]["max_tokens"], "fits_seq_len": report["train"]["fits"]})
    if not (report["train"]["fits"] and report["val"]["fits"]):
        print("WARNING: some examples exceed the sequence length and would be truncated")
    misaligned = report["train"]["alignment"]["prompt_prefix_mismatches"] + report["val"]["alignment"]["prompt_prefix_mismatches"]
    run.metrics["prompt_prefix_mismatches"] = misaligned
    if misaligned:
        msg = (f"{misaligned} examples have a prompt that is not a prefix of prompt+answer under this tokenizer's chat template. TRL would then train the loss on the "
               "brief itself and on a context that differs from inference (this is what Mistral's template does with a system message).")
        if not args.dry_run:
            raise SystemExit("refusing to train: " + msg)
        print("WARNING: " + msg)
    if args.dry_run:
        run.status = "dry_run"
        print(json.dumps(summary, indent=2))
        return summary

    import torch
    from datasets import Dataset
    from peft import LoraConfig, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, BitsAndBytesConfig
    from trl import SFTConfig, SFTTrainer

    if quantize and not torch.cuda.is_available():
        raise SystemExit("No CUDA GPU found. Run on a GPU machine (Kaggle / Colab T4 / 24 GB card), or use --dry-run.")
    if quantize:
        print(f"GPU compute capability {compute_capability()}: training in {'bf16' if bf16_ok() else 'fp16'}")
        prepare_pre_ampere()
    lora = LoraConfig(r=args.lora_r, lora_alpha=args.lora_alpha, lora_dropout=args.lora_dropout, target_modules=LORA_TARGETS, bias="none", task_type="CAUSAL_LM")
    if quantize:
        compute = torch.bfloat16 if bf16_ok() else torch.float16
        bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=compute)
        model = AutoModelForCausalLM.from_pretrained(args.base_model, quantization_config=bnb, device_map="auto", torch_dtype=compute)
        model = prepare_model_for_kbit_training(model, use_gradient_checkpointing=True)
    else:
        compute = torch.float32
        model = AutoModelForCausalLM.from_pretrained(args.base_model, torch_dtype=compute)

    to_ds = lambda rows: Dataset.from_list([{"prompt": r["prompt"], "completion": r["completion"]} for r in rows])  # noqa: E731
    cfg = SFTConfig(**supported_kwargs(
        SFTConfig, required=("completion_only_loss", "max_length", "learning_rate", "lr_scheduler_type"),
        output_dir=args.out, num_train_epochs=args.epochs, max_steps=args.max_steps, per_device_train_batch_size=args.batch_size,
        per_device_eval_batch_size=args.batch_size, gradient_accumulation_steps=args.grad_accum, learning_rate=args.lr, lr_scheduler_type="cosine",
        warmup_ratio=0.03, logging_steps=1 if args.max_steps > 0 else 10, save_strategy="no" if args.max_steps > 0 else ("steps" if args.save_every > 0 else "epoch"),
        save_steps=max(args.save_every, 1), save_total_limit=2,
        eval_strategy="no" if args.max_steps > 0 else "epoch", bf16=quantize and compute == torch.bfloat16, fp16=quantize and compute == torch.float16,
        gradient_checkpointing=quantize, max_length=args.seq_len, completion_only_loss=True, report_to="none", seed=args.seed, use_cpu=not torch.cuda.is_available()))
    trainer = SFTTrainer(model=model, args=cfg, train_dataset=to_ds(train), eval_dataset=None if args.max_steps > 0 else to_ds(val), peft_config=lora, processing_class=tok)
    if quantize and compute == torch.float16:      # TRL casts a 4-bit model's adapter to bf16, which the fp16 gradient scaler cannot unscale
        print(f"fp16 training: kept {keep_trainable_in_fp32(trainer.model)} trainable adapter tensors in fp32")
    ckpt = latest_checkpoint(args.out, args.resume)
    if ckpt:
        print(f"resuming from {ckpt}")
    trainer.train(resume_from_checkpoint=ckpt)
    trainer.model.save_pretrained(args.out)       # adapter only
    tok.save_pretrained(args.out)
    losses = [h["loss"] for h in trainer.state.log_history if "loss" in h]
    run.metrics.update({"steps": trainer.state.global_step, "final_train_loss": round(losses[-1], 4) if losses else None})
    run.artifacts.append(str(args.out))
    write_training_card(Path(args.out), vars(args), {"data": report, "recipe": recipe, "final_train_loss": run.metrics["final_train_loss"]})
    print(f"adapter saved to {args.out}")
    return summary


if __name__ == "__main__":
    main()

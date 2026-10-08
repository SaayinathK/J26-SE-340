"""DPO preference optimisation on top of the SFT adapter.   Production target: ONE 24 GB GPU (or Kaggle / Colab).

    python -m strategy_agent.training.dpo --sft-adapter outputs/sft_adapter --pairs pairs.jsonl --out outputs/dpo_adapter      # GPU
    python -m strategy_agent.training.dpo --dry-run --pairs pairs.jsonl --base-model Qwen/Qwen2.5-1.5B-Instruct               # CPU: data only
    python -m strategy_agent.training.dpo --no-quantize --max-steps 2 ...                                                     # CPU smoke test

Pairs come from real feedback and outcomes (strategy_agent.learning.preference.export_pairs_jsonl, per tenant). beta = 0.1.

Reference policy = the SFT model. With trl 1.x we load the SFT adapter as the trainable adapter and pass ref_model=None: TRL then keeps a
frozen copy of the adapter's INITIAL weights under the name "ref" and uses it for the KL anchor (verified in trl 1.16's source and by the
smoke test). Earlier trl versions used `model_adapter_name` / `ref_adapter_name`, which no longer exist, so this script needs trl >= 1.0.

Privacy: pairs are tenant data. Training on several tenants' pairs together needs their consent; the consent-gated pipeline is the
intended route. This script does not pool tenants by itself.

WHAT HAS AND HAS NOT BEEN RUN: `--dry-run` and the CPU smoke test HAVE been executed (trl 1.16 / peft 0.21). The 4-bit CUDA path has NOT
(no NVIDIA GPU on the development machine).
"""
from __future__ import annotations

import argparse
import json
from pathlib import Path

from ..experiments import ExperimentLog, default_log
from ..gpu import compute_capability, prepare_pre_ampere
from .common import DEFAULT_BASE, latest_checkpoint, adapt_rows, alignment_report, bf16_ok, keep_trainable_in_fp32, length_report, load_jsonl, supported_kwargs, write_training_card

MIN_PAIRS_WARNING = 50


def parse(argv=None) -> argparse.Namespace:
    ap = argparse.ArgumentParser(description=__doc__.split("\n")[0])
    ap.add_argument("--base-model", default=DEFAULT_BASE)
    ap.add_argument("--sft-adapter", default="outputs/sft_adapter")
    ap.add_argument("--pairs", required=True, help="JSONL exported by learning.preference.export_pairs_jsonl")
    ap.add_argument("--out", default="outputs/dpo_adapter")
    ap.add_argument("--beta", type=float, default=0.1)
    ap.add_argument("--epochs", type=float, default=2.0)
    ap.add_argument("--lr", type=float, default=5e-6)
    ap.add_argument("--seq-len", type=int, default=2048)
    ap.add_argument("--batch-size", type=int, default=1)
    ap.add_argument("--grad-accum", type=int, default=8)
    ap.add_argument("--seed", type=int, default=42)
    ap.add_argument("--max-steps", type=int, default=-1)
    ap.add_argument("--no-quantize", action="store_true", help="skip 4-bit quantisation and the CUDA requirement (CPU smoke tests ONLY)")
    ap.add_argument("--resume", action="store_true", help="continue from the latest checkpoint in --out (use after a Colab disconnect)")
    ap.add_argument("--dry-run", action="store_true")
    ap.add_argument("--experiment-log", default=None)
    return ap.parse_args(argv)


def validate_pairs(rows: list[dict]) -> list[str]:
    problems = []
    for i, r in enumerate(rows):
        for k in ("prompt", "chosen", "rejected"):
            if not isinstance(r.get(k), list) or not r[k]:
                problems.append(f"row {i}: '{k}' must be a non-empty list of chat messages")
        if r.get("chosen") == r.get("rejected"):
            problems.append(f"row {i}: chosen and rejected are identical")
    return problems


def main(argv=None) -> dict:
    args = parse(argv)
    log = ExperimentLog(args.experiment_log) if args.experiment_log else default_log()
    with log.run("dpo", {k: v for k, v in vars(args).items() if k != "experiment_log"}) as run:
        return _run(args, run)


def _run(args: argparse.Namespace, run) -> dict:
    rows = load_jsonl(Path(args.pairs))
    problems = validate_pairs(rows)
    if problems:
        raise SystemExit("invalid preference data:\n  " + "\n  ".join(problems[:10]))
    from transformers import AutoTokenizer

    tok = AutoTokenizer.from_pretrained(args.base_model)
    if tok.pad_token is None:
        tok.pad_token = tok.eos_token
    rows = adapt_rows(tok, rows, ("prompt",))
    kinds: dict[str, int] = {}
    for r in rows:
        kinds[r.get("kind", "unknown")] = kinds.get(r.get("kind", "unknown"), 0) + 1
    quantize = not args.no_quantize
    summary = {"recipe": {"base_model": args.base_model, "reference": "the SFT adapter (TRL keeps a frozen 'ref' copy of its initial weights)", "beta": args.beta,
                          "lr": args.lr, "epochs": args.epochs, "effective_batch": args.batch_size * args.grad_accum, "seq_len": args.seq_len,
                          "quantisation": "4-bit NF4" if quantize else "none (CPU smoke test)"},
               "data": {**length_report(tok, rows, args.seq_len, "dpo"), "by_kind": kinds, "alignment": alignment_report(tok, rows, "dpo")}}
    if summary["data"]["alignment"]["prompt_prefix_mismatches"]:
        msg = "some pairs have a prompt that is not a prefix of prompt+answer under this tokenizer's chat template; TRL would train on a context that differs from inference."
        if not args.dry_run:
            raise SystemExit("refusing to train: " + msg)
        print("WARNING: " + msg)
    run.metrics.update({"pairs": len(rows), "max_tokens": summary["data"]["max_tokens"], "fits_seq_len": summary["data"]["fits"]})
    if len(rows) < MIN_PAIRS_WARNING:
        print(f"WARNING: only {len(rows)} preference pairs; DPO is unreliable below about {MIN_PAIRS_WARNING}. Collect more feedback first.")
    if args.dry_run:
        run.status = "dry_run"
        print(json.dumps(summary, indent=2))
        return summary

    import torch
    from datasets import Dataset
    from peft import PeftModel, prepare_model_for_kbit_training
    from transformers import AutoModelForCausalLM, BitsAndBytesConfig
    from trl import DPOConfig, DPOTrainer

    if quantize and not torch.cuda.is_available():
        raise SystemExit("No CUDA GPU found. Run on a GPU machine, or use --dry-run.")
    if quantize:
        print(f"GPU compute capability {compute_capability()}: training in {'bf16' if bf16_ok() else 'fp16'}")
        prepare_pre_ampere()
        compute = torch.bfloat16 if bf16_ok() else torch.float16
        bnb = BitsAndBytesConfig(load_in_4bit=True, bnb_4bit_quant_type="nf4", bnb_4bit_use_double_quant=True, bnb_4bit_compute_dtype=compute)
        base = AutoModelForCausalLM.from_pretrained(args.base_model, quantization_config=bnb, device_map="auto", torch_dtype=compute)
        base = prepare_model_for_kbit_training(base, use_gradient_checkpointing=True)
    else:
        compute = torch.float32
        base = AutoModelForCausalLM.from_pretrained(args.base_model, torch_dtype=compute)
    model = PeftModel.from_pretrained(base, args.sft_adapter, is_trainable=True)      # the SFT adapter becomes the trainable policy

    ds = Dataset.from_list([{"prompt": r["prompt"], "chosen": r["chosen"], "rejected": r["rejected"]} for r in rows])
    cfg = DPOConfig(**supported_kwargs(
        DPOConfig, required=("beta", "max_length", "learning_rate"),
        output_dir=args.out, beta=args.beta, num_train_epochs=args.epochs, max_steps=args.max_steps, per_device_train_batch_size=args.batch_size,
        gradient_accumulation_steps=args.grad_accum, learning_rate=args.lr, lr_scheduler_type="cosine", warmup_ratio=0.1,
        logging_steps=1 if args.max_steps > 0 else 5, save_strategy="no" if args.max_steps > 0 else "epoch", bf16=quantize and compute == torch.bfloat16,
        fp16=quantize and compute == torch.float16, gradient_checkpointing=quantize, max_length=args.seq_len, report_to="none", seed=args.seed,
        use_cpu=not torch.cuda.is_available()))
    trainer = DPOTrainer(model=model, ref_model=None, args=cfg, train_dataset=ds, processing_class=tok)
    if quantize and compute == torch.float16:      # fp16 mixed precision needs fp32 trainable weights (see keep_trainable_in_fp32)
        print(f"fp16 training: kept {keep_trainable_in_fp32(trainer.model)} trainable adapter tensors in fp32")
    ckpt = latest_checkpoint(args.out, args.resume)
    if ckpt:
        print(f"resuming from {ckpt}")
    trainer.train(resume_from_checkpoint=ckpt)
    trainer.model.save_pretrained(args.out, selected_adapters=["default"])          # the trained policy adapter only (not the frozen "ref" copy)
    tok.save_pretrained(args.out)
    losses = [h["loss"] for h in trainer.state.log_history if "loss" in h]
    run.metrics.update({"steps": trainer.state.global_step, "final_train_loss": round(losses[-1], 4) if losses else None})
    run.artifacts.append(str(args.out))
    write_training_card(Path(args.out), vars(args), {"data": summary["data"], "recipe": summary["recipe"], "final_train_loss": run.metrics["final_train_loss"]})
    print(f"adapter saved to {args.out}")
    return summary


if __name__ == "__main__":
    main()

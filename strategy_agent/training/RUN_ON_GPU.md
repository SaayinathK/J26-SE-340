# Running the fine-tuning on a GPU (Kaggle / Colab / a 24 GB card)

> **Easiest path: the Colab notebook** `strategy_agent/training/colab_finetune_mistral.ipynb`. Upload `strategy_agent_colab.zip` when it asks, then run the cells top to bottom:
> GPU check, install, dry run, QLoRA SFT of Mistral-7B-Instruct-v0.3 (saved to Google Drive, **resumes after a disconnect**), evaluation of the fine-tuned model in 4-bit against the
> template and the rule baseline, an optional DPO step (only if you have 50 or more real pairs), and download. The notebook is checked offline by `tests/test_colab_notebook.py`
> (valid JSON, parseable cells, every flag exists, library pins match the tested versions) but **was not run on Colab by its author**. The manual steps below are the same commands.

These scripts are **not needed for the local demo**: the service runs with the template generator or the small local model. Use this when you want the real
fine-tuned generator. **Status: the training code path has been executed on CPU with a tiny model (see `tests/test_training_smoke.py`); the 4-bit NF4 + CUDA run with a
real 7B model has not been run by the author, because there was no NVIDIA GPU.** Expect to debug environment issues on the first GPU run.

## What to pick

| Hardware | Base model | Notes |
|---|---|---|
| One 24 GB GPU (RTX 3090/4090, A5000, L4 24 GB ...) | `mistralai/Mistral-7B-Instruct-v0.3` (script default; public, no token needed) | the production target in the brief |
| Kaggle / Colab **T4 (16 GB)** | `Qwen/Qwen2.5-1.5B-Instruct` | a 7B model at 2048 tokens is very tight on 16 GB; use the 1.5B model, or Mistral with `--seq-len 1024 --grad-accum 32` and expect it to be slow |

## Steps

1. **Get the project onto the machine** (clone it, or upload the folder / a zip). Python 3.11 or newer, an NVIDIA GPU with a recent driver.
2. **Install**
   ```bash
   pip install -r requirements-gpu.txt          # torch, transformers, peft, trl>=1.0, bitsandbytes, datasets, accelerate (+ the core requirements)
   python -m spacy download en_core_web_sm      # only needed if you also run the privacy pipeline there
   ```
3. **Check the data against the model's own tokenizer (no GPU used)**
   ```bash
   python -m strategy_agent.training.sft_qlora --dry-run --base-model mistralai/Mistral-7B-Instruct-v0.3
   ```
   `examples_over_seq_len` must be 0 and `alignment.aligned` must be `true` for train and val. The real run **refuses to start** if the alignment fails (Mistral's chat template would otherwise
   drop the system message from the training sequences; the scripts fold it into the user turn).
4. **SFT**
   ```bash
   python -m strategy_agent.training.sft_qlora --data-dir data/strategy_sft/v1 --out outputs/sft_adapter
   ```
   Add `--resume` to continue after a disconnect (it picks up the newest `checkpoint-N` in `--out`; keep `--out` on persistent storage).
   Defaults: 3 epochs, lr 2e-4, batch 1 x grad-accum 16, LoRA r=16/alpha=32/dropout 0.05. Check `outputs/sft_adapter/training_card.json`: `final_train_loss` should be well below the
   starting loss printed in the first log lines. The output folder holds the **adapter only**.
5. **Collect preference pairs.** Pairs are built from real feedback and outcomes, per tenant. Export them:
   ```python
   from strategy_agent.learning.preference import export_pairs_jsonl
   export_pairs_jsonl(repo, "pairs.jsonl")      # repo = TenantStore(...).scoped(TenantContext(tenant_id, "u", ("tenant_admin",)))
   ```
   You need roughly 50 or more pairs; the script warns below that. Pooling several tenants' pairs requires their consent.
6. **DPO** (needs `trl >= 1.0`)
   ```bash
   python -m strategy_agent.training.dpo --sft-adapter outputs/sft_adapter --pairs pairs.jsonl --out outputs/dpo_adapter
   ```
   The reference policy is the SFT model (TRL keeps a frozen copy of the adapter's starting weights). The first logged loss should be about 0.693 (ln 2) with rewards near zero.
7. **Bring the adapter back and evaluate it** (on the machine with the pipeline; CPU is fine for a small subset):
   ```bash
   python -m strategy_agent.eval.run --model mistral --adapter outputs/dpo_adapter --load-4bit --llm-briefs 6     # --load-4bit on a 16 GB GPU
   ```
   The report then compares **fine-tuned vs template vs rule baseline**, and shows how often the model fell back to the template. To serve it:
   `LLM_MODEL_NAME=mistralai/Mistral-7B-Instruct-v0.3 ADAPTER_PATH=outputs/dpo_adapter ADAPTER_ID=dpo-v1 LLM_LOAD_4BIT=true uvicorn strategy_agent.api.main:create_app --factory`.

## Troubleshooting

| Symptom | Try |
|---|---|
| CUDA out of memory | `--seq-len 1024`, `--grad-accum 32`, a smaller base model; close other GPU processes |
| `completion_only_loss` / `refusing to train` error | the installed `trl` is too old: `pip install -U "trl>=1.0"` (the scripts stop instead of silently training something different) |
| `bitsandbytes` import or CUDA setup errors | match the CUDA toolkit to the `bitsandbytes` build; on Apple Silicon 4-bit does not run (use `--no-quantize` only for smoke tests) |
| Loss stays near the random-model value | check `--dry-run` first; confirm the adapter actually trained (`training_card.json`) |
| A TRL warning *"The tokenized prompt is not a prefix of the tokenized prompt+completion"* | **stop the run**: the training sequences are misaligned. The scripts now refuse to start in this state; if you see it, you are on an old copy of the project |
| `RuntimeError: gemm input type BFloat16 and output type float is only supported for CUDA devices with compute capability 8.0 or higher` at step 0 (T4 / V100) | you are on an old copy: a T4 reports bf16 as "supported" through emulation, but TRL's loss kernel needs real bf16 hardware (compute capability 8.0+). The scripts now pick fp16 on such GPUs (`strategy_agent/gpu.py`) and print the capability they saw |
| `NotImplementedError: "_amp_foreach_non_finite_check_and_unscale_cuda" not implemented for 'BFloat16'` after the first optimiser step (T4 / V100) | TRL's `SFTTrainer` casts the adapter of a 4-bit model to bf16, but fp16 training needs fp32 adapter weights. The scripts now cast them back (`keep_trainable_in_fp32`) and print `fp16 training: kept N trainable adapter tensors in fp32`. If you do not see that line you are on an old copy |
| Mistral template error about roles | handled automatically (the system text is folded into the user turn); report it if you still see it |

Every run, including dry runs, is appended to `experiments/runs.jsonl` (`python -m strategy_agent.experiments`).

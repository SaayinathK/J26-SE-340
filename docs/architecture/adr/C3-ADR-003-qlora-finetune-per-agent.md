# C3-ADR-003 — Fine-tune Mistral 7B (QLoRA) for the Lead Intelligence agent; facts stay in RAG

**Date:** 14 Oct 2026 (results added 20 Oct 2026) · **Status:** Accepted · **Owner:** Shathursini J (C3)

## Context
The platform architecture has one agent per job (Strategy, Content, Lead Intelligence, Email) shared by
all tenants, a common context engine and a tenant-scoped RAG knowledge base. Base Mistral 7B with RAG
gave 100% grounded but 93.3% policy-consistent answers, and did not cite the follow-up policy (C3-13).

## Decision
- Fine-tune Mistral 7B Instruct v0.3 with **QLoRA** (4-bit nf4 base, LoRA r=16, alpha 32, 2 epochs, lr 2e-4)
  on Google Colab (T4) for **behaviour**: JSON-only output, citing retrieved S-labels including the policy,
  following the segment policy.
- **Facts are not trained in.** Tenant data still comes from RAG at answer time, so one shared agent model
  serves all tenants without leaking one tenant's data to another.
- Training data (`finetune_data.py`): 360 examples (324 train / 36 validation) from train-split leads of all
  3 tenants; the 30 `rag_eval.py` leads are excluded. Mixing tenants teaches "follow the policy in the context",
  not one tenant's rule. In production only opted-in tenants would contribute training data (supervisor feedback, 9 Aug 2026).
- Deployment: see C3-ADR-005 (adapter merged into a GGUF model for Ollama).

## Results
| Check | Base | Fine-tuned | Where |
| --- | --- | --- | --- |
| Cites the policy source (30 validation prompts) | 0% | 100% | Colab, `reports/c3-14_finetune_eval.csv` |
| Policy-consistent action (30 held-out leads) | 93.3% | 100% | Ollama, `reports/c3-13_rag_eval_summary*.json` |
| Grounded / model cites own sources | 100% / 100% | 100% / 100% | same |
| Sources per answer | 2.0 | 3.0 | same |
| Same answer on repeat | 2 of 3 | 3 of 3 | same |

Training loss 1.15 → 0.020, validation loss 0.037 → 0.020.

## Consequences
- Every recommendation now follows and cites the tenant's policy, which makes it traceable to the business rule.
- Gold answers are rule-based templates, so messages are more consistent but less varied than the base model's.
- 30 leads is a small test set (28 vs 30 policy-consistent). Generation took 77 s median vs 134 s for the base on a
  laptop CPU, but laptop load was not controlled between the two runs, so no speed claim is made.

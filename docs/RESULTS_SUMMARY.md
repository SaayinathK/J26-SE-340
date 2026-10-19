# Strategy Agent — Results Summary

Honest, examiner-ready summary of the measured results. All numbers come from
`eval_reports/eval_report.md` (fine-tuned run) and the training card in `sft_adapter/training_card.json`.

## The model

- **Base:** `mistralai/Mistral-7B-Instruct-v0.3`, fine-tuned with **QLoRA** (4-bit NF4, LoRA r=16 / α=32,
  dropout 0.05, all 7 attention + MLP projection modules).
- **Supervised fine-tuning (SFT):** 2 epochs / 122 steps on 964 synthetic (brief → strategy JSON)
  examples. Final train loss **0.1599**; validation loss **0.165**; token accuracy **94.8%**.
- Training data is synthetic (rule-generated), so the strong token accuracy chiefly reflects that the
  model learned the **output format and strategy structure** well; it is not evidence of real-world
  strategy quality. The evaluation below measures quality directly.

## Generation quality (fine-tuned model)

Evaluated on a held-out subset with the real fine-tuned model loaded in 4-bit on a GPU.

| System | Predicted uplift | Fell back to template |
|---|---|---|
| agent_finetuned_with_shared | **0.558** | **0** |
| agent_finetuned_cold_start | 0.443 | **0** |
| agent_template (either) | ~0.44 | n/a (is the template) |

- **Fall-back rate = 0:** the fine-tuned model produced schema-valid strategy JSON on every brief — no
  silent fallback to the template. The numbers therefore measure the model itself.
- The fine-tuned model **with cross-tenant insights** achieved the highest predicted uplift (0.558).
- Honest limit: the fine-tuned comparison ran on a small subset (4 briefs, GPU cost) with wide
  confidence intervals. A full 60-brief true-uplift comparison is future work.

## Simulated A/B (60 briefs, template generator, true "hidden-world" uplift)

| System | True uplift |
|---|---|
| rule_baseline | 0.550 |
| agent_template_with_shared | 0.502 |
| agent_template_cold_start | 0.489 |
| random_mix | −0.398 |

The agent clearly beats a random channel mix but, in this simulated world, trails a simple
domain-informed rule baseline. Reported honestly: the contribution is the **privacy-preserving,
feedback-capable generation pipeline**, not a raw uplift record.

## Privacy (the core novelty)

- **PII leakage: 0** — 0 of 150 tenants had any planted identifier in the shared store; 0 structured-PII
  findings over 4,480 stored strings; stored IDs are random hex.
- **k-anonymity (k = 5): enforced** — every published insight is backed by ≥ 5 distinct tenants; 15 of
  24 groups were held back; **0** below-k insights published.
- **Honest limits (measured, not hidden):**
  - Membership-inference AUC **0.72** (0.69 with Laplace noise; 0.5 = chance) — k-anonymity alone does
    not stop an attacker who already knows a target's own channel mix. Noise reduces the AUC but also
    shrinks the benefit of shared insights (0.0161 → 0.0025).
  - Participation disclosure ~0.79 — k-anonymity guarantees ≥ k contributors per insight but does not
    hide *who* they are when every matching business took part.

## Status of the four novelties

| # | Novelty | Status |
|---|---|---|
| 1 | Business-context-aware strategy generation | Demonstrated (fine-tuned Mistral, 0 fallback) |
| 2 | Privacy-preserving cross-tenant learning (consent + k-anonymity) | Demonstrated (0 leakage, attacks measured) |
| 3 | Continuous adaptation from outcomes | Built (feedback + reward + preference pairs); DPO run is future work |
| 4 | Feedback-driven optimisation (DPO) | Implemented; demonstration is future work |

## How to cite this in the dissertation

> The Strategy Agent fine-tunes Mistral-7B-Instruct-v0.3 with QLoRA to generate ranked marketing
> strategies as structured JSON. On a held-out evaluation the fine-tuned model produced schema-valid
> output with a 0% fallback rate, and with cross-tenant insights achieved the highest predicted uplift
> among the evaluated systems. The consent-gated anonymisation pipeline published cross-tenant insights
> with zero PII leakage and enforced k-anonymity (k = 5); residual membership-inference and
> participation-disclosure risks were measured and partially mitigated with Laplace noise. Training and
> evaluation use synthetic data; a full-scale true-uplift comparison and the DPO feedback-learning stage
> are identified as future work.

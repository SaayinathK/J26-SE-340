# Dataset card: strategy_sft v1

Synthetic instruction data for supervised fine-tuning of the Strategy Agent generator: *business brief -> ranked strategies as JSON*.

- **Generated:** 2026-10-22T08:34:26+00:00 to 2026-10-22T08:35:06+00:00 (seed 42); synthetic data: there is no real-world collection period
- **Sources:** rule-based TemplateGenerator (labels); synthetic business briefs sampled from fixed industry / audience / region / constraint tables
- **Examples:** 1200 (435 include synthetic evidence sections)
- **Format:** prompt/completion (TRL conversational)
- **Length (real tokenizers):** mistralai/Mistral-7B-Instruct-v0.3: max 1999, mean 1435.6, Qwen/Qwen2.5-1.5B-Instruct: max 1783, mean 1275.0; limit 2000 tokens.
- **Label source:** rule-based TemplateGenerator (deterministic teacher). NOT human- or LLM-written.
- **Validation:** every completion passes JSON-schema + pydantic + constraint-compliance validation; duplicates removed by prompt hash; every example fits the training sequence length under each tokenizer listed
- **Schema fingerprint:** `8859208eeda7b148`
- **Personal data:** none. Everything is synthetic.

| Split | Examples |
|---|---|
| train | 964 |
| val | 119 |
| test | 117 |

Splits are assigned by a hash of the prompt, so the same brief can never appear in two splits.

## Coverage
- Objectives: {'awareness': 346, 'sales': 288, 'lead_gen': 243, 'retention': 323}
- Business models: {'B2B': 606, 'B2C': 594}
- Industries: 18 (SaaS, automotive, beauty salon, consulting, education, fashion e-commerce, fintech, fitness studio, healthcare clinic, logistics, manufacturing, nonprofit, real estate, restaurant, retail, tea exporter, telecom, travel agency)

## Limitations (read before using)
- The labels come from a rule-based generator, so a model trained on this learns **format, schema and constraint adherence**, not real marketing insight.
  Real quality gains are meant to come from preference optimisation (DPO) on real tenant feedback.
- Channel mixes follow fixed rule tables plus random synthetic evidence; they are plausible, not empirically validated.

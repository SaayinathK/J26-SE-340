# Strategy Agent: architecture, novelties, substitutions and results

> Research prototype of one component of a multi-tenant AI Marketing SaaS (J26-SE-340). It turns a business brief into ranked,
> structured marketing strategies, learns from real campaign outcomes, and lets tenants who **opt in** share anonymised insights
> with others. It runs on a laptop CPU with no API key. Everything marked **real** below is implemented and tested; everything
> marked **stand-in** is a deliberate, documented substitute for production infrastructure (section 3).

## 1. What it does

```
 brief ──► POST /v1/strategy/generate ──► tenant RAG + shared-insight RAG ──► prompt ──► generator (LLM or template)
                                                                                         │ parse → validate → retry once → fallback
                                          persist (model_version, adapter_id,   ◄── rank ◄┘
                                           evidence ids, prompt_hash, score breakdown)

 feedback / outcome ──► reward ──► preference pairs (DPO)        ┐
 completed campaign ──► consent check ► PII removal ► de-identify ► generalise ► k-anonymity gate ► aggregate (+noise)
                                                        ► validate ► SHARED STORE ──► read-only insights ──► other tenants' RAG
 revocation ──► delete every contribution via the tenant-side ledger ──► rebuild insights
```

The code is one package, `strategy_agent/`, separate from the older `fl_marketing/` package (which it neither imports nor modifies).

## 2. The four novelties and where they live

| # | Novelty | Code | How it is checked |
|---|---|---|---|
| 1 | Business-context-aware strategy generation (LLM to structured JSON) | `generation/` (`prompt.py`, `generator.py`, `rag.py`, `ranking.py`, `service.py`) | schema/constraint validity rates; simulated A/B; quality rubric (`eval/`) |
| 2 | **Privacy-preserving, consent-gated cross-tenant learning** (the core) | `privacy/` (`consent.py`, `anonymizer.py`, `k_anonymity.py`, `pipeline.py`), `db/shared_store.py` | 3 required privacy tests + negative controls; PII scan; k audit; two re-identification attacks; k / noise sweep |
| 3 | Continuous adaptation from campaign outcomes | `learning/feedback.py`, `learning/service.py`; outcomes become campaigns that feed RAG and the sharing pipeline | `tests/test_learning.py`; outcome-to-insight loop test |
| 4 | Strategy optimisation through feedback learning | `learning/preference.py` (pairs), `training/dpo.py` (GPU) | pair-building tests; DPO **dry run** on exported pairs (training itself not executed here) |

## 3. Production design versus this prototype (every substitution)

| Production spec | This prototype | Real or stand-in |
|---|---|---|
| Fine-tuned **Mistral 7B** (QLoRA) served by vLLM | `LLMGenerator` loads any local causal chat model (default **Qwen2.5-1.5B-Instruct**, CPU, greedy) and, optionally, a LoRA adapter (`ADAPTER_PATH`), behind the same `Generator` interface; `TemplateGenerator` (deterministic rules) is the always-available fallback. Mistral is supported by setting `LLM_MODEL_NAME` and uses the `[INST]` prompt format. | **Stand-in**. Only the generator is swapped; prompt, validation, ranking, privacy and learning are unchanged. |
| DPO fine-tuning | Real feedback to reward to **preference pairs**, exported in TRL conversational format; `training/dpo.py` | Pairs: **real**. Training code: **executed on CPU with a tiny model** (see section 10). The 4-bit GPU run: **not executed**. |
| QLoRA SFT | `training/sft_qlora.py` | Same status as DPO |
| vLLM multi-LoRA serving | one in-process generator | **Stand-in** |
| **MLflow** | `strategy_agent/experiments.py`: an append-only JSONL **experiment log** (`experiments/runs.jsonl`) of every evaluation, dataset build and training run with parameters, headline metrics, artifacts and status | **Stand-in** |
| Prefect | plain scheduled command: `python -m strategy_agent.privacy.pipeline --batch` | **Stand-in** |
| Postgres row-level security | SQLite where every row carries `tenant_id` and the repository injects the filter into every query | **Stand-in** |
| Qdrant | `bge-small-en-v1.5` embeddings (downloaded and working) with a TF-IDF fallback | **Stand-in** |
| Redis / Celery | none needed (synchronous) | **Stand-in** |
| Presidio + k-anonymity anonymisation | Presidio + spaCy `en_core_web_sm` + a regex layer + the tenant's own brand/product/competitor names, closed-vocabulary validation, k-anonymity gate, optional Laplace noise | **Real** (CPU) |
| Simulated A/B (GBM) | `GradientBoostingRegressor` learned from a synthetic marketing "world" (`eval/simulator.py`) | **Real method, synthetic world** (see section 8) |

Small deviations from the brief (all in the interest of safety or testability): `n_strategies` and optional name lists were added to the request;
the generator interface takes a `PromptBundle` (prompt text plus the structured request, which the template generator needs) instead of a bare string;
the shared store keeps a random per-tenant `contributor_token` so k-anonymity can count *distinct* tenants; only ratio metrics (CTR, CPL, ROI, conversion rate, **uplift**)
are ever shared, never spend or impressions; a closed channel vocabulary turns custom channel names into `other_channel`. `rating` on feedback and every field of an
outcome are **required**, as the brief lists them.

## 4. API

| Endpoint | Auth | Notes |
|---|---|---|
| `POST /v1/strategy/generate` | any tenant user | body has no tenant id; 422 if the constraints leave no feasible channel |
| `POST /v1/strategy/{id}/feedback` | any tenant user | decision accepted / rejected / edited, rating 1-5, comment; 404 for another tenant's id |
| `POST /v1/strategy/{id}/outcome` | any tenant user | CTR / CPL / conversion / ROI / spend; computes uplift vs the tenant's own baseline |
| `GET`/`PUT /v1/strategy/sharing/consent` | **`tenant_admin` only** | scopes: channel_mix, budget_split, timeline, messaging_angles, outcome_metrics |
| `GET /v1/strategy/shared-insights` | any tenant user | anonymised, aggregated, k-gated; filters `industry_bucket`, `objective`, `region` |
| `GET /health` | none | |

Auth: a JWT (`tenant_id`, `sub`, `roles` claims), or in dev only the `X-Dev-Tenant` / `X-Dev-Roles` headers. **Any `tenant_id` in a body or query string is refused with 400.**

## 5. Privacy design

**Threat model.** (a) A tenant reading another tenant's data; (b) identifying or private data reaching the shared store or the insights API;
(c) an attacker linking a published insight back to a tenant.

**Tenant isolation.** `TenantRepo` is built from the authenticated context and has no method that takes a tenant id. Selects, updates and deletes are
assembled by helpers that append `tenant_id = ?`; inserts force it. A test asserts no repository method has a `tenant_id` parameter.

**The pipeline** (`privacy/pipeline.py`): consent and scope check, PII removal (Presidio, regex and tenant names), opaque contribution id with the only
tenant-to-contribution link held in the tenant's **own** DB (the ledger), generalisation (industry bucket, region, budget band, quarter, abstract
messaging angle from a fixed list), a **closed-vocabulary check** on every stored field, a second PII scan, the k-anonymity gate, aggregation with optional
Laplace noise, write to a separate shared database that only this pipeline can write (the API gets a read-only reader).

**Consent semantics.** Opting in needs at least one scope. Opting out deletes every contribution of the tenant and rebuilds the insights. *Narrowing* the
scopes also purges what was shared under the broader consent. Re-opting in rotates the tenant's contributor token.

**What the evidence shows** (run: seed 42, 150 synthetic tenants, 118 consenting, k = 5; full report in `eval_reports/eval_report.html`):

| Check | Result |
|---|---|
| Planted identifiers (business, brand, product, competitor, person, email, phone, URL, tenant id, exact budget) found in the shared store | **0 of 150 tenants** |
| Presidio + regex findings over 4,480 stored strings | **0** |
| Every published insight backed by at least k distinct tenants; groups below k published | **yes; 0** (15 of 24 groups held back) |
| Revocation removes all of a tenant's contributions; insight disappears when support falls below k | **yes** (tested) |
| Attack B, aggregate membership inference (worst case: attacker knows the target's own channel mix), AUC | **0.72** at k = 5 with no noise; **0.69** with Laplace noise (epsilon 1.0 per aggregate); 0.5 is chance. A different noise draw gave 0.64: these estimates move by about 0.05 with the noise alone. |
| Cost of that noise: benefit of shared insights for a cold-start business | **0.045 to 0.025** predicted-uplift points (another noise draw: 0.014) |

**Known limitations (please state them).**
1. **k-anonymity alone does not stop membership inference by an attacker who already knows a target's own channel mix** (AUC 0.72 above). Larger k and noise reduce it, at a real cost in utility. The AUC estimates come from few insights, so differences below about 0.1 are noise.
2. **Participation disclosure.** An insight proves at least k businesses contributed; if every business matching its public attributes took part, an attacker who knows the list of businesses learns that each of them did (2 of 9 insights in the run).
3. **The NER model is small** (`en_core_web_sm`): it caught "Priya Fernando" in short sentences and missed it in a long one. This is why free text is never stored: only a value from a fixed angle list survives. Brand/competitor names are matched from the tenant's profile, not guessed.
4. **Laplace noise is per published aggregate**, with no accounting of composition across repeated publications.
5. The `contributor_token` is a random pseudonym stored in the shared contributions table (never published); it exists only to count distinct tenants.
6. Any authenticated tenant can read the shared insights, whether or not it contributes (a free-rider; see open decisions).
7. Authentication is a plain JWT check; there is no rate limiting, audit trail or key rotation.

## 6. Continuous learning

`reward = w_outcome * clip(uplift, -1, 1) + w_feedback * explicit_feedback` (weights 0.6 / 0.4 in config; a missing signal's weight is renormalised, not counted as zero).
`uplift` is relative improvement over the tenant's own historical baseline for the same objective (cost per lead: lower is better). The baseline excludes
campaigns the agent itself recommended, so the agent cannot raise its own bar. Preference pairs: an edit makes the edited version chosen and the original
rejected; accept/reject pair the decision against the best/worst other strategy; strong measured outcomes add reward-based pairs (only when an outcome exists).
Pairs are tenant data and stay in the tenant DB.

## 7. Generation and ranking

The prompt has business context, objective, constraints, the tenant's own evidence, cross-business evidence (clearly labelled as not from this business)
and the output schema. Brand and competitor names are not sent to the model. Output is parsed, checked against the JSON Schema and the Pydantic model, and
checked against the request's constraints; one retry on invalid output; then the deterministic template. A partial LLM answer is topped up from the template and
the response says so in `warnings`. `score = w1*confidence + w2*historical_uplift_similarity + w3*constraint_fit + w4*shared_insight_support` (config weights); the
breakdown is stored with each recommendation.

## 8. Evaluation (`python -m strategy_agent.eval.run --model template|qwen|mistral|llm|auto [--adapter PATH]`)

| Area | What is measured |
|---|---|
| Structural | JSON parse rate, schema validity, raw budget-sum correctness, constraint compliance (on the generator's **raw** output) |
| Quality | deterministic 1-5 rubric: relevance, specificity, feasibility, coherence (heuristic, not human or LLM judgement) |
| Simulated A/B | uplift of each system's top strategy over an even channel split, on a learned outcome model; paired tests with bootstrap CI and Wilcoxon p |
| Privacy | PII leakage, k audit, attack A, attack B, k x noise sweep with utility |
| Ablations | with vs without shared insights; template vs local LLM |

**Results (template generator; seed 42, 60 briefs).** The simulator itself: held-out R squared 0.86-0.88 per objective; predicted vs true uplift correlation 0.96.

| System | Mean predicted uplift | 95% CI |
|---|---|---|
| random mix | -0.29 | [-0.39, -0.20] |
| rule baseline (generic 3-channel mix) | **+0.47** | [0.42, 0.52] |
| agent, cold start (no history, no shared insights) | +0.39 | [0.36, 0.43] |
| agent, with shared insights | +0.44 | [0.39, 0.49] |

* The agent is far better than random (difference +0.69, wins 59 of 60) **but worse than the simple rule baseline** (difference -0.08, 95% CI [-0.10, -0.06], wins 10 of 60). The baseline puts its budget on the few channels the synthetic world rewards most, so it is a strong baseline *in this world*; the result says diversified mixes underperform concentration here and says nothing about real marketing. We did not tune the template or the world to hide this.
* **Cross-tenant insights help a business with no history:** +0.042 (95% CI [0.023, 0.062], Wilcoxon p = 0.0001, wins 44 / 16). Ranking is mildly useful: rank 1 beats the other strategies by +0.033 on average.
* Structural: the template scores 1.0 on every structural rate (it is deterministic); the quality rubric averages 4.54 of 5.

**How far to trust this.** The world is designed by us; the rubric is a heuristic; the attacks are simple. These results test the *pipeline* (can strategies be compared, does evidence help, does privacy hold against defined attacks). They are not evidence that the strategies work for real businesses.

**Not evaluated: the local LLM and the fine-tuned model.** Two items in the evaluation are reported as *not run*, and no claim is made about them:
(a) **template vs local LLM**: the Qwen weights (about 3 GB) are not on the development machine (the connection to the model host is very slow and kept dropping);
(b) **fine-tuned vs template vs baseline**: no adapter exists yet, because fine-tuning needs a GPU. The wiring is built and tested: `--model qwen --adapter outputs/sft_adapter`
adds an `agent_finetuned` system to the comparison. A test runs that exact path with a tiny model and an adapter trained by the real scripts. Because a model that cannot
write valid JSON silently falls back to the template, **every LLM system is reported with its fall-back rate**; a system that falls back often is measuring the template, not the model.
To run (a) once the weights are cached: `python -m strategy_agent.eval.run --model qwen --llm-briefs 6`; expect minutes per brief on a CPU.

## 9. Dataset (`data/strategy_sft/v1`)

1,200 synthetic examples (964 train / 119 val / 117 test), 18 industries, 4 objectives, B2B and B2C, 435 with synthetic evidence sections; every completion passes
schema and constraint validation; splits are by prompt hash so no brief appears twice. The card lists counts, sources, a date range (generation window, since the data is synthetic) and
the real-tokenizer lengths. **Every example fits 2,048 tokens under both tokenizers** (longest: 1,999 with Mistral-7B-Instruct-v0.3, 1,783 with Qwen2.5; the Mistral count includes the system text, see section 10).
*A bug this caught:* the first version filtered on a character-based estimate that suited Qwen; checking against the real Mistral tokenizer showed 3 training examples over 2,048 tokens.
The builder now measures with the real tokenizers (those available offline) and records which it used.
**Labels come from the rule-based generator**, so fine-tuning on this teaches the format, schema and constraint behaviour, not marketing insight. See `DATASET_CARD.md`.

## 10. Fine-tuning (QLoRA SFT and DPO) and Mistral: what exists and what has been run

**Production target:** Mistral-7B-Instruct-v0.3 (the scripts' default `--base-model`) on one 24 GB GPU, 4-bit NF4 + LoRA r=16 / alpha=32 / dropout 0.05 on the attention and MLP projections,
completion-only loss, sequence length 2048, 3 epochs, cosine schedule, gradient checkpointing, adapter-only save (`training/sft_qlora.py`); then DPO with beta 0.1 on the SFT adapter (`training/dpo.py`).
On a 16 GB Kaggle/Colab T4 use `--base-model Qwen/Qwen2.5-1.5B-Instruct`.

| Check | Status |
|---|---|
| Both scripts' data handling, length checks, **prompt/answer alignment check** and recipe printout (`--dry-run`) against the **real Mistral-7B-Instruct-v0.3 tokenizer** and the real dataset | **Run**: 0 of 1,083 examples over 2,048 tokens; 0 misaligned |
| **Mistral's chat template drops a system message once an assistant answer is present**, so training sequences lacked the instruction, TRL took only `<s>[INST]` as the prompt, and the loss covered the brief too | **Found by the first Colab run** (TRL's warning; reproduced locally: 200 of 200 examples misaligned). **Fixed** by folding the system text into the user turn (what Mistral's `[INST]` format does anyway); both scripts now **refuse to train** if the prompt is not a prefix of prompt+answer. Tested with the real tokenizer, a faithful fake, and a full-log check with a negative control. |
| The training code path itself (TRL `SFTTrainer` with completion-only loss, LoRA, optimiser steps, adapter save; `DPOTrainer` with the SFT adapter as policy and TRL's frozen `ref` copy as reference) | **Run on CPU** with a tiny random model, trl 1.16 / peft 0.21, in the test suite |
| A trained adapter loads through the pipeline's generator and joins the evaluation (`--adapter`) | **Run** (tiny model) |
| The DPO starting loss is ln 2 (policy equals reference) | **Observed**: 0.6931 |
| The same SFT and DPO code paths with a tiny Mistral-architecture model and Mistral's **real tokenizer and chat template** (completion-only masking, reference mechanism) | **Run on CPU**, in the test suite |
| A **Colab notebook** that runs SFT, evaluation in 4-bit and optional DPO, with Drive checkpointing and `--resume` | **Written and checked offline** (valid, parseable, every flag exists, pins match); **not run on Colab by its author** |
| **4-bit NF4 on a CUDA GPU, with the real 7B model** | **NOT run.** It needs an NVIDIA GPU; the development machine has none (and `bitsandbytes` 4-bit does not run on Apple Silicon). |
| Any trained Mistral adapter, or any measured effect of fine-tuning | **None exists.** No claim is made. |

Things this process found and fixed: **the Mistral system-message bug above, which the first real GPU run exposed and my earlier local checks missed (my log filter hid the TRL warning, and the dry run had no alignment check)**; the script originally passed `model_adapter_name` / `ref_adapter_name`, which trl 1.x no longer has, and a helper would have **silently dropped them**, training against the wrong
reference; the helper now refuses to drop critical arguments, and the script uses trl 1.x's mechanism. The newer `transformers` also changed what `apply_chat_template(return_tensors=...)` returns, which would have broken generation.

**To run it yourself** (the Colab notebook `training/colab_finetune_mistral.ipynb` does all of this; see also `training/RUN_ON_GPU.md`): install `requirements-gpu.txt`, accept nothing (Mistral-7B-Instruct-v0.3 is public), run the two commands, then `python -m strategy_agent.eval.run --model mistral --adapter outputs/dpo_adapter`.

## 11. Tests

226 tests (`pytest`, about two minutes): tenant isolation 6; auth and config 11; privacy 24; consent and insights API 7; generation 36; learning 20; dataset 8; experiment log 5;
modules (channels, read-only reader, chat/Mistral prompt, budget, provenance, demo) 8; evaluation 23; training scripts 7; **training smoke tests on CPU 7**; **brief compliance 41** (the brief's layout, endpoints and data-model fields); **Colab notebook 6**; resume 2; 4-bit availability 1; Mistral-tokenizer smoke 2; **Mistral system-message alignment regression 11** (detection, fold, guard, real tokenizers, full-log check with a negative control).
Privacy tests include **negative controls**: the leak checks are shown to fail when a leak is planted. The regression test for the leak matcher encodes the false positives hit
while building the evaluation (a budget matching the decimals of another number, or a segment of a random id).

## 12. Open decisions

1. Should reading shared insights require the reader to have opted in (reciprocity)? Today it does not.
2. Choose k and the noise level by the privacy/utility table above; the defaults (k = 5, noise off) favour utility.
3. Replace the single-use `contributor_token` scheme with a cryptographic counting protocol if the shared store is ever exposed beyond the pipeline.
4. Track the cumulative privacy budget across publications.
5. Wire the nightly job to a real scheduler and move SQLite to Postgres with row-level security.
6. Finish the Qwen download and evaluate it; run the QLoRA SFT and DPO on a GPU (`training/RUN_ON_GPU.md`) and re-run the evaluation with `--model mistral --adapter ...`.

## 13. Honesty notes

* The prototype uses a small local LLM (not yet evaluated here) and a template fallback; production fine-tunes Mistral 7B via QLoRA. The generator is pluggable, so only the model swaps.
* The privacy pipeline, ranking, feedback/reward loop and evaluation are **real code with real tests**, not simulations. The marketing world used to score strategies **is** simulated.
* Small-model generation quality is expected to be below Mistral 7B; the pipeline and the privacy properties are independent of model size.

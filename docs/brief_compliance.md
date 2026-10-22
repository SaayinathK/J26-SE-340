# Compliance with the build brief (`STRATEGY_AGENT_BUILD_PROMPT.md`), clause by clause

Status words: **Done** (implemented and tested) | **Done, noted** (implemented, with a deviation or limit stated) | **Verified on CPU only** | **Not done** (with the reason).
`tests/test_brief_compliance.py` checks the layout (section 4), data-model fields (5), API surface (7) and settings (6.1) mechanically; everything else is evidenced by the tests named below.

## What cannot be completed on the development machine, and why

| Item | Why | What exists instead / how to finish |
|---|---|---|
| **Actual QLoRA fine-tuning of Mistral 7B** (SFT then DPO), and therefore a *fine-tuned* system in the evaluation | No NVIDIA GPU (a MacBook; `bitsandbytes` 4-bit does not run on Apple Silicon). The brief itself says these run on Kaggle/Colab and are "not required for the local demo". | The scripts are written, their data handling is checked against the **real Mistral tokenizer**, and their training code path is **executed on CPU** (tiny models incl. a Mistral-architecture one with Mistral's real tokenizer; TRL 1.16 + PEFT 0.21). A **Colab notebook** (`strategy_agent/training/colab_finetune_mistral.ipynb`, with Drive checkpointing and `--resume`) runs SFT, 4-bit evaluation and optional DPO; it is checked offline but **not run on Colab by its author**. See `RUN_ON_GPU.md`. |
| **Real Qwen2.5-1.5B-Instruct output** (quality and JSON validity of the real model) and the **template vs local-LLM ablation** | The 3 GB weights are still downloading at about 200 KB/s (a few hours left). Embeddings (`bge-small`) did download and are in use. | The generator class is complete and tested with a tiny model (load, adapter merge, generate, fall back). The report says "not run". Finish with the download command in `README_strategy_agent.md`, then `python -m strategy_agent.eval.run --model qwen`. |

Everything else in the brief is implemented. The three evaluation rows that depend on the two items above are reported as *not run*; no claim is made about them.

## Section 0 and 1: the four novelties and the substitution table
| Clause | Where | Evidence | Status |
|---|---|---|---|
| 1 Business-context-aware strategy generation (LLM to structured JSON) | `generation/` | `test_generation.py` (36) | Done, noted: template generator evaluated; real Qwen not (see above) |
| 2 Privacy-preserving cross-tenant learning, consent-gated | `privacy/`, `db/shared_store.py` | `test_privacy.py` (24), `test_api_consent.py`, eval privacy suite | Done |
| 3 Continuous adaptation from outcomes | `learning/service.py`, `learning/feedback.py` | `test_learning.py` (20) | Done |
| 4 Strategy optimisation by feedback learning | `learning/preference.py`, `training/dpo.py` | pair tests; DPO CPU smoke test | Done (pairs real; GPU training not run) |
| Pluggable LLM generator + template fallback | `generation/generator.py` | `test_generation.py`, `test_training_smoke.py` | Done, noted |
| DPO: feedback to reward to pair builder; GPU script | `learning/`, `training/dpo.py` | as above | Done |
| SQLite with tenant scoping **+ lightweight local experiment log** | `db/`, `experiments.py` | `test_tenant_isolation.py`, `test_experiments.py` | Done |
| Plain scheduled scripts instead of orchestration | `python -m strategy_agent.privacy.pipeline --batch` | `test_privacy.py` | Done |
| Presidio + k-anonymity, built for real | `privacy/anonymizer.py`, `k_anonymity.py` | privacy tests | Done |
| Simulated A/B with scikit-learn | `eval/simulator.py`, `eval/compare.py` | `test_eval.py` | Done (the simulated world is synthetic) |
| Real, runnable GPU scripts for QLoRA SFT/DPO | `training/` | `test_training.py`, `test_training_smoke.py` | Done on CPU; 4-bit GPU run **not executed** |

## Section 2: working rules
| Rule | Status |
|---|---|
| Work in phases; summary and tests at the end of each | Done (phases 0 to 6, each ending with a green suite) |
| No hard-coded secrets or config; `.env` + typed Pydantic settings | Done: `config.py`, `.env.example`; the app refuses dev auth or the default secret outside dev |
| Every data-access path tenant-scoped; tenant id from the token, never the body | Done: no repo method takes a tenant id; any `tenant_id` in a body or query string is refused (400) |
| Type hints, docstrings, pytest for every module | Done, noted: every module in the layout is named in a test (`test_brief_compliance.py`); type hints and docstrings throughout, not machine-checked |
| Simple, explainable designs | Done |
| Separate top-level package; `fl_marketing/` untouched | Done: `strategy_agent/` lives in its own project folder and does not import or modify `fl_marketing` |

## Section 3: stack
| Item | Status |
|---|---|
| Python 3.11+, FastAPI, Pydantic v2 | Done (3.11.15) |
| `transformers` + `torch` (CPU) running Qwen2.5-1.5B-Instruct; template fallback | Done, noted (weights not yet local) |
| Presidio + spaCy `en_core_web_sm` + custom brand/business/competitor recognisers; regex fallback | Done |
| SQLite: one tenant DB + one separate shared DB, repository layer filters by tenant | Done |
| `bge-small-en-v1.5` embeddings else TF-IDF | Done (both work; embeddings downloaded and verified) |
| scikit-learn GBM for the simulator | Done |
| `peft`, `bitsandbytes`, `trl` (`SFTTrainer`, `DPOTrainer`) | Done: `requirements-gpu.txt`; `peft`/`trl` installed and exercised; `bitsandbytes` GPU-only |
| `pydantic-settings` + `.env`; `jsonschema` | Done |
| `requirements.txt` and a make/README run guide | Done (`requirements*.txt`, `requirements-lock.txt`, `Makefile`, `README_strategy_agent.md`) |

## Section 4: repository layout
Every file in the brief's tree exists (41 checks in `test_brief_compliance.py`). The brief's `eval/simulator.py` is the simulator module (it also holds the synthetic world it learns from). Additions beyond the brief: `channels.py`, `experiments.py`, `gpu.py`, `demo.py`, `generation/chat.py`, `generation/service.py`, `learning/service.py`, `eval/{compare,population,fixtures,quality,structural,report}.py`, `training/{common.py,RUN_ON_GPU.md}`, `api/deps.py`.

## Section 5: data models
| Model | Status |
|---|---|
| `BusinessProfile`, `Objective`, `Constraints` with the listed fields | Done (+ optional name lists used by the PII recognisers) |
| `GenerateRequest`: no `tenant_id`; `use_shared_insights: bool = True` | Done (+ `n_strategies`); unknown fields are rejected |
| `Strategy`: the exact schema; shares sum to about 1.0; no blocked channels; within budget | Done: exact field set tested; blocked channels and **implied spend vs budget/cap** checked in `compliance_violations` |
| `ConsentSettings` with the listed fields and scopes | Done |
| `SharedInsight`: `contribution_id` (opaque) and the listed fields; never a tenant id | Done (+ `support_count`, `angle`, `summary`) |
| `FeedbackRequest`: decision, `edited_version?`, rating 1 to 5, comment | Done: `rating` is **required**, as listed |
| `OutcomeRequest`: impressions, ctr, cpl, conversion_rate, roi, spend, period | Done: **all required**, as listed |

## Section 6: component specs
| Spec | Where / evidence | Status |
|---|---|---|
| 6.1 Typed settings (model name, k default 5, ranking and reward weights, paths); JWT or `X-Dev-Tenant` / `X-Dev-Roles` to `TenantContext`; reject any body carrying a `tenant_id` | `config.py`, `auth.py`; `test_auth_and_config.py` | Done |
| 6.2 Tenant-scoped storage; test that a tenant cannot read another's rows | `db/tenant_store.py`; `test_tenant_isolation.py` | Done |
| 6.3 `Generator` interface; `LLMGenerator` loads the model once, Mistral-style chat prompt, JSON, validate, retry once, fall back; never crash | `generation/generator.py`, `prompt.py` (`[INST]` builder; `chat.py` folds the system text into the user turn where a template would otherwise drop it, which Mistral's does), `service.py` | Done, noted: the interface takes a `PromptBundle`; parse/validate/retry/fall-back run in `StrategyService` around the generator, not inside the class |
| 6.4 `/generate`: tenant context, RAG (tenant + shared, filtered by industry bucket and objective, read-only), prompt sections, N strategies, ranking `w1..w4` (weights in config, logged), persist with `recommendation_id`, `model_version`, `adapter_id`, evidence ids, `prompt_hash` | `generation/service.py`, `ranking.py`, `rag.py`; `test_generation.py` | Done (score breakdown is stored with each recommendation) |
| 6.5 Consent: GET/PUT, `tenant_admin` only; revocation deletes contributions via the ledger | `privacy/consent.py`; `test_api_consent.py`, `test_privacy.py` | Done |
| 6.6 Pipeline steps 1 to 8 (consent, PII removal, de-identification with a tenant-side ledger, generalisation, k-gate, aggregation + optional Laplace, validation, shared store) | `privacy/pipeline.py`; **the three required privacy tests** plus negative controls | Done, noted: validation uses a **closed-vocabulary check plus a structured-PII re-scan** (names/locations by NER fire on harmless vocabulary words); aggregates now include **median uplift** |
| 6.7 Feedback and outcome endpoints; reward formula; preference pairs (edit = edited chosen, original rejected); DPO step in `training/dpo.py` | `learning/`; `test_learning.py` | Done |
| 6.8 Eval CLI with `--model <alias>`; structural; quality rubric; simulated A/B (mean, CI, significance) for **fine-tuned vs template vs rule baseline**; privacy eval incl. re-identification attack; ablations (shared vs not; template vs local LLM); HTML/Markdown report | `eval/run.py`; `eval_reports/` | Done, noted: **fine-tuned and local-LLM rows are "not run"** (see the table at the top); template, baseline and shared-insights ablation are complete |
| 6.9 Synthetic dataset, schema-validated, de-duplicated, versioned JSONL with a dataset card (counts, sources, date range) | `data/seed_generator.py`; `data/strategy_sft/v1/` | Done (length-checked with the real Mistral and Qwen tokenizers) |
| 6.10 `sft_qlora.py` (4-bit NF4, LoRA r16/a32/d0.05 on attention + MLP, completion-only loss, seq 2048, 2 to 3 epochs, cosine, gradient checkpointing, adapter only); `dpo.py` (beta about 0.1 on the SFT adapter); documented as Kaggle/Colab | `training/` | Done on CPU; **4-bit GPU run not executed** |

## Section 7: API surface
All seven operations exist and nothing else (`test_the_api_surface_is_exactly_the_briefs`). Done.

## Section 8: phase plan
Phases 0 to 6 completed in order; each ended with passing tests. Done.

## Section 9: definition of done
| Item | Status |
|---|---|
| All endpoints run locally with the small model **or** the template fallback; never crash on bad JSON | Done (template; the small-model path is tested with a tiny model and always falls back safely) |
| Privacy tests prove: no tenant id / brand / email / phone / exact budget survives; k blocks small groups; revocation removes contributions; shared-store re-scan is clean | Done (`test_privacy.py`; evaluation: 0 of 150 tenants leaked) |
| `python -m strategy_agent.eval.run` produces a report with structural, quality, simulated A/B and privacy metrics | Done |
| Tenant isolation everywhere; tenant id from the token | Done |
| GPU SFT/DPO scripts present and documented | Done (`RUN_ON_GPU.md`) |
| `docs/strategy_agent.md`: architecture, four novelties, **every substitution**, honestly | Done |
| `requirements.txt`, `.env.example`, README run guide | Done |
| **Small, logical commits**; `fl_marketing/` untouched | Done, noted: the git history was **created at the end** from the finished tree, grouped by area, so early commits are not each independently runnable. `fl_marketing/` is not part of this repository. |

## Section 10: honesty notes
Stated in `docs/strategy_agent.md` (sections 3, 8, 10 and 13): small local LLM versus production Mistral 7B, the pluggable generator, which parts are real and which simulated, and that small-model quality is expected to be lower while the pipeline and privacy properties do not depend on model size.

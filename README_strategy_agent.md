# Strategy Agent: run guide

A research-prototype service that turns a business brief into ranked marketing strategies, learns from real outcomes, and supports consent-gated, anonymised cross-tenant learning.
Full design, results and limitations: [docs/strategy_agent.md](docs/strategy_agent.md). Clause-by-clause status against the build brief, including what cannot be done on a machine without a GPU:
[docs/brief_compliance.md](docs/brief_compliance.md).

## Setup (Python 3.11 or newer; no GPU, no API key)

```bash
cd strategy-agent
python3.11 -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt                    # core: runs everything with the template generator
python -m spacy download en_core_web_sm            # the PII detector's language model
cp .env.example .env                               # optional; defaults work for local use
```
`requirements-lock.txt` is the exact environment this was built and tested in. Optional extras: `requirements-llm.txt` (local Qwen LLM + embedding retriever) and
`requirements-gpu.txt` (training scripts).

## See it work in 30 seconds

```bash
python -m strategy_agent.demo          # consent, sharing, k-gating, generation, feedback, outcome, revocation (temporary DBs)
pytest                                 # about 210 tests, roughly two minutes
```

## Run the API

```bash
uvicorn strategy_agent.api.main:create_app --factory --port 8100
# docs: http://127.0.0.1:8100/docs
```
In dev you can skip JWTs with headers: `X-Dev-Tenant: acme`, `X-Dev-Roles: tenant_admin`.

## Web UI

With the API running, open **http://127.0.0.1:8100/** in a browser. The UI is served by the API
itself (same origin, no build step) and covers the whole flow: enter a business brief and generate
ranked strategies (budget allocation, segments, messaging, timeline, KPIs, rationale, confidence),
give feedback / report outcomes (which create preference pairs for learning), set cross-tenant
sharing consent, and browse the anonymised shared insights. Set the tenant / role in the top-right;
the generator in use (template or LLM) is shown in the status pill. Source: `strategy_agent/ui/index.html`.

```bash
curl -s localhost:8100/v1/strategy/generate -H 'X-Dev-Tenant: acme' -H 'X-Dev-Roles: tenant_admin' -H 'Content-Type: application/json' -d '{
  "business_profile": {"industry": "retail", "business_model": "B2C", "target_audience": "young professionals",
                       "region": "Colombo, Sri Lanka", "brand_tone": "friendly", "monthly_budget": 5000},
  "objective": {"type": "sales", "target_kpi": "roi", "target_value": 2.5, "time_horizon": "8 weeks"},
  "constraints": {"channels_blocked": ["sms"]}}'

# opt in to sharing (tenant_admin only), then give feedback / outcomes using the recommendation_id from the response
curl -s -X PUT localhost:8100/v1/strategy/sharing/consent -H 'X-Dev-Tenant: acme' -H 'X-Dev-Roles: tenant_admin' -H 'Content-Type: application/json' \
  -d '{"opted_in": true, "scopes": ["channel_mix", "outcome_metrics"]}'
```
For real tokens set `ALLOW_DEV_AUTH=false` and a long `JWT_SECRET`, and send `Authorization: Bearer <JWT with tenant_id, sub, roles>`.
Outside `APP_ENV=dev` the app refuses to start with dev auth on or the default secret.

## Nightly sharing job

```bash
python -m strategy_agent.privacy.pipeline --batch     # share pending campaigns of opted-in tenants, then rebuild the published insights
```

## Evaluation report

```bash
python -m strategy_agent.eval.run --model template                    # ~1 minute; eval_reports/eval_report.html, .md, eval_results.json
python -m strategy_agent.eval.run --model qwen --llm-briefs 6         # a local LLM (needs its weights cached; see below)
python -m strategy_agent.eval.run --model mistral --adapter outputs/dpo_adapter   # fine-tuned vs template vs rule baseline (after GPU training)
```
Model aliases: `template`, `qwen`, `mistral`, `llm` (whatever `LLM_MODEL_NAME` says), `auto`. A model that writes invalid JSON makes the service fall back to the template; the report shows each
system's fall-back rate so you can tell when a "model" result is really the template's.

## Experiment log (the MLflow stand-in)

Every evaluation, dataset build and training run is appended to `experiments/runs.jsonl`:
```bash
python -m strategy_agent.experiments --last 10        # table of recent runs; add --kind eval | dataset | sft | dpo
```

## Dataset and GPU training (optional)

```bash
python -m strategy_agent.data.seed_generator --n 1200 --seed 42 --out data/strategy_sft/v1     # length-checked with the real Mistral and Qwen tokenizers
python -m strategy_agent.training.sft_qlora --dry-run          # CPU: validates the data against the PRODUCTION base model's tokenizer (Mistral-7B-Instruct-v0.3)
# On a GPU (24 GB card; Kaggle / Colab T4 with Qwen as the base): see strategy_agent/training/RUN_ON_GPU.md
python -m strategy_agent.training.sft_qlora --data-dir data/strategy_sft/v1 --out outputs/sft_adapter
python -m strategy_agent.training.dpo --sft-adapter outputs/sft_adapter --pairs pairs.jsonl --out outputs/dpo_adapter
```
Status: the training **code path** is run on CPU with a tiny model in the test suite (TRL 1.16 / PEFT 0.21). The 4-bit GPU run with the real 7B model has **not** been executed (no GPU here).

## The local LLM (optional)

```bash
pip install -r requirements-llm.txt
HF_HUB_DISABLE_XET=1 python -c "from huggingface_hub import snapshot_download as d; d('Qwen/Qwen2.5-1.5B-Instruct')"   # about 3 GB
GENERATOR_BACKEND=auto uvicorn strategy_agent.api.main:create_app --factory --port 8100
# production-style, once an adapter has been trained on a GPU:
LLM_MODEL_NAME=mistralai/Mistral-7B-Instruct-v0.3 ADAPTER_PATH=outputs/dpo_adapter ADAPTER_ID=dpo-v1 uvicorn strategy_agent.api.main:create_app --factory --port 8100
```
`GET /health` reports which generator is active. If the weights are missing or generation fails, the service falls back to the template generator and never errors.

## Layout

```
strategy_agent/  config.py auth.py schemas.py channels.py   db/ (tenant-scoped repo, shared store)   generation/ (prompt, generators, rag, ranking, service)
                 privacy/ (consent, anonymizer, k_anonymity, pipeline)   learning/ (reward, preference pairs)   api/   eval/   data/   training/   tests/
docs/ (strategy_agent.md, brief_compliance.md)   eval_reports/   experiments/   data/strategy_sft/v1/   requirements*.txt   .env.example   Makefile
```

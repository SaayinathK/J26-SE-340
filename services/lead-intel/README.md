# C3 — Lead Intelligence Agent (Shathursini J, IT23164062)

Scores CRM leads (KF1), gives grounded next-best-action recommendations with a fine-tuned Mistral 7B (KF2),
behavioural analytics, tracks real outcomes to monitor the model (FR7) and keeps the full output history
of every lead in its own database (FR10).
Port **4003**, called through the C4 gateway only (see `docs/architecture/lead-intel/c3-gateway-integration.md`).

## Where everything is (team folder structure)

| Folder | What is in it |
| --- | --- |
| `services/lead-intel/src/` | the API: `main.py`, `api/` routes, `agent/` RAG + knowledge base, `services/` scoring, alerts, analytics, monitoring, history, `repositories/` database access, `models/` request schemas, `clients/model_client.py` (Ollama), `config/settings.py` (all paths) |
| `services/lead-intel/db/` | `migrations/` (C3 database tables + row-level security), `seed/` (optional demo history) |
| `services/lead-intel/tests/` | `unit/` and `integration/` tests |
| `services/lead-intel/streamlit/` | older Streamlit dashboard (the main UI is `frontend/`) |
| `ml/lead-intel/` | how the models are made: `training/`, `notebooks/`, `serving/` (Ollama model container), `reports/`, `data/` |
| `ml/models/lead-intel/` | trained files: `lead_scorer.joblib`, `c3-mistral-ft-Q4_K_M.gguf` (gitignored) |
| `frontend/src/features/lead-intel/` | the Lead Intelligence screens of the platform web app |

## Run locally (from the repo root, PowerShell)

```powershell
python -m venv .venv ; .venv\Scripts\activate
pip install -r services/lead-intel/requirements.txt
cd services/lead-intel
uvicorn main:app --app-dir src --port 4003       # API: http://127.0.0.1:4003/docs
python -m pytest -q                               # 40 tests pass (+4 database tests, skipped without a database)
```

Without `C3_DATABASE_URL` the history is saved in JSON-lines files in `services/lead-intel/state/` (gitignored).
To use the Docker database from a local run: `$env:C3_DATABASE_URL="postgresql://lead_intel_app:c3_local_dev_only_2026@127.0.0.1:5436/lead_intel"`.
How to rebuild the data, model and knowledge base: `ml/lead-intel/README.md`.

## Run with Docker (whole platform)

From the repo root: `powershell -ExecutionPolicy Bypass -File .\scripts\start-docker.ps1` (details in `docs/docker.md`).

| Container | Port (127.0.0.1) | What |
| --- | --- | --- |
| `lead-intel` | 4003 | this API (the gateway calls it; the port is for testing) |
| `lead-intel-database` | 5436 | C3 Postgres `lead_intel`: lead history, row-level security per tenant |
| `lead-intel-model` | 11437 | Ollama with `nomic-embed-text` + `c3-mistral-ft` |
| `frontend` | 3000 | platform web app (sign in through the gateway) |

On a laptop with little Docker memory, set `C3_OLLAMA_URL=http://host.docker.internal:11434` in the root `.env` and
run `docker compose stop lead-intel-model` so C3 uses Ollama on the host (`docs/docker-validation.md`).

```powershell
docker compose exec -T lead-intel python -m pytest -q -p no:cacheprovider
docker compose exec -T -e C3_TEST_DATABASE_URL=postgresql://lead_intel_app:c3_local_dev_only_2026@lead-intel-database:5432/lead_intel lead-intel python -m pytest -q -p no:cacheprovider tests/integration/test_postgres_repo.py
docker compose exec -T lead-intel python db/seed/seed_history.py tenant_a 5     # optional: first scores for the history page
```

## Database (database per service)

| Table | One row per | Used by |
| --- | --- | --- |
| `lead_scores` | every score (with reasons, confidence, alert, model version, where it came from) | hot -> cold alert, history page, Strategy agent |
| `recommendations` | every piece of advice (action, message, sources S1..., policy check, model, full answer) | history page, Email agent (`status` new / sent) |
| `lead_outcomes` | every bought / did-not-buy answer, with the score at that time | monitoring (FR7), Component 2 retraining |

Rows are never overwritten. Every table has a `tenant` column and **row-level security**: the service logs in as
`lead_intel_app` (not a superuser, cannot bypass RLS) and sets `app.current_tenant` in each transaction, so the
database itself refuses another tenant's rows. Decision: `docs/adr/C3-ADR-006-own-database-lead-history.md`.

## Endpoints

| Route | WP | What it returns |
| --- | --- | --- |
| `POST /leads/score` | C3-06, C3-11 | score 0-100, segment, SHAP top factors, confidence, segment-drop alert (saved to history) |
| `GET /leads/{id}/recommendation` | C3-08, C3-09, C3-14 | grounded next action + message, cited sources, policy check, model used (saved to history) |
| `GET /leads/analytics` | C3-10 | funnel, drop-off, top sources, objections |
| `GET /leads/dashboard` | C3-12 | top-10 hottest leads, segment mix, weekly trend, lead list |
| `POST /leads/{id}/outcome` | FR7 | stores won / lost next to the score the model gave |
| `GET /leads/monitoring` | FR7 | AUC, Brier, win rate per segment, retrain flag (per tenant) |
| `GET /leads/history` | FR10 | every lead with history: counts, last score, last result |
| `GET /leads/{id}/history` | FR10 | one lead: timeline of scores, advice and results + score series |

Contracts: `contracts/v1/lead-score.yaml` (I-04), `lead-recommendation.yaml` (I-05), `lead-outcome.yaml` (FR7),
`lead-history.yaml` (FR10).

## Results (tenant_a, 20-22 Oct 2026)

| What | Result | Evidence (`ml/lead-intel/reports/`) |
| --- | --- | --- |
| Lead scoring (O2) | GB test AUC 0.891 vs rule baseline 0.786 | `c3-04_model_comparison.csv` |
| Calibration | hot 85% / warm 59% / cold 13% real conversion | `c3-05_segments.csv` |
| Accuracy check, 1,386 unseen leads | AUC 0.892, accuracy 0.815, dashboard numbers 12/12 match | `c3-accuracy_check.json` |
| Retrieval (O3, O4), 100 queries | hybrid 0.7: P@5 0.590, Recall@5 0.306, Hit@5 0.970, MRR 0.865 vs BM25 0.736 | `c3-09_retrieval_comparison_100q.csv` |
| Latency (NFR1) | scoring p95 85 ms, hybrid retrieval p95 175 ms | `c3-13_latency.csv` |
| Scale (NFR2) | 10,000 leads scored in one batch in 289 ms (p95) | `c3-13_latency.csv` |
| RAG quality, base vs fine-tuned (30 leads) | grounded 100% / 100%; policy-consistent 93.3% / 100% | `c3-13_rag_eval_summary*.json` |
| Fine-tuning (30 validation prompts) | cites the policy source 0% -> 100%; loss 1.15 -> 0.020 | `c3-14_finetune_summary.json` |
| Outcome monitoring (FR7), 481 held-out leads | AUC 0.892, Brier 0.124, no retrain needed | `c3-fr7_monitoring.json` |
| Docker + gateway (C3-06), 21 Oct | smoke 5/5 PASS; recommendation via gateway 91 s | `docs/docker-validation.md` |

## Settings (environment variables)

All of them are in `src/config/settings.py` and `.env.example`.

| Variable | Default | Use |
| --- | --- | --- |
| `C3_DATABASE_URL` | empty (= files) | C3 Postgres for the history (Docker sets it) |
| `C3_STATE_DIR` | `services/lead-intel/state` | history files when there is no database |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama (use 127.0.0.1, not localhost, on Windows) |
| `C3_LLM_MODEL` | `mistral:7b-instruct-q4_K_M` | LLM for recommendations (`c3-mistral-ft` = fine-tuned; Docker default) |
| `C3_RETRIEVAL` | `hybrid` | `bm25`, `embedding`, `hybrid` or `rrf` (hybrid 0.7 won in C3-09) |
| `C3_MODEL_PATH`, `C3_LEADS_PATH`, `C3_KB_DIR` | under `ml/` | only if your files are somewhere else |
| `C3_OLLAMA_URL` | `http://lead-intel-model:11434` | Docker only: Ollama used by C3 (`http://host.docker.internal:11434` = host) |

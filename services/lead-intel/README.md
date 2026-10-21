# C3 — Lead Intelligence Agent (Shathursini J, IT23164062)

Scores CRM leads (KF1), gives grounded next-best-action recommendations with a fine-tuned Mistral 7B (KF2),
behavioural analytics, and tracks real outcomes to monitor the model (FR7).
Port **3001**, called through the C4 gateway (see `docs/c3-gateway-integration.md`).

## Run from a fresh clone

```bash
python -m venv .venv && .venv\Scripts\activate          # Windows  (source .venv/bin/activate on Linux/macOS)
pip install -r requirements.txt
# put Kaggle X Education Leads.csv in data/raw/Leads.csv
python ingest.py && python validate_mapping.py          # C3-01  -> data/processed/leads_ghl.jsonl
python baseline.py && python train.py                   # C3-03, C3-04
python calibrate.py                                     # C3-05  -> models/lead_scorer.joblib
ollama pull nomic-embed-text && ollama pull mistral:7b-instruct-q4_K_M
python kb.py                                            # C3-07  -> data/kb/ (all 3 tenants)
uvicorn app:app --port 3001                             # API: http://127.0.0.1:3001/docs
python -m pytest -q                                     # 34 tests (no Ollama needed)
```

## Run with Docker (whole platform)

From the repo root: `powershell -ExecutionPolicy Bypass -File .\scripts\start-docker.ps1` (details in `docs/docker.md`).
It starts PostgreSQL, Ollama, C3 (Docker network only, no public port), the C4 gateway (`http://localhost:4000`) and
this dashboard (`http://localhost:8501`, sign in through the gateway). Data and models are mounted read-only, never in the image.
On a laptop with little Docker memory, set `C3_OLLAMA_URL=http://host.docker.internal:11434` in the root `.env` and
run `docker compose stop ollama` so C3 uses Ollama on the host (`docs/docker-validation.md`).

```bash
docker compose exec -T -e C3_HISTORY=/tmp/h.json -e C3_OUTCOMES=/tmp/o.json lead-intel python -m pytest -q -p no:cacheprovider
```

## Fine-tuned model (C3-14)

| Step | Where | Output |
| --- | --- | --- |
| Build the training data | `python finetune_data.py` | `data/finetune/train.jsonl`, `val.jsonl` (360 examples, not in git) |
| QLoRA training (Colab T4) | `notebooks/02_finetune_mistral_qlora.ipynb` | LoRA adapter, `reports/c3-14_*` |
| Merge adapter + GGUF (Colab CPU) | `notebooks/03_merge_lora_to_gguf.ipynb` | `c3-mistral-ft-Q4_K_M.gguf` (4.37 GB, not in git) |
| Load into Ollama | `ollama create c3-mistral-ft -f Modelfile` | model `c3-mistral-ft` |
| Use it | `C3_LLM_MODEL=c3-mistral-ft` | recommendations from the fine-tuned model |

Ollama 0.34.1+ no longer supports `ADAPTER`, so the adapter is merged into the weights (`docs/adr/C3-ADR-005`).

## Endpoints

| Route | WP | What it returns |
| --- | --- | --- |
| `POST /leads/score` | C3-06, C3-11 | score 0-100, segment, SHAP top factors, confidence, segment-drop alert |
| `GET /leads/{id}/recommendation` | C3-08, C3-09, C3-14 | grounded next action + message, cited sources, policy check, model used |
| `GET /leads/analytics` | C3-10 | funnel, drop-off, top sources, objections |
| `GET /leads/dashboard` | C3-12 | top-10 hottest leads, segment mix, weekly trend |
| `POST /leads/{id}/outcome` | FR7 | stores won / lost next to the score the model gave |
| `GET /leads/monitoring` | FR7 | AUC, Brier, win rate per segment, retrain flag (per tenant) |

Contracts: `contracts/v1/lead-score.yaml` (I-04), `lead-recommendation.yaml` (I-05), `lead-outcome.yaml` (FR7).

## Evaluation scripts

| Script | WP | Output |
| --- | --- | --- |
| `retrieval_eval.py tenant_a 100` | C3-09, O3 | `reports/c3-09_retrieval_comparison_100q.csv`, `reports/c3-09_queries_100q.json` |
| `perf_report.py` | C3-13, NFR1, NFR2 | `reports/c3-13_latency.csv` |
| `rag_eval.py` | C3-13 | `reports/c3-13_rag_eval*.csv`, `reports/c3-13_rag_eval_summary*.json` |
| `outcome_replay.py` | FR7 | `reports/c3-fr7_monitoring.json` |
| `streamlit run dashboard.py` | C3-12 | dashboard UI on port 8501 (dark theme, `.streamlit/config.toml`; API must be running) |

## Results (tenant_a, 20 Oct 2026)

| What | Result | Evidence |
| --- | --- | --- |
| Lead scoring (O2) | GB test AUC 0.891 vs rule baseline 0.786 | `reports/c3-04_model_comparison.csv` |
| Calibration | hot 85% / warm 59% / cold 13% real conversion | `reports/c3-05_segments.csv` |
| Retrieval (O3, O4), 100 queries | hybrid 0.7: P@5 0.590, Recall@5 0.306, Hit@5 0.970, MRR 0.865 vs BM25 0.736 | `reports/c3-09_retrieval_comparison_100q.csv` |
| Latency (NFR1) | scoring p95 85 ms, hybrid retrieval p95 175 ms | `reports/c3-13_latency.csv` |
| Scale (NFR2) | 10,000 leads scored in one batch in 289 ms (p95) | `reports/c3-13_latency.csv` |
| RAG quality, base vs fine-tuned (30 leads) | grounded 100% / 100%; policy-consistent 93.3% / 100%; sources 2 / 3; repeat 2/3 / 3/3 | `reports/c3-13_rag_eval_summary*.json` |
| Fine-tuning (30 validation prompts) | cites the policy source 0% -> 100%; loss 1.15 -> 0.020 | `reports/c3-14_finetune_summary.json` |
| Outcome monitoring (FR7), 481 held-out leads | AUC 0.892, Brier 0.124, no retrain needed | `reports/c3-fr7_monitoring.json` |
| Docker + gateway (C3-06), 21 Oct | smoke 5/5 PASS; recommendation via gateway 91 s, grounded, policy-consistent, c3-mistral-ft | `docs/docker-validation.md` (repo root) |

LLM generation on a laptop CPU takes about 77 s (fine-tuned) to 134 s (base) per answer; answers are cached.
Design decisions: `docs/adr/C3-ADR-001` to `005`. Requirements traceability: `docs/c3-traceability.md`.

## Settings (environment variables)

| Variable | Default | Use |
| --- | --- | --- |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | Ollama host (use 127.0.0.1, not localhost, on Windows; in Docker it is set from `C3_OLLAMA_URL`) |
| `C3_LLM_MODEL` | `mistral:7b-instruct-q4_K_M` | LLM for recommendations (`c3-mistral-ft` = fine-tuned; Docker default) |
| `C3_RETRIEVAL` | `hybrid` | `bm25`, `embedding`, `hybrid` or `rrf` (hybrid 0.7 won in C3-09) |
| `C3_HISTORY` | `data/processed/score_history.json` | last score per lead, for alerts |
| `C3_OUTCOMES` | `data/processed/outcomes.json` | recorded outcomes, for monitoring (FR7) |
| `C3_API` | `http://127.0.0.1:3001` | API address used by the dashboard |
| `C3_GATEWAY` | (not set) | dashboard signs in and calls the gateway instead of C3 directly (Docker) |
| `C3_OLLAMA_URL` | `http://ollama:11434` | Docker only: Ollama used by the C3 container (`http://host.docker.internal:11434` = host) |
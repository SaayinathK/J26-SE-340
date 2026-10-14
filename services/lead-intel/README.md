# C3 — Lead Intelligence Agent (Shathursini J, IT23164062)

Scores CRM leads (KF1), gives grounded next-best-action recommendations (KF2) and behavioural analytics.
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
uvicorn app:app --port 3001                             # API: http://localhost:3001/docs
python -m pytest -q                                     # tests (no Ollama needed)
```

## Endpoints

| Route | WP | What it returns |
| --- | --- | --- |
| `POST /leads/score` | C3-06, C3-11 | score 0-100, segment, SHAP top factors, confidence, segment-drop alert |
| `GET /leads/{id}/recommendation` | C3-08, C3-09 | grounded next action + message, cited sources, policy check |
| `GET /leads/analytics` | C3-10 | funnel, drop-off, top sources, objections |
| `GET /leads/dashboard` | C3-12 | top-10 hottest leads, segment mix, weekly trend |

## Evaluation scripts

| Script | WP | Output |
| --- | --- | --- |
| `retrieval_eval.py` | C3-09 | `reports/c3-09_retrieval_comparison.csv`, `reports/c3-09_queries.json` |
| `perf_report.py` | C3-13 | `reports/c3-13_latency.csv` |
| `rag_eval.py` | C3-13 | `reports/c3-13_rag_eval.csv`, `reports/c3-13_rag_eval_summary.json` |
| `streamlit run dashboard.py` | C3-12 | dashboard UI on port 8501 (API must be running) |

## Results (tenant_a, 14 Oct 2026)

| What | Result | Evidence |
| --- | --- | --- |
| Lead scoring (C3-04) | GB test AUC 0.891 vs rule baseline 0.786 | `reports/c3-04_model_comparison.csv` |
| Calibration (C3-05) | hot 85% / warm 59% / cold 13% real conversion | `reports/c3-05_segments.csv` |
| Retrieval (C3-09) | hybrid 0.7: MRR 0.858, P@5 0.496 (embedding 0.839 / 0.472) | `reports/c3-09_retrieval_comparison.csv` |
| Latency (C3-13) | scoring p95 97 ms, hybrid retrieval p95 214 ms | `reports/c3-13_latency.csv` |
| RAG quality (C3-13) | 30/30 grounded, 28/30 policy-consistent, LLM median 134 s (CPU) | `reports/c3-13_rag_eval_summary.json` |

## Settings (environment variables)

| Variable | Default | Use |
| --- | --- | --- |
| `OLLAMA_URL` | `http://127.0.0.1:11434` | point to the shared Ollama host (use 127.0.0.1, not localhost, on Windows) |
| `C3_LLM_MODEL` | `mistral:7b-instruct-q4_K_M` | LLM for recommendations |
| `C3_RETRIEVAL` | `hybrid` | `bm25`, `embedding`, `hybrid` or `rrf` (hybrid 0.7 won in C3-09) |
| `C3_HISTORY` | `data/processed/score_history.json` | last score per lead, for alerts |
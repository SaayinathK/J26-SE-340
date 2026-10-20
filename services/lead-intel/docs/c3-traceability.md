# C3 — Requirements traceability (proposal → code → test → evidence)

Owner: Shathursini J (IT23164062). Requirements from the proposal (Section 5, from the stakeholder interview).
Status as of 20 Oct 2026. 34 automated tests pass (`python -m pytest -q`).

## Objectives

| ID | Proposal target | Implemented in | Test | Evidence | Result |
| --- | --- | --- | --- | --- | --- |
| O1 CRM integration | ≥ 95% field mapping on ≥ 500 records | `ingest.py`, `validate_mapping.py` | `test_features.py` | `docs/c3-mapping.md` | 100% on 500 |
| O2 Lead scoring | beat rule baseline, AUC ≥ 0.80 | `train.py`, `calibrate.py` | `test_api.py` | `reports/c3-04_model_comparison.csv` | AUC 0.891 vs 0.786 |
| O3 RAG | precision/recall on ≥ 100 test queries | `rag.py`, `retrieval_eval.py` | `test_rag.py`, `test_retrieval.py` | `reports/c3-09_retrieval_comparison_100q.csv` | 100 queries: P@5 0.590, Recall@5 0.306, Hit@5 0.970 |
| O4 Retrieval optimisation | beat keyword baseline on MRR, < 500 ms | `kb.scores()` hybrid | `test_retrieval.py` | `reports/c3-09_retrieval_comparison_100q.csv`, `C3-ADR-002` | MRR 0.865 vs 0.736 (+17.5%), p95 175 ms |
| O5 Behavioural analytics | user evaluation, SUS ≥ 68 / ≥ 4.0 of 5 | `analytics.py`, `dashboard.py` | `test_analytics.py`, `test_dashboard.py` | user study | **pending** |

## Functional requirements

| ID | Requirement | Endpoint / module | Test | Evidence |
| --- | --- | --- | --- | --- |
| FR1 | ingest lead records (source, tags, activity, stage) | `ingest.py` | `test_features.py` | `docs/c3-mapping.md` |
| FR2 | conversion score 0–100 | `POST /leads/score` | `test_api.py` | contract I-04 |
| FR3 | cold / warm / hot segments | `app.segment()` | `test_api.py` | `reports/c3-05_segments.csv` |
| FR4 | retrieve tenant context before generating | `rag.retrieve()` | `test_rag.py`, `test_retrieval.py` | `reports/c3-08_examples.json` |
| FR5 | grounded personalised recommendation/message | `GET /leads/{id}/recommendation` | `test_rag.py` | `reports/c3-13_rag_eval_summary*.json` (30/30 grounded, base and fine-tuned) |
| FR6 | pipeline insights (top source, drop-off, objections) | `GET /leads/analytics` | `test_analytics.py` | dashboard screenshots (`evidence/c3-12/`) |
| FR7 | log prediction outcomes for accuracy evaluation | `POST /leads/{id}/outcome`, `GET /leads/monitoring` | `test_monitoring.py` | `reports/c3-fr7_monitoring.json` (481 held-out leads: AUC 0.892, Brier 0.124) |
| FR8 | alert when a hot lead goes cold | `check_alert()` in `/leads/score` | `test_alerts.py` | contract I-04 v1.1.0 |
| FR9 | confidence / source indicator | `confidence()`, `sources[]` | `test_alerts.py`, `test_rag.py` | dashboard screenshots |

## Non-functional requirements

| ID | Requirement | How it is met | Test | Evidence |
| --- | --- | --- | --- | --- |
| NFR1 | scoring + retrieval ≤ 1 s | hybrid retrieval + single-lead scoring | `test_performance.py` (p95 < 1 s) | `reports/c3-13_latency.csv`: score p95 85 ms + hybrid retrieval p95 175 ms |
| NFR2 | ≥ 10,000 lead records | vectorised batch scoring | `test_performance.py` (10,000 leads) | `reports/c3-13_latency.csv`: 10,000 leads in 289 ms (p95) |
| NFR3 | tenant isolation | tenant header from gateway, per-tenant KB, 404 for another tenant's lead | `test_kb.py`, `test_rag.py`, `test_alerts.py`, `test_monitoring.py` | `docs/c3-gateway-integration.md` |
| NFR4 | SUS ≥ 68 | user study | — | **pending** |
| NFR5 | consistent outputs | deterministic scoring; LLM temperature 0.2 + seed; answers cached | `test_api.py`, `test_performance.py` | LLM repeatability: base 2/3, fine-tuned 3/3 (`c3-13_rag_eval_summary*.json`) |

LLM generation time is not part of NFR1: about 77 s per answer on a laptop CPU (`rag_eval.py`); answers are cached after the first call.

## Extra beyond the proposal

| Item | Where | Evidence |
| --- | --- | --- |
| C3-14 QLoRA fine-tuning of Mistral 7B (behaviour, not facts) | `finetune_data.py`, `notebooks/02_finetune_mistral_qlora.ipynb` | `reports/c3-14_*`: policy citation 0% → 100%; `C3-ADR-003` |
| Fine-tuned model served in Ollama (merged GGUF Q4_K_M) | `notebooks/03_merge_lora_to_gguf.ipynb`, `Modelfile` | `reports/c3-13_rag_eval_summary_c3-mistral-ft.json`; `C3-ADR-005` |
| Dashboard UI | `dashboard.py` | `evidence/c3-12/` |

## Design decisions
`docs/adr/C3-ADR-001` scoring model · `002` hybrid retrieval · `003` QLoRA fine-tuning · `004` per-tenant KB now, pgvector later · `005` merged GGUF for Ollama

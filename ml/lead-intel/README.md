# ml/lead-intel — how the C3 models are made and served (Shathursini J, IT23164062)

The API that USES these models is `services/lead-intel/`. The training scripts reuse its code
(features, knowledge base, RAG) through `training/_paths.py`, so nothing is copied twice.

## Folders

| Folder | What | In git? |
| --- | --- | --- |
| `data/raw/Leads.csv` | Kaggle X Education leads (9,240 rows) | no - download it |
| `data/processed/leads_ghl.jsonl` | the same leads in GoHighLevel CRM format, 3 tenants | no - made by `prepare_data.py` |
| `data/processed/kb/` | per-tenant knowledge base (documents + vectors) | no - made by `build_kb.py` |
| `data/processed/finetune/` | 360 fine-tuning examples | no - made by `finetune_data.py` |
| `data/raw/business_context/` | each tenant's business rules (follow-up policy) | yes |
| `docs/architecture/lead-intel/Leads_Data_Dictionary.xlsx` | meaning of every Kaggle column | yes |
| `training/` | data preparation, training, evaluation scripts | yes |
| `training/configs/qlora.yaml` | the QLoRA settings used in notebook 02 | yes |
| `notebooks/` | 01 EDA, 02 QLoRA fine-tuning (Colab T4), 03 merge to GGUF (Colab CPU) | yes |
| `serving/` | `Modelfile`, `Dockerfile`, `entrypoint.sh` of the `lead-intel-model` container | yes |
| `docs/evidence/lead-intel/reports/` | every result (CSV / JSON / PNG) - written by the scripts, shown as evidence | yes |
| `../models/lead-intel/` | `lead_scorer.joblib`, `c3-mistral-ft-Q4_K_M.gguf` (4.37 GB) | no - see below |

Weights and data stay out of git. The GGUF file is in Google Drive (`My Drive/c3_finetune`).

## Rebuild everything (from the repo root, PowerShell, venv active)

```powershell
python ml/lead-intel/training/prepare_data.py       # C3-01  -> data/processed/leads_ghl.jsonl
python ml/lead-intel/training/validate_mapping.py   # C3-01  100% of fields mapped on 500 records
python ml/lead-intel/training/baseline.py           # C3-03  rule-based baseline
python ml/lead-intel/training/train.py              # C3-04  model comparison
python ml/lead-intel/training/calibrate.py          # C3-05  -> ml/models/lead-intel/lead_scorer.joblib
ollama pull nomic-embed-text
python ml/lead-intel/training/build_kb.py           # C3-07  -> data/processed/kb/ (all 3 tenants)
python ml/lead-intel/training/evaluate.py tenant_a  # accuracy check on unseen leads
```

## Fine-tuned model (C3-14)

| Step | Where | Output |
| --- | --- | --- |
| Build the training data | `python ml/lead-intel/training/finetune_data.py` | `data/processed/finetune/train.jsonl`, `val.jsonl` |
| QLoRA training (Colab T4) | `notebooks/02_finetune_mistral_qlora.ipynb` | LoRA adapter, `reports/c3-14_*` |
| Merge adapter + GGUF (Colab CPU) | `notebooks/03_merge_lora_to_gguf.ipynb` | `c3-mistral-ft-Q4_K_M.gguf` |
| Load into Ollama (laptop) | `cd ml/lead-intel/serving ; ollama create c3-mistral-ft -f Modelfile` | model `c3-mistral-ft` |
| Load into Docker | `lead-intel-model` container does it on start | model `c3-mistral-ft` on port 11437 |

## Evaluation scripts (`training/`)

| Script | WP | Output in `docs/evidence/lead-intel/reports/` |
| --- | --- | --- |
| `evaluate.py tenant_a` | O2 | `c3-accuracy_check.json` |
| `retrieval_eval.py tenant_a 100` | C3-09, O3 | `c3-09_retrieval_comparison_100q.csv`, `c3-09_queries_100q.json` |
| `perf_report.py` | C3-13, NFR1, NFR2 | `c3-13_latency.csv` |
| `rag_eval.py` | C3-13 | `c3-13_rag_eval*.csv`, `c3-13_rag_eval_summary*.json` |
| `outcome_replay.py` | FR7 | `c3-fr7_monitoring.json` |
| `c3_08_examples.py` | C3-08 | `c3-08_examples.json` (API must be running) |

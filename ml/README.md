# ml/ — how each agent's model is made and served (not the API that uses it)

`services/<agent>/` is the API that USES a model; `ml/<agent>/` is how the model is MADE and SERVED.
This keeps training libraries (torch, CUDA) out of the service images.

| Folder | What |
| --- | --- |
| `ml/<agent>/data/raw/` | input data (gitignored; download links in the agent's README) |
| `ml/<agent>/data/processed/` | generated data (gitignored; rebuilt by `training/`) |
| `ml/<agent>/notebooks/` | exploration and GPU training (Colab) |
| `ml/<agent>/training/` | `configs/`, `prepare_data.py`, `train.py`, `evaluate.py` |
| `ml/<agent>/serving/` | `Dockerfile` + `Modelfile` of the `<agent>-model` container |
| `ml/<agent>/requirements.txt` · `README.md` | libraries · base model, data, metrics |
| `ml/models/` | trained weights and adapters (gitignored; kept in Google Drive / Hugging Face Hub) |
| `ml/shared/` | code reused by all agents (`data_utils.py`, `eval_utils.py`, `base_trainer.py`) - team, to do |

Agents: `lead-intel/` (C3, done - see its README). Evaluation results are evidence: `docs/evidence/<agent>/`.

# Run the fine-tuned model on an NVIDIA RTX laptop (Windows)

This runs the **real fine-tuned Mistral-7B** behind the Strategy Agent UI — model, API and UI all in
**one process**. There is no separate model server to connect; the service loads the trained adapter
in-process and serves it.

**Requirements:** NVIDIA RTX GPU with **≥ 6 GB VRAM** (8 GB — RTX 4060/4070 — recommended), ~20 GB
free disk (the base model is ~14.5 GB, downloaded once), Python 3.11, internet for the first run.

The trained adapter is already bundled in this project at `sft_adapter/` — **no retraining needed.**

## 1. Install Python 3.11
From python.org. Verify in PowerShell: `py -3.11 --version`.

## 2. Create the environment
```powershell
cd <this project folder>
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1          # if blocked: Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass
```

## 3. Install PyTorch **with CUDA** FIRST (this is the step people miss)
`pip install torch` on Windows gives a **CPU-only** build, and then the GPU won't be used. Install the
CUDA build explicitly:
```powershell
pip install torch --index-url https://download.pytorch.org/whl/cu121
python -c "import torch; print('CUDA available:', torch.cuda.is_available())"   # must print True
```
If it prints `True`, continue. (Use cu124 instead of cu121 if you have a very new driver.)

## 4. Install the rest
```powershell
pip install -r requirements.txt -r requirements-gpu.txt
python -m spacy download en_core_web_sm
```

## 5. Run (one command)
Just run the bundled launcher from the project root — it sets all the model env vars and starts the server:
```powershell
.\run_gpu.bat
```
(On Mac/Linux: `bash run_gpu.sh`.)

- **First run** downloads Mistral-7B (~14.5 GB) — a few minutes, once. Subsequent runs are instant.
- Open **http://127.0.0.1:8100/** in a browser.
- Confirm the status pill shows **`generator: mistral-…`** (not `template`). If it says `template`,
  the GPU/weights weren't ready — see troubleshooting.

`run_gpu.bat` wires the fine-tuned model (`GENERATOR_BACKEND=auto`,
`LLM_MODEL_NAME=mistralai/Mistral-7B-Instruct-v0.3`, `ADAPTER_PATH=sft_adapter`, `LLM_LOAD_4BIT=true`).
Run it **from the project root** so `sft_adapter` resolves. (These are set as process env vars, not a
`.env` file, so `pytest` still uses the CPU defaults and stays green.)

## What you'll see
A real brief → fine-tuned Mistral generates ranked strategies as structured JSON (takes a few seconds
of genuine inference), feedback/outcomes feed the learning loop, consent + k-anonymity-gated shared
insights work. `/health` reports the active generator.

## Troubleshooting
| Symptom | Fix |
|---|---|
| `generator: template` in the UI | `torch.cuda.is_available()` is False → you installed CPU torch. Redo step 3 (CUDA build). |
| `CUDA out of memory` | Close other GPU apps. 6 GB cards are tight; the 4-bit model needs ~6 GB. |
| `bitsandbytes` import/install error | Ensure the CUDA torch from step 3 is installed first, then `pip install -U bitsandbytes`. |
| First run slow / stalls | It's downloading the 14.5 GB base model. Let it finish; it's cached afterwards. |
| Adapter not found | Run uvicorn from the project root, so `ADAPTER_PATH=sft_adapter` resolves. |

## Verify it's really the fine-tuned model
```powershell
curl http://127.0.0.1:8100/health
# {"status":"ok","generator":"mistral-7b-instruct-v0.3+sft-v1", ...}  <- not "template"
```

# Strategy Agent: handover guide

This guide has three independent parts. Do the ones you were asked to do.

| Part | What it is | Needs |
|---|---|---|
| **A. Finish the GPU fine-tuning on Google Colab** | Resume a Mistral-7B QLoRA training run that stopped at step 100 of 122, then evaluate the result | A Google account, a free Colab T4 GPU, about 2 GB free in Google Drive, about 2 to 3 hours |
| **B. Run the project on your own computer** | Install it, run the tests and the demo, start the API, run the evaluation | Python 3.11, about 2 GB of disk, no GPU |
| **C. Give someone else access to a running API** | Expose the API address safely | Part B first |

Everything below was checked on the author's machine. Anything that could not be checked is marked **(untested)**.

---

## 0. What this project is, and where it stands

The **Strategy Agent** turns a business brief (industry, budget, goal, constraints) into ranked marketing strategies as structured JSON. It also:

* learns from real feedback and campaign outcomes;
* lets businesses **opt in** to sharing anonymised results with each other, with privacy checks (PII removal, k-anonymity, optional noise);
* includes scripts that fine-tune a language model (Mistral-7B) to write better strategies.

It lives in its own package, `strategy_agent/`, and is separate from the federated-learning project (`fl_marketing`).

### Honest status at handover

| Item | Status |
|---|---|
| API, privacy pipeline, learning loop, evaluation, dataset, training scripts, Colab notebook | Done. The test suite (about 240 tests) passes on the author's machine |
| Evaluation of the rule-based **template generator** against a rule baseline | Done. Report in `eval_reports/` |
| **Mistral-7B QLoRA fine-tuning (SFT)** | **Partly done.** It ran on a Colab T4 for 100 of 122 steps (epoch 1.64 of 2). Training loss was about 0.159. At the end of epoch 1 the validation loss was 0.1698, with 94.6% token accuracy. The last saved state is `checkpoint-100`. **The remaining 22 steps and the evaluation of the fine-tuned model are what Part A finishes.** |
| Real **Qwen2.5-1.5B** output in the evaluation | **Not done.** The weights were downloaded and the loader fixed, but the evaluation has not been re-run since |
| **DPO** (preference tuning) | Cannot run yet. It needs at least 50 real preference pairs from user feedback, and none exist |
| Evaluation "world" | **Synthetic.** The simulated A/B results come from a model trained on invented data. They show that the pipeline works, not real marketing performance |

The training data (`data/strategy_sft/v1/`) is rule-generated. A high token accuracy (about 95%) therefore mostly shows that the model learned the **format**. It is not evidence of strategy quality. The evaluation in Part A, section 7, is what compares quality.

---

## 1. What is in the package

Unzip `strategy_agent_handover.zip` into an **empty folder**. The zip has no top-level folder, so unzipping it into a crowded folder mixes the files in.

```
HANDOVER.md                   this file
README_strategy_agent.md      the run guide (shorter than this one)
requirements*.txt             dependencies (core, local LLM, GPU training); requirements-lock.txt = exact versions the author used
.env.example                  every setting, with comments (copy to .env if you want to change any)
Makefile                      shortcuts (install / test / demo / run / eval)
docs/                         design document and a clause-by-clause status against the original build brief
data/strategy_sft/v1/         the synthetic training dataset (train / val / test) and its dataset card
eval_reports/                 the evaluation report for the template generator (HTML, Markdown, JSON)
experiments/runs.jsonl        the experiment log (one JSON line per evaluation or training run)
strategy_agent/               the code
  api/ generation/ privacy/ learning/ db/ eval/ data/ training/ tests/
  training/colab_finetune_mistral.ipynb    the Colab notebook for Part A
  training/RUN_ON_GPU.md                   a GPU runbook, including a troubleshooting table
```

Not included, on purpose: virtual environments, `.env` files, databases, model weights, and any secrets.

---

## Part A. Finish the fine-tuning on Colab

### A1. What you need

* A Google account.
* The Drive folder `strategy_agent_run` that the owner shared with you. It contains `sft_adapter/checkpoint-100`.
* About 2 GB free in **your own** Google Drive.
* A Colab **T4 GPU**. Free accounts get a limited daily GPU allowance. If Colab says you have no compute units or cannot connect to a GPU, you cannot continue today. Try again after the allowance resets (the Resources panel says it is daily), or buy compute units.
* Roughly 1 to 1.25 hours for the remaining 22 steps, and 30 to 60 minutes more for the evaluation. These are estimates. The measured speed on a T4 was 110 to 150 seconds per step, plus about 6 minutes for a validation pass.

### A2. Put the checkpoint in your own Drive

Colab can only resume from files in **your** Drive.

1. Open the shared `strategy_agent_run` folder in Google Drive and go into `sft_adapter`.
2. Right-click `checkpoint-100` and choose **Download**. Drive builds a zip (about 0.5 GB). Unzip it on your computer.
3. In **your own** Drive, create the folders `strategy_agent_run` and, inside it, `sft_adapter`. Upload the unzipped `checkpoint-100` folder into `sft_adapter`, so you end up with:

   ```
   My Drive / strategy_agent_run / sft_adapter / checkpoint-100 / ...
   ```

4. Check that `checkpoint-100` contains at least `trainer_state.json`, `optimizer.pt`, `scheduler.pt` and `adapter_model.safetensors`. Resuming needs all four.

If you only get `checkpoint-80`, that also works. It resumes from step 80, so there are 42 steps left.

### A3. Open the notebook and attach a GPU

1. Go to colab.research.google.com. Choose **File, then Upload notebook**, and select `colab_finetune_mistral.ipynb`. A copy is also inside the project zip at `strategy_agent/training/`.
2. **Runtime, then Change runtime type**: choose **T4 GPU** and click **Save**.
3. Click **Connect** in the top right.

> **Use a T4 for this resume.** The notebook sets `EPOCHS = 2` on a GPU under 20 GB, and the checkpoint was trained with that schedule. On a bigger GPU (L4, A100) it would pick 3 epochs, which changes the learning-rate schedule. If you must use a bigger GPU, edit section 2 to `EPOCHS = 2`. A resume on a different GPU type is **(untested)**.

### A4. Run the cells, one at a time

Press the play button on each cell and wait for it to finish before starting the next. **Do not use "Run all".** It would roll into the long training step.

| Section heading | What it does | What you should see |
|---|---|---|
| **1. Check the GPU** | Checks that a GPU is attached | A line like `Tesla T4: 15 GB, compute capability 7.5 -> training in fp16`. If it fails with `No such file or directory: 'nvidia-smi'`, **no GPU was attached**. See the troubleshooting table |
| **2. Settings** | Sets the training options | A printed dictionary with `EPOCHS: 2`. Nothing to change |
| **3. Storage and the project** | Mounts your Drive and unpacks the project | A Google popup asking for Drive access: click **Allow** and choose your account. Then a **Choose Files** button: upload `strategy_agent_handover.zip`. It ends with `project: /content/strategy-agent` and a list of folders |
| **4. Install the training libraries** | Installs pinned versions of trl, peft, transformers and so on | Takes 1 to 3 minutes. If it asks you to restart the session, do **Runtime, then Restart session**, then run section 3 again, and section 4 again |
| **5. Dry run** | Checks the dataset against Mistral's real tokenizer | The last line must be `OK: every example fits and is correctly aligned for mistralai/Mistral-7B-Instruct-v0.3`. It also shows `examples: 964` for train and `119` for val, with `aligned: True`. **If it fails, do not continue. Send the whole output to the owner** |
| **6. QLoRA fine-tuning (SFT)** | Trains (resumes) | See A5 |
| **Check the result** | Reads what training saved | Final loss, the adapter file list and the LoRA settings |
| **7. Evaluate the fine-tuned model** | Runs the evaluation on the GPU | Printed "Key findings" and "Ablations". See A6 |
| **8. (Optional) DPO** | Skips itself, because there are no preference pairs | `Skipping DPO: found 0 preference pairs` |
| **9. Download your results** | Zips the adapter and downloads it | A file `strategy_agent_results.zip` |

### A5. Section 6: resuming the training

The first lines it prints must include all of these. If any is missing, stop the cell and send the output to the owner:

```
GPU compute capability (7, 5): training in fp16
fp16 training: kept 448 trainable adapter tensors in fp32
resuming from /content/drive/MyDrive/strategy_agent_run/sft_adapter/checkpoint-100
```

* It downloads Mistral-7B (about 14.5 GB) to Colab's temporary disk: about 5 minutes. Then it loads it: about 1 minute.
* The progress bar should start near `100/122`. If it starts at `0/122`, the checkpoint was not found or not read. Stop the cell (the stop button on the cell) and check the Drive path from A2.
* Training prints `{'loss': ...}` lines every 10 steps. The loss should stay around 0.16 and not rise sharply. It must never show `nan`.
* At step 122 it runs a validation pass of about 6 minutes, prints `eval_loss`, and saves the adapter to `strategy_agent_run/sft_adapter`.
* A checkpoint is written every 20 steps. If the session drops, reconnect, run sections 1 to 5, then run section 6 again. It resumes from the newest checkpoint.

### A6. Section 7: evaluation, and what to send back

Section 7 installs the project's normal requirements on Colab's Python (3.13), loads the fine-tuned 7B model in 4-bit, and generates strategies for 4 briefs. Expect it to be slow. It is **(untested)** on Colab. If its pip install fails, send the error to the owner.

**Read the "fell back to the template" figure first.** If Mistral often writes invalid JSON, the service falls back to the template generator. Those results then measure the template, not the model.

Send the owner:

1. `strategy_agent_results.zip` (downloaded by section 9).
2. The printed output of the "Check the result" cell.
3. The printed "Key findings" and "Ablations" text from section 7.
4. From your Drive, `strategy_agent_run/eval_reports/` (the HTML, Markdown and JSON report) and `runs.jsonl`.

### A7. Keep the session alive

* Free Colab sessions can disconnect during long runs. Keep the tab open and click on it every 20 to 30 minutes.
* Keep your computer plugged in and awake. On a Mac, run `caffeinate -dims` in the Terminal app and leave it open.
* Do **not** delete anything in `sft_adapter` on Drive. It holds the saved training state.

### A8. Troubleshooting for Part A

| Symptom | Cause and fix |
|---|---|
| Section 1: `FileNotFoundError ... 'nvidia-smi'` | No GPU is attached (the tool does not exist on CPU machines). Runtime, then Change runtime type, then T4 GPU, then Save. If the **Resources** panel (click the arrow next to RAM / Disk, then View resources) says the daily free allowance has run out, wait and retry later, or buy compute units |
| Section 3: `FileNotFoundError ... strategy_agent_colab.zip` | The notebook is working inside a folder it deletes. In a new cell run `%cd /content`, then run section 3 again and re-upload the zip |
| Section 3: Drive mount error | Run the cell again. Click **Allow** on every Google screen, with the same account you are using in Colab |
| Section 4 asks to restart | Runtime, then Restart session. Then run section 3 and section 4 again. Your Drive files stay |
| Section 5 raises an `AssertionError` | **Do not train.** Send the full output to the owner |
| Section 6: `RuntimeError: gemm input type BFloat16 ... compute capability 8.0` | You are running an old copy of the code. Use the zip from this package |
| Section 6: `NotImplementedError: _amp_foreach_non_finite_check_and_unscale_cuda ... 'BFloat16'` | Same cause: an old copy. Use the zip from this package |
| Section 6: `CUDA out of memory` | Close other Colab notebooks that use the GPU. If it persists, in section 2 set `SEQ_LEN = 1024` and `GRAD_ACCUM = 32`. That changes the recipe, so tell the owner |
| Output stops at one step for more than 10 to 15 minutes | The session probably ended. Open the **Terminal** at the bottom of Colab and run `nvidia-smi`. If the command is not found or no Python process is listed, redo the setup: connect a T4, run sections 1 to 5, then section 6 |
| Section 6 starts from `0/122` | The checkpoint was not found. Check A2 (the exact folder names) |
| Colab says it cannot connect to a GPU due to usage limits | The free allowance is used up. Wait for it to reset, or buy compute units |

---

## Part B. Run the project on your own computer

No GPU, no API key and no internet access are needed for the core service. It uses a rule-based generator, so it runs everywhere.

### B1. Requirements

* **Python 3.11** (the author used 3.11.15). Newer versions are untested.
* About 2 GB of disk for the core install.

Check your Python:

```bash
python3.11 --version          # macOS / Linux
py -3.11 --version            # Windows (PowerShell)
```

### B2. Install

**macOS / Linux**

```bash
cd <the folder where you unzipped the project>
python3.11 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

**Windows (PowerShell)**

```powershell
cd <the folder where you unzipped the project>
py -3.11 -m venv .venv
.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m spacy download en_core_web_sm
```

If PowerShell refuses to run the activation script, run `Set-ExecutionPolicy -Scope Process -ExecutionPolicy Bypass` and try again.
If a download fails on a weak connection, re-run the same command. `pip` resumes.

`requirements-lock.txt` lists the exact versions of the author's environment, which is a Mac. Use it as a reference. Do not install it on Windows.

### B3. Check that it works

```bash
python -m pytest -q                    # about 240 tests, roughly 2 to 3 minutes
python -m strategy_agent.demo          # the whole flow on temporary databases
```

The demo shows consent, sharing, k-anonymity gating, strategy generation, feedback, outcomes and revocation. On a fresh machine about 20 tests are reported as **skipped**: the ones that need the Qwen or Mistral tokenizers, which are not downloaded. That is normal. There must be **no failures**.

### B4. Start the API

```bash
python -m uvicorn strategy_agent.api.main:create_app --factory --port 8100
```

* Health check: open `http://127.0.0.1:8100/health`. It reports which generator is active.
* The interactive docs at `http://127.0.0.1:8100/docs` list the endpoints. **Their "Try it out" button cannot send the authentication header**, so it answers `401 missing credentials`. Call the API with `curl` or the Python script below.
* Stop the server with `Ctrl+C`.

The API has exactly these endpoints:

| Method and path | Purpose |
|---|---|
| `GET /health` | Status and which generator is active |
| `POST /v1/strategy/generate` | A business brief in, ranked strategies out |
| `GET`, `PUT /v1/strategy/sharing/consent` | Read or set the sharing opt-in (tenant admin only) |
| `GET /v1/strategy/shared-insights` | Read the anonymised, k-anonymity-gated cross-business insights (optional filters: `industry_bucket`, `objective`, `region`, `limit`). Read-only |
| `POST /v1/strategy/{recommendation_id}/feedback` | Accept, reject or edit a strategy, with a rating |
| `POST /v1/strategy/{recommendation_id}/outcome` | Report the real campaign results |

### B5. Try it (works on every operating system)

In dev mode you identify yourself with two headers instead of a token. The tenant is always taken from the header or the token, never from the request body, and a `tenant_id` in a body is rejected.

Save this as `try_api.py` and run `python try_api.py` while the server is running:

```python
import httpx

c = httpx.Client(base_url="http://127.0.0.1:8100", timeout=120,
                 headers={"X-Dev-Tenant": "demo", "X-Dev-Roles": "tenant_admin"})

brief = {
    "business_profile": {"industry": "retail", "business_model": "B2C", "target_audience": "young professionals",
                         "region": "Colombo, Sri Lanka", "brand_tone": "friendly", "monthly_budget": 5000},
    "objective": {"type": "sales", "target_kpi": "roi", "target_value": 2.5, "time_horizon": "8 weeks"},
    "constraints": {"channels_blocked": ["sms"]},
}
r = c.post("/v1/strategy/generate", json=brief).json()
print("generator:", r["generator_used"], "| top strategy:", r["strategies"][0]["title"])
rid = r["recommendation_id"]

c.put("/v1/strategy/sharing/consent", json={"opted_in": True, "scopes": ["channel_mix", "outcome_metrics"]})
c.post(f"/v1/strategy/{rid}/feedback", json={"decision": "accepted", "rating": 5, "comment": ""})
c.post(f"/v1/strategy/{rid}/outcome", json={"impressions": 100000, "ctr": 0.02, "cpl": 12.0, "conversion_rate": 0.03,
                                              "roi": 2.0, "spend": 4000.0, "period": "2026-08-01"})
print("done")
```

On macOS and Linux you can use `curl` instead. Example:

```bash
curl -s localhost:8100/v1/strategy/generate -H 'X-Dev-Tenant: demo' -H 'X-Dev-Roles: tenant_admin' \
  -H 'Content-Type: application/json' -d '{"business_profile": {"industry": "retail", "business_model": "B2C",
  "target_audience": "young professionals", "region": "Colombo, Sri Lanka", "brand_tone": "friendly", "monthly_budget": 5000},
  "objective": {"type": "sales", "target_kpi": "roi", "target_value": 2.5, "time_horizon": "8 weeks"}}'
```

### B6. Run the evaluation

```bash
python -m strategy_agent.eval.run --model template      # about 2 minutes
```

It writes `eval_reports/eval_report.html`, `.md` and `eval_results.json`. Open the HTML file in a browser. The report covers structural validity, a quality rubric, a simulated A/B test against a rule baseline, privacy checks (PII leakage, k-anonymity, membership-inference attacks) and ablations. Section "Read this first" of the report says what the numbers do and do not mean.

Every run is appended to `experiments/runs.jsonl`. Show recent runs with:

```bash
python -m strategy_agent.experiments --last 10
```

### B7. Optional: a real local language model (Qwen2.5-1.5B, CPU)

```bash
pip install -r requirements-llm.txt
HF_HUB_DISABLE_XET=1 python -c "from huggingface_hub import snapshot_download as d; d('Qwen/Qwen2.5-1.5B-Instruct')"    # about 3 GB
GENERATOR_BACKEND=auto python -m uvicorn strategy_agent.api.main:create_app --factory --port 8100
python -m strategy_agent.eval.run --model qwen --llm-briefs 6                                                         # slow on a CPU
```

On Windows PowerShell, set variables with `$env:GENERATOR_BACKEND = "auto"` before the command.
`GET /health` shows whether the LLM or the template generator is active. If the model is missing or writes invalid JSON, the service falls back to the template and never fails. The evaluation report shows each system's **fall-back rate**. Always read it, because a fall-back means the result measures the template.

### B8. Use the fine-tuned Mistral adapter after Part A

Serving a 7B model needs an NVIDIA GPU (4-bit loading does not run on Apple Silicon or most laptops):

```bash
pip install -r requirements-gpu.txt
LLM_MODEL_NAME=mistralai/Mistral-7B-Instruct-v0.3 ADAPTER_PATH=<path to sft_adapter> ADAPTER_ID=sft-v1 LLM_LOAD_4BIT=true \
  python -m uvicorn strategy_agent.api.main:create_app --factory --port 8100
```

Without a GPU the same settings fall back to the template generator.

### B9. Settings

Copy `.env.example` to `.env` to change anything (generator backend, model name, adapter path, privacy k, ranking weights, database paths). Every setting is documented in that file.

---

## Part C. Giving someone else access to a running API

Pick **one** option. Option 1 is the safest.

**Option 1 (recommended): they run their own copy.** Send them the package and let them follow Part B. Nothing is exposed.

**Option 2: the same Wi-Fi, for a quick demo only.**

```bash
python -m uvicorn strategy_agent.api.main:create_app --factory --host 0.0.0.0 --port 8100
```

They call `http://<your-computer's-IP>:8100`. On a Mac, find the IP with `ipconfig getifaddr en0`. In dev mode **anyone who can reach the port can act as any tenant** by sending a header, so use this only on a network you trust, and stop the server afterwards.

**Option 3: over the internet, with real authentication.** Do all of these steps. The app refuses to start in production mode without the first two.

1. Create a long random secret:

   ```bash
   python3 -c "import secrets; print(secrets.token_urlsafe(48))"
   ```

2. Start the server in production mode, listening only on your own machine:

   ```bash
   APP_ENV=prod ALLOW_DEV_AUTH=false JWT_SECRET='<the secret>' \
     python -m uvicorn strategy_agent.api.main:create_app --factory --host 127.0.0.1 --port 8100
   ```

3. Open a tunnel to get a public HTTPS address, for example with `cloudflared tunnel --url http://localhost:8100` or `ngrok http 8100`. **(untested here)**

4. Create a token for the other person, using the **same** secret:

   ```bash
   JWT_SECRET='<the secret>' python -c "from strategy_agent.config import Settings; from strategy_agent.auth import create_token; print(create_token('friend-tenant', 'friend', ['tenant_admin'], Settings(), 86400))"
   ```

   The last number is the lifetime in seconds (86400 is 24 hours). Each token belongs to one tenant, and the tenant comes from the token.

5. They call the public address with the header `Authorization: Bearer <token>`. For example `GET /health`.

Things to know:
* Your computer must stay on and online.
* Their requests are stored in **your** SQLite files (`data/tenant.sqlite`, `data/shared.sqlite`).
* Never send the secret and the token in the same message as the code. Send the token alone.
* Stop the tunnel when you are done.

---

## Understanding the results

| You see | It means |
|---|---|
| Training loss falls from about 0.42 to about 0.16 | The model learned the output format and the rule patterns of the synthetic data |
| Validation loss close to the training loss | It generalises within the synthetic data and does not just memorise it |
| "Fell back to the template" rate is high | The fine-tuned model often wrote invalid JSON. Quality figures then describe the template |
| Agent better than a random mix but worse than the rule baseline | Honest outcome of the simulated world. Do not hide it |
| Membership-inference AUC above 0.5 | k-anonymity alone does not stop an attacker who already knows a target's own data. Noise lowers the AUC and reduces the usefulness of the shared insights |

When you report results, always state: the model (Mistral-7B-Instruct-v0.3 with a QLoRA adapter), the number of training steps (122, or 100 if you used the earlier checkpoint), the small number of briefs in the LLM evaluation, the fall-back rate, and that the training data and the evaluation world are synthetic.

---

## Troubleshooting for Part B

| Symptom | Fix |
|---|---|
| `python3.11: command not found` | Install Python 3.11 from python.org. On Windows use `py -3.11` |
| `pip install` fails or stalls on a weak connection | Run the same command again. `pip` keeps what it already downloaded |
| `OSError: [E050] Can't find model 'en_core_web_sm'` | Run `python -m spacy download en_core_web_sm` inside the activated environment |
| macOS: "library load disallowed by system policy" | Files copied from another computer carry a quarantine flag. Unzip the project fresh and recreate `.venv`. Do not copy a `.venv` from another machine |
| Port 8100 already in use | Use another port, for example `--port 8110` |
| `401 missing credentials` | Send the `X-Dev-Tenant` header (dev mode) or `Authorization: Bearer <token>`. The `/docs` page cannot send them |
| `400 tenant_id must not be sent` | Remove any `tenant_id` field from the request body or query string. It is taken from the token |
| App refuses to start with `APP_ENV=prod` | Set `ALLOW_DEV_AUTH=false` and a long `JWT_SECRET`. That is intentional |
| The report says the local LLM is "not available" although it was downloaded | Check `GET /health` and the "Run" section of the report. Missing weights, `torch` or `transformers` all give this message. Install `requirements-llm.txt` |
| About 20 tests are skipped | Normal when the Qwen and Mistral tokenizers are not downloaded. They are not failures |

---

## Safety checklist before you share anything

* Do not send `.env`, `.venv`, `data/*.sqlite`, tokens, or the JWT secret.
* Do not paste your Google Drive links in public places. Share the Drive folder with named accounts only.
* The shared databases contain only anonymised aggregates, but the tenant database contains whatever was sent to your API. Treat it as private.

---

## Where to read more

* `README_strategy_agent.md`: the shorter run guide.
* `docs/strategy_agent.md`: architecture, the four novelties, every substitution made (small model for Mistral, rule fallback and so on), and limitations.
* `docs/brief_compliance.md`: a clause-by-clause status against the original build brief, including what could not be completed.
* `strategy_agent/training/RUN_ON_GPU.md`: the GPU training runbook and its troubleshooting table.
* `data/strategy_sft/v1/DATASET_CARD.md`: how the training data was made and checked.

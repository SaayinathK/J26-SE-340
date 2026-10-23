# Colab QLoRA automation

The Learning center has two independent loops. Aggregate outcomes update a Beta-binomial engagement ranker. **Mistral fine-tuning** trains actual tenant-specific LoRA adapter weights on a frozen 4-bit Mistral v0.3 base using Transformers/PEFT. It runs in batches while your Colab session stays connected; it does not learn on every request.

## Connection status

There is no public app/API address configured yet. The pipeline can be tested locally, but **Colab cannot reach your computer's localhost**. No GPU training or model deployment has been performed by installing this feature. Fine-tuning consent and both automatic options default to off.

Two connections are required:

- Colab → your publicly reachable HTTPS app/gateway origin, for `/api/training-worker/*`. Use the frontend origin if it proxies `/api` to the gateway. Its reverse proxy must accept JSON requests up to 2 MB and forward Authorization headers. No browser cookies or CORS bypass is needed by the Python worker.
- Email service → Ollama in that same Colab runtime, through your existing inference connection (`OLLAMA_HOST` in `services/email-agent/.env`). A candidate installed on another runtime cannot be activated.

Once you have a public HTTPS origin, enter it in the notebook. You do not need to expose PostgreSQL or the email service directly. This feature does not create public tunnels or alter your current inference URL.

## Setup

1. Open **Email Agent → Learning center → Mistral fine-tuning** as an administrator. Enable the separate reviewed-text consent. It covers eligible briefs, business knowledge and approved email copy leaving the app for your own Colab runtime and Google Drive.
2. Download **Colab setup kit**. Open `c4_continuous_qlora_colab.ipynb` in your existing GPU session, upload the kit in step 1, install its bounded dependencies and mount Drive. The original training notebook is unchanged.
3. Keep the project's Ollama **0.12.3 server and CLI** running locally. The worker checks the server version and refuses another adapter import path. `ollama list` must include both your app's configured default model and `mistral:7b-instruct-v0.3-q4_K_M`. If the matching base is missing, install it explicitly with `ollama pull mistral:7b-instruct-v0.3-q4_K_M`. Do not install over an unrelated running Ollama instance.
4. Supply the starting adapter used to build your existing fine-tuned default (normally `/content/drive/MyDrive/c4_finetune/c4-email-lora`). Its configuration must identify Mistral 7B Instruct v0.3. A model tag alone cannot recover trainable adapter weights. Future runs continue the previously activated tenant adapter from its tenant/job directory; they fail safely if it is missing.
5. Create a temporary worker token in Learning center. Enter your public app/API origin and paste the token into the notebook's hidden prompt or Colab secret `C4_FT_WORKER_TOKEN`. Never put it in notebook outputs, URLs or source control. It expires after 8 hours and can be revoked in the UI.
6. Run the worker cell. It polls every 60 seconds. Queue a ready job manually, or enable automatic queuing. Automatic activation is a separate optional setting; the default requires choosing **Use language model** after evaluation.

From a local checkout the equivalent worker command is:

```sh
python colab_worker.py --api-url https://YOUR-PUBLIC-APP-ORIGIN --initial-adapter /content/drive/MyDrive/c4_finetune/c4-email-lora
```

The token is read from the environment or a hidden prompt, never a CLI argument. `--check` checks local CUDA and pinned Ollama without claiming jobs. `--once` handles at most one queued job. The worker requires a CUDA GPU and performs real training; there is no production mock-training mode.

## Dataset and scheduling

- At least **20 training and 5 held-out distinct campaign groups** are required. A stable hash of normalized brief, audience and tone assigns groups to a roughly 80/20 split. Repeated identical briefs are deduplicated. Up to 96 training and 24 held-out groups are snapshotted per job.
- Only current sequence versions with `Reviewed` status and a current 4/5-or-better human review qualify. Guardrails are rerun against current knowledge. Required personalization tokens, the exact unsubscribe footer, length limits and valid day 0/3/7 structure are enforced.
- Seeded/sample sequences, sample knowledge sources and sequences with synthetic outcomes are excluded. Detectable email addresses and phone numbers are excluded rather than silently redacted. This is a conservative pattern filter, **not a guarantee of anonymization**. Names, business information and qualitative claims still require administrator review before consent.
- The prompt uses the real application prompt builder and retrieved tenant facts. Answer-only loss trains on the accepted sequence. Oversized examples fail rather than truncating the target. Training is 2 epochs with 4-bit NF4, rank-16 LoRA, batch size 1 and gradient accumulation 8.
- Automatic queuing requires consent, readiness, at least 10 new eligible sequence/version IDs and a 24-hour cooldown. Only one queued/running job per tenant and one running job across the shared GPU are allowed. Nothing runs while Colab is disconnected.

This is supervised adaptation from reviewed writing. It does not implement RLHF, prove better engagement or automatically label arbitrary model output as correct. The quality of reviewed examples matters more than their count. Near-duplicate briefs with different wording are not semantically deduplicated.

## Evaluation and activation

For every held-out brief plus six fixed grounding/regression briefs, the worker captures **raw** baseline and candidate outputs with the same deterministic generation settings. It does not repair JSON, append footers or remove claims before evaluation. The server re-scores those outputs with the application validator; client-supplied pass/fail claims are ignored.

The candidate must achieve at least 80% overall pass rate, match or exceed baseline overall pass rate, and achieve 100% grounding and safety pass rates on this suite. Grounding checks are pattern-based; qualitative facts are not verified. These small-sample scores are screening criteria, not measured campaign uplift or proof of general accuracy. Review and approval guardrails remain in force after activation.

Only a validated candidate belonging to the current tenant can be selected. Activation also checks that the candidate exists on the configured Ollama server. Other tenants keep their own selection. **Restore default model** rolls back immediately; it keeps saved drafts and adapter artifacts.

The authenticated Colab worker is trusted to run training and provide genuine raw outputs. Server-side rescoring verifies the supplied text; it cannot independently attest GPU execution or prove those outputs came from particular adapter bytes. The stored SHA-256 is artifact provenance, not a remote attestation.

## Interruptions, privacy and artifacts

Worker JWTs have a dedicated issuer/audience, are stored hashed, tenant-bound and revocable, and require the creator still to be an active administrator. They cannot log into the app. Gateway-to-service requests additionally use signed identity headers. All three training tables enforce tenant RLS; datasets and token hashes are absent from normal UI responses. HTTPS redirects are refused to protect bearer credentials.

Heartbeats renew a five-minute job lease every 30 seconds. After three heartbeat failures the worker stops. Reconnection can reclaim an expired job once automatically; after two attempts it fails. Admins can cancel or retry a failed/cancelled job with unchanged eligible data. Consent withdrawal cancels queued/running jobs, revokes worker access and restores the default model. The worker stops on its next lease check; an in-flight CUDA operation can finish before that check. This is cooperative cancellation, not remote process termination.

Shared-GPU AI generation is paused while a job has a valid running lease. Existing requests can finish before training starts; if another process is using GPU memory, training may fail safely. Manual drafting stays available. If Colab dies, a selected tenant adapter becomes unavailable until the same model is restored on the inference server; use rollback to select the default instead.

Adapters, checkpoints, baseline outputs and evaluation reports are saved under `MyDrive/ciftron-qlora/<tenant UUID>/<job UUID>/`. Treat that Drive folder as sensitive tenant material. Removing app consent does not delete copies already held in your Drive/runtime. Job dataset snapshots and evaluation results are retained in the application database for audit. Delete external artifacts separately when no longer needed.

The serving adapter and matching base must be compatible. Ollama's pinned importer warns that quantization differences can affect adapter results. Registration or inference failure rejects/stops the job; no incompatible candidate is silently substituted. Verify a full GPU cycle with your actual runtime before presenting this as operational training.

## Build and verification

```sh
node scripts/build-colab-worker.cjs
npm run build --prefix frontend
powershell -NoProfile -File services/email-agent/scripts/verify-accounts.ps1
python -m unittest discover -s ml/email-agent/tests -p "test_colab_worker.py" -v
```

The kit uses an explicit four-file allowlist: worker, bounded requirements, clean notebook and this guide. Rebuild it after changing any of them and before packaging the frontend. It contains no `.env`, credentials, weights or tenant dataset.

The automated tests use disposable databases and explicitly synthetic evaluation outputs. They exercise control flow and safety gates; they do not execute GPU training or measure model improvement.

Primary references: [PEFT quantization and QLoRA](https://huggingface.co/docs/peft/developer_guides/quantization), [Ollama 0.12.3 adapter import and matching-base requirement](https://github.com/ollama/ollama/blob/v0.12.3/docs/import.md), [Colab runtime limits and restrictions](https://research.google.com/colaboratory/faq.html). Colab resources and session duration are not guaranteed; keep use interactive and within your plan's limits.

# Email Agent model runtime

The service owns a minimal CPU-only Ollama image, built from the upstream 0.12.3 executable and its matching CPU/C runtime libraries. Unused GPU libraries are excluded. `Dockerfile` targets the current Linux amd64 environment. The backend uses http://email-agent-model:11434; local tools use http://localhost:11435.

Active model state lives in the dedicated `ciftron_email_agent_models` Linux Docker volume at `/models`. Native storage avoids slow/random reads of multi-GB weights through the Windows filesystem mount. Source manifests/weights may remain in ignored `.local/models` within this folder. Large immutable blobs can be hard-linked from an existing cache on the same host drive without duplicating that source data.

The service launcher imports the configured `OLLAMA_MODEL` and `EMBED_MODEL` from the local cache when available. It copies blobs atomically, installs manifests last, reuses complete files, and stops if host free storage falls below 1 GiB. Initializing native runtime storage still requires room for another copy of the configured weights. For a fresh installation without a local cache, use `docker compose -f services/email-agent/compose.yml exec email-agent-model ollama pull <tag>`.

The model image is reused on normal startup; use `services/email-agent/start.ps1 -RebuildModel` to rebuild it. Building the upstream stage temporarily needs space for the full upstream image. Training lives in `../training` and the saved adapter is under `../../models/email-agent/c4-email-lora`. Register it explicitly with `register-finetuned.ps1`; registration leaves the application's selected model unchanged and requires a separate successful inference check.

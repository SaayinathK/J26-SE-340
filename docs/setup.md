# Setup and operation

Requirements: Node.js 22, npm, Docker Compose with `include` support, Docker Desktop on Windows. GPU/CUDA training dependencies are separate and are not needed to run the web application.

## First setup

```powershell
node scripts/setup.cjs
npm ci --prefix frontend
npm ci --prefix services/gateway
npm ci --prefix services/email-agent
powershell -NoProfile -File scripts/start.ps1
```

`setup.cjs` creates only missing local settings, with distinct database passwords and JWT secrets. It configures a separate `AGENT_GATEWAY_SECRET` shared only by gateway and Email Agent. Existing credentials are preserved. Do not commit `.env` files. Examples document settings; the generator is preferred over copying placeholder passwords.

Linux/macOS:

```sh
./scripts/setup.sh
docker compose build
docker compose up -d gateway-database email-agent-database content-agent-database lead-intel-database strategy-fl-database
./scripts/migrate-all.sh
docker compose up -d
```

Windows startup uses locally built frontend assets and prepared pure-JavaScript runtime packages for the prebuilt overlay. Use `scripts/start.ps1 -ContainerBuild` to install dependencies inside standard Linux image builds. The local migration helper still needs backend npm dependencies.

## Open the application

Use http://127.0.0.1:5173 or http://localhost:5173 consistently. One gateway account opens Email Agent directly from the sidebar; no iframe, service login or launcher page is involved. Set `GOOGLE_CLIENT_ID` in gateway settings if Google sign-in is required. Include the frontend origin in `CLIENT_ORIGINS`. Production HTTPS deployments must enable secure cookies and configure exact public application origins.

Frontend `/api/*` requests proxy only to gateway. Gateway port 4000 is an API port; the old gateway-served website has moved to the frontend container.

## Models and data

The existing `ciftron_email_agent_models` volume is retained. Copy cached configured models with `ml/email-agent/serving/import-model-cache.ps1`, or pull them explicitly using `docker exec email-agent-model ollama pull <tag>`. The default generation tag is `mistral:7b-instruct-q4_K_M`; model availability does not establish measured generation quality or latency. Saved QLoRA weights are not automatically activated. Missing models leave manual draft editing available.

Model caches and training data are ignored. No model pull, training run, database seed or weight conversion happens automatically during a source-folder move.

## Migrations and optional seeds

```powershell
node scripts/migrate-all.cjs
# Optional demonstration tenants only; do not run merely to start an existing stack:
node scripts/seed-all.cjs
node scripts/seed-all.cjs --apply
```

Migrations use per-service owner credentials locally, while application connections use the restricted `c4_app` role. Existing SQL migrations retain their content. Empty pending schemas have no application migrations. The system seeder previews by default; `--apply` adds labelled samples to the three demo tenants while preserving existing records and passwords. Synthetic engagement is shown separately from measured results and excluded from continuous learning. See [database seeding](database-seeding.md) for coverage, generated credentials and verification.

`docker/db-init/01-enable-pgvector.sql` runs only for a newly initialized database volume. Existing volumes gain extensions through migrations. Do not use `docker compose down -v` to update the application.

## Development and verification

```powershell
npm run dev --prefix frontend
node --test services/gateway/tests/unit/*.cjs
npm test --prefix frontend
npm test --prefix services/email-agent
powershell -File services/gateway/scripts/verify-accounts.ps1
powershell -File services/email-agent/scripts/verify-accounts.ps1
node tests/e2e/verify-service-flow.cjs
```

`npm run dev` reuses a running gateway or starts its local process; `/api` is the only Vite proxy. Browser integration tests require built frontend assets and Playwright (or `CIFTRON_PLAYWRIGHT_PATH`). They create uniquely named temporary databases and remove them afterward. They do not create test accounts in user databases. Screenshots and logs are stored under ignored `.local/` folders.

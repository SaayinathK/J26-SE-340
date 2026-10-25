# Local Docker deployment

Run commands from the repository root. Docker Desktop must use Linux containers.

## Services

| Container service | Address | Purpose |
| --- | --- | --- |
| gateway | http://localhost:4000 | JWT authentication, roles, audit, email API, lead API proxy |
| frontend | http://localhost:3000 | Platform web app (React + nginx); calls the gateway only |
| lead-intel | http://localhost:4003 | C3: scoring, analytics, recommendations, monitoring, lead history |
| lead-intel-database | localhost:5436 | C3 PostgreSQL `lead_intel` (lead history, row-level security) |
| lead-intel-model | http://localhost:11437 | C3 Ollama: nomic-embed-text + c3-mistral-ft |
| ollama | http://ollama:11434 (Docker network only) | Embeddings and language models for the email agent |
| db | localhost:5433 | PostgreSQL 16 with pgvector and row-level security |

Each service runs in its own container. Compose provides DNS between them.
The `content-agent`, `email-agent` and `strategy-fl` directories contain only
`.gitkeep` placeholders, so they have no standalone applications to launch.
The implemented email agent currently runs inside the gateway process.
Only loopback (127.0.0.1) ports are published.
Lead requests use `/api/leads/...`; the gateway maps the JWT tenant UUID to
the C3 tenant slug and overwrites the upstream tenant header.

## First startup

The existing local data and trained artifacts are mounted read-only, never baked
into images. These files are excluded from Git. A fresh clone needs the preparation
steps in `ml/lead-intel/README.md` and the fine-tuned GGUF described in
`ml/lead-intel/serving/Modelfile`. Required assets are the scorer, processed CRM data, per-tenant KB
documents/vectors (all under `ml/`), and `ml/models/lead-intel/c3-mistral-ft-Q4_K_M.gguf`.

```powershell
./scripts/start-docker.ps1
```

This generates an ignored root `.env` with a random JWT secret, builds images,
starts PostgreSQL and C3, seeds demonstration users, starts the gateway and
web app (frontend), and performs gateway smoke checks. It then starts Ollama, prepares
missing embedding/email/fine-tuned models and seeds the email KB.
Scoring and analytics can run while Ollama downloads; recommendations require Ollama.
Initial image/model downloads require several GB and may take considerable time.
Existing host models can be reused by setting `OLLAMA_MODELS_SOURCE=D:/ollama-models`
and `OLLAMA_MODELS_ACCESS=ro` in the root `.env`. Use the actual model-store path;
it must contain `blobs` and `manifests`. All three required models must already
exist when using a read-only store. Startup skips models that are already present.

Sign into the web app (http://localhost:3000) with `admin@tenant-a.com` / `Test@12345`.
Other seeded users: tenant A marketer/viewer, tenant B admin/marketer, tenant C
admin; all use that demonstration password. Database credentials in Compose and
the SQL migrations are development credentials. Change them together before
using this outside local development.

## Run services separately

After the first startup has prepared models and database users:

```powershell
docker compose up -d --wait db
docker compose up -d --wait ollama
docker compose up -d --wait lead-intel
docker compose up -d --wait gateway
docker compose up -d --wait frontend
./scripts/smoke-docker.ps1
docker compose ps
docker compose logs --tail 100 gateway lead-intel
```

The startup dependencies enforce health checks. Stopping the stack with
`docker compose down` preserves PostgreSQL, Ollama and C3 history/outcome volumes.
SQL initialization runs only for a new database volume; existing databases must
receive the migrations separately. Never remove database volumes to apply updates.

## Checks

```powershell
docker compose exec -T gateway npm test -- --runInBand
docker compose exec -T lead-intel python -m pytest -q -p no:cacheprovider
```

The gateway tests include tenant header spoofing, role enforcement and upstream
error handling. Lead tests use fake embeddings for offline retrieval checks.
Real recommendation generation also requires loaded Ollama models and enough RAM
for a 7B model; HTTP health checks alone do not verify model generation.
The existing email agent falls back to explicitly `[MOCK]` emails when generation
fails, so a 200 email response alone does not demonstrate a working LLM.

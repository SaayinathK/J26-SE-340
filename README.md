# Ciftron research platform

One React web application connects to five service APIs through the gateway. Authentication, sessions, CSRF protection and platform roles belong to the gateway. Each agent owns its application database and calls its own model runtime. Unimplemented agents show **Not available**.

```text
frontend/              Single web app: pages, shared UI, agent features
services/              Gateway and four agent APIs, each with src/db/tests
ml/                    Shared helpers, agent training/serving, ignored weights
docker/                PostgreSQL initialization and optional proxy guidance
tests/                 Cross-service integration, browser and load checks
docs/                  Architecture, API contracts, evidence, setup
scripts/               Configuration, startup, migration and optional seed helpers
```

Open **http://127.0.0.1:5173**. Port 4000 serves the gateway API.

On Windows, with Node.js, Docker Desktop and installed project dependencies:

```powershell
node scripts/setup.cjs
powershell -NoProfile -File scripts/start.ps1
```

On a fresh checkout, install dependencies first. See [setup](docs/setup.md) for Linux/macOS, container builds, migrations and local development. Existing database volume names are retained; startup never deletes volumes or seeds accounts automatically.

The Compose stack defines **15 containers**: one frontend, five APIs, four model runtimes and five databases. The content, lead and strategy API/model implementations are placeholders returning 503; their frontend pages explicitly report unavailable. Email Agent supports knowledge, generation through Ollama, and persisted manual drafts. Email delivery and scheduling are not connected.

See [service map](services/README.md), [architecture](docs/architecture/README.md), [ML assets and evaluation](ml/README.md), and [historical evidence](docs/evidence/README.md).

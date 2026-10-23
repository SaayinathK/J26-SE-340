# Ciftron research platform

One React web application connects to five service APIs through the gateway. Authentication, sessions, CSRF protection and platform roles belong to the gateway. Each agent owns its application database and calls its own model runtime. Content, Lead Intelligence and Strategy have native workspaces with honest connection states; see [agent UI integration](docs/agent-workspace-integration.md) for the teammate API adapters and pending backend setup.

The Email Agent Learning center includes optional [Colab QLoRA automation](docs/colab-qlora-automation.md): reviewed tenant writing can train actual Mistral adapter weights with evaluated activation and rollback. A public app/API origin and connected GPU runtime are required; training consent defaults to off.

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

The Compose stack defines **15 containers**: one frontend, five APIs, four model runtimes and five databases. The content, lead and strategy API/model implementations in this checkout are placeholders returning 503; their native workspaces show connection status and supported manual actions while those backends are pending. Email Agent includes a responsive studio with knowledge, Ollama generation, persisted drafts, personalized previews, reviews, manually recorded aggregate outcomes, and opt-in evaluated engagement guidance. GoHighLevel and Meta account references can be saved for future integration. Email delivery, scheduling, and external CRM/data synchronization are not connected yet.

See [service map](services/README.md), [architecture](docs/architecture/README.md), [ML assets and evaluation](ml/README.md), and [historical evidence](docs/evidence/README.md).

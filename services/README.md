# services/ — one folder per running service (team folder structure)

Each service owns its code (`src/`), its database schema (`db/`), its tests, its `Dockerfile` and its `.env.example`.
Only the gateway is reachable from the frontend; every agent is called by the gateway over HTTP.

| Service | Folder | Port (127.0.0.1) | Database container | Model container | Status |
| --- | --- | --- | --- | --- | --- |
| C4 gateway (auth, roles, audit, routing; email agent runs inside it for now) | `gateway/` | 4000 | `db` (c4-postgres) 5433 | `ollama` (Docker network only) | running |
| C4 email agent (now inside the gateway) | `email-agent/` | 4001 | - | - | placeholder |
| C1 content agent | `content-agent/` | 4002 | - | - | placeholder |
| C3 lead intelligence | `lead-intel/` | 4003 | `lead-intel-database` 5436 | `lead-intel-model` 11437 | running |
| C2 strategy / federated learning | `strategy-fl/` | 4004 | - | - | placeholder |

Layout inside a service (example: `lead-intel/`):

```
src/            api/ routes · agent/ logic + prompts · services/ business logic · repositories/ DB access
                models/ request schemas · clients/model_client.* (model container) · config/ · main.*
db/             migrations/ · seed/
tests/          unit/ · integration/
Dockerfile · .env.example · README.md
```

Ports and containers: `docker-compose.yml`. How each model is made: `ml/<service>/README.md`.

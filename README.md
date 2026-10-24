# J26-SE-340 — AI Marketing SaaS Platform (multi-client AI agents)

Microservices · single frontend · database per service · per-agent fine-tuning.

| Folder | What |
| --- | --- |
| `frontend/` | the single web app for all agents (calls the gateway only) |
| `services/` | one folder per service: gateway (C4), email-agent, content-agent, lead-intel (C3), strategy-fl (C2) - see `services/README.md` |
| `ml/` | how each agent's model is made and served - see `ml/README.md` |
| `docker/` | shared Docker files (database init, optional reverse proxy) - team, to do |
| `tests/` | cross-service tests only: `integration/`, `e2e/`, `load/` |
| `docs/` | `architecture/` (diagrams, decisions), `api/` (OpenAPI per service), `evidence/`, `setup.md` |
| `scripts/` | `setup.sh`, `migrate-all.sh`, `seed-all.sh` (+ Windows `start-docker.ps1`, `smoke-docker.ps1`) |

## Run (Docker)

```
cp .env.example .env            # set JWT_SECRET
docker compose up -d            # frontend http://localhost:3000, gateway :4000
sh scripts/migrate-all.sh       # bring existing databases up to date (safe to repeat)
```

Full guide: `docs/setup.md`. Never commit `.env`, data or model weights (see `.gitignore`).

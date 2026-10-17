# Service map

One frontend at http://127.0.0.1:5173 calls gateway only. The service folders contain APIs and databases; their UIs live under frontend/src/features. Model assets live under ml/<agent>/.

| API | Port | Database host port | Model host port | Current implementation |
| --- | --- | --- | --- | --- |
| gateway | 4000 | 5433 | - | Auth, roles, platform records, routing, rate limiting |
| email-agent | 4001 | 5434 | 11435 | Knowledge, sequences, Ollama client, manual drafts |
| content-agent | 4002 | 5435 | 11436 | Pending API/model; 503 |
| lead-intel | 4003 | 5436 | 11437 | Pending API/model; 503 |
| strategy-fl | 4004 | 5437 | 11438 | Pending API/model/FL; 503 |

Containers use database port 5432 and model port 11434 internally. All published development ports bind to loopback. Each database has its own persistent volume and credentials. Gateway does not open agent databases.

Use [root setup](../docs/setup.md) to start/migrate the stack. A component's compose.yml can build its API/database separately. For agent integration, implement the API and root frontend feature, replacing the truthful pending state; do not reintroduce a service-owned frontend. Gateway-only browser access and authenticated tenant boundaries must be retained.

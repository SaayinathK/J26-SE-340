# Docker stack

The root Compose file includes service-owned API/database definitions, the single frontend, and model runtime definitions. It defines 15 containers: frontend, gateway, email-agent, content-agent, lead-intel, strategy-fl; one database per API; and one model per agent.

Use [setup](../docs/setup.md). `docker-compose.prebuilt.yml` packages locally built frontend assets and verified installed JavaScript backend dependencies. Standard Dockerfiles install their own production dependencies; API images contain no UI builds, datasets, model binaries or credentials.

Database and model volume names were preserved during restructuring. `db-init/01-enable-pgvector.sql` initializes new database volumes. Migrations remain service-owned and are applied explicitly before API startup. Do not remove volumes during routine upgrades.

The pending agent/model containers report not_implemented rather than returning simulated outputs. Their UI pages live in root frontend features and show Not available. Optional external reverse proxy guidance is in nginx/README.md.

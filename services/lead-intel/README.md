# lead-intel

The shared frontend now contains the professional Lead Intelligence UI. This directory still runs the existing placeholder service. See [teammate service connection requirements](../../docs/agent-workspace-integration.md) for tenant-key mapping, gateway adapters and the actual model/database dependencies.

Service-owned API, agent logic and persistence. UI code belongs in the single root frontend; training, notebooks and serving assets belong under ../../ml/lead-intel. The implementation is pending; all API requests return 503 / not_implemented.

`src/main.cjs` is the entrypoint. `db/migrations` owns schema changes; `db/seed` holds optional explicit seeds. `tests` holds component tests. No frontend or model binaries belong in this folder.

See [service map](../README.md) and [setup](../../docs/setup.md).

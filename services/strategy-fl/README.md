# strategy-fl

The shared frontend provides a manual strategy planning workspace with downloadable briefs and existing campaign context. The Strategy backend remains unimplemented; this UI does not generate model recommendations. See [agent workspace integration](../../docs/agent-workspace-integration.md).

Service-owned API, agent logic and persistence. UI code belongs in the single root frontend; training, notebooks and serving assets belong under ../../ml/strategy-fl. The implementation is pending; all API requests return 503 / not_implemented.

`src/main.cjs` is the entrypoint. `db/migrations` owns schema changes; `db/seed` holds optional explicit seeds. `tests` holds component tests. No frontend or model binaries belong in this folder.

See [service map](../README.md) and [setup](../../docs/setup.md).

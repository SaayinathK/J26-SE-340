# email-agent

Service-owned API, agent logic and persistence. UI code belongs in the single root frontend; training, notebooks and serving assets belong under ../../ml/email-agent. Gateway requests are authenticated with AGENT_GATEWAY_SECRET, bound to method/path/body and scoped to the current workspace. Standalone legacy auth endpoints are retained for compatibility; the web app uses gateway auth only.

`src/main.js` is the entrypoint. `db/migrations` owns schema changes; `db/seed` holds optional explicit seeds. `tests` holds component tests. No frontend or model binaries belong in this folder.

See [service map](../README.md) and [setup](../../docs/setup.md).

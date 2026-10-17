# gateway

Platform authentication, sessions, RBAC, API routing and rate limiting. The shared UI lives at ../../frontend and port 4000 serves JSON APIs. Agent requests use a short-lived signed identity from the current platform session.

`src/main.js` is the entrypoint. `db/migrations` owns schema changes; `db/seed` holds optional explicit seeds. `tests` holds component tests. No frontend or model binaries belong in this folder.

See [service map](../README.md) and [setup](../../docs/setup.md).

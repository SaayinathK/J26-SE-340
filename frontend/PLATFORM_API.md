# Platform API ownership

Gateway serves the platform UI and `/api` at http://localhost:4000. Authentication uses gateway-owned HTTP-only cookies, CSRF tokens, signing keys, local account/session records and current database roles. Callers cannot select their tenant or privileges.

| Endpoint | Responsibility |
| --- | --- |
| `/api/auth/*`, `/api/team/*` | Platform accounts, sessions, Google identity and membership |
| `GET /api/platform/snapshot` | Local platform campaigns, knowledge, activity and historical sequence summaries |
| `GET /api/platform/status` | Local database status; Email Agent is an external application |
| `POST /api/platform/campaigns` | Create platform draft |
| `PATCH /api/platform/campaigns/:id` | Update Draft/Archived state with optimistic concurrency |
| `POST /api/platform/knowledge` | Add platform knowledge |
| `DELETE /api/platform/knowledge/:id` | Remove platform knowledge |

The gateway no longer hosts `/api/email/*` or sequence write compatibility proxies. Its UI opens the independent Email Agent at http://localhost:4001. Existing platform sequence summaries are retained historical records and are not synchronized with the Email Agent database.

Email Agent owns `/api/auth/*`, `/api/team/*`, `/api/email/snapshot`, `/api/email/status`, `/api/email/knowledge`, `/api/email/sequence` and `/api/email/sequences` on its own port. Its current local sessions/roles authorize every request. Generation and sequence writes require administrator/marketer access; knowledge writes require administrator access. Its credentials and cookies are separate from gateway.

Tenant tables enforce PostgreSQL row security. Mutating browser requests require an allowed origin and `X-CSRF-Token`. Stale writes return 409, invalid input 400/422, authentication 401, forbidden access 403, model outages 503 and malformed model output 502. Email sending/delivery is not configured.

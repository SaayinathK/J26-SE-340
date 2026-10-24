# C3-06 — Calling C3 through the C4 gateway

> **Update 22 Oct 2026:** the gateway route is live (`services/gateway/src/routes/leads.js`) and C3 now runs on port **4003**
> (`http://lead-intel:4003` in Docker), with the extra read-only routes `/api/leads/history` and `/api/leads/:id/history`.
> The status notes below are kept as the 14 Oct record.

**Update (20 Oct 2026):** The proxy is now implemented in
`services/gateway/src/routes/leads.js`, with JWT-derived tenant context, roles,
audit, outcome and monitoring routes, and a 300-second upstream timeout.
See [Docker setup](../../../docs/setup.md) for the integrated deployment.
The proposal and results below describe the earlier integration work.

**Status (14 Oct 2026):** C3 works on its own (port 3001). The C4 gateway (`feature/c4-platform-email`, last checked at `6968cfa`)
has login, JWT, roles, audit and `/api/email/sequence`, but **no route to C3 yet**. This note is what C3 needs from C4.

## What I found in the C4 branch

| Item | C4 today | What C3 expects | Fix |
| --- | --- | --- | --- |
| Gateway port | 4000 (`PORT` default) | Guide says 3000 | Agree one port in `.env` |
| Routes to C3 | none | `/api/leads/*` → `http://127.0.0.1:3001/leads/*` | Add `routes/leads.js` (below) |
| Tenant in JWT | `tenant_id` = UUID | `X-Tenant-Id: tenant_a` (slug) | Gateway maps UUID → slug from `tenants.slug` |
| Header from client | not handled | must be ignored | Proxy builds headers itself |
| Email sequence segment | `audience_segment` is free text typed by the user | C3 segment (hot/warm/cold) from I-04 | Call `POST /api/leads/score` first and pass its `segment` (golden path) |

## Proposed proxy (for Saayinath to review and commit on the C4 branch)

File: [`gateway-proposal/leads.js`](gateway-proposal/leads.js) → copy to `services/gateway/src/routes/leads.js`, then add one line in `server.js` before `app.listen`:

```js
app.use('/api/leads', require('./routes/leads'));
```

| Gateway route | Roles | C3 route |
| --- | --- | --- |
| `POST /api/leads/score` | agency_admin, marketer | `POST /leads/score` (I-04) |
| `GET /api/leads/:id/recommendation` | agency_admin, marketer | `GET /leads/{id}/recommendation` (I-05) |
| `GET /api/leads/analytics` | all roles | `GET /leads/analytics` |
| `GET /api/leads/dashboard` | all roles | `GET /leads/dashboard` |

Every call is audited (`c3_lead_*` actions). Timeout is 180 s because RAG on CPU can take ~2 min.

**Check with C4:** if row-level security hides `tenants` from the app role, either add `slug` to
`auth_private.lookup_login_user` and put `tenant_slug` in the JWT, or use a SECURITY DEFINER lookup.

## Test results (proxy run against the real C3 API, DB stubbed)

| Case | Expected | Result |
| --- | --- | --- |
| No token | 401 | 401 |
| Marketer, tenant_a, score | 200 + score | 200, score 80, hot |
| Viewer tries to score | 403 | 403 |
| Client sends `X-Tenant-Id: tenant_b` with a tenant_a token | tenant_a data | tenant_a (3,146 leads) |
| Token for unknown tenant | 403 | 403 |
| tenant_a token asks for a tenant_b lead | 404 | 404 |

## Steps to close C3-06 with Saayinath

1. Saayinath adds `routes/leads.js` + the `app.use` line, starts Postgres (docker compose) and the gateway.
2. I start C3: `uvicorn app:app --port 3001`.
3. Log in as a tenant_a marketer → `POST /api/leads/score` with the token → screenshot.
4. Repeat with a tenant_b user → different tenant data → screenshot.
5. Check `audit_log` has `c3_lead_score` rows → screenshot. Save all in `evidence/c3-06/`.

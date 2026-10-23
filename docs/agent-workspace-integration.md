# Shared agent workspaces

Content, Lead Intelligence and Strategy now have native pages in the single Ciftron frontend. They use the platform sidebar, cookie session, role permissions, theme and responsive layout. They do not open a second application or require another login.

The designs and request fields were adapted after inspecting the actual teammate sources on `origin/feature/c1-content-agent` (`e61e061`) and `origin/feature/c3-lead-intel` (`49f2706`). Their screenshots are visual references, not evidence that those services are running in this checkout. No model weights, raw CRM datasets, teammate `.env` files or separate authentication stores were copied.

## Pages

- **Content studio:** overview, four creation formats, creative library, recorded feedback, learning summary, business profile and CRM connection status. Generated outputs can be inspected and exported. Administrators can save the content business profile through its service.
- **Lead Intelligence:** overview, searchable/filterable/paginated roster, detail drawer, grounded recommendations, suggested message, actual outcome recording, CRM lookup, scoring, history and workspace-specific model quality.
- **Strategy planning:** manual campaign brief with audience, positioning, channels, dates and budget, downloadable JSON and existing workspace campaign/knowledge context. The fetched Strategy branch still contains no implementation. This planner does not invent AI recommendations or claim to train a model.

Manual content and strategy briefs live in the current page until downloaded. They are not silently saved to PostgreSQL or browser storage. Content generation and feedback, business-profile saving, lead scores, advice and outcomes use the connected services. A successful response is required before a save/success message appears. Downloaded manual files are marked `saved_to_service: false`.

## Current connection status

The Content, Lead and Strategy service directories in this checkout still run their existing placeholder processes. Their business backends have **not** been imported, provisioned or started by this UI change. The new pages remain accessible with a connection-pending state. Unknown counts display a dash, and no names, scores, predictions or outcome statistics are fabricated.

Use these signed-in routes:

```text
http://localhost:5173/#content-agent
http://localhost:5173/#lead-intel
http://localhost:5173/#strategy-fl
```

## Connecting the teammate services

Configure the gateway's server-side `CONTENT_AGENT_INTERNAL_URL` and `LEAD_INTEL_INTERNAL_URL` to the actual service root origins. They must be HTTP(S) origins without credentials, path, query or fragment. The browser continues to use the same-origin gateway and never sees service addresses or service tokens. The frontend does not accept arbitrary backend addresses from user input.

For the current Content service contract, configure `CONTENT_AGENT_JWT_SECRET` in the gateway to match that service's JWT secret (at least 32 bytes). The gateway issues a 60-second internal token with `clientId` set to the authenticated platform workspace UUID. That workspace must already have the matching active `clients.id` and tenant records in the Content service database. This UI change does not create, merge or impersonate teammate client accounts. Keep the internal service reachable only through your trusted network. A future service that validates the existing `X-Gateway-Identity` contract can use that signed header instead.

The Lead service uses `X-Tenant-Id`. The gateway supplies the authenticated database workspace slug, falling back only to its UUID when no slug exists. The Lead service must contain a matching tenant key. Unknown workspaces fail rather than falling back to `tenant_a` or another dataset. Browser-supplied tenant and Authorization headers are never relayed as service identity.

The gateway adapts the actual teammate routes:

| Browser/gateway | Teammate service |
| --- | --- |
| `/api/content/history`, `/generate`, `/feedback` | `/content/history`, `/content/generate`, `/content/feedback` |
| `/api/content/campaigns` | `/campaigns` |
| `/api/content/settings` | `/settings` |
| `/api/content/learning/summary` | `/learning/summary` |
| `/api/content/crm` | `/crm` |
| `/api/lead-intel/dashboard`, `/history`, `/score`, `/monitoring`, `/model-quality` | `/leads/dashboard`, `/leads/history`, `/leads/score`, `/leads/monitoring`, `/leads/model-quality` |
| `/api/lead-intel/:id/profile`, `/history`, `/recommendation`, `/outcome` | `/leads/:id/profile`, `/history`, `/recommendation`, `/outcome` |

Only recognized paths are accepted. Queries are preserved; path traversal, arbitrary auth endpoints and external origins are rejected. FastAPI `{ok:true}` health responses are recognized. A service 401 becomes a gateway 502 with an agent-connection message, so it does not sign a user out of their valid platform session. Validation errors are converted to readable messages. Generation and recommendation requests have bounded extended timeouts for the teammates' model calls; no synthetic progress percentages are displayed.

## Access and data handling

Administrators and Marketers can create content, request lead advice, score leads and record outcomes. Viewers can inspect permitted agent records but cannot perform those writes. Lead advice is implemented as a GET by the teammate service, but the gateway still requires `campaigns:write` because it generates and stores advice. Content business-profile changes require `workspace:manage`.

Content uses the **Content service's campaign IDs**, not IDs silently substituted from the platform campaign table. The displayed workspace Knowledge count refers to shared platform knowledge; the content engine is responsible for retrieving its configured profile, sources and approved examples. No automatic cross-service data sync is implied.

Anonymized leads retain their actual service IDs when no name is supplied; the UI does not generate fictional people. Roster filters describe the loaded selection, separately from the service's total CRM count. Scores come directly from the model response. Advice is shown only when the service returns `grounded: true`. What-if scoring does not allow recording outcomes or requesting advice for the altered scenario. Only `this_tenant` validation metrics are displayed; global test-set metrics are not presented as this workspace's results.

CRM/Meta connection status is read from the service. Opening a page does not authorize an integration, send messages, launch ads or confirm an outcome. Qualitative accuracy still needs review. Scores and learning statistics do not guarantee conversion or performance improvement.

## Verification

```powershell
npm test --prefix frontend
npm run build --prefix frontend
node --test services/gateway/tests/unit/*.test.cjs
node tests/e2e/verify-service-flow.cjs --agent-ui-only
node tests/e2e/verify-service-flow.cjs --rbac-only
```

The agent UI browser flow uses disposable real account databases, the real gateway proxy and explicit HTTP service fixtures. It exercises creation/history/feedback, profile saving, lead filters/details/advice/outcomes/scoring, role restrictions, spoofed-header rejection, cross-workspace isolation and layouts at 320/390/768/1440 pixels. Fixture screenshots are labelled as test data. It does not execute teammate models or certify a deployed teammate database.

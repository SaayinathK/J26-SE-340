# CRM integration

Open **CRM** in the sidebar. Create an account-level private integration in your CRM provider and grant these read scopes:

- `locations.readonly`
- `locations/customFields.readonly`
- `contacts.readonly`
- `opportunities.readonly`

Enter its account/location ID and private integration token. This is a private integration connection, not an OAuth marketplace installation. The first sync verifies customer and opportunity access; missing permissions appear on the CRM page. No records are written to the external CRM.

Create your campaigns in Business settings. On CRM, select each campaign, choose its customer tags (any match; no tags means all contacts), and optionally map existing categorical custom fields for segment, pain and goal. Save once. Sync runs immediately, then approximately every 15 minutes while the backend is running. A 30-second worker checks for queued jobs. Use Sync now to refresh sooner.

The pipeline retrieves account business details, contact pages, opportunity pages and contact field definitions. It stages a full snapshot in memory, then atomically replaces campaign summaries only after every fetch succeeds. Deletions are reflected by the next complete refresh. Concurrent syncs and campaign generation are guarded by advisory locks. A busy campaign causes a retry on the next scheduled cycle.

The CRM leads view stores contact names, emails, phones, company/location, source, contact type, tags and linked opportunity names/statuses in tenant-scoped storage. Search by name, email, phone or company; filter by tag or the selected campaign. Successful sync replaces the lead snapshot and removes deleted contacts. Disconnect deletes this local lead snapshot. Free-text notes and arbitrary custom fields are not imported into the leads view. Separately, the model receives aggregate campaign summaries only: category counts, recorded pains/goals, and opportunity status counts; contact names, emails and phone numbers are excluded from prompts. Category labels with fewer than three contacts are suppressed; this is data minimization, not a guarantee of anonymity. Select non-identifying categorical fields and tags. There is a 5,000-record limit per resource; oversized or incomplete snapshots fail visibly instead of replacing evidence with partial data.

Context generation includes the campaign's current summary and revision. Changed evidence invalidates cached drafts and persona planning. Campaign business settings take precedence over CRM business defaults. The saved offer and audience remain necessary: the CRM pipeline does not invent offer details. Historical generations retain their original labels; new personas using a nonempty CRM cohort are labeled **CRM-informed suggestion**. This means customer data informed generation, not that every generated claim has been independently validated. Unrecorded pain points remain hypotheses. Won CRM opportunities are not recorded as verified purchases, and do not select advertising winners. The existing purchase-performance learning pipeline remains separate.

Failed syncs preserve the last successful summary. Summaries older than 24 hours are excluded from generation. The dashboard displays last sync, errors and expired evidence. Disconnect removes the token, stored lead details and active summaries; reconnect and remap to resume. The server never returns stored tokens to the browser. Existing manual research records and endpoints are retained for historical compatibility; the navigation and old research page now lead to CRM.

## Server setup

Run `npm run migrate:campaigns` from `services/content-agent` before starting the server. Production requires `CRM_ENCRYPTION_KEY`, a persistent base64-encoded 32-byte random key, supplied through your secret manager. Generate one with `openssl rand -base64 32`. Back it up securely; losing it requires reconnection. Development automatically creates a git-ignored, permission-restricted `.local-secrets/crm.key`. AES-256-GCM encryption binds credentials to their workspace.

The API host is fixed to the provider's official endpoint. `CRM_API_VERSION` defaults to `v3`; set an alternative version only if required by the provider/account. API requests have timeouts and bounded retry for rate limits and server errors. No webhook/public callback URL is required for this polling implementation.

## Verification

`npm test` covers aggregation, encryption, cross-account response rejection and pagination, alongside existing application tests. `node scripts/smoke_crm.js` uses disposable local database accounts and simulated CRM responses to test the route-to-context pipeline, tenant isolation, stable revisions, failed syncs, contact deletion, expiry and disconnect. It does not certify access to a real connected account; that requires the user's credentials and a successful live sync.

Provider references: [Private integration setup](https://help.gohighlevel.com/support/solutions/articles/155000003054-private-integrations-everything-you-need-to-know), [API scopes](https://marketplace.gohighlevel.com/docs/Authorization/Scopes/index.html), [Contact search](https://marketplace.gohighlevel.com/docs/ghl/contacts/search-contacts-advanced/index.html), [Opportunity search](https://marketplace.gohighlevel.com/docs/ghl/opportunities/search-opportunity/index.html).

## From leads to content

After syncing, choose a campaign on CRM to inspect its matching leads and **Lead analysis for content**. Map tags and categorical fields once to identify relevant segments, recorded pains and goals. Click **Prepare content for this audience** to open the content studio with that campaign selected, then choose a format and generate. The prompt remains optional. This action prepares campaign content from aggregate evidence; it does not message contacts or launch an advertising campaign automatically. Contact data is displayed from the last successful sync, whose timestamp is shown.

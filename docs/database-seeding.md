# Database demo seeds

By default, the system seeder populates Green Leaf Coaching (`tenant_a`), Prime Realty Group (`tenant_b`) and EventSpark Agency (`tenant_c`). It preserves their IDs and existing records. Other workspaces, including SLIIT, change only when explicitly selected with `--workspace-slug`.

From the repository root, with Node dependencies installed and the databases running:

```powershell
node scripts/migrate-all.cjs
node scripts/seed-all.cjs
node scripts/seed-all.cjs --apply
```

The command without `--apply` previews inside transactions, then rolls back. `--apply` commits the sample data. Linux/macOS can use `./scripts/seed-all.sh --apply`.

To populate an existing workspace instead of the three default demo tenants:

```powershell
node scripts/seed-all.cjs --workspace-slug YOUR-EXISTING-SLUG
node scripts/seed-all.cjs --workspace-slug YOUR-EXISTING-SLUG --apply
```

This mode requires an existing workspace with an active administrator. It reuses its accounts and leaves passwords, roles and real records unchanged. It adds four `[Sample]` campaigns, four explicitly fictional `[Sample]` knowledge sources, three sample sequences, three fictional reviews, nine synthetic outcome rows and a non-activatable sample learning evaluation. It creates no new accounts or invitations and leaves all other tenants unchanged. Existing learning consent and integration settings remain intact. Samples are visible only when signed into the selected workspace; another workspace with the same display name remains separate.

| Model | Sample data across three tenants |
| --- | --- |
| Tenants | Reuse the three existing demo tenants; create them only when missing |
| Gateway users / email identity projections | Administrator, marketer and viewer for each tenant; nine accounts in total |
| Campaigns | 12 campaigns, including three archived campaigns |
| Knowledge | Reuse coaching and realty facts; add four EventSpark sources; mirror demo sources into gateway |
| Email sequences | Nine manually authored three-email sequences, days 0/3/7, with personalization, links and unsubscribe text |
| Email reviews | Nine clearly labelled fictional reviews requesting changes; no approval seeded |
| Email outcomes | 27 aggregate rows marked `provenance: synthetic` |
| Learning runs | Three sample evaluations computed from the fictional outcome rows |
| Learning preferences | Insert disabled defaults only when absent; preserve existing consent and active model settings |
| Integration preferences | Prepare empty GoHighLevel and Meta references only when missing; no API connection |
| Workspace invitations | One pending sample invitation per tenant; no message sent |
| Workspace events / audit log | Labelled seed activity and an audit record in each implemented service |

Gateway and Email Agent reuse the same tenant, account and sample campaign/sequence IDs. The seeder does not create independent authentication passwords in the email service. Gateway remains the account authority. Matching fixture rows in gateway's existing sequence table support its dashboard; this is an explicit seed, not an implemented live synchronization mechanism.

Sample names start with `[Sample]`. In Email Studio → Performance, **Measured results** shows measured data, while **Sample data** shows fictional engagement counts. Sample outcomes are read-only and excluded from learning readiness, training and prompt guidance. Sample evaluation history cannot be activated. Actual model responses from the PP1 evidence and previously saved drafts are preserved.

Existing passwords, roles, edited samples, saved sequences, outcomes, integration references and learning preferences are not overwritten. Each rerun inserts only missing fixture records using stable IDs. It does not restore archived knowledge automatically. Newly created account passwords are randomly generated, hashed for storage, and written only to the ignored local file `.local/seed-credentials.json`. Existing account passwords are not recovered or reset, and plaintext passwords are not printed in seed output. Keep the local credentials file private.

Each database uses its own transaction. The two service commits are not a distributed transaction; if a connection fails between commits, rerunning the idempotent seeder completes missing data. Application startup never seeds automatically.

Content Agent, Lead Intelligence and Strategy/FL currently have no application tables to populate. Their databases are left unchanged. Active login sessions and Google sign-in challenges are created by real authentication flows and are not seeded. No model download, inference, email sending or external CRM/Meta requests run during seeding.

Verify against newly created, isolated databases:

```powershell
node scripts/verify-seed.cjs
powershell -NoProfile -File services/email-agent/scripts/verify-accounts.ps1
# After applying the seed, using newly created account credentials and Playwright:
node scripts/verify-seed-ui.cjs
```

The seed verifier checks preview rollback, repeat inserts, password and edited-record preservation, matching cross-service identities, tenant isolation, synthetic provenance and disabled learning defaults. It removes only its own uniquely named temporary databases afterwards.

Service-owned db/seed. SQL schemas are versioned under db/migrations; pending components do not contain business implementations.

`pp1-demo.json` holds the coaching and realty facts. `scripts/setup-demo.cjs` prepares those two demo knowledge bases. The root `scripts/seed-all.cjs --apply` also adds campaigns, role accounts, sample sequences, fictional reviews, synthetic outcomes and non-activatable sample evaluations for all three existing demo tenants. See [database seeding](../../../../docs/database-seeding.md). Existing facts and generated PP1 drafts are preserved.

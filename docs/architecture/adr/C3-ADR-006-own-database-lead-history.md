# C3-ADR-006 — Own database for the lead history (database per service)

**Date:** 22 Oct 2026 · **Status:** Accepted · **Owner:** Shathursini J (C3)

## Context
The team folder structure (J26-SE-340_Folder_Structure) uses **database per service**: each service owns its
schema in `services/<name>/db/` and only that service touches its database. Until now C3 kept only the LAST
score per lead and the outcomes in JSON files, so every new score overwrote the old one and the advice was not
stored at all. The Strategy agent, the Email agent and Component 2 (continuous learning) need that history.

## Decision
C3 gets its own PostgreSQL database `lead_intel` (container `lead-intel-database`, pgvector image, port 5436) with
three append-only tables: `lead_scores`, `recommendations`, `lead_outcomes` (`services/lead-intel/db/migrations/`).
Every table has a `tenant` column and row-level security on `app.current_tenant`; the service logs in as
`lead_intel_app` (NOSUPERUSER, NOBYPASSRLS), the same pattern as C4's `c4_app`.
Code reaches it only through `src/repositories/` (`PostgresHistoryRepo`); without `C3_DATABASE_URL` the same
interface writes JSON-lines files (`FileHistoryRepo`), so tests and local runs need no database.
Other components read the history through the API (`GET /leads/history`, `GET /leads/{id}/history`), never the tables.

## Consequences
- Scores, advice and outcomes are kept for each lead and shown on the Lead history page.
- Tenant isolation is enforced twice: by the gateway (JWT -> tenant) and by the database (RLS). Tested in
  `tests/integration/test_postgres_repo.py` against a real Postgres.
- If the database is down, scoring still works (the score is just not saved); history and outcomes return 503.
- The knowledge base still uses per-tenant files (C3-ADR-004); the `vector` extension is enabled in `lead_intel`
  so it can move into this database later.

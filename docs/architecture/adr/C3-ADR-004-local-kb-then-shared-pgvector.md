# C3-ADR-004 — Per-tenant KB files now, shared pgvector `knowledge_base` table later

**Date:** 11 Oct 2026 · **Status:** Accepted (temporary) · **Owner:** Shathursini J (C3)

## Context
The architecture has one CRM-grounded knowledge base with tenant-scoped retrieval. C4's Postgres +
pgvector `knowledge_base` table (with `tenant_id`) was merged to `main` on 14 Oct; C3 was built before it existed.

## Decision
Store C3 documents per tenant in `data/processed/kb/<tenant>_docs.jsonl` + `_vectors.npy` (isolation by file), behind
`kb._open()` / `kb.scores()`, so only those two functions change when moving to the shared table.

## Consequences
Isolation is tested (each tenant file contains only its own leads). Migration step after PP1: insert the same
documents into `knowledge_base` with `tenant_id`, and query with `WHERE tenant_id = $1` under RLS.

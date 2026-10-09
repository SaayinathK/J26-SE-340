# C1 Content Agent

Node.js 20 / Express service for tenant-scoped retrieval, Phi-3 classification and Mistral content generation. Uses the existing PostgreSQL schema; does not create or migrate tables.

## Setup

```sh
cd services/content-agent
cp .env.example .env
npm install
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
ollama pull phi3:mini
ollama pull mistral:7b-instruct-q4_K_M
ollama pull nomic-embed-text
npm start
```

The server prints `Server running on port 5001`. PostgreSQL 16 with pgvector and the supplied tables must already exist at the configured DATABASE_URL. Ollama must be running at OLLAMA_HOST. Replace the example JWT secret before deployment. Node's built-in fetch and crypto replace the unnecessary node-fetch and deprecated crypto packages.

## API

Register with `POST /api/auth/register` using `{ "name":"Demo", "email":"demo@example.com", "password":"a-long-local-password" }`. Login uses `POST /api/auth/login` with email/password. Responses include a JWT and registration also returns `client.id`, the tenant UUID. `GET /api/auth/me` returns the authenticated account. All other endpoints require `Authorization: Bearer <token>`.

| Method | Path | Body / response |
| --- | --- | --- |
| POST | /context/build | `{content_type, brief, brand_voice_id?}` → `{success, context}` |
| POST | /content/generate | Same body → `{success, content_id, ...generatedFields, attempts, context_ids}` |
| POST | /content/feedback | `{generation_id, feedback:"positive"\|"negative"}` → `{success, performance}` |
| GET | /content/history | `{success, history:[]}`; latest 20 |
| GET | /health | Process liveness; does not assert dependency readiness |

Formats: meta_ad, funnel_page, email, social_post, vsl. Briefs under 20 characters, fewer than two KB matches, or missing brand voice block generation with a 400 `missing` array. Invalid model JSON or format violations are retried three times, then return 502. Quota exhaustion returns 429. No quota is consumed on failed generation/persistence.

## Seed and evidence

Set `TENANT_ID` in `.env` to the registered client UUID, or pass `--tenant-id UUID` to tenant scripts.

```sh
python3 scripts/ingest_kb.py
python3 scripts/intent_classifier.py
python3 scripts/retrieval.py
python3 scripts/seed_brand_voices.py
python3 scripts/build_training_dataset.py
```

Ingestion is idempotent and commits 20 entries as one transaction. All seeded campaign metrics are clearly marked synthetic; replace them with verified business facts for real campaigns. The voice script creates three original profiles and prints their descriptions; select a profile using its entry_id from the tenant's KB. Without an explicit voice ID, the newest profile is selected.

The classifier sends 50 actual Ollama requests (10 per format) and writes `evidence/c1-02-accuracy.txt`. It measures content-type accuracy on a simple templated fixture, not independent benchmark generalization or stage/subtype accuracy. It exits unsuccessfully below 43/50; accuracy is never fabricated. Retrieval prints cosine scores and independently verifies the tenant_id of every returned row. Empty retrieval fails the evidence check. Run against two seeded tenant accounts to exercise multiple tenants.

For blinded baseline evaluation, set `API_TOKEN` to a JWT and run:

```sh
python3 scripts/evaluation.py
python3 scripts/evaluation.py --score ratings.json --key evidence/evaluation-RUN-PRIVATE-key.json
```

This makes 20 baseline Ollama calls and 20 authenticated context pipeline calls, consuming 20 generations. Share only the blinded JSON with reviewers; keep the randomized answer key private. Reviewers produce an array of `{ "id":"pair-id", "A":4, "B":3 }` records for all 20 pairs. Scores average factuality, relevance, brand fit and clarity on a 1–5 rubric. The evaluator compares the complete pipelines, including context pipeline validation retries. Model failures abort the run rather than producing invented evidence. Training export includes only positive examples and performs no fine-tuning; files contain tenant content and should remain private.

## Tests and design

```sh
npm test
python3 -m compileall -q scripts
```

Jest tests use mocked DB and context dependencies to exercise HTTP contracts, authentication, invalid inputs, quota races and tenant parameters, plus real format validation/retry logic. They do not certify a live PostgreSQL/Ollama deployment. Live evidence scripts require those dependencies and a registered tenant.

Every tenant query runs on a checked-out connection with transaction-local `app.current_tenant` set before execution. Tenant-owned table reads/updates also include tenant predicates; inserts carry the authenticated tenant. A global pool SET would not safely scope subsequent pooled queries. Clients use `id`, not a nonexistent tenant_id column; login must locate an account before its tenant is known. Production should use a least-privileged database role: postgres superusers bypass RLS, so explicit predicates remain essential.

Cosine retrieval uses pgvector `<=>` rather than `<->` (Euclidean distance). Intent, retrieval and voice work run concurrently; champion selection waits only for the classified subtype. Persistence, quota increment and prompt-use tracking commit atomically. Since the supplied schema declares no composite prompt uniqueness constraint, an advisory transaction lock locates the record before a primary-key upsert. Feedback locks the generation and applies a rating delta, making repeat submissions idempotent. Prompt hashes include exact system/user strings; repeated exact prompts accrue usage. Champion eligibility is >=5 uses and >=60% positive ratings per use. No new champion instruction is inferred from ratings; only a stored `prompt_snapshot.addition` is used.

Suggested commit format: `feat(c1-api): implement content pipeline [C1-06]`, with corresponding c1-kb, c1-intent, c1-retrieval, c1-context and c1-generation scopes for separate work packages.

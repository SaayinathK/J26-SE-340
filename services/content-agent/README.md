# C1 Content Agent

Node.js 20 / Express service for tenant-scoped retrieval, Phi-3 classification and Mistral content generation. Uses the existing PostgreSQL schema plus the additive campaign migration.

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
npm run migrate:campaigns
npm start
```

The server prints `Server running on port 5001`. PostgreSQL 16 with pgvector and the supplied tables must already exist at the configured DATABASE_URL. Ollama must be running at OLLAMA_HOST. Replace the example JWT secret before deployment. Node's built-in fetch and crypto replace the unnecessary node-fetch and deprecated crypto packages.

## API

Register with `POST /api/auth/register` using `{ "name":"Demo", "email":"demo@example.com", "password":"a-long-local-password" }`. Login uses `POST /api/auth/login` with email/password. Responses include a JWT and registration also returns `client.id`, the tenant UUID. `GET /api/auth/me` returns the authenticated account. All other endpoints require `Authorization: Bearer <token>`.

| Method | Path | Body / response |
| --- | --- | --- |
| POST | /context/build | `{content_type, brief?, brand_voice_id?}` → `{success, context}` |
| POST | /content/generate | Same body → `{success, content_id, ...generatedFields, attempts, context_ids}` |
| POST | /content/feedback | `{generation_id, feedback:"positive"\|"negative"}` → `{success, performance}` |
| GET | /content/history | `{success, history:[]}`; latest 20 |
| GET | /health | Process liveness; does not assert dependency readiness |

Formats: meta_ad, funnel_page, email, social_post, vsl. The brief is optional (up to 10,000 characters). With no brief, the context engine prepares instructions for the selected format using the saved business profile. A saved profile is sufficient; knowledge entries and approved examples enrich it. Accounts without a profile need at least two KB matches and a brand voice, otherwise generation returns a 400 `missing` array directing the client to setup. History stores the effective brief, original user brief, and automatic/custom source. Invalid model JSON or format violations are retried three times, then return 502. Quota exhaustion returns 429. No quota is consumed on failed generation/persistence.

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

This makes 20 baseline Ollama calls and 20 authenticated context pipeline calls, consuming 20 generations. Share only the blinded JSON with reviewers; keep the randomized answer key private. Reviewers produce an array of `{ "id":"pair-id", "A":4, "B":3 }` records for all 20 pairs. Scores average factuality, relevance, brand fit and clarity on a 1–5 rubric. The evaluator compares the complete pipelines, including context pipeline validation retries. Explicit HTTP 502 responses are retried up to three times with backoff (configurable with `--attempts`). Each completed pair and pending baseline is saved atomically in a private checkpoint. If a failure persists, the evaluator prints the server error and a `--resume` command; completed pairs are not regenerated. Connection timeouts are not retried automatically because the server may have already persisted the generation; inspect history before resuming. Keep checkpoints private alongside the answer key. Runs interrupted with the older evaluator cannot recover unsaved baseline outputs. Training export includes only positive examples and performs no fine-tuning; files contain tenant content and should remain private.

## Tests and design

```sh
npm test
python3 -m compileall -q scripts
```

Jest tests use mocked DB and context dependencies to exercise HTTP contracts, authentication, invalid inputs, quota races and tenant parameters, plus real format validation/retry logic. They do not certify a live PostgreSQL/Ollama deployment. Live evidence scripts require those dependencies and a registered tenant.

Every tenant query runs on a checked-out connection with transaction-local `app.current_tenant` set before execution. Tenant-owned table reads/updates also include tenant predicates; inserts carry the authenticated tenant. A global pool SET would not safely scope subsequent pooled queries. Clients use `id`, not a nonexistent tenant_id column; login must locate an account before its tenant is known. Production should use a least-privileged database role: postgres superusers bypass RLS, so explicit predicates remain essential.

Cosine retrieval uses pgvector `<=>` rather than `<->` (Euclidean distance). Intent, retrieval and voice work run concurrently; champion selection waits only for the classified subtype. Persistence, quota increment and prompt-use tracking commit atomically. Since the supplied schema declares no composite prompt uniqueness constraint, an advisory transaction lock locates the record before a primary-key upsert. Feedback locks the generation and applies a rating delta, making repeat submissions idempotent. Prompt hashes include exact system/user strings; repeated exact prompts accrue usage. Champion eligibility is >=5 uses and >=60% positive ratings per use. No new champion instruction is inferred from ratings; only a stored `prompt_snapshot.addition` is used.

Suggested commit format: `feat(c1-api): implement content pipeline [C1-06]`, with corresponding c1-kb, c1-intent, c1-retrieval, c1-context and c1-generation scopes for separate work packages.

## AdBloom campaigns

Run `npm run migrate:campaigns` once against the configured DATABASE_URL before starting the updated service. It adds `content_campaigns` with tenant RLS; existing business settings and generations are preserved. The database role must be allowed to create the table and index.

- In Business settings, save reusable defaults, then create named campaigns with independent offers, audiences, and voices.
- `GET/POST /campaigns` lists/creates campaigns. `PUT /campaigns/:id` accepts `{name, profile, version}` and resets persona/winner/draft state when settings change; history remains intact.
- `POST /content/generate` accepts `campaign_id` and `generation_mode: "initial" | "winner"`. Initial output contains three personas. Winner mode requires a previously selected persona and returns one persona with ten hooks and three complete body options.
- `POST /campaigns/:id/winner` takes `{persona_index, version}`. Selection is manual, not evidence of Meta performance. The Learning page supports daily results and optional read-only Meta insights sync; see below.
- Each completed persona is checkpointed. Retry with unchanged campaign settings, instructions, knowledge and model to resume. Final history and quota are committed together only after the whole requested set validates. A per-campaign lock prevents concurrent generations or edits from mixing results.
- `GET /content/history?campaign_id=<uuid>` scopes history to a campaign. Legacy generations remain visible in the unfiltered history.
- The knowledge base remains shared business reference material. Campaign profile and voice override business defaults; approved examples are scoped to the selected campaign.

Creative generation uses Ollama JSON schemas, canonical CTA formatting, and targeted repairs that preserve valid hooks and body options. The model stays loaded for 15 minutes; short copy and winner-only requests reduce generated tokens. Wall-clock time depends on the local model and hardware.

## Continuous learning (purchases at the lowest cost)

Run `npm run migrate:campaigns` after updating. Migration 002 adds creative variants, daily metrics, revision evidence, and Meta connection metadata. It also reconciles historical feedback totals from the ratings actually stored on generations. Feedback now shares the generation transaction, supports corrections, and cannot double-count repeated requests. Prompt approval rates use rated generations; approval is separate from purchase performance.

Workflow:
1. Create a campaign and generate its initial three personas. The new initial generation establishes a fresh persona test. Old generations remain in history, but their performance cannot influence a different test.
2. Open **Learning** and register the exact persona / hook / body combination deployed in each fixed creative ad.
3. Enter daily results, import daily JSON objects, or map a verified Meta ad ID and sync. Reimporting the same variant/date replaces its totals. Do not copy campaign-wide totals into individual creative rows. Keep reporting timezone, attribution definition, currency, and targeting test consistent.
4. Evaluation happens after metric changes, before generation, and every 15 minutes while the backend runs. It compares shared reporting dates in the last 30 days, excluding the newest two days for attribution lag. Every persona needs at least 3 shared dates, 1,000 impressions, 10 purchases and positive spend. The leading cost per purchase must beat the runner-up by at least 20% and pass a conservative count-uncertainty guard. These are operational thresholds for observational data, not a guarantee of statistical or causal superiority.
5. Automatic selection stores the winning audience and an observed creative example as versioned prompt guidance. Winner-only generation uses that guidance. Initial/exploration generation does not use it. Expired, corrected, or insufficient evidence withdraws an automatic selection; manual selections pause automation. Re-enable automation in Learning when desired.

All guidance revisions have supporting evidence in `learning_revisions`; generations record the applied revision and prompt variant hash. **Model weights are not automatically retrained.** This pipeline adapts prompts and examples. Hook/body statistics describe the combinations in which they ran, not isolated causal effects.

### Optional Meta connection

No credentials are required for manual metrics. For live sync, an administrator must configure a tenant's read-only Marketing API token with access to the desired ad account. Store it in the backend environment under a dedicated name such as `META_TOKEN_CLIENT_A`; do not send tokens to the frontend, put them in CLI arguments, or commit them.

```sh
# From services/content-agent; token already set in environment or the ignored .env
node scripts/connect_meta.js TENANT_UUID AD_ACCOUNT_NUMERIC_ID META_TOKEN_CLIENT_A vXX.0
```

Replace `vXX.0` with a supported Graph API version for your Meta app. The command verifies account access and stores only the environment-variable name. Restart the backend after changing its environment. In Learning, map the exact static ad to its registered combination, then sync. No ads are created, published, or modified. Dynamic creative combinations are not automatically attributed to individual hook/body options.

Sync reads 30 days of daily insights with fixed `7d_click` / `1d_view` attribution and impression reporting time, takes only the aggregate `purchase` action (never adds overlapping purchase aliases), and uses `inline_link_clicks` for link CTR. It checks account ownership, follows pagination cursors on the fixed Graph host, validates all remote rows, and replaces a campaign's reporting window transactionally. Empty windows clear stale observations. Sync failures leave prior data intact for that campaign and appear on the Learning page. Expired tokens need administrator renewal. Live validation requires a real connected account; mocked adapter tests do not establish Meta approval or access.

Primary API references: [Meta's ad-insights collection](https://www.postman.com/meta/facebook-marketing-api/request/u07tack/get-ad-insights-l1), [Meta's generated insights fields](https://github.com/facebook/facebook-python-business-sdk/blob/main/facebook_business/adobjects/adsinsights.py).

### Verification

`npm test` covers decision thresholds, invalid reports, source/currency isolation, feedback deltas, Meta account checks and pagination, and existing content flows. `node scripts/smoke_learning.js` uses the real configured database and API with a deterministic model stub; it creates and removes its own disposable accounts. It verifies winner selection, guidance delivery, idempotent imports and ratings, correction withdrawal, manual override, and account isolation. Do not use it as an inference-quality benchmark.

## Evidence-backed personas from CRM research

Run `npm run migrate:campaigns` to add migration 003. **Customer research** stores campaign-scoped research findings and human claim reviews. It does not independently verify a CRM or declare a persona representative of the whole market.

Prepare anonymized, aggregated CRM summaries using the downloadable CSV template. Accepted columns are `source_reference,collected_on,sample_size,audience,finding,limitations`. Include report filters and provenance; the sample size is the records represented and may not be unique customers. Do not upload names, email addresses, phone numbers, or customer identifiers. This is a CSV import, not a live CRM connector. If a CRM only records transactions, use it for observed buying behavior; it does not establish motivations or pain points unless those were actually recorded.

Imports are previewed before submission. Exact duplicate rows are skipped, and each import is transactional. The system uses up to 12 recent active findings in the generation context, with bounded excerpts to limit inference context. Remaining claims stay hypotheses. A model is never allowed to mark its own persona as validated.

After initial generation, review each persona description and pain point. Link supporting or contradicting evidence with an exact excerpt and a written rationale. A human must confirm the review. All claims need supporting links and no recorded contradiction for the qualified label **research-supported, human-reviewed**. This is evidence coverage under the reviewer's assessment, not a statistical confidence score, causal claim, or independent authentication. Partial and conflicting findings remain visible.

Reviews are tied to the exact persona set. New initial personas or campaign profile changes require new reviews. Evidence can be withdrawn without destroying its audit record; current statuses are recalculated, drafts invalidated, and future winner-only outputs lose unsupported labels. Generated history retains its support status at generation time, so consult Customer research for the current assessment. Research support and purchase-performance winners are separate concepts.

Tests: `npm test`, `npm test --prefix client`, and `node scripts/smoke_research.js`. The last command creates disposable accounts against the configured local database and stubs model inference to test import deduplication, source delivery to generation, claim review, tenant isolation, evidence withdrawal, and stale-review rejection.

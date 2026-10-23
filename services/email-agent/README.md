# email-agent

The Learning center supports separate, opt-in **Mistral QLoRA fine-tuning** through an existing connected Colab GPU session. It includes tenant-scoped reviewed-example snapshots, expiring worker credentials, lease-based jobs, server evaluation, optional gated activation and rollback. See [Colab setup and limitations](../../docs/colab-qlora-automation.md). A public HTTPS app/API origin is still needed; this installation has not run GPU training.

Service-owned API, agent logic and persistence. UI code belongs in the single root frontend; training, notebooks and serving assets belong under ../../ml/email-agent. Gateway requests are authenticated with AGENT_GATEWAY_SECRET, bound to method/path/body and scoped to the current workspace. Standalone legacy auth endpoints are retained for compatibility; the web app uses gateway auth only.

`src/main.js` is the entrypoint. `db/migrations` owns schema changes; `db/seed` holds optional explicit seeds. `tests` holds component tests. No frontend or model binaries belong in this folder.

See [service map](../README.md) and [setup](../../docs/setup.md).

The [system database seeder](../../docs/database-seeding.md) populates labelled samples for the three existing demo tenants. Migration `009_sample_outcomes.sql` distinguishes synthetic outcomes from manually measured results. Performance separates the two; synthetic outcomes do not count toward learning readiness or training, and sample evaluation runs cannot be activated. Existing user records, model outputs and integration settings are preserved.

For the coaching and realty demo accounts, knowledge entries, model reconnection and campaign briefs, see the [PP1 demo guide](../../docs/email-agent-pp1-demo.md). `node scripts/setup-demo.cjs` previews the tenant-scoped setup; `--apply` adds the supplied facts and archives known obsolete gym seeds without deleting them. The compatibility `seed-kb.js` entrypoint uses the same workflow and no longer depends on an embedding server.

Knowledge sources can be archived and restored using `PATCH /api/email/knowledge/:id` with `{ "archived": true }` or `false`. Administrator knowledge permissions and tenant isolation apply. Snapshot `documents` contains active sources, while `archived_documents` preserves archived sources for the Knowledge page. Archived sources are excluded from generation and approval retrieval, including explicit source selections.

## Runtime grounding guardrails

`runGuardrails(emails, context)` checks commercial facts against retrieved workspace knowledge in addition to PII, opt-out text, spam phrases, and tone. It flags unsupported percentages, dollar amounts, multipliers, uppercase tokens containing digits or explicit code instructions, numbered scarcity claims, and relative deadline phrases as `HALLUCINATION`. Full normalized facts are compared, so `$2` is not authorized by `$20` and `SAVE20` is not authorized by `SAVE200`. Duplicate facts are reported once per email; STOP remains excluded.

Fresh coaching/realty inference also prompted bounded free-service offer checks (for example, “free coaching session” against “first session is free”), qualitative limited-spots patterns and relative expiry wording such as “expire in 48 hours.” Ordinary durations, follow-up timing, calendar years and “free time” remain outside those claim patterns. These checks do not verify every schedule, deadline wording, offer condition or qualitative assertion. [Fresh demo evidence](../../docs/evidence/pp1-live/README.md) preserves the original misses as well as the corrected drafts and retest.

Generation validates against the exact selected knowledge text supplied to its prompt. Manual creation, editing, and review approval retrieve the same tenant-scoped source selection before validation. Campaign goals, user-supplied context fields, system instructions, and engagement guidance do not authorize offers. `source=none` provides no grounding facts. Flags block approval, not work. Generation retries once on `HALLUCINATION` using the same knowledge snapshot and a shared 90-second model budget. Usable output returns HTTP 200 with persisted `guardrail_flags` and `review_status: "Needs review"` when flags remain. A failed retry preserves the first usable draft. Saving edits is allowed and returns fresh checks; approval rechecks current knowledge and returns HTTP 422 with `code: GUARDRAIL_REJECTED` for any unresolved flags. Malformed sequences and unavailable inference without a usable draft still return errors. Sending is not connected. The studio highlights flagged sentences in red in its saved preview; edit-mode flags refer to the last saved version until the next save.

The Tenant A regression replays `FIRSTMONTH`, `YOUNGPRO26`, `10%`, `first 10 sign-ups only`, and `until tomorrow at midnight` against the approved free-month/referral-credit context. All five are flagged; the approved `$20` credit passes. These are conservative lexical checks, not a semantic verifier of every claim, offer condition, negation, or paraphrase. The source text must still be accurate, and human review remains necessary. Historical notebook evaluation results and saved model weights are unchanged.

## Email studio and continuous learning

The studio provides overview, sequence builder, saved library, knowledge, performance, learning, and integration pages. Draft edits use optimistic sequence versions; review decisions are attached to the reviewed version; edits return it to Draft or Needs review according to the checks. Personalization previews substitute sample values locally without sending mail.

Migration `008_guardrail_drafts.sql` adds stored flags and the Needs review status. Migration `007_email_learning.sql` adds tenant-isolated aggregate outcomes, reviews, learning preferences, evaluated model runs, and future integration references. Run `node scripts/migrate-all.cjs` from the repository root before deploying the updated service. The migration runner verifies forced row-level security on the new tables as well as existing workspace records.

- `GET /api/email/insights`: recorded aggregate outcomes and human reviews.
- `PUT /api/email/sequences/:id/outcomes/:index`: replace measured counts for a sequence step, with outcome and sequence versions. Provenance is manual; repeated records are not added to the previous counts.
- `PUT /api/email/sequences/:id/review`: rate a saved version and mark it Reviewed or Needs changes.
- `GET /api/email/learning`: consent, dataset readiness, evaluation history, active guidance.
- `PUT /api/email/learning/settings`: administrator-managed opt-in and automatic-update preference.
- `POST /api/email/learning/train`: fit and evaluate a candidate on current data; unchanged datasets reuse the existing run.
- `POST /api/email/learning/runs/:id/activate`: activate a validated workspace candidate.
- `GET /api/email/integrations` and `PUT /api/email/integrations/:provider`: save GoHighLevel or Meta account references for future authorization. No secrets are collected, no external requests are sent, and connection status remains false.

The engagement learner is a Beta-binomial ranker over tone, subject-length bucket, and CTA-link presence. It trains on counts only, excluding email copy, recipient identifiers, and review notes. At least six measured email steps from three distinct sequences and 100 deliveries are required. Entire sequences are held out for evaluation; delivery-weighted squared error of aggregate click rates is compared against the training-set prior. Candidates that underperform the baseline cannot be activated. This metric is not LLM accuracy or a causal estimate of campaign uplift.

With consent and continuous updates enabled, recording changed outcomes trains a new candidate and activates it only if it passes evaluation. Active format guidance is added to future generation prompts, without overriding the requested tone or factual brand context. Disabling learning immediately removes active guidance. Learning stays within each workspace; it does not retrain Mistral/QLoRA weights or claim to implement the proposed XGBoost architecture. The separate QLoRA training and inference-evaluation tools remain under `ml/email-agent`.

Run `npm test` for model, guardrail, and identity unit checks. `scripts/verify-accounts.ps1` verifies account, sequence, review, outcome, learning, and integration behavior against a newly created temporary PostgreSQL database. It does not seed or reset the application's database. Browser verification is in `tests/e2e/verify-service-flow.cjs`.

## C4-09 measurement

Run `node services/email-agent/scripts/evaluate-guardrails.cjs` from the repository root. The 20 manually authored emails include 10 planted problems and 10 clean cases, with case-level results under [docs/evidence/c4-09](../../docs/evidence/c4-09/README.md). Neutral durations, calendar years, numbered guidance, authorized prices and promo codes are covered. This is a guardrail regression evaluation, not model accuracy. The browser verification also records a reconstructed FIRSTMONTH replay and checks draft saves, red highlighting and blocked approval.

pattern-based; numeric, code, scarcity and deadline claims are verified against tenant knowledge; qualitative claims (e.g. ‘certified coaches’) are not verified and are covered by human review before approval.

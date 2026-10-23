# C4-09 guardrail evidence

Manually authored evaluation fixtures, not a held-out model benchmark.

| Measure | Result |
| --- | --- |
| Planted problems detected | 10/10 |
| Recall | 100% |
| Clean emails flagged | 0/10 |
| False positive rate | 0% |

Recall requires every expected check type in a planted email to be detected. These small, hand-authored cases demonstrate the implementation; they do not establish production accuracy or fine-tuned model accuracy. See [case-level results](results.json) and the source fixture for exact inputs.

Run from the repository root: `node services/email-agent/scripts/evaluate-guardrails.cjs`.

Generation retries once on hallucination flags, using the same retrieved knowledge snapshot and sharing a 90-second model budget. A usable draft returns HTTP 200 even if flags remain; a failed retry preserves the previous usable draft. Draft saves return updated flags. Approval rechecks current tenant knowledge and returns HTTP 422 for unresolved flags. Sending is not connected. The model has not been retrained by this change.

pattern-based; numeric, code, scarcity and deadline claims are verified against tenant knowledge; qualitative claims (e.g. ‘certified coaches’) are not verified and are covered by human review before approval.

## Replay provenance

The FIRSTMONTH replay is reconstructed from the five claims reported by the user, not an archived raw model response. A screenshot of that replay is clearly labelled in the campaign brief. An original raw response is still needed to present this as captured real model output.

[Replay screenshot](replay.png) · [Workflow replay results](replay.json) · [20-email source fixture](../../../services/email-agent/tests/fixtures/c4-09-cases.json)

To regenerate the browser evidence with installed local dependencies and PostgreSQL available, run `npm --prefix frontend run build`, then `node tests/e2e/verify-service-flow.cjs --guardrail-only`. The runner creates and removes only its own temporary databases.

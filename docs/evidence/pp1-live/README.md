# Fresh Email Agent demo evidence — 23 October 2026

These files contain real `c4-email-ft` inference responses from the reconnected Colab tunnel, using the existing tenant-scoped service functions and database. Model responses were not mocked. These are a few diagnostic examples, not a model-accuracy benchmark. No sequence was approved or sent.

## Knowledge and connection

- Green Leaf Coaching (`tenant_a`): six active coaching sources; 15 duplicate gym seed sources archived and recoverable.
- Prime Realty Group (`tenant_b`): three active realty sources.
- The no-offer test temporarily archived the two coaching offer sources, leaving four active sources, then restored both afterwards. Final counts are six and three.
- The running Docker service reported `ready` for `c4-email-ft` after recreation with the user's updated tunnel URL.
- SLIIT accounts remain separate workspaces. Demo login accounts are `admin@tenant-a.com` and `admin@tenant-b.com`, using their existing passwords.

## Preserve the raw results

| Initial fresh inference | Original preflight | Initial flags | Flags on recheck after improvements |
| --- | --- | --- | --- |
| [Coaching welcome](tenant_a-0.json) | 4/5 | 0 | 1 |
| [Property valuation](tenant_b-0.json) | 4/5 | 0 | 2 |
| [Coaching without offers](tenant_a-3.json) | 3/5 | 0 | 3 |

The original JSON files retain the original flag arrays, output text and exact retrieved context. They are not silently replaced with the later corrected drafts. The initial outputs exposed missed free-service, scarcity and relative-expiry wording; these became regression tests and additional generic pattern checks. The appraisal wording also differed from the authorized home valuation. A promised welcome gift and other qualitative marketing claims required editorial review.

## Fresh retest with improved checks

The [updated no-offer response](updated-runtime/tenant_a-3.json) is another real inference run using the strengthened prompt and checks. It made two generation attempts and returned **five HALLUCINATION flags** across the three emails for unsupported free sessions and limited spots, with `review_status: "Needs review"`. This diagnostic retest was saved to evidence rather than creating another library draft.

The model also invented weekday/time arrangements and an “Ends Soon” subject. Those specific schedule and qualitative-deadline assertions are not covered by these patterns and require human review. Five detected flags do not mean every incorrect assertion was detected. Approval is blocked by the unresolved flags.

## Edited library drafts

| Draft | Saved version | Preflight | Flags | Approval |
| --- | --- | --- | --- | --- |
| [Coaching welcome](tenant_a-0-edited.json) | 2 | 5/5 | 0 | Draft; unapproved |
| [Property valuation](tenant_b-0-edited.json) | 2 | 5/5 | 0 | Draft; unapproved |
| [Coaching without offers](tenant_a-3-edited.json) | 2 | 5/5 | 0 | Draft; unapproved |

Editorial changes added missing action links, removed invented incentives and urgency, clarified authorized service wording and shortened subjects. The no-offer draft received a formal editorial rewrite based on its four-source context. Every edited sequence preserves days 0/3/7 and the unsubscribe footer. Each edited JSON includes the original-output reference, exact changes and rechecked flags.

The Prime Realty response and its supplied context contained no Green Leaf/coaching programme facts. This demonstrates tenant-scoped context selection in these runs; it is not a claim that a generative model can never invent another business's facts.

Preflight 5/5 measures editor completeness, opt-out text, personalization, action links and subject length. It is not factual accuracy. Pattern-based guardrails and human review remain separate requirements. The model weights were not retrained; only runtime checks and prompt instructions changed.

pattern-based; numeric, code, scarcity and deadline claims are verified against tenant knowledge; qualitative claims (e.g. ‘certified coaches’) are not verified and are covered by human review before approval.

See the [demo guide](../../email-agent-pp1-demo.md) for exact campaign briefs, accounts and the reversible no-offer workflow.

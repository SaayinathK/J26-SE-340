# Email Agent PP1 demo

Use the existing gateway accounts `admin@tenant-a.com` for **Green Leaf Coaching** and `admin@tenant-b.com` for **Prime Realty Group**, with their existing passwords. A SLIIT login belongs to a separate workspace and will correctly show different knowledge. Demo setup does not rename SLIIT, reset passwords, or switch the browser's signed-in user.

## Prepare the knowledge

From the repository root:

```powershell
node services/email-agent/scripts/setup-demo.cjs
node services/email-agent/scripts/setup-demo.cjs --apply
```

The first command previews changes. The second adds the six coaching sources and three realty sources from [the demo fixture](../services/email-agent/db/seed/pp1-demo.json). It archives only the known, obsolete gym seed texts in Green Leaf, preserving all original records. Repeating the command does not create duplicate sources. It restores archived demo offers, so run it before a demo, not during a no-offer test. The legacy `seed-kb.js` entrypoint now delegates to this same setup instead of adding gym facts or requiring an embedding model.

Archived sources remain visible under **Knowledge → Archived** and can be restored. They are excluded from All knowledge sources, selected-source retrieval, and approval checks. The demo uses the application's tenant-scoped text retrieval; it does not claim that a vector-search integration is connected.

## Reconnect the Colab model

If the saved tunnel hostname no longer resolves, restart the Colab **inference and tunnel** session and copy its fresh HTTPS origin. This workspace cannot restart a remote Colab session. The repository's QLoRA training notebook is a separate training workflow; model reconnection does not require retraining.

Set `OLLAMA_HOST` in `services/email-agent/.env` to that new origin, keeping the configured `OLLAMA_MODEL` unchanged. The endpoint must expose `/api/tags` and `/api/generate`, and `/api/tags` must list the configured model. A tunnel landing page alone is not a successful inference check.

```powershell
docker compose up -d --force-recreate --no-deps email-agent
```

Open [Email Studio](http://127.0.0.1:5173/#email-agent?view=builder), then click **Refresh**. Expect **AI writing available**. If the model is unavailable, generation remains disabled and manual editing remains usable. A working tunnel and a real inference response are required before claiming live model generation or model-output isolation evidence.

## Green Leaf Coaching tests

Sign in as `admin@tenant-a.com`. Confirm **Saved to Green Leaf Coaching** and **All knowledge sources (6)**. Choose one brief per generation and select **All knowledge sources**.

| Test | Campaign goal | Audience | Tone |
| --- | --- | --- | --- |
| Welcome / first session | Invite young professionals to book their free first coaching session and explain how coaching can help with career confidence. | Young professionals aged 25-35 in Colombo | Friendly |
| Re-engage | Re-engage past clients who have not booked a session in three months and invite them back to the Growth programme. | Past clients who completed the Starter programme | Professional |
| Referral | Encourage current clients to refer a friend so both get one free session. | Active clients in the Growth programme | Friendly |
| No offer | Introduce our evening online coaching sessions to busy managers. | Mid-career managers with long working hours | Formal |

Before **No offer**, archive **Coaching: current offer** and **Coaching: referral** in Knowledge. Confirm **All knowledge sources (4)**, then generate a fresh sequence. Archived offers cannot authorize a claim. Do not reuse a saved offer sequence as evidence of fresh no-offer generation. Restore both entries afterwards for the welcome and referral demos. Archiving is a reversible alternative to deleting the two entries.

## Prime Realty Group isolation test

Sign out and sign in as `admin@tenant-b.com`. Confirm **Saved to Prime Realty Group** and **All knowledge sources (3)**.

- Campaign goal: `Encourage homeowners to request a free property valuation.`
- Audience: `Homeowners in Colombo thinking of selling`
- Tone: **Professional**

Inspect all three generated emails for Prime Realty's property valuation, locations and client service. Check that they do not mention coaching, Starter/Growth/Leadership programmes or a free coaching session. Tenant-scoped retrieval prevents Green Leaf sources entering Prime Realty's context; model output still needs inspection for unsupported qualitative claims.

## Review the result

Expect three emails on days 0/3/7, each ending with the unsubscribe footer. Facts must come from the active tenant knowledge. Generation retries once if hallucination flags occur and preserves a reviewable draft if flags remain. Red sentences and flag details identify the detected issues; flags block approval, not saving edits.

For preflight 5/5, keep subjects at most 60 characters, include `{{first_name}}` and `{{cta_link}}` in each email, and retain the unsubscribe line. These are editor checks, not a factual-accuracy score. Save any edits to refresh server-side checks before approval. CRM import and sending are not connected.

pattern-based; numeric, code, scarcity and deadline claims are verified against tenant knowledge; qualitative claims (e.g. ‘certified coaches’) are not verified and are covered by human review before approval.

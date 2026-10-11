'use strict';
const BRAND_CONTEXT_LINE = 'Always address the reader with {{first_name}} and link actions to {{cta_link}}.';
function buildEmailPrompt(campaignGoal, audienceSegment, brandContext) {
  return 'Brand context:\n' + brandContext
    + '\n\nYou are an email marketing specialist.\n'
    + 'Write a 3-step email drip sequence for the following campaign.\n\n'
    + 'Campaign goal: ' + campaignGoal + '\n'
    + 'Audience: ' + audienceSegment + '\n\n'
    + 'Rules:\n'
    + '1. Each email must be relevant to the campaign goal and audience.\n'
    + '2. Keep each email body under 150 words.\n'
    + '3. REQUIRED: Every email body MUST end with this exact line:\n'
    + '   To unsubscribe from these emails, reply STOP or click here.\n'
    + '4. Do NOT omit the unsubscribe line from any email - it is legally required.\n'
    + '5. send_at_days: email 1 = 0, email 2 = 3, email 3 = 7.\n'
    + '6. Use ONLY prices, discounts and promo codes that appear in the brand context. If the context has no offer, do not invent one.\n\n'
    + 'Return ONLY valid JSON with no markdown:\n'
    + '{"emails":[{"email_index":1,"subject":"...","body":"...","send_at_days":0},{"email_index":2,"subject":"...","body":"...","send_at_days":3},{"email_index":3,"subject":"...","body":"...","send_at_days":7}]}';
}
module.exports = { buildEmailPrompt, BRAND_CONTEXT_LINE };

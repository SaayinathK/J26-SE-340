'use strict';
const { withTenant } = require('../lib/tenant');
const { uuid, text } = require('../lib/validation');
const { runGuardrails } = require('../agent/tools/guardrails');
const sequenceView = row => ({ ...row, updated: row.updated_at });
async function event(client, user, title, description, icon) {
  await client.query('INSERT INTO workspace_events (tenant_id, user_id, title, description, icon) VALUES ($1,$2,$3,$4,$5)', [user.tenant_id, user.user_id, title, description, icon]);
}
function validSequence(body) {
  if (!text(body.name, 500) || !text(body.audience, 150) || !['Friendly', 'Professional', 'Formal'].includes(body.tone) || !['all', 'none'].includes(body.source) && !uuid(body.source)) return 'Enter a goal, audience, tone, and valid knowledge source.';
  if (!Array.isArray(body.emails) || body.emails.length !== 3 || !body.emails.every((email, index) => email && email.email_index === index + 1 && email.send_at_days === [0, 3, 7][index] && text(email.subject, 200) && text(email.body, 12000))) return 'A sequence needs three emails with a subject, message, and day 0, 3, and 7 timing.';
  const check = runGuardrails(body.emails);
  if (!check.passed) return 'Sequence failed safety checks: ' + [...new Set(check.flags.map(flag => flag.check))].join(', ') + '. Review all three emails.';
  return null;
}
async function saveGenerated(user, body) {
  return withTenant(user.tenant_id, async client => {
    const { rows } = await client.query('INSERT INTO email_sequences (tenant_id,name,audience,tone,source,emails,origin) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [user.tenant_id, body.name, body.audience, body.tone, body.source, JSON.stringify(body.emails), 'ollama']);
    await event(client, user, 'Email sequence generated', body.name, 'sparkles');
    return sequenceView(rows[0]);
  });
}
module.exports = { uuid, text, event, validSequence, sequenceView, saveGenerated };

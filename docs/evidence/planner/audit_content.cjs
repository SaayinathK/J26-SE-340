'use strict';
const path = require('node:path');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const gateway = path.resolve(__dirname, '../../services/gateway');
const { runGuardrails } = require(path.join(gateway, 'src/services/guardrails'));
const { validSequence } = require(path.join(gateway, 'src/services/workspace'));
const footer = 'To unsubscribe from these emails, reply STOP or click here.';
const email = body => ({ email_index: 1, send_at_days: 0, subject: 'A useful introduction', body });
const cases = [
  ['safe template', 'Hello {{first_name}}, learn about our services. ' + footer, true],
  ['email PII', 'Contact jane@example.com. ' + footer, false],
  ['phone PII', 'Call 0771234567. ' + footer, false],
  ['missing unsubscribe', 'Hello {{first_name}}, learn about our services.', false],
  ['spam phrase', 'You can make money fast! ' + footer, false],
  ['excessive capitals', 'SPECIAL TODAY OFFER AMAZING VALUE ' + footer, false],
];
const report = { audit_date: '2026-10-21', guardrail_cases: [], limitations: [] };
for (const [name, body, expected] of cases) {
  const result = runGuardrails([email(body)]);
  assert.equal(result.passed, expected, name);
  report.guardrail_cases.push({ name, expected_pass: expected, actual_pass: result.passed, flags: result.flags.map(flag => flag.check) });
}
const sequence = body => ({ name: 'Audit only', audience: 'Subscribers', source: 'none', tone: 'Professional', emails: [0, 3, 7].map((day, index) => ({ ...email(body), email_index: index + 1, send_at_days: day })) });
const long = sequence(Array(155).fill('word').join(' ') + ' ' + footer);
const invented = sequence('Claim 90% off with code INVENTED90. ' + footer);
report.limitations.push({ name: '150-word body limit', body_words: long.emails[0].body.split(/\s+/).length, save_validator_error: validSequence(long), enforced: validSequence(long) !== null });
report.limitations.push({ name: 'source-grounded offer check', source: 'none', save_validator_error: validSequence(invented), rejected_by_save_validator: validSequence(invented) !== null });
const wrongDays = sequence('Hello {{first_name}}. ' + footer); wrongDays.emails[1].send_at_days = 4;
assert.notEqual(validSequence(wrongDays), null);
report.sequence_timing_validation = { wrong_day_rejected: true };
fs.writeFileSync(path.join(__dirname, 'checks/content-audit.json'), JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify(report, null, 2));

'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { renderEmailForLead } = require('../../src/services/templates');
const { runGuardrails } = require('../../src/agent/tools/guardrails');
test('required STOP footer does not count as promotional capitals', () => {
  const footer = 'To unsubscribe from these emails, reply STOP or click here.';
  assert.equal(runGuardrails([{ email_index: 1, subject: 'HELLO FROM TEAM', body: footer }]).passed, true);
  assert.equal(runGuardrails([{ email_index: 1, subject: 'HELLO FROM TEAM TODAY', body: footer }]).flags.some(flag => flag.check === 'TONE'), true);
});
test('delivery rendering replaces both tags without changing the reusable template', () => {
  const template = { subject: 'Hello {{first_name}}', body: 'Hi {{first_name}}, start here: {{cta_link}}' };
  const rendered = renderEmailForLead(template, { first_name: 'Alex', cta_link: 'https://example.com/start?lead=123' });
  assert.equal(rendered.subject, 'Hello Alex');
  assert.equal(rendered.body, 'Hi Alex, start here: https://example.com/start?lead=123');
  assert.ok(template.body.includes('{{cta_link}}'));
});
test('replacement treats dollar signs in lead names literally', () => {
  assert.equal(renderEmailForLead({ subject: '{{first_name}}', body: '{{cta_link}}' }, { first_name: 'A$&', cta_link: 'https://example.com/' }).subject, 'A$&');
});
test('delivery rendering rejects missing values, unsafe links, header injection, and unresolved tags', () => {
  const email = { subject: 'Hi {{first_name}}', body: '{{cta_link}}' };
  for (const values of [{}, { first_name: 'Alex', cta_link: 'javascript:alert(1)' }, { first_name: 'Alex', cta_link: 'https://user:password@example.com/' }, { first_name: 'Alex\r\nBcc: other', cta_link: 'https://example.com/' }]) assert.throws(() => renderEmailForLead(email, values));
  assert.throws(() => renderEmailForLead({ ...email, body: '{{unknown}}' }, { first_name: 'Alex', cta_link: 'https://example.com/' }));
});

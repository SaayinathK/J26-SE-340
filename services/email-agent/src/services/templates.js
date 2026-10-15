'use strict';
// Call at the delivery boundary with the actual lead and campaign link.
// Stored/generated sequences retain placeholders and can be reused safely.
function renderEmailForLead(email, { first_name, cta_link } = {}) {
  if (!email || typeof email.subject !== 'string' || typeof email.body !== 'string') throw new TypeError('An email subject and body are required.');
  if (typeof first_name !== 'string' || !first_name.trim() || first_name.trim().length > 80 || /[\r\n{}]/.test(first_name)) throw new TypeError('A valid lead first name is required.');
  let link;
  try { link = new URL(cta_link); } catch { throw new TypeError('A valid campaign action link is required.'); }
  if (!['https:', 'http:'].includes(link.protocol) || link.username || link.password) throw new TypeError('Use an HTTP or HTTPS campaign action link without embedded credentials.');
  const values = { first_name: first_name.trim(), cta_link: link.href };
  const replace = value => value.replace(/\{\{(first_name|cta_link)\}\}/g, (_match, key) => values[key]);
  const rendered = { ...email, subject: replace(email.subject), body: replace(email.body) };
  if (/\{\{[^{}]+\}\}/.test(rendered.subject + '\n' + rendered.body)) throw new TypeError('Resolve all email template tags before sending.');
  return rendered;
}
module.exports = { renderEmailForLead };

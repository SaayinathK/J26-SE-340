export const FOOTER = 'To unsubscribe from these emails, reply STOP or click here.';
export const steps = ['The introduction', 'Build the relationship', 'The next conversation'];
export const presets = [
  { name: 'Welcome series', icon: 'users', goal: 'Welcome new subscribers, introduce our business, and invite them to explore our services.', audience: 'New subscribers' },
  { name: 'Product introduction', icon: 'sparkles', goal: 'Introduce our product, explain its value, and invite interested customers to learn more.', audience: 'Interested prospects' },
  { name: 'Reconnect', icon: 'refresh', goal: 'Reconnect with previous customers, share useful updates, and invite them to get in touch.', audience: 'Previous customers' },
  { name: 'Lead nurture', icon: 'trend', goal: 'Help prospects understand our services, answer common questions, and invite a conversation.', audience: 'Warm leads' },
];
export const dateLabel = value => value ? new Date(value).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: 'numeric' }) : 'Not yet';
export const rate = (value, total) => total > 0 ? `${(value / total * 100).toFixed(1)}%` : '—';
export function totals(outcomes) { return outcomes.reduce((sum, row) => { for (const key of Object.keys(sum)) sum[key] += row[key] || 0; return sum; }, { delivered: 0, opened: 0, clicked: 0, replied: 0, unsubscribed: 0 }); }
export function qualityChecks(emails) {
  const hasEmails = emails.length === 3;
  return [
    { title: 'Complete sequence', detail: 'A subject and message for each email.', passed: hasEmails && emails.every(email => email.subject.trim() && email.body.trim()) },
    { title: 'Opt-out text', detail: 'An unsubscribe option in every message.', passed: hasEmails && emails.every(email => /unsubscribe|opt.?out|reply\s+stop/i.test(email.body)) },
    { title: 'Personalization', detail: 'A first-name placeholder in every message.', passed: hasEmails && emails.every(email => email.body.includes('{{first_name}}')) },
    { title: 'Clear next step', detail: 'An action-link placeholder in every message.', passed: hasEmails && emails.every(email => email.body.includes('{{cta_link}}')) },
    { title: 'Readable subjects', detail: 'Aim for subject lines of 60 characters or fewer.', passed: hasEmails && emails.every(email => email.subject.trim() && email.subject.length <= 60) },
  ];
}
export function renderPreview(value, name, link) { return value.replaceAll('{{first_name}}', name || 'Alex').replaceAll('{{cta_link}}', link || 'https://example.com/explore'); }

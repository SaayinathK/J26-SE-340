// frontend/src/features/lead-intel/lang.js — plain-English words for CRM values, model output and lead names

// ---------- demo names ----------
// The CRM dataset is anonymised (no names). To make the demo easy to read, every lead id gets a
// made-up display name. The same id always gives the same name. The real id is always shown too.
const FIRST = ['Amara', 'Nimal', 'Kavya', 'Ravi', 'Sara', 'Arjun', 'Maya', 'Dinesh', 'Priya', 'Kamal', 'Leena', 'Tharun',
  'Anika', 'Suresh', 'Nisha', 'Imran', 'Meera', 'Vikram', 'Fathima', 'Rohan', 'Ishara', 'Dilan', 'Asha', 'Kevin',
  'Zara', 'Nuwan', 'Divya', 'Ashan', 'Hiruni', 'Sahan', 'Tara', 'Yasir'];
const LAST = ['Perera', 'Fernando', 'Silva', 'Kumar', 'Nair', 'Jayasuriya', 'Rajapaksha', 'Menon', 'Iyer', 'Gunawardena',
  'Wickrama', 'Bandara', 'Khan', 'Reddy', 'Dias', 'Mendis', 'Sharma', 'Rao', 'Hussain', 'Ekanayake', 'Joseph', 'Pillai'];

function hash(s) {
  let h = 2166136261;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return h >>> 0;
}
export function leadName(id) {
  const h = hash(String(id));
  return `${FIRST[h % FIRST.length]} ${LAST[(h >>> 8) % LAST.length]}`;
}
export function initials(name) {
  return name.split(' ').map((w) => w[0]).join('').slice(0, 2).toUpperCase();
}
const HUES = [172, 190, 150, 205, 45, 330, 265, 20];
export const avatarColour = (id) => `hsl(${HUES[hash(String(id)) % HUES.length]} 70% 45%)`;

// ---------- segments ----------
export const SEGMENT = {
  hot: { label: 'Hot', plain: 'Ready to buy', tip: 'Very likely to become a customer. Contact first.' },
  warm: { label: 'Warm', plain: 'Interested', tip: 'Some interest. Send helpful information.' },
  cold: { label: 'Cold', plain: 'Not ready yet', tip: 'Low interest now. Keep in touch slowly.' },
};

// ---------- CRM values in simple words ----------
const ACTIVITY = {
  'Email Opened': 'Opened our email',
  'SMS Sent': 'We sent an SMS',
  'Olark Chat Conversation': 'Chatted on our website',
  'Page Visited on Website': 'Visited our website',
  'Converted to Lead': 'Became a lead',
  'Email Bounced': 'Email did not arrive',
  'Email Link Clicked': 'Clicked a link in our email',
  'Form Submitted on Website': 'Filled a form on our website',
  'Unreachable': 'Could not reach them',
  'Unsubscribed': 'Unsubscribed',
  'Had a Phone Conversation': 'Talked on the phone',
  'Approached upfront': 'We contacted them first',
  'View in browser link Clicked': 'Opened email in browser',
  'Email Received': 'Sent us an email',
  'Email Marked Spam': 'Marked our email as spam',
  'Visited Booth in Tradeshow': 'Met us at an event',
  'Resubscribed to emails': 'Subscribed again',
};
const SOURCE = {
  'Google': 'Google',
  'Direct Traffic': 'Came to our website directly',
  'Olark Chat': 'Website chat',
  'Organic Search': 'Search engine',
  'Reference': 'Referred by someone',
  'Welingak Website': 'Partner website',
  'Referral Sites': 'Another website',
  'Facebook': 'Facebook',
  'bing': 'Bing',
};
const ORIGIN = {
  'Landing Page Submission': 'Landing page form',
  'API': 'Added automatically',
  'Lead Add Form': 'Added by our team',
  'Lead Import': 'Imported list',
  'Quick Add Form': 'Quick add form',
};
export const activity = (v) => (v ? ACTIVITY[v] || v : 'No activity yet');
export const source = (v) => (v ? SOURCE[v] || v : 'Unknown');
export const origin = (v) => (v ? ORIGIN[v] || v : 'Unknown');
export const minutes = (sec) => (sec == null ? '–' : sec < 60 ? `${Math.round(sec)} sec` : `${Math.round(sec / 60)} min`);

// ---------- model factors (SHAP) in simple words ----------
const FEATURE = {
  time_on_site_sec: 'Time spent on our website',
  total_visits: 'Number of website visits',
  pages_per_visit: 'Pages looked at per visit',
  time_per_visit: 'Time spent per visit',
};
const CAT = { source: 'Came from', lead_origin: 'Added through', last_activity: 'Last action', occupation: 'Job',
  specialization: 'Field of study' };
export function factorText(feature) {
  const f = feature.replace(/^(num|cat)__/, '');
  if (FEATURE[f]) return FEATURE[f];
  for (const [k, label] of Object.entries(CAT)) {
    if (f.startsWith(k + '_')) {
      let v = f.slice(k.length + 1);
      if (k === 'last_activity') v = activity(v);
      if (k === 'source') v = source(v);
      if (k === 'lead_origin') v = origin(v);
      return `${label}: ${v === 'Unknown' ? 'not given' : v}`;
    }
  }
  return f.replace(/_/g, ' ');
}

// ---------- recommendation sources in simple words ----------
export function explainSource(s) {
  const t = s.text || '';
  if (s.type === 'business_context') {
    const m = t.match(/^([^:]+):\s*(.*)$/);
    return { kind: 'rule', title: m ? `Your business rule: ${m[1].toLowerCase()}` : 'Your business rule', body: m ? m[2] : t };
  }
  if (s.type === 'pattern') {
    const m = t.match(/leads with (.+?) '(.+?)' converted at (\d+)% \(n=(\d+)\), compared with the tenant average of (\d+)%/i);
    if (m) {
      const [, field, value, rate, n, avg] = m;
      const who = {
        'lead origin': `leads added through "${origin(value)}"`,
        'source': `leads who came from "${source(value)}"`,
        'last activity': `leads whose last action was "${activity(value)}"`,
        'occupation': `leads whose job is "${value}"`,
        'specialization': `leads interested in "${value}"`,
      }[field.toLowerCase()] || `leads with ${field} "${value}"`;
      return { kind: 'pattern', title: 'What your past data shows',
        body: `${rate} out of 100 ${who} became customers (based on ${n} leads). Your normal rate is ${avg} out of 100.` };
    }
    return { kind: 'pattern', title: 'What your past data shows', body: t.replace(/^Pattern:\s*/, '') };
  }
  // lead_profile: a similar past lead
  const won = /Outcome:\s*converted/i.test(t);
  const get = (re) => (t.match(re) || [])[1];
  const bits = [
    get(/Occupation:\s*([^.]+)\./) && `job: ${get(/Occupation:\s*([^.]+)\./)}`,
    get(/source\s+([^.]+?)\s+via/) && `came from: ${source(get(/source\s+([^.]+?)\s+via/))}`,
    get(/Last activity:\s*([^.]+)\./) && `last action: ${activity(get(/Last activity:\s*([^.]+)\./))}`,
  ].filter(Boolean);
  return { kind: won ? 'won' : 'lost', title: won ? 'A similar past lead became a customer' : 'A similar past lead did not buy',
    body: bits.length ? bits.join(' · ') : t };
}

// "Follow the hot-lead policy (S7): this lead should get a phone call within 24 hours. ..." -> plain sentence
export function simpleAction(rec) {
  if (rec.policy_rule) {
    const r = rec.policy_rule.replace(/^get(s)?\s+/i, 'Give them ').replace(/^go(es)? into\s+/i, 'Add them to ');
    return r.charAt(0).toUpperCase() + r.slice(1) + '.';
  }
  return (rec.next_best_action || '').replace(/\s*\(S\d+\)/g, '');
}

export function strength(c) {
  if (c == null) return { label: 'Unknown', cls: 'muted' };
  if (c >= 0.75) return { label: 'Strong match', cls: '' };
  if (c >= 0.6) return { label: 'Good match', cls: '' };
  return { label: 'Weak match', cls: 'warn' };
}

// "marketer@tenant-a.com" -> "Marketer"
export function displayName(email) {
  const n = (email || '').split('@')[0].replace(/[._-]+/g, ' ');
  return n.replace(/\b\w/g, (c) => c.toUpperCase());
}

const PII_REGEX = /\b(\+?\d[\d\s\-]{7,}\d|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\d{9,12})\b/g;
const SPAM_WORDS = ['free!!!', 'guaranteed income', 'act now!!!', 'limited time offer', 'click here now', 'make money fast'];

// Compare complete extracted facts rather than substrings: $2 is not supported
// by $20, 10% is not supported by 110%, and CODE20 is not CODE200.
function groundingFacts(text) {
  const claims = [];
  const add = (kind, value, canonical = value.toUpperCase()) => claims.push({ value, key: `${kind}:${canonical}` });
  for (const match of text.matchAll(/\d+(?:\.\d+)?\s*%|\$\s*\d[\d,]*(?:\.\d+)?|\b\d+(?:\.\d+)?\s*x\b/gi)) {
    const value = match[0];
    const compact = value.replace(/[\s,]/g, '').toLowerCase();
    const kind = compact.startsWith('$') ? 'money' : compact.endsWith('%') ? 'percent' : 'multiplier';
    const [whole, fraction = ''] = compact.replace(/[$%x]/g, '').split('.');
    const integer = whole.replace(/^0+(?=\d)/, '');
    const decimal = fraction.replace(/0+$/, '');
    // Keep arbitrary precision; Number() could equate distinct large amounts.
    add(kind, value, integer + (decimal ? '.' + decimal : ''));
  }
  // Bare tokens must contain digits; ordinary uppercase headlines are not codes.
  const codes = (text.match(/\b[A-Z][A-Z0-9_-]{4,}\b/g) || [])
    .filter(word => word !== 'STOP' && /\d/.test(word));
  for (const code of codes) add('code', code);
  // Explicit code instructions also cover mixed/lowercase codes.
  for (const match of text.matchAll(/\b(?:(?:use|enter|apply)\s+(?:the\s+)?(?:promo\s+|coupon\s+)?code|(?:promo(?:tional)?|coupon|discount)\s+code)\s*(?:is\s+|[:=]\s*)?["']?([A-Za-z][A-Za-z0-9_-]{3,})\b/gi)) {
    const before = text.slice(Math.max(0, match.index - 20), match.index);
    if (/\b(?:no|without)\s*$/i.test(before) || /^(?:required|needed|available|provided|exists)$/i.test(match[1])) continue;
    add('code', match[1]);
  }
  // A free service is a commercial offer even when it contains no digits.
  // Match bounded service nouns, avoiding neutral phrases such as "free time".
  const freeOffers = [
    /\bfree\s+(?:(?:first|initial|one|coaching|online|home|property|professional|welcome)\s+){0,3}(sessions?|consultations?|trials?|months?|valuations?|appraisals?|gifts?)\b/gi,
    /\b(sessions?|consultations?|trials?|months?|valuations?|appraisals?|gifts?)\s+(?:(?:is|are)\s+)?free\b/gi,
  ];
  for (const pattern of freeOffers) for (const match of text.matchAll(pattern)) {
    if (/\b(?:no|not|without|never)\s+(?:a\s+)?$/i.test(text.slice(Math.max(0,match.index - 20),match.index))) continue;
    add('free_offer',match[0],match[1].toLowerCase().replace(/s$/,''));
  }
  const restrictions = [
    /\b(?:first|only|last|remaining|limited\s+to)\s+\d[\d,]*\s+(?:(?:new|early)\s+)?(?:sign[-\s]?ups?|customers?|members?|spots?|places?|orders?|people|subscribers?)(?:\s+only)?\b/gi,
    /\b(?:until|by|before|ends?|expires?|valid\s+through)\s+(?:at\s+)?(?:today|tomorrow|tonight)(?:\s+(?:at|by))?(?:\s+(?:midnight|noon|\d{1,2}(?::\d{2})?\s*(?:a\.?m\.?|p\.?m\.?)))?\b/gi,
    /\b(?:ends?|expires?)\s+(?:within|in)\s+\d+\s+(?:minutes?|hours?|days?|weeks?)\b/gi,
    /\b(?:limited\s+(?:spots?|places?)(?:\s+available)?|(?:only\s+)?a\s+few\s+(?:spots?|places?)\s+(?:left|remaining))\b/gi,
  ];
  for (const pattern of restrictions) for (const match of text.matchAll(pattern)) {
    add('restriction', match[0], match[0].toLowerCase().replace(/sign[-\s]ups?/g, 'signups').replace(/\s+only$/, '').replace(/\s+/g, ' ').trim());
  }
  return [...new Map(claims.map(claim => [claim.key, claim])).values()];
}

function runGuardrails(emails, context = '') {
  const flags = [];
  const supported = new Set(groundingFacts(typeof context === 'string' ? context : '').map(claim => claim.key));

  for (const email of emails) {
    const text = `${email.subject} ${email.body}`;

    // 1. PII check
    PII_REGEX.lastIndex = 0;
    if (PII_REGEX.test(text))
      flags.push({ email_index: email.email_index, check: 'PII', detail: 'Personal info detected in email' });

    // 2. Unsubscribe check
    if (!/unsubscribe|opt.?out|reply\s+stop/i.test(email.body))
      flags.push({ email_index: email.email_index, check: 'UNSUBSCRIBE', detail: 'No unsubscribe option found' });

    // 3. Spam words
    for (const word of SPAM_WORDS) {
      if (text.toLowerCase().includes(word))
        flags.push({ email_index: email.email_index, check: 'SPAM', detail: `Spam phrase detected: "${word}"` });
    }

    // 4. Grounding: only retrieved knowledge can authorize commercial facts.
    // Campaign instructions, learning guidance and client-supplied context are
    // deliberately excluded by the callers.
    for (const fact of groundingFacts(text)) {
      if (!supported.has(fact.key)) {
        const occurrences = [];
        for (const field of ['subject','body']) {
          const value = email[field];
          let position = value.toLowerCase().indexOf(fact.value.toLowerCase());
          while (position !== -1) {
            occurrences.push({ field, start:position, end:position + fact.value.length, text:value.slice(position,position + fact.value.length) });
            position = value.toLowerCase().indexOf(fact.value.toLowerCase(),position + fact.value.length);
          }
        }
        flags.push({ email_index: email.email_index, check: 'HALLUCINATION', detail: `Ungrounded: ${fact.value}`, occurrences });
      }
    }

    // 5. Excessive caps (tone check)
    // STOP is the required opt-out keyword, not promotional emphasis.
    const capsWords = (text.match(/[A-Z]{4,}/g) || []).filter(word => word !== 'STOP').length;
    if (capsWords > 3)
      flags.push({ email_index: email.email_index, check: 'TONE', detail: `${capsWords} all-caps words detected` });
  }

  for (const flag of flags) {
    if (flag.occurrences) continue;
    const email = emails.find(item => item.email_index === flag.email_index);
    flag.occurrences = [];
    for (const field of ['subject','body']) {
      const value = email[field];
      const pattern = flag.check === 'PII' ? new RegExp(PII_REGEX.source,'g') : flag.check === 'TONE' ? /\b[A-Z]{4,}\b/g : null;
      if (pattern) for (const match of value.matchAll(pattern)) {
        if (flag.check === 'TONE' && match[0] === 'STOP') continue;
        flag.occurrences.push({ field,start:match.index,end:match.index + match[0].length,text:match[0] });
      }
      if (flag.check === 'SPAM') {
        const word = SPAM_WORDS.find(word => flag.detail === `Spam phrase detected: "${word}"`);
        let start = value.toLowerCase().indexOf(word);
        while (start !== -1) { flag.occurrences.push({ field,start,end:start + word.length,text:value.slice(start,start + word.length) }); start = value.toLowerCase().indexOf(word,start + word.length); }
      }
    }
  }
  return { passed: flags.length === 0, flags };
}

module.exports = { runGuardrails };

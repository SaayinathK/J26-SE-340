const PII_REGEX = /\b(\+?\d[\d\s\-]{7,}\d|[a-zA-Z0-9._%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}|\d{9,12})\b/g;
const SPAM_WORDS = ['free!!!', 'guaranteed income', 'act now!!!', 'limited time offer', 'click here now', 'make money fast'];

function runGuardrails(emails) {
  const flags = [];

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

    // 4. Excessive caps (tone check)
    const capsWords = (text.match(/[A-Z]{4,}/g) || []).length;
    if (capsWords > 3)
      flags.push({ email_index: email.email_index, check: 'TONE', detail: `${capsWords} all-caps words detected` });
  }

  return { passed: flags.length === 0, flags };
}

module.exports = { runGuardrails };
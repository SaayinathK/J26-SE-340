'use strict';
// Read examples on stdin and compare with the app's actual prompt builder.
const { buildEmailPrompt, BRAND_CONTEXT_LINE } = require('../../../services/email-agent/src/agent/prompts/emailPrompt');
const { runGuardrails } = require('../../../services/email-agent/src/agent/tools/guardrails');
let input = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', chunk => { input += chunk; });
process.stdin.on('end', () => {
  const results = JSON.parse(input).map(example => {
    const prompt = example.messages?.[0]?.content;
    const match = typeof prompt === 'string' && prompt.match(/^Brand context:\n([\s\S]*?)\n\nYou are an email marketing specialist\.[\s\S]*?\nCampaign goal: ([\s\S]*?)\nAudience: ([\s\S]*?)\n\nRules:/);
    let guardrails = false;
    try { const answer = JSON.parse(example.messages[1].content); guardrails = Array.isArray(answer.emails) && answer.emails.length === 3 && answer.emails.every((email, index) => email?.email_index === index + 1) && runGuardrails(answer.emails).passed; } catch {}
    return { prompt_matches_app: Boolean(match && buildEmailPrompt(match[2], match[3], match[1]) === prompt), fixed_context_line: Boolean(match && match[1].includes(BRAND_CONTEXT_LINE)), app_guardrails_pass: guardrails };
  });
  process.stdout.write(JSON.stringify(results));
});

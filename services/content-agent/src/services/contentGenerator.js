const llm = require('./llmService');
const CTAS = ['LEARN MORE','SIGN UP','GET TICKETS','REGISTER NOW','BOOK NOW'];
const formats = {
  meta_ad: { hook: 'string, max 125 characters', primary_text: 'string, max 280 characters', headline: 'string, max 40 characters', cta: CTAS.join('|') },
  funnel_page: { headline: 'string', subheadline: 'string', benefits: ['string'], social_proof: 'string', cta: 'string', urgency: 'string' },
  vsl: { hook_30s: 'string', problem: 'string', agitate: 'string', solution: 'string', proof: 'string', offer: 'string', cta: 'string' },
  social_post: { instagram: 'string', facebook: 'string', linkedin: 'string', hashtags: ['string'] },
  email: { subject: 'string', preview_text: 'string', body: 'string', cta: 'string' }
};
function validateAd(ad) {
  const errors = [];
  for (const [field, limit] of Object.entries({ hook:125, primary_text:280, headline:40 })) {
    if (typeof ad?.[field] !== 'string' || !ad[field].trim()) errors.push(`${field} is required`);
    else if ([...ad[field]].length > limit) errors.push(`${field} exceeds ${limit} characters`);
  }
  if (!CTAS.includes(ad?.cta)) errors.push('cta must be an allowed Meta CTA');
  return errors;
}
function fixAdLimits(ad) {
  if (!ad) return ad;
  const fixed = { ...ad };

  if (fixed.hook && [...fixed.hook].length > 125) {
    fixed.hook = [...fixed.hook].slice(0, 122).join('') + '...';
  }
  if (fixed.primary_text && [...fixed.primary_text].length > 280) {
    fixed.primary_text = [...fixed.primary_text].slice(0, 277).join('') + '...';
  }
  if (fixed.headline && [...fixed.headline].length > 40) {
    fixed.headline = [...fixed.headline].slice(0, 37).join('') + '...';
  }
  if (!fixed.cta || !['LEARN MORE','SIGN UP','GET TICKETS','REGISTER NOW','BOOK NOW'].includes(fixed.cta)) {
    fixed.cta = 'LEARN MORE';
  }

  return fixed;
}
function validateOutput(output, type) {
  if (type === 'meta_ad') return validateAd(output);
  return Object.entries(formats[type]).filter(([k,v]) => Array.isArray(v)
    ? !Array.isArray(output?.[k]) || !output[k].length || !output[k].every(x => typeof x === 'string' && x.trim())
    : typeof output?.[k] !== 'string' || !output[k].trim()).map(([k]) => `${k} is required`);
}
function buildPrompt(ctx, brief, type, errors = []) {
  const business = ctx.business_profile || '';
  const pastSection = ctx.past_examples ? `\n${ctx.past_examples}` : '';

  const limitWarning = type === 'meta_ad' ? `

CRITICAL RULES — MUST FOLLOW:
- hook: MAXIMUM 125 characters. Count every character. Cut words if needed.
- primary_text: MAXIMUM 280 characters. Write TWO SHORT SENTENCES ONLY. Stop at 280.
- headline: MAXIMUM 40 characters. FIVE WORDS MAXIMUM.
- cta: ONLY one of these exact values: LEARN MORE, SIGN UP, GET TICKETS, REGISTER NOW, BOOK NOW

EXAMPLE of correct primary_text length:
"Join 300 entrepreneurs at Elev8 Montreal. 2 days of real strategies, connections, and accountability. Only $497 — seats are limited."
That is under 280 characters. Match that length.
` : '';

  const systemPrompt = `You write marketing copy for a specific client business.

${business ? `=== THIS IS THE CLIENT YOU ARE WRITING FOR ===
${business}
=== WRITE EXCLUSIVELY FOR THIS BUSINESS. DO NOT REFERENCE ANY OTHER BUSINESS. ===` : ''}

Return JSON matching this schema: ${JSON.stringify(formats[type])}.
${limitWarning}${pastSection}
Use only the client business details above. Never invent facts.`;

  const userPrompt = JSON.stringify({
    brief,
    business_profile:  ctx.business_profile,
    brand_voice:       ctx.brand_voice,
    knowledge:         ctx.kb_entries,
    champion_addition: ctx.champion,
    intent:            ctx.intent,
    corrections:       errors,
  });

  return { systemPrompt, userPrompt };
}
async function generate(ctx, brief, type, errors = []) {
  const prompt = buildPrompt(ctx, brief, type, errors);
  const result = await llm.callLLM({ model: process.env.CONTENT_MODEL || 'mistral:7b-instruct-q4_K_M', prompt: prompt.systemPrompt + '\n' + prompt.userPrompt, maxTokens: 1800 });
  let output;
  try { output = JSON.parse(result.output); } catch { output = null; }
  return { output, tokensUsed: result.tokensUsed, ...prompt };
}
async function generateWithRetry(ctx, brief, contentType, maxAttempts = 3) {
  if (!formats[contentType]) throw Object.assign(new Error('Unsupported content_type'), { status:400 });
  if (!Number.isInteger(maxAttempts) || maxAttempts < 1 || maxAttempts > 5) throw new Error('Invalid maxAttempts');
  let errors = [], tokensUsed = 0;
  for (let attempts = 1; attempts <= maxAttempts; attempts++) {
    const result = await generate(ctx, brief, contentType, errors);
    tokensUsed += result.tokensUsed;
    errors = validateOutput(result.output, contentType);
    if (!errors.length) return { ...result, tokensUsed, attempts };
  }
// Apply truncation fallback instead of failing
const lastResult = await generate(ctx, brief, contentType, errors);
const fixed = contentType === 'meta_ad' ? fixAdLimits(lastResult.output) : lastResult.output;
return { ...lastResult, output: fixed, tokensUsed, attempts: maxAttempts };}
module.exports = { validateAd, generateWithRetry, buildPrompt,
  generateMetaAd: async (c,b) => (await generate(c,b,'meta_ad')).output,
  generateFunnelPage: async (c,b) => (await generate(c,b,'funnel_page')).output,
  generateVSL: async (c,b) => (await generate(c,b,'vsl')).output,
  generateSocialPost: async (c,b) => (await generate(c,b,'social_post')).output,
  generateEmail: async (c,b) => (await generate(c,b,'email')).output };

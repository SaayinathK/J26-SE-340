'use strict';
const { withTenant } = require('../lib/tenant');
const { request: modelRequest } = require('../clients/model_client');
const GEN_MODEL = process.env.OLLAMA_MODEL || 'mistral:7b-instruct-q4_K_M';
const { buildEmailPrompt, BRAND_CONTEXT_LINE } = require('./prompts/emailPrompt');
let statusCache;
let statusExpiry = 0;
async function modelStatus() {
  if (Date.now() < statusExpiry) return statusCache;
  try {
    const response = await modelRequest('/api/tags', { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('Provider unavailable');
    const data = await response.json();
    const installed = data.models?.some(model => model.name === GEN_MODEL || model.name === GEN_MODEL + ':latest');
    statusCache = { status: installed ? 'ready' : 'model_missing', model: GEN_MODEL };
  } catch { statusCache = { status: 'unavailable', model: GEN_MODEL }; }
  statusExpiry = Date.now() + 10000;
  return statusCache;
}
async function generateSequence(tenantId, campaignGoal, audienceSegment, options = {}) {
  const context = await withTenant(tenantId, async client => {
    const business = (await client.query('SELECT name FROM tenants WHERE tenant_id=$1', [tenantId])).rows[0]?.name;
    const documents = options.source === 'none' ? [] : (await client.query('SELECT text FROM knowledge_base WHERE tenant_id=$1 AND ($2::uuid IS NULL OR entry_id=$2) ORDER BY created_at DESC LIMIT 10', [tenantId, ['all', undefined].includes(options.source) ? null : options.source])).rows;
    if (options.source && !['all', 'none'].includes(options.source) && !documents.length) {
      const error = new Error('Knowledge source is unavailable in this workspace. Choose another source.'); error.status = 404; throw error;
    }
    const facts = documents.map(document => document.text).join('\n---\n').slice(0, 24000);
    return { business, hasDocuments: documents.length > 0, documents: [`${business} uses a ${(options.tone || 'Professional').toLowerCase()} tone.`, facts, BRAND_CONTEXT_LINE].filter(Boolean).join('\n---\n') };
  });
  const prompt = buildEmailPrompt(campaignGoal, audienceSegment, context.documents);
  let response;
  try {
    response = await modelRequest('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(90000),
      body: JSON.stringify({ model: GEN_MODEL, prompt, stream: false, format: 'json', options: { num_predict: 1800, temperature: 0.5 } }),
    });
  } catch {
    const error = new Error('The AI service is unavailable or timed out. Check Ollama and the configured model, then try again. You can still write and save a sequence manually.'); error.status = 503; throw error;
  }
  if (!response.ok) { const error = new Error('The AI model could not generate this sequence. Check the configured Ollama model and try again.'); error.status = 503; throw error; }
  try {
    const data = await response.json();
    const parsed = JSON.parse(data.response);
    const footer = 'To unsubscribe from these emails, reply STOP or click here.';
    const emails = Array.isArray(parsed.emails) ? parsed.emails.map(email => {
      if (!email || typeof email.body !== 'string' || !email.body.trim()) return email;
      const body = email.body.trimEnd();
      return { ...email, body: body.endsWith(footer) ? body : `${body}\n\n${footer}` };
    }) : parsed.emails;
    return { emails, model: GEN_MODEL, context_sources: context.hasDocuments ? 'workspace_text' : 'none' };
  } catch {
    const error = new Error('The AI service returned an invalid sequence. Try again or write your own draft.'); error.status = 502; throw error;
  }
}
module.exports = { generateSequence, modelStatus, buildEmailPrompt, BRAND_CONTEXT_LINE };

'use strict';
const { withTenant } = require('../lib/tenant');
const { request: modelRequest } = require('../clients/model_client');
const GEN_MODEL = process.env.OLLAMA_MODEL || 'mistral:7b-instruct-q4_K_M';
const { buildEmailPrompt, BRAND_CONTEXT_LINE } = require('./prompts/emailPrompt');
const { retrieveKnowledge } = require('../repositories/knowledgeContext');
const { runGuardrails } = require('./tools/guardrails');
const { sequenceStructureError } = require('../repositories/sequenceStore');
const {selectedModel}=require('../repositories/fineTuneStore');
let statusCache;
let statusExpiry = 0;
async function modelStatus(tenantId) {
  const selection=tenantId?await withTenant(tenantId,async client=>({model:await selectedModel(client),busy:(await client.query('SELECT auth_private.finetune_gpu_busy() AS busy')).rows[0].busy})):{model:GEN_MODEL,busy:false};
  if(selection.busy)return {status:'training',model:selection.model};
  const selected=selection.model;
  if (Date.now() < statusExpiry && statusCache?.model===selected) return statusCache;
  try {
    const response = await modelRequest('/api/tags', { signal: AbortSignal.timeout(2000) });
    if (!response.ok) throw new Error('Provider unavailable');
    const data = await response.json();
    const installed = data.models?.some(model => model.name === selected || model.name === selected + ':latest');
    statusCache = { status: installed ? 'ready' : 'model_missing', model: selected };
  } catch { statusCache = { status: 'unavailable', model: selected }; }
  statusExpiry = Date.now() + 10000;
  return statusCache;
}
async function generateSequence(tenantId, campaignGoal, audienceSegment, options = {}) {
  const { learningContext } = require('../repositories/learningStore');
  const context = await withTenant(tenantId, async client => {
    if((await client.query('SELECT auth_private.finetune_gpu_busy() AS busy')).rows[0].busy){const error=new Error('The connected GPU is training a language-model candidate. Manual drafting remains available. Try AI generation after training finishes.');error.status=503;throw error;}
    const model=await selectedModel(client);
    const business = (await client.query('SELECT name FROM tenants WHERE tenant_id=$1', [tenantId])).rows[0]?.name;
    const { facts, count } = await retrieveKnowledge(client, tenantId, options.source);
    const learned = await learningContext(client);
    const advisory = learned?.suggestions.length ? 'Workspace engagement guidance (advisory only; follow the requested tone and factual brand context): ' + learned.suggestions.join(' ') : '';
    return { business, facts, hasDocuments: count > 0, learned, model, documents: [`${business} uses a ${(options.tone || 'Professional').toLowerCase()} tone.`, facts, BRAND_CONTEXT_LINE, advisory].filter(Boolean).join('\n---\n') };
  });
  const basePrompt = buildEmailPrompt(campaignGoal, audienceSegment, context.documents);
  const deadline = Date.now() + 90000;
  let draft;
  for (let attempt = 1; attempt <= 2; attempt++) {
    const prompt = basePrompt + (draft ? '\n\nCORRECTION: Your previous draft contained unsupported claims: ' + draft.guardrail_flags.filter(flag => flag.check === 'HALLUCINATION').map(flag => flag.detail).join('; ') + '. Remove these claims. Use only facts in the brand context; do not invent replacements, codes, discounts, scarcity or deadlines. Return the complete JSON sequence.' : '');
    try {
      const emails = await requestDraft(prompt, Math.max(1, deadline - Date.now()),context.model);
      const structureError = sequenceStructureError({ name:campaignGoal, audience:audienceSegment, tone:options.tone || 'Professional', source:options.source || 'all', emails });
      if (structureError) { const error = new Error(structureError); error.status = 502; throw error; }
      const { flags } = runGuardrails(emails, context.facts);
      draft = { emails, guardrail_flags:flags, generation_attempts:attempt, retry_status:attempt === 1 ? 'not_needed' : 'completed' };
      if (!flags.some(flag => flag.check === 'HALLUCINATION')) break;
    } catch (error) {
      if (!draft) throw error;
      draft = { ...draft, generation_attempts:attempt, retry_status:'failed', retry_message:'The retry did not return a usable sequence. Your previous draft is available for review.' };
      break;
    }
  }
  return { ...draft, grounding_context:context.facts, model:context.model, context_sources:context.hasDocuments ? 'workspace_text' : 'none', learning_run_id:context.learned?.id || null };
}
async function requestDraft(prompt, timeout, model) {
  let response;
  try {
    response = await modelRequest('/api/generate', {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, signal: AbortSignal.timeout(timeout),
      body: JSON.stringify({ model, prompt, stream: false, format: 'json', options: { num_predict: 1800, temperature: 0.5 } }),
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
    return emails;
  } catch {
    const error = new Error('The AI service returned an invalid sequence. Try again or write your own draft.'); error.status = 502; throw error;
  }
}
module.exports = { generateSequence, modelStatus, buildEmailPrompt, BRAND_CONTEXT_LINE };

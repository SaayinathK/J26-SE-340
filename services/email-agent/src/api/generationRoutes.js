'use strict';
const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const { generateSequence } = require('../agent/generation');
const { text, uuid, validateSequence, saveGenerated } = require('../repositories/sequenceStore');
router.use(rateLimit({ windowMs: 60000, limit: 5, keyGenerator: req => req.user.user_id, message: { error: 'Please wait a minute before generating another sequence.' } }));
router.post('/', async (req, res) => {
  const { campaign_goal, audience_segment, tone = 'Professional', source = 'all' } = req.body || {};
  if (!text(campaign_goal, 500) || !text(audience_segment, 150) || !['Friendly', 'Professional', 'Formal'].includes(tone) || !['all', 'none'].includes(source) && !uuid(source)) return res.status(400).json({ error: 'Enter a valid campaign goal, audience, tone, and knowledge source.' });
  try {
    const result = await generateSequence(req.user.tenant_id, campaign_goal.trim(), audience_segment.trim(), { tone, source });
    const body = { name: campaign_goal.trim(), audience: audience_segment.trim(), tone, source, emails: result.emails, generation: { model: result.model, context_sources: result.context_sources, learning_run_id: result.learning_run_id, attempts:result.generation_attempts, retry_status:result.retry_status, retry_message:result.retry_message } };
    const validation = validateSequence(body, result.grounding_context);
    body.guardrail_flags = validation.flags;
    const sequence = await saveGenerated(req.user, body);
    res.json({ tenant_id: req.user.tenant_id, campaign_goal, audience_segment, ...sequence, guardrail_flags: validation.flags });
  } catch (error) {
    if (error.status) return res.status(error.status).json({ error: error.message });
    throw error;
  }
});
module.exports = router;

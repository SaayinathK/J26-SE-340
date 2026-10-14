const router = require('express').Router();
const { generateSequence } = require('../services/emailAgent');
const { runGuardrails } = require('../services/guardrails');

router.post('/sequence', async (req, res) => {
  const { campaign_goal, audience_segment } = req.body || {};

  if (!campaign_goal || !audience_segment)
    return res.status(400).json({ error: 'campaign_goal and audience_segment are required' });

  try {
    const result = await generateSequence(req.user.tenant_id, campaign_goal, audience_segment);
    const check = runGuardrails(result.emails);

    if (!check.passed)
      return res.status(422).json({ error: 'Guardrail violations', flags: check.flags, emails: result.emails });

    res.json({
      tenant_id: req.user.tenant_id,
      campaign_goal,
      audience_segment,
      emails: result.emails,
      guardrail_flags: []
    });

  } catch (e) {
    console.error('Email sequence error:', e.message);
    res.status(500).json({ error: 'Failed to generate email sequence' });
  }
});

module.exports = router;
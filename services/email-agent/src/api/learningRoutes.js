'use strict';
const router = require('express').Router();
const { withTenant } = require('../lib/tenant');
const { requirePermission } = require('../policies/rbac');
const { uuid, event, validateSequence } = require('../repositories/sequenceStore');
const { retrieveKnowledge } = require('../repositories/knowledgeContext');
const { settings, trainWorkspace, learningContext } = require('../repositories/learningStore');
const engagement = require('../services/engagementModel');
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.use(['/learning', '/insights', '/integrations', '/sequences/:id/outcomes/:index', '/sequences/:id/review'], requirePermission('email:generate'));
router.get('/integrations', async (req, res) => {
  const preferences = await withTenant(req.user.tenant_id, async client => (await client.query('SELECT provider,account_reference,version,updated_at FROM email_integration_preferences')).rows);
  res.json({ preferences, crm_connected: false, meta_connected: false, delivery_connected: false });
});
router.put('/integrations/:provider', requirePermission('workspace:manage'), async (req, res) => {
  const { account_reference = '', version } = req.body || {};
  if (!['gohighlevel','meta'].includes(req.params.provider) || typeof account_reference !== 'string' || !/^[a-zA-Z0-9_-]{0,100}$/.test(account_reference) || !Number.isInteger(version) || version < 0) return res.status(422).json({ error: 'Use an account reference of up to 100 letters, numbers, dashes, or underscores and the current version.' });
  const result = await withTenant(req.user.tenant_id, async client => {
    const saved = version === 0 ? await client.query('INSERT INTO email_integration_preferences (tenant_id,provider,account_reference) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING provider,account_reference,version', [req.user.tenant_id, req.params.provider, account_reference]) : await client.query('UPDATE email_integration_preferences SET account_reference=$1,version=version+1,updated_at=now() WHERE provider=$2 AND version=$3 RETURNING provider,account_reference,version', [account_reference,req.params.provider,version]);
    if (saved.rows[0]) await event(client, req.user, 'Integration preferences saved', req.params.provider + ' · connection pending', 'plug');
    return saved.rows[0];
  });
  if (!result) return res.status(409).json({ error: 'Connection preferences changed. Refresh and try again.' });
  res.json({ ...result, connected: false });
});
router.get('/insights', async (req, res) => {
  const result = await withTenant(req.user.tenant_id, async client => ({
    outcomes: (await client.query('SELECT o.*,s.name,s.tone FROM email_outcomes o JOIN email_sequences s ON s.id=o.sequence_id ORDER BY o.updated_at DESC')).rows,
    reviews: (await client.query("SELECT r.*,s.name,coalesce(s.generation->>'sample','false')='true' AS sample FROM email_reviews r JOIN email_sequences s ON s.id=r.sequence_id ORDER BY r.created_at DESC LIMIT 500")).rows,
  }));
  res.json({ ...result, delivery_connected: false, provenance: 'Each outcome identifies manual measurements or synthetic demo data.' });
});
router.get('/learning', async (req, res) => {
  const result = await withTenant(req.user.tenant_id, async client => ({
    settings: await settings(client), guidance: await learningContext(client),
    runs: (await client.query('SELECT id,status,algorithm,dataset_hash,sample_count,sequence_count,evaluation,created_at FROM email_learning_runs ORDER BY created_at DESC LIMIT 30')).rows,
    dataset: (await client.query("SELECT count(*)::int AS records,count(DISTINCT sequence_id)::int AS sequences,coalesce(sum(delivered),0)::int AS delivered FROM email_outcomes WHERE delivered>0 AND provenance='manual'")).rows[0],
    method: 'Tenant-specific Beta-binomial engagement ranking. No raw email content or recipient identifiers are used. LLM weights are not retrained by this loop.',
  }));
  res.json(result);
});
router.put('/learning/settings', requirePermission('workspace:manage'), async (req, res) => {
  const { enabled, auto_train, version } = req.body || {};
  if (typeof enabled !== 'boolean' || typeof auto_train !== 'boolean' || !Number.isInteger(version) || version < 0 || auto_train && !enabled) return res.status(400).json({ error: 'Provide valid learning consent, continuous-update preference, and version.' });
  const result = await withTenant(req.user.tenant_id, async client => {
    const updated = version === 0 ? await client.query('INSERT INTO email_learning_settings (tenant_id,enabled,auto_train) VALUES ($1,$2,$3) ON CONFLICT DO NOTHING RETURNING *', [req.user.tenant_id, enabled, auto_train]) : await client.query('UPDATE email_learning_settings SET enabled=$1,auto_train=$2,active_run_id=CASE WHEN $1 THEN active_run_id ELSE NULL END,version=version+1,updated_at=now() WHERE version=$3 RETURNING *', [enabled, auto_train, version]);
    if (updated.rows[0]) await event(client, req.user, enabled ? 'Workspace learning enabled' : 'Workspace learning paused', 'Learning preferences updated by an administrator.', 'shield');
    return updated.rows[0];
  });
  if (!result) return res.status(409).json({ error: 'Learning settings changed. Refresh and try again.' });
  res.json(result);
});
router.post('/learning/train', requirePermission('workspace:manage'), async (req, res) => {
  try { res.json(await withTenant(req.user.tenant_id, client => trainWorkspace(client, req.user))); }
  catch (error) { if (error.status) return res.status(error.status).json({ error: error.message }); throw error; }
});
router.post('/learning/runs/:id/activate', requirePermission('workspace:manage'), async (req, res) => {
  if (!uuid(req.params.id)) return res.status(400).json({ error: 'Invalid model run.' });
  const result = await withTenant(req.user.tenant_id, async client => {
    const config = await settings(client);
    if (!config.enabled) return null;
    const run = (await client.query("SELECT id FROM email_learning_runs WHERE id=$1 AND status='validated' AND coalesce(evaluation->>'synthetic','false') <> 'true'", [req.params.id])).rows[0];
    if (!run) return null;
    await client.query('UPDATE email_learning_settings SET active_run_id=$1,version=version+1,updated_at=now()', [run.id]);
    await event(client, req.user, 'Engagement model activated', 'Validated workspace guidance will inform future generations.', 'sparkles');
    return run;
  });
  if (!result) return res.status(409).json({ error: 'Enable learning and choose a validated run from this workspace.' });
  res.json(result);
});
router.put('/sequences/:id/outcomes/:index', async (req, res) => {
  const body = req.body || {};
  const counts = ['delivered','opened','clicked','replied','unsubscribed'];
  const index = Number(req.params.index);
  if (!uuid(req.params.id) || ![1,2,3].includes(index) || !Number.isInteger(body.version) || body.version < 0 || !Number.isInteger(body.sequence_version) || !counts.every(key => Number.isInteger(body[key]) && body[key] >= 0 && body[key] <= 10000000) || counts.slice(1).some(key => body[key] > body.delivered)) return res.status(422).json({ error: 'Enter non-negative whole counts. Engagement counts cannot exceed deliveries. Include the current sequence and outcome versions.' });
  const result = await withTenant(req.user.tenant_id, async client => {
    const sequence = (await client.query('SELECT * FROM email_sequences WHERE id=$1 AND version=$2 FOR UPDATE', [req.params.id, body.sequence_version])).rows[0];
    if (!sequence) return null;
    const prior = (await client.query('SELECT provenance FROM email_outcomes WHERE sequence_id=$1 AND email_index=$2',[sequence.id,index])).rows[0];
    if (prior?.provenance === 'synthetic') return {sample:true};
    const values = [req.user.tenant_id, sequence.id, index, sequence.version, ...counts.map(key => body[key]), JSON.stringify(engagement.features(sequence, index))];
    const query = body.version === 0 ? 'INSERT INTO email_outcomes (tenant_id,sequence_id,email_index,sequence_version,delivered,opened,clicked,replied,unsubscribed,features) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) ON CONFLICT DO NOTHING RETURNING *' : 'UPDATE email_outcomes SET sequence_version=$4,delivered=$5,opened=$6,clicked=$7,replied=$8,unsubscribed=$9,features=$10,version=version+1,updated_at=now() WHERE tenant_id=$1 AND sequence_id=$2 AND email_index=$3 AND version=$11 RETURNING *';
    const outcome = (await client.query(query, body.version === 0 ? values : [...values, body.version])).rows[0];
    if (outcome) {
      await event(client, req.user, 'Email outcomes recorded', `${sequence.name} · Email ${index} · manually entered aggregate counts`, 'activity');
      const config = await settings(client);
      if (config.enabled && config.auto_train) await trainWorkspace(client, req.user, { automatic: true });
    }
    return outcome;
  });
  if (result?.sample) return res.status(409).json({error:'Sample outcomes are read-only. Record measured results against a separate sequence.'});
  if (!result) return res.status(409).json({ error: 'Sequence or outcomes changed. Refresh before recording results.' });
  res.json(result);
});
router.put('/sequences/:id/review', async (req, res) => {
  const { version, rating, verdict, note = '' } = req.body || {};
  if (!uuid(req.params.id) || !Number.isInteger(version) || !Number.isInteger(rating) || rating < 1 || rating > 5 || !['Reviewed','Needs changes'].includes(verdict) || typeof note !== 'string' || note.length > 1000) return res.status(422).json({ error: 'Choose a rating from 1 to 5, a review decision, and a note up to 1,000 characters.' });
  const result = await withTenant(req.user.tenant_id, async client => {
    const sequence = (await client.query('SELECT * FROM email_sequences WHERE id=$1 AND version=$2 FOR UPDATE', [req.params.id, version])).rows[0];
    if (!sequence) return null;
    const { facts } = await retrieveKnowledge(client, req.user.tenant_id, sequence.source);
    const validation = validateSequence(sequence, facts);
    if (validation.error && verdict === 'Reviewed') {
      await client.query("UPDATE email_sequences SET review_status='Needs review',guardrail_flags=$1,guardrail_checked_at=now() WHERE id=$2", [JSON.stringify(validation.flags),sequence.id]);
      return { validation };
    }
    await client.query('UPDATE email_sequences SET review_status=$1,guardrail_flags=$4,guardrail_checked_at=now() WHERE id=$2 AND version=$3', [verdict, sequence.id, version,JSON.stringify(validation.flags)]);
    const review = (await client.query('INSERT INTO email_reviews (tenant_id,sequence_id,sequence_version,user_id,rating,verdict,note) VALUES ($1,$2,$3,$4,$5,$6,$7) ON CONFLICT (sequence_id,sequence_version,user_id) DO UPDATE SET rating=EXCLUDED.rating,verdict=EXCLUDED.verdict,note=EXCLUDED.note,created_at=now() RETURNING *', [req.user.tenant_id, sequence.id, version, req.user.user_id, rating, verdict, note.trim()])).rows[0];
    await event(client, req.user, 'Email sequence reviewed', `${verdict} · ${rating}/5`, 'checks');
    return review;
  });
  if (!result) return res.status(409).json({ error: 'This sequence changed. Reload the current version before reviewing.' });
  if (result.validation) return res.status(422).json({ error: result.validation.error, code: 'GUARDRAIL_REJECTED', guardrail_flags: result.validation.flags });
  res.json(result);
});
module.exports = router;

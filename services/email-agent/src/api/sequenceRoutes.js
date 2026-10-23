'use strict';
const router = require('express').Router();
const { withTenant } = require('../lib/tenant');
const { uuid, event, validateSequence, sequenceStructureError, sequenceView } = require('../repositories/sequenceStore');
const { retrieveKnowledge } = require('../repositories/knowledgeContext');
async function saveSequence(req, res) {
  const body = req.body || {};
  const error = sequenceStructureError(body);
  if (error) return res.status(422).json({ error });
  if (req.params.id && (!uuid(req.params.id) || !Number.isInteger(body.version))) return res.status(400).json({ error: 'Invalid sequence version.' });
  const sequence = await withTenant(req.user.tenant_id, async client => {
    if (uuid(body.source) && !(await client.query("SELECT 1 FROM knowledge_base WHERE entry_id=$1 AND coalesce(metadata->>'archived','false') <> 'true'", [body.source])).rowCount) return null;
    const { facts } = await retrieveKnowledge(client, req.user.tenant_id, body.source);
    const validation = validateSequence(body, facts);
    const reviewStatus = validation.flags.length ? 'Needs review' : 'Draft';
    let result;
    if (req.params.id) result = await client.query('UPDATE email_sequences SET name=$1,audience=$2,tone=$3,source=$4,emails=$5,review_status=$8,guardrail_flags=$9,guardrail_checked_at=now(),version=version+1,updated_at=now() WHERE id=$6 AND version=$7 RETURNING *', [body.name.trim(), body.audience.trim(), body.tone, body.source, JSON.stringify(body.emails), req.params.id, body.version,reviewStatus,JSON.stringify(validation.flags)]);
    else result = await client.query('INSERT INTO email_sequences (tenant_id,name,audience,tone,source,emails,origin,guardrail_flags,review_status,guardrail_checked_at) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,now()) RETURNING *', [req.user.tenant_id, body.name.trim(), body.audience.trim(), body.tone, body.source, JSON.stringify(body.emails), 'manual',JSON.stringify(validation.flags),reviewStatus]);
    if (result.rows[0]) await event(client, req.user, 'Email sequence saved', body.name.trim(), 'sparkles');
    return result.rows[0];
  });
  if (!sequence) return res.status(409).json({ error: 'Sequence is unavailable or changed in another session. Reload it before saving.' });
  res.status(req.params.id ? 200 : 201).json(sequenceView(sequence));
}
router.post('/', saveSequence);
router.put('/:id', saveSequence);
router.delete('/:id', async (req, res) => {
  if (!uuid(req.params.id) || !Number.isInteger(req.body?.version)) return res.status(400).json({ error: 'Invalid sequence version.' });
  const removed = await withTenant(req.user.tenant_id, async client => {
    const { rows } = await client.query('DELETE FROM email_sequences WHERE id=$1 AND version=$2 RETURNING name', [req.params.id, req.body.version]);
    if (rows[0]) await event(client, req.user, 'Email sequence removed', rows[0].name, 'sparkles');
    return rows.length;
  });
  if (!removed) return res.status(409).json({ error: 'Sequence is unavailable or changed. Refresh and try again.' });
  res.json({ message: 'Sequence removed.' });
});
module.exports = router;

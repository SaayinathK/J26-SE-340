'use strict';
const router = require('express').Router();
const { withTenant } = require('../services/session');
const { permissionsFor, requirePermission } = require('../policies/rbac');
const { uuid, text, event } = require('../services/workspace');
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/snapshot', requirePermission('campaigns:read'), async (req, res) => {
  const permissions = permissionsFor(req.user.role);
  const snapshot = await withTenant(req.user.tenant_id, async client => {
    const campaigns = (await client.query('SELECT * FROM campaigns ORDER BY created_at DESC LIMIT 1000')).rows.map(row => ({ ...row, sent: null, open: null, click: null, color: 'teal' }));
    const documents = permissions.includes('knowledge:read') ? (await client.query('SELECT entry_id AS id, type, text, metadata, created_at FROM knowledge_base ORDER BY created_at DESC LIMIT 500')).rows.map(row => ({ id: row.id, type: row.type || 'Business context', text: row.text || '', name: row.metadata?.name || row.type || 'Knowledge source', size: `${Math.max(1, Math.ceil(Buffer.byteLength(row.text || '') / 1024))} KB`, added: row.created_at, created_at: row.created_at })) : [];
    const sequences = permissions.includes('email:generate') ? (await client.query('SELECT * FROM email_sequences ORDER BY updated_at DESC LIMIT 500')).rows.map(row => ({ ...row, updated: row.updated_at })) : [];
    const activities = (await client.query('SELECT id, title, description, icon, created_at FROM workspace_events WHERE ($1::boolean OR icon = $2) ORDER BY created_at DESC LIMIT 100', [permissions.includes('monitoring:read'), 'mail'])).rows;
    const totals = (await client.query(`SELECT
      (SELECT count(*)::int FROM campaigns) AS campaigns,
      (SELECT count(*)::int FROM campaigns WHERE status='Draft') AS drafts,
      (SELECT count(*)::int FROM campaigns WHERE status='Archived') AS archived,
      CASE WHEN $1::boolean THEN (SELECT count(*)::int FROM email_sequences) ELSE NULL END AS sequences,
      CASE WHEN $2::boolean THEN (SELECT count(*)::int FROM knowledge_base) ELSE NULL END AS documents`, [permissions.includes('email:generate'), permissions.includes('knowledge:read')])).rows[0];
    const campaignDays = (await client.query("SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_at, count(*)::int AS count FROM campaigns WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '29 days') AT TIME ZONE 'UTC' GROUP BY 1 ORDER BY 1")).rows;
    const sequenceDays = permissions.includes('email:generate') ? (await client.query("SELECT to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS created_at, count(*)::int AS count FROM email_sequences WHERE created_at >= (date_trunc('day', now() AT TIME ZONE 'UTC') - interval '29 days') AT TIME ZONE 'UTC' GROUP BY 1 ORDER BY 1")).rows : [];
    return { campaigns, documents, sequences, activities, totals, daily: { campaigns: campaignDays, sequences: sequenceDays } };
  });
  res.json({ ...snapshot, synced_at: new Date().toISOString(), delivery_connected: false, refresh_interval_ms: 5000 });
});
router.get('/status', requirePermission('monitoring:read'), async (_req, res) => {
  const started = Date.now();
  await withTenant(_req.user.tenant_id, client => client.query('SELECT 1'));
  const database = { status: 'connected', latency_ms: Date.now() - started };
  res.json({ gateway: 'connected', database, ai: { status: 'external_application', model: null }, delivery: { status: 'not_connected' }, agents: { strategy: 'not_connected', content: 'not_connected', lead_intelligence: 'not_connected' }, checked_at: new Date().toISOString() });
});
router.post('/campaigns', requirePermission('campaigns:write'), async (req, res) => {
  const { name, audience } = req.body || {};
  if (!text(name, 100) || !text(audience, 150)) return res.status(400).json({ error: 'Enter a campaign name and audience (up to 100 and 150 characters).' });
  const campaign = await withTenant(req.user.tenant_id, async client => {
    const { rows } = await client.query('INSERT INTO campaigns (tenant_id,name,audience) VALUES ($1,$2,$3) RETURNING *', [req.user.tenant_id, name.trim(), audience.trim()]);
    await event(client, req.user, 'Campaign created', name.trim(), 'mail');
    return rows[0];
  });
  res.status(201).json(campaign);
});
router.patch('/campaigns/:id', requirePermission('campaigns:write'), async (req, res) => {
  const { status, version } = req.body || {};
  if (!uuid(req.params.id) || !['Draft', 'Archived'].includes(status) || !Number.isInteger(version)) return res.status(400).json({ error: 'Choose a valid draft or archived campaign. Sending is not connected.' });
  const campaign = await withTenant(req.user.tenant_id, async client => {
    const { rows } = await client.query('UPDATE campaigns SET status=$1, version=version+1, updated_at=now() WHERE id=$2 AND version=$3 RETURNING *', [status, req.params.id, version]);
    if (rows[0]) await event(client, req.user, 'Campaign ' + status.toLowerCase(), rows[0].name, 'mail');
    return rows[0];
  });
  if (!campaign) return res.status(409).json({ error: 'Campaign is unavailable or changed in another session. Refresh and try again.' });
  res.json(campaign);
});
router.post('/knowledge', requirePermission('knowledge:write'), async (req, res) => {
  const { name, type, text: content } = req.body || {};
  if (!text(name, 100) || !text(type, 80) || !text(content, 200 * 1024) || Buffer.byteLength(content) > 200 * 1024) return res.status(400).json({ error: 'Add a name, type, and text content up to 200 KB.' });
  const document = await withTenant(req.user.tenant_id, async client => {
    const { rows } = await client.query('INSERT INTO knowledge_base (tenant_id,type,text,metadata) VALUES ($1,$2,$3,$4) RETURNING entry_id AS id', [req.user.tenant_id, type.trim(), content.trim(), JSON.stringify({ name: name.trim() })]);
    await event(client, req.user, 'Knowledge source added', name.trim(), 'file');
    return rows[0];
  });
  res.status(201).json(document);
});
router.delete('/knowledge/:id', requirePermission('knowledge:write'), async (req, res) => {
  if (!uuid(req.params.id)) return res.status(400).json({ error: 'Invalid knowledge source.' });
  const removed = await withTenant(req.user.tenant_id, async client => {
    const { rows } = await client.query('DELETE FROM knowledge_base WHERE entry_id=$1 RETURNING metadata', [req.params.id]);
    if (rows[0]) await event(client, req.user, 'Knowledge source removed', rows[0].metadata?.name || 'Knowledge source', 'file');
    return rows.length;
  });
  if (!removed) return res.status(404).json({ error: 'Knowledge source not found.' });
  res.json({ message: 'Knowledge source removed.' });
});
module.exports = router;

'use strict';
const router = require('express').Router();
const { withTenant } = require('../services/session');
const { permissionsFor, requirePermission } = require('../policies/rbac');
const { uuid, text, event } = require('../repositories/sequenceStore');
const { modelStatus } = require('../agent/generation');
router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/snapshot', async (req, res) => {
  const permissions = permissionsFor(req.user.role);
  const snapshot = await withTenant(req.user.tenant_id, async client => {
    const documents = permissions.includes('knowledge:read') ? (await client.query('SELECT entry_id AS id, type, text, metadata, created_at FROM knowledge_base ORDER BY created_at DESC LIMIT 500')).rows.map(row => ({ id: row.id, type: row.type || 'Business context', text: row.text || '', name: row.metadata?.name || row.type || 'Knowledge source', size: `${Math.max(1, Math.ceil(Buffer.byteLength(row.text || '') / 1024))} KB`, added: row.created_at, created_at: row.created_at })) : [];
    const sequences = permissions.includes('email:generate') ? (await client.query('SELECT * FROM email_sequences ORDER BY updated_at DESC LIMIT 500')).rows.map(row => ({ ...row, updated: row.updated_at })) : [];
    const activities = permissions.includes('email:generate') ? (await client.query('SELECT id, title, description, icon, created_at FROM workspace_events ORDER BY created_at DESC LIMIT 100')).rows : [];
    return { documents, sequences, activities, campaigns: [] };
  });
  res.json({ ...snapshot, delivery_connected: false, synced_at: new Date().toISOString() });
});
router.get('/status', requirePermission('email:generate'), async (req, res) => {
  await withTenant(req.user.tenant_id, client => client.query('SELECT 1'));
  res.json({ service: 'email-agent', database: { status: 'connected' }, ai: await modelStatus() });
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

'use strict';
const router = require('express').Router();
const crypto = require('node:crypto');
const authenticate = require('../middleware/auth');
const audit = require('../middleware/audit');
const { requirePermission } = require('../policies/rbac');
const { hash, withTenant } = require('../services/session');
const roles = ['agency_admin', 'marketer', 'viewer'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
router.use(authenticate, audit('team_management'), requirePermission('team:manage'));
router.get('/', async (req, res) => {
  const result = await withTenant(req.user.tenant_id, async client => {
    const members = await client.query('SELECT user_id AS id, display_name AS name, email, role, is_active, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at', [req.user.tenant_id]);
    const invitations = await client.query('SELECT invitation_id AS id, email, role, expires_at FROM workspace_invitations WHERE tenant_id = $1 AND accepted_at IS NULL AND expires_at > now() ORDER BY created_at DESC', [req.user.tenant_id]);
    return { members: members.rows, invitations: invitations.rows };
  });
  res.set('Cache-Control', 'no-store').json(result);
});
router.post('/invitations', async (req, res) => {
  const { email, role } = req.body || {};
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !roles.includes(role)) return res.status(400).json({ error: 'A valid email and workspace role are required.' });
  const token = crypto.randomBytes(32).toString('hex');
  await withTenant(req.user.tenant_id, async client => {
    await client.query('DELETE FROM workspace_invitations WHERE tenant_id = $1 AND lower(email) = $2 AND accepted_at IS NULL', [req.user.tenant_id, email.trim().toLowerCase()]);
    await client.query('INSERT INTO workspace_invitations (tenant_id, email, role, token_hash, created_by) VALUES ($1, $2, $3, $4, $5)', [req.user.tenant_id, email.trim().toLowerCase(), role, hash(token), req.user.user_id]);
  });
  const origin = (process.env.CLIENT_ORIGINS || 'http://localhost:5173').split(',')[0].trim();
  res.status(201).json({ invitation_url: `${origin}/#register?invite=${token}`, message: 'Invitation created. Share this single-use link with the intended recipient. No email has been sent.' });
});
router.patch('/:id', async (req, res) => {
  const { role, is_active } = req.body || {};
  if (!uuid.test(req.params.id) || (!roles.includes(role) && typeof is_active !== 'boolean') || (role != null && !roles.includes(role))) return res.status(400).json({ error: 'Choose a valid member and role.' });
  if (req.params.id === req.user.user_id) return res.status(400).json({ error: 'You cannot change your own role or deactivate your own account.' });
  const result = await withTenant(req.user.tenant_id, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [req.user.tenant_id]);
    const actor = await client.query('SELECT role FROM users WHERE user_id = $1 AND tenant_id = $2 AND is_active = true', [req.user.user_id, req.user.tenant_id]);
    if (actor.rows[0]?.role !== 'agency_admin') return { status: 403, error: 'Administrator access is required.' };
    const target = await client.query('SELECT role, is_active FROM users WHERE user_id = $1 AND tenant_id = $2 FOR UPDATE', [req.params.id, req.user.tenant_id]);
    if (!target.rows[0]) return { status: 404, error: 'Member not found in this workspace.' };
    if (target.rows[0].role === 'agency_admin' && target.rows[0].is_active && (is_active === false || (role && role !== 'agency_admin'))) {
      const count = await client.query("SELECT count(*)::int AS count FROM users WHERE tenant_id = $1 AND role = 'agency_admin' AND is_active = true", [req.user.tenant_id]);
      if (count.rows[0].count <= 1) return { status: 409, error: 'The workspace must keep an active administrator.' };
    }
    const updated = await client.query('UPDATE users SET role = COALESCE($1, role), is_active = COALESCE($2, is_active) WHERE user_id = $3 AND tenant_id = $4 RETURNING user_id AS id, display_name AS name, email, role, is_active', [role || null, typeof is_active === 'boolean' ? is_active : null, req.params.id, req.user.tenant_id]);
    if (is_active === false) await client.query('DELETE FROM auth_sessions WHERE user_id = $1 AND tenant_id = $2', [req.params.id, req.user.tenant_id]);
    return { member: updated.rows[0] };
  });
  if (result.error) return res.status(result.status).json({ error: result.error });
  return res.json(result);
});
module.exports = router;

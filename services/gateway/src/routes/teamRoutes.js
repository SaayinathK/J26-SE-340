'use strict';
const router = require('express').Router();
const crypto = require('node:crypto');
const authenticate = require('../middleware/auth');
const audit = require('../middleware/audit');
const { requirePermission } = require('../policies/rbac');
const { hash, withTenant } = require('../services/session');
const {applicationOrigin} = require('../services/invitations');
const mail=require('../services/invitationMail');
const invitationLimit=require('express-rate-limit').rateLimit({windowMs:900000,limit:20,keyGenerator:req=>req.user.user_id,standardHeaders:'draft-8',legacyHeaders:false,message:{error:'Please wait before sending more invitations.'}});
const roles = ['agency_admin', 'marketer', 'viewer'];
const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/i;
router.use(authenticate, audit('team_management'), requirePermission('team:manage'));
router.get('/', async (req, res) => {
  const result = await withTenant(req.user.tenant_id, async client => {
    const members = await client.query('SELECT user_id AS id, display_name AS name, email, role, is_active, created_at FROM users WHERE tenant_id = $1 ORDER BY created_at', [req.user.tenant_id]);
    const invitations = await client.query("SELECT invitation_id AS id, email, role, expires_at,delivery_status,delivery_sent_at,CASE WHEN expires_at<=now() THEN 'Expired' ELSE 'Pending' END AS status FROM workspace_invitations WHERE tenant_id = $1 AND accepted_at IS NULL ORDER BY created_at DESC LIMIT 500", [req.user.tenant_id]);
    return { members: members.rows, invitations: invitations.rows,email_delivery_configured:mail.configured() };
  });
  res.set('Cache-Control', 'no-store').json(result);
});
router.post('/invitations', invitationLimit,async (req, res) => {
  const { role } = req.body || {};
  const email = typeof req.body?.email === 'string' ? req.body.email.trim().toLowerCase() : '';
  if (typeof email !== 'string' || email.length > 254 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !roles.includes(role)) return res.status(400).json({ error: 'A valid email and workspace role are required.' });
  const token = crypto.randomBytes(32).toString('hex');
  const origin = applicationOrigin(req);
  const result = await withTenant(req.user.tenant_id, async client => {
    await client.query('SELECT pg_advisory_xact_lock(hashtext($1))',['invitation:' + req.user.tenant_id + ':' + email]);
    const status = (await client.query('SELECT auth_private.invitation_recipient_status($1,$2) AS status',[email,req.user.tenant_id])).rows[0].status;
    if(status !== 'new') return {conflict:status};
    await client.query('DELETE FROM workspace_invitations WHERE tenant_id = $1 AND lower(email) = $2 AND accepted_at IS NULL', [req.user.tenant_id, email.trim().toLowerCase()]);
    return (await client.query('INSERT INTO workspace_invitations (tenant_id, email, role, token_hash, created_by) VALUES ($1, $2, $3, $4, $5) RETURNING invitation_id AS id,email,role,expires_at', [req.user.tenant_id, email, role, hash(token), req.user.user_id])).rows[0];
  });
  if(result.conflict) return res.status(409).json({code:'INVITATION_ACCOUNT_EXISTS',error:result.conflict==='already_member'?'This person is already a member of your workspace.':result.conflict==='inactive_member'?'This member is deactivated. Reactivate their account in the member list.':'This email already has an account in another workspace. Invite a different email address.'});
  const invitation={...result,workspace_name:req.user.workspace_name,invitation_url:`${origin}/#register?invite=${token}`};
  const delivery=await mail.sendInvitation(invitation);
  await withTenant(req.user.tenant_id,client=>client.query("UPDATE workspace_invitations SET delivery_status=$1,delivery_sent_at=CASE WHEN $1='sent' THEN now() ELSE NULL END,delivery_message_id=$2 WHERE invitation_id=$3",[delivery.status==='not_configured'?'not_sent':delivery.status,delivery.message_id || null,result.id]));
  res.status(201).json({...invitation,delivery:{status:delivery.status,message:delivery.message},message:delivery.message});
});
router.delete('/invitations/:id',async(req,res)=>{
  if(!uuid.test(req.params.id)) return res.status(400).json({error:'Invalid invitation.'});
  const deleted=await withTenant(req.user.tenant_id,client=>client.query('DELETE FROM workspace_invitations WHERE invitation_id=$1 AND tenant_id=$2 AND accepted_at IS NULL RETURNING invitation_id',[req.params.id,req.user.tenant_id]));
  if(!deleted.rowCount) return res.status(404).json({error:'Invitation is unavailable or has already been accepted.'});
  res.json({message:'Invitation revoked. Its link no longer works.'});
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

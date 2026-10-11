'use strict';
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const pool = require('../config/db');
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
module.exports = async function gatewayIdentity(req, res, next) {
  const token = req.headers['x-gateway-identity'];
  if (!token) return next();
  let user;
  try {
    if (Buffer.byteLength(process.env.AGENT_GATEWAY_SECRET || '') < 32) throw new Error('Missing service secret');
    user = jwt.verify(token, process.env.AGENT_GATEWAY_SECRET, { algorithms: ['HS256'], issuer: 'ciftron-gateway', audience: 'email-agent', maxAge: '30s' });
    const body = ['GET', 'HEAD'].includes(req.method) ? '' : JSON.stringify(req.body || {});
    if (!uuid.test(user.sub) || !uuid.test(user.tenant_id) || !uuid.test(user.jti) ||
      !['agency_admin', 'marketer', 'viewer'].includes(user.role) || user.method !== req.method || user.path !== req.originalUrl ||
      user.body_hash !== crypto.createHash('sha256').update(body).digest('hex') ||
      typeof user.email !== 'string' || user.email.length > 254 || typeof user.workspace_name !== 'string' || user.workspace_name.length > 80) throw new Error('Invalid service identity');
  } catch { return res.status(401).json({ error: 'Invalid gateway identity.' }); }
  try {
    await pool.query('SELECT auth_private.ensure_gateway_identity($1,$2,$3,$4,$5,$6)',
      [user.tenant_id, user.sub, user.email, user.display_name || '', user.role, user.workspace_name]);
    req.user = { user_id: user.sub, tenant_id: user.tenant_id, email: user.email, display_name: user.display_name, role: user.role, workspace_name: user.workspace_name };
    req.gatewayAuthenticated = true;
    next();
  } catch (error) {
    console.error('Gateway identity projection failed:', error.code || error.name);
    res.status(503).json({ error: 'The email workspace is not available. Please try again.' });
  }
};

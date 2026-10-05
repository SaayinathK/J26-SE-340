'use strict';
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { permissionsFor } = require('../policies/rbac');
const production = () => process.env.NODE_ENV === 'production';
const cookieName = type => `${production() ? '__Host-' : ''}c4_${type}`;
const cookieOptions = () => ({ httpOnly: true, secure: production(), sameSite: 'lax', path: '/' });
function cookies(req) {
  const result = {};
  for (const part of (req.headers.cookie || '').split(';')) {
    const index = part.indexOf('=');
    if (index < 1) continue;
    try { result[part.slice(0, index).trim()] = decodeURIComponent(part.slice(index + 1).trim()); } catch {}
  }
  return result;
}
function equal(a, b) {
  if (typeof a !== 'string' || typeof b !== 'string') return false;
  const first = Buffer.from(a); const second = Buffer.from(b);
  return first.length === second.length && crypto.timingSafeEqual(first, second);
}
function hash(value) { return crypto.createHash('sha256').update(value).digest('hex'); }
async function withTenant(tenantId, operation) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const result = await operation(client);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
function identity(user) {
  return {
    user: { user_id: user.user_id, tenant_id: user.tenant_id, email: user.email, name: user.display_name || user.email.split('@')[0], role: user.role, google_linked: Boolean(user.google_sub) },
    workspace: { id: user.tenant_id, name: user.workspace_name, slug: user.workspace_slug, plan: user.workspace_tier, domain: user.workspace_domain || '' },
    permissions: permissionsFor(user.role),
  };
}
async function createSession(res, user) {
  const sessionId = crypto.randomUUID();
  const token = jwt.sign({ sub: user.user_id, tenant_id: user.tenant_id, role: user.role, jti: sessionId }, process.env.JWT_SECRET, {
    algorithm: 'HS256', expiresIn: process.env.JWT_EXPIRES_IN || '1h', issuer: 'c4-gateway', audience: 'c4-platform',
  });
  const expiry = jwt.decode(token).exp;
  await withTenant(user.tenant_id, client => client.query(
    'INSERT INTO auth_sessions (session_id, user_id, tenant_id, expires_at) VALUES ($1, $2, $3, to_timestamp($4))',
    [sessionId, user.user_id, user.tenant_id, expiry],
  ));
  const { rows } = await pool.query('SELECT * FROM auth_private.resolve_session($1, $2, $3)', [sessionId, user.user_id, user.tenant_id]);
  if (!rows[0]) throw new Error('Account is inactive');
  res.cookie(cookieName('session'), token, { ...cookieOptions(), maxAge: Math.max(0, expiry * 1000 - Date.now()) });
  return { access_token: token, token_type: 'Bearer', expires_in: Math.max(0, expiry - Math.floor(Date.now() / 1000)), ...identity(rows[0]) };
}
function requestProtection(req, res, next) {
  if (['GET', 'HEAD', 'OPTIONS'].includes(req.method)) return next();
  const origin = req.headers.origin;
  const allowed = (process.env.CLIENT_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173').split(',').map(value => value.trim());
  if (origin && !allowed.includes(origin)) return res.status(403).json({ error: 'This application origin is not allowed.' });
  const cookie = cookies(req);
  if ((origin || cookie[cookieName('session')] || cookie[cookieName('csrf')]) && !equal(cookie[cookieName('csrf')], req.headers['x-csrf-token'])) {
    return res.status(403).json({ error: 'Your security token has expired. Refresh the page and try again.', code: 'CSRF_INVALID' });
  }
  if (!req.is('application/json')) return res.status(415).json({ error: 'Use application/json for this request.' });
  next();
}
module.exports = { cookies, cookieName, cookieOptions, equal, hash, withTenant, createSession, identity, requestProtection };

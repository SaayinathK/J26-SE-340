
const jwt = require('jsonwebtoken');
const pool = require('../config/db');
const { cookies, cookieName } = require('../services/session');

async function authenticate(req, res, next) {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7) : !header ? cookies(req)[cookieName('session')] : null;
  if (!token) return res.status(401).json({ error: 'Authentication required' });
  let payload;
  try {
    payload = jwt.verify(token, process.env.JWT_SECRET, { algorithms: ['HS256'], issuer: 'c4-gateway', audience: 'c4-platform' });
    const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
    if (![payload.sub, payload.tenant_id, payload.jti].every(value => typeof value === 'string' && uuid.test(value))) throw new Error('Invalid claims');
  } catch { return res.status(401).json({ error: 'Invalid or expired session' }); }
  try {
    // Authorization always uses the current database role, never the JWT role claim.
    const { rows } = await pool.query('SELECT * FROM auth_private.resolve_session($1, $2, $3)', [payload.jti, payload.sub, payload.tenant_id]);
    if (rows.length !== 1) return res.status(401).json({ error: 'This session has expired or been revoked.' });
    req.user = rows[0];
    req.sessionId = payload.jti;
    next();
  } catch { return res.status(503).json({ error: 'Account service is temporarily unavailable. Please try again.' }); }
}
module.exports = authenticate;

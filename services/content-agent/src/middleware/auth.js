const jwt = require('jsonwebtoken');
const db = require('../config/db');
async function protect(req, res, next) {
  const match = /^Bearer\s+(\S+)$/i.exec(req.headers.authorization || '');
  if (!match) return res.status(401).json({ success: false, error: 'Bearer token required' });
  let payload;
  try { payload = jwt.verify(match[1], process.env.JWT_SECRET, { algorithms: ['HS256'] }); }
  catch { return res.status(401).json({ success: false, error: 'Invalid or expired token' }); }
  if (!db.validTenant(payload.clientId)) return res.status(401).json({ success: false, error: 'Invalid token subject' });
  try {
    const { rows } = await db.query('SELECT id, is_active FROM clients WHERE id = $1', [payload.clientId], payload.clientId);
    if (!rows[0]?.is_active) return res.status(401).json({ success: false, error: 'Account inactive or missing' });
    req.clientId = req.tenant_id = payload.clientId;
    next();
  } catch (error) { next(error); }
}
async function checkLimit(req, res, next) {
  try {
    const { rows } = await db.query('SELECT generations_used, generations_limit FROM clients WHERE id = $1', [req.tenant_id], req.tenant_id);
    if (!rows[0] || rows[0].generations_used >= rows[0].generations_limit) return res.status(429).json({ success: false, error: 'Generation limit reached' });
    next();
  } catch (error) { next(error); }
}
module.exports = { protect, checkLimit };

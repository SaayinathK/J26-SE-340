'use strict';
const router = require('express').Router();
const crypto = require('node:crypto');
const bcrypt = require('bcryptjs');
const { OAuth2Client } = require('google-auth-library');
const rateLimit = require('express-rate-limit');
const pool = require('../config/db');
const authenticate = require('../middleware/auth');
const audit = require('../middleware/audit');
const { cookies, cookieName, cookieOptions, equal, hash, withTenant, createSession, identity } = require('../services/session');
const google = new OAuth2Client();
const googleClientId = () => (process.env.GOOGLE_CLIENT_ID || '').endsWith('.apps.googleusercontent.com') ? process.env.GOOGLE_CLIENT_ID.trim() : '';
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many sign-in attempts. Please wait 15 minutes and try again.' } });
const registrationLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, message: { error: 'Too many account creation attempts. Please try again later.' } });
const validEmail = value => typeof value === 'string' && value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
const validPassword = value => typeof value === 'string' && value.length >= 12 && Buffer.byteLength(value, 'utf8') <= 72 && /[a-z]/.test(value) && /[A-Z]/.test(value) && /[0-9]/.test(value);
const validName = value => typeof value === 'string' && value.trim().length >= 2 && value.trim().length <= 80;

function accountError(error, res) {
  if (error.code === '23505') return res.status(409).json({ error: 'An account with these details already exists. Sign in or use your existing sign-in method.' });
  if (error.code === '22023') return res.status(400).json({ error: 'Account details or invitation are invalid. Check your invitation email and try again.' });
  console.error('Account operation failed:', error.code || error.name);
  return res.status(503).json({ error: 'Account service is temporarily unavailable. Please try again.' });
}

router.use((_req, res, next) => { res.set('Cache-Control', 'no-store'); next(); });
router.get('/config', (req, res) => {
  const existing = cookies(req)[cookieName('csrf')];
  const csrf = /^[a-f0-9]{64}$/.test(existing || '') ? existing : crypto.randomBytes(32).toString('hex');
  res.cookie(cookieName('csrf'), csrf, { ...cookieOptions(), maxAge: 24 * 60 * 60 * 1000 });
  const clientId = googleClientId();
  res.json({ csrf_token: csrf, google_client_id: clientId, google_enabled: Boolean(clientId), password_min_length: 12 });
});

router.post('/login', limiter, async (req, res) => {
  const { email, password } = req.body || {};
  if (!validEmail(email) || typeof password !== 'string' || !password || Buffer.byteLength(password, 'utf8') > 72) return res.status(400).json({ error: 'Enter a valid email and password.' });
  try {
    const { rows } = await pool.query('SELECT user_id, tenant_id, email, password_hash, role FROM auth_private.lookup_login_user($1)', [email.trim().toLowerCase()]);
    // Perform bcrypt work even for unknown accounts to reduce account enumeration timing differences.
    const fallback = '$2a$12$6Y1JxkrnPlfZ4uBtbH/tuOaNqITMe4g.RAK0XACjiqjWiQ6FfcywK';
    const valid = await bcrypt.compare(password, rows[0]?.password_hash || fallback);
    if (!valid || !rows[0]?.password_hash) return res.status(401).json({ error: 'Email or password is incorrect.' });
    const result = await createSession(res, rows[0]);
    req.user = { user_id: result.user.user_id, tenant_id: result.user.tenant_id };
    return res.json(result);
  } catch (error) { return accountError(error, res); }
});

router.post('/register', registrationLimiter, async (req, res) => {
  const { name, email, password, workspace_name, invitation_token } = req.body || {};
  if (!validName(name) || !validEmail(email) || !validPassword(password)) return res.status(400).json({ error: 'Use a valid name, email, and a 12–72 byte password with uppercase, lowercase, and a number.' });
  if (invitation_token != null && !/^[a-f0-9]{64}$/.test(invitation_token)) return res.status(400).json({ error: 'Invalid invitation.' });
  if (!invitation_token && !validName(workspace_name)) return res.status(400).json({ error: 'Enter a workspace name between 2 and 80 characters.' });
  if (req.body.role || req.body.tenant_id) return res.status(400).json({ error: 'Workspace access is assigned by the server, not selected during registration.' });
  try {
    const passwordHash = await bcrypt.hash(password, 12);
    const { rows } = await pool.query('SELECT * FROM auth_private.register_account($1, $2, $3, $4, $5, $6)', [name.trim(), email.trim().toLowerCase(), passwordHash, null, workspace_name?.trim() || null, invitation_token ? hash(invitation_token) : null]);
    return res.status(201).json(await createSession(res, rows[0]));
  } catch (error) { return accountError(error, res); }
});

router.get('/me', authenticate, (req, res) => res.json(identity(req.user)));
router.patch('/profile', authenticate, audit('account_profile'), async (req, res) => {
  if (!validName(req.body?.name)) return res.status(400).json({ error: 'Enter a name between 2 and 80 characters.' });
  try {
    await withTenant(req.user.tenant_id, client => client.query('UPDATE users SET display_name = $1 WHERE user_id = $2 AND tenant_id = $3', [req.body.name.trim(), req.user.user_id, req.user.tenant_id]));
    return res.json({ message: 'Profile updated.' });
  } catch (error) { return accountError(error, res); }
});
router.post('/logout', authenticate, audit('logout'), async (req, res) => {
  try {
    await withTenant(req.user.tenant_id, client => client.query('DELETE FROM auth_sessions WHERE session_id = $1 AND user_id = $2', [req.sessionId, req.user.user_id]));
    res.clearCookie(cookieName('session'), cookieOptions());
    return res.json({ message: 'Signed out successfully.' });
  } catch (error) { return accountError(error, res); }
});

router.get('/google/challenge', limiter, async (req, res) => {
  if (!googleClientId()) return res.status(503).json({ error: 'Google sign-in is not configured yet. Use email and password.' });
  const intent = req.query.intent;
  if (!['login', 'register', 'link'].includes(intent)) return res.status(400).json({ error: 'Invalid sign-in request.' });
  try {
    const nonce = crypto.randomBytes(32).toString('hex');
    await pool.query('DELETE FROM auth_google_challenges WHERE expires_at <= now()');
    await pool.query('INSERT INTO auth_google_challenges (challenge_hash, intent) VALUES ($1, $2)', [hash(nonce), intent]);
    res.cookie(cookieName('google_nonce'), nonce, { ...cookieOptions(), maxAge: 5 * 60 * 1000 });
    return res.json({ nonce });
  } catch (error) { return accountError(error, res); }
});

router.post('/google', limiter, (req, res, next) => req.body?.intent === 'link' ? authenticate(req, res, next) : next(), async (req, res) => {
  if (!googleClientId()) return res.status(503).json({ error: 'Google sign-in is not configured yet.' });
  const { credential, intent, workspace_name, invitation_token } = req.body || {};
  const nonce = cookies(req)[cookieName('google_nonce')];
  if (typeof credential !== 'string' || credential.length > 12000 || !/^[a-f0-9]{64}$/.test(nonce || '') || !['login', 'register', 'link'].includes(intent)) return res.status(400).json({ error: 'Restart Google sign-in and try again.' });
  let payload;
  try {
    const ticket = await google.verifyIdToken({ idToken: credential, audience: googleClientId() });
    payload = ticket.getPayload();
    if (typeof payload?.sub !== 'string' || !payload.sub || payload.sub.length > 255 || payload.email_verified !== true || !validEmail(payload.email) || !equal(payload.nonce, nonce)) throw new Error('Invalid Google identity');
  } catch { return res.status(401).json({ error: 'Google could not verify this sign-in. Please try again.' }); }
  try {
    const challenge = await pool.query('DELETE FROM auth_google_challenges WHERE challenge_hash = $1 AND intent = $2 AND expires_at > now() RETURNING challenge_hash', [hash(nonce), intent]);
    res.clearCookie(cookieName('google_nonce'), cookieOptions());
    if (challenge.rowCount !== 1) return res.status(401).json({ error: 'This Google sign-in request has expired or was already used.' });
    const existing = await pool.query('SELECT * FROM auth_private.lookup_google_user($1)', [payload.sub]);
    if (intent === 'link') {
      if (existing.rows.length && existing.rows[0].user_id !== req.user.user_id) return res.status(409).json({ error: 'This Google account is already linked to another user.' });
      if (payload.email.toLowerCase() !== req.user.email.toLowerCase()) return res.status(400).json({ error: 'Choose the Google account with the same email as your signed-in account.' });
      await withTenant(req.user.tenant_id, client => client.query('UPDATE users SET google_sub = $1 WHERE user_id = $2 AND tenant_id = $3', [payload.sub, req.user.user_id, req.user.tenant_id]));
      return res.json(identity({ ...req.user, google_sub: payload.sub }));
    }
    if (existing.rows.length) {
      if (intent === 'register') return res.status(409).json({ error: 'This Google account is already registered. Use Sign in.', code: 'GOOGLE_ACCOUNT_ALREADY_REGISTERED' });
      return res.json(await createSession(res, existing.rows[0]));
    }
    if (intent === 'login') return res.status(401).json({ error: 'No linked Google account was found. Create an account, or sign in with your password and link Google in Settings.', code: 'GOOGLE_ACCOUNT_NOT_LINKED' });
    if (req.body.role || req.body.tenant_id || (!invitation_token && !validName(workspace_name)) || (invitation_token != null && !/^[a-f0-9]{64}$/.test(invitation_token))) return res.status(400).json({ error: 'Enter your workspace name or use a valid invitation.' });
    const name = validName(req.body.name) ? req.body.name.trim() : validName(payload.name) ? payload.name.trim() : payload.email.split('@')[0].padEnd(2, '_').slice(0, 80);
    const result = await pool.query('SELECT * FROM auth_private.register_account($1, $2, $3, $4, $5, $6)', [name, payload.email.toLowerCase(), null, payload.sub, workspace_name?.trim() || null, invitation_token ? hash(invitation_token) : null]);
    return res.status(201).json(await createSession(res, result.rows[0]));
  } catch (error) {
    if (error.code === '23505') return res.status(409).json({ error: 'An account with this email already exists. Sign in with your password, then link Google in Settings → Connected sign-in.', code: 'GOOGLE_LINK_REQUIRED' });
    return accountError(error, res);
  }
});
module.exports = router;

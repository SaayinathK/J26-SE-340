'use strict';
// Runs against an isolated migrated PostgreSQL database, not a mocked store.
jest.mock('google-auth-library', () => ({ OAuth2Client: jest.fn().mockImplementation(() => ({ verifyIdToken: (...args) => mockVerifyGoogle(...args) })) }));
const mockVerifyGoogle = jest.fn();
const request = require('supertest');
const jwt = require('jsonwebtoken');
const crypto = require('node:crypto');
const app = require('../../src/main');
const pool = require('../../src/config/db');
const { withTenant, hash } = require('../../src/services/session');
const suffix = crypto.randomBytes(5).toString('hex');
const password = 'SecureTestPass123!';
const accounts = {};
const agentA = request.agent(app);
const agentB = request.agent(app);
let csrfA; let csrfB; let admin; let secondAdmin; let viewer; let marketer;
jest.setTimeout(30000);

async function register(label, extras = {}) {
  const body = { name: `${label} Test`, email: `${label}-${suffix}@example.com`, password, workspace_name: `${label} Workspace`, ...extras };
  const result = await request(app).post('/api/auth/register').send(body);
  return { result, email: body.email, token: result.body.access_token, user: result.body.user };
}
const bearer = token => ({ Authorization: `Bearer ${token}` });
async function googleChallenge(intent) {
  const agent = request.agent(app);
  const config = await agent.get('/api/auth/config');
  const challenge = await agent.get(`/api/auth/google/challenge?intent=${intent}`);
  expect(challenge.status).toBe(200);
  return { agent, csrf: config.body.csrf_token, nonce: challenge.body.nonce };
}

beforeAll(async () => {
  process.env.GOOGLE_CLIENT_ID = 'test-client.apps.googleusercontent.com';
  const first = await register('admin'); expect(first.result.status).toBe(201); admin = first;
  const second = await register('other'); expect(second.result.status).toBe(201); secondAdmin = second;
  csrfA = (await agentA.get('/api/auth/config')).body.csrf_token;
  csrfB = (await agentB.get('/api/auth/config')).body.csrf_token;
  expect((await agentA.post('/api/auth/login').set('X-CSRF-Token', csrfA).send({ email: admin.email, password })).status).toBe(200);
  expect((await agentB.post('/api/auth/login').set('X-CSRF-Token', csrfB).send({ email: secondAdmin.email, password })).status).toBe(200);
  for (const role of ['viewer', 'marketer']) {
    const email = `${role}-${suffix}@example.com`;
    const invitation = await agentA.post('/api/team/invitations').set('X-CSRF-Token', csrfA).send({ email, role });
    expect(invitation.status).toBe(201);
    const token = new URLSearchParams(invitation.body.invitation_url.split('?')[1]).get('invite');
    const account = await register(role, { email, invitation_token: token });
    expect(account.result.status).toBe(201);
    accounts[role] = { ...account, invitation: token };
  }
  viewer = accounts.viewer; marketer = accounts.marketer;
});
afterAll(async () => { await pool.end(); });

test('registration creates a server-assigned administrator in a new workspace', () => {
  expect(admin.user.role).toBe('agency_admin');
  expect(admin.user.tenant_id).not.toBe(secondAdmin.user.tenant_id);
  expect(admin.result.body.workspace.name).toBe('admin Workspace');
  expect(admin.result.body.permissions).toContain('team:manage');
  expect(admin.result.headers['set-cookie'].some(value => value.includes('HttpOnly') && value.includes('SameSite=Lax'))).toBe(true);
});
test('public registration rejects role and tenant selection', async () => {
  const result = await register('forged', { role: 'agency_admin', tenant_id: admin.user.tenant_id });
  expect(result.result.status).toBe(400);
});
test('weak passwords are rejected', async () => { expect((await register('weak', { password: 'short' })).result.status).toBe(400); });
test('duplicate email does not create a second account or workspace', async () => { expect((await register('duplicate', { email: admin.email })).result.status).toBe(409); });
test('password login rejects incorrect credentials', async () => {
  expect((await request(app).post('/api/auth/login').send({ email: admin.email, password: 'WrongPassword123' })).status).toBe(401);
});
test('HTTP-only session cookie restores current identity and permissions', async () => {
  const result = await agentA.get('/api/auth/me');
  expect(result.status).toBe(200); expect(result.body.user.email).toBe(admin.email);
  expect(result.body.permissions).toContain('workspace:manage');
  expect(result.body.user.password_hash).toBeUndefined();
});
test('unauthenticated and expired tokens cannot read account data', async () => {
  expect((await request(app).get('/api/auth/me')).status).toBe(401);
  const claims = jwt.decode(admin.token);
  const expired = jwt.sign({ sub: claims.sub, tenant_id: claims.tenant_id, jti: claims.jti, role: 'agency_admin' }, process.env.JWT_SECRET, { issuer: 'email-agent', audience: 'email-agent-ui', expiresIn: -1 });
  expect((await request(app).get('/api/auth/me').set(bearer(expired))).status).toBe(401);
});
test('browser mutations reject missing CSRF tokens and foreign origins', async () => {
  expect((await agentA.patch('/api/auth/profile').send({ name: 'Blocked Update' })).status).toBe(403);
  expect((await agentA.patch('/api/auth/profile').set('X-CSRF-Token', csrfA).set('Origin', 'https://attacker.example').send({ name: 'Blocked Update' })).status).toBe(403);
});
test('invitation assigns its own workspace and role', () => {
  expect(viewer.user.tenant_id).toBe(admin.user.tenant_id); expect(viewer.user.role).toBe('viewer');
  expect(marketer.user.role).toBe('marketer');
});
test('single-use invitation cannot be replayed', async () => {
  const result = await register('replay', { email: viewer.email, invitation_token: viewer.invitation });
  expect(result.result.status).toBe(400);
});
test('invitation cannot be accepted with another email', async () => {
  const invitation = await agentA.post('/api/team/invitations').set('X-CSRF-Token', csrfA).send({ email: `intended-${suffix}@example.com`, role: 'viewer' });
  const token = new URLSearchParams(invitation.body.invitation_url.split('?')[1]).get('invite');
  expect((await register('wrong-recipient', { invitation_token: token })).result.status).toBe(400);
});
test('expired invitations cannot create an account', async () => {
  const token = crypto.randomBytes(32).toString('hex');
  const email = `expired-${suffix}@example.com`;
  await withTenant(admin.user.tenant_id, client => client.query("INSERT INTO workspace_invitations (tenant_id, email, role, token_hash, created_by, expires_at) VALUES ($1, $2, 'viewer', $3, $4, now() - interval '1 minute')", [admin.user.tenant_id, email, hash(token), admin.user.user_id]));
  expect((await register('expired', { email, invitation_token: token })).result.status).toBe(400);
});
test('database session expiry is enforced even if the signed JWT is still valid', async () => {
  const sessionId = crypto.randomUUID();
  await withTenant(admin.user.tenant_id, client => client.query("INSERT INTO auth_sessions (session_id, user_id, tenant_id, expires_at) VALUES ($1, $2, $3, now() - interval '1 second')", [sessionId, admin.user.user_id, admin.user.tenant_id]));
  const token = jwt.sign({ sub: admin.user.user_id, tenant_id: admin.user.tenant_id, jti: sessionId, role: 'agency_admin' }, process.env.JWT_SECRET, { issuer: 'email-agent', audience: 'email-agent-ui', expiresIn: '1h' });
  expect((await request(app).get('/api/auth/me').set(bearer(token))).status).toBe(401);
});
test('viewer cannot manage team or generate email', async () => {
  expect((await request(app).get('/api/email/snapshot').set(bearer(viewer.token))).status).toBe(200);
  expect((await request(app).get('/api/email/status').set(bearer(viewer.token))).status).toBe(403);
  expect((await request(app).get('/api/team').set(bearer(viewer.token))).status).toBe(403);
  expect((await request(app).post('/api/email/sequence').set(bearer(viewer.token)).send({ campaign_goal: 'Test', audience_segment: 'Test' })).status).toBe(403);
});
test('marketer can use email but cannot manage team or knowledge', async () => {
  expect((await request(app).get('/api/email/snapshot').set(bearer(marketer.token))).status).toBe(200);
  expect((await request(app).get('/api/team').set(bearer(marketer.token))).status).toBe(403);
  expect((await request(app).post('/api/email/knowledge').set(bearer(marketer.token)).send({ name: 'Forbidden', domain: '' })).status).toBe(403);
});
test('team reads and writes cannot cross workspace boundaries', async () => {
  const team = await agentB.get('/api/team');
  expect(team.body.members.every(member => member.email === secondAdmin.email)).toBe(true);
  expect((await agentB.patch(`/api/team/${viewer.user.user_id}`).set('X-CSRF-Token', csrfB).send({ role: 'agency_admin' })).status).toBe(404);
});
test('a user cannot promote or deactivate themselves', async () => {
  expect((await agentA.patch(`/api/team/${admin.user.user_id}`).set('X-CSRF-Token', csrfA).send({ role: 'viewer' })).status).toBe(400);
});
test('role changes take effect immediately even when a JWT still claims the old role', async () => {
  expect((await agentA.patch(`/api/team/${marketer.user.user_id}`).set('X-CSRF-Token', csrfA).send({ role: 'viewer' })).status).toBe(200);
  expect(jwt.decode(marketer.token).role).toBe('marketer');
  expect((await request(app).get('/api/email/status').set(bearer(marketer.token))).status).toBe(403);
});
test('deactivation invalidates an existing session', async () => {
  expect((await agentA.patch(`/api/team/${viewer.user.user_id}`).set('X-CSRF-Token', csrfA).send({ is_active: false })).status).toBe(200);
  expect((await request(app).get('/api/auth/me').set(bearer(viewer.token))).status).toBe(401);
});
test('profile updates persist to the database', async () => {
  expect((await agentA.patch('/api/auth/profile').set('X-CSRF-Token', csrfA).send({ name: 'Updated Administrator' })).status).toBe(200);
  expect((await agentA.get('/api/auth/me')).body.user.name).toBe('Updated Administrator');
});
test('Google rejects verification failures, unverified email, and nonce mismatch', async () => {
  for (const mode of ['verification', 'email', 'nonce']) {
    const challenge = await googleChallenge('login');
    if (mode === 'verification') mockVerifyGoogle.mockRejectedValueOnce(new Error('Bad signature'));
    else mockVerifyGoogle.mockResolvedValueOnce({ getPayload: () => ({ sub: 'google-test-sub', email: admin.email, email_verified: mode !== 'email', nonce: mode === 'nonce' ? 'wrong' : challenge.nonce }) });
    const result = await challenge.agent.post('/api/auth/google').set('X-CSRF-Token', challenge.csrf).send({ credential: 'mock-token', intent: 'login' });
    expect(result.status).toBe(401);
  }
});
test('Google registration creates a real workspace after provider verification', async () => {
  const challenge = await googleChallenge('register');
  mockVerifyGoogle.mockResolvedValueOnce({ getPayload: () => ({ sub: `google-${suffix}`, email: `google-${suffix}@gmail.com`, email_verified: true, nonce: challenge.nonce, name: 'Google Member' }) });
  const result = await challenge.agent.post('/api/auth/google').set('X-CSRF-Token', challenge.csrf).send({ credential: 'mock-token', intent: 'register', workspace_name: 'Google Workspace' });
  expect(result.status).toBe(201); expect(result.body.user.google_linked).toBe(true); expect(result.body.user.role).toBe('agency_admin');
  expect(mockVerifyGoogle).toHaveBeenLastCalledWith({ idToken: 'mock-token', audience: 'test-client.apps.googleusercontent.com' });
  const profile = await challenge.agent.get('/api/auth/me'); expect(profile.status).toBe(200);
});
test('Google never auto-links an existing password account merely by email', async () => {
  const challenge = await googleChallenge('register');
  mockVerifyGoogle.mockResolvedValueOnce({ getPayload: () => ({ sub: `different-${suffix}`, email: admin.email, email_verified: true, nonce: challenge.nonce, name: 'Unlinked Account' }) });
  const result = await challenge.agent.post('/api/auth/google').set('X-CSRF-Token', challenge.csrf).send({ credential: 'mock-token', intent: 'register', workspace_name: 'Not Created' });
  expect(result.status).toBe(409); expect(result.body.code).toBe('GOOGLE_LINK_REQUIRED');
  expect((await agentA.get('/api/auth/me')).body.user.google_linked).toBe(false);
});
test('Google nonce cannot be replayed even when its cookie is copied', async () => {
  const challenge = await googleChallenge('login');
  const payload = { sub: `unregistered-${suffix}`, email: `unregistered-${suffix}@gmail.com`, email_verified: true, nonce: challenge.nonce };
  mockVerifyGoogle.mockResolvedValue({ getPayload: () => payload });
  const first = await challenge.agent.post('/api/auth/google').set('X-CSRF-Token', challenge.csrf).send({ credential: 'mock-token', intent: 'login' });
  expect(first.status).toBe(401);
  expect(first.body.code).toBe('GOOGLE_ACCOUNT_NOT_LINKED');
  expect((await challenge.agent.get('/api/auth/me')).status).toBe(401);
  const replay = await request(app).post('/api/auth/google').set('Cookie', [`email_agent_csrf=${challenge.csrf}`, `email_agent_google_nonce=${challenge.nonce}`]).set('X-CSRF-Token', challenge.csrf).send({ credential: 'mock-token', intent: 'login' });
  expect(replay.status).toBe(401); expect(replay.body.error).toMatch(/already used/);
});
test('linking Google requires the same email as the authenticated account', async () => {
  const challenge = await agentA.get('/api/auth/google/challenge?intent=link');
  mockVerifyGoogle.mockResolvedValueOnce({ getPayload: () => ({ sub: `wrong-link-${suffix}`, email: secondAdmin.email, email_verified: true, nonce: challenge.body.nonce }) });
  const result = await agentA.post('/api/auth/google').set('X-CSRF-Token', csrfA).send({ credential: 'mock-token', intent: 'link' });
  expect(result.status).toBe(400);
});
test('an authenticated password account can explicitly link verified Google identity', async () => {
  const challenge = await agentA.get('/api/auth/google/challenge?intent=link');
  mockVerifyGoogle.mockResolvedValueOnce({ getPayload: () => ({ sub: `linked-${suffix}`, email: admin.email, email_verified: true, nonce: challenge.body.nonce }) });
  const result = await agentA.post('/api/auth/google').set('X-CSRF-Token', csrfA).send({ credential: 'mock-token', intent: 'link' });
  expect(result.status).toBe(200); expect((await agentA.get('/api/auth/me')).body.user.google_linked).toBe(true);
});
test('logout revokes the same token for bearer and cookie access', async () => {
  const login = await agentB.post('/api/auth/login').set('X-CSRF-Token', csrfB).send({ email: secondAdmin.email, password });
  expect((await agentB.post('/api/auth/logout').set('X-CSRF-Token', csrfB).send({})).status).toBe(200);
  expect((await request(app).get('/api/auth/me').set(bearer(login.body.access_token))).status).toBe(401);
  expect((await agentB.get('/api/auth/me')).status).toBe(401);
});

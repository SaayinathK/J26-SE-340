'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('node:crypto');
const jwt = require('jsonwebtoken');
const middleware = require('../../src/middleware/gatewayIdentity');
const pool = require('../../src/config/db');
const secret = crypto.randomBytes(48).toString('hex');
process.env.AGENT_GATEWAY_SECRET = secret;
const claims = () => ({ sub: crypto.randomUUID(), tenant_id: crypto.randomUUID(), jti: crypto.randomUUID(),
  email: 'member@example.com', display_name: 'Member', role: 'marketer', workspace_name: 'Workspace',
  method: 'POST', path: '/api/email/sequences', body_hash: crypto.createHash('sha256').update('{"name":"Draft"}').digest('hex') });
const sign = (data, options = {}) => jwt.sign(data, secret, { issuer: 'ciftron-gateway', audience: 'email-agent', expiresIn: 30, ...options });
async function invoke(token, changes = {}) {
  const req = { headers: { 'x-gateway-identity': token }, method: 'POST', originalUrl: '/api/email/sequences', body: { name: 'Draft' }, ...changes };
  let code, called = false;
  const res = { status(value) { code = value; return this; }, json() {} };
  await middleware(req, res, () => { called = true; });
  return { code, called, req };
}
test('gateway identities bind method, path, and request body before accessing persistence', async () => {
  const token = sign(claims());
  for (const changes of [{ method: 'DELETE' }, { originalUrl: '/api/email/knowledge' }, { body: { name: 'Changed draft' } }]) {
    const result = await invoke(token, changes);
    assert.equal(result.code, 401); assert.equal(result.called, false);
  }
});
test('wrong audience, expired tokens and unknown roles cannot become an agent identity', async () => {
  for (const token of [sign(claims(), { audience: 'content-agent' }), sign(claims(), { expiresIn: -1 }), sign({ ...claims(), role: 'superuser' })]) {
    assert.equal((await invoke(token)).code, 401);
  }
});
test('a verified identity projects only its signed user and workspace into the agent database', async () => {
  const original = pool.query;
  const data = claims();
  let values;
  pool.query = async (_sql, params) => { values = params; return { rows: [] }; };
  try {
    const result = await invoke(sign(data));
    assert.equal(result.called, true);
    assert.deepEqual(values, [data.tenant_id, data.sub, data.email, data.display_name, data.role, data.workspace_name]);
    assert.equal(result.req.user.tenant_id, data.tenant_id);
    assert.equal(result.req.gatewayAuthenticated, true);
  } finally { pool.query = original; }
});

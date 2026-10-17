'use strict';
/**
 * C4 — Tenant Isolation & RBAC Integration Tests (25 cases)
 * Routes confirmed against src/main.js
 */
const request = require('supertest');
const app     = require('../../src/main');

jest.setTimeout(30000);

const U = {
  adminA:    { email: 'admin@tenant-a.com',    password: 'Test@12345' },
  marketerA: { email: 'marketer@tenant-a.com', password: 'Test@12345' },
  viewerA:   { email: 'viewer@tenant-a.com',   password: 'Test@12345' },
  adminB:    { email: 'admin@tenant-b.com',    password: 'Test@12345' },
  marketerB: { email: 'marketer@tenant-b.com', password: 'Test@12345' },
};

const _tokens = {};
async function tok(key) {
  if (!_tokens[key]) {
    const res = await request(app).post('/api/auth/login').send(U[key]);
    if (!res.body.access_token) throw new Error('Login failed for ' + key + ': ' + JSON.stringify(res.body));
    _tokens[key] = res.body.access_token;
  }
  return _tokens[key];
}
async function auth(key) {
  return { Authorization: 'Bearer ' + (await tok(key)) };
}

// ── 1. Authentication ────────────────────────────────────────────────────────
describe('1. Authentication', () => {
  test('T01 valid login (admin-a) → 200 + access_token', async () => {
    const res = await request(app).post('/api/auth/login').send(U.adminA);
    expect(res.status).toBe(200);
    expect(typeof res.body.access_token).toBe('string');
    expect(res.body.access_token.length).toBeGreaterThan(20);
  });

  test('T02 valid login (marketer-a) → 200 + access_token', async () => {
    const res = await request(app).post('/api/auth/login').send(U.marketerA);
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('access_token');
  });

  test('T03 wrong password → 401', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: U.adminA.email, password: 'WrongPassword!' });
    expect(res.status).toBe(401);
  });

  test('T04 non-existent email → 401', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ email: 'ghost@no-tenant.com', password: 'Test@12345' });
    expect(res.status).toBe(401);
  });

  test('T05 missing email field → 400', async () => {
    const res = await request(app).post('/api/auth/login')
      .send({ password: 'Test@12345' });
    expect(res.status).toBe(400);
  });
});

// ── 2. JWT Security ──────────────────────────────────────────────────────────
describe('2. JWT Security', () => {
  test('T06 valid token → GET /api/auth/me returns 200 + user object', async () => {
    const res = await request(app).get('/api/auth/me').set(await auth('adminA'));
    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('user');
    expect(res.body.user).toHaveProperty('tenant_id');
    expect(res.body.user).toHaveProperty('role', 'agency_admin');
  });

  test('T07 no token → 401', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  test('T08 malformed token → 401', async () => {
    const res = await request(app).get('/api/auth/me')
      .set('Authorization', 'Bearer not.a.jwt');
    expect(res.status).toBe(401);
  });

  test('T09 tampered JWT signature → 401', async () => {
    const token = await tok('adminA');
    const parts = token.split('.');
    parts[2] = parts[2].slice(0, -1) + (parts[2].slice(-1) === 'A' ? 'B' : 'A');
    const res = await request(app).get('/api/auth/me')
      .set('Authorization', 'Bearer ' + parts.join('.'));
    expect(res.status).toBe(401);
  });

  test('T10 missing Bearer prefix → 401', async () => {
    const token = await tok('adminA');
    const res = await request(app).get('/api/auth/me')
      .set('Authorization', token);
    expect(res.status).toBe(401);
  });
});

// ── 3. Tenant Isolation ──────────────────────────────────────────────────────
describe('3. Tenant Isolation', () => {
  test('T11 admin-a and admin-b have different tenant_ids', async () => {
    const [rA, rB] = await Promise.all([
      request(app).get('/api/auth/me').set(await auth('adminA')),
      request(app).get('/api/auth/me').set(await auth('adminB')),
    ]);
    expect(rA.body.user.tenant_id).toBeDefined();
    expect(rB.body.user.tenant_id).toBeDefined();
    expect(rA.body.user.tenant_id).not.toBe(rB.body.user.tenant_id);
  });

  test('T12 /api/tenant/context tenant_id matches /api/auth/me (admin-a)', async () => {
    const hdrs = await auth('adminA');
    const [me, ctx] = await Promise.all([
      request(app).get('/api/auth/me').set(hdrs),
      request(app).get('/api/tenant/context').set(hdrs),
    ]);
    expect(ctx.status).toBe(200);
    expect(ctx.body.tenant_id).toBe(me.body.user.tenant_id);
  });

  test('T13 /api/tenant/context tenant_id matches /api/auth/me (admin-b)', async () => {
    const hdrs = await auth('adminB');
    const [me, ctx] = await Promise.all([
      request(app).get('/api/auth/me').set(hdrs),
      request(app).get('/api/tenant/context').set(hdrs),
    ]);
    expect(ctx.status).toBe(200);
    expect(ctx.body.tenant_id).toBe(me.body.user.tenant_id);
  });

  test('T14 email sequence tenant_id matches authenticated user (admin-a)', async () => {
    const hdrs = await auth('adminA');
    const me = await request(app).get('/api/auth/me').set(hdrs);
    const seq = await request(app).post('/api/email/sequence').set(hdrs)
      .send({ campaign_goal: 'Test isolation', audience_segment: 'Testers' });
    expect(seq.status).toBe(200);
    expect(seq.body.tenant_id).toBe(me.body.user.tenant_id);
  });

  test('T15 tenant_b sequence returns different tenant_id than tenant_a', async () => {
    const [sA, sB] = await Promise.all([
      request(app).post('/api/email/sequence').set(await auth('adminA'))
        .send({ campaign_goal: 'A goal', audience_segment: 'A audience' }),
      request(app).post('/api/email/sequence').set(await auth('adminB'))
        .send({ campaign_goal: 'B goal', audience_segment: 'B audience' }),
    ]);
    expect(sA.status).toBe(200);
    expect(sB.status).toBe(200);
    expect(sA.body.tenant_id).not.toBe(sB.body.tenant_id);
  });
});

// ── 4. RBAC ──────────────────────────────────────────────────────────────────
describe('4. RBAC — Role-Based Access Control', () => {
  // /api/admin/dashboard — agency_admin only
  test('T16 agency_admin CAN access /api/admin/dashboard', async () => {
    const res = await request(app).get('/api/admin/dashboard').set(await auth('adminA'));
    expect(res.status).toBe(200);
  });

  test('T17 marketer CANNOT access /api/admin/dashboard → 403', async () => {
    const res = await request(app).get('/api/admin/dashboard').set(await auth('marketerA'));
    expect(res.status).toBe(403);
  });

  test('T18 viewer CANNOT access /api/admin/dashboard → 403', async () => {
    const res = await request(app).get('/api/admin/dashboard').set(await auth('viewerA'));
    expect(res.status).toBe(403);
  });

  // /api/campaigns/manage — agency_admin + marketer
  test('T19 agency_admin CAN access /api/campaigns/manage', async () => {
    const res = await request(app).get('/api/campaigns/manage').set(await auth('adminA'));
    expect(res.status).toBe(200);
  });

  test('T20 marketer CAN access /api/campaigns/manage', async () => {
    const res = await request(app).get('/api/campaigns/manage').set(await auth('marketerA'));
    expect(res.status).toBe(200);
  });

  test('T21 viewer CANNOT access /api/campaigns/manage → 403', async () => {
    const res = await request(app).get('/api/campaigns/manage').set(await auth('viewerA'));
    expect(res.status).toBe(403);
  });

  // /api/campaigns/view — all authenticated roles
  test('T22 viewer CAN access /api/campaigns/view', async () => {
    const res = await request(app).get('/api/campaigns/view').set(await auth('viewerA'));
    expect(res.status).toBe(200);
  });
});

// ── 5. Email Sequence & Guardrails ───────────────────────────────────────────
describe('5. Email Sequence & Guardrails', () => {
  test('T23 returns 401 without auth', async () => {
    const res = await request(app).post('/api/email/sequence')
      .send({ campaign_goal: 'Test', audience_segment: 'Test' });
    expect(res.status).toBe(401);
  });

  test('T24 returns 200 with 3 emails and guardrail_flags', async () => {
    const res = await request(app).post('/api/email/sequence')
      .set(await auth('adminA'))
      .send({ campaign_goal: 'Increase gym memberships', audience_segment: 'Young professionals' });
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.emails)).toBe(true);
    expect(res.body.emails).toHaveLength(3);
    expect(res.body).toHaveProperty('guardrail_flags');
  });

  test('T25 all emails contain unsubscribe text (guardrail proof)', async () => {
    const res = await request(app).post('/api/email/sequence')
      .set(await auth('adminA'))
      .send({ campaign_goal: 'Drive sales', audience_segment: 'Adults 25-40' });
    expect(res.status).toBe(200);
    for (const email of res.body.emails) {
      const lower = email.body.toLowerCase();
      expect(lower.includes('unsubscribe') || lower.includes('stop')).toBe(true);
    }
  });
});
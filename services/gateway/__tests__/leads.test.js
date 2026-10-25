process.env.JWT_SECRET = 'lead-route-test-secret';
process.env.DB_PASSWORD = 'test';
jest.mock('../src/db', () => ({ query: jest.fn() }));

const request = require('supertest');
const jwt = require('jsonwebtoken');
const pool = require('../src/db');
const app = require('../src/server');

function token(role = 'agency_admin') {
  return jwt.sign({ sub: 'user-a', tenant_id: 'tenant-uuid-a', role }, process.env.JWT_SECRET,
    { issuer: 'c4-gateway', audience: 'c4-platform' });
}

beforeEach(() => {
  pool.query.mockReset();
  pool.query.mockResolvedValue({ rows: [{ slug: 'tenant_a' }] });
  global.fetch = jest.fn().mockResolvedValue({ status: 200, text: async () => '{"tenant_leads":12}' });
});

afterEach(() => { jest.restoreAllMocks(); });

test('requires authentication before forwarding', async () => {
  expect((await request(app).get('/api/leads/dashboard')).status).toBe(401);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('derives tenant from JWT and replaces a spoofed tenant header', async () => {
  const response = await request(app).get('/api/leads/dashboard')
    .set('Authorization', 'Bearer ' + token()).set('X-Tenant-Id', 'tenant_b');
  expect(response.status).toBe(200);
  expect(pool.query).toHaveBeenCalledWith('SELECT slug FROM tenants WHERE tenant_id = $1', ['tenant-uuid-a']);
  expect(global.fetch.mock.calls[0][1].headers['X-Tenant-Id']).toBe('tenant_a');
});

test('viewers cannot write scores', async () => {
  expect((await request(app).post('/api/leads/score')
    .set('Authorization', 'Bearer ' + token('viewer')).send({ lead_id: 'lead-a' })).status).toBe(403);
  expect(global.fetch).not.toHaveBeenCalled();
});

test('reports upstream failures', async () => {
  global.fetch.mockRejectedValue(new Error('connection refused'));
  expect((await request(app).get('/api/leads/monitoring')
    .set('Authorization', 'Bearer ' + token())).status).toBe(502);
});

test('preserves upstream validation errors', async () => {
  global.fetch.mockResolvedValue({ status: 422, text: async () => '{"detail":"Invalid lead"}' });
  const response = await request(app).post('/api/leads/score')
    .set('Authorization', 'Bearer ' + token()).send({});
  expect(response.status).toBe(422);
  expect(response.body.detail).toBe('Invalid lead');
});

test('viewers can read lead history, forwarded with the JWT tenant', async () => {
  for (const path of ['/api/leads/history', '/api/leads/L-123/history']) {
    const response = await request(app).get(path).set('Authorization', 'Bearer ' + token('viewer'));
    expect(response.status).toBe(200);
  }
  expect(global.fetch.mock.calls[0][0]).toMatch(/\/leads\/history$/);
  expect(global.fetch.mock.calls[1][0]).toMatch(/\/leads\/L-123\/history$/);
  expect(global.fetch.mock.calls[1][1].headers['X-Tenant-Id']).toBe('tenant_a');
});

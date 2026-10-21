process.env.JWT_SECRET = 'knowledge-test-secret';
jest.mock('../src/config/db', () => ({ query: jest.fn(), validTenant: id => /^[0-9a-f-]{36}$/i.test(id) }));
jest.mock('../src/services/llmService', () => ({ getEmbedding: jest.fn() }));
const request = require('supertest');
const jwt = require('jsonwebtoken');
const express = require('express');
const db = require('../src/config/db');
const llm = require('../src/services/llmService');
const app = express();
app.use(express.json());
app.use('/knowledge', require('../src/routes/knowledge'));
app.use((err, req, res, next) => res.status(err.status || 500).json({ success: false, error: err.message }));
const tenant = '11111111-1111-4111-8111-111111111111';
const entryId = '22222222-2222-4222-8222-222222222222';
const token = `Bearer ${jwt.sign({ clientId: tenant }, process.env.JWT_SECRET)}`;
beforeEach(() => {
  jest.clearAllMocks();
  db.query.mockImplementation(async sql => ({ rows: sql.includes('FROM clients') ? [{ id: tenant, is_active: true }] : [{ entry_id: entryId, type: 'brand_voice', text: 'Be clear.' }] }));
  llm.getEmbedding.mockResolvedValue(Array(768).fill(0));
});
test('unauthenticated requests cannot read or change knowledge', async () => {
  for (const method of ['get', 'post', 'delete']) {
    const response = await request(app)[method](method === 'delete' ? `/knowledge/${entryId}` : '/knowledge');
    expect(response.status).toBe(401);
  }
  expect(db.query).not.toHaveBeenCalled();
});
test('list queries only the authenticated tenant', async () => {
  const response = await request(app).get('/knowledge').set('Authorization', token);
  expect(response.body.entries).toHaveLength(1);
  expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('WHERE tenant_id = $1'), [tenant], tenant);
});
test('add embeds text and ignores a supplied foreign tenant', async () => {
  const response = await request(app).post('/knowledge').set('Authorization', token).send({ type: 'brand_voice', text: ' Be clear. ', tenant_id: entryId });
  expect(response.status).toBe(201);
  expect(llm.getEmbedding).toHaveBeenCalledWith('Be clear.');
  expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('INSERT INTO knowledge_base'), [expect.any(String), tenant, 'brand_voice', 'Be clear.', JSON.stringify(Array(768).fill(0))], tenant);
});
test.each([{ type:'unknown', text:'Something' }, { type:'brand', text:'  ' }])('invalid knowledge is rejected before embedding', async body => {
  expect((await request(app).post('/knowledge').set('Authorization', token).send(body)).status).toBe(400);
  expect(llm.getEmbedding).not.toHaveBeenCalled();
});
test('foreign or missing entry cannot be deleted', async () => {
  db.query.mockImplementation(async sql => ({ rows: sql.includes('FROM clients') ? [{ is_active:true }] : [] }));
  const response = await request(app).delete(`/knowledge/${entryId}`).set('Authorization', token);
  expect(response.status).toBe(404);
  expect(db.query).toHaveBeenLastCalledWith(expect.stringContaining('tenant_id = $1 AND entry_id = $2'), [tenant, entryId], tenant);
});
test('embedding failures do not insert an incomplete entry', async () => {
  llm.getEmbedding.mockRejectedValue(new Error('Embedding unavailable'));
  expect((await request(app).post('/knowledge').set('Authorization', token).send({ type:'brand', text:'A business fact' })).status).toBe(500);
  expect(db.query.mock.calls.some(([sql]) => sql.includes('INSERT'))).toBe(false);
});

jest.mock('../src/db', () => ({ connect: jest.fn() }));

const pool = require('../src/db');
const { generateSequence } = require('../src/services/emailAgent');
const originalFetch = global.fetch;
let client;

beforeEach(() => {
  client = { query: jest.fn().mockResolvedValue({ rows: [{ text: 'Tenant A context' }] }), release: jest.fn() };
  pool.connect.mockResolvedValue(client);
  global.fetch = jest.fn()
    .mockResolvedValueOnce({ ok: true, json: async () => ({ embedding: [0.1, 0.2] }) })
    .mockResolvedValueOnce({ ok: true, json: async () => ({ response: JSON.stringify({ emails: [{ subject: 'Campaign', body: 'Hello' }] }) }) });
});

afterEach(() => { global.fetch = originalFetch; });

test('reads the email KB with transaction-scoped tenant context on the same connection', async () => {
  await generateSequence('tenant-a-uuid', 'Campaign goal', 'Audience');
  expect(client.query.mock.calls[0]).toEqual(['BEGIN']);
  expect(client.query.mock.calls[1]).toEqual(["SELECT set_config('app.current_tenant', $1, true)", ['tenant-a-uuid']]);
  expect(client.query.mock.calls[2][1]).toEqual(['tenant-a-uuid', '[0.1,0.2]']);
  expect(client.query.mock.calls[3]).toEqual(['COMMIT']);
  expect(client.release).toHaveBeenCalledTimes(1);
});

test('rolls back and releases the connection when KB retrieval fails', async () => {
  client.query.mockRejectedValueOnce(new Error('Database unavailable'));
  const sequence = await generateSequence('tenant-a-uuid', 'Campaign goal', 'Audience');
  expect(sequence.emails).toHaveLength(1);
  expect(client.query).toHaveBeenCalledWith('ROLLBACK');
  expect(client.release).toHaveBeenCalledTimes(1);
});

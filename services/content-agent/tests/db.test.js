const mockClient = { query:jest.fn(),release:jest.fn() };
jest.mock('pg',()=>({Pool:jest.fn(()=>({connect:jest.fn(async()=>mockClient)}))}));
const db = require('../src/config/db');
const tenant='11111111-1111-4111-8111-111111111111';
beforeEach(()=>{jest.clearAllMocks();mockClient.query.mockResolvedValue({rows:[]});});
test('scope and data query use the same checked-out connection and release it',async()=>{
  await db.query('SELECT text FROM knowledge_base WHERE tenant_id = $1',[tenant],tenant);
  expect(mockClient.query.mock.calls.map(c=>c[0])).toEqual(['BEGIN',"SELECT set_config('app.current_tenant', $1, true)","SELECT set_config('app.current_tenant', $1, true)",'SELECT text FROM knowledge_base WHERE tenant_id = $1','COMMIT']);
  expect(mockClient.query.mock.calls[1][1]).toEqual([tenant]);
  expect(mockClient.release).toHaveBeenCalledTimes(1);
});
test('failed work rolls back and releases the connection',async()=>{
  await expect(db.transaction(tenant,async()=>{throw new Error('failed');})).rejects.toThrow('failed');
  expect(mockClient.query).toHaveBeenLastCalledWith('ROLLBACK');expect(mockClient.release).toHaveBeenCalledTimes(1);
});
test('tenant tables reject unscoped access',async()=>{await expect(db.query('SELECT * FROM generations')).rejects.toThrow('Tenant scope is required');});

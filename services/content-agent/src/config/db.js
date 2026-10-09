const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL, connectionTimeoutMillis: 5000 });
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validTenant(id) { return typeof id === 'string' && UUID.test(id); }
async function transaction(tenantId, work) {
  if (!validTenant(tenantId)) throw Object.assign(new Error('Invalid tenant ID'), { status: 400 });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    // set_config with true is parameterized SET LOCAL on this same connection.
    await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
    const scoped = async (text, params = []) => {
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenantId]);
      return client.query(text, params);
    };
    const result = await work(scoped);
    await client.query('COMMIT');
    return result;
  } catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
async function query(text, params = [], tenantId) {
  if (tenantId) return transaction(tenantId, run => run(text, params));
  if (/\b(knowledge_base|generations|prompt_performance|business_settings)\b/i.test(text)) {
    throw new Error('Tenant scope is required');
  }
  const client = await pool.connect();
  try { return await client.query(text, params); } finally { client.release(); }
}
module.exports = { pool, query, transaction, validTenant };

'use strict';
// Read-only application/database inspection. No passwords, cookies, or tokens are logged.
const path = require('node:path');
const fs = require('node:fs');
const root = path.resolve(__dirname, '../..');
const gateway = path.join(root, 'services/gateway');
require(path.join(gateway, 'node_modules/dotenv')).config({ path: path.join(gateway, '.env'), quiet: true });
const { Pool } = require(path.join(gateway, 'node_modules/pg'));
const pool = new Pool({ host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: process.env.DB_NAME, user: process.env.DB_USER, password: process.env.DB_PASSWORD, connectionTimeoutMillis: 5000 });
const report = { audit_date: '2026-10-21', read_only: true, endpoints: [] };
async function endpoint(url, options = {}) {
  try {
    const result = await fetch(url, { ...options, signal: AbortSignal.timeout(5000) });
    const item = { url, method: options.method || 'GET', status: result.status, server: result.headers.get('server') };
    if (url.endsWith('/health')) item.body = await result.json().catch(() => null);
    report.endpoints.push(item);
  } catch (error) { report.endpoints.push({ url, error: error.cause?.code || error.name }); }
}
async function main() {
  for (const route of ['/health', '/api/auth/me', '/api/tenant/context', '/api/platform/snapshot']) await endpoint('http://127.0.0.1:4000' + route);
  await endpoint('http://127.0.0.1:4000/api/email/sequence', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' });
  await endpoint('http://127.0.0.1:5173/');
  await endpoint('http://127.0.0.1:5173/api/auth/me');
  report.configured_model_in_host_env = process.env.OLLAMA_MODEL || '(default)';
  try {
    const result = await fetch((process.env.OLLAMA_HOST || 'http://127.0.0.1:11434') + '/api/tags', { signal: AbortSignal.timeout(5000) });
    report.ollama = { http_status: result.status, models: (await result.json()).models?.map(m => m.name) };
  } catch (error) { report.ollama = { error: error.cause?.code || error.name }; }
  const client = await pool.connect();
  try {
    await client.query('BEGIN READ ONLY');
    report.application_role = (await client.query('SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
    report.rls = (await client.query("SELECT relname, relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ANY(ARRAY['users'::regclass,'knowledge_base'::regclass,'auth_sessions'::regclass,'workspace_invitations'::regclass,'campaigns'::regclass,'email_sequences'::regclass,'workspace_events'::regclass]) ORDER BY relname")).rows;
    report.unscoped_counts = {};
    for (const table of ['users', 'knowledge_base', 'campaigns', 'email_sequences']) report.unscoped_counts[table] = (await client.query(`SELECT count(*)::int AS count FROM ${table}`)).rows[0].count;
    const tenants = (await client.query("SELECT tenant_id, slug FROM tenants WHERE slug IN ('tenant_a','tenant_b','tenant_c') ORDER BY slug")).rows;
    report.sample_tenants = [];
    for (const tenant of tenants) {
      await client.query("SELECT set_config('app.current_tenant', $1, true)", [tenant.tenant_id]);
      const users = (await client.query('SELECT tenant_id FROM users')).rows;
      const foreign = tenants.find(other => other.tenant_id !== tenant.tenant_id);
      const foreignCount = foreign ? (await client.query('SELECT count(*)::int AS count FROM users WHERE tenant_id=$1', [foreign.tenant_id])).rows[0].count : null;
      report.sample_tenants.push({ slug: tenant.slug, own_users_visible: users.length, only_own_users: users.every(u => u.tenant_id === tenant.tenant_id), foreign_users_visible: foreignCount });
    }
    await client.query('ROLLBACK');
  } finally { client.release(); }
}
main().catch(error => { report.error = error.code || error.name; process.exitCode = 1; }).finally(async () => {
  await pool.end();
  fs.writeFileSync(path.join(__dirname, 'checks/runtime-audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
});

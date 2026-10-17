'use strict';
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { Client } = require('pg');
const directory = process.env.MIGRATIONS_DIR || path.resolve(__dirname, '../db/migrations');
const config = {
  host: process.env.DB_HOST || 'gateway-database', port: Number(process.env.DB_PORT || 5432),
  database: process.env.DB_NAME || 'saas_platform', user: process.env.MIGRATION_DB_USER || 'admin',
  password: process.env.MIGRATION_DB_PASSWORD, connectionTimeoutMillis: 10000,
};
// Adopt the known existing schema without rerunning non-idempotent legacy policies.
const baselines = {
  '001_init.sql': "SELECT to_regclass('public.tenants') IS NOT NULL AND to_regclass('public.users') IS NOT NULL AND to_regclass('public.knowledge_base') IS NOT NULL AND to_regclass('public.audit_log') IS NOT NULL AS present",
  '002_app_role.sql': "SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname='c4_app') AND EXISTS (SELECT 1 FROM information_schema.role_table_grants WHERE grantee='c4_app' AND table_name='users' AND privilege_type='INSERT') AS present",
  '003_auth_lookup.sql': "SELECT EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth_private' AND p.proname='lookup_login_user') AS present",
  '004_accounts_and_sessions.sql': "SELECT to_regclass('public.auth_sessions') IS NOT NULL AND to_regclass('public.workspace_invitations') IS NOT NULL AND EXISTS (SELECT 1 FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace WHERE n.nspname='auth_private' AND p.proname='register_account') AS present",
};
async function main() {
  if (!config.password || !process.env.DB_PASSWORD) throw new Error('Set migration and application database passwords.');
  if (process.env.DB_USER !== 'c4_app') throw new Error('The application must use the restricted c4_app database role.');
  const client = new Client(config);
  await client.connect();
  try {
    await client.query("SELECT pg_advisory_lock(hashtext('c4_schema_migrations'))");
    const roleExisted = (await client.query("SELECT 1 FROM pg_roles WHERE rolname='c4_app'")).rowCount > 0;
    await client.query('CREATE TABLE IF NOT EXISTS c4_schema_migrations (name TEXT PRIMARY KEY, checksum TEXT NOT NULL, adopted BOOLEAN NOT NULL DEFAULT false, applied_at TIMESTAMPTZ NOT NULL DEFAULT now())');
    await client.query('REVOKE ALL ON c4_schema_migrations FROM PUBLIC');
    for (const name of fs.readdirSync(directory).filter(name => /^\d+_.+\.sql$/.test(name)).sort()) {
      const sql = fs.readFileSync(path.join(directory, name), 'utf8').replace(/\r\n/g, '\n');
      const checksum = crypto.createHash('sha256').update(sql).digest('hex');
      const previous = (await client.query('SELECT checksum FROM c4_schema_migrations WHERE name=$1', [name])).rows[0];
      if (previous) {
        if (previous.checksum !== checksum) throw new Error('An applied migration changed: ' + name);
        console.log('Already applied: ' + name); continue;
      }
      const adopted = baselines[name] ? (await client.query(baselines[name])).rows[0].present : false;
      if (!adopted) await client.query(sql);
      await client.query('INSERT INTO c4_schema_migrations (name,checksum,adopted) VALUES ($1,$2,$3)', [name, checksum, adopted]);
      console.log((adopted ? 'Adopted existing schema: ' : 'Applied: ') + name);
    }
    if (!roleExisted) {
      const passwordSql = (await client.query("SELECT format('ALTER ROLE c4_app PASSWORD %L', $1::text) AS statement", [process.env.DB_PASSWORD])).rows[0].statement;
      await client.query(passwordSql);
    }
    const application = new Client({ ...config, user: 'c4_app', password: process.env.DB_PASSWORD });
    await application.connect();
    try {
      const role = (await application.query('SELECT rolsuper, rolbypassrls FROM pg_roles WHERE rolname=current_user')).rows[0];
      if (role.rolsuper || role.rolbypassrls) throw new Error('Application database role must enforce row-level security.');
      const isolated = await application.query("SELECT relrowsecurity, relforcerowsecurity FROM pg_class WHERE oid = ANY(ARRAY['users'::regclass,'knowledge_base'::regclass,'auth_sessions'::regclass,'workspace_invitations'::regclass,'campaigns'::regclass,'email_sequences'::regclass,'workspace_events'::regclass])");
      if (isolated.rows.length !== 7 || isolated.rows.some(table => !table.relrowsecurity || !table.relforcerowsecurity)) throw new Error('Tenant tables must enforce row-level security.');
      await application.query('SELECT 1 FROM campaigns LIMIT 1');
      console.log('Application connection verified with tenant isolation.');
    } finally { await application.end(); }
  } finally {
    await client.query("SELECT pg_advisory_unlock(hashtext('c4_schema_migrations'))").catch(() => {});
    await client.end();
  }
}
main().catch(error => { console.error('Database migration failed:', error.code || error.message); process.exitCode = 1; });

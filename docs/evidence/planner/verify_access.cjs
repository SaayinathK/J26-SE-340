'use strict';
// Additional audit checks use a uniquely named temporary database, never workspace records.
const path = require('node:path');
const fs = require('node:fs');
const crypto = require('node:crypto');
const assert = require('node:assert/strict');
const root = path.resolve(__dirname, '../..');
const gateway = path.join(root, 'services/gateway');
require(path.join(gateway, 'node_modules/dotenv')).config({ path: path.join(gateway, '.env'), quiet: true });
const { Client } = require(path.join(gateway, 'node_modules/pg'));
const request = require(path.join(gateway, 'node_modules/supertest'));
const database = 'c4_planner_verify_' + crypto.randomBytes(6).toString('hex');
const ownerConfig = { host: process.env.DB_HOST, port: Number(process.env.DB_PORT), database: 'postgres', user: process.env.MIGRATION_DB_USER || 'admin', password: process.env.POSTGRES_PASSWORD || process.env.MIGRATION_DB_PASSWORD || 'localdev', connectionTimeoutMillis: 5000 };
const owner = new Client(ownerConfig);
const report = { audit_date: '2026-10-21', isolated_database: true, rbac: [], isolation: [], audit_log: null, cleaned_up: false };
let created = false;
let applicationPool;
async function main() {
  assert.match(database, /^c4_planner_verify_[a-f0-9]{12}$/);
  await owner.connect();
  await owner.query('CREATE DATABASE ' + database); created = true;
  const setup = new Client({ ...ownerConfig, database });
  await setup.connect();
  try {
    for (const file of fs.readdirSync(path.join(root, 'db/migrations')).filter(f => /^\d+_.+\.sql$/.test(f)).sort()) await setup.query(fs.readFileSync(path.join(root, 'db/migrations', file), 'utf8'));
    process.env.DB_NAME = database;
    const app = require(path.join(gateway, 'src/server'));
    applicationPool = require(path.join(gateway, 'src/db'));
    const password = 'PlannerEvidencePass123!';
    const accounts = [];
    for (let i = 0; i < 3; i++) {
      const result = await request(app).post('/api/auth/register').send({ name: 'Audit Administrator ' + i, workspace_name: 'Audit Workspace ' + i, email: `planner-admin-${i}@example.com`, password });
      assert.equal(result.status, 201);
      accounts.push({ token: result.body.access_token, tenant: result.body.user.tenant_id, user: result.body.user.user_id });
    }
    const roles = { agency_admin: accounts[0] };
    for (const role of ['marketer', 'viewer']) {
      const email = `planner-${role}@example.com`;
      const invite = await request(app).post('/api/team/invitations').set('Authorization', 'Bearer ' + accounts[0].token).send({ email, role });
      assert.equal(invite.status, 201);
      const token = new URLSearchParams(invite.body.invitation_url.split('?')[1]).get('invite');
      const result = await request(app).post('/api/auth/register').send({ name: 'Audit ' + role, email, password, invitation_token: token });
      assert.equal(result.status, 201);
      roles[role] = { token: result.body.access_token, tenant: result.body.user.tenant_id };
    }
    const routes = [['/api/admin/dashboard', ['agency_admin']], ['/api/campaigns/manage', ['agency_admin', 'marketer']], ['/api/campaigns/view', ['agency_admin', 'marketer', 'viewer']]];
    for (const [role, account] of Object.entries(roles)) for (const [route, allowed] of routes) {
      const expected = allowed.includes(role) ? 200 : 403;
      const result = await request(app).get(route).set('Authorization', 'Bearer ' + account.token);
      assert.equal(result.status, expected);
      report.rbac.push({ role, route, expected, actual: result.status, passed: true });
    }
    for (const account of accounts) {
      const connection = await applicationPool.connect();
      try {
        await connection.query('BEGIN');
        await connection.query("SELECT set_config('app.current_tenant', $1, true)", [account.tenant]);
        const visible = (await connection.query('SELECT tenant_id FROM users')).rows;
        assert(visible.length > 0 && visible.every(r => r.tenant_id === account.tenant));
        const foreign = accounts.find(other => other.tenant !== account.tenant);
        assert.equal((await connection.query('SELECT user_id FROM users WHERE tenant_id=$1', [foreign.tenant])).rowCount, 0);
        await connection.query('SAVEPOINT denied_insert');
        await assert.rejects(connection.query('INSERT INTO campaigns (tenant_id,name,audience) VALUES ($1,$2,$3)', [foreign.tenant, 'Forbidden cross-tenant write', 'None']), error => error.code === '42501');
        await connection.query('ROLLBACK TO SAVEPOINT denied_insert');
        await connection.query('ROLLBACK');
        report.isolation.push({ tenant_number: accounts.indexOf(account) + 1, own_users_visible: visible.length, cross_tenant_reads_blocked: true, cross_tenant_inserts_blocked: true });
      } finally { connection.release(); }
    }
    // Audit inserts happen on response finish. Wait briefly for those known writes.
    let records = [];
    for (let attempt = 0; attempt < 30; attempt++) {
      records = (await setup.query("SELECT tenant_id,user_id,route,decision,status_code FROM audit_log WHERE route IN ('/api/admin/dashboard','/api/campaigns/manage','/api/campaigns/view')")).rows;
      if (records.length === 9) break;
      await new Promise(resolve => setTimeout(resolve, 50));
    }
    assert.equal(records.length, 9);
    assert(records.every(r => r.tenant_id === accounts[0].tenant && r.user_id && r.route));
    assert.equal(records.filter(r => r.decision === 'allowed' && r.status_code === 200).length, 6);
    assert.equal(records.filter(r => r.decision === 'denied' && r.status_code === 403).length, 3);
    report.audit_log = { verified_records: 9, allowed: 6, denied: 3, tenant_user_route_recorded: true };
    report.passed = true;
  } finally { await setup.end(); }
}
main().catch(error => { report.passed = false; report.error = error.code || error.message; process.exitCode = 1; }).finally(async () => {
  if (applicationPool) await applicationPool.end();
  if (created && /^c4_planner_verify_[a-f0-9]{12}$/.test(database)) {
    try { await owner.query('DROP DATABASE ' + database + ' WITH (FORCE)'); report.cleaned_up = true; }
    catch (error) { report.cleanup_error = error.code || error.name; process.exitCode = 1; }
  }
  await owner.end().catch(() => {});
  fs.writeFileSync(path.join(__dirname, 'checks/access-audit.json'), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify(report, null, 2));
});

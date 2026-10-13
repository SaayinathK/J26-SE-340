//tests\test-tenant-isolation.js
const { Pool } = require('../services/gateway/node_modules/pg');

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  database: 'saas_platform',
  user: 'c4_app',
  password: 'c4_local_dev_only_2026'
});

async function getUsersForTenant(slug) {
  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const tenantResult = await client.query(
      'SELECT tenant_id FROM tenants WHERE slug = $1',
      [slug]
    );

    if (tenantResult.rows.length !== 1) {
      throw new Error(`Tenant not found: ${slug}`);
    }

    const tenantId = tenantResult.rows[0].tenant_id;

    await client.query(
      "SELECT set_config('app.current_tenant', $1, true)",
      [tenantId]
    );

    const result = await client.query(
      `SELECT tenant_id, email, role
       FROM users
       ORDER BY email`
    );

    await client.query('COMMIT');

    return {
      tenantId,
      users: result.rows
    };
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
  }
}

async function main() {
  const expectedCounts = {
    tenant_a: 3,
    tenant_b: 1,
    tenant_c: 1
  };

  for (const [slug, expectedCount] of Object.entries(expectedCounts)) {
    const { tenantId, users } = await getUsersForTenant(slug);

    const isolated = users.every(
      user => user.tenant_id === tenantId
    );

    const passed =
      isolated && users.length === expectedCount;

    console.log(`\n${slug}`);
    console.log(`Visible users: ${users.length}`);

    users.forEach(user => {
      console.log(`  ${user.email} (${user.role})`);
    });

    console.log(
      `Tenant isolation: ${passed ? 'PASS' : 'FAIL'}`
    );

    if (!passed) {
      throw new Error(`Isolation test failed for ${slug}`);
    }
  }

  console.log('\nALL TENANT ISOLATION TESTS PASSED');
}

main()
  .catch(error => {
    console.error(error);
    process.exitCode = 1;
  })
  .finally(() => pool.end());

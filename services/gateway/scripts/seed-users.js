
require('dotenv').config();

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const pool = new Pool({
  host: 'localhost',
  port: 5433,
  database: 'saas_platform',
  user: 'c4_app',
  password: 'c4_local_dev_only_2026'
});

async function seedUsers() {
  const passwordHash = await bcrypt.hash('Test@12345', 12);

  const users = [
    ['tenant_a', 'admin@tenant-a.com', 'agency_admin'],
    ['tenant_a', 'marketer@tenant-a.com', 'marketer'],
    ['tenant_a', 'viewer@tenant-a.com', 'viewer'],
    ['tenant_b', 'admin@tenant-b.com', 'agency_admin'],
    ['tenant_c', 'admin@tenant-c.com', 'agency_admin']
  ];

  for (const [slug, email, role] of users) {
    const client = await pool.connect();

    try {
      await client.query('BEGIN');

      const tenant = await client.query(
        'SELECT tenant_id FROM tenants WHERE slug = $1',
        [slug]
      );

      if (tenant.rows.length === 0) {
        throw new Error(`Tenant not found: ${slug}`);
      }

      const tenantId = tenant.rows[0].tenant_id;

      await client.query(
        "SELECT set_config('app.current_tenant', $1, true)",
        [tenantId]
      );

      await client.query(
        `INSERT INTO users
         (tenant_id, email, password_hash, role)
         VALUES ($1, $2, $3, $4)
         ON CONFLICT (email) DO NOTHING`,
        [tenantId, email, passwordHash, role]
      );

      await client.query('COMMIT');

      console.log(`Created or verified: ${email}`);
    } catch (error) {
      await client.query('ROLLBACK');
      throw error;
    } finally {
      client.release();
    }
  }
}

seedUsers()
  .then(() => console.log('User seeding completed'))
  .catch(console.error)
  .finally(() => pool.end());

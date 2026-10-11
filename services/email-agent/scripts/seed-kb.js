// scripts/seed-kb.js
require('dotenv').config({ path: require('path').resolve(__dirname, '../.env') });
const { Pool } = require('pg');
const { promisify } = require('util');
const sleep = promisify(setTimeout);

// Use c4_app role (from .env) — no separate admin connection needed
const pool = new Pool({
  host:     process.env.DB_HOST     || 'localhost',
  port:     Number(process.env.DB_PORT) || 5433,
  database: process.env.DB_NAME     || 'saas_platform',
  user:     process.env.DB_USER     || 'c4_app',
  password: process.env.DB_PASSWORD,
});

const OLLAMA      = process.env.OLLAMA_HOST  || 'http://localhost:11434';
const EMBED_MODEL = process.env.EMBED_MODEL  || 'nomic-embed-text';
const sleep_ms    = promisify(setTimeout);

async function embed(text) {
  const res = await fetch(`${OLLAMA}/api/embeddings`, {
    method:  'POST',
    headers: { 'Content-Type': 'application/json' },
    body:    JSON.stringify({ model: EMBED_MODEL, prompt: text }),
  });
  if (!res.ok) throw new Error(`Ollama HTTP ${res.status}`);
  const { embedding } = await res.json();
  return embedding;
}

const ENTRIES = [
  { text: 'Green Leaf Coaching uses an encouraging, science-backed tone. We emphasise sustainable habits, community, and evidence-based wellness.' },
  { text: 'Membership tiers: Basic $29/mo (gym floor weekdays), Premium $59/mo (adds classes + app), Elite $99/mo (adds personal training).' },
  { text: 'Target audience: Young professionals aged 25-35 who want efficient 45-minute workouts before or after work. They value convenience, results, and community.' },
  { text: 'Key benefits: State-of-the-art equipment refreshed yearly, certified trainers, flexible freeze options, guest passes, towel service, parking.' },
  { text: 'October 2026 promotions: First month free for new members. Refer a friend and earn $20 credit. No joining fee this month.' },
];

async function seed() {
 const { rows } = await pool.query(
  `SELECT tenant_id FROM tenants WHERE slug = 'tenant_a' LIMIT 1`,
);
const tenant_id = rows[0].tenant_id;
  console.log('Seeding for tenant_id:', tenant_id);

  for (const entry of ENTRIES) {
    process.stdout.write(`  Embedding: "${entry.text.slice(0, 40)}…" `);
    const embedding = await embed(entry.text);

    // set_config AND INSERT must be in the SAME transaction on the SAME client
    const client = await pool.connect();
    try {
      await client.query('BEGIN');
      await client.query(`SELECT set_config('app.current_tenant', $1, true)`, [tenant_id]);
      await client.query(
        `INSERT INTO knowledge_base (tenant_id, text, embedding)
         VALUES ($1, $2, $3::vector)
         ON CONFLICT DO NOTHING`,
        [tenant_id, entry.text, JSON.stringify(embedding)],
      );
      await client.query('COMMIT');
      console.log('✓');
    } catch (e) {
      await client.query('ROLLBACK');
      throw e;
    } finally {
      client.release();
    }
    await sleep(300);
  }

  console.log('\n✅  Done.');
  await pool.end();
}

seed().catch(e => { console.error('Failed:', e.message); process.exit(1); });
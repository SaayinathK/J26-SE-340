'use strict';
// Optional direct PostgreSQL setup for verification when the Docker CLI is unavailable.
require('dotenv').config({ path: require('node:path').resolve(__dirname, '../.env'), quiet: true });
const { Client } = require('pg');
const fs = require('node:fs');
const path = require('node:path');
const [action, name] = process.argv.slice(2);
if (!['create', 'drop'].includes(action) || !/^c4_browser_verify_[a-f0-9]{12}$/.test(name || '')) {
  throw new Error('Only create/drop of an isolated c4_browser_verify database is permitted.');
}
const configuration = {
  host: process.env.DB_HOST || '127.0.0.1', port: Number(process.env.DB_PORT || 5433),
  database: 'postgres', user: process.env.MIGRATION_DB_USER || 'admin',
  password: process.env.POSTGRES_PASSWORD || process.env.MIGRATION_DB_PASSWORD || 'localdev',
  connectionTimeoutMillis: 5000, query_timeout: 15000,
};
async function main() {
  const owner = new Client(configuration);
  await owner.connect();
  try {
    if (action === 'drop') {
      await owner.query('DROP DATABASE ' + name + ' WITH (FORCE)');
      console.log('Removed isolated browser database.');
      return;
    }
    await owner.query('CREATE DATABASE ' + name);
    const database = new Client({ ...configuration, database: name });
    try {
      await database.connect();
      const directory = path.resolve(__dirname, '../db/migrations');
      for (const file of fs.readdirSync(directory).filter(file => /^\d+_.+\.sql$/.test(file)).sort()) {
        await database.query(fs.readFileSync(path.join(directory, file), 'utf8'));
      }
      console.log('Created and migrated isolated browser database.');
    } catch (error) {
      await database.end().catch(() => {});
      await owner.query('DROP DATABASE ' + name + ' WITH (FORCE)');
      throw error;
    } finally { await database.end().catch(() => {}); }
  } finally { await owner.end(); }
}
main().catch(error => { console.error('Isolated database operation failed:', error.code || error.name); process.exitCode = 1; });

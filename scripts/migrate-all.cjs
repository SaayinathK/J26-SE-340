'use strict';
const path = require('node:path');
const fs = require('node:fs');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
for (const [service, port] of [['gateway',5433],['email-agent',5434]]) {
  const cwd = path.join(root, 'services', service);
  const dotenv = require(path.join(cwd, 'node_modules/dotenv'));
  const config = dotenv.parse(fs.readFileSync(path.join(cwd, '.env')));
  const owner = dotenv.parse(fs.readFileSync(path.join(cwd, 'db/.env')));
  const result = spawnSync(process.execPath, ['scripts/migrate.js'], { cwd, windowsHide: true, stdio: 'inherit', env: {
    ...process.env, ...config, DB_HOST: '127.0.0.1', DB_PORT: String(port), MIGRATION_DB_USER: 'admin', MIGRATION_DB_PASSWORD: owner.POSTGRES_PASSWORD,
  } });
  if (result.status !== 0) process.exit(result.status || 1);
}
console.log('Available service migrations applied. Pending agents have no application migrations yet.');

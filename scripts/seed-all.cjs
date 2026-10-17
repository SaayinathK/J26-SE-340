'use strict';
// Optional, explicit demo seeds; startup never seeds user databases automatically.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
for (const [service, database] of [['gateway','saas_platform'],['email-agent','email_agent'],['content-agent','content_agent'],['lead-intel','lead_intel'],['strategy-fl','strategy_fl']]) {
  const directory = path.join(root, 'services', service, 'db/seed');
  for (const file of fs.readdirSync(directory).filter(name => name.endsWith('.sql')).sort()) {
    const result = spawnSync('docker', ['exec','-i',service+'-database','psql','-U','admin','-d',database,'-v','ON_ERROR_STOP=1'], {input:fs.readFileSync(path.join(directory,file)),windowsHide:true,stdio:['pipe','inherit','inherit']});
    if (result.status !== 0) process.exit(result.status || 1);
  }
}

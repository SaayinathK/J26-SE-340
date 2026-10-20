'use strict';
const fs = require('node:fs');
const path = require('node:path');
const { spawn } = require('node:child_process');
const [source, destination] = process.argv.slice(2);
const cache = path.resolve(__dirname, './.local/models/blobs') + path.sep;
if (!source || !path.resolve(source).startsWith(cache) || !/^[a-zA-Z0-9_.-]+:\/models\/blobs\/sha256-[a-f0-9]{64}\.partial$/.test(destination || '')) throw new Error('Invalid model copy paths.');
const child = spawn('docker', ['cp', source, destination], { windowsHide: true, stdio: 'inherit' });
let stopped = false;
const guard = setInterval(() => {
  const disk = fs.statfsSync(path.parse(path.resolve(source)).root);
  if (disk.bavail * disk.bsize < 1024 ** 3) {
    stopped = true;
    console.error('Model import stopped to preserve 1 GiB of free host storage. Free disk space before retrying.');
    child.kill();
  }
}, 1000);
child.on('error', error => { clearInterval(guard); console.error(error.message); process.exitCode = 1; });
child.on('exit', code => { clearInterval(guard); process.exitCode = stopped ? 1 : (code || 0); });

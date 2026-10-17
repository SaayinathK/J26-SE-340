// Package verified installed pure-JavaScript runtime packages for an offline image build.
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const lock = require('../package-lock.json');
const destination = path.join(root, '.runtime');
if (!destination.startsWith(root + path.sep)) throw new Error('Invalid staging directory');
fs.rmSync(destination, { recursive: true, force: true });
fs.mkdirSync(destination, { recursive: true });
for (const [relative, info] of Object.entries(lock.packages)) {
  if (!relative || info.dev) continue;
  const source = path.join(root, relative);
  if (!fs.existsSync(source)) { if (info.optional) continue; throw new Error('Install dependencies: ' + relative); }
  // Packages can contain nested node_modules entries tracked separately in the lock.
  linkTree(source, path.join(destination, relative));
}
function linkTree(source, target) {
  fs.mkdirSync(target, { recursive: true });
  for (const entry of fs.readdirSync(source, { withFileTypes: true })) {
    if (entry.name === 'node_modules') continue;
    const from = path.join(source, entry.name), to = path.join(target, entry.name);
    if (entry.isDirectory()) linkTree(from, to);
    else { if (entry.name.endsWith('.node')) throw new Error('Native dependency requires a Linux build: ' + from); if (!fs.existsSync(to)) fs.linkSync(from, to); }
  }
}
console.log('Prepared production dependencies for ' + require('../package.json').name);

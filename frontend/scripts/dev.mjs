import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { resolve } from 'node:path';
import { parseArgs } from 'node:util';
import { createServer, loadEnv } from 'vite';

const frontend = fileURLToPath(new URL('..', import.meta.url));
const gateway = resolve(frontend, '../services/gateway');
const { values } = parseArgs({ options: {
  host: { type: 'string', default: '127.0.0.1' },
  port: { type: 'string', default: '5173' },
  strictPort: { type: 'boolean', default: true },
} });
const frontendPort = Number(values.port);
if (!Number.isInteger(frontendPort) || frontendPort < 1 || frontendPort > 65535) throw new Error('Choose a valid frontend port.');
const frontendEnv = loadEnv('development', frontend, '');
const gatewayEnv = loadEnv('development', gateway, '');
const target = new URL(process.env.GATEWAY_URL || frontendEnv.GATEWAY_URL || `http://127.0.0.1:${gatewayEnv.PORT || 4000}`);
process.env.GATEWAY_URL = target.href;

let child;
let server;
let childError;
let stopping = false;
const delay = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));

async function inspectGateway() {
  let response;
  try { response = await fetch(new URL('/health', target), { signal: AbortSignal.timeout(1500) }); }
  catch { return { connected: false, ready: false }; }
  let health;
  try { health = await response.json(); } catch {}
  if (!response.ok || health?.service !== 'c4-gateway') return { connected: true, ready: false };
  try {
    const config = await fetch(new URL('/api/auth/config', target), { signal: AbortSignal.timeout(1500) });
    const data = await config.json();
    return { connected: true, ready: config.ok && typeof data.csrf_token === 'string' };
  } catch { return { connected: true, ready: false }; }
}

async function stop(code = 0) {
  if (stopping) return;
  stopping = true;
  await server?.close();
  // An existing gateway belongs to its original owner and is left running.
  if (child && child.exitCode === null && child.signalCode === null) child.kill();
  process.exitCode = code;
}

async function start() {
  const existing = await inspectGateway();
  if (existing.connected && !existing.ready) throw new Error(`The service on gateway port ${target.port || 80} is outdated or is not the Ciftron gateway. Restart the correct gateway before continuing.`);
  if (existing.ready) {
    console.log(`Using the running Ciftron gateway on port ${target.port || 80}.`);
  } else {
    if (target.protocol !== 'http:' || !['localhost', '127.0.0.1', '[::1]'].includes(target.hostname)) {
      throw new Error('The configured gateway is unavailable. Start that service or use a local HTTP GATEWAY_URL.');
    }
    const origins = new Set((gatewayEnv.CLIENT_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean));
    origins.add(`http://localhost:${frontendPort}`);
    origins.add(`http://127.0.0.1:${frontendPort}`);
    console.log(`Starting the Ciftron gateway on port ${target.port || 80}…`);
    child = spawn(process.execPath, ['src/main.js'], {
      cwd: gateway,
      env: { ...process.env, PORT: target.port || '80', CLIENT_ORIGINS: [...origins].join(',') },
      stdio: 'inherit',
      windowsHide: true,
    });
    child.on('error', error => { childError = error; });
    child.on('exit', code => {
      childError = new Error(`The gateway stopped (exit ${code ?? 'signal'}). Check its environment and install its dependencies with npm install in services/gateway.`);
      if (server && !stopping) { console.error(childError.message); void stop(1); }
    });
    let ready = false;
    for (let attempt = 0; attempt < 30; attempt++) {
      if (childError) throw childError;
      if ((await inspectGateway()).ready) { ready = true; break; }
      await delay(250);
    }
    if (!ready) throw new Error('The gateway did not become ready. Check services/gateway/.env and the gateway output above.');
  }
  server = await createServer({
    root: frontend,
    configFile: resolve(frontend, 'vite.config.js'),
    server: { host: values.host, port: frontendPort, strictPort: values.strictPort },
  });
  await server.listen();
  server.printUrls();
}

process.on('SIGINT', () => void stop());
process.on('SIGTERM', () => void stop());
start().catch(async error => { console.error(`\n${error.message}\n`); await stop(1); });

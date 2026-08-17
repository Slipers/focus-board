/**
 * Dev launcher : démarre Vite, attend que le serveur réponde, puis lance Electron
 * sur le serveur de dev (hot reload du renderer, recompilation du main à chaud).
 */
import { spawn } from 'node:child_process';
import { once } from 'node:events';
import process from 'node:process';

const PORT = 5273;
const URL = `http://localhost:${PORT}`;
const npx = process.platform === 'win32' ? 'npx.cmd' : 'npx';
const children = [];

function run(cmd, args, extraEnv = {}) {
  const child = spawn(cmd, args, { stdio: 'inherit', shell: process.platform === 'win32', env: { ...process.env, ...extraEnv } });
  children.push(child);
  return child;
}

function shutdown(code = 0) {
  for (const c of children) {
    if (!c.killed) c.kill();
  }
  process.exit(code);
}

async function waitForServer(timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      const res = await fetch(URL);
      if (res.ok) return true;
    } catch {
      /* pas encore prêt */
    }
    await new Promise((r) => setTimeout(r, 250));
  }
  return false;
}

run(npx, ['vite']);

const tsc = run(npx, ['tsc', '-p', 'tsconfig.electron.json']);
await once(tsc, 'exit');
run(process.execPath, ['scripts/copy-preload.mjs']);

if (!(await waitForServer())) {
  console.error('Le serveur Vite n a pas démarré à temps.');
  shutdown(1);
}

const electron = run(npx, ['electron', '.'], { FOCUS_DEV_URL: URL });
electron.on('exit', (code) => shutdown(code ?? 0));

process.on('SIGINT', () => shutdown(0));
process.on('SIGTERM', () => shutdown(0));

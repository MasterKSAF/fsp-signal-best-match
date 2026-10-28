import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
if (existsSync('.env')) process.loadEnvFile('.env');
process.env.PORT ||= process.env.API_PORT || '4312';
process.env.API_PORT ||= process.env.PORT;
if (process.env.PORT !== process.env.API_PORT) {
  throw new Error('PORT and API_PORT must match: the API listener and Vite proxy use the same port.');
}
process.env.NODE_ENV = 'development';
const root = process.cwd();
const children = [
  spawn(process.execPath, ['--import', 'tsx', 'artifacts/api-server/src/index.ts'], { cwd: root, stdio: 'inherit', env: process.env }),
  spawn(process.execPath, [path.join(root, 'artifacts/fsp-signal/node_modules/vite/bin/vite.js'), '--config', 'vite.config.ts'], { cwd: path.join(root, 'artifacts/fsp-signal'), stdio: 'inherit', env: process.env }),
];
let stopping = false;
function stop(code = 0) { if (stopping) return; stopping = true; for (const child of children) child.kill(); process.exitCode = code; }
process.on('SIGINT', () => stop());
process.on('SIGTERM', () => stop());
for (const child of children) { child.on('error', err => { console.error(err.message); stop(1); }); child.on('exit', code => stop(code || 0)); }

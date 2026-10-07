import { spawn } from 'node:child_process';
const child = spawn(process.execPath, ['--import','tsx','scripts/src/seed-fsp-signal.ts'], {stdio:'inherit',env:process.env});
child.on('exit', code => { process.exitCode = code ?? 1; });

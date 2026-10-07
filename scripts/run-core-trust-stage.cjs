// Read the existing isolated QA container credentials in memory, never print/save them.
const { execFileSync, spawnSync } = require('node:child_process');
const name = 'signal-qa-cycle-01-db-1';
const info = JSON.parse(execFileSync('docker', ['inspect', name], { encoding: 'utf8' }))[0];
if (!info || info.Name !== '/' + name || !(info.NetworkSettings?.Ports?.['5432/tcp'] ?? []).some(p => p.HostIp === '127.0.0.1' && p.HostPort === '55435')) throw new Error('Isolated QA container binding differs from the accepted stage target.');
const env = new Map(info.Config.Env.map(value => { const index = value.indexOf('='); return [value.slice(0,index), value.slice(index+1)]; }));
const password = env.get('POSTGRES_PASSWORD'); const user = env.get('POSTGRES_USER');
if (!password || !user) throw new Error('QA postgres credentials are unavailable.');
const databaseUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:55435/signal_resume_stage`;
const result = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/multi-resume-core-trust-integration.ts'], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: databaseUrl, API_ORIGIN: 'http://127.0.0.1:4313', NODE_ENV: 'test' } });
process.exitCode = result.status ?? 1;

// Run only the exact manifest-owned dedicated API/DB, without emitting credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { execFileSync, spawnSync } = require('node:child_process');
const {assertDeliverySnapshot}=require('./lib/multi-resume-load-delivery.cjs');
const manifest = JSON.parse(fs.readFileSync('outputs/local-backup/multi-resume-load-stand/stand.json', 'utf8'));
assert.equal(manifest.owner, 'resume_catalog'); assert.equal(manifest.profile, 'dedicated-v1'); assert.equal(manifest.database, 'signal_resume_load_check'); assert.equal(manifest.apiPort, 4315);
const container = 'signal-qa-cycle-01-db-1', info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(info.Id, manifest.containerId);
assert.ok(info.NetworkSettings.Ports['5432/tcp'].some(p => p.HostIp === '127.0.0.1' && p.HostPort === '55435'));
const env = new Map(info.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
const runtime = JSON.parse(fs.readFileSync(manifest.runtimeManifestPath, 'utf8'));
assertDeliverySnapshot(runtime,process.cwd());
const cleanup = process.argv.includes('--cleanup');
const sqlAcceptance = process.argv.includes('--sql-acceptance');
const cacheHttp=process.argv.includes('--cache-http');
if(!cleanup&&!sqlAcceptance&&!cacheHttp&&!process.argv.includes('--diagnostic'))assert.equal(runtime.runtimeKind,'normal-delivery','Full acceptance requires the exact normal delivery bundle, not a custom diagnostic build');
if (!cleanup) {
  const pwsh = 'C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe';
  const owner = Number(execFileSync(pwsh, ['-NoLogo','-NoProfile','-Command', '(Get-NetTCPConnection -LocalPort 4315 -State Listen | Select-Object -First 1 -ExpandProperty OwningProcess)'], { encoding: 'utf8' }).trim());
  assert.equal(owner, manifest.pid, 'Dedicated listener is not our stand');
}
const result = spawnSync(process.execPath, [cleanup ? runtime.fixturePath.replace('fixture.mjs', 'cleanup.mjs') : sqlAcceptance ? runtime.fixturePath.replace('fixture.mjs', 'sql-acceptance.mjs') : cacheHttp ? runtime.fixturePath.replace('fixture.mjs','cache-http.mjs') : runtime.fixturePath, ...(process.argv.includes('--diagnostic') ? ['--diagnostic'] : []), ...(process.argv.includes('--baseline-only') ? ['--baseline-only'] : []), ...(process.argv.includes('--profile-pool') ? ['--profile-pool'] : [])], { stdio: 'inherit', env: { ...process.env, DATABASE_URL: `postgresql://${encodeURIComponent(env.get('POSTGRES_USER'))}:${encodeURIComponent(env.get('POSTGRES_PASSWORD'))}@127.0.0.1:55435/signal_resume_load_check`, SIGNAL_LOAD_PROFILE: 'dedicated-v1', SIGNAL_CATALOG_TEST_ISOLATED: '1', LOAD_API_ORIGIN: 'http://127.0.0.1:4315', INTEGRATION_APP_ORIGIN: 'http://127.0.0.1:4316', SIGNAL_LOAD_APP_PID: String(manifest.pid), SIGNAL_LOAD_RUNTIME_MANIFEST: manifest.runtimeManifestPath } });
process.exitCode = result.status ?? 1;


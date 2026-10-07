// Run only the exact manifest-owned dedicated API/DB, without emitting credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path=require('node:path');
const {createHash,randomBytes}=require('node:crypto');
const { execFileSync, spawnSync } = require('node:child_process');
const {assertDeliverySnapshot,assertCleanLoadNodeOptions,assertOwnedLoadProcess}=require('./lib/multi-resume-load-delivery-v060.cjs');
assertCleanLoadNodeOptions(process.env,process.execArgv);
const manifest = JSON.parse(fs.readFileSync('outputs/local-backup/multi-resume-load-stand-v060/stand.json', 'utf8'));
assert.equal(process.env.SIGNAL_V060_LOAD_ACCEPTANCE,'1');
assert.equal(manifest.owner, 'resume_catalog'); assert.equal(manifest.profile, 'dedicated-v060'); assert.equal(manifest.database, 'signal_resume_load_check'); assert.equal(manifest.apiPort, 4315);
const container = 'signal-qa-cycle-01-db-1', info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(info.Id, manifest.containerId);
assert.ok(info.NetworkSettings.Ports['5432/tcp'].some(p => p.HostIp === '127.0.0.1' && p.HostPort === '55435'));
const env = new Map(info.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
const runtime = JSON.parse(fs.readFileSync(manifest.runtimeManifestPath, 'utf8'));
assertDeliverySnapshot(runtime,process.cwd());
assert.equal(runtime.applicationVersion,'0.6.0');
const hash=file=>createHash('sha256').update(fs.readFileSync(file)).digest('hex');
const fixtureRoot=path.dirname(runtime.fixturePath);
function assertFixtureSnapshot(){
  assert.deepEqual(Object.keys(runtime.fixtureAssets).sort(),['cache-http.mjs','cleanup.mjs','fixture.mjs','sql-acceptance.mjs']);
  for(const [name,expected]of Object.entries(runtime.fixtureAssets)){assert.match(expected,/^[a-f0-9]{64}$/);assert.equal(hash(path.join(fixtureRoot,name)),expected,'Versioned fixture sidecar changed');}
  assert.equal(runtime.fixtureAssets['fixture.mjs'],runtime.fixtureSha256);
}
assertFixtureSnapshot();
const cleanup = process.argv.includes('--cleanup');
const sqlAcceptance = process.argv.includes('--sql-acceptance');
const cacheHttp=process.argv.includes('--cache-http');
if(!cleanup&&!sqlAcceptance&&!cacheHttp&&!process.argv.includes('--diagnostic'))assert.equal(runtime.runtimeKind,'normal-delivery','Full acceptance requires the exact normal delivery bundle, not a custom diagnostic build');
function assertOwnedListener() {
  const pwsh = 'C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe';
  const owner = Number(execFileSync(pwsh, ['-NoLogo','-NoProfile','-Command', '(Get-NetTCPConnection -LocalPort 4315 -State Listen | Select-Object -First 1 -ExpandProperty OwningProcess)'], { encoding: 'utf8' }).trim());
  assert.equal(owner, manifest.pid, 'Dedicated listener is not our stand');
  const identity=JSON.parse(execFileSync(pwsh,['-NoLogo','-NoProfile','-Command',`Get-Process -Id ${owner} | Select-Object Id,StartTime,ProcessName | ConvertTo-Json -Compress`],{encoding:'utf8'}));
  assert.equal(manifest.identity.Id,manifest.pid);assertOwnedLoadProcess(manifest.identity,identity,owner);
}
if(!cleanup)assertOwnedListener();
const result = spawnSync(process.execPath, [cleanup ? runtime.fixturePath.replace('fixture.mjs', 'cleanup.mjs') : sqlAcceptance ? runtime.fixturePath.replace('fixture.mjs', 'sql-acceptance.mjs') : cacheHttp ? runtime.fixturePath.replace('fixture.mjs','cache-http.mjs') : runtime.fixturePath, ...(process.argv.includes('--diagnostic') ? ['--diagnostic'] : []), ...(process.argv.includes('--baseline-only') ? ['--baseline-only'] : []), ...(process.argv.includes('--profile-pool') ? ['--profile-pool'] : [])], { stdio: 'inherit', env: { ...process.env, NODE_OPTIONS:'',DATABASE_URL: `postgresql://${encodeURIComponent(env.get('POSTGRES_USER'))}:${encodeURIComponent(env.get('POSTGRES_PASSWORD'))}@127.0.0.1:55435/signal_resume_load_check`, SIGNAL_LOAD_PROFILE: 'dedicated-v060', SIGNAL_CATALOG_TEST_ISOLATED: '1', LOAD_API_ORIGIN: 'http://127.0.0.1:4315', INTEGRATION_APP_ORIGIN: 'http://127.0.0.1:4316', SIGNAL_LOAD_APP_PID: String(manifest.pid), SIGNAL_LOAD_RUNTIME_MANIFEST: manifest.runtimeManifestPath } });
if(!cleanup)assertOwnedListener();
assertDeliverySnapshot(runtime,process.cwd());assertFixtureSnapshot();
const action=cleanup?'cleanup':sqlAcceptance?'sql':cacheHttp?'http':process.argv.includes('--diagnostic')?'diagnostic':'full';
const association={schemaVersion:1,applicationVersion:'0.6.0',at:new Date().toISOString(),action,childExitCode:result.status??1,apiBundleSha256:runtime.apiSha256,candidateManifestSha256:runtime.candidateManifestSha256,allAcceptedSourcesCurrentBeforeAndAfter:true,sourceCount:Object.keys(runtime.sourceHashes).length,allDistAssetsStableBeforeAndAfter:true,fixtureAssets:runtime.fixtureAssets,ownedPid:manifest.pid,buildId:manifest.buildId};
const associationPath=`outputs/verification/0.6.0/multi-resume/runtime-association-${manifest.buildId}-${action}-${randomBytes(4).toString('hex')}.json`;
fs.writeFileSync(associationPath,JSON.stringify(association,null,2)+'\n',{flag:'wx'});console.log(JSON.stringify({association:associationPath,sha256:hash(associationPath),childExitCode:association.childExitCode}));
process.exitCode = result.status ?? 1;

// Exact owned local stand. Credentials are read only in memory and never saved.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { createRequire } = require('node:module');
const { randomBytes, createHash } = require('node:crypto');
const { execFileSync, spawn } = require('node:child_process');
const {readDeliveryCandidate,copyDeliverySnapshot,assertDeliverySnapshot,assertCleanLoadNodeOptions}=require('./lib/multi-resume-load-delivery-v060.cjs');
assertCleanLoadNodeOptions(process.env,process.execArgv);
const root = process.cwd(), container = 'signal-qa-cycle-01-db-1', database = 'signal_resume_load_check';
const privateDir = path.resolve(root, 'outputs/local-backup/multi-resume-load-stand-v060');
const manifestPath = path.join(privateDir, 'stand.json');
fs.mkdirSync(privateDir, { recursive: true });
fs.mkdirSync(path.resolve(root,'outputs/verification/0.6.0/multi-resume'),{recursive:true});
const info = JSON.parse(execFileSync('docker', ['inspect', container], { encoding: 'utf8' }))[0];
assert.equal(info.Name, '/' + container);
assert.ok(info.NetworkSettings.Ports['5432/tcp'].some(p => p.HostIp === '127.0.0.1' && p.HostPort === '55435'));
const env = new Map(info.Config.Env.map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
const user = env.get('POSTGRES_USER'), password = env.get('POSTGRES_PASSWORD');
assert.ok(user && password);
const databaseUrl = `postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:55435/${database}`;
function docker(args) { return execFileSync('docker', ['exec', container, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }); }
function query(sql, db = 'postgres') { return docker(['psql', '-X', '-v', 'ON_ERROR_STOP=1', '-U', user, '-d', db, '-Atqc', sql]).trim(); }
const pwsh = 'C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe';
function listener() { return Number(execFileSync(pwsh, ['-NoLogo','-NoProfile','-Command', "$signalLoadListener = Get-NetTCPConnection -LocalPort 4315 -State Listen -ErrorAction SilentlyContinue\nif ($signalLoadListener) { $signalLoadListener | Select-Object -First 1 -ExpandProperty OwningProcess }\nexit 0"], { encoding: 'utf8' }).trim()) || null; }
function identity(pid) { return JSON.parse(execFileSync(pwsh, ['-NoLogo','-NoProfile','-Command', `Get-Process -Id ${pid} | Select-Object Id,StartTime,ProcessName | ConvertTo-Json -Compress`], { encoding: 'utf8' })); }
function sha(file) { return createHash('sha256').update(fs.readFileSync(file)).digest('hex'); }
const action = process.argv[2] ?? 'setup';
async function main() {
  if (action === 'stop') {
    const old = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    assert.equal(old.owner, 'resume_catalog'); assert.equal(old.profile, 'dedicated-v060'); assert.equal(old.database, database); assert.equal(old.apiPort, 4315);
    const owner = listener();
    if (owner === null) { console.log('Owned load listener already stopped'); return; }
    assert.equal(owner, old.pid, 'Refuse to stop any unrelated listener');
    const current = identity(owner); assert.equal(current.StartTime, old.identity.StartTime); assert.equal(current.ProcessName, 'node');
    process.kill(owner, 'SIGTERM');
    for (let n = 0; n < 20 && listener(); n++) await new Promise(resolve => setTimeout(resolve, 500));
    assert.equal(listener(), null); old.stoppedAt = new Date().toISOString(); fs.writeFileSync(manifestPath, JSON.stringify(old, null, 2));
    console.log('Stopped only the manifest-owned API 4315'); return;
  }
  assert.equal(process.env.SIGNAL_V060_LOAD_ACCEPTANCE,'1');
  assert.equal(action,'rebuild-delivery','New 0.6 acceptance permits only exact normal-delivery copy on the previously owned stand');
  const delivery=action==='rebuild-delivery';
  if(delivery)assert.notEqual(process.env.SIGNAL_LOAD_INSPECT,'1','Full delivery stand runs without inspector');
  assert.equal(listener(), null, 'Dedicated API port must be free; stop only your owned stand first');
  let manifest;
  const exists = query(`SELECT count(*) FROM pg_database WHERE datname='${database}'`) === '1';
  if (exists) {
    assert.ok(['rebuild','rebuild-delivery'].includes(action), 'Existing DB requires exact owned stand manifest');
    if(fs.existsSync(manifestPath))manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    else {
      const previousPath=path.resolve(root,'outputs/local-backup/multi-resume-load-stand/stand.json');
      const previous=JSON.parse(fs.readFileSync(previousPath,'utf8'));
      assert.equal(previous.owner,'resume_catalog');assert.equal(previous.profile,'dedicated-v1');assert.equal(previous.database,database);assert.equal(previous.apiPort,4315);assert.equal(previous.containerId,info.Id);assert.ok(previous.stoppedAt);
      assert.equal(previous.apiSha256,'3ada309626da44b40f545d1f090ada5aed1bd2287361ae16d536d2db6d20aeb3');
      manifest={owner:'resume_catalog',profile:'dedicated-v060',applicationVersion:'0.6.0',database,postgresPort:55435,apiPort:4315,originPort:4316,containerId:info.Id,createdAt:new Date().toISOString(),previousOwnershipManifestSha256:sha(previousPath)};
      fs.writeFileSync(manifestPath,JSON.stringify(manifest,null,2));
    }
    assert.equal(manifest.owner, 'resume_catalog'); assert.equal(manifest.database, database); assert.equal(manifest.containerId, info.Id);
    assert.equal(manifest.profile,'dedicated-v060');
    assert.equal(query("SELECT count(*) FROM signal_users WHERE email LIKE 'multi-load-%@example.test'", database),'0','Previous owned fixtures must already have exact cleanup');
    assert.equal(query("SELECT count(*) FROM signal_users WHERE email LIKE 'v060-multi-load-%@example.test'", database), '0', 'Recover exact fixtures before rebuild');
  } else throw new Error('Previously owned dedicated load DB must already exist; no restoration or stage access is permitted by this versioned runner');
  // Apply only additive, source-owned new-version migrations to this owned DB.
  for (const name of ['0006_assessment_purpose.sql', '0007_reviewer_scope.sql', '0008_resume_pool_digest.sql','0009_microtask_resume.sql']) {
    const sql = fs.readFileSync(path.join(root, 'lib/db/migrations', name), 'utf8');
    execFileSync('docker', ['exec','-i',container,'psql','-X','-v','ON_ERROR_STOP=1','-U',user,'-d',database], { input: sql, encoding: 'utf8', stdio: ['pipe','ignore','pipe'] });
  }
  const buildId = randomBytes(6).toString('hex'), runtime = path.resolve(root, 'artifacts/api-server/.load-runtime', buildId);
  fs.mkdirSync(runtime, { recursive: true });
  const checked = ['artifacts/api-server/src/lib/signal-resume-matching.ts','artifacts/api-server/src/lib/signal-matching.ts','artifacts/api-server/src/lib/signal-resume-catalog.ts','artifacts/api-server/src/lib/assessment-ranking-evidence.ts','artifacts/api-server/src/lib/signal-resume-qualification.ts','artifacts/api-server/src/lib/signal-resume.ts','artifacts/api-server/src/lib/assessment-bank.ts','artifacts/api-server/src/lib/assessment-managed.ts','artifacts/api-server/src/routes/signal-employer-matching.ts','artifacts/api-server/src/routes/signal-candidate-bank.ts'];
  checked.push('artifacts/api-server/src/lib/signal-catalog-computation.ts','artifacts/api-server/src/lib/signal-readonly-resume.ts','artifacts/api-server/src/lib/signal-fresh-pool-cache.ts','artifacts/api-server/src/lib/signal-fresh-ranking-cache.ts','artifacts/api-server/src/lib/signal-resume-evaluation.ts','artifacts/api-server/src/lib/fsp-provider.ts','artifacts/api-server/src/lib/fsp-results.ts','artifacts/api-server/src/lib/signal-evidence-compatibility.ts','artifacts/api-server/src/lib/skill-coverage-input.ts');
  const sources = Object.fromEntries(checked.map(file => [file, sha(file)]));
  const requireApi = createRequire(path.join(root, 'artifacts/api-server/package.json'));
  const esbuild = requireApi('esbuild');
  const aliases = { '@workspace/db': path.resolve(root, 'lib/db/src/index.ts'), '@workspace/api-zod': path.resolve(root, 'lib/api-zod/src/index.ts') };
  const banner = `import { createRequire as __loadCreateRequire } from 'node:module'; import __loadPath from 'node:path'; import {fileURLToPath as __loadFileURLToPath} from 'node:url'; globalThis.require=__loadCreateRequire(import.meta.url); globalThis.__filename=__loadFileURLToPath(import.meta.url); globalThis.__dirname=__loadPath.dirname(globalThis.__filename);`;
  const options = { platform: 'node', bundle: true, format: 'esm', external: ['pdfkit','nodemailer','pino','pino-http','pg-native','*.node'], alias: aliases, sourcemap: 'linked', metafile: true, banner: { js: banner }, logLevel: 'silent' };
  const attestation=delivery?readDeliveryCandidate(root,checked):undefined;
  const copied=attestation?copyDeliverySnapshot(root,runtime,attestation):undefined;
  const apiPath = copied?.apiPath??path.join(runtime, 'api.mjs');
  const result = delivery?undefined:await esbuild.build({ ...options, entryPoints: [path.join(root, 'artifacts/api-server/src/index.ts')], outfile: apiPath, define: { __SIGNAL_MATCHER_SHA256__: JSON.stringify(sources['artifacts/api-server/src/lib/signal-matching.ts']) } });
  await esbuild.build({ ...options, entryPoints: [path.join(root, 'scripts/multi-resume-load-stage-v060.ts')], outfile: path.join(runtime, 'fixture.mjs') });
  await esbuild.build({ ...options, entryPoints: [path.join(root, 'scripts/multi-resume-load-cleanup-v060.ts')], outfile: path.join(runtime, 'cleanup.mjs') });
  await esbuild.build({ ...options, entryPoints: [path.join(root, 'scripts/multi-resume-load-sql-acceptance-v060.ts')], outfile: path.join(runtime, 'sql-acceptance.mjs') });
  await esbuild.build({ ...options, entryPoints: [path.join(root, 'scripts/multi-resume-cache-http-v060.ts')], outfile: path.join(runtime, 'cache-http.mjs') });
  const after = Object.fromEntries(checked.map(file => [file, sha(file)]));
  assert.deepEqual(after, sources, 'Sources changed during the snapshot build; retry instead of claiming a coherent version');
  if(attestation)assert.deepEqual(readDeliveryCandidate(root,checked),attestation,'Final candidate changed during fixture compilation');
  const nodeFlags = ['--max-old-space-size=512', ...(process.env.SIGNAL_LOAD_INSPECT === '1' ? ['--inspect=127.0.0.1:9235'] : [])];
  const fixtureAssets=Object.fromEntries(['fixture.mjs','cleanup.mjs','sql-acceptance.mjs','cache-http.mjs'].map(name=>[name,sha(path.join(runtime,name))]));
  const runtimeManifest = { applicationVersion:'0.6.0',builtAt: new Date().toISOString(), runtimeKind:delivery?'normal-delivery':'custom-diagnostic',sourceHashes: attestation?.candidate.sourceHashes??sources, apiPath, apiSha256: sha(apiPath), fixturePath: path.join(runtime, 'fixture.mjs'), fixtureSha256: sha(path.join(runtime, 'fixture.mjs')),fixtureAssets, nodeFlags, diagnosticsRegistrationOnly:true, externalPackages: delivery?null:options.external, inputHashes: attestation?.candidate.sourceHashes??Object.fromEntries(Object.keys(result.metafile.inputs).map(file => [file, sha(path.resolve(root, file))])),...(copied??{}) };
  assertDeliverySnapshot(runtimeManifest,root);
  const runtimeManifestPath = path.join(runtime, 'manifest.json'); fs.writeFileSync(runtimeManifestPath, JSON.stringify(runtimeManifest, null, 2));
  const stdout = fs.openSync(path.join(privateDir, `api-${buildId}.stdout.log`), 'a'), stderr = fs.openSync(path.join(privateDir, `api-${buildId}.stderr.log`), 'a');
  const child = spawn(process.execPath, [...nodeFlags, apiPath], { cwd: root, detached: true, windowsHide: true, stdio: ['ignore', stdout, stderr], env: { ...process.env, NODE_OPTIONS:'', DATABASE_URL: databaseUrl, PORT: '4315', HOST: '127.0.0.1', PUBLIC_URL: 'http://127.0.0.1:4316', CORS_ORIGIN: 'http://127.0.0.1:4316', DEMO_MODE: 'false', NODE_ENV: 'production', VERIFICATION_TOKEN_SECRET: randomBytes(64).toString('hex'), SIGNAL_LOAD_PROFILE_DIAGNOSTICS:'1', MAIL_TRANSPORT: 'mailpit', MAILPIT_URL: 'http://127.0.0.1:8026' } });
  child.unref(); fs.closeSync(stdout); fs.closeSync(stderr);
  manifest = { ...manifest, pid: child.pid, runtimeManifestPath, buildId, apiPath, apiSha256: runtimeManifest.apiSha256, startedAt: new Date().toISOString() };
  fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  for (let n = 0; n < 30; n++) { if (listener() === child.pid) break; await new Promise(resolve => setTimeout(resolve, 500)); }
  assert.equal(listener(), child.pid, 'Owned API did not become the dedicated listener');
  manifest.identity = identity(child.pid); fs.writeFileSync(manifestPath, JSON.stringify(manifest, null, 2));
  console.log(JSON.stringify({ profile: 'dedicated-v060', database, apiPort: 4315, originPort: 4316, pid: child.pid, apiSha256: manifest.apiSha256, buildId }));
}
main().catch(error => { console.error(error.message); process.exitCode = 1; });

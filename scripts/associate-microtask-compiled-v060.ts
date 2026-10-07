/** Exact actual compiled/PID/SQL/source-map association, not an inferred source claim. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { homedir } from 'node:os';
import { resolve, dirname, relative, join } from 'node:path';
assert.equal(process.env.SIGNAL_V060_COMPILED_ACCEPTANCE, '1');
assert.equal(process.env.API_ORIGIN, 'http://127.0.0.1:4365');
const database = new URL(process.env.DATABASE_URL ?? '');
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55435'); assert.equal(database.pathname, '/signal_resume_v060_compiled_check');
const expected = process.env.SIGNAL_V060_COMPILED_API_SHA ?? ''; assert.match(expected, /^[a-f0-9]{64}$/);
const proofPath = process.argv[2] ?? ''; assert.match(proofPath, /^outputs\/verification\/release-0\.6\.0\/microtask-resume-http-[a-f0-9]{8}\.json$/);
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const privatePath = join(homedir(), '.codex/private/signal-v060-compiled-check-process.json');
const readyPath = 'outputs/verification/release-0.6.0/compiled-stand-ready.json';
const privateBytes = await readFile(privatePath), runtime = JSON.parse(privateBytes.toString('utf8').replace(/^\uFEFF/, ''));
const readyBytes = await readFile(readyPath), ready = JSON.parse(readyBytes.toString('utf8').replace(/^\uFEFF/, ''));
assert.equal(runtime.apiBundleSha256, expected); assert.equal(ready.apiBundleSha256, expected);
assert.equal(ready.pid, runtime.pid); assert.ok(Number.isSafeInteger(runtime.pid) && runtime.pid > 0);
const snapshot = dirname(runtime.runtimeEntryPath);
assert.match(relative(process.cwd(), snapshot).replaceAll('\\', '/'), /^outputs\/local-backup\/v060-compiled-runtime-[a-f0-9]{12}\/dist$/);
async function witness() {
  const quote = (value: string) => "'" + value.replaceAll("'", "''") + "'";
  const code = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$m=Get-Content -LiteralPath ${quote(privatePath)} -Raw|ConvertFrom-Json;$p=Get-Process -Id $m.pid;$c=(Get-CimInstance Win32_Process -Filter ('ProcessId='+$m.pid)).CommandLine;if($p.StartTime.ToUniversalTime().Ticks -ne ([datetime]$m.startedAt).ToUniversalTime().Ticks -or -not $c.Contains($m.runtimeEntryPath) -or -not $c.Contains('signal-v060-compiled-check.env') -or $c.Contains('--import')){throw 'Actual owned compiled process differs'};$b=@(Get-NetTCPConnection -LocalPort 4365 -State Listen);if($b.Count -ne 1 -or $b[0].OwningProcess -ne $m.pid -or $b[0].LocalAddress -ne '127.0.0.1'){throw 'Actual owned compiled listener differs'};Write-Output 'PASS'`;
  const pwsh = join(homedir(), 'AppData/Local/Programs/PowerShell/7/pwsh.exe');
  assert.equal(execFileSync(pwsh, ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(code, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true }).trim(), 'PASS');
  assert.equal(sha(await readFile(privatePath)), sha(privateBytes)); assert.equal(sha(await readFile(readyPath)), sha(readyBytes));
  assert.equal(Object.keys(runtime.deliveryFiles).length, 11);
  for (const [name, hash] of Object.entries(runtime.deliveryFiles)) {
    assert.match(name, /^[a-z0-9.-]+$/); assert.equal(sha(await readFile(join(snapshot, name))), hash);
    assert.equal(sha(await readFile(join('artifacts/api-server/dist', name))), hash);
  }
}
await witness();
const proofBytes = await readFile(proofPath), proof = JSON.parse(proofBytes.toString('utf8'));
assert.equal(proof.passed, true); assert.equal(proof.cleanup, true); assert.equal(proof.checks.length, 16);
assert.equal(proof.apiOrigin, 'http://127.0.0.1:4365'); assert.equal(proof.database, 'signal_resume_v060_compiled_check');
const sourceMap = JSON.parse(await readFile(join(snapshot, 'index.mjs.map'), 'utf8')), embedded: Record<string, string> = {};
for (const [path, hash] of Object.entries(proof.sourceHashes)) {
  const bytes = await readFile(path); assert.equal(sha(bytes), hash);
  if (!path.includes('/src/')) continue;
  assert.match(path, /^artifacts\/api-server\/src\/[a-z0-9/.-]+\.ts$/);
  const key = '../src/' + path.split('/src/')[1], index = sourceMap.sources.indexOf(key); assert.ok(index >= 0);
  const content = Buffer.from(sourceMap.sourcesContent[index], 'utf8'); assert.deepEqual(content, bytes); embedded[path] = sha(content);
}
assert.equal(Object.keys(embedded).length, 5);
const { pool } = await import('../lib/db/src/index.ts');
try {
  const owned = JSON.parse(await readFile(join(homedir(), '.codex/private/signal-v060-compiled-check-database.json'), 'utf8'));
  const identity = (await pool.query('SELECT oid::int,datname AS name FROM pg_database WHERE datname=current_database()')).rows[0];
  assert.equal(identity.name, 'signal_resume_v060_compiled_check'); assert.equal(identity.oid, owned.databaseOid);
  const migrationSha = proof.sourceHashes['lib/db/migrations/0009_microtask_resume.sql'];
  assert.equal((await pool.query('SELECT hash FROM drizzle.__drizzle_migrations WHERE hash=$1', [migrationSha])).rows.length, 1);
  const count = (await pool.query('SELECT count(*)::int AS n FROM signal_users WHERE email LIKE $1', [proof.fixturePrefix + '%'])).rows[0].n; assert.equal(count, 0);
  await witness();
  const report = { schemaVersion: 1, applicationVersion: '0.6.0', kind: 'normal-compiled-microtask-http-association', passed: true, generatedAt: new Date().toISOString(),
    runtime: { pid: runtime.pid, processStartedAt: runtime.startedAt, apiOrigin: ready.apiOrigin, runtimeKind: ready.runtimeKind,
      apiBundleSha256: expected, deliveryFiles: runtime.deliveryFiles, deliveryFileCount: 11, actualPidStartEntryVerified: true, normalDeliveryByteIdenticalSnapshot: true },
    databaseIdentity: { database: identity.name, databaseOid: identity.oid, applied0009Sha256: migrationSha, ownedFixturePrefixRemaining: count },
    actualProof: { path: proofPath, sha256: sha(proofBytes), checks: 16, cleanup: true }, runtimeReady: { path: readyPath, sha256: sha(readyBytes) },
    embeddedSourceHashes: embedded, sourceHashes: proof.sourceHashes,
    scope: 'Actual normal byte-identical compiled snapshot on its owned isolated DB. Sixteen controlled practice groups; actual PID/start/listener/eleven asset SHA before and after; five embedded TS byte matches and applied0009/OID. No load/human exam/browser/full source graph/clean archive/stage migration claim.' };
  const path = 'outputs/verification/release-0.6.0/compiled-microtask-http-association.json';
  try { const prior = await readFile(path); await mkdir('outputs/verification/release-0.6.0/history', { recursive: true });
    await writeFile(`outputs/verification/release-0.6.0/history/compiled-microtask-http-association-${sha(prior).slice(0, 12)}.json`, prior, { flag: 'wx' });
  } catch (error: any) { if (!['ENOENT', 'EEXIST'].includes(error.code)) throw error; }
  await writeFile(path, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, checks: 16, pid: runtime.pid, apiBundleSha256: expected, path, sha256: sha(await readFile(path)) }));
} finally { await pool.end(); }

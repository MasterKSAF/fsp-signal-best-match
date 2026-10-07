/** Exact owned stage upgrade. Default/check-only never calls Docker, SQL or migration. */
const assert = require('node:assert/strict');
const { createHash } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');
const fs = require('node:fs');
const path = require('node:path');

const ROOT = path.resolve(__dirname, '..');
const TARGET = Object.freeze({ container: 'signal-qa-cycle-01-db-1', database: 'signal_resume_stage', host: '127.0.0.1', port: 55435, owner: 'root/owned-stage-v050-upgrade' });
const PRIVATE = path.join(ROOT, 'outputs/verification/multi-resume-2026-10-06/private');
const MANIFEST = path.join(PRIVATE, 'stage-owner-0008.json');
const RECEIPT = path.join(ROOT, 'outputs/verification/assessment-purpose/stage-upgrade-0008.json');
const SOURCE_PATHS = ['scripts/upgrade-owned-stage-v050.cjs', 'scripts/migrate.ts', 'lib/db/migrations/meta/_journal.json', 'lib/db/migrations/0008_resume_pool_digest.sql', 'lib/db/src/schema/signal-resume.ts'];
const sha = data => createHash('sha256').update(data).digest('hex');
const timestamp = () => new Date().toISOString();
const stamp = () => timestamp().replace(/[:.]/g, '-');

function assertContainer(info) {
  assert.equal(info?.Name, '/' + TARGET.container, 'Exact owned stage container required');
  assert.match(info.Id ?? '', /^[a-f0-9]{64}$/, 'Container identity required');
  assert.equal(info.State?.Running, true, 'Owned stage container must be running');
  assert.ok(Number.isFinite(Date.parse(info.State.StartedAt)), 'Container start identity required');
  assert.equal(info.Config?.Labels?.['com.docker.compose.project'], 'signal-qa-cycle-01');
  assert.equal(info.Config?.Labels?.['com.docker.compose.service'], 'db');
  const bindings = info.NetworkSettings?.Ports?.['5432/tcp'];
  assert.ok(Array.isArray(bindings) && bindings.length === 1, 'Only one exact loopback binding permitted');
  assert.equal(bindings[0].HostIp, TARGET.host); assert.equal(bindings[0].HostPort, String(TARGET.port));
  const environment = new Map((info.Config.Env ?? []).map(value => { const split = value.indexOf('='); return [value.slice(0, split), value.slice(split + 1)]; }));
  assert.equal(environment.get('POSTGRES_USER'), 'signal', 'Exact owned stage role required');
  assert.ok(environment.get('POSTGRES_PASSWORD'), 'Owned local DB credential unavailable');
  return { user: environment.get('POSTGRES_USER'), password: environment.get('POSTGRES_PASSWORD') };
}
function validateManifest(manifest) {
  assert.equal(manifest?.schemaVersion, 1); assert.equal(manifest.owner, TARGET.owner);
  assert.equal(manifest.database, TARGET.database); assert.equal(manifest.containerName, TARGET.container);
  assert.equal(manifest.host, TARGET.host); assert.equal(manifest.port, TARGET.port);
  assert.match(manifest.containerId ?? '', /^[a-f0-9]{64}$/); assert.match(manifest.image ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.ok(Number.isFinite(Date.parse(manifest.containerStartedAt)));
  assert.ok(Number.isSafeInteger(manifest.databaseOid) && manifest.databaseOid > 0);
  assert.ok(Number.isFinite(Date.parse(manifest.capturedAt)));
  return manifest;
}
function assertIdentity(manifest, info, database) {
  validateManifest(manifest); assertContainer(info);
  assert.equal(info.Id, manifest.containerId); assert.equal(info.Image, manifest.image);
  assert.equal(info.State.StartedAt, manifest.containerStartedAt, 'Stage DB container restarted or replaced');
  assert.equal(database.name, TARGET.database); assert.equal(Number(database.oid), manifest.databaseOid, 'Stage DB OID differs from owned manifest');
}
function quoteIdentifier(value) { assert.equal(typeof value, 'string'); assert.ok(value && !value.includes('\0')); return '"' + value.replaceAll('"', '""') + '"'; }
function publicTableHashSql(table) {
  const projection = table === 'signal_candidate_resumes' ? "(to_jsonb(t) - 'pool_content_digest')" : 'to_jsonb(t)';
  return `SELECT committed.row_digest, count(*)::text AS copies FROM (SELECT encode(sha256(convert_to(${projection}::text, 'UTF8')), 'hex') AS row_digest FROM public.${quoteIdentifier(table)} AS t) AS committed GROUP BY committed.row_digest ORDER BY committed.row_digest COLLATE "C"`;
}
function commitTable(table, rows) {
  const hash = createHash('sha256'); let count = 0;
  for (const row of rows) {
    assert.match(row.row_digest, /^[a-f0-9]{64}$/); assert.match(String(row.copies), /^[1-9][0-9]*$/);
    const copies = Number(row.copies); assert.ok(Number.isSafeInteger(copies)); count += copies; assert.ok(Number.isSafeInteger(count));
    hash.update(row.row_digest + ':' + String(copies) + '\n');
  }
  return { table, rows: count, sha256: hash.digest('hex') };
}
function businessState(tables) {
  assert.equal(new Set(tables.map(item => item.table)).size, tables.length);
  const sorted = [...tables].sort((a, b) => a.table < b.table ? -1 : a.table > b.table ? 1 : 0);
  return { method: 'All public ordinary/partitioned tables; complete jsonb row SHA256 multiset including duplicate multiplicities; UTC snapshot', excludedColumns: ['public.signal_candidate_resumes.pool_content_digest'], tables: sorted, sha256: sha(JSON.stringify(sorted)) };
}
function assertBusinessUnchanged(before, after) {
  assert.deepEqual(after.excludedColumns, before.excludedColumns);
  assert.deepEqual(after.tables, before.tables, 'Public business rows or table inventory changed');
  assert.equal(after.sha256, before.sha256);
}
function inspectContainer() {
  const result = spawnSync('docker', ['inspect', TARGET.container], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, windowsHide: true });
  assert.equal(result.status, 0, 'Cannot read exact stage Docker identity');
  const parsed = JSON.parse(result.stdout); assert.equal(parsed.length, 1); assertContainer(parsed[0]); return parsed[0];
}
function sourceHashes() {
  const hashes = Object.fromEntries(SOURCE_PATHS.map(relative => [relative, sha(fs.readFileSync(path.join(ROOT, relative)))]));
  const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/db/migrations/meta/_journal.json'), 'utf8'));
  assert.equal(journal.entries?.at(-1)?.idx, 8); assert.equal(journal.entries.at(-1).tag, '0008_resume_pool_digest', 'Only the frozen-through-0008 migration set is allowed');
  for (const entry of journal.entries) {
    assert.match(entry.tag, /^\d{4}_[a-z0-9_]+$/);
    const relative = 'lib/db/migrations/' + entry.tag + '.sql'; hashes[relative] = sha(fs.readFileSync(path.join(ROOT, relative)));
  }
  return hashes;
}
async function databaseIdentity(client) {
  const result = await client.query('SELECT current_database() AS name, (SELECT oid::bigint::text FROM pg_database WHERE datname=current_database()) AS oid');
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].name, TARGET.database); return result.rows[0];
}
async function snapshotBusiness(client) {
  const names = await client.query("SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE \"C\"");
  assert.ok(names.rows.some(row => row.name === 'signal_candidate_resumes'), 'Owned stage business schema absent');
  const tables = [];
  for (const { name } of names.rows) tables.push(commitTable(name, (await client.query(publicTableHashSql(name))).rows));
  return businessState(tables);
}
function backupOwnedStage(info, credential, snapshotId) {
  assertContainer(info); assert.match(snapshotId, /^[0-9A-Fa-f-]+$/, 'Exported snapshot token malformed');
  fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
  const destination = path.join(PRIVATE, 'before0008-' + stamp() + '.dump');
  const fd = fs.openSync(destination, 'wx', 0o600); let result;
  try {
    result = spawnSync('docker', ['exec', info.Id, 'pg_dump', '-U', credential.user, '-d', TARGET.database, '--format=custom', '--no-owner', '--no-privileges', '--snapshot=' + snapshotId], { stdio: ['ignore', fd, 'pipe'], maxBuffer: 1024 * 1024, timeout: 120000, windowsHide: true });
    fs.fsyncSync(fd);
  } finally { fs.closeSync(fd); }
  assert.equal(result.status, 0, 'Binary owned-stage backup failed; private attempt retained');
  const header = Buffer.alloc(5), readFd = fs.openSync(destination, 'r');
  try { assert.equal(fs.readSync(readFd, header, 0, 5, 0), 5); } finally { fs.closeSync(readFd); }
  assert.equal(header.toString('ascii'), 'PGDMP', 'Custom binary backup signature missing');
  const bytes = fs.statSync(destination).size; assert.ok(bytes > 100);
  return { file: destination, bytes, sha256: sha(fs.readFileSync(destination)), format: 'PostgreSQL custom binary PGDMP; direct child stdout FD, no shell pipeline', sameExportedSnapshotAsBeforeHash: true };
}
function saveReceipt(receipt) {
  fs.mkdirSync(path.dirname(RECEIPT), { recursive: true });
  if (fs.existsSync(RECEIPT)) {
    const old = fs.readFileSync(RECEIPT), history = path.join(path.dirname(RECEIPT), 'history'); fs.mkdirSync(history, { recursive: true });
    const saved = path.join(history, 'stage-upgrade-0008-' + sha(old).slice(0, 12) + '.json'); if (!fs.existsSync(saved)) fs.writeFileSync(saved, old, { flag: 'wx' });
  }
  fs.writeFileSync(RECEIPT, JSON.stringify(receipt, null, 2) + '\n');
}
async function main(args = process.argv.slice(2)) {
  assert.ok(args.length <= 1, 'Only one explicit fixed-stage mode is accepted');
  const mode = args[0] ?? '--check-only';
  assert.ok(['--check-only', '--capture-owned-stage-identity', '--upgrade-owned-stage'].includes(mode), 'Unknown stage helper mode');
  const sources = sourceHashes();
  if (mode === '--check-only') {
    const manifestPresent = fs.existsSync(MANIFEST); if (manifestPresent) validateManifest(JSON.parse(fs.readFileSync(MANIFEST, 'utf8')));
    console.log(JSON.stringify({ checkOnly: true, prepared: true, target: TARGET, identityManifestPresent: manifestPresent, sourceHashes: sources, dockerCalled: false, databaseAccess: false, backupCreated: false, migrated: false, seeded: false, restarted: false })); return;
  }
  const info = inspectContainer(), credential = assertContainer(info);
  const { Client } = createRequire(path.join(ROOT, 'lib/db/package.json'))('pg');
  const client = new Client({ host: TARGET.host, port: TARGET.port, database: TARGET.database, user: credential.user, password: credential.password, application_name: 'signal-owned-stage-upgrade-v050', connectionTimeoutMillis: 5000, statement_timeout: 120000 });
  await client.connect();
  let receipt, inTransaction = false, step = 'ownership';
  try {
    const identity = await databaseIdentity(client);
    if (mode === '--capture-owned-stage-identity') {
      assert.ok(!fs.existsSync(MANIFEST), 'Existing owned-stage identity manifest is never replaced');
      const table = await client.query("SELECT to_regclass('public.signal_candidate_resumes') AS name"); assert.ok(table.rows[0].name, 'Expected existing stage schema absent');
      const manifest = validateManifest({ schemaVersion: 1, owner: TARGET.owner, host: TARGET.host, port: TARGET.port, database: TARGET.database, databaseOid: Number(identity.oid), containerName: TARGET.container, containerId: info.Id, image: info.Image, containerStartedAt: info.State.StartedAt, capturedAt: timestamp() });
      fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 }); fs.writeFileSync(MANIFEST, JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx', mode: 0o600 });
      console.log(JSON.stringify({ identityCaptured: true, manifest: path.relative(ROOT, MANIFEST).replaceAll('\\', '/'), database: TARGET.database, databaseOid: manifest.databaseOid, migrated: false, seeded: false, restarted: false })); return;
    }
    const manifest = validateManifest(JSON.parse(fs.readFileSync(MANIFEST, 'utf8'))); assertIdentity(manifest, info, identity);
    receipt = { schemaVersion: 1, applicationVersion: '0.5.0', status: 'FAIL', passed: false, startedAt: timestamp(), target: { database: TARGET.database, host: TARGET.host, port: TARGET.port, containerName: TARGET.container, containerId: info.Id, databaseOid: manifest.databaseOid }, manifestSha256: sha(fs.readFileSync(MANIFEST)), sourceHashes: sources, reportContainsRowsOrContacts: false, seedCalled: false, resetCalled: false, processesRestarted: false };
    step = 'snapshot-and-private-backup';
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); inTransaction = true; await client.query("SET LOCAL TIME ZONE 'UTC'"); await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
    receipt.before = await snapshotBusiness(client);
    const exported = await client.query('SELECT pg_export_snapshot() AS id');
    const backup = backupOwnedStage(info, credential, exported.rows[0].id);
    receipt.backup = { sha256: backup.sha256, bytes: backup.bytes, format: backup.format, private: true, sameExportedSnapshotAsBeforeHash: true, rawPathExported: false };
    await client.query('COMMIT'); inTransaction = false;
    assertIdentity(manifest, inspectContainer(), await databaseIdentity(client));
    assert.deepEqual(sourceHashes(), sources, 'Migration/source inputs drifted before execution');
    step = 'migrate-only';
    const databaseUrl = `postgresql://${encodeURIComponent(credential.user)}:${encodeURIComponent(credential.password)}@${TARGET.host}:${TARGET.port}/${TARGET.database}`;
    const migrated = spawnSync(process.execPath, ['--import', 'tsx', 'scripts/migrate.ts'], { cwd: ROOT, env: { ...process.env, DATABASE_URL: databaseUrl }, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 120000, windowsHide: true });
    const privateLog = path.join(PRIVATE, 'upgrade0008-' + stamp() + '.log'); fs.writeFileSync(privateLog, (migrated.stdout ?? '') + '\n' + (migrated.stderr ?? ''), { flag: 'wx', mode: 0o600 });
    receipt.migration = { script: 'scripts/migrate.ts', exitCode: migrated.status, rawOutputPrivate: true, withoutSeedOrReset: true };
    assert.equal(migrated.status, 0, 'Stage migration failed; private diagnostics retained');
    step = 'after-business-and-signatures';
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); inTransaction = true; await client.query("SET LOCAL TIME ZONE 'UTC'"); await client.query("SET LOCAL DateStyle = 'ISO, YMD'");
    assertIdentity(manifest, inspectContainer(), await databaseIdentity(client));
    receipt.after = await snapshotBusiness(client); assertBusinessUnchanged(receipt.before, receipt.after);
    const signed = (await client.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_at IS NULL)::int AS live, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted, count(*) FILTER (WHERE octet_length(pool_content_digest)=32 AND pool_content_digest=signal_resume_pool_content_digest(r))::int AS signed, count(*) FILTER (WHERE deleted_at IS NULL AND octet_length(pool_content_digest)=32 AND pool_content_digest=signal_resume_pool_content_digest(r))::int AS live_signed, count(*) FILTER (WHERE deleted_at IS NOT NULL AND octet_length(pool_content_digest)=32 AND pool_content_digest=signal_resume_pool_content_digest(r))::int AS deleted_signed FROM public.signal_candidate_resumes r")).rows[0];
    assert.equal(signed.total, signed.signed); assert.equal(signed.live, signed.live_signed); assert.equal(signed.deleted, signed.deleted_signed);
    receipt.signatures = { ...signed, allLiveAndDeletedRowsSigned32Bytes: true, exactDigestFunctionMatches: true };
    await client.query('COMMIT'); inTransaction = false;
    assert.deepEqual(sourceHashes(), sources, 'Source inputs changed during upgrade');
    assertIdentity(manifest, inspectContainer(), await databaseIdentity(client));
    receipt.businessStatePreserved = true; receipt.status = 'PASS'; receipt.passed = true;
  } catch {
    if (receipt) receipt.failure = 'Owned stage upgrade failed at ' + step + '; raw data/credentials/errors withheld';
    else throw new Error('Owned stage identity registration/manifest check failed; no migration authorized');
  } finally {
    if (inTransaction) await client.query('ROLLBACK').catch(() => {});
    try { await client.end(); } catch { if (receipt) { receipt.status = 'FAIL'; receipt.passed = false; receipt.failure = 'Owned-stage SQL connection cleanup failed; private details withheld'; } else throw new Error('Owned-stage identity connection cleanup failed'); }
    if (receipt) { receipt.finishedAt = timestamp(); receipt.scope = 'Exact existing named stage only. Same-snapshot private binary backup; all public table row commitments excluding solely resume digest; migrations only, no seed/reset/process control. No backup restore or app/browser/load acceptance claim.'; saveReceipt(receipt); }
  }
  if (receipt) {
    console.log(JSON.stringify({ passed: receipt.passed, status: receipt.status, report: path.relative(ROOT, RECEIPT).replaceAll('\\', '/'), businessStatePreserved: receipt.businessStatePreserved ?? false, migrated: receipt.migration?.exitCode === 0, seedCalled: false, resetCalled: false, processesRestarted: false }));
    if (!receipt.passed) process.exitCode = 1;
  }
}

module.exports = { TARGET, assertContainer, validateManifest, assertIdentity, quoteIdentifier, publicTableHashSql, commitTable, businessState, assertBusinessUnchanged, main };
if (require.main === module) main().catch(() => { console.error(JSON.stringify({ passed: false, failure: 'Fixed-stage helper guard failed; private details withheld', completionState: 'not-confirmed' })); process.exitCode = 1; });

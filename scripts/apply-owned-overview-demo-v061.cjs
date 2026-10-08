/** Preparation default has zero private-file/process/Docker/DB access.
 * Explicit root release applies ONLY insert-once overview content to exact owned stage.
 * Existing seeder is never replaced with all-seed, migration, repair, or reset.
 */
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const { createHash, randomUUID } = require('node:crypto');
const { spawnSync } = require('node:child_process');
const { createRequire } = require('node:module');

const ROOT = path.resolve(__dirname, '..');
const TARGET = Object.freeze({ database: 'signal_resume_stage', host: '127.0.0.1', port: 55435, containerName: 'signal-qa-cycle-01-db-1', apiOrigin: 'http://127.0.0.1:4313', apiPort: 4313 });
const RUNNER = path.join(os.homedir(), '.codex/private/signal-stage-api.cjs');
const PRIVATE = path.join(os.homedir(), '.codex/private/signal-v061-stage-overview');
const HISTORICAL = 'outputs/verification/release-0.6.0/stage-upgrade-0009.json';
const HELPER = 'scripts/apply-owned-overview-demo-v061.cjs';
const SEEDER = 'scripts/src/seed-overview-demo.ts';
const CHILD = 'scripts/seed-overview-demo.ts';
const AVATAR = 'scripts/fixtures/overview-synthetic-avatar.png';
const MARKER = 'overview-demo-content-v060-20261007';
const SHA_PATTERN = /^[a-f0-9]{64}$/;
const SOURCE_PATHS = [HELPER, SEEDER, CHILD, AVATAR, 'package.json', 'scripts/upgrade-owned-stage-v060.cjs', 'scripts/migrate.ts', 'lib/db/migrations/meta/_journal.json', 'lib/db/migrations/0009_microtask_resume.sql', 'lib/db/src/schema/signal-opportunities.ts', 'artifacts/api-server/src/lib/microtask-resume-policy.ts', 'artifacts/api-server/src/lib/opportunity-rules.ts', 'artifacts/api-server/src/lib/signal-avatar.ts'];
const EXPECTED_ADDITIONS = Object.freeze({ signal_users: 6, signal_candidate_profiles: 6, signal_candidate_resumes: 8, signal_micro_preferences: 6, signal_micro_templates: 1, signal_micro_subscriptions: 1, signal_micro_offers: 1, signal_demo_seed: 1 });
const EMAILS = ['backend-junior', 'backend-middle', 'backend-senior', 'frontend-junior', 'frontend-middle', 'frontend-ungraded'].map(slug => `overview-v060-${slug}@example.test`);
const sha = value => createHash('sha256').update(value).digest('hex');
const now = () => new Date().toISOString();
const quoteIdentifier = value => { assert.equal(typeof value, 'string'); assert.ok(value && !value.includes('\0')); return '"' + value.replaceAll('"', '""') + '"'; };
const json = value => JSON.stringify(value, null, 2) + '\n';
const sourceHashes = () => Object.fromEntries(SOURCE_PATHS.map(relative => [relative, sha(fs.readFileSync(path.join(ROOT, relative)))]));

function parseArgs(args) {
  assert.equal(args[0], '--apply-owned-stage');
  const names = ['expected-pid', 'expected-started-at', 'expected-runner-sha256', 'expected-container-id', 'expected-database-oid', 'expected-helper-sha256', 'expected-seeder-sha256', 'expected-child-sha256', 'expected-avatar-sha256', 'historical-0009-proof-sha256'];
  const parsed = {};
  assert.equal(args.length, 1 + names.length * 2, 'All explicit exact runtime/source bindings required');
  for (let i = 1; i < args.length; i += 2) {
    const name = args[i]?.replace(/^--/, '');
    assert.ok(names.includes(name) && args[i] === '--' + name && !Object.hasOwn(parsed, name));
    assert.ok(typeof args[i + 1] === 'string' && args[i + 1].length > 0);
    parsed[name] = args[i + 1];
  }
  for (const name of names.filter(name => name.includes('sha256') || name === 'expected-container-id')) assert.match(parsed[name], SHA_PATTERN);
  for (const name of ['expected-pid', 'expected-database-oid']) { assert.match(parsed[name], /^[1-9][0-9]*$/); assert.ok(Number.isSafeInteger(Number(parsed[name]))); }
  assert.match(parsed['expected-started-at'], /^\d{4}-\d{2}-\d{2}T[0-9:.]+(?:Z|\+00:00)$/);
  assert.ok(Number.isFinite(Date.parse(parsed['expected-started-at'])));
  return parsed;
}
function assertProcess(binding) {
  const script = String.raw`
$ErrorActionPreference='Stop'
if($PSVersionTable.PSVersion.Major -lt 7){throw 'PowerShell7 required'}
$signalExpectedPid=[int]$env:SIGNAL_OVERVIEW_BOUND_PID
$signalExpectedStarted=[datetime]$env:SIGNAL_OVERVIEW_BOUND_STARTED
$signalExpectedRunner=([string]$env:SIGNAL_OVERVIEW_BOUND_RUNNER).Replace('\','/')
$signalProcess=Get-CimInstance Win32_Process -Filter ('ProcessId='+$signalExpectedPid)
$signalCommand=([string]$signalProcess.CommandLine).Replace('\','/')
$signalRunnerArgument='(?:^|\s)(?:"'+[regex]::Escape($signalExpectedRunner)+'"|'+[regex]::Escape($signalExpectedRunner)+')(?=$|\s)'
if(-not $signalProcess -or $signalProcess.Name -ne 'node.exe' -or $signalProcess.ProcessId -ne $signalExpectedPid -or $signalCommand -notmatch $signalRunnerArgument){throw 'Owned runner identity mismatch'}
if(([datetime]$signalProcess.CreationDate).ToUniversalTime().Ticks -ne $signalExpectedStarted.ToUniversalTime().Ticks){throw 'Exact start identity mismatch'}
$signalBindings=@(Get-NetTCPConnection -LocalPort 4313 -State Listen -ErrorAction SilentlyContinue)
if($signalBindings.Count -ne 1 -or $signalBindings[0].OwningProcess -ne $signalExpectedPid -or $signalBindings[0].LocalAddress -ne '127.0.0.1' -or $signalBindings[0].LocalPort -ne 4313){throw 'Exact loopback API binding mismatch'}
[ordered]@{pid=$signalExpectedPid;startTimeUtc=([datetime]$signalProcess.CreationDate).ToUniversalTime().ToString('o');runnerBound=$true;apiOrigin='http://127.0.0.1:4313'}|ConvertTo-Json -Compress
`;
  const ps = path.join(os.homedir(), 'AppData/Local/Programs/PowerShell/7/pwsh.exe');
  const result = spawnSync(ps, ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', '-'], { input: script, encoding: 'utf8', maxBuffer: 1024 * 1024, timeout: 15000, windowsHide: true, env: { ...process.env, SIGNAL_OVERVIEW_BOUND_PID: binding['expected-pid'], SIGNAL_OVERVIEW_BOUND_STARTED: binding['expected-started-at'], SIGNAL_OVERVIEW_BOUND_RUNNER: RUNNER } });
  assert.equal(result.status, 0, 'Exact owned stage process guard failed; raw process output withheld');
  const parsed = JSON.parse(result.stdout.trim());
  assert.equal(parsed.pid, Number(binding['expected-pid'])); assert.equal(parsed.runnerBound, true); assert.equal(parsed.apiOrigin, TARGET.apiOrigin);
  return parsed;
}
function readRunnerIdentity(binding) {
  const bytes = fs.readFileSync(RUNNER);
  assert.equal(sha(bytes), binding['expected-runner-sha256'], 'Exact private runner SHA differs');
  // Opaque source identity only. Never eval/import the runner or interpret its template credentials.
  assert.ok(bytes.toString('utf8').includes('@127.0.0.1:55435/signal_resume_stage'), 'Private runner must contain exact stage target literal');
  return { sha256: sha(bytes), pathReadOnly: true, evaluated: false, databaseUrlParsed: false };
}
function inspectContainer(binding) {
  const result = spawnSync('docker', ['inspect', TARGET.containerName], { encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 15000, windowsHide: true });
  assert.equal(result.status, 0, 'Exact stage container inspect failed');
  const parsed = JSON.parse(result.stdout); assert.equal(parsed.length, 1); const info = parsed[0];
  assert.equal(info.Id, binding['expected-container-id']); assert.equal(info.Name, '/' + TARGET.containerName); assert.equal(info.State.Running, true);
  assert.equal(info.Config.Labels?.['com.docker.compose.project'], 'signal-qa-cycle-01'); assert.equal(info.Config.Labels?.['com.docker.compose.service'], 'db');
  const ports = info.NetworkSettings.Ports?.['5432/tcp']; assert.equal(ports?.length, 1); assert.equal(ports[0].HostIp, TARGET.host); assert.equal(ports[0].HostPort, String(TARGET.port));
  const env = new Map((info.Config.Env ?? []).map(value => { const i = value.indexOf('='); return [value.slice(0, i), value.slice(i + 1)]; }));
  assert.equal(env.get('POSTGRES_USER'), 'signal'); assert.ok(env.get('POSTGRES_PASSWORD'));
  return { info, user: env.get('POSTGRES_USER'), password: env.get('POSTGRES_PASSWORD') };
}
async function assertDatabaseIdentity(client, binding) {
  const result = await client.query('SELECT current_database() AS name, (SELECT oid::bigint::text FROM pg_database WHERE datname=current_database()) AS oid');
  assert.equal(result.rows.length, 1); assert.equal(result.rows[0].name, TARGET.database); assert.equal(String(result.rows[0].oid), binding['expected-database-oid']);
}
async function assertCurrent0009AndResumeSignatures(client) {
  const last = (await client.query('SELECT hash FROM drizzle.__drizzle_migrations ORDER BY created_at DESC, id DESC LIMIT 1')).rows;
  assert.equal(last.length, 1); assert.equal(last[0].hash, sha(fs.readFileSync(path.join(ROOT, 'lib/db/migrations/0009_microtask_resume.sql'))), 'Actual owned stage must already be at0009; no migration allowed');
  const trigger = (await client.query("SELECT count(*)::int AS total FROM pg_trigger WHERE tgname='signal_micro_offer_resume_immutable' AND NOT tgisinternal AND tgrelid='public.signal_micro_offers'::regclass")).rows[0]; assert.equal(trigger.total, 1);
  const signed = (await client.query("SELECT count(*)::int AS total, count(*) FILTER (WHERE deleted_at IS NULL)::int AS live, count(*) FILTER (WHERE deleted_at IS NOT NULL)::int AS deleted, count(*) FILTER (WHERE octet_length(pool_content_digest)=32 AND pool_content_digest=signal_resume_pool_content_digest(r))::int AS signed FROM public.signal_candidate_resumes r")).rows[0];
  assert.equal(signed.total, signed.signed, 'Every existing live/deleted CV must retain its exact current digest');
  return { ...signed, allLiveAndDeletedRowsSigned32Bytes: true, exactDigestFunctionMatches: true };
}
function historicalProof(binding) {
  const bytes = fs.readFileSync(path.join(ROOT, HISTORICAL)); assert.equal(sha(bytes), binding['historical-0009-proof-sha256']);
  const proof = JSON.parse(bytes.toString('utf8'));
  assert.equal(proof.applicationVersion, '0.6.0', 'Historical 0009 proof must retain its original version');
  assert.equal(proof.status, 'PASS'); assert.equal(proof.passed, true); assert.equal(proof.businessStatePreserved, true);
  assert.equal(proof.target.database, TARGET.database); assert.equal(proof.target.host, TARGET.host); assert.equal(proof.target.port, TARGET.port);
  assert.equal(proof.target.containerName, TARGET.containerName); assert.equal(proof.target.containerId, binding['expected-container-id']); assert.equal(String(proof.target.databaseOid), binding['expected-database-oid']);
  assert.equal(proof.migration.exitCode, 0); assert.equal(proof.migration.withoutSeedOrReset, true);
  assert.equal(proof.signatures.allLiveAndDeletedRowsSigned32Bytes, true); assert.equal(proof.signatures.exactDigestFunctionMatches, true);
  for (const relative of ['scripts/migrate.ts', 'lib/db/migrations/meta/_journal.json', 'lib/db/migrations/0009_microtask_resume.sql', 'lib/db/src/schema/signal-opportunities.ts']) assert.equal(sha(fs.readFileSync(path.join(ROOT, relative))), proof.sourceHashes[relative], 'Historical migration source association differs');
  return sha(bytes);
}

async function snapshot(client) {
  const tableNames = (await client.query("SELECT c.relname AS name FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname='public' AND c.relkind IN ('r','p') ORDER BY c.relname COLLATE \"C\"")).rows.map(row => row.name);
  assert.ok(tableNames.includes('signal_candidate_resumes') && tableNames.includes('signal_users'));
  const tables = [];
  for (const table of tableNames) {
    const keys = (await client.query("SELECT a.attname AS name FROM pg_index i JOIN pg_attribute a ON a.attrelid=i.indrelid AND a.attnum=ANY(i.indkey) WHERE i.indrelid=$1::regclass AND i.indisprimary ORDER BY a.attnum", ['public.' + quoteIdentifier(table)])).rows.map(row => row.name);
    const primary = keys.length ? `jsonb_build_array(${keys.map(key => 't.' + quoteIdentifier(key)).join(',')})::text` : 'to_jsonb(t)::text';
    const data = (await client.query(`SELECT ${primary} AS identity, to_jsonb(t)::text AS value FROM public.${quoteIdentifier(table)} t`)).rows;
    const rows = data.map(row => ({ keySha256: sha(row.identity), sha256: sha(row.value), data: JSON.parse(row.value) })).sort((a, b) => a.keySha256.localeCompare(b.keySha256) || a.sha256.localeCompare(b.sha256));
    if (keys.length) assert.equal(new Set(rows.map(row => row.keySha256)).size, rows.length, 'Primary identity collision');
    tables.push({ table, primaryKeyColumns: keys, rows });
  }
  return { tables };
}
function commitment(snapshotData, selector = () => true) {
  const tables = snapshotData.tables.map(table => ({ table: table.table, primaryKeyColumns: table.primaryKeyColumns, rows: table.rows.filter(row => selector(table.table, row)).map(row => ({ keySha256: row.keySha256, sha256: row.sha256 })) }));
  return { method: 'Complete canonical to_jsonb public row bytes, UTC; primary identity hash plus row hash, duplicate multiplicities retained; no excluded columns; sequence counters are outside business tables', tables, rows: tables.reduce((sum, table) => sum + table.rows.length, 0), sha256: sha(JSON.stringify(tables)) };
}
function protectedGroups(before) {
  const users = before.tables.find(table => table.table === 'signal_users').rows.map(row => row.data);
  const ordinaryReviewer = new Set(users.filter(user => user.demo_mode !== true || user.review_scope_id !== null).map(user => user.id));
  const generalDemo = new Set(users.filter(user => user.demo_mode === true && user.review_scope_id === null).map(user => user.id));
  const companies = new Map(before.tables.find(table => table.table === 'signal_companies').rows.map(row => [row.data.id, row.data.owner_user_id]));
  const linked = ids => (table, row) => table === 'signal_users' ? ids.has(row.data.id) : Object.entries(row.data).some(([key, value]) => (key === 'user_id' || key.endsWith('_user_id')) && ids.has(value)) || ids.has(companies.get(row.data.company_id));
  return { ordinaryReviewer: commitment(before, linked(ordinaryReviewer)), preexistingGeneralDemo: commitment(before, linked(generalDemo)), actorCounts: { ordinaryReviewer: ordinaryReviewer.size, preexistingGeneralDemo: generalDemo.size }, groupScope: 'Direct user_id/*_user_id and company ownership commitments supplement the stronger all-preexisting-row commitment; full-table equality protects unlinked cooldown/audit/session/history rows too.' };
}
function compareAndAdditions(before, after) {
  assert.deepEqual(after.tables.map(table => [table.table, table.primaryKeyColumns]), before.tables.map(table => [table.table, table.primaryKeyColumns]), 'Public table/primary-key inventory changed');
  const existing = [], added = [];
  for (const beforeTable of before.tables) {
    const afterTable = after.tables.find(table => table.table === beforeTable.table);
    const unused = [...afterTable.rows]; const retained = [];
    for (const old of beforeTable.rows) {
      const i = unused.findIndex(row => row.keySha256 === old.keySha256 && row.sha256 === old.sha256);
      assert.ok(i >= 0, 'Preexisting complete business row changed or disappeared'); retained.push(unused.splice(i, 1)[0]);
    }
    existing.push({ ...afterTable, rows: retained.sort((a, b) => a.keySha256.localeCompare(b.keySha256) || a.sha256.localeCompare(b.sha256)) });
    added.push({ ...afterTable, rows: unused });
  }
  const priorMarker = before.tables.find(table => table.table === 'signal_demo_seed').rows.some(row => row.data.key === MARKER);
  for (const table of added) assert.equal(table.rows.length, priorMarker ? 0 : EXPECTED_ADDITIONS[table.table] ?? 0, 'Unexpected row additions');
  const get = name => added.find(table => table.table === name)?.rows.map(row => row.data) ?? [];
  if (!priorMarker) {
    const users = get('signal_users'); assert.deepEqual(users.map(user => user.email).sort(), [...EMAILS].sort());
    assert.ok(users.every(user => user.demo_mode === true && user.review_scope_id === null && user.role === 'candidate'));
    const ids = new Set(users.map(user => user.id));
    assert.ok(get('signal_candidate_profiles').every(row => ids.has(row.user_id)));
    assert.ok(get('signal_candidate_resumes').every(row => ids.has(row.user_id)));
    assert.ok(get('signal_micro_preferences').every(row => ids.has(row.candidate_user_id)));
    const owner = before.tables.find(table => table.table === 'signal_users').rows.find(row => row.data.email === 'employer-demo@example.test' && row.data.demo_mode === true && row.data.review_scope_id === null && row.data.role === 'employer'); assert.ok(owner);
    const company = before.tables.find(table => table.table === 'signal_companies').rows.find(row => row.data.owner_user_id === owner.data.id); assert.ok(company);
    const template = get('signal_micro_templates')[0]; assert.equal(template.company_id, company.data.id); assert.equal(template.title, 'Учебный счётчик библиотеки · Demo'); assert.equal(template.educational_only, true);
    const subscription = get('signal_micro_subscriptions')[0], offer = get('signal_micro_offers')[0];
    assert.equal(subscription.template_id, template.id); assert.equal(subscription.active, false); assert.ok(ids.has(subscription.candidate_user_id));
    assert.equal(offer.subscription_id, subscription.id); assert.equal(offer.company_id, company.data.id); assert.equal(offer.candidate_user_id, subscription.candidate_user_id); assert.equal(offer.status, 'evaluated');
    assert.equal(offer.result.purpose, 'company_task'); assert.equal(offer.result.qualificationEffect, 'none'); assert.equal(offer.result.total, 8); assert.equal(offer.result.max, 10);
    const selected = get('signal_candidate_resumes').find(row => row.id === offer.resume_id); assert.ok(selected); assert.equal(selected.user_id, offer.candidate_user_id); assert.equal(selected.is_primary, false); assert.equal(selected.verified_grade, 'Middle');
    assert.equal(subscription.resume_id, selected.id); assert.equal(offer.resume_revision, selected.revision); assert.equal(offer.resume_context.resumeId, selected.id);
    assert.equal(get('signal_demo_seed')[0].key, MARKER);
  }
  return { priorMarker, existing: { tables: existing }, addedByTable: Object.fromEntries(added.filter(table => table.rows.length).map(table => [table.table, table.rows.length])) };
}
function backup(clientContainer, user, snapshotId, runId) {
  assert.match(snapshotId, /^[0-9A-Fa-f-]+$/); assert.match(runId, /^[a-f0-9]{32}$/);
  const temp = `/tmp/signal-overview-v061-${runId}.dump`; assert.match(temp, /^\/tmp\/signal-overview-v061-[a-f0-9]{32}\.dump$/);
  const destination = path.join(PRIVATE, `before-overview-v061-${runId}.dump`);
  assert.ok(!fs.existsSync(destination));
  const dumped = spawnSync('docker', ['exec', clientContainer.Id, 'pg_dump', '-U', user, '-d', TARGET.database, '--format=custom', '--no-owner', '--no-privileges', '--snapshot=' + snapshotId, '--file=' + temp], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
  assert.equal(dumped.status, 0, 'Whole owned-stage custom backup failed; seeder not started');
  const copied = spawnSync('docker', ['cp', `${clientContainer.Id}:${temp}`, destination], { encoding: 'utf8', timeout: 120000, maxBuffer: 1024 * 1024, windowsHide: true });
  assert.equal(copied.status, 0, 'Custom binary backup copy failed; seeder not started');
  const bytes = fs.readFileSync(destination); assert.equal(bytes.subarray(0, 5).toString('ascii'), 'PGDMP'); assert.ok(bytes.length > 100);
  const removed = spawnSync('docker', ['exec', clientContainer.Id, 'rm', '--', temp], { encoding: 'utf8', timeout: 15000, maxBuffer: 1024 * 1024, windowsHide: true });
  assert.equal(removed.status, 0, 'Only owned temporary backup file cleanup failed; private copy retained');
  return { path: destination, sha256: sha(bytes), bytes: bytes.length, private: true, format: 'PostgreSQL custom PGDMP; docker --file then binary docker cp, no shell pipeline', sameExportedSnapshotAsBeforeHash: true };
}

async function main(args = process.argv.slice(2)) {
  const mode = args[0] ?? '--check-only';
  if (mode === '--check-only') {
    assert.ok(args.length <= 1);
    console.log(JSON.stringify({ schemaVersion: 1, type: 'signal-overview-stage-preservation-v061', applicationVersion: '0.6.1', preparationOnly: true, stageAccess: false, privateFileReads: false, sourceFileReads: false, dockerCalled: false, processAction: false, databaseAccess: false, seedCalled: false, resetCalled: false, migrated: false, requiresExplicitRootReleaseAndExactBindings: true, target: TARGET }));
    return;
  }
  const binding = parseArgs(args);
  assert.equal(process.env.SIGNAL_STAGE_OVERVIEW_V061_RELEASE, '1', 'Explicit root release required before any private/stage/source access');
  const sources = sourceHashes();
  assert.equal(sources[HELPER], binding['expected-helper-sha256']); assert.equal(sources[SEEDER], binding['expected-seeder-sha256']); assert.equal(sources[CHILD], binding['expected-child-sha256']); assert.equal(sources[AVATAR], binding['expected-avatar-sha256']);
  assert.equal(JSON.parse(fs.readFileSync(path.join(ROOT, 'package.json'), 'utf8')).version, '0.6.1');
  const journal = JSON.parse(fs.readFileSync(path.join(ROOT, 'lib/db/migrations/meta/_journal.json'), 'utf8')); assert.equal(journal.entries.at(-1).idx, 9); assert.equal(journal.entries.at(-1).tag, '0009_microtask_resume');
  const historical0009ProofSha256 = historicalProof(binding);
  const runner = readRunnerIdentity(binding), processBinding = assertProcess(binding), connection = inspectContainer(binding);
  const { Client } = createRequire(path.join(ROOT, 'lib/db/package.json'))('pg');
  const client = new Client({ host: TARGET.host, port: TARGET.port, database: TARGET.database, user: connection.user, password: connection.password, application_name: 'signal-overview-preservation-v061', connectionTimeoutMillis: 5000, statement_timeout: 120000 });
  const runId = randomUUID().replaceAll('-', '');
  fs.mkdirSync(PRIVATE, { recursive: true, mode: 0o700 });
  const privateRelative = path.relative(ROOT, PRIVATE);
  assert.ok(privateRelative.startsWith('..' + path.sep) || path.isAbsolute(privateRelative), 'Private backup/receipt must stay outside repository');
  const receiptPath = path.join(PRIVATE, `signal-overview-stage-preservation-v061-${runId}.json`);
  const receipt = { schemaVersion: 1, type: 'signal-overview-stage-preservation-v061', status: 'FAIL', passed: false, startedAtUtc: now(), target: { database: TARGET.database, host: TARGET.host, port: TARGET.port, containerName: TARGET.containerName, containerId: connection.info.Id, databaseOid: Number(binding['expected-database-oid']) }, application: { version: '0.6.1', apiOrigin: TARGET.apiOrigin, runnerSha256: runner.sha256, pid: processBinding.pid, startTimeUtc: processBinding.startTimeUtc, versionMeaning: 'Target source workspace version; running old process binding only, no current API-version/restart claim' }, historical0009ProofSha256, sourceHashes: sources, marker: MARKER, seedCalled: false, resetCalled: false, migrated: false, processesRestarted: false, credentialsExported: false, rawRowsExported: false };
  let active = false, connected = false, step = 'database-identity';
  try {
    await client.connect(); connected = true; await assertDatabaseIdentity(client, binding);
    step = 'consistent-before-snapshot-and-private-backup';
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); active = true; await client.query("SET LOCAL TIME ZONE 'UTC'");
    receipt.signaturesBefore = await assertCurrent0009AndResumeSignatures(client);
    const before = await snapshot(client), beforeCommitment = commitment(before);
    receipt.before = { preexistingBusinessRowsSha256: beforeCommitment.sha256, preexistingBusinessRows: beforeCommitment.rows, commitment: beforeCommitment, protectedGroups: protectedGroups(before) };
    const exported = (await client.query('SELECT pg_export_snapshot() AS id')).rows[0].id;
    receipt.backup = backup(connection.info, connection.user, exported, runId);
    await client.query('COMMIT'); active = false;
    step = 'repeat-all-guards-before-only-overview-seed';
    readRunnerIdentity(binding); assertProcess(binding); inspectContainer(binding); await assertDatabaseIdentity(client, binding); assert.deepEqual(sourceHashes(), sources); assert.equal(historicalProof(binding), historical0009ProofSha256);
    const fresh = await snapshot(client); assert.deepEqual(commitment(fresh), beforeCommitment, 'Stage activity changed rows after backup; no seeder authorized');
    step = 'dedicated-insert-only-overview-seeder';
    const databaseUrl = `postgresql://${encodeURIComponent(connection.user)}:${encodeURIComponent(connection.password)}@${TARGET.host}:${TARGET.port}/${TARGET.database}`;
    const seeded = spawnSync(process.execPath, ['--import', 'tsx', CHILD], { cwd: ROOT, env: { ...process.env, DATABASE_URL: databaseUrl, DEMO_MODE: 'true', API_ORIGIN: TARGET.apiOrigin }, encoding: 'utf8', maxBuffer: 2 * 1024 * 1024, timeout: 60000, windowsHide: true });
    receipt.seedCalled = true; receipt.seed = { script: CHILD, exitCode: seeded.status, dedicatedOverviewOnly: true, noRepairOrReset: true };
    fs.writeFileSync(path.join(PRIVATE, `overview-v061-${runId}.log`), (seeded.stdout ?? '') + '\n' + (seeded.stderr ?? ''), { flag: 'wx', mode: 0o600 });
    assert.equal(seeded.status, 0, 'Dedicated overview transaction failed; private log retained; no reset/restore attempted');
    step = 'all-preexisting-rows-and-only-allowed-additions';
    await client.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY'); active = true; await client.query("SET LOCAL TIME ZONE 'UTC'");
    receipt.signaturesAfter = await assertCurrent0009AndResumeSignatures(client);
    const after = await snapshot(client), compared = compareAndAdditions(before, after), existingCommitment = commitment(compared.existing);
    assert.deepEqual(existingCommitment, beforeCommitment);
    receipt.after = { preexistingBusinessRowsSha256: existingCommitment.sha256, preexistingBusinessRows: existingCommitment.rows, commitment: existingCommitment, protectedGroups: protectedGroups(compared.existing) };
    assert.deepEqual(receipt.after.protectedGroups, receipt.before.protectedGroups);
    receipt.addedByTable = compared.addedByTable; receipt.contentPreviouslyPresent = compared.priorMarker;
    await client.query('COMMIT'); active = false;
    readRunnerIdentity(binding); assertProcess(binding); inspectContainer(binding); await assertDatabaseIdentity(client, binding); assert.deepEqual(sourceHashes(), sources); assert.equal(historicalProof(binding), historical0009ProofSha256);
    receipt.noUnexpectedRows = true; receipt.noChangedPreexistingRows = true; receipt.protectedOrdinaryReviewerRowsPreserved = true; receipt.preexistingGeneralDemoRowsPreserved = true;
    receipt.passed = true; receipt.status = 'PRESERVED';
  } catch {
    receipt.failureStep = step; receipt.failure = 'Exact preservation guard failed; raw errors/rows/credentials withheld. Do not restart from this receipt or reset/restore automatically.';
    process.exitCode = 1;
  } finally {
    if (active) await client.query('ROLLBACK').catch(() => {});
    if (connected) await client.end().catch(() => { receipt.passed = false; receipt.status = 'FAIL'; process.exitCode = 1; });
    receipt.finishedAtUtc = now(); receipt.scope = 'Only exact named owned stage; same-exported-snapshot private whole DB backup; all complete preexisting public business rows retained including cooldowns/history/ordinary/reviewer/generalDemo actions; only marker-owned overview inserts allowed. PostgreSQL sequence counters excluded. No migration, all-seed, repair, reset, API restart, browser/load/runtime release acceptance. Concurrent stage mutation causes FAIL, never overwrites user activity or auto-restores backup.';
    fs.writeFileSync(receiptPath, json(receipt), { flag: 'wx', mode: 0o600 });
  }
  console.log(JSON.stringify({ prepared: false, passed: receipt.passed, status: receipt.status, preservationProofPath: receiptPath, preservationProofSha256: sha(fs.readFileSync(receiptPath)), seedCalled: receipt.seedCalled, resetCalled: false, migrated: false, processesRestarted: false }));
}
module.exports = { TARGET, parseArgs, quoteIdentifier, commitment, compareAndAdditions, main };
if (require.main === module) main().catch(() => { console.error(JSON.stringify({ passed: false, status: 'GUARD_REJECTED', stageApplicationConfirmed: false, privateDetailsWithheld: true })); process.exitCode = 1; });

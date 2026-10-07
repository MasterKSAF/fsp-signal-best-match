/** Restore the private pre-upgrade dump only into a new named QA database. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';

const run = promisify(execFile), requireDb = createRequire(new URL('../lib/db/package.json', import.meta.url));
const { Pool } = requireDb('pg');
const container = 'signal-qa-cycle-01-db-1', database = 'signal_resume_migration_check';
const dump = 'outputs/verification/multi-resume-2026-10-06/private/before.dump';
const out = 'outputs/verification/multi-resume/migration-check-2026-10-06.json';
const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const quote = (value: string) => `"${value.replaceAll('"', '""')}"`;
const info = JSON.parse((await run('docker', ['inspect', container])).stdout)[0];
assert.equal(info.Name, '/' + container);
assert.ok(info.NetworkSettings.Ports['5432/tcp'].some((p: any) => p.HostIp === '127.0.0.1' && p.HostPort === '55435'));
const env = new Map<string, string>(info.Config.Env.map((value: string) => { const at = value.indexOf('='); return [value.slice(0, at), value.slice(at + 1)]; }));
const user = env.get('POSTGRES_USER')!, password = env.get('POSTGRES_PASSWORD')!;
assert.ok(user && password);
const url = new URL(`postgresql://${encodeURIComponent(user)}:${encodeURIComponent(password)}@127.0.0.1:55435/${database}`);
assert.equal(url.pathname, '/signal_resume_migration_check');
assert.equal(url.port, '55435');
assert.equal(url.hostname, '127.0.0.1');
const controlUrl = new URL(url); controlUrl.pathname = '/postgres';
const control = new Pool({ connectionString: controlUrl.href }), target = new Pool({ connectionString: url.href });
const runId = randomBytes(6).toString('hex'), containerDump = `/tmp/signal-migration-check-${runId}.dump`;
const checks: string[] = [], report: any = {
  status: 'FAIL', startedAt: new Date().toISOString(), database, container,
  scope: 'Actual private pre-upgrade backup restored into a new isolated QA database; migration, preservation and reruns. No API/runtime, live/old QA/stage queries or participant data exported.',
  reportContainsRowsOrContacts: false, runtimeStarted: false, externalNotifications: false, checks,
};
let created = false;
let priorFailedReport: any = null;
async function guard() { assert.equal((await target.query('SELECT current_database() AS name')).rows[0].name, database); }
async function columns(table: string) {
  return (await target.query('SELECT column_name FROM information_schema.columns WHERE table_schema=\'public\' AND table_name=$1 ORDER BY ordinal_position', [table])).rows.map((row: any) => row.column_name) as string[];
}
async function digest(table: string, fields: readonly string[], condition = 'true') {
  const { rows: [row] } = await target.query(`SELECT count(*)::int AS count, md5(coalesce(string_agg(rowhash,'' ORDER BY rowhash),'')) AS digest FROM (SELECT md5(row_to_json(t)::text) AS rowhash FROM (SELECT ${fields.map(quote).join(',')} FROM ${quote(table)} WHERE ${condition}) t) h`);
  return { count: row.count, sha256OfCanonicalRowDigests: sha(row.digest) };
}
async function snapshot(spec: Record<string, string[]>) {
  const rows: Record<string, unknown> = {};
  for (const [table, fields] of Object.entries(spec)) rows[table] = await digest(table, fields);
  return rows;
}
async function allTables() {
  const result: Record<string, string[]> = {};
  for (const row of (await target.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows) result[row.tablename] = await columns(row.tablename);
  return result;
}
async function count(sql: string, params: unknown[] = []) { return Number((await target.query(sql, params)).rows[0].count); }
async function apply(sql: string) {
  await guard();
  const client = await target.connect();
  try { await client.query('BEGIN'); await client.query(sql); await client.query('COMMIT'); }
  catch (error) { await client.query('ROLLBACK'); throw error; }
  finally { client.release(); }
}
try {
  const backup = await readFile(dump);
  report.backup = { privatePath: dump, bytes: backup.length, sha256: sha(backup), excludedFromSubmission: true };
  const exists = (await control.query('SELECT count(*)::int AS count FROM pg_database WHERE datname=$1', [database])).rows[0].count;
  if (exists) {
    assert.equal(process.env.SIGNAL_MIGRATION_CHECK_REUSE, '1', 'Existing database requires explicit reuse of an untouched failed restore, never overwrite');
    const oldReport = await readFile(out);
    priorFailedReport = JSON.parse(oldReport.toString());
    assert.equal(priorFailedReport.status, 'FAIL');
    assert.equal(priorFailedReport.database, database);
    assert.equal(priorFailedReport.backup.sha256, sha(backup));
    assert.equal(priorFailedReport.checks.length, 0);
    await mkdir('outputs/verification/multi-resume/history', { recursive: true });
    await writeFile(`outputs/verification/multi-resume/history/migration-check-failed-${sha(oldReport).slice(0, 12)}.json`, oldReport);
    report.reusedUntouchedFailedRestore = true;
    report.restoreSeconds = priorFailedReport.restoreSeconds;
  } else {
    await control.query(`CREATE DATABASE ${quote(database)}`); created = true;
    await guard();
    await run('docker', ['cp', dump, `${container}:${containerDump}`]);
    const restoreAt = performance.now();
    await run('docker', ['exec', container, 'pg_restore', '--exit-on-error', '--no-owner', '-U', user, '-d', database, containerDump], { timeout: 60000 });
    report.restoreSeconds = (performance.now() - restoreAt) / 1000;
  }
  await guard();
  assert.equal((await columns('signal_candidate_resumes')).includes('id'), false, 'Backup must actually precede multi-resume upgrade');
  assert.equal(await count("SELECT count(*) FROM pg_tables WHERE schemaname='public' AND tablename='signal_complaints'"), 0);
  const legacyColumns = await allTables(), restoredSnapshot = await snapshot(legacyColumns);
  if (priorFailedReport) assert.deepEqual(restoredSnapshot, priorFailedReport.restoredPreUpgrade, 'Retry must use the exact untouched restored database from the preserved failed check');
  report.restoredPreUpgrade = restoredSnapshot;
  const originalCandidateCount = await count("SELECT count(*) FROM signal_candidate_profiles p JOIN signal_users u ON u.id=p.user_id WHERE u.role='candidate'");
  const oldResumeCount = await count('SELECT count(*) FROM signal_candidate_resumes');
  report.restoredCounts = { candidatesWithProfiles: originalCandidateCount, oldResumes: oldResumeCount };
  assert.ok(originalCandidateCount > 0);
  report.realLegacyContentAvailable = oldResumeCount > 0;
  checks.push('Private real backup restores pre-upgrade schema and existing profiles/history; actual legacy resume content count is reported without inventing nonempty rows');

  // These fixtures are added to the isolated restored database only, not the backup or a serving database.
  const candidate = (await target.query("INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,'unusable-migration-fixture','candidate','Migration synthetic candidate',true,false) RETURNING id", [`migration-${runId}-candidate@example.test`])).rows[0].id;
  const employer = (await target.query("INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,'unusable-migration-fixture','employer','Migration synthetic employer',true,false) RETURNING id", [`migration-${runId}-employer@example.test`])).rows[0].id;
  await target.query("INSERT INTO signal_candidate_profiles(user_id,professional_alias,specialization,verified_grade,verified_score,verified_skills,stack,skills,years_experience,salary_min,salary_max,salary_period,salary_type,visibility,consent_matching,contact_email) VALUES($1,'Migration synthetic','Frontend / TypeScript','Middle',83,ARRAY['TypeScript'],ARRAY['TypeScript'],ARRAY['Accessibility'],7,1800000,2400000,'year','net','pseudonymous',true,$2),($3,'Employer-only legacy profile','Backend / Python',NULL,NULL,'{}','{}','{}',0,NULL,NULL,'month','gross','private',false,$4)", [candidate, `migration-${runId}-candidate@example.test`, employer, `migration-${runId}-employer@example.test`]);
  assert.equal(await count('SELECT count(*) FROM signal_candidate_resumes WHERE user_id IN($1,$2)', [candidate, employer]), 0);
  const contentCandidate = (await target.query("INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,'unusable-migration-fixture','candidate','Migration synthetic legacy CV',true,false) RETURNING id", [`migration-${runId}-content@example.test`])).rows[0].id;
  await target.query("INSERT INTO signal_candidate_profiles(user_id,professional_alias,specialization,assumed_grade,verified_grade,verified_score,verified_skills,stack,skills,years_experience,work_format,salary_min,salary_max,salary_period,salary_type,visibility,consent_matching,phone,contact_email,latest_assessment_at) VALUES($1,'Migration content fixture','Backend / Python','Senior','Middle',100,ARRAY['Python','SQL'],ARRAY['Python','PostgreSQL'],ARRAY['Architecture'],9,'Гибрид',200000,300000,'month','gross','public',true,'+70000000000',$2,'2026-10-05T12:00:00Z')", [contentCandidate, `migration-${runId}-content@example.test`]);
  await target.query("INSERT INTO signal_candidate_resumes(user_id,summary,soft_skills,experience,projects,education,portfolio,questionnaire,questionnaire_history) VALUES($1,'Synthetic Cyrillic content — migration preservation',ARRAY['Коммуникация'],$2,$3,$4,$5,$6,$7)", [contentCandidate,
    JSON.stringify([{ company: 'Synthetic company', description: 'Original experience payload', startDate: '2020-01' }]),
    JSON.stringify([{ title: 'Synthetic project', description: 'Preserved detailed project' }]),
    JSON.stringify([{ institution: 'Synthetic school', qualification: 'Preserved qualification' }]),
    JSON.stringify([{ title: 'Synthetic portfolio', url: 'https://example.test/portfolio' }]),
    JSON.stringify({ version: 'backend-python-v1', industry: 'ИТ', specialization: 'Backend / Python', answers: { python: 3, databases: 2, api: 3, testing: 2, reliability: 3, ownership: 2 } }),
    JSON.stringify([{ createdAt: '2026-10-04T12:00:00Z', grade: 'Middle', source: 'synthetic-migration-fixture', preserved: true }]),
  ]);
  report.syntheticPreUpgradeFixtures = { candidateWithoutCV: 1, employerWithLegacyProfileWithoutCV: 1, candidateWithNonemptyLegacyContent: 1 };
  const oldResumeOwners = (await target.query('SELECT user_id FROM signal_candidate_resumes ORDER BY user_id')).rows.map((row: any) => Number(row.user_id));
  assert.ok(oldResumeOwners.length > 0 && oldResumeOwners.every((id: number) => Number.isSafeInteger(id) && id > 0));
  const withFixtures = await snapshot(legacyColumns);
  const originalProfessional = ['user_id', 'specialization', 'assumed_grade', 'verified_grade', 'verified_grade_changed_at', 'verified_score', 'verified_skills', 'stack', 'skills', 'years_experience', 'work_format', 'salary_min', 'salary_max', 'salary_period', 'salary_type', 'visibility', 'consent_matching', 'latest_assessment_at'];
  const candidateProfessional = await digest('signal_candidate_profiles', originalProfessional, "user_id IN(SELECT id FROM signal_users WHERE role='candidate')");
  const oldIds = await digest('signal_assessment_attempts', ['id', 'user_id']);
  const migration04 = await readFile('lib/db/migrations/0004_multi_resume.sql', 'utf8'), migration05 = await readFile('lib/db/migrations/0005_trust_operations.sql', 'utf8');
  report.migrationSourceHashes = { '0004_multi_resume.sql': sha(migration04), '0005_trust_operations.sql': sha(migration05) };
  await apply(migration04); await apply(migration05);
  const afterColumns = await allTables();
  const preserved = await snapshot(legacyColumns);
  for (const table of Object.keys(legacyColumns)) {
    if (table !== 'signal_candidate_resumes') assert.deepEqual(preserved[table], withFixtures[table], `Original ${table} columns/count/digest remain unchanged`);
  }
  const originalCv = await digest('signal_candidate_resumes', legacyColumns.signal_candidate_resumes!, `user_id IN(${oldResumeOwners.join(',')})`);
  assert.deepEqual(originalCv, withFixtures.signal_candidate_resumes, 'Every legacy content/questionnaire/history field stays unchanged');
  assert.deepEqual(await digest('signal_candidate_resumes', originalProfessional), candidateProfessional, 'Professional fields are copied exactly from candidate profiles');
  assert.deepEqual(await digest('signal_assessment_attempts', ['id', 'user_id']), oldIds);
  report.originalLegacyColumnsAfterUpgrade = preserved;
  checks.push('All original table counts/digests preserved; every old resume content/questionnaire/history field unchanged; professional projection copied exactly');
  assert.equal(await count("SELECT count(*) FROM signal_candidate_resumes r JOIN signal_users u ON u.id=r.user_id WHERE u.role<>'candidate'"), 0);
  assert.equal(await count('SELECT count(*) FROM signal_candidate_resumes WHERE user_id=$1 AND is_primary AND deleted_at IS NULL', [candidate]), 1);
  assert.equal(await count('SELECT count(*) FROM signal_candidate_resumes WHERE user_id=$1', [employer]), 0);
  assert.equal(await count('SELECT count(*) FROM signal_candidate_resumes WHERE consent_catalog OR ready_for_offers'), 0);
  assert.equal(await count('SELECT count(*) FROM signal_candidate_resumes WHERE revision<>1 OR deleted_at IS NOT NULL'), 0);
  assert.equal(await count('SELECT count(*) FROM signal_resume_migration_state WHERE applied_at IS NULL'), 0);
  assert.equal(await count('SELECT count(*) FROM signal_candidate_resumes'), originalCandidateCount + 2);
  checks.push('Candidate with no previous CV receives exactly one primary; employer receives none; new catalogue/readiness flags remain off');
  const linkChecks = {
    attemptsPreserved: (await digest('signal_assessment_attempts', ['id', 'user_id'])).count,
    invitationsPreserved: (preserved.signal_invitations as any).count,
    applicationsPreserved: (preserved.signal_applications as any).count,
    invalidAttemptLinks: await count('SELECT count(*) FROM signal_assessment_attempts a JOIN signal_candidate_resumes r ON r.id=a.resume_id WHERE a.user_id<>r.user_id OR a.resume_specialization<>r.specialization'),
    invalidInvitationLinks: await count('SELECT count(*) FROM signal_invitations i LEFT JOIN signal_resume_migration_state m ON m.user_id=i.candidate_user_id WHERE i.resume_id IS DISTINCT FROM m.resume_id'),
    invalidApplicationLinks: await count('SELECT count(*) FROM signal_applications a LEFT JOIN signal_resume_migration_state m ON m.user_id=a.candidate_user_id WHERE a.resume_id IS DISTINCT FROM m.resume_id'),
    inventedHistoricalSnapshots: await count('SELECT count(*) FROM signal_invitations WHERE resume_snapshot IS NOT NULL') + await count('SELECT count(*) FROM signal_applications WHERE resume_snapshot IS NOT NULL'),
  };
  assert.equal(linkChecks.invalidAttemptLinks + linkChecks.invalidInvitationLinks + linkChecks.invalidApplicationLinks + linkChecks.inventedHistoricalSnapshots, 0);
  report.historyAndLinks = linkChecks;
  checks.push('Original attempt IDs, invitation/application histories and contact bases remain intact; added resume links are owned; unknown historical snapshots stay NULL');

  const first = await snapshot(afterColumns);
  await apply(migration04); await apply(migration05);
  const firstRerun = await snapshot(afterColumns);
  assert.deepEqual(firstRerun, first, 'First direct SQL rerun leaves every upgraded table unchanged');
  report.firstRerun = { unchanged: true, before: first, after: firstRerun };
  checks.push('First rerun of both complete SQL files is idempotent across every public table');

  // Editing/hiding/deleting a migrated resume must never be undone by the backfill retry.
  await guard();
  await target.query("UPDATE signal_candidate_resumes SET deleted_at='2026-10-06T12:00:00Z',is_primary=false,consent_matching=false,visibility='private',title='Deleted migration fixture',revision=2 WHERE user_id=$1", [candidate]);
  const deletedBefore = await snapshot(afterColumns);
  await apply(migration04); await apply(migration05);
  const secondRerun = await snapshot(afterColumns);
  assert.deepEqual(secondRerun, deletedBefore, 'Retry cannot reactivate, overwrite or replace a tombstone');
  assert.equal(await count('SELECT count(*) FROM signal_candidate_resumes WHERE user_id=$1', [candidate]), 1);
  assert.equal(await count('SELECT count(*) FROM signal_candidate_resumes WHERE user_id=$1 AND deleted_at IS NULL', [candidate]), 0);
  assert.equal(await count('SELECT count(*) FROM signal_resume_migration_state WHERE user_id=$1 AND applied_at IS NOT NULL', [candidate]), 1);
  report.secondRerunAfterSoftDelete = { unchanged: true, before: deletedBefore, after: secondRerun };
  checks.push('Second rerun after deleting the migrated candidate CV preserves the exact tombstone and durable backfill marker without resurrection');

  // Durable marker also protects a removed row: no FK to the CV is deliberately required.
  await guard(); await target.query('DELETE FROM signal_candidate_resumes WHERE user_id=$1', [candidate]);
  const removedBefore = await snapshot(afterColumns);
  await apply(migration04);
  assert.deepEqual(await snapshot(afterColumns), removedBefore);
  assert.equal(await count('SELECT count(*) FROM signal_candidate_resumes WHERE user_id=$1', [candidate]), 0);
  report.optionalHardDeleteRetry = { unchanged: true, durableMarkerRetained: true };
  checks.push('Additional retry after removal of the original migrated row does not backfill again while its durable marker remains');
  report.status = 'PASS';
  report.databaseRetainedForInspection = true;
} catch (error) {
  report.failure = error instanceof Error ? error.message : 'Migration acceptance failed';
  report.errorCode = (error as any)?.code ?? null;
  process.exitCode = 1;
} finally {
  if (created) await guard().catch(() => {});
  await target.end(); await control.end();
  await run('docker', ['exec', container, 'rm', '-f', containerDump]).catch(() => {});
  report.completedAt = new Date().toISOString();
  report.scriptSha256 = sha(await readFile('scripts/multi-resume-migration-check.ts'));
  await mkdir('outputs/verification/multi-resume', { recursive: true });
  await writeFile(out, JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ status: report.status, checks: checks.length, report: out, database, failure: report.failure ?? null, errorCode: report.errorCode ?? null }));
}

import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { db, pool } from '../lib/db/src/index';
import { migrate } from '../lib/db/node_modules/drizzle-orm/node-postgres/migrator.js';
import { buildSkillAttempt } from '../artifacts/api-server/src/lib/skill-module-bank';
import { bankContentHash, currentBankBundle } from '../artifacts/api-server/src/lib/skill-bank-manifest';
import { claimComputation, enqueueComputation, publishComputation, readCurrentComputation, StaleComputationError, ComputationAccessError } from '../artifacts/api-server/src/lib/signal-computation-tasks';

const connection = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['127.0.0.1', 'localhost'].includes(connection.hostname) && connection.port === '55480' && connection.pathname === '/signal', 'Only the allocated competitive QA database may be used');
const ident = (v: string) => `"${v.replaceAll('"', '""')}"`;
type TableSnapshot = { table: string; columns: string[]; count: number; digest: string };
async function snapshotTable(table: string, columns: string[]): Promise<TableSnapshot> {
  const tuple = `row(${columns.map(ident).join(',')})::text`;
  const { rows } = await pool.query(`select count(*)::int as count,md5(coalesce(string_agg(md5(${tuple}),'' order by md5(${tuple})),'')) as digest from ${ident(table)}`);
  return { table, columns, ...rows[0] };
}
try {
  const beforeS01 = !(await pool.query("select 1 from information_schema.columns where table_name='signal_skill_attempts' and column_name='provenance'")).rowCount;
  if (beforeS01) {
    const owner = (await pool.query('select user_id,id from signal_candidate_resumes order by id limit 1')).rows[0];
    assert.ok(owner, 'Seed the isolated baseline first');
    const form = buildSkillAttempt('python', 'Middle', 'pre-manifest-legacy-fixture');
    await pool.query(`insert into signal_skill_attempts(user_id,resume_id,skill_id,level,program_version,status,cases,oracles,answers,policy,expires_at) values($1,$2,'python','Middle',$3,'active',$4,$5,'{}',$6,now()+interval '30 minutes')`, [owner.user_id, owner.id, form.programVersion, JSON.stringify(form.cases), JSON.stringify(form.oracles), JSON.stringify(form.policy)]);
    const tables = (await pool.query("select tablename from pg_tables where schemaname='public' order by tablename")).rows;
    const before: TableSnapshot[] = [];
    for (const { tablename } of tables) {
      const columns = (await pool.query("select column_name from information_schema.columns where table_schema='public' and table_name=$1 order by ordinal_position", [tablename])).rows.map(r => r.column_name);
      before.push(await snapshotTable(tablename, columns));
    }
    writeFileSync('../baseline-database-before.json', JSON.stringify({ migration: '0019_service_complaints', databaseOwner: 'signal-competitive-20261028', tables: before }, null, 2));
  }
  const before = JSON.parse(readFileSync('../baseline-database-before.json', 'utf8')) as { tables: TableSnapshot[] };
  assert.ok(before.tables.every(t => t.columns?.length), 'Preservation baseline must include original column projection');
  await migrate(db, { migrationsFolder: 'lib/db/migrations' });
  // Compare original column projections: adding NULL provenance is not rewriting history.
  const preserved = await Promise.all(before.tables.map(t => snapshotTable(t.table, t.columns)));
  assert.deepEqual(preserved, before.tables);
  const checks = [{ id: 'migration-preserves-all-baseline-columns', passed: true, tables: preserved.length }];
  const bundle = currentBankBundle(); const attestationHash = bankContentHash(bundle.attestation);
  await pool.query(`insert into signal_skill_bank_releases(content_hash,release_id,program_version,manifest,sources,attestation,attestation_hash) values($1,$2,$3,$4,$5,$6,$7) on conflict do nothing`, [bundle.manifestHash, bundle.releaseId, bundle.manifest.programVersion, JSON.stringify(bundle.manifest), JSON.stringify(bundle.sources), JSON.stringify(bundle.attestation), attestationHash]);
  await assert.rejects(pool.query('update signal_skill_bank_releases set program_version=$1 where content_hash=$2', ['mutated', bundle.manifestHash]), /immutable/);
  const legacy = (await pool.query('select id,cases,oracles,provenance,bank_release_hash from signal_skill_attempts where provenance is null order by id limit 1')).rows[0];
  assert.ok(legacy && legacy.bank_release_hash === null && legacy.provenance === null);
  await assert.rejects(pool.query('update signal_skill_attempts set cases=\'[]\' where id=$1', [legacy.id]), /immutable/);
  checks.push({ id: 'immutable-release-and-legacy-attempt', passed: true, tables: 2 });
  const company = (await pool.query('select id,owner_user_id from signal_companies order by id limit 1')).rows[0];
  const need = (await pool.query(`insert into signal_needs(company_id,title,specialization,grade,required_skills,description,work_format,salary_min,salary_max,status)
    select $1,'S03 isolated dependency fixture',specialization,grade,required_skills,'QA-owned context',work_format,salary_min,salary_max,'active' from signal_needs where company_id=$1 limit 1 returning id`, [company.id])).rows[0];
  assert.ok(need);
  const resume = (await pool.query(`insert into signal_candidate_resumes(user_id,title,specialization,assumed_grade,stack,skills,years_experience,work_format,visibility,consent_matching,consent_catalog)
    select user_id,'S03 isolated CV',specialization,assumed_grade,stack,skills,years_experience,work_format,'public',true,true from signal_candidate_resumes order by id limit 1 returning id`)).rows[0];
  const context = { type: 'need' as const, id: need.id };
  const command = { actorId: company.owner_user_id, companyId: company.id, context, kind: 'qa-barrier', commandKey: `qa:${randomUUID()}`, input: { first: 1, nested: { b: 2, a: 1 } } };
  const [a, b] = await Promise.all([enqueueComputation(command), enqueueComputation({ ...command, input: { nested: { a: 1, b: 2 }, first: 1 } })]);
  assert.equal(a.id, b.id);
  const oldLease = await claimComputation(a.id); assert.ok(oldLease);
  // Explicit barrier: a separate client revokes the exact CV after capture and before publication.
  const mutator = await pool.connect();
  try { await mutator.query('update signal_candidate_resumes set consent_matching=false,revision=revision+1 where id=$1', [resume.id]); }
  finally { mutator.release(); }
  assert.equal((await publishComputation(a.id, oldLease.leaseFence, { candidateResumeId: resume.id })).reason, 'discarded_stale');
  assert.equal((await pool.query('select result from signal_computation_tasks where id=$1', [a.id])).rows[0].result, null);
  await assert.rejects(readCurrentComputation(a.id, company.owner_user_id, company.id), StaleComputationError);
  const latest = (await pool.query("select id from signal_computation_tasks where context_id=$1 and command_key like 'latest:%' order by created_at desc limit 1", [need.id])).rows[0];
  const freshLease = await claimComputation(latest.id); assert.ok(freshLease);
  assert.equal((await publishComputation(latest.id, freshLease.leaseFence, { count: 0 })).published, true);
  assert.deepEqual((await readCurrentComputation(latest.id, company.owner_user_id, company.id)).result, { count: 0 });
  await assert.rejects(readCurrentComputation(latest.id, company.owner_user_id + 999999, company.id), ComputationAccessError);
  checks.push({ id: 'two-client-consent-race-dedup-latest-and-ACL', passed: true, tables: 3 });
  const leaseTask = await enqueueComputation({ ...command, commandKey: `qa-lease:${randomUUID()}` });
  const fence1 = await claimComputation(leaseTask.id); assert.ok(fence1);
  await pool.query("update signal_computation_tasks set lease_until=now()-interval '1 second' where id=$1", [leaseTask.id]);
  const fence2 = await claimComputation(leaseTask.id); assert.ok(fence2 && fence2.leaseFence > fence1.leaseFence);
  assert.equal((await publishComputation(leaseTask.id, fence1.leaseFence, { oldWorker: true })).reason, 'lease_lost');
  assert.equal((await publishComputation(leaseTask.id, fence2.leaseFence, { currentWorker: true })).published, true);
  await pool.query('update signal_needs set revision=revision+1,grade=$2 where id=$1', [need.id, 'Senior']);
  await assert.rejects(readCurrentComputation(leaseTask.id, company.owner_user_id, company.id), StaleComputationError);
  checks.push({ id: 'lease-recovery-fencing-and-requirement-revision', passed: true, tables: 2 });
  writeFileSync('../stage-a-integration.json', JSON.stringify({ passed: true, checks }, null, 2));
  console.info(JSON.stringify({ passed: true, checks }));
} finally { await pool.end(); }

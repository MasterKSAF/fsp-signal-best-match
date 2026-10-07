/** Local restore drill. Exported snapshot -> private dump -> NEW named DB.
 * Never overwrites a database, never boots schedulers or mail, never emits rows.
 * Only explicit synthetic source users and the exact newly created DB are removed.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { once } from 'node:events';

const run = promisify(execFile), requireDb = createRequire(new URL('../lib/db/package.json', import.meta.url));
const { Pool } = requireDb('pg');
const sourceUrl = process.env.DATABASE_URL!;
assert.ok(sourceUrl && ['localhost', '127.0.0.1', '[::1]'].includes(new URL(sourceUrl).hostname), 'Local database only');
const source = new Pool({ connectionString: sourceUrl });
const suffix = randomUUID().replaceAll('-', '').slice(0, 12), database = `signal_restore_${suffix}`;
assert.match(database, /^signal_restore_[a-f0-9]{12}$/);
const privateDirectory = 'outputs/local-backup', reportDirectory = 'outputs/verification';
await mkdir(privateDirectory, { recursive: true }); await mkdir(reportDirectory, { recursive: true });
const dumpPath = `${privateDirectory}/restore-${suffix}.dump`, containerDump = `/tmp/signal-restore-${suffix}.dump`;
const report: any = { startedAt: new Date().toISOString(), scope: 'Full local working-database snapshot, including explicit synthetic restore fixtures; no human reliability or production disaster-recovery claim', database, sourceData: 'Local prototype records and synthetic demo/QA data; no rows, contacts, dump or credentials are exported in this report', commands: ['docker compose exec -T db pg_dump --format=custom --snapshot=<exported read-only snapshot> --file=<private temporary file> -U signal -d signal', 'docker cp <db container>:<private temporary file> outputs/local-backup/<private dump>', 'docker compose exec -T db createdb -U signal <new isolated database>', 'docker compose exec -T db pg_restore --exit-on-error --no-owner -U signal -d <new isolated database> <private temporary file>', 'node --env-file-if-exists=.env --import tsx scripts/backup-restore-check.ts'], checks: [], timingsSeconds: {}, passed: false, cleanup: 'pending', schedulerStarted: false, mailSent: false };
const checks = report.checks as string[], created: number[] = []; let testCreated = false, restored: any, snapshotClient: any, httpServer: any, apiPool: any;
const sha = (input: string | Buffer) => createHash('sha256').update(input).digest('hex');
const quote = (name: string) => `"${name.replaceAll('"', '""')}"`;
async function snapshot(client: any) {
  const tableNames = (await client.query("SELECT schemaname, tablename FROM pg_tables WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,tablename")).rows;
  const tables = [];
  for (const { schemaname, tablename } of tableNames) {
    const { rows: [row] } = await client.query(`SELECT count(*)::int AS rows, md5(coalesce(string_agg(rowhash,'' ORDER BY rowhash),'')) AS digest FROM (SELECT md5(row_to_json(t)::text) AS rowhash FROM ${quote(schemaname)}.${quote(tablename)} t) hashed`);
    tables.push({ table: `${schemaname}.${tablename}`, rows: row.rows, sha256OfCanonicalRowDigests: sha(row.digest) });
  }
  const schema = (await client.query("SELECT n.nspname AS schema, c.relname AS table, a.attname AS column, format_type(a.atttypid,a.atttypmod) AS type, a.attnotnull AS required, pg_get_expr(d.adbin,d.adrelid) AS default FROM pg_attribute a JOIN pg_class c ON c.oid=a.attrelid JOIN pg_namespace n ON n.oid=c.relnamespace LEFT JOIN pg_attrdef d ON d.adrelid=c.oid AND d.adnum=a.attnum WHERE n.nspname IN ('public','drizzle') AND c.relkind='r' AND a.attnum>0 AND NOT a.attisdropped ORDER BY n.nspname,c.relname,a.attnum")).rows;
  const constraints = (await client.query("SELECT n.nspname AS schema, c.relname AS table, con.conname AS name, con.contype AS type, con.convalidated AS validated, pg_get_constraintdef(con.oid) AS definition FROM pg_constraint con JOIN pg_class c ON c.oid=con.conrelid JOIN pg_namespace n ON n.oid=c.relnamespace WHERE n.nspname IN ('public','drizzle') ORDER BY n.nspname,c.relname,con.conname")).rows;
  const sequences = [];
  for (const row of (await client.query("SELECT schemaname,sequencename FROM pg_sequences WHERE schemaname IN ('public','drizzle') ORDER BY schemaname,sequencename")).rows) {
    const { rows: [state] } = await client.query(`SELECT last_value::text, is_called FROM ${quote(row.schemaname)}.${quote(row.sequencename)}`);
    sequences.push({ name: `${row.schemaname}.${row.sequencename}`, ...state });
  }
  return { tables, schemaSha256: sha(JSON.stringify(schema)), constraintsSha256: sha(JSON.stringify(constraints)), constraintCount: constraints.length, invalidConstraints: constraints.filter((c: any) => !c.validated).length, sequences };
}
async function addFixtures() {
  const client = await source.connect();
  try {
    await client.query('BEGIN');
    const insertUser = async (role: string) => {
      const { rows: [u] } = await client.query('INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,$2,$3,$4,true,false) RETURNING id', [`restore-${suffix}-${role}@example.test`, 'unusable-restore-fixture', role, 'Synthetic restore fixture']); created.push(u.id); return u.id;
    };
    const candidate = await insertUser('candidate'), employer = await insertUser('employer');
    await client.query("INSERT INTO signal_candidate_profiles(user_id,professional_alias,verified_grade,verified_score,verified_skills,stack,consent_matching,contact_email,salary_min,salary_max,latest_assessment_at) VALUES($1,'Restore fixture','Middle',100,ARRAY['Python','SQL'],ARRAY['Python','SQL'],true,$2,180000,250000,now())", [candidate, `restore-${suffix}-candidate@example.test`]);
    await client.query("INSERT INTO signal_candidate_resumes(user_id,summary) VALUES($1,'Synthetic restoration check')", [candidate]);
    await client.query("INSERT INTO signal_consents(user_id,consent_type,version) VALUES($1,'terms','restore-synthetic-v1'),($1,'privacy','restore-synthetic-v1')", [candidate]);
    const { rows: [company] } = await client.query("INSERT INTO signal_companies(owner_user_id,name,contact_email) VALUES($1,'Restore test company',$2) RETURNING id", [employer, `restore-${suffix}-employer@example.test`]);
    const { rows: [need] } = await client.query("INSERT INTO signal_needs(company_id,title,specialization,grade,required_skills,description,work_format,salary_min,salary_max,salary_period,salary_type) VALUES($1,'Restore need','Backend / Python','Middle',ARRAY['Python','SQL'],'Synthetic local restore check','Удалённо',180000,250000,'month','gross') RETURNING id", [company.id]);
    const { rows: [attempt] } = await client.query("INSERT INTO signal_assessment_attempts(user_id,program_id,grade,status,cases,oracles,answers,score,verified,due_at,submitted_at) VALUES($1,'backend-python','Middle','submitted','[]','{}','[]',100,true,now()+interval '45 minutes',now()) RETURNING id", [candidate]);
    await client.query("INSERT INTO signal_assessment_contexts(attempt_id,snapshot) VALUES($1,$2)", [attempt.id, { source: 'synthetic_restore_fixture', purpose: 'Retain history, not a generated or human assessment result' }]);
    const invite = async () => (await client.query("INSERT INTO signal_invitations(need_id,company_id,candidate_user_id,title,message,reason,salary_min,salary_max,salary_period,salary_type,work_format,status) VALUES($1,$2,$3,'Restore offer','Synthetic restoration check','Synthetic history',180000,250000,'month','gross','Удалённо','accepted') RETURNING id", [need.id, company.id, candidate])).rows[0].id;
    const activeInvite = await invite(), revokedInvite = await invite();
    await client.query("INSERT INTO signal_contact_grants(invitation_id,candidate_user_id,company_id,revoked_at) VALUES($1,$2,$3,NULL),($4,$2,$3,now())", [activeInvite,candidate,company.id,revokedInvite]);
    const { rows: [job] } = await client.query("INSERT INTO signal_jobs(company_id,title,description,specialization,grade,skills,work_format,salary_min,salary_max,salary_period,salary_type,status) VALUES($1,'Restore job','Synthetic restoration check','Backend / Python','Middle',ARRAY['Python','SQL'],'Удалённо',180000,250000,'month','gross','published') RETURNING *", [company.id]);
    const jobSnapshot = { version: 1,title:job.title,companyName:'Restore test company',description:job.description,specialization:job.specialization,grade:job.grade,skills:job.skills,workFormat:job.work_format,salaryMin:job.salary_min,salaryMax:job.salary_max,salaryPeriod:job.salary_period,salaryType:job.salary_type };
    await client.query("INSERT INTO signal_applications(job_id,company_id,candidate_user_id,snapshot,status) VALUES($1,$2,$3,$4,'shortlisted')",[job.id,company.id,candidate,jobSnapshot]);
    const { rows: [template] } = await client.query("INSERT INTO signal_micro_templates(company_id,title,competency,scenario,expected_minutes,rubric) VALUES($1,'Restore practice','SQL','Synthetic educational task',15,$2) RETURNING id", [company.id,JSON.stringify([{id:'reasoning',label:'Reasoning',maxPoints:10}])]);
    await client.query('INSERT INTO signal_micro_preferences(candidate_user_id,enabled) VALUES($1,true)', [candidate]);
    const { rows: [subscription] } = await client.query("INSERT INTO signal_micro_subscriptions(template_id,candidate_user_id,active,next_due_at,last_offered_at) VALUES($1,$2,true,now()+interval '7 days',now()) RETURNING id", [template.id,candidate]);
    await client.query("INSERT INTO signal_micro_offers(subscription_id,company_id,candidate_user_id,snapshot,status,due_at,scheduled_for) VALUES($1,$2,$3,$4,'offered',now()+interval '3 days',now())", [subscription.id,company.id,candidate,{title:'Restore practice',competency:'SQL',scenario:'Synthetic educational task',expectedMinutes:15,rubric:[{id:'reasoning',label:'Reasoning',maxPoints:10}],version:1,companyName:'Restore test company',limits:'Synthetic'}]);
    await client.query('COMMIT');
    return { candidate, employer, companyId:company.id, needId:need.id, attemptId:attempt.id, activeInvite, revokedInvite, jobId:job.id, subscriptionId:subscription.id };
  } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
}
try {
  report.originalWorkingData = await snapshot(source);
  report.functionalSourceHashes=Object.fromEntries(await Promise.all(['artifacts/api-server/src/app.ts','artifacts/api-server/src/routes/signal-profile-assessments.ts','artifacts/api-server/src/routes/signal-invitations.ts','artifacts/api-server/src/routes/signal-microtasks.ts','artifacts/api-server/src/routes/signal-jobs.ts'].map(async filename=>[filename,sha(await readFile(filename))])));
  const fixtures = await addFixtures();
  await writeFile(`${privateDirectory}/restore-fixture-${suffix}.json`, JSON.stringify({ createdUserIds: created, database, cleanup:'pending' }, null,2));
  const container = (await run('docker',['compose','ps','-q','db'])).stdout.trim(); assert.ok(container);
  report.postgresImage = (await run('docker',['inspect','--format','{{.Image}}',container])).stdout.trim();
  snapshotClient = await source.connect(); await snapshotClient.query('BEGIN ISOLATION LEVEL REPEATABLE READ READ ONLY');
  const snapshotId = (await snapshotClient.query('SELECT pg_export_snapshot() AS snapshot')).rows[0].snapshot;
  report.source = await snapshot(snapshotClient);
  const startDump = performance.now();
  await run('docker',['exec',container,'pg_dump','-U','signal','-d','signal','--format=custom',`--snapshot=${snapshotId}`,`--file=${containerDump}`],{timeout:120000});
  await run('docker',['cp',`${container}:${containerDump}`,dumpPath],{timeout:60000});
  report.timingsSeconds.dump = (performance.now()-startDump)/1000;
  await snapshotClient.query('COMMIT'); snapshotClient.release(); snapshotClient = undefined;
  const dump = await readFile(dumpPath); report.backup = { bytes:dump.length, sha256:sha(dump), location:'outputs/local-backup (private, excluded from source/submission packages)' };
  await run('docker',['exec',container,'createdb','-U','signal',database]); testCreated = true;
  const startRestore = performance.now();
  await run('docker',['exec',container,'pg_restore','--exit-on-error','--no-owner','-U','signal','-d',database,containerDump],{timeout:120000});
  report.timingsSeconds.restore = (performance.now()-startRestore)/1000;
  const restoredUrl = new URL(sourceUrl); restoredUrl.pathname = `/${database}`;
  restored = new Pool({connectionString:restoredUrl.toString()});
  report.restored = await snapshot(restored);
  assert.deepEqual(report.restored,report.source,'Schema, row digests/counts, constraints, sequence state and migration rows must match');
  assert.equal(report.restored.invalidConstraints,0); checks.push('Complete snapshot equality: every public/drizzle table, schema, constraints, migrations and sequence state');
  for (const name of ['signal_assessment_attempts','signal_consents','signal_contact_grants','signal_invitations','signal_jobs','signal_applications','signal_micro_subscriptions','signal_micro_offers']) assert.ok(report.source.tables.find((t:any)=>t.table===`public.${name}`)?.rows>0,name);
  const grants = (await restored.query('SELECT revoked_at IS NULL AS active, count(*)::int AS count FROM signal_contact_grants WHERE candidate_user_id=$1 GROUP BY revoked_at IS NULL ORDER BY active',[fixtures.candidate])).rows;
  assert.deepEqual(grants,[{active:false,count:1},{active:true,count:1}]);
  const due = (await restored.query('SELECT next_due_at > now() AS future, active FROM signal_micro_subscriptions WHERE id=$1',[fixtures.subscriptionId])).rows[0]; assert.deepEqual(due,{future:true,active:true});
  checks.push('Non-empty attempt history, active/revoked consent bases, invitations, job/application snapshots and future schedule preserved');
  // Import app AFTER selecting restored DB. app.ts mounts routes; index.ts (mail/schedulers) is deliberately never imported.
  process.env.DATABASE_URL = restoredUrl.toString(); process.env.DEMO_MODE='false'; process.env.LOG_LEVEL='silent';
  delete process.env.SMTP_HOST; delete process.env.MAILPIT_URL;
  const { default: app } = await import('../artifacts/api-server/src/app.ts');
  apiPool = (await import('../lib/db/src/index.ts')).pool;
  httpServer=app.listen(0,'127.0.0.1'); await once(httpServer,'listening');
  const address=httpServer.address(); assert.ok(address&&typeof address!=='string'); const origin=`http://127.0.0.1:${address.port}`;
  const clients: Record<string,string>={};
  for (const [role,id] of [['candidate',fixtures.candidate],['employer',fixtures.employer]] as const) {
    const token=randomBytes(32).toString('base64url'); await restored.query('INSERT INTO signal_sessions(token_hash,user_id,demo_mode,expires_at) VALUES($1,$2,false,now()+interval \'1 hour\')',[sha(token),id]); clients[role]=`fsp_signal_session=${token}`;
  }
  async function api(role:string,path:string,method='GET',body?:unknown,expected=200) {
    const r=await fetch(`${origin}/api${path}`,{method,headers:{Cookie:clients[role]!,...(body===undefined?{}:{'Content-Type':'application/json'})},body:body===undefined?undefined:JSON.stringify(body),signal:AbortSignal.timeout(15000)});
    assert.equal(r.status,expected,`${role} ${method} ${path}`); return r.headers.get('content-type')?.includes('application/pdf')?await r.arrayBuffer():await r.json() as any;
  }
  assert.equal((await api('candidate','/me/candidate-profile')).userId,fixtures.candidate);
  assert.equal((await api('candidate','/assessments/history')).attempts.some((a:any)=>a.id===fixtures.attemptId),true);
  assert.ok((await api('candidate','/me/resume/pdf')).byteLength>1000);
  assert.ok((await api('employer','/employer/needs')).some((n:any)=>n.id===fixtures.needId));
  await api('candidate','/employer/needs','GET',undefined,403); await api('employer','/me/candidate-profile','GET',undefined,403);
  const contact=await api('employer',`/employer/invitations/${fixtures.activeInvite}/contacts`); assert.ok(JSON.stringify(contact).includes(`restore-${suffix}-candidate@example.test`));
  await api('candidate',`/me/invitations/${fixtures.activeInvite}/revoke-contact`,'POST');
  const closed=await api('employer',`/employer/invitations/${fixtures.activeInvite}/contacts`,'GET',undefined,403); assert.ok(!JSON.stringify(closed).includes(`restore-${suffix}-candidate@example.test`));
  const tasks=await api('candidate','/me/microtasks'); assert.ok(tasks.offers.some((o:any)=>o.subscriptionId===fixtures.subscriptionId));
  await api('candidate',`/me/microtasks/subscriptions/${fixtures.subscriptionId}`,'POST',{active:false});
  assert.equal((await restored.query('SELECT active FROM signal_micro_subscriptions WHERE id=$1',[fixtures.subscriptionId])).rows[0].active,false);
  checks.push('Restored HTTP roles: own profile/history/PDF/needs, cross-role denial, addressed contact/revocation and scheduled-task opt-out');
  report.passed=true;
} catch(error) { report.failure=error instanceof Error?error.message:String(error); process.exitCode=1;
} finally {
  if(httpServer)await new Promise<void>(resolve=>httpServer.close(()=>resolve()));
  if(apiPool)await apiPool.end(); if(restored)await restored.end();
  if(snapshotClient){await snapshotClient.query('ROLLBACK').catch(()=>{});snapshotClient.release();}
  try {
    if(testCreated){const container=(await run('docker',['compose','ps','-q','db'])).stdout.trim();await run('docker',['exec',container,'dropdb','-U','signal',database]);assert.equal((await source.query('SELECT count(*)::int AS n FROM pg_database WHERE datname=$1',[database])).rows[0].n,0);}
    if(created.length)await source.query('DELETE FROM signal_users WHERE id=ANY($1::int[]) AND email LIKE $2',[created,`restore-${suffix}-%@example.test`]);
    assert.equal((await source.query('SELECT count(*)::int AS n FROM signal_users WHERE id=ANY($1::int[])',[created])).rows[0].n,0);
    const afterWorkingData = await snapshot(source);
    report.workingDataPreserved=JSON.stringify(report.originalWorkingData.tables)===JSON.stringify(afterWorkingData.tables)&&report.originalWorkingData.schemaSha256===afterWorkingData.schemaSha256&&report.originalWorkingData.constraintsSha256===afterWorkingData.constraintsSha256;
    report.workingSequencePolicy='Synthetic inserts consume sequence values; sequences are not reset in the working DB. Existing rows/schema/constraints must be unchanged.';
    assert.equal(report.workingDataPreserved,true,'Working rows, schema and constraints must equal baseline after scoped cleanup');
    const container=(await run('docker',['compose','ps','-q','db'])).stdout.trim();if(container)await run('docker',['exec',container,'rm','-f',containerDump]);
    report.cleanup='complete';
    await writeFile(`${privateDirectory}/restore-fixture-${suffix}.json`,JSON.stringify({createdUserIds:created,database,cleanup:'complete'},null,2));
  }catch(error){report.cleanup='failed';report.cleanupFailure=error instanceof Error?error.message:String(error);report.passed=false;process.exitCode=1;}
  await source.end(); report.completedAt=new Date().toISOString();report.scriptSha256=sha(await readFile('scripts/backup-restore-check.ts'));
  await writeFile(`${reportDirectory}/backup-restore-${suffix}.json`,JSON.stringify(report,null,2));await writeFile(`${reportDirectory}/backup-restore.json`,JSON.stringify(report,null,2));
  console.log(JSON.stringify({passed:report.passed,cleanup:report.cleanup,checks:report.checks,failure:report.failure,timingsSeconds:report.timingsSeconds},null,2));
}

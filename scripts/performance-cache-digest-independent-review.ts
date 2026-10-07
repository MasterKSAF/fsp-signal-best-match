/** Independent, small SQL controls. Mutates ONLY the previously owned isolated
 * migration-check DB. 0008 persists there; every synthetic write is rolled back. */
import assert from 'node:assert/strict';
import { createHash, randomUUID } from 'node:crypto';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { createRequire } from 'node:module';
import { readFile, writeFile, mkdir } from 'node:fs/promises';

const run=promisify(execFile), requireDb=createRequire(new URL('../lib/db/package.json',import.meta.url));
const {Pool}=requireDb('pg'), {PgDialect}=requireDb('drizzle-orm/pg-core');
const container='signal-qa-cycle-01-db-1', database='signal_resume_migration_check';
const output='outputs/verification/assessment-purpose/performance-cache-digest-independent-review.json';
const sha=(value:string|Buffer)=>createHash('sha256').update(value).digest('hex');
const info=JSON.parse((await run('docker',['inspect',container])).stdout)[0];
assert.equal(info.Name,'/'+container);
assert.ok(info.NetworkSettings.Ports['5432/tcp'].some((p:any)=>p.HostIp==='127.0.0.1'&&p.HostPort==='55435'));
const env=new Map<string,string>(info.Config.Env.map((v:string)=>{const at=v.indexOf('=');return[v.slice(0,at),v.slice(at+1)];}));
assert.ok(env.get('POSTGRES_USER')&&env.get('POSTGRES_PASSWORD'));
const url=new URL(`postgresql://${encodeURIComponent(env.get('POSTGRES_USER')!)}:${encodeURIComponent(env.get('POSTGRES_PASSWORD')!)}@127.0.0.1:55435/${database}`);
assert.equal(url.pathname,'/'+database);assert.equal(url.hostname,'127.0.0.1');assert.equal(url.port,'55435');
const original=JSON.parse(await readFile('outputs/verification/multi-resume/migration-check-2026-10-06.json','utf8'));
assert.equal(original.status,'PASS');assert.equal(original.database,database);assert.equal(original.container,container);
const target=new Pool({connectionString:url.href,max:1});
const client=await target.connect();let appPool:any;let transaction=false;
const checks:string[]=[];
const report:any={status:'FAIL',startedAt:new Date().toISOString(),database,container,checks,scope:'Independent small actual SQL controls. Only owned migration-check DB; no live/stage/load/API/restore. Full0008 persists here; synthetic rows and temporary0007 prerequisite roll back; PostgreSQL sequences may advance. Reports contain counts/hashes/field names only.',reportContainsRowsOrContacts:false};
async function guard(){assert.equal((await client.query('SELECT current_database() name')).rows[0].name,database);}
async function allHashes(){
  const result:Record<string,unknown>={};
  for(const {tablename}of(await client.query("SELECT tablename FROM pg_tables WHERE schemaname='public' ORDER BY tablename")).rows){
    assert.match(tablename,/^[a-z_]+$/);
    const row=(await client.query(`SELECT count(*)::int count,encode(sha256(convert_to(coalesce(string_agg(encode(sha256(convert_to((to_jsonb(t)-'pool_content_digest')::text,'UTF8')),'hex'),'' ORDER BY idhash),''),'UTF8')),'hex') digest FROM (SELECT x.*,encode(sha256(convert_to((to_jsonb(x)-'pool_content_digest')::text,'UTF8')),'hex') idhash FROM "${tablename}" x) t`)).rows[0];
    result[tablename]=row;
  }
  return result;
}
async function checkpoint(name:string,action:()=>Promise<void>){await client.query('SAVEPOINT independent_control');try{await action();checks.push(name);}finally{await client.query('ROLLBACK TO SAVEPOINT independent_control');await client.query('RELEASE SAVEPOINT independent_control');}}
try{
  await guard();const before=await allHashes();
  const migration=await readFile('lib/db/migrations/0008_resume_pool_digest.sql','utf8');
  report.migrationSha256=sha(migration);
  await client.query('BEGIN');transaction=true;await guard();await client.query(migration);await client.query('COMMIT');transaction=false;
  assert.deepEqual(await allHashes(),before,'0008 must preserve all business fields, identities, history and tombstones');
  const backfill=(await client.query('SELECT count(*)::int rows,count(*) FILTER(WHERE octet_length(pool_content_digest)=32 AND pool_content_digest=signal_resume_pool_content_digest(r))::int signed,count(*) FILTER(WHERE deleted_at IS NOT NULL)::int soft_deleted FROM signal_candidate_resumes r')).rows[0];
  assert.ok(backfill.rows>0);assert.equal(backfill.rows,backfill.signed);report.backfill=backfill;
  checks.push('0008 actual backfill signs every existing retained row and preserves all public-table business hashes/counts; tombstone count reported explicitly');
  const once=await client.query("SELECT id,encode(pool_content_digest,'hex') digest FROM signal_candidate_resumes ORDER BY id");
  await client.query('BEGIN');transaction=true;await client.query(migration);await client.query('COMMIT');transaction=false;
  assert.deepEqual((await client.query("SELECT id,encode(pool_content_digest,'hex') digest FROM signal_candidate_resumes ORDER BY id")).rows,once.rows);
  assert.deepEqual(await allHashes(),before);checks.push('Second full0008 execution preserves business hashes and every previously signed row');
  await client.query('BEGIN');transaction=true;await guard();
  // This prior migration-check DB predates reviewer scope. The prerequisite is
  // temporary solely for testing the CURRENT production fingerprint expression.
  await client.query(await readFile('lib/db/migrations/0007_reviewer_scope.sql','utf8'));
  const nonce=randomUUID(), ids:number[]=[];
  for(let i=0;i<2;i++)ids.push((await client.query("INSERT INTO signal_users(email,password_hash,role,display_name,email_verified,demo_mode) VALUES($1,'unusable-digest-fixture','candidate',$2,true,false) RETURNING id",[`digest-${nonce}-${i}@example.test`,'Synthetic digest '+i])).rows[0].id);
  for(const id of ids)await client.query("INSERT INTO signal_candidate_profiles(user_id,professional_alias,specialization,avatar_data_url) VALUES($1,'Synthetic alias','Backend / Python','data:image/png;base64,fixture-presence-only')",[id]);
  const resumeId=(await client.query("INSERT INTO signal_candidate_resumes(user_id,title,visibility,consent_matching,consent_catalog,verified_grade,verified_score,verified_grade_changed_at,latest_assessment_at,created_at,updated_at) VALUES($1,'Synthetic digest résumé','public',true,true,'Junior',77,'2026-10-01T00:00:00.000001Z','2026-10-01T00:00:00.000001Z','2026-10-01T00:00:00.000001Z','2026-10-01T00:00:00.000001Z') RETURNING id",[ids[0]])).rows[0].id;
  const digest=async(id=resumeId)=>(await client.query("SELECT encode(pool_content_digest,'hex') digest FROM signal_candidate_resumes WHERE id=$1",[id])).rows[0].digest as string;
  const baseDigest=await digest();assert.equal(baseDigest.length,64);
  await checkpoint('Backfill repairs both unsigned legacy live row and tombstone without changing business fields or resurrecting the tombstone',async()=>{
    const tombstoneId=(await client.query("INSERT INTO signal_candidate_resumes(user_id,title,deleted_at) VALUES($1,'Synthetic legacy tombstone','2026-10-01T01:00:00.000001Z') RETURNING id",[ids[0]])).rows[0].id;
    const businesses=await allHashes(), signedLive=await digest(), signedTombstone=await digest(tombstoneId);
    // Isolated administrator setup emulates old/corrupt pre-backfill records.
    // Ordinary UPDATE tampering is checked separately with the trigger enabled.
    await client.query('ALTER TABLE signal_candidate_resumes DISABLE TRIGGER signal_resume_pool_content_digest_guard');
    await client.query("UPDATE signal_candidate_resumes SET pool_content_digest=decode(repeat('ff',32),'hex') WHERE id=ANY($1::int[])",[[resumeId,tombstoneId]]);
    await client.query('ALTER TABLE signal_candidate_resumes ENABLE TRIGGER signal_resume_pool_content_digest_guard');
    assert.notEqual(await digest(),signedLive);assert.notEqual(await digest(tombstoneId),signedTombstone);
    await client.query(migration);
    assert.equal(await digest(),signedLive);assert.equal(await digest(tombstoneId),signedTombstone);
    assert.deepEqual(await allHashes(),businesses);
    assert.equal((await client.query('SELECT deleted_at IS NOT NULL deleted FROM signal_candidate_resumes WHERE id=$1',[tombstoneId])).rows[0].deleted,true);
  });
  const columns=(await client.query("SELECT column_name,data_type FROM information_schema.columns WHERE table_schema='public' AND table_name='signal_candidate_resumes' ORDER BY ordinal_position")).rows;
  const mutated:string[]=[];
  for(const {column_name:column,data_type:type}of columns){
    if(column==='pool_content_digest')continue;
    assert.match(column,/^[a-z_]+$/);let expression:string,params:any[]=[resumeId];
    if(column==='id')expression='id+1000000000';
    else if(column==='user_id'){expression='$2';params.push(ids[1]);}
    else if(type==='boolean')expression=`NOT "${column}"`;
    else if(type==='integer')expression=`coalesce("${column}",0)+1`;
    else if(type==='timestamp with time zone')expression=`coalesce("${column}",'2026-10-01T00:00:00Z'::timestamptz)+interval '1 microsecond'`;
    else if(type==='ARRAY')expression=`array_append("${column}",'independent-digest-test')`;
    else if(type==='jsonb')expression=`jsonb_build_object('independent',true,'prior',"${column}")`;
    else if(type==='text'){expression='$2';params.push(({assumed_grade:'Middle',verified_grade:'Middle',salary_period:'year',salary_type:'net',visibility:'pseudonymous'}as Record<string,string>)[column]??'independent-digest-test');}
    else throw Error('Unreviewed database field type '+type);
    await checkpoint(`Digest changes for direct ${column} update without requiring revision change`,async()=>{
      await client.query(`UPDATE signal_candidate_resumes SET "${column}"=${expression} WHERE id=$1`,params);
      assert.notEqual(await digest(column==='id'?resumeId+1000000000:resumeId),baseDigest,column);
      if(column!=='revision')assert.equal((await client.query('SELECT revision FROM signal_candidate_resumes WHERE id=$1',[column==='id'?resumeId+1000000000:resumeId])).rows[0].revision,1);
    });mutated.push(column);
  }
  report.coveredResumeColumns=mutated;
  await checkpoint('Explicit digest override cannot alter signed value, and no-op updates retain exact content signature',async()=>{
    await client.query("UPDATE signal_candidate_resumes SET pool_content_digest=decode(repeat('ff',32),'hex') WHERE id=$1",[resumeId]);assert.equal(await digest(),baseDigest);
    await client.query('UPDATE signal_candidate_resumes SET pool_content_digest=NULL,revision=revision WHERE id=$1',[resumeId]);assert.equal(await digest(),baseDigest);
  });
  await checkpoint('Identical instant has invariant signature across UTC/Tokyo/Los_Angeles and DateStyle; one microsecond changes it',async()=>{
    for(const zone of ['UTC','Asia/Tokyo','America/Los_Angeles']){
      await client.query("SELECT set_config('TimeZone',$1,true)",[zone]);await client.query("SET LOCAL DateStyle='SQL, DMY'");
      await client.query('UPDATE signal_candidate_resumes SET title=title WHERE id=$1',[resumeId]);assert.equal(await digest(),baseDigest);
    }
  });
  process.env.DATABASE_URL=url.href;
  const {resumePoolFingerprintExpression}=await import('../artifacts/api-server/src/lib/signal-resume-matching.ts');
  const dbModule=await import('../lib/db/src/index.ts');appPool=dbModule.pool;
  const compiled=new PgDialect().sqlToQuery(resumePoolFingerprintExpression());assert.equal(compiled.params.length,0);
  const poolFingerprint=async()=>(await client.query(`SELECT ${compiled.sql} digest,count(*)::int count FROM signal_candidate_resumes INNER JOIN signal_users ON signal_users.id=signal_candidate_resumes.user_id INNER JOIN signal_candidate_profiles ON signal_candidate_profiles.user_id=signal_candidate_resumes.user_id WHERE signal_candidate_resumes.id=$1 AND signal_users.role='candidate' AND NOT signal_users.demo_mode AND signal_users.review_scope_id IS NULL AND signal_candidate_resumes.deleted_at IS NULL AND signal_candidate_resumes.visibility<>'private' AND signal_candidate_resumes.consent_catalog`,[resumeId])).rows[0];
  const basePool=await poolFingerprint();assert.equal(basePool.count,1);
  for(const [name,query]of[
    ['alias',"UPDATE signal_candidate_profiles SET professional_alias='Changed current alias' WHERE user_id=$1"],
    ['FSP history','UPDATE signal_candidate_profiles SET has_fsp_history=true WHERE user_id=$1'],
    ['public identity',"UPDATE signal_users SET display_name='Changed current public name' WHERE id=$1"],
    ['accessible photo presence',"UPDATE signal_candidate_profiles SET avatar_data_url='' WHERE user_id=$1"],
  ])await checkpoint('Fresh joined '+name+' changes fingerprint without résumé update',async()=>{await client.query(query,[ids[0]]);assert.equal(await digest(),baseDigest);assert.notEqual((await poolFingerprint()).digest,basePool.digest);});
  await checkpoint('Replacing nonempty photo bytes leaves presence digest unchanged; photo bytes are outside cached pool',async()=>{await client.query("UPDATE signal_candidate_profiles SET avatar_data_url='data:image/png;base64,different-presence-only' WHERE user_id=$1",[ids[0]]);assert.deepEqual(await poolFingerprint(),basePool);});
  for(const [name,query,param]of[
    ['catalogue consent','UPDATE signal_candidate_resumes SET consent_catalog=false WHERE id=$1',resumeId],
    ['private visibility',"UPDATE signal_candidate_resumes SET visibility='private' WHERE id=$1",resumeId],
    ['deleted résumé','UPDATE signal_candidate_resumes SET deleted_at=now() WHERE id=$1',resumeId],
    ['candidate role',"UPDATE signal_users SET role='employer' WHERE id=$1",ids[0]],
    ['reviewer cohort',"UPDATE signal_users SET demo_mode=true,review_scope_id='c3d6e1a8-777d-4198-9ab3-9798a858634d' WHERE id=$1",ids[0]],
  ]as const)await checkpoint('Live SQL excludes '+name+' even with an existing warm identity',async()=>{await client.query(query,[param]);const value=await poolFingerprint();assert.equal(value.count,0);assert.notEqual(value.digest,basePool.digest);});
  await client.query('ROLLBACK');transaction=false;
  assert.deepEqual(await allHashes(),before);report.syntheticWritesRolledBack=true;
  report.status='PASS';
}catch(error:any){report.failure=error instanceof assert.AssertionError?error.message:'Independent SQL control failed; private values suppressed';throw error;}
finally{
  if(transaction)await client.query('ROLLBACK');client.release();await target.end();if(appPool)await appPool.end();
  report.finishedAt=new Date().toISOString();report.sourceHashes=Object.fromEntries(await Promise.all(['lib/db/migrations/0008_resume_pool_digest.sql','artifacts/api-server/src/lib/signal-resume-matching.ts','artifacts/api-server/src/lib/signal-fresh-pool-cache.ts','scripts/performance-cache-digest-independent-review.ts'].map(async path=>[path,sha(await readFile(path))])));
  await mkdir('outputs/verification/assessment-purpose/history',{recursive:true});
  try{const previous=await readFile(output);await writeFile(`outputs/verification/assessment-purpose/history/cache-digest-${sha(previous).slice(0,12)}.json`,previous,{flag:'wx'});}catch(error:any){if(!['ENOENT','EEXIST'].includes(error.code))throw error;}
  await writeFile(output,JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,groups:checks.length,database,report:output}));
}

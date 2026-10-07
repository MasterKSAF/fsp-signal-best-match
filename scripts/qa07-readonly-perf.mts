/** Diagnostic only: artificial SELECT workload, never live routes/fixtures/mutations. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { assembleManagedAttempt } from '../artifacts/api-server/src/lib/assessment-managed.ts';
import { assessmentRubricKey } from '../artifacts/api-server/src/lib/assessment-ranking-evidence.ts';
import { withAssessmentRankingEvidence } from '../artifacts/api-server/src/lib/assessment-ranking-evidence.ts';
import { PgDialect } from 'drizzle-orm/pg-core';

const target = new URL(process.env.DATABASE_URL || '');
assert.ok(['127.0.0.1','localhost'].includes(target.hostname) && target.port==='55433' && target.pathname==='/signal','Read-only diagnosis uses named working local DB only');
const { pool } = await import('../lib/db/src/index.ts');
const connection = await pool.connect();
const rows = Array.from({length:1000},(_,n)=>{
  const program=n%4===0||n%40===9?'frontend-typescript':'backend-python',grade=n%10===9?'Junior':n%10>=7?'Senior':'Middle';
  const form=assembleManagedAttempt(program,grade,`signal-scale-2026-10-06-v1:${n}`,{contextId:program==='backend-python'?'api-platform':'frontend-product'});
  return {program,grade,oracles:form.oracles};
});
const json=JSON.stringify(rows.map(row=>row.oracles));
const projection="CASE WHEN jsonb_typeof(value)='object' THEN coalesce((SELECT jsonb_object_agg(entry.key,jsonb_build_object('blueprint',entry.value->'blueprint')) FROM jsonb_each(value) entry),'{}'::jsonb) ELSE value END";
let capturedProjection:unknown;
await withAssessmentRankingEvidence([{userId:1,verifiedGrade:'Middle',latestAssessmentAt:new Date(),specialization:'Backend / Python'}] as any,{
  select(columns:any){capturedProjection=columns.oracles;return{from(){return{where(){return Promise.resolve([]);}};}};},
} as any);
assert.ok(capturedProjection);
const rendered=new PgDialect().sqlToQuery(capturedProjection as any);
assert.equal(rendered.params.length,0);
assert.ok(rendered.sql.includes('"signal_assessment_attempts"."oracles"'));
const actualProjection=rendered.sql.replaceAll('"signal_assessment_attempts"."oracles"','value');
try {
  await connection.query('BEGIN READ ONLY');
  await connection.query("SET LOCAL statement_timeout='10s'");
  const full=await connection.query('SELECT value AS oracles FROM jsonb_array_elements($1::jsonb)',[json]);
  const projected=await connection.query(`SELECT ${projection} AS oracles FROM jsonb_array_elements($1::jsonb)`,[json]);
  const actual=await connection.query(`SELECT ${actualProjection} AS oracles FROM jsonb_array_elements($1::jsonb)`,[json]);
  assert.equal(full.rows.length,1000);assert.equal(projected.rows.length,1000);assert.equal(actual.rows.length,1000);
  for(let n=0;n<rows.length;n++){
    const row=rows[n]!;
    const first=Object.values(row.oracles)[0]!;
    const version=first.blueprint.version;
    assert.equal(assessmentRubricKey(full.rows[n]!.oracles,row.program,version,row.grade),assessmentRubricKey(projected.rows[n]!.oracles,row.program,version,row.grade));
    assert.deepEqual(Object.keys(full.rows[n]!.oracles),Object.keys(projected.rows[n]!.oracles));
    assert.equal(assessmentRubricKey(full.rows[n]!.oracles,row.program,version,row.grade),assessmentRubricKey(actual.rows[n]!.oracles,row.program,version,row.grade));
    assert.deepEqual(Object.keys(full.rows[n]!.oracles),Object.keys(actual.rows[n]!.oracles));
  }
  const mutated=Object.values(rows[0]!.oracles).map(value=>({blueprint:value.blueprint}));
  const malformed=[{},null,[],42,'historical scalar',mutated,{'a':{blueprint:null}}, {'a':{blueprint:'scalar'}}, {'a':{blueprint:['array']}}, {'a':{blueprint:{family:'missing others'}}}];
  const malformedFull=await connection.query('SELECT value AS oracles FROM jsonb_array_elements($1::jsonb)',[JSON.stringify(malformed)]);
  const malformedProjected=await connection.query(`SELECT ${actualProjection} AS oracles FROM jsonb_array_elements($1::jsonb)`,[JSON.stringify(malformed)]);
  for(let n=0;n<malformed.length;n++){
    const original=malformedFull.rows[n]!.oracles,after=malformedProjected.rows[n]!.oracles;
    assert.equal(assessmentRubricKey(original,'frontend-typescript','signal-frontend-typescript-v2','Middle'),assessmentRubricKey(after,'frontend-typescript','signal-frontend-typescript-v2','Middle'));
    if(original&&typeof original==='object')assert.deepEqual(Object.keys(original),Object.keys(after));
    if(!original||typeof original!=='object'||Array.isArray(original))assert.deepEqual(after,original);
  }
  const measurements:Record<string,number[]>={full:[],projected:[],actualNineFieldProjection:[]};
  for(let n=0;n<6;n++)for(const mode of n%2?['actualNineFieldProjection','projected','full']:['full','projected','actualNineFieldProjection']){
    const start=performance.now();
    await connection.query(mode==='full'?'SELECT value AS oracles FROM jsonb_array_elements($1::jsonb)':`SELECT ${mode==='projected'?projection:actualProjection} AS oracles FROM jsonb_array_elements($1::jsonb)`,[json]);
    measurements[mode]!.push(performance.now()-start);
  }
  const indexes=await connection.query("SELECT tablename,indexname,indexdef FROM pg_indexes WHERE schemaname='public' AND tablename IN ('signal_assessment_attempts','signal_assessment_corrections','signal_candidate_profiles','signal_users') ORDER BY tablename,indexname");
  const statistics=await connection.query("SELECT relname,n_live_tup,n_dead_tup,last_autovacuum IS NOT NULL AS has_autovacuum FROM pg_stat_user_tables WHERE relname IN ('signal_assessment_attempts','signal_candidate_profiles') ORDER BY relname");
  const fullBytes=Buffer.byteLength(JSON.stringify(full.rows)),projectedBytes=Buffer.byteLength(JSON.stringify(projected.rows)),actualNineFieldBytes=Buffer.byteLength(JSON.stringify(actual.rows));
  const report={version:'signal-qa07-readonly-perf-v2',measuredAt:new Date().toISOString(),scope:'Artificial1000 generated oracle SELECT projection diagnostic on loopback PostgreSQL; not serving API latency, not actual load table query timing',readOnly:true,generatedRecords:1000,fixtureSeed:'signal-scale-2026-10-06-v1',sourceScriptSha256:createHash('sha256').update(await readFile('scripts/load-scale.ts')).digest('hex'),productionLoaderSha256:createHash('sha256').update(await readFile('artifacts/api-server/src/lib/assessment-ranking-evidence.ts')).digest('hex'),actualSqlCapturedFromProductionLoader:true,rubricHashesAndObjectKeysEquivalent:true,malformedShapesPreserved:true,malformedCaseCount:malformed.length,fullBytes,projectedBytes,reductionFraction:1-projectedBytes/fullBytes,actualNineFieldBytes,actualNineFieldReductionFraction:1-actualNineFieldBytes/fullBytes,selectRoundTripsMilliseconds:measurements,indexes:indexes.rows,postCleanupTableStatistics:statistics.rows,limitations:['Load fixtures were already exactly cleaned before this diagnostic; actual1000-row live query timings were not captured during load.','Synthetic CTE round-trip includes host/PG input JSON parsing, SQL projection, transfer and Node pg JSON decoding; not a calibrated isolated database benchmark.','App CPU samples exist, but DB CPU and per-stage route timers were not captured by unchanged historical/current load script.'],workingDatabaseMutated:false,rawOraclesAnswersOrContactRowsExported:false};
  const path='outputs/verification/qa07-readonly-perf.json';
  try{const old=await readFile(path);await writeFile(`outputs/verification/history/qa07-readonly-perf-${createHash('sha256').update(old).digest('hex').slice(0,12)}.json`,old);}catch(error){if((error as any).code!=='ENOENT')throw error;}
  await writeFile(path,JSON.stringify(report,null,2)+'\n');
  console.log(JSON.stringify({passed:true,generatedRecords:1000,malformedCaseCount:malformed.length,fullBytes,projectedBytes,actualNineFieldBytes,actualNineFieldReductionFraction:report.actualNineFieldReductionFraction,measurements,rubricHashesAndObjectKeysEquivalent:true,readOnly:true}));
  await connection.query('ROLLBACK');
} finally {connection.release();await pool.end();}

import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {writeFileSync} from 'node:fs';
import os from 'node:os';
import {performance} from 'node:perf_hooks';
import {pool} from '../lib/db/src/index';
import {assertOwnDatabase,qaUser} from './competitive-fixtures';
import {loadSelectionResumes,freshSelectionIds,freshSelectionIdentity} from '../artifacts/api-server/src/lib/employer-selection-service';
import {selectionCandidate} from '../artifacts/api-server/src/lib/employer-selection-query';
import {evaluateResumeCandidates} from '../artifacts/api-server/src/lib/signal-resume-evaluation';
import {selectMatchingResumes} from '../artifacts/api-server/src/lib/signal-resume-catalog';
import {rankMatches,MATCH_ALGORITHM_VERSION,type MatchNeed} from '../artifacts/api-server/src/lib/signal-matching';
assertOwnDatabase();process.env.DEMO_MODE='true';process.env.SIGNAL_SKILL_MODULES_ENABLED='true';
const scope={demoMode:true,reviewScopeId:null},at=new Date('2026-10-28T00:00:00Z'),checks:string[]=[];
const definition={version:'selection-measurement-v1',people:16,extraCvs:4,closedConsentIndices:[13],privateIndices:[14],blockedIndices:[15],salaryUnknownModulo:3,remoteModulo:2,pages:[1,2,3],pageSize:4,contexts:['declared-python','hard-senior-python'],fixedTime:at.toISOString()};
const measurements:any[]=[];
let queryCount=0,queryMs=0,bytes=0,rowCount=0;
const originalQuery=pool.query;
try{
 const company=await qaUser('employer'),ids:number[]=[],people:number[]=[];
 for(let i=0;i<16;i++){
  const u=await qaUser();people.push(u.id);ids.push(u.resumeId!);
  await pool.query(`UPDATE signal_candidate_resumes SET specialization='Backend / Python',assumed_grade='Junior',stack=ARRAY['Python'],skills=ARRAY['Python'],work_format=$2,salary_min=$3,salary_max=$4,salary_period=$5,salary_type=$6,consent_matching=$7,visibility=$8 WHERE id=$1`,[u.resumeId,i%2?'Офис':'Удалённо',i%3?100000:null,i%3?150000:null,'month','gross',i!==13,i===14?'private':'pseudonymous']);
  if(i<4)ids.push((await pool.query(`INSERT INTO signal_candidate_resumes(user_id,title,specialization,assumed_grade,stack,skills,visibility,consent_matching,consent_catalog,work_format) VALUES($1,'Second Python CV','Backend / Python','Junior',ARRAY['Python'],ARRAY['Python'],'pseudonymous',true,true,'Удалённо') RETURNING id`,[u.id])).rows[0].id);
 }
 await pool.query(`INSERT INTO signal_company_blocks(candidate_user_id,company_id,active) VALUES($1,$2,true)`,[people[15],company.companyId]);
 // Instrument real SQL promises, not the estimated number of service calls.
 (pool as any).query=function(...args:any[]){queryCount++;const start=performance.now();const out=(originalQuery as any).apply(pool,args);if(!out?.then)return out;return out.then((r:any)=>{queryMs+=performance.now()-start;rowCount+=r.rows?.length??0;bytes+=Buffer.byteLength(JSON.stringify(r.rows??[]));return r;});};
 const need:MatchNeed={specialization:'Backend / Python',grade:'Junior',gradeMode:'declared_or_verified',requiredSkills:['Python'],skillRequirements:[{skill:'Python',mode:'declared_or_verified'}],desirableSkills:['SQL'],workFormat:'Удалённо',salaryMin:90000,salaryMax:180000,salaryPeriod:'month',salaryType:'gross'};
 const strict:MatchNeed={...need,skillRequirements:[{skill:'Python',mode:'verified',level:'Senior'}]};
 const run=async(mode:'eager_projection'|'deferred_page_projection',context:MatchNeed,page:number)=>{
  const q=queryCount,t=queryMs,b=bytes,rc=rowCount;global.gc?.();const before=process.memoryUsage(),start=performance.now();
  const rows=await loadSelectionResumes(company.companyId!,scope,'matching',{resumeIds:ids});
  const evaluated=evaluateResumeCandidates(context,rows,true,at),ranked=rankMatches(selectMatchingResumes(evaluated.filter(e=>e.evaluation.eligible)));
  const offset=(page-1)*4;
  const project=(r:typeof ranked[number])=>selectionCandidate(r.candidate,r.alternatives,r.evaluation);
  const pageRows=ranked.slice(offset,offset+4),projected=mode==='eager_projection'?ranked.map(project).slice(offset,offset+4):pageRows.map(project);
  const fresh=await freshSelectionIds(company.companyId!,scope,'matching',pageRows.map(r=>r.candidate.resumeId));
  const result=projected.filter((_,i)=>!!freshSelectionIdentity(pageRows[i].candidate,fresh));
  const sample={mode,context:context===need?'declared':'strict',page,ms:performance.now()-start,sqlQueries:queryCount-q,sqlMs:queryMs-t,sqlJsonBytes:bytes-b,sqlRows:rowCount-rc,heapDelta:process.memoryUsage().heapUsed-before.heapUsed,rss:process.memoryUsage().rss};
  return {sample,result,ranked:ranked.map(r=>({id:r.candidate.userId,resumeId:r.candidate.resumeId,score:r.evaluation.ranking.businessFitScore,group:r.evaluation.ranking.groupId})),admission:evaluated.map(r=>({id:r.candidate.resumeId,eligible:r.evaluation.eligible,reasons:r.evaluation.ineligibilityReasons}))};
 };
 // First-use and warmed requests: DB/OS caches are never flushed on the shared machine.
 for(const context of [need,strict])for(const page of definition.pages)for(let repeat=0;repeat<7;repeat++){
  const modes=repeat%2?['deferred_page_projection','eager_projection'] as const:['eager_projection','deferred_page_projection'] as const;
  const a=await run(modes[0],context,page),b=await run(modes[1],context,page);assert.deepEqual(a.result,b.result);assert.deepEqual(a.ranked,b.ranked);assert.deepEqual(a.admission,b.admission);measurements.push({...a.sample,repeat,cache:repeat===0?'first_use_no_cache_flush':'warm'},{...b.sample,repeat,cache:repeat===0?'first_use_no_cache_flush':'warm'});
 }
 checks.push('84 sequential own-QA requests; equal exact CV, admission, scores, comparability order and complete public explanations across contexts and pages');
 const rows=await loadSelectionResumes(company.companyId!,scope,'matching',{resumeIds:ids});assert.ok(!rows.some(r=>[people[13],people[14],people[15]].includes(r.userId)));assert.equal((await run('deferred_page_projection',strict,1)).result.length,0);
 const stale=rows[0];await pool.query('UPDATE signal_candidate_resumes SET consent_matching=false,revision=revision+1 WHERE id=$1',[stale.resumeId]);const fresh=await freshSelectionIds(company.companyId!,scope,'matching',[stale.resumeId]);assert.equal(freshSelectionIdentity(stale,fresh),null);checks.push('private, closed consent and blocked fixtures excluded; required verified Senior not bypassed; revoke between ranking and page read removes stale exact CV');
 const mean=(v:number[])=>v.reduce((a,b)=>a+b,0)/v.length;
 const summary=Object.fromEntries(['eager_projection','deferred_page_projection'].map(mode=>{const m=measurements.filter(s=>s.mode===mode&&s.cache==='warm');return [mode,{requests:m.length,meanMs:mean(m.map(s=>s.ms)),meanSqlQueries:mean(m.map(s=>s.sqlQueries)),meanSqlMs:mean(m.map(s=>s.sqlMs)),meanSqlJsonBytes:mean(m.map(s=>s.sqlJsonBytes)),meanHeapDelta:mean(m.map(s=>s.heapDelta)),maxRss:Math.max(...m.map(s=>s.rss)),p95:null}];}));
 const report={status:'measured_no_production_adoption',synthetic:true,algorithm:MATCH_ALGORITHM_VERSION,definition,definitionHash:createHash('sha256').update(JSON.stringify(definition)).digest('hex'),fixtureIds:ids,hardware:{os:os.type(),release:os.release(),cpu:os.cpus()[0]?.model,logicalCpus:os.cpus().length,ram:os.totalmem(),node:process.version},flags:{skillModules:true},checks,summary,measurements,decision:'Projection-only prototype still performs full evaluation, SQL and sorting. Small QA timings do not justify a second production path or claim numeric/lazy acceleration. Keep existing implementation; no p95 claim from these few correlated repeats. Historical latency FAIL is unchanged.',at:new Date().toISOString()};
 writeFileSync('../selection-measurement.json',JSON.stringify(report,null,2));console.log(JSON.stringify({status:report.status,summary,checks},null,2));
}finally{pool.query=originalQuery;await pool.end();}

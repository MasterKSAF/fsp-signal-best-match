/** Independent small behavioral controls. Never opens a DB, API or runtime. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { FreshJsonPoolCache } from '../artifacts/api-server/src/lib/signal-fresh-pool-cache';
import { FreshRankingCache, freshRankingKey } from '../artifacts/api-server/src/lib/signal-fresh-ranking-cache';
import { readonlyResumeProjection } from '../artifacts/api-server/src/lib/signal-readonly-resume';
import type { CatalogResume } from '../artifacts/api-server/src/lib/signal-resume-catalog';
import type { SignalPoolScope } from '../artifacts/api-server/src/lib/signal-pool-scope';
import { evaluateMatch, rankMatches, type MatchEvaluation, type MatchNeed } from '../artifacts/api-server/src/lib/signal-matching';
import { selectMatchingResumes } from '../artifacts/api-server/src/lib/signal-resume-catalog';
const checks: string[]=[];
const deferred=<T>()=>{let resolve!:(value:T)=>void;const promise=new Promise<T>(r=>resolve=r);return{promise,resolve};};
{
  // A delayed earlier version must not be stored under the newer current key.
  const cache=new FreshJsonPoolCache<{id:number;skills:string[]}>();
  const old=deferred<{fingerprint:string;data:{id:number;skills:string[]}[]}>();
  const oldRead=cache.read('same-pool','before',()=>old.promise);
  const afterRead=cache.read('same-pool','after',async()=>({fingerprint:'after',data:[]}));
  // The current FIFO gate requires the earlier builder to finish before the
  // later generation can load. Earlier controls used parallel builders.
  old.resolve({fingerprint:'before',data:[{id:1,skills:['Python']}]});await oldRead;
  const after=await afterRead;
  assert.deepEqual(await cache.read('same-pool','after',async()=>{throw Error('New empty snapshot replaced by earlier response');}),after);
  checks.push('Out-of-order old load cannot replace the newer empty permitted pool under its fingerprint');
  const ownSnapshot=await cache.read('different-scope','preflight',async()=>({fingerprint:'actual-snapshot',data:[{id:2,skills:['SQL']}]}));
  assert.equal(cache.fingerprintFor(ownSnapshot),'actual-snapshot');
  assert.deepEqual(await cache.read('different-scope','actual-snapshot',async()=>{throw Error('Content-own fingerprint was not used');}),ownSnapshot);
  assert.throws(()=>ownSnapshot[0]!.skills.push('Injected'),TypeError);
  checks.push('Snapshot-own fingerprint is preserved after a preflight race; nested cached arrays resist mutation');
}
{
  // SQL B is already taken but its network result is delayed. A later request
  // has observed reverted A before it joins the first request's pending key.
  const cache=new FreshJsonPoolCache<number>(), snapshotB=deferred<{fingerprint:string;data:number[]}>();
  const first=cache.read('ABA-pool','A',()=>snapshotB.promise);
  let ownFreshReads=0;
  const second=cache.read('ABA-pool','A',async()=>{ownFreshReads++;return{fingerprint:'A',data:[1]};});
  snapshotB.resolve({fingerprint:'B',data:[2]});
  assert.deepEqual(await first,[2],'Original request may return its own later SQL snapshot B');
  assert.deepEqual(await second,[1],'Later fresh A request must not receive B taken before its preflight');
  assert.equal(ownFreshReads,1,'Fingerprint mismatch must issue the later caller own snapshot');
  checks.push('ABA pending: A preflight/B delayed snapshot/reverted A preflight requires own current A read, never joined B');
}
{
  const cache=new FreshJsonPoolCache<number>(1,1), blocked=Array.from({length:8},()=>deferred<{fingerprint:string;data:number[]}>());let active=0,peak=0;const started:number[]=[];
  const reads=blocked.map((gate,index)=>cache.read('scope-'+index,'same-fingerprint',async()=>{active++;peak=Math.max(peak,active);started.push(index);try{return await gate.promise;}finally{active--;}}));
  assert.deepEqual(started,[0]);assert.equal(cache.diagnostics().inflight,8);assert.equal(cache.diagnostics().waitingBuilders,7);
  blocked.forEach((gate,index)=>gate.resolve({fingerprint:'same-fingerprint',data:[index]}));
  assert.deepEqual(await Promise.all(reads),Array.from({length:8},(_,index)=>[index]));
  assert.deepEqual(started,[0,1,2,3,4,5,6,7]);assert.equal(peak,1);assert.equal(cache.diagnostics().entries,0);assert.equal(cache.diagnostics().waitingBuilders,0);
  checks.push('Eight pending callers preserve FIFO with one actual snapshot builder per cache; oversized returned results are outside retention');
}
{
  const need:MatchNeed={specialization:'Backend / Python',grade:'Middle',requiredSkills:['Python'],desirableSkills:[],workFormat:'Удалённо',salaryMin:100000,salaryMax:150000,salaryPeriod:'month',salaryType:'gross'};
  const scope={demoMode:false,reviewScopeId:null}, at=new Date('2026-10-06T12:00:00Z');
  const row=(id:number)=>({resumeId:id,userId:id,latestAssessmentAt:new Date(at),title:'current-'+id}) as CatalogResume;
  const original=[row(1),row(2)], current=[row(1),row(2)];
  const evaluation={ranking:{position:1,poolSize:1},factors:[{name:'retained',score:1,weight:1}]} as MatchEvaluation;
  const cache=new FreshRankingCache(), key=freshRankingKey(need,scope,new Map(),'pool-hash','current-evidence',original,at);
  cache.read(key,original,()=>[{candidate:original[0]!,evaluation,alternatives:original}]);
  const warm=cache.read(key,current,()=>{throw Error('Expected pure result reuse');});
  assert.equal(warm[0]!.candidate,current[0]);assert.equal(warm[0]!.alternatives[1],current[1]);
  assert.notEqual(warm[0]!.candidate.latestAssessmentAt,original[0]!.latestAssessmentAt);
  assert.equal(Reflect.set(warm[0]!.evaluation.factors[0]!,'score',0),false);
  const missing=cache.read(key,[current[1]!],()=>[]);assert.deepEqual(missing,[]);
  checks.push('Ranking reuse attaches fresh rows/Dates, freezes nested evaluation, and cannot return a missing selected ID');
  for(const boundary of [30,90,180]) {
    const before=new Date(at.getTime()+boundary*86400000-(boundary===180?1:0));
    const after=new Date(at.getTime()+boundary*86400000+(boundary===180?0:1));
    assert.notEqual(freshRankingKey(need,scope,new Map(),'pool-hash','current-evidence',original,before),freshRankingKey(need,scope,new Map(),'pool-hash','current-evidence',original,after));
  }
  assert.notEqual(freshRankingKey(need,scope,new Map(),'pool-hash','corrected-evidence',original,at),key);
  assert.notEqual(freshRankingKey(need,{demoMode:true,reviewScopeId:'34e12210-6475-4cef-8b23-e6c571832c54'},new Map(),'pool-hash','current-evidence',original,at),key);
  checks.push('Keys separate fresh correction/reviewer cohort and exact 30/90/180-day transitions');
}
{
  // Observe the actual matcher and the real composite ranking key; do not use
  // arbitrary "changed-key" strings to simulate privacy invalidation.
  const at=new Date('2026-10-06T12:00:00Z'),proofAt=new Date('2026-10-05T12:00:00Z');
  const need:MatchNeed={specialization:'Backend / Python',grade:'Junior',requiredSkills:['Python'],desirableSkills:[],workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross'};
  const scope:SignalPoolScope={demoMode:false,reviewScopeId:null},cache=new FreshRankingCache();
  const person:CatalogResume={userId:101,alias:'Synthetic independent facet',resumeId:1,resumeRevision:1,title:'Original title',specialization:'Backend / Python',verifiedGrade:'Middle',verifiedScore:100,verifiedSkills:['Python'],stack:['Python'],statedSkills:[],yearsExperience:3,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,salaryPeriod:'month',salaryType:'gross',latestAssessmentAt:proofAt,hasFspHistory:false,visibility:'pseudonymous',consentMatching:true,consentCatalog:true,readyForOffers:true,demoMode:false,deletedAt:null,legacyQualification:null,avatarDataUrl:null,publicName:null,assessmentEvidence:{attemptId:201,candidateId:101,programId:'backend-python',programVersion:'signal-backend-python-v6',grade:'Middle',score:100,submittedAt:proofAt.toISOString(),state:'verified',comparisonPolicy:'same-program-version-rubric-v1',rubricKey:'a'.repeat(64)}};
  const digest=(value:unknown)=>createHash('sha256').update(JSON.stringify(value)).digest('hex');
  let renders=0;
  const response=(rows:CatalogResume[],currentScope=scope)=>{
    const pool=digest(rows.map(({assessmentEvidence:_evidence,...publicFacts})=>publicFacts)),metadata=digest(rows.map(row=>row.assessmentEvidence));
    const key=freshRankingKey(need,currentScope,new Map(),pool,metadata,rows,at);
    const entries=cache.read(key,rows,()=>rows.map(candidate=>({candidate,evaluation:evaluateMatch(need,candidate,currentScope.demoMode,at),alternatives:[candidate]})).filter(row=>row.evaluation.eligible));
    return cache.serialize(entries,()=>{renders++;return JSON.stringify(entries.map(({candidate,evaluation})=>({resumeId:candidate.resumeId,title:candidate.title,score:evaluation.baseScore,evidenceDate:candidate.latestAssessmentAt?.toISOString()??null,ranking:evaluation.ranking})));});
  };
  const first=response([person]);assert.equal(JSON.parse(first)[0].title,'Original title');
  assert.equal(response([structuredClone(person)]),first);assert.equal(renders,1);
  const titled={...person,title:'Edited title',resumeRevision:2};assert.equal(JSON.parse(response([titled]))[0].title,'Edited title');assert.equal(renders,2);
  assert.equal(response([]),'[]','A current SQL pool with the résumé hidden cannot reuse its old nonempty DTO');
  const revoked={...person,assessmentEvidence:{...person.assessmentEvidence!,state:'revoked' as const}};
  assert.equal(response([revoked]),'[]','Fresh correction must remove an otherwise admitted real matching candidate');
  const beforeScope=renders;
  response([{...person,demoMode:true}],{demoMode:true,reviewScopeId:'ee417213-16c3-4d78-a74e-67e4268a0538'});
  assert.equal(renders,beforeScope+1,'Reviewer cohort cannot reuse a retained ordinary JSON facet');
  checks.push('Actual matcher + full composite keys keep warm JSON exact, refresh edited title, exclude current hidden/revoked rows and isolate reviewer cohort');
  const alternate={...person,resumeId:2,title:'Alternate whole resume',verifiedScore:80,assessmentEvidence:{...person.assessmentEvidence!,score:80}};
  const peer={...person,userId:102,resumeId:3,alias:'Other synthetic person',verifiedScore:90,assessmentEvidence:{...person.assessmentEvidence!,candidateId:102,attemptId:202,score:90}};
  const rows=[person,alternate,peer],winnerCache=new FreshRankingCache();
  const winnerPoolFingerprint=digest(rows.map(({assessmentEvidence:_evidence,...facts})=>facts));
  const winnerKey=freshRankingKey(need,scope,new Map(),winnerPoolFingerprint,digest(rows.map(row=>row.assessmentEvidence)),rows,at);
  const defaultEntries=winnerCache.read(winnerKey,rows,()=>rankMatches(selectMatchingResumes(rows.map(candidate=>({candidate,evaluation:evaluateMatch(need,candidate,false,at)})).filter(row=>row.evaluation.eligible))));
  assert.equal(defaultEntries.find(row=>row.candidate.userId===101)!.candidate.resumeId,1);
  const equivalent=winnerCache.readEquivalentDefault(winnerKey,rows,new Map([[101,1]]));assert.ok(equivalent);
  assert.deepEqual(equivalent,defaultEntries,'Selecting the actual default whole resume must preserve every ranking/alternative fact');
  const body=winnerCache.serialize(defaultEntries,()=>JSON.stringify(defaultEntries));
  assert.equal(winnerCache.serialize(equivalent,()=>{throw Error('Equivalent winners must reuse identical professional JSON');}),body);
  assert.equal(winnerCache.readEquivalentDefault(winnerKey,rows,new Map([[101,2]])),undefined,'A valid alternative is not the default winner');
  assert.equal(winnerCache.readEquivalentDefault(winnerKey,rows,new Map([[102,1]])),undefined,'Another person cannot request the first person winner');
  assert.equal(winnerCache.readEquivalentDefault(winnerKey,rows,new Map([[999,1]])),undefined);
  assert.equal(winnerCache.readEquivalentDefault(winnerKey,rows.filter(row=>row.resumeId!==1),new Map([[101,1]])),undefined,'Missing selected IDs must not be reattached');
  const correctedRows=rows.map(row=>row.resumeId===1?{...row,assessmentEvidence:{...row.assessmentEvidence!,state:'revoked' as const}}:row);
  assert.equal(winnerCache.readEquivalentDefault(freshRankingKey(need,scope,new Map(),winnerPoolFingerprint,digest(correctedRows.map(row=>row.assessmentEvidence)),correctedRows,at),correctedRows,new Map([[101,1]])),undefined,'A new current proof key cannot use the previous default computation');
  assert.equal(winnerCache.readEquivalentDefault(freshRankingKey(need,scope,new Map(),winnerPoolFingerprint,digest(rows.map(row=>row.assessmentEvidence)),rows,new Date('2026-11-04T12:00:00.001Z')),rows,new Map([[101,1]])),undefined,'Current age-band transition cannot borrow the old default result');
  checks.push('Actual matcher default-winner reuse preserves identical JSON/alternatives and rejects changed, foreign, absent, corrected or age-transition overrides');
}
{
  const sourceDate=new Date('2026-10-05T12:00:00.123Z'),expected=sourceDate.getTime();
  const view=readonlyResumeProjection({id:1,latestAssessmentAt:sourceDate,deletedAt:null,title:'Immutable current snapshot',stack:['Python'],legacyQualification:{skills:['SQL']}});
  const cache=new FreshJsonPoolCache<typeof view>();
  const first=await cache.read('readonly-pool','current-full-signature',async()=>({fingerprint:'current-full-signature',data:[view]}));
  Date.prototype.setTime.call(first[0]!.latestAssessmentAt,0);
  sourceDate.setUTCFullYear(1999);
  assert.equal(Reflect.set(first[0]!,'title','Caller injection'),false);
  assert.throws(()=>first[0]!.legacyQualification.skills.push('Caller injection'),TypeError);
  const second=await cache.read('readonly-pool','current-full-signature',async()=>{throw Error('Unchanged full signature should reuse the safe immutable snapshot');});
  assert.equal(second[0]!.latestAssessmentAt.getTime(),expected);
  assert.equal(JSON.parse(JSON.stringify(second))[0].latestAssessmentAt,new Date(expected).toISOString());
  assert.equal(second[0]!.title,'Immutable current snapshot');
  assert.notEqual(second[0]!.latestAssessmentAt,second[0]!.latestAssessmentAt);
  checks.push('Shared warm readonly snapshot survives caller Date.prototype setters, original source Date mutation and nested/field injection');
}
{
  // The allocation optimization shares accessors, but must never share a row's
  // timestamps with another row or turn a null date into the previous value.
  const aAt=new Date('2026-10-01T12:00:00.123Z'),bAt=new Date('2026-09-01T12:00:00.456Z');
  const rows=[readonlyResumeProjection({resumeId:1,latestAssessmentAt:aAt,deletedAt:null}),readonlyResumeProjection({resumeId:2,latestAssessmentAt:bAt,deletedAt:new Date('2026-10-02T12:00:00.789Z')}),readonlyResumeProjection({resumeId:3,latestAssessmentAt:null,deletedAt:null})];
  const cache=new FreshJsonPoolCache<(typeof rows)[number]>();
  await cache.read('shared-accessors','same-current-content',async()=>({fingerprint:'same-current-content',data:rows}));
  aAt.setTime(0);bAt.setTime(0);
  const warm=await cache.read('shared-accessors','same-current-content',async()=>{throw Error('Expected unchanged snapshot');});
  warm[0]!.latestAssessmentAt!.setUTCFullYear(2000);
  assert.equal(warm[1]!.latestAssessmentAt!.toISOString(),'2026-09-01T12:00:00.456Z');
  assert.equal(warm[0]!.latestAssessmentAt!.toISOString(),'2026-10-01T12:00:00.123Z');
  assert.equal(warm[1]!.deletedAt!.toISOString(),'2026-10-02T12:00:00.789Z');
  assert.equal(warm[2]!.latestAssessmentAt,null);assert.equal(warm[2]!.deletedAt,null);
  assert.deepEqual(JSON.parse(JSON.stringify(warm)),[{resumeId:1,latestAssessmentAt:'2026-10-01T12:00:00.123Z',deletedAt:null},{resumeId:2,latestAssessmentAt:'2026-09-01T12:00:00.456Z',deletedAt:'2026-10-02T12:00:00.789Z'},{resumeId:3,latestAssessmentAt:null,deletedAt:null}]);
  checks.push('Shared accessors keep two different rows and null timestamps separate after source/caller mutations, with exact public JSON');
}
{
  const cache=new FreshJsonPoolCache<number>(),block=deferred<{fingerprint:string;data:number[]}>();
  await cache.read('reviewer-A','currently-hidden',async()=>({fingerprint:'currently-hidden',data:[]}));
  const busy=cache.read('other-reviewer','busy',()=>block.promise);
  let current='earlier-visible',ownedStatements=0,loads=0;
  const queued=cache.read('reviewer-A','earlier-visible',async()=>{loads++;throw Error('Fresh hidden retained snapshot should be reusable');},async()=>{ownedStatements++;return current;});
  current='currently-hidden';assert.equal(ownedStatements,0);
  block.resolve({fingerprint:'busy',data:[90]});await busy;
  assert.deepEqual(await queued,[]);assert.equal(ownedStatements,1);assert.equal(loads,0);
  assert.deepEqual(await cache.read('reviewer-B','currently-hidden',async()=>({fingerprint:'currently-hidden',data:[12]})),[12]);
  checks.push('Queued caller checks its current complete fingerprint after waiting; retained hidden content is reused only in its own reviewer context');
}
{
  const cache=new FreshJsonPoolCache<number>(),block=deferred<{fingerprint:string;data:number[]}>();
  const first=cache.read('ABA-refresh','A',()=>block.promise);
  let statements=0;
  const later=cache.read('ABA-refresh','A',async()=>({fingerprint:'C',data:[3]}),async()=>{statements++;return'C';});
  block.resolve({fingerprint:'B',data:[2]});assert.deepEqual(await first,[2]);
  assert.deepEqual(await later,[3]);assert.equal(statements,1);
  checks.push('ABA mismatch owns a new current fingerprint statement and its own current snapshot, allowing later C without borrowing earlier B');
}
{
  const now=new Date('2026-10-06T12:00:00Z'),sourceAt=Object.freeze(new Date('2026-10-05T12:00:00Z'));
  const need:MatchNeed={specialization:'Backend / Python',grade:'Junior',requiredSkills:['Python'],desirableSkills:[],workFormat:'Удалённо',salaryMin:null,salaryMax:null,salaryPeriod:'month',salaryType:'gross'};
  const arbitrary=Object.freeze({resumeId:1,latestAssessmentAt:sourceAt}) as CatalogResume;
  const owned=readonlyResumeProjection({resumeId:1,latestAssessmentAt:sourceAt}) as CatalogResume;
  const key=(row:CatalogResume,at=now)=>freshRankingKey(need,{demoMode:false,reviewScopeId:null},new Map(),'same-full-pool','same-full-evidence',[row],at);
  const arbitraryBefore=key(arbitrary),ownedBefore=key(owned);
  Date.prototype.setTime.call(sourceAt,now.getTime()-200*86400000);
  assert.notEqual(key(arbitrary),arbitraryBefore,'Object.freeze(Date) must not opt an arbitrary row into immutable timestamp reuse');
  assert.equal(key(owned),ownedBefore,'Factory-owned snapshot retains its captured timestamp');
  assert.notEqual(key(owned,new Date(Date.parse('2026-11-04T12:00:00.001Z'))),ownedBefore,'Owned primitive timestamps must still evaluate the current age boundary');
  checks.push('Fresh age keys observe mutated arbitrary frozen Dates, preserve factory-owned scalars and reevaluate owned 30-day boundaries');
}
const files=['artifacts/api-server/src/lib/signal-resume-matching.ts','artifacts/api-server/src/lib/signal-fresh-pool-cache.ts','artifacts/api-server/src/lib/signal-fresh-ranking-cache.ts','artifacts/api-server/src/lib/signal-resume-evaluation.ts','artifacts/api-server/src/lib/assessment-ranking-evidence.ts','artifacts/api-server/src/lib/signal-readonly-resume.ts','scripts/performance-cache-independent-review.ts'];
const sourceHashes=Object.fromEntries(await Promise.all(files.map(async path=>[path,createHash('sha256').update(await readFile(path)).digest('hex')])));
const report={passed:true,measuredAt:new Date().toISOString(),checks,sourceHashes,scope:'Thirteen tiny independent behavioral controls including FIFO/ABA, current scope, actual matcher/default winners/JSON, readonly timestamps and arbitrary frozen-Date age boundaries; no DB, HTTP, process mutation or load. They do not prove current SQL freshness or memory/performance SLA.'};
const output='outputs/verification/assessment-purpose/performance-cache-independent-review.json';
await mkdir('outputs/verification/assessment-purpose',{recursive:true});
try {const prior=await readFile(output);await mkdir('outputs/verification/assessment-purpose/history',{recursive:true});await writeFile(`outputs/verification/assessment-purpose/history/cache-review-${createHash('sha256').update(prior).digest('hex').slice(0,12)}.json`,prior,{flag:'wx'});}catch(error:any){if(!['ENOENT','EEXIST'].includes(error.code))throw error;}
await writeFile(output,JSON.stringify(report,null,2));
console.log(JSON.stringify({passed:true,groups:checks.length,scope:report.scope}));

import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import {evaluateMatch,rankMatches,compareRankedMatches,type MatchCandidate,type MatchNeed,type SignalGrade} from '../artifacts/api-server/src/lib/signal-matching';
import {trustedFspResults,fspBonusForSignal,emptyFspSignal,presentFspSignal,type FspResult} from '../artifacts/api-server/src/lib/fsp-results';
import {fspSignalFromConnection,fspRegistryProvider,fspDemoFixtureId,fspConsentVersion} from '../artifacts/api-server/src/lib/fsp-provider';
import {FreshRankingCache,freshRankingKey} from '../artifacts/api-server/src/lib/signal-fresh-ranking-cache';
import {evaluateResumeCandidates} from '../artifacts/api-server/src/lib/signal-resume-evaluation';
type Person={id:number;alias:string;score:number;grade?:SignalGrade|null;version?:string;result?:FspResult;legacyBool?:boolean;workFormat?:string};
const goldenBytes=readFileSync(new URL('./fixtures/fsp-category-v060.json',import.meta.url));
const fixture=JSON.parse(goldenBytes.toString()) as {at:string;need:MatchNeed;scenarios:{id:string;people:Person[];expected:number[];withoutFsp:number[]}[]};
const at=new Date(fixture.at);
function person(p:Person):MatchCandidate {
  const grade=p.grade===undefined?'Middle':p.grade;
  const signal=p.result?trustedFspResults([{id:'event-1',title:'Synthetic outcome',event:'Пример: synthetic fixture',occurredAt:'2026-09-25',kind:p.result==='participation'?'participation':'placement',result:p.result}]):undefined;
  return {userId:p.id,alias:p.alias,specialization:'Backend / Python',verifiedGrade:grade,verifiedScore:p.score,verifiedSkills:['Python','SQL'],stack:[],statedSkills:[],workFormat:p.workFormat??'Удалённо',salaryMin:120000,salaryMax:180000,salaryPeriod:'month',salaryType:'gross',latestAssessmentAt:at,hasFspHistory:p.legacyBool??Boolean(signal),fspSignal:signal,visibility:'pseudonymous',consentMatching:true,demoMode:true,
    assessmentEvidence:grade?{attemptId:10000+p.id,candidateId:p.id,programId:'backend-python',programVersion:p.version??'signal-backend-python-v6',grade,score:p.score,submittedAt:at.toISOString(),state:'verified',comparisonPolicy:'same-program-version-rubric-v1',rubricKey:'synthetic-policy-rubric'}:null};
}
const rank=(people:MatchCandidate[])=>rankMatches(people.map(candidate=>({candidate,evaluation:evaluateMatch(fixture.need,candidate,true,at)})).filter(row=>row.evaluation.eligible));
test('v6 predeclared policy goldens retain their before-implementation hash and all explicit expected orders',()=>{
  const baseline=JSON.parse(readFileSync(new URL('../outputs/quality/0.6.0/fsp-category/before-policy.json',import.meta.url),'utf8'));
  assert.equal(createHash('sha256').update(goldenBytes).digest('hex'),baseline.goldensSha256);
  assert.equal(baseline.targetedBaseline.passed,38);
  for(const scenario of fixture.scenarios){const candidates=scenario.people.map(person);assert.deepEqual(rank(candidates).map(row=>row.candidate.userId),scenario.expected,scenario.id);assert.deepEqual(rank(candidates.map(c=>({...c,hasFspHistory:false,fspSignal:emptyFspSignal()}))).map(row=>row.candidate.userId),scenario.withoutFsp,scenario.id+' ablation');}
});
test('category anchors ignore FSP/raw quality and are selected before local reranking; full-pool positions are stable and transitive',()=>{
  const people=[person({id:1,alias:'A',score:83}),person({id:2,alias:'Z',score:85,result:'win'}),person({id:3,alias:'B',score:100,grade:'Senior'}),person({id:4,alias:'C',score:83,grade:'Senior',version:'signal-backend-python-v5'}),person({id:5,alias:'D',score:83,version:'signal-backend-python-v5',result:'prize'})];
  const expected=rank(people),ids=expected.map(r=>r.candidate.userId);
  for(let shift=0;shift<people.length;shift++)assert.deepEqual(rank([...people.slice(shift),...people.slice(0,shift)].reverse()).map(r=>r.candidate.userId),ids);
  for(const a of expected)for(const b of expected)for(const c of expected)if(compareRankedMatches(a,b)<=0&&compareRankedMatches(b,c)<=0)assert.ok(compareRankedMatches(a,c)<=0);
  const categoryIds=expected.map(row=>row.evaluation.ranking.categoryId);assert.equal(new Set(categoryIds.slice(0,3)).size,1);assert.equal(new Set(categoryIds.slice(3)).size,1);
  const ablated=rank(people.map(c=>({...c,fspSignal:emptyFspSignal()})));
  assert.deepEqual(ablated.map(r=>r.evaluation.ranking.categoryId),categoryIds);
  for(const row of expected){assert.equal(row.evaluation.rankingScore,row.evaluation.ranking.businessFitScore);assert.equal(row.evaluation.scoreScope,'shared_need_fit');assert.equal(row.evaluation.ranking.poolSize,5);assert.equal('note' in row.evaluation.fspSignal,false);assert.ok(presentFspSignal(row.evaluation.fspSignal).note.length>0);}
});
test('MAX result gives distinct 1/2/3 without event count, title inference, chronology or overflow',()=>{
  const participation={id:'p',title:'Winner (untrusted title)',event:'Пример: event',occurredAt:'2026-09-25',kind:'participation' as const};
  assert.equal(trustedFspResults(Array.from({length:128},()=>participation)).bonus,1);
  assert.equal(trustedFspResults([{...participation,kind:'placement'}]).bonus,0);
  assert.equal(trustedFspResults([{...participation,kind:'rank'}]).bonus,0);
  assert.equal(trustedFspResults([{...participation,result:'prize'},{...participation,result:'win'},participation]).bonus,3);
  assert.equal(trustedFspResults(Array.from({length:129},()=>participation)).bonus,0);
  const forged={...trustedFspResults([participation]),bestResult:'bad' as FspResult,bonus:3 as const};assert.equal(fspBonusForSignal(forged,true),0);
  assert.equal(fspBonusForSignal(trustedFspResults([{...participation,result:'win'}]),false),0);
});
test('current connection trust, consent, provenance, revocation, empty and legacy outcomes control the signal independently of stored booleans',async()=>{
  const context={accountIsDemo:true,demoEnabled:true},result=await fspRegistryProvider.resolve(fspDemoFixtureId,context);
  const row={fspId:fspDemoFixtureId,status:result.status,consentVersion:fspConsentVersion,consentedAt:at,verifiedAt:at,revokedAt:null,provenance:result.provenance,providerVersion:result.providerVersion,achievements:result.achievements};
  assert.equal(fspSignalFromConnection(row,context).bonus,3);
  for(const patch of [{fspId:'user-entered'},{status:'pending'},{consentVersion:'unknown'},{consentedAt:null},{verifiedAt:null},{revokedAt:at},{provenance:'user_supplied'},{providerVersion:'unknown'},{achievements:[]}])assert.equal(fspSignalFromConnection({...row,...patch},context).bonus,0);
  assert.equal(fspSignalFromConnection(row,{...context,accountIsDemo:false}).bonus,0);assert.equal(fspSignalFromConnection(row,{...context,demoEnabled:false}).bonus,0);
  const legacy={...row,providerVersion:'signal-fsp-example-v1',achievements:[{id:'old',title:'Finalist',event:'Пример: event',occurredAt:'2026-09-20',kind:'placement'}]};
  assert.equal(fspSignalFromConnection(legacy,context).historyStatus,'unresolved_results');assert.equal(fspSignalFromConnection(legacy,context).bonus,0);
});
test('warm ranking memo uses fresh full ledger fingerprints; revoke/title/source changes cannot reuse a previous sporting order',()=>{
  const cache=new FreshRankingCache(),scope={demoMode:true,reviewScopeId:null};
  const candidates=fixture.scenarios[0]!.people.map(person).map((c,index)=>({...c,resumeId:100+index,resumeRevision:1,title:'Synthetic',yearsExperience:0,consentCatalog:true,readyForOffers:false,avatarDataUrl:null,publicName:null,deletedAt:null,legacyQualification:null}));
  const build=()=>rank(candidates).map(row=>({...row,alternatives:[row.candidate]}));
  const key=(ledger:unknown)=>freshRankingKey(fixture.need,scope,new Map(),createHash('sha256').update(JSON.stringify(ledger)).digest('hex'),'current-proof',candidates,at);
  const warm=cache.read(key(candidates.map(c=>c.fspSignal)),candidates,build);assert.deepEqual(warm.map(r=>r.candidate.userId),[2,1]);
  candidates[1]!.fspSignal=emptyFspSignal(true);const revoked=cache.read(key(candidates.map(c=>c.fspSignal)),candidates,build);assert.deepEqual(revoked.map(r=>r.candidate.userId),[1,2]);
  assert.notEqual(warm[0]!.evaluation.fspBonus,revoked[0]!.evaluation.fspBonus);
});
test('request-local same-person evaluation keeps distinct FSP facts distinct instead of sharing the legacy boolean result',()=>{
  const participation=person({id:1,alias:'A',score:83,result:'participation'}),win=person({id:1,alias:'A',score:83,result:'win'});
  const rows=evaluateResumeCandidates(fixture.need,[participation,win],true,at);assert.equal(rows[0]!.evaluation.fspBonus,1);assert.equal(rows[1]!.evaluation.fspBonus,3);assert.notEqual(rows[0]!.evaluation,rows[1]!.evaluation);
});

import {test} from 'node:test';
import assert from 'node:assert/strict';
import {createHash} from 'node:crypto';
import {createRequire} from 'node:module';
import {once} from 'node:events';
import {FreshRankingCache,freshRankingKey,estimateRankingStringBytes} from '../artifacts/api-server/src/lib/signal-fresh-ranking-cache';
import {readonlyResumeProjection} from '../artifacts/api-server/src/lib/signal-readonly-resume';
import {evaluateMatch,rankMatches,MATCH_ALGORITHM_VERSION,type MatchNeed} from '../artifacts/api-server/src/lib/signal-matching';
import type {CatalogResume} from '../artifacts/api-server/src/lib/signal-resume-catalog';
const at=new Date('2026-10-05T12:00:00Z'),day=86400000,scope={demoMode:false,reviewScopeId:null};
const need:MatchNeed={specialization:'Backend / Python',grade:'Middle',requiredSkills:['Python'],desirableSkills:[],workFormat:'Удалённо',salaryMin:null,salaryMax:null,salaryPeriod:'month',salaryType:'gross'};
function row(userId:number,resumeId:number):CatalogResume{return {userId,resumeId,resumeRevision:1,title:'Резюме ⚡',alias:'Профиль '+userId,specialization:need.specialization,verifiedGrade:'Middle',verifiedScore:100,verifiedSkills:['Python'],stack:['Python'],statedSkills:['Python'],yearsExperience:2,workFormat:'Удалённо',salaryMin:null,salaryMax:null,salaryPeriod:'month',salaryType:'gross',latestAssessmentAt:at,hasFspHistory:false,visibility:'pseudonymous',consentMatching:true,consentCatalog:true,readyForOffers:true,demoMode:false,reviewScopeId:null,deletedAt:null,legacyQualification:true,avatarDataUrl:null,publicName:null};}
const ownedRows=()=>Object.freeze([row(1,11),row(1,12),row(2,21)].map(readonlyResumeProjection)) as unknown as CatalogResume[];
function computed(rows:CatalogResume[]){return rankMatches([rows[0]!,rows[2]!].map(candidate=>({candidate,evaluation:evaluateMatch(need,candidate,false,at),alternatives:rows.filter(row=>row.userId===candidate.userId)})));}
function originalKey(rows:CatalogResume[],now:Date){const bands=rows.map(row=>{const m=row.latestAssessmentAt?.getTime();if(m===undefined||!Number.isFinite(m))return 3;const days=Math.max(0,(now.getTime()-m)/day);return days<=30?0:days<=90?1:days<180?2:3;});return createHash('sha256').update(JSON.stringify([MATCH_ALGORITHM_VERSION,need,scope,[], 'pool','evidence',bands])).digest('hex');}
test('owned freshness memo preserves original hash at inclusive boundaries, rollback, future and invalid dates',()=>{
 const cache=new FreshRankingCache(),rows=ownedRows();
 for(const days of [-10,0,30,90,180,300])for(const delta of [-1,0,1]){const now=new Date(at.getTime()+days*day+delta);assert.equal(cache.key(need,scope,new Map(),'pool','evidence',rows,now),originalKey(rows,now));}
 const advanced=new Date(at.getTime()+181*day),back=new Date(at.getTime()+29*day);cache.key(need,scope,new Map(),'pool','evidence',rows,advanced);assert.equal(cache.key(need,scope,new Map(),'pool','evidence',rows,back),originalKey(rows,back));
 const unusual=Object.freeze([readonlyResumeProjection({...row(1,11),latestAssessmentAt:null}),readonlyResumeProjection({...row(2,21),latestAssessmentAt:new Date(NaN)})]) as unknown as CatalogResume[];
 assert.equal(cache.key(need,scope,new Map(),'pool','evidence',unusual,at),originalKey(unusual,at));
 assert.ok(cache.diagnostics().retainedEstimatedBytes<=cache.diagnostics().budgetBytes);
});
test('freezing caller objects cannot turn mutable Date into an owned timestamp memo',()=>{
 const rows=Object.freeze([Object.freeze({...row(1,11),latestAssessmentAt:new Date(at)})]) as unknown as CatalogResume[],cache=new FreshRankingCache();
 const key=cache.key(need,scope,new Map(),'pool','evidence',rows,at);rows[0]!.latestAssessmentAt!.setTime(at.getTime()-181*day);
 assert.notEqual(cache.key(need,scope,new Map(),'pool','evidence',rows,at),key);assert.equal(cache.diagnostics().bandEstimatedBytes,0);
});
test('addressed cached default equals whole-pool find including ordinal and alternatives',()=>{
 const rows=ownedRows(),cache=new FreshRankingCache(),full=cache.read('fresh',rows,()=>computed(rows));
 for(const expected of full){const actual=cache.readDefaultEntry('fresh',rows,expected.candidate.userId,expected.candidate.resumeId);assert.deepEqual(actual,expected);assert.equal(actual!.candidate,expected.candidate);assert.equal(actual!.evaluation.ranking.position,expected.evaluation.ranking.position);actual!.alternatives.pop();assert.deepEqual(cache.readDefaultEntry('fresh',rows,expected.candidate.userId,expected.candidate.resumeId),expected);}
 assert.equal(cache.readDefaultEntry('fresh',rows,1,12),undefined);assert.equal(cache.readDefaultEntry('fresh',rows,999,11),undefined);assert.equal(cache.readDefaultEntry('changed-proof-or-scope',rows,1,11),undefined);
 assert.equal(cache.readDefaultEntry('fresh',rows.filter(row=>row.resumeId!==21),1,11),undefined,'All current rows must still exist even for a targeted hit');
 const copies=rows.map(row=>({...row,title:'Current title'}));assert.equal(cache.readDefaultEntry('fresh',copies,1,11)!.candidate.title,'Current title');
});
test('unrelated computed rows cannot gain owned offset fast-path permission',()=>{
 const rows=ownedRows(),cache=new FreshRankingCache(),foreign=row(999,999);cache.read('malformed-caller',rows,()=>rankMatches([{candidate:foreign,evaluation:evaluateMatch(need,foreign,false,at),alternatives:[foreign]}]));
 assert.equal(cache.readDefaultEntry('malformed-caller',rows,999,999),undefined);assert.equal(cache.readIfPresent('malformed-caller',rows),undefined);
});
test('mutable injected rows reattach their current owner before equivalent-default validation',()=>{
 const rows=[row(1,11),row(1,12),row(2,21)],cache=new FreshRankingCache();cache.read('caller-key',rows,()=>computed(rows));
 const changed=rows.map(value=>({...value,userId:value.userId===1?7:value.userId}));
 assert.equal(cache.readEquivalentDefault('caller-key',changed,new Map([[1,11]])),undefined);
 assert.ok(cache.readEquivalentDefault('caller-key',changed,new Map([[7,11]])));
});
test('current scope, pool, proof and override facts remain material with the owned memo',()=>{
 const rows=ownedRows(),cache=new FreshRankingCache(),key=cache.key(need,scope,new Map(),'pool','evidence',rows,at);
 for(const [pool,proof]of [['new-pool','evidence'],['pool','new-proof']])assert.notEqual(cache.key(need,scope,new Map(),pool!,proof!,rows,at),key);
 assert.notEqual(cache.key(need,{...scope,reviewScopeId:'foreign'},new Map(),'pool','evidence',rows,at),key);
 assert.notEqual(cache.key({...need,requiredSkills:['UnknownRequired']},scope,new Map(),'pool','evidence',rows,at),key);
 assert.notEqual(cache.key(need,scope,new Map([[1,12]]),'pool','evidence',rows,at),key);
 assert.equal(cache.key(need,scope,new Map(),'pool','evidence',rows,at),freshRankingKey(need,scope,new Map(),'pool','evidence',rows,at));
});
test('private UTF8 facet preserves actual Express bytes, Content-Length, ETag and HEAD with no-store',async()=>{
 const requireApi=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));const express=requireApi('express');const app=express();
 const cache=new FreshRankingCache(),rows=ownedRows();let builds=0;const json=JSON.stringify({profile:'Кириллица ⚡ 😀',values:['<text>',42]});
 app.get('/original',(_req:any,res:any)=>{res.setHeader('Cache-Control','no-store');res.type('application/json').send(json);});
 app.get('/cached',(_req:any,res:any)=>{res.setHeader('Cache-Control','no-store');const entries=cache.read('current',rows,()=>computed(rows));cache.respondJson(entries,()=>{builds++;return json;},res);});
 const server=app.listen(0,'127.0.0.1');await once(server,'listening');const address=server.address();assert.ok(address&&typeof address==='object');const base='http://127.0.0.1:'+address.port;
 try{const a=await fetch(base+'/original'),b=await fetch(base+'/cached');assert.deepEqual(Buffer.from(await a.arrayBuffer()),Buffer.from(await b.arrayBuffer()));for(const h of ['content-type','content-length','etag','cache-control'])assert.equal(b.headers.get(h),a.headers.get(h));
 for(let n=0;n<2;n++){const c=await fetch(base+'/cached');assert.equal(await c.text(),json);}assert.equal(builds,1);
 const head=await fetch(base+'/cached',{method:'HEAD'});assert.equal(await head.text(),'');assert.equal(head.headers.get('content-length'),String(Buffer.byteLength(json)));assert.equal(head.headers.get('cache-control'),'no-store');
 const condA=await fetch(base+'/original',{headers:{'If-None-Match':a.headers.get('etag')!}}),condB=await fetch(base+'/cached',{headers:{'If-None-Match':a.headers.get('etag')!}});assert.equal(condB.status,condA.status);await condA.arrayBuffer();await condB.arrayBuffer();
 const d=cache.diagnostics();assert.equal(d.entrySizes[0]!.utf8Facet,true);assert.equal(d.entrySizes[0]!.jsonEstimatedBytes,Buffer.byteLength(json)+64);assert.ok(d.retainedEstimatedBytes<=d.budgetBytes);
 }finally{await new Promise<void>(resolve=>server.close(()=>resolve()));}
});
test('string facet replacement, tiny budgets and evicted result arrays do not create unbounded body retention',()=>{
 const rows=ownedRows(),probe=new FreshRankingCache(),text=JSON.stringify({name:'Пример'.repeat(20)});probe.read('accounting',rows,()=>computed(rows));
 const cache=new FreshRankingCache(1,probe.diagnostics().retainedEstimatedBytes+estimateRankingStringBytes(text)+128),first=cache.read('A',rows,()=>computed(rows));
 cache.serialize(first,()=>text);const before=cache.diagnostics().retainedEstimatedBytes;let sent='';const response:any={setHeader(){},send(value:Buffer){sent=value.toString('utf8');}};cache.respondJson(first,()=>{throw new Error('Existing facet reuse');},response);assert.equal(sent,text);assert.ok(cache.diagnostics().retainedEstimatedBytes<before);
 cache.read('B',rows,()=>computed(rows));let rebuilt=0;cache.respondJson(first,()=>{rebuilt++;return text;},response);assert.equal(rebuilt,1,'Stale result cannot retrieve another key body');
 const small=new FreshRankingCache(1,64),entries=small.read('oversize',rows,()=>computed(rows));for(let n=0;n<2;n++)small.respondJson(entries,()=>{rebuilt++;return 'x'.repeat(10000);},response);assert.equal(small.diagnostics().entries,0);assert.ok(small.diagnostics().retainedEstimatedBytes<=64);
});

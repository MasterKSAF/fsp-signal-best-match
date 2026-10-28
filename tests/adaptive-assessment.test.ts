import assert from 'node:assert/strict';
import {test} from 'node:test';
import {adaptiveState,betaMastery,nextAdaptiveItem,type AdaptiveObservation} from '../artifacts/api-server/src/lib/adaptive-assessment';
const topics=Array.from({length:6},(_,i)=>`t${i}`),now=new Date('2026-10-20T12:00:00Z'),deadline=new Date(+now+2700000);
const pool=topics.flatMap(t=>Array.from({length:4},(_,r)=>({id:`${t}-${r}`,familyId:`${t}-family-${r}`,competencyId:t,available:true,exposure:0})));
test('synthetic replay covers mandatory competencies and never repeats exposed families',()=>{
 const observations:AdaptiveObservation[]=[],seen=new Set<string>([pool[0]!.familyId]);
 for(let n=0;n<24;n++){const a=nextAdaptiveItem(pool,topics,observations,'fixed-seed',now,deadline,seen),b=nextAdaptiveItem(pool,topics,JSON.parse(JSON.stringify(observations)),'fixed-seed',now,deadline,seen);assert.deepEqual(a,b);if(!a.item)break;assert.ok(!seen.has(a.item.familyId));seen.add(a.item.familyId);observations.push({itemId:a.item.id,familyId:a.item.familyId,competencyId:a.item.competencyId,passed:n%3!==0,receivedAt:now.toISOString()});if(n===11)assert.ok(topics.every(t=>observations.filter(o=>o.competencyId===t).length===2));}
 assert.ok(observations.length<=24);assert.equal(new Set(observations.map(o=>o.familyId)).size,observations.length);
});
test('no conclusions without coverage; time, exhaustion, unrated and repeated observations remain controlled',()=>{
 assert.equal(betaMastery(0,0),.30000000000000004);assert.ok(betaMastery(4,0)>betaMastery(1,0));
 assert.equal(adaptiveState(topics,[],deadline,deadline).outcome,'insufficient_data');
 assert.equal(nextAdaptiveItem([],topics,[],'s',now,deadline).state.outcome,'insufficient_data');
 const o={itemId:'x',familyId:'x',competencyId:topics[0]!,passed:null,receivedAt:now.toISOString()};assert.equal(adaptiveState(topics,[o],now,deadline).outcome,'analysis_pending');assert.throws(()=>adaptiveState(topics,[o,o],now,deadline));
 const cases=topics.flatMap(t=>Array.from({length:4},(_,i)=>({itemId:`${t}${i}`,familyId:`${t}${i}`,competencyId:t,passed:true,receivedAt:now.toISOString()})));
 assert.equal(adaptiveState(topics,cases,now,deadline).outcome,'level_supported');assert.equal(adaptiveState(topics,cases.map(o=>({...o,passed:false})),now,deadline).outcome,'level_not_supported');
});

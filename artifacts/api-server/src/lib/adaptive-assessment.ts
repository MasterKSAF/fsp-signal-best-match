import { createHash } from 'node:crypto';
export const ADAPTIVE_PROCEDURE='adaptive-beta-coverage-v1';
export type AdaptiveItem={id:string;familyId:string;competencyId:string;available:boolean;exposure:number};
export type AdaptiveObservation={itemId:string;familyId:string;competencyId:string;passed:boolean|null;receivedAt:string;skipped?:boolean};
export type AdaptiveOutcome='continue'|'level_supported'|'level_not_supported'|'insufficient_data'|'analysis_pending';
const choose=(n:number,k:number)=>{let x=1;for(let i=1;i<=k;i++)x=x*(n-i+1)/i;return x;};
/** Exact integer-parameter Beta tail via the binomial identity. Thresholds are policy, not validated accuracy. */
export function betaMastery(successes:number,failures:number,threshold=.7){const a=successes+1,b=failures+1,n=a+b-1;let tail=0;for(let k=0;k<a;k++)tail+=choose(n,k)*threshold**k*(1-threshold)**(n-k);return tail;}
export function adaptiveState(topics:readonly string[],observations:readonly AdaptiveObservation[],now:Date,deadline:Date,max=24){
 const seen=new Set<string>();for(const o of observations){if(seen.has(o.familyId))throw new Error('Repeated family is not an independent observation');seen.add(o.familyId);if(!topics.includes(o.competencyId))throw new Error('Unknown competency');}
 const coverage=topics.map(id=>{const rated=observations.filter(o=>o.competencyId===id&&o.passed!==null),successes=rated.filter(o=>o.passed).length,failures=rated.length-successes,a=1+successes,b=1+failures,total=a+b;return {id,n:rated.length,successes,failures,mastery:betaMastery(successes,failures),information:a*b/(total*total*(total+1)*(total+1))};});
 const complete=coverage.length===6&&coverage.every(c=>c.n>=2);
 let outcome:AdaptiveOutcome='continue';
 if(observations.some(o=>o.passed===null&&!o.skipped))outcome=+now>=+deadline?'insufficient_data':'analysis_pending';
 else if(complete&&coverage.every(c=>c.mastery>=.8))outcome='level_supported';
 else if(complete&&coverage.some(c=>c.mastery<=.2))outcome='level_not_supported';
 else if(+now>=+deadline||observations.length>=max)outcome='insufficient_data';
 return {procedure:ADAPTIVE_PROCEDURE,coverage,outcome,observations:observations.length,minimumPerTopic:2,maximum:max,experimental:true};
}
export function nextAdaptiveItem(pool:readonly AdaptiveItem[],topics:readonly string[],observations:readonly AdaptiveObservation[],seed:string,now:Date,deadline:Date,excluded:ReadonlySet<string>=new Set()){
 const state=adaptiveState(topics,observations,now,deadline);if(state.outcome!=='continue')return {state,item:null};
 const used=new Set([...excluded,...observations.map(o=>o.familyId)]),eligible=pool.filter(i=>i.available&&i.exposure<1000&&!used.has(i.familyId)&&topics.includes(i.competencyId));
 const deficit=state.coverage.filter(c=>c.n<2),min=Math.min(...deficit.map(c=>c.n));
 const candidates=eligible.filter(i=>!deficit.length||deficit.some(c=>c.id===i.competencyId&&c.n===min)).map(i=>({...i,utility:state.coverage.find(c=>c.id===i.competencyId)!.information})).sort((a,b)=>b.utility-a.utility||a.id.localeCompare(b.id));
 if(!candidates.length)return {state:{...state,outcome:'insufficient_data' as const},item:null};
 const top=candidates.slice(0,3),number=createHash('sha256').update(`${ADAPTIVE_PROCEDURE}|${seed}|${observations.length}`).digest().readUInt32BE(0);
 return {state,item:top[number%top.length]!};
}

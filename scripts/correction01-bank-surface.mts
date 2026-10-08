/** One bounded conditional choice-only control, before/after immutable source. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
import * as current from '../artifacts/api-server/src/lib/skill-module-bank';
import * as before from '../outputs/verification/full-audit-a01-a11-20261008/clean-workspace/artifacts/api-server/src/lib/skill-module-bank';
const dir='outputs/verification/correction-01-20261008/bank';
const revision=process.argv[2]??'v1';assert.match(revision,/^v[1-9]\d*$/);
const hash=(s:string)=>createHash('sha256').update(s).digest().readUInt32BE(0);
const strategies=['shortest','longest','rank2','rank3','random'] as const;
function pick(options:string[],strategy:string,seed:string){
 if(strategy==='random')return hash(seed)%options.length;
 const ranked=options.map((text,i)=>({i,len:text.length,tie:hash(`${seed}|${i}`)})).sort((a,b)=>a.len-b.len||a.tie-b.tie);
 return ranked[strategy==='shortest'?0:strategy==='longest'?ranked.length-1:strategy==='rank2'?1:2].i;
}
function answer(f:ReturnType<typeof current.buildSkillAttempt>,strategy:string,seed:string){
 const answers:Record<string,string>={};let total=0,correct=0;
 for(const c of f.cases){const oracle=f.oracles[c.id];
  if(c.options){const id=c.options[pick(c.options.map(o=>o.text),strategy,`${seed}/${c.id}`)].id;answers[c.id]=id;total++;correct+=Number(id===oracle.expected);continue;}
  if(!oracle.parts){answers[c.id]=oracle.expected;continue;}
  const parts=c.prompt.split(/\n\n(?=Часть (?:B|[12]))/);
  answers[c.id]=oracle.parts.map((p,i)=>{const options=[...(parts[i]??'').matchAll(/^([1-4])\. (.+)$/gm)].map(m=>m[2]);if(!options.length)return p.expected;const response=String(1+pick(options,strategy,`${seed}/${c.id}/${i}`));total++;correct+=Number(response===p.expected);return response;}).join(';');
 }
 return{answers,total,correct};
}
const semanticVariants=[];
for(const [c,s]of [[0,1],[5,0]])for(let n=5;n<=9;n++)for(const flag of [false,true]){
 const t=current.skillScenarioFixture('frontend-engineering','Junior',c,s,n,flag),old=before.skillScenarioFixture('frontend-engineering','Junior',c,s,n,flag);
 semanticVariants.push({family:`frontend-engineering/${c}/${s}`,n,flag,prompt:t.prompt,currentOptions:t.options,correctSemantic:t.answer,currentLengths:t.options!.map(o=>o.length),currentCorrectAscendingRank:1+t.options!.filter(o=>o.length<t.answer.length).length,beforeLengths:old.options!.map(o=>o.length),beforeCorrectAscendingRank:1+old.options!.filter(o=>o.length<old.answer.length).length});
}
assert.equal(semanticVariants.length,20);
const rows=[];
for(const m of current.skillModuleRegistry)for(const level of ['Junior','Middle','Senior'] as const){
 const samples=m.id==='frontend-engineering'&&level==='Junior'?240:120;
 const counts=Object.fromEntries(strategies.map(s=>[s,{passed:0,choices:0,correctChoices:0}]));
 const baselineCounts=m.id==='frontend-engineering'&&level==='Junior'?Object.fromEntries(strategies.map(s=>[s,{passed:0,choices:0,correctChoices:0}])):null;
 for(let i=0;i<samples;i++){
  const seed=`correction01-conditional-${m.id}-${level}-${i}`,f=current.buildSkillAttempt(m.id,level,seed);
  for(const strategy of strategies){const a=answer(f,strategy,seed),d=current.scoreSkillAttempt(f.cases,f.oracles,a.answers,f.policy);counts[strategy].passed+=Number(d.passed);counts[strategy].choices+=a.total;counts[strategy].correctChoices+=a.correct;}
  if(baselineCounts){const old=before.buildSkillAttempt(m.id,level,seed);for(const strategy of strategies){const a=answer(old,strategy,seed),d=before.scoreSkillAttempt(old.cases,old.oracles,a.answers,old.policy);baselineCounts[strategy].passed+=Number(d.passed);baselineCounts[strategy].choices+=a.total;baselineCounts[strategy].correctChoices+=a.correct;}}
 }
 rows.push({skill:m.id,level,samples,strategies:counts,beforeSameSeed:baselineCounts});
}
const paths=['artifacts/api-server/src/lib/skill-junior-protocol-choices-v6.ts','artifacts/api-server/src/lib/skill-module-bank.ts','outputs/verification/full-audit-a01-a11-20261008/clean-workspace/artifacts/api-server/src/lib/skill-junior-protocol-choices-v6.ts'];
const sourceHashes=Object.fromEntries(paths.map(p=>[p,createHash('sha256').update(readFileSync(p)).digest('hex')]));
const output={measuredAt:new Date().toISOString(),bankVersion:current.SKILL_BANK_VERSION,semanticVariants,rows,sourceHashes,policy:'Selectors see visible options only. Open answers held correct to isolate conditional choice shortcuts. All controls on fixed seeds, one120-form control of each active programme plus240 Frontend Junior forms.',limitations:['Conditional choice-only experiment is not the probability of human qualification.','Five specified text strategies are not an exhaustive adversary.','Residual SQL/TypeScript and noncritical cues remain disclosed; no statistical equality with random required.','Only the two critical Frontend Junior families were edited; Middle part A shares these editorial texts without changing its required invariant.']};
writeFileSync(`${dir}/surface-controls-${revision}.json`,JSON.stringify(output,null,2),{flag:'wx'});
for(const r of rows)console.log(JSON.stringify({skill:r.skill,level:r.level,samples:r.samples,passed:Object.fromEntries(strategies.map(s=>[s,r.strategies[s].passed])),before:r.beforeSameSeed?Object.fromEntries(strategies.map(s=>[s,r.beforeSameSeed[s].passed])):null}));

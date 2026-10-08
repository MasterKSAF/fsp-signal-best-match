import { writeFileSync } from 'node:fs';
import { skillModuleRegistry,skillScenarioFixture } from '../artifacts/api-server/src/lib/skill-module-bank';
const rows=[];
for(const m of skillModuleRegistry)for(const level of ['Junior','Middle','Senior'] as const)for(let c=0;c<6;c++)for(let s=0;s<3;s++)for(const [n,flag] of [[5,true],[9,false]] as const){const t=skillScenarioFixture(m.id,level,c,s,n,flag);rows.push({key:`${m.id}/${level}/${c}/${s}/${n}/${flag}`,skill:m.id,level,c,s,n,flag,competency:m.competencies[c],title:t.title,prompt:t.prompt,...(t.options?{options:t.options}:{}),responseType:t.responseType});}
writeFileSync('outputs/verification/full-audit-a01-a11-20261008/bank/public-only-scenarios-draft.json',JSON.stringify({stage:'editorial draft; math/requirements stable, options may receive plausible distractor fixes',containsPrivateKeys:false,rows},null,2));
console.log(rows.length);

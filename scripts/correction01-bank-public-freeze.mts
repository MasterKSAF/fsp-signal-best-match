/** Public-only capture. No answer/oracle/scorer values are serialized. */
import { skillScenarioFixture, skillModuleRegistry, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
const dir='outputs/verification/correction-01-20261008/bank';
const revision=process.argv[2]??'v1';if(!/^v[1-9]\d*$/.test(revision))throw new Error('Invalid evidence revision');
mkdirSync(dir,{recursive:true});
const files=readdirSync('artifacts/api-server/src/lib').filter(f=>f.startsWith('skill-')&&f.endsWith('.ts')).map(f=>`artifacts/api-server/src/lib/${f}`);
const sourceHashes=Object.fromEntries(files.map(path=>[path,createHash('sha256').update(readFileSync(path)).digest('hex')]));
const rows=[];
for(const m of skillModuleRegistry)for(const level of ['Junior','Middle','Senior'] as const)for(let c=0;c<6;c++)for(let s=0;s<3;s++){
 const task=skillScenarioFixture(m.id,level,c,s,5,true);
 rows.push({key:`${m.id}/${level}/${c}/${s}/5/true`,skill:m.id,level,c,s,n:5,flag:true,competency:m.competencies[c],title:task.title,prompt:task.prompt,responseType:task.responseType??'text',...(task.options?{options:task.options}:{}),...(task.parts?{partTypes:task.parts.map(p=>p.responseType)}:{})});
}
writeFileSync(`${dir}/public-input-${revision}-frozen.json`,JSON.stringify({frozenAt:new Date().toISOString(),bankVersion:SKILL_BANK_VERSION,editorialRevision:`correction01-${revision}`,containsPrivateKeys:false,sourceHashes,rows},null,2),{flag:'wx'});
console.log(JSON.stringify({publicRows:rows.length,sourceFiles:files.length}));

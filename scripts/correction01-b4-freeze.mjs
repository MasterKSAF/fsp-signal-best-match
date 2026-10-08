/** Build references, complete misconception works and labels from saved public material.
 * This process imports no product module and never calls a generator/scorer. */
import assert from 'node:assert/strict';
import {readFileSync,writeFileSync} from 'node:fs';
import {createHash} from 'node:crypto';
const dir='outputs/verification/correction-01-20261008/bank';
const revision=process.argv[2]??'v1';assert.match(revision,/^v[1-9]\d*$/);
const old='outputs/verification/full-audit-a01-a11-20261008/bank';
const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
const sourceHashes={};
const read=(path)=>{const b=readFileSync(path);sourceHashes[path]=sha(b);return JSON.parse(b);};
const pub=read(`${dir}/public-input-${revision}-frozen.json`);
const primary=read(`${old}/reference-primary-v2-frozen-before-b4-rerun.json`);
const middle=read(`${old}/independent-review/middle-semantic-worksheet-v2-frozen.json`);
const senior=read(`${old}/independent-review/senior-all-semantic-108-frozen.json`);
const supplements=['protocol-semantic-mapping-v3-frozen.json','lower-seven-protocol-semantic-mapping-v4-frozen.json','python-two-protocol-semantic-mapping-v5-frozen.json'].flatMap(f=>read(`${old}/independent-review/${f}`).rows);
const priorProfiles=read(`${old}/profiles-frozen-before-scoring.json`);
const byKey=data=>new Map(data.map(r=>[r.key,r]));
const prim=byKey(primary.rows),mid=byKey(middle.rows),sen=byKey(senior.rows),sup=byKey(supplements),publics=byKey(pub.rows);
function parts(r){return r.level==='Junior'?[r.prompt]:r.prompt.split(r.level==='Middle'?'\n\nЧасть B':'\n\nЧасть 2');}
function options(part){return [...part.matchAll(/^([1-4])\. (.+)$/gm)].map(m=>({wire:m[1],text:m[2]}));}
function mapPart(semantic,part){const list=options(part);if(!list.length)return String(semantic);const selected=list.filter(o=>o.text===semantic);assert.equal(selected.length,1,`Unmapped semantic: ${semantic}`);return selected[0].wire;}
const c01Semantic={
 'frontend-engineering/0/1':'Владелец фильтра: проверяемый URL; Back: прочитать фильтр URL; Ключ запроса: фильтр и права аккаунта.',
 'frontend-engineering/5/0':'Snapshot/revision: обновить из актуального success; Draft: зафиксировать сохранённый draft; Feedback/focus: объявить успех, фокус сохранить.',
};
const vectors=pub.rows.map(r=>{
 const change=sup.get(r.key),source=prim.get(r.key);assert.ok(source);
 const primarySemantic=c01Semantic[`${r.skill}/${r.c}/${r.s}`]&&r.level!=='Senior'?c01Semantic[`${r.skill}/${r.c}/${r.s}`]:change?.primarySemanticDecision??source.semanticDecision;
 const visibleParts=parts(r);
 let primaryWire;
 if(r.level==='Junior'&&r.options){const selected=r.options.filter(t=>t===primarySemantic);assert.equal(selected.length,1,r.key);primaryWire=`o${r.options.indexOf(primarySemantic)+1}`;}
 else primaryWire=mapPart(primarySemantic,visibleParts[0]);
 const secondarySemantic=r.level==='Junior'?null:r.level==='Middle'?mid.get(r.key).semanticDecision:change?.invariantSemanticDecision??sen.get(r.key).semanticDecision;
 const secondaryWire=r.level==='Junior'?null:mapPart(secondarySemantic,visibleParts[1]);
 return {key:r.key,skill:r.skill,level:r.level,c:r.c,s:r.s,primarySemanticStatement:String(primarySemantic),primaryWireResponse:primaryWire,secondarySemanticStatement:secondarySemantic,secondaryWireResponse:secondaryWire,response:primaryWire+(secondaryWire===null?'':`;${secondaryWire}`),primaryBasis:c01Semantic[`${r.skill}/${r.c}/${r.s}`]&&r.level!=='Senior'?'C01 explicit owner/operation contract, editorial only':change?.basis??source.method};
});
assert.equal(vectors.length,324);
const refs=byKey(vectors),skills=priorProfiles.skills,levels=priorProfiles.levels;
const profiles=priorProfiles.profiles.map(p=>({id:`format-control/${p.id}`,priorId:p.id,kind:p.id==='strong'?'reference':'omission-or-format',levels,description:p.id==='strong'?'Complete reference control':p.id==='junior-only'?'Primary-only omission above Junior; no claimed knowledge discrimination':p.id==='middle-only'?'Primary-only omission at Senior; no claimed knowledge discrimination':`${p.id}: inherited zero/foreign/omission responses; may be syntactically invalid`}));
const errors=[
 {id:'knowledge/junior-react-replacement-batching',level:'Junior',skill:'react',failed:[0],targets:[{c:0,s:0,primary:'6'}],model:'Treat both functional updaters as replacements calculated from the captured count5; batch then keeps6. This misses ordered updater composition (5→6→7).'},
 {id:'knowledge/junior-fe-local-filter',level:'Junior',skill:'frontend-engineering',failed:[0],targets:[{c:0,s:1,primaryChoice:/Владелец фильтра: локальный state формы/}],model:'A local form owner is sufficient for any filter; Back keeps its current state. Ignores the explicit sharable-link/history lifetime.'},
 {id:'knowledge/middle-sql-row-cas',level:'Middle',skill:'sql',failed:[3],targets:[{c:3,s:0,secondaryChoice:/^CAS своей строки после общего snapshot/}],model:'Transfers row revision lost-update protection to the two-row on-call invariant. Both own-row CAS can succeed, so this does not prevent write skew. One noncritical failure remains allowed by5/6.'},
 {id:'knowledge/middle-fe-shared-save-status',level:'Middle',skill:'frontend-engineering',failed:[0],targets:[{c:0,s:0,secondaryChoice:/^Сохранить cache CV1, но success-effect/}],model:'Separates data cache by CV but leaves success cleanup global; a CV1 success clears CV2 draft. Confuses cache identity with operation/draft ownership.'},
 {id:'knowledge/senior-sql-local-atomicity',level:'Senior',skill:'sql',failed:[3],targets:[{c:3,s:0,primary:'1|1|1',secondaryChoice:/^Сохранить order и SQL receipt в SERIALIZABLE/}],model:'Treats SQL order/outbox atomicity and SERIALIZABLE as an exactly-once guarantee for external delivery. Counts only one effect after lost ACK despite two receives and no recipient dedupe.'},
 {id:'knowledge/senior-react-junior-transfer',level:'Senior',skill:'react',failed:[0,3],targets:[{c:0,s:2,primary:'12|5|10',secondaryChoice:/^Отдельные setters выполнять в одном handler/},{c:3,s:0,primary:'draftA|draftA|1',secondaryChoice:/^После ACK заменить client key новым server-id/}],model:'Uses whole-state rollback to baseline5 instead of replaying remaining B, trusts batching for coupled invariants, and carries Junior persisted key=id across optimistic ACK. Fails critical state and noncritical identity.'},
 {id:'knowledge/senior-react-stale-validation',level:'Senior',skill:'react',failed:[3],targets:[{c:3,s:2,primary:'1|5|empty',secondaryChoice:/^Сохранить draft выше plugin, но validation cache только/}],model:'Same business entity/CV revision is taken as evidence that V1 success validates V2 after schema/generation changed. Durable draft is retained but old result is incorrectly accepted. One noncritical failure remains allowed.'},
];
for(const e of errors)profiles.push({id:e.id,kind:'complete-semantic-error',levels:[e.level],description:e.model});
const foreign={python:'typescript',sql:'frontend-engineering',typescript:'python',react:'backend-engineering','backend-engineering':'react','frontend-engineering':'sql'};
const works=[],moduleLabels=[];
function selectedWire(publicRow,partIndex,pattern){
 const list=partIndex===null?publicRow.options.map((text,i)=>({wire:`o${i+1}`,text})):options(parts(publicRow)[partIndex]);
 const selected=list.filter(o=>pattern.test(o.text));assert.equal(selected.length,1,`${publicRow.key}: ${pattern}`);return selected[0].wire;
}
function critical(skill,level,c){if(level!=='Senior')return c===0||c===5;return({python:[0,3,5],sql:[0,3,5],typescript:[0,4,5],react:[0,2,5],'backend-engineering':[0,1,4,5],'frontend-engineering':[0,1,5]})[skill].includes(c);}
for(const p of profiles)for(const level of p.levels)for(const skill of skills){
 const error=errors.find(e=>e.id===p.id&&e.skill===skill),prior=priorProfiles.module_labels.find(l=>l.skill===skill&&l.level===level&&l.profile===p.priorId);
 const expectedPass=error?6-error.failed.length>=5&&!error.failed.some(c=>critical(skill,level,c)):p.kind==='complete-semantic-error'?true:prior.pass;
 moduleLabels.push({profile:p.id,skill,level,expectedPass,basis:error?`Independent public contract: failures c${error.failed.join(',c')}; threshold5/6; critical as published`:p.kind==='complete-semantic-error'?'Unaffected reference module':`Preserved label for prior ${p.priorId}`});
 for(let repeat=0;repeat<3;repeat++){
  const answers={},taskKeys=[],edits=[];
  for(let c=0;c<6;c++){
   const target=error?.targets.find(t=>t.c===c),s=target?.s??repeat,key=`${skill}/${level}/${c}/${s}/5/true`,gold=refs.get(key),r=publics.get(key);taskKeys.push(key);
   let answer=gold.response;
   if(p.kind==='omission-or-format'){
    const gap=skill.includes('engineering')?2:1;
    const known=p.priorId==='junior-only'&&level==='Junior'||p.priorId==='middle-only'&&level!=='Senior'||p.priorId==='noncritical-gap'&&c!==gap||p.priorId==='critical-gap'&&c!==0||p.priorId==='weak'&&c===1;
    if(!known)answer=p.priorId==='nontransferable'?refs.get(`${foreign[skill]}/Junior/${c}/${s}/5/true`).response:p.priorId==='junior-only'&&level!=='Junior'||p.priorId==='middle-only'&&level==='Senior'?gold.primaryWireResponse:level==='Junior'?'0':'0;0';
   }
   if(target){
    const a=target.primary??(target.primaryChoice?selectedWire(r,level==='Junior'?null:0,target.primaryChoice):gold.primaryWireResponse);
    const b=target.secondaryChoice?selectedWire(r,1,target.secondaryChoice):gold.secondaryWireResponse;
    answer=a+(b===null?'':`;${b}`);edits.push({caseId:`q${c+1}`,taskKey:key,response:answer,model:error.model});
   }
   answers[`q${c+1}`]=answer;
  }
  works.push({profile:p.id,kind:p.kind,skill,level,repeat,taskKeys,answers,expectedPass,edits});
 }
}
const matrices=[{id:'backend-python',specialization:'Backend / Python',stack:['Python','SQL'],mandatory:['python','sql','backend-engineering']},{id:'backend-typescript',specialization:'Backend / Python',stack:['TypeScript','SQL'],mandatory:['typescript','sql','backend-engineering']},{id:'frontend-typescript-react',specialization:'Frontend / TypeScript',stack:['TypeScript','React'],mandatory:['typescript','react','frontend-engineering']}];
const categoryLabels=[];
for(const p of profiles)for(const level of p.levels)for(const matrix of matrices){const pass=matrix.mandatory.every(skill=>moduleLabels.find(l=>l.profile===p.id&&l.skill===skill&&l.level===level).expectedPass);categoryLabels.push({profile:p.id,level,matrix:matrix.id,expectedGrade:pass?level:null,basis:'All and only the published mandatory modules; Backend language alternative is explicitly declared; no lower-level evidence synthesized'});}
// Syntax is judged against public response domains, before scorer or comparison with keys.
const syntaxFailures=[];
for(const w of works.filter(w=>w.kind==='complete-semantic-error'||w.kind==='reference'))for(let c=0;c<6;c++){
 const r=publics.get(w.taskKeys[c]),raw=w.answers[`q${c+1}`],fragments=raw.split(';'),visible=parts(r);
 if(fragments.length!==(r.level==='Junior'?1:2)){syntaxFailures.push({task:r.key,raw,reason:'part count'});continue;}
 for(let i=0;i<fragments.length;i++){
  const f=fragments[i];const choices=r.level==='Junior'&&r.options?r.options.map((_,index)=>`o${index+1}`):options(visible[i]).map(o=>o.wire);
  if(choices.length&&!choices.includes(f))syntaxFailures.push({task:r.key,raw,reason:'choice outside public ids'});
  if(!choices.length&&(r.partTypes?.[i]??r.responseType)==='integer'&&!/^[+-]?\d+$/.test(f))syntaxFailures.push({task:r.key,raw,reason:'integer syntax'});
  if(!f.trim())syntaxFailures.push({task:r.key,raw,reason:'empty part'});
 }
}
assert.equal(syntaxFailures.length,0,JSON.stringify(syntaxFailures));
const misconceptions=errors.map(e=>({...e,targets:e.targets.map(t=>({...t,primaryChoice:t.primaryChoice?.source,secondaryChoice:t.secondaryChoice?.source}))}));
const payload={frozenAt:new Date().toISOString(),status:'Frozen before scorer execution',sourceHashes,bankSourceHashes:pub.sourceHashes,provenance:'Retained independent semantic worksheets, public textual option mapping only. New mistake models and expected labels authored from public contracts before scoring. Author has seen bank source and prior evidence; this is not a claim of complete author blindness.',vectors,profiles,misconceptions,matrices,moduleLabels,categoryLabels,works,syntaxValidation:{checkedCompleteAnswers:works.filter(w=>w.kind==='complete-semantic-error'||w.kind==='reference').length*6,syntaxFailures},limitations:['Synthetic contract/misconception exercise, not human difficulty, hiring discrimination or threshold calibration.','Three repeated forms vary unaffected scenarios but keep the targeted misconception scenario at n5true; they do not span every n/flag or model all knowledge deficits.','Existing omission/format controls remain intentionally invalid or incomplete; their rejection is not evidence of knowledge separation.','A single noncritical mistake can pass5/6, including Middle SQL row-CAS and Senior React stale validation; labels explicitly preserve that behavior.','Prior pre-exposure and lost exact V1 public bytes remain disclosed; new hashes do not repair historical loss.']};
const path=`${dir}/b4-v6-editorial-c01-vectors-and-labels-${revision}-frozen.json`;writeFileSync(path,JSON.stringify(payload,null,2),{flag:'wx'});
writeFileSync(`${dir}/b4-${revision}-freeze-receipt.json`,JSON.stringify({frozenAt:payload.frozenAt,path,sha256:sha(readFileSync(path)),publicInputSha256:sourceHashes[`${dir}/public-input-${revision}-frozen.json`],vectors:vectors.length,moduleWorks:works.length,categoryGroups:categoryLabels.length,completeKnowledgeModels:errors.length},null,2),{flag:'wx'});
console.log(JSON.stringify({vectors:vectors.length,moduleWorks:works.length,categoryGroups:categoryLabels.length,completeKnowledgeModels:errors.length,syntaxFailures:syntaxFailures.length}));

import assert from 'node:assert/strict';
import test from 'node:test';
import {readFileSync} from 'node:fs';
import {juniorProtocolChoicesV6} from '../artifacts/api-server/src/lib/skill-junior-protocol-choices-v6';
import {skillScenarioFixture,skillContentFamilyId,skillModuleTemplates,buildSkillAttempt,skillModulePolicy} from '../artifacts/api-server/src/lib/skill-module-bank';
import {skillOverrideStatus} from '../artifacts/api-server/src/lib/skill-bank-operator-policy';

test('C01 both branches of two critical families preserve public ownership/operation contracts over all20 variants',()=>{
 let checked=0;
 for(const [c,s]of [[0,1],[5,0]]){
  const ranks=new Set<number>();
  for(let n=5;n<=9;n++)for(const flag of [false,true]){
   const choices=juniorProtocolChoicesV6('frontend-engineering',c,s,n,flag)!;
   assert.equal(choices.length,4);assert.equal(new Set(choices).size,4);
   const expected=c===0?flag?
    'Владелец фильтра: проверяемый URL; Back: прочитать фильтр URL; Ключ запроса: фильтр и права аккаунта.':
    'Владелец текста: local draft формы; Server snapshot: хранить отдельно от ввода; Применённый фильтр: менять при явном применении.':flag?
    'Snapshot/revision: обновить из актуального success; Draft: зафиксировать сохранённый draft; Feedback/focus: объявить успех, фокус сохранить.':
    'Проверка ответа: operation identity не совпала; Draft/conflict: сохранить локальный ввод и конфликт; Следующая запись: после сравнения и решения автора.';
   assert.equal(skillScenarioFixture('frontend-engineering','Junior',c,s,n,flag).answer,expected);
   assert.equal(choices[0],expected);
   ranks.add(1+choices.filter(v=>v.length<expected.length).length);checked++;
  }
  assert.ok(ranks.size>1,'same length-rank cannot identify every branch');
  assert.notDeepEqual([...ranks],[2]);
 }
 assert.equal(checked,20);
});

test('C02 frozen complete knowledge errors use the public domains, filled parts and correct trace arity',()=>{
 const dir='outputs/verification/correction-01-20261008/bank';
 const frozen=JSON.parse(readFileSync(`${dir}/b4-v6-editorial-c01-vectors-and-labels-v2-frozen.json`,'utf8'));
 const publicRows=new Map<string,any>(JSON.parse(readFileSync(`${dir}/public-input-v2-frozen.json`,'utf8')).rows.map((r:any)=>[r.key,r]));
 const gold=new Map<string,any>(frozen.vectors.map((r:any)=>[r.key,r]));
 let edits=0;
 for(const work of frozen.works.filter((w:any)=>w.kind==='complete-semantic-error'))for(const edit of work.edits){
  const r=publicRows.get(edit.taskKey),ref=gold.get(edit.taskKey),fragments=edit.response.split(';');
  assert.equal(fragments.length,r.level==='Junior'?1:2);assert.ok(fragments.every((s:string)=>s.trim().length));
  const visible=r.level==='Junior'?[r.prompt]:r.prompt.split(r.level==='Middle'?'\n\nЧасть B':'\n\nЧасть 2');
  for(const [i,fragment]of fragments.entries()){
   const choices=r.level==='Junior'&&r.options?r.options.map((_:unknown,index:number)=>`o${index+1}`):[...visible[i].matchAll(/^([1-4])\. (.+)$/gm)].map(m=>m[1]);
   if(choices.length){assert.ok(choices.includes(fragment));continue;}
   const referenceFragment=i===0?ref.primaryWireResponse:ref.secondaryWireResponse;
   assert.equal(fragment.split('|').length,referenceFragment.split('|').length,edit.taskKey);
   for(const [index,token]of fragment.split('|').entries()){
    const sample=referenceFragment.split('|')[index];
    if(/^[+-]?\d+$/.test(sample))assert.match(token,/^[+-]?\d+$/);
    else assert.ok(visible[i].includes(token),`trace literal ${token} must be grounded in public scenario`);
   }
  }
  edits++;
 }
 assert.equal(edits,24);
 const middleChoices=frozen.vectors.filter((r:any)=>r.level==='Middle'&&/^([1-4])\. /m.test(publicRows.get(r.key).prompt.split('\n\nЧасть B')[0]));
 assert.equal(middleChoices.length,44);
 assert.ok(middleChoices.every((r:any)=>r.primarySemanticStatement!==r.primaryWireResponse));
});

test('C01 editorial keeps both critical stable lineages, old disable/exposure aliases and unchanged gates',()=>{
 assert.equal(skillModulePolicy.threshold,83);
 for(const [c,s]of [[0,1],[5,0]])for(const level of ['Junior','Middle'] as const){
  const t=skillModuleTemplates.find(t=>t.skillId==='frontend-engineering'&&t.level===level&&t.competencyIndex===c&&t.scenarioIndex===s)!;
  const old=t.id.replace('-v6:','-v5:');assert.equal(skillContentFamilyId(t.id),skillContentFamilyId(old));
  assert.equal(skillOverrideStatus(t.id,[{templateId:old,status:'disabled'}]),'disabled');
  const personalExposures=new Map([[old,1]]);
  const f=buildSkillAttempt('frontend-engineering',level,'correction01-lineage',{personalExposures});
  assert.ok(f.cases.every(row=>row.templateId!==t.id));
  assert.ok(f.cases.find(row=>row.competencyId===t.competencyId)!.critical);
 }
});

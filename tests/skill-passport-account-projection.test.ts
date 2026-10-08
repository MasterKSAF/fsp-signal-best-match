import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPassportAccountSkills, type PassportResumeContext } from '../artifacts/api-server/src/lib/skill-passport-projection';
import { getSkillQualification, selectAccountSkillEvidence, type SkillQualificationInputs, type SkillModuleEvidence } from '../artifacts/api-server/src/lib/skill-module-qualification';
import { skillModuleRegistry } from '../artifacts/api-server/src/lib/skill-module-bank';
const resume = (id:number, specialization='Backend / Python', assumedGrade:'Junior'|'Middle'|'Senior'='Middle', stack=['Python']):PassportResumeContext => ({id,userId:72,title:id===1?'Backend-разработчик':'Разработчик',specialization,assumedGrade,stack,skills:[]});
const evidence = (id:number, skillId:string, level:'Junior'|'Middle'='Junior'):SkillModuleEvidence => { const competencies=skillModuleRegistry.find(m=>m.id===skillId)!.competencies; return {id,userId:72,attemptId:id,skillId,level,programVersion:'signal-skills-2026-10-v1',competencyIds:[...competencies],verifiedAt:new Date('2026-10-08T10:00:00Z'),decision:{score:100,passed:true,criticalComplete:true,competencies:competencies.map(id=>({id,passed:true,critical:false})),threshold:80}} as SkillModuleEvidence; };
const empty:SkillQualificationInputs = {evidence:[],revokedIds:new Set()};
const proofs = (inputs:SkillQualificationInputs) => selectAccountSkillEvidence({userId:72,specialization:'',assumedGrade:'Junior',stack:[],skills:[]},inputs);

test('account proofs survive zero resumes and are not limited to the active specialization',()=>{
  const inputs={evidence:[evidence(1,'python'),evidence(2,'react')],revokedIds:new Set<number>()};
  assert.deepEqual(proofs(inputs).map(p=>p.skillId),['python','react']);
  assert.deepEqual(projectPassportAccountSkills([],inputs,proofs(inputs)),[]);
  assert.equal(JSON.stringify(inputs.evidence),JSON.stringify([evidence(1,'python'),evidence(2,'react')]));
});
test('canonical aliases deduplicate across CVs; a confirmed Python never becomes a declared copy',()=>{
  const inputs={evidence:[evidence(1,'python')],revokedIds:new Set<number>()};
  const contexts=[resume(1,'Backend / Python','Middle',['Py','Python','FastAPI']),resume(2,'Backend / Python','Middle',['python','FastAPI'])];
  const rows=projectPassportAccountSkills(contexts,inputs,proofs(inputs));
  const python=rows.filter(s=>s.skillId==='python'); assert.equal(python.length,1); assert.equal(python[0].state,'recommended'); assert.equal(python[0].verifiedLevel,'Junior'); assert.equal(python[0].targetLevel,'Middle');
  const fastapi=rows.filter(s=>s.label==='FastAPI'); assert.equal(fastapi.length,1); assert.equal(fastapi[0].state,'declared'); assert.deepEqual(fastapi[0].resumeIds,[1,2]);
});
test('SQL does not verify PostgreSQL, nor Python FastAPI; source owners/revocations are exact',()=>{
  const foreign={...evidence(3,'react'),userId:99}; const revoked=evidence(4,'typescript');
  const inputs={evidence:[evidence(1,'sql','Middle'),evidence(2,'python','Middle'),foreign,revoked],revokedIds:new Set([4])};
  assert.deepEqual(proofs(inputs).map(p=>p.skillId),['python','sql']);
  const rows=projectPassportAccountSkills([resume(1,'Backend / Python','Middle',['Python','SQL','Postgres','FastAPI'])],inputs,proofs(inputs));
  assert.equal(rows.find(s=>s.label==='PostgreSQL')?.state,'declared'); assert.equal(rows.find(s=>s.label==='FastAPI')?.state,'declared');
  assert.ok(!rows.some(s=>s.skillId==='python'||s.skillId==='sql'));
});
test('all real resume recommendations deduplicate with exact affiliations and highest target; current Junior proof is retained',()=>{
  const inputs={evidence:[evidence(1,'sql')],revokedIds:new Set<number>()};
  const contexts=[resume(2,'Backend / Python','Middle'),resume(1,'Backend / Python','Senior'),resume(3,'Frontend / TypeScript','Middle',['TypeScript','React'])];
  const rows=projectPassportAccountSkills(contexts,inputs,proofs(inputs));
  assert.deepEqual(rows.find(s=>s.skillId==='sql')?.resumeIds,[1,2]); assert.equal(rows.find(s=>s.skillId==='sql')?.targetLevel,'Senior'); assert.equal(rows.find(s=>s.skillId==='sql')?.verifiedLevel,'Junior');
  for (const skillId of ['typescript','react','frontend-engineering']) assert.deepEqual(rows.find(s=>s.skillId===skillId)?.resumeIds,[3]);
  assert.equal(proofs(inputs)[0].level,'Junior');
});
test('an unsupported role never receives guessed Backend/Frontend recommendations',()=>{
  const rows=projectPassportAccountSkills([resume(1,'AI / Custom','Middle',['Py','Docker'])],empty,[]);
  assert.ok(rows.every(s=>s.state==='declared')); assert.deepEqual(rows.map(s=>s.label).sort(),['Docker','Python']);
});
test('optional tags do not change mandatory coverage and deleting SQL cannot evade its requirement',()=>{
  const base=resume(1); const optional={...base,skills:['Docker','FastAPI','PostgreSQL']}; const explicit={...base,skills:['SQL']};
  assert.deepEqual(getSkillQualification(base,empty).coverage,getSkillQualification(optional,empty).coverage);
  assert.deepEqual(getSkillQualification(base,empty).coverage,getSkillQualification(explicit,empty).coverage);
  const rows=projectPassportAccountSkills([optional],empty,[]); assert.equal(rows.find(s=>s.skillId==='sql')?.state,'recommended'); assert.equal(rows.find(s=>s.label==='PostgreSQL')?.state,'declared');
});

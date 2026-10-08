import assert from 'node:assert/strict';
import test from 'node:test';
import { projectPassportAccountSkills, type PassportResumeContext } from '../artifacts/api-server/src/lib/skill-passport-projection';
import { bindPassportSkill, passportNextResume } from '../artifacts/fsp-signal/src/lib/skill-passport-context';
const resumes: PassportResumeContext[] = [
  {id:1,userId:72,title:'Backend Middle',specialization:'Backend / Python',assumedGrade:'Middle',stack:['Python'],skills:[]},
  {id:2,userId:72,title:'Backend Senior',specialization:'Backend / Python',assumedGrade:'Senior',stack:['Py'],skills:[]},
];
const input = { evidence: [], revokedIds: new Set<number>() };
test('one canonical recommendation retains each CV target/reason and binds opposite active CV filters exactly', () => {
  const before=JSON.stringify(resumes);
  const python=projectPassportAccountSkills(resumes,input,[]).find(s=>s.skillId==='python')!;
  assert.equal(python.targetLevel,'Senior'); assert.deepEqual(python.resumeIds,[1,2]);
  assert.deepEqual(python.contexts.map(c=>[c.resumeId,c.state,c.targetLevel]),[[1,'recommended','Middle'],[2,'recommended','Senior']]);
  assert.ok(python.contexts.every(c=>typeof c.reason==='string' && c.reason.length));
  for (const [filter,active,level,id] of [['1',2,'Middle',1],['2',1,'Senior',2]] as const) {
    const bound=bindPassportSkill(python,filter,active)!;
    assert.equal(bound.targetLevel,level); assert.equal(bound.resumeId,id); assert.deepEqual(bound.resumeIds,[id]);
    const href=`/candidate/kalibr?skill=${bound.skillId}&level=${bound.targetLevel}&resumeId=${bound.resumeId}`;
    const params=new URL(href,'http://localhost').searchParams;
    assert.equal(params.get('skill'),'python'); assert.equal(params.get('level'),level); assert.equal(params.get('resumeId'),String(id));
  }
  assert.equal(JSON.stringify(resumes),before);
});
test('all-CV maximum chooses a CV requiring that exact level, rather than blindly choosing active CV', () => {
  const python=projectPassportAccountSkills(resumes,input,[]).find(s=>s.skillId==='python')!;
  assert.equal(bindPassportSkill(python,'all',1)?.resumeId,2);
  assert.equal(bindPassportSkill(python,'all',1)?.targetLevel,'Senior');
  const tied=projectPassportAccountSkills([resumes[1],{...resumes[1],id:3}],input,[]).find(s=>s.skillId==='python')!;
  assert.equal(bindPassportSkill(tied,'all',3)?.resumeId,3); assert.equal(bindPassportSkill(tied,'all',null)?.resumeId,2);
});
test('filter preserves a declared CV affiliation rather than promoting another CV recommendation', () => {
  const rows=projectPassportAccountSkills([resumes[0],{...resumes[1],specialization:'Custom AI'}],input,[]);
  const python=rows.find(s=>s.skillId==='python')!;
  assert.equal(bindPassportSkill(python,'2',1)?.state,'declared'); assert.equal(bindPassportSkill(python,'2',1)?.targetLevel,null);
  assert.equal(bindPassportSkill(python,'1',2)?.state,'recommended'); assert.equal(bindPassportSkill(python,'99',1),null);
});
test('account next-level attempts honour selected CV; no-CV state neither invents a context nor changes proofs', () => {
  const python=projectPassportAccountSkills(resumes,input,[]).find(s=>s.skillId==='python')!;
  const recommendation=bindPassportSkill(python,'all',1);
  assert.equal(passportNextResume('1',[1,2],2,recommendation),1);
  assert.equal(passportNextResume('2',[1,2],1,recommendation),2);
  assert.equal(passportNextResume('all',[1,2],1,recommendation),2);
  assert.equal(passportNextResume('all',[],null,null),null);
  assert.deepEqual(projectPassportAccountSkills([],input,[]),[]);
});

import assert from 'node:assert/strict';
import test from 'node:test';
import { passportRelatedSkillIds, projectPassportAccountSkills, type PassportResumeContext } from '../artifacts/api-server/src/lib/skill-passport-projection';
import { getResumeQualification } from '../artifacts/api-server/src/lib/signal-resume-qualification';
import { evaluateGradeRequirement, evaluateSkillRequirement } from '../artifacts/api-server/src/lib/recruiting-requirements';
import { bindPassportSkill, passportMode, passportNextResume, passportProofs } from '../artifacts/fsp-signal/src/lib/skill-passport-context';
import { qualificationGradeLabel, qualificationSourceLabel } from '../artifacts/fsp-signal/src/lib/qualification-presentation';
import { infoBounds, infoPosition } from '../artifacts/fsp-signal/src/lib/inline-info-position';

const inputs={evidence:[],revokedIds:new Set<number>()};
const backend:PassportResumeContext={id:1,userId:72,title:'Backend',specialization:'Backend / Python',assumedGrade:'Middle',stack:['Py','FastAPI'],skills:[]};
const frontend:PassportResumeContext={...backend,id:2,title:'Frontend',specialization:'Frontend / TypeScript',stack:['TypeScript','React']};
test('passport exact/all/none keep ownership separate from role affiliation and declarations',()=>{
  const proofs=[{skillId:'python',level:'Junior',evidenceId:7},{skillId:'react',level:'Middle',evidenceId:8},{skillId:'sql',level:'Middle',evidenceId:9}];
  const contexts=[backend,frontend].map(resume=>({id:resume.id,relatedSkillIds:passportRelatedSkillIds(resume,inputs)}));
  assert.deepEqual(contexts[0].relatedSkillIds,['backend-engineering','python','sql']);
  assert.deepEqual(contexts[1].relatedSkillIds,['frontend-engineering','react','typescript']);
  assert.deepEqual(passportProofs(proofs,'1',contexts).map(proof=>proof.skillId),['python','sql']);
  assert.deepEqual(passportProofs(proofs,'2',contexts).map(proof=>proof.skillId),['react']);
  for(const mode of ['all','none'] as const) assert.deepEqual(passportProofs(proofs,mode,contexts),proofs);
  const accountSkills=projectPassportAccountSkills([backend,frontend],inputs,[]);
  assert.equal(accountSkills.filter(skill=>bindPassportSkill(skill,'none',1)).length,0);
  assert.ok(accountSkills.map(skill=>bindPassportSkill(skill,'1',2)).filter(Boolean).every(skill=>skill!.resumeIds.includes(1)));
  assert.equal(passportNextResume('none',[1,2],1,null),null);
});
test('passport invalid/deleted/foreign CV URL falls back without inventing a CV or deleting proofs',()=>{
  assert.equal(passportMode('2',[1]),'all');assert.equal(passportMode('2',[1,2]),'2');
  for(const value of ['0','-1','1.2','bad',null])assert.equal(passportMode(value,[1]),'all');
  assert.equal(passportMode('none',[]),'none');assert.equal(passportMode('all',[]),'all');
  const proof={skillId:'python',evidenceId:7};assert.deepEqual(passportProofs([proof],'none',[]),[proof]);
  assert.deepEqual(projectPassportAccountSkills([],inputs,[]),[]);
});
test('untraced legacy skill names never satisfy verified requirements; historical overall grade remains',()=>{
  const legacy={specialization:'Backend / Python',grade:'Middle' as const,score:92,skills:['Python'],assessedAt:'2026-09-18T09:00:00Z',gradeChangedAt:null,attemptId:null,limitation:'Historical aggregate'};
  const before=JSON.stringify(legacy),qualification=getResumeQualification({userId:9,specialization:legacy.specialization,legacyQualification:legacy},[]);
  assert.equal(qualification.verifiedGrade,'Middle');assert.equal(qualification.source,'legacy');assert.deepEqual(qualification.verifiedSkills,[]);assert.deepEqual(qualification.evidence,[]);
  const candidate={userId:9,specialization:legacy.specialization,verifiedGrade:qualification.verifiedGrade,assumedGrade:'Middle' as const,verifiedSkills:qualification.verifiedSkills,skillEvidence:[],stack:['Python'],statedSkills:[],assessmentEvidence:null};
  const strict=evaluateSkillRequirement({skill:'Python',mode:'verified'},candidate);
  assert.equal(strict.verified,false);assert.equal(strict.covered,false);assert.equal(strict.source,'declared');
  assert.equal(evaluateSkillRequirement({skill:'Python',mode:'declared_or_verified'},candidate).covered,true);
  assert.equal(evaluateGradeRequirement('Middle','verified',candidate).satisfied,true);
  assert.equal(qualificationGradeLabel(qualification),'Подтверждённый грейд: Middle');assert.equal(qualificationSourceLabel(qualification),'Исторический общий грейд');
  assert.equal(qualificationGradeLabel({verifiedGrade:null,assumedGrade:'Middle'}),'Заявленный грейд: Middle');
  assert.equal(JSON.stringify(legacy),before);
});
test('tooltip geometry stays inside dialog and visual viewport at zoom with long text',()=>{
  const scenarios=[
    {view:{left:0,top:0,width:1280,height:720},dialog:{left:350,top:110,width:570,height:490}},
    {view:{left:0,top:0,width:320,height:400},dialog:{left:0,top:100,width:320,height:300}},
    {view:{left:130,top:80,width:195,height:260},dialog:{left:0,top:0,width:390,height:844}},
  ];
  for(const {view,dialog} of scenarios){
    const bounds=infoBounds(view,dialog);
    for(const box of [{width:280,height:130},{width:580,height:1600}])for(const anchor of [{left:bounds.left,top:bounds.top,bottom:bounds.top+21},{left:bounds.left+bounds.width-10,top:bounds.top+bounds.height-20,bottom:bounds.top+bounds.height}]){
      const position=infoPosition(anchor,box,bounds);
      assert.ok(position.left>=bounds.left&&position.top>=bounds.top);
      assert.ok(position.left+Math.min(box.width,position.maxWidth)<=bounds.left+bounds.width);
      assert.ok(position.top+Math.min(box.height,position.maxHeight)<=bounds.top+bounds.height);
    }
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { invitationContextProjection, invitationPublicCompany, PRIVATE_REQUEST_INVITATION_LABEL } from '../artifacts/api-server/src/lib/invitation-public-projection';
import { candidateAssessmentContextSnapshot } from '../artifacts/api-server/src/lib/assessment-context-public-projection';
import { snapshotForNeed, snapshotForProfile } from '../artifacts/api-server/src/lib/assessment-context';
import { ContextCreateInvitationBody } from '../artifacts/api-server/src/lib/invitation-context-input';

const privateTitle='INTERNAL-TITLE-privacy-test';
const privateDescription='INTERNAL-DESCRIPTION-privacy-test';
const sent={title:'Предлагаем обсудить работу',message:'Сообщение, явно введённое работодателем',reason:'Подходящий опыт',
  salaryMin:150000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо'};
const invitation={needId:41,jobId:null,contextVersion:3,...sent,
  contextSnapshot:{type:'need',id:41,version:3,title:privateTitle,description:privateDescription,status:'active',
    notes:{text:privateDescription},shortlist:[{name:'INTERNAL-CANDIDATE'}],
    requiredSkills:['PRIVATE-SKILL'],invitationConditions:{...sent,internalNote:privateDescription}}};

test('candidate projection hides all need metadata in old and new snapshots and preserves explicitly sent conditions',()=>{
  const before=JSON.stringify(invitation);
  for(const record of [invitation,{...invitation,contextSnapshot:{}},{...invitation,contextSnapshot:null}]){
    const dto=invitationContextProjection(record,'candidate',{owner:true,candidate:true});
    const text=JSON.stringify(dto);
    for(const marker of [privateTitle,privateDescription,'INTERNAL-CANDIDATE','PRIVATE-SKILL'])assert.equal(text.includes(marker),false);
    assert.deepEqual(dto.context,{type:'need',id:41,version:3,title:PRIVATE_REQUEST_INVITATION_LABEL,available:false});
    assert.deepEqual(dto.contextSnapshot,{type:'need',id:41,version:3,title:PRIVATE_REQUEST_INVITATION_LABEL,
      invitationConditions:{title:sent.title,salaryMin:150000,salaryMax:220000,salaryPeriod:'month',salaryType:'gross',workFormat:'Удалённо'}});
  }
  assert.equal(JSON.stringify(invitation),before,'projection must not rewrite historical rows');
  assert.equal(invitationContextProjection({...invitation,title:privateTitle},'candidate').contextSnapshot?.invitationConditions !== undefined,true,
    'explicitly sent title is not censored by a private-title heuristic');
  assert.equal(JSON.stringify(invitationContextProjection({...invitation,title:privateTitle},'candidate')).includes(privateTitle),true);
});

test('employer retains complete historical snapshot after the live context is archived or deleted',()=>{
  const dto=invitationContextProjection(invitation,'employer');
  assert.equal(dto.context.title,privateTitle);assert.equal(dto.context.available,false);
  assert.deepEqual(dto.contextSnapshot,invitation.contextSnapshot);
  assert.equal(invitationContextProjection(invitation,'employer',{owner:true,candidate:false}).context.available,true);
});

test('public job label is from its sent published snapshot; draft/internal job metadata does not cross the boundary',()=>{
  const job={...invitation,needId:null,jobId:7,contextSnapshot:{...invitation.contextSnapshot,type:'job',status:'published',title:'Python-разработчик'}};
  const dto=invitationContextProjection(job,'candidate',{owner:true,candidate:true});
  assert.equal(dto.context.type,'job');assert.equal(dto.context.id,7);assert.equal(dto.context.title,'Python-разработчик');
  assert.equal(dto.context.available,true);assert.equal(JSON.stringify(dto).includes(privateDescription),false);
  assert.equal(invitationContextProjection({...job,contextSnapshot:{...job.contextSnapshot,status:'draft',title:privateTitle}},'candidate').context.title,sent.title);
  assert.equal(invitationContextProjection(job,'candidate').context.available,false);
});

test('public company card contains only intended profile fields',()=>{
  const company={id:32,name:'Вектор',description:'Разрабатываем продукты',industry:'ИТ',contactEmail:'hr@example.test',
    contactPhone:null,contactMethod:'Электронная почта',ownerUserId:303,inn:'1234567890',notes:privateDescription,createdAt:new Date()};
  assert.deepEqual(invitationPublicCompany(company),{id:32,name:'Вектор',description:'Разрабатываем продукты',industry:'ИТ',
    contactEmail:'hr@example.test',contactPhone:null,contactMethod:'Электронная почта'});
  assert.equal(invitationPublicCompany(null),null);
});

test('assessment list/detail projection strips private need title and raw requirements, including old saved snapshots',()=>{
  const stored={...snapshotForNeed({title:privateTitle,description:privateDescription,specialization:'Backend / Python',grade:'Middle',
    requiredSkills:['Python',privateDescription],desirableSkills:[]}),needId:41,companyId:32,notes:privateDescription};
  const before=JSON.stringify(stored);
  const dto=candidateAssessmentContextSnapshot(stored)!;
  assert.equal(dto.roleTitle,PRIVATE_REQUEST_INVITATION_LABEL);
  assert.deepEqual(dto.requirements,dto.context.skills);assert.deepEqual(dto.unsupportedRequirements,[]);
  for(const marker of [privateTitle,privateDescription,'needId','companyId','notes'])assert.equal(JSON.stringify(dto).includes(marker),false);
  assert.equal(JSON.stringify(stored),before);
  assert.deepEqual(candidateAssessmentContextSnapshot(snapshotForProfile('api-platform','Junior')),snapshotForProfile('api-platform','Junior'));
  assert.equal(candidateAssessmentContextSnapshot(null),null);assert.equal(candidateAssessmentContextSnapshot({source:'invitation'}),null);
});

test('invitation context validation rejects missing/both/null sources and unversioned needs as well as jobs',()=>{
  const base={...sent,candidateId:301,resumeId:287,contextVersion:3};
  assert.equal(ContextCreateInvitationBody.safeParse({...base,needId:41}).success,true);
  assert.equal(ContextCreateInvitationBody.safeParse({...base,jobId:33}).success,true);
  for(const source of [{},{needId:41,jobId:33},{needId:null},{needId:41,contextVersion:undefined},{jobId:33,contextVersion:undefined}]){
    assert.equal(ContextCreateInvitationBody.safeParse({...base,...source}).success,false);
  }
});

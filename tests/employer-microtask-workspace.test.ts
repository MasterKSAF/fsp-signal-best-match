import test from 'node:test';
import assert from 'node:assert/strict';
import { microAnswerSubmitted, microOfferCandidateIdentity, microOfferQuery, microOfferReadableFromFacts, microTemplateUpdateInput } from '../artifacts/api-server/src/lib/microtask-workspace-policy';
import { captureMicroResume, type MicroLiveResume } from '../artifacts/api-server/src/lib/microtask-resume-policy';

const company = {id:3,role:'employer',demoMode:false,reviewScopeId:null};
const candidate = {id:7,role:'candidate',demoMode:false,reviewScopeId:null,visibility:'pseudonymous',matching:true,enabled:true};
const resume:MicroLiveResume = {id:42,userId:7,revision:4,title:'Выбранное резюме',specialization:'Backend / Python',verifiedGrade:'Middle',verifiedSkills:['Python'],visibility:'pseudonymous',consentMatching:true,deletedAt:null};
const offer = {...captureMicroResume(resume,'Псевдоним'),companyId:3,candidateUserId:7,consentRevokedAt:null,acceptedAt:new Date('2026-10-01T10:00:00Z'),result:null};
const facts = {company,candidate,resume,blocked:false,companyAllowed:true};
test('Answer identity follows current exact CV visibility and current alias, never the saved old identity',()=>{
  const current = {...facts,candidate:{...candidate,alias:'Новый псевдоним',displayName:'Разрешённое имя'}};
  assert.deepEqual(microOfferCandidateIdentity(offer,current),{alias:'Новый псевдоним',displayName:null});
  assert.deepEqual(microOfferCandidateIdentity(offer,{...current,resume:{...resume,visibility:'public'}}),{alias:'Новый псевдоним',displayName:'Разрешённое имя'});
  assert.deepEqual(microOfferCandidateIdentity(offer,{...current,candidate:{...current.candidate,alias:null}}),{alias:'Кандидат',displayName:null});
});
test('Revoked, blocked, foreign or unavailable exact CV exposes no answer identity',()=>{
  for (const denied of [{...facts,blocked:true},{...facts,companyAllowed:false},{...facts,company:{...company,id:4}},{...facts,resume:{...resume,id:43}},{...facts,resume:{...resume,visibility:'private'}}]) assert.equal(microOfferCandidateIdentity(offer,denied),null);
  assert.equal(microOfferCandidateIdentity({...offer,consentRevokedAt:new Date()},facts),null);
});
test('Company answers keep exact CV access independent from consent to the catalog and current primary',()=>{
  assert.equal(microOfferReadableFromFacts(offer,facts),true);
  assert.equal(microOfferReadableFromFacts(offer,{...facts,resume:{...resume,id:43}}),false);
  assert.equal(microOfferReadableFromFacts(offer,{...facts,resume:{...resume,revision:12}}),true);
  assert.equal(microOfferReadableFromFacts(offer,{...facts,resume:{...resume,consentMatching:false}}),false);
  assert.equal(microOfferReadableFromFacts(offer,{...facts,resume:{...resume,visibility:'private'}}),false);
  assert.equal(microOfferReadableFromFacts(offer,{...facts,resume:{...resume,deletedAt:new Date()}}),false);
});
test('Revoke, blocks, restrictions, foreign company and review pools remove answer access',()=>{
  assert.equal(microOfferReadableFromFacts({...offer,consentRevokedAt:new Date()},facts),false);
  for (const patch of [{blocked:true},{companyAllowed:false},{company:{...company,id:4}},{company:{...company,role:'candidate'}},{candidate:{...candidate,id:8}},{candidate:{...candidate,demoMode:true,reviewScopeId:'11111111-1111-4111-8111-111111111111'}}]) {
    assert.equal(microOfferReadableFromFacts(offer,{...facts,...patch}),false);
  }
});
test('Legacy answers require recorded review history and never manufacture a resume binding',()=>{
  const legacy = {...offer,resumeId:null,resumeRevision:null,resumeContext:null,resumeProvenance:'legacy_unbound' as const};
  assert.equal(microOfferReadableFromFacts(legacy,{...facts,resume:undefined}),true);
  assert.equal(microOfferReadableFromFacts({...legacy,acceptedAt:null},{...facts,resume:undefined}),false);
  assert.equal(microOfferReadableFromFacts(legacy,{...facts,candidate:{...candidate,matching:false}}),false);
});
test('Assignments and accepted drafts are not answers, including a filled unsubmitted draft',()=>{
  for (const status of ['offered','accepted','declined','expired','withdrawn']) assert.equal(microAnswerSubmitted({status,answer:'Черновик'}),false);
  for (const status of ['submitted','evaluated']) {
    assert.equal(microAnswerSubmitted({status,answer:'Реальный отправленный ответ'}),true);
    assert.equal(microAnswerSubmitted({status,answer:null}),false);
    assert.equal(microAnswerSubmitted({status,answer:'  '}),false);
  }
});
test('Template-specific answer URLs reject ambiguous and invalid parameters',()=>{
  assert.deepEqual(microOfferQuery.parse({templateId:'42',submittedOnly:'1'}),{templateId:42,submittedOnly:'1'});
  for (const query of [{templateId:'0'},{templateId:'1.5'},{templateId:'2147483648'},{templateId:['1','2']},{submittedOnly:'true'},{templateId:'2',companyId:'3'}]) assert.equal(microOfferQuery.safeParse(query).success,false);
});
test('Editing requires an explicit current version and retains strict teaching and rubric rules',()=>{
  const template = {jobId:1,title:'Урок транзакции',competency:'SQL',specialization:'Backend / Python',scenario:'Опишите учебный подход к транзакции и восстановлению после сбоя на вымышленных данных.',expectedMinutes:20,intervalDays:7,deadlineDays:3,educationalOnly:true,rubric:[{id:'reason',label:'Понятный подход',maxPoints:5}]};
  assert.equal(microTemplateUpdateInput.parse({...template,version:3}).version,3);
  for (const patch of [{version:undefined},{version:0},{version:3.5},{version:3,expectedMinutes:90},{version:3,qualificationEffect:'Signal'},{version:3,rubric:[{id:'reason',label:'Понятный подход',maxPoints:5},{id:'reason',label:'Дубликат',maxPoints:5}]}]) assert.equal(microTemplateUpdateInput.safeParse({...template,...patch}).success,false);
});

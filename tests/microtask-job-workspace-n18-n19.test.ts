import test from 'node:test';
import assert from 'node:assert/strict';
import { capturedMicroJob,microJobAvailable,microJobProjection,type MicroJob } from '../artifacts/api-server/src/lib/microtask-job-policy';
import { microTemplateInput,captureMicroResume } from '../artifacts/api-server/src/lib/microtask-resume-policy';
import { microTemplateUpdateInput,microAnswerCounters,microAnswerMatches,microWorkspacePage,microWorkspacePageQuery,microOfferReadableFromFacts } from '../artifacts/api-server/src/lib/microtask-workspace-policy';
import { jobSearchInput } from '../artifacts/api-server/src/lib/job-discovery';
const job:MicroJob={id:42,companyId:3,title:'Учебная вакансия',version:2,specialization:'Backend / Python',status:'published',deletedAt:null};
const target={jobId:42,companyId:3,specialization:'Backend / Python'};
const input={jobId:42,title:'Задание по вакансии',specialization:target.specialization,competency:'SQL',scenario:'Предложите учебное решение обработки повтора запроса на вымышленных данных, опишите проверку.',expectedMinutes:20,intervalDays:7,deadlineDays:3,educationalOnly:true,rubric:[{id:'reason',label:'Обоснование',maxPoints:5}]};
test('N19 new/edit task input requires a real integer job reference without accepting shadow context fields',()=>{
 assert.equal(microTemplateInput.parse(input).jobId,42);
 assert.equal(microTemplateUpdateInput.parse({...input,version:2}).jobId,42);
 for(const jobId of [undefined,null,0,-1,1.5,'42',2147483648])assert.equal(microTemplateInput.safeParse({...input,jobId}).success,false,String(jobId));
 assert.equal(microTemplateInput.safeParse({...input,companyId:9}).success,false);
 assert.equal(microTemplateInput.safeParse({...input,needId:5}).success,false);
});
test('N19 only own exact live published job permits assignment; draft permits preparation only',()=>{
 assert.equal(microJobAvailable(job,target),true);assert.equal(microJobAvailable({...job,status:'draft'},target,'prepare'),true);
 assert.equal(microJobAvailable({...job,status:'draft'},target),false);
 for(const patch of [{companyId:8},{id:43},{specialization:'Frontend / TypeScript'},{status:'closed'},{status:'archived'},{deletedAt:new Date()}])assert.equal(microJobAvailable({...job,...patch},target),false);
 for(const patch of [{companyId:8},{id:43},{status:'closed'},{status:'archived'},{deletedAt:new Date()}])assert.equal(microJobAvailable({...job,...patch},target,'prepare'),false);
 assert.equal(microJobAvailable(undefined,target),false);assert.equal(microJobAvailable(job,{...target,jobId:null}),false);
 assert.equal(microJobProjection({...job,companyId:8},target),null);
});
test('N19 captured context survives rename/archive without adopting another job or adding private fields',()=>{
 const source={...job},snapshot=capturedMicroJob(source);source.title='Новое название';source.version=8;source.status='archived';
 assert.deepEqual(snapshot,{id:42,title:'Учебная вакансия',version:2,specialization:'Backend / Python'});
 assert.equal(microJobAvailable(source,target),false);assert.equal(microJobProjection(source,target)?.available,false);
 assert.equal(microJobAvailable(source,{...target,jobId:99}),false);
});
test('N18 all/new/evaluated counters match exact filtered answer sets; new zero cannot expose evaluated',()=>{
 const answers=[{id:1,status:'evaluated',answer:'Проверено'},{id:2,status:'accepted',answer:'Черновик'},{id:3,status:'submitted',answer:'  '},{id:4,status:'withdrawn',answer:'Отозвано'}];
 assert.deepEqual(microAnswerCounters(answers),{answerCount:1,newAnswerCount:0,evaluatedAnswerCount:1});
 assert.deepEqual(answers.filter(row=>microAnswerMatches(row,'new')),[]);
 assert.deepEqual(answers.filter(row=>microAnswerMatches(row,'evaluated')).map(row=>row.id),[1]);
 answers.push({id:5,status:'submitted',answer:'Новый ответ'});
 assert.deepEqual(microAnswerCounters(answers),{answerCount:2,newAnswerCount:1,evaluatedAnswerCount:1});
});
test('N18 authorized pagination reports its actual total and clamps an empty final page',()=>{
 const rows=Array.from({length:23},(_,id)=>({id}));
 assert.deepEqual(microWorkspacePage(rows,{page:2,pageSize:20}),{items:rows.slice(20),total:23,page:2,pageSize:20,pageCount:2});
 assert.equal(microWorkspacePage(rows,{page:99,pageSize:20}).page,2);
 assert.deepEqual(microWorkspacePage([],{page:2,pageSize:20}),{items:[],total:0,page:1,pageSize:20,pageCount:0});
 for(const query of [{filter:'offered'},{page:'0'},{pageSize:'101'},{companyId:'3'}])assert.equal(microWorkspacePageQuery.safeParse(query).success,false);
});
test('N18 recipients reuse fresh owner/role/CV/consent/block access before counting or paging',()=>{
 const binding={companyId:3,candidateUserId:7,resumeId:42,resumeRevision:2,resumeContext:null,resumeProvenance:'captured' as const,consentRevokedAt:null,acceptedAt:null,result:null};
 const company={id:3,role:'employer',demoMode:false,reviewScopeId:null},candidate={id:7,role:'candidate',demoMode:false,reviewScopeId:null,visibility:'public',matching:true,enabled:true};
 const resume={id:42,userId:7,revision:2,title:'Точное резюме',specialization:'Backend / Python',verifiedGrade:'Middle' as const,verifiedSkills:['Python'],visibility:'public',consentMatching:true,deletedAt:null};
 Object.assign(binding,captureMicroResume(resume,"N19 кандидат"));
 const facts={company,candidate,resume,blocked:false,companyAllowed:true};
 assert.equal(microOfferReadableFromFacts(binding,facts),true);
 for(const patch of [{blocked:true},{companyAllowed:false},{company:{...company,id:4}},{candidate:{...candidate,role:'employer'}},{resume:{...resume,userId:8}},{resume:{...resume,id:43}},{resume:{...resume,consentMatching:false}},{resume:{...resume,deletedAt:new Date()}}])assert.equal(microOfferReadableFromFacts(binding,{...facts,...patch}),false);
 assert.equal(microOfferReadableFromFacts({...binding,consentRevokedAt:new Date()},facts),false);
});
test('N19 job task filter is optional strict boolean and keeps other discovery conditions',()=>{
 assert.equal(jobSearchInput.parse({}).hasTask,false);
 const filters=jobSearchInput.parse({hasTask:'true',q:'Python',hideApplied:'true',skills:'[{"skill":"PostgreSQL","level":"Middle"}]'});
 assert.equal(filters.hasTask,true);assert.equal(filters.q,'Python');assert.equal(filters.hideApplied,true);
 assert.equal(jobSearchInput.parse({hasTask:'false'}).hasTask,false);
 assert.equal(jobSearchInput.safeParse({hasTask:'yes'}).success,false);
});

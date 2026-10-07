const fs = require('node:fs');
const { createRequire } = require('node:module');
const path = require('node:path');
const load = createRequire(path.resolve('lib/api-spec/node_modules/orval/package.json'));
const YAML = load('yaml');
const file = 'lib/api-spec/openapi.yaml';
const doc = YAML.parseDocument(fs.readFileSync(file, 'utf8'));
const integer = { type: 'integer', minimum: 1, maximum: 2147483647 };
for (const name of ['CandidateProfile', 'CandidateProfileInput', 'AssessmentStartInput', 'MatchCandidate', 'MatchExplanation', 'InvitationInput']) {
  doc.setIn(['components', 'schemas', name, 'properties', 'resumeId'], integer);
}
for (const name of ['AssessmentAttempt', 'AssessmentResult', 'AssessmentHistoryItem', 'Invitation']) {
  doc.setIn(['components', 'schemas', name, 'properties', 'resumeId'], { ...integer, nullable: true });
}
for (const name of ['CandidateProfile', 'CandidateProfileInput', 'MatchCandidate']) {
  doc.setIn(['components', 'schemas', name, 'properties', 'title'], { type: 'string', minLength: 2, maxLength: 120 });
  doc.setIn(['components', 'schemas', name, 'properties', 'revision'], integer);
}
for (const name of ['CandidateProfile', 'CandidateProfileInput']) {
  for (const key of ['consentCatalog', 'readyForOffers']) doc.setIn(['components', 'schemas', name, 'properties', key], { type: 'boolean' });
}
const parameters = doc.getIn(['paths', '/matches/explanation', 'get', 'parameters']);
if (!parameters.items.some(node => node.get('name') === 'resumeId')) parameters.add({ name: 'resumeId', in: 'query', required: true, schema: integer });
doc.setIn(['components', 'schemas', 'InvitationInput', 'properties', 'idempotencyKey'], { type: 'string', minLength: 8, maxLength: 128 });
doc.setIn(['components', 'schemas', 'Invitation', 'properties', 'companyId'], integer);
doc.setIn(['components', 'schemas', 'MatchCandidate', 'properties', 'resumeRevision'], integer);
const ref = name => ({ $ref: `#/components/schemas/${name}` });
const object = (properties, required = []) => ({ type: 'object', properties, ...(required.length ? { required } : {}) });
const str = (minLength, maxLength) => ({ type: 'string', ...(minLength ? { minLength } : {}), ...(maxLength ? { maxLength } : {}) });
const enumeration = values => ({ type: 'string', enum: values });
const arr = items => ({ type: 'array', items });
const schema = (name, value) => doc.setIn(['components', 'schemas', name], value);
schema('ResumeMetadata', object({ title: str(2,120), visibility: enumeration(['private','pseudonymous','public']), consentMatching: {type:'boolean'}, consentCatalog: {type:'boolean'}, readyForOffers: {type:'boolean'}, revision: integer }));
schema('OwnedResume', { allOf: [ref('CandidateResume'), ref('ResumeMetadata'), object({ id:integer, resumeId:integer, isPrimary:{type:'boolean'}, specialization: enumeration(['Backend / Python','Frontend / TypeScript']), verifiedGrade:{type:'string',nullable:true}, qualification:{type:'object',additionalProperties:true} }, ['id','resumeId','isPrimary','specialization','revision'])] });
schema('CreateOwnedResume', object({title:str(2,120),specialization:enumeration(['Backend / Python','Frontend / TypeScript']),copyFromId:integer},['title','specialization']));
schema('OwnedResumeList', object({resumes:arr(ref('OwnedResume')),count:{type:'integer',minimum:0,maximum:5},limit:{type:'integer',enum:[5]}},['resumes','count','limit']));
const categories = ['spam','misleading','discrimination','inappropriate','privacy','other'];
schema('ComplaintInput', object({objectType:enumeration(['company','job','invitation']),objectId:integer,category:enumeration(categories),explanation:str(0,2000),idempotencyKey:str(8,128)},['objectType','objectId','category','idempotencyKey']));
schema('TrustComplaint', object({id:integer,objectType:str(),objectId:integer,companyId:integer,category:enumeration(categories),explanation:str(),status:str(),decisionReason:{type:'string',nullable:true},createdAt:{type:'string',format:'date-time'}},['id','objectType','objectId','companyId','category','status']));
schema('EmployerRestriction', object({id:integer,scope:enumeration(['invitations','contacts','publishing','all']),publicReason:str(),expiresAt:{type:'string',format:'date-time'},liftedAt:{type:'string',nullable:true},appeal:{type:'object',nullable:true,additionalProperties:true}},['id','scope','publicReason','expiresAt']));
schema('ModerationDecisionInput', object({action:enumeration(['review','dismiss','restrict']),reason:str(5,2000),scope:enumeration(['invitations','contacts','publishing','all']),durationHours:{type:'integer',minimum:1,maximum:720},publicReasonCode:enumeration(categories)},['action','reason']));
schema('ResumeAlternative', object({resumeId:integer,title:str(),specialization:str(),verifiedGrade:{type:'string',nullable:true},revision:integer,resumeRevision:integer,evidenceDate:{type:'string',nullable:true}},['resumeId','title','specialization']));
doc.setIn(['components','schemas','MatchCandidate','properties','availableResumes'],arr(ref('ResumeAlternative')));
const errorRef = { $ref:'#/components/responses/ApiError' };
const json = value => ({'application/json':{schema:value}});
const idParam = { name:'id',in:'path',required:true,schema:integer };
function operation(route, method, operationId, response, body, description, status=200) {
  const op = {operationId,tags:[route.startsWith('/moderation')?'moderation':route.includes('resume')?'resumes':'trust'],description,responses:{[status]:{description:'Successful authorized operation',content:json(response)},400:errorRef,401:errorRef,403:errorRef,404:errorRef,409:errorRef,429:errorRef}};
  if (route.includes('{id}')) op.parameters=[idParam];
  if (body) op.requestBody={required:true,content:json(body)};
  doc.setIn(['paths',route,method],doc.createNode(op));
}
operation('/me/resumes','get','listOwnedResumes',ref('OwnedResumeList'),null,'Candidate owner only. Hidden and draft resumes count towards limit five.');
operation('/me/resumes','post','createOwnedResume',ref('OwnedResume'),ref('CreateOwnedResume'),'Atomic candidate-wide limit. New/copy resumes are private, opt-in false.',201);
operation('/me/resumes/{id}','get','getOwnedResume',ref('OwnedResume'),null,'Live owned resume only. Foreign/deleted ID gives 404.');
operation('/me/resumes/{id}','put','saveOwnedResume',ref('OwnedResume'),{allOf:[ref('CandidateResumeInput'),object({revision:integer})]},'Save full selected content. Stale revision gives409. Shared qualification is preserved.');
operation('/me/resumes/{id}','patch','editOwnedResumeMetadata',ref('OwnedResume'),ref('ResumeMetadata'),'Edit selected title/privacy/explicit publication and readiness.');
operation('/me/resumes/{id}','delete','deleteOwnedResume',object({},[]),null,'Soft-delete selected resume; shared proof/history remains.',204);
doc.setIn(['paths','/me/resumes/{id}','delete','responses','204'],{description:'Resume soft-deleted; no response body.'});
operation('/me/resumes/{id}/copy','post','copyOwnedResume',ref('OwnedResume'),null,'Copy owned content into private resume, within the same atomic limit.',201);
operation('/me/resumes/{id}/primary','post','setPrimaryOwnedResume',ref('OwnedResume'),null,'Assign primary for legacy compatibility; no rank bonus.');
operation('/me/resumes/{id}/pdf','get','downloadOwnedResumePdf',{type:'string',format:'binary'},null,'PDF from exactly the owned resume; contacts excluded.');
doc.setIn(['paths','/me/resumes/{id}/pdf','get','responses','200','content'],{'application/pdf':{schema:{type:'string',format:'binary'}}});
operation('/me/avatar','post','uploadCandidateAvatar',object({avatarDataUrl:{type:'string',nullable:true}}),object({dataUrl:str()},['dataUrl']),'Verified PNG/JPEG/WebP raster signature, maximum2MiB decoded; no SVG.');
operation('/me/avatar','delete','deleteCandidateAvatar',object({avatarDataUrl:{type:'string',nullable:true}}),null,'Delete shared candidate avatar.');
operation('/me/trust-status','get','getTrustStatus',object({moderator:{type:'boolean'}},['moderator']),null,'Server-issued moderator capability, never public registration.');
operation('/me/company-blocks','get','listCompanyBlocks',object({blocks:arr(object({companyId:integer,companyName:str(),active:{type:'boolean'},blockedAt:str(),unblockedAt:{type:'string',nullable:true}}))},['blocks']),null,'Candidate own blocks across all resumes.');
operation('/me/companies/{id}/block','put','setCompanyBlock',object({blocked:{type:'boolean'}}),object({blocked:{type:'boolean'}},['blocked']),'Block revokes current grants. Unblock does not restore revoked grants.');
operation('/me/complaints','get','listOwnComplaints',object({complaints:arr(ref('TrustComplaint'))},['complaints']),null,'Reporter own status and decision only.');
operation('/me/complaints','post','submitComplaint',object({complaint:ref('TrustComplaint'),replayed:{type:'boolean'}},['complaint','replayed']),ref('ComplaintInput'),'Addressed-access ACL; idempotency/dedup,10new complaints per rolling24h; no automatic sanction.',201);
operation('/employer/restrictions','get','listEmployerRestrictions',object({restrictions:arr(ref('EmployerRestriction'))},['restrictions']),null,'Owned company fixed public reasons only; reporter identity/raw explanation excluded.');
operation('/employer/restrictions/{id}/appeals','post','appealEmployerRestriction',object({appeal:{type:'object',additionalProperties:true}}),object({explanation:str(10,2000)},['explanation']),'Owned restriction appeal; different moderator resolves it.');
operation('/moderation/queue','get','getModerationQueue',object({complaints:arr(ref('TrustComplaint')),appeals:arr({type:'object',additionalProperties:true})},['complaints','appeals']),null,'Explicit server moderator capability. Own company excluded. Private queue.');
operation('/moderation/complaints/{id}/decision','post','decideComplaint',object({},[]),ref('ModerationDecisionInput'),'Reason required. Scoped expiry; immutable audit. Replay must preserve exact restriction fields.');
operation('/moderation/restrictions/{id}/lift','post','liftEmployerRestriction',object({},[]),object({reason:str(5,2000)},['reason']),'Explicit moderator removal and immutable audit.');
operation('/moderation/appeals/{id}/decision','post','decideEmployerAppeal',object({},[]),object({action:enumeration(['accept','reject']),reason:str(5,2000)},['action','reason']),'Must be a different moderator from restriction issuer; no self-company decision.');
operation('/moderation/audit','get','getModerationAudit',object({events:arr({type:'object',additionalProperties:true})},['events']),null,'Read-only immutable audit, excludes own company.');
const matchesParams=doc.getIn(['paths','/matches','get','parameters']);
for(const p of [{name:'resumeId',in:'query',schema:integer},{name:'resumeIds',in:'query',schema:{type:'string'},description:'Comma separated at most100resumeIDs; oneperperson. Exclusive withresumeId.'}]) if(!matchesParams.items.some(n=>(typeof n.get === 'function' ? n.get('name') : n.name)===p.name)) matchesParams.add(p);
for(const route of ['/assessments/attempts/{id}','/assessments/attempts/{id}/answers','/assessments/attempts/{id}/submit']) {
 const method=route.endsWith('/answers')?'put':route.endsWith('/submit')?'post':'get';const params=doc.getIn(['paths',route,method,'parameters']);
 if(params&&!params.items.some(n=>(typeof n.get === 'function' ? n.get('name') : n.name)==='resumeId'))params.add({name:'resumeId',in:'query',schema:integer,description:'If supplied, must equal immutable attempt target, even after target deletion.'});
}
const instant = {type:'string',format:'date-time'};
const nullableInstant = {...instant,nullable:true};
doc.setIn(['components','schemas','UserSummary','properties','reviewMode'],{type:'boolean',description:'Computed from persisted server-only review cohort. Review accounts take real exams; they have no overview Demo shortcuts.'});
schema('QualificationBasis',object({purpose:enumeration(['signal_qualification']),source:enumeration(['signal_assessment']),attemptId:integer,resumeId:{...integer,nullable:true},resumeRevision:{...integer,nullable:true},specialization:{type:'string',nullable:true},programId:str(),programVersion:{type:'string',nullable:true},declaredGrade:enumeration(['Junior','Middle','Senior']),gradeConfirmedAt:nullableInstant,confirmationOrigin:enumeration(['candidate_confirmed','legacy_unrecorded'])},['purpose','source','attemptId','resumeId','resumeRevision','specialization','programId','programVersion','declaredGrade','gradeConfirmedAt','confirmationOrigin']));
for(const name of ['AssessmentAttempt','AssessmentResult','AssessmentHistoryItem']) {
  doc.setIn(['components','schemas',name,'properties','purpose'],enumeration(['signal_qualification']));
  doc.setIn(['components','schemas',name,'properties','programVersion'],{type:'string',nullable:true});
  doc.setIn(['components','schemas',name,'properties','declaredGrade'],enumeration(['Junior','Middle','Senior']));
  doc.setIn(['components','schemas',name,'properties','qualificationBasis'],ref('QualificationBasis'));
}
doc.setIn(['components','schemas','AssessmentStartInput','properties','purpose'],enumeration(['signal_qualification']));
doc.setIn(['components','schemas','AssessmentStartInput','properties','gradeConfirmed'],{type:'boolean',enum:[true]});
doc.setIn(['components','schemas','AssessmentStartInput','required'],['programId','grade','purpose','gradeConfirmed','resumeId']);
doc.setIn(['components','schemas','AssessmentStartInput','additionalProperties'],false);
doc.setIn(['components','schemas','AssessmentStartInput','description'],'Server fixes purpose, selected resume/program/version and candidate-confirmed grade at issue. Vacancy context may shape cases, but cannot override the candidate grade. Company tasks use separate microtask routes and never award Signal grade. Candidate/program cooldown applies to all resumes and reviewer accounts.');
doc.setIn(['components','schemas','AssessmentContextSnapshot','properties','vacancyGrade'],enumeration(['Junior','Middle','Senior']));
for(const name of ['AssessmentAnswersInput']) doc.setIn(['components','schemas',name,'additionalProperties'],false);
for(const key of ['code','retryAt']) doc.setIn(['components','schemas','ApiError','properties',key],key==='retryAt'?instant:str());
const safeResume=object({resumeId:integer,resumeRevision:integer,title:str(),specialization:str(),verifiedGrade:{type:'string',nullable:true},verifiedScore:{type:'number',nullable:true},verifiedSkills:arr(str()),stack:arr(str()),yearsExperience:{type:'number'},experienceSource:enumeration(['self_reported']),workFormat:str(),salaryMin:{type:'number',nullable:true},salaryMax:{type:'number',nullable:true},salaryPeriod:enumeration(['month','year']),salaryType:enumeration(['gross','net']),readyForOffers:{type:'boolean'},evidenceDate:nullableInstant},['resumeId','resumeRevision','title','specialization','verifiedGrade','verifiedSkills']);
schema('CatalogCandidate',{allOf:[safeResume,object({candidateId:integer,alias:str(),publicName:{type:'string',nullable:true},avatarDataUrl:{type:'string',nullable:true},fspHistory:{type:'boolean'},skillEvidence:arr({type:'object',additionalProperties:true}),badges:arr({type:'object',additionalProperties:true}),qualificationBasis:{type:'object',nullable:true,additionalProperties:true},availableResumes:arr(ref('ResumeAlternative')),whySuitable:arr(str()),matching:{type:'object',nullable:true,additionalProperties:true}},['candidateId','alias','availableResumes'])]});
schema('CandidateCatalog',object({candidates:arr(ref('CatalogCandidate')),catalogVersion:str(),policyVersion:str(),availableTotal:{type:'integer',minimum:0},total:{type:'integer',minimum:0},page:integer,pageSize:{type:'integer',enum:[24]},order:str(),orderNote:str(),specializations:arr(str())},['candidates','total','availableTotal','page','pageSize','order','orderNote']));
operation('/employer/candidates','get','getCandidateCatalog',ref('CandidateCatalog'),null,'Authorized employer pool only; whole-resume AND filters, person deduplication before count/pagination. Real photo filter observes current identity visibility; no contacts or answer keys.');
const filters={q:str(0,120),specialization:str(0,120),grade:enumeration(['Junior','Middle','Senior','unconfirmed']),skill:str(0,80),skills:str(0,1600),fsp:enumeration(['yes','no']),experienceMin:{type:'integer',minimum:0,maximum:80},experienceMax:{type:'integer',minimum:0,maximum:80},workFormat:str(0,120),salaryMin:{type:'integer',minimum:0,maximum:2000000000},salaryMax:{type:'integer',minimum:0,maximum:2000000000},salaryPeriod:enumeration(['month','year']),salaryType:enumeration(['gross','net']),hasPhoto:enumeration(['yes','no']),readyForOffers:enumeration(['yes','no']),checkedWithinDays:{type:'integer',minimum:1,maximum:3650},needId:integer,page:{type:'integer',minimum:1,maximum:10000,default:1}};
doc.setIn(['paths','/employer/candidates','get','parameters'],Object.entries(filters).map(([name,value])=>({name,in:'query',schema:value,description:name.startsWith('salary')?'Salary amount filters require both comparable period and gross/net type.':undefined})));
operation('/employer/candidates/{id}','get','getCatalogResume',ref('CatalogCandidate'),null,'Currently authorized exact visible resume; hidden/deleted/foreign cohort gives404.');
schema('ResumePairComparison',object({needId:integer,needCreatedAt:instant,algorithmVersion:str(),left:{allOf:[safeResume,object({candidateId:integer,alias:str(),evaluation:{type:'object',additionalProperties:true}})]},right:{allOf:[safeResume,object({candidateId:integer,alias:str(),evaluation:{type:'object',additionalProperties:true}})]},summary:str(),differences:arr(object({kind:str(),text:str()},['kind','text'])),comparable:{type:'boolean'},limitations:arr(str()),orderContext:object({leftPosition:{type:'integer',nullable:true},rightPosition:{type:'integer',nullable:true},poolSize:{type:'integer'},note:str()},['leftPosition','rightPosition','poolSize','note'])},['needId','algorithmVersion','left','right','summary','differences','comparable','limitations','orderContext']));
operation('/employer/compare','get','compareResumePair',ref('ResumePairComparison'),null,'Same current owned need and two exact accessible resumes, evaluated in the full pool. No pair-only reranking or raw cross-program score comparison.');
doc.setIn(['paths','/employer/compare','get','parameters'],['needId','leftResumeId','rightResumeId'].map(name=>({name,in:'query',required:true,schema:integer})));
for (const name of ['MicrotaskResult', 'MicrotaskOffer']) {
  doc.setIn(['components','schemas',name,'properties','purpose'],enumeration(['company_task']));
}
doc.setIn(['components','schemas','MicrotaskResult','properties','qualificationEffect'],enumeration(['none']));
const publicTaskResult = doc.getIn(['components','schemas','MicrotaskResult']).toJSON();
delete publicTaskResult.properties.evaluatorUserId;
schema('SharedCompanyTaskResult', publicTaskResult);
const sharedEvidence = object({id:integer,purpose:enumeration(['company_task']),qualificationEffect:enumeration(['none']),companyName:str(),title:str(),competency:str(),rubric:arr({type:'object',additionalProperties:true}),limits:str(),result:{allOf:[ref('SharedCompanyTaskResult')],nullable:true}},['id','purpose','qualificationEffect','companyName','title','competency','rubric','limits','result']);
doc.setIn(['paths','/employer/micro-evidence/{id}','get','responses','200','content','application/json','schema'],arr(sharedEvidence));
doc.setIn(['components','schemas','JobApplication','properties','resumeId'],{...integer,nullable:true,description:'Immutable selected resume at application time; null only for legacy records.'});
doc.setIn(['components','schemas','JobApplication','properties','candidate','properties','resumeId'],integer);
doc.setIn(['components','schemas','JobApplication','properties','candidate','properties','resumeRevision'],integer);
doc.setIn(['components','schemas','ApplyForJobInput','properties','resumeId'],integer);
doc.setIn(['components','schemas','ApplyForJobInput','properties','jobVersion'],integer);
doc.setIn(['components','schemas','ApplyForJobInput','required'],['companyId','jobVersion','consentDisclosure','resumeId']);
doc.setIn(['components','schemas','ApplyForJobInput','additionalProperties'],false);

doc.setIn(['info', 'version'], '0.5.0');
fs.writeFileSync(file, doc.toString({ lineWidth: 140 }));

import assert from 'node:assert/strict';
import test from 'node:test';
import {mkdir,writeFile} from 'node:fs/promises';
import {projectResumeDocument,guardResumeDocumentProjection,renderResumeDocx,renderResumePdf,type DocumentQualification} from '../artifacts/api-server/src/lib/resume-document';
import {emptyResume} from '../artifacts/api-server/src/lib/signal-resume-contract';
import {buildSkillAttempt,scoreSkillAttempt,SKILL_BANK_VERSION} from '../artifacts/api-server/src/lib/skill-module-bank';
import {getSkillQualification,skillLevelRank} from '../artifacts/api-server/src/lib/skill-module-qualification';

const profile={displayName:'Пётр Сергеевич Контрольный',professionalAlias:'Анонимный разработчик',contactEmail:'freshness-private@example.test',phone:'+79997778899',title:'Backend-разработчик',specialization:'Backend / Python',assumedGrade:'Middle',verifiedGrade:'Middle',verifiedSkills:['Python','SQL'],stack:['Python','SQL'],skills:[],yearsExperience:4,workFormat:'Удалённо',salaryMin:1234567,salaryMax:8765432,salaryPeriod:'year',salaryType:'gross'};
const content={...emptyResume(),summary:'Обрабатывал события.',projects:[{title:'Система',role:'Автор',description:'Надёжный API',url:'https://private.example.test'}]};
const qualification:DocumentQualification={verifiedGrade:'Middle',source:'assessment',category:null,skills:[],historical:{date:'2026-10-01T00:00:00Z',programVersion:'historical-v1'}};
const preferences={location:'Казань',schedule:'Гибкий',employment:'Полная',relocation:false,startAvailability:'Сейчас'};
const input={resumeId:778,revision:12,profile,content,qualification,preferences,audience:'employer' as const,contactsAllowed:false,publicIdentity:false};
function proof(level:'Junior'|'Middle',id:number){
  const form=buildSkillAttempt('python',level,`document-freshness-${id}`);
  const decision=scoreSkillAttempt(form.cases,form.oracles,Object.fromEntries(Object.entries(form.oracles).map(([key,o])=>[key,o.expected])),form.policy);
  assert.equal(decision.passed,true);
  return {id,userId:771,attemptId:id,skillId:'python',level,programVersion:SKILL_BANK_VERSION,competencyIds:decision.competencies.filter(c=>c.passed).map(c=>c.id),verifiedAt:new Date('2026-10-08T10:00:00Z'),decision};
}
const juniorProof=proof('Junior',1),middleProof=proof('Middle',2);
const target={userId:771,specialization:'Backend / Python',assumedGrade:'Middle' as const,stack:['Python','SQL'],skills:[]};
const junior=getSkillQualification(target,{evidence:[juniorProof],revokedIds:new Set<number>()});
const middle=getSkillQualification(target,{evidence:[juniorProof,middleProof],revokedIds:new Set<number>()});
const corrected=getSkillQualification(target,{evidence:[juniorProof,middleProof],revokedIds:new Set<number>([1,2])});
const withSkills=(skills:typeof junior.skills)=>({...input,qualification:{...qualification,skills}});
const snapshot=(model:ReturnType<typeof projectResumeDocument>)=>({resumeId:model.resumeId,revision:model.revision,contactsPermitted:false,publicIdentity:false,identityRevision:'unchanged-shared-identity',projectionVersion:model.projectionVersion});

test('stable full projection version updates anonymous alias and permitted name without a CV revision edit',()=>{
  const before=projectResumeDocument(input);
  assert.match(before.projectionVersion,/^signal-document-v1:[a-f0-9]{64}$/);
  for(let i=0;i<3;i++)assert.equal(projectResumeDocument(structuredClone(input)).projectionVersion,before.projectionVersion);
  const renamed=projectResumeDocument({...input,profile:{...profile,professionalAlias:'Новый псевдоним'}});
  assert.notEqual(renamed.projectionVersion,before.projectionVersion);assert.equal(renamed.revision,before.revision);
  const publicBefore=projectResumeDocument({...input,publicIdentity:true});
  const publicAfter=projectResumeDocument({...input,publicIdentity:true,profile:{...profile,displayName:'Новое публичное имя'}});
  assert.notEqual(publicBefore.projectionVersion,publicAfter.projectionVersion);assert.equal(publicBefore.revision,publicAfter.revision);
});
test('projection version is scoped to permitted selected data, and not an oracle for excluded identity, contacts, content or skill proofs',()=>{
  const before=projectResumeDocument({...input,fields:[]});
  const privateChange=projectResumeDocument({...input,fields:[],profile:{...profile,displayName:'Другое скрытое имя',contactEmail:'different-private@example.test',phone:'+79881112233'},content:{...content,summary:'Не включённый раздел'},qualification:{...qualification,skills:middle.skills}});
  assert.equal(privateChange.projectionVersion,before.projectionVersion);
  assert.equal(JSON.stringify(privateChange).includes('different-private'),false);
});
test('historical Middle aggregate persisted fields remain equal when a partial Python proof rises or is corrected, but document versions change',()=>{
  const historical={verifiedGrade:'Middle' as const,verifiedScore:88,verifiedSkills:['Python','SQL'],latestAssessmentAt:new Date('2026-10-01T00:00:00Z'),qualificationAttemptId:91};
  const persisted=(modular:typeof junior)=>{const use=modular.verifiedGrade&&skillLevelRank[modular.verifiedGrade]>=skillLevelRank[historical.verifiedGrade];return {...historical,...(use?{verifiedGrade:modular.verifiedGrade,verifiedScore:null,latestAssessmentAt:modular.latestAssessmentAt,qualificationAttemptId:null}:{}),verifiedSkills:[...new Set([...historical.verifiedSkills,...modular.verifiedSkills])]};};
  assert.deepEqual(persisted(junior),persisted(middle));assert.deepEqual(persisted(junior),persisted(corrected));
  const documents=[junior,middle,corrected].map(q=>projectResumeDocument(withSkills(q.skills)));
  assert.equal(new Set(documents.map(d=>d.projectionVersion)).size,3);
  assert.deepEqual(documents.map(d=>d.revision),[12,12,12]);
  assert.ok(JSON.stringify(documents[0]).includes('Python - Junior'));assert.ok(JSON.stringify(documents[1]).includes('Python - Middle'));assert.ok(JSON.stringify(documents[2]).includes('Python · заявлен'));
});
test('same-day proof replacement, full timestamp, exact programme and qualification source are versioned even when formatted text stays equal',()=>{
  const base=withSkills(junior.skills),before=projectResumeDocument(base);
  const original=base.qualification.skills[0];
  for(const delta of [{evidenceId:93},{attemptId:94},{verifiedAt:'2026-10-08T11:00:00Z'},{programVersion:'another-programme'}]){
    const after=projectResumeDocument({...base,qualification:{...base.qualification,skills:[{...original,...delta}]}});
    assert.notEqual(after.projectionVersion,before.projectionVersion,JSON.stringify(delta));
  }
  assert.notEqual(projectResumeDocument({...base,qualification:{...base.qualification,source:'legacy'}}).projectionVersion,before.projectionVersion);
  assert.notEqual(projectResumeDocument({...base,qualification:{...base.qualification,historical:{...base.qualification.historical!,date:'2026-10-01T01:00:00Z'}}}).projectionVersion,before.projectionVersion);
});
test('controlled real PDF and DOCX render races discard stale identity/proof/correction bytes; unchanged rendering remains allowed',async()=>{
  const initialInput=withSkills(junior.skills),initial=projectResumeDocument(initialInput);
  const mutations=[{...initialInput,profile:{...profile,professionalAlias:'Новый псевдоним'}},withSkills(middle.skills),withSkills(corrected.skills)];
  const receipt:unknown[]=[];
  for(const [format,render] of [['pdf',renderResumePdf],['docx',renderResumeDocx]] as const){
    for(const [index,next] of mutations.entries()){
      let entered!:()=>void,release!:()=>void;const started=new Promise<void>(resolve=>{entered=resolve;}),barrier=new Promise<void>(resolve=>{release=resolve;});let current=initialInput,rendered:Buffer|undefined;
      const pending=guardResumeDocumentProjection(snapshot(initial),async()=>{const rendering=render(initial);entered();rendered=await rendering;await barrier;return rendered;},async()=>snapshot(projectResumeDocument(current)));
      await started;current=next;release();const decision=await pending;
      assert.ok(rendered&&rendered.length>1000);assert.equal(decision.status,'changed');assert.equal(decision.output,null);
      receipt.push({format,mutation:['alias','Junior-to-Middle','correction'][index],status:decision.status,initialVersion:initial.projectionVersion,currentVersion:projectResumeDocument(next).projectionVersion,cvRevisionUnchanged:true});
    }
    const fresh=projectResumeDocument(withSkills(middle.skills));const allowed=await guardResumeDocumentProjection(snapshot(fresh),()=>render(fresh),async()=>snapshot(projectResumeDocument(withSkills(middle.skills))));
    assert.equal(allowed.status,'allowed');assert.ok(allowed.output);
    if(process.env.SIGNAL_DOCUMENT_FRESHNESS_PROOFS){const directory=process.env.SIGNAL_DOCUMENT_FRESHNESS_PROOFS;await mkdir(directory,{recursive:true});await writeFile(`${directory}/fresh-middle.${format}`,allowed.output);}
  }
  const revoke=await guardResumeDocumentProjection(snapshot(initial),()=>renderResumeDocx(initial),async()=>null);assert.equal(revoke.status,'unavailable');assert.equal(revoke.output,null);
  if(process.env.SIGNAL_DOCUMENT_FRESHNESS_PROOFS){const directory=process.env.SIGNAL_DOCUMENT_FRESHNESS_PROOFS;await writeFile(`${directory}/projection-races.json`,JSON.stringify({checkedAt:new Date().toISOString(),status:'PASS',receipt,revoke:'unavailable'},null,2));}
});

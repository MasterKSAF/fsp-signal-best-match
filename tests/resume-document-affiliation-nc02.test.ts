import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { documentSkillProofs, projectResumeDocument, renderResumeDocx, guardResumeDocumentProjection, type DocumentQualification } from '../artifacts/api-server/src/lib/resume-document';
import { emptyResume } from '../artifacts/api-server/src/lib/signal-resume-contract';
import { getSkillQualification, type SkillModuleEvidence } from '../artifacts/api-server/src/lib/skill-module-qualification';
import { skillModuleRegistry, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
import { passportRelatedSkillIds } from '../artifacts/api-server/src/lib/skill-passport-projection';
import { passportProofs } from '../artifacts/fsp-signal/src/lib/skill-passport-context';

const at=new Date('2026-10-09T09:00:00Z');
const profile={displayName:'Синтетический кандидат',professionalAlias:'Разработчик',contactEmail:'fixture@example.test',phone:null,title:'Backend-разработчик',specialization:'Backend / Python',assumedGrade:'Middle' as const,verifiedGrade:null,verifiedSkills:[],stack:['Python','FastAPI','PostgreSQL','Docker'],skills:[],yearsExperience:3,workFormat:'Удалённо',salaryMin:100000,salaryMax:180000,salaryPeriod:'month',salaryType:'gross'};
const backend={...profile,id:701,userId:700};
const frontend={...backend,id:702,title:'Frontend-разработчик',specialization:'Frontend / TypeScript',stack:['React','Figma'],skills:[]};
const preferences={location:'',schedule:'',employment:'',relocation:false,startAvailability:''};
function evidence(skillId:string,id:number):SkillModuleEvidence {
  const module=skillModuleRegistry.find(module=>module.id===skillId)!;
  return {id,userId:700,attemptId:id+100,skillId,level:'Junior',programVersion:SKILL_BANK_VERSION,competencyIds:[...module.competencies],verifiedAt:at,decision:{score:100,passed:true,criticalComplete:true,competencies:module.competencies.map(id=>({id,label:id,passed:true,critical:true})),failedCritical:[]}};
}
const baseProofs=['python','sql','backend-engineering'].map((id,index)=>evidence(id,index+1));
const react=evidence('react',4);
const qualify=(extra:SkillModuleEvidence[]=[],revokedIds=new Set<number>())=>getSkillQualification(backend,{evidence:[...baseProofs,...extra],revokedIds});
const project=(qualification:DocumentQualification,options:Partial<Parameters<typeof projectResumeDocument>[0]>={})=>projectResumeDocument({resumeId:backend.id,revision:7,profile,content:emptyResume(),audience:'owner',contactsAllowed:true,publicIdentity:true,qualification,preferences,...options});
const snapshot=(document:ReturnType<typeof project>)=>({resumeId:document.resumeId,revision:document.revision,contactsPermitted:document.contactsPermitted,publicIdentity:false,identityRevision:'fixed',projectionVersion:document.projectionVersion});

test('exact document uses the same explicit and mandatory-role affiliation as owner passport, without narrowing account proofs',()=>{
  const inputs={evidence:[...baseProofs,react],revokedIds:new Set<number>()};
  const before=structuredClone(inputs),qualification=getSkillQualification(backend,inputs);
  assert.ok(qualification.skills.some(skill=>skill.skillId==='react'),'account proof remains valid for matching/all/none');
  const passport=passportProofs(qualification.skills,'701',[{id:701,relatedSkillIds:passportRelatedSkillIds(backend,inputs)}]);
  const selected=documentSkillProofs(profile,qualification);
  assert.deepEqual(selected.map(proof=>proof.evidenceId).sort(),passport.map(proof=>proof.evidenceId).sort());
  assert.deepEqual(selected.map(proof=>proof.label).sort(),['Backend engineering','Python','SQL']);
  for(const audience of ['owner','employer'] as const){
    const document=project(qualification,{audience,contactsAllowed:false,publicIdentity:false});
    assert.ok(!JSON.stringify(document).includes('React'));assert.ok(!JSON.stringify(document).includes('Figma'));
    assert.equal(document.skillChips?.find(skill=>skill.label==='PostgreSQL')?.status,'declared','SQL cannot verify adjacent PostgreSQL');
    assert.equal(document.skillChips?.find(skill=>skill.label==='SQL')?.status,'verified','mandatory role proof need not be manually declared');
  }
  const other=getSkillQualification(frontend,inputs);
  assert.ok(JSON.stringify(project(other,{resumeId:702,profile:{...profile,...frontend}})).includes('React - Junior'));
  assert.deepEqual(inputs,before,'stored account source objects remain unchanged');
});

test('unrelated proof creation, replacement and removal do not change exact content fingerprint even when cached CV revision advances',()=>{
  const before=project(qualify());
  const variants=[qualify([react]),qualify([{...react,id:9,attemptId:109,verifiedAt:new Date('2026-10-09T11:00:00Z')}]),qualify([react],new Set([react.id]))];
  for(const qualification of variants){
    const after=project(qualification,{revision:8});
    assert.equal(after.projectionVersion,before.projectionVersion);
    assert.equal(after.revision,8,'real business revision is still exposed for optimistic concurrency');
    assert.deepEqual(after.sections,before.sections);assert.deepEqual(after.skillChips,before.skillChips);
  }
});

test('explicitly adding a related skill reuses existing account proof; removal and revocation update text/chips/version without altering history',()=>{
  const qualification=qualify([react]),before=structuredClone(qualification);
  const included=project(qualification,{profile:{...profile,skills:['React']}}),excluded=project(qualification);
  assert.ok(JSON.stringify(included).includes('React - Junior'));
  assert.equal(included.skillChips?.find(skill=>skill.label==='React')?.status,'verified');
  assert.notEqual(included.projectionVersion,excluded.projectionVersion);
  const revoked=project(qualify([react],new Set([react.id])),{profile:{...profile,skills:['React']}});
  assert.equal(revoked.skillChips?.find(skill=>skill.label==='React')?.status,'declared');
  assert.ok(!JSON.stringify(revoked).includes('React - Junior'));assert.notEqual(revoked.projectionVersion,included.projectionVersion);
  assert.deepEqual(qualification,before,'a CV relation is not a mutation/revocation of account proof');
});

test('proof text, chips and fingerprint select the same strongest canonical proof independently of duplicate source order',()=>{
  const python=qualify().skills.find(skill=>skill.label==='Python')!;
  const lower={...python,label:'py',level:'Junior'},higher={...python,level:'Middle',evidenceId:44,attemptId:144};
  const first=project({...qualify(),skills:[higher,lower]}),second=project({...qualify(),skills:[lower,higher]});
  assert.equal(first.projectionVersion,second.projectionVersion);
  assert.equal(first.sections.find(section=>section.title==='Навыки')?.paragraphs.filter(item=>item.text.startsWith('Python - Middle')).length,1);
  assert.equal(first.skillChips?.find(skill=>skill.label==='Python')?.level,'Middle');
  assert.ok(!JSON.stringify(first.sections).includes('Python - Junior'));
});

test('excluding skills excludes both related and unrelated proof changes from content and version; source/header changes remain meaningful',()=>{
  const first=project(qualify(),{fields:['summary']}),next=project({...qualify([react]),skills:qualify([react]).skills.map(proof=>({...proof,evidenceId:proof.evidenceId+100,attemptId:proof.attemptId+100}))},{revision:10,fields:['summary']});
  assert.equal(first.skillChips,undefined);assert.equal(next.skillChips,undefined);assert.equal(first.projectionVersion,next.projectionVersion);
  const renamed=project(qualify(),{fields:['summary'],profile:{...profile,title:'Другая должность'}});
  assert.notEqual(first.projectionVersion,renamed.projectionVersion);
});

test('real DOCX has no unrelated skill, and a warmed completed export is discarded after fresh ACL or related proof change',async()=>{
  const initial=project(qualify([react]),{audience:'employer',contactsAllowed:false,publicIdentity:false});
  const render=()=>renderResumeDocx(initial);
  const bytes=await render();
  const require=createRequire(new URL('../artifacts/api-server/package.json',import.meta.url));
  const inner=createRequire(require.resolve('docx')),zip=await inner('jszip').loadAsync(bytes);
  const xml=await zip.file('word/document.xml').async('string');
  assert.ok(xml.includes('Python - Junior'));assert.ok(!xml.includes('React'));assert.ok(!xml.includes('Figma'));
  assert.equal((await guardResumeDocumentProjection(snapshot(initial),async()=>bytes,async()=>null)).status,'unavailable');
  const corrected=project(qualify([react],new Set([1])),{audience:'employer',contactsAllowed:false,publicIdentity:false});
  assert.equal((await guardResumeDocumentProjection(snapshot(initial),async()=>bytes,async()=>snapshot(corrected))).status,'changed');
  assert.equal((await guardResumeDocumentProjection(snapshot(initial),async()=>bytes,async()=>({...snapshot(initial),revision:initial.revision+1}))).status,'changed','revision still guards a concurrent edit even though it is not content');
});

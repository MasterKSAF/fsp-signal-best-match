import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSkillAttempt, scoreSkillAttempt, skillModuleRegistry, skillModuleTemplates, skillScenarioFixture, skillContentFamilyId, SkillBankUnavailableError, SKILL_BANK_VERSION, SENIOR_SKILL_RUBRIC_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
import { seniorRequirementProbe } from '../artifacts/api-server/src/lib/skill-senior-outcomes';
import { getSkillQualification, selectAccountSkillEvidence, skillRequirementCovered, SKILL_MATRIX_VERSION, type SkillModuleEvidence, type SkillQualificationTarget } from '../artifacts/api-server/src/lib/skill-module-qualification';
import { skillIssueRestriction } from '../artifacts/api-server/src/lib/skill-module-policy';

/** Hand-calculated primary results for n=5,flag=true; independent of production expected-answer builders. */
export const handwrittenSeniorPrimary: Record<string, readonly (readonly string[])[]> = {
  python: [['2|2|True|True','3|1|3','2|old'],['1|[]','10','2|10'],['7|6','1|2','value'],['2|1','cleanup|cancelled','NoneType|True'],['enter:A|enter:B|exit:A|caught','open|close','0|5'],['6|1','2|0','reject']],
  sql: [['42|11','5|10','1|20'],['18/3','50|9','11|2|13'],['1|2','1','2'],['1|1|2','1|7','2'],['7|5|11|6','3|4','3|1|2|4'],['3','1|no','1|0']],
  typescript: [['reject','ready|1','1|0'],['sync|6|q','error|7','no|null|null'],['yes|no|string','2|no|number','no'],['1|1','null|b','1'],['1|2','1|op2','3'],['5|3|false|true','2|yes','0']],
  react: [['4|1','1|2','12|10|10'],['B|A','6','0'],['false','4|4|0','server|client'],['empty|draftA|1','empty','0|5|empty'],['conflict|Ufa|1','1|0','あ|0'],['1|1','0|0','no']],
  'backend-engineering': [['3|1','0|412','no'],['6|1','no','1|no'],['30','5','1'],['5|2','40|queue','85|10'],['403|0','yes','0'],['no','no','2|no']],
  'frontend-engineering': [['6|y|yes','1|6','2|0'],['D|B|0','no','no'],['10|500','300','0'],['1|ab','1','0|yes'],['no','no','yes'],['0','no','no']],
};
const answersFor = (form: ReturnType<typeof buildSkillAttempt>) => Object.fromEntries(Object.entries(form.oracles).map(([id,o])=>[id,o.expected]));

test('all six real Senior programmes have independent outcomes, 108 task families, two obligatory parts and private keys', () => {
  assert.equal(SKILL_BANK_VERSION,'signal-skills-2026-10-v6');
  const senior = skillModuleTemplates.filter(t=>t.level==='Senior');
  assert.equal(senior.length,108); assert.equal(new Set(senior.map(t=>t.contentFamilyId)).size,108);
  const lowerFamilies = new Set(skillModuleTemplates.filter(t=>t.level!=='Senior').map(t=>t.contentFamilyId));
  assert.ok(senior.every(t=>!lowerFamilies.has(t.contentFamilyId)&&[2,3].includes(t.version)));
  for(const m of skillModuleRegistry) {
    assert.deepEqual(m.availableLevels,['Junior','Middle','Senior']);
    assert.equal(m.levelCriteria.Senior.length,6); assert.notDeepEqual(m.levelCriteria.Senior,m.levelCriteria.Middle);
    assert.equal(m.levelPolicies.Senior.durationMinutes,45); assert.equal(m.levelPolicies.Middle.durationMinutes,30);
    const form=buildSkillAttempt(m.id,'Senior','independent-senior');
    assert.equal(form.policy.rubricVersion,SENIOR_SKILL_RUBRIC_VERSION);assert.equal(form.policy.durationMinutes,45);
    assert.equal(form.cases.length,6);assert.ok(form.cases.every(c=>c.templateId.includes(':Senior:')&&c.seniorOutcome&&!c.middleOutcome&&form.oracles[c.id]!.parts?.length===2));
    assert.equal(form.cases.filter(c=>c.critical).length,m.id==='backend-engineering'?4:3);
  }
  assert.equal(/"(?:expected|explanation|parts|oracles)":/.test(JSON.stringify(skillModuleRegistry)),false);
  assert.throws(()=>buildSkillAttempt('PostgreSQL','Senior','sql-is-not-postgresql'),SkillBankUnavailableError);
  assert.throws(()=>buildSkillAttempt('python','Staff' as never,'no-fallback'),SkillBankUnavailableError);
});

test('108 handwritten primary answers and every invariant produce a substantive decision; partial answers fail their competency',()=>{
  const lengthRanks=[0,0,0,0];
  for(const m of skillModuleRegistry) for(let c=0;c<6;c++)for(let s=0;s<3;s++) {
    const probe=seniorRequirementProbe(m.id,c,s,5,true);
    assert.equal(probe.parts[0].expected,handwrittenSeniorPrimary[m.id]![c]![s],`${m.id}/${c}/${s}`);
    assert.equal(probe.parts[1].choices?.length,4);
    assert.equal(new Set(probe.parts[1].choices).size,4);
    const lengths=probe.parts[1].choices!.map(x=>x.length);lengthRanks[lengths.slice(1).filter(x=>x<lengths[0]!).length]++;
    const task=skillScenarioFixture(m.id,'Senior',c,s,5,true);
    assert.equal(task.parts![0]!.expected,handwrittenSeniorPrimary[m.id]![c]![s]);
    assert.equal(task.parts!.length,2);assert.ok(task.prompt.includes('обязательный инженерный инвариант'));
    assert.notEqual(task.prompt,skillScenarioFixture(m.id,'Middle',c,s,5,true).prompt);
  }
  assert.ok(lengthRanks.every(count=>count<50),`A fixed length-rank shortcut is too strong: ${lengthRanks.join(',')}`);
});

test('all 1080 authored variants plus actual forms pass complete answers and fail critical/both-part violations',()=>{
  for(const m of skillModuleRegistry)for(let c=0;c<6;c++)for(let s=0;s<3;s++)for(let n=5;n<=9;n++)for(const f of [false,true]) {
    const senior=skillScenarioFixture(m.id,'Senior',c,s,n,f);
    assert.ok(senior.parts?.every(p=>p.expected.length&&['integer','text'].includes(p.responseType)));
    assert.equal(senior.parts?.length,2); assert.ok(senior.seniorOutcome);
  }
  for(const m of skillModuleRegistry)for(const seed of ['senior-positive-A','senior-positive-B','senior-negative-C','senior-negative-D']) {
    const form=buildSkillAttempt(m.id,'Senior',seed);const good=answersFor(form);
    const decision=scoreSkillAttempt(form.cases,form.oracles,good,form.policy);
    assert.equal(decision.passed,true);assert.equal(decision.levelCoverage?.filter(c=>c.passed).length,6);
    assert.equal(scoreSkillAttempt(form.cases,form.oracles,{},form.policy).passed,false);
    for(const critical of form.cases.filter(c=>c.critical)) {
      for(const response of [form.oracles[critical.id]!.parts![0]!.expected,`${form.oracles[critical.id]!.parts![0]!.expected};wrong`,`wrong;${form.oracles[critical.id]!.parts![1]!.expected}`]) {
        const bad=scoreSkillAttempt(form.cases,form.oracles,{...good,[critical.id]:response},form.policy);
        assert.equal(bad.passed,false);assert.equal(bad.score,83);assert.equal(bad.criticalComplete,false);
      }
    }
    const [a,b]=form.cases.filter(c=>!c.critical);
    assert.equal(scoreSkillAttempt(form.cases,form.oracles,{...good,[a!.id]:'wrong'},form.policy).passed,true);
    assert.equal(scoreSkillAttempt(form.cases,form.oracles,{...good,[a!.id]:'wrong',[b!.id]:'wrong'},form.policy).passed,false);
    assert.equal(scoreSkillAttempt(form.cases,form.oracles,Object.fromEntries(form.cases.map(c=>[c.id,form.oracles[c.id]!.parts![0]!.expected])),form.policy).passed,false);
  }
});

test('Senior exposure is stable across version renaming; no personally seen family repeats, exhaustion refuses issuance',()=>{
  for(const m of skillModuleRegistry) {
    const exposures=new Map<string,number>();const issued:string[]=[];
    for(let i=0;i<3;i++) {
      const form=buildSkillAttempt(m.id,'Senior',`rotation-${i}`,{personalExposures:exposures});
      for(const c of form.cases){assert.ok(!issued.includes(c.contentFamilyId!));issued.push(c.contentFamilyId!);exposures.set(c.templateId.replace('-v6:','-v99:'),1);assert.equal(skillContentFamilyId(c.templateId.replace('-v6:','-v99:')),c.contentFamilyId);}
    }
    assert.equal(new Set(issued).size,18);
    assert.throws(()=>buildSkillAttempt(m.id,'Senior','exhausted',{personalExposures:exposures}),SkillBankUnavailableError);
    const disabled=new Set(skillModuleTemplates.filter(t=>t.skillId===m.id&&t.level==='Senior'&&t.competencyIndex===5).map(t=>t.id));
    assert.throws(()=>buildSkillAttempt(m.id,'Senior','critical-pool-missing',{disabled}),SkillBankUnavailableError);
    const a=buildSkillAttempt(m.id,'Senior','global-balanced');
    const b=buildSkillAttempt(m.id,'Senior','global-balanced',{globalExposures:new Map(a.cases.map(c=>[c.contentFamilyId!,1000]))});
    assert.ok(b.cases.every((c,i)=>c.contentFamilyId!==a.cases[i]!.contentFamilyId));
    const frozen=structuredClone(a);buildSkillAttempt(m.id,'Senior','separate');assert.deepEqual(a,frozen);
  }
});

function evidence(skillId:string,id:number,level:'Junior'|'Middle'|'Senior'='Senior'):SkillModuleEvidence {
  const form=buildSkillAttempt(skillId,level,`proof-${id}`); const decision=scoreSkillAttempt(form.cases,form.oracles,answersFor(form),form.policy);
  return {id,userId:77,attemptId:id,skillId,level,programVersion:form.programVersion,competencyIds:decision.competencies.filter(c=>c.passed).map(c=>c.id),decision,verifiedAt:new Date('2026-10-08T12:00:00Z')};
}
const target=(specialization='Backend / Python'):SkillQualificationTarget=>({userId:77,specialization,assumedGrade:'Senior',stack:specialization.startsWith('Backend')?['Python','SQL']:['TypeScript','React'],skills:[]});
test('Senior category requires all mandatory role slots, exact Senior coverage and ownership; optional recommendations never change denominator',()=>{
  assert.equal(SKILL_MATRIX_VERSION,'signal-category-competency-matrix-v2');
  for(const specialization of ['Backend / Python','Frontend / TypeScript']) {
    const ids=specialization.startsWith('Backend')?['python','sql','backend-engineering']:['typescript','react','frontend-engineering'];
    const rows=ids.map((id,i)=>evidence(id,i+1));const t=target(specialization);const inputs={evidence:rows,revokedIds:new Set<number>()};
    const complete=getSkillQualification(t,inputs);assert.equal(complete.verifiedGrade,'Senior');assert.equal(complete.category?.requirements.length,3);assert.equal(complete.verifiedScore,null);
    assert.equal(getSkillQualification({...t,skills:['Kafka','FastAPI','PostgreSQL','Extra recommended']},inputs).verifiedGrade,'Senior');
    assert.equal(getSkillQualification(t,{...inputs,evidence:rows.slice(0,2)}).verifiedGrade,null);
    assert.equal(getSkillQualification(t,{...inputs,evidence:[...rows.slice(0,2),evidence(ids[2]!,4,'Middle')]}).verifiedGrade,'Middle');
    assert.equal(getSkillQualification(t,{...inputs,revokedIds:new Set([3])}).verifiedGrade,null);
    const forged=structuredClone(rows);forged[2]!.programVersion='signal-skills-2026-10-v3';assert.equal(getSkillQualification(t,{...inputs,evidence:forged}).verifiedGrade,null);
    const noCoverage=structuredClone(rows);delete noCoverage[2]!.decision.levelCoverage;assert.equal(getSkillQualification(t,{...inputs,evidence:noCoverage}).verifiedGrade,null);
    const wrongOwner=structuredClone(rows);wrongOwner[2]!.userId=88;assert.equal(getSkillQualification(t,{...inputs,evidence:wrongOwner}).verifiedGrade,null);
    const snapshot=structuredClone(complete.category);getSkillQualification(t,{...inputs,revokedIds:new Set([1])});assert.deepEqual(complete.category,snapshot);
  }
  const all=selectAccountSkillEvidence(target(),{evidence:[evidence('python',1),evidence('sql',2,'Middle')],revokedIds:new Set()});
  assert.equal(skillRequirementCovered({skill:'Python',level:'Senior'},all),true);
  assert.equal(skillRequirementCovered({skill:'FastAPI',level:'Senior'},all),false);
  assert.equal(skillRequirementCovered({skill:'PostgreSQL',level:'Middle'},all),false);
});

test('a legitimate 5-of-6 Senior pass is retained as account skill evidence and closes its matrix slot; critical failures never do',()=>{
  for(const m of skillModuleRegistry){
    const form=buildSkillAttempt(m.id,'Senior','retained-five-of-six');const good=answersFor(form);
    for(const missed of form.cases.filter(c=>!c.critical)){
      const decision=scoreSkillAttempt(form.cases,form.oracles,{...good,[missed.id]:'wrong'},form.policy);
      assert.equal(decision.passed,true);assert.equal(decision.score,83);
      const proof:SkillModuleEvidence={id:1,userId:77,attemptId:1,skillId:m.id,level:'Senior',programVersion:form.programVersion,decision,competencyIds:decision.competencies.filter(c=>c.passed).map(c=>c.id),verifiedAt:new Date('2026-10-08T12:00:00Z')};
      const selected=selectAccountSkillEvidence(target(),{evidence:[proof],revokedIds:new Set()});
      assert.equal(selected.length,1);assert.equal(selected[0]!.level,'Senior');assert.equal(skillRequirementCovered({skill:m.title,level:'Senior'},selected),true);
    }
    for(const missed of form.cases.filter(c=>c.critical)){
      const decision=scoreSkillAttempt(form.cases,form.oracles,{...good,[missed.id]:'wrong'},form.policy);
      const proof={...evidence(m.id,1),decision,competencyIds:decision.competencies.filter(c=>c.passed).map(c=>c.id)};
      assert.equal(decision.passed,false);assert.equal(selectAccountSkillEvidence(target(),{evidence:[proof],revokedIds:new Set()}).length,0);
    }
  }
});

test('old saved v3 multipart rubric still canonicalizes answers without rewriting snapshots; Senior limits are real',()=>{
  const form=buildSkillAttempt('python','Middle','immutable-v3');form.programVersion='signal-skills-2026-10-v3';form.policy.rubricVersion='six-competencies-critical-5of6-middle-outcomes-v3';
  const snapshot=structuredClone(form);const answer=answersFor(form);
  for(const c of form.cases) {
    const parts=form.oracles[c.id]!.parts!;
    answer[c.id]=parts.map(p=>p.responseType==='integer'&&/^\d+$/.test(p.expected)?`+00${p.expected}`:p.expected).join(' ; ');
  }
  assert.equal(scoreSkillAttempt(form.cases,form.oracles,answer,form.policy).passed,true);assert.deepEqual(form,snapshot);
  const now=new Date('2026-10-08T12:00:00Z'); const row={skillId:'python',level:'Senior',status:'submitted',startedAt:new Date(+now-60000),submittedAt:new Date(+now-1000)};
  assert.equal(skillIssueRestriction([row],'python','Senior',now)?.code,'module_retry');
  assert.equal(skillIssueRestriction([row],'sql','Senior',now),null);
  assert.equal(skillIssueRestriction([{...row,status:'expired',submittedAt:null},{...row,level:'Middle',status:'expired',submittedAt:null}],'python','Senior',now)?.code,'module_issue_limit');
});

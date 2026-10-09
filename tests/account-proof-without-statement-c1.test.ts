import assert from 'node:assert/strict';
import test from 'node:test';
import { getSkillQualification, type SkillModuleEvidence } from '../artifacts/api-server/src/lib/skill-module-qualification';
import { SKILL_BANK_VERSION, skillModuleRegistry } from '../artifacts/api-server/src/lib/skill-module-bank';
import { evaluateMatch, type MatchNeed } from '../artifacts/api-server/src/lib/signal-matching';
import { evaluateSkillRequirement } from '../artifacts/api-server/src/lib/recruiting-requirements';
import { preparePoolAdmission } from '../artifacts/api-server/src/lib/matching-pool-admission';
import { applicationSkillChips } from '../artifacts/api-server/src/lib/employer-application-display';
import { selectionCandidate } from '../artifacts/api-server/src/lib/employer-selection-query';
import type { CatalogResume } from '../artifacts/api-server/src/lib/signal-resume-catalog';

let projectionPromise: Promise<typeof import('../artifacts/api-server/src/lib/signal-skill-matching')> | undefined;
async function project() {
  process.env.DATABASE_URL = 'postgresql://unit_only:unused@127.0.0.1:1/unit_mock_never_connect';
  return (projectionPromise ??= import('../artifacts/api-server/src/lib/signal-skill-matching')).then(m => m.projectCurrentSkillModuleEvidence);
}
function proof(id:number, skillId='python', level:'Junior'|'Middle'='Middle', userId=17):SkillModuleEvidence {
  const module=skillModuleRegistry.find(item=>item.id===skillId)!;
  return {id,userId,attemptId:id+1000,skillId,level,programVersion:SKILL_BANK_VERSION,competencyIds:[...module.competencies],verifiedAt:new Date('2026-10-09T10:00:00Z'),
    decision:{score:100,passed:true,criticalComplete:true,rubricVersion:'six-competencies-critical-5of6-middle-outcomes-v4',
      competencies:module.competencies.map((id,index)=>({id,passed:true,critical:index===0||index===5})),
      ...(level==='Middle'?{levelCoverage:module.competencies.map((_id,index)=>({requirementId:`${skillId}:middle-outcome-v2:${index+1}`,passed:true}))}:{})}};
}
function resume(resumeId=1,patch:Partial<CatalogResume>={}):CatalogResume {
  return {userId:17,resumeId,resumeRevision:1,title:`CV ${resumeId}`,alias:'C1 synthetic',specialization:'Backend / Python',assumedGrade:'Middle',verifiedGrade:null,verifiedScore:null,
    verifiedSkills:[],stack:['Docker','SQL'],statedSkills:[],yearsExperience:2,workFormat:'Удалённо',salaryMin:100000,salaryMax:200000,latestAssessmentAt:null,hasFspHistory:false,
    visibility:'public',consentMatching:true,consentCatalog:true,readyForOffers:true,demoMode:false,avatarDataUrl:null,publicName:null,deletedAt:null,legacyQualification:null,...patch};
}
const mixed:MatchNeed={specialization:'Backend / Python',grade:'Middle',gradeMode:'declared_or_verified',requiredSkills:['Python','Docker'],skillRequirements:[{skill:'Python',mode:'verified',level:'Middle'},{skill:'Docker',mode:'declared_or_verified'}],desirableSkills:[],workFormat:'Удалённо',salaryMin:100000,salaryMax:200000};
const flexible:MatchNeed={...mixed,skillRequirements:[{skill:'Python',mode:'declared_or_verified'},{skill:'Docker',mode:'declared_or_verified'}]};
const target=(row:CatalogResume)=>({userId:row.userId,specialization:row.specialization,assumedGrade:row.assumedGrade!,stack:row.stack,skills:row.statedSkills});

test('C1 account proof survives removal from both declaration fields in matching, admission, coverage and chips without overall grade',async()=>{
  const enrich=await project(),evidence=[proof(1)],inputs={evidence,revokedIds:new Set<number>()};
  const rows=[resume(1,{stack:['Python','Docker','SQL'],statedSkills:['Python']}),resume(1)];
  const snapshot=structuredClone(rows),[before,after]=enrich(rows,inputs);
  for(const row of [before,after]){
    for(const context of [mixed,flexible]){
      const match=evaluateMatch(context,row,false);
      assert.equal(match.eligible,true);assert.equal(preparePoolAdmission(context,false)(row),true);
      assert.equal(match.evidence[0].status,'verified');assert.equal(match.evidence[0].satisfied,true);assert.equal(match.evidence[0].provenance?.evidenceId,1);
    }
    const coverage=mixed.skillRequirements!.map(item=>evaluateSkillRequirement(item,row));
    assert.equal(coverage.filter(item=>item.verified).length,1);assert.equal(coverage.filter(item=>item.covered).length,2);
    assert.equal(coverage[0].verifiedLevel,'Middle');assert.equal(row.verifiedGrade,null);assert.equal(row.categoryEvidence,undefined);
    const selected=selectionCandidate({...row,updatedAt:new Date('2026-10-09'),location:null},[]);
    assert.deepEqual(selected.skillChips.find(item=>item.label==='Python'),{label:'Python',status:'verified',level:'Middle'});
    assert.deepEqual(applicationSkillChips(target(row),inputs).find(item=>item.label==='Python'),{label:'Python',status:'verified',level:'Middle'});
  }
  assert.deepEqual(rows,snapshot);assert.deepEqual(after.stack,['Docker','SQL']);assert.deepEqual(after.statedSkills,[]);
  assert.equal(evaluateMatch({...mixed,gradeMode:'verified'},after,false).eligible,false,'one Python proof does not supply an overall Middle category');
});

test('C1 account proofs remain visible across role changes while category stays exact to the current CV matrix',async()=>{
  const enrich=await project(),inputs={evidence:['python','sql','backend-engineering'].map((skill,index)=>proof(index+1,skill)),revokedIds:new Set<number>()};
  const rows=[resume(1,{stack:['Python']}),resume(2),resume(3,{specialization:'Frontend / TypeScript',stack:['TypeScript','React']}),resume(4,{specialization:'Custom / Analyst',stack:[]})];
  const result=enrich(rows,inputs);
  assert.equal(result[0].verifiedGrade,'Middle');assert.equal(result[0].categoryEvidence?.specialization,'Backend / Python');
  for(const row of result.slice(1)){
    assert.equal(row.verifiedGrade,null);assert.equal(row.categoryEvidence,undefined);
    assert.equal(row.skillEvidence?.find(item=>item.skill==='Python')?.level,'Middle');
    assert.equal(evaluateSkillRequirement({skill:'Python',mode:'verified',level:'Middle'},row).covered,true);
  }
  assert.equal(getSkillQualification(target(rows[1]),inputs).coverage.find(item=>item.id==='language')?.covered,false,'account evidence does not guess the selected CV language');
  assert.deepEqual(getSkillQualification(target(rows[3]),inputs).coverage,[]);
});

test('C1 a below-level proof remains real without a declaration and loses no source when insufficient',async()=>{
  const enrich=await project(),row=enrich([resume()],{evidence:[proof(1,'python','Junior')],revokedIds:new Set()})[0];
  const coverage=evaluateSkillRequirement(mixed.skillRequirements![0],row),match=evaluateMatch(mixed,row,false);
  assert.equal(coverage.verified,true);assert.equal(coverage.verifiedLevel,'Junior');assert.equal(coverage.verifiedSufficient,false);assert.equal(coverage.covered,false);
  assert.equal(match.eligible,false);assert.equal(match.evidence[0].status,'verified');assert.match(match.evidence[0].reason!,/Junior.*Middle/);
  assert.equal(evaluateMatch(flexible,row,false).eligible,true);
});

test('C1 current corrections remove account proof without borrowing foreign evidence or sibling CV declarations',async()=>{
  const enrich=await project(),own=proof(1),foreign=proof(2,'python','Middle',18),evidence=[own,foreign];
  const rows=[resume(1),resume(2,{stack:['Python'],statedSkills:[]}),resume(3,{userId:19})];
  const before=enrich(rows,{evidence,revokedIds:new Set()});assert.equal(evaluateMatch(mixed,before[0],false).eligible,true);
  const corrected=enrich(rows,{evidence,revokedIds:new Set([own.id])});
  for(const row of corrected){assert.equal(row.skillEvidence?.some(item=>item.skill==='Python'),false);assert.equal(row.verifiedSkills.includes('Python'),false);assert.equal(evaluateMatch(mixed,row,false).eligible,false);}
  assert.equal(evaluateMatch(flexible,corrected[0],false).eligible,false,'Python declaration in CV2 does not fill CV1');
  assert.equal(evaluateMatch(flexible,corrected[1],false).eligible,false,'Docker declaration in CV1 does not fill CV2');
  assert.equal(evaluateSkillRequirement({skill:'Python',mode:'declared_or_verified'},corrected[1]).source,'declared');
  assert.equal(applicationSkillChips(target(rows[0]),{evidence,revokedIds:new Set([own.id])}).some(item=>item.label==='Python'),false);
  assert.equal(before[0].skillEvidence?.[0].evidenceId,own.id,'later correction does not mutate an earlier response');
});

test('C1 account proof never bypasses private visibility, matching consent, pool or specialization gates',async()=>{
  const enrich=await project(),patches:Partial<CatalogResume>[]=[{visibility:'private'},{consentMatching:false},{demoMode:true},{specialization:'Frontend / TypeScript'}];
  const rows=enrich(patches.map((patch,index)=>resume(index+1,patch)),{evidence:[proof(1)],revokedIds:new Set()});
  for(const row of rows){
    assert.equal(evaluateSkillRequirement(mixed.skillRequirements![0],row).covered,true,'a proof stays valid independently of access');
    assert.equal(evaluateMatch(mixed,row,false).eligible,false);assert.equal(preparePoolAdmission(mixed,false)(row),false);
  }
});

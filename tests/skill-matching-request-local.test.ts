import assert from 'node:assert/strict';
import test from 'node:test';
import type { CatalogResume } from '../artifacts/api-server/src/lib/signal-resume-catalog';
import type { SkillModuleEvidence } from '../artifacts/api-server/src/lib/skill-module-qualification';
import { skillModuleRegistry, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';

let modulePromise: Promise<typeof import('../artifacts/api-server/src/lib/signal-skill-matching')> | undefined;
async function projection() {
  process.env.DATABASE_URL = 'postgresql://unit_only:unused@127.0.0.1:1/unit_mock_never_connect';
  return (modulePromise ??= import('../artifacts/api-server/src/lib/signal-skill-matching')).then(m => m.projectCurrentSkillModuleEvidence);
}
const at = new Date('2026-10-08T00:00:00Z');
function proof(userId: number, skillId: string, level: 'Junior'|'Middle' = 'Junior'): SkillModuleEvidence {
  const module = skillModuleRegistry.find(m => m.id === skillId)!;
  const id = userId * 10 + skillModuleRegistry.indexOf(module);
  return { id, userId, attemptId: id + 100000, skillId, level, programVersion: SKILL_BANK_VERSION,
    competencyIds: [...module.competencies], verifiedAt: at,
    decision: { score: 100, passed: true, criticalComplete: true,
      rubricVersion: 'six-competencies-critical-5of6-middle-outcomes-v4',
      competencies: module.competencies.map((id,c) => ({id,passed:true,critical:c===0||c===5})),
      ...(level === 'Middle' ? {levelCoverage:module.competencies.map((_id,c)=>({requirementId:`${skillId}:middle-outcome-v2:${c+1}`,passed:true}))} : {}) },
  };
}
function resume(userId: number, resumeId: number, patch: Partial<CatalogResume> = {}): CatalogResume {
  return { userId,resumeId,resumeRevision:1,title:`CV ${resumeId}`,alias:`Person ${userId}`,
    specialization:'Backend / Python',assumedGrade:'Junior',verifiedGrade:null,verifiedScore:null,
    verifiedSkills:[],stack:['Python','SQL'],statedSkills:[],yearsExperience:2,workFormat:'Удалённо',
    salaryMin:100000,salaryMax:200000,latestAssessmentAt:null,hasFspHistory:false,
    visibility:'pseudonymous',consentMatching:true,consentCatalog:true,readyForOffers:true,
    demoMode:false,avatarDataUrl:null,publicName:null,deletedAt:null,legacyQualification:null,...patch };
}

test('fresh request partition never borrows another owner proof or reuses the wrong CV declaration',async()=>{
  const project=await projection();
  const evidence=['python','sql','backend-engineering','typescript','react','frontend-engineering'].map(id=>proof(11,id));
  evidence.push(proof(22,'sql'),proof(22,'backend-engineering'));
  const rows=[resume(11,1),resume(11,2,{stack:[],statedSkills:[]}),
    resume(11,3,{stack:[],statedSkills:['Python']}),resume(11,4,{assumedGrade:'Middle'}),
    resume(11,5,{specialization:'Frontend / TypeScript',stack:['TypeScript','React']}),
    resume(11,6,{specialization:'Frontend / TypeScript',stack:['TypeScript']}),resume(22,7)];
  const before=structuredClone(rows),inputs={evidence,revokedIds:new Set<number>()};
  const result=project(rows,inputs);
  assert.equal(result[0]!.verifiedGrade,'Junior');
  assert.equal(result[1]!.verifiedGrade,null,'no declared language cannot borrow sibling CV declaration');
  assert.equal(result[2]!.verifiedGrade,'Junior','declared skills participate independently of stack');
  assert.equal(result[3]!.categoryEvidence?.targetGrade,'Middle','same effective grade is not the same target category');
  assert.equal(result[4]!.categoryEvidence?.specialization,'Frontend / TypeScript');
  assert.equal(result[5]!.verifiedGrade,null,'missing declared React cannot borrow another CV framework');
  assert.equal(result[6]!.verifiedGrade,null,'second owner cannot borrow Python from first owner');
  for(const row of result)assert.ok(row.skillEvidence?.every(e=>e.candidateId===row.userId));
  assert.deepEqual(rows,before,'professional source rows are not mutated');
  assert.equal(inputs.evidence.length,8);
});

test('later requests immediately see revocation and changed proof inputs; there is no cross-request memo',async()=>{
  const project=await projection(),rows=[resume(11,1)];
  const evidence=['python','sql','backend-engineering'].map(id=>proof(11,id));
  const first=project(rows,{evidence,revokedIds:new Set()});assert.equal(first[0]!.verifiedGrade,'Junior');
  const revoked=project(rows,{evidence,revokedIds:new Set([evidence[0]!.id])});
  assert.equal(revoked[0]!.verifiedGrade,null);assert.equal(revoked[0]!.skillEvidence?.some(e=>e.skill==='Python'),false);
  const replaced=project(rows,{evidence:evidence.slice(1),revokedIds:new Set()});assert.equal(replaced[0]!.verifiedGrade,null);
  assert.equal(first[0]!.verifiedGrade,'Junior','fresh request cannot mutate a prior result');
});

test('proof-validation work is linear in owned evidence for repeated identical CVs',async()=>{
  const project=await projection();let levelReads=0;
  const evidence:SkillModuleEvidence[]=[],rows:CatalogResume[]=[];
  for(let owner=1;owner<=30;owner++){
    for(const skill of ['python','sql','backend-engineering']){
      const value=proof(owner,skill,'Middle');
      Object.defineProperty(value,'level',{enumerable:true,get(){levelReads++;return 'Middle';}});
      evidence.push(value);
    }
    for(let cv=0;cv<3;cv++)rows.push(resume(owner,owner*10+cv,{assumedGrade:'Middle'}));
  }
  const result=project(rows,{evidence,revokedIds:new Set()});
  assert.ok(result.every(row=>row.verifiedGrade==='Middle'));
  assert.ok(levelReads<=evidence.length*8,`unrelated owners or identical CVs were revalidated: ${levelReads}`);
  assert.equal(result.length,90);
});

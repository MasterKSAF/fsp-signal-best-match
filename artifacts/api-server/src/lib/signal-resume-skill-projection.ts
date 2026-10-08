import type { CatalogResume } from './signal-resume-catalog';
import type { SafeSkillEvidence } from './signal-matching';
import {canonicalSkillKey} from './skill-catalog';
import {getResumeQualification,type ResumeQualificationAttempt} from './signal-resume-qualification';

/** A single freshly read batch only. Each whole CV keeps its own fields; the
 * account proof derivation may be reused only for the same declared context.
 * The attempts, versions and correction set belong to this call, never a TTL. */
export function projectLegacyResumeSkillEvidence<T extends CatalogResume>(
  rows:T[],
  inputs:{attempts:ResumeQualificationAttempt[];correctedIds:ReadonlySet<number>},
  photos:ReadonlyMap<number,string|null>=new Map(),
  work?:{qualificationCalls:number;derivedSkillArrays:number},
):T[] {
  const attemptsByUser=new Map<number,ResumeQualificationAttempt[]>();
  for(const attempt of inputs.attempts){const group=attemptsByUser.get(attempt.userId);if(group)group.push(attempt);else attemptsByUser.set(attempt.userId,[attempt]);}
  type Derived=Pick<CatalogResume,'verifiedGrade'|'verifiedScore'|'verifiedSkills'|'latestAssessmentAt'|'skillEvidence'>;
  const byTarget=new Map<string,Derived>();
  return rows.map(row=>{
    const key=JSON.stringify([row.userId,row.specialization,row.assumedGrade,row.stack,row.statedSkills,row.legacyQualification,row.demoMode]);
    let derived=byTarget.get(key);
    if(!derived){
      if(work){work.qualificationCalls++;work.derivedSkillArrays++;}
      const qualification=getResumeQualification(row,attemptsByUser.get(row.userId)??[],inputs.correctedIds);
      const proven=new Set(qualification.evidence.map(proof=>canonicalSkillKey(proof.skill)));
      const legacy:SafeSkillEvidence[]=qualification.verifiedSkills.filter(skill=>!proven.has(canonicalSkillKey(skill))).map(skill=>({
        skill,candidateId:row.userId,attemptId:null,programId:null,programVersion:null,templateId:null,templateVersion:null,criterionId:null,criterion:null,result:null,
        date:qualification.latestAssessmentAt?.toISOString()??null,sourceType:row.demoMode?'demo_example':'legacy_record',limitation:qualification.limitation??'Историческое подтверждение без подробного протокола.',
      }));
      derived={verifiedGrade:qualification.verifiedGrade,verifiedScore:qualification.verifiedScore,verifiedSkills:qualification.verifiedSkills,latestAssessmentAt:qualification.latestAssessmentAt,skillEvidence:[...qualification.evidence,...legacy]};
      byTarget.set(key,derived);
    }
    return {...row,...derived,avatarDataUrl:row.visibility==='public'?(photos.get(row.resumeId)??null):null};
  });
}

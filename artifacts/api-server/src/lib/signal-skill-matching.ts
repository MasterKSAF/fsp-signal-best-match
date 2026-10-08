import { db, type SkillCategorySnapshot } from '@workspace/db';
import { gradeRank } from './signal-matching';
import type { CatalogResume } from './signal-resume-catalog';
import { getSkillQualification, type SkillQualificationInputs, type SkillQualification } from './skill-module-qualification';
import { loadSkillQualificationInputs, moduleMatchEvidence, skillModulesEnabled } from './skill-module-service';
type ProjectionOptions={mutateLocalProjection?:boolean;work?:{qualificationCalls:number;moduleEvidenceGenerations:number;derivedSkillArrays:number;wholeRowCopies:number}};

/** Current account-owned evidence is read at request time, after legacy projection.
 * No attempt ID from the old table is fabricated for a modular certificate.
 */
export async function withCurrentSkillModuleEvidence<T extends CatalogResume>(rows: T[], reader: Pick<typeof db, 'select'> = db,options:ProjectionOptions={}): Promise<(T & { categoryEvidence?: SkillCategorySnapshot | null })[]> {
  if (!skillModulesEnabled() || !rows.length) return rows;
  const inputs = await loadSkillQualificationInputs([...new Set(rows.map(row => row.userId))], reader);
  return projectCurrentSkillModuleEvidence(rows, inputs,options);
}

/** One fresh batch belongs to this request only. Partition before validation:
 * another person's decision cannot affect this résumé or consume its proof work.
 * Different role/grade/stack/skill declarations still get their own qualification. */
export function projectCurrentSkillModuleEvidence<T extends CatalogResume>(rows: T[], inputs: SkillQualificationInputs,options:ProjectionOptions={}): (T & { categoryEvidence?: SkillCategorySnapshot | null })[] {
  const evidenceByUser = new Map<number, SkillQualificationInputs['evidence']>();
  for (const evidence of inputs.evidence) {
    const owned = evidenceByUser.get(evidence.userId);
    if (owned) owned.push(evidence);
    else evidenceByUser.set(evidence.userId, [evidence]);
  }
  const qualificationByTarget = new Map<string, SkillQualification>();
  const evidenceByTarget=new Map<string,ReturnType<typeof moduleMatchEvidence>>();
  const derivedByTarget=new Map<string,WeakMap<object,{legacySkills:CatalogResume['verifiedSkills'];verifiedSkills:string[];skillEvidence:NonNullable<CatalogResume['skillEvidence']>}>>();
  return rows.map(row => {
    const target = { userId: row.userId, specialization: row.specialization, assumedGrade: row.assumedGrade ?? row.verifiedGrade ?? 'Junior', stack: row.stack, skills: row.statedSkills };
    const targetKey = JSON.stringify([target.userId, target.specialization, target.assumedGrade, target.stack, target.skills]);
    let modular = qualificationByTarget.get(targetKey);
    if (!modular) {
      if(options.work)options.work.qualificationCalls++;
      modular = getSkillQualification(target, { evidence: evidenceByUser.get(row.userId) ?? [], revokedIds: inputs.revokedIds });
      qualificationByTarget.set(targetKey, modular);
    }
    const chosen = !!modular.verifiedGrade && (!row.verifiedGrade || gradeRank[modular.verifiedGrade] >= gradeRank[row.verifiedGrade]);
    let moduleEvidence=evidenceByTarget.get(targetKey);
    if(!moduleEvidence){if(options.work)options.work.moduleEvidenceGenerations++;moduleEvidence=moduleMatchEvidence(row.userId,modular.skills);evidenceByTarget.set(targetKey,moduleEvidence);}
    let memo=derivedByTarget.get(targetKey);if(!memo){memo=new WeakMap();derivedByTarget.set(targetKey,memo);}
    const saved=row.skillEvidence?memo.get(row.skillEvidence):undefined;
    let derived=saved?.legacySkills===row.verifiedSkills?saved:undefined;
    if(!derived){if(options.work)options.work.derivedSkillArrays++;const moduleKeys=new Set(moduleEvidence.map(proof=>proof.skill));derived={legacySkills:row.verifiedSkills,verifiedSkills:[...new Set([...row.verifiedSkills,...modular.verifiedSkills])],skillEvidence:[...(row.skillEvidence??[]).filter(proof=>!moduleKeys.has(proof.skill)),...moduleEvidence]};if(row.skillEvidence)memo.set(row.skillEvidence,derived);}
    const values={verifiedSkills:derived.verifiedSkills,skillEvidence:derived.skillEvidence,
      ...(chosen?{verifiedGrade:modular.verifiedGrade,verifiedScore:null,latestAssessmentAt:modular.latestAssessmentAt,assessmentEvidence:null,categoryEvidence:modular.category}:{})};
    if(options.mutateLocalProjection){if(Object.isFrozen(row))throw new Error('Cannot enrich shared frozen pool rows in place');return Object.assign(row,values);}
    if(options.work)options.work.wholeRowCopies++;
    return {...row,...values};
  });
}

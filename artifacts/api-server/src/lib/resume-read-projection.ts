import type { ResumeQualification } from './signal-resume-qualification';
import type { SkillQualification } from './skill-module-qualification';

const gradeRank = { Junior: 1, Middle: 2, Senior: 3 };
type DerivedFields = Pick<ResumeQualification, 'verifiedGrade' | 'verifiedScore' | 'verifiedSkills' | 'latestAssessmentAt' | 'qualificationAttemptId'>;

/** A current read projection never updates the saved CV revision or its history.
 * The same grade precedence applies as during an explicit persisted recomputation. */
export function resumeReadDerivedFields(historical: ResumeQualification, modular: SkillQualification, modulesEnabled: boolean): DerivedFields {
  const useModular = modulesEnabled && modular.verifiedGrade !== null &&
    (historical.verifiedGrade === null || gradeRank[modular.verifiedGrade] >= gradeRank[historical.verifiedGrade]);
  return {
    verifiedGrade: useModular ? modular.verifiedGrade : historical.verifiedGrade,
    verifiedScore: useModular ? null : historical.verifiedScore,
    verifiedSkills: [...new Set([...historical.verifiedSkills, ...(modulesEnabled ? modular.verifiedSkills : [])])],
    latestAssessmentAt: useModular ? modular.latestAssessmentAt : historical.latestAssessmentAt,
    qualificationAttemptId: useModular ? null : historical.qualificationAttemptId,
  };
}

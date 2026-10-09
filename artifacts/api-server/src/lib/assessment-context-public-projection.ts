import { z } from 'zod';
import { PRIVATE_REQUEST_INVITATION_LABEL } from './invitation-public-projection';

const grade = z.enum(['Junior','Middle','Senior']);
// Parsing historical JSON strips unknown fields at every boundary. It does not
// replace stored context, reissue tasks or recalculate historical evidence.
const snapshotShape = z.object({
  version:z.string(), source:z.enum(['profile','invitation']),
  context:z.object({id:z.string(),title:z.string(),description:z.string(),skills:z.array(z.string()),
    coverage:z.array(z.object({requirement:z.string(),families:z.array(z.string()),evidence:z.string()}))}),
  targetGrade:grade, vacancyGrade:grade.optional(), roleTitle:z.string(),
  requirements:z.array(z.string()), unsupportedRequirements:z.array(z.string()), reason:z.string(),
});

export function candidateAssessmentContextSnapshot(saved:unknown) {
  const parsed=snapshotShape.safeParse(saved);
  if(!parsed.success)return null;
  const snapshot=parsed.data;
  if(snapshot.source === 'profile')return snapshot;
  return {...snapshot,roleTitle:PRIVATE_REQUEST_INVITATION_LABEL,
    // Company requirements are private; describe the issued public programme,
    // not the free-form strings that selected it internally.
    requirements:[...snapshot.context.skills],unsupportedRequirements:[],
    reason:`Проверка по приглашению компании. Программа Signal проверяет выбранный вами уровень ${snapshot.targetGrade}.`,
  };
}

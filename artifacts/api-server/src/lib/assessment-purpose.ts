import { z } from 'zod';
import { isAssessmentContextId } from './assessment-context';
import { postgresIntIdInputSchema, postgresIntIdSchema } from './postgres-id';

export const QualificationStartBody = z.object({
  purpose: z.literal('signal_qualification'),
  gradeConfirmed: z.literal(true),
  programId: z.enum(['backend-python', 'frontend-typescript']),
  grade: z.enum(['Junior', 'Middle', 'Senior']),
  resumeId: postgresIntIdSchema,
  contextId: z.string().max(120).refine(isAssessmentContextId).optional(),
  invitationId: postgresIntIdSchema.optional(),
}).strict().refine(value => value.contextId === undefined || value.invitationId === undefined, { message: 'Выберите один источник контекста.' });
export const QualificationSaveBody = z.object({
  answers: z.array(z.object({ caseId: z.string(), answer: z.string().max(3000) }).strict()),
  resumeId: postgresIntIdInputSchema.optional(),
}).strict();
export const QualificationSubmitBody = z.object({ resumeId: postgresIntIdInputSchema.optional() }).strict();

type PurposeAttempt = {
  id: number; resumeId: number | null; resumeRevision: number | null;
  resumeSpecialization: string | null; programId: string; programVersion: string | null;
  grade: 'Junior' | 'Middle' | 'Senior'; purpose?: string;
  purposeOrigin?: string; gradeConfirmedAt?: Date | null;
};
/** Missing purpose is an old Signal-bank record, never a company offer renamed by a client. */
export function isQualificationAttempt(attempt: Pick<PurposeAttempt, 'purpose'>) {
  return attempt.purpose === undefined || attempt.purpose === 'signal_qualification';
}
export function qualificationBasis(attempt: PurposeAttempt) {
  if (!isQualificationAttempt(attempt)) return null;
  return {
    purpose: 'signal_qualification' as const, source: 'signal_assessment' as const,
    attemptId: attempt.id, resumeId: attempt.resumeId, resumeRevision: attempt.resumeRevision,
    specialization: attempt.resumeSpecialization, programId: attempt.programId,
    programVersion: attempt.programVersion, declaredGrade: attempt.grade,
    gradeConfirmedAt: attempt.gradeConfirmedAt?.toISOString() ?? null,
    confirmationOrigin: attempt.purposeOrigin === 'candidate_confirmed' && attempt.gradeConfirmedAt
      ? 'candidate_confirmed' as const : 'legacy_unrecorded' as const,
  };
}

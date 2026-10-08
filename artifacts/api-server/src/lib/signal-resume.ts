import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { db, signalAssessmentAttemptsTable, signalAssessmentCorrectionsTable, signalCandidateProfilesTable, signalCandidateResumesTable, signalUsersTable, type SignalResumeSnapshot } from "@workspace/db";
import { emptyResume, recommendResumeGrade, ResumeQuestionnaireSchema } from "./signal-resume-contract";
import { getResumeQualification } from "./signal-resume-qualification";
import { postgresIntIdSchema } from "./postgres-id";
import { reconcileMicrotaskResume } from "./microtask-resume";
import { candidateIdentityRevision } from "./signal-candidate-identity";
import { loadSkillQualificationInputs, recordSkillCategory, skillModulesEnabled } from './skill-module-service';
import { getSkillQualification, skillLevelRank } from './skill-module-qualification';
export { getResumeQualification } from "./signal-resume-qualification";
export type { SafeResumeEvidence, ResumeQualification, ResumeQualificationAttempt } from "./signal-resume-qualification";
export type CandidateResume = typeof signalCandidateResumesTable.$inferSelect;
export type ResumeReader = Pick<typeof db, "select">;
export type ResumeWriter = Pick<typeof db, "select" | "insert" | "update" | "execute">;

export async function listCandidateResumes(userId: number, reader: ResumeReader = db): Promise<CandidateResume[]> {
  return reader.select().from(signalCandidateResumesTable).where(and(eq(signalCandidateResumesTable.userId, userId), isNull(signalCandidateResumesTable.deletedAt))).orderBy(desc(signalCandidateResumesTable.isPrimary), asc(signalCandidateResumesTable.id));
}
/** Missing ID means primary only. A damaged primary never selects an arbitrary row. */
export async function resolveCandidateResume(userId: number, resumeId?: number, reader: ResumeReader = db): Promise<CandidateResume | null> {
  if (resumeId !== undefined && !postgresIntIdSchema.safeParse(resumeId).success) return null;
  const [row] = await reader.select().from(signalCandidateResumesTable).where(and(eq(signalCandidateResumesTable.userId, userId), isNull(signalCandidateResumesTable.deletedAt), resumeId === undefined ? eq(signalCandidateResumesTable.isPrimary, true) : eq(signalCandidateResumesTable.id, resumeId))).limit(1);
  return row ?? null;
}
export function professionalResumeFields(profile: Pick<CandidateResume, "specialization" | "assumedGrade" | "verifiedGrade" | "verifiedGradeChangedAt" | "verifiedScore" | "verifiedSkills" | "stack" | "skills" | "yearsExperience" | "workFormat" | "salaryMin" | "salaryMax" | "salaryPeriod" | "salaryType" | "visibility" | "consentMatching" | "latestAssessmentAt">) {
  const { specialization, assumedGrade, verifiedGrade, verifiedGradeChangedAt, verifiedScore, verifiedSkills, stack, skills, yearsExperience, workFormat, salaryMin, salaryMax, salaryPeriod, salaryType, visibility, consentMatching, latestAssessmentAt } = profile;
  return { specialization, assumedGrade, verifiedGrade, verifiedGradeChangedAt, verifiedScore, verifiedSkills, stack, skills, yearsExperience, workFormat, salaryMin, salaryMax, salaryPeriod, salaryType, visibility, consentMatching, latestAssessmentAt };
}
/** Only a new account gets its first resume. Deleted rows remain durable tombstones. */
export async function ensureCandidateResume(userId: number, writer: ResumeWriter = db): Promise<CandidateResume | null> {
  if (writer === db) return db.transaction(tx => ensureCandidateResume(userId, tx));
  await writer.execute(sql`SELECT pg_advisory_xact_lock(3306,${userId})`);
  const existing = await writer.select().from(signalCandidateResumesTable).where(eq(signalCandidateResumesTable.userId, userId)).limit(1);
  if (existing.length) return resolveCandidateResume(userId, undefined, writer);
  const [profile] = await writer.select().from(signalCandidateProfilesTable).where(eq(signalCandidateProfilesTable.userId, userId)).limit(1);
  if (!profile) return null;
  const [created] = await writer.insert(signalCandidateResumesTable).values({
    userId, title: profile.specialization === 'Frontend / TypeScript' ? 'Frontend-разработчик' : 'Backend-разработчик', isPrimary: true, ...emptyResume(profile.specialization),
    ...professionalResumeFields(profile), legacyQualification: profile.verifiedGrade || profile.verifiedSkills.length ? {
      specialization: profile.specialization, grade: profile.verifiedGrade, score: profile.verifiedScore,
      skills: profile.verifiedSkills, assessedAt: profile.latestAssessmentAt?.toISOString() ?? null,
      gradeChangedAt: profile.verifiedGradeChangedAt?.toISOString() ?? null, attemptId: null,
      limitation: "Исторический итог без полной связи с критериями. Новые подтверждения и даты не приписываются.",
    } : null,
  }).returning();
  return created ?? null;
}
export async function getResumeProfile(userId: number, resumeId?: number, reader: ResumeReader = db) {
  const resume = await resolveCandidateResume(userId, resumeId, reader); if (!resume) return null;
  // Name and the shared identity fields must come from one live SQL snapshot.
  // Session displayName and any individual CV revision can be stale independently.
  const [shared] = await reader.select({ identity: signalCandidateProfilesTable, displayName: signalUsersTable.displayName })
    .from(signalCandidateProfilesTable).innerJoin(signalUsersTable, eq(signalUsersTable.id, signalCandidateProfilesTable.userId))
    .where(eq(signalCandidateProfilesTable.userId, userId)).limit(1);
  return shared ? { ...shared.identity, displayName: shared.displayName,
    identityRevision: candidateIdentityRevision({ ...shared.identity, displayName: shared.displayName }),
    ...professionalResumeFields(resume), resumeId: resume.id, resumeRevision: resume.revision,
    title: resume.title, consentCatalog: resume.consentCatalog, readyForOffers: resume.readyForOffers,
    qualificationAttemptId: resume.qualificationAttemptId, isPrimary: resume.isPrimary, updatedAt: resume.updatedAt } : null;
}
export async function synchronizePrimaryResume(userId: number, writer: ResumeWriter = db): Promise<void> {
  const resume = await resolveCandidateResume(userId, undefined, writer);
  if (resume) await writer.update(signalCandidateProfilesTable).set(professionalResumeFields(resume)).where(eq(signalCandidateProfilesTable.userId, userId));
  else await writer.update(signalCandidateProfilesTable).set({ verifiedGrade: null, verifiedScore: null, verifiedSkills: [], latestAssessmentAt: null, visibility: "private", consentMatching: false }).where(eq(signalCandidateProfilesTable.userId, userId));
}
export async function loadCandidateQualificationInputs(userIds: readonly number[], reader: ResumeReader = db) {
  if (!userIds.length) return { attempts: [], correctedIds: new Set<number>() };
  const attempts = await reader.select().from(signalAssessmentAttemptsTable).where(and(sql`${signalAssessmentAttemptsTable.userId} = any(${sql.param([...new Set(userIds)])}::int[])`, eq(signalAssessmentAttemptsTable.status, "submitted")));
  const corrections = attempts.length ? await reader.select({ attemptId: signalAssessmentCorrectionsTable.attemptId }).from(signalAssessmentCorrectionsTable).where(sql`${signalAssessmentCorrectionsTable.attemptId} = any(${sql.param(attempts.map(a => a.id))}::int[])`) : [];
  return { attempts, correctedIds: new Set(corrections.map(row => row.attemptId)) };
}
export async function recomputeCandidateResumes(userId: number, writer: ResumeWriter = db): Promise<CandidateResume[]> {
  if (writer === db) return db.transaction(tx => recomputeCandidateResumes(userId, tx));
  await writer.execute(sql`SELECT pg_advisory_xact_lock(3306,${userId})`);
  const resumes = await listCandidateResumes(userId, writer);
  const { attempts, correctedIds } = await loadCandidateQualificationInputs([userId], writer);
  const modularInputs = await loadSkillQualificationInputs([userId], writer);
  const result: CandidateResume[] = [];
  for (const resume of resumes) {
    const historical = getResumeQualification(resume, attempts, correctedIds);
    const modular = getSkillQualification(resume, modularInputs);
    const useModular = skillModulesEnabled() && modular.verifiedGrade && (!historical.verifiedGrade || skillLevelRank[modular.verifiedGrade] >= skillLevelRank[historical.verifiedGrade]);
    const qualification = useModular ? { ...historical, verifiedGrade: modular.verifiedGrade, verifiedScore: null, latestAssessmentAt: modular.latestAssessmentAt, qualificationAttemptId: null,
      verifiedSkills: [...new Set([...historical.verifiedSkills, ...modular.verifiedSkills])] } : { ...historical, verifiedSkills: skillModulesEnabled() ? [...new Set([...historical.verifiedSkills, ...modular.verifiedSkills])] : historical.verifiedSkills };
    const values = { verifiedGrade: qualification.verifiedGrade, verifiedScore: qualification.verifiedScore,
      verifiedSkills: qualification.verifiedSkills, latestAssessmentAt: qualification.latestAssessmentAt,
      qualificationAttemptId: qualification.qualificationAttemptId };
    if (resume.verifiedGrade !== values.verifiedGrade || resume.verifiedScore !== values.verifiedScore || JSON.stringify(resume.verifiedSkills) !== JSON.stringify(values.verifiedSkills) || resume.latestAssessmentAt?.getTime() !== values.latestAssessmentAt?.getTime() || resume.qualificationAttemptId !== values.qualificationAttemptId) {
      const [row] = await writer.update(signalCandidateResumesTable).set({ ...values, verifiedGradeChangedAt: resume.verifiedGrade !== values.verifiedGrade ? new Date() : resume.verifiedGradeChangedAt,
        revision: sql`${signalCandidateResumesTable.revision}+1`, updatedAt: new Date() }).where(and(eq(signalCandidateResumesTable.id, resume.id), isNull(signalCandidateResumesTable.deletedAt))).returning();
      if (row) { await reconcileMicrotaskResume(writer, userId, row.id); result.push(row); }
    } else result.push(resume);
    if (useModular) await recordSkillCategory(resume, writer);
  }
  await synchronizePrimaryResume(userId, writer);
  return result;
}
export async function getCandidateQuestionnaireStatus(userId: number, resumeId?: number, reader: ResumeReader = db) {
  const resume = await resolveCandidateResume(userId, resumeId, reader);
  const current = ResumeQuestionnaireSchema.safeParse(resume?.questionnaire);
  const questionnaire = current.success ? current.data : null;
  const recommendedGrade = questionnaire ? recommendResumeGrade(questionnaire).grade : null;
  return { completed: recommendedGrade !== null, recommendedGrade, specialization: questionnaire?.specialization ?? "", industry: questionnaire?.industry ?? "", resumeId: resume?.id ?? null };
}
export function snapshotCandidateResume(resume: CandidateResume): SignalResumeSnapshot {
  const { id: resumeId, revision, title, specialization, verifiedGrade, verifiedScore, verifiedSkills, stack, skills, yearsExperience, workFormat, salaryMin, salaryMax, salaryPeriod, salaryType, summary } = resume;
  return { resumeId, revision, title, specialization, verifiedGrade, verifiedScore, verifiedSkills, stack, skills, yearsExperience, workFormat, salaryMin, salaryMax, salaryPeriod, salaryType, summary, updatedAt: resume.updatedAt.toISOString() };
}

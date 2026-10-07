import { createHash } from "node:crypto";
import type { signalCandidateResumesTable, SignalLegacyQualification } from "@workspace/db";
import { EVIDENCE_COMPATIBILITY_VERSION } from "./signal-evidence-compatibility";
import { describeQualificationAttempt, getResumeQualification, qualificationEvidenceId, type CriterionApplicability, type ResumeQualificationAttempt } from "./signal-resume-qualification";

export type CandidateEvidenceResume = Pick<typeof signalCandidateResumesTable.$inferSelect,
  "id" | "userId" | "revision" | "title" | "specialization" | "visibility" | "isPrimary" | "deletedAt" | "legacyQualification">;
export type CandidateEvidenceCorrection = { attemptId: number; reason: string; createdAt: Date };
export type CandidateEvidenceApplication = Omit<CriterionApplicability, "evidenceId" | "canonicalSkillId" | "criterionId"> & { resumeId: number };
export type CandidateEvidenceItem = {
  id: string; skill: string; canonicalSkillId: string; criterionId: string; criterion: string;
  date: string; sourceType: "signal_assessment"; purpose: "signal_qualification";
  attemptId: number; originalResumeId: number | null; programId: string; programVersion: string;
  grade: "Junior" | "Middle" | "Senior"; result: number; status: "active" | "revoked";
  limitation: string | null; correction: { date: string; reason: string } | null;
  applications: CandidateEvidenceApplication[];
};

/** Owner-only read model. Source proof is never duplicated for a copied CV.
 * Applications come directly from the qualification resolver, not from labels
 * or an independent ledger/front-end compatibility calculation. */
export function buildCandidateEvidenceCatalog(userId: number, allResumes: readonly CandidateEvidenceResume[], attempts: readonly ResumeQualificationAttempt[], corrections: readonly CandidateEvidenceCorrection[]) {
  const ownedResumes = allResumes.filter(row => row.userId === userId);
  const liveResumes = ownedResumes.filter(row => !row.deletedAt).sort((a, b) => Number(b.isPrimary) - Number(a.isPrimary) || a.id - b.id);
  const ownAttempts = attempts.filter(row => row.userId === userId && row.status === "submitted" && row.submittedAt);
  const ownAttemptIds = new Set(ownAttempts.map(row => row.id));
  const correctionById = new Map(corrections.filter(row => ownAttemptIds.has(row.attemptId)).map(row => [row.attemptId, row]));
  // A linked historical summary may no longer have a full source attempt in
  // the input. Its correction still invalidates the legacy application.
  const correctedIds = new Set(corrections.map(row => row.attemptId));
  const qualifications = liveResumes.map(resume => ({ resume, qualification: getResumeQualification(resume, ownAttempts, correctedIds, { includeRetainedCriteria: true }) }));
  const evidenceById = new Map<string, CandidateEvidenceItem>();
  for (const attempt of ownAttempts) {
    const source = describeQualificationAttempt(userId, attempt);
    if (!source.valid) continue; // Never fabricate criteria for missing provenance.
    const correction = correctionById.get(attempt.id);
    for (const value of source.evidence) {
      const id = qualificationEvidenceId(value);
      if (evidenceById.has(id)) continue;
      const applications = qualifications.map(({ resume, qualification }) => {
        const outcome = qualification.applicability.find(row => row.attemptId === attempt.id);
        const criterion = outcome?.criteria?.find(row => row.evidenceId === id);
        if (!criterion) throw new Error("Qualification applicability is missing a validated owner criterion.");
        const { evidenceId: _evidenceId, canonicalSkillId: _canonicalSkillId, criterionId: _criterionId, ...application } = criterion;
        return { resumeId: resume.id, ...application };
      });
      evidenceById.set(id, { id, skill: value.skill, canonicalSkillId: value.canonicalSkillId,
        criterionId: value.criterionId, criterion: source.criterionDescriptions.get(value.criterionId) ?? value.criterion, date: value.date,
        sourceType: value.sourceType, purpose: value.purpose, attemptId: value.attemptId,
        originalResumeId: attempt.resumeId, programId: value.programId, programVersion: value.programVersion,
        grade: value.grade, result: value.result, status: correction ? "revoked" : "active",
        limitation: value.limitation, correction: correction ? { date: correction.createdAt.toISOString(), reason: correction.reason } : null,
        applications });
    }
  }
  const historicalById = new Map<string, { id: string; sourceType: "legacy_summary"; specialization: string;
    grade: "Junior" | "Middle" | "Senior" | null; score: number | null; skills: string[];
    date: string | null; programVersion: null; attemptId: number | null; limitation: string;
    status: "retained" | "revoked"; applications: { resumeId: number; applied: boolean; reason: string }[] }>();
  for (const resume of ownedResumes) {
    const legacy: SignalLegacyQualification | null = resume.legacyQualification;
    if (!legacy) continue;
    const id = `legacy:${createHash("sha256").update(JSON.stringify(legacy)).digest("hex").slice(0, 24)}`;
    if (historicalById.has(id)) continue;
    const revoked = legacy.attemptId !== null && correctedIds.has(legacy.attemptId);
    historicalById.set(id, { id, sourceType: "legacy_summary", specialization: legacy.specialization,
      grade: legacy.grade, score: legacy.score, skills: [...legacy.skills], date: legacy.assessedAt,
      programVersion: null, attemptId: legacy.attemptId, limitation: legacy.limitation,
      status: revoked ? "revoked" : "retained", applications: qualifications.map(({ resume: target, qualification }) => {
        const sameSummary = target.legacyQualification && JSON.stringify(target.legacyQualification) === JSON.stringify(legacy);
        const applied = Boolean(sameSummary && !revoked && qualification.source === "legacy" && target.specialization === legacy.specialization);
        return { resumeId: target.id, applied, reason: revoked ? "Исторический итог отозван; исходная запись сохранена." : applied ? "Сохранён исторический итог собственной специализации. Полной версии и критериев нет: индивидуальные доказательства навыков не приписываются." : "Исторический итог сохранён. Он не присваивает грейд другого направления и не заменяет более сильный применимый результат." };
      }) });
  }
  return { matrixVersion: EVIDENCE_COMPATIBILITY_VERSION,
    resumes: qualifications.map(({ resume, qualification }) => ({ id: resume.id, revision: resume.revision,
      title: resume.title, specialization: resume.specialization, visibility: resume.visibility,
      isPrimary: resume.isPrimary, verifiedGrade: qualification.verifiedGrade })),
    evidence: [...evidenceById.values()].sort((a, b) => b.date.localeCompare(a.date) || b.attemptId - a.attemptId || a.id.localeCompare(b.id)),
    historicalQualifications: [...historicalById.values()].sort((a, b) => (b.date ?? "").localeCompare(a.date ?? "") || a.id.localeCompare(b.id)) };
}

export type CandidateEvidenceCatalog = ReturnType<typeof buildCandidateEvidenceCatalog>;

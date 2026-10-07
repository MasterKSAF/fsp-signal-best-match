import { Router, type IRouter } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, signalAssessmentAttemptsTable, signalAssessmentCorrectionsTable, signalCandidateResumesTable } from "@workspace/db";
import { getSessionUser } from "../lib/signal-auth";
import { buildCandidateEvidenceCatalog } from "../lib/signal-candidate-evidence";

const router: IRouter = Router();
router.get("/me/evidence/registry", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "no-store, private");
  const session = await getSessionUser(req);
  if (!session) { res.status(401).json({ error: "Войдите в аккаунт кандидата." }); return; }
  if (session.user.role !== "candidate") { res.status(403).json({ error: "Мои подтверждения доступны только владельцу аккаунта кандидата." }); return; }
  if (Object.keys(req.query).length) { res.status(400).json({ error: "Подтверждения выбираются по текущему аккаунту. Параметры другого владельца или резюме не принимаются." }); return; }
  // One repeatable-read snapshot prevents mixed evidence/correction/CV states.
  // This GET never resurrects a deleted resume or mutates qualifications.
  const catalog = await db.transaction(async tx => {
    const resumes = await tx.select({ id: signalCandidateResumesTable.id, userId: signalCandidateResumesTable.userId,
      revision: signalCandidateResumesTable.revision, title: signalCandidateResumesTable.title,
      specialization: signalCandidateResumesTable.specialization, visibility: signalCandidateResumesTable.visibility,
      isPrimary: signalCandidateResumesTable.isPrimary, deletedAt: signalCandidateResumesTable.deletedAt,
      legacyQualification: signalCandidateResumesTable.legacyQualification }).from(signalCandidateResumesTable).where(eq(signalCandidateResumesTable.userId, session.user.id));
    const attempts = await tx.select().from(signalAssessmentAttemptsTable).where(and(eq(signalAssessmentAttemptsTable.userId, session.user.id), eq(signalAssessmentAttemptsTable.status, "submitted")));
    const correctionIds = [...new Set([...attempts.map(row => row.id), ...resumes.flatMap(row => row.legacyQualification?.attemptId ? [row.legacyQualification.attemptId] : [])])];
    const corrections = correctionIds.length ? await tx.select({ attemptId: signalAssessmentCorrectionsTable.attemptId,
      reason: signalAssessmentCorrectionsTable.reason, createdAt: signalAssessmentCorrectionsTable.createdAt }).from(signalAssessmentCorrectionsTable)
      .innerJoin(signalAssessmentAttemptsTable, eq(signalAssessmentAttemptsTable.id, signalAssessmentCorrectionsTable.attemptId))
      .where(and(inArray(signalAssessmentCorrectionsTable.attemptId, correctionIds), eq(signalAssessmentAttemptsTable.userId, session.user.id))) : [];
    return buildCandidateEvidenceCatalog(session.user.id, resumes, attempts, corrections);
  }, { isolationLevel: "repeatable read", accessMode: "read only" });
  res.json(catalog);
});
export default router;

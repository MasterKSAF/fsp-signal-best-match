import { Router, type IRouter, type Request, type Response } from "express";
import { and, eq, isNull, sql } from "drizzle-orm";
import { db, signalCandidateProfilesTable, signalCandidateResumesTable } from "@workspace/db";
import { ensureCandidateProfile, getSessionUser } from "../lib/signal-auth";
import { appendResumeQuestionnaireHistory, CopyResumeSchema, CreateResumeSchema, emptyResume, recommendResumeGrade, resumeAnswerScale, resumeQuestions, frontendResumeQuestions, questionsForResume, ResumeMetadataSchema, SaveResumeSchema, VersionedSaveResumeSchema } from "../lib/signal-resume-contract";
import { ensureCandidateResume, getResumeProfile, listCandidateResumes, loadCandidateQualificationInputs, professionalResumeFields, recomputeCandidateResumes, resolveCandidateResume, synchronizePrimaryResume, type CandidateResume } from "../lib/signal-resume";
import { getResumeQualification } from "../lib/signal-resume-qualification";
import { validateAvatarDataUrl } from "../lib/signal-avatar";
import { renderCandidateResumePdf } from "../lib/signal-resume-pdf";
import { postgresIntIdParam, postgresIntIdTextSchema } from "../lib/postgres-id";
import { revokeMicrotasksForResume } from "../lib/microtask-resume";

const router: IRouter = Router();
router.param("id", postgresIntIdParam);
async function candidate(req: Request, res: Response) {
  const session = await getSessionUser(req);
  if (!session) { res.status(401).json({ error: "Войдите в аккаунт кандидата." }); return null; }
  if (session.user.role !== "candidate") { res.status(403).json({ error: "Резюме доступно только кандидату." }); return null; }
  await ensureCandidateProfile(session.user); await ensureCandidateResume(session.user.id);
  res.setHeader("Cache-Control", "no-store, private");
  return session.user;
}
function requestedId(req: Request): number | undefined | null {
  const raw = req.params.id ?? req.query.resumeId;
  if (raw === undefined) return undefined;
  const parsed = postgresIntIdTextSchema.safeParse(raw); return parsed.success ? parsed.data : null;
}
function resumeContent(row: CandidateResume) {
  return SaveResumeSchema.parse({ summary: row.summary, softSkills: row.softSkills, experience: row.experience, projects: row.projects, education: row.education, portfolio: row.portfolio, questionnaire: row.questionnaire });
}
function responsePayload(row: CandidateResume) {
  // Database-maintained content signatures never belong to a client DTO.
  const { poolContentDigest: _poolContentDigest, ...publicRow } = row;
  return { ...publicRow, resumeId: row.id, updatedAt: row.updatedAt.toISOString(),
    recommendation: recommendResumeGrade(resumeContent(row).questionnaire), questions: questionsForResume(row.specialization),
    questionSets: { "Backend / Python": resumeQuestions, "Frontend / TypeScript": frontendResumeQuestions }, answerScale: resumeAnswerScale };
}
const notFound = (res: Response) => { res.status(404).json({ error: "Резюме не найдено или недоступно." }); };
const badInput = (res: Response, issues?: { path: PropertyKey[]; message: string }[]) => res.status(400).json({ error: "Проверьте поля резюме.", details: issues?.map(issue => ({ path: issue.path.join("."), message: issue.message })) });

router.get("/me/resumes", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const resumes = await recomputeCandidateResumes(user.id);
  const inputs = await loadCandidateQualificationInputs([user.id]);
  res.json({ resumes: resumes.map(row => ({ ...responsePayload(row), qualification: getResumeQualification(row, inputs.attempts, inputs.correctedIds) })), count: resumes.length, limit: 5 });
});
async function createResume(req: Request, res: Response, copyDefaults?: { title?: string }): Promise<void> {
  const user = await candidate(req, res); if (!user) return;
  const parsed = CreateResumeSchema.safeParse(req.body); if (!parsed.success) { badInput(res, parsed.error.issues); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const resumes = await listCandidateResumes(user.id, tx);
    if (resumes.length >= 5) return { kind: "limit" as const };
    const source = parsed.data.copyFromId ? await resolveCandidateResume(user.id, parsed.data.copyFromId, tx) : null;
    if (parsed.data.copyFromId && !source) return { kind: "missing" as const };
    const [profile] = await tx.select().from(signalCandidateProfilesTable).where(eq(signalCandidateProfilesTable.userId, user.id)).limit(1);
    const specialization = copyDefaults && source ? source.specialization : parsed.data.specialization;
    const title = copyDefaults && source ? copyDefaults.title ?? `${source.title.slice(0, 112)} — копия` : parsed.data.title;
    const sameProgram = source?.specialization === specialization;
    const values = source ? { ...resumeContent(source), ...professionalResumeFields(source), questionnaireHistory: source.questionnaireHistory } : emptyResume(specialization);
    const [created] = await tx.insert(signalCandidateResumesTable).values({ ...values, userId: user.id,
      title, specialization, isPrimary: !resumes.length,
      questionnaire: sameProgram ? source!.questionnaire : emptyResume(specialization).questionnaire,
      visibility: "private", consentMatching: false, consentCatalog: false, readyForOffers: false,
      legacyQualification: profile?.legacyQualification ?? source?.legacyQualification ?? null,
      // These are computed below; a copy cannot paste the source's grade into another program.
      verifiedGrade: null, verifiedScore: null, verifiedSkills: [], latestAssessmentAt: null,
      verifiedGradeChangedAt: null, qualificationAttemptId: null,
    }).returning();
    await recomputeCandidateResumes(user.id, tx);
    return { kind: "created" as const, row: await resolveCandidateResume(user.id, created!.id, tx) };
  });
  if (result.kind === "limit") { res.status(409).json({ error: "Можно хранить не более пяти резюме. Удалите одно, чтобы создать новое.", code: "RESUME_LIMIT", limit: 5 }); return; }
  if (result.kind === "missing" || !result.row) { notFound(res); return; }
  res.status(201).json(responsePayload(result.row));
}
router.post("/me/resumes", (req, res) => createResume(req, res));
router.post("/me/resumes/:id/copy", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); const parsed = CopyResumeSchema.safeParse(req.body ?? {});
  if (id === null || id === undefined || !parsed.success) { badInput(res, parsed.success ? undefined : parsed.error.issues); return; }
  const source = await resolveCandidateResume(user.id, id); if (!source) { notFound(res); return; }
  // The shared atomic creator reauthorizes the source under the limit lock,
  // including deletion races, and always applies closed-copy defaults.
  req.body = { title: parsed.data.title ?? `${source.title.slice(0, 112)} — копия`, specialization: source.specialization, copyFromId: source.id };
  await createResume(req, res, { title: parsed.data.title });
});

async function readResume(req: Request, res: Response): Promise<void> {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); if (id === null) { badInput(res); return; }
  await recomputeCandidateResumes(user.id);
  const row = await resolveCandidateResume(user.id, id); if (!row) { notFound(res); return; }
  const inputs = await loadCandidateQualificationInputs([user.id]);
  res.json({ ...responsePayload(row), qualification: getResumeQualification(row, inputs.attempts, inputs.correctedIds) });
}
async function saveResume(req: Request, res: Response): Promise<void> {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); if (id === null) { badInput(res); return; }
  const parsed = VersionedSaveResumeSchema.safeParse(req.body); if (!parsed.success) { badInput(res, parsed.error.issues); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const previous = await resolveCandidateResume(user.id, id, tx); if (!previous) return { kind: "missing" as const };
    if (parsed.data.revision !== undefined && parsed.data.revision !== previous.revision) return { kind: "conflict" as const };
    if (parsed.data.questionnaire.specialization !== previous.specialization) return { kind: "program" as const };
    const { revision: _revision, ...input } = parsed.data;
    const [row] = await tx.update(signalCandidateResumesTable).set({ ...input,
      questionnaireHistory: appendResumeQuestionnaireHistory(previous.questionnaireHistory, input.questionnaire),
      revision: sql`${signalCandidateResumesTable.revision}+1`, updatedAt: new Date() }).where(and(eq(signalCandidateResumesTable.id, previous.id), isNull(signalCandidateResumesTable.deletedAt))).returning();
    return { kind: "saved" as const, row };
  });
  if (result.kind === "missing") { notFound(res); return; }
  if (result.kind === "conflict") { res.status(409).json({ error: "Резюме изменилось в другой вкладке. Обновите данные перед сохранением.", code: "RESUME_REVISION_CONFLICT" }); return; }
  if (result.kind === "program") { res.status(409).json({ error: "Специализация анкеты должна совпадать с выбранным резюме." }); return; }
  res.json(responsePayload(result.row!));
}
async function resumePdf(req: Request, res: Response): Promise<void> {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); if (id === null) { badInput(res); return; }
  await recomputeCandidateResumes(user.id);
  const row = await resolveCandidateResume(user.id, id); const profile = row && await getResumeProfile(user.id, row.id);
  if (!row || !profile) { notFound(res); return; }
  const inputs = await loadCandidateQualificationInputs([user.id]);
  const qualification = getResumeQualification(row, inputs.attempts, inputs.correctedIds);
  const bytes = await renderCandidateResumePdf({ ...profile, displayName: user.displayName,
    qualificationSource: qualification.source, qualificationLimitation: qualification.limitation }, resumeContent(row));
  res.set({ "Content-Type": "application/pdf", "Content-Disposition": `attachment; filename="Signal-Resume-${row.id}.pdf"`, "Cache-Control": "no-store, private", "X-Content-Type-Options": "nosniff", "Content-Length": String(bytes.length), "X-Signal-Resume-Id": String(row.id), "X-Signal-Resume-Revision": String(row.revision) });
  res.status(200).send(bytes);
}
router.get("/me/resume", readResume);
router.put("/me/resume", saveResume);
router.get("/me/resume/pdf", resumePdf);
router.get("/me/resumes/:id/pdf", resumePdf);
router.get("/me/resumes/:id", readResume);
router.put("/me/resumes/:id", saveResume);
router.patch("/me/resumes/:id", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); const parsed = ResumeMetadataSchema.safeParse(req.body);
  if (id === null || !parsed.success) { badInput(res, parsed.success ? undefined : parsed.error.issues); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const previous = await resolveCandidateResume(user.id, id, tx); if (!previous) return { kind: "missing" as const };
    const { revision, ...values } = parsed.data;
    if (revision !== undefined && revision !== previous.revision) return { kind: "conflict" as const };
    const [row] = await tx.update(signalCandidateResumesTable).set({ ...values, revision: sql`${signalCandidateResumesTable.revision}+1`, updatedAt: new Date() }).where(eq(signalCandidateResumesTable.id, previous.id)).returning();
    if (row && (row.visibility === "private" || !row.consentMatching)) await revokeMicrotasksForResume(tx, user.id, row.id);
    await synchronizePrimaryResume(user.id, tx);
    return { kind: "saved" as const, row };
  });
  if (result.kind === "missing") { notFound(res); return; }
  if (result.kind === "conflict") { res.status(409).json({ error: "Резюме изменилось. Обновите страницу.", code: "RESUME_REVISION_CONFLICT" }); return; }
  res.json(responsePayload(result.row!));
});
router.post("/me/resumes/:id/primary", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); if (id === null || id === undefined) { badInput(res); return; }
  const row = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const selected = await resolveCandidateResume(user.id, id, tx); if (!selected) return null;
    await tx.update(signalCandidateResumesTable).set({ isPrimary: false }).where(and(eq(signalCandidateResumesTable.userId, user.id), isNull(signalCandidateResumesTable.deletedAt)));
    const [primary] = await tx.update(signalCandidateResumesTable).set({ isPrimary: true }).where(eq(signalCandidateResumesTable.id, id)).returning();
    await synchronizePrimaryResume(user.id, tx); return primary ?? null;
  });
  if (!row) { notFound(res); return; } res.json(responsePayload(row));
});
router.delete("/me/resumes/:id", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const id = requestedId(req); if (id === null || id === undefined) { badInput(res); return; }
  const deleted = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const row = await resolveCandidateResume(user.id, id, tx); if (!row) return false;
    await tx.update(signalCandidateResumesTable).set({ deletedAt: new Date(), isPrimary: false, visibility: "private", consentMatching: false, consentCatalog: false, readyForOffers: false, revision: sql`${signalCandidateResumesTable.revision}+1`, updatedAt: new Date() }).where(eq(signalCandidateResumesTable.id, id));
    await revokeMicrotasksForResume(tx, user.id, id);
    if (row.isPrimary) {
      const remaining = await listCandidateResumes(user.id, tx);
      if (remaining[0]) await tx.update(signalCandidateResumesTable).set({ isPrimary: true }).where(eq(signalCandidateResumesTable.id, remaining[0].id));
    }
    await synchronizePrimaryResume(user.id, tx); return true;
  });
  if (!deleted) { notFound(res); return; } res.status(204).end();
});
router.post("/me/avatar", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const avatar = validateAvatarDataUrl(req.body?.dataUrl);
  if (!avatar || Object.keys(req.body ?? {}).some(key => key !== "dataUrl")) { res.status(400).json({ error: "Загрузите PNG, JPEG или WebP размером до 2 МБ." }); return; }
  await db.update(signalCandidateProfilesTable).set({ avatarDataUrl: avatar.dataUrl, avatarUpdatedAt: new Date() }).where(eq(signalCandidateProfilesTable.userId, user.id));
  res.json({ avatarDataUrl: avatar.dataUrl });
});
router.delete("/me/avatar", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  await db.update(signalCandidateProfilesTable).set({ avatarDataUrl: null, avatarUpdatedAt: new Date() }).where(eq(signalCandidateProfilesTable.userId, user.id));
  res.json({ avatarDataUrl: null });
});
export default router;

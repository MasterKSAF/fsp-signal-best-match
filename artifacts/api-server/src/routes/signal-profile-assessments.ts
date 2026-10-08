import { isDeepStrictEqual } from "node:util";
import { and, desc, eq, gt, sql } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetAssessmentAttemptParams,
  GetAssessmentAttemptResponse,
  GetAssessmentHistoryResponse,
  GetCandidateProfileResponse,
  GetFspStatusResponse,
  ListAssessmentProgramsResponse,
  SaveAssessmentAnswersParams,
  SaveAssessmentAnswersResponse,
  SaveCandidateProfileBody,
  SaveCandidateProfileResponse,
  StartAssessmentAttemptResponse,
  SubmitAssessmentAttemptParams,
  SubmitAssessmentAttemptResponse,
} from "@workspace/api-zod";
import {
  db,
  signalAssessmentAttemptsTable,
  signalAssessmentContextsTable,
  signalCandidateProfilesTable,
  signalCandidateResumesTable,
  signalUsersTable,
  signalBankTemplateOverridesTable,
  signalAssessmentCorrectionsTable,
} from "@workspace/db";
import type { SignalAnswer, SignalCase } from "@workspace/db";
import {
  assessmentBankVersion,
  assembleAttempt,
  isCurrentKalibrAttempt,
  requiredScore,
  scoreAttempt,
  type AssessmentGrade,
} from "../lib/assessment-bank";
import { ensureCandidateProfile, getSessionUser } from "../lib/signal-auth";
import { contextProgramId, isAssessmentContextId, snapshotForNeed, snapshotForProfile, type AssessmentContextSnapshot } from "../lib/assessment-context";
import { assessmentPrograms, assembleManagedAttempt, exposedTemplateIds, isProgramId, ManagedBankUnavailableError, managedTemplates, programSpecialization, verifiedSkillsForAttempt } from "../lib/assessment-managed";
import { getInvitedAssessmentNeed } from "./signal-assessment-context";
import { ensureCandidateResume, getCandidateQuestionnaireStatus, getResumeProfile, resolveCandidateResume, recomputeCandidateResumes } from "../lib/signal-resume";
import { emptyResume } from "../lib/signal-resume-contract";
import { postgresIntIdSchema, postgresIntIdTextSchema } from "../lib/postgres-id";
import { QualificationStartBody, QualificationSaveBody, QualificationSubmitBody, qualificationBasis } from "../lib/assessment-purpose";
import { isOverviewDemo } from "../lib/signal-pool-scope";
import { revokeMicrotasksForResume } from "../lib/microtask-resume";
import { applyCandidateProfileRevisionGuard } from "../lib/signal-candidate-identity";
import { legacyQualificationIssuancePolicy } from "../lib/skill-bank-operator-policy";

const router: IRouter = Router();
// This router also has string program IDs: constrain integer attempt contracts
// individually instead of installing an integer policy on every :id parameter.
const BoundedGetAssessmentAttemptParams = GetAssessmentAttemptParams.extend({ id: postgresIntIdTextSchema });
const BoundedSaveAssessmentAnswersParams = SaveAssessmentAnswersParams.extend({ id: postgresIntIdTextSchema });
const BoundedSubmitAssessmentAttemptParams = SubmitAssessmentAttemptParams.extend({ id: postgresIntIdTextSchema });
const gradeRank: Record<AssessmentGrade, number> = { Junior: 1, Middle: 2, Senior: 3 };
const repeatDelayMs = 7 * 24 * 60 * 60 * 1000;
const gradeChangeDelayMs = 90 * 24 * 60 * 60 * 1000;
type AttemptRow = typeof signalAssessmentAttemptsTable.$inferSelect;
const notCorrected = () => sql`not exists (select 1 from signal_assessment_corrections correction where correction.attempt_id = ${signalAssessmentAttemptsTable.id})`;
const qualificationOnly = () => eq(signalAssessmentAttemptsTable.purpose, "signal_qualification");
async function correctionFor(attemptId: number, reader: Pick<typeof db, "select"> = db) {
  const [row] = await reader.select({ reason: signalAssessmentCorrectionsTable.reason, createdAt: signalAssessmentCorrectionsTable.createdAt }).from(signalAssessmentCorrectionsTable).where(eq(signalAssessmentCorrectionsTable.attemptId, attemptId)).limit(1);
  return row;
}

async function candidateUser(
  req: Request,
  res: Response,
  ensureProfile = true,
): Promise<{ id: number; email: string; displayName: string; demoMode: boolean; overviewDemo: boolean } | null> {
  const session = await getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Войдите в аккаунт кандидата." });
    return null;
  }
  if (session.user.role !== "candidate") {
    res.status(403).json({ error: "Этот раздел доступен кандидату." });
    return null;
  }
  if (ensureProfile) await ensureCandidateProfile(session.user);
  return {
    id: session.user.id,
    email: session.user.email,
    displayName: session.user.displayName,
    demoMode: session.demoMode,
    overviewDemo: session.overviewDemo,
  };
}

async function profileRow(userId: number) {
  await ensureCandidateResume(userId);
  return getResumeProfile(userId);
}

function requestedResumeId(req: Request, res: Response): number | undefined | null {
  if (req.body?.resumeId !== undefined && req.query.resumeId !== undefined && String(req.body.resumeId) !== String(req.query.resumeId)) {
    res.status(400).json({ error: "В запросе выбраны разные резюме." }); return null;
  }
  const value = req.body?.resumeId ?? req.query.resumeId;
  if (value === undefined) return undefined;
  const parsed = postgresIntIdTextSchema.safeParse(typeof value === "number" ? String(value) : value);
  if (!parsed.success) { res.status(400).json({ error: "Некорректный номер резюме." }); return null; }
  return parsed.data;
}

function isCurrentAttempt(attempt: AttemptRow): boolean {
  return isCurrentKalibrAttempt(attempt.cases, attempt.oracles);
}

function staleAttemptError(res: Response): void {
  res.status(409).json({
    error: "Формат этой попытки не поддерживается. История сохранена; обратитесь в поддержку.",
  });
}

function profilePayload(
  profile: NonNullable<Awaited<ReturnType<typeof profileRow>>>,
) {
  return {
    resumeId: profile.resumeId,
    title: profile.title,
    revision: profile.resumeRevision,
    identityRevision: profile.identityRevision,
    consentCatalog: profile.consentCatalog,
    readyForOffers: profile.readyForOffers,
    avatarDataUrl: profile.avatarDataUrl,
    userId: profile.userId,
    displayName: profile.displayName,
    professionalAlias: profile.professionalAlias,
    specialization: profile.specialization,
    assumedGrade: profile.assumedGrade,
    verifiedGrade: profile.verifiedGrade,
    verifiedSkills: profile.verifiedSkills,
    stack: profile.stack,
    skills: profile.skills,
    yearsExperience: profile.yearsExperience,
    workFormat: profile.workFormat,
    salaryMin: profile.salaryMin,
    salaryMax: profile.salaryMax,
    salaryPeriod: profile.salaryPeriod,
    salaryType: profile.salaryType,
    visibility: profile.visibility,
    consentMatching: profile.consentMatching,
    phone: profile.phone,
    contactEmail: profile.contactEmail,
    latestAssessmentAt: profile.latestAssessmentAt?.toISOString() ?? null,
    updatedAt: profile.updatedAt.toISOString(),
  };
}

router.get("/me/candidate-profile", async (req, res): Promise<void> => {
  const user = await candidateUser(req, res);
  if (!user) return;
  const resumeId = requestedResumeId(req, res); if (resumeId === null) return;
  await ensureCandidateResume(user.id);
  const profile = await getResumeProfile(user.id, resumeId);
  if (!profile) {
    res.status(404).json({ error: "Профиль не найден." });
    return;
  }
  res.setHeader("Cache-Control", "no-store, private");
  res.json(profilePayload(profile));
});

router.put("/me/candidate-profile", async (req, res): Promise<void> => {
  const user = await candidateUser(req, res, false); if (!user) return;
  const resumeId = requestedResumeId(req, res); if (resumeId === null) return;
  // A stale primary-form must never be retargeted by a later primary switch.
  // GET keeps its primary fallback, but writes must address a body CV ID.
  if (req.body?.resumeId === undefined) { res.status(400).json({ error: "Выберите резюме для сохранения." }); return; }
  const parsed = SaveCandidateProfileBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "Проверьте обязательные поля профиля." }); return; }
  const input = parsed.data;
  if (input.salaryMin != null && input.salaryMax != null && input.salaryMin > input.salaryMax) {
    res.status(400).json({ error: "Минимальная зарплата не может быть выше максимальной." }); return;
  }
  if (req.body.title !== undefined && (typeof req.body.title !== "string" || req.body.title.trim().length < 2 || req.body.title.length > 120)) { res.status(400).json({ error: "Название резюме должно содержать от 2 до 120 символов." }); return; }
  for (const key of ["consentCatalog", "readyForOffers"]) {
    if (req.body[key] !== undefined && typeof req.body[key] !== "boolean") { res.status(400).json({ error: "Проверьте настройки доступа." }); return; }
  }
  const saved = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${user.id})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const target = await resolveCandidateResume(user.id, resumeId, tx);
    if (!target) return { kind: "missing" as const };
    const current = await getResumeProfile(user.id, target.id, tx);
    if (!current) return { kind: "missing" as const };
    return applyCandidateProfileRevisionGuard(input, { revision: target.revision, identityRevision: current.identityRevision }, async () => {
      const now = new Date();
      await tx.update(signalCandidateResumesTable).set({
        ...(req.body.title === undefined ? {} : { title: req.body.title.trim() }),
        specialization: input.specialization, assumedGrade: input.assumedGrade,
        ...(input.specialization === target.specialization ? {} : { questionnaire: emptyResume(input.specialization).questionnaire }),
        stack: input.stack, skills: input.skills, yearsExperience: input.yearsExperience,
        workFormat: input.workFormat, salaryMin: input.salaryMin ?? null, salaryMax: input.salaryMax ?? null,
        salaryPeriod: input.salaryPeriod, salaryType: input.salaryType, visibility: input.visibility,
        consentMatching: input.consentMatching,
        ...(req.body.consentCatalog === undefined ? {} : { consentCatalog: req.body.consentCatalog }),
        ...(req.body.readyForOffers === undefined ? {} : { readyForOffers: req.body.readyForOffers }),
        revision: target.revision + 1, updatedAt: now,
      }).where(and(eq(signalCandidateResumesTable.id, target.id), eq(signalCandidateResumesTable.userId, user.id)));
      if (input.specialization !== target.specialization || input.visibility === "private" || !input.consentMatching) {
        await revokeMicrotasksForResume(tx, user.id, target.id, now);
      }
      await tx.update(signalCandidateProfilesTable).set({ professionalAlias: input.professionalAlias,
        phone: input.phone ?? null, contactEmail: input.contactEmail ?? user.email, updatedAt: now,
      }).where(eq(signalCandidateProfilesTable.userId, user.id));
      await tx.update(signalUsersTable).set({ displayName: input.displayName.trim() }).where(eq(signalUsersTable.id, user.id));
      await recomputeCandidateResumes(user.id, tx);
      return getResumeProfile(user.id, target.id, tx);
    });
  });
  if (saved.kind === "invalid") { res.status(400).json({ error: "Обновите профиль: для сохранения необходимы обе версии данных." }); return; }
  if (saved.kind === "conflict") {
    res.status(409).json({ code: saved.code, error: saved.code === "CANDIDATE_IDENTITY_REVISION_CONFLICT"
      ? "Общие данные профиля изменились в другой вкладке. Обновите данные перед сохранением."
      : "Резюме изменилось в другой вкладке. Обновите данные перед сохранением." }); return;
  }
  if (saved.kind === "missing" || !saved.value) { res.status(404).json({ error: "Резюме не найдено." }); return; }
  res.setHeader("Cache-Control", "no-store, private");
  res.json(profilePayload(saved.value));
});

router.get("/assessments/programs", async (_req, res): Promise<void> => {
  res.json(ListAssessmentProgramsResponse.parse(assessmentPrograms));
});

router.get("/assessments/programs/:id/competencies", async (req, res): Promise<void> => {
  if (!isProgramId(req.params.id)) { res.status(404).json({ error: "Программа не найдена." }); return; }
  const overrides = await db.select().from(signalBankTemplateOverridesTable);
  const disabled = new Set(overrides.filter(item => item.status === "disabled").map(item => item.templateId));
  res.json({ program: assessmentPrograms.find(item => item.id === req.params.id), templates: managedTemplates.filter(item => item.programId === req.params.id).map(item => ({ ...item, status: disabled.has(item.id) ? "disabled" : "active" })), partialCredit: "Структурированный ответ: одинаковый вес правильных компонентов на своих местах. Остальные ответы: 0 или 100.", categoryRule: "Junior: минимум 67, Middle/Senior: 83; каждый критичный критерий решён полностью." });
});

router.post("/assessments/attempts", async (req, res): Promise<void> => {
  const user = await candidateUser(req, res);
  if (!user) return;
  const parsed = QualificationStartBody.safeParse(req.body);
  if (!parsed.success || !isProgramId(parsed.data.programId)) {
    res.status(400).json({ error: "Выберите квалификационную программу Signal, резюме и явно подтвердите выбранный уровень.", code: "QUALIFICATION_CONFIRMATION_REQUIRED" });
    return;
  }
  const programId = parsed.data.programId;
  const grade = parsed.data.grade as AssessmentGrade;
  // Parse the optional context independently as well: older generated clients
  // may omit it, while malformed or conflicting selections must never be ignored.
  const contextId: unknown = req.body.contextId;
  const invitationId: unknown = req.body.invitationId;
  if ((contextId !== undefined && !isAssessmentContextId(contextId)) ||
      (invitationId !== undefined && !postgresIntIdSchema.safeParse(invitationId).success) ||
      (contextId !== undefined && invitationId !== undefined)) {
    res.status(400).json({ error: "Выберите одну программу или одно полученное приглашение." });
    return;
  }
  const resumeId = requestedResumeId(req, res); if (resumeId === null) return;
  await ensureCandidateResume(user.id);
  const decision = await db.transaction(async (tx) => {
    // One lock covers start, answer-save and submit for this candidate.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${user.id})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const profile = await getResumeProfile(user.id, resumeId, tx);
    const questionnaire = user.overviewDemo ? null : await getCandidateQuestionnaireStatus(user.id, profile?.resumeId, tx);
    if (!profile) {
      return { kind: "error" as const, status: 400 as const, error: "Сначала заполните профиль кандидата." };
    }
    if (profile.specialization !== programSpecialization(programId)) {
      return {
        kind: "error" as const,
        status: 409 as const,
        error: "Программа проверки должна совпадать со специализацией в профиле.",
      };
    }

    // Resolve and authorize the requested program before any resume/cooldown
    // shortcut. An existing attempt must never hide a forbidden invitation.
    let contextSnapshot: AssessmentContextSnapshot | null = null;
    if (typeof invitationId === "number") {
      const need = await getInvitedAssessmentNeed(user.id, invitationId, tx);
      if (!need) return { kind: "error" as const, status: 404 as const, error: "Доступное приглашение для проверки не найдено." };
      if (need.specialization !== programSpecialization(programId)) return { kind: "error" as const, status: 400 as const, error: "Специализация приглашения отличается от выбранной программы." };
       contextSnapshot = { ...snapshotForNeed(need, grade), needId: need.id, companyId: need.companyId };
    } else if (isAssessmentContextId(contextId)) {
      if (contextProgramId(contextId) !== programId) return { kind: "error" as const, status: 400 as const, error: "Роль относится к другой программе проверки." };
      contextSnapshot = snapshotForProfile(contextId, grade);
    }
    if (!user.overviewDemo && (!questionnaire?.completed || questionnaire.specialization !== profile.specialization)) {
      return { kind: "error" as const, status: 409 as const, error: "Перед проверкой навыков заполните первичный опрос в профиле." };
    }

    const now = new Date();
    const [lastCategoryChange] = await tx
      .select({
        grade: signalAssessmentAttemptsTable.grade,
        submittedAt: signalAssessmentAttemptsTable.submittedAt,
      })
      .from(signalAssessmentAttemptsTable)
      .where(
        and(
           eq(signalAssessmentAttemptsTable.userId, user.id),
           qualificationOnly(),
          eq(signalAssessmentAttemptsTable.programId, programId),
          eq(signalAssessmentAttemptsTable.status, "submitted"),
          eq(signalAssessmentAttemptsTable.gradeChanged, true),
          notCorrected(),
        ),
      )
      .orderBy(desc(signalAssessmentAttemptsTable.submittedAt))
      .limit(1);
    const currentGrade = profile.verifiedGrade as AssessmentGrade | null;
    const lastAwardedGrade = (lastCategoryChange?.grade ?? null) as AssessmentGrade | null;
    const cooldownBaseline = currentGrade && lastAwardedGrade
      ? (gradeRank[currentGrade] > gradeRank[lastAwardedGrade] ? currentGrade : lastAwardedGrade)
      : currentGrade ?? lastAwardedGrade;
    const cooldownChangedAt = lastCategoryChange?.submittedAt ?? profile.verifiedGradeChangedAt ?? null;
    // An operator correction grants one replacement decision at the affected
    // grade. Restoring an older lower proof must not make that replacement
    // unavailable for 90 days. No other grade or ordinary repeat is exempt.
    const [latestCorrection] = await tx
      .select({ createdAt: signalAssessmentCorrectionsTable.createdAt })
      .from(signalAssessmentCorrectionsTable)
      .innerJoin(signalAssessmentAttemptsTable, eq(signalAssessmentAttemptsTable.id, signalAssessmentCorrectionsTable.attemptId))
      .where(and(eq(signalAssessmentAttemptsTable.userId, user.id), qualificationOnly(), eq(signalAssessmentAttemptsTable.programId, programId), eq(signalAssessmentAttemptsTable.grade, grade)))
      .orderBy(desc(signalAssessmentCorrectionsTable.createdAt)).limit(1);
    const [replacementDecision] = latestCorrection ? await tx
      .select({ id: signalAssessmentAttemptsTable.id })
      .from(signalAssessmentAttemptsTable)
      .where(and(eq(signalAssessmentAttemptsTable.userId, user.id), qualificationOnly(), eq(signalAssessmentAttemptsTable.programId, programId), eq(signalAssessmentAttemptsTable.grade, grade), eq(signalAssessmentAttemptsTable.status, "submitted"), gt(signalAssessmentAttemptsTable.submittedAt, latestCorrection.createdAt), notCorrected()))
      .limit(1) : [];
    const correctionReplacementAvailable = Boolean(latestCorrection && !replacementDecision);
    if (
      cooldownBaseline &&
      !correctionReplacementAvailable &&
      gradeRank[grade] > gradeRank[cooldownBaseline] &&
      cooldownChangedAt &&
      now.getTime() - cooldownChangedAt.getTime() < gradeChangeDelayMs
    ) {
      const nextDate = new Date(cooldownChangedAt.getTime() + gradeChangeDelayMs);
      return {
        kind: "error" as const,
        status: 409 as const,
        error: `Следующее повышение категории будет доступно после ${nextDate.toLocaleDateString("ru-RU")}.`,
      };
    }
    const openAttempts = await tx
      .select()
      .from(signalAssessmentAttemptsTable)
      .where(
        and(
           eq(signalAssessmentAttemptsTable.userId, user.id),
           qualificationOnly(),
          eq(signalAssessmentAttemptsTable.programId, programId),
          eq(signalAssessmentAttemptsTable.status, "in_progress"),
          notCorrected(),
        ),
      )
      .orderBy(desc(signalAssessmentAttemptsTable.startedAt));
    const existing = openAttempts.find(
      (attempt) => isCurrentAttempt(attempt) && attempt.dueAt.getTime() > now.getTime(),
    );
    if (existing) {
      const [savedContext] = await tx.select({ snapshot: signalAssessmentContextsTable.snapshot })
        .from(signalAssessmentContextsTable)
        .where(eq(signalAssessmentContextsTable.attemptId, existing.id)).limit(1);
      if (existing.resumeId === profile.resumeId && existing.grade === grade && isDeepStrictEqual(savedContext?.snapshot ?? null, contextSnapshot)) {
        return { kind: "attempt" as const, attempt: existing, created: false };
      }
      return { kind: "error" as const, status: 409 as const, error: "Уже идёт проверка. Продолжите её из истории в паспорте навыков или дождитесь завершения её времени." };
    }

    // Legacy is explicitly read/complete-only in every environment. Existing
    // frozen active snapshots were restored above; an env toggle cannot reissue
    // the retired bank with known measurement defects.
    if (legacyQualificationIssuancePolicy === 'read_complete_only') {
      return {
        kind: "error" as const,
        status: 409 as const,
        code: "SKILL_MODULE_QUALIFICATION_REQUIRED",
        error: "Новая выдача прежних квалификационных форм закрыта. Ранее выданные попытки можно продолжить из истории; новые проверки доступны в матрице навыков, когда модульный режим включён.",
      };
    }

    const priorAttempts = await tx
      .select()
      .from(signalAssessmentAttemptsTable)
      .where(
        and(
           eq(signalAssessmentAttemptsTable.userId, user.id),
           qualificationOnly(),
          eq(signalAssessmentAttemptsTable.programId, programId),
          eq(signalAssessmentAttemptsTable.grade, grade),
          eq(signalAssessmentAttemptsTable.status, "submitted"),
          notCorrected(),
        ),
      )
      .orderBy(desc(signalAssessmentAttemptsTable.submittedAt));
    const lastSameGrade = priorAttempts.find(
      (attempt) => isCurrentAttempt(attempt) && Boolean(attempt.submittedAt),
    );
    if (
      lastSameGrade?.submittedAt &&
      now.getTime() - lastSameGrade.submittedAt.getTime() < repeatDelayMs
    ) {
      const nextDate = new Date(lastSameGrade.submittedAt.getTime() + repeatDelayMs);
      return {
        kind: "error" as const,
        status: 409 as const,
        error: `Повторить проверку этого уровня можно после ${nextDate.toLocaleDateString("ru-RU")}.`,
      };
    }

    await tx.execute(sql`SELECT pg_advisory_xact_lock_shared(751203)`);
    const overrides = await tx.select().from(signalBankTemplateOverridesTable);
    const exposureRows = await tx.select({ oracles: signalAssessmentAttemptsTable.oracles }).from(signalAssessmentAttemptsTable).where(and(eq(signalAssessmentAttemptsTable.userId, user.id), qualificationOnly(), eq(signalAssessmentAttemptsTable.programId, programId), eq(signalAssessmentAttemptsTable.grade, grade)));
    let form: ReturnType<typeof assembleManagedAttempt>;
    try {
      form = assembleManagedAttempt(programId, grade, undefined, { contextId: contextSnapshot?.context.id, disabledTemplateIds: overrides.filter(item => item.status === "disabled").map(item => item.templateId), previousTemplateIds: exposureRows.flatMap(item => exposedTemplateIds(item.oracles)) });
    } catch (error) {
      if (error instanceof ManagedBankUnavailableError) return { kind: "error" as const, status: 503 as const, error: error.message };
      throw error;
    }
    const { cases, oracles } = form;
    const startedAt = now;
    const dueAt = new Date(startedAt.getTime() + 45 * 60 * 1000);
    const [attempt] = await tx
      .insert(signalAssessmentAttemptsTable)
      .values({
        userId: user.id,
        purpose: "signal_qualification", purposeOrigin: "candidate_confirmed", gradeConfirmedAt: now,
        resumeId: profile.resumeId,
        resumeSpecialization: profile.specialization,
        resumeRevision: profile.resumeRevision,
        programVersion: assessmentPrograms.find(program => program.id === programId)!.version,
        programId,
        grade,
        cases,
        oracles,
        answers: [],
        startedAt,
        dueAt,
      })
      .returning();
    if (!attempt) {
      return { kind: "error" as const, status: 500 as const, error: "Не удалось начать проверку." };
    }
    if (contextSnapshot) {
      await tx.insert(signalAssessmentContextsTable).values({ attemptId: attempt.id, snapshot: contextSnapshot });
    }
    return { kind: "attempt" as const, attempt, created: true };
  });
  if (decision.kind === "error") {
    res.status(decision.status).json({ error: decision.error, ...("code" in decision ? { code: decision.code } : {}) });
    return;
  }
  res
    .status(decision.created ? 201 : 200)
    .json(await attemptPayload(decision.attempt));
});

router.get("/assessments/history", async (req, res): Promise<void> => {
  const user = await candidateUser(req, res);
  if (!user) return;
  const attempts = await db
    .select({
      id: signalAssessmentAttemptsTable.id,
      resumeId: signalAssessmentAttemptsTable.resumeId,
      resumeRevision: signalAssessmentAttemptsTable.resumeRevision,
      resumeSpecialization: signalAssessmentAttemptsTable.resumeSpecialization,
      purpose: signalAssessmentAttemptsTable.purpose,
      purposeOrigin: signalAssessmentAttemptsTable.purposeOrigin,
      gradeConfirmedAt: signalAssessmentAttemptsTable.gradeConfirmedAt,
      programVersion: signalAssessmentAttemptsTable.programVersion,
      programId: signalAssessmentAttemptsTable.programId,
      grade: signalAssessmentAttemptsTable.grade,
      status: signalAssessmentAttemptsTable.status,
      score: signalAssessmentAttemptsTable.score,
      verified: signalAssessmentAttemptsTable.verified,
      startedAt: signalAssessmentAttemptsTable.startedAt,
      dueAt: signalAssessmentAttemptsTable.dueAt,
      submittedAt: signalAssessmentAttemptsTable.submittedAt,
      cases: signalAssessmentAttemptsTable.cases,
      oracles: signalAssessmentAttemptsTable.oracles,
    })
    .from(signalAssessmentAttemptsTable)
    .where(and(eq(signalAssessmentAttemptsTable.userId, user.id), qualificationOnly()))
    .orderBy(desc(signalAssessmentAttemptsTable.startedAt))
    .limit(50);
  // Deliberately map only metadata: task texts, answers and keys never leave this endpoint.
  const corrections = await db.select().from(signalAssessmentCorrectionsTable).innerJoin(signalAssessmentAttemptsTable, eq(signalAssessmentAttemptsTable.id, signalAssessmentCorrectionsTable.attemptId)).where(eq(signalAssessmentAttemptsTable.userId, user.id));
  const correctionMap = new Map(corrections.map(row => [row.signal_assessment_corrections.attemptId, row.signal_assessment_corrections]));
  res.setHeader("Cache-Control", "no-store, private");
  res.json({
    attempts: attempts.map((attempt) => ({
      id: attempt.id,
      purpose: attempt.purpose, declaredGrade: attempt.grade, programVersion: attempt.programVersion,
      qualificationBasis: qualificationBasis(attempt),
      resumeId: attempt.resumeId,
      resumeRevision: attempt.resumeRevision,
      resumeSpecialization: attempt.resumeSpecialization,
      programId: attempt.programId,
      grade: attempt.grade,
      status: attempt.status,
      score: attempt.score,
      verified: correctionMap.has(attempt.id) ? false : attempt.verified,
      correctionReason: correctionMap.get(attempt.id)?.reason ?? null,
      startedAt: attempt.startedAt.toISOString(),
      dueAt: attempt.dueAt.toISOString(),
      submittedAt: attempt.submittedAt?.toISOString() ?? null,
      bankVersion: assessmentBankVersion(attempt.cases, attempt.oracles),
    })),
  });
});

router.get("/assessments/attempts/:id", async (req, res): Promise<void> => {
  const user = await candidateUser(req, res);
  if (!user) return;
  const resumeId = requestedResumeId(req, res); if (resumeId === null) return;
  const params = BoundedGetAssessmentAttemptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Некорректный номер попытки." });
    return;
  }
  const [attempt] = await db
    .select()
    .from(signalAssessmentAttemptsTable)
    .where(
      and(
        eq(signalAssessmentAttemptsTable.id, params.data.id),
        eq(signalAssessmentAttemptsTable.userId, user.id),
        qualificationOnly(),
      ),
    )
    .limit(1);
  if (!attempt || (resumeId !== undefined && attempt.resumeId !== resumeId)) {
    res.status(404).json({ error: "Попытка не найдена." });
    return;
  }
  if (attempt.status === "in_progress") {
    const correction = await correctionFor(attempt.id);
    if (correction) { res.status(409).json({ error: `Попытка прекращена: ${correction.reason}. Можно начать новую проверку.` }); return; }
    if (!isCurrentAttempt(attempt)) {
      staleAttemptError(res);
      return;
    }
  }
  res.json(await attemptPayload(attempt));
});

router.put("/assessments/attempts/:id/answers", async (req, res): Promise<void> => {
  const user = await candidateUser(req, res);
  if (!user) return;
  const resumeId = requestedResumeId(req, res); if (resumeId === null) return;
  const params = BoundedSaveAssessmentAnswersParams.safeParse(req.params);
  const parsed = QualificationSaveBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Проверьте ответы и попробуйте сохранить ещё раз." });
    return;
  }
  const decision = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${user.id})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const [attempt] = await tx
      .select()
      .from(signalAssessmentAttemptsTable)
      .where(
        and(
          eq(signalAssessmentAttemptsTable.id, params.data.id),
          eq(signalAssessmentAttemptsTable.userId, user.id),
          qualificationOnly(),
        ),
      )
      .limit(1);
    if (!attempt || (resumeId !== undefined && attempt.resumeId !== resumeId)) {
      return { kind: "error" as const, status: 404 as const, error: "Попытка не найдена." };
    }
    const correction = await correctionFor(attempt.id, tx);
    if (correction) return { kind: "error" as const, status: 409 as const, error: `Попытка прекращена: ${correction.reason}. Можно начать новую проверку.` };
    if (!isCurrentAttempt(attempt)) {
      return {
        kind: "error" as const,
        status: 409 as const,
        error: "Эта попытка создана по устаревшей версии КАЛИБР. Начните новую проверку.",
      };
    }
    if (attempt.status !== "in_progress") {
      return { kind: "error" as const, status: 409 as const, error: "Эта попытка уже отправлена." };
    }
    const now = new Date();
    if (attempt.dueAt.getTime() <= now.getTime()) {
      return { kind: "error" as const, status: 409 as const, error: "Время попытки истекло." };
    }
    const caseIds = new Set(attempt.cases.map((item: SignalCase) => item.id));
    const answers = Array.from(
      new Map(
        parsed.data.answers
          .filter((answer) => caseIds.has(answer.caseId))
          .map((answer) => [
            answer.caseId,
            { caseId: answer.caseId, answer: answer.answer.trim() },
          ]),
      ).values(),
    ) as SignalAnswer[];
    const [saved] = await tx
      .update(signalAssessmentAttemptsTable)
      .set({ answers })
      .where(
        and(
          eq(signalAssessmentAttemptsTable.id, attempt.id),
          eq(signalAssessmentAttemptsTable.status, "in_progress"),
          gt(signalAssessmentAttemptsTable.dueAt, now),
        ),
      )
      .returning();
    if (!saved) {
      return { kind: "error" as const, status: 409 as const, error: "Состояние попытки изменилось." };
    }
    return { kind: "attempt" as const, attempt: saved };
  });
  if (decision.kind === "error") {
    res.status(decision.status).json({ error: decision.error });
    return;
  }
  res.json(await attemptPayload(decision.attempt));
});

router.post("/assessments/attempts/:id/submit", async (req, res): Promise<void> => {
  const user = await candidateUser(req, res);
  if (!user) return;
  const resumeId = requestedResumeId(req, res); if (resumeId === null) return;
  const submission = QualificationSubmitBody.safeParse(req.body ?? {});
  if (!submission.success) { res.status(400).json({ error: "Отправка принимает только ID выбранного резюме. Назначение, программа и уровень уже зафиксированы." }); return; }
  const params = BoundedSubmitAssessmentAttemptParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Некорректный номер попытки." });
    return;
  }
  const decision = await db.transaction(async (tx) => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(${user.id})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const [attempt] = await tx
      .select()
      .from(signalAssessmentAttemptsTable)
      .where(
        and(
          eq(signalAssessmentAttemptsTable.id, params.data.id),
          eq(signalAssessmentAttemptsTable.userId, user.id),
          qualificationOnly(),
        ),
      )
      .limit(1);
    if (!attempt || (resumeId !== undefined && attempt.resumeId !== resumeId)) {
      return { kind: "error" as const, status: 404 as const, error: "Попытка не найдена." };
    }
    // Repeated submit returns the first immutable decision and never promotes twice.
    if (attempt.status === "submitted") {
      return { kind: "result" as const, attempt, gradeChanged: attempt.gradeChanged };
    }
    const correction = await correctionFor(attempt.id, tx);
    if (correction) return { kind: "error" as const, status: 409 as const, error: `Попытка прекращена: ${correction.reason}. Можно начать новую проверку.` };
    if (!isCurrentAttempt(attempt)) {
      return {
        kind: "error" as const,
        status: 409 as const,
        error: "Эта попытка создана по устаревшей версии КАЛИБР. Начните новую проверку.",
      };
    }
    const now = new Date();
    if (attempt.dueAt.getTime() <= now.getTime()) {
      return { kind: "error" as const, status: 409 as const, error: "Время попытки истекло." };
    }

    const evaluated = scoreAttempt(attempt.cases, attempt.oracles, attempt.answers);
    const attemptGrade = attempt.grade as AssessmentGrade;
    const verified =
      evaluated.score >= requiredScore(attemptGrade) && evaluated.criticalComplete;
    const awarded = await tx.select().from(signalAssessmentAttemptsTable).where(and(
      eq(signalAssessmentAttemptsTable.userId, user.id), qualificationOnly(), eq(signalAssessmentAttemptsTable.programId, attempt.programId),
      eq(signalAssessmentAttemptsTable.status, "submitted"), eq(signalAssessmentAttemptsTable.verified, true), notCorrected()
    ));
    const currentGrade = awarded.reduce<AssessmentGrade | null>((best, row) => !best || gradeRank[row.grade] > gradeRank[best] ? row.grade : best, null);
    const gradeChanged =
      verified &&
      (currentGrade === null || gradeRank[attemptGrade] > gradeRank[currentGrade]);

    const [submitted] = await tx
      .update(signalAssessmentAttemptsTable)
      .set({
        status: "submitted",
        score: evaluated.score,
        verified,
        gradeChanged,
        submittedAt: now,
      })
      .where(
        and(
          eq(signalAssessmentAttemptsTable.id, attempt.id),
          eq(signalAssessmentAttemptsTable.status, "in_progress"),
          gt(signalAssessmentAttemptsTable.dueAt, now),
        ),
      )
      .returning();
    if (!submitted) {
      return { kind: "error" as const, status: 409 as const, error: "Состояние попытки изменилось." };
    }

    // Reuse immutable proof across compatible live resumes. Deleted targets are never recreated.
    await recomputeCandidateResumes(user.id, tx);
    return { kind: "result" as const, attempt: submitted, gradeChanged };
  });
  if (decision.kind === "error") {
    res.status(decision.status).json({ error: decision.error });
    return;
  }
  res.json(await resultPayload(decision.attempt, decision.gradeChanged));
});

router.get("/fsp/status", async (_req, res): Promise<void> => {
  res.json(
    GetFspStatusResponse.parse({
      state: "demo_provider",
      provider: "MockFspRegistryAdapter",
      notice: "Показаны только синтетические демонстрационные сведения. Реестр ФСП не подключён.",
    }),
  );
});

async function attemptPayload(attempt: typeof signalAssessmentAttemptsTable.$inferSelect) {
  const saved = new Map(attempt.answers.map((item) => [item.caseId, item.answer]));
  const cases = attempt.cases.map((item) => ({
    ...item,
    savedAnswer: saved.get(item.id) ?? null,
  }));
  const result =
    attempt.status === "submitted"
      ? await resultPayload(attempt, attempt.gradeChanged)
      : null;
  return {
    id: attempt.id,
    purpose: attempt.purpose, declaredGrade: attempt.grade, qualificationBasis: qualificationBasis(attempt),
    resumeId: attempt.resumeId,
    resumeRevision: attempt.resumeRevision,
    resumeSpecialization: attempt.resumeSpecialization,
    programId: attempt.programId,
    programVersion: attempt.programVersion,
    grade: attempt.grade,
    status: attempt.status,
    cases,
    startedAt: attempt.startedAt.toISOString(),
    dueAt: attempt.dueAt.toISOString(),
    submittedAt: attempt.submittedAt?.toISOString() ?? null,
    result,
  };
}

async function resultPayload(
  attempt: typeof signalAssessmentAttemptsTable.$inferSelect,
  gradeChanged: boolean,
) {
  const evaluated = scoreAttempt(attempt.cases, attempt.oracles, attempt.answers);
  const correction = await correctionFor(attempt.id);
  const [user] = await db.select({ demoMode: signalUsersTable.demoMode, reviewScopeId: signalUsersTable.reviewScopeId }).from(signalUsersTable).where(eq(signalUsersTable.id, attempt.userId)).limit(1);
  const overviewDemo = user ? isOverviewDemo(user) : false;
  const verified =
    attempt.verified ??
    (evaluated.score >= requiredScore(attempt.grade) && evaluated.criticalComplete);
  return {
    attemptId: attempt.id,
    purpose: attempt.purpose, programId: attempt.programId, programVersion: attempt.programVersion,
    declaredGrade: attempt.grade, qualificationBasis: qualificationBasis(attempt),
    resumeId: attempt.resumeId,
    grade: attempt.grade,
    score: attempt.score ?? evaluated.score,
    verified: correction ? false : verified,
    correctionReason: correction?.reason ?? null,
    statusText: correction ? `Результат аннулирован: ${correction.reason}. Исходная попытка сохранена; доступна новая проверка.` : verified
      ? "Категория подтверждена квалификационной проверкой Signal."
      : "Недостаточно данных для подтверждения категории.",
    evidence: correction ? [] : evaluated.evidence.map((item) => ({
      ...item,
      purpose: "signal_qualification",
      source: overviewDemo ? "Demo · проверка навыков" : "Signal · проверка навыков",
      sourceType: overviewDemo ? "demo_example" : "signal_assessment",
      candidateUserId: attempt.userId,
      attemptId: attempt.id,
      date: (attempt.submittedAt ?? new Date()).toISOString(),
    })),
    nextStep: correction ? "Начните новую проверку. Ограничение повтора аннулированной попытки снято." : verified
      ? "Обновите паспорт навыков и настройки видимости."
      : `Можно повторить проверку ${attempt.grade} через 7 дней или выбрать другой доступный уровень.`,
    gradeChanged,
  };
}

export default router;

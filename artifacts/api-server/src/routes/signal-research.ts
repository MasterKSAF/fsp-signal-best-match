import { createHash, randomBytes } from 'node:crypto';
import { and, desc, eq, lt, sql } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';
import { db, signalResearchStudiesTable as studies, signalResearchEnrollmentsTable as enrollments, signalResearchAttemptsTable as attempts, signalResearchRatingsTable as ratings, signalBankTemplateOverridesTable as overrides, type ResearchResponse } from '@workspace/db';
import { getSessionUser } from '../lib/signal-auth';
import { postgresIntIdInputSchema, postgresIntIdParam, postgresIntIdSchema, parsePostgresIntId } from '../lib/postgres-id';
import { assembleManagedAttempt, assessmentPrograms, exposedTemplateIds, ManagedBankUnavailableError } from '../lib/assessment-managed';
import { requiredScore, scoreAttempt, type AttemptOracle } from '../lib/assessment-bank';
import { RESEARCH_CONSENT_VERSION, RESEARCH_PROTOCOL_VERSION, researchReport, exportResearchAnswer, aggregateResearchReport } from '../lib/research-report';
import { legacyQualificationIssuancePolicy } from '../lib/skill-bank-operator-policy';

const router: IRouter = Router();
router.param('id', postgresIntIdParam);
router.param('enrollmentId', postgresIntIdParam);
const consentText = 'Я добровольно участвую в сравнении двух форм проверки. Разрешаю сохранить мои ответы, результаты критериев, отметки пропуска/неоднозначности и время. Серверное время включает паузы; активное время сообщает браузер только при фокусе. Эти данные доступны назначенному оператору исследования, не работодателям. Рабочая категория и ограничения обычной проверки не меняются. Можно отозвать участие и удалить исследовательские ответы в любой момент.';
const operatorIds = () => new Set((process.env.SIGNAL_RESEARCH_OPERATOR_IDS ?? '').split(',').map(value => parsePostgresIntId(value.trim())).filter((value): value is number => value !== null));
const numberId = (value: unknown) => postgresIntIdInputSchema.safeParse(value);
type Enrollment = typeof enrollments.$inferSelect;
async function identity(req: Request, res: Response, operator = false) {
  const session = await getSessionUser(req);
  if (!session) { res.status(401).json({ error: 'Войдите в личный аккаунт.' }); return null; }
  if (session.demoMode || !session.user.emailVerified || (operator && !operatorIds().has(session.user.id)) || (!operator && session.user.role !== 'candidate')) { res.status(403).json({ error: operator ? 'Нет отдельного разрешения оператора исследования.' : 'Нужен подтверждённый личный аккаунт кандидата.' }); return null; }
  return session.user;
}
async function ownedStudy(req: Request, res: Response) {
  const user = await identity(req, res, true); if (!user) return null;
  const id = numberId(req.params.id);
  const [study] = id.success ? await db.select().from(studies).where(and(eq(studies.id, id.data), eq(studies.ownerUserId, user.id))).limit(1) : [];
  if (!study) { res.status(404).json({ error: 'Исследование не найдено.' }); return null; } return study;
}
async function eraseEnrollment(enrollment: Enrollment, status: 'revoked' | 'expired') {
  await db.transaction(async tx => {
    await tx.select().from(studies).where(eq(studies.id, enrollment.studyId)).for('update');
    await tx.select().from(enrollments).where(eq(enrollments.id, enrollment.id)).for('update');
    await tx.delete(attempts).where(eq(attempts.enrollmentId, enrollment.id));
    const reviews = await tx.select().from(ratings).where(eq(ratings.studyId, enrollment.studyId));
    for (const review of reviews) await tx.update(ratings).set({ ratings: review.ratings.filter(row => row.pseudonym !== enrollment.pseudonym) }).where(eq(ratings.id, review.id));
    await tx.update(enrollments).set({ status, revokedAt: status === 'revoked' ? new Date() : enrollment.revokedAt, independentGrade: null, independentBasis: null, groupAssignedAt: null, pseudonym: `withdrawn-${randomBytes(16).toString('hex')}` }).where(eq(enrollments.id, enrollment.id));
  });
}
export async function purgeExpiredResearch(now = new Date()) {
  const rows = await db.select().from(enrollments).where(and(eq(enrollments.status, 'active'), lt(enrollments.expiresAt, now)));
  for (const row of rows) await eraseEnrollment(row, 'expired');
  await db.update(attempts).set({ status: 'expired' }).where(and(eq(attempts.status, 'in_progress'), lt(attempts.dueAt, now)));
}
router.use('/research', async (_req, _res, next) => { try { await purgeExpiredResearch(); next(); } catch (error) { next(error); } });
export function startResearchRetentionScheduler(intervalMs = 60000) {
  const retentionTimer = setInterval(() => { void purgeExpiredResearch().catch(() => { /* Next request retries; never log research content. */ }); }, intervalMs);
  retentionTimer.unref();
  return () => clearInterval(retentionTimer);
}

router.get('/research/access', async (req, res) => {
  const session = await getSessionUser(req);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ operator: Boolean(session && !session.demoMode && session.user.emailVerified && operatorIds().has(session.user.id)), candidate: Boolean(session && !session.demoMode && session.user.emailVerified && session.user.role === 'candidate'), consentVersion: RESEARCH_CONSENT_VERSION });
});
router.get('/research/studies', async (req, res) => {
  const user = await identity(req, res, true); if (!user) return;
  const rows = await db.select().from(studies).where(eq(studies.ownerUserId, user.id)).orderBy(desc(studies.id));
  res.json({ studies: rows.map(({ protocolSnapshot, ...study }) => ({ ...study, protocolFrozen: Boolean(protocolSnapshot) })), programs: assessmentPrograms });
});
const CreateStudy = z.object({ title: z.string().trim().min(3).max(120), programId: z.enum(['backend-python', 'frontend-typescript']), grade: z.enum(['Junior', 'Middle', 'Senior']), retentionDays: z.number().int().min(1).max(90).default(30), measurementOrigin: z.enum(['synthetic', 'operator_declared_human']).default('synthetic') }).strict();
router.post('/research/studies', async (req, res) => {
  const user = await identity(req, res, true); if (!user) return;
  const input = CreateStudy.safeParse(req.body); if (!input.success) { res.status(400).json({ error: 'Проверьте название, программу и срок хранения 1–90 дней.' }); return; }
  if (legacyQualificationIssuancePolicy === 'read_complete_only') { res.status(409).json({ error: 'Новые исследования прежней программы закрыты. Сохранённые результаты и ранее открытые попытки остаются доступными.' }); return; }
  try {
    const study = await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock_shared(751203)`);
      const disabled = await tx.select({ templateId: overrides.templateId }).from(overrides).where(eq(overrides.status, 'disabled'));
      const forms = Object.fromEntries((['A', 'B'] as const).map((form, index) => {
        const assembled = assembleManagedAttempt(input.data.programId, input.data.grade, undefined, { forcedVariant: index as 0 | 1, disabledTemplateIds: disabled.map(row => row.templateId) });
        return [form, { ...assembled, templateIds: exposedTemplateIds(assembled.oracles) }];
      })) as NonNullable<typeof studies.$inferSelect.protocolSnapshot>['forms'];
      const [created] = await tx.insert(studies).values({ ...input.data, ownerUserId: user.id, protocolVersion: RESEARCH_PROTOCOL_VERSION, protocolSnapshot: { frozenAt: new Date().toISOString(), programVersion: assessmentPrograms.find(program => program.id === input.data.programId)!.version, scoreThreshold: requiredScore(input.data.grade), criticalCriteriaRequired: true, forms } }).returning();
      return created!;
    });
    const { protocolSnapshot, ...safe } = study;
    res.status(201).json({ study: { ...safe, protocolFrozen: true } });
  } catch (error) { if (error instanceof ManagedBankUnavailableError) { res.status(409).json({ error: 'Нельзя зафиксировать две полные формы: шаблон отключён.' }); return; } throw error; }
});
router.post('/research/studies/:id/close', async (req, res) => {
  const study = await ownedStudy(req, res); if (!study) return;
  await db.update(studies).set({ status: 'closed' }).where(eq(studies.id, study.id)); res.json({ status: 'closed' });
});
router.get('/research/studies/:id', async (req, res) => {
  const session = await getSessionUser(req);
  if (!session || session.demoMode || !session.user.emailVerified) { res.status(session ? 403 : 401).json({ error: 'Нужен подтверждённый личный аккаунт.' }); return; }
  const id = numberId(req.params.id); const [study] = id.success ? await db.select().from(studies).where(eq(studies.id, id.data)).limit(1) : [];
  if (!study) { res.status(404).json({ error: 'Исследование не найдено.' }); return; }
  const operator = operatorIds().has(session.user.id) && study.ownerUserId === session.user.id;
  if (!operator && session.user.role !== 'candidate') { res.status(403).json({ error: 'Это исследование для кандидатов.' }); return; }
  const [enrollment] = await db.select().from(enrollments).where(and(eq(enrollments.studyId, study.id), eq(enrollments.userId, session.user.id))).limit(1);
  const participants = operator ? await db.select({ id: enrollments.id, pseudonym: enrollments.pseudonym, order: enrollments.order, status: enrollments.status, independentGrade: enrollments.independentGrade, independentBasis: enrollments.independentBasis, groupAssignedAt: enrollments.groupAssignedAt, expiresAt: enrollments.expiresAt }).from(enrollments).where(eq(enrollments.studyId, study.id)) : [];
  const ownAttempts = enrollment?.status === 'active' ? await db.select({ id: attempts.id, form: attempts.form, status: attempts.status, startedAt: attempts.startedAt, dueAt: attempts.dueAt, result: attempts.result }).from(attempts).where(eq(attempts.enrollmentId, enrollment.id)).orderBy(attempts.id) : [];
  res.setHeader('Cache-Control', 'no-store');
  res.json({ study: { id: study.id, title: study.title, programId: study.programId, grade: study.grade, status: study.status, retentionDays: study.retentionDays, measurementOrigin: study.measurementOrigin, protocolVersion: study.protocolVersion }, operator, newFormsAvailable: legacyQualificationIssuancePolicy !== 'read_complete_only', consentText, consentVersion: RESEARCH_CONSENT_VERSION, enrollment: enrollment ? { id: enrollment.id, pseudonym: enrollment.pseudonym, status: enrollment.status, order: enrollment.order, independentGrade: enrollment.independentGrade, expiresAt: enrollment.expiresAt } : null, attempts: ownAttempts, participants });
});
router.post('/research/studies/:id/enroll', async (req, res) => {
  const user = await identity(req, res); if (!user) return;
  if (req.body?.consent !== true || req.body?.consentVersion !== RESEARCH_CONSENT_VERSION) { res.status(400).json({ error: 'Нужно отдельное согласие с текущими условиями исследования.' }); return; }
  const id = numberId(req.params.id); if (!id.success) { res.status(404).json({ error: 'Исследование не найдено.' }); return; }
  const result = await db.transaction(async tx => {
    const [study] = await tx.select().from(studies).where(eq(studies.id, id.data)).for('update').limit(1);
    if (!study || study.status !== 'open') return null;
    const [existing] = await tx.select().from(enrollments).where(and(eq(enrollments.studyId, study.id), eq(enrollments.userId, user.id))).limit(1);
    if (existing) return existing;
    if (legacyQualificationIssuancePolicy === 'read_complete_only') return null;
    const all = await tx.select({ id: enrollments.id }).from(enrollments).where(eq(enrollments.studyId, study.id));
    const [enrollment] = await tx.insert(enrollments).values({ studyId: study.id, userId: user.id, pseudonym: `P-${randomBytes(6).toString('hex')}`, order: all.length % 2 ? 'BA' : 'AB', consentVersion: RESEARCH_CONSENT_VERSION, expiresAt: new Date(Date.now() + study.retentionDays * 86400000) }).returning();
    return enrollment;
  });
  if (!result || result.status !== 'active') { res.status(409).json({ error: 'Новый набор прежней программы закрыт или участие завершено. Повтор запроса не восстанавливает согласие.' }); return; }
  res.json({ enrollmentId: result.id, pseudonym: result.pseudonym, order: result.order });
});
router.post('/research/studies/:id/revoke', async (req, res) => {
  const user = await identity(req, res); if (!user) return;
  const id = numberId(req.params.id); const [enrollment] = id.success ? await db.select().from(enrollments).where(and(eq(enrollments.studyId, id.data), eq(enrollments.userId, user.id))).limit(1) : [];
  if (!enrollment) { res.status(404).json({ error: 'Участие не найдено.' }); return; }
  await eraseEnrollment(enrollment, 'revoked'); res.json({ status: 'revoked', message: 'Ответы и персональные строки исследования удалены. Рабочий профиль не меняется.' });
});
router.put('/research/studies/:id/participants/:enrollmentId/group', async (req, res) => {
  const study = await ownedStudy(req, res); if (!study) return;
  const input = z.object({ grade: z.enum(['Junior', 'Middle', 'Senior']), basis: z.string().trim().min(15).max(1000) }).strict().safeParse(req.body);
  const id = numberId(req.params.enrollmentId);
  if (!input.success || !id.success) { res.status(400).json({ error: 'Укажите независимую категорию и основание до начала попытки.' }); return; }
  const changed = await db.transaction(async tx => {
    const [enrollment] = await tx.select().from(enrollments).where(and(eq(enrollments.id, id.data), eq(enrollments.studyId, study.id), eq(enrollments.status, 'active'))).for('update').limit(1);
    if (!enrollment) return false;
    const existing = await tx.select({ id: attempts.id }).from(attempts).where(eq(attempts.enrollmentId, enrollment.id)).limit(1);
    if (existing.length || enrollment.groupAssignedAt) return false;
    await tx.update(enrollments).set({ independentGrade: input.data.grade, independentBasis: input.data.basis, groupAssignedAt: new Date() }).where(eq(enrollments.id, enrollment.id)); return true;
  });
  res.status(changed ? 200 : 409).json(changed ? { saved: true } : { error: 'Группа уже зафиксирована или участие недоступно.' });
});

router.post('/research/studies/:id/attempts/start', async (req, res) => {
  const user = await identity(req, res); if (!user) return; const id = numberId(req.params.id);
  if (!id.success) { res.status(404).json({ error: 'Исследование не найдено.' }); return; }
  try {
    const result = await db.transaction(async tx => {
      const [study] = await tx.select().from(studies).where(eq(studies.id, id.data)).for('update').limit(1);
      const [enrollment] = await tx.select().from(enrollments).where(and(eq(enrollments.studyId, id.data), eq(enrollments.userId, user.id))).for('update').limit(1);
      if (!study || study.status !== 'open' || !study.protocolSnapshot || !enrollment || enrollment.status !== 'active' || enrollment.expiresAt <= new Date() || !enrollment.independentGrade) return null;
      const previous = await tx.select().from(attempts).where(eq(attempts.enrollmentId, enrollment.id)).orderBy(attempts.id);
      const active = previous.find(item => item.status === 'in_progress'); if (active) return active;
      if (legacyQualificationIssuancePolicy === 'read_complete_only') return null;
      if (previous.length >= 2) return null;
      const form = enrollment.order[previous.length] as 'A' | 'B';
      await tx.execute(sql`select pg_advisory_xact_lock_shared(751203)`);
      const disabled = await tx.select({ templateId: overrides.templateId }).from(overrides).where(eq(overrides.status, 'disabled'));
      const assembled = study.protocolSnapshot.forms[form];
      if (disabled.some(row => assembled.templateIds.includes(row.templateId))) throw new ManagedBankUnavailableError('зафиксированная форма исследования');
      const [attempt] = await tx.insert(attempts).values({ enrollmentId: enrollment.id, form, programVersion: study.protocolSnapshot.programVersion, cases: assembled.cases, oracles: assembled.oracles, dueAt: new Date(Date.now() + 45 * 60000) }).returning(); return attempt;
    });
    if (!result) { res.status(409).json({ error: 'Новые формы прежней программы не выдаются. Продолжение требует ранее открытой попытки, активного согласия и независимой группы.' }); return; }
    res.json({ attemptId: result.id });
  } catch (error) { if (error instanceof ManagedBankUnavailableError) { res.status(409).json({ error: 'Одна из форм исследования недоступна после отключения шаблона. Обратитесь к оператору.' }); return; } throw error; }
});
async function ownAttempt(req: Request, res: Response) {
  const user = await identity(req, res); if (!user) return null; const id = numberId(req.params.id);
  const [row] = id.success ? await db.select({ attempt: attempts, enrollment: enrollments, study: studies }).from(attempts).innerJoin(enrollments, eq(enrollments.id, attempts.enrollmentId)).innerJoin(studies, eq(studies.id, enrollments.studyId)).where(and(eq(attempts.id, id.data), eq(enrollments.userId, user.id), eq(enrollments.status, 'active'))).limit(1) : [];
  if (!row || row.enrollment.expiresAt <= new Date()) { res.status(404).json({ error: 'Попытка не найдена.' }); return null; } return row;
}
router.get('/research/attempts/:id', async (req, res) => {
  const row = await ownAttempt(req, res); if (!row) return;
  res.setHeader('Cache-Control', 'no-store');
  res.json({ attempt: { id: row.attempt.id, form: row.attempt.form, status: row.attempt.status, startedAt: row.attempt.startedAt, dueAt: row.attempt.dueAt, result: row.attempt.result, cases: row.attempt.cases, responses: row.attempt.responses }, studyId: row.study.id });
});
const ResponseBody = z.object({ responses: z.array(z.object({ caseId: z.string().max(250), answer: z.string().max(1000), activeMs: z.number().int().min(0).max(2700000), skipped: z.boolean(), ambiguous: z.boolean() }).strict()).max(6) }).strict();
router.put('/research/attempts/:id/answers', async (req, res) => {
  const row = await ownAttempt(req, res); if (!row) return; const input = ResponseBody.safeParse(req.body);
  if (!input.success || new Set(input.data.responses.map(item => item.caseId)).size !== input.data.responses.length || input.data.responses.some(item => !row.attempt.cases.some(task => task.id === item.caseId))) { res.status(400).json({ error: 'Проверьте ответы и отметки времени.' }); return; }
  const saved = await db.transaction(async tx => {
    const [enrollment] = await tx.select().from(enrollments).where(and(eq(enrollments.id, row.enrollment.id), eq(enrollments.status, 'active'))).for('update').limit(1);
    const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, row.attempt.id)).for('update').limit(1);
    if (!enrollment || !attempt || attempt.status !== 'in_progress' || attempt.dueAt <= new Date() || enrollment.expiresAt <= new Date()) return false;
    const now = new Date().toISOString();
    const responses: ResearchResponse[] = input.data.responses.map(item => ({ ...item, savedAtSource: 'answer_save', firstSavedAt: attempt.responses.find(old => old.caseId === item.caseId)?.firstSavedAt ?? now, lastSavedAt: now }));
    await tx.update(attempts).set({ responses }).where(eq(attempts.id, attempt.id)); return true;
  });
  res.status(saved ? 200 : 409).json(saved ? { saved: true } : { error: 'Попытка завершена или согласие отозвано.' });
});
router.post('/research/attempts/:id/submit', async (req, res) => {
  const row = await ownAttempt(req, res); if (!row) return;
  const result = await db.transaction(async tx => {
    const [enrollment] = await tx.select().from(enrollments).where(and(eq(enrollments.id, row.enrollment.id), eq(enrollments.status, 'active'))).for('update').limit(1);
    const [attempt] = await tx.select().from(attempts).where(eq(attempts.id, row.attempt.id)).for('update').limit(1);
    if (!enrollment || !attempt || enrollment.expiresAt <= new Date()) return null;
    if (attempt.status === 'submitted') return attempt.result;
    if (attempt.status !== 'in_progress' || attempt.dueAt <= new Date()) return null;
    const now = new Date();
    const completeResponses: ResearchResponse[] = attempt.cases.map(task => attempt.responses.find(item => item.caseId === task.id) ?? { caseId: task.id, answer: '', activeMs: 0, skipped: true, ambiguous: false, firstSavedAt: now.toISOString(), lastSavedAt: now.toISOString(), savedAtSource: 'missing_at_submit' });
    const evaluated = scoreAttempt(attempt.cases, attempt.oracles as AttemptOracle, completeResponses.map(item => ({ caseId: item.caseId, answer: item.skipped ? '' : item.answer })));
    const snapshot = { score: evaluated.score, verified: evaluated.score >= (row.study.protocolSnapshot?.scoreThreshold ?? requiredScore(row.study.grade)) && evaluated.criticalComplete, evidence: evaluated.evidence.map(({ skill, score, criterionId, programVersion, templateId, templateVersion }) => ({ skill, score, criterionId, programVersion, templateId, templateVersion })) };
    await tx.update(attempts).set({ status: 'submitted', submittedAt: now, responses: completeResponses, result: snapshot }).where(eq(attempts.id, attempt.id)); return snapshot;
  });
  res.status(result ? 200 : 409).json(result ? { result, profileChanged: false } : { error: 'Попытка истекла или участие завершено.' });
});

async function measurements(studyId: number) {
  return db.select({ pseudonym: enrollments.pseudonym, independentGrade: enrollments.independentGrade, form: attempts.form, programVersion: attempts.programVersion, result: attempts.result, responses: attempts.responses, startedAt: attempts.startedAt, submittedAt: attempts.submittedAt, status: attempts.status }).from(attempts).innerJoin(enrollments, eq(enrollments.id, attempts.enrollmentId)).where(and(eq(enrollments.studyId, studyId), eq(enrollments.status, 'active')));
}
router.get('/research/studies/:id/report', async (req, res) => {
  const study = await ownedStudy(req, res); if (!study) return;
  const [rows, reviews] = await Promise.all([measurements(study.id), db.select().from(ratings).where(eq(ratings.studyId, study.id))]);
  res.setHeader('Cache-Control', 'no-store'); res.json(researchReport(rows, study.grade, reviews, study.measurementOrigin));
});
router.get('/research/studies/:id/aggregate-report', async (req, res) => {
  const study = await ownedStudy(req, res); if (!study) return;
  const [rows, reviews] = await Promise.all([measurements(study.id), db.select().from(ratings).where(eq(ratings.studyId, study.id))]);
  res.setHeader('Cache-Control', 'no-store'); res.json(aggregateResearchReport(researchReport(rows, study.grade, reviews, study.measurementOrigin)));
});
router.get('/research/studies/:id/private-responses', async (req, res) => {
  const study = await ownedStudy(req, res); if (!study) return;
  const rows = await measurements(study.id);
  res.setHeader('Cache-Control', 'no-store');
  res.json({ protocolVersion: study.protocolVersion, sensitivity: 'Private consented research answers: may contain user-entered personal text. Never publish or add to submission archives.', forms: study.protocolSnapshot ? { A: study.protocolSnapshot.forms.A.cases, B: study.protocolSnapshot.forms.B.cases } : null, measurements: rows });
});
router.get('/research/studies/:id/export', async (req, res) => {
  const study = await ownedStudy(req, res); if (!study) return;
  const rows = await measurements(study.id);
  const taskRows = await db.select({ pseudonym: enrollments.pseudonym, form: attempts.form, cases: attempts.cases }).from(attempts).innerJoin(enrollments, eq(enrollments.id, attempts.enrollmentId)).where(and(eq(enrollments.studyId, study.id), eq(enrollments.status, 'active')));
  // No account IDs, contact data, arbitrary free text, cases, oracle or seed.
  // This is pseudonymous, not anonymous; only aggregate-report is for public reports.
  res.setHeader('Cache-Control', 'no-store');
  res.json({ protocolVersion: study.protocolVersion, measurementOrigin: study.measurementOrigin, studyId: study.id, rubric: { grade: study.grade, scoreThreshold: study.protocolSnapshot?.scoreThreshold ?? null, criticalCriteriaRequired: true, frozenAt: study.protocolSnapshot?.frozenAt ?? null, programVersion: study.protocolSnapshot?.programVersion ?? null, forms: study.protocolSnapshot ? Object.fromEntries((['A', 'B'] as const).map(form => [form, study.protocolSnapshot!.forms[form].cases.map(task => { const blueprint = (study.protocolSnapshot!.forms[form].oracles as AttemptOracle)[task.id]?.blueprint; return { caseId: task.id, title: task.title, criterionId: blueprint?.family ?? null, templateId: blueprint?.templateId ?? null, templateVersion: blueprint?.templateVersion ?? null, critical: blueprint?.critical ?? null }; })])) : null }, measurements: rows.map(row => ({ ...row, responses: row.responses.map(({ answer, ...item }) => ({ ...item, responseLength: answer.length, normalizedAnswer: exportResearchAnswer(answer, taskRows.find(task => task.pseudonym === row.pseudonym && task.form === row.form)?.cases.find(task => task.id === item.caseId)?.options ?? []) })) })), humanProvenance: 'Requires independent external protocol; synthetic controls are not human pilots.', privacy: 'Pseudonymous, not anonymous. Account mapping and arbitrary text are excluded. Review before sharing; use aggregate-report for a public report.' });
});
router.get('/research/studies/:id/review-packet', async (req, res) => {
  const study = await ownedStudy(req, res); if (!study) return;
  const active = await db.select({ pseudonym: enrollments.pseudonym }).from(enrollments).where(and(eq(enrollments.studyId, study.id), eq(enrollments.status, 'active')));
  res.json({ studyId: study.id, protocolVersion: study.protocolVersion, reviewerId: '', instructions: 'Два специалиста независимо оценивают уровень по разрешённой внешней работе/интервью; баллы Signal, A/B, независимая группа и оценки коллеги не показываются. Для связи используйте код участника. Затем заполните категорию и основание.', ratings: active.map(row => ({ pseudonym: row.pseudonym, grade: null, comment: '' })) });
});
router.get('/research/studies/:id/reviews', async (req, res) => {
  const study = await ownedStudy(req, res); if (!study) return;
  const originals = await db.select().from(ratings).where(eq(ratings.studyId, study.id)).orderBy(ratings.id);
  res.json({ reviews: originals.map(({ id: _id, studyId: _studyId, ...original }) => original), sensitivity: 'Original independent ratings and disagreements. Restricted research data, not a public report.' });
});
router.post('/research/studies/:id/reviews', async (req, res) => {
  const study = await ownedStudy(req, res); if (!study) return;
  if (study.status !== 'closed') { res.status(409).json({ error: 'Закройте набор исследования перед импортом независимой разметки.' }); return; }
  const input = z.object({ studyId: postgresIntIdSchema, protocolVersion: z.literal(RESEARCH_PROTOCOL_VERSION), reviewerId: z.string().trim().min(3).max(100), ratings: z.array(z.object({ pseudonym: z.string(), grade: z.enum(['Junior', 'Middle', 'Senior']), comment: z.string().trim().min(10).max(1000) }).strict()).min(1).max(2000) }).passthrough().safeParse(req.body);
  if (!input.success || input.data.studyId !== study.id) { res.status(400).json({ error: 'Проверьте исследование, автора и исходную разметку.' }); return; }
  const active = await db.select({ pseudonym: enrollments.pseudonym }).from(enrollments).where(and(eq(enrollments.studyId, study.id), eq(enrollments.status, 'active')));
  const expected = new Set(active.map(row => row.pseudonym));
  if (input.data.ratings.length !== expected.size || new Set(input.data.ratings.map(row => row.pseudonym)).size !== expected.size || input.data.ratings.some(row => !expected.has(row.pseudonym))) { res.status(400).json({ error: 'Нужна полная разметка активных участников без дублей.' }); return; }
  const inserted = await db.transaction(async tx => {
    await tx.select().from(studies).where(eq(studies.id, study.id)).for('update');
    const cohort = await tx.select({ pseudonym: enrollments.pseudonym }).from(enrollments).where(and(eq(enrollments.studyId, study.id), eq(enrollments.status, 'active')));
    if (cohort.length !== input.data.ratings.length || input.data.ratings.some(row => !cohort.some(member => member.pseudonym === row.pseudonym))) return false;
    const existing = await tx.select().from(ratings).where(eq(ratings.studyId, study.id));
    const reviewerId = input.data.reviewerId.toLowerCase();
    if (existing.length >= 2 || existing.some(row => row.reviewerId === reviewerId)) return false;
    await tx.insert(ratings).values({ studyId: study.id, reviewerId, ratings: input.data.ratings, sourceSha256: createHash('sha256').update(JSON.stringify(req.body)).digest('hex') }); return true;
  });
  res.status(inserted ? 201 : 409).json(inserted ? { imported: true } : { error: 'Сохраняются два независимых исходных файла. Повторная запись автора не перезаписывает оценку.' });
});
export default router;

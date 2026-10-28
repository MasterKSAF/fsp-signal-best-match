import { randomUUID } from 'node:crypto';
import { and, desc, eq, gte, inArray, sql } from 'drizzle-orm';
import { Router, type IRouter, type Request, type Response } from 'express';
import { z } from 'zod';
import { db, signalSkillAttemptsTable as attempts, signalSkillBankReleasesTable as releases, signalSkillEvidenceTable as evidence, signalSkillExposuresTable as exposures, signalBankTemplateOverridesTable as overrides, signalAssessmentAttemptsTable as oldAttempts, signalAssessmentCorrectionsTable as oldCorrections, signalCandidateResumesTable as resumes } from '@workspace/db';
import { bankContentHash, currentBankBundle, SkillBankNotAttestedError } from '../lib/skill-bank-manifest';
import { ensureCandidateProfile, getSessionUser } from '../lib/signal-auth';
import { listCandidateResumes, recomputeCandidateResumes, resolveCandidateResume } from '../lib/signal-resume';
import { buildSkillAttempt, changedConditionTraining, scoreSkillAttempt, skillModulePolicy, skillModuleRegistry, SkillBankUnavailableError, skillModuleTemplates, skillContentFamilyId, SKILL_BANK_VERSION } from '../lib/skill-module-bank';
import { findContinuableSkillAttempt, getSkillBankAvailability } from '../lib/skill-bank-availability';
import { getSkillQualification, selectAccountSkillEvidence, skillLevelRank } from '../lib/skill-module-qualification';
import { getCurrentResumeWorkspaceQualification, loadSkillQualificationInputs, skillModulesEnabled, skillAttemptRevocation } from '../lib/skill-module-service';
import { passportRelatedSkillIds, projectPassportAccountSkills } from '../lib/skill-passport-projection';
import { postgresIntIdSchema, postgresIntIdTextSchema } from '../lib/postgres-id';
import { skillIssueRestriction } from '../lib/skill-module-policy';
const router: IRouter = Router();
const Level = z.enum(['Junior', 'Middle', 'Senior']);
const Start = z.object({ resumeId: postgresIntIdSchema, skillId: z.string().min(1).max(60), level: Level, programVersion: z.string().min(1).max(120).optional() }).strict();
const Answers = z.record(z.string().regex(/^q[1-6]$/), z.string().max(2000));
const Save = z.object({ revision: z.number().int().min(1), answers: Answers }).strict();
type Row = typeof attempts.$inferSelect;
async function candidate(req: Request, res: Response) {
  const session = await getSessionUser(req);
  if (!session) { res.status(401).json({ error: 'Войдите в аккаунт кандидата.' }); return null; }
  if (session.user.role !== 'candidate') { res.status(403).json({ error: 'Проверка навыков доступна кандидату.' }); return null; }
  if (!skillModulesEnabled()) { res.status(503).json({ error: 'Модульные проверки пока не включены в этой среде.', code: 'skill_modules_disabled' }); return null; }
  await ensureCandidateProfile(session.user);
  res.setHeader('Cache-Control', 'no-store, private');
  return session.user;
}
function parseResume(req: Request, res: Response) {
  const parsed = postgresIntIdTextSchema.safeParse(req.query.resumeId);
  if (!parsed.success) { res.status(400).json({ error: 'Выберите конкретное резюме.', code: 'resume_required' }); return null; } return parsed.data;
}
export function publicSkillAttempt(row: Row, revocation: { reason: string; date: string } | null = null) {
  return { id: row.id, resumeId: row.resumeId, skillId: row.skillId, level: row.level, programVersion: row.programVersion, status: row.status,
    provenance: row.provenance ? { status: 'complete', releaseId: row.provenance.releaseId, contentHash: row.provenance.contentHash, attestationHash: row.provenance.attestationHash } : { status: 'legacy_snapshot', releaseId: null, contentHash: null, attestationHash: null },
    cases: row.cases, answers: row.answers, revision: row.revision, policy: row.policy, revocation,
    startedAt: row.startedAt.toISOString(), expiresAt: row.expiresAt.toISOString(), submittedAt: row.submittedAt?.toISOString() ?? null, decision: row.decision,
    feedback: row.status === 'submitted' ? row.cases.map(c => ({ competencyId: c.competencyId, title: c.title, explanation: row.oracles[c.id]?.explanation ?? '', passed: row.decision?.competencies.find(v => v.id === c.competencyId)?.passed ?? false })) : [] };
}
router.get('/me/skill-matrix', async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  // Viewing the account passport/history requires no CV; an explicit foreign/deleted ID still fails closed.
  const resumeId = req.query.resumeId === undefined ? undefined : parseResume(req, res); if (resumeId === null) return;
  const resume = resumeId === undefined ? null : await resolveCandidateResume(user.id, resumeId);
  if (resumeId !== undefined && !resume) { res.status(404).json({ error: 'Резюме не найдено.' }); return; }
  const [inputs, history, disabled, contexts, seen] = await Promise.all([loadSkillQualificationInputs([user.id]), db.select().from(attempts).where(eq(attempts.userId, user.id)).orderBy(desc(attempts.startedAt), desc(attempts.id)), db.select().from(overrides).where(eq(overrides.status, 'disabled')), listCandidateResumes(user.id), db.select({ templateId: exposures.templateId }).from(exposures).where(eq(exposures.userId, user.id))]);
  const personal = new Map<string, number>();
  for (const exposure of seen) personal.set(exposure.templateId, (personal.get(exposure.templateId) ?? 0) + 1);
  const disabledIds = new Set(disabled.map(d => d.templateId));
  const now = new Date();
  const accountTarget = { userId: user.id, specialization: '', assumedGrade: 'Junior' as const, stack: [], skills: [] };
  const accountEvidence = selectAccountSkillEvidence(accountTarget, inputs);
  const old = await db.select({ id: oldAttempts.id, resumeId: oldAttempts.resumeId, status: oldAttempts.status, grade: oldAttempts.grade, programId: oldAttempts.programId, programVersion: oldAttempts.programVersion, score: oldAttempts.score, verified: oldAttempts.verified, submittedAt: oldAttempts.submittedAt, startedAt: oldAttempts.startedAt, dueAt: oldAttempts.dueAt }).from(oldAttempts).where(eq(oldAttempts.userId, user.id)).orderBy(desc(oldAttempts.startedAt)).limit(50);
  const corrections = old.length ? await db.select({attemptId:oldCorrections.attemptId,reason:oldCorrections.reason}).from(oldCorrections).where(inArray(oldCorrections.attemptId,old.map(a=>a.id))) : [];
  res.json({ bankVersion: SKILL_BANK_VERSION, policy: skillModulePolicy,
    resume: resume ? { id: resume.id, revision: resume.revision, title: resume.title, specialization: resume.specialization, targetGrade: resume.assumedGrade, statedSkills: [...new Set([...resume.stack, ...resume.skills])] } : null,
    skillContexts: contexts.map(c => ({ id: c.id, title: c.title, specialization: c.specialization, targetGrade: c.assumedGrade, statedSkills: [...new Set([...c.stack, ...c.skills])], relatedSkillIds: passportRelatedSkillIds(c, inputs) })),
    accountSkills: projectPassportAccountSkills(contexts, inputs, accountEvidence),
    modules: skillModuleRegistry.map(module => ({ ...module, levels: (['Junior', 'Middle', 'Senior'] as const).map(level => {
      const active = findContinuableSkillAttempt(history, module.id, level, now);
      const availability = getSkillBankAvailability(module, level, { templates: skillModuleTemplates, personalExposures: personal, disabled: disabledIds, contentFamilyId: skillContentFamilyId });
      return { level, ...availability,
        evidence: accountEvidence.find(e => e.skillId === module.id && skillLevelRank[e.level] >= skillLevelRank[level]) ?? null,
        activeAttemptId: active?.id ?? null, restriction: active ? null : skillIssueRestriction(history, module.id, level, now) };
    }) })), qualification: resume ? getSkillQualification(resume, inputs) : null, accountEvidence,
    history: await Promise.all(history.slice(0, 50).map(async a => ({ id: a.id, skillId: a.skillId, level: a.level, status: a.status === 'active' && +a.expiresAt <= +now ? 'expired' : a.status, startedAt: a.startedAt.toISOString(), submittedAt: a.submittedAt?.toISOString() ?? null, decision: a.decision, programVersion: a.programVersion, resumeId: a.resumeId, revocation: await skillAttemptRevocation(a.id,user.id) }))),
    historicalQualification: resume ? await getCurrentResumeWorkspaceQualification(resume) : null,
    historicalAttempts: old.map(a => ({ ...a, correctionReason: corrections.find(c=>c.attemptId===a.id)?.reason ?? null, active: a.status === 'in_progress' && +a.dueAt > +now })) });
});
router.get('/me/skill-qualification', async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return; const resumeId = parseResume(req, res); if (resumeId === null) return;
  const resume = await resolveCandidateResume(user.id, resumeId); if (!resume) { res.status(404).json({ error: 'Резюме не найдено.' }); return; }
  res.json(await getCurrentResumeWorkspaceQualification(resume));
});
router.post('/me/skill-target', async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const parsed = z.object({ resumeId: postgresIntIdSchema, revision: z.number().int().min(1), grade: Level }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: 'Укажите целевой грейд и актуальную версию резюме.' }); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4410,${user.id})`);
    await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${user.id})`);
    const resume = await resolveCandidateResume(user.id, parsed.data.resumeId, tx);
    if (!resume) return { status: 404, body: { error: 'Резюме не найдено.' } };
    if (resume.revision !== parsed.data.revision) return { status: 409, body: { error: 'Резюме изменено в другой вкладке. Обновите страницу и выберите цель снова.', code: 'resume_revision_conflict' } };
    if (resume.assumedGrade !== parsed.data.grade) await tx.update(resumes).set({ assumedGrade: parsed.data.grade, revision: sql`${resumes.revision}+1`, updatedAt: new Date() }).where(eq(resumes.id, resume.id));
    await recomputeCandidateResumes(user.id, tx);
    return { status: 200, body: { saved: true } };
  }); res.status(result.status).json(result.body);
});
router.post('/me/skill-attempts', async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const parsed = Start.safeParse(req.body); if (!parsed.success) { res.status(400).json({ error: 'Выберите резюме, навык и уровень.' }); return; }
  const input = parsed.data;
  const module = skillModuleRegistry.find(m => m.id === input.skillId);
  if (!module || !module.availableLevels.includes(input.level)) { res.status(422).json({ error: 'Для этого навыка и уровня проверка не подготовлена.', code: 'unsupported_skill_level' }); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4410,${user.id})`);
    const resume = await resolveCandidateResume(user.id, input.resumeId, tx); if (!resume) return { status: 404, body: { error: 'Резюме не найдено.' } };
    const now = new Date();
    const rows = await tx.select().from(attempts).where(eq(attempts.userId, user.id)).orderBy(desc(attempts.startedAt));
    const active = findContinuableSkillAttempt(rows, input.skillId, input.level, now);
    if (active) return { status: 200, body: { attempt: publicSkillAttempt(active), resumed: true } };
    // A programme update does not invalidate an already-issued immutable snapshot.
    if ((input.level === 'Senior' && input.programVersion !== SKILL_BANK_VERSION) || (input.programVersion && input.programVersion !== SKILL_BANK_VERSION)) return { status: 409, body: { error: 'Программа обновилась. Обновите матрицу и выберите уровень снова.', code: 'skill_program_version_conflict' } };
    const restriction = skillIssueRestriction(rows, input.skillId, input.level, now); if (restriction) return { status: 429, body: restriction };
    await tx.update(attempts).set({ status: 'expired' }).where(and(eq(attempts.userId, user.id), eq(attempts.status, 'active'), sql`${attempts.expiresAt} <= ${now}`));
    // Account locking prevents limit races; short global lock atomically balances issued templates.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4411,1)`);
    // Reuse bank management's lock: a completed disable cannot race a fresh issue.
    await tx.execute(sql`SELECT pg_advisory_xact_lock(751203)`);
    const exposureRows = await tx.select().from(exposures).where(sql`${exposures.userId} = ${user.id} OR ${exposures.issuedAt} >= ${new Date(+now - 30 * 24 * 3600_000)}`);
    const personal = new Map<string, number>(); const global = new Map<string, number>();
    for (const exposure of exposureRows) { if (exposure.userId === user.id) personal.set(exposure.templateId, (personal.get(exposure.templateId) ?? 0) + 1); if (+exposure.issuedAt >= +now - 30 * 24 * 3600_000) global.set(exposure.templateId, (global.get(exposure.templateId) ?? 0) + 1); }
    const disabled = await tx.select().from(overrides).where(eq(overrides.status, 'disabled'));
    const disabledIds = new Set(disabled.map(d => d.templateId));
    const availability = getSkillBankAvailability(module, input.level, { templates: skillModuleTemplates, personalExposures: personal, disabled: disabledIds, contentFamilyId: skillContentFamilyId });
    if (!availability.available) return { status: 503, body: { error: availability.reason!, code: 'skill_bank_unavailable' } };
    let bank: ReturnType<typeof currentBankBundle>;
    try { bank = currentBankBundle(); }
    catch (error) { if (error instanceof SkillBankNotAttestedError) return { status: 503, body: { error: error.message, code: 'skill_bank_not_attested' } }; throw error; }
    let form: ReturnType<typeof buildSkillAttempt>;
    const seed = randomUUID();
    try { form = buildSkillAttempt(input.skillId, input.level, seed, { personalExposures: personal, globalExposures: global, disabled: disabledIds }); }
    catch (error) { if (error instanceof SkillBankUnavailableError) return { status: 503, body: { error: error.message, code: 'skill_bank_unavailable' } }; throw error; }
    const attestationHash = bankContentHash(bank.attestation);
    await tx.insert(releases).values({ contentHash: bank.manifestHash, releaseId: bank.releaseId, programVersion: form.programVersion, manifest: bank.manifest, sources: bank.sources, attestation: bank.attestation, attestationHash }).onConflictDoNothing();
    const [archive] = await tx.select().from(releases).where(eq(releases.contentHash, bank.manifestHash));
    if (!archive || archive.attestationHash !== attestationHash || bankContentHash(archive.manifest) !== bank.manifestHash) throw new Error('Immutable bank archive conflict');
    const [row] = await tx.insert(attempts).values({ userId: user.id, resumeId: resume.id, skillId: input.skillId, level: input.level, ...form, bankReleaseHash: bank.manifestHash, provenance: { status: 'complete', releaseId: bank.releaseId, contentHash: bank.manifestHash, attestationHash, seed, variantHash: bankContentHash({ cases: form.cases, oracles: form.oracles, policy: form.policy }) }, status: 'active', startedAt: now, expiresAt: new Date(+now + form.policy.durationMinutes * 60_000) }).returning();
    if (!row) throw new Error('Attempt could not be created');
    await tx.insert(exposures).values(row.cases.map(c => ({ userId: user.id, attemptId: row.id, templateId: c.templateId, issuedAt: now }))).onConflictDoNothing();
    return { status: 201, body: { attempt: publicSkillAttempt(row), resumed: false } };
  });
  res.status(result.status).json(result.body);
});
router.get('/me/skill-attempts/:id', async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return; const id = postgresIntIdTextSchema.safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: 'Некорректный номер проверки.' }); return; }
  const [row] = await db.select().from(attempts).where(and(eq(attempts.id, id.data), eq(attempts.userId, user.id))).limit(1);
  if (!row) { res.status(404).json({ error: 'Проверка не найдена.' }); return; }
  res.json(publicSkillAttempt(row.status === 'active' && +row.expiresAt <= Date.now() ? { ...row, status: 'expired' } : row, await skillAttemptRevocation(row.id,user.id)));
});
async function writeAttempt(req: Request, res: Response, submit: boolean) {
  const user = await candidate(req, res); if (!user) return;
  const id = postgresIntIdTextSchema.safeParse(req.params.id); const parsed = Save.safeParse(req.body);
  if (!id.success || !parsed.success) { res.status(400).json({ error: 'Проверьте ответы и версию сохранения.' }); return; }
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4410,${user.id})`);
    const [row] = await tx.select().from(attempts).where(and(eq(attempts.id, id.data), eq(attempts.userId, user.id))).limit(1);
    if (!row) return { status: 404, body: { error: 'Проверка не найдена.' } };
    if (row.status === 'submitted') return submit ? { status: 200, body: { attempt: publicSkillAttempt(row,await skillAttemptRevocation(row.id,user.id,tx)), alreadySubmitted: true } } : { status: 409, body: { error: 'Проверка уже завершена.' } };
    if (row.status === 'expired' || +row.expiresAt <= Date.now()) { await tx.update(attempts).set({ status: 'expired' }).where(eq(attempts.id, row.id)); return { status: 409, body: { error: 'Время проверки истекло. Черновик и прежние подтверждения сохранены.', code: 'attempt_expired' } }; }
    if (parsed.data.revision !== row.revision) return { status: 409, body: { error: 'Ответы изменены в другой вкладке. Обновите проверку перед продолжением.', code: 'answer_revision_conflict' } };
    const now = new Date(); const answers = parsed.data.answers;
    const decision = submit ? scoreSkillAttempt(row.cases, row.oracles, answers, row.policy) : null;
    const [updated] = await tx.update(attempts).set({ answers, revision: row.revision + 1, ...(submit ? { status: 'submitted' as const, submittedAt: now, decision } : {}) }).where(eq(attempts.id, row.id)).returning();
    if (!updated) throw new Error('Attempt missing after update');
    if (decision?.passed) await tx.insert(evidence).values({ userId: user.id, attemptId: row.id, skillId: row.skillId, level: row.level, programVersion: row.programVersion, competencyIds: decision.competencies.filter(c => c.passed).map(c => c.id), verifiedAt: now, decision }).onConflictDoNothing();
    if (submit) await recomputeCandidateResumes(user.id, tx);
    return { status: 200, body: { attempt: publicSkillAttempt(updated) } };
  }); res.status(result.status).json(result.body);
}
router.put('/me/skill-attempts/:id/answers', (req, res) => writeAttempt(req, res, false));
router.post('/me/skill-attempts/:id/submit', (req, res) => writeAttempt(req, res, true));
router.get('/me/skill-training/changed-condition', async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return; const question = changedConditionTraining('python', 'Junior');
  if (!question) { res.status(404).json({ error: 'Тренировка не подготовлена.' }); return; }
  const { expected: _expected, ...publicQuestion } = question; res.json(publicQuestion);
});
router.post('/me/skill-training/changed-condition', async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return; const answer = z.object({ answer: z.string().max(30) }).strict().safeParse(req.body);
  if (!answer.success) { res.status(400).json({ error: 'Выберите ответ.' }); return; }
  res.json({ passed: answer.data.answer === changedConditionTraining('python', 'Junior')?.expected, qualificationImpact: false, explanation: 'Срез создаёт новый внешний список; append в копии не меняет длину исходного списка.' });
});
export default router;

/** Actual isolated HTTP acceptance; private oracle reads solve owned synthetic
 * fixtures only. No credentials, answers or personal text enter the report. */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { emptyResume } from '../artifacts/api-server/src/lib/signal-resume-contract';
import { captureV060CompiledTarget } from './lib/compiled-v060-acceptance';

const database = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
const origin = process.env.API_ORIGIN ?? 'http://127.0.0.1:4313';
const appOrigin = process.env.PUBLIC_URL ?? 'http://127.0.0.1:4314';
const compiledTarget = captureV060CompiledTarget(process.env, origin, appOrigin);
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55435');
assert.equal(database.pathname, compiledTarget ? '/signal_resume_v060_compiled_check' : '/signal_resume_stage');
if (!compiledTarget) { assert.equal(origin, 'http://127.0.0.1:4313'); assert.equal(appOrigin, 'http://127.0.0.1:4314'); }
const { db, pool, signalUsersTable: users, signalSessionsTable: sessions, signalAssessmentAttemptsTable: attempts,
  signalAssessmentContextsTable: contexts, signalCompaniesTable: companies, signalMicroOffersTable: offers } = await import('../lib/db/src/index');
const prefix = (compiledTarget ? 'purpose-v060-' : 'purpose-') + randomUUID().slice(0, 8), ownedIds: number[] = [];
const checks: { name: string; status: 'PASS' }[] = []; const startedAt = new Date().toISOString();
let passed = false, failure: string | null = null, cleanup = false;
const sourceFiles = ['artifacts/api-server/src/routes/signal-profile-assessments.ts', 'artifacts/api-server/src/routes/signal-assessment-context.ts', 'artifacts/api-server/src/routes/signal-microtasks.ts', 'artifacts/api-server/src/lib/assessment-purpose.ts', 'artifacts/api-server/src/lib/signal-resume-qualification.ts', 'lib/db/migrations/0006_assessment_purpose.sql'];
const hashSources = async () => Object.fromEntries(await Promise.all(sourceFiles.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const sourceHashes = await hashSources();
async function step(name: string, run: () => Promise<void>) { await run(); checks.push({ name, status: 'PASS' }); }
async function fixture(role: 'candidate' | 'employer' = 'candidate', review = false) {
  const reviewScopeId = review ? randomUUID() : null;
  const [user] = await db.insert(users).values({ email: `${prefix}-${ownedIds.length}@example.test`, passwordHash: 'unusable-local-fixture-only', displayName: 'Синтетическая проверка назначения', role, emailVerified: true, demoMode: review, reviewScopeId }).returning();
  assert.ok(user); ownedIds.push(user.id);
  if (role === 'employer') await db.insert(companies).values({ ownerUserId: user.id, name: 'Synthetic purpose fixture company', contactEmail: user.email });
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000), demoMode: review, reviewScopeId });
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(origin + '/api' + path, { method, headers: { Cookie: 'fsp_signal_session=' + token, Origin: appOrigin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const bytes = Buffer.from(await response.arrayBuffer()); let data: any; try { data = bytes.length ? JSON.parse(bytes.toString()) : undefined; } catch {}
    return { status: response.status, data, bytes };
  };
  const ok = async (path: string, method = 'GET', body?: unknown, status = 200) => { const result = await request(path, method, body); assert.equal(result.status, status, `${method} ${path}: ${result.data?.error ?? ''}`); return result.data; };
  return { id: user.id, email: user.email, request, ok };
}
type Actor = Awaited<ReturnType<typeof fixture>>;
const startBody = (resumeId: number, grade: 'Junior' | 'Middle' | 'Senior' = 'Middle', extra = {}) => ({ purpose: 'signal_qualification', gradeConfirmed: true, resumeId, programId: 'backend-python', grade, ...extra });
async function fillQuestionnaire(actor: Actor, resumeId: number) {
  const row = await actor.ok(`/me/resumes/${resumeId}`); const body = emptyResume(row.specialization);
  for (const key of Object.keys(body.questionnaire.answers)) (body.questionnaire.answers as Record<string, number | null>)[key] = 2;
  await actor.ok(`/me/resumes/${resumeId}`, 'PUT', { ...body, revision: row.revision });
}
async function solve(actor: Actor, attemptId: number, correct = true) {
  assert.ok(ownedIds.includes(actor.id));
  const [row] = await db.select().from(attempts).where(and(eq(attempts.id, attemptId), eq(attempts.userId, actor.id))); assert.ok(row);
  const answers = row.cases.map(item => ({ caseId: item.id, answer: correct ? row.oracles[item.id]!.answer : 'synthetic wrong answer' }));
  await actor.ok(`/assessments/attempts/${attemptId}/answers`, 'PUT', { answers });
  return actor.ok(`/assessments/attempts/${attemptId}/submit`, 'POST', {});
}
async function frozenDatabaseGuard(attemptId: number, contextId: number, offerId: number) {
  const client = await pool.connect(); let rejected = 0;
  try {
    await client.query('BEGIN');
    const edits: [string, unknown[]][] = [
      ["UPDATE signal_assessment_attempts SET purpose='company_task' WHERE id=$1", [attemptId]],
      ["UPDATE signal_assessment_attempts SET program_version='forged-v999' WHERE id=$1", [attemptId]],
      ["UPDATE signal_assessment_attempts SET grade='Senior' WHERE id=$1", [attemptId]],
      ['UPDATE signal_assessment_attempts SET resume_id=NULL WHERE id=$1', [attemptId]],
      ["UPDATE signal_assessment_attempts SET oracles='{}'::jsonb WHERE id=$1", [attemptId]],
      ["UPDATE signal_assessment_contexts SET snapshot=snapshot||'{\"targetGrade\":\"Senior\"}'::jsonb WHERE attempt_id=$1", [contextId]],
      ["UPDATE signal_micro_offers SET purpose='signal_qualification' WHERE id=$1", [offerId]],
    ];
    for (const [query, args] of edits) {
      await client.query('SAVEPOINT forbidden_change');
      await assert.rejects(client.query(query, args), error => (error as { code?: string }).code === '23514'); rejected++;
      await client.query('ROLLBACK TO SAVEPOINT forbidden_change');
    }
    await client.query('ROLLBACK');
  } finally { await client.query('ROLLBACK'); client.release(); }
  assert.equal(rejected, 7);
}
try {
  assert.equal((await db.execute(sql`select current_database() as name`)).rows[0]?.name, database.pathname.slice(1));
  const a = await fixture(), b = await fixture(), reviewer = await fixture('candidate', true), employer = await fixture('employer'), foreignEmployer = await fixture('employer');
  const first = (await a.ok('/me/resumes')).resumes[0], second = (await b.ok('/me/resumes')).resumes[0], reviewerResume = (await reviewer.ok('/me/resumes')).resumes[0];
  await step('Required purpose and explicit candidate grade confirmation; Demo/reviewer/version/cooldown flags never gain authority', async () => {
    const valid = startBody(first.id); const { purpose: _p, ...noPurpose } = valid; const { gradeConfirmed: _c, ...noConfirmation } = valid;
    for (const body of [noPurpose, noConfirmation, { ...valid, gradeConfirmed: false }, { ...valid, purpose: 'company_task' },
      ...['demoMode', 'overviewDemo', 'reviewMode', 'reviewScopeId', 'programVersion', 'targetGrade', 'verifiedGrade', 'userId', 'skipCooldown'].map(key => ({ ...valid, [key]: key === 'reviewScopeId' ? randomUUID() : true }))]) {
      assert.equal((await a.request('/assessments/attempts', 'POST', body)).status, 400);
    }
    assert.equal((await a.request('/assessments/attempts', 'POST', valid)).status, 409);
    assert.equal((await reviewer.request('/assessments/attempts', 'POST', startBody(reviewerResume.id))).status, 409, 'A review cohort takes ordinary questionnaire/exam policy despite demoMode=true');
    assert.equal((await db.select().from(attempts).where(inArray(attempts.userId, [a.id, reviewer.id]))).length, 0);
  });
  await fillQuestionnaire(a, first.id); await fillQuestionnaire(b, second.id);
  const copy = await a.ok(`/me/resumes/${first.id}/copy`, 'POST', {}, 201);
  let issued: any, independent: any;
  await step('Concurrent tabs start one captured program; another owner gets an independent server-generated form and state', async () => {
    const pair = await Promise.all([a.request('/assessments/attempts', 'POST', startBody(first.id, 'Middle', { contextId: 'api-platform' })), a.request('/assessments/attempts', 'POST', startBody(first.id, 'Middle', { contextId: 'api-platform' }))]);
    assert.deepEqual(pair.map(row => row.status).sort(), [200, 201]); assert.equal(pair[0]!.data.id, pair[1]!.data.id); issued = pair[0]!.data;
    independent = await b.ok('/assessments/attempts', 'POST', startBody(second.id), 201); assert.notEqual(independent.id, issued.id);
    assert.notDeepEqual(independent.cases.map((row: any) => row.id), issued.cases.map((row: any) => row.id));
    assert.equal(issued.purpose, 'signal_qualification'); assert.equal(issued.qualificationBasis.confirmationOrigin, 'candidate_confirmed'); assert.ok(issued.qualificationBasis.gradeConfirmedAt);
    assert.equal(issued.qualificationBasis.resumeId, first.id); assert.equal(issued.programVersion, 'signal-backend-python-v6'); assert.equal(issued.declaredGrade, 'Middle');
    assert.equal((await a.request('/assessments/attempts', 'POST', startBody(copy.id))).status, 409);
  });
  await step('Foreign owner cannot read, save, submit or inspect context; employer receives no qualification answers or keys', async () => {
    for (const actor of [b, employer]) for (const [suffix, method, body] of [['', 'GET', undefined], ['/context', 'GET', undefined], ['/answers', 'PUT', { answers: [] }], ['/submit', 'POST', {}]] as const) {
      assert.equal((await actor.request(`/assessments/attempts/${issued.id}${suffix}`, method, body)).status, actor === b ? 404 : 403);
    }
    assert.equal((await employer.request('/assessments/history')).status, 403);
    const registry = await employer.ok('/assessments/programs/backend-python/competencies'); assert.doesNotMatch(JSON.stringify(registry), /"oracles"|"answer"|"seed"|"blueprint"/);
  });
  await step('Save/submit reject purpose, program/version, declared grade, authority and context substitutions', async () => {
    for (const key of ['purpose', 'programId', 'programVersion', 'grade', 'gradeConfirmed', 'demoMode', 'reviewMode', 'reviewScopeId', 'contextId', 'invitationId', 'resumeSpecialization']) {
      assert.equal((await a.request(`/assessments/attempts/${issued.id}/answers`, 'PUT', { answers: [], [key]: 'forged' })).status, 400, key);
      assert.equal((await a.request(`/assessments/attempts/${issued.id}/submit`, 'POST', { [key]: 'forged' })).status, 400, key);
    }
    assert.equal((await a.request(`/assessments/attempts/${issued.id}/answers`, 'PUT', { answers: [], resumeId: second.id })).status, 404);
    assert.equal((await a.request(`/assessments/attempts/${issued.id}/submit`, 'POST', { resumeId: second.id })).status, 404);
  });
  let ordinaryResult: any;
  await step('Changed/deleted target still finishes the issued program, compatible copy shares original proof, duplicate submit returns the identical decision', async () => {
    const profile = await a.ok(`/me/candidate-profile?resumeId=${first.id}`);
    await a.ok('/me/candidate-profile', 'PUT', { ...profile, resumeId: first.id, specialization: 'Frontend / TypeScript' });
    await a.ok(`/me/resumes/${first.id}`, 'DELETE', undefined, 204);
    ordinaryResult = await solve(a, issued.id); assert.equal(ordinaryResult.verified, true); assert.equal(ordinaryResult.score, 100); assert.equal(ordinaryResult.programId, 'backend-python');
    const replayPair = await Promise.all([a.ok(`/assessments/attempts/${issued.id}/submit`, 'POST', {}), a.ok(`/assessments/attempts/${issued.id}/submit`, 'POST', {})]);
    replayPair.forEach(result => assert.deepEqual(result, ordinaryResult));
    const own = (await a.ok('/me/resumes')).resumes; assert.ok(!own.some((row: any) => row.id === first.id)); assert.equal(own.find((row: any) => row.id === copy.id).verifiedGrade, 'Middle');
    assert.equal((await b.ok(`/assessments/attempts/${independent.id}`)).cases.every((row: any) => row.savedAnswer === null), true);
    const failedOther = await solve(b, independent.id, false); assert.equal(failedOther.verified, false); assert.equal((await b.ok('/me/candidate-profile')).verifiedGrade, null);
    assert.equal((await a.ok('/me/candidate-profile')).verifiedGrade, 'Middle');
    assert.doesNotMatch(JSON.stringify(ordinaryResult), /"oracles"|"answer"|"seed"|"blueprint"/);
  });
  const profile = await a.ok(`/me/candidate-profile?resumeId=${copy.id}`);
  await a.ok('/me/candidate-profile', 'PUT', { ...profile, resumeId: copy.id, visibility: 'pseudonymous', consentMatching: true, consentCatalog: true, readyForOffers: true });
  await employer.ok('/employer/company', 'PUT', { name: 'Synthetic purpose company', description: 'Изолированная техническая компания проверки назначения.', industry: 'Информационные технологии', contactEmail: employer.email, contactPhone: null, contactMethod: 'Электронная почта' });
  await foreignEmployer.ok('/employer/company', 'PUT', { name: 'Synthetic other company', description: 'Изолированная компания для проверки чужого доступа.', industry: 'Информационные технологии', contactEmail: foreignEmployer.email, contactPhone: null, contactMethod: 'Электронная почта' });
  const need = await employer.ok('/employer/needs', 'POST', { title: 'API platform engineer', specialization: 'Backend / Python', grade: 'Middle', requiredSkills: ['Python', 'SQL'], desirableSkills: [], description: 'Учебный контекст разработки REST API, SQL и доставки событий outbox.', workFormat: 'Удалённо', salaryMin: 100000, salaryMax: 200000, salaryPeriod: 'month', salaryType: 'gross' }, 201);
  const invitation = await employer.ok('/employer/invitations', 'POST', { idempotencyKey: prefix + '-invitation', needId: need.id, candidateId: a.id, resumeId: copy.id, title: 'Обсудим учебную API роль', message: 'Приглашение для изолированной проверки контекста и выбранного кандидатом грейда.', reason: 'Полная квалификация и соответствие навыков учебной потребности.', salaryMin: 100000, salaryMax: 200000, salaryPeriod: 'month', salaryType: 'gross', workFormat: 'Удалённо' }, 201);
  let invited: any;
  await step('Invited Signal exam preserves vacancy level/context but checks the level explicitly selected and confirmed by the candidate', async () => {
    assert.equal((await b.request('/assessments/attempts', 'POST', startBody(second.id, 'Junior', { invitationId: invitation.id }))).status, 404);
    assert.equal((await a.request('/assessments/attempts', 'POST', { ...startBody(copy.id, 'Junior', { invitationId: invitation.id }), gradeConfirmed: false })).status, 400);
    invited = await a.ok('/assessments/attempts', 'POST', startBody(copy.id, 'Junior', { invitationId: invitation.id }), 201);
    const context = (await a.ok(`/assessments/attempts/${invited.id}/context`)).snapshot;
    assert.equal(context.vacancyGrade, 'Middle'); assert.equal(context.targetGrade, 'Junior'); assert.equal(context.needId, need.id); assert.ok(Number.isInteger(context.companyId)); assert.equal(context.source, 'invitation');
    assert.equal(invited.declaredGrade, 'Junior'); assert.equal(invited.qualificationBasis.declaredGrade, 'Junior');
    assert.equal((await a.ok('/assessments/attempts', 'POST', startBody(copy.id, 'Junior', { invitationId: invitation.id }))).id, invited.id);
    const failureResult = await solve(a, invited.id, false); assert.equal(failureResult.verified, false); assert.equal(failureResult.gradeChanged, false);
    assert.equal((await a.ok('/me/candidate-profile')).verifiedGrade, 'Middle');
  });
  await step('7-day repeat and 90-day promotion policy survives copies, invitations and purpose relabelling; failed lower exam retains earned grade', async () => {
    const another = await a.ok(`/me/resumes/${copy.id}/copy`, 'POST', {}, 201);
    for (const body of [startBody(copy.id, 'Middle'), startBody(another.id, 'Middle'), startBody(copy.id, 'Junior', { invitationId: invitation.id }), startBody(another.id, 'Senior'), startBody(copy.id, 'Senior', { invitationId: invitation.id })]) assert.equal((await a.request('/assessments/attempts', 'POST', body)).status, 409);
    assert.equal((await a.request('/assessments/attempts', 'POST', { ...startBody(another.id, 'Senior'), purpose: 'company_task' })).status, 400);
    assert.equal((await db.select().from(attempts).where(eq(attempts.userId, a.id))).length, 2);
    assert.equal((await a.ok('/me/candidate-profile')).verifiedGrade, 'Middle');
  });
  let offer: any;
  await step('Existing company practice still runs end to end with separate immutable purpose/result and no Signal qualification change', async () => {
    await a.ok('/me/microtasks/preferences', 'PUT', { enabled: true });
    const template = await employer.ok('/employer/microtasks', 'POST', { specialization: 'Backend / Python', title: 'Учебный контракт API', competency: 'Контракты API', scenario: 'В учебном сервисе описать правила обработки повторного запроса и границы ключа идемпотентности. Производственная работа не требуется.', expectedMinutes: 10, intervalDays: 7, deadlineDays: 3, educationalOnly: true, rubric: [{ id: 'reasoning', label: 'Обоснованы границы ключа', maxPoints: 10 }] }, 201);
    await employer.ok(`/employer/microtasks/${template.id}/subscriptions`, 'POST', { candidateId: a.id, resumeId: copy.id });
    offer = (await a.ok('/me/microtasks')).offers.find((row: any) => row.snapshot.title === template.title); assert.ok(offer); assert.equal(offer.purpose, 'company_task');
    assert.equal((await b.request(`/me/microtasks/${offer.id}/decision`, 'POST', { decision: 'accept', consentCompanyReview: true })).status, 409);
    await a.ok(`/me/microtasks/${offer.id}/decision`, 'POST', { decision: 'accept', consentCompanyReview: true });
    assert.equal((await a.request(`/me/microtasks/${offer.id}/submit`, 'POST', { answer: 'Синтетический ответ компании.', purpose: 'signal_qualification', grade: 'Senior' })).status, 400);
    await a.ok(`/me/microtasks/${offer.id}/submit`, 'POST', { answer: 'Учебное обоснование границы ключа включает клиента, операцию и входные данные.' });
    const evaluation = { scores: [{ criterionId: 'reasoning', points: 10, comment: 'Учебная рубрика выполнена.' }], feedback: 'Синтетическая оценка конкретного задания компании.' };
    assert.equal((await foreignEmployer.request(`/employer/microtasks/offers/${offer.id}/evaluate`, 'POST', evaluation)).status, 409);
    const evaluated = await employer.ok(`/employer/microtasks/offers/${offer.id}/evaluate`, 'POST', evaluation);
    assert.equal(evaluated.result.source, 'company_task'); assert.equal(evaluated.result.purpose, 'company_task'); assert.equal(evaluated.result.qualificationEffect, 'none');
    assert.deepEqual(await employer.ok(`/employer/microtasks/offers/${offer.id}/evaluate`, 'POST', evaluation), evaluated);
    await a.ok(`/me/microtasks/${offer.id}/visibility`, 'POST', { shareResult: true });
    const evidence = await employer.ok(`/employer/micro-evidence/${a.id}?resumeId=${copy.id}`); assert.equal(evidence.find((row: any) => row.id === offer.id).purpose, 'company_task');
    assert.equal((await a.ok('/me/candidate-profile')).verifiedGrade, 'Middle'); assert.equal((await db.select().from(attempts).where(eq(attempts.userId, a.id))).length, 2);
  });
  await step('Database rejects seven purpose/program/grade/target/oracle/context rewrites and preserves original captured records', async () => {
    const [context] = await db.select().from(contexts).where(eq(contexts.attemptId, invited.id)); assert.ok(context);
    await frozenDatabaseGuard(invited.id, context.attemptId, offer.id);
    const [original] = await db.select().from(attempts).where(eq(attempts.id, invited.id)); assert.equal(original!.grade, 'Junior'); assert.equal(original!.purpose, 'signal_qualification');
    const [companyOffer] = await db.select().from(offers).where(eq(offers.id, offer.id)); assert.equal(companyOffer!.purpose, 'company_task');
  });
  await step('History, catalog evidence and real PDF keep qualification provenance without answer keys or contact data', async () => {
    const history = await a.ok('/assessments/history'); assert.equal(history.attempts.length, 2); assert.ok(history.attempts.every((row: any) => row.purpose === 'signal_qualification' && row.qualificationBasis.confirmationOrigin === 'candidate_confirmed'));
    const catalog = await employer.ok('/employer/candidates'); const row = catalog.candidates.find((item: any) => item.candidateId === a.id); assert.ok(row);
    assert.doesNotMatch(JSON.stringify(row), /"oracles"|"answer"|"seed"|"blueprint"|"phone"|"contactEmail"/);
    if (row.evidence?.length) assert.ok(row.evidence.every((item: any) => item.purpose === 'signal_qualification'));
    const pdf = await a.request(`/me/resumes/${copy.id}/pdf`); assert.equal(pdf.status, 200); assert.equal(pdf.bytes.subarray(0, 5).toString(), '%PDF-');
  });
  assert.deepEqual(await hashSources(), sourceHashes, 'Backend source changed during purpose acceptance.');
  if (compiledTarget) assert.deepEqual(captureV060CompiledTarget(process.env, origin, appOrigin), compiledTarget, 'Normal bundle changed during purpose acceptance');
  passed = true;
} catch (error) { failure = error instanceof Error ? error.message : String(error); }
finally {
  try { if (ownedIds.length) await db.delete(users).where(inArray(users.id, ownedIds)); cleanup = (await db.select({ id: users.id }).from(users).where(inArray(users.id, ownedIds))).length === 0; }
  catch (error) { failure = `${failure ?? ''} cleanup: ${error instanceof Error ? error.message : String(error)}`; passed = false; }
  await pool.end(); await mkdir('outputs/verification/assessment-purpose', { recursive: true });
  const report = `outputs/verification/assessment-purpose/${prefix}.json`;
  await writeFile(report, JSON.stringify({ passed, startedAt, finishedAt: new Date().toISOString(), database: database.pathname.slice(1), origin, checks, failure, cleanup, fixtureIds: ownedIds, sourceHashes, ...(compiledTarget ? { compiledTarget } : {}), limitations: ['Synthetic mechanism acceptance, not a human assessment validity claim.', 'Direct fixture oracle reads are private to this local test, never exposed through employer HTTP.', 'Runtime/build identity must also be attested by the coordinator; hashes attest stable local source.'] }, null, 2));
  console.log(JSON.stringify({ passed, checks: checks.length, failure, cleanup, report }));
}
if (!passed || !cleanup) process.exitCode = 1;

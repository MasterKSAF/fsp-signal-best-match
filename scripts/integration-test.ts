/**
 * Local integration regression suite. Runs against the real HTTP API, PostgreSQL
 * and Mailpit. Oracle access is confined to this test process, never an API route.
 * Every mutable row belongs to captured, freshly registered test user IDs.
 */
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { setTimeout as delay } from 'node:timers/promises';
import { mkdir, writeFile } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { captureV060CompiledTarget } from './lib/compiled-v060-acceptance';

const apiOrigin = process.env.INTEGRATION_API_ORIGIN || 'http://127.0.0.1:4312';
const appOrigin = process.env.INTEGRATION_APP_ORIGIN || process.env.PUBLIC_URL || 'http://127.0.0.1:4310';
const mailOrigin = process.env.INTEGRATION_MAILPIT_ORIGIN || process.env.MAILPIT_URL || 'http://127.0.0.1:8026';
const compiledTarget = captureV060CompiledTarget(process.env, apiOrigin, appOrigin);
if (compiledTarget) assert.equal(mailOrigin, 'http://127.0.0.1:8030');
for (const url of [apiOrigin, appOrigin, mailOrigin, process.env.DATABASE_URL || '']) {
  assert.ok(url, 'DATABASE_URL and local service URLs are required.');
  assert.ok(['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname), 'Integration tests only run against local services.');
}
if (process.env.SIGNAL_ISOLATED_STAGE_ACCEPTANCE === '1') {
  const stage = new URL(process.env.DATABASE_URL!);
  assert.equal(stage.hostname, '127.0.0.1'); assert.equal(stage.port, '55435'); assert.equal(stage.pathname, '/signal_resume_stage');
  assert.equal(apiOrigin, 'http://127.0.0.1:4313'); assert.equal(appOrigin, 'http://127.0.0.1:4314'); assert.equal(mailOrigin, 'http://127.0.0.1:8030');
}
if (process.env.SIGNAL_ISOLATED_FRESH_ACCEPTANCE === '1') {
  assert.notEqual(process.env.SIGNAL_ISOLATED_STAGE_ACCEPTANCE, '1');
  const fresh = new URL(process.env.DATABASE_URL!);
  assert.equal(fresh.hostname, '127.0.0.1'); assert.equal(fresh.port, '55435'); assert.equal(fresh.pathname, '/signal_resume_integration_check');
  assert.equal(apiOrigin, 'http://127.0.0.1:4353'); assert.equal(appOrigin, 'http://127.0.0.1:4354'); assert.equal(mailOrigin, 'http://127.0.0.1:8030');
}
const {
  db, pool, signalUsersTable: users, signalCandidateProfilesTable: profiles,
  signalCandidateResumesTable: resumes,
  signalAssessmentAttemptsTable: attempts, signalSessionsTable: sessions,
  signalContactGrantsTable: grants,
} = await import('../lib/db/src/index.ts');
const runId = randomUUID().slice(0, 8);
const capturedUserIds = new Set<number>();
const password = `Signal-test-${randomUUID()}`;
let assertions = 0;
const checked: string[] = [];
const suiteStarted = Date.now();
function passed(label: string) { assertions++; checked.push(label); console.log(`PASS ${label}`); }

class Client {
  cookies = new Map<string, string>();
  async request(path: string, method = 'GET', body?: unknown, extraHeaders?: Record<string, string>) {
    const headers: Record<string, string> = { Accept: 'application/json', Origin: appOrigin, ...extraHeaders };
    if (body !== undefined) headers['Content-Type'] = 'application/json';
    if (this.cookies.size) headers.Cookie = [...this.cookies].map(([key, value]) => `${key}=${value}`).join('; ');
    const response = await fetch(`${apiOrigin}/api${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    for (const cookie of response.headers.getSetCookie()) {
      const [pair] = cookie.split(';');
      const separator = pair.indexOf('=');
      const key = pair.slice(0, separator), value = pair.slice(separator + 1);
      if (value) this.cookies.set(key, value); else this.cookies.delete(key);
    }
    const bytes = Buffer.from(await response.arrayBuffer());
    const text = bytes.toString('utf8');
    let data: any;
    try { data = text ? JSON.parse(text) : null; } catch { data = null; }
    return { response, status: response.status, data, bytes };
  }
  async ok(path: string, method = 'GET', body?: unknown, statuses = [200]) {
    const result = await this.request(path, method, body);
    assert.ok(statuses.includes(result.status), `${method} ${path}: expected ${statuses.join('/')} got ${result.status}. ${result.data?.error || ''}`);
    return result.data;
  }
  async denied(path: string, method = 'GET', body?: unknown, statuses = [401, 403, 404, 409]) {
    const result = await this.request(path, method, body);
    assert.ok(statuses.includes(result.status), `${method} ${path} must reject, got ${result.status}.`);
    return result;
  }
}

async function mailCode(email: string) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    const response = await fetch(`${mailOrigin}/api/v1/search?query=${encodeURIComponent(`to:${email}`)}`, { signal: AbortSignal.timeout(5000) });
    assert.equal(response.status, 200, 'Mailpit search must be available');
    const results: any = await response.json();
    for (const item of results.messages || []) {
      const messageResponse = await fetch(`${mailOrigin}/api/v1/message/${encodeURIComponent(item.ID)}`, { signal: AbortSignal.timeout(5000) });
      const message: any = await messageResponse.json();
      if (!(message.To || item.To || []).some((recipient: any) => recipient.Address?.toLowerCase() === email)) continue;
      const match = String(message.Text || message.HTML || '').match(/\b(\d{6})\b/);
      if (match) return match[1];
    }
    await delay(250);
  }
  throw new Error(`No verification message reached local Mailpit for test account ${email}.`);
}

async function register(role: 'candidate' | 'employer', suffix: string) {
  const client = new Client();
  const email = `fsp-integration-${runId}-${suffix}@example.test`;
  const result = await client.request('/auth/register', 'POST', { email, password, displayName: `Тест ${suffix}`, role, consentTerms: true, consentPrivacy: true });
  // Capture the exact database ID even if a later delivery error made registration fail.
  const [row] = await db.select().from(users).where(eq(users.email, email));
  if (row) capturedUserIds.add(row.id);
  assert.equal(result.status, 201, `Registration failed: ${result.data?.error || result.status}`);
  assert.ok(row, 'Registration must persist its own user');
  assert.equal(result.data.demoVerificationCode, undefined, 'A verification secret must not be returned by HTTP registration');
  assert.equal(row.demoMode, false, 'Real registration must not join the demo pool');
  assert.match(row.passwordHash, /^scrypt:/, 'Password must have an adaptive salted hash');
  assert.notEqual(row.passwordHash, password);
  await client.denied('/auth/login', 'POST', { email, password }, [403]);
  const code = await mailCode(email);
  const verified = await client.ok('/auth/verify-email', 'POST', { email, code });
  assert.equal(verified.user.id, row.id);
  assert.equal(verified.user.demoMode, false);
  assert.ok(client.cookies.get('fsp_signal_session'), 'Verification should establish a cookie session');
  await client.denied('/auth/verify-email', 'POST', { email, code }, [400]);
  passed(`register + Mailpit + single-use email verification (${role})`);
  const owned = role === 'candidate' ? await client.ok('/me/resumes') : null;
  const resumeId: number | undefined = owned?.resumes.find((item: any) => item.isPrimary)?.id;
  if (role === 'candidate') assert.ok(resumeId);
  return { client, email, id: row.id, resumeId };
}

function profile(email: string, visibility = 'pseudonymous') {
  return { displayName: 'Тестовый инженер', professionalAlias: `Инженер ${runId}`, specialization: 'Backend / Python', assumedGrade: 'Senior', stack: ['Python', 'PostgreSQL', 'Docker'], skills: ['Python', 'SQL'], yearsExperience: 5, workFormat: 'Удалённо', salaryMin: 180000, salaryMax: 250000, salaryPeriod: 'month', salaryType: 'gross', visibility, consentMatching: true, consentCatalog: true, readyForOffers: true, phone: '+79990001122', contactEmail: email };
}
const needInput = { title: 'Инженер для интеграционной проверки', specialization: 'Backend / Python', grade: 'Middle', requiredSkills: ['Python', 'SQL'], desirableSkills: ['Architecture'], description: 'Реальные задачи серверной разработки и SQL. Синтетическая тестовая потребность.', workFormat: 'Удалённо', salaryMin: 180000, salaryMax: 260000, salaryPeriod: 'month', salaryType: 'gross' };
const resumeInput = {
  summary: 'Синтетическое резюме для проверки экспорта. Разрабатываю API и сервисы на Python.',
  softSkills: ['Командная работа', 'Техническая коммуникация'],
  experience: [{ company: 'Тестовая проектная команда', role: 'Backend-разработчик', start: '2023-06', end: null, description: 'Создал API и добавил интеграционные тесты. Вымышленные сведения для проверки приложения.' }],
  projects: [{ title: 'Учебный сервис', role: 'Разработчик', description: 'API с разграничением доступа.', url: 'https://example.org/project' }],
  education: [{ institution: 'Тестовый университет', qualification: 'Прикладная информатика', start: '2018-09', end: '2022-06' }],
  portfolio: [{ title: 'Портфолио', url: 'https://example.org/portfolio' }],
  questionnaire: { version: 'backend-python-v1', industry: 'Информационные технологии', specialization: 'Backend / Python', answers: { python: 2, databases: 2, api: 2, testing: 2, reliability: 2, ownership: 2 } },
};

function hasCandidate(bank: any, userId: number) { return bank.candidates.some((item: any) => item.candidateId === userId); }
function assertPrivateBank(bank: any) {
  assert.ok(Array.isArray(bank.candidates));
  assert.ok(Number.isSafeInteger(bank.total) && bank.total >= 0);
  assert.equal(bank.pageSize, 24);
  assert.ok(Array.isArray(bank.specializations));
  for (const item of bank.candidates) {
    for (const key of ['email', 'phone', 'contactEmail', 'displayName', 'questionnaire', 'resume']) assert.equal(item[key], undefined, `Candidate bank must not return private field ${key}`);
    assert.ok(item.verifiedGrade === null || ['Junior', 'Middle', 'Senior'].includes(item.verifiedGrade), 'Catalog exposes an explicit unconfirmed state rather than inventing Junior');
  }
}

async function readOwnedAttempt(id: number, userId: number) {
  assert.ok(capturedUserIds.has(userId), 'Oracle access is restricted to this run’s newly created users');
  const [attempt] = await db.select().from(attempts).where(and(eq(attempts.id, id), eq(attempts.userId, userId)));
  assert.ok(attempt, 'Attempt must belong to the freshly registered account');
  return attempt;
}

try {
  if (process.env.SIGNAL_ISOLATED_STAGE_ACCEPTANCE === '1') assert.equal((await pool.query('select current_database() as name')).rows[0]?.name, 'signal_resume_stage');
  if (process.env.SIGNAL_ISOLATED_FRESH_ACCEPTANCE === '1') assert.equal((await pool.query('select current_database() as name')).rows[0]?.name, 'signal_resume_integration_check');
  if (compiledTarget) assert.equal((await pool.query('select current_database() as name')).rows[0]?.name, compiledTarget.database);
  const anonymous = new Client();
  await anonymous.denied('/me');
  await anonymous.denied('/me/candidate-profile');
  for (const path of ['/me/resume', '/me/resume/pdf', '/me/fsp-connection', '/assessments/contexts', '/employer/candidates']) await anonymous.denied(path, 'GET', undefined, [401]);
  const forged = await anonymous.request('/me/candidate-profile', 'GET', undefined, { 'X-User-Id': '1', 'X-Demo-User': 'candidate-demo' });
  assert.equal(forged.status, 401);
  passed('anonymous and forged identity headers do not authorize access');

  const candidate = await register('candidate', 'candidate');
  const employerA = await register('employer', 'company-a');
  const employerB = await register('employer', 'company-b');
  const exploit = await register('candidate', 'regression');
  const invalidOrigin = await candidate.client.request('/me/candidate-profile', 'PUT', profile(candidate.email), { Origin: 'https://attacker.invalid' });
  assert.equal(invalidOrigin.status, 403, 'Cross-origin mutations must be rejected');
  passed('cross-origin mutation rejected');

  for (const employer of [employerA, employerB]) {
    await employer.client.ok('/employer/company', 'PUT', { name: `Компания ${employer.id}`, description: 'Синтетическая компания для интеграционной проверки.', industry: 'Информационные технологии', contactEmail: employer.email, contactPhone: null, contactMethod: 'Электронная почта' });
    const own = await employer.client.ok('/employer/company');
    assert.equal(own.company.contactEmail, employer.email);
  }
  await candidate.client.denied('/employer/company', 'PUT', {}, [403]);
  await employerA.client.denied('/me/candidate-profile', 'PUT', profile(candidate.email), [403]);
  await candidate.client.ok('/me/candidate-profile', 'PUT', profile(candidate.email));
  const before = await candidate.client.ok('/me/candidate-profile');
  assert.equal(before.verifiedGrade, null, 'Self-declared Senior must not grant a verified category');
  const needA = await employerA.client.ok('/employer/needs', 'POST', needInput, [201]);
  const needB = await employerB.client.ok('/employer/needs', 'POST', needInput, [201]);
  await employerB.client.denied(`/matches?needId=${needA.id}`, 'GET', undefined, [404]);
  passed('company ownership, roles, profile statement versus verified category');

  await employerA.client.denied('/me/resume', 'GET', undefined, [403]);
  await employerA.client.denied('/me/resume', 'PUT', resumeInput, [403]);
  await employerA.client.denied('/me/resume/pdf', 'GET', undefined, [403]);
  const emptyResume = await candidate.client.ok('/me/resume');
  assert.equal(emptyResume.recommendation.grade, null);
  assert.equal(emptyResume.questionnaireHistory.length, 0);
  await candidate.client.denied('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId, programId: 'backend-python', grade: 'Middle' }, [409]);
  const savedResume = await candidate.client.ok('/me/resume', 'PUT', resumeInput);
  assert.equal(savedResume.recommendation.grade, 'Middle');
  assert.equal(savedResume.recommendation.completedCount, 6);
  assert.equal(savedResume.questionnaireHistory.length, 1);
  assert.deepEqual(savedResume.experience, resumeInput.experience);
  const repeatedResume = await candidate.client.ok('/me/resume', 'PUT', resumeInput);
  assert.deepEqual(repeatedResume.questionnaireHistory, savedResume.questionnaireHistory, 'Unchanged questionnaire must not append duplicate history');
  const changedResumeInput = { ...resumeInput, questionnaire: { ...resumeInput.questionnaire, answers: { ...resumeInput.questionnaire.answers, python: 3 } } };
  const changedResume = await candidate.client.ok('/me/resume', 'PUT', changedResumeInput);
  assert.equal(changedResume.questionnaireHistory.length, 2);
  assert.deepEqual(changedResume.questionnaireHistory[0], savedResume.questionnaireHistory[0], 'Previous completed snapshot must be immutable');
  const incomplete = await candidate.client.ok('/me/resume', 'PUT', { ...changedResumeInput, questionnaire: { ...changedResumeInput.questionnaire, answers: { ...changedResumeInput.questionnaire.answers, ownership: null } } });
  assert.equal(incomplete.recommendation.grade, null);
  assert.equal(incomplete.questionnaireHistory.length, 2);
  await candidate.client.denied('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId, programId: 'backend-python', grade: 'Middle' }, [409]);
  await candidate.client.ok('/me/resume', 'PUT', changedResumeInput);
  assert.equal((await candidate.client.ok('/me/candidate-profile')).verifiedGrade, null, 'Questionnaire recommendations must not grant verified grades');
  const otherResume = await exploit.client.ok('/me/resume');
  assert.equal(otherResume.summary, '', 'Another candidate cannot receive the saved resume');
  assert.equal(otherResume.questionnaireHistory.length, 0);
  await candidate.client.denied('/me/resume', 'PUT', { ...resumeInput, userId: exploit.id }, [400]);
  for (const url of ['javascript:alert(1)', 'data:text/html,unsafe', 'https://user:password@example.org']) await candidate.client.denied('/me/resume', 'PUT', { ...resumeInput, portfolio: [{ title: 'Небезопасная ссылка', url }] }, [400]);
  await candidate.client.denied('/me/resume', 'PUT', { ...resumeInput, experience: [{ ...resumeInput.experience[0], start: '2025-01', end: '2024-01' }] }, [400]);
  assert.deepEqual((await candidate.client.ok('/me/resume')).questionnaire, changedResumeInput.questionnaire, 'Rejected writes must not replace saved data');
  await exploit.client.ok('/me/resume', 'PUT', { ...resumeInput, summary: 'Другое тестовое резюме.' });
  passed('structured resume validation, isolated persistence, questionnaire gate, immutable history and idempotent save');

  await employerA.client.denied('/me/fsp-connection', 'GET', undefined, [403]);
  await employerA.client.denied('/me/fsp-connection', 'PUT', { fspId: 'TEST-123', consentImport: true }, [403]);
  await candidate.client.denied('/me/fsp-connection', 'PUT', { fspId: `TEST-${runId}`, consentImport: false }, [400]);
  assert.equal((await candidate.client.ok('/me/fsp-connection')).status, 'unlinked');
  const pendingFsp = await candidate.client.ok('/me/fsp-connection', 'PUT', { fspId: `TEST-${runId}`, consentImport: true });
  assert.equal(pendingFsp.status, 'pending');
  assert.equal(pendingFsp.hasHistory, false);
  assert.equal(pendingFsp.verifiedAt, null);
  assert.equal(pendingFsp.demoAvailable, false);
  assert.deepEqual(pendingFsp.achievements, []);
  await candidate.client.denied('/me/fsp-connection', 'PUT', { fspId: 'FSP-DEMO-2026', consentImport: true }, [400]);
  assert.deepEqual(await candidate.client.ok('/me/fsp-connection'), pendingFsp, 'A real account cannot activate the example fixture or alter its current connection with a rejected ID');
  assert.equal((await exploit.client.ok('/me/fsp-connection')).status, 'unlinked');
  const revokedFsp = await candidate.client.ok('/me/fsp-connection', 'DELETE');
  assert.equal(revokedFsp.status, 'unlinked');
  assert.equal(revokedFsp.fspId, null);
  assert.equal(revokedFsp.hasHistory, false);
  assert.deepEqual(await candidate.client.ok('/me/fsp-connection', 'DELETE'), revokedFsp, 'Repeated unlink is idempotent');
  await candidate.client.ok('/me/fsp-connection', 'PUT', { fspId: `TEST-${runId}`, consentImport: true });
  passed('FSP consent and role checks, pending identifiers without achievements, demo-ID rejection and idempotent unlink');

  await employerA.client.denied('/assessments/contexts', 'GET', undefined, [403]);
  const contexts = await candidate.client.ok('/assessments/contexts');
  assert.deepEqual(contexts.profiles.map((item: any) => item.id).sort(), ['api-platform', 'data-services', 'reliability']);
  assert.equal(contexts.invitations.length, 0);
  const needContext = await employerA.client.ok(`/employer/needs/${needA.id}/assessment-context`);
  assert.equal(needContext.supported, true);
  assert.equal(needContext.targetGrade, 'Middle');
  assert.ok(needContext.matchedRequirements.includes('Python'));
  await employerB.client.denied(`/employer/needs/${needA.id}/assessment-context`, 'GET', undefined, [404]);
  await candidate.client.denied(`/employer/needs/${needA.id}/assessment-context`, 'GET', undefined, [403]);
  await candidate.client.denied('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId, programId: 'backend-python', grade: 'Middle', contextId: 'unknown-context' }, [400]);
  await exploit.client.denied('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: exploit.resumeId, programId: 'backend-python', grade: 'Middle', invitationId: 2147483647 }, [404]);
  const started = await candidate.client.ok('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId, programId: 'backend-python', grade: 'Middle', contextId: 'api-platform' }, [200, 201]);
  const resumed = await candidate.client.ok('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId, programId: 'backend-python', grade: 'Middle', contextId: 'api-platform' }, [200]);
  assert.equal(resumed.id, started.id, 'An exact retry resumes its own existing attempt');
  await candidate.client.denied('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId, programId: 'backend-python', grade: 'Middle', contextId: 'reliability' }, [409]);
  await candidate.client.denied('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId, programId: 'backend-python', grade: 'Junior', contextId: 'api-platform' }, [409]);
  await candidate.client.denied('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId, programId: 'backend-python', grade: 'Middle', invitationId: 2147483647 }, [404]);
  passed('active attempt resumes only the same grade and role; different contexts conflict and unknown invitations stay private');
  const attemptContext = await candidate.client.ok(`/assessments/attempts/${started.id}/context`);
  assert.equal(attemptContext.snapshot.source, 'profile');
  assert.equal(attemptContext.snapshot.context.id, 'api-platform');
  assert.equal(attemptContext.snapshot.targetGrade, 'Middle');
  assert.ok(attemptContext.snapshot.context.coverage.length >= 5);
  assert.equal(attemptContext.snapshot.context.diagnosisBranch, undefined, 'Public context must not leak generator switches');
  await exploit.client.denied(`/assessments/attempts/${started.id}/context`, 'GET', undefined, [404]);
  await employerA.client.denied(`/assessments/attempts/${started.id}/context`, 'GET', undefined, [403]);
  passed('role context selection, own need mapping, immutable attempt snapshot and context access isolation');
  assert.ok(started.cases.length >= 6, 'Five task families and a transfer question must be present');
  assert.equal(started.oracles, undefined, 'Public attempt must not expose answers');
  for (const item of started.cases) { assert.equal(item.answer, undefined); assert.equal(item.oracle, undefined); assert.equal(item.correctAnswer, undefined); }
  await exploit.client.denied(`/assessments/attempts/${started.id}`, 'GET', undefined, [404]);
  await employerA.client.denied(`/assessments/attempts/${started.id}`, 'GET', undefined, [403]);
  const persisted = await readOwnedAttempt(started.id, candidate.id);
  const correctAnswers = persisted.cases.map(item => ({ caseId: item.id, answer: persisted.oracles[item.id]?.answer || '' }));
  assert.ok(correctAnswers.every(answer => answer.answer.length > 0), 'Internal test fixture needs a complete private oracle');
  await candidate.client.ok(`/assessments/attempts/${started.id}/answers`, 'PUT', { answers: correctAnswers });
  const submission = await candidate.client.ok(`/assessments/attempts/${started.id}/submit`, 'POST');
  assert.equal(submission.score, 100);
  assert.equal(submission.verified, true);
  assert.equal(submission.grade, 'Middle');
  const repeated = await candidate.client.ok(`/assessments/attempts/${started.id}/submit`, 'POST');
  assert.deepEqual(repeated, submission, 'A duplicate submit returns the original decision, including whether that decision awarded a grade.');
  await candidate.client.denied(`/assessments/attempts/${started.id}/answers`, 'PUT', { answers: [] }, [409]);
  await candidate.client.denied('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId, programId: 'backend-python', grade: 'Middle' }, [409]);
  const history = await candidate.client.ok('/assessments/history');
  assert.ok(history.attempts.some((attempt: any) => attempt.id === started.id && attempt.verified));
  passed('server-graded assessment, private oracle, ownership, idempotency, cooldown and history');

  const exportedResume = await candidate.client.request('/me/resume/pdf');
  assert.equal(exportedResume.status, 200);
  assert.match(exportedResume.response.headers.get('content-type') || '', /^application\/pdf/);
  assert.match(exportedResume.response.headers.get('content-disposition') || '', /attachment.*Signal-Resume-[0-9]+\.pdf/);
  assert.equal(exportedResume.response.headers.get('x-signal-resume-id'), String(candidate.resumeId));
  assert.match(exportedResume.response.headers.get('cache-control') || '', /no-store/);
  assert.equal(exportedResume.bytes.subarray(0, 5).toString(), '%PDF-');
  assert.match(exportedResume.bytes.subarray(-32).toString(), /%%EOF/);
  assert.equal(Number(exportedResume.response.headers.get('content-length')), exportedResume.bytes.length);
  await mkdir('outputs/verification/resume', { recursive: true });
  await writeFile(`outputs/verification/resume/http-resume-${runId}.pdf`, exportedResume.bytes);
  passed('private downloadable resume PDF preserves binary bytes, attachment headers and a complete document');

  const matches = await employerA.client.ok(`/matches?needId=${needA.id}`);
  const match = matches.find((item: any) => item.candidateId === candidate.id);
  assert.ok(match, 'Verified and consenting real candidate must appear for a real company');
  assert.equal(match.email, undefined);
  assert.equal(match.phone, undefined);
  assert.equal(match.fspBonus, 0, 'An unverified self-entered FSP ID must not produce a ranking bonus');
  assert.ok(!JSON.stringify(matches).includes(candidate.email), 'Matching must not transmit private contacts');
  const explanation = await employerA.client.ok(`/matches/explanation?needId=${needA.id}&candidateId=${candidate.id}&resumeId=${candidate.resumeId}`);
  assert.equal(explanation.score, match.score, 'List and explanation must use the same score');
  const factorSum = explanation.factors.reduce((sum: number, item: any) => sum + item.score * item.weight * 100, 0);
  assert.equal(Math.round(factorSum), explanation.score, 'Explanation factors must reconstruct the base score');

  await candidate.client.denied('/employer/candidates', 'GET', undefined, [403]);
  const bankQuery = `/employer/candidates?q=${encodeURIComponent(runId)}`;
  const bank = await employerA.client.ok(bankQuery);
  assertPrivateBank(bank);
  assert.equal(bank.page, 1);
  assert.ok(hasCandidate(bank, candidate.id), 'Verified, visible and consenting profile belongs in the candidate bank');
  assert.ok(!hasCandidate(bank, exploit.id), 'A candidate without verified skills must not appear');
  assert.ok(bank.specializations.includes('Backend / Python'));
  assert.ok(!JSON.stringify(bank).includes(candidate.email));
  assert.ok(!JSON.stringify(bank).includes('+79990001122'));
  for (const filter of ['grade=Middle', 'skill=SQL', 'skill=python', `specialization=${encodeURIComponent('Backend / Python')}`, 'fsp=no']) {
    assert.ok(hasCandidate(await employerA.client.ok(`${bankQuery}&${filter}`), candidate.id), `Matching bank filter must keep this candidate: ${filter}`);
  }
  for (const filter of ['grade=Senior', 'skill=NoSuchVerifiedSkill', 'specialization=Frontend', 'fsp=yes']) {
    assert.ok(!hasCandidate(await employerA.client.ok(`${bankQuery}&${filter}`), candidate.id), `Non-matching bank filter must exclude this candidate: ${filter}`);
  }
  for (const filter of ['page=0', 'grade=Principal', 'fsp=maybe', 'page=1&extra=unknown']) await employerA.client.denied(`/employer/candidates?${filter}`, 'GET', undefined, [400]);
  const emptyBankPage = await employerA.client.ok(`${bankQuery}&page=10000`);
  assert.equal(emptyBankPage.page, 10000);
  assert.equal(emptyBankPage.candidates.length, 0);
  assert.equal(emptyBankPage.total, bank.total);
  await candidate.client.ok('/me/candidate-profile', 'PUT', { ...profile(candidate.email), consentMatching: false });
  assert.ok(!(await employerA.client.ok(`/matches?needId=${needA.id}`)).some((item: any) => item.candidateId === candidate.id), 'Withdrawal of matching consent immediately removes matching');
  assert.ok(hasCandidate(await employerA.client.ok(bankQuery), candidate.id), 'Independent catalog consent remains independent from matching consent');
  await candidate.client.ok('/me/candidate-profile', 'PUT', { ...profile(candidate.email), consentMatching: false, consentCatalog: false });
  assert.ok(!hasCandidate(await employerA.client.ok(bankQuery), candidate.id), 'Withdrawal of catalog consent must immediately remove the catalog card');
  await candidate.client.ok('/me/candidate-profile', 'PUT', profile(candidate.email));
  passed('candidate bank filters, pagination metadata, hidden contact fields and matching-consent enforcement');

  await candidate.client.ok('/me/candidate-profile', 'PUT', profile(candidate.email, 'private'));
  const hidden = await employerA.client.ok(`/matches?needId=${needA.id}`);
  assert.ok(!hidden.some((item: any) => item.candidateId === candidate.id));
  assert.ok(!hasCandidate(await employerA.client.ok(bankQuery), candidate.id), 'Private profiles must disappear from the independent candidate bank as well');
  await employerA.client.denied(`/matches/explanation?needId=${needA.id}&candidateId=${candidate.id}&resumeId=${candidate.resumeId}`, 'GET', undefined, [404]);
  await candidate.client.ok('/me/candidate-profile', 'PUT', profile(candidate.email));
  const impossibleNeed = await employerA.client.ok('/employer/needs', 'POST', { ...needInput, requiredSkills: ['UnverifiedSkillForTest'] }, [201]);
  const unavailable = await employerA.client.ok(`/matches?needId=${impossibleNeed.id}`);
  assert.ok(!unavailable.some((item: any) => item.candidateId === candidate.id));
  await employerA.client.denied(`/matches/explanation?needId=${impossibleNeed.id}&candidateId=${candidate.id}&resumeId=${candidate.resumeId}`, 'GET', undefined, [404]);
  passed('matching and explanation agree on scoring, visibility and mandatory-skill eligibility');

  const inviteInput = { idempotencyKey: `integration-${runId}-invitation`, needId: needA.id, candidateId: candidate.id, resumeId: candidate.resumeId, title: 'Приглашение на знакомство', message: 'Хотим обсудить задачи и условия нашей тестовой роли.', reason: 'Подтверждены Python и SQL, необходимые нашей команде.', salaryMin: 190000, salaryMax: 250000, salaryPeriod: 'month', salaryType: 'gross', workFormat: 'Удалённо' };
  await employerA.client.denied('/employer/invitations', 'POST', { ...inviteInput, salaryMin: 0 }, [400]);
  const parallelInvites = await Promise.all([employerA.client.request('/employer/invitations', 'POST', inviteInput), employerA.client.request('/employer/invitations', 'POST', inviteInput)]);
  assert.deepEqual(parallelInvites.map(result => result.status).sort(), [200, 201], 'Concurrent duplicate invitation returns the existing invitation');
  assert.equal(parallelInvites[0].data.id,parallelInvites[1].data.id,'Concurrent requests must resolve to the same invitation');
  const invitation = parallelInvites.find(result => result.status === 201)!.data;
  const invitedContexts = await candidate.client.ok('/assessments/contexts');
  const invitedContext = invitedContexts.invitations.find((item: any) => item.id === invitation.id);
  assert.ok(invitedContext, 'A received active invitation should expose its role context');
  assert.equal(invitedContext.snapshot.source, 'invitation');
  assert.equal(invitedContext.snapshot.roleTitle, needInput.title);
  assert.equal(invitedContext.snapshot.targetGrade, 'Middle');
  assert.ok(!(await exploit.client.ok('/assessments/contexts')).invitations.some((item: any) => item.id === invitation.id), 'Other candidates must not see this invitation context');
  await exploit.client.denied('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: exploit.resumeId, programId: 'backend-python', grade: 'Middle', invitationId: invitation.id }, [404]);
  await employerA.client.denied(`/employer/invitations/${invitation.id}/contacts`, 'GET', undefined, [403]);
  await employerB.client.denied(`/employer/invitations/${invitation.id}/contacts`, 'GET', undefined, [403, 404]);
  await exploit.client.denied(`/me/invitations/${invitation.id}/decision`, 'POST', { decision: 'accept' }, [404, 409]);
  const inbox = await candidate.client.ok('/me/invitations');
  assert.ok(inbox.find((item: any) => item.id === invitation.id).companyContact.includes(employerA.email), 'Company contact must be visible before the candidate decides');
  const [accepted] = await Promise.all([candidate.client.ok(`/me/invitations/${invitation.id}/decision`, 'POST', { decision: 'accept' }), candidate.client.ok(`/me/invitations/${invitation.id}/decision`, 'POST', { decision: 'accept' })]);
  assert.equal(accepted.invitation.contactShared, true);
  await candidate.client.ok(`/me/invitations/${invitation.id}/decision`, 'POST', { decision: 'accept' });
  const activeGrants = await db.select().from(grants).where(eq(grants.invitationId, invitation.id));
  assert.equal(activeGrants.length, 1, 'Repeated acceptance creates exactly one grant');
  const contacts = await employerA.client.ok(`/employer/invitations/${invitation.id}/contacts`);
  assert.equal(contacts.email, candidate.email);
  await employerB.client.denied(`/employer/invitations/${invitation.id}/contacts`, 'GET', undefined, [403, 404]);
  await candidate.client.ok(`/me/invitations/${invitation.id}/revoke-contact`, 'POST');
  await employerA.client.denied(`/employer/invitations/${invitation.id}/contacts`, 'GET', undefined, [403]);
  // Replaying the old acceptance cannot silently restore a revoked grant.
  await candidate.client.ok(`/me/invitations/${invitation.id}/decision`, 'POST', { decision: 'accept' });
  await employerA.client.denied(`/employer/invitations/${invitation.id}/contacts`, 'GET', undefined, [403]);
  const inviteB = await employerB.client.ok('/employer/invitations', 'POST', { ...inviteInput, needId: needB.id }, [201]);
  await candidate.client.ok(`/me/invitations/${inviteB.id}/decision`, 'POST', { decision: 'decline' });
  await employerB.client.denied(`/employer/invitations/${inviteB.id}/contacts`, 'GET', undefined, [403]);
  const afterDecisionContexts = await candidate.client.ok('/assessments/contexts');
  assert.ok(afterDecisionContexts.invitations.some((item: any) => item.id === invitation.id), 'Accepted invitation keeps its own assessment context');
  assert.ok(!afterDecisionContexts.invitations.some((item: any) => item.id === inviteB.id), 'Declined invitation must not remain selectable');
  passed('salary validation, invitation → acceptance → scoped contact grant → revocation; decline stays private');
  passed('active invitation contexts are candidate-owned and declined contexts disappear');

  const demo = new Client();
  await demo.ok('/auth/demo-session', 'POST', { role: 'employer' });
  const demoNeeds = await demo.ok('/employer/needs');
  assert.ok(demoNeeds.length, 'Seeded demo needs are required');
  const demoMatches = await demo.ok(`/matches?needId=${demoNeeds[0].id}`);
  assert.ok(!demoMatches.some((item: any) => capturedUserIds.has(item.candidateId)), 'Demo employers cannot see real profiles');
  const demoBank = await demo.ok('/employer/candidates');
  assertPrivateBank(demoBank);
  assert.ok(demoBank.total > demoBank.pageSize, 'Demo fixture should exercise candidate bank pagination');
  assert.ok(!demoBank.candidates.some((item: any) => capturedUserIds.has(item.candidateId)), 'Demo bank must not expose this run’s real accounts');
  const demoBankNext = await demo.ok('/employer/candidates?page=2');
  assert.equal(demoBankNext.page, 2);
  assert.equal(demoBankNext.total, demoBank.total);
  assert.ok(!demoBankNext.candidates.some((item: any) => demoBank.candidates.some((first: any) => first.candidateId === item.candidateId)), 'Stable pages must not duplicate candidates');
  const unconfirmedDemo = await demo.ok('/employer/candidates?grade=unconfirmed');
  assertPrivateBank(unconfirmedDemo);
  assert.ok(unconfirmedDemo.total > 0, 'Fresh Demo deliberately includes a visible unconfirmed CV');
  for (const item of unconfirmedDemo.candidates) {
    assert.equal(item.verifiedGrade, null, 'Unconfirmed filter never assigns a default Junior');
    assert.equal(item.verifiedScore, null, 'This unexamined Demo fixture has no invented score');
    assert.deepEqual(item.verifiedSkills, [], 'This unexamined Demo fixture has no invented skills');
    assert.equal(item.evidenceDate, null, 'This unexamined Demo fixture has no invented evidence date');
    assert.ok(!demoMatches.some((match: any) => match.candidateId === item.candidateId), 'Unconfirmed catalog publication does not grant matching admission');
  }
  for (const [result, expectedDemoMode] of [[bank, false], [demoBank, true], [demoBankNext, true]] as const) {
    for (const item of result.candidates) {
      const [row] = await db.select({ demoMode: users.demoMode, reviewScopeId: users.reviewScopeId, consentCatalog: resumes.consentCatalog, visibility: resumes.visibility, verifiedGrade: resumes.verifiedGrade, deletedAt: resumes.deletedAt }).from(users).innerJoin(resumes, eq(resumes.userId, users.id)).where(and(eq(users.id, item.candidateId),eq(resumes.id,item.resumeId)));
      assert.ok(row?.consentCatalog && row.visibility !== 'private' && row.deletedAt === null, 'Catalog selects the exact consented active CV');
      assert.equal(item.verifiedGrade,row.verifiedGrade,'Catalog preserves the exact CV grade, including unconfirmed');
      assert.equal(row.demoMode, expectedDemoMode, 'Candidate bank must preserve the real/demo pool boundary');
      assert.equal(row.reviewScopeId,null,'Ordinary and overview pools do not include reviewer cohorts');
    }
  }
  await demo.denied(`/matches/explanation?needId=${demoNeeds[0].id}&candidateId=${candidate.id}&resumeId=${candidate.resumeId}`, 'GET', undefined, [404]);
  for (const item of matches) {
    const [candidateRow] = await db.select({ demoMode: users.demoMode }).from(users).where(eq(users.id, item.candidateId));
    assert.equal(candidateRow?.demoMode, false, 'Real employer must not see demo candidates');
  }
  await demo.ok('/auth/logout', 'POST');
  passed('demo and real account pools remain isolated');

  const proofBeforeFailure = await candidate.client.ok('/me/candidate-profile');
  const juniorNeed = await employerA.client.ok('/employer/needs', 'POST', { ...needInput, title: 'Junior Python: тест контекста приглашения', grade: 'Junior' }, [201]);
  const juniorInvitation = await employerA.client.ok('/employer/invitations', 'POST', { ...inviteInput, idempotencyKey: `integration-${runId}-junior`, needId: juniorNeed.id }, [201]);
  const lowerAttempt = await candidate.client.ok('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId,programId:'backend-python',grade:'Junior',invitationId:juniorInvitation.id}, [200,201]);
  const invitationAttemptContext = await candidate.client.ok(`/assessments/attempts/${lowerAttempt.id}/context`);
  assert.equal(invitationAttemptContext.snapshot.source, 'invitation');
  assert.equal(invitationAttemptContext.snapshot.roleTitle, 'Junior Python: тест контекста приглашения');
  assert.equal(invitationAttemptContext.snapshot.targetGrade, 'Junior');
  assert.ok(invitationAttemptContext.snapshot.requirements.includes('SQL'));
  assert.deepEqual(await candidate.client.ok(`/assessments/attempts/${started.id}/context`), attemptContext, 'A later role selection cannot rewrite the original attempt snapshot');
  const lowerResult = await candidate.client.ok(`/assessments/attempts/${lowerAttempt.id}/submit`, 'POST');
  assert.equal(lowerResult.verified, false);
  const proofAfterFailure = await candidate.client.ok('/me/candidate-profile');
  assert.equal(proofAfterFailure.verifiedGrade, proofBeforeFailure.verifiedGrade);
  assert.equal(proofAfterFailure.latestAssessmentAt, proofBeforeFailure.latestAssessmentAt, 'Failed attempt cannot refresh old evidence');
  assert.deepEqual(proofAfterFailure.verifiedSkills, proofBeforeFailure.verifiedSkills);
  passed('a failed lower-level attempt preserves category and evidence date');

  await candidate.client.ok('/me/candidate-profile', 'PUT', {...profile(candidate.email),specialization:'Frontend'});
  const changedSpecialization = await candidate.client.ok('/me/candidate-profile');
  assert.equal(changedSpecialization.verifiedGrade, null);
  assert.deepEqual(changedSpecialization.verifiedSkills, []);
  await candidate.client.denied('/assessments/attempts','POST',{ purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId,programId:'backend-python',grade:'Senior'},[409]);
  await candidate.client.ok('/me/candidate-profile', 'PUT', profile(candidate.email));
  await candidate.client.denied('/assessments/attempts','POST',{ purpose: 'signal_qualification', gradeConfirmed: true, resumeId: candidate.resumeId,programId:'backend-python',grade:'Senior'},[409]);
  passed('specialization changes clear unrelated proof and cannot bypass promotion cooldown');

  await exploit.client.ok('/me/candidate-profile', 'PUT', profile(exploit.email));
  const exploitAttempt = await exploit.client.ok('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: exploit.resumeId, programId: 'backend-python', grade: 'Senior' }, [200, 201]);
  const shortcutAnswers = exploitAttempt.cases.map((item: any) => ({ caseId: item.id, answer: item.responseType === 'choice' ? item.options[1] : 'идемпотентность транзакция индекс retry SQL архитектура' }));
  await exploit.client.ok(`/assessments/attempts/${exploitAttempt.id}/answers`, 'PUT', { answers: shortcutAnswers });
  const shortcut = await exploit.client.ok(`/assessments/attempts/${exploitAttempt.id}/submit`, 'POST');
  assert.equal(shortcut.verified, false, 'Second-choice/keyword exploit must not produce a verified Senior');
  assert.ok(shortcut.score < 100, 'Blind second choices must not produce a perfect score');
  const exploitProfile = await exploit.client.ok('/me/candidate-profile');
  assert.equal(exploitProfile.verifiedGrade, null);
  const expired = await exploit.client.ok('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: exploit.resumeId, programId: 'backend-python', grade: 'Junior' }, [200, 201]);
  await readOwnedAttempt(expired.id, exploit.id);
  await db.update(attempts).set({ dueAt: new Date(Date.now() - 60000) }).where(and(eq(attempts.id, expired.id), eq(attempts.userId, exploit.id)));
  await exploit.client.denied(`/assessments/attempts/${expired.id}/answers`, 'PUT', { answers: [] }, [409]);
  await exploit.client.denied(`/assessments/attempts/${expired.id}/submit`, 'POST', undefined, [409]);
  const legacy = await exploit.client.ok('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: exploit.resumeId, programId: 'backend-python', grade: 'Middle' }, [200, 201]);
  await readOwnedAttempt(legacy.id, exploit.id);
  await assert.rejects(db.update(attempts).set({ oracles: { legacy: { answer: 'B' } } }).where(and(eq(attempts.id, legacy.id), eq(attempts.userId, exploit.id))), error => (error as any).cause?.code === '23514' || (error as any).code === '23514');
  await db.update(attempts).set({ dueAt: new Date(Date.now() - 60000) }).where(and(eq(attempts.id, legacy.id), eq(attempts.userId, exploit.id)));
  const [unsupportedLegacy] = await db.insert(attempts).values({ userId: exploit.id, resumeId: exploit.resumeId, programId: 'backend-python', grade: 'Middle', cases: [], oracles: { legacy: { answer: 'B' } }, dueAt: new Date(Date.now() + 45 * 60000) }).returning();
  assert.ok(unsupportedLegacy);
  await exploit.client.denied(`/assessments/attempts/${unsupportedLegacy.id}/answers`, 'PUT', { answers: [] }, [409]);
  await exploit.client.denied(`/assessments/attempts/${unsupportedLegacy.id}/submit`, 'POST', undefined, [409]);
  passed('second-choice/keyword exploit, expired attempts and legacy bank attempts rejected');

  const interrupted = await exploit.client.ok('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: exploit.resumeId,programId:'backend-python',grade:'Junior'}, [200,201]);
  const interruptedDb = await readOwnedAttempt(interrupted.id, exploit.id);
  await exploit.client.ok(`/assessments/attempts/${interrupted.id}/answers`, 'PUT', {answers:interruptedDb.cases.map(item=>({caseId:item.id,answer:interruptedDb.oracles[item.id].answer}))});
  await exploit.client.ok('/me/candidate-profile','PUT',{...profile(exploit.email),specialization:'Frontend'});
  const finishedOriginal = await exploit.client.ok(`/assessments/attempts/${interrupted.id}/submit`,'POST');
  assert.equal(finishedOriginal.verified, true); assert.equal(finishedOriginal.score, 100);
  assert.equal(finishedOriginal.programId, 'backend-python'); assert.equal(finishedOriginal.resumeId, exploit.resumeId);
  assert.equal((await exploit.client.ok('/me/candidate-profile')).verifiedGrade,null);
  passed('issued attempt finishes under its captured specialization after profile changes; incompatible resume receives no grade');

  const ownSessions = await db.select().from(sessions).where(eq(sessions.userId, employerB.id));
  assert.ok(ownSessions.length);
  await db.update(sessions).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(sessions.userId, employerB.id));
  await employerB.client.denied('/me', 'GET', undefined, [401]);
  const logoutCookie = new Map(candidate.client.cookies);
  await candidate.client.ok('/auth/logout', 'POST');
  candidate.client.cookies = logoutCookie;
  await candidate.client.denied('/me', 'GET', undefined, [401]);
  await candidate.client.ok('/auth/login', 'POST', { email: candidate.email, password });
  assert.equal((await candidate.client.ok('/me')).user.id, candidate.id);
  passed('expired and revoked sessions reject replay; password login works');
  if (compiledTarget) assert.deepEqual(captureV060CompiledTarget(process.env, apiOrigin, appOrigin), compiledTarget, 'Normal bundle changed during acceptance');
  console.log(`Integration suite passed: ${assertions} scenario groups.`);
} finally {
  // No broad pattern delete. Cascade removes only data owned by exact captured IDs.
  if (capturedUserIds.size) {
    const ids = [...capturedUserIds];
    await db.delete(users).where(inArray(users.id, ids));
    const remaining = await db.select({ id: users.id }).from(users).where(inArray(users.id, ids));
    assert.equal(remaining.length, 0, 'All captured test accounts must be cleaned up');
    console.log(`Cleaned ${ids.length} test accounts and their dependent records.`);
  }
  await pool.end();
}
await mkdir('outputs/verification',{recursive:true});
await writeFile(process.env.INTEGRATION_REPORT_PATH || 'outputs/verification/integration.json',JSON.stringify({passed:true,generatedAt:new Date().toISOString(),durationMs:Date.now()-suiteStarted,groups:assertions,checks:checked,environment:'Local PostgreSQL, Mailpit and HTTP API',...(compiledTarget ? { compiledTarget, syntheticOverviewFixtures: true, overviewIsNotIndependentReviewer: true } : {})},null,2)+'\n');

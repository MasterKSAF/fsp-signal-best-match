/** Isolated HTTP router, real session lookup and PostgreSQL, scoped synthetic
 * fixtures. This verifies mechanics/privacy, never human or bank difficulty. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { once } from 'node:events';
import { createRequire } from 'node:module';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalSessionsTable as sessions, signalResearchStudiesTable as studies, signalResearchAttemptsTable as attempts, signalResearchEnrollmentsTable as enrollments, signalResearchRatingsTable as ratings, signalCandidateProfilesTable as profiles, signalAssessmentAttemptsTable as productionAttempts } from '../lib/db/src/index';
import researchRouter, { purgeExpiredResearch } from '../artifacts/api-server/src/routes/signal-research';
import type { AttemptOracle } from '../artifacts/api-server/src/lib/assessment-bank';

assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(process.env.DATABASE_URL!).hostname), 'Local DB only');
const requireApi = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const express = requireApi('express'), cookieParser = requireApi('cookie-parser');
process.env.DEMO_MODE = 'true'; // Test process only; never changes the running app configuration.
const runId = `research-qa-${randomUUID()}`, ids: number[] = [], checks: string[] = [];
const pass = (label: string) => { checks.push(label); console.log(`PASS ${label}`); };
const app = express(); app.use(express.json(), cookieParser()); app.use('/api', researchRouter);
const server = app.listen(0, '127.0.0.1'); await once(server, 'listening');
const address = server.address(); assert.ok(address && typeof address !== 'string');
const origin = `http://127.0.0.1:${address.port}`, started = Date.now();
class Client {
  constructor(public cookie = '') {}
  async request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { Cookie: this.cookie, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data = await response.json(); return { status: response.status, data };
  }
  async ok(path: string, method = 'GET', body?: unknown, status = 200) { const result = await this.request(path, method, body); assert.equal(result.status, status, `${method} ${path}: ${result.data.error ?? ''}`); return result.data; }
}
async function fixture(role: 'employer' | 'candidate' = 'candidate', demoMode = false, emailVerified = true) {
  const [user] = await db.insert(users).values({ email: `${runId}-${ids.length}@example.test`, passwordHash: 'unusable-test-fixture', displayName: 'Synthetic research fixture', role, demoMode, emailVerified }).returning(); ids.push(user!.id);
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ userId: user!.id, tokenHash: createHash('sha256').update(token).digest('hex'), demoMode, expiresAt: new Date(Date.now() + 3600000) });
  return { id: user!.id, client: new Client(`fsp_signal_session=${token}`) };
}
let success = false;
try {
  const operator = await fixture('employer'), otherOperator = await fixture('employer'), employer = await fixture('employer'), a = await fixture(), b = await fixture(), expiring = await fixture(), demo = await fixture('candidate', true), unverified = await fixture('candidate', false, false);
  process.env.SIGNAL_RESEARCH_OPERATOR_IDS = `${operator.id},${otherOperator.id}`;
  const input = { title: 'Synthetic A/B privacy control', programId: 'frontend-typescript', grade: 'Middle', retentionDays: 1, measurementOrigin: 'synthetic' };
  assert.equal((await new Client().request('/research/studies')).status, 401);
  for (const client of [employer.client, a.client, demo.client]) assert.equal((await client.request('/research/studies', 'POST', input)).status, 403);
  assert.equal((await unverified.client.request('/research/studies', 'POST', input)).status, 401);
  const { study } = await operator.client.ok('/research/studies', 'POST', input, 201);
  const sid = study.id, base = `/research/studies/${sid}`;
  const listed = await operator.client.ok('/research/studies'); assert.doesNotMatch(JSON.stringify(listed), /oracles|blueprint|"answer"|protocolSnapshot/);
  assert.equal((await otherOperator.client.request(`${base}/export`)).status, 404);
  assert.equal((await employer.client.request(base)).status, 403);
  assert.equal((await a.client.request(`${base}/private-responses`)).status, 403);
  assert.equal((await operator.client.ok(`${base}/report`)).agreementAB, null);
  pass('Separate explicit operator permission, study ownership, verified personal candidate access and no key leak');
  const detail = await a.client.ok(base);
  assert.equal((await a.client.request(`${base}/enroll`, 'POST', { consent: false, consentVersion: detail.consentVersion })).status, 400);
  assert.equal((await a.client.request(`${base}/enroll`, 'POST', { consent: true, consentVersion: 'old' })).status, 400);
  const ea = await a.client.ok(`${base}/enroll`, 'POST', { consent: true, consentVersion: detail.consentVersion });
  const eb = await b.client.ok(`${base}/enroll`, 'POST', { consent: true, consentVersion: detail.consentVersion });
  const ec = await expiring.client.ok(`${base}/enroll`, 'POST', { consent: true, consentVersion: detail.consentVersion });
  assert.equal(ea.order, 'AB'); assert.equal(eb.order, 'BA');
  assert.deepEqual(await a.client.ok(`${base}/enroll`, 'POST', { consent: true, consentVersion: detail.consentVersion }), ea);
  assert.equal((await a.client.request(`${base}/attempts/start`, 'POST')).status, 409);
  for (const enrollment of [ea, eb, ec]) await operator.client.ok(`${base}/participants/${enrollment.enrollmentId}/group`, 'PUT', { grade: enrollment === eb ? 'Senior' : 'Middle', basis: 'Synthetic predetermined external reference; not a human judgement' });
  assert.equal((await operator.client.request(`${base}/participants/${ea.enrollmentId}/group`, 'PUT', { grade: 'Junior', basis: 'Changing an already frozen reference' })).status, 409);
  pass('Explicit versioned consent, idempotent enrolment, AB/BA counterbalance and independent group frozen before first attempt');
  await db.insert(profiles).values({ userId: a.id, professionalAlias: runId, verifiedGrade: 'Senior', verifiedScore: 91, verifiedGradeChangedAt: new Date('2026-01-01'), latestAssessmentAt: new Date('2026-01-01') });
  const before = await db.select().from(profiles).where(eq(profiles.userId, a.id));
  const [protocol] = await db.select().from(studies).where(eq(studies.id, sid)); assert.ok(protocol!.protocolSnapshot);
  const used: number[] = [];
  for (const person of [a, b]) for (let index = 0; index < 2; index++) {
    const started = await person.client.ok(`${base}/attempts/start`, 'POST'); const aid = started.attemptId; used.push(aid);
    assert.equal((await person.client.ok(`${base}/attempts/start`, 'POST')).attemptId, aid);
    const issued = await person.client.ok(`/research/attempts/${aid}`);
    assert.doesNotMatch(JSON.stringify(issued), /oracles|blueprint|"seed"/);
    assert.equal((await (person === a ? b : a).client.request(`/research/attempts/${aid}`)).status, 404);
    const [stored] = await db.select().from(attempts).where(eq(attempts.id, aid)); assert.ok(stored);
    assert.deepEqual(stored.cases, protocol!.protocolSnapshot.forms[stored.form].cases);
    assert.equal(stored.programVersion, protocol!.protocolSnapshot.programVersion);
    assert.equal((await person.client.request(`/research/attempts/${aid}/answers`, 'PUT', { responses: [{ caseId: 'foreign', answer: '', activeMs: 0, skipped: true, ambiguous: false }] })).status, 400);
    const responses = stored.cases.map(task => ({ caseId: task.id, answer: (stored.oracles as AttemptOracle)[task.id]!.answer, activeMs: 15000, skipped: false, ambiguous: false }));
    if (person === a && stored.form === 'B') { responses.shift(); responses[0]!.answer = 'PRIVATE CONTACT SENTINEL name@example.test'; responses[0]!.ambiguous = true; }
    await person.client.ok(`/research/attempts/${aid}/answers`, 'PUT', { responses });
    const result = await person.client.ok(`/research/attempts/${aid}/submit`, 'POST'); assert.equal(result.profileChanged, false);
    assert.deepEqual((await person.client.ok(`/research/attempts/${aid}/submit`, 'POST')).result, result.result);
    assert.equal((await person.client.request(`/research/attempts/${aid}/answers`, 'PUT', { responses })).status, 409);
  }
  assert.equal((await a.client.request(`${base}/attempts/start`, 'POST')).status, 409);
  assert.deepEqual(await db.select().from(profiles).where(eq(profiles.userId, a.id)), before);
  assert.equal((await db.select().from(productionAttempts).where(inArray(productionAttempts.userId, [a.id, b.id]))).length, 0);
  pass('Exactly two immutable frozen forms; private ownership; idempotent submission; ordinary profile/history and cooldown untouched');
  const data = await operator.client.ok(`${base}/export`), raw = await operator.client.ok(`${base}/private-responses`), report = await operator.client.ok(`${base}/report`);
  assert.doesNotMatch(JSON.stringify(data), /PRIVATE CONTACT SENTINEL|name@example.test|"userId"|"oracles"|"answer"|"password"/);
  assert.match(JSON.stringify(raw), /PRIVATE CONTACT SENTINEL/); assert.doesNotMatch(JSON.stringify(raw), /"oracles"|"blueprint"/);
  assert.equal(report.counts.paired, 2); assert.equal(report.agreementAB, .5); assert.equal(report.skipped, 1); assert.equal(report.ambiguous, 1); assert.equal(report.humanValidation, 'not_measured');
  assert.equal(data.measurements.every((row: any) => row.responses.length === 6), true);
  pass('Pseudonymous safe export versus restricted raw answers; omitted answers count as skips; synthetic provenance and measured pairs');
  const expiredAttempt = await expiring.client.ok(`${base}/attempts/start`, 'POST');
  await db.update(attempts).set({ dueAt: new Date(Date.now() - 1000) }).where(eq(attempts.id, expiredAttempt.attemptId));
  assert.equal((await expiring.client.request(`/research/attempts/${expiredAttempt.attemptId}/submit`, 'POST')).status, 409);
  await db.update(enrollments).set({ expiresAt: new Date(Date.now() - 1000) }).where(eq(enrollments.id, ec.enrollmentId));
  await purgeExpiredResearch();
  assert.equal((await db.select().from(attempts).where(eq(attempts.enrollmentId, ec.enrollmentId))).length, 0);
  assert.equal((await expiring.client.request(`${base}/enroll`, 'POST', { consent: true, consentVersion: detail.consentVersion })).status, 409);
  pass('Server due time and retention expiry remove research answers and reject silent re-enrolment');
  const packet = await operator.client.ok(`${base}/review-packet`);
  assert.doesNotMatch(JSON.stringify(packet.ratings), /score|form|independentGrade|userId/);
  const review = (reviewerId: string, grade: string) => ({ ...packet, reviewerId, ratings: packet.ratings.map((item: any) => ({ ...item, grade, comment: 'Synthetic reviewer fixture, never external expert evidence' })) });
  assert.equal((await operator.client.request(`${base}/reviews`, 'POST', review('reviewer-one', 'Middle'))).status, 409);
  await operator.client.ok(`${base}/close`, 'POST');
  await operator.client.ok(`${base}/reviews`, 'POST', review('reviewer-one', 'Middle'), 201);
  assert.equal((await operator.client.request(`${base}/reviews`, 'POST', review('REVIEWER-ONE', 'Senior'))).status, 409);
  await operator.client.ok(`${base}/reviews`, 'POST', review('reviewer-two', 'Senior'), 201);
  assert.equal((await operator.client.request(`${base}/reviews`, 'POST', review('reviewer-three', 'Junior'))).status, 409);
  const rated = await operator.client.ok(`${base}/report`); assert.equal(rated.expertReview.exactAgreement, 0); assert.equal(rated.expertReview.disagreements.length, 2);
  assert.equal((await operator.client.ok(`${base}/reviews`)).reviews.length, 2);
  assert.doesNotMatch(JSON.stringify(await operator.client.ok(`${base}/aggregate-report`)), /pseudonym|reviewerId|Synthetic reviewer fixture|P-/);
  pass('Blind packet, two append-only independent reviewer imports, duplicate author blocked, disagreements preserved and aggregate-only report');
  await a.client.ok(`${base}/revoke`, 'POST'); await a.client.ok(`${base}/revoke`, 'POST');
  assert.equal((await a.client.request(`/research/attempts/${used[0]}`)).status, 404);
  assert.equal((await db.select().from(attempts).where(eq(attempts.enrollmentId, ea.enrollmentId))).length, 0);
  assert.doesNotMatch(JSON.stringify(await operator.client.ok(`${base}/private-responses`)), /PRIVATE CONTACT SENTINEL/);
  for (const original of await db.select().from(ratings).where(eq(ratings.studyId, sid))) assert.ok(original.ratings.every(item => item.pseudonym !== ea.pseudonym));
  const [tombstone] = await db.select().from(enrollments).where(eq(enrollments.id, ea.enrollmentId)); assert.notEqual(tombstone!.pseudonym, ea.pseudonym); assert.equal(tombstone!.independentBasis, null);
  assert.deepEqual(await db.select().from(profiles).where(eq(profiles.userId, a.id)), before);
  pass('Withdrawal removes attempts, responses, reviewer rows and pseudonym link; repeated revoke is safe; work profile remains unchanged');
  success = true;
} finally {
  await new Promise<void>((resolve, reject) => server.close(error => error ? reject(error) : resolve()));
  if (ids.length) await db.delete(users).where(inArray(users.id, ids));
  await mkdir('outputs/verification', { recursive: true });
  await writeFile(process.env.INTEGRATION_REPORT_PATH || 'outputs/verification/research-http.json', JSON.stringify({ generatedAt: new Date().toISOString(), passed: success, groups: checks.length, checks, durationMs: Date.now() - started, provenance: 'Synthetic scoped HTTP fixtures; not a human pilot or independent expert validation', scope: 'Research router over HTTP, real auth sessions and PostgreSQL; full application origin guard tested by common integration suite', cleanup: 'Only exact synthetic user IDs created by this run and their cascading research records deleted. No answers, identities, keys or source account mapping exported.' }, null, 2));
  await pool.end();
}

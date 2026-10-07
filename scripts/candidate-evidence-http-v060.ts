/** Controlled local mechanism acceptance. Solves only this run's synthetic
 * owned forms; no seed/reset, public credentials, answer or oracle receipts. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { and, eq, inArray, sql } from 'drizzle-orm';
import { emptyResume } from '../artifacts/api-server/src/lib/signal-resume-contract';
import { recomputeCandidateResumes } from '../artifacts/api-server/src/lib/signal-resume';
import type { CandidateEvidenceCatalog } from '../artifacts/api-server/src/lib/signal-candidate-evidence';
import { captureV060CompiledTarget } from './lib/compiled-v060-acceptance';

const target = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
const origin = process.env.API_ORIGIN ?? '';
const compiledTarget = captureV060CompiledTarget(process.env, origin, process.env.PUBLIC_URL ?? origin);
if (!compiledTarget) assert.equal(process.env.SIGNAL_V060_ISOLATED_ACCEPTANCE, '1');
assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55435');
assert.equal(target.pathname, compiledTarget ? '/signal_resume_v060_compiled_check' : '/signal_resume_v060_check');
if (!compiledTarget) assert.equal(origin, 'http://127.0.0.1:4363');
const { db, pool, signalUsersTable: users, signalSessionsTable: sessions, signalCompaniesTable: companies,
  signalAssessmentAttemptsTable: attempts, signalAssessmentCorrectionsTable: corrections } = await import('../lib/db/src/index');
const prefix = `${compiledTarget ? 'v060-evidence-compiled' : 'v060-evidence'}-${randomUUID().slice(0, 10)}`;
const ownedIds: number[] = [], checks: { name: string; status: 'PASS' }[] = [];
const startedAt = new Date().toISOString(); let passed = false, failure: string | null = null, cleanup = false;
const sources = ['artifacts/api-server/src/lib/signal-evidence-compatibility.ts', 'artifacts/api-server/src/lib/signal-resume-qualification.ts',
  'artifacts/api-server/src/lib/signal-candidate-evidence.ts', 'artifacts/api-server/src/routes/signal-candidate-evidence.ts',
  'artifacts/api-server/src/routes/signal-resume.ts', 'artifacts/api-server/src/lib/signal-resume.ts'];
const hashSources = async () => Object.fromEntries(await Promise.all(sources.map(async file => [file, createHash('sha256').update(await readFile(file)).digest('hex')])));
const sourceHashes = await hashSources();
async function step(name: string, run: () => Promise<void>) { await run(); checks.push({ name, status: 'PASS' }); }
async function fixture(role: 'candidate' | 'employer' = 'candidate') {
  const [user] = await db.insert(users).values({ email: `${prefix}-${ownedIds.length}@example.test`, passwordHash: 'unusable-local-synthetic-fixture',
    role, displayName: 'Синтетическая проверка истории', emailVerified: true, demoMode: false }).returning(); assert.ok(user); ownedIds.push(user.id);
  if (role === 'employer') await db.insert(companies).values({ ownerUserId: user.id, name: 'Synthetic evidence company', contactEmail: user.email });
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000), demoMode: false });
  const request = async (path: string, method = 'GET', body?: unknown, anonymous = false) => {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { ...(anonymous ? {} : { Cookie: `fsp_signal_session=${token}` }),
      Origin: origin!, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const bytes = await response.text(); let data: any; try { data = bytes ? JSON.parse(bytes) : null; } catch {}
    return { status: response.status, data, cacheControl: response.headers.get('cache-control') };
  };
  const ok = async (path: string, method = 'GET', body?: unknown, status = 200) => { const result = await request(path, method, body); assert.equal(result.status, status, `${method} ${path}: ${result.data?.error ?? 'non-JSON response'}`); return result.data; };
  const registry = async () => { const result = await request('/me/evidence/registry'); assert.equal(result.status, 200); assert.match(result.cacheControl ?? '', /no-store/); return result.data as CandidateEvidenceCatalog; };
  return { id: user.id, request, ok, registry };
}
type Actor = Awaited<ReturnType<typeof fixture>>;
async function questionnaire(actor: Actor, resumeId: number) {
  const current = await actor.ok(`/me/resumes/${resumeId}`); const body = emptyResume(current.specialization);
  for (const key of Object.keys(body.questionnaire.answers)) (body.questionnaire.answers as Record<string, number | null>)[key] = 2;
  await actor.ok(`/me/resumes/${resumeId}`, 'PUT', { ...body, revision: current.revision });
}
async function exam(actor: Actor, resumeId: number, programId: 'backend-python' | 'frontend-typescript', grade: 'Junior' | 'Middle', onlySql = false) {
  await questionnaire(actor, resumeId);
  const issued = await actor.ok('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, resumeId, programId, grade }, 201);
  const [row] = await db.select().from(attempts).where(and(eq(attempts.id, issued.id), eq(attempts.userId, actor.id))); assert.ok(row); assert.ok(ownedIds.includes(row.userId));
  const answers = row.cases.map(item => ({ caseId: item.id, answer: !onlySql || row.oracles[item.id]!.blueprint.family === 'sql-data' ? row.oracles[item.id]!.answer : 'synthetic deliberately incorrect' }));
  await actor.ok(`/assessments/attempts/${issued.id}/answers`, 'PUT', { answers });
  const result = await actor.ok(`/assessments/attempts/${issued.id}/submit`, 'POST', {});
  const [saved] = await db.select().from(attempts).where(eq(attempts.id, issued.id)); assert.ok(saved?.submittedAt);
  return { id: issued.id as number, date: saved.submittedAt.toISOString(), result, row: saved };
}
try {
  assert.equal((await db.execute(sql`select current_database() as name`)).rows[0]?.name, target.pathname.slice(1));
  const a = await fixture(), b = await fixture(), employer = await fixture('employer');
  await step('Owner-only registry rejects anonymous, employer and query owner/resume substitutions; empty history never invents proof', async () => {
    assert.equal((await a.request('/me/evidence/registry', 'GET', undefined, true)).status, 401);
    assert.equal((await employer.request('/me/evidence/registry')).status, 403);
    for (const query of [`?userId=${b.id}`, '?resumeId=1', '?ownerId=1', '?includeAnswers=true']) assert.equal((await a.request(`/me/evidence/registry${query}`)).status, 400);
    assert.deepEqual((await a.registry()).evidence, []);
  });
  const first = (await a.ok('/me/resumes')).resumes[0]; const other = (await b.ok('/me/resumes')).resumes[0];
  const copies: number[] = [first.id];
  for (let i = 0; i < 4; i++) copies.push((await a.ok(`/me/resumes/${first.id}/copy`, 'POST', {}, 201)).id);
  const backend = await exam(a, first.id, 'backend-python', 'Middle');
  let originalSqlId: string;
  await step('Five resumes reuse one original SQL source/date/version; current public passport remains its seven-skill contract', async () => {
    const ledger = await a.registry(); assert.equal(ledger.resumes.length, 5); assert.ok(ledger.resumes.every(row => row.verifiedGrade === 'Middle'));
    const sqlProof = ledger.evidence.filter(row => row.canonicalSkillId === 'sql'); assert.equal(sqlProof.length, 1); originalSqlId = sqlProof[0]!.id;
    assert.equal(sqlProof[0]!.attemptId, backend.id); assert.equal(sqlProof[0]!.date, backend.date); assert.equal(sqlProof[0]!.programVersion, 'signal-backend-python-v6');
    assert.equal(sqlProof[0]!.applications.length, 5); assert.ok(sqlProof[0]!.applications.every(row => row.applied && row.selected && row.compatibilityRuleId));
    assert.equal(ledger.evidence.length, 8); assert.match(sqlProof[0]!.criterion, /SQL/);
    const passport = await a.ok(`/me/evidence?resumeId=${first.id}`); assert.equal(passport.resumeId, first.id); assert.equal(passport.evidence.length, 7);
    assert.ok(passport.evidence.every((row: any) => row.attemptId === backend.id && row.date === backend.date));
  });
  await step('Five copies cannot bypass the resume limit, same-program repeat delay or grade increase delay', async () => {
    const deniedCopy = await a.request(`/me/resumes/${first.id}/copy`, 'POST', {});
    assert.equal(deniedCopy.status, 409); assert.equal(deniedCopy.data.code, 'RESUME_LIMIT');
    await questionnaire(a, copies[1]!);
    const body = { purpose: 'signal_qualification', gradeConfirmed: true, resumeId: copies[1], programId: 'backend-python' };
    const repeat = await a.request('/assessments/attempts', 'POST', { ...body, grade: 'Middle' });
    assert.equal(repeat.status, 409); assert.match(repeat.data.error, /Повторить проверку этого уровня можно после/);
    const increase = await a.request('/assessments/attempts', 'POST', { ...body, grade: 'Senior' });
    assert.equal(increase.status, 409); assert.match(increase.data.error, /Следующее повышение категории будет доступно после/);
    assert.equal((await db.select().from(attempts).where(eq(attempts.userId, a.id))).length, 1);
  });
  await a.ok(`/me/resumes/${copies.pop()!}`, 'DELETE', undefined, 204);
  const front = await a.ok('/me/resumes', 'POST', { title: 'Frontend synthetic evidence', specialization: 'Frontend / TypeScript' }, 201);
  await step('Backend criterion survives changing application context; no SQL or whole Backend grade transfers to Frontend', async () => {
    const ledger = await a.registry(); assert.equal(ledger.resumes.find(row => row.id === front.id)!.verifiedGrade, null);
    const proof = ledger.evidence.find(row => row.id === originalSqlId!)!; assert.equal(proof.date, backend.date);
    const application = proof.applications.find(row => row.resumeId === front.id)!;
    assert.equal(application.applied, false); assert.equal(application.selected, false); assert.equal(application.reasonCode, 'different_program'); assert.equal(application.compatibilityRuleId, null); assert.ok(application.nextStep);
  });
  const frontend = await exam(a, front.id, 'frontend-typescript', 'Junior');
  await step('Independent Frontend Junior leaves all Backend Middle and source records unchanged; repeated registry GET is idempotent', async () => {
    const before = await a.registry(); assert.equal(before.resumes.find(row => row.id === front.id)!.verifiedGrade, 'Junior');
    assert.ok(before.resumes.filter(row => row.id !== front.id).every(row => row.verifiedGrade === 'Middle'));
    const sqlProof = before.evidence.find(row => row.id === originalSqlId!)!; assert.equal(sqlProof.date, backend.date); assert.equal(sqlProof.grade, 'Middle');
    assert.deepEqual(await a.registry(), before);
    assert.equal((await db.select().from(attempts).where(eq(attempts.userId, a.id))).length, 2);
  });
  const partial = await exam(b, other.id, 'backend-python', 'Middle', true);
  await step('Successful individual criterion in failed full program is retained without a grade and stays private to its account', async () => {
    const owned = await b.registry(); assert.equal(owned.resumes[0]!.verifiedGrade, null); assert.equal(owned.evidence.length, 1);
    assert.equal(owned.evidence[0]!.canonicalSkillId, 'sql'); assert.equal(owned.evidence[0]!.grade, 'Middle'); assert.equal(owned.evidence[0]!.result, 100);
    assert.equal(owned.evidence[0]!.date, partial.date); assert.equal(partial.row.verified, false);
    assert.ok((await a.registry()).evidence.every(row => row.attemptId !== partial.id));
    assert.ok(owned.evidence.every(row => row.attemptId !== backend.id && row.attemptId !== frontend.id));
    assert.equal((await b.request(`/me/evidence?resumeId=${first.id}`)).status, 404);
  });
  await step('Changing original CV specialization updates applications but preserves immutable captured Backend source', async () => {
    const profile = await a.ok(`/me/candidate-profile?resumeId=${first.id}`);
    await a.ok('/me/candidate-profile', 'PUT', { ...profile, resumeId: first.id, specialization: 'Frontend / TypeScript' });
    const ledger = await a.registry(); assert.equal(ledger.resumes.find(row => row.id === first.id)!.verifiedGrade, 'Junior');
    const proof = ledger.evidence.find(row => row.id === originalSqlId!)!; assert.equal(proof.originalResumeId, first.id); assert.equal(proof.date, backend.date);
    assert.equal(proof.applications.find(row => row.resumeId === first.id)!.applied, false);
    const [captured] = await db.select().from(attempts).where(eq(attempts.id, backend.id)); assert.equal(captured!.resumeSpecialization, 'Backend / Python');
  });
  await step('Deleting original CV does not erase proof or resurrect tombstone; new compatible copy reuses original result exactly once', async () => {
    await a.ok(`/me/resumes/${first.id}`, 'DELETE', undefined, 204);
    const after = await a.registry(); assert.ok(!after.resumes.some(row => row.id === first.id));
    const proof = after.evidence.find(row => row.id === originalSqlId!)!; assert.equal(proof.originalResumeId, first.id); assert.equal(proof.date, backend.date);
    assert.ok(proof.applications.every(row => row.resumeId !== first.id));
    const copied = await a.ok(`/me/resumes/${copies[1]}/copy`, 'POST', {}, 201);
    const restored = await a.registry(); const reused = restored.evidence.filter(row => row.id === originalSqlId!); assert.equal(reused.length, 1);
    assert.equal(reused[0]!.date, backend.date); assert.equal(reused[0]!.applications.find(row => row.resumeId === copied.id)!.selected, true);
    assert.equal((await a.request(`/me/resumes/${first.id}`)).status, 404);
    assert.equal((await db.select().from(attempts).where(eq(attempts.userId, a.id))).length, 2);
  });
  await step('Custom domain, job/project roles and soft-skill tags survive save, another active CV and reread without acquiring qualification', async () => {
    const resumeId = copies[1]!; const current = await a.ok(`/me/resumes/${resumeId}`);
    const custom = { ...emptyResume(current.specialization), summary: 'Synthetic custom fields persistence.',
      softSkills: ['Командная работа', 'Авторский личный навык'],
      experience: [{ company: 'Synthetic Company', role: 'Авторская должность инженера данных', start: '2024-03', end: null, description: 'Synthetic experience description.' }],
      projects: [{ title: 'Synthetic Project', role: 'Авторская роль в проекте', description: 'Synthetic project description.', url: null }],
      questionnaire: { ...current.questionnaire, industry: 'Авторская предметная область' } };
    await a.ok(`/me/resumes/${resumeId}`, 'PUT', { ...custom, revision: current.revision });
    await a.ok(`/me/resumes/${front.id}/primary`, 'POST', {});
    const saved = await a.ok(`/me/resumes/${resumeId}`);
    for (const key of ['softSkills', 'experience', 'projects', 'questionnaire'] as const) assert.deepEqual(saved[key], custom[key]);
    assert.equal(saved.verifiedGrade, 'Middle'); assert.ok(!saved.verifiedSkills.includes('Авторский личный навык'));
    assert.equal((await a.registry()).evidence.filter(row => row.id === originalSqlId!).length, 1);
  });
  await step('Correction after prior reads revokes every Backend application, retains original source, updates stored CVs and keeps Frontend unaffected', async () => {
    await a.registry();
    await db.transaction(async tx => {
      await tx.execute(sql`select pg_advisory_xact_lock(${a.id})`); await tx.execute(sql`select pg_advisory_xact_lock(3306,${a.id})`);
      await tx.insert(corrections).values({ attemptId: backend.id, reason: 'Синтетическое исправление ошибочного условия', operator: 'PRIVATE_FIXTURE_OPERATOR_NOT_PUBLIC',
        originalDecision: { score: backend.row.score, verified: backend.row.verified, status: backend.row.status } });
      await recomputeCandidateResumes(a.id, tx);
    });
    const ledger = await a.registry(); assert.equal(ledger.resumes.find(row => row.id === front.id)!.verifiedGrade, 'Junior');
    assert.ok(ledger.resumes.filter(row => row.specialization === 'Backend / Python').every(row => row.verifiedGrade === null));
    const revoked = ledger.evidence.filter(row => row.attemptId === backend.id); assert.equal(revoked.length, 8);
    assert.ok(revoked.every(row => row.status === 'revoked' && row.date === backend.date && row.correction && row.applications.every(app => !app.applied && !app.selected && app.reasonCode === 'revoked')));
    const passport = await a.ok(`/me/evidence?resumeId=${copies[1]}`); assert.deepEqual(passport.evidence, []);
    const stored = (await a.ok('/me/resumes')).resumes; assert.ok(stored.filter((row: any) => row.specialization === 'Backend / Python').every((row: any) => row.verifiedGrade === null && row.verifiedSkills.length === 0));
    const [source] = await db.select().from(attempts).where(eq(attempts.id, backend.id)); assert.equal(source!.verified, true); assert.equal(source!.score, 100);
  });
  await step('Owner response has no answers, cases, oracles, contacts, operators or internal digests; session revocation removes access', async () => {
    const dto = JSON.stringify(await a.registry());
    for (const key of ['answers', 'cases', 'oracles', 'passwordHash', 'poolContentDigest', 'phone', 'contactEmail', 'email', 'operator']) assert.ok(!dto.includes(`"${key}"`));
    assert.ok(!dto.includes('PRIVATE_FIXTURE_OPERATOR_NOT_PUBLIC'));
    await db.delete(sessions).where(eq(sessions.userId, a.id)); assert.equal((await a.request('/me/evidence/registry')).status, 401);
  });
  assert.deepEqual(await hashSources(), sourceHashes, 'Owned backend source changed during acceptance.');
  if (compiledTarget) assert.deepEqual(captureV060CompiledTarget(process.env, origin, process.env.PUBLIC_URL ?? origin), compiledTarget, 'Normal bundle changed during owner evidence acceptance');
  passed = true;
} catch (error) { failure = error instanceof Error ? error.message : String(error); }
finally {
  try {
    if (ownedIds.length) await db.delete(users).where(inArray(users.id, ownedIds));
    cleanup = (await db.select({ id: users.id }).from(users).where(inArray(users.id, ownedIds))).length === 0;
  } catch (error) { passed = false; failure = `${failure ?? ''} cleanup: ${error instanceof Error ? error.message : String(error)}`; }
  await pool.end(); await mkdir('outputs/verification/evidence-v060', { recursive: true });
  const report = `outputs/verification/evidence-v060/${prefix}.json`;
  await writeFile(report, JSON.stringify({ passed, startedAt, finishedAt: new Date().toISOString(), database: target.pathname.slice(1), apiOrigin: origin,
    checks, failure, cleanup, fixtureIds: ownedIds, sourceHashes, ...(compiledTarget ? { compiledTarget } : {}), limitations: ['Synthetic mechanism acceptance, not a human validation study.', 'Private direct oracle access solves only run-owned synthetic fixtures; answers are excluded from public receipts.', 'Full-load acceptance and runtime build identity are separate coordinator checks.'] }, null, 2));
  console.log(JSON.stringify({ passed, checks: checks.length, failure, cleanup, report }));
}
if (!passed || !cleanup) process.exitCode = 1;

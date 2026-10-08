/** Five bounded actual HTTP submissions. Time/exposure setup is explicitly synthetic and disposable. */
import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalSessionsTable as sessions, signalSkillAttemptsTable as attempts, signalSkillEvidenceTable as evidence, signalSkillExposuresTable as exposures } from '../lib/db/src/index';
import { hashPassword } from '../artifacts/api-server/src/lib/signal-auth';
import { buildSkillAttempt, SKILL_BANK_VERSION, SENIOR_SKILL_RUBRIC_VERSION, skillModuleTemplates, skillModuleRegistry } from '../artifacts/api-server/src/lib/skill-module-bank';
import { seniorV5ChangedFamilies } from '../artifacts/api-server/src/lib/skill-senior-corrections-v5';

const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55435'); assert.equal(database.pathname, '/signal_ui_refinement_20261008');
assert.equal(process.env.NODE_ENV, 'test'); assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED, 'true');
assert.equal(SKILL_BANK_VERSION, 'signal-skills-2026-10-v5');
const [bundlePath, expectedSha, expectedPid] = process.argv.slice(2);
assert.equal(bundlePath?.replaceAll('\\', '/'), 'C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008/outputs/runtime/ui-refinement-correction01-iteration04/dist/index.mjs');
assert.match(expectedSha ?? '', /^[a-f0-9]{64}$/); assert.match(expectedPid ?? '', /^\d+$/);
const bundleSha = createHash('sha256').update(await readFile(bundlePath!)).digest('hex'); assert.equal(bundleSha, expectedSha);
const processScript = "$ProgressPreference = 'SilentlyContinue'; $correctionListeners = @(Get-NetTCPConnection -LocalPort 4371 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique); if ($correctionListeners.Count -ne 1) { throw 'Expected one owned API listener' }; $correctionProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $correctionListeners[0]); @{pid=$correctionProcess.ProcessId;commandLine=$correctionProcess.CommandLine} | ConvertTo-Json -Compress";
const running = JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe', ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(processScript, 'utf16le').toString('base64')], { encoding: 'utf8' }));
assert.equal(running.pid, Number(expectedPid)); assert.ok(running.commandLine.replaceAll('\\', '/').includes('outputs/runtime/ui-refinement-correction01-iteration04/dist/index.mjs'));
const origin = 'http://localhost:4371', appOrigin = 'http://localhost:4372';
const prefix = `senior-correction01-${randomUUID()}`, owned: number[] = [];
const checks: unknown[] = [], issued: unknown[] = [];
let passed = false, failure: string | undefined;
const newFamiliesSeen = new Set<string>();
const dir = 'outputs/verification/ui-refinement-correction01-20261008/senior';
const noOracle = (data: unknown) => assert.doesNotMatch(JSON.stringify(data), /"(?:oracles|expected|parts|seed|answerKey)"\s*:/);

async function actor(skillId: string, failCompetency?: string) {
  const [user] = await db.insert(users).values({ email: `${prefix}-${owned.length}@example.test`, passwordHash: await hashPassword(randomUUID()), displayName: 'Синтетическая проверка Senior C04', role: 'candidate', emailVerified: true, demoMode: false }).returning();
  assert.ok(user); owned.push(user.id);
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600_000), demoMode: false });
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { Cookie: `fsp_signal_session=${token}`, Origin: appOrigin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15_000) });
    return { status: response.status, data: await response.json() as any };
  };
  const resumes = await request('/me/resumes'); assert.equal(resumes.status, 200); const resumeId = resumes.data.resumes[0].id;
  // Two expired, exactly frozen v5 forms expose alternatives. Desired new C04 families are NOT in those forms.
  const disabled = new Set(skillModuleTemplates.filter(t => t.skillId === skillId && t.level === 'Senior' && seniorV5ChangedFamilies.has(`${skillId}:${t.competencyId}:s${t.scenarioIndex + 1}`)).map(t => t.id));
  const seen = new Map<string, number>(), old = new Date(Date.now() - 48 * 3600_000), seeded: number[] = [];
  for (let i = 0; i < 2; i++) {
    const form = buildSkillAttempt(skillId, 'Senior', `${prefix}-${user.id}-seed-${i}`, { personalExposures: seen, disabled });
    const [row] = await db.insert(attempts).values({ userId: user.id, resumeId, skillId, level: 'Senior', ...form, status: 'expired', startedAt: old, expiresAt: new Date(+old + 45 * 60000) }).returning();
    assert.ok(row); seeded.push(row.id);
    await db.insert(exposures).values(form.cases.map(c => ({ userId: user.id, attemptId: row.id, templateId: c.templateId, issuedAt: old })));
    for (const c of form.cases) { assert.ok(!c.contentFamilyId!.startsWith('skill-senior-content-v2:')); seen.set(c.templateId, 1); }
  }
  const beforeConflict = await db.select({ id: attempts.id }).from(attempts).where(eq(attempts.userId, user.id));
  const wrongVersion = await request('/me/skill-attempts', 'POST', { resumeId, skillId, level: 'Senior', programVersion: 'signal-skills-2026-10-v4' });
  assert.equal(wrongVersion.status, 409); assert.equal(wrongVersion.data.code, 'skill_program_version_conflict');
  assert.equal((await db.select({ id: attempts.id }).from(attempts).where(eq(attempts.userId, user.id))).length, beforeConflict.length);
  const matrixBefore = await request(`/me/skill-matrix?resumeId=${resumeId}`); assert.equal(matrixBefore.status, 200);
  const beforeLevel = matrixBefore.data.modules.find((m: any) => m.id === skillId).levels.find((l: any) => l.level === 'Senior');
  assert.equal(beforeLevel.available, true);
  const created = await request('/me/skill-attempts', 'POST', { resumeId, skillId, level: 'Senior', programVersion: SKILL_BANK_VERSION });
  assert.equal(created.status, 201); noOracle(created.data);
  const form = created.data.attempt; assert.equal(form.programVersion, SKILL_BANK_VERSION); assert.equal(form.policy.rubricVersion, SENIOR_SKILL_RUBRIC_VERSION); assert.equal(form.policy.durationMinutes, 45);
  assert.deepEqual(form.feedback, []); assert.doesNotMatch(JSON.stringify(form), /"explanation"\s*:/);
  const desired = form.cases.filter((c: any) => c.contentFamilyId.startsWith('skill-senior-content-v2:'));
  assert.equal(desired.length, skillId === 'typescript' ? 1 : 2);
  for (const c of desired) { assert.equal(c.templateVersion, 2); newFamiliesSeen.add(c.contentFamilyId); }
  const [snapshot] = await db.select().from(attempts).where(and(eq(attempts.id, form.id), eq(attempts.userId, user.id))); assert.ok(snapshot);
  const contentHash = (a: typeof snapshot) => createHash('sha256').update(JSON.stringify({ cases: a.cases, oracles: a.oracles, policy: a.policy, programVersion: a.programVersion, startedAt: a.startedAt, expiresAt: a.expiresAt })).digest('hex');
  const beforeHash = contentHash(snapshot), answers = Object.fromEntries(snapshot.cases.map(c => [c.id, snapshot.oracles[c.id]!.expected]));
  if (failCompetency) { const target = snapshot.cases.find(c => c.competencyId === failCompetency)!; assert.ok(target.contentFamilyId!.startsWith('skill-senior-content-v2:')); assert.equal(target.critical, true); answers[target.id] = `${snapshot.oracles[target.id]!.parts![0]!.expected};wrong new invariant`; }
  const saved = await request(`/me/skill-attempts/${form.id}/answers`, 'PUT', { revision: form.revision, answers }); assert.equal(saved.status, 200); noOracle(saved.data);
  const submitted = await request(`/me/skill-attempts/${form.id}/submit`, 'POST', { revision: saved.data.attempt.revision, answers }); assert.equal(submitted.status, 200); noOracle(submitted.data);
  const decision = submitted.data.attempt.decision;
  assert.equal(decision.passed, !failCompetency); assert.equal(decision.score, failCompetency ? 83 : 100); assert.equal(decision.criticalComplete, !failCompetency);
  const [after] = await db.select().from(attempts).where(eq(attempts.id, form.id)); assert.ok(after); assert.equal(contentHash(after), beforeHash);
  const proof = await db.select().from(evidence).where(and(eq(evidence.userId, user.id), eq(evidence.attemptId, form.id))); assert.equal(proof.length, failCompetency ? 0 : 1);
  const account = await request('/me/skill-matrix'); assert.equal(account.status, 200);
  assert.equal(Boolean(account.data.accountEvidence.find((e: any) => e.skillId === skillId)), !failCompetency);
  if (!failCompetency) assert.equal(account.data.accountEvidence.find((e: any) => e.skillId === skillId).programVersion, SKILL_BANK_VERSION);
  issued.push({ actorId: user.id, skillId, attemptId: form.id, seededExpiredFixtureIds: seeded, desiredFamilyIds: desired.map((c: any) => c.contentFamilyId), failCompetency: failCompetency ?? null, score: decision.score, passed: decision.passed, privateFrozenSnapshotSha: beforeHash, snapshotUnchanged: true });
  checks.push({ name: `${skillId}:${failCompetency ?? 'full'}: actual v5 issue + frozen snapshot submission + proof outcome`, status: 'PASS' });
}
try {
  for (const skill of ['sql', 'typescript', 'react']) await actor(skill);
  await actor('sql', 'transactions'); await actor('sql', 'constraints');
  assert.equal(newFamiliesSeen.size, 5); passed = true;
} catch (error) { failure = error instanceof Error ? error.message : String(error); throw error; }
finally {
  if (owned.length) await db.delete(users).where(inArray(users.id, owned));
  const remainingActors = owned.length ? (await db.select({ id: users.id }).from(users).where(inArray(users.id, owned))).length : 0;
  const remainingSessions = owned.length ? (await db.select({ userId: sessions.userId }).from(sessions).where(inArray(sessions.userId, owned))).length : 0;
  const sourceFiles = ['artifacts/api-server/src/lib/skill-module-bank.ts', 'artifacts/api-server/src/lib/skill-senior-outcomes.ts', 'artifacts/api-server/src/lib/skill-senior-corrections-v5.ts', 'artifacts/api-server/src/lib/skill-module-qualification.ts'];
  const source = await Promise.all(sourceFiles.map(async path => ({ path, sha256: createHash('sha256').update(await readFile(path)).digest('hex') })));
  await mkdir(dir, { recursive: true });
  await writeFile(`${dir}/http-correction01.json`, JSON.stringify({ passed: passed && remainingActors === 0 && remainingSessions === 0, failure, checks, issued, newFamiliesSeen: [...newFamiliesSeen], ownedActorIds: owned, cleanup: { remainingActors, remainingSessions }, runtime: { bundlePath, sha256: bundleSha, pid: running.pid, api: origin, web: appOrigin, database: database.pathname }, source, bankVersion: SKILL_BANK_VERSION, rubricVersion: SENIOR_SKILL_RUBRIC_VERSION, matrixVersion: 'signal-category-competency-matrix-v2', measuredAt: new Date().toISOString(), limitations: ['Five actual HTTP submissions only, no load test.', 'Pre-existing content exposures are modeled by two frozen expired disposable fixture forms, not human attempt history.', 'Oracle-assisted owned fixture answers verify issuance/scoring/persistence, not human professional calibration.', 'No existing users, attempts or evidence were modified; all disposable actors and their dependent rows were deleted.'] }, null, 2));
  await pool.end();
  console.log(JSON.stringify({ passed, checks: checks.length, issued: issued.length, changedFamilies: newFamiliesSeen.size, remainingActors, remainingSessions, receipt: `${dir}/http-correction01.json` }));
}

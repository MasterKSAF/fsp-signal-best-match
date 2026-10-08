/** Actual HTTP regression for the legacy issuance bypass; one owned ordinary actor, no fabricated legacy attempt. */
import assert from 'node:assert/strict';
import { randomUUID, randomBytes, createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalSessionsTable as sessions, signalAssessmentAttemptsTable as legacyAttempts, signalSkillAttemptsTable as moduleAttempts } from '../lib/db/src/index';

const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname, '127.0.0.1');
assert.equal(database.port, '55435');
assert.equal(database.pathname, '/signal_independent_fixes_20261007');
assert.equal(process.env.PORT, '4367');
assert.equal(process.env.SIGNAL_WORKSPACE_ENABLED, 'true');
assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED, 'true');
const [bundlePath, expectedSha, expectedPid] = process.argv.slice(2);
assert.ok(bundlePath && bundlePath.replaceAll('\\', '/').startsWith('C:/Users/Misha/Documents/ChatGPT/LCT/fsp-signal/outputs/local-backup/'));
assert.match(expectedSha ?? '', /^[a-f0-9]{64}$/); assert.match(expectedPid ?? '', /^\d+$/);
const sha256 = createHash('sha256').update(await readFile(bundlePath)).digest('hex');
assert.equal(sha256, expectedSha);
const ps = "$ProgressPreference = 'SilentlyContinue'; $taskListeners = @(Get-NetTCPConnection -LocalPort 4367 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique); if ($taskListeners.Count -ne 1) { throw 'Expected one API process' }; $taskApi = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $taskListeners[0]); @{pid=$taskApi.ProcessId; commandLine=$taskApi.CommandLine} | ConvertTo-Json -Compress";
const running = JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe', ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000 }));
assert.equal(running.pid, Number(expectedPid));
assert.ok(String(running.commandLine).replaceAll('\\', '/').toLowerCase().includes(bundlePath.replaceAll('\\', '/').toLowerCase()));

const fixtureEmail = 'skill-gate-' + randomUUID() + '@example.test';
let userId: number | null = null;
let passed = false, failure: string | undefined, remainingUsers: number | undefined, moduleId: number | undefined;
const checks: string[] = [];
const requests: { path: string; status: number; code?: string }[] = [];
const directory = 'outputs/verification/candidate-workspace-skill-matrix-20261008';
try {
  const [user] = await db.insert(users).values({ email: fixtureEmail, passwordHash: 'unusable-owned-gate-test-only', displayName: 'Дмитрий Олегович Берестов', role: 'candidate', emailVerified: true, demoMode: false }).returning();
  assert.ok(user); userId = user.id;
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ userId, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000), demoMode: false });
  async function request(path: string, method = 'GET', body?: unknown) {
    const response = await fetch('http://localhost:4367/api' + path, { method, headers: { Cookie: 'fsp_signal_session=' + token, Origin: 'http://localhost:4368', ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data = await response.json(); requests.push({ path, status: response.status, ...(data.code ? { code: data.code } : {}) });
    return { status: response.status, data };
  }
  async function ok(path: string, method = 'GET', body?: unknown, status = 200) {
    const result = await request(path, method, body); assert.equal(result.status, status, result.data.error ?? path); return result.data;
  }
  const resume = (await ok('/me/resumes')).resumes[0];
  const profile = await ok(`/me/candidate-profile?resumeId=${resume.id}`);
  await ok('/me/candidate-profile', 'PUT', { ...profile, resumeId: resume.id, revision: profile.revision, identityRevision: profile.identityRevision, specialization: 'Backend / Python', stack: ['Python', 'SQL'], skills: ['Python', 'SQL'], assumedGrade: 'Senior' });
  const current = await ok(`/me/resumes/${resume.id}`);
  const completed = await ok(`/me/resumes/${resume.id}`, 'PUT', { revision: current.revision, summary: current.summary, softSkills: current.softSkills, experience: current.experience, projects: current.projects, education: current.education, portfolio: current.portfolio, questionnaire: { ...current.questionnaire, answers: Object.fromEntries(Object.keys(current.questionnaire.answers).map(key => [key, 3])) } });
  assert.equal(completed.recommendation.completedCount, 6); assert.equal(completed.recommendation.grade, 'Senior');
  assert.equal((await ok(`/me/candidate-profile?resumeId=${resume.id}`)).verifiedGrade, null);
  assert.equal((await db.select({ id: legacyAttempts.id }).from(legacyAttempts).where(eq(legacyAttempts.userId, userId))).length, 0);
  checks.push('Ordinary candidate completed Backend questionnaire over normal API; declared/recommended Senior grants no grade');

  for (const grade of ['Senior', 'Junior'] as const) {
    const result = await request('/assessments/attempts', 'POST', { purpose: 'signal_qualification', gradeConfirmed: true, programId: 'backend-python', grade, resumeId: resume.id });
    assert.equal(result.status, 409); assert.equal(result.data.code, 'SKILL_MODULE_QUALIFICATION_REQUIRED');
    assert.equal((await db.select({ id: legacyAttempts.id }).from(legacyAttempts).where(eq(legacyAttempts.userId, userId))).length, 0);
    checks.push(`New legacy ${grade} issuance returns explicit module-required 409 and inserts no legacy row`);
  }
  const module = (await ok('/me/skill-attempts', 'POST', { resumeId: resume.id, skillId: 'python', level: 'Junior' }, 201)).attempt;
  moduleId = module.id;
  assert.equal(module.skillId, 'python'); assert.equal(module.level, 'Junior'); assert.equal(module.status, 'active');
  const [stored] = await db.select({ id: moduleAttempts.id }).from(moduleAttempts).where(and(eq(moduleAttempts.id, module.id), eq(moduleAttempts.userId, userId)));
  assert.ok(stored);
  assert.equal((await db.select({ id: legacyAttempts.id }).from(legacyAttempts).where(eq(legacyAttempts.userId, userId))).length, 0);
  assert.equal((await ok(`/me/candidate-profile?resumeId=${resume.id}`)).verifiedGrade, null);
  checks.push('Module Python Junior still issues normally; no legacy attempt or automatic category is manufactured');
  passed = true;
} catch (error) { failure = error instanceof Error ? error.message : String(error); }
finally {
  try {
    if (userId !== null) {
      const [owned] = await db.select({ email: users.email }).from(users).where(eq(users.id, userId));
      assert.equal(owned?.email, fixtureEmail);
      await db.delete(users).where(and(eq(users.id, userId), eq(users.email, fixtureEmail)));
      remainingUsers = (await db.select({ id: users.id }).from(users).where(eq(users.id, userId))).length;
    } else remainingUsers = 0;
    assert.equal(remainingUsers, 0);
  } catch (error) { passed = false; failure = [failure, 'Owned fixture cleanup: ' + String(error)].filter(Boolean).join('; '); }
  await pool.end(); await mkdir(directory, { recursive: true });
  const report = { passed, checks, failure, synthetic: true, runtime: { pid: running.pid, bundlePath: bundlePath.replaceAll('\\', '/'), sha256 }, requests, issuedModuleAttemptId: moduleId, historicalActiveRestore: { exercisedOverHttp: false, limitation: 'No authentic active old attempt was created or modified for this regression. Existing restore branch and old GET/save/submit remain subject to source review and prior historical tests.' }, cleanup: { createdUsers: userId === null ? 0 : 1, remainingUsers, ownFixtureOnly: true }, measuredAt: new Date().toISOString() };
  await writeFile(directory + '/skill-legacy-issuance-gate-http.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed, checks: checks.length, failure, cleaned: remainingUsers === 0, apiSha256: sha256 }));
}
if (!passed) process.exitCode = 1;

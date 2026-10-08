/** Bounded C05 integration fixture. No existing actor, saved result, or source DB is changed. */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { and, eq, inArray } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalSessionsTable as sessions, signalSkillAttemptsTable as attempts, signalSkillExposuresTable as exposures } from '../lib/db/src/index';
import { hashPassword } from '../artifacts/api-server/src/lib/signal-auth';
import { buildSkillAttempt, scoreSkillAttempt, skillModuleRegistry, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';

const database = new URL(process.env.DATABASE_URL!);
assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55435'); assert.equal(database.pathname, '/signal_ui_refinement_20261008');
assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED, 'true'); assert.equal(process.env.NODE_ENV, 'test');
assert.equal(SKILL_BANK_VERSION, 'signal-skills-2026-10-v5', 'Run only after the addressed v5 content changes are integrated');
const [bundlePath, expectedSha, expectedPid] = process.argv.slice(2);
const runtimeRoot = resolve('outputs/runtime').replaceAll('\\', '/').toLowerCase() + '/';
assert.ok(resolve(bundlePath ?? '').replaceAll('\\', '/').toLowerCase().startsWith(runtimeRoot));
assert.match(expectedSha ?? '', /^[a-f0-9]{64}$/); assert.match(expectedPid ?? '', /^\d+$/);
const digest = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex');
const bundleSha = digest(await readFile(bundlePath!)); assert.equal(bundleSha, expectedSha);
const processScript = "$availabilityListeners = @(Get-NetTCPConnection -LocalPort 4371 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique); if ($availabilityListeners.Count -ne 1) { throw 'Expected one API listener' }; $availabilityProcess = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $availabilityListeners[0]); @{ pid=$availabilityProcess.ProcessId; commandLine=$availabilityProcess.CommandLine } | ConvertTo-Json -Compress";
const runtime = JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe', ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(processScript, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000 }));
assert.equal(runtime.pid, Number(expectedPid));
assert.ok(runtime.commandLine.replaceAll('\\', '/').toLowerCase().includes(bundlePath!.replaceAll('\\', '/').toLowerCase()) || runtime.commandLine.replaceAll('\\', '/').toLowerCase().includes(bundlePath!.replaceAll('\\', '/').toLowerCase().split('/outputs/')[1]));

const out = 'outputs/verification/ui-refinement-correction01-20261008/availability';
await mkdir(out, { recursive: true });
// Exact historical authoring code is copied from the immutable v4 source map.
// It creates explicitly synthetic fixtures; it never regenerates an existing saved snapshot.
const frozenDir = `${out}/frozen-v4`;
await mkdir(frozenDir, { recursive: true });
const mapPath = 'outputs/runtime/ui-refinement-iteration03/dist/index.mjs.map';
const sourceMap = JSON.parse(await readFile(mapPath, 'utf8'));
const expectedFrozen: Record<string, string | undefined> = {
  'skill-module-bank.ts': '1bbc83ccc474f91d32123b19977f8e7a51c93968bae3ecedd53e6615f87b0d8e',
  'skill-senior-outcomes.ts': '24754c0b4e9bb9b52bc8a4029e6d8b0da73e1b2d590d642edbae73e3d9e94c66',
  'skill-senior-reviewed-choices.ts': '4b9499d7245799535d921dd8a84e994f30a78cdb0cb5dfcaff40af72ae8f98dc',
  'skill-middle-outcomes.ts': '0786fc121001aae3003e2beb362acf9215cf696efe22dd617109cb1c26c5f4d1',
};
const frozenSource: { file: string; sha256: string }[] = [];
for (const [file, expected] of Object.entries(expectedFrozen)) {
  const index = sourceMap.sources.findIndex((path: string) => path.replaceAll('\\', '/').endsWith(`/src/lib/${file}`));
  assert.ok(index >= 0, `${file} not in the accepted v4 source map`);
  const content = sourceMap.sourcesContent[index]; assert.equal(typeof content, 'string');
  const sha256 = digest(content); if (expected) assert.equal(sha256, expected);
  await writeFile(`${frozenDir}/${file}`, content); frozenSource.push({ file, sha256 });
}
const historical = await import(pathToFileURL(resolve(`${frozenDir}/skill-module-bank.ts`)).href) as typeof import('../artifacts/api-server/src/lib/skill-module-bank');
assert.equal(historical.SKILL_BANK_VERSION, 'signal-skills-2026-10-v4');

const prefix = `availability-c01-${randomUUID()}`;
const owned: number[] = [];
const privateActors: { id: number; email: string; password: string; label: string; resumeId?: number }[] = [];
const retained: number[] = [];
const checks: { name: string; status: 'PASS'; detail: unknown }[] = [];
const origin = 'http://localhost:4371', appOrigin = 'http://localhost:4372';
let passed = false, failure: string | undefined;
async function fixture(label: string) {
  const email = `${prefix}-${owned.length}@example.test`, password = randomUUID();
  const [user] = await db.insert(users).values({ email, passwordHash: await hashPassword(password), displayName: label, role: 'candidate', emailVerified: true, demoMode: false }).returning();
  assert.ok(user); owned.push(user.id);
  privateActors.push({ id: user.id, email, password, label });
  const token = randomBytes(32).toString('base64url');
  await db.insert(sessions).values({ userId: user.id, tokenHash: digest(token), expiresAt: new Date(Date.now() + 3600_000), demoMode: false });
  const request = async (path: string, method = 'GET', body?: unknown) => {
    const response = await fetch(`${origin}/api${path}`, { method, headers: { Cookie: `fsp_signal_session=${token}`, Origin: appOrigin, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data = await response.json() as any;
    assert.doesNotMatch(JSON.stringify(data), /"(?:oracles|expected|answerKey|seed)"\s*:/, 'Private answer keys must not be present');
    return { status: response.status, data };
  };
  const ok = async (path: string, method = 'GET', body?: unknown, expected = 200) => { const response = await request(path, method, body); assert.equal(response.status, expected, `${path}: ${response.data.error ?? ''}`); return response.data; };
  const resumes = await ok('/me/resumes'); assert.ok(resumes.resumes?.[0]);
  privateActors.find(a => a.id === user.id)!.resumeId = resumes.resumes[0].id;
  return { id: user.id, resumeId: resumes.resumes[0].id as number, request, ok };
}
type Actor = Awaited<ReturnType<typeof fixture>>;
function level(matrix: any, skillId: string) { return matrix.modules.find((m: any) => m.id === skillId).levels.find((l: any) => l.level === 'Senior'); }
async function seed(a: Actor, skillId: string, form: ReturnType<typeof buildSkillAttempt>, active = false) {
  assert.ok(owned.includes(a.id));
  const startedAt = new Date(Date.now() - (active ? 0 : 48 * 3600_000));
  const expiresAt = new Date(+startedAt + form.policy.durationMinutes * 60_000);
  const decision = active ? null : scoreSkillAttempt(form.cases, form.oracles, {}, form.policy);
  if (decision) assert.equal(decision.passed, false);
  const [row] = await db.insert(attempts).values({ userId: a.id, resumeId: a.resumeId, skillId, level: 'Senior', ...form, status: active ? 'active' : 'submitted', answers: {}, decision, startedAt, expiresAt, submittedAt: active ? null : expiresAt }).returning();
  assert.ok(row);
  await db.insert(exposures).values(form.cases.map(c => ({ userId: a.id, attemptId: row.id, templateId: c.templateId, issuedAt: startedAt })));
  return row;
}
async function step(name: string, fn: () => Promise<unknown>) { checks.push({ name, status: 'PASS', detail: await fn() }); }
try {
  const current = await fixture('Синтетическая проверка доступности новых форм');
  if (process.env.SIGNAL_AVAILABILITY_RETAIN_FOR_UI === 'true') retained.push(current.id);
  const activeIds: number[] = [];
  await step('All six skills: fresh matrix is available and ordinary issue creates a current Senior snapshot', async () => {
    const matrix = await current.ok(`/me/skill-matrix?resumeId=${current.resumeId}`);
    for (const module of skillModuleRegistry) {
      const before = level(matrix, module.id); assert.equal(before.available, true); assert.equal(before.availabilityCode, null);
      const issued = await current.ok('/me/skill-attempts', 'POST', { resumeId: current.resumeId, skillId: module.id, level: 'Senior', programVersion: SKILL_BANK_VERSION }, 201);
      activeIds.push(issued.attempt.id); assert.equal(issued.attempt.programVersion, SKILL_BANK_VERSION);
      const personal = new Map<string, number>(issued.attempt.cases.map((c: any) => [c.templateId, 1]));
      for (let formIndex = 0; formIndex < 2; formIndex++) {
        const next = buildSkillAttempt(module.id, 'Senior', `${prefix}:${module.id}:${formIndex}`, { personalExposures: personal });
        await seed(current, module.id, next);
        for (const c of next.cases) personal.set(c.templateId, 1);
      }
      assert.equal(new Set([...personal.keys()]).size, 18);
    }
    return { actorId: current.id, actualIssuedAttempts: activeIds, skills: 6, syntheticHistoricalFailedForms: 12 };
  });
  await step('All six skills: exhausted new pools remain unavailable while the already-issued snapshots resume unchanged', async () => {
    const matrix = await current.ok(`/me/skill-matrix?resumeId=${current.resumeId}`);
    for (const module of skillModuleRegistry) {
      const item = level(matrix, module.id); assert.equal(item.available, false); assert.equal(item.availabilityCode, 'skill_bank_unavailable'); assert.ok(item.activeAttemptId); assert.equal(item.restriction, null);
      const snapshot = await current.ok(`/me/skill-attempts/${item.activeAttemptId}`);
      const resumed = await current.ok('/me/skill-attempts', 'POST', { resumeId: current.resumeId, skillId: module.id, level: 'Senior', programVersion: 'signal-skills-2026-10-v4' });
      assert.equal(resumed.resumed, true); assert.deepEqual(resumed.attempt, snapshot);
    }
    return { sixNewPoolsUnavailable: true, sixSavedSnapshotsResumed: true, staleRequestedVersionDidNotInvalidateActiveSnapshot: true };
  });
  await step('All six skills: after cooldown/fixture expiry, matrix agrees with POST503 and no new attempt/exposure is written', async () => {
    await db.update(attempts).set({ status: 'expired', expiresAt: new Date(Date.now() - 1) }).where(and(eq(attempts.userId, current.id), inArray(attempts.id, activeIds), eq(attempts.status, 'active')));
    const beforeAttempts = await db.select().from(attempts).where(eq(attempts.userId, current.id)).orderBy(attempts.id);
    const beforeExposures = await db.select().from(exposures).where(eq(exposures.userId, current.id)).orderBy(exposures.id);
    const matrix = await current.ok(`/me/skill-matrix?resumeId=${current.resumeId}`);
    for (const module of skillModuleRegistry) {
      const item = level(matrix, module.id); assert.equal(item.available, false); assert.equal(item.activeAttemptId, null); assert.equal(item.availabilityCode, 'skill_bank_unavailable'); assert.equal(item.restriction, null);
      const denied = await current.request('/me/skill-attempts', 'POST', { resumeId: current.resumeId, skillId: module.id, level: 'Senior', programVersion: SKILL_BANK_VERSION });
      assert.equal(denied.status, 503); assert.equal(denied.data.code, item.availabilityCode); assert.equal(denied.data.error, item.reason);
    }
    assert.deepEqual(await db.select().from(attempts).where(eq(attempts.userId, current.id)).orderBy(attempts.id), beforeAttempts);
    assert.deepEqual(await db.select().from(exposures).where(eq(exposures.userId, current.id)).orderBy(exposures.id), beforeExposures);
    return { sixMatrixFalseAndPost503: true, previousSubmittedFixtureAgeHours: 48, cooldownRestriction: null, unchangedAttemptCount: beforeAttempts.length, unchangedExposureCount: beforeExposures.length };
  });
  const old = await fixture('Синтетическая проверка сохранённых форм v4');
  const oldSnapshots: unknown[] = [];
  await step('All six skills: exact frozen v4 content retains its lineage in the v5 matrix', async () => {
    for (const module of skillModuleRegistry) {
      const personal = new Map<string, number>();
      for (let index = 0; index < 3; index++) {
        const form = historical.buildSkillAttempt(module.id, 'Senior', `${prefix}:v4:${module.id}:${index}`, { personalExposures: personal });
        const row = await seed(old, module.id, form, index === 2); oldSnapshots.push(row);
        for (const c of form.cases) personal.set(c.templateId, 1);
      }
      assert.equal(personal.size, 18);
    }
    const matrix = await old.ok(`/me/skill-matrix?resumeId=${old.resumeId}`); assert.equal(matrix.bankVersion, SKILL_BANK_VERSION);
    for (const module of skillModuleRegistry) { const item = level(matrix, module.id); assert.equal(item.available, false); assert.equal(item.availabilityCode, 'skill_bank_unavailable'); assert.ok(item.activeAttemptId); }
    return { actorId: old.id, exactFrozenV4SyntheticSnapshots: 18, unchangedLineagePreventsFullFreshForm: true };
  });
  await step('All six skills: real old-version active snapshots resume under the new bank without rewriting history or spending exposure', async () => {
    const before = await db.select().from(exposures).where(eq(exposures.userId, old.id)).orderBy(exposures.id);
    for (const module of skillModuleRegistry) {
      const matrix = await old.ok(`/me/skill-matrix?resumeId=${old.resumeId}`), active = level(matrix, module.id).activeAttemptId;
      const snapshot = await old.ok(`/me/skill-attempts/${active}`);
      assert.equal(snapshot.programVersion, 'signal-skills-2026-10-v4');
      const resumed = await old.ok('/me/skill-attempts', 'POST', { resumeId: old.resumeId, skillId: module.id, level: 'Senior', programVersion: SKILL_BANK_VERSION });
      assert.equal(resumed.resumed, true); assert.deepEqual(resumed.attempt, snapshot);
    }
    assert.deepEqual(await db.select().from(attempts).where(eq(attempts.userId, old.id)).orderBy(attempts.id), oldSnapshots);
    assert.deepEqual(await db.select().from(exposures).where(eq(exposures.userId, old.id)).orderBy(exposures.id), before);
    return { continuedOldV4Snapshots: 6, unchangedSnapshotsAndExposure: true };
  });
  passed = true;
} catch (error) { failure = error instanceof Error ? error.message : String(error); throw error; }
finally {
  const cleanup = owned.filter(id => !passed || !retained.includes(id));
  if (cleanup.length) await db.delete(users).where(inArray(users.id, cleanup));
  const remaining = cleanup.length ? await db.select({ id: users.id }).from(users).where(inArray(users.id, cleanup)) : [];
  const sourceFiles = ['artifacts/api-server/src/lib/skill-bank-availability.ts', 'artifacts/api-server/src/routes/signal-skill-modules.ts', 'artifacts/api-server/src/lib/skill-module-bank.ts', 'scripts/skill-bank-availability-http-correction01.ts'];
  const source = await Promise.all(sourceFiles.map(async path => ({ path, sha256: digest(await readFile(path)) })));
  const credentialsFile = 'C:/Users/Misha/.codex/private/signal-availability-correction01-actors-20261008.json';
  if (passed && retained.length) await writeFile(credentialsFile, JSON.stringify({ prefix, actors: privateActors.filter(a => retained.includes(a.id)) }, null, 2));
  await writeFile(`${out}/http-receipt.json`, JSON.stringify({ passed, failure, checks, source, frozenSource, frozenSourceMap: mapPath, runtime: { api: origin, web: appOrigin, database: database.pathname, bundlePath, bundleSha, pid: runtime.pid, bankVersion: SKILL_BANK_VERSION }, ownedActorIds: owned, cleanedActorIds: cleanup, retainedActorIds: passed ? retained : [], ...(passed && retained.length ? { credentialsFile } : {}), cleanupRemaining: remaining.length, fixtureNotes: ['Only newly created synthetic actors are seeded; previous saved attempts, snapshots, and proofs are untouched.', 'Twelve failed historical fixtures per actor use explicit48h timestamps; no confirmation is awarded.', 'The current actor active expiry is a fixture clock simulation; six old-v4 active snapshots are checked without mutation.', 'No oracle answer is sent to the public client. Frozen source extraction is a test-only historical fixture, not a production fallback.'], measuredAt: new Date().toISOString() }, null, 2));
  assert.equal(remaining.length, 0); await pool.end();
  console.log(JSON.stringify({ passed, checks: checks.length, ownedActors: owned.length, retainedActorIds: passed ? retained : [], cleanupRemaining: remaining.length, receipt: `${out}/http-receipt.json` }));
}

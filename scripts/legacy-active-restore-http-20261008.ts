/** Genuine flag-off issuance -> flag-on restore/save/submit; one owned ordinary actor. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawn, type ChildProcess } from 'node:child_process';
import { open, mkdir, readFile, writeFile } from 'node:fs/promises';
import { setTimeout as delay } from 'node:timers/promises';
import { and, eq } from 'drizzle-orm';
import { db, pool, signalAssessmentAttemptsTable as legacy, signalSkillAttemptsTable as modules } from '../lib/db/src/index';
import { qaEnvironment, guardRuntime, powershell, createOwnedActor, deleteOwnedActor, ok, request, protectedState, proofDirectory, type OwnedActor } from './qa-owned-http-20261008';

qaEnvironment();
const [bundlePath, expectedSha, expectedPid, tempBundlePath, tempExpectedSha, mode = 'retain'] = process.argv.slice(2);
assert.ok(mode === 'retain' || mode === 'cleanup-on-success');
const runtime = await guardRuntime(bundlePath, expectedSha, Number(expectedPid));
assert.ok(tempBundlePath.replaceAll('\\','/').startsWith('C:/Users/Misha/Documents/ChatGPT/LCT/fsp-signal/outputs/local-backup/legacy-active-qa-api-20261008/'));
const tempSha = createHash('sha256').update(await readFile(tempBundlePath)).digest('hex'); assert.equal(tempSha, tempExpectedSha);
assert.equal(Number(powershell('@(Get-NetTCPConnection -LocalPort 4389 -State Listen -ErrorAction SilentlyContinue).Count')), 0);
const before = await protectedState(); assert.equal(before.legacy.count, 7);
assert.equal(before.legacy.md5, '8fe3a1ca84bf5f25bb357bee68ca0630');
const checks: string[] = [];
let actor: OwnedActor | undefined, child: ChildProcess | undefined, tempRuntime: Awaited<ReturnType<typeof guardRuntime>> | undefined;
let resumeId: number | undefined, legacyId: number | undefined, moduleId: number | undefined;
let passed = false, failure: string | undefined, retained = false, temporaryStopped = false, cleaned = false;
let beforeModule: unknown, mixed: unknown;
const privatePath = 'C:/Users/Misha/.codex/private/signal-legacy-active-ui-20261008.json';
async function stopTemporary() {
  if (temporaryStopped || !child || !child.pid || child.exitCode !== null || child.signalCode !== null) { temporaryStopped = true; return; }
  if (tempRuntime) await guardRuntime(tempBundlePath, tempSha, tempRuntime.pid, 4389);
  else {
    // A launch failure may precede the listener; verify our spawned process
    // identity directly rather than leaving it alive or stopping any port owner.
    const identity = JSON.parse(powershell(`$taskApi = Get-CimInstance Win32_Process -Filter 'ProcessId = ${child.pid}'; if (!$taskApi) { throw 'Owned process identity unavailable' }; @{pid=$taskApi.ProcessId; commandLine=$taskApi.CommandLine} | ConvertTo-Json -Compress`));
    assert.equal(identity.pid, child.pid);
    assert.ok(String(identity.commandLine).replaceAll('\\','/').toLowerCase().includes(tempBundlePath.replaceAll('\\','/').toLowerCase()));
  }
  const exit = new Promise<void>(resolve => child!.once('exit', () => resolve()));
  assert.equal(child.kill('SIGTERM'), true);
  await Promise.race([exit, delay(5000).then(() => { throw new Error('Owned temporary process did not exit'); })]);
  assert.equal(Number(powershell('@(Get-NetTCPConnection -LocalPort 4389 -State Listen -ErrorAction SilentlyContinue).Count')), 0);
  temporaryStopped = true;
}
try {
  await mkdir(proofDirectory, { recursive: true });
  const log = await open(proofDirectory + '/legacy-active-temporary-api.log', 'a');
  child = spawn(process.execPath, [tempBundlePath], { windowsHide: true, env: { ...process.env, PORT: '4389', HOST: '127.0.0.1', PUBLIC_URL: 'http://localhost:4389', SIGNAL_SKILL_MODULES_ENABLED: 'false' }, stdio: ['ignore', log.fd, log.fd] });
  await log.close();
  const launchError = new Promise<never>((_resolve,reject) => child!.once('error',reject));
  const ready = async () => {
    for (let i = 0; i < 40; i++) {
      if (child!.exitCode !== null) throw new Error('Owned temporary API exited before ready; inspect bounded API log');
      try { const response = await fetch('http://127.0.0.1:4389/api/healthz', { signal: AbortSignal.timeout(1000) }); if (response.ok) return; } catch { /* bounded own-process readiness only */ }
      await delay(250);
    }
    throw new Error('Owned temporary API failed readiness');
  };
  await Promise.race([ready(), launchError]);
  tempRuntime = await guardRuntime(tempBundlePath, tempSha, child.pid!, 4389);
  actor = await createOwnedActor('legacy-active', 'candidate', 'Дмитрий Олегович Берестов');
  const resume = (await ok(actor, '/me/resumes')).resumes[0]; resumeId = resume.id;
  const profile = await ok(actor, `/me/candidate-profile?resumeId=${resumeId}`);
  await ok(actor, '/me/candidate-profile', 'PUT', { ...profile, resumeId, revision: profile.revision, identityRevision: profile.identityRevision, specialization: 'Backend / Python', stack: ['Python', 'SQL'], skills: ['Python', 'SQL'], assumedGrade: 'Middle' });
  const current = await ok(actor, `/me/resumes/${resumeId}`);
  const filled = await ok(actor, `/me/resumes/${resumeId}`, 'PUT', { revision: current.revision, summary: 'Синтетический собственный профиль для проверки совместимости квалификации.', softSkills: current.softSkills, experience: current.experience, projects: current.projects, education: current.education, portfolio: current.portfolio, questionnaire: { ...current.questionnaire, answers: Object.fromEntries(Object.keys(current.questionnaire.answers).map(key => [key, 2])) } });
  assert.equal(filled.recommendation.completedCount, 6);
  assert.equal((await ok(actor, `/me/candidate-profile?resumeId=${resumeId}`)).verifiedGrade, null);
  checks.push('Fresh ordinary owned actor and complete questionnaire created over normal routes; no grade fabricated');
  const start = { purpose: 'signal_qualification', gradeConfirmed: true, programId: 'backend-python', grade: 'Junior', resumeId };
  const issued = await ok(actor, '/assessments/attempts', 'POST', start, 201, 4389);
  legacyId = issued.id; assert.equal(issued.status, 'in_progress'); assert.equal(issued.resumeId, resumeId);
  const [stored] = await db.select().from(legacy).where(and(eq(legacy.id, legacyId!), eq(legacy.userId, actor.id)));
  assert.ok(stored && stored.cases.length === 6 && +stored.dueAt > Date.now());
  const immutable = ({ id, userId, resumeId, resumeRevision, resumeSpecialization, purpose, purposeOrigin, gradeConfirmedAt, programId, programVersion, grade, cases, oracles, startedAt, dueAt }: typeof stored) => ({ id, userId, resumeId, resumeRevision, resumeSpecialization, purpose, purposeOrigin, gradeConfirmedAt, programId, programVersion, grade, cases, oracles, startedAt, dueAt });
  const issuanceHash = createHash('sha256').update(JSON.stringify(immutable(stored))).digest('hex');
  await stopTemporary();
  checks.push('Real active legacy attempt issued by production routes with modules=false; scheduler-free owned API4389 stopped');
  const restored = await ok(actor, `/assessments/attempts/${legacyId}?resumeId=${resumeId}`);
  assert.equal(restored.id, issued.id); assert.equal(restored.programVersion, issued.programVersion); assert.equal(restored.startedAt, issued.startedAt); assert.equal(restored.dueAt, issued.dueAt); assert.deepEqual(restored.cases, issued.cases);
  const resumed = await ok(actor, '/assessments/attempts', 'POST', start, 200);
  assert.equal(resumed.id, issued.id);
  assert.equal((await db.select({ id: legacy.id }).from(legacy).where(eq(legacy.userId, actor.id))).length, 1);
  checks.push('Modules=true GET and repeated start restore the same ID/cases/deadline/version without issuing another attempt');
  const answers = stored.cases.map(c => ({ caseId: c.id, answer: stored.oracles[c.id]!.answer }));
  const saved = await ok(actor, `/assessments/attempts/${legacyId}/answers`, 'PUT', { resumeId, answers });
  assert.equal(saved.status, 'in_progress'); assert.ok(saved.cases.every((c: any) => c.savedAnswer === answers.find(a => a.caseId === c.id)!.answer));
  const savedRead = await ok(actor, `/assessments/attempts/${legacyId}?resumeId=${resumeId}`); assert.deepEqual(savedRead.cases, saved.cases);
  const result = await ok(actor, `/assessments/attempts/${legacyId}/submit`, 'POST', { resumeId });
  assert.equal(result.verified, true); assert.equal(result.grade, 'Junior'); assert.equal(result.score, 100);
  const repeated = await ok(actor, `/assessments/attempts/${legacyId}/submit`, 'POST', { resumeId }); assert.deepEqual(repeated, result);
  const [finished] = await db.select().from(legacy).where(and(eq(legacy.id, legacyId!), eq(legacy.userId, actor.id)));
  assert.equal(finished.status, 'submitted'); assert.equal(createHash('sha256').update(JSON.stringify(immutable(finished))).digest('hex'), issuanceHash);
  assert.equal((await ok(actor, `/me/candidate-profile?resumeId=${resumeId}`)).verifiedGrade, 'Junior');
  beforeModule = await ok(actor, `/me/skill-qualification?resumeId=${resumeId}`);
  const blocked = await request(actor, '/assessments/attempts', 'POST', start);
  assert.equal(blocked.status, 409); assert.equal(blocked.data.code, 'SKILL_MODULE_QUALIFICATION_REQUIRED');
  checks.push('Normal save/GET/submit completes genuine legacy attempt; repeated submit is stable, issuance metadata unchanged, new legacy issue still 409');
  const module = (await ok(actor, '/me/skill-attempts', 'POST', { resumeId, skillId: 'python', level: 'Junior' }, 201)).attempt;
  moduleId = module.id;
  const [moduleStored] = await db.select().from(modules).where(and(eq(modules.id, moduleId!), eq(modules.userId, actor.id)));
  assert.ok(moduleStored);
  const moduleAnswers = Object.fromEntries(moduleStored.cases.map(c => [c.id, moduleStored.oracles[c.id]!.expected]));
  const moduleResult = (await ok(actor, `/me/skill-attempts/${moduleId}/submit`, 'POST', { revision: module.revision, answers: moduleAnswers })).attempt;
  assert.equal(moduleResult.decision.passed, true); assert.equal(moduleResult.decision.criticalComplete, true);
  const matrix = await ok(actor, `/me/skill-matrix?resumeId=${resumeId}`);
  assert.equal(matrix.accountEvidence.length, 1); assert.equal(matrix.accountEvidence[0].skillId, 'python');
  assert.equal(matrix.qualification.verifiedGrade, null); assert.equal(matrix.qualification.category, null);
  assert.equal((await ok(actor, `/me/candidate-profile?resumeId=${resumeId}`)).verifiedGrade, 'Junior');
  mixed = await ok(actor, `/me/skill-qualification?resumeId=${resumeId}`);
  checks.push('One real Python Junior module adds evidence without closing the role matrix or promoting historical Junior');
  assert.deepEqual(await protectedState(before.legacy.ids), before);
  checks.push('Original seven legacy rows and actor997 profile/resumes/module limits unchanged');
  passed = true;
  if (mode === 'retain') {
    await writeFile(privatePath, JSON.stringify({ actor, resumeId, legacyId, moduleId, purpose: 'Owned synthetic mixed historical/module UI fixture; delete only after root UI handoff.', protectedBefore: before, issuanceHash, runtime }, null, 2));
    retained = true;
  }
} catch (error) { failure = error instanceof Error ? error.message : String(error); }
finally {
  try { await stopTemporary(); } catch (error) { passed = false; failure = [failure, 'Temporary stop: ' + String(error)].filter(Boolean).join('; '); }
  try {
    if (actor && !retained) { await deleteOwnedActor(actor); assert.deepEqual(await protectedState(), before); cleaned = true; }
    else if (!actor) cleaned = true;
  } catch (error) { passed = false; failure = [failure, 'Owned cleanup: ' + String(error)].filter(Boolean).join('; '); }
  await pool.end(); await mkdir(proofDirectory, { recursive: true });
  await writeFile(proofDirectory + '/legacy-active-restore-http.json', JSON.stringify({ passed, failure, checks, synthetic: true, runtime, temporary: { ...tempRuntime, schedulerFree: true, modulesEnabled: false, stopped: temporaryStopped }, actualLegacy: { id: legacyId, authenticIssueOverHttp: true, restoredOverHttp: passed, answersAndSubmitOverHttp: passed }, mixedModule: { id: moduleId, qualificationBefore: beforeModule, qualificationAfter: mixed }, preserved: before, cleanup: { cleaned, retainedForRootUi: retained, ownFixtureOnly: true }, measuredAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ passed, checks: checks.length, failure, temporaryStopped, retainedForRootUi: retained, cleaned, ...(retained ? { privateCredentialPath: privatePath, userId: actor!.id, resumeId } : {}) }));
}
if (!passed) process.exitCode = 1;

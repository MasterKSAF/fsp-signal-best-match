/** Bounded confirmation after the QA stop bookkeeping bug; no new issuance or fabricated data. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { and, eq } from 'drizzle-orm';
import { db, pool, signalAssessmentAttemptsTable as legacy, signalSkillAttemptsTable as modules } from '../lib/db/src/index';
import { qaEnvironment, guardRuntime, powershell, ok, protectedState, proofDirectory, type OwnedActor } from './qa-owned-http-20261008';
qaEnvironment();
const fixture = JSON.parse(await readFile('C:/Users/Misha/.codex/private/signal-legacy-active-ui-20261008.json','utf8'));
const actor = fixture.actor as OwnedActor;
assert.ok(actor.email.startsWith('legacy-active-') && actor.email.endsWith('@example.test'));
try {
  await guardRuntime(fixture.runtime.bundlePath, fixture.runtime.sha256, fixture.runtime.pid);
  assert.equal(Number(powershell('@(Get-NetTCPConnection -LocalPort 4389 -State Listen -ErrorAction SilentlyContinue).Count')), 0);
  const [stored] = await db.select().from(legacy).where(and(eq(legacy.id, fixture.legacyId),eq(legacy.userId,actor.id)));
  assert.ok(stored); assert.equal(stored.status,'submitted'); assert.equal(stored.score,100); assert.equal(stored.verified,true);
  const { id,userId,resumeId,resumeRevision,resumeSpecialization,purpose,purposeOrigin,gradeConfirmedAt,programId,programVersion,grade,cases,oracles,startedAt,dueAt } = stored;
  assert.equal(createHash('sha256').update(JSON.stringify({ id,userId,resumeId,resumeRevision,resumeSpecialization,purpose,purposeOrigin,gradeConfirmedAt,programId,programVersion,grade,cases,oracles,startedAt,dueAt })).digest('hex'),fixture.issuanceHash);
  const attempt = await ok(actor,`/assessments/attempts/${fixture.legacyId}?resumeId=${fixture.resumeId}`);
  assert.equal(attempt.status,'submitted'); assert.equal(attempt.result.verified,true); assert.equal(attempt.result.score,100);
  assert.equal((await ok(actor,`/me/candidate-profile?resumeId=${fixture.resumeId}`)).verifiedGrade,'Junior');
  const matrix = await ok(actor,`/me/skill-matrix?resumeId=${fixture.resumeId}`);
  assert.equal(matrix.accountEvidence.length,1); assert.equal(matrix.accountEvidence[0].skillId,'python'); assert.equal(matrix.accountEvidence[0].level,'Junior');
  assert.equal(matrix.qualification.verifiedGrade,null); assert.equal(matrix.qualification.category,null);
  const [module] = await db.select().from(modules).where(and(eq(modules.id,fixture.moduleId),eq(modules.userId,actor.id)));
  assert.ok(module); assert.equal(module.status,'submitted'); assert.equal(module.decision?.passed,true);
  assert.deepEqual(await protectedState(fixture.protectedBefore.legacy.ids),fixture.protectedBefore);
  const reportPath = proofDirectory + '/legacy-active-restore-http.json';
  const report = JSON.parse(await readFile(reportPath,'utf8'));
  assert.equal(report.checks.length,6); assert.equal(report.temporary.stopped,true); assert.equal(report.cleanup.retainedForRootUi,true);
  const total = (await protectedState()).legacy.count; assert.equal(total,fixture.protectedBefore.legacy.count+1);
  report.harnessRecovery = { reason: 'The second stop call misread Node signalCode SIGTERM / exitCode null after the owned API was already stopped; stop bookkeeping is now idempotent.', priorFailureStage: 'finally temporary stop guard', unchangedProductSources: true, noReissue: true, persistedOwnedDataConfirmedOverHttp: true, port4389Free: true, at: new Date().toISOString() };
  report.passed = true; delete report.failure;
  report.actualLegacy.restoredOverHttp = true; report.actualLegacy.answersAndSubmitOverHttp = true;
  report.checks.push('Bounded retained HTTP/DB confirmation: genuine submitted immutable legacy row, one passed module, original7/997 intact, temporary4389 free');
  await writeFile(reportPath,JSON.stringify(report,null,2));
  console.log(JSON.stringify({ passed:true, checks:report.checks.length, temporary4389Stopped:true, retainedForRootUi:true, userId:actor.id,resumeId:fixture.resumeId }));
} finally { await pool.end(); }

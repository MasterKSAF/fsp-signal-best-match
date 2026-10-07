/** Read-only source-stand facts for the four privately owned synthetic UI actors. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { eq, inArray, sql } from 'drizzle-orm';
import { buildCandidateEvidenceCatalog } from '../artifacts/api-server/src/lib/signal-candidate-evidence';
import { getResumeQualification } from '../artifacts/api-server/src/lib/signal-resume-qualification';

const target = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
assert.equal(target.hostname, '127.0.0.1'); assert.equal(target.port, '55435');
assert.equal(target.pathname, '/signal_resume_v060_check');
assert.equal(process.env.API_ORIGIN, 'http://127.0.0.1:4363');
const privateRoot = join(homedir(), '.codex/private');
const actors = JSON.parse(await readFile(join(privateRoot, 'signal-v060-ui-reviewers.json'), 'utf8'));
const ownedIds: number[] = actors.accounts.map((account: { id: number }) => account.id);
assert.deepEqual([...ownedIds].sort((a, b) => a - b), [68, 69, 70, 72]);
const owner = JSON.parse((await readFile(join(privateRoot, 'signal-v060-check-database.json'), 'utf8')).replace(/^\uFEFF/, ''));
const processManifest = JSON.parse((await readFile(join(privateRoot, 'signal-v060-check-process.json'), 'utf8')).replace(/^\uFEFF/, ''));
assert.equal(owner.database, target.pathname.slice(1)); assert.equal(processManifest.apiOrigin, process.env.API_ORIGIN);
const readyPath = 'outputs/verification/release-0.6.0/stand-ready.json';
const readyBytes = await readFile(readyPath), ready = JSON.parse(readyBytes.toString('utf8').replace(/^\uFEFF/, ''));
assert.equal(ready.pid, processManifest.pid); assert.equal(ready.runtimeKind, 'source-tsx-targeted-only');
const hash = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
const sources = [
  'artifacts/api-server/src/lib/signal-candidate-evidence.ts',
  'artifacts/api-server/src/lib/signal-resume-qualification.ts',
  'artifacts/api-server/src/lib/signal-evidence-compatibility.ts',
  'artifacts/api-server/src/lib/assessment-purpose.ts',
  'artifacts/api-server/src/lib/assessment-bank.ts',
  'artifacts/api-server/src/lib/signal-pool-scope.ts',
  'artifacts/api-server/src/lib/microtask-resume-policy.ts',
  'artifacts/api-server/src/routes/signal-candidate-evidence.ts',
  'artifacts/api-server/src/routes/signal-microtasks.ts',
  'artifacts/api-server/src/routes/signal-invitations.ts',
  'scripts/aggregate-source-gui-state-v060.ts',
];
const sourceHashes = Object.fromEntries(await Promise.all(sources.map(async path => [path, hash(await readFile(path))])));

function processWitness() {
  const privateEnv = join(privateRoot, 'signal-v060-check.env').replaceAll('\\', '/');
  const command = `$ErrorActionPreference='Stop';$ProgressPreference='SilentlyContinue';$p=Get-Process -Id ${processManifest.pid};$w=Get-CimInstance Win32_Process -Filter 'ProcessId=${processManifest.pid}';$b=@(Get-NetTCPConnection -LocalPort 4363 -State Listen);$line=$w.CommandLine.Replace('\\','/');@{pid=$p.Id;startedAt=$p.StartTime.ToUniversalTime().ToString('o');name=$w.Name;ownedEnvironment=$line.Contains('${privateEnv}');sourceEntry=$line.Contains('artifacts/api-server/src/index.ts');bindings=@($b|Select-Object LocalAddress,LocalPort,OwningProcess)}|ConvertTo-Json -Depth 5 -Compress`;
  const result = spawnSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe', ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(command, 'utf16le').toString('base64')], { encoding: 'utf8', windowsHide: true });
  assert.equal(result.status, 0, 'Exact privately owned source process unavailable');
  const actual = JSON.parse(result.stdout.trim());
  assert.equal(actual.pid, processManifest.pid); assert.equal(actual.name, 'node.exe');
  assert.equal(Date.parse(actual.startedAt), Date.parse(processManifest.startedAt));
  assert.equal(actual.ownedEnvironment, true); assert.equal(actual.sourceEntry, true);
  assert.deepEqual(actual.bindings, [{ LocalAddress: '127.0.0.1', LocalPort: 4363, OwningProcess: processManifest.pid }]);
  return { pid: actual.pid, processStartedAt: actual.startedAt, apiOrigin: process.env.API_ORIGIN, runtimeKind: ready.runtimeKind };
}
const before = processWitness();
const { db, pool, signalUsersTable, signalCompaniesTable, signalAssessmentAttemptsTable,
  signalCandidateResumesTable, signalAssessmentCorrectionsTable } = await import('../lib/db/src/index.ts');
try {
  const state = await db.transaction(async tx => {
    const identity = (await tx.execute(sql`SELECT current_database() AS name,(SELECT oid::text FROM pg_database WHERE datname=current_database()) AS oid`)).rows[0] as { name: string; oid: string };
    assert.equal(identity.name, owner.database); assert.equal(Number(identity.oid), owner.databaseOid);
    const accounts = await tx.select({ id: signalUsersTable.id, role: signalUsersTable.role, demoMode: signalUsersTable.demoMode, reviewScopeId: signalUsersTable.reviewScopeId }).from(signalUsersTable).where(inArray(signalUsersTable.id, ownedIds));
    assert.equal(accounts.length, 4); assert.ok(accounts.every(row => row.demoMode && row.reviewScopeId));
    const byId = new Map(accounts.map(row => [row.id, row]));
    assert.equal(byId.get(68)!.role, 'candidate'); assert.equal(byId.get(69)!.role, 'employer');
    assert.equal(byId.get(70)!.role, 'candidate'); assert.equal(byId.get(72)!.role, 'employer');
    assert.equal(byId.get(68)!.reviewScopeId, byId.get(69)!.reviewScopeId);
    assert.equal(byId.get(70)!.reviewScopeId, byId.get(72)!.reviewScopeId);
    assert.notEqual(byId.get(68)!.reviewScopeId, byId.get(70)!.reviewScopeId);
    const company = await tx.select({ id: signalCompaniesTable.id, ownerUserId: signalCompaniesTable.ownerUserId }).from(signalCompaniesTable).where(eq(signalCompaniesTable.ownerUserId, 69));
    assert.equal(company.length, 1); assert.equal(company[0]!.id, 18);
    const resumes = await tx.select().from(signalCandidateResumesTable).where(inArray(signalCandidateResumesTable.userId, [68, 70]));
    const attempts = await tx.select().from(signalAssessmentAttemptsTable).where(inArray(signalAssessmentAttemptsTable.userId, [68, 70]));
    const corrections = await tx.select().from(signalAssessmentCorrectionsTable).where(inArray(signalAssessmentCorrectionsTable.attemptId, attempts.map(row => row.id)));
    const correctedIds = new Set(corrections.map(row => row.attemptId));
    const passed = attempts.find(row => row.id === 26)!, failed = attempts.find(row => row.id === 27)!;
    assert.equal(passed.userId, 68); assert.equal(passed.score, 100); assert.equal(passed.verified, true); assert.equal(passed.grade, 'Junior');
    assert.equal(failed.userId, 70); assert.equal(failed.score, 0); assert.equal(failed.verified, false);
    assert.equal(passed.purpose, 'signal_qualification'); assert.equal(failed.purpose, 'signal_qualification');
    assert.equal(passed.purposeOrigin, 'candidate_confirmed'); assert.equal(failed.purposeOrigin, 'candidate_confirmed');
    const selected = resumes.find(row => row.id === 110)!, second = resumes.find(row => row.id === failed.resumeId)!;
    const qualification = getResumeQualification(selected, attempts, correctedIds, { includeRetainedCriteria: true });
    const failedQualification = getResumeQualification(second, attempts, correctedIds, { includeRetainedCriteria: true });
    assert.equal(qualification.verifiedGrade, 'Junior'); assert.equal(qualification.qualificationAttemptId, 26);
    assert.equal(failedQualification.verifiedGrade, null); assert.equal(second.verifiedGrade, null);
    const registry = buildCandidateEvidenceCatalog(68, resumes, attempts, corrections);
    assert.ok(registry.evidence.length > 0);
    assert.ok(registry.evidence.every(row => row.attemptId === 26 && row.date === passed.submittedAt!.toISOString() && row.purpose === 'signal_qualification'));
    assert.ok(registry.evidence.every(row => row.applications.some(application => application.resumeId === 110 && application.applied)));
    const offer = (await tx.execute(sql`SELECT id,candidate_user_id,company_id,purpose,status,resume_id,resume_revision,resume_provenance,resume_context,created_at,submitted_at,result,share_result,consent_revoked_at FROM signal_micro_offers WHERE id=36`)).rows[0] as any;
    assert.equal(offer.candidate_user_id, 68); assert.equal(offer.company_id, company[0]!.id);
    assert.equal(offer.purpose, 'company_task'); assert.equal(offer.status, 'evaluated');
    assert.equal(offer.resume_id, 110); assert.equal(offer.resume_revision, 5); assert.equal(offer.resume_provenance, 'captured');
    assert.equal(offer.resume_context.resumeId, 110); assert.equal(offer.resume_context.revision, 5);
    assert.equal(offer.result.total, 10); assert.equal(offer.result.max, 10); assert.equal(offer.result.source, 'company_task');
    assert.equal(offer.result.purpose, 'company_task'); assert.equal(offer.result.qualificationEffect, 'none');
    assert.equal(offer.result.evaluatorUserId, 69);
    const invitations = (await tx.execute(sql`SELECT i.id,i.need_id,i.company_id,i.candidate_user_id,i.resume_id,i.status,i.created_at,i.updated_at,g.consented_at,g.revoked_at FROM signal_invitations i LEFT JOIN signal_contact_grants g ON g.invitation_id=i.id WHERE i.need_id=5 AND i.candidate_user_id=68`)).rows as any[];
    assert.equal(invitations.length, 1); const invitation = invitations[0]!;
    assert.equal(invitation.company_id, company[0]!.id); assert.equal(invitation.resume_id, 110); assert.equal(invitation.status, 'accepted');
    assert.ok(invitation.consented_at && invitation.revoked_at); assert.ok(new Date(invitation.revoked_at) > new Date(invitation.consented_at));
    const safeAttempt = (row: typeof passed, derivedGrade: string | null) => ({ id: row.id, candidateId: row.userId, purpose: row.purpose, purposeOrigin: row.purposeOrigin,
      score: row.score, verified: row.verified, requestedGrade: row.grade, derivedVerifiedGrade: derivedGrade,
      originalResumeId: row.resumeId, originalResumeRevision: row.resumeRevision,
      programId: row.programId, programVersion: row.programVersion,
      gradeConfirmedAt: row.gradeConfirmedAt, startedAt: row.startedAt, submittedAt: row.submittedAt });
    return {
      database: identity.name, databaseOid: Number(identity.oid), syntheticReviewerActors: { candidates: [68, 70], employer: 69, samePairScope: true, foreignPairScopeDistinct: true, scopeIdentifiersExported: false },
      qualification: safeAttempt(passed, qualification.verifiedGrade), failedQualification: safeAttempt(failed, failedQualification.verifiedGrade),
      selectedResume: { id: selected.id, currentRevision: selected.revision, specialization: selected.specialization, isPrimary: selected.isPrimary, storedVerifiedGrade: selected.verifiedGrade, sourceQualificationAttemptId: qualification.qualificationAttemptId },
      sourceRegistry: { matrixVersion: registry.matrixVersion, canonicalOwnerReadModel: true, originalDatesPreserved: true, evidence: registry.evidence.map(row => ({ id: row.id, canonicalSkillId: row.canonicalSkillId, criterionId: row.criterionId, attemptId: row.attemptId, originalResumeId: row.originalResumeId, date: row.date, purpose: row.purpose, sourceType: row.sourceType, result: row.result, status: row.status, applications: row.applications.map(application => ({ resumeId: application.resumeId, applied: application.applied, selected: application.selected, reasonCode: application.reasonCode, compatibilityRuleId: application.compatibilityRuleId })) })) },
      companyPractice: { id: offer.id, purpose: offer.purpose, status: offer.status, candidateId: offer.candidate_user_id, companyId: offer.company_id, source: offer.result.source, manualEvaluatorUserId: offer.result.evaluatorUserId, total: offer.result.total, max: offer.result.max, qualificationEffect: offer.result.qualificationEffect, assignedGrade: null, selectedResumeId: offer.resume_id, capturedRevision: offer.resume_revision, provenance: offer.resume_provenance, createdAt: offer.created_at, submittedAt: offer.submitted_at, evaluatedAt: offer.result.evaluatedAt },
      invitationContact: { id: invitation.id, needId: invitation.need_id, candidateId: invitation.candidate_user_id, companyId: invitation.company_id, resumeId: invitation.resume_id, status: invitation.status, createdAt: invitation.created_at, updatedAt: invitation.updated_at, consentedAt: invitation.consented_at, revokedAt: invitation.revoked_at, contactShared: false, revocationHistoryPreserved: true },
    };
  }, { isolationLevel: 'repeatable read', accessMode: 'read only' });
  const after = processWitness(); assert.deepEqual(after, before);
  for (const [path, expected] of Object.entries(sourceHashes)) assert.equal(hash(await readFile(path)), expected);
  assert.equal((await fetch('http://127.0.0.1:4363/api/healthz')).status, 200);
  const report = { schemaVersion: 1, applicationVersion: '0.6.0', passed: true, generatedAt: new Date().toISOString(),
    execution: before, sourceHashes, sourceFilesUnchangedDuringRead: true, standReady: { path: readyPath, sha256: hash(readyBytes) },
    ...state, noDatabaseWrites: true, noNewAuthSessions: true, credentialsOrAnswersExported: false,
    scope: 'Read-only SQL snapshot of exact privately owned synthetic source-stand UI actors plus current pure owner registry/qualification resolvers. Live source-tsx4363 process identity and health verified. No authenticated endpoint, screenshot, normal compiled runtime, full source graph, human exam validity, load, sealed archive or clean-launch claim.' };
  const output = 'outputs/verification/release-0.6.0/source-gui-state-readonly.json';
  await writeFile(output, JSON.stringify(report, null, 2) + '\n', { flag: 'wx' });
  console.log(JSON.stringify({ passed: true, output, sha256: hash(await readFile(output)), sourceRegistryEntries: state.sourceRegistry.evidence.length, noDatabaseWrites: true }));
} finally { await pool.end(); }

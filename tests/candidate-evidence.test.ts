import assert from "node:assert/strict";
import test from "node:test";
import { assembleManagedAttempt } from "../artifacts/api-server/src/lib/assessment-managed";
import { assembleAttempt } from "../artifacts/api-server/src/lib/assessment-bank";
import { EVIDENCE_COMPATIBILITY_RULES, EVIDENCE_COMPATIBILITY_VERSION, resolveCriterionCompatibility } from "../artifacts/api-server/src/lib/signal-evidence-compatibility";
import { buildCandidateEvidenceCatalog, type CandidateEvidenceResume } from "../artifacts/api-server/src/lib/signal-candidate-evidence";
import { getResumeQualification, type ResumeQualificationAttempt } from "../artifacts/api-server/src/lib/signal-resume-qualification";

const ownerId = 71;
const date = "2026-10-02T10:20:00.000Z";
function resume(id: number, specialization = "Backend / Python"): CandidateEvidenceResume {
  return { id, userId: ownerId, revision: 1, title: `Owned ${id}`, specialization, visibility: "private", isPrimary: id === 1, deletedAt: null, legacyQualification: null };
}
function proof(id = 901, programId: "backend-python" | "frontend-typescript" = "backend-python", grade: "Junior" | "Middle" | "Senior" = "Middle"): ResumeQualificationAttempt {
  const form = assembleManagedAttempt(programId, grade, `evidence-registry-${id}`, {programVersion:programId === "backend-python" ? "signal-backend-python-v6" : "signal-frontend-typescript-v2"});
  return { id, userId: ownerId, resumeId: 1, resumeRevision: 1, resumeSpecialization: programId === "backend-python" ? "Backend / Python" : "Frontend / TypeScript",
    programId, grade, programVersion: programId === "backend-python" ? "signal-backend-python-v6" : "signal-frontend-typescript-v2",
    purpose: "signal_qualification", purposeOrigin: "candidate_confirmed", gradeConfirmedAt: new Date("2026-10-02T10:00:00Z"),
    status: "submitted", ...form, answers: form.cases.map(row => ({ caseId: row.id, answer: form.oracles[row.id]!.answer })),
    score: 100, verified: true, gradeChanged: true, startedAt: new Date("2026-10-02T10:00:00Z"), dueAt: new Date("2026-10-02T10:45:00Z"), submittedAt: new Date(date) };
}

test("account SQL source is one observation across five copies, with original date and criterion", () => {
  const source = proof(); const before = structuredClone(source);
  const catalog = buildCandidateEvidenceCatalog(ownerId, [1, 2, 3, 4, 5].map(id => resume(id)), [source], []);
  assert.equal(catalog.matrixVersion, EVIDENCE_COMPATIBILITY_VERSION);
  const sql = catalog.evidence.filter(row => row.canonicalSkillId === "sql");
  assert.equal(sql.length, 1); assert.equal(sql[0]!.attemptId, source.id);
  assert.equal(sql[0]!.date, date); assert.equal(sql[0]!.programVersion, "signal-backend-python-v6");
  assert.match(sql[0]!.criterion, /SQL/); assert.equal(sql[0]!.applications.length, 5);
  assert.ok(sql[0]!.applications.every(row => row.applied && row.selected && row.compatibilityRuleId));
  assert.equal(catalog.evidence.length, 8, "Two Python criterion sources are distinct; CV copies are not new sources.");
  assert.deepEqual(source, before); assert.ok(catalog.resumes.every(row => row.verifiedGrade === "Middle"));
});

test("Backend SQL is retained and honestly limited in Frontend; independent Frontend grade does not replace Backend", () => {
  const resumes = [resume(1), resume(2), resume(3, "Frontend / TypeScript")];
  const backend = proof(); const frontend = proof(902, "frontend-typescript", "Junior");
  const onlyBackend = buildCandidateEvidenceCatalog(ownerId, resumes, [backend], []);
  assert.equal(onlyBackend.resumes[2]!.verifiedGrade, null);
  const limited = onlyBackend.evidence.find(row => row.canonicalSkillId === "sql")!.applications.find(row => row.resumeId === 3)!;
  assert.equal(limited.applied, false); assert.equal(limited.selected, false);
  assert.equal(limited.reasonCode, "different_program"); assert.equal(limited.compatibilityRuleId, null); assert.ok(limited.nextStep);
  const both = buildCandidateEvidenceCatalog(ownerId, resumes, [backend, frontend], []);
  assert.deepEqual(both.resumes.map(row => row.verifiedGrade), ["Middle", "Middle", "Junior"]);
  assert.deepEqual(both.evidence.filter(row => row.attemptId === backend.id), onlyBackend.evidence);
  assert.ok(!getResumeQualification(resumes[2]!, [backend, frontend]).verifiedSkills.includes("SQL"));
});

test("one correction invalidates every application while preserving source and unrelated Frontend proof", () => {
  const source = proof(); const other = proof(902, "frontend-typescript", "Junior");
  const catalog = buildCandidateEvidenceCatalog(ownerId, [resume(1), resume(2), resume(3, "Frontend / TypeScript")], [source, other],
    [{ attemptId: source.id, reason: "Содержательная ошибка исходного условия", createdAt: new Date("2026-10-04T11:00:00Z") }]);
  assert.deepEqual(catalog.resumes.map(row => row.verifiedGrade), [null, null, "Junior"]);
  for (const row of catalog.evidence.filter(row => row.attemptId === source.id)) {
    assert.equal(row.status, "revoked"); assert.equal(row.date, date); assert.equal(row.result, 100);
    assert.equal(row.correction!.reason, "Содержательная ошибка исходного условия");
    assert.ok(row.applications.every(application => !application.applied && !application.selected && application.reasonCode === "revoked"));
  }
  assert.ok(catalog.evidence.filter(row => row.attemptId === other.id).every(row => row.status === "active"));
  assert.equal(source.verified, true); assert.equal(source.score, 100);
});

test("a completed partial criterion is visible without manufacturing a full grade", () => {
  const source = proof(); source.verified = false; source.score = 17;
  source.answers = source.answers.map((row, index) => ({ ...row, answer: index === 1 ? row.answer : "wrong" }));
  const catalog = buildCandidateEvidenceCatalog(ownerId, [resume(1)], [source], []);
  assert.equal(catalog.resumes[0]!.verifiedGrade, null); assert.equal(catalog.evidence.length, 1);
  assert.equal(catalog.evidence[0]!.canonicalSkillId, "sql"); assert.equal(catalog.evidence[0]!.status, "active");
  assert.equal(catalog.evidence[0]!.applications[0]!.selected, true);
});

test("a superseded source remains in the account ledger with an explicit current-selection reason", () => {
  const old = proof(); const newer = proof(903);
  newer.submittedAt = new Date("2026-10-03T10:20:00Z");
  const catalog = buildCandidateEvidenceCatalog(ownerId, [resume(1)], [old, newer], []);
  assert.equal(catalog.evidence.filter(row => row.canonicalSkillId === "sql").length, 2);
  const oldSql = catalog.evidence.find(row => row.attemptId === old.id && row.canonicalSkillId === "sql")!;
  assert.equal(oldSql.status, "active"); assert.equal(oldSql.applications[0]!.applied, true);
  assert.equal(oldSql.applications[0]!.selected, false); assert.equal(oldSql.applications[0]!.reasonCode, "superseded");
  assert.equal(oldSql.date, date); assert.equal(newer.submittedAt.toISOString(), "2026-10-03T10:20:00.000Z");
});

test("foreign account sources and CVs, oracle data, answers and internal digest never enter the owner DTO", () => {
  const own = proof(); const foreign = proof(902); foreign.userId = 88;
  const foreignResume = { ...resume(99), userId: 88, title: "FOREIGN_PRIVATE_CV" };
  const catalog = buildCandidateEvidenceCatalog(ownerId, [resume(1), foreignResume], [own, foreign], []);
  assert.deepEqual(catalog.resumes.map(row => row.id), [1]);
  assert.ok(catalog.evidence.every(row => row.attemptId === own.id));
  const serialized = JSON.stringify(catalog);
  for (const forbidden of ["FOREIGN_PRIVATE_CV", '"answers"', '"oracles"', '"cases"', '"passwordHash"', '"poolContentDigest"', '"operator"']) assert.ok(!serialized.includes(forbidden));
});

test("soft-delete and specialization changes preserve source without resurrecting its original CV", () => {
  const source = proof(); const original = resume(1); original.deletedAt = new Date("2026-10-03T10:00:00Z");
  const catalog = buildCandidateEvidenceCatalog(ownerId, [original, resume(2, "Frontend / TypeScript")], [source], []);
  assert.deepEqual(catalog.resumes.map(row => row.id), [2]); assert.equal(catalog.evidence.length, 8);
  assert.ok(catalog.evidence.every(row => row.originalResumeId === 1 && row.applications.length === 1 && !row.applications[0]!.applied));
  const empty = buildCandidateEvidenceCatalog(ownerId, [original], [source], []);
  assert.deepEqual(empty.resumes, []); assert.ok(empty.evidence.every(row => row.applications.length === 0));
});

test("versioned matrix rejects textual/family/level/version substitutions and contains no invented cross-program rules", () => {
  const source = { programId: "backend-python", programVersion: "signal-backend-python-v6", criterionId: "sql-data", grade: "Middle" as const };
  assert.equal(resolveCriterionCompatibility(source, "Backend / Python").applied, true);
  assert.equal(resolveCriterionCompatibility(source, "Frontend / TypeScript").applied, false);
  assert.equal(resolveCriterionCompatibility({ ...source, criterionId: "postgresql" }, "Backend / Python").applied, false);
  assert.equal(resolveCriterionCompatibility({ ...source, programVersion: "signal-backend-python-v999" }, "Backend / Python").applied, false);
  assert.equal(resolveCriterionCompatibility(source, "Backend/Python").applied, false, "Free-text lookalikes do not select a qualification program.");
  assert.ok(EVIDENCE_COMPATIBILITY_RULES.every(rule => rule.sourceProgramId === rule.targetProgramId && rule.gradeEffect === "none"));
  const forged = proof(); forged.grade = "Senior";
  assert.equal(getResumeQualification(resume(1), [forged]).verifiedGrade, null);
  const company = proof(); company.purpose = "company_task" as typeof company.purpose;
  assert.deepEqual(buildCandidateEvidenceCatalog(ownerId, [resume(1)], [company], []).evidence, []);
});

test("known historical versions retain their own rubric/source and unknown summaries receive no invented criterion", () => {
  const source = proof(); const form = assembleAttempt("Middle", "historical-evidence-original");
  Object.assign(source, form, { programVersion: "kalibr-backend-python-v4", answers: form.cases.map(row => ({ caseId: row.id, answer: form.oracles[row.id]!.answer })) });
  const catalog = buildCandidateEvidenceCatalog(ownerId, [resume(1), resume(2)], [source], []);
  assert.equal(catalog.resumes[0]!.verifiedGrade, "Middle"); assert.ok(catalog.evidence.every(row => row.programVersion === "kalibr-backend-python-v4"));
  const old = resume(1); old.legacyQualification = { specialization: old.specialization, grade: "Senior", score: 92, skills: ["SQL"], assessedAt: "2026-08-01T09:00:00Z", gradeChangedAt: null, attemptId: null, limitation: "Версия и критерии отсутствуют." };
  const deletedCopy = { ...resume(2), deletedAt: new Date(), legacyQualification: old.legacyQualification };
  const legacy = buildCandidateEvidenceCatalog(ownerId, [old, deletedCopy], [], []);
  assert.deepEqual(legacy.evidence, []); assert.equal(legacy.historicalQualifications.length, 1);
  assert.equal(legacy.historicalQualifications[0]!.programVersion, null);
  assert.equal(legacy.historicalQualifications[0]!.date, "2026-08-01T09:00:00Z");
  assert.equal(legacy.resumes[0]!.verifiedGrade, "Senior");
});

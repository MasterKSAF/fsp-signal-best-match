import assert from "node:assert/strict";
import test from "node:test";
import { assembleManagedAttempt } from "../artifacts/api-server/src/lib/assessment-managed.ts";
import { getResumeQualification, type ResumeQualificationAttempt, type ResumeQualificationTarget } from "../artifacts/api-server/src/lib/signal-resume-qualification.ts";
import { validateAvatarDataUrl } from "../artifacts/api-server/src/lib/signal-avatar.ts";
import { CreateResumeSchema, ResumeMetadataSchema } from "../artifacts/api-server/src/lib/signal-resume-contract.ts";

const target = (specialization = "Backend / Python"): ResumeQualificationTarget => ({ userId: 17, specialization, legacyQualification: null });
function attempt(id: number, programId: "backend-python" | "frontend-typescript", grade: "Junior" | "Middle" | "Senior", pass = true): ResumeQualificationAttempt {
  const form = assembleManagedAttempt(programId, grade, `resume-proof-${id}`, {programVersion:programId === "backend-python" ? "signal-backend-python-v6" : "signal-frontend-typescript-v2"});
  return { id, userId: 17, resumeId: 99, resumeRevision: 1,
    purpose: "signal_qualification", purposeOrigin: "candidate_confirmed", gradeConfirmedAt: new Date("2026-10-01T09:00:00Z"),
    resumeSpecialization: programId === "backend-python" ? "Backend / Python" : "Frontend / TypeScript",
    programVersion: programId === "backend-python" ? "signal-backend-python-v6" : "signal-frontend-typescript-v2",
    programId, grade, status: "submitted", ...form,
    answers: form.cases.map(item => ({ caseId: item.id, answer: pass ? form.oracles[item.id]!.answer : "wrong" })),
    score: pass ? 100 : 0, verified: pass, gradeChanged: pass,
    startedAt: new Date("2026-10-01T09:00:00Z"), dueAt: new Date("2026-10-01T09:35:00Z"), submittedAt: new Date("2026-10-01T09:20:00Z"),
  };
}
test("one original program applies to two resumes without changing proof dates, count or score", () => {
  const original = attempt(1, "backend-python", "Middle");
  const before = structuredClone(original);
  const first = getResumeQualification(target(), [original]);
  const second = getResumeQualification(target(), [original]);
  assert.deepEqual(first, second); assert.deepEqual(original, before);
  assert.equal(first.verifiedGrade, "Middle"); assert.equal(first.verifiedScore, 100);
  assert.equal(first.latestAssessmentAt?.toISOString(), "2026-10-01T09:20:00.000Z");
  assert.equal(first.evidence.length, 7); assert.equal(first.evidence.filter(e => e.canonicalSkillId === "python").length, 1);
  assert.ok(first.evidence.every(e => e.attemptId === 1 && e.date === original.submittedAt!.toISOString()));
});
test("Backend Middle and Frontend Junior remain separate; skills and equal labels do not transfer grade", () => {
  const inputs = [attempt(1, "backend-python", "Middle"), attempt(2, "frontend-typescript", "Junior")];
  assert.equal(getResumeQualification(target(), inputs).verifiedGrade, "Middle");
  const frontend = getResumeQualification(target("Frontend / TypeScript"), inputs);
  assert.equal(frontend.verifiedGrade, "Junior"); assert.ok(!frontend.verifiedSkills.includes("SQL"));
  assert.equal(frontend.applicability.find(item => item.attemptId === 1)?.applied, false);
  assert.equal(getResumeQualification(target("Frontend / TypeScript"), [inputs[0]!]).verifiedGrade, null);
});
test("partial criteria carry evidence but never manufacture Junior or combine into a grade", () => {
  const a = attempt(1, "backend-python", "Middle", false);
  const b = attempt(2, "backend-python", "Middle", false);
  for (let index = 0; index < 6; index++) {
    const saved = index < 3 ? a : b;
    saved.answers[index]!.answer = (saved.oracles as Record<string, { answer: string }>)[saved.cases[index]!.id]!.answer;
  }
  const qualification = getResumeQualification(target(), [a, b]);
  assert.equal(qualification.verifiedGrade, null); assert.equal(qualification.verifiedScore, null);
  assert.ok(qualification.evidence.length > 0); assert.ok(!qualification.evidence.some(e => e.practicalPassed));
});
test("revocation removes shared evidence and grade everywhere without touching attempts", () => {
  const original = attempt(1, "backend-python", "Middle");
  const revoked = new Set([1]);
  for (const resume of [target(), target()]) {
    const qualification = getResumeQualification(resume, [original], revoked);
    assert.equal(qualification.verifiedGrade, null); assert.deepEqual(qualification.evidence, []);
  }
  assert.equal(original.verified, true); assert.equal(original.score, 100);
});
test("unknown historical origin stays limited and receives no invented per-skill proof or new date", () => {
  const resume = target();
  resume.legacyQualification = { specialization: resume.specialization, grade: "Senior", score: 92, skills: ["SQL", "API-контракты"], assessedAt: "2026-09-01T10:00:00Z", gradeChangedAt: null, attemptId: null, limitation: "Версия и критерии не сохранялись." };
  const historical = getResumeQualification(resume, []);
  assert.equal(historical.verifiedGrade, "Senior"); assert.equal(historical.programVersion, null);
  assert.equal(historical.latestAssessmentAt?.toISOString(), "2026-09-01T10:00:00.000Z");
  assert.deepEqual(historical.evidence, []); assert.equal(historical.source, "legacy");
  assert.equal(getResumeQualification({ ...resume, specialization: "Frontend / TypeScript" }, []).verifiedGrade, null);
});
test("a linked revoked historical summary cannot resurrect an annulled grade", () => {
  const resume = target();
  resume.legacyQualification = { specialization: resume.specialization, grade: "Middle", score: 100, skills: ["SQL"], assessedAt: "2026-10-01T09:20:00Z", gradeChangedAt: null, attemptId: 1, limitation: "old" };
  assert.equal(getResumeQualification(resume, [attempt(1, "backend-python", "Middle")], new Set([1])).verifiedGrade, null);
});
test("context version mismatch and forged skill metadata cannot create compatible proof", () => {
  const stale = attempt(1, "backend-python", "Middle"); stale.programVersion = "signal-backend-python-v999";
  assert.equal(getResumeQualification(target(), [stale]).verifiedGrade, null);
  const forged = attempt(2, "frontend-typescript", "Junior");
  for (const oracle of Object.values(forged.oracles) as { blueprint: { verifiedSkills: string[] } }[]) oracle.blueprint.verifiedSkills = ["SQL", "PostgreSQL"];
  assert.deepEqual(getResumeQualification(target("Frontend / TypeScript"), [forged]).evidence, []);
});
test("resume metadata rejects forged ownership, grade and primary shortcuts", () => {
  assert.ok(CreateResumeSchema.safeParse({ title: "Backend", specialization: "Backend / Python" }).success);
  for (const body of [{ userId: 18 }, { verifiedGrade: "Senior" }, { isPrimary: true }]) {
    assert.equal(ResumeMetadataSchema.safeParse({ title: "x", ...body }).success, false);
  }
});
test("avatar accepts a real tiny raster and rejects active data, mismatched signatures and oversize", () => {
  const png = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZsAAAAASUVORK5CYII=";
  assert.equal(validateAvatarDataUrl(png)?.contentType, "image/png");
  assert.equal(validateAvatarDataUrl(png.replace("image/png", "image/jpeg")), null);
  assert.equal(validateAvatarDataUrl("data:image/svg+xml;base64," + Buffer.from("<svg onload=alert(1)/>").toString("base64")), null);
  assert.equal(validateAvatarDataUrl("data:image/png;base64," + Buffer.alloc(2 * 1024 * 1024 + 1).toString("base64")), null);
});

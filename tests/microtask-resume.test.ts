import test from "node:test";
import assert from "node:assert/strict";
import { captureMicroResume, microBindingAccessible, microResumeEligible, microTemplateInput,
  type MicroLiveResume } from "../artifacts/api-server/src/lib/microtask-resume-policy";
import { canScheduleOffer, nextOfferDate, DAY } from "../artifacts/api-server/src/lib/opportunity-rules";

const ordinary = { demoMode: false, reviewScopeId: null };
const scopeOne = { demoMode: true, reviewScopeId: "11111111-1111-4111-8111-111111111111" };
const scopeTwo = { demoMode: true, reviewScopeId: "22222222-2222-4222-8222-222222222222" };
const base: MicroLiveResume = { id: 42, userId: 7, revision: 3, title: "Python: второе резюме",
  specialization: "Backend / Python", verifiedGrade: "Middle", verifiedSkills: ["Python", "SQL"],
  visibility: "pseudonymous", consentMatching: true, deletedAt: null };
const template = { title: "Разбор транзакции", competency: "SQL", specialization: "Backend / Python",
  scenario: "Опишите учебный подход к транзакции и обработке сбоя, без выполнения производственной работы.",
  expectedMinutes: 20, intervalDays: 7, deadlineDays: 3, educationalOnly: true,
  rubric: [{ id: "reasoning", label: "Понятный подход", maxPoints: 5 }] };

test("Company template requires a supported category while free competency remains free", () => {
  assert.equal(microTemplateInput.safeParse(template).success, true);
  for (const patch of [{ specialization: undefined }, { specialization: "Backend" }, { specialization: "Own grade" },
    { qualificationEffect: "Signal" }, { expectedMinutes: 90 }, { educationalOnly: false }]) {
    assert.equal(microTemplateInput.safeParse({ ...template, ...patch }).success, false);
  }
  assert.equal(microTemplateInput.safeParse({ ...template, competency: "Авторская предметная практика" }).success, true);
});

test("A visible qualified secondary resume needs no primary projection", () => {
  // The primary is private and unqualified; it is deliberately not an input.
  const privatePrimary = { ...base, id: 41, visibility: "private", verifiedGrade: null };
  assert.equal(microResumeEligible(privatePrimary, 7, template.specialization, ordinary, ordinary), false);
  assert.equal(microResumeEligible(base, 7, template.specialization, ordinary, ordinary), true);
});

test("Foreign ownership, wrong category, consent, deletion and grade gates stay independent", () => {
  assert.equal(microResumeEligible(base, 8, template.specialization, ordinary, ordinary), false);
  for (const patch of [{ specialization: "Frontend / TypeScript" }, { verifiedGrade: null },
    { visibility: "private" }, { consentMatching: false }, { deletedAt: new Date() }]) {
    assert.equal(microResumeEligible({ ...base, ...patch }, 7, template.specialization, ordinary, ordinary), false);
  }
  assert.equal(microResumeEligible(base, 7, null, ordinary, ordinary), false);
});

test("Ordinary, overview and reviewer pairs never become each other's practice pool", () => {
  assert.equal(microResumeEligible(base, 7, template.specialization, scopeOne, scopeOne), true);
  for (const target of [ordinary, scopeTwo, { demoMode: true, reviewScopeId: null }])
    assert.equal(microResumeEligible(base, 7, template.specialization, scopeOne, target), false);
});

test("Capture is immutable professional context without contacts or fabricated regrading", () => {
  const source = { ...base, verifiedSkills: [...base.verifiedSkills] };
  const captured = captureMicroResume(source, "Псевдоним");
  source.verifiedSkills.push("Kubernetes");
  source.title = "Новое название";
  assert.deepEqual(captured.resumeContext?.verifiedSkills, ["Python", "SQL"]);
  assert.equal(captured.resumeContext?.title, base.title);
  assert.equal(captured.resumeContext?.verifiedGrade, "Middle");
  assert.deepEqual(Object.keys(captured.resumeContext!).sort(), ["professionalAlias", "resumeId", "revision", "specialization", "title", "verifiedGrade", "verifiedSkills"].sort());
  assert.throws(() => captureMicroResume({ ...base, verifiedGrade: null }, "Псевдоним"));
});

test("Primary switch or a harmless newer revision cannot retarget an offer", () => {
  const captured = captureMicroResume(base, "Псевдоним");
  assert.equal(microBindingAccessible(captured, { ...base, revision: 8, title: "После редактирования" }, 7, ordinary, ordinary), true);
  assert.equal(captured.resumeRevision, 3);
  assert.equal(microBindingAccessible(captured, { ...base, id: 99 }, 7, ordinary, ordinary), false);
  assert.equal(microBindingAccessible(captured, { ...base, specialization: "Frontend / TypeScript" }, 7, ordinary, ordinary), false);
});

test("Captured origin is required and cannot be reconstructed from a current primary", () => {
  const legacy = { resumeId: null, resumeRevision: null, resumeContext: null, resumeProvenance: "legacy_unbound" as const };
  assert.equal(microBindingAccessible(legacy, base, 7, ordinary, ordinary), false);
  const captured = captureMicroResume(base, "Псевдоним");
  assert.equal(microBindingAccessible({ ...captured, resumeRevision: 4 }, base, 7, ordinary, ordinary), false);
  assert.equal(microBindingAccessible({ ...captured, resumeContext: null }, base, 7, ordinary, ordinary), false);
});

test("Five resumes do not reset the person-wide weekly or open-offer clock", () => {
  const now = new Date("2026-10-07T12:00:00Z");
  for (let index = 0; index < 5; index++) {
    const selected = captureMicroResume({ ...base, id: 42 + index }, "Псевдоним");
    assert.equal(selected.resumeId, 42 + index);
    const common = { enabled: true, active: true, templateActive: true, nextDueAt: now, now,
      lastAnyOfferAt: new Date(now.getTime() - 6 * DAY), hasOpenOffer: false };
    assert.equal(canScheduleOffer(common), false);
    assert.equal(canScheduleOffer({ ...common, lastAnyOfferAt: new Date(now.getTime() - 7 * DAY), hasOpenOffer: true }), false);
    assert.equal(canScheduleOffer({ ...common, lastAnyOfferAt: new Date(now.getTime() - 7 * DAY) }), true);
  }
  assert.equal(nextOfferDate(now, 1).getTime(), now.getTime() + 7 * DAY);
});

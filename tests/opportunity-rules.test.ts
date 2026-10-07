import assert from "node:assert/strict";
import test from "node:test";
import {
  canScheduleOffer,
  DAY,
  jobInput,
  jobTransitionAllowed,
  microInput,
  nextOfferDate,
} from "../artifacts/api-server/src/lib/opportunity-rules";
test("Job publication requires positive salary, explicit known state transitions and no accidental need reference", () => {
  const input = {
    title: "Backend engineer",
    description: "Учебная компания ищет разработчика API.",
    specialization: "Backend / Python",
    grade: "Middle",
    skills: ["Python"],
    workFormat: "Удалённо",
    salaryMin: 100000,
    salaryMax: 200000,
    salaryPeriod: "month",
    salaryType: "gross",
  };
  assert.equal(jobInput.safeParse(input).success, true);
  assert.equal(jobInput.safeParse({ ...input, salaryMin: 0 }).success, false);
  assert.equal(
    jobInput.safeParse({ ...input, salaryMin: 200001 }).success,
    false,
  );
  assert.equal(
    jobInput.safeParse({ ...input, needId: 123, status: "published" }).success,
    false,
  );
  assert.equal(jobTransitionAllowed("draft", "published"), true);
  assert.equal(jobTransitionAllowed("published", "archived"), false);
  assert.equal(jobTransitionAllowed("archived", "published"), false);
  assert.equal(jobTransitionAllowed("closed", "published"), true);
});
test("Recurring microtasks respect global weekly frequency, open offers, opt-out and persisted due dates", () => {
  const now = new Date("2026-10-05T12:00:00Z");
  const base = {
    enabled: true,
    active: true,
    templateActive: true,
    nextDueAt: now,
    lastAnyOfferAt: null,
    hasOpenOffer: false,
    now,
  };
  assert.equal(canScheduleOffer(base), true);
  for (const patch of [
    { enabled: false },
    { active: false },
    { templateActive: false },
    { hasOpenOffer: true },
    { nextDueAt: new Date(now.getTime() + 1) },
    { lastAnyOfferAt: new Date(now.getTime() - 7 * DAY + 1) },
  ])
    assert.equal(canScheduleOffer({ ...base, ...patch }), false);
  assert.equal(
    canScheduleOffer({
      ...base,
      lastAnyOfferAt: new Date(now.getTime() - 7 * DAY),
    }),
    true,
  );
  assert.equal(nextOfferDate(now, 7).toISOString(), "2026-10-12T12:00:00.000Z");
  assert.equal(nextOfferDate(now, 1).toISOString(), "2026-10-12T12:00:00.000Z");
});
test("Microtasks require educational purpose, bounded duration and distinct rubric criteria", () => {
  const input = {
    title: "Учебная задача",
    competency: "Повторы",
    scenario:
      "Предложите правило обработки повторного запроса в вымышленной учебной библиотеке.",
    expectedMinutes: 20,
    intervalDays: 7,
    deadlineDays: 3,
    educationalOnly: true,
    rubric: [{ id: "criterion", label: "Корректное объяснение", maxPoints: 3 }],
  };
  assert.equal(microInput.safeParse(input).success, true);
  for (const patch of [
    { educationalOnly: false },
    { expectedMinutes: 46 },
    { intervalDays: 6 },
    { deadlineDays: 0 },
    { rubric: [...input.rubric, ...input.rubric] },
  ])
    assert.equal(microInput.safeParse({ ...input, ...patch }).success, false);
});

import assert from "node:assert/strict";
import test from "node:test";
import {
  KALIBR_BANK_VERSION,
  assessmentBankVersion,
  assembleAttempt,
  isCurrentKalibrAttempt,
  requiredScore,
  scoreAttempt,
  type AssessmentGrade,
  type AttemptOracle,
} from "../artifacts/api-server/src/lib/assessment-bank.ts";

const grades: AssessmentGrade[] = ["Junior", "Middle", "Senior"];
const expectedFamilies = [
  "API-контракты",
  "SQL и данные",
  "Диагностика инцидента",
  "Идемпотентность",
  "Выбор архитектуры",
  "Изменение условия",
];

function correctAnswers(attempt: ReturnType<typeof assembleAttempt>) {
  return attempt.cases.map((item) => ({
    caseId: item.id,
    answer: attempt.oracles[item.id]!.answer,
  }));
}

function wrongAnswer(
  item: ReturnType<typeof assembleAttempt>["cases"][number],
  oracle: AttemptOracle[string],
): string {
  if (item.responseType === "choice") {
    return item.options.find((option) => option !== oracle.answer) ?? "неверный вариант";
  }
  return `${oracle.answer}x`;
}

function isVerified(score: number, criticalComplete: boolean, grade: AssessmentGrade): boolean {
  return score >= requiredScore(grade) && criticalComplete;
}

test("КАЛИБР генерирует 100 воспроизводимых безопасных форм каждого грейда", () => {
  const apiAnswers = new Set<string>();
  for (const grade of grades) {
    for (let index = 0; index < 100; index += 1) {
      const seed = `property-${grade}-${index}`;
      const attempt = assembleAttempt(grade, seed);
      const replay = assembleAttempt(grade, seed);

      assert.deepEqual(attempt, replay, `форма ${grade}/${seed} должна быть воспроизводимой`);
      assert.equal(attempt.cases.length, 6);
      assert.deepEqual(attempt.cases.map((item) => item.family), expectedFamilies);
      assert.equal(new Set(attempt.cases.map((item) => item.id)).size, 6);
      assert.equal(isCurrentKalibrAttempt(attempt.cases, attempt.oracles), true);
      assert.equal(assessmentBankVersion(attempt.cases, attempt.oracles), KALIBR_BANK_VERSION);
      assert.deepEqual(
        attempt.cases.map((item) => item.responseType),
        ["text", "text", "choice", "text", "choice", "text"],
      );
      assert.match(attempt.cases[0]!.prompt, /```python/);
      assert.match(attempt.cases[1]!.prompt, /```sql/);
      assert.match(attempt.cases[3]!.prompt, /```python/);
      assert.match(attempt.cases[5]!.prompt, /```python/);
      assert.doesNotMatch(JSON.stringify(attempt.cases), /"blueprint"|"rubric"/);
      for (const item of attempt.cases) {
        assert.equal(Object.hasOwn(item, "answer"), false);
      }

      const fullResult = scoreAttempt(attempt.cases, attempt.oracles, correctAnswers(attempt));
      assert.equal(fullResult.score, 100);
      assert.equal(fullResult.criticalComplete, true);
      apiAnswers.add(attempt.oracles[attempt.cases[0]!.id]!.answer);

      for (const criticalCase of attempt.cases.filter(
        (item) => attempt.oracles[item.id]!.blueprint.critical,
      )) {
        const answers = correctAnswers(attempt).map((answer) =>
          answer.caseId === criticalCase.id
            ? {
                caseId: answer.caseId,
                answer: wrongAnswer(criticalCase, attempt.oracles[criticalCase.id]!),
              }
            : answer,
        );
        const result = scoreAttempt(attempt.cases, attempt.oracles, answers);
        assert.equal(result.criticalComplete, false, `${grade}/${criticalCase.family}`);
      }
    }
  }
  // A copied concrete API response almost never fits a new generated trace.
  assert.ok(apiAnswers.size > 120, "параметры должны менять точный structured-ответ");
});

test("старый обход вторым вариантом, самым длинным или коротким текстом не подтверждает грейд", () => {
  for (const grade of grades) {
    for (let index = 0; index < 100; index += 1) {
      const attempt = assembleAttempt(grade, `exploit-${grade}-${index}`);
      const choicesAtSecondIndex = attempt.cases.map((item) => ({
        caseId: item.id,
        answer: item.responseType === "choice" ? (item.options[1] ?? "результат") : "результат",
      }));
      const longest = attempt.cases.map((item) => ({
        caseId: item.id,
        answer:
          item.responseType === "choice"
            ? [...item.options].sort((left, right) => right.length - left.length)[0]!
            : "1",
      }));
      const shortest = attempt.cases.map((item) => ({
        caseId: item.id,
        answer:
          item.responseType === "choice"
            ? [...item.options].sort((left, right) => left.length - right.length)[0]!
            : "1",
      }));

      for (const [name, answers] of [
        ["second-option", choicesAtSecondIndex],
        ["longest", longest],
        ["shortest", shortest],
      ] as const) {
        const result = scoreAttempt(attempt.cases, attempt.oracles, answers);
        assert.equal(result.criticalComplete, false, `${grade}/${index}/${name}`);
        assert.equal(isVerified(result.score, result.criticalComplete, grade), false);
        assert.ok(result.score < requiredScore(grade), `${grade}/${index}/${name}`);
      }
    }
  }
});

test("structured trace даёт частичный зачёт только за правильные компоненты в правильном порядке", () => {
  const attempt = assembleAttempt("Senior", "partial-components");
  const apiCase = attempt.cases[0]!;
  const expected = attempt.oracles[apiCase.id]!.answer.split("|");
  const answerWithOneWrongComponent = [...expected.slice(0, -1), "200:0"].join("|");
  const result = scoreAttempt(attempt.cases, attempt.oracles, [
    { caseId: apiCase.id, answer: answerWithOneWrongComponent },
  ]);
  const apiEvidence = result.evidence.find((item) => item.skill === "API-контракты");
  assert.equal(apiEvidence?.score, 75);
  assert.match(apiEvidence?.criterion ?? "", /часть структурированного/);
  assert.equal(result.criticalComplete, false);
  assert.equal(isVerified(result.score, result.criticalComplete, "Senior"), false);
});

test("готовый ответ из другой формы не переносится даже для двух MCQ", () => {
  for (const grade of grades) {
    for (let index = 0; index < 100; index += 1) {
      const source = assembleAttempt(grade, `transfer-source-${grade}-${index}`);
      const target = assembleAttempt(grade, `transfer-target-${grade}-${index}`);
      const sourceByFamily = new Map(
        source.cases.map((item) => [item.family, source.oracles[item.id]!.answer]),
      );
      const targetChoices = target.cases.filter((item) => item.responseType === "choice");
      for (const item of targetChoices) {
        assert.notEqual(sourceByFamily.get(item.family), target.oracles[item.id]!.answer);
      }
      const copiedAnswers = target.cases.map((item) => ({
        caseId: item.id,
        answer: sourceByFamily.get(item.family) ?? "",
      }));
      const result = scoreAttempt(target.cases, target.oracles, copiedAnswers);
      assert.equal(result.criticalComplete, false);
      assert.equal(isVerified(result.score, result.criticalComplete, grade), false);
    }
  }
});

test("лишние или отсутствующие компоненты trace не принимаются как полный ответ", () => {
  const attempt = assembleAttempt("Senior", "strict-components-regression");
  for (const item of attempt.cases.filter(
    (entry) => attempt.oracles[entry.id]!.blueprint.partialCredit === "ordered_components",
  )) {
    const expected = attempt.oracles[item.id]!.answer;
    for (const malformed of [`${expected}|extra`, `${expected}|`, expected.split("|").slice(0, -1).join("|")]) {
      const answers = correctAnswers(attempt).map((answer) =>
        answer.caseId === item.id ? { ...answer, answer: malformed } : answer,
      );
      const result = scoreAttempt(attempt.cases, attempt.oracles, answers);
      assert.equal(result.evidence.find((evidence) => evidence.skill === item.family)?.score, 0);
      if (attempt.oracles[item.id]!.blueprint.critical) assert.equal(result.criticalComplete, false);
    }
  }
});

test("публичный идентификатор варианта не раскрывает начальное состояние PRNG", () => {
  const seed = "public-id-state-regression";
  let formerPublicState = 2166136261;
  for (let index = 0; index < seed.length; index += 1) {
    formerPublicState ^= seed.charCodeAt(index);
    formerPublicState = Math.imul(formerPublicState, 16777619);
  }
  const oldKey = (formerPublicState >>> 0).toString(36);
  const attempt = assembleAttempt("Senior", seed);
  const publicKey = attempt.cases[0]!.id.split(":").at(-1)!;
  assert.notEqual(publicKey, oldKey);
  assert.ok(Number.parseInt(publicKey, 36) > 0xffffffff, "ID нельзя читать как 32-битное состояние");
});

test("устаревший oracle без blueprint не считается действующей попыткой", () => {
  const attempt = assembleAttempt("Middle", "legacy-shape");
  const legacyOracles = Object.fromEntries(
    Object.entries(attempt.oracles).map(([caseId, oracle]) => [caseId, { answer: oracle.answer }]),
  );
  assert.equal(isCurrentKalibrAttempt(attempt.cases, legacyOracles), false);
  assert.equal(assessmentBankVersion(attempt.cases, legacyOracles), "legacy");
});

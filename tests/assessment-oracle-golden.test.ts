import assert from "node:assert/strict";
import test from "node:test";

import {
  assembleAttempt,
  scoreAttempt,
  type AssessmentGrade,
} from "../artifacts/api-server/src/lib/assessment-bank";

type GoldenFixture = {
  grade: AssessmentGrade;
  seed: string;
  /**
   * These values were calculated outside assessment-bank before this test was
   * written. SQL totals use an independent SQLite query; Python traces are
   * evaluated from the snippets' state transitions, not copied from oracles.
   */
  answers: Record<string, string>;
};

const fixtures: GoldenFixture[] = [
  {
    grade: "Junior",
    seed: "golden-junior",
    answers: {
      "API-контракты": "201:184|200:184|409:184",
      "SQL и данные": "1152",
      "Диагностика инцидента":
        "Снять EXPLAIN ANALYZE INC-430 и сопоставить 184 ожидаемых с 968 фактическими строками для tenant_id=393.",
      Идемпотентность: "184|184|696",
      "Выбор архитектуры":
        "Записать изменение ord-5015 и outbox-событие evt-92929 в одной транзакции, затем доставлять outbox отдельно.",
      "Изменение условия": "200:184|409:184",
    },
  },
  {
    grade: "Middle",
    seed: "golden-middle",
    answers: {
      "API-контракты": "201:340|201:674|200:340|409:340",
      "SQL и данные": "1431",
      "Диагностика инцидента":
        "Снять граф pg_locks для INC-556 и связать 340 ожидающих блокировку с запросами tenant_id=529.",
      Идемпотентность: "A:340|D:340|A:1431|D:1431",
      "Выбор архитектуры":
        "Повторять outbox evt-75917 с тем же id, а consumer фиксирует дедуплицированный эффект ord-9105 до ack.",
      "Изменение условия": "201:674|409:340|200:340",
    },
  },
  {
    grade: "Senior",
    seed: "golden-senior",
    answers: {
      "API-контракты": "201:223|412:223|409:223|200:223",
      "SQL и данные": "827",
      "Диагностика инцидента":
        "Остановить canary INC-206 флагом и сохранить plan/lock trace для tenant_id=924 с p99=827.",
      Идемпотентность: "A:29:972|D:29:972|S:29:972|A:30:1799",
      "Выбор архитектуры":
        "Зафиксировать состояние саги ord-3607 и outbox, затем идемпотентно завершить или компенсировать резерв с наблюдаемым статусом.",
      "Изменение условия": "412:223|409:223|200:223",
    },
  },
];

for (const fixture of fixtures) {
  test(`KALIBR ${fixture.grade}: fixed seed has externally calculated Python and SQL oracle answers`, () => {
    const { cases, oracles } = assembleAttempt(fixture.grade, fixture.seed);
    assert.equal(cases.length, 6);

    const answers = cases.map((item) => {
      const answer = fixture.answers[item.family];
      assert.ok(answer, `missing golden answer for ${item.family}`);
      assert.equal(oracles[item.id]?.answer, answer, `${item.family} oracle drifted`);
      return { caseId: item.id, answer };
    });

    const result = scoreAttempt(cases, oracles, answers);
    assert.equal(result.score, 100);
    assert.equal(result.criticalComplete, true);
    assert.deepEqual(
      result.evidence.map((item) => item.score),
      [100, 100, 100, 100, 100, 100],
    );
  });
}

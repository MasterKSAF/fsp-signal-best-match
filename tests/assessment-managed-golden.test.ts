import assert from "node:assert/strict";
import test from "node:test";
import { assembleManagedAttempt } from "../artifacts/api-server/src/lib/assessment-managed";
import { requiredScore, scoreAttempt, type AssessmentGrade } from "../artifacts/api-server/src/lib/assessment-bank";

/** Synthetic team-authored goldens, not participant answers or independent expert labels.
 * The seed independent-v1 gives visible fixture n=808. Numbers below were worked
 * out from the displayed algorithms/relations, separately from generator functions.
 * Runtime-heldout tests execute the displayed TypeScript with a second mechanism.
 */
const backend = {
  Junior: ["200:811|412:811|200:812", "2", "Сопоставить частоту исходящих запросов, лимит провайдера и Retry-After; ограничить повторные запросы.", "ok:809|old:809|ok:810", "Добавить необязательное поле с договорённым значением по умолчанию, проверить совместимость старых и новых клиентов.", "808|813|813"],
  Middle: ["200:811|200:811|412:811|200:812", "1622", "По trace связать повторы с исходным запросом, задать общий retry budget и deadline; ограничить усиление нагрузки.", "ok:810|old:810|old:810|ok:811", "Расширить схему, развернуть совместимые writers, выполнить проверяемый backfill и переключить readers; удалять старое последним.", "808|813|817"],
  Senior: ["422:810|200:811|412:811|200:812", "811", "Ввести admission control по приоритету и возрасту, ограничить ретраи; наблюдать drain rate и ошибки до расширения мощности.", "ok:809|gap:809|ok:810|ok:811", "После сверки данных, остановки старых writers и наблюдаемого cutover сохранить окно отката, затем убрать старый путь.", "813|817|817"],
};
const frontend = {
  Junior: [
    ["value:808|wait|wait", "813", "Сопоставить long task с обработчиком, уменьшить синхронную работу и измерить задержку повторно.", "first-808|last-808|open-808", "У общего владельца; передавать значение и событие изменения, производный список вычислять из него.", "new-808|new-808|late-808"],
    ["809|invalid|invalid", "812", "Запустить независимые запросы одновременно, сохранить обработку ошибки каждого и измерить waterfall.", "email:Ошибка|submit:Отправлено|submit:Отправлено", "Проверить поле на границе данных и использовать согласованное значение по умолчанию в модели интерфейса.", "808|810|810"],
  ],
  Middle: [
    ["value:808|wait|retry", "817", "Профилировать сам расчёт, вынести тяжёлую обработку из main thread и ограничить объём рендера.", "first-808|last-808|first-808|open-808", "Хранить сериализуемый фильтр в URL, серверные ответы в кеше по этому ключу, локальный черновик отдельно.", "new-808|new-808|new-808"],
    ["809|invalid|invalid", "2430", "После получения ID профиля запустить независимые детали параллельно с ограничением числа запросов.", "email:Ошибка|submit:Отправлено|submit:Отправлено", "Преобразовать и проверить оба DTO в единую модель на границе API; тестировать обе ветки контракта.", "810|810|810"],
  ],
  Senior: [
    ["value:808|wait|retry|stop", "819", "Разделить стоимость сериализации, передачи и commit, сократить данные и виртуализировать видимую часть; повторно измерить.", "first-808|last-808|first-808|heading-808", "Разделить серверный снимок и черновик, проверять ревизию при записи, показывать конфликт и явное решение пользователю.", "new-808|new-808|new-808"],
    ["809|invalid|version", "812", "Дедуплицировать запрос в границе аккаунта, сохранить ключи авторизации и параллелить только независимые ветки.", "email:Ошибка|heading:Отправлено|heading:Отправлено", "Версионировать формат кеша, явно мигрировать или инвалидировать старые записи и сохранить наблюдаемый обратимый переход.", "810|810|810"],
  ],
};

test("54 new template keys match manually worked synthetic cases; legacy 18 are covered by existing oracle goldens", () => {
  for (const grade of ["Junior", "Middle", "Senior"] as const) {
    const back = assembleManagedAttempt("backend-python", grade, "independent-v1", { forcedVariant: 1 });
    assert.deepEqual(back.cases.map(item => back.oracles[item.id]!.answer), backend[grade]);
    for (const variant of [0, 1] as const) {
      const form = assembleManagedAttempt("frontend-typescript", grade, "independent-v1", { forcedVariant: variant });
      assert.deepEqual(form.cases.map(item => form.oracles[item.id]!.answer), frontend[grade][variant]);
      const result = scoreAttempt(form.cases, form.oracles, form.cases.map((item, slot) => ({ caseId: item.id, answer: frontend[grade][variant][slot]! })));
      assert.equal(result.score, 100); assert.equal(result.criticalComplete, true);
    }
  }
});

test("held-out backend SQL and traces match separately worked fixtures, not the oracle used as expectation", () => {
  // The distinct seed has visible n=123. SQL: Junior B,D lack payment; Middle B+C=125+127; Senior B latest=126.
  const expected = {
    Junior: ["200:126|412:126|200:127", "2", "ok:124|old:124|ok:125", "123|128|128"],
    Middle: ["200:126|200:126|412:126|200:127", "252", "ok:125|old:125|old:125|ok:126", "123|128|132"],
    Senior: ["422:125|200:126|412:126|200:127", "126", "ok:124|gap:124|ok:125|ok:126", "128|132|132"],
  };
  for (const grade of ["Junior", "Middle", "Senior"] as const) {
    const form = assembleManagedAttempt("backend-python", grade, "independent-holdout-v1", { forcedVariant: 1 });
    assert.deepEqual([0, 1, 3, 5].map(slot => form.oracles[form.cases[slot]!.id]!.answer), expected[grade]);
  }
});

test("frozen category rubric distinguishes threshold, critical errors, positional partial credit and reordered answers", () => {
  for (const grade of ["Junior", "Middle", "Senior"] as AssessmentGrade[]) {
    const form = assembleManagedAttempt("frontend-typescript", grade, "independent-v1", { forcedVariant: 0 });
    const expected = frontend[grade][0];
    const make = (slots: number[]) => form.cases.map((item, slot) => ({ caseId: item.id, answer: slots.includes(slot) ? expected[slot]! : "" }));
    const four = scoreAttempt(form.cases, form.oracles, make([0, 1, 3, 5]));
    assert.deepEqual([four.score, four.criticalComplete], [67, grade !== "Senior"]);
    assert.equal(four.score >= requiredScore(grade), grade === "Junior");
    const five = scoreAttempt(form.cases, form.oracles, make([0, 1, 2, 3, 5]));
    assert.deepEqual([five.score, five.criticalComplete], [83, grade !== "Senior"]);
    const all = make([0, 1, 2, 3, 4, 5]);
    all[0]!.answer = `${expected[0]!.split("|").slice(0, -1).join("|")}|wrong`;
    const partial = scoreAttempt(form.cases, form.oracles, all);
    assert.equal(partial.evidence[0]!.score, grade === "Senior" ? 75 : 67);
    assert.equal(partial.criticalComplete, false, "A high total never compensates an incomplete critical criterion");
    all[0]!.answer = `${expected[0]}|extra`;
    assert.equal(scoreAttempt(form.cases, form.oracles, all).evidence[0]!.score, 0);
  }
});

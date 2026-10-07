import { createHash, randomBytes } from "node:crypto";
import type { SignalCase } from "@workspace/db";
import { getAssessmentContext, type AssessmentContextId } from "./assessment-context";

/** Server-only version marker for a complete KALIBR form. */
export const KALIBR_BANK_VERSION = "kalibr-backend-python-v4";

export type AssessmentGrade = "Junior" | "Middle" | "Senior";

export type FamilyId =
  | "api-contracts"
  | "sql-data"
  | "incident-diagnosis"
  | "idempotency"
  | "architecture"
  | "condition-change";

export type OracleBlueprint = {
  version: string;
  grade: AssessmentGrade;
  family: FamilyId | "typescript" | "frontend-state" | "frontend-performance" | "accessibility" | "frontend-architecture" | "async-ui";
  programId?: string;
  templateId?: string;
  templateVersion?: number;
  verifiedSkills?: string[];
  objective: string;
  responseType: "choice" | "integer" | "structured";
  partialCredit: "all_or_nothing" | "ordered_components";
  targetSeconds: number;
  critical: boolean;
};

/** Persisted in the server database only. It is never part of SignalCase. */
export type AttemptOracle = Record<
  string,
  {
    answer: string;
    blueprint: OracleBlueprint;
  }
>;

type Attempt = { cases: SignalCase[]; oracles: AttemptOracle };
type Random = () => number;

type Scenario = {
  tenantId: number;
  operationId: string;
  eventId: string;
  incidentId: string;
  orderId: string;
  amounts: [number, number, number, number];
  retrySeconds: number;
};

const familyLabels: Record<FamilyId, string> = {
  "api-contracts": "API-контракты",
  "sql-data": "SQL и данные",
  "incident-diagnosis": "Диагностика инцидента",
  idempotency: "Идемпотентность",
  architecture: "Выбор архитектуры",
  "condition-change": "Изменение условия",
};

const familyOrder: FamilyId[] = [
  "api-contracts",
  "sql-data",
  "incident-diagnosis",
  "idempotency",
  "architecture",
  "condition-change",
];

const familyResponseTypes: Record<FamilyId, OracleBlueprint["responseType"]> = {
  "api-contracts": "structured",
  "sql-data": "integer",
  "incident-diagnosis": "choice",
  idempotency: "structured",
  architecture: "choice",
  "condition-change": "structured",
};

function hashSeed(value: string): number {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededRandom(seed: string): Random {
  let state = hashSeed(seed);
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function integer(random: Random, min: number, max: number): number {
  return min + Math.floor(random() * (max - min + 1));
}

function shuffle<T>(values: T[], random: Random): T[] {
  const result = [...values];
  for (let index = result.length - 1; index > 0; index -= 1) {
    const swapIndex = Math.floor(random() * (index + 1));
    [result[index], result[swapIndex]] = [result[swapIndex]!, result[index]!];
  }
  return result;
}

function normalizeAnswer(value: string): string {
  return value
    .trim()
    .normalize("NFC")
    .replace(/\s+/g, " ")
    .toLocaleLowerCase("ru-RU");
}

function makeCaseId(
  grade: AssessmentGrade,
  family: FamilyId,
  variantKey: string,
): string {
  return `${KALIBR_BANK_VERSION}:${grade}:${family}:${variantKey}`;
}

function placeAnswer(
  answer: string,
  distractors: [string, string, string],
  position: number,
  random: Random,
): string[] {
  const options = shuffle(distractors, random);
  options.splice(position, 0, answer);
  return options;
}

function choiceCase(input: {
  id: string;
  grade: AssessmentGrade;
  family: FamilyId;
  title: string;
  prompt: string;
  answer: string;
  distractors: [string, string, string];
  answerPosition: number;
  objective: string;
  targetSeconds: number;
  critical?: boolean;
  random: Random;
}): { item: SignalCase; oracle: AttemptOracle[string] } {
  return {
    item: {
      id: input.id,
      family: familyLabels[input.family],
      title: input.title,
      prompt: input.prompt,
      responseType: "choice",
      options: placeAnswer(input.answer, input.distractors, input.answerPosition, input.random),
    },
    oracle: {
      answer: input.answer,
      blueprint: {
        version: KALIBR_BANK_VERSION,
        grade: input.grade,
        family: input.family,
        objective: input.objective,
        responseType: "choice",
        partialCredit: "all_or_nothing",
        targetSeconds: input.targetSeconds,
        critical: input.critical ?? false,
      },
    },
  };
}

function structuredCase(input: {
  id: string;
  grade: AssessmentGrade;
  family: FamilyId;
  title: string;
  prompt: string;
  answer: string;
  objective: string;
  targetSeconds: number;
  responseType: "integer" | "structured";
  critical?: boolean;
}): { item: SignalCase; oracle: AttemptOracle[string] } {
  return {
    item: {
      id: input.id,
      family: familyLabels[input.family],
      title: input.title,
      prompt: input.prompt,
      responseType: "text",
      options: [],
    },
    oracle: {
      answer: input.answer,
      blueprint: {
        version: KALIBR_BANK_VERSION,
        grade: input.grade,
        family: input.family,
        objective: input.objective,
        responseType: input.responseType,
        partialCredit:
          input.responseType === "structured" ? "ordered_components" : "all_or_nothing",
        targetSeconds: input.targetSeconds,
        critical: input.critical ?? false,
      },
    },
  };
}

function scenarioFor(random: Random): Scenario {
  const tenantId = integer(random, 210, 980);
  return {
    tenantId,
    operationId: `op-${integer(random, 3000, 9999)}`,
    eventId: `evt-${integer(random, 10000, 99999)}`,
    incidentId: `INC-${integer(random, 120, 990)}`,
    orderId: `ord-${integer(random, 1000, 9999)}`,
    amounts: [
      integer(random, 120, 390),
      integer(random, 400, 790),
      integer(random, 810, 1290),
      integer(random, 1300, 1900),
    ],
    retrySeconds: integer(random, 12, 48),
  };
}

function fenced(language: "python" | "sql", source: string): string {
  return `\n\n\`\`\`${language}\n${source}\n\`\`\``;
}

function apiTask(
  grade: AssessmentGrade,
  scenario: Scenario,
  id: string,
) {
  const [first, second, third, fourth] = scenario.amounts;
  if (grade === "Junior") {
    return structuredCase({
      id,
      grade,
      family: "api-contracts",
      title: "Трасса повторного POST",
      prompt: `Контракт POST /orders хранит Idempotency-Key и хеш тела. Проследите три вызова для ключа ${scenario.operationId}. Введите результаты строго в формате \`код:заказ|код:заказ|код:заказ\` без пробелов.${fenced("python", ["stored = {}", "def create(key, body_hash, next_order):", "    previous = stored.get(key)", "    if previous is None:", "        stored[key] = (body_hash, next_order)", "        return f\"201:{next_order}\"", "    if previous[0] != body_hash:", "        return f\"409:{previous[1]}\"", "    return f\"200:{previous[1]}\"", "", `r1 = create(\"${scenario.operationId}\", \"h-a\", ${first})`, `r2 = create(\"${scenario.operationId}\", \"h-a\", ${second})`, `r3 = create(\"${scenario.operationId}\", \"h-b\", ${third})`].join("\n"))}`,
      answer: `201:${first}|200:${first}|409:${first}`,
      objective: "Idempotency-Key, сохранённый результат и конфликт тела",
      targetSeconds: 300,
      critical: true,
      responseType: "structured",
    });
  }
  if (grade === "Middle") {
    return structuredCase({
      id,
      grade,
      family: "api-contracts",
      title: "Трасса ключа в границе арендатора",
      prompt: `Ключ идемпотентности уникален только внутри арендатора. Проследите вызовы и введите четыре результата строго как \`код:заказ|...\` без пробелов.${fenced("python", ["stored = {}", "def create(tenant, key, body_hash, next_order):", "    full_key = (tenant, key)", "    previous = stored.get(full_key)", "    if previous is None:", "        stored[full_key] = (body_hash, next_order)", "        return f\"201:{next_order}\"", "    if previous[0] != body_hash:", "        return f\"409:{previous[1]}\"", "    return f\"200:{previous[1]}\"", "", `r1 = create(${scenario.tenantId}, \"${scenario.operationId}\", \"h-a\", ${first})`, `r2 = create(${scenario.tenantId + 1}, \"${scenario.operationId}\", \"h-a\", ${second})`, `r3 = create(${scenario.tenantId}, \"${scenario.operationId}\", \"h-a\", ${third})`, `r4 = create(${scenario.tenantId}, \"${scenario.operationId}\", \"h-b\", ${fourth})`].join("\n"))}`,
      answer: `201:${first}|201:${second}|200:${first}|409:${first}`,
      objective: "Scope ключа, повтор и конфликт тела в multi-tenant API",
      targetSeconds: 360,
      critical: true,
      responseType: "structured",
    });
  }
  const version = scenario.retrySeconds;
  return structuredCase({
    id,
    grade,
    family: "api-contracts",
    title: "Трасса replay с версией команды",
    prompt: `В региональном API ключ хранит версию и хеш исходной команды. Проследите четыре вызова. Введите результаты строго как \`код:заказ|...\` без пробелов.${fenced("python", ["records = {}", "def apply(key, version, body_hash, next_order):", "    previous = records.get(key)", "    if previous is None:", "        records[key] = (version, body_hash, next_order)", "        return f\"201:{next_order}\"", "    if previous[0] != version:", "        return f\"412:{previous[2]}\"", "    if previous[1] != body_hash:", "        return f\"409:{previous[2]}\"", "    return f\"200:{previous[2]}\"", "", `r1 = apply(\"${scenario.operationId}\", ${version}, \"h-a\", ${first})`, `r2 = apply(\"${scenario.operationId}\", ${version + 1}, \"h-a\", ${second})`, `r3 = apply(\"${scenario.operationId}\", ${version}, \"h-b\", ${third})`, `r4 = apply(\"${scenario.operationId}\", ${version}, \"h-a\", ${fourth})`].join("\n"))}`,
    answer: `201:${first}|412:${first}|409:${first}|200:${first}`,
    objective: "Версия, хеш команды и устойчивый результат replay",
    targetSeconds: 360,
    critical: true,
    responseType: "structured",
  });
}

function sqlTask(grade: AssessmentGrade, scenario: Scenario, id: string) {
  const [first, second, third, fourth] = scenario.amounts;
  if (grade === "Junior") {
    return structuredCase({
      id,
      grade,
      family: "sql-data",
      title: "Фильтр арендатора и статуса",
      prompt: `Выполните запрос мысленно по приведённым строкам. Введите одно целое число.${fenced("sql", `SELECT COALESCE(SUM(amount), 0)\nFROM payments\nWHERE tenant_id = ${scenario.tenantId} AND status = 'paid';`)}\n\npayments: (${scenario.tenantId}, paid, ${first}), (${scenario.tenantId}, pending, ${second}), (${scenario.tenantId}, paid, ${third}), (${scenario.tenantId + 1}, paid, ${fourth})`,
      answer: String(first + third),
      objective: "Фильтрация по tenant_id и статусу в SQL",
      targetSeconds: 300,
      responseType: "integer",
      critical: true,
    });
  }
  if (grade === "Middle") {
    return structuredCase({
      id,
      grade,
      family: "sql-data",
      title: "Кардинальность при JOIN",
      prompt: `Запрос использует EXISTS, поэтому строка заказа попадает в сумму максимум один раз. Введите одно целое число.${fenced("sql", `SELECT COALESCE(SUM(o.amount), 0)\nFROM orders o\nWHERE o.tenant_id = ${scenario.tenantId}\n  AND EXISTS (\n    SELECT 1 FROM payment_attempts p\n    WHERE p.tenant_id = o.tenant_id\n      AND p.order_id = o.id\n      AND p.status = 'paid'\n  );`)}\n\norders: (${scenario.tenantId}, A, ${first}), (${scenario.tenantId}, B, ${third}), (${scenario.tenantId + 1}, A, ${fourth})\npayment_attempts: (${scenario.tenantId}, A, paid), (${scenario.tenantId}, A, paid), (${scenario.tenantId}, B, pending), (${scenario.tenantId}, B, paid), (${scenario.tenantId + 1}, A, paid)`,
      answer: String(first + third),
      objective: "EXISTS, кардинальность и изоляция арендатора",
      targetSeconds: 360,
      responseType: "integer",
      critical: true,
    });
  }
  return structuredCase({
    id,
    grade,
    family: "sql-data",
    title: "Последняя версия заказа",
    prompt: `В PostgreSQL \`DISTINCT ON\` берёт одну последнюю версию каждого заказа до суммирования. Выполните запрос по строкам и введите одно целое число.${fenced("sql", `WITH latest AS (\n  SELECT DISTINCT ON (tenant_id, order_id) tenant_id, order_id, status, amount\n  FROM payment_versions\n  WHERE tenant_id = ${scenario.tenantId}\n  ORDER BY tenant_id, order_id, version DESC\n)\nSELECT COALESCE(SUM(amount), 0)\nFROM latest\nWHERE status = 'paid';`)}\n\npayment_versions: (${scenario.tenantId}, A, v1, paid, ${first}), (${scenario.tenantId}, A, v2, refunded, ${second}), (${scenario.tenantId}, B, v1, paid, ${third}), (${scenario.tenantId}, C, v1, pending, ${fourth}), (${scenario.tenantId + 1}, A, v9, paid, ${first})`,
    answer: String(third),
    objective: "Последняя версия, статус и граница tenant_id",
    targetSeconds: 360,
    responseType: "integer",
    critical: true,
  });
}

function incidentTask(
  grade: AssessmentGrade,
  scenario: Scenario,
  id: string,
  answerPosition: number,
  random: Random,
  diagnosisBranch?: "query" | "runtime",
) {
  const [first, second, third] = scenario.amounts;
  const planOrPool = diagnosisBranch ? diagnosisBranch === "query" : (scenario.retrySeconds + scenario.tenantId) % 2 === 0;
  if (grade === "Junior") {
    const answer = planOrPool
      ? `Снять EXPLAIN ANALYZE ${scenario.incidentId} и сопоставить ${first} ожидаемых с ${third} фактическими строками для tenant_id=${scenario.tenantId}.`
      : `Снять trace ${scenario.incidentId} и сопоставить очередь пула ${first} с ${second} активными запросами БД до изменения лимитов.`;
    const prompt = planOrPool
      ? `${scenario.incidentId}: p95 вырос после изменения фильтра tenant_id=${scenario.tenantId}; возвращается ${third} строк при ожидании ${first}, ошибок нет. С чего начать?`
      : `${scenario.incidentId}: p95 вырос под нагрузкой, но число строк стабильно ${third}; очередь пула достигла ${first}, активных запросов БД ${second}. С чего начать?`;
    const distractors: [string, string, string] = planOrPool
      ? [
          `Увеличить pool_size до ${second} и сравнить только p95 после повторной нагрузки.`,
          `Откатить фильтр tenant_id=${scenario.tenantId} и сохранить лишь одну метрику задержки.`,
          `Добавить индекс по status и выкатить его всем арендаторам без измерения селективности.`,
        ]
      : [
          `Добавить индекс по status и считать очередь ${first} следствием плана без трассировки.`,
          `Перезапустить воркеры и признать сеть причиной, если очередь кратко станет меньше ${first}.`,
          `Продлить HTTP-тайм-ауты и ретраи, собрав итог только по ошибкам 5xx без трасс.`,
        ];
    return choiceCase({
      id,
      grade,
      family: "incident-diagnosis",
      title: "Рост задержки чтения",
      prompt,
      answer,
      distractors,
      answerPosition,
      objective: planOrPool ? "Проверка плана и селективности запроса" : "Трассировка пула и загрузки БД",
      targetSeconds: 300,
      random,
    });
  }
  if (grade === "Middle") {
    const answer = planOrPool
      ? `Снять граф pg_locks для ${scenario.incidentId} и связать ${first} ожидающих блокировку с запросами tenant_id=${scenario.tenantId}.`
      : `Сопоставить trace ${scenario.incidentId}, очередь пула ${first} и ${second} активных запросов БД до изменения лимитов.`;
    const prompt = planOrPool
      ? `${scenario.incidentId}: после миграции ${first} запросов ждут блокировку, p95 растёт, а очередь пула стабильна на ${second}. Какое первое действие даст проверяемую гипотезу?`
      : `${scenario.incidentId}: p95 растёт под нагрузкой, очередь пула ${first}, активных запросов БД ${second}, блокировок всего ${third}. Какое первое действие даст проверяемую гипотезу?`;
    const distractors: [string, string, string] = planOrPool
      ? [
          `Одновременно увеличить pool_size до ${second} и число воркеров, затем сравнить среднюю задержку.`,
          `Перезапустить миграцию и считать блокировки нормой, если p95 кратко станет ниже ${first}.`,
          `Продлить HTTP-тайм-ауты, собрав итог только по ошибкам 5xx без связи с pg_locks.`,
        ]
      : [
          `Увеличить pool_size до ${second + first} и считать изменение p95 достаточным объяснением.`,
          `Перезапустить загруженные воркеры и считать сеть причиной, если очередь кратко исчезла.`,
          `Продлить HTTP-тайм-ауты и ретраи, собрав итог только по ошибкам 5xx без трасс.`,
        ];
    return choiceCase({
      id,
      grade,
      family: "incident-diagnosis",
      title: "Насыщение пула соединений",
      prompt,
      answer,
      distractors,
      answerPosition,
      objective: planOrPool ? "Граф блокировок и запросы арендатора" : "Связь трасс, очереди и загрузки БД",
      targetSeconds: 360,
      random,
    });
  }
  const answer = planOrPool
    ? `Остановить canary ${scenario.incidentId} флагом и сохранить plan/lock trace для tenant_id=${scenario.tenantId} с p99=${third}.`
    : `Приостановить consumer ${scenario.eventId}, сохранить dedup ledger и сравнить replay ${first}/${second} до повторного запуска.`;
  const prompt = planOrPool
    ? `${scenario.incidentId}: после canary только у tenant_id=${scenario.tenantId} p99 вырос до ${third}, есть ${first} блокировок. Как ограничить ущерб и сохранить доказательства?`
    : `${scenario.incidentId}: после failover consumer получил ${first} повторов ${scenario.eventId}, ledger показывает ${second} обработанных записей, p99 вырос. Как ограничить ущерб и сохранить доказательства?`;
  const distractors: [string, string, string] = planOrPool
    ? [
        `Продолжить canary для tenant_id=${scenario.tenantId} и сравнить p99=${third} без plan и lock trace.`,
        `Откатить всю БД к резервной копии и считать тишину в логах достаточным доказательством.`,
        `Отключить наблюдаемость для флага и повторить rollout тем же процентом арендаторов.`,
      ]
    : [
        `Продолжить delivery ${scenario.eventId} и увеличить ретраи до ${third}, не сохраняя ledger.`,
        `Очистить event_id из ledger и считать новый регион отдельным источником доставки.`,
        `Отключить метрики consumer-а и ждать, пока p99 вернётся к прежнему значению.`,
      ];
  return choiceCase({
    id,
    grade,
    family: "incident-diagnosis",
    title: "Регрессия после canary",
    prompt,
    answer,
    distractors,
    answerPosition,
    objective: planOrPool ? "Canary: ограничение ущерба и lock trace" : "Replay: ограничение ущерба и dedup ledger",
    targetSeconds: 360,
    random,
  });
}

function idempotencyTask(
  grade: AssessmentGrade,
  scenario: Scenario,
  id: string,
) {
  const [first, second, third] = scenario.amounts;
  if (grade === "Junior") {
    return structuredCase({
      id,
      grade,
      family: "idempotency",
      title: "Трасса дедупликации события",
      prompt: `Consumer применяет эффект только при новом event_id. Проследите три доставки. Введите три значения баланса строго через \`|\` без пробелов.${fenced("python", ["processed = set()", "balance = 0", "def consume(event_id, amount):", "    global balance", "    if event_id in processed:", "        return balance", "    processed.add(event_id)", "    balance += amount", "    return balance", "", `r1 = consume(\"${scenario.eventId}\", ${first})`, `r2 = consume(\"${scenario.eventId}\", ${first})`, `r3 = consume(\"${scenario.eventId}-next\", ${second})`].join("\n"))}`,
      answer: `${first}|${first}|${first + second}`,
      objective: "Дедупликация event_id и exactly-once бизнес-эффект",
      targetSeconds: 300,
      critical: true,
      responseType: "structured",
    });
  }
  if (grade === "Middle") {
    const total = first + third;
    return structuredCase({
      id,
      grade,
      family: "idempotency",
      title: "Доставка до и после ack",
      prompt: `Запись \`done\` и изменение баланса происходят в одной транзакции до ack. Проследите доставки двух событий. Введите четыре результата строго как \`A:баланс|D:баланс|...\` без пробелов.${fenced("python", ["ledger = {}", "balance = 0", "def apply(event_id, amount):", "    global balance", "    if ledger.get(event_id) == \"done\":", "        return f\"D:{balance}\"", "    ledger[event_id] = \"done\"", "    balance += amount", "    return f\"A:{balance}\"", "", `r1 = apply(\"${scenario.eventId}\", ${first})`, `r2 = apply(\"${scenario.eventId}\", ${second})`, `r3 = apply(\"${scenario.eventId}-b\", ${third})`, `r4 = apply(\"${scenario.eventId}-b\", ${second})`].join("\n"))}`,
      answer: `A:${first}|D:${first}|A:${total}|D:${total}`,
      objective: "Durable ledger до ack и повторная доставка",
      targetSeconds: 360,
      critical: true,
      responseType: "structured",
    });
  }
  const version = scenario.retrySeconds;
  const afterFirst = first + second;
  const afterFourth = afterFirst + third;
  return structuredCase({
    id,
    grade,
    family: "idempotency",
    title: "Поздний replay и версия агрегата",
    prompt: `Consumer хранит event_id и версию агрегата на всём согласованном replay-window. Проследите четыре доставки. Введите результаты строго как \`A:версия:баланс|D:версия:баланс|S:версия:баланс|A:версия:баланс\` без пробелов.${fenced("python", ["handled = set()", `version = ${version}`, `balance = ${first}`, "def apply(event_id, expected_version, delta):", "    global version, balance", "    if event_id in handled:", "        return f\"D:{version}:{balance}\"", "    if expected_version != version:", "        return f\"S:{version}:{balance}\"", "    handled.add(event_id)", "    version += 1", "    balance += delta", "    return f\"A:{version}:{balance}\"", "", `r1 = apply(\"${scenario.eventId}\", ${version}, ${second})`, `r2 = apply(\"${scenario.eventId}\", ${version}, ${third})`, `r3 = apply(\"${scenario.eventId}-late\", ${version}, ${third})`, `r4 = apply(\"${scenario.eventId}-next\", ${version + 1}, ${third})`].join("\n"))}`,
    answer: `A:${version + 1}:${afterFirst}|D:${version + 1}:${afterFirst}|S:${version + 1}:${afterFirst}|A:${version + 2}:${afterFourth}`,
    objective: "Replay, optimistic version и устойчивый dedup-барьер",
    targetSeconds: 360,
    critical: true,
    responseType: "structured",
  });
}

function architectureTask(
  grade: AssessmentGrade,
  scenario: Scenario,
  id: string,
  answerPosition: number,
  random: Random,
  selectedBranch?: 0 | 1 | 2,
) {
  const branch = selectedBranch ?? (scenario.retrySeconds + scenario.amounts[0]) % 3;
  if (grade === "Junior") {
    const content =
      branch === 0
        ? {
            title: "Событие после изменения заказа",
            prompt: `Сервис сохраняет ${scenario.orderId}, затем должен опубликовать ${scenario.eventId}. Процесс может завершиться между записью и публикацией. Какой вариант исключает потерю события?`,
            answer: `Записать изменение ${scenario.orderId} и outbox-событие ${scenario.eventId} в одной транзакции, затем доставлять outbox отдельно.`,
            distractors: [
              `Сначала публиковать ${scenario.eventId}, а запись ${scenario.orderId} повторять до HTTP-ответа.`,
              `Сохранять ${scenario.orderId}, а ${scenario.eventId} держать в памяти воркера до плановой публикации.`,
              `Писать оба действия в разные логи и еженочью восстанавливать пропуски вручную.`,
            ] as [string, string, string],
            objective: "Транзакционный outbox",
          }
        : branch === 1
          ? {
              title: "Повторная доставка события",
              prompt: `Брокер дважды доставил ${scenario.eventId} для ${scenario.orderId}; ack разрешён только после бизнес-эффекта. Какой контракт не применит эффект дважды?`,
              answer: `Передавать устойчивый ${scenario.eventId} и записывать его ledger вместе с эффектом ${scenario.orderId} до ack.`,
              distractors: [
                `Создавать новый event_id для каждого delivery, чтобы consumer не увидел повтор.`,
                `Подтверждать ack сразу, а дубликаты ${scenario.eventId} исправлять ночной сверкой.`,
                `Игнорировать второй delivery, только если он пришёл в тот же процесс за ${scenario.retrySeconds} секунд.`,
              ] as [string, string, string],
              objective: "Стабильный event_id и consumer dedup",
            }
          : {
              title: "Частичный сбой двух сервисов",
              prompt: `Для ${scenario.orderId} нужно зарезервировать лимит и создать заказ в разных сервисах; общей БД и 2PC нет. Как сохранить восстанавливаемое состояние?`,
              answer: `Вести ${scenario.orderId} как сагу с локальным outbox, наблюдаемым статусом и идемпотентной компенсацией резерва.`,
              distractors: [
                `Сделать два независимых HTTP-вызова и при тайм-ауте считать оба эффекта успешными.`,
                `Выполнить вызовы в фиксированном порядке и откатывать их вручную по обращениям клиентов.`,
                `Сохранить текстовую инструкцию оператору без статуса операции и корреляционного ключа.`,
              ] as [string, string, string],
              objective: "Saga и компенсация",
            };
    return choiceCase({
      id,
      grade,
      family: "architecture",
      title: content.title,
      prompt: content.prompt,
      answer: content.answer,
      distractors: content.distractors,
      answerPosition,
      objective: content.objective,
      targetSeconds: 300,
      random,
    });
  }
  if (grade === "Middle") {
    const content =
      branch === 0
        ? {
            title: "Падение паблишера после send",
            prompt: `Паблишер отправил ${scenario.eventId} из outbox ${scenario.orderId}, но упал до отметки delivered. Брокер повторит сообщение. Какой контракт доставки нужен?`,
            answer: `Повторять outbox ${scenario.eventId} с тем же id, а consumer фиксирует дедуплицированный эффект ${scenario.orderId} до ack.`,
            distractors: [
              `Пометить ${scenario.eventId} delivered до send и считать повтор ошибкой сети.`,
              `Генерировать новый event_id на повторе, чтобы consumer увидел независимое сообщение.`,
              `Подтверждать delivery до эффекта и восстанавливать расхождения по еженочной сверке.`,
            ] as [string, string, string],
            objective: "At-least-once outbox и consumer dedup",
          }
        : branch === 1
          ? {
              title: "Конкурентные consumer-ы",
              prompt: `Два consumer-а одновременно получают ${scenario.eventId} для tenant_id=${scenario.tenantId}; запись должна быть видна после failover. Какой порядок сохраняет эффект один раз?`,
              answer: `Уникально закрепить (${scenario.tenantId}, ${scenario.eventId}) и эффект в одной транзакции, затем отправить ack.`,
              distractors: [
                `Держать ${scenario.eventId} в кеше каждого consumer-а и отправлять ack сразу.`,
                `Обрабатывать оба delivery, а различие tenant_id=${scenario.tenantId} исправлять вручную.`,
                `Выбирать победителя по времени получения и не хранить факт обработки после ack.`,
              ] as [string, string, string],
              objective: "Уникальный consumer ledger и момент ack",
            }
          : {
              title: "Сбой после резерва лимита",
              prompt: `Лимит для ${scenario.orderId} уже зарезервирован, но создание заказа упало после тайм-аута; общей БД нет. Какой процесс даёт проверяемое восстановление?`,
              answer: `Зафиксировать шаг саги ${scenario.orderId} и outbox, затем идемпотентно завершить заказ или компенсировать резерв.`,
              distractors: [
                `Повторять создание заказа бесконечно и считать резерв действительным без статуса саги.`,
                `Удалить резерв при первом тайм-ауте, не проверяя исход операции у второго сервиса.`,
                `Попросить оператора выбрать случайный порядок повторов без корреляционного идентификатора.`,
              ] as [string, string, string],
              objective: "Saga state, outbox и идемпотентная компенсация",
            };
    return choiceCase({
      id,
      grade,
      family: "architecture",
      title: content.title,
      prompt: content.prompt,
      answer: content.answer,
      distractors: content.distractors,
      answerPosition,
      objective: content.objective,
      targetSeconds: 360,
      random,
    });
  }
  const content =
    branch === 0
      ? {
          title: "Региональный replay outbox",
          prompt: `После failover второй регион читает outbox ${scenario.eventId} для ${scenario.orderId}; старый регион мог уже отправить его. Как не потерять и не удвоить эффект?`,
          answer: `Сохранить глобально устойчивый ${scenario.eventId}, outbox lease и dedup ledger ${scenario.orderId} на весь replay-window.`,
          distractors: [
            `Удалить ${scenario.eventId} после первой отправки и доверять тому, что второй регион не увидит его.`,
            `Создать региональный event_id и применить оба delivery, если они пришли из разных зон.`,
            `Держать статус delivered только в памяти паблишера до завершения failover.`,
          ] as [string, string, string],
          objective: "Multi-region outbox, lease и долговечный dedup",
        }
      : branch === 1
        ? {
            title: "Эволюция контракта события",
            prompt: `Producer выпускает ${scenario.eventId} с новой схемой для ${scenario.orderId}, а часть consumer-ов ещё читает старую. Как провести переход без потери и двойного эффекта?`,
            answer: `Публиковать версионированный ${scenario.eventId} через outbox, сохранить совместимый consumer и dedup по стабильному id до cutover.`,
            distractors: [
              `Сразу удалить старые поля ${scenario.eventId} и повторять delivery, пока все consumer-ы не обновятся.`,
              `Выдавать новый event_id на каждую схему и считать их независимыми бизнес-эффектами.`,
              `Отключить старые consumer-ы без наблюдаемого статуса обработки и компенсирующих действий.`,
            ] as [string, string, string],
            objective: "Versioned event contract и совместимый consumer",
          }
        : {
            title: "Межсервисная операция",
            prompt: `Для ${scenario.orderId} нужно зарезервировать лимит и создать заказ в разных сервисах; общей БД и 2PC нет. Какой вариант даёт контролируемое восстановление?`,
            answer: `Зафиксировать состояние саги ${scenario.orderId} и outbox, затем идемпотентно завершить или компенсировать резерв с наблюдаемым статусом.`,
            distractors: [
              `Сделать два независимых HTTP-вызова и при тайм-ауте считать оба эффекта вероятно успешными.`,
              `Выполнить удалённые действия в фиксированном порядке и откатывать их вручную по обращениям клиентов.`,
              `Хранить текстовую инструкцию оператору без статуса саги и корреляционного ключа.`,
            ] as [string, string, string],
            objective: "Saga, outbox и идемпотентная компенсация",
          };
  return choiceCase({
    id,
    grade,
    family: "architecture",
    title: content.title,
    prompt: content.prompt,
    answer: content.answer,
    distractors: content.distractors,
    answerPosition,
    objective: content.objective,
    targetSeconds: 360,
    random,
  });
}

function followUpTask(
  grade: AssessmentGrade,
  scenario: Scenario,
  id: string,
) {
  const [first, second] = scenario.amounts;
  if (grade === "Junior") {
    return structuredCase({
      id,
      grade,
      family: "condition-change",
      title: "Изменилось условие: перезапуск до ответа",
      prompt: `Условие изменилось: процесс перезапустился после durable-записи для ${scenario.operationId}, но до ответа. Проследите два повтора. Введите результаты строго как \`код:заказ|код:заказ\` без пробелов.${fenced("python", ["stored = {", `    \"${scenario.operationId}\": (\"h-a\", ${first})`, "}", "def create(key, body_hash, next_order):", "    previous = stored.get(key)", "    if previous is None:", "        stored[key] = (body_hash, next_order)", "        return f\"201:{next_order}\"", "    if previous[0] != body_hash:", "        return f\"409:{previous[1]}\"", "    return f\"200:{previous[1]}\"", "", `r1 = create(\"${scenario.operationId}\", \"h-a\", ${second})`, `r2 = create(\"${scenario.operationId}\", \"h-b\", ${second})`].join("\n"))}`,
      answer: `200:${first}|409:${first}`,
      objective: "Контрфактический replay после durable-записи",
      targetSeconds: 300,
      responseType: "structured",
    });
  }
  if (grade === "Middle") {
    return structuredCase({
      id,
      grade,
      family: "condition-change",
      title: "Изменилось условие: другое тело",
      prompt: `Условие изменилось: тот же ключ приходит от другого tenant, а затем исходный tenant меняет тело. Проследите три вызова. Введите результаты строго как \`код:заказ|...\` без пробелов.${fenced("python", ["stored = {", `    (${scenario.tenantId}, \"${scenario.operationId}\"): (\"h-a\", ${first})`, "}", "def create(tenant, key, body_hash, next_order):", "    previous = stored.get((tenant, key))", "    if previous is None:", "        stored[(tenant, key)] = (body_hash, next_order)", "        return f\"201:{next_order}\"", "    if previous[0] != body_hash:", "        return f\"409:{previous[1]}\"", "    return f\"200:{previous[1]}\"", "", `r1 = create(${scenario.tenantId + 1}, \"${scenario.operationId}\", \"h-a\", ${second})`, `r2 = create(${scenario.tenantId}, \"${scenario.operationId}\", \"h-b\", ${second})`, `r3 = create(${scenario.tenantId}, \"${scenario.operationId}\", \"h-a\", ${second})`].join("\n"))}`,
      answer: `201:${second}|409:${first}|200:${first}`,
      objective: "Контрфактический scope ключа и конфликт тела",
      targetSeconds: 300,
      responseType: "structured",
    });
  }
  const version = scenario.retrySeconds + 1;
  return structuredCase({
    id,
    grade,
    family: "condition-change",
    title: "Изменилось условие: поздний replay",
    prompt: `Условие изменилось: поздний повтор операции ${scenario.operationId} приходит после перехода агрегата на версию ${version}. Проследите три вызова. Введите результаты строго как \`код:заказ|...\` без пробелов.${fenced("python", ["records = {", `    \"${scenario.operationId}\": (${version}, \"h-a\", ${first})`, "}", "def apply(key, version, body_hash, next_order):", "    previous = records[key]", "    if previous[0] != version:", "        return f\"412:{previous[2]}\"", "    if previous[1] != body_hash:", "        return f\"409:{previous[2]}\"", "    return f\"200:{previous[2]}\"", "", `r1 = apply(\"${scenario.operationId}\", ${version - 1}, \"h-a\", ${second})`, `r2 = apply(\"${scenario.operationId}\", ${version}, \"h-b\", ${second})`, `r3 = apply(\"${scenario.operationId}\", ${version}, \"h-a\", ${second})`].join("\n"))}`,
    answer: `412:${first}|409:${first}|200:${first}`,
    objective: "Контрфактический replay после смены версии",
    targetSeconds: 300,
    responseType: "structured",
  });
}

/**
 * Builds one reproducible form. `seed` is only for server tests; handlers
 * never return it, nor any oracle fields, to the client.
 */
export function assembleAttempt(grade: AssessmentGrade, seed = randomBytes(16).toString("hex"), contextId?: AssessmentContextId): Attempt {
  const random = seededRandom(seed);
  const scenario = scenarioFor(random);
  const context = contextId ? getAssessmentContext(contextId) : undefined;
  // Keep the public identifier independent from the PRNG's initial state.
  const variantKey = createHash("sha256").update(seed).digest("hex").slice(0, 16);
  const startingPosition = integer(random, 0, 3);
  const positionFor = (offset: number) => (startingPosition + offset) % 4;
  const generated = [
    apiTask(grade, scenario, makeCaseId(grade, "api-contracts", variantKey)),
    sqlTask(grade, scenario, makeCaseId(grade, "sql-data", variantKey)),
    incidentTask(grade, scenario, makeCaseId(grade, "incident-diagnosis", variantKey), positionFor(0), random, context?.diagnosisBranch),
    idempotencyTask(grade, scenario, makeCaseId(grade, "idempotency", variantKey)),
    architectureTask(grade, scenario, makeCaseId(grade, "architecture", variantKey), positionFor(1), random, context?.architectureBranch),
    followUpTask(grade, scenario, makeCaseId(grade, "condition-change", variantKey)),
  ];
  return {
    cases: generated.map((entry) => entry.item),
    oracles: Object.fromEntries(generated.map((entry) => [entry.item.id, entry.oracle])),
  };
}

function isGrade(value: unknown): value is AssessmentGrade {
  return value === "Junior" || value === "Middle" || value === "Senior";
}

function hasCurrentOracle(
  value: unknown,
  grade: AssessmentGrade,
  family: FamilyId,
): value is AttemptOracle[string] {
  if (!value || typeof value !== "object") return false;
  const oracle = value as Partial<AttemptOracle[string]>;
  return (
    typeof oracle.answer === "string" &&
    oracle.blueprint?.version === KALIBR_BANK_VERSION &&
    oracle.blueprint.grade === grade &&
    oracle.blueprint.family === family &&
    oracle.blueprint.responseType === familyResponseTypes[family] &&
    oracle.blueprint.partialCredit ===
      (familyResponseTypes[family] === "structured" ? "ordered_components" : "all_or_nothing")
  );
}

/** Returns true only for a complete current server-generated form. */
export function isCurrentKalibrAttempt(cases: unknown, oracles: unknown): boolean {
  if (
    !Array.isArray(cases) ||
    cases.length !== familyOrder.length ||
    !oracles ||
    typeof oracles !== "object"
  ) {
    return false;
  }
  const firstOracle = (oracles as AttemptOracle)[(cases[0] as SignalCase)?.id];
  const managedVersions: Record<string, { programId: string; seniorArchitectureRequired: boolean }> = {
    "signal-backend-python-v5": { programId: "backend-python", seniorArchitectureRequired: false },
    "signal-frontend-typescript-v1": { programId: "frontend-typescript", seniorArchitectureRequired: false },
    "signal-backend-python-v6": { programId: "backend-python", seniorArchitectureRequired: true },
    "signal-frontend-typescript-v2": { programId: "frontend-typescript", seniorArchitectureRequired: true },
  };
  const managedVersion = managedVersions[firstOracle?.blueprint?.version ?? ""];
  if (managedVersion) {
    const programId = managedVersion.programId;
    const families = programId === "backend-python" ? familyOrder : ["typescript", "frontend-state", "frontend-performance", "accessibility", "frontend-architecture", "async-ui"];
    const seen = new Set<string>();
    return cases.every((item: SignalCase, index) => {
      const oracle = (oracles as AttemptOracle)[item.id];
      const blueprint = oracle?.blueprint;
      if (!blueprint || seen.has(item.id)) return false;
      seen.add(item.id);
      const seniorArchitecture = managedVersion.seniorArchitectureRequired && blueprint.grade === "Senior" && index === 4;
      return typeof oracle.answer === "string" && blueprint.version === firstOracle.blueprint.version && blueprint.programId === programId && blueprint.family === families[index] && blueprint.grade === firstOracle.blueprint.grade && isGrade(blueprint.grade) && typeof blueprint.templateId === "string" && blueprint.templateVersion === (seniorArchitecture ? 2 : 1) && blueprint.critical === ([0, 1, 3].includes(index) || seniorArchitecture) && blueprint.responseType === (index === 2 || index === 4 ? "choice" : index === 1 ? "integer" : "structured") && item.responseType === (blueprint.responseType === "choice" ? "choice" : "text") && blueprint.partialCredit === (blueprint.responseType === "structured" ? "ordered_components" : "all_or_nothing");
    });
  }
  const caseIds = new Set<string>();
  return cases.every((item, index) => {
    if (!item || typeof item !== "object") return false;
    const candidate = item as Partial<SignalCase>;
    const family = familyOrder[index]!;
    const id = candidate.id;
    const grade = id?.split(":")[1];
    const expectedCaseResponseType =
      familyResponseTypes[family] === "choice" ? "choice" : "text";
    if (
      typeof id !== "string" ||
      !id.startsWith(`${KALIBR_BANK_VERSION}:`) ||
      !id.includes(`:${family}:`) ||
      caseIds.has(id) ||
      !isGrade(grade) ||
      candidate.responseType !== expectedCaseResponseType
    ) {
      return false;
    }
    caseIds.add(id);
    return hasCurrentOracle((oracles as Record<string, unknown>)[id], grade, family);
  });
}

export function assessmentBankVersion(cases: unknown, oracles: unknown): string {
  return isCurrentKalibrAttempt(cases, oracles) ? (oracles as AttemptOracle)[(cases as SignalCase[])[0]!.id]!.blueprint.version : "legacy";
}

function answerScore(submitted: string, oracle: AttemptOracle[string] | undefined): number {
  if (!oracle) return 0;
  const normalizedSubmitted = normalizeAnswer(submitted);
  const normalizedExpected = normalizeAnswer(oracle.answer);
  if (!normalizedSubmitted) return 0;
  if (oracle.blueprint?.partialCredit === "ordered_components") {
    const expectedParts = normalizedExpected.split("|");
    const submittedParts = normalizedSubmitted.split("|");
    if (submittedParts.length !== expectedParts.length) return 0;
    const matched = expectedParts.filter(
      (expected, index) => submittedParts[index] === expected,
    ).length;
    return Math.round((matched / expectedParts.length) * 100);
  }
  return normalizedSubmitted === normalizedExpected ? 100 : 0;
}

export function scoreAttempt(
  cases: SignalCase[],
  oracles: AttemptOracle | Record<string, { answer: string; rubric?: string[] }>,
  answers: Array<{ caseId: string; answer: string }>,
): {
  score: number;
  criticalComplete: boolean;
  evidence: Array<{ skill: string; score: number; criterion: string; criterionId: string | null; programId: string; programVersion: string; templateId: string | null; templateVersion: number | null }>;
} {
  const answerMap = new Map(
    answers.map((item) => [item.caseId, typeof item.answer === "string" ? item.answer : ""]),
  );
  const currentOracles = oracles as AttemptOracle;
  let totalScore = 0;
  const criticalResults: boolean[] = [];
  const evidence = cases.map((item) => {
    const submitted = answerMap.get(item.id) ?? "";
    const oracle = currentOracles[item.id];
    const caseScore = answerScore(submitted, oracle);
    const isCorrect = caseScore === 100;
    totalScore += caseScore;
    if (oracle?.blueprint?.critical) criticalResults.push(isCorrect);
    return {
      skill: item.family,
      score: caseScore,
      criterionId: oracle?.blueprint?.family ?? null,
      programId: oracle?.blueprint?.programId ?? "backend-python",
      programVersion: oracle?.blueprint?.version ?? "legacy",
      templateId: oracle?.blueprint?.templateId ?? null,
      templateVersion: oracle?.blueprint?.templateVersion ?? null,
      criterion: isCorrect
        ? "Критерий варианта подтверждён серверной проверкой."
        : caseScore > 0
          ? "Подтверждена часть структурированного критерия; для критичного навыка нужен полный ответ."
        : "Критерий варианта не подтверждён серверной проверкой.",
    };
  });
  return {
    score: Math.round(totalScore / Math.max(cases.length, 1)),
    criticalComplete: criticalResults.length > 0 && criticalResults.every(Boolean),
    evidence,
  };
}

/** Transparent MVP thresholds; not a claim of psychometric calibration. */
export function requiredScore(grade: AssessmentGrade): number {
  if (grade === "Junior") return 67;
  return 83;
}

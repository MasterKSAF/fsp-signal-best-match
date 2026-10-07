export const ASSESSMENT_CONTEXT_VERSION = "backend-role-context-v1";
import { skillCoverage } from "./skill-catalog";
export type AssessmentContextId = "api-platform" | "data-services" | "reliability" | "frontend-product" | "frontend-platform" | "frontend-accessibility";
export type ContextGrade = "Junior" | "Middle" | "Senior";
export type ContextCoverage = { requirement: string; families: string[]; evidence: string };
export type AssessmentContext = {
  id: AssessmentContextId;
  title: string;
  description: string;
  skills: string[];
  coverage: ContextCoverage[];
  diagnosisBranch: "query" | "runtime";
  architectureBranch: 0 | 1 | 2;
};

const sharedCoverage: ContextCoverage[] = [
  { requirement: "Разработка API на Python", families: ["API-контракты", "Изменение условия"], evidence: "Трассировка вызовов, границы ключа и повтор после изменения условий" },
  { requirement: "Работа с SQL", families: ["SQL и данные"], evidence: "Результат запроса с учётом изоляции данных. Знание конкретной СУБД отдельно не подтверждается" },
  { requirement: "Безопасная повторная обработка", families: ["Идемпотентность"], evidence: "Трассировка доставки событий и сохранённого бизнес-эффекта" },
];

const contexts: AssessmentContext[] = [
  {
    id: "api-platform", title: "Разработчик API", skills: ["Python", "API contracts", "SQL", "Architecture"],
    description: "Разрабатывать API платформы, хранить данные разных клиентов и надёжно передавать события между сервисами.",
    diagnosisBranch: "query", architectureBranch: 0,
    coverage: [...sharedCoverage,
      { requirement: "Находить причины замедления запросов", families: ["Диагностика инцидента"], evidence: "Выбор проверяемой гипотезы по плану запроса, блокировкам или canary — в зависимости от уровня" },
      { requirement: "Согласовывать запись и публикацию события", families: ["Выбор архитектуры"], evidence: "Выбор безопасного порядка записи и доставки при сбое процесса" },
    ],
  },
  {
    id: "data-services", title: "Разработчик сервисов данных", skills: ["Python", "SQL", "Idempotency"],
    description: "Создавать сервисы обработки данных, проектировать SQL-запросы и безопасно развивать поток событий.",
    diagnosisBranch: "query", architectureBranch: 1,
    coverage: [...sharedCoverage,
      { requirement: "Диагностировать запросы и миграции данных", families: ["Диагностика инцидента"], evidence: "Выбор наблюдений, которые связывают задержку с запросом или изменением схемы" },
      { requirement: "Обрабатывать поток данных без двойного эффекта", families: ["Выбор архитектуры"], evidence: "Доставка, конкурентная обработка или эволюция контракта события — в зависимости от уровня" },
    ],
  },
  {
    id: "reliability", title: "Разработчик надёжных сервисов", skills: ["Python", "Incident diagnosis", "Replay safety", "Architecture"],
    description: "Поддерживать устойчивость сервисов под нагрузкой, расследовать сбои и восстанавливать межсервисные операции.",
    diagnosisBranch: "runtime", architectureBranch: 2,
    coverage: [...sharedCoverage,
      { requirement: "Локализовать проблему под нагрузкой или после сбоя", families: ["Диагностика инцидента"], evidence: "Выбор первого действия по очереди пула, трассировке или повторной доставке" },
      { requirement: "Восстанавливать операции нескольких сервисов", families: ["Выбор архитектуры"], evidence: "Выбор процесса восстановления и компенсации частичного сбоя" },
    ],
  },
];

const frontendCoverage: ContextCoverage[] = [
  { requirement: "TypeScript на границе данных", families: ["TypeScript"], evidence: "Сужение типов и проверка входного значения без небезопасного приведения" },
  { requirement: "Состояние интерфейса", families: ["Состояние интерфейса", "Асинхронный интерфейс"], evidence: "Reducer, производные данные и защита от позднего ответа" },
  { requirement: "Доступность", families: ["Доступность"], evidence: "Клавиатурная навигация, фокус и обратная связь формы" },
  { requirement: "Качество интерфейсной архитектуры", families: ["Производительность интерфейса", "Архитектура интерфейса"], evidence: "Измеряемая диагностика и границы владения состоянием; конкретные фреймворки не подтверждаются" },
];
contexts.push(
  { id: "frontend-product", title: "Разработчик продуктового интерфейса", description: "Создавать типизированные формы, списки и предсказуемые асинхронные сценарии.", skills: ["TypeScript", "Frontend state", "Async UI"], coverage: frontendCoverage, diagnosisBranch: "runtime", architectureBranch: 0 },
  { id: "frontend-platform", title: "Разработчик интерфейсной платформы", description: "Управлять контрактами данных, производительностью и границами состояния приложения.", skills: ["TypeScript", "Frontend performance", "Frontend architecture"], coverage: frontendCoverage, diagnosisBranch: "runtime", architectureBranch: 1 },
  { id: "frontend-accessibility", title: "Разработчик доступных интерфейсов", description: "Делать формы и переходы доступными с клавиатуры и устойчивыми к изменению данных.", skills: ["TypeScript", "Accessibility", "Async UI"], coverage: frontendCoverage, diagnosisBranch: "runtime", architectureBranch: 2 },
);
export function contextProgramId(id: AssessmentContextId) { return id.startsWith("frontend-") ? "frontend-typescript" : "backend-python"; }

export function getAssessmentContext(id: AssessmentContextId): AssessmentContext {
  const context = contexts.find((item) => item.id === id);
  if (!context) throw new Error("Неизвестный профиль проверки.");
  return context;
}

export function isAssessmentContextId(value: unknown): value is AssessmentContextId {
  return typeof value === "string" && contexts.some(context => context.id === value);
}

/** Only this projection is returned to a browser: generator switches stay server-side. */
export function publicAssessmentContext(context: AssessmentContext) {
  return { id: context.id, title: context.title, description: context.description, skills: context.skills, coverage: context.coverage };
}

export function listAssessmentContexts(programId = "backend-python") {
  return contexts.filter(context => contextProgramId(context.id) === programId).map(publicAssessmentContext);
}

export type NeedForAssessment = {
  title: string; description: string; specialization: string;
  grade: ContextGrade; requiredSkills: string[]; desirableSkills: string[];
};

const keywords: Record<AssessmentContextId, RegExp[]> = {
  "api-platform": [/\bapi\b|rest|graphql|контракт|платформ/iu, /outbox|http|fastapi|django/iu],
  "data-services": [/sql|postgres|баз[аыу]\s+данных/iu, /поток|обработк.{0,10}данных|etl|pipeline|kafka|consumer|хранилищ/iu],
  reliability: [/надеж|надёж|отказ|восстанов|reliab|sre|incident|инцидент/iu, /нагруз|replay|monitor|наблюдаем|fault|saga|компенсац/iu],
  "frontend-product": [/продукт|форм|спис|state/iu],
  "frontend-platform": [/платформ|контракт|производитель|performance/iu],
  "frontend-accessibility": [/accessib|доступн|клавиат|фокус/iu],
};

function isCoveredRequirement(value: string) {
  // A general API or event scenario cannot certify knowledge of a particular
  // framework/broker. Keep FastAPI, Kafka, Redis, etc. visible as unchecked.
  return /^(python(?:\s*3(?:\.\d+)?)?|sql|postgresql|postgres|api(?: contracts)?|rest(?: api)?|идемпотентность|idempotency|architecture|архитектура|incident diagnosis|диагностика инцидента|replay safety)$/iu.test(value.trim());
}

/** Transparent rules, not an ML prediction or an inferred personal grade. */
export function selectContextForNeed(need: NeedForAssessment) {
  const titleAndDescription = `${need.title} ${need.description}`;
  const skills = need.requiredSkills.join(" ");
  const programId = need.specialization === "Frontend / TypeScript" ? "frontend-typescript" : "backend-python";
  const scored = contexts.filter(context => contextProgramId(context.id) === programId).map((context) => ({
    context,
    score: keywords[context.id].reduce((total, pattern) => total + (pattern.test(titleAndDescription) ? 1 : 0) + (pattern.test(skills) ? 2 : 0), 0),
  })).sort((left, right) => right.score - left.score);
  const selected = scored[0]!;
  const context = selected.context;
  const supported = need.specialization === "Backend / Python" || need.specialization === "Frontend / TypeScript";
  const coverage = skillCoverage(need.requiredSkills, need.specialization);
  return {
    supported,
    targetGrade: need.grade,
    context: publicAssessmentContext(context),
    reason: supported
      ? selected.score > 0 ? "Профиль выбран по описанию роли и обязательным навыкам. Целевой уровень указан работодателем." : "Выбран общий профиль API: более узкое направление в требованиях не указано. Целевой уровень указан работодателем."
      : "Для этой специализации проверка пока недоступна.",
    matchedRequirements: coverage.filter(item => item.supported).map(item => item.raw),
    unsupportedRequirements: coverage.filter(item => !item.supported).map(item => item.raw),
  };
}

export type AssessmentContextSnapshot = {
  version: typeof ASSESSMENT_CONTEXT_VERSION;
  source: "profile" | "invitation";
  context: ReturnType<typeof publicAssessmentContext>;
  targetGrade: ContextGrade;
  vacancyGrade?: ContextGrade;
  needId?: number;
  companyId?: number;
  roleTitle: string;
  requirements: string[];
  unsupportedRequirements: string[];
  reason: string;
};

export function snapshotForProfile(contextId: AssessmentContextId, grade: ContextGrade): AssessmentContextSnapshot {
  const context = publicAssessmentContext(getAssessmentContext(contextId));
  return { version: ASSESSMENT_CONTEXT_VERSION, source: "profile", context, targetGrade: grade, roleTitle: context.title, requirements: context.skills, unsupportedRequirements: [], reason: contextProgramId(contextId) === "backend-python" ? "Выбранная вами программа. Шесть компетенций сохраняют единую основу оценки, прикладные сценарии учитывают эту роль." : "Выбранная вами роль. Шесть компетенций и единая рубрика Frontend / TypeScript; конкретный фреймворк отдельно не подтверждается." };
}

export function snapshotForNeed(need: NeedForAssessment, declaredGrade: ContextGrade = need.grade): AssessmentContextSnapshot {
  const selection = selectContextForNeed(need);
  return { version: ASSESSMENT_CONTEXT_VERSION, source: "invitation", context: selection.context, targetGrade: declaredGrade, vacancyGrade: need.grade, roleTitle: need.title, requirements: selection.matchedRequirements, unsupportedRequirements: selection.unsupportedRequirements, reason: `Контекст задач учитывает потребность компании. Квалификационная программа Signal проверяет выбранный кандидатом уровень ${declaredGrade}; уровень вакансии ${need.grade} указан отдельно.` };
}

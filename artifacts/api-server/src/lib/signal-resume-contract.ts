import { z } from "zod";
import { isDeepStrictEqual } from "node:util";
import type { SignalResumeQuestionnaireHistory } from "@workspace/db";
import { postgresIntIdSchema } from "./postgres-id";

const month = z.string().regex(/^(19|20|21)\d{2}-(0[1-9]|1[0-2])$/, "Укажите месяц и год.");
// Historical education records sometimes know only the year. Preserve that precision rather than inventing January.
const educationDate = z.string().regex(/^(19|20|21)\d{2}(?:-(0[1-9]|1[0-2]))?$/, "Укажите год или месяц и год.");
const requiredText = (max: number) => z.string().trim().min(1, "Заполните поле.").max(max, `Не более ${max} символов.`);
const safeUrl = z.string().trim().max(600).url("Введите полный адрес сайта.").refine((value) => {
  try { const parsed = new URL(value); return ["https:", "http:"].includes(parsed.protocol) && !parsed.username && !parsed.password; } catch { return false; }
}, "Допустимы ссылки http:// или https:// без логина и пароля.");
const dateRange = <T extends { start: string; end: string | null }>(value: T) => value.end === null || ((value.start.length === 4 || value.end.length === 4) ? value.end.slice(0,4) >= value.start.slice(0,4) : value.end >= value.start);

export const resumeQuestions = [
  { key: "python", title: "Python", question: "Как вы работаете с Python: коллекциями, исключениями, типизацией и асинхронным кодом?" },
  { key: "databases", title: "Базы данных", question: "Как вы проектируете схемы, пишете SQL и разбираетесь с транзакциями и индексами?" },
  { key: "api", title: "API", question: "Как вы создаёте HTTP API, проверяете входные данные и управляете доступом?" },
  { key: "testing", title: "Тестирование", question: "Как вы пишете тесты и проверяете изменения перед выпуском?" },
  { key: "reliability", title: "Надёжность", question: "Как вы находите причины сбоев, работаете с логами, повторами и очередями?" },
  { key: "ownership", title: "Самостоятельность", question: "Какую ответственность вы берёте за технические решения и результат команды?" },
] as const;
export const frontendResumeQuestions = [
  { key: "typescript", title: "TypeScript", question: "Как вы проверяете входные данные, используете union-типы и сужение типов в TypeScript?" },
  { key: "state", title: "Состояние интерфейса", question: "Как вы организуете состояние форм, производные данные и асинхронные обновления?" },
  { key: "accessibility", title: "Доступность", question: "Как вы проверяете клавиатурную навигацию, фокус и обратную связь интерфейса?" },
  { key: "performance", title: "Производительность", question: "Как вы измеряете задержки интерфейса и находите узкие места загрузки или рендера?" },
  { key: "architecture", title: "Архитектура", question: "Как вы проектируете границы компонентов, контрактов API и состояния приложения?" },
  { key: "ownership", title: "Самостоятельность", question: "Какую ответственность вы берёте за технические решения и результат команды?" },
] as const;
export function questionsForResume(specialization: string) { return specialization === "Frontend / TypeScript" ? frontendResumeQuestions : resumeQuestions; }
export const resumeAnswerScale = [
  { value: 0, label: "Пока не работал с этим" },
  { value: 1, label: "Решаю с примерами или помощью" },
  { value: 2, label: "Самостоятельно решаю рабочие задачи" },
  { value: 3, label: "Проектирую решения и помогаю другим" },
] as const;
const answer = z.number().int().min(0).max(3).nullable();
const BackendQuestionnaireSchema = z.object({
  version: z.literal("backend-python-v1"),
  industry: requiredText(120),
  specialization: z.literal("Backend / Python"),
  answers: z.object({ python: answer, databases: answer, api: answer, testing: answer, reliability: answer, ownership: answer }).strict(),
}).strict();
const FrontendQuestionnaireSchema = z.object({
  version: z.literal("frontend-typescript-v1"), industry: requiredText(120), specialization: z.literal("Frontend / TypeScript"),
  answers: z.object({ typescript: answer, state: answer, accessibility: answer, performance: answer, architecture: answer, ownership: answer }).strict(),
}).strict();
export const ResumeQuestionnaireSchema = z.discriminatedUnion("version", [BackendQuestionnaireSchema, FrontendQuestionnaireSchema]);
export const SaveResumeSchema = z.object({
  summary: z.string().trim().max(3000),
  softSkills: z.array(requiredText(100)).max(20),
  experience: z.array(z.object({ company: requiredText(160), role: requiredText(160), start: month, end: month.nullable(), description: z.string().trim().max(2400) }).strict().refine(dateRange, { message: "Дата окончания не может быть раньше начала.", path: ["end"] })).max(10),
  projects: z.array(z.object({ title: requiredText(160), role: z.string().trim().max(160), description: z.string().trim().max(2400), url: safeUrl.nullable() }).strict()).max(10),
  education: z.array(z.object({ institution: requiredText(200), qualification: requiredText(200), start: educationDate, end: educationDate.nullable() }).strict().refine(dateRange, { message: "Дата окончания не может быть раньше начала.", path: ["end"] })).max(5),
  portfolio: z.array(z.object({ title: requiredText(100), url: safeUrl }).strict()).max(8),
  questionnaire: ResumeQuestionnaireSchema,
}).strict();
export type ResumeInput = z.infer<typeof SaveResumeSchema>;
export const CreateResumeSchema = z.object({
  title: requiredText(120), specialization: z.enum(["Backend / Python", "Frontend / TypeScript"]),
  copyFromId: postgresIntIdSchema.optional(),
}).strict();
export const CopyResumeSchema = z.object({ title: requiredText(120).optional() }).strict();
export const ResumeMetadataSchema = z.object({
  title: requiredText(120).optional(), visibility: z.enum(["private", "pseudonymous", "public"]).optional(),
  consentMatching: z.boolean().optional(), consentCatalog: z.boolean().optional(), readyForOffers: z.boolean().optional(),
  revision: postgresIntIdSchema.optional(),
}).strict().refine(value => Object.keys(value).some(key => key !== "revision"), "Укажите изменяемые поля.");
export const VersionedSaveResumeSchema = SaveResumeSchema.extend({ revision: postgresIntIdSchema.optional() });
export type ResumeRecommendation = { grade: "Junior" | "Middle" | "Senior" | null; completedCount: number; totalQuestions: number; explanation: string };

export function emptyResume(specialization = "Backend / Python"): ResumeInput {
  return { summary: "", softSkills: [], experience: [], projects: [], education: [], portfolio: [], questionnaire: specialization === "Frontend / TypeScript" ? { version: "frontend-typescript-v1", industry: "Информационные технологии", specialization: "Frontend / TypeScript", answers: { typescript: null, state: null, accessibility: null, performance: null, architecture: null, ownership: null } } : { version: "backend-python-v1", industry: "Информационные технологии", specialization: "Backend / Python", answers: { python: null, databases: null, api: null, testing: null, reliability: null, ownership: null } } };
}

/** Self-reported answers choose a starting assessment; they never verify a grade. */
export function recommendResumeGrade(questionnaire: ResumeInput["questionnaire"]): ResumeRecommendation {
  const values = Object.values(questionnaire.answers);
  const completedCount = values.filter((value) => value !== null).length;
  const base = { completedCount, totalQuestions: resumeQuestions.length };
  if (completedCount !== resumeQuestions.length) return { ...base, grade: null, explanation: "Опрос поможет рекомендовать стартовый уровень. Проверку и уровень можно выбрать самостоятельно." };
  const numbers = values as number[];
  const score = numbers.reduce((sum, value) => sum + value, 0);
  const language = "python" in questionnaire.answers ? questionnaire.answers.python : questionnaire.answers.typescript;
  const { ownership } = questionnaire.answers;
  const grade = score >= 15 && numbers.every((value) => value >= 2) && ownership === 3
    ? "Senior" : score >= 9 && language! >= 2 && numbers.every((value) => value >= 1) ? "Middle" : "Junior";
  return { ...base, grade, explanation: `Начните с проверки ${grade}. Это рекомендация по вашим ответам, а не подтверждённая категория.` };
}

export function appendResumeQuestionnaireHistory(history: SignalResumeQuestionnaireHistory[], questionnaire: ResumeInput["questionnaire"], completedAt = new Date().toISOString()): SignalResumeQuestionnaireHistory[] {
  const recommendedGrade = recommendResumeGrade(questionnaire).grade;
  // PostgreSQL JSONB may reorder object keys. Compare values, never serialized key order.
  if (!recommendedGrade || isDeepStrictEqual(history.at(-1)?.questionnaire, questionnaire)) return history;
  return [...history, { completedAt, recommendedGrade, questionnaire }].slice(-20);
}

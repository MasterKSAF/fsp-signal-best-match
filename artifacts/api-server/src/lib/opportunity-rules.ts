import { z } from "zod";
import { RequirementModeSchema } from './recruiting-requirements';
export const jobInput = z
  .object({
    title: z.string().trim().min(3).max(160),
    description: z.string().trim().min(30).max(6000),
    specialization: z.string().trim().min(2).max(100),
    grade: z.enum(["Junior", "Middle", "Senior"]),
    gradeMode: RequirementModeSchema.optional(),
    skills: z.array(z.string().trim().min(1).max(60)).max(20),
    workFormat: z.enum(["Удалённо", "Офис", "Гибрид"]),
    salaryMin: z.number().int().positive().max(100000000),
    salaryMax: z.number().int().positive().max(100000000),
    salaryPeriod: z.enum(["month", "year"]),
    salaryType: z.enum(["gross", "net"]),
  })
  .strict()
  .refine((v) => v.salaryMin <= v.salaryMax, {
    message: "Проверьте зарплатную вилку.",
  });
export const microInput = z
  .object({
    title: z.string().trim().min(3).max(160),
    competency: z.string().trim().min(2).max(100),
    scenario: z.string().trim().min(50).max(6000),
    expectedMinutes: z.number().int().min(5).max(45),
    intervalDays: z.number().int().min(7).max(90),
    deadlineDays: z.number().int().min(1).max(7),
    educationalOnly: z.literal(true),
    rubric: z
      .array(
        z
          .object({
            id: z.string().regex(/^[a-z0-9-]{1,40}$/),
            label: z.string().trim().min(3).max(200),
            maxPoints: z.number().int().min(1).max(10),
          })
          .strict(),
      )
      .min(1)
      .max(6),
  })
  .strict()
  .refine((v) => new Set(v.rubric.map((r) => r.id)).size === v.rubric.length, {
    message: "Критерии должны иметь разные ID.",
  });
export const DAY = 86400000;
export const MICRO_LIMITS =
  "Учебная ситуация; результат оценивает автор задания. Проверена только указанная компетенция в рамках этой рубрики. Общая категория Signal не изменяется; контакты не передаются.";
export function nextOfferDate(now: Date, intervalDays: number) {
  return new Date(now.getTime() + Math.max(7, intervalDays) * DAY);
}
export function canScheduleOffer(input: {
  enabled: boolean;
  active: boolean;
  templateActive: boolean;
  nextDueAt: Date;
  lastAnyOfferAt: Date | null;
  hasOpenOffer: boolean;
  now: Date;
}) {
  return (
    input.enabled &&
    input.active &&
    input.templateActive &&
    input.nextDueAt <= input.now &&
    !input.hasOpenOffer &&
    (!input.lastAnyOfferAt ||
      input.lastAnyOfferAt.getTime() + 7 * DAY <= input.now.getTime())
  );
}
export function jobTransitionAllowed(from: string, to: string) {
  return (
    from === to ||
    (
      {
        draft: ["published", "archived"],
        published: ["closed"],
        closed: ["published", "archived"],
        archived: [],
      } as Record<string, string[]>
    )[from]?.includes(to) === true
  );
}

import { z } from "zod";
import { postgresIntIdSchema } from "./postgres-id";
export const ComplaintCategorySchema = z.enum(["spam", "misleading", "discrimination", "inappropriate", "privacy", "other"]);
const safeText = (min: number, max: number) => z.string().trim().min(min).max(max).refine(value => !/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/.test(value), "Недопустимые управляющие символы.");
export const SubmitComplaintSchema = z.object({ objectType: z.enum(["company", "job", "invitation"]), objectId: postgresIntIdSchema, category: ComplaintCategorySchema, explanation: safeText(0, 2000).default(""), idempotencyKey: z.string().min(8).max(128).regex(/^[A-Za-z0-9_-]+$/) }).strict();
export const ComplaintDecisionSchema = z.object({ action: z.enum(["review", "dismiss", "restrict"]), reason: safeText(5, 2000), scope: z.enum(["invitations", "contacts", "publishing", "all"]).default("all"), durationHours: z.number().int().min(1).max(720).default(168), publicReasonCode: ComplaintCategorySchema.default("other") }).strict();
export const ReasonSchema = z.object({ reason: safeText(5, 2000) }).strict();
export const AppealSchema = z.object({ explanation: safeText(5, 2000) }).strict();
export const AppealDecisionSchema = z.object({ action: z.enum(["accept", "reject"]), reason: safeText(5, 2000) }).strict();
export const BlockCompanySchema = z.object({ blocked: z.boolean() }).strict();
export const publicRestrictionReasons: Record<z.infer<typeof ComplaintCategorySchema>, string> = {
  spam: "Ограничение по решению модератора: нежелательные повторные обращения.",
  misleading: "Ограничение по решению модератора: недостоверные условия предложения.",
  discrimination: "Ограничение по решению модератора: недопустимые условия взаимодействия.",
  inappropriate: "Ограничение по решению модератора: нарушение правил общения.",
  privacy: "Ограничение по решению модератора: нарушение правил доступа к сведениям.",
  other: "Временное ограничение по решению модератора. Решение можно оспорить.",
};
export const COMPLAINT_LIMIT_PER_24H = 10;
export const TRUST_WINDOW_MS = 24 * 60 * 60 * 1000;
export function complaintTransitionAllowed(from: string, action: "review" | "dismiss" | "restrict") {
  return ["submitted", "in_review"].includes(from) || action === "review" && from === "in_review";
}

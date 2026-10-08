import { createHash } from "node:crypto";
import { z } from "zod";
import type { SignalPoolScope } from "./signal-pool-scope";

const queryNumber = (schema: z.ZodType<number>) => z.preprocess(value => typeof value === "string" ? Number(value) : value, schema);
export const microRecipientQuery = z.object({
  templateId: queryNumber(z.number().int().positive().max(2_147_483_647)).optional(),
  search: z.string().max(100).optional().default(""),
  grade: z.enum(["Junior", "Middle", "Senior"]).optional(),
  limit: queryNumber(z.number().int().min(1).max(50)).optional().default(25),
  cursor: z.string().min(1).max(512).optional(),
}).strict();

export function recipientSearch(value: string) {
  return value.normalize("NFKC").trim().replace(/\s+/gu, " ");
}

/** The cursor contains only the last permitted resume ID, never pool totals. */
export function recipientCursorContext(input: { companyId: number; scope: SignalPoolScope;
  templateId?: number; specialization: string | null; search: string; grade?: string }) {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex").slice(0, 32);
}

export function encodeRecipientCursor(after: number, context: string) {
  return Buffer.from(JSON.stringify({ v: 1, after, context })).toString("base64url");
}

export function decodeRecipientCursor(cursor: string | undefined, context: string): number | null {
  if (!cursor) return null;
  try {
    const value = z.object({ v: z.literal(1), after: z.number().int().positive().max(2_147_483_647),
      context: z.literal(context) }).strict().parse(JSON.parse(Buffer.from(cursor, "base64url").toString("utf8")));
    return value.after;
  } catch {
    throw new Error("Параметры поиска изменились. Начните поиск резюме заново.");
  }
}

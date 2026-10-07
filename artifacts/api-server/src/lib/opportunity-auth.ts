import { eq } from "drizzle-orm";
import type { Request, Response } from "express";
import { db, signalCompaniesTable } from "@workspace/db";
import { getSessionUser } from "./signal-auth";
import { parsePostgresIntId } from "./postgres-id";
export async function opportunityActor(
  req: Request,
  res: Response,
  role: "candidate" | "employer",
) {
  const session = await getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Войдите в аккаунт." });
    return null;
  }
  if (session.user.role !== role) {
    res.status(403).json({ error: "Недостаточно прав." });
    return null;
  }
  const [company] =
    role === "employer"
      ? await db
          .select()
          .from(signalCompaniesTable)
          .where(eq(signalCompaniesTable.ownerUserId, session.user.id))
          .limit(1)
      : [];
  if (role === "employer" && !company) {
    res.status(404).json({ error: "Компания не найдена." });
    return null;
  }
  return { userId: session.user.id, demoMode: session.demoMode, reviewScopeId: session.reviewScopeId, company };
}
export function positiveId(value: unknown) {
  return parsePostgresIntId(value) ?? 0;
}

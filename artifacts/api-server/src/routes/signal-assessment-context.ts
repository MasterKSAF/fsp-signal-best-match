import { and, desc, eq, inArray } from "drizzle-orm";
import { Router, type IRouter } from "express";
import {
  db, signalAssessmentAttemptsTable, signalAssessmentContextsTable,
  signalCompaniesTable, signalInvitationsTable, signalNeedsTable,
} from "@workspace/db";
import { getSessionUser } from "../lib/signal-auth";
import { listAssessmentContexts, selectContextForNeed, snapshotForNeed } from "../lib/assessment-context";
import { isProgramId, programSpecialization } from "../lib/assessment-managed";
import { postgresIntIdParam, parsePostgresIntId } from "../lib/postgres-id";

const router: IRouter = Router();
router.param("id", postgresIntIdParam);
export const activeContextInvitationStatuses = ["sent", "viewed", "accepted"] as const;

export async function getInvitedAssessmentNeed(userId: number, invitationId: number, reader: Pick<typeof db, "select"> = db) {
  const [row] = await reader.select({ need: signalNeedsTable })
    .from(signalInvitationsTable)
    .innerJoin(signalNeedsTable, eq(signalInvitationsTable.needId, signalNeedsTable.id))
    .where(and(
      eq(signalInvitationsTable.id, invitationId),
      eq(signalInvitationsTable.candidateUserId, userId),
      inArray(signalInvitationsTable.status, [...activeContextInvitationStatuses]),
      inArray(signalNeedsTable.specialization, ["Backend / Python", "Frontend / TypeScript"]),
    )).limit(1);
  return row?.need ?? null;
}

router.get("/assessments/contexts", async (req, res) => {
  const session = await getSessionUser(req);
  if (!session) { res.status(401).json({ error: "Войдите в аккаунт кандидата." }); return; }
  if (session.user.role !== "candidate") { res.status(403).json({ error: "Этот раздел доступен кандидату." }); return; }
  const programId = req.query.programId ?? "backend-python";
  if (!isProgramId(programId)) { res.status(400).json({ error: "Неизвестная программа проверки." }); return; }
  const rows = await db.select({ id: signalInvitationsTable.id, need: signalNeedsTable })
    .from(signalInvitationsTable)
    .innerJoin(signalNeedsTable, eq(signalInvitationsTable.needId, signalNeedsTable.id))
    .where(and(eq(signalInvitationsTable.candidateUserId, session.user.id), inArray(signalInvitationsTable.status, [...activeContextInvitationStatuses]), eq(signalNeedsTable.specialization, programSpecialization(programId)!)))
    .orderBy(desc(signalInvitationsTable.createdAt)).limit(30);
  res.json({ profiles: listAssessmentContexts(programId), invitations: rows.map((row) => ({ id: row.id, title: row.need.title, snapshot: snapshotForNeed(row.need) })) });
});

router.get("/assessments/attempts/:id/context", async (req, res) => {
  const session = await getSessionUser(req);
  if (!session) { res.status(401).json({ error: "Войдите в аккаунт кандидата." }); return; }
  if (session.user.role !== "candidate") { res.status(403).json({ error: "Этот раздел доступен кандидату." }); return; }
  const attemptId = parsePostgresIntId(req.params.id);
  if (attemptId === null) { res.status(400).json({ error: "Некорректный номер проверки." }); return; }
  const [row] = await db.select({ id: signalAssessmentAttemptsTable.id, snapshot: signalAssessmentContextsTable.snapshot })
    .from(signalAssessmentAttemptsTable)
    .leftJoin(signalAssessmentContextsTable, eq(signalAssessmentContextsTable.attemptId, signalAssessmentAttemptsTable.id))
    .where(and(eq(signalAssessmentAttemptsTable.id, attemptId), eq(signalAssessmentAttemptsTable.userId, session.user.id), eq(signalAssessmentAttemptsTable.purpose, "signal_qualification"))).limit(1);
  if (!row) { res.status(404).json({ error: "Проверка не найдена." }); return; }
  res.json({ snapshot: row.snapshot ?? null });
});

router.get("/employer/needs/:id/assessment-context", async (req, res) => {
  const session = await getSessionUser(req);
  if (!session) { res.status(401).json({ error: "Войдите в аккаунт работодателя." }); return; }
  if (session.user.role !== "employer") { res.status(403).json({ error: "Этот раздел доступен работодателю." }); return; }
  const needId = parsePostgresIntId(req.params.id);
  if (needId === null) { res.status(400).json({ error: "Некорректный номер потребности." }); return; }
  const [row] = await db.select({ need: signalNeedsTable }).from(signalNeedsTable)
    .innerJoin(signalCompaniesTable, eq(signalCompaniesTable.id, signalNeedsTable.companyId))
    .where(and(eq(signalNeedsTable.id, needId), eq(signalCompaniesTable.ownerUserId, session.user.id))).limit(1);
  if (!row) { res.status(404).json({ error: "Потребность не найдена." }); return; }
  res.json(selectContextForNeed(row.need));
});

export default router;

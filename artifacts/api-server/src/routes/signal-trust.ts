import { createHash } from "node:crypto";
import { Router, type IRouter, type Request, type Response } from "express";
import { and, asc, desc, eq, gt, isNull, ne, or, sql } from "drizzle-orm";
import { db, signalApplicationsTable, signalCompaniesTable, signalCompanyBlocksTable, signalComplaintRequestsTable, signalComplaintsTable, signalContactGrantsTable, signalEmployerRestrictionsTable, signalInvitationsTable, signalJobsTable, signalMicroOffersTable, signalRestrictionAppealsTable, signalTrustAuditTable, signalUsersTable } from "@workspace/db";
import { getSessionUser, type AuthenticatedSignalSession } from "../lib/signal-auth";
import { isSignalModerator } from "../lib/signal-trust";
import { AppealDecisionSchema, AppealSchema, BlockCompanySchema, COMPLAINT_LIMIT_PER_24H, ComplaintDecisionSchema, complaintTransitionAllowed, publicRestrictionReasons, ReasonSchema, SubmitComplaintSchema, TRUST_WINDOW_MS } from "../lib/signal-trust-contract";
import { postgresIntIdParam, postgresIntIdTextSchema } from "../lib/postgres-id";
import { signalPoolPredicate } from "../lib/signal-pool-scope";
const router: IRouter = Router();
router.param("id", postgresIntIdParam);
type Reader = Pick<typeof db, "select">;
type Writer = Pick<typeof db, "select" | "insert" | "update" | "execute">;
type Complaint = typeof signalComplaintsTable.$inferSelect;
async function actor(req: Request, res: Response, role?: "candidate" | "employer" | "moderator"): Promise<AuthenticatedSignalSession | null> {
  const session = await getSessionUser(req);
  if (!session) { res.status(401).json({ error: "Войдите в аккаунт." }); return null; }
  if (role === "moderator" ? !await isSignalModerator(session.user.id) : role && session.user.role !== role) { res.status(403).json({ error: "Недостаточно прав для этого действия." }); return null; }
  res.setHeader("Cache-Control", "no-store, private"); return session;
}
const paramId = (req: Request) => { const parsed = postgresIntIdTextSchema.safeParse(req.params.id); return parsed.success ? parsed.data : null; };
const missing = (res: Response) => res.status(404).json({ error: "Объект не найден или недоступен." });
const invalid = (res: Response) => res.status(400).json({ error: "Проверьте поля обращения." });
const conflict = (res: Response, error: string) => res.status(409).json({ error });
const complaintDto = (row: Complaint) => {
  const { id, companyId, objectType, objectId, category, explanation, status, decisionReason, createdAt, updatedAt } = row;
  return { id, companyId, objectType, objectId, category, explanation, status, decisionReason, createdAt, updatedAt };
};
async function companyForSession(companyId: number, session: AuthenticatedSignalSession, reader: Reader = db) {
  const [row] = await reader.select({ company: signalCompaniesTable }).from(signalCompaniesTable).innerJoin(signalUsersTable, eq(signalUsersTable.id, signalCompaniesTable.ownerUserId)).where(and(eq(signalCompaniesTable.id, companyId), signalPoolPredicate(signalUsersTable, session.user))).limit(1);
  return row?.company ?? null;
}
async function ownedCompany(userId: number, reader: Reader = db) {
  const [company] = await reader.select().from(signalCompaniesTable).where(eq(signalCompaniesTable.ownerUserId, userId)).limit(1); return company ?? null;
}
async function accessibleCompany(companyId: number, session: AuthenticatedSignalSession, reader: Reader = db) {
  const company = await companyForSession(companyId, session, reader); if (!company) return null;
  const [invitation] = await reader.select({ id: signalInvitationsTable.id }).from(signalInvitationsTable).where(and(eq(signalInvitationsTable.companyId, companyId), eq(signalInvitationsTable.candidateUserId, session.user.id))).limit(1);
  const [application] = await reader.select({ id: signalApplicationsTable.id }).from(signalApplicationsTable).where(and(eq(signalApplicationsTable.companyId, companyId), eq(signalApplicationsTable.candidateUserId, session.user.id))).limit(1);
  const [job] = await reader.select({ id: signalJobsTable.id }).from(signalJobsTable).where(and(eq(signalJobsTable.companyId, companyId), eq(signalJobsTable.status, "published"))).limit(1);
  // An addressed company task is a real relationship even before acceptance.
  // This never admits an unrelated company or another candidate's offer; the
  // company's exact account pool scope was already checked above.
  const [microOffer] = await reader.select({ id: signalMicroOffersTable.id }).from(signalMicroOffersTable).where(and(eq(signalMicroOffersTable.companyId, companyId), eq(signalMicroOffersTable.candidateUserId, session.user.id))).limit(1);
  return invitation || application || job || microOffer ? company : null;
}
async function complaintCompany(input: { objectType: string; objectId: number }, session: AuthenticatedSignalSession, reader: Reader) {
  if (input.objectType === "company") return accessibleCompany(input.objectId, session, reader);
  if (input.objectType === "invitation") {
    const [invitation] = await reader.select().from(signalInvitationsTable).where(and(eq(signalInvitationsTable.id, input.objectId), eq(signalInvitationsTable.candidateUserId, session.user.id))).limit(1);
    return invitation ? companyForSession(invitation.companyId, session, reader) : null;
  }
  const [job] = await reader.select().from(signalJobsTable).where(eq(signalJobsTable.id, input.objectId)).limit(1);
  if (!job) return null;
  if (job.status !== "published") {
    const [application] = await reader.select({ id: signalApplicationsTable.id }).from(signalApplicationsTable).where(and(eq(signalApplicationsTable.jobId, job.id), eq(signalApplicationsTable.candidateUserId, session.user.id))).limit(1);
    if (!application) return null;
  }
  return companyForSession(job.companyId, session, reader);
}
async function lockCompany(companyId: number, writer: Writer) { await writer.execute(sql`SELECT id FROM signal_companies WHERE id=${companyId} FOR UPDATE`); }
async function revokeContacts(companyId: number, writer: Writer, candidateId?: number) {
  await writer.update(signalContactGrantsTable).set({ revokedAt: new Date() }).where(and(eq(signalContactGrantsTable.companyId, companyId), isNull(signalContactGrantsTable.revokedAt), candidateId === undefined ? undefined : eq(signalContactGrantsTable.candidateUserId, candidateId)));
}
async function audit(writer: Writer, actorUserId: number, action: string, objectType: string, objectId: number, companyId: number | null, reason: string, details: Record<string, unknown> = {}) {
  await writer.insert(signalTrustAuditTable).values({ actorUserId, action, objectType, objectId, companyId, reason, details });
}

router.get("/me/trust-status", async (req, res): Promise<void> => { const session = await actor(req, res); if (session) res.json({ moderator: await isSignalModerator(session.user.id) }); });
router.get("/me/company-blocks", async (req, res): Promise<void> => {
  const session = await actor(req, res, "candidate"); if (!session) return;
  const blocks = await db.select({ id: signalCompanyBlocksTable.id, companyId: signalCompanyBlocksTable.companyId, companyName: signalCompaniesTable.name, active: signalCompanyBlocksTable.active, blockedAt: signalCompanyBlocksTable.blockedAt, unblockedAt: signalCompanyBlocksTable.unblockedAt }).from(signalCompanyBlocksTable).innerJoin(signalCompaniesTable, eq(signalCompanyBlocksTable.companyId, signalCompaniesTable.id)).where(eq(signalCompanyBlocksTable.candidateUserId, session.user.id)).orderBy(desc(signalCompanyBlocksTable.blockedAt));
  res.json({ blocks });
});
router.put("/me/companies/:id/block", async (req, res): Promise<void> => {
  const session = await actor(req, res, "candidate"); if (!session) return;
  const id = paramId(req); const parsed = BlockCompanySchema.safeParse(req.body); if (!id || !parsed.success) { invalid(res); return; }
  const result = await db.transaction(async tx => {
    await lockCompany(id, tx);
    const [previous] = await tx.select().from(signalCompanyBlocksTable).where(and(eq(signalCompanyBlocksTable.companyId, id), eq(signalCompanyBlocksTable.candidateUserId, session.user.id))).limit(1);
    if (!previous && !await accessibleCompany(id, session, tx)) return null;
    if (previous?.active === parsed.data.blocked) return previous;
    const now = new Date();
    const [block] = await tx.insert(signalCompanyBlocksTable).values({ candidateUserId: session.user.id, companyId: id, active: parsed.data.blocked, blockedAt: now, unblockedAt: parsed.data.blocked ? null : now }).onConflictDoUpdate({ target: [signalCompanyBlocksTable.candidateUserId, signalCompanyBlocksTable.companyId], set: { active: parsed.data.blocked, ...(parsed.data.blocked ? { blockedAt: now, unblockedAt: null } : { unblockedAt: now }) } }).returning();
    if (parsed.data.blocked) await revokeContacts(id, tx, session.user.id);
    await audit(tx, session.user.id, parsed.data.blocked ? "company_blocked" : "company_unblocked", "company", id, id, parsed.data.blocked ? "Личное решение кандидата. Все резюме аккаунта." : "Блокировка снята. Контактные согласия не восстанавливаются.");
    return block ?? null;
  });
  if (!result) { missing(res); return; } res.json({ companyId: result.companyId, blocked: result.active, blockedAt: result.blockedAt, unblockedAt: result.unblockedAt });
});
router.get("/me/complaints", async (req, res): Promise<void> => {
  const session = await actor(req, res); if (!session) return;
  const rows = await db.select().from(signalComplaintsTable).where(eq(signalComplaintsTable.reporterUserId, session.user.id)).orderBy(desc(signalComplaintsTable.createdAt));
  res.json({ complaints: rows.map(complaintDto) });
});
router.get("/me/complaints/:id", async (req, res): Promise<void> => {
  const session = await actor(req, res); if (!session) return;
  const id = paramId(req); if (!id) { missing(res); return; }
  const [row] = await db.select().from(signalComplaintsTable).where(and(eq(signalComplaintsTable.id,id),eq(signalComplaintsTable.reporterUserId,session.user.id))).limit(1);
  if (!row) { missing(res); return; } res.json({complaint:complaintDto(row)});
});
router.post("/me/complaints", async (req, res): Promise<void> => {
  const session = await actor(req, res); if (!session) return;
  const parsed = SubmitComplaintSchema.safeParse(req.body); if (!parsed.success) { invalid(res); return; }
  const { idempotencyKey, ...body } = parsed.data;
  if (body.objectType === "service" ? body.objectId !== session.user.id : session.user.role !== "candidate") { missing(res); return; }
  const bodyHash = createHash("sha256").update(JSON.stringify(body)).digest("hex");
  const result = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(4307,${session.user.id})`);
    const [receipt] = await tx.select().from(signalComplaintRequestsTable).where(and(eq(signalComplaintRequestsTable.reporterUserId, session.user.id), eq(signalComplaintRequestsTable.requestKey, idempotencyKey))).limit(1);
    if (receipt) {
      if (receipt.bodyHash !== bodyHash) return { kind: "conflict" as const };
      const [complaint] = await tx.select().from(signalComplaintsTable).where(and(eq(signalComplaintsTable.id, receipt.complaintId), eq(signalComplaintsTable.reporterUserId, session.user.id))).limit(1);
      return { kind: "saved" as const, complaint: complaint!, replayed: true };
    }
    const company = body.objectType === "service" ? null : await complaintCompany(body, session, tx); if (body.objectType !== "service" && !company) return { kind: "missing" as const };
    const [duplicate] = await tx.select().from(signalComplaintsTable).where(and(eq(signalComplaintsTable.reporterUserId, session.user.id), eq(signalComplaintsTable.objectType, body.objectType), eq(signalComplaintsTable.objectId, body.objectId), eq(signalComplaintsTable.category, body.category), body.objectType === "service" ? and(eq(signalComplaintsTable.explanation, body.explanation), gt(signalComplaintsTable.createdAt, new Date(Date.now()-300_000))) : undefined)).limit(1);
    if (duplicate) {
      await tx.insert(signalComplaintRequestsTable).values({ reporterUserId: session.user.id, requestKey: idempotencyKey, bodyHash, complaintId: duplicate.id });
      return { kind: "saved" as const, complaint: duplicate, replayed: true };
    }
    const since = new Date(Date.now() - TRUST_WINDOW_MS);
    const recent = await tx.select({ createdAt: signalComplaintsTable.createdAt }).from(signalComplaintsTable).where(and(eq(signalComplaintsTable.reporterUserId, session.user.id), gt(signalComplaintsTable.createdAt, since))).orderBy(asc(signalComplaintsTable.createdAt));
    if (recent.length >= COMPLAINT_LIMIT_PER_24H) return { kind: "rate" as const, retryAt: new Date(recent[0]!.createdAt.getTime() + TRUST_WINDOW_MS).toISOString() };
    const [complaint] = await tx.insert(signalComplaintsTable).values({ ...body, reporterUserId: session.user.id, companyId: company?.id ?? null }).returning();
    await tx.insert(signalComplaintRequestsTable).values({ reporterUserId: session.user.id, requestKey: idempotencyKey, bodyHash, complaintId: complaint!.id });
    await audit(tx, session.user.id, "complaint_submitted", "complaint", complaint!.id, company?.id ?? null, "Обращение сохранено; это не решение о нарушении.", { category: body.category, objectType: body.objectType, objectId: body.objectId });
    return { kind: "saved" as const, complaint: complaint!, replayed: false };
  });
  if (result.kind === "conflict") { conflict(res, "Ключ обращения уже использован с другим содержимым."); return; }
  if (result.kind === "missing") { missing(res); return; }
  if (result.kind === "rate") { res.status(429).json({ error: "Не более 10 новых обращений за 24 часа.", code: "COMPLAINT_RATE_LIMIT", retryAt: result.retryAt }); return; }
  res.status(result.replayed ? 200 : 201).json({ complaint: complaintDto(result.complaint), replayed: result.replayed });
});

router.get("/employer/restrictions", async (req, res): Promise<void> => {
  const session = await actor(req, res, "employer"); if (!session) return;
  const company = await ownedCompany(session.user.id); if (!company) { missing(res); return; }
  const rows = await db.select().from(signalEmployerRestrictionsTable).where(eq(signalEmployerRestrictionsTable.companyId, company.id)).orderBy(desc(signalEmployerRestrictionsTable.startsAt));
  const appeals = await db.select().from(signalRestrictionAppealsTable).where(eq(signalRestrictionAppealsTable.companyId, company.id));
  res.json({ restrictions: rows.map(row => ({ id: row.id, scope: row.scope, publicReason: row.publicReason, startsAt: row.startsAt, expiresAt: row.expiresAt, liftedAt: row.liftedAt,
    active: !row.liftedAt && row.startsAt <= new Date() && row.expiresAt > new Date(),
    appeal: appeals.find(appeal => appeal.restrictionId === row.id) ? (() => { const appeal = appeals.find(item => item.restrictionId === row.id)!; return { id: appeal.id, status: appeal.status, explanation: appeal.explanation, decisionReason: appeal.decisionReason, createdAt: appeal.createdAt, decidedAt: appeal.decidedAt }; })() : null })) });
});
router.post("/employer/restrictions/:id/appeals", async (req, res): Promise<void> => {
  const session = await actor(req, res, "employer"); if (!session) return;
  const id = paramId(req); const parsed = AppealSchema.safeParse(req.body); if (!id || !parsed.success) { invalid(res); return; }
  const result = await db.transaction(async tx => {
    const company = await ownedCompany(session.user.id, tx); if (!company) return { kind: "missing" as const };
    await lockCompany(company.id, tx);
    const [restriction] = await tx.select().from(signalEmployerRestrictionsTable).where(and(eq(signalEmployerRestrictionsTable.id, id), eq(signalEmployerRestrictionsTable.companyId, company.id))).limit(1);
    if (!restriction) return { kind: "missing" as const };
    const [previous] = await tx.select().from(signalRestrictionAppealsTable).where(eq(signalRestrictionAppealsTable.restrictionId, id)).limit(1);
    if (previous) return previous.explanation === parsed.data.explanation ? { kind: "saved" as const, appeal: previous, replayed: true } : { kind: "conflict" as const };
    const [appeal] = await tx.insert(signalRestrictionAppealsTable).values({ restrictionId: id, companyId: company.id, authorUserId: session.user.id, explanation: parsed.data.explanation }).returning();
    await audit(tx, session.user.id, "appeal_submitted", "appeal", appeal!.id, company.id, "Работодатель подал апелляцию.", { restrictionId: id });
    return { kind: "saved" as const, appeal: appeal!, replayed: false };
  });
  if (result.kind === "missing") { missing(res); return; } if (result.kind === "conflict") { conflict(res, "Апелляция по этому решению уже сохранена."); return; }
  res.status(result.replayed ? 200 : 201).json({ appeal: result.appeal, replayed: result.replayed });
});
router.get("/moderation/queue", async (req, res): Promise<void> => {
  const session = await actor(req, res, "moderator"); if (!session) return;
  const complaints = await db.select({ complaint: signalComplaintsTable, companyName: signalCompaniesTable.name }).from(signalComplaintsTable).leftJoin(signalCompaniesTable, eq(signalComplaintsTable.companyId, signalCompaniesTable.id)).innerJoin(signalUsersTable, eq(signalUsersTable.id, signalComplaintsTable.reporterUserId)).where(and(signalPoolPredicate(signalUsersTable, session.user), or(isNull(signalComplaintsTable.companyId), ne(signalCompaniesTable.ownerUserId, session.user.id)))).orderBy(asc(signalComplaintsTable.createdAt));
  const appeals = await db.select({ appeal: signalRestrictionAppealsTable, restriction: signalEmployerRestrictionsTable, companyName: signalCompaniesTable.name }).from(signalRestrictionAppealsTable).innerJoin(signalEmployerRestrictionsTable, eq(signalRestrictionAppealsTable.restrictionId, signalEmployerRestrictionsTable.id)).innerJoin(signalCompaniesTable, eq(signalCompaniesTable.id, signalRestrictionAppealsTable.companyId)).innerJoin(signalUsersTable, eq(signalUsersTable.id, signalCompaniesTable.ownerUserId)).where(and(signalPoolPredicate(signalUsersTable, session.user), ne(signalCompaniesTable.ownerUserId, session.user.id))).orderBy(asc(signalRestrictionAppealsTable.createdAt));
  res.json({ complaints: complaints.map(row => ({ ...complaintDto(row.complaint), companyName: row.companyName })), appeals: appeals.map(row => ({ ...row.appeal, restriction: row.restriction, companyName: row.companyName })) });
});
router.post("/moderation/complaints/:id/decision", async (req, res): Promise<void> => {
  const session = await actor(req, res, "moderator"); if (!session) return;
  const id = paramId(req); const parsed = ComplaintDecisionSchema.safeParse(req.body); if (!id || !parsed.success) { invalid(res); return; }
  const result = await db.transaction(async tx => {
    const [initial] = await tx.select().from(signalComplaintsTable).where(eq(signalComplaintsTable.id, id)).limit(1); if (!initial) return { kind: "missing" as const };
    if (initial.objectType === "service") {
      await tx.execute(sql`SELECT id FROM signal_complaints WHERE id=${id} FOR UPDATE`);
      const [complaint] = await tx.select().from(signalComplaintsTable).where(eq(signalComplaintsTable.id,id)).limit(1);
      const [reporter] = await tx.select({id:signalUsersTable.id}).from(signalUsersTable).where(and(eq(signalUsersTable.id,initial.reporterUserId),signalPoolPredicate(signalUsersTable,session.user))).limit(1);
      if (!reporter) return {kind:"missing" as const};
      if (initial.reporterUserId === session.user.id) return {kind:"self" as const};
      if (parsed.data.action === "restrict") return {kind:"conflict" as const};
      const status = parsed.data.action === "resolve" ? "resolved" : parsed.data.action === "dismiss" ? "dismissed" : "in_review";
      if (complaint!.status === status && complaint!.decisionReason === parsed.data.reason) return {kind:"saved" as const,complaint:complaint!,replayed:true};
      if (!complaintTransitionAllowed(complaint!.status,parsed.data.action)) return {kind:"conflict" as const};
      const [changed] = await tx.update(signalComplaintsTable).set({status,decisionReason:parsed.data.reason,moderatorUserId:session.user.id,updatedAt:new Date()}).where(eq(signalComplaintsTable.id,id)).returning();
      await audit(tx,session.user.id,`complaint_${status}`,"complaint",id,null,parsed.data.reason);
      return {kind:"saved" as const,complaint:changed!,replayed:false};
    }
    if (!initial.companyId || parsed.data.action === "resolve") return {kind:"conflict" as const};
    await lockCompany(initial.companyId, tx);
    const company = await companyForSession(initial.companyId, session, tx); if (!company) return { kind: "missing" as const };
    if (company.ownerUserId === session.user.id || initial.reporterUserId === session.user.id) return { kind: "self" as const };
    const [complaint] = await tx.select().from(signalComplaintsTable).where(eq(signalComplaintsTable.id, id)).limit(1);
    const input = parsed.data;
    const expectedStatus = input.action === "restrict" ? "upheld" : input.action === "dismiss" ? "dismissed" : "in_review";
    if (complaint!.status === expectedStatus && complaint!.decisionReason === input.reason) {
      if (input.action === "restrict") {
        const [existing] = await tx.select().from(signalEmployerRestrictionsTable).where(eq(signalEmployerRestrictionsTable.complaintId, id)).limit(1);
        if (!existing || existing.scope !== input.scope || existing.publicReason !== publicRestrictionReasons[input.publicReasonCode] || Math.round((existing.expiresAt.getTime() - existing.startsAt.getTime()) / 3_600_000) !== input.durationHours) return { kind: "conflict" as const };
      }
      return { kind: "saved" as const, complaint: complaint!, replayed: true };
    }
    if (!complaintTransitionAllowed(complaint!.status, input.action)) return { kind: "conflict" as const };
    const [changed] = await tx.update(signalComplaintsTable).set({ status: expectedStatus, decisionReason: input.reason, moderatorUserId: session.user.id, updatedAt: new Date() }).where(eq(signalComplaintsTable.id, id)).returning();
    if (input.action === "restrict") {
      const [restriction] = await tx.insert(signalEmployerRestrictionsTable).values({ companyId: company.id, complaintId: id, scope: input.scope, publicReason: publicRestrictionReasons[input.publicReasonCode], moderatorUserId: session.user.id, expiresAt: new Date(Date.now() + input.durationHours * 60 * 60 * 1000) }).returning();
      if (["contacts", "all"].includes(input.scope)) await revokeContacts(company.id, tx);
      await audit(tx, session.user.id, "restriction_created", "restriction", restriction!.id, company.id, input.reason, { complaintId: id, scope: input.scope, expiresAt: restriction!.expiresAt.toISOString(), publicReasonCode: input.publicReasonCode });
    }
    await audit(tx, session.user.id, `complaint_${expectedStatus}`, "complaint", id, company.id, input.reason, { previousStatus: complaint!.status, status: expectedStatus });
    return { kind: "saved" as const, complaint: changed!, replayed: false };
  });
  if (result.kind === "missing") { missing(res); return; } if (result.kind === "self") { res.status(403).json({ error: "Обращение должен рассмотреть другой модератор." }); return; }
  if (result.kind === "conflict") { conflict(res, "Дело уже рассмотрено. Для снятия ограничения используйте отдельное действие."); return; }
  res.json({ complaint: complaintDto(result.complaint), replayed: result.replayed });
});
router.post("/moderation/restrictions/:id/lift", async (req, res): Promise<void> => {
  const session = await actor(req, res, "moderator"); if (!session) return;
  const id = paramId(req); const parsed = ReasonSchema.safeParse(req.body); if (!id || !parsed.success) { invalid(res); return; }
  const result = await db.transaction(async tx => {
    const [initial] = await tx.select().from(signalEmployerRestrictionsTable).where(eq(signalEmployerRestrictionsTable.id, id)).limit(1); if (!initial) return { kind: "missing" as const };
    await lockCompany(initial.companyId, tx);
    const company = await companyForSession(initial.companyId, session, tx); if (!company) return { kind: "missing" as const };
    if (company.ownerUserId === session.user.id) return { kind: "self" as const };
    const [current] = await tx.select().from(signalEmployerRestrictionsTable).where(eq(signalEmployerRestrictionsTable.id, id)).limit(1);
    if (current!.liftedAt) return { kind: "saved" as const, restriction: current!, replayed: true };
    const [restriction] = await tx.update(signalEmployerRestrictionsTable).set({ liftedAt: new Date(), liftReason: parsed.data.reason, liftedByUserId: session.user.id }).where(eq(signalEmployerRestrictionsTable.id, id)).returning();
    await audit(tx, session.user.id, "restriction_lifted", "restriction", id, company.id, parsed.data.reason, { contactsRestored: false });
    return { kind: "saved" as const, restriction: restriction!, replayed: false };
  });
  if (result.kind === "missing") { missing(res); return; } if (result.kind === "self") { res.status(403).json({ error: "Собственное ограничение снимает другой модератор." }); return; }
  res.json({ restriction: result.restriction, replayed: result.replayed });
});
router.post("/moderation/appeals/:id/decision", async (req, res): Promise<void> => {
  const session = await actor(req, res, "moderator"); if (!session) return;
  const id = paramId(req); const parsed = AppealDecisionSchema.safeParse(req.body); if (!id || !parsed.success) { invalid(res); return; }
  const result = await db.transaction(async tx => {
    const [initial] = await tx.select().from(signalRestrictionAppealsTable).where(eq(signalRestrictionAppealsTable.id, id)).limit(1); if (!initial) return { kind: "missing" as const };
    await lockCompany(initial.companyId, tx);
    const company = await companyForSession(initial.companyId, session, tx); if (!company) return { kind: "missing" as const };
    const [restriction] = await tx.select().from(signalEmployerRestrictionsTable).where(eq(signalEmployerRestrictionsTable.id, initial.restrictionId)).limit(1);
    if (company.ownerUserId === session.user.id || restriction!.moderatorUserId === session.user.id) return { kind: "self" as const };
    const [appeal] = await tx.select().from(signalRestrictionAppealsTable).where(eq(signalRestrictionAppealsTable.id, id)).limit(1);
    const expected = parsed.data.action === "accept" ? "accepted" : "rejected";
    if (appeal!.status !== "submitted") return appeal!.status === expected && appeal!.decisionReason === parsed.data.reason ? { kind: "saved" as const, appeal: appeal!, replayed: true } : { kind: "conflict" as const };
    const [changed] = await tx.update(signalRestrictionAppealsTable).set({ status: expected, decisionReason: parsed.data.reason, moderatorUserId: session.user.id, decidedAt: new Date() }).where(eq(signalRestrictionAppealsTable.id, id)).returning();
    if (expected === "accepted" && !restriction!.liftedAt) {
      await tx.update(signalEmployerRestrictionsTable).set({ liftedAt: new Date(), liftReason: parsed.data.reason, liftedByUserId: session.user.id }).where(eq(signalEmployerRestrictionsTable.id, restriction!.id));
      await audit(tx, session.user.id, "restriction_lifted_on_appeal", "restriction", restriction!.id, company.id, parsed.data.reason, { appealId: id, contactsRestored: false });
    }
    await audit(tx, session.user.id, `appeal_${expected}`, "appeal", id, company.id, parsed.data.reason, { restrictionId: restriction!.id });
    return { kind: "saved" as const, appeal: changed!, replayed: false };
  });
  if (result.kind === "missing") { missing(res); return; } if (result.kind === "self") { res.status(403).json({ error: "Апелляцию рассматривает другой модератор, не связанный с работодателем." }); return; }
  if (result.kind === "conflict") { conflict(res, "Апелляция уже рассмотрена."); return; } res.json({ appeal: result.appeal, replayed: result.replayed });
});
router.get("/moderation/audit", async (req, res): Promise<void> => {
  const session = await actor(req, res, "moderator"); if (!session) return;
  // A moderator sees events from their pool only; audit has no contacts or raw complaints.
  const events = await db.select({ event: signalTrustAuditTable }).from(signalTrustAuditTable).innerJoin(signalCompaniesTable, eq(signalTrustAuditTable.companyId, signalCompaniesTable.id)).innerJoin(signalUsersTable, eq(signalCompaniesTable.ownerUserId, signalUsersTable.id)).where(and(signalPoolPredicate(signalUsersTable, session.user), ne(signalCompaniesTable.ownerUserId, session.user.id))).orderBy(desc(signalTrustAuditTable.createdAt)).limit(200);
  const serviceEvents = await db.select({ event: signalTrustAuditTable }).from(signalTrustAuditTable)
    .innerJoin(signalComplaintsTable, and(eq(signalTrustAuditTable.objectType, "complaint"), eq(signalTrustAuditTable.objectId, signalComplaintsTable.id), eq(signalComplaintsTable.objectType, "service")))
    .innerJoin(signalUsersTable, eq(signalUsersTable.id, signalComplaintsTable.reporterUserId))
    .where(and(isNull(signalTrustAuditTable.companyId), signalPoolPredicate(signalUsersTable, session.user)))
    .orderBy(desc(signalTrustAuditTable.createdAt)).limit(200);
  res.json({ events: [...events, ...serviceEvents].map(row => row.event).sort((a,b) => b.createdAt.getTime()-a.createdAt.getTime()).slice(0,200) });
});
export default router;

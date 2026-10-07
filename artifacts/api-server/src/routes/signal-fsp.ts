import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, signalCandidateProfilesTable } from "@workspace/db";
import { signalFspConnectionsTable } from "../../../../lib/db/src/schema/signal-fsp";
import { ensureCandidateProfile, getSessionUser } from "../lib/signal-auth";
import { isDemoModeEnabled } from "../lib/signal-runtime";
import { canUseFspExample, fspConsentVersion, fspDemoFixtureId, fspStatusMessage, fspSignalFromConnection, hasTrustedFspHistory, resolveFspSafely, validFspLinkInput, type FspProviderContext } from "../lib/fsp-provider";

const router: IRouter = Router();
type Connection = typeof signalFspConnectionsTable.$inferSelect;

async function candidate(req: Request, res: Response) {
  const session = await getSessionUser(req);
  if (!session) { res.status(401).json({ error: "Войдите в аккаунт кандидата." }); return null; }
  if (session.user.role !== "candidate") { res.status(403).json({ error: "Связь с ФСП доступна в профиле кандидата." }); return null; }
  await ensureCandidateProfile(session.user);
  return session.user;
}

function payload(row: Connection | undefined, context: FspProviderContext) {
  const disabledFixture = row?.status === "connected_demo" && !canUseFspExample(context);
  const status = disabledFixture ? "unavailable" : (row?.status ?? "unlinked");
  const fspSignal = fspSignalFromConnection(row, context);
  const trusted = fspSignal.historyStatus === 'trusted_results' || fspSignal.historyStatus === 'unresolved_results';
  return {
    status, fspId: row?.fspId ?? null,
    demoAvailable: canUseFspExample(context), demoFixtureId: canUseFspExample(context) ? fspDemoFixtureId : null,
    hasHistory: Boolean(trusted && row?.achievements.length), achievements: trusted ? row!.achievements : [],
    fspSignal,
    requestedAt: row?.requestedAt?.toISOString() ?? null,
    consentedAt: row?.consentedAt?.toISOString() ?? null,
    verifiedAt: trusted ? row!.verifiedAt!.toISOString() : null,
    importedAt: trusted ? row!.importedAt?.toISOString() ?? null : null,
    revokedAt: row?.revokedAt?.toISOString() ?? null,
    provenance: row?.provenance ?? null, providerVersion: row?.providerVersion ?? null,
    message: fspStatusMessage(status),
  };
}

router.get("/me/fsp-connection", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const [row] = await db.select().from(signalFspConnectionsTable).where(eq(signalFspConnectionsTable.userId, user.id));
  res.json(payload(row, { accountIsDemo: user.demoMode, demoEnabled: isDemoModeEnabled() }));
});

router.put("/me/fsp-connection", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const input = validFspLinkInput(req.body);
  if (!input) { res.status(400).json({ error: "Укажите ФСП ID длиной до 100 символов (латинские буквы, цифры, точка, двоеточие, дефис или подчёркивание) и согласитесь на импорт сведений." }); return; }
  const context = { accountIsDemo: user.demoMode, demoEnabled: isDemoModeEnabled() };
  if (input.fspId === fspDemoFixtureId && !canUseFspExample(context)) {
    res.status(400).json({ error: "Этот ID доступен только в аккаунте с примерами. Введите собственный ФСП ID." }); return;
  }
  const resolved = await resolveFspSafely(input.fspId, context);
  const row = await db.transaction(async (tx) => {
    // One lock per candidate serializes link, replacement and revoke, including
    // the first request before a connection row exists.
    await tx.select({ id: signalCandidateProfilesTable.userId }).from(signalCandidateProfilesTable).where(eq(signalCandidateProfilesTable.userId, user.id)).for("update");
    const [existing] = await tx.select().from(signalFspConnectionsTable).where(eq(signalFspConnectionsTable.userId, user.id));
    if (existing?.fspId === input.fspId && existing.status === resolved.status && existing.providerVersion === resolved.providerVersion && existing.consentVersion === fspConsentVersion && !!existing.consentedAt && !existing.revokedAt
      && existing.provenance === resolved.provenance && Boolean(existing.verifiedAt) === resolved.verified && existing.lastErrorCode === resolved.errorCode && JSON.stringify(existing.achievements) === JSON.stringify(resolved.achievements)) {
      const trustedHistory = hasTrustedFspHistory(resolved, context);
      await tx.update(signalCandidateProfilesTable).set({ hasFspHistory: trustedHistory }).where(and(eq(signalCandidateProfilesTable.userId, user.id), eq(signalCandidateProfilesTable.hasFspHistory, !trustedHistory)));
      return existing;
    }
    const now = new Date();
    const values = {
      fspId: input.fspId, status: resolved.status, consentVersion: fspConsentVersion,
      consentedAt: now, requestedAt: now, revokedAt: null,
      verifiedAt: resolved.verified ? now : null, importedAt: resolved.verified ? now : null,
      provenance: resolved.provenance, providerVersion: resolved.providerVersion,
      achievements: resolved.achievements, lastErrorCode: resolved.errorCode, updatedAt: now,
    };
    const [saved] = await tx.insert(signalFspConnectionsTable).values({ userId: user.id, ...values }).onConflictDoUpdate({ target: signalFspConnectionsTable.userId, set: values }).returning();
    await tx.update(signalCandidateProfilesTable).set({ hasFspHistory: hasTrustedFspHistory(resolved, context), updatedAt: now }).where(eq(signalCandidateProfilesTable.userId, user.id));
    return saved;
  });
  res.json(payload(row, context));
});

router.delete("/me/fsp-connection", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  const row = await db.transaction(async (tx) => {
    await tx.select({ id: signalCandidateProfilesTable.userId }).from(signalCandidateProfilesTable).where(eq(signalCandidateProfilesTable.userId, user.id)).for("update");
    const [existing] = await tx.select().from(signalFspConnectionsTable).where(eq(signalFspConnectionsTable.userId, user.id));
    const now = new Date();
    // Also revoke any legacy fixture flag; other profile/assessment data stays intact.
    await tx.update(signalCandidateProfilesTable).set({ hasFspHistory: false, updatedAt: now }).where(and(eq(signalCandidateProfilesTable.userId, user.id), eq(signalCandidateProfilesTable.hasFspHistory, true)));
    if (!existing || existing.status === "unlinked") return existing;
    const [saved] = await tx.update(signalFspConnectionsTable).set({
      fspId: null, status: "unlinked", achievements: [], provenance: null,
      providerVersion: null, verifiedAt: null, importedAt: null, requestedAt: null,
      revokedAt: now, lastErrorCode: null, updatedAt: now,
    }).where(eq(signalFspConnectionsTable.userId, user.id)).returning();
    return saved;
  });
  res.json(payload(row, { accountIsDemo: user.demoMode, demoEnabled: isDemoModeEnabled() }));
});

export default router;

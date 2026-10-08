import { and, eq } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { db, signalCandidateProfilesTable } from "@workspace/db";
import { signalFspConnectionsTable } from "../../../../lib/db/src/schema/signal-fsp";
import { ensureCandidateProfile, getSessionUser } from "../lib/signal-auth";
import { isDemoModeEnabled } from "../lib/signal-runtime";
import { canUseFspExample, fspStatusMessage, fspSignalFromConnection, savedFspIdentityValues, validFspSaveInput, type FspProviderContext } from "../lib/fsp-provider";

const router: IRouter = Router();
type Connection = typeof signalFspConnectionsTable.$inferSelect;

async function candidate(req: Request, res: Response) {
  const session = await getSessionUser(req);
  if (!session) { res.status(401).json({ error: "Войдите в аккаунт кандидата." }); return null; }
  if (session.user.role !== "candidate") { res.status(403).json({ error: "Связь с ФСП доступна в профиле кандидата." }); return null; }
  await ensureCandidateProfile(session.user);
  res.setHeader("Cache-Control", "no-store, private");
  return session.user;
}

function payload(row: Connection | undefined, context: FspProviderContext) {
  const disabledFixture = row?.status === "connected_demo" && !canUseFspExample(context);
  const status = disabledFixture ? "unavailable" : (row?.status ?? "unlinked");
  const fspSignal = fspSignalFromConnection(row, context);
  const trusted = fspSignal.historyStatus === 'trusted_results' || fspSignal.historyStatus === 'unresolved_results';
  return {
    status, fspId: row?.fspId ?? null,
    demoAvailable: false, demoFixtureId: null, importAvailable: false,
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
  const input = validFspSaveInput(req.body);
  if (!input) { res.status(400).json({ error: "Укажите ФСП ID длиной до 100 символов: латинские буквы, цифры, точка, двоеточие, дефис или подчёркивание." }); return; }
  const context = { accountIsDemo: user.demoMode, demoEnabled: isDemoModeEnabled() };
  const row = await db.transaction(async tx => {
    await tx.select({ id: signalCandidateProfilesTable.userId }).from(signalCandidateProfilesTable).where(eq(signalCandidateProfilesTable.userId, user.id)).for("update");
    // In particular, even an entered synthetic fixture ID remains an unverified opaque ID.
    const values = savedFspIdentityValues(input.fspId, new Date());
    const [saved] = await tx.insert(signalFspConnectionsTable).values({ userId: user.id, ...values }).onConflictDoUpdate({ target: signalFspConnectionsTable.userId, set: values }).returning();
    await tx.update(signalCandidateProfilesTable).set({ hasFspHistory: false, updatedAt: values.updatedAt }).where(eq(signalCandidateProfilesTable.userId, user.id));
    return saved;
  });
  res.json(payload(row, context));
});

router.post("/me/fsp-connection/import", async (req, res): Promise<void> => {
  const user = await candidate(req, res); if (!user) return;
  if (!req.body || Object.keys(req.body).some(key => key !== 'consentImport') || req.body.consentImport !== true) {
    res.status(400).json({ error: 'Для импорта нужно отдельное согласие на получение сведений ФСП.', code: 'fsp_import_consent_required' }); return;
  }
  const [row] = await db.select().from(signalFspConnectionsTable).where(eq(signalFspConnectionsTable.userId, user.id));
  if (!row?.fspId) { res.status(409).json({ error: 'Сначала сохраните ФСП ID.', code: 'fsp_id_required' }); return; }
  // No configured verified registry/ownership flow exists. Never turn consent into a fixture import.
  res.status(503).json({ error: 'Реестр ФСП ещё не подключён. ID сохранён без подтверждения и импорта.', code: 'registry_not_configured' });
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

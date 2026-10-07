import { and, eq, gt, isNull, lte, or } from "drizzle-orm";
import { db, signalCompanyBlocksTable, signalEmployerRestrictionsTable, signalModeratorPermissionsTable } from "@workspace/db";

export type TrustAction = "invitations" | "contacts" | "publishing";
export type CompanyActionDecision = { allowed: true } | { allowed: false; code: "COMPANY_BLOCKED" | "COMPANY_RESTRICTED"; publicReason: string; retryAt?: string };
export async function assertCompanyActionAllowed(companyId: number, candidateId?: number, reader: Pick<typeof db, "select"> = db, action: TrustAction = "invitations"): Promise<CompanyActionDecision> {
  if (candidateId !== undefined && action !== "publishing") {
    const [block] = await reader.select({ id: signalCompanyBlocksTable.id }).from(signalCompanyBlocksTable).where(and(eq(signalCompanyBlocksTable.companyId, companyId), eq(signalCompanyBlocksTable.candidateUserId, candidateId), eq(signalCompanyBlocksTable.active, true))).limit(1);
    if (block) return { allowed: false, code: "COMPANY_BLOCKED", publicReason: "Взаимодействие с этим кандидатом недоступно." };
  }
  const now = new Date();
  const restrictions = await reader.select().from(signalEmployerRestrictionsTable).where(and(eq(signalEmployerRestrictionsTable.companyId, companyId), isNull(signalEmployerRestrictionsTable.liftedAt), lte(signalEmployerRestrictionsTable.startsAt, now), gt(signalEmployerRestrictionsTable.expiresAt, now), or(eq(signalEmployerRestrictionsTable.scope, action), eq(signalEmployerRestrictionsTable.scope, "all"))));
  const restriction = restrictions.sort((a, b) => b.expiresAt.getTime() - a.expiresAt.getTime() || a.id - b.id)[0];
  return restriction ? { allowed: false, code: "COMPANY_RESTRICTED", publicReason: restriction.publicReason, retryAt: restriction.expiresAt.toISOString() } : { allowed: true };
}
export async function canReadCompanyCandidateContacts(companyId: number, candidateId: number, reader: Pick<typeof db, "select"> = db): Promise<boolean> {
  return (await assertCompanyActionAllowed(companyId, candidateId, reader, "contacts")).allowed;
}
export async function isSignalModerator(userId: number, reader: Pick<typeof db, "select"> = db): Promise<boolean> {
  const [permission] = await reader.select({ active: signalModeratorPermissionsTable.active }).from(signalModeratorPermissionsTable).where(eq(signalModeratorPermissionsTable.userId, userId)).limit(1);
  return permission?.active === true;
}

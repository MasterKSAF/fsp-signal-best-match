import { and, eq, isNull } from "drizzle-orm";
import {
  db,
  signalCandidateProfilesTable as profiles,
  signalContactGrantsTable as grants,
  signalUsersTable as users,
  signalCompaniesTable as companies,
} from "@workspace/db";
import { canReadCompanyCandidateContacts } from "./signal-trust";
import { signalPoolPredicate, type SignalScopedAccount } from "./signal-pool-scope";
export type ContactTransaction = Parameters<
  Parameters<typeof db.transaction>[0]
>[0];
export type ContactBasis =
  | { invitationId: number; applicationId?: never }
  | { applicationId: number; invitationId?: never };
export async function lockContactOwner(
  tx: ContactTransaction,
  candidateUserId: number,
) {
  await tx
    .select({ id: profiles.userId })
    .from(profiles)
    .where(eq(profiles.userId, candidateUserId))
    .for("update");
}
export async function createContactPermission(
  tx: ContactTransaction,
  candidateUserId: number,
  companyId: number,
  basis: ContactBasis,
) {
  await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
  if (!await canReadCompanyCandidateContacts(companyId, candidateUserId, tx)) return;
  // The parent transition and this insert run once, in one transaction. A replay
  // cannot reactivate a revoked row because the unique source is never updated.
  await tx
    .insert(grants)
    .values({ candidateUserId, companyId, ...basis })
    .onConflictDoNothing();
}
export async function revokeCompanyPermissions(
  tx: ContactTransaction,
  candidateUserId: number,
  companyId: number,
) {
  await lockContactOwner(tx, candidateUserId);
  return tx
    .update(grants)
    .set({ revokedAt: new Date() })
    .where(
      and(
        eq(grants.candidateUserId, candidateUserId),
        eq(grants.companyId, companyId),
        isNull(grants.revokedAt),
      ),
    )
    .returning();
}
export async function readPermittedContacts(
  tx: ContactTransaction,
  candidateUserId: number,
  companyId: number,
  scope: SignalScopedAccount | boolean,
  basis: ContactBasis,
) {
  await tx.select({ id: companies.id }).from(companies).where(eq(companies.id, companyId)).for("update");
  if (!await canReadCompanyCandidateContacts(companyId, candidateUserId, tx)) return null;
  await lockContactOwner(tx, candidateUserId);
  const [grant] = await tx
    .select()
    .from(grants)
    .where(
      and(
        eq(grants.candidateUserId, candidateUserId),
        eq(grants.companyId, companyId),
        isNull(grants.revokedAt),
        basis.invitationId !== undefined
          ? eq(grants.invitationId, basis.invitationId)
          : eq(grants.applicationId, basis.applicationId),
      ),
    )
    .limit(1);
  if (!grant) return null;
  const [candidate] = await tx
    .select({
      displayName: users.displayName,
      email: profiles.contactEmail,
      phone: profiles.phone,
    })
    .from(users)
    .innerJoin(profiles, eq(profiles.userId, users.id))
    .where(
      and(
        eq(users.id, candidateUserId),
        signalPoolPredicate(users, scope),
        eq(users.role, "candidate"),
      ),
    )
    .limit(1);
  return candidate?.email
    ? { ...candidate, consentedAt: grant.consentedAt.toISOString() }
    : null;
}

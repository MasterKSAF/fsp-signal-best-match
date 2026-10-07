import { and, eq, inArray, isNull, sql } from "drizzle-orm";
import { signalMicroSubscriptionsTable as subscriptions, signalMicroOffersTable as offers, signalMicroTemplatesTable as templates,
  signalCandidateResumesTable as resumes, signalCompaniesTable as companies, signalUsersTable as users } from "@workspace/db";
import { lockContactOwner, type ContactTransaction } from "./signal-contact-permissions";
import { microBindingAccessible, type MicroResumeBinding } from "./microtask-resume-policy";
export type MicrotaskResumeWriter = Pick<ContactTransaction, "select" | "update">;
/** Same order as resume editing: never hold the profile row before its resume lock. */
export async function lockMicrotaskOwner(tx: ContactTransaction, candidateUserId: number) {
  await tx.execute(sql`SELECT pg_advisory_xact_lock(3306,${candidateUserId})`);
  await lockContactOwner(tx, candidateUserId);
}

// Call under the existing candidate owner lock. Never take company locks here:
// company actions acquire company then candidate; reversing that would deadlock.
export async function revokeMicrotasksForResume(tx: MicrotaskResumeWriter, candidateUserId: number, resumeId: number, now = new Date()) {
  await tx.update(subscriptions).set({ active: false }).where(and(eq(subscriptions.candidateUserId, candidateUserId), eq(subscriptions.resumeId, resumeId)));
  await tx.update(offers).set({ shareResult: false, consentRevokedAt: now })
    .where(and(eq(offers.candidateUserId, candidateUserId), eq(offers.resumeId, resumeId), isNull(offers.consentRevokedAt)));
  await tx.update(offers).set({ status: "withdrawn" }).where(and(eq(offers.candidateUserId, candidateUserId), eq(offers.resumeId, resumeId), inArray(offers.status, ["offered", "accepted", "submitted"])));
}

export async function microBindingAvailable(tx: MicrotaskResumeWriter, binding: MicroResumeBinding, candidateUserId: number, companyId: number) {
  if (!binding.resumeId) return false;
  const [resume] = await tx.select().from(resumes).where(and(eq(resumes.id, binding.resumeId), eq(resumes.userId, candidateUserId)));
  const [candidate] = await tx.select({ demoMode: users.demoMode, reviewScopeId: users.reviewScopeId, role: users.role }).from(users).where(eq(users.id, candidateUserId));
  const [company] = await tx.select({ demoMode: users.demoMode, reviewScopeId: users.reviewScopeId, role: users.role }).from(companies)
    .innerJoin(users, eq(users.id, companies.ownerUserId)).where(eq(companies.id, companyId));
  return candidate?.role === "candidate" && company?.role === "employer" && microBindingAccessible(binding, resume, candidateUserId, candidate, company);
}

/** Qualification corrections reconcile all existing applications without inventing a new snapshot. */
export async function reconcileMicrotaskResume(tx: MicrotaskResumeWriter, candidateUserId: number, resumeId: number, now = new Date()) {
  const bound = await tx.select({ subscription: subscriptions, companyId: templates.companyId }).from(subscriptions)
    .innerJoin(templates, eq(templates.id, subscriptions.templateId))
    .where(and(eq(subscriptions.candidateUserId, candidateUserId), eq(subscriptions.resumeId, resumeId)));
  // Offers are independently bound: an inactive subscription can later select another resume.
  const history = await tx.select().from(offers).where(and(eq(offers.candidateUserId, candidateUserId), eq(offers.resumeId, resumeId), isNull(offers.consentRevokedAt)));
  for (const { subscription, companyId } of bound) {
    if (!await microBindingAvailable(tx, subscription, candidateUserId, companyId)) {
      await tx.update(subscriptions).set({ active: false }).where(eq(subscriptions.id, subscription.id));
    }
  }
  for (const offer of history) {
    if (!await microBindingAvailable(tx, offer, candidateUserId, offer.companyId)) {
      await tx.update(offers).set({ shareResult: false, consentRevokedAt: now,
        ...(["offered", "accepted", "submitted"].includes(offer.status) ? { status: "withdrawn" as const } : {}) })
        .where(eq(offers.id, offer.id));
    }
  }
}

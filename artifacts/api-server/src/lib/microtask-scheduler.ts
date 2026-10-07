import { and, desc, eq, gt, inArray, lte, or } from "drizzle-orm";
import {
  db,
  signalMicroSubscriptionsTable as subscriptions,
  signalMicroTemplatesTable as templates,
  signalMicroOffersTable as offers,
  signalMicroPreferencesTable as preferences,
  signalCompaniesTable as companies,
  signalCandidateProfilesTable as profiles,
  signalCandidateResumesTable as resumes,
  signalUsersTable as users,
} from "@workspace/db";
import {
  canScheduleOffer,
  DAY,
  MICRO_LIMITS,
  nextOfferDate,
} from "./opportunity-rules";
import { logger } from "./logger";
import { assertCompanyActionAllowed } from "./signal-trust";
import { captureMicroResume, microBindingAccessible } from "./microtask-resume-policy";
import { microBindingAvailable, reconcileMicrotaskResume, lockMicrotaskOwner } from "./microtask-resume";

/** Injected clock is a local test hook, never accepted from an HTTP request. */
export async function runMicrotaskScheduler(
  now = new Date(),
  fixtureCandidateIds?: number[],
) {
  if (fixtureCandidateIds && fixtureCandidateIds.length === 0)
    return { created: 0, checked: 0, ranAt: now.toISOString() };
  await db
    .update(offers)
    .set({ status: "expired" })
    .where(
      and(
        inArray(offers.status, ["offered", "accepted"]),
        lte(offers.dueAt, now),
        fixtureCandidateIds
          ? inArray(offers.candidateUserId, fixtureCandidateIds)
          : undefined,
      ),
    );
  let created = 0;
  let checked = 0;
  let after: { id: number; nextDueAt: Date } | null = null;
  // Page over the due-date/ID key, including ineligible rows. Blocked first pages
  // cannot starve later candidates; the oldest due program gets the weekly slot.
  while (true) {
    const due = await db
      .select({
        id: subscriptions.id,
        userId: subscriptions.candidateUserId,
        nextDueAt: subscriptions.nextDueAt,
      })
      .from(subscriptions)
      .where(
        and(
          eq(subscriptions.active, true),
          after
            ? or(
                gt(subscriptions.nextDueAt, after.nextDueAt),
                and(
                  eq(subscriptions.nextDueAt, after.nextDueAt),
                  gt(subscriptions.id, after.id),
                ),
              )
            : undefined,
          lte(subscriptions.nextDueAt, now),
          fixtureCandidateIds
            ? inArray(subscriptions.candidateUserId, fixtureCandidateIds)
            : undefined,
        ),
      )
      .orderBy(subscriptions.nextDueAt, subscriptions.id)
      .limit(100);
    if (!due.length) break;
    checked += due.length;
    after = due[due.length - 1];
    for (const item of due) {
      created += await db.transaction(async (tx) => {
        const [preview] = await tx.select({companyId: templates.companyId}).from(subscriptions).innerJoin(templates, eq(templates.id, subscriptions.templateId)).where(eq(subscriptions.id, item.id));
        if (!preview) return 0;
        await tx.select({id:companies.id}).from(companies).where(eq(companies.id, preview.companyId)).for("update");
        if (!(await assertCompanyActionAllowed(preview.companyId, item.userId, tx, "invitations")).allowed || !(await assertCompanyActionAllowed(preview.companyId, undefined, tx, "publishing")).allowed) return 0;
        await lockMicrotaskOwner(tx, item.userId);
        const [sub] = await tx
          .select()
          .from(subscriptions)
          .where(eq(subscriptions.id, item.id))
          .for("update");
        if (!sub?.active) return 0;
        const [template] = await tx
          .select()
          .from(templates)
          .where(eq(templates.id, sub.templateId))
          .for("share");
        if (!template?.active) return 0;
        const [pref] = await tx
          .select()
          .from(preferences)
          .where(eq(preferences.candidateUserId, item.userId));
        if (!pref?.enabled) return 0;
        if (sub.resumeId) await reconcileMicrotaskResume(tx, item.userId, sub.resumeId, now);
        const [candidate] = await tx
          .select({
            alias: profiles.professionalAlias,
            demoMode: users.demoMode,
            reviewScopeId: users.reviewScopeId,
          })
          .from(profiles)
          .innerJoin(users, eq(profiles.userId, users.id))
          .where(eq(profiles.userId, item.userId));
        const [company] = await tx
          .select({ name: companies.name, demoMode: users.demoMode, reviewScopeId: users.reviewScopeId })
          .from(companies)
          .innerJoin(users, eq(companies.ownerUserId, users.id))
          .where(eq(companies.id, template.companyId));
        const [resume] = sub.resumeId ? await tx.select().from(resumes)
          .where(and(eq(resumes.id, sub.resumeId), eq(resumes.userId, item.userId))) : [];
        if (!candidate || !company || !resume || !template.specialization ||
          resume.specialization !== template.specialization ||
          !microBindingAccessible(sub, resume, item.userId, candidate, company)) return 0;
        const [latest] = await tx
          .select({ createdAt: offers.createdAt })
          .from(offers)
          .where(eq(offers.candidateUserId, item.userId))
          .orderBy(desc(offers.createdAt))
          .limit(1);
        const openOffers = await tx
          .select()
          .from(offers)
          .where(
            and(
              eq(offers.candidateUserId, item.userId),
              inArray(offers.status, ["offered", "accepted"]),
            ),
          );
        for (const open of openOffers) {
          if (open.resumeProvenance === "captured" && !await microBindingAvailable(tx, open, item.userId, open.companyId)) {
            await tx.update(offers).set({ status: "withdrawn", consentRevokedAt: now, shareResult: false }).where(eq(offers.id, open.id));
          }
        }
        // Re-read after revocation: other resume/company pairs have their own fresh scope.
        const [remainingOpen] = await tx.select({ id: offers.id }).from(offers)
          .where(and(eq(offers.candidateUserId, item.userId), inArray(offers.status, ["offered", "accepted"]))).limit(1);
        if (
          !canScheduleOffer({
            enabled: pref?.enabled ?? false,
            active: sub.active,
            templateActive: template.active,
            nextDueAt: sub.nextDueAt,
            lastAnyOfferAt: latest?.createdAt ?? null,
            hasOpenOffer: !!remainingOpen,
            now,
          })
        )
          return 0;
        const [inserted] = await tx
          .insert(offers)
          .values({
            subscriptionId: sub.id,
            companyId: template.companyId,
            candidateUserId: item.userId,
            ...captureMicroResume(resume, candidate.alias),
            snapshot: {
              title: template.title,
              competency: template.competency,
              scenario: template.scenario,
              expectedMinutes: template.expectedMinutes,
              rubric: template.rubric,
              version: template.version,
              companyName: company.name,
              limits: MICRO_LIMITS,
            },
            scheduledFor: sub.nextDueAt,
            dueAt: new Date(now.getTime() + template.deadlineDays * DAY),
            createdAt: now,
          })
          .onConflictDoNothing()
          .returning({ id: offers.id });
        await tx
          .update(subscriptions)
          .set({
            nextDueAt: nextOfferDate(now, template.intervalDays),
            lastOfferedAt: now,
          })
          .where(eq(subscriptions.id, sub.id));
        return inserted ? 1 : 0;
      });
    }
  }
  return { created, checked, ranAt: now.toISOString() };
}
export function startMicrotaskScheduler() {
  let running = false;
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      await runMicrotaskScheduler();
    } catch (error) {
      logger.error(
        { schedulerError: error instanceof Error ? error.name : "unknown" },
        "Microtask scheduler failed",
      );
    } finally {
      running = false;
    }
  };
  void tick();
  const timer = setInterval(() => void tick(), 60000);
  timer.unref();
  return () => clearInterval(timer);
}

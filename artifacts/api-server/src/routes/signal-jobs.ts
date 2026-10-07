import { and, desc, eq, isNull } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { z } from "zod";
import {
  db,
  signalJobsTable as jobs,
  signalApplicationsTable as applications,
  signalCompaniesTable as companies,
  signalUsersTable as users,
  signalCandidateProfilesTable as profiles,
  signalContactGrantsTable as grants,
} from "@workspace/db";
import { opportunityActor, positiveId } from "../lib/opportunity-auth";
import { signalPoolPredicate, poolScopeForAccount } from "../lib/signal-pool-scope";
import { getSessionUser } from "../lib/signal-auth";
import { postgresIntIdParam, postgresIntIdSchema } from "../lib/postgres-id";
import {
  historicalResumeVisible,
  loadResumeCandidates,
  publicHistoricalSnapshot,
  resumeSnapshot,
} from "../lib/signal-resume-matching";
import { assertCompanyActionAllowed } from "../lib/signal-trust";
import { jobInput, jobTransitionAllowed } from "../lib/opportunity-rules";
import {
  createContactPermission,
  lockContactOwner,
  readPermittedContacts,
  revokeCompanyPermissions,
} from "../lib/signal-contact-permissions";
const router: IRouter = Router();
router.param("id", postgresIntIdParam);
const companyJoin = () =>
  db
    .select({ job: jobs, companyName: companies.name })
    .from(jobs)
    .innerJoin(companies, eq(jobs.companyId, companies.id))
    .innerJoin(users, eq(companies.ownerUserId, users.id));
const snapshot = (job: typeof jobs.$inferSelect, companyName: string) => ({
  version: job.version,
  title: job.title,
  companyName,
  description: job.description,
  specialization: job.specialization,
  grade: job.grade,
  skills: job.skills,
  workFormat: job.workFormat,
  salaryMin: job.salaryMin,
  salaryMax: job.salaryMax,
  salaryPeriod: job.salaryPeriod,
  salaryType: job.salaryType,
});
const publicJob = (row: {
  job: typeof jobs.$inferSelect;
  companyName: string;
}) => ({
  id: row.job.id,
  companyId: row.job.companyId,
  status: row.job.status,
  ...snapshot(row.job, row.companyName),
  publishedAt: row.job.publishedAt,
});

router.get("/public/jobs", async (req, res) => {
  const session = await getSessionUser(req);
  const scope = poolScopeForAccount(session?.user ?? false);
  const rows = await companyJoin()
    .where(and(eq(jobs.status, "published"), signalPoolPredicate(users, scope)))
    .orderBy(desc(jobs.publishedAt))
    .limit(200);
  res.json(rows.map(publicJob));
});
router.get("/public/jobs/:id", async (req, res) => {
  const session = await getSessionUser(req);
  const [row] = await companyJoin()
    .where(
      and(
        eq(jobs.id, positiveId(req.params.id)),
        eq(jobs.status, "published"),
        signalPoolPredicate(users, poolScopeForAccount(session?.user ?? false)),
      ),
    )
    .limit(1);
  if (!row) {
    res.status(404).json({ error: "Вакансия не найдена или закрыта." });
    return;
  }
  res.json(publicJob(row));
});
router.get("/employer/jobs", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  res.json(
    (
      await db
        .select()
        .from(jobs)
        .where(eq(jobs.companyId, actor.company.id))
        .orderBy(desc(jobs.updatedAt))
    ).map((job) => publicJob({ job, companyName: actor.company!.name })),
  );
});
router.post("/employer/jobs", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = jobInput.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({
      error: "Заполните условия, описание и зарплатную вилку в рублях.",
    });
    return;
  }
  const [job] = await db
    .insert(jobs)
    .values({ ...input.data, companyId: actor.company.id })
    .returning();
  res.status(201).json(publicJob({ job, companyName: actor.company.name }));
});
router.put("/employer/jobs/:id", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = jobInput.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Проверьте условия вакансии." });
    return;
  }
  const job = await db.transaction(async (tx) => {
    const [current] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.id, positiveId(req.params.id)),
          eq(jobs.companyId, actor.company!.id),
        ),
      )
      .for("update");
    if (!current || current.status === "archived") return null;
    const [updated] = await tx
      .update(jobs)
      .set({
        ...input.data,
        version: current.version + 1,
        updatedAt: new Date(),
      })
      .where(eq(jobs.id, current.id))
      .returning();
    return updated;
  });
  if (!job) {
    res.status(404).json({ error: "Вакансия недоступна для изменения." });
    return;
  }
  res.json(publicJob({ job, companyName: actor.company.name }));
});
router.post("/employer/jobs/:id/status", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = z
    .object({ status: z.enum(["published", "closed", "archived"]) })
    .strict()
    .safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Некорректный статус." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [job] = await tx
      .select()
      .from(jobs)
      .where(
        and(
          eq(jobs.id, positiveId(req.params.id)),
          eq(jobs.companyId, actor.company!.id),
        ),
      )
      .for("update");
    if (!job) return { code: 404 as const };
    if (input.data.status === "published") {
      const permission = await assertCompanyActionAllowed(
        actor.company!.id,
        undefined,
        tx,
        "publishing",
      );
      if (!permission.allowed)
        return {
          code: 403 as const,
          publicReason: permission.publicReason,
          restrictionCode: permission.code,
          retryAt: permission.retryAt,
        };
    }
    if (!jobTransitionAllowed(job.status, input.data.status))
      return { code: 409 as const };
    if (job.status === input.data.status) return { job };
    const [updated] = await tx
      .update(jobs)
      .set({
        status: input.data.status,
        updatedAt: new Date(),
        ...(input.data.status === "published"
          ? { publishedAt: new Date() }
          : {}),
      })
      .where(eq(jobs.id, job.id))
      .returning();
    return { job: updated };
  });
  if (!result.job) {
    res.status(result.code!).json({
      error: result.publicReason ?? "Этот переход недоступен.",
      code: result.restrictionCode ?? null,
      retryAt: result.retryAt ?? null,
    });
    return;
  }
  res.json(publicJob({ job: result.job, companyName: actor.company.name }));
});

router.post("/jobs/:id/applications", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const input = z
    .object({
      message: z.string().trim().max(2000).default(""),
      consentDisclosure: z.literal(true),
      companyId: postgresIntIdSchema,
      jobVersion: z.number().int().positive(),
      resumeId: postgresIntIdSchema,
    })
    .strict()
    .safeParse(req.body);
  if (!input.success) {
    res.status(400).json({
      error:
        "Подтвердите передачу имени, email, телефона и профессионального профиля выбранной компании.",
    });
    return;
  }
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: companies.id })
      .from(companies)
      .where(eq(companies.id, input.data.companyId))
      .for("update");
    await lockContactOwner(tx, actor.userId);
    const permission = await assertCompanyActionAllowed(
      input.data.companyId,
      actor.userId,
      tx,
      "contacts",
    );
    if (!permission.allowed)
      return {
        error: 403,
        code: permission.code,
        publicReason: permission.publicReason,
        retryAt: permission.retryAt,
      };
    const [resume] = await loadResumeCandidates(
      actor,
      { purpose: "owned", userId: actor.userId, resumeId: input.data.resumeId },
      tx,
    );
    if (!resume) return { error: 404 };
    const [existing] = await tx
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.jobId, positiveId(req.params.id)),
          eq(applications.candidateUserId, actor.userId),
        ),
      )
      .limit(1);
    if (existing)
      return existing.companyId !== input.data.companyId
        ? { error: 404 }
        : existing.resumeId !== input.data.resumeId
          ? {
              error: 409,
              code: "ALREADY_APPLIED_WITH_RESUME",
              publicReason:
                "На эту вакансию уже отправлен отклик с другим резюме.",
            }
          : { application: existing, created: false };
    const [job] = await tx
      .select()
      .from(jobs)
      .where(eq(jobs.id, positiveId(req.params.id)))
      .for("update");
    if (
      !job ||
      job.status !== "published" ||
      job.companyId !== input.data.companyId
    )
      return { error: 404 };
    if (job.version !== input.data.jobVersion) return { error: 409 };
    const [company] = await tx
      .select({ name: companies.name })
      .from(companies)
      .innerJoin(users, eq(companies.ownerUserId, users.id))
      .where(
        and(
          eq(companies.id, job.companyId),
          signalPoolPredicate(users, actor),
        ),
      )
      .limit(1);
    if (!company) return { error: 404 };
    const [application] = await tx
      .insert(applications)
      .values({
        jobId: job.id,
        companyId: job.companyId,
        candidateUserId: actor.userId,
        message: input.data.message,
        snapshot: snapshot(job, company.name),
        resumeId: resume.resumeId,
        resumeSnapshot: resumeSnapshot(resume),
      })
      .returning();
    await createContactPermission(tx, actor.userId, job.companyId, {
      applicationId: application.id,
    });
    return { application, created: true };
  });
  if (!result.application) {
    res.status(result.error!).json({
      code: result.code ?? null,
      retryAt: result.retryAt ?? null,
      error:
        result.publicReason ??
        (result.error === 409
          ? "Условия изменились. Откройте вакансию заново и подтвердите актуальные условия."
          : "Вакансия не принимает отклики."),
    });
    return;
  }
  res.status(result.created ? 201 : 200).json(result.application);
});

router.get("/me/applications", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const rows = await db
    .select({ application: applications, contactShared: grants.id })
    .from(applications)
    .leftJoin(
      grants,
      and(eq(grants.applicationId, applications.id), isNull(grants.revokedAt)),
    )
    .where(eq(applications.candidateUserId, actor.userId))
    .orderBy(desc(applications.createdAt));
  res.json(
    rows.map((r) => ({ ...r.application, contactShared: !!r.contactShared })),
  );
});
router.get("/employer/applications", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const rows = await db
    .select({
      application: applications,
      alias: profiles.professionalAlias,
      specialization: profiles.specialization,
      verifiedGrade: profiles.verifiedGrade,
      contactShared: grants.id,
    })
    .from(applications)
    .innerJoin(users, eq(users.id, applications.candidateUserId))
    .innerJoin(profiles, eq(profiles.userId, applications.candidateUserId))
    .leftJoin(
      grants,
      and(eq(grants.applicationId, applications.id), isNull(grants.revokedAt)),
    )
    .where(
      and(
        eq(applications.companyId, actor.company.id),
        signalPoolPredicate(users, actor),
      ),
    )
    .orderBy(desc(applications.createdAt));
  // A revoked application still has its non-identifying lifecycle and original job
  // conditions; professional profile details and the cover message are withheld.
  res.setHeader("Cache-Control", "no-store");
  res.json(
    await Promise.all(
      rows.map(async (r) => {
        const permission = await assertCompanyActionAllowed(
          actor.company!.id,
          r.application.candidateUserId,
          db,
          "contacts",
        );
        const visible =
          r.contactShared &&
          permission.allowed &&
          (await historicalResumeVisible(
            r.application.candidateUserId,
            r.application.resumeId,
            actor,
          ));
        const professional = visible
          ? publicHistoricalSnapshot(r.application.resumeSnapshot)
          : null;
        return {
          ...r.application,
          candidateUserId: undefined,
          resumeSnapshot: professional,
          message: visible ? r.application.message : "",
          candidate: professional
            ? {
                alias: r.alias,
                specialization: professional.specialization,
                verifiedGrade: professional.verifiedGrade,
                resumeId: professional.resumeId,
                resumeRevision: professional.revision,
              }
            : null,
          contactShared: !!r.contactShared && permission.allowed,
        };
      }),
    ),
  );
});
router.post("/employer/applications/:id/status", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const input = z
    .object({ status: z.enum(["viewed", "shortlisted", "declined"]) })
    .strict()
    .safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Некорректный статус." });
    return;
  }
  const result = await db.transaction(async (tx) => {
    const [row] = await tx
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.id, positiveId(req.params.id)),
          eq(applications.companyId, actor.company!.id),
        ),
      )
      .for("update");
    if (!row) return null;
    if (row.status === input.data.status) return row;
    if (
      ["withdrawn", "declined"].includes(row.status) ||
      (input.data.status === "viewed" && row.status !== "sent")
    )
      return null;
    const [updated] = await tx
      .update(applications)
      .set({ status: input.data.status, updatedAt: new Date() })
      .where(eq(applications.id, row.id))
      .returning();
    return updated;
  });
  if (!result) {
    res.status(409).json({ error: "Отклик недоступен для этого действия." });
    return;
  }
  res.json({ id: result.id, status: result.status, resumeId: result.resumeId });
});
router.get("/employer/applications/:id/contacts", async (req, res) => {
  const actor = await opportunityActor(req, res, "employer");
  if (!actor?.company) return;
  const [application] = await db
    .select()
    .from(applications)
    .where(
      and(
        eq(applications.id, positiveId(req.params.id)),
        eq(applications.companyId, actor.company.id),
      ),
    )
    .limit(1);
  const contact = application
    ? await db.transaction(async (tx) => {
        const permission = await assertCompanyActionAllowed(
          actor.company!.id,
          application.candidateUserId,
          tx,
          "contacts",
        );
        if (
          !permission.allowed ||
          !(await historicalResumeVisible(
            application.candidateUserId,
            application.resumeId,
            actor,
            tx,
          ))
        )
          return null;
        return readPermittedContacts(
          tx,
          application.candidateUserId,
          actor.company!.id,
          actor,
          { applicationId: application.id },
        );
      })
    : null;
  if (!contact) {
    res
      .status(403)
      .json({ error: "Доступ к контактам отсутствует или отозван." });
    return;
  }
  res.json(contact);
});
router.post("/me/applications/:id/withdraw", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  const row = await db.transaction(async (tx) => {
    await lockContactOwner(tx, actor.userId);
    const [application] = await tx
      .select()
      .from(applications)
      .where(
        and(
          eq(applications.id, positiveId(req.params.id)),
          eq(applications.candidateUserId, actor.userId),
        ),
      )
      .for("update");
    if (!application) return null;
    await revokeCompanyPermissions(tx, actor.userId, application.companyId);
    const [updated] = await tx
      .update(applications)
      .set({
        status: "withdrawn",
        updatedAt:
          application.status === "withdrawn"
            ? application.updatedAt
            : new Date(),
      })
      .where(eq(applications.id, application.id))
      .returning();
    return updated;
  });
  if (!row) {
    res.status(404).json({ error: "Отклик не найден." });
    return;
  }
  res.json(row);
});
router.get("/me/contact-permissions", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  res.json(
    await db
      .select({
        id: grants.id,
        companyId: grants.companyId,
        companyName: companies.name,
        invitationId: grants.invitationId,
        applicationId: grants.applicationId,
        consentedAt: grants.consentedAt,
        revokedAt: grants.revokedAt,
      })
      .from(grants)
      .innerJoin(companies, eq(companies.id, grants.companyId))
      .where(eq(grants.candidateUserId, actor.userId)),
  );
});
router.post("/me/contact-permissions/:id/revoke", async (req, res) => {
  const actor = await opportunityActor(req, res, "candidate");
  if (!actor) return;
  await db.transaction((tx) =>
    revokeCompanyPermissions(tx, actor.userId, positiveId(req.params.id)),
  );
  res.json({
    message:
      "Все основания доступа этой компании отозваны. Новая передача возможна только по новому явному действию.",
  });
});
export default router;

import { and, desc, eq, gt, inArray, isNull, lte } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import {
  CreateInvitationBody,
  CreateInvitationResponse,
  DecideInvitationBody,
  DecideInvitationParams,
  DecideInvitationResponse,
  GetInvitationContactsParams,
  GetInvitationContactsResponse,
  ListEmployerInvitationsResponse,
  ListMyInvitationsResponse,
  RevokeInvitationContactResponse,
  WithdrawInvitationParams,
  WithdrawInvitationResponse,
} from "@workspace/api-zod";
import {
  db,
  signalCandidateProfilesTable,
  signalCompaniesTable,
  signalContactGrantsTable,
  signalInvitationsTable,
  signalNeedsTable,
  signalUsersTable,
  signalInvitationRequestsTable,
} from "@workspace/db";
import { getSessionUser } from "../lib/signal-auth";
import {
  poolScopeForAccount,
  signalPoolPredicate,
  type SignalPoolScope,
} from "../lib/signal-pool-scope";
import { postgresIntIdParam, postgresIntIdSchema } from "../lib/postgres-id";
import { withAssessmentRankingEvidence } from "../lib/assessment-ranking-evidence";
import {
  historicalResumeVisible,
  loadResumeCandidates,
  publicHistoricalSnapshot,
  resumeSnapshot,
} from "../lib/signal-resume-matching";
import {
  invitationBodyHash,
  invitationQuotaLimit,
  quotaRetryAt,
  closedInvitationRetryAt,
  INVITATION_WINDOW_MS,
} from "../lib/signal-invitation-policy";
import { assertCompanyActionAllowed } from "../lib/signal-trust";
import {
  createContactPermission,
  lockContactOwner,
  readPermittedContacts,
  revokeCompanyPermissions,
} from "../lib/signal-contact-permissions";
import {
  evaluateMatch,
  type MatchCandidate,
  type MatchNeed,
  type SignalGrade,
} from "../lib/signal-matching";

const router: IRouter = Router();
router.param("id", postgresIntIdParam);
const IdempotencyKey = z
  .string()
  .min(1)
  .max(128)
  .regex(/^[A-Za-z0-9._:-]+$/);
const BoundedCreateInvitationBody = CreateInvitationBody.extend({
  needId: postgresIntIdSchema,
  candidateId: postgresIntIdSchema,
  resumeId: postgresIntIdSchema,
  idempotencyKey: IdempotencyKey.optional(),
}).strict();

type EmployerContext = SignalPoolScope & { userId: number; companyId: number };
type CandidateContext = SignalPoolScope & { userId: number };
type CandidateRow = MatchCandidate;

async function employerCompanyContext(
  req: Request,
  res: Response,
): Promise<EmployerContext | null> {
  const session = await getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Войдите в аккаунт работодателя." });
    return null;
  }
  if (session.user.role !== "employer") {
    res.status(403).json({ error: "Действие доступно только работодателю." });
    return null;
  }
  const [company] = await db
    .select({ id: signalCompaniesTable.id })
    .from(signalCompaniesTable)
    .where(eq(signalCompaniesTable.ownerUserId, session.user.id))
    .limit(1);
  if (!company) {
    res.status(400).json({ error: "Профиль компании не найден." });
    return null;
  }
  return {
    userId: session.user.id,
    companyId: company.id,
    ...poolScopeForAccount(session.user),
  };
}

async function candidateContext(
  req: Request,
  res: Response,
): Promise<CandidateContext | null> {
  const session = await getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Войдите в аккаунт кандидата." });
    return null;
  }
  if (session.user.role !== "candidate") {
    res.status(403).json({ error: "Действие доступно только кандидату." });
    return null;
  }
  return { userId: session.user.id, ...poolScopeForAccount(session.user) };
}

function needForMatch(need: typeof signalNeedsTable.$inferSelect): MatchNeed {
  return {
    specialization: need.specialization,
    grade: need.grade as SignalGrade,
    requiredSkills: need.requiredSkills,
    desirableSkills: need.desirableSkills,
    workFormat: need.workFormat,
    salaryMin: need.salaryMin,
    salaryMax: need.salaryMax,
    salaryPeriod: need.salaryPeriod,
    salaryType: need.salaryType,
  };
}

async function invitationPayload(
  invitation: typeof signalInvitationsTable.$inferSelect,
) {
  const [[company], [profile], [grant]] = await Promise.all([
    db
      .select()
      .from(signalCompaniesTable)
      .where(eq(signalCompaniesTable.id, invitation.companyId))
      .limit(1),
    db
      .select({ alias: signalCandidateProfilesTable.professionalAlias })
      .from(signalCandidateProfilesTable)
      .where(
        eq(signalCandidateProfilesTable.userId, invitation.candidateUserId),
      )
      .limit(1),
    db
      .select({ invitationId: signalContactGrantsTable.invitationId })
      .from(signalContactGrantsTable)
      .where(
        and(
          eq(signalContactGrantsTable.invitationId, invitation.id),
          eq(signalContactGrantsTable.companyId, invitation.companyId),
          isNull(signalContactGrantsTable.revokedAt),
        ),
      )
      .limit(1),
  ]);
  const permission = await assertCompanyActionAllowed(
    invitation.companyId,
    invitation.candidateUserId,
    db,
    "contacts",
  );
  const companyContact = company
    ? `${company.contactMethod}: ${company.contactEmail}${company.contactPhone ? ` · ${company.contactPhone}` : ""}`
    : "Контакт компании не указан";
  return {
    id: invitation.id,
    needId: invitation.needId,
    companyId: invitation.companyId,
    resumeId: invitation.resumeId,
    resumeSnapshot:
      permission.allowed &&
      invitation.resumeSnapshot &&
      (await historicalResumeVisible(
        invitation.candidateUserId,
        invitation.resumeId,
        poolScopeForAccount(
          (
            await db
              .select({
                demoMode: signalUsersTable.demoMode,
                reviewScopeId: signalUsersTable.reviewScopeId,
              })
              .from(signalUsersTable)
              .where(eq(signalUsersTable.id, invitation.candidateUserId))
              .limit(1)
          )[0] ?? false,
        ),
      ))
        ? publicHistoricalSnapshot(invitation.resumeSnapshot)
        : null,
    candidateId: invitation.candidateUserId,
    candidateAlias: profile?.alias ?? "Кандидат",
    companyName: company?.name ?? "Компания",
    companyContact,
    title: invitation.title,
    message: invitation.message,
    reason: invitation.reason,
    salaryMin: invitation.salaryMin,
    salaryMax: invitation.salaryMax,
    salaryPeriod: invitation.salaryPeriod,
    salaryType: invitation.salaryType,
    workFormat: invitation.workFormat,
    status: invitation.status,
    contactShared: Boolean(grant) && permission.allowed,
    createdAt: invitation.createdAt.toISOString(),
  };
}

async function invitationInCandidatePool(
  invitationId: number,
  context: CandidateContext,
): Promise<typeof signalInvitationsTable.$inferSelect | null> {
  const [row] = await db
    .select({ invitation: signalInvitationsTable })
    .from(signalInvitationsTable)
    .innerJoin(
      signalCompaniesTable,
      eq(signalInvitationsTable.companyId, signalCompaniesTable.id),
    )
    .innerJoin(
      signalUsersTable,
      eq(signalCompaniesTable.ownerUserId, signalUsersTable.id),
    )
    .where(
      and(
        eq(signalInvitationsTable.id, invitationId),
        eq(signalInvitationsTable.candidateUserId, context.userId),
        signalPoolPredicate(signalUsersTable, context),
      ),
    )
    .limit(1);
  return row?.invitation ?? null;
}

router.get("/me/invitations", async (req, res): Promise<void> => {
  const context = await candidateContext(req, res);
  if (!context) return;
  const rows = await db
    .select({ invitation: signalInvitationsTable })
    .from(signalInvitationsTable)
    .innerJoin(
      signalCompaniesTable,
      eq(signalInvitationsTable.companyId, signalCompaniesTable.id),
    )
    .innerJoin(
      signalUsersTable,
      eq(signalCompaniesTable.ownerUserId, signalUsersTable.id),
    )
    .where(
      and(
        eq(signalInvitationsTable.candidateUserId, context.userId),
        signalPoolPredicate(signalUsersTable, context),
      ),
    )
    .orderBy(desc(signalInvitationsTable.createdAt));
  res.setHeader("Cache-Control", "no-store");
  res.json(
    await Promise.all(
      rows.map(({ invitation }) => invitationPayload(invitation)),
    ),
  );
});

router.post("/me/invitations/:id/view", async (req, res): Promise<void> => {
  const context = await candidateContext(req, res);
  if (!context) return;
  const params = DecideInvitationParams.safeParse(req.params);
  if (!params.success) {
    res.status(400).json({ error: "Некорректное приглашение." });
    return;
  }
  const owned = await invitationInCandidatePool(params.data.id, context);
  if (!owned) {
    res.status(404).json({ error: "Приглашение не найдено." });
    return;
  }
  const [updated] = await db
    .update(signalInvitationsTable)
    .set({ status: "viewed", updatedAt: new Date() })
    .where(
      and(
        eq(signalInvitationsTable.id, owned.id),
        eq(signalInvitationsTable.candidateUserId, context.userId),
        eq(signalInvitationsTable.status, "sent"),
      ),
    )
    .returning();
  // Idempotent and monotonic: viewing never reopens an accepted/closed offer.
  res.json(await invitationPayload(updated ?? owned));
});

router.get("/employer/invitations", async (req, res): Promise<void> => {
  const context = await employerCompanyContext(req, res);
  if (!context) return;
  const rows = await db
    .select({ invitation: signalInvitationsTable })
    .from(signalInvitationsTable)
    .innerJoin(
      signalUsersTable,
      eq(signalInvitationsTable.candidateUserId, signalUsersTable.id),
    )
    .where(
      and(
        eq(signalInvitationsTable.companyId, context.companyId),
        signalPoolPredicate(signalUsersTable, context),
      ),
    )
    .orderBy(desc(signalInvitationsTable.createdAt));
  res.setHeader("Cache-Control", "no-store");
  res.json(
    await Promise.all(
      rows.map(({ invitation }) => invitationPayload(invitation)),
    ),
  );
});

router.post("/employer/invitations", async (req, res): Promise<void> => {
  const context = await employerCompanyContext(req, res);
  if (!context) return;
  const parsed = BoundedCreateInvitationBody.safeParse(req.body);
  if (!parsed.success) {
    res
      .status(400)
      .json({ error: "Проверьте данные и зарплатный диапазон приглашения." });
    return;
  }
  const { idempotencyKey: bodyKey, ...input } = parsed.data;
  const key = IdempotencyKey.safeParse(req.get("Idempotency-Key") ?? bodyKey);
  if (!key.success) {
    res.status(400).json({
      error: "Укажите ключ повторного запроса.",
      code: "IDEMPOTENCY_KEY_REQUIRED",
    });
    return;
  }
  if (input.salaryMin > input.salaryMax) {
    res
      .status(400)
      .json({ error: "Минимальная зарплата не может быть выше максимальной." });
    return;
  }
  const [need] = await db
    .select()
    .from(signalNeedsTable)
    .where(
      and(
        eq(signalNeedsTable.id, input.needId),
        eq(signalNeedsTable.companyId, context.companyId),
      ),
    )
    .limit(1);
  if (!need) {
    res.status(404).json({ error: "Кандидат или потребность не найдены." });
    return;
  }
  const hash = invitationBodyHash(input);
  const creation = await db.transaction(async (tx) => {
    // Company first: quota, idempotency and insert share one transaction/lock.
    await tx
      .select({ id: signalCompaniesTable.id })
      .from(signalCompaniesTable)
      .where(eq(signalCompaniesTable.id, context.companyId))
      .for("update");
    const permission = await assertCompanyActionAllowed(
      context.companyId,
      input.candidateId,
      tx,
    );
    if (!permission.allowed)
      return {
        error: 403,
        code: permission.code,
        message: permission.publicReason,
        retryAt: permission.retryAt,
      };
    const [receipt] = await tx
      .select()
      .from(signalInvitationRequestsTable)
      .where(
        and(
          eq(signalInvitationRequestsTable.companyId, context.companyId),
          eq(signalInvitationRequestsTable.requestKey, key.data),
        ),
      )
      .limit(1);
    if (receipt) {
      if (receipt.bodyHash !== hash)
        return {
          error: 409,
          code: "IDEMPOTENCY_CONFLICT",
          message: "Этот ключ уже использован для другого запроса.",
        };
      const [invitation] = await tx
        .select()
        .from(signalInvitationsTable)
        .where(eq(signalInvitationsTable.id, receipt.invitationId))
        .limit(1);
      return invitation
        ? { invitation, created: false }
        : {
            error: 409,
            code: "IDEMPOTENCY_GONE",
            message: "Исходное приглашение недоступно.",
          };
    }
    await tx
      .select({ userId: signalCandidateProfilesTable.userId })
      .from(signalCandidateProfilesTable)
      .where(eq(signalCandidateProfilesTable.userId, input.candidateId))
      .for("update");
    const raw = await loadResumeCandidates(
      context,
      {
        purpose: "matching",
        userId: input.candidateId,
        resumeId: input.resumeId,
      },
      tx,
    );
    const [candidate] = await withAssessmentRankingEvidence(raw, tx);
    if (
      !candidate ||
      !evaluateMatch(needForMatch(need), candidate, context.demoMode).eligible
    )
      return {
        error: 404,
        code: "CANDIDATE_UNAVAILABLE",
        message: "Кандидат или потребность не найдены.",
      };
    const [existing] = await tx
      .select()
      .from(signalInvitationsTable)
      .where(
        and(
          eq(signalInvitationsTable.companyId, context.companyId),
          eq(signalInvitationsTable.needId, input.needId),
          eq(signalInvitationsTable.candidateUserId, input.candidateId),
          inArray(signalInvitationsTable.status, [
            "sent",
            "viewed",
            "accepted",
          ]),
        ),
      )
      .orderBy(desc(signalInvitationsTable.createdAt))
      .limit(1);
    if (existing) {
      await tx.insert(signalInvitationRequestsTable).values({
        companyId: context.companyId,
        requestKey: key.data,
        bodyHash: hash,
        invitationId: existing.id,
      });
      return { invitation: existing, created: false };
    }
    const now = new Date();
    const [closed] = await tx
      .select({ updatedAt: signalInvitationsTable.updatedAt })
      .from(signalInvitationsTable)
      .where(
        and(
          eq(signalInvitationsTable.companyId, context.companyId),
          eq(signalInvitationsTable.candidateUserId, input.candidateId),
          inArray(signalInvitationsTable.status, [
            "declined",
            "withdrawn",
            "expired",
          ]),
        ),
      )
      .orderBy(desc(signalInvitationsTable.updatedAt))
      .limit(1);
    const cooldown = closed
      ? closedInvitationRetryAt(closed.updatedAt, now)
      : null;
    if (cooldown)
      return {
        error: 429,
        code: "CANDIDATE_CONTACT_COOLDOWN",
        message:
          "После закрытия предложения повторное обращение к этому человеку доступно через 7 дней.",
        retryAt: cooldown,
      };
    const recent = await tx
      .select({ createdAt: signalInvitationsTable.createdAt })
      .from(signalInvitationsTable)
      .where(
        and(
          eq(signalInvitationsTable.companyId, context.companyId),
          gt(
            signalInvitationsTable.createdAt,
            new Date(now.getTime() - INVITATION_WINDOW_MS),
          ),
          lte(signalInvitationsTable.createdAt, now),
        ),
      );
    const retryAt = quotaRetryAt(
      recent.map((row) => row.createdAt),
      now,
      invitationQuotaLimit(),
    );
    if (retryAt)
      return {
        error: 429,
        code: "INVITATION_QUOTA",
        message: `Лимит компании: ${invitationQuotaLimit()} новых приглашений за последние 24 часа.`,
        retryAt,
      };
    const [invitation] = await tx
      .insert(signalInvitationsTable)
      .values({
        ...input,
        companyId: context.companyId,
        candidateUserId: input.candidateId,
        resumeId: candidate.resumeId,
        resumeSnapshot: resumeSnapshot(candidate),
        status: "sent",
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!invitation)
      throw new Error("Invitation creation did not return a row");
    await tx.insert(signalInvitationRequestsTable).values({
      companyId: context.companyId,
      requestKey: key.data,
      bodyHash: hash,
      invitationId: invitation.id,
    });
    return { invitation, created: true };
  });
  if (!creation.invitation) {
    res.status(creation.error!).json({
      error: creation.message,
      code: creation.code,
      retryAt: creation.retryAt ?? null,
    });
    return;
  }
  res
    .status(creation.created ? 201 : 200)
    .json(await invitationPayload(creation.invitation));
});

router.post("/me/invitations/:id/decision", async (req, res): Promise<void> => {
  const context = await candidateContext(req, res);
  if (!context) return;
  const params = DecideInvitationParams.safeParse(req.params);
  const parsed = DecideInvitationBody.safeParse(req.body);
  if (!params.success || !parsed.success) {
    res.status(400).json({ error: "Некорректное решение по приглашению." });
    return;
  }
  const owned = await invitationInCandidatePool(params.data.id, context);
  if (!owned) {
    res.status(404).json({ error: "Приглашение не найдено." });
    return;
  }
  const targetStatus =
    parsed.data.decision === "accept" ? "accepted" : "declined";
  const result = await db.transaction(async (tx) => {
    await tx
      .select({ id: signalCompaniesTable.id })
      .from(signalCompaniesTable)
      .where(eq(signalCompaniesTable.id, owned.companyId))
      .for("update");
    if (targetStatus === "accepted") {
      const permission = await assertCompanyActionAllowed(
        owned.companyId,
        context.userId,
        tx,
        "contacts",
      );
      if (!permission.allowed) return null;
    }
    await lockContactOwner(tx, context.userId);
    const [updated] = await tx
      .update(signalInvitationsTable)
      .set({ status: targetStatus, updatedAt: new Date() })
      .where(
        and(
          eq(signalInvitationsTable.id, owned.id),
          eq(signalInvitationsTable.candidateUserId, context.userId),
          eq(signalInvitationsTable.companyId, owned.companyId),
          inArray(signalInvitationsTable.status, ["sent", "viewed"]),
        ),
      )
      .returning();
    if (updated) {
      if (targetStatus === "accepted") {
        await createContactPermission(tx, context.userId, updated.companyId, {
          invitationId: updated.id,
        });
      }
      return updated;
    }
    const [current] = await tx
      .select()
      .from(signalInvitationsTable)
      .where(
        and(
          eq(signalInvitationsTable.id, owned.id),
          eq(signalInvitationsTable.candidateUserId, context.userId),
          eq(signalInvitationsTable.companyId, owned.companyId),
        ),
      )
      .limit(1);
    return current?.status === targetStatus ? current : null;
  });
  if (!result) {
    res
      .status(409)
      .json({ error: "Приглашение уже недоступно для этого действия." });
    return;
  }
  const invitation = await invitationPayload(result);
  res.json({ invitation, disclosedContacts: null });
});

router.post(
  "/employer/invitations/:id/withdraw",
  async (req, res): Promise<void> => {
    const context = await employerCompanyContext(req, res);
    if (!context) return;
    const params = WithdrawInvitationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Некорректное приглашение." });
      return;
    }
    const [owned] = await db
      .select({ invitation: signalInvitationsTable })
      .from(signalInvitationsTable)
      .innerJoin(
        signalUsersTable,
        eq(signalInvitationsTable.candidateUserId, signalUsersTable.id),
      )
      .where(
        and(
          eq(signalInvitationsTable.id, params.data.id),
          eq(signalInvitationsTable.companyId, context.companyId),
          signalPoolPredicate(signalUsersTable, context),
        ),
      )
      .limit(1);
    if (!owned?.invitation) {
      res.status(404).json({ error: "Приглашение не найдено." });
      return;
    }
    const [updated] = await db
      .update(signalInvitationsTable)
      .set({ status: "withdrawn", updatedAt: new Date() })
      .where(
        and(
          eq(signalInvitationsTable.id, owned.invitation.id),
          eq(signalInvitationsTable.companyId, context.companyId),
          inArray(signalInvitationsTable.status, ["sent", "viewed"]),
        ),
      )
      .returning();
    if (!updated) {
      const [current] = await db
        .select()
        .from(signalInvitationsTable)
        .where(
          and(
            eq(signalInvitationsTable.id, owned.invitation.id),
            eq(signalInvitationsTable.companyId, context.companyId),
          ),
        )
        .limit(1);
      if (current?.status === "withdrawn") {
        res.json(await invitationPayload(current));
        return;
      }
      res
        .status(409)
        .json({ error: "После ответа кандидата приглашение отозвать нельзя." });
      return;
    }
    res.json(await invitationPayload(updated));
  },
);

router.get(
  "/employer/invitations/:id/contacts",
  async (req, res): Promise<void> => {
    const context = await employerCompanyContext(req, res);
    if (!context) return;
    const params = GetInvitationContactsParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Некорректное приглашение." });
      return;
    }
    const disclosure = await db.transaction(async (tx) => {
      const [invitation] = await tx
        .select()
        .from(signalInvitationsTable)
        .where(
          and(
            eq(signalInvitationsTable.id, params.data.id),
            eq(signalInvitationsTable.companyId, context.companyId),
            eq(signalInvitationsTable.status, "accepted"),
          ),
        )
        .limit(1);
      if (!invitation) return null;
      const permission = await assertCompanyActionAllowed(
        context.companyId,
        invitation.candidateUserId,
        tx,
        "contacts",
      );
      if (
        !permission.allowed ||
        !(await historicalResumeVisible(
          invitation.candidateUserId,
          invitation.resumeId,
          context,
          tx,
        ))
      )
        return null;
      return readPermittedContacts(
        tx,
        invitation.candidateUserId,
        context.companyId,
        context,
        { invitationId: invitation.id },
      );
    });
    if (!disclosure) {
      res.status(403).json({ error: "Контактные данные пока не доступны." });
      return;
    }
    res.json(GetInvitationContactsResponse.parse(disclosure));
  },
);

router.post(
  "/me/invitations/:id/revoke-contact",
  async (req, res): Promise<void> => {
    const context = await candidateContext(req, res);
    if (!context) return;
    const params = DecideInvitationParams.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "Некорректное приглашение." });
      return;
    }
    const owned = await invitationInCandidatePool(params.data.id, context);
    if (!owned) {
      res.status(404).json({ error: "Приглашение не найдено." });
      return;
    }
    const [existing] = await db
      .select({ id: signalContactGrantsTable.id })
      .from(signalContactGrantsTable)
      .where(
        and(
          eq(signalContactGrantsTable.invitationId, owned.id),
          eq(signalContactGrantsTable.candidateUserId, context.userId),
        ),
      )
      .limit(1);
    if (!existing) {
      res.status(404).json({ error: "Активный доступ к контактам не найден." });
      return;
    }
    await db.transaction((tx) =>
      revokeCompanyPermissions(tx, context.userId, owned.companyId),
    );
    res.json(
      RevokeInvitationContactResponse.parse({
        message:
          "Доступ этой компании по всем приглашениям и откликам отозван.",
      }),
    );
  },
);

export default router;

import { randomInt } from "node:crypto";
import { and, count, desc, eq, gt, isNull } from "drizzle-orm";
import { Router, type IRouter, type Request, type Response } from "express";
import {
  GetCurrentUserResponse,
  LoginBody,
  LoginResponse,
  LogoutResponse,
  RegisterBody,
  RegisterResponse,
  StartDemoSessionBody,
  StartDemoSessionResponse,
  VerifyEmailBody,
  VerifyEmailResponse,
} from "@workspace/api-zod";
import {
  db,
  signalCandidateProfilesTable,
  signalCompaniesTable,
  signalConsentsTable,
  signalDemoSeedTable,
  signalNeedsTable,
  signalSessionsTable,
  signalUsersTable,
  signalVerificationTokensTable,
} from "@workspace/db";
import { logger } from "../lib/logger";
import {
  isMailTransportConfigured,
  sendVerificationEmail,
} from "../lib/signal-mail";
import { FixedWindowRateLimiter, rateLimitKey } from "../lib/signal-rate-limit";
import {
  clearSessionCookie,
  createSession,
  getSessionUser,
  hashPassword,
  hashVerificationCode,
  revokeSession,
  toPublicSignalUser,
  verifyPassword,
} from "../lib/signal-auth";
import {
  isDemoModeEnabled,
  isDemoVerificationCodeExposureEnabled,
} from "../lib/signal-runtime";
import { isOverviewDemo, signalPoolPredicate } from "../lib/signal-pool-scope";

const router: IRouter = Router();
const loginAttempts = new FixedWindowRateLimiter(12, 15 * 60 * 1000);
const registrationAttempts = new FixedWindowRateLimiter(6, 60 * 60 * 1000);
const verificationAttempts = new FixedWindowRateLimiter(12, 15 * 60 * 1000);
const CONSENT_VERSION = "2026-10-05";
const MAILBOX_TTL_MS = 30 * 60 * 1000;

function requestIp(req: Request): string {
  return req.ip || req.socket.remoteAddress || "unknown";
}

function sendRateLimit(res: Response, retryAfterMs: number): void {
  res
    .set("Retry-After", String(Math.max(1, Math.ceil(retryAfterMs / 1000))))
    .status(429)
    .json({ error: "Слишком много попыток. Попробуйте позже." });
}

function normalizedEmail(email: string): string {
  return email.trim().toLowerCase();
}

function registrationNotice(): string {
  return "Если этот адрес можно использовать для регистрации, код подтверждения отправлен.";
}

router.get("/public/demo-summary", async (_req, res): Promise<void> => {
  if (!isDemoModeEnabled()) {
    res.status(404).json({ error: "Ресурс не найден." });
    return;
  }
  const [[candidateCount], [needCount], [seed]] = await Promise.all([
    db
      .select({ value: count() })
      .from(signalCandidateProfilesTable)
      .innerJoin(
        signalUsersTable,
        eq(signalCandidateProfilesTable.userId, signalUsersTable.id),
      )
      .where(
        and(
          eq(signalUsersTable.role, "candidate"),
          eq(signalUsersTable.demoMode, true),
          isNull(signalUsersTable.reviewScopeId),
        ),
      ),
    db
      .select({ value: count() })
      .from(signalNeedsTable)
      .innerJoin(
        signalCompaniesTable,
        eq(signalNeedsTable.companyId, signalCompaniesTable.id),
      )
      .innerJoin(
        signalUsersTable,
        eq(signalCompaniesTable.ownerUserId, signalUsersTable.id),
      )
      .where(signalPoolPredicate(signalUsersTable, true)),
    db
      .select({ version: signalDemoSeedTable.version })
      .from(signalDemoSeedTable)
      .where(eq(signalDemoSeedTable.key, "default"))
      .limit(1),
  ]);
  res.json({
    datasetVersion: seed?.version ?? "unseeded",
    candidateCount: candidateCount?.value ?? 0,
    employerNeedCount: needCount?.value ?? 0,
    synthetic: true,
    notice:
      "Синтетические демонстрационные данные. Точность подбора на реальном найме не измерена.",
  });
});

router.post("/auth/register", async (req, res): Promise<void> => {
  const parsed = RegisterBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Проверьте заполнение формы." });
    return;
  }
  const input = parsed.data;
  const email = normalizedEmail(input.email);
  const displayName = input.displayName.trim();
  if (
    displayName.length < 2 ||
    !input.consentTerms ||
    !input.consentPrivacy
  ) {
    res.status(400).json({
      error: "Для регистрации заполните имя и примите условия обработки данных.",
    });
    return;
  }
  const limiter = registrationAttempts.consume(rateLimitKey(requestIp(req), email));
  if (limiter.limited) {
    sendRateLimit(res, limiter.retryAfterMs);
    return;
  }

  const showLocalCode = isDemoVerificationCodeExposureEnabled();
  if (!isMailTransportConfigured() && !showLocalCode) {
    res.status(503).json({
      error: "Регистрация временно недоступна. Попробуйте позже.",
    });
    return;
  }

  let [user] = await db
    .select()
    .from(signalUsersTable)
    .where(eq(signalUsersTable.email, email))
    .limit(1);
  if (!user) {
    try {
      user = await db.transaction(async (tx) => {
        const [createdUser] = await tx
          .insert(signalUsersTable)
          .values({
            email,
            passwordHash: await hashPassword(input.password),
            role: input.role,
            displayName,
            emailVerified: false,
            // Public registration always enters the real pool, including while
            // a local synthetic demo is enabled.
            demoMode: false,
          })
          .returning();
        if (!createdUser) throw new Error("User creation did not return a row");
        await tx.insert(signalConsentsTable).values([
          { userId: createdUser.id, consentType: "terms", version: CONSENT_VERSION },
          { userId: createdUser.id, consentType: "privacy", version: CONSENT_VERSION },
        ]);
        if (createdUser.role === "candidate") {
          await tx.insert(signalCandidateProfilesTable).values({
            userId: createdUser.id,
            professionalAlias: createdUser.displayName,
            contactEmail: createdUser.email,
            visibility: "private",
            consentMatching: false,
          });
        } else {
          await tx.insert(signalCompaniesTable).values({
            ownerUserId: createdUser.id,
            name: createdUser.displayName,
            contactEmail: createdUser.email,
            contactMethod: "Электронная почта",
          });
        }
        return createdUser;
      });
    } catch {
      // A concurrent registration may have won the unique-email race.  Keep
      // the response indistinguishable from a normal registration.
      [user] = await db
        .select()
        .from(signalUsersTable)
        .where(eq(signalUsersTable.email, email))
        .limit(1);
    }
  }

  if (!user) {
    res.status(503).json({ error: "Регистрация временно недоступна. Попробуйте позже." });
    return;
  }
  let demoVerificationCode: string | undefined;
  if (!user.emailVerified) {
    const code = String(randomInt(100000, 1_000_000));
    await db
      .update(signalVerificationTokensTable)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(signalVerificationTokensTable.userId, user.id),
          isNull(signalVerificationTokensTable.consumedAt),
        ),
      );
    await db.insert(signalVerificationTokensTable).values({
      userId: user.id,
      tokenHash: hashVerificationCode(code),
      expiresAt: new Date(Date.now() + MAILBOX_TTL_MS),
    });

    if (isMailTransportConfigured()) {
      try {
        await sendVerificationEmail({
          to: email,
          code,
          publicUrl: process.env.PUBLIC_URL,
        });
      } catch (error) {
        logger.warn(
          { mailError: error instanceof Error ? error.name : "unknown" },
          "Verification email delivery failed",
        );
        res.status(503).json({
          error: "Регистрация временно недоступна. Попробуйте позже.",
        });
        return;
      }
    }
    if (showLocalCode) demoVerificationCode = code;
  }

  res.status(201).json(
    RegisterResponse.parse({
      email,
      verificationRequired: true,
      ...(demoVerificationCode ? { demoVerificationCode } : {}),
      notice: registrationNotice(),
    }),
  );
});

router.post("/auth/verify-email", async (req, res): Promise<void> => {
  const parsed = VerifyEmailBody.safeParse(req.body);
  if (!parsed.success || !/^\d{6}$/.test(parsed.data?.code ?? "")) {
    res.status(400).json({ error: "Введите корректный адрес и шестизначный код." });
    return;
  }
  const email = normalizedEmail(parsed.data.email);
  const limiter = verificationAttempts.consume(rateLimitKey(requestIp(req), email));
  if (limiter.limited) {
    sendRateLimit(res, limiter.retryAfterMs);
    return;
  }
  const [user] = await db
    .select()
    .from(signalUsersTable)
    .where(eq(signalUsersTable.email, email))
    .limit(1);
  if (!user) {
    res.status(400).json({ error: "Код недействителен или срок его действия истёк." });
    return;
  }
  const [token] = await db
    .select()
    .from(signalVerificationTokensTable)
    .where(
      and(
        eq(signalVerificationTokensTable.userId, user.id),
        eq(
          signalVerificationTokensTable.tokenHash,
          hashVerificationCode(parsed.data.code),
        ),
        isNull(signalVerificationTokensTable.consumedAt),
        gt(signalVerificationTokensTable.expiresAt, new Date()),
      ),
    )
    .orderBy(desc(signalVerificationTokensTable.createdAt))
    .limit(1);
  if (!token) {
    res.status(400).json({ error: "Код недействителен или срок его действия истёк." });
    return;
  }

  const [verified] = await db.transaction(async (tx) => {
    const [consumed] = await tx
      .update(signalVerificationTokensTable)
      .set({ consumedAt: new Date() })
      .where(
        and(
          eq(signalVerificationTokensTable.id, token.id),
          isNull(signalVerificationTokensTable.consumedAt),
        ),
      )
      .returning();
    if (!consumed) return [];
    return tx
      .update(signalUsersTable)
      .set({ emailVerified: true })
      .where(eq(signalUsersTable.id, user.id))
      .returning();
  });
  if (!verified) {
    res.status(400).json({ error: "Код недействителен или срок его действия истёк." });
    return;
  }
  verificationAttempts.reset(rateLimitKey(requestIp(req), email));
  const expiresAt = await createSession(res, verified);
  res.json(
    VerifyEmailResponse.parse({
      user: await toPublicSignalUser(verified),
      expiresAt: expiresAt.toISOString(),
    }),
  );
});

router.post("/auth/login", async (req, res): Promise<void> => {
  const parsed = LoginBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Проверьте адрес и пароль." });
    return;
  }
  const email = normalizedEmail(parsed.data.email);
  const key = rateLimitKey(requestIp(req), email);
  const limiter = loginAttempts.consume(key);
  if (limiter.limited) {
    sendRateLimit(res, limiter.retryAfterMs);
    return;
  }
  const [user] = await db
    .select()
    .from(signalUsersTable)
    .where(eq(signalUsersTable.email, email))
    .limit(1);
  // Do the expensive password work even for an unknown address to reduce
  // account-enumeration timing differences.
  const valid = user
    ? await verifyPassword(parsed.data.password, user.passwordHash)
    : await hashPassword(parsed.data.password).then(() => false);
  if (!user || !valid || (user.demoMode && !isDemoModeEnabled())) {
    res.status(401).json({ error: "Не удалось войти. Проверьте данные." });
    return;
  }
  if (!user.emailVerified) {
    res.status(403).json({ error: "Сначала подтвердите адрес электронной почты." });
    return;
  }
  loginAttempts.reset(key);
  const expiresAt = await createSession(res, user);
  res.json(
    LoginResponse.parse({
      user: await toPublicSignalUser(user),
      expiresAt: expiresAt.toISOString(),
    }),
  );
});

router.post("/auth/demo-session", async (req, res): Promise<void> => {
  if (!isDemoModeEnabled()) {
    res.status(404).json({ error: "Ресурс не найден." });
    return;
  }
  const parsed = StartDemoSessionBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Выберите демонстрационный сценарий." });
    return;
  }
  const email =
    parsed.data.role === "candidate"
      ? "candidate-demo@example.test"
      : "employer-demo@example.test";
  const [user] = await db
    .select()
    .from(signalUsersTable)
    .where(eq(signalUsersTable.email, email))
    .limit(1);
  if (!user || !user.emailVerified || !isOverviewDemo(user)) {
    res.status(503).json({ error: "Демонстрационные данные ещё не подготовлены." });
    return;
  }
  const expiresAt = await createSession(res, user);
  res.json(
    StartDemoSessionResponse.parse({
      user: await toPublicSignalUser(user),
      expiresAt: expiresAt.toISOString(),
    }),
  );
});

router.get("/me", async (req, res): Promise<void> => {
  const session = await getSessionUser(req);
  if (!session) {
    res.status(401).json({ error: "Войдите, чтобы продолжить." });
    return;
  }
  res.json(
    GetCurrentUserResponse.parse({
      user: await toPublicSignalUser(session.user, session.demoMode),
      expiresAt: session.expiresAt.toISOString(),
    }),
  );
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await revokeSession(req);
  clearSessionCookie(res);
  res.json(LogoutResponse.parse({ message: "Вы вышли из аккаунта." }));
});

export default router;

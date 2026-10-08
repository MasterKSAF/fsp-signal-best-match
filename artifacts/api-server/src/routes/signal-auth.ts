import { z } from 'zod';
import { and, count, eq, isNull } from "drizzle-orm";
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
  signalDemoSeedTable,
  signalNeedsTable,
  signalSessionsTable,
  signalUsersTable,
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
  revokeSession,
  toPublicSignalUser,
  verifyPassword,
} from "../lib/signal-auth";
import {
  isDemoModeEnabled,
  isDemoVerificationCodeExposureEnabled,
} from "../lib/signal-runtime";
import { preparePendingRegistration, consumePendingRegistration } from '../lib/signal-registration';
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

  let demoVerificationCode: string | undefined;
  let challenge: Awaited<ReturnType<typeof preparePendingRegistration>>;
  try {
    challenge = await preparePendingRegistration({ email, password: input.password, role: input.role, displayName }, CONSENT_VERSION, MAILBOX_TTL_MS);
  } catch (error) {
    logger.warn({ registrationError: error instanceof Error ? error.name : 'unknown' }, 'Registration challenge could not be prepared');
    res.status(503).json({ error: 'Регистрация временно недоступна. Попробуйте позже.' });
    return;
  }
  if (challenge.code) {
    if (isMailTransportConfigured()) {
      try {
        await sendVerificationEmail({ to: email, code: challenge.code, publicUrl: process.env.PUBLIC_URL });
      } catch (error) {
        logger.warn({ mailError: error instanceof Error ? error.name : 'unknown' }, 'Verification email delivery failed');
        res.status(503).json({ error: 'Регистрация временно недоступна. Попробуйте позже.' });
        return;
      }
    }
    if (showLocalCode) demoVerificationCode = challenge.code;
  }

  res.status(201).json(
    RegisterResponse.extend({registrationId:z.string().uuid()}).parse({
      email,
      registrationId:challenge.registrationId,
      verificationRequired: true,
      ...(demoVerificationCode ? { demoVerificationCode } : {}),
      notice: registrationNotice(),
    }),
  );
});

router.post("/auth/verify-email", async (req, res): Promise<void> => {
  const parsed = VerifyEmailBody.extend({registrationId:z.string().uuid()}).safeParse(req.body);
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
  const verified = await consumePendingRegistration(email, parsed.data.code, parsed.data.registrationId);
  if (!verified) {
    res.status(400).json({ error: 'Код недействителен или срок его действия истёк.' });
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

async function ownAccount(user: typeof signalUsersTable.$inferSelect) {
  const [profile] = user.role === 'candidate' ? await db.select({alias:signalCandidateProfilesTable.professionalAlias}).from(signalCandidateProfilesTable).where(eq(signalCandidateProfilesTable.userId,user.id)).limit(1) : [];
  return {id:user.id,displayName:user.displayName,email:user.email,emailVerified:user.emailVerified,role:user.role,demoMode:user.demoMode,reviewMode:user.reviewScopeId!==null,createdAt:user.createdAt.toISOString(),professionalAlias:profile?.alias??null};
}
router.get('/me/account',async(req,res):Promise<void>=>{
  const session=await getSessionUser(req); if(!session){res.status(401).json({error:'Войдите, чтобы продолжить.'});return;}
  res.set('Cache-Control','no-store').json(await ownAccount(session.user));
});
const AccountUpdate=z.object({displayName:z.string().trim().min(2).max(120),expectedDisplayName:z.string().min(2).max(120),professionalAlias:z.string().trim().min(2).max(120).optional(),expectedProfessionalAlias:z.string().max(120).optional()}).strict().refine(v=>(v.professionalAlias===undefined)===(v.expectedProfessionalAlias===undefined));
router.patch('/me/account',async(req,res):Promise<void>=>{
  const session=await getSessionUser(req);if(!session){res.status(401).json({error:'Войдите, чтобы продолжить.'});return;}
  const parsed=AccountUpdate.safeParse(req.body);if(!parsed.success){res.status(400).json({error:'Проверьте имя и псевдоним.'});return;}
  const input=parsed.data;
  const result=await db.transaction(async tx=>{
    const [current]=await tx.select().from(signalUsersTable).where(eq(signalUsersTable.id,session.user.id)).for('update');
    if(!current||current.displayName!==input.expectedDisplayName)return null;
    if(input.professionalAlias!==undefined){
      if(current.role!=='candidate')return null;
      const [profile]=await tx.select().from(signalCandidateProfilesTable).where(eq(signalCandidateProfilesTable.userId,current.id)).for('update');
      if(!profile||profile.professionalAlias!==input.expectedProfessionalAlias)return null;
      await tx.update(signalCandidateProfilesTable).set({professionalAlias:input.professionalAlias}).where(eq(signalCandidateProfilesTable.userId,current.id));
    }
    const [saved]=await tx.update(signalUsersTable).set({displayName:input.displayName}).where(eq(signalUsersTable.id,current.id)).returning();return saved;
  });
  if(!result){res.status(409).json({error:'Данные аккаунта изменились. Обновите страницу и повторите сохранение.',code:'account_revision_conflict'});return;}
  res.set('Cache-Control','no-store').json(await ownAccount(result));
});

router.post("/auth/logout", async (req, res): Promise<void> => {
  await revokeSession(req);
  clearSessionCookie(res);
  res.json(LogoutResponse.parse({ message: "Вы вышли из аккаунта." }));
});

export default router;

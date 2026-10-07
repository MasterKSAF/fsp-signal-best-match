import {
  createHash,
  createHmac,
  randomBytes,
  scrypt as nodeScrypt,
  timingSafeEqual,
} from "node:crypto";
import { promisify } from "node:util";
import { and, eq, gt } from "drizzle-orm";
import type { Request, Response } from "express";
import {
  db,
  signalCandidateProfilesTable,
  signalCompaniesTable,
  signalSessionsTable,
  signalUsersTable,
} from "@workspace/db";
import {
  isDemoModeEnabled,
  isSecureCookieRequired,
} from "./signal-runtime";
import { poolScopeForAccount, isOverviewDemo, sameSignalPool } from "./signal-pool-scope";

const scrypt = promisify(nodeScrypt);
const sessionCookieName = "fsp_signal_session";
const sessionLifetimeMs = 1000 * 60 * 60 * 24 * 14;
if (process.env.NODE_ENV === "production" && !process.env.VERIFICATION_TOKEN_SECRET) {
  throw new Error("VERIFICATION_TOKEN_SECRET must be set in production");
}
const verificationSecret =
  process.env.VERIFICATION_TOKEN_SECRET ?? randomBytes(32).toString("hex");

export type SignalUser = typeof signalUsersTable.$inferSelect;
export type AuthenticatedSignalSession = {
  user: SignalUser;
  demoMode: boolean;
  reviewScopeId: string | null;
  overviewDemo: boolean;
  reviewMode: boolean;
  expiresAt: Date;
};

export type PublicSignalUser = {
  id: number;
  email: string;
  role: "candidate" | "employer";
  displayName: string;
  companyName: string | null;
  demoMode: boolean;
  reviewMode: boolean;
};

export function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}

/** Hash a short-lived verification code with a server-side secret. */
export function hashVerificationCode(code: string): string {
  return createHmac("sha256", verificationSecret).update(code).digest("hex");
}

export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16).toString("hex");
  const derived = (await scrypt(password, salt, 64)) as Buffer;
  return `scrypt:${salt}:${derived.toString("hex")}`;
}

export async function verifyPassword(
  password: string,
  stored: string,
): Promise<boolean> {
  const [algorithm, salt, expectedHex] = stored.split(":");
  if (
    algorithm !== "scrypt" ||
    !/^[a-f0-9]{32}$/i.test(salt ?? "") ||
    !/^[a-f0-9]{128}$/i.test(expectedHex ?? "")
  ) {
    return false;
  }
  try {
    const expected = Buffer.from(expectedHex, "hex");
    const actual = (await scrypt(password, salt, expected.length)) as Buffer;
    return expected.length === actual.length && timingSafeEqual(expected, actual);
  } catch {
    return false;
  }
}

function sessionCookieOptions() {
  return {
    httpOnly: true,
    secure: isSecureCookieRequired(),
    sameSite: "strict" as const,
    path: "/",
  };
}

export async function createSession(
  response: Response,
  user: Pick<SignalUser, "id" | "demoMode"> & Partial<Pick<SignalUser, "reviewScopeId">>,
): Promise<Date> {
  const rawToken = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + sessionLifetimeMs);
  await db.insert(signalSessionsTable).values({
    tokenHash: sha256(rawToken),
    userId: user.id,
    // Session pool membership always comes from the authenticated account,
    // never from a header or a route parameter.
    ...poolScopeForAccount(user),
    expiresAt,
  });
  response.cookie(sessionCookieName, rawToken, {
    ...sessionCookieOptions(),
    maxAge: sessionLifetimeMs,
  });
  return expiresAt;
}

export function clearSessionCookie(response: Response): void {
  response.clearCookie(sessionCookieName, sessionCookieOptions());
}

function rawSessionToken(request: Request): string | null {
  const rawToken: unknown = request.cookies?.[sessionCookieName];
  return typeof rawToken === "string" && /^[A-Za-z0-9_-]{43}$/.test(rawToken)
    ? rawToken
    : null;
}

export async function getSessionUser(
  request: Request,
): Promise<AuthenticatedSignalSession | null> {
  const rawToken = rawSessionToken(request);
  if (!rawToken) return null;
  const tokenHash = sha256(rawToken);
  const [session] = await db
    .select({
      user: signalUsersTable,
      demoMode: signalSessionsTable.demoMode,
      reviewScopeId: signalSessionsTable.reviewScopeId,
      expiresAt: signalSessionsTable.expiresAt,
    })
    .from(signalSessionsTable)
    .innerJoin(
      signalUsersTable,
      eq(signalSessionsTable.userId, signalUsersTable.id),
    )
    .where(
      and(
        eq(signalSessionsTable.tokenHash, tokenHash),
        gt(signalSessionsTable.expiresAt, new Date()),
      ),
    )
    .limit(1);
  if (!session) return null;

  const poolMismatch = !sameSignalPool(session, session.user);
  const disabledDemoPool = session.user.demoMode && !isDemoModeEnabled();
  if (poolMismatch || disabledDemoPool || !session.user.emailVerified) {
    await db
      .delete(signalSessionsTable)
      .where(eq(signalSessionsTable.tokenHash, tokenHash));
    return null;
  }
  return { ...session, overviewDemo: isOverviewDemo(session.user), reviewMode: session.user.reviewScopeId !== null };
}

export async function revokeSession(request: Request): Promise<void> {
  const rawToken = rawSessionToken(request);
  if (!rawToken) return;
  await db
    .delete(signalSessionsTable)
    .where(eq(signalSessionsTable.tokenHash, sha256(rawToken)));
}

export async function toPublicSignalUser(
  user: SignalUser,
  demoMode = user.demoMode,
): Promise<PublicSignalUser> {
  let companyName: string | null = null;
  if (user.role === "employer") {
    const [company] = await db
      .select({ name: signalCompaniesTable.name })
      .from(signalCompaniesTable)
      .where(eq(signalCompaniesTable.ownerUserId, user.id))
      .limit(1);
    companyName = company?.name ?? null;
  }
  return {
    id: user.id,
    email: user.email,
    role: user.role,
    displayName: user.displayName,
    companyName,
    demoMode,
    reviewMode: user.reviewScopeId !== null,
  };
}

export async function ensureCandidateProfile(user: SignalUser): Promise<void> {
  if (user.role !== "candidate") return;
  await db
    .insert(signalCandidateProfilesTable)
    .values({
      userId: user.id,
      professionalAlias: user.displayName,
      contactEmail: user.email,
      visibility: "private",
      consentMatching: false,
    })
    .onConflictDoNothing({ target: signalCandidateProfilesTable.userId });
}

export async function ensureEmployerCompany(user: SignalUser): Promise<void> {
  if (user.role !== "employer") return;
  await db
    .insert(signalCompaniesTable)
    .values({
      ownerUserId: user.id,
      name: user.displayName,
      contactEmail: user.email,
      contactMethod: "Электронная почта",
    })
    .onConflictDoNothing({ target: signalCompaniesTable.ownerUserId });
}

// Kept as a compatibility alias for callers that have not yet migrated.
export const isDemoEnvironment = isDemoModeEnabled;

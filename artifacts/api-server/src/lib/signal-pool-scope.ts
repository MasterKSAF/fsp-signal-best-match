import { and, eq, isNull, type SQL } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";

/** Persisted server membership. Review pairs never share the overview Demo pool. */
export type SignalPoolScope = { demoMode: boolean; reviewScopeId: string | null };
export type SignalScopedAccount = { demoMode: boolean; reviewScopeId?: string | null };
const scopeIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function poolScopeForAccount(account: SignalScopedAccount | boolean): SignalPoolScope {
  const scope = typeof account === "boolean"
    ? { demoMode: account, reviewScopeId: null }
    : { demoMode: account.demoMode, reviewScopeId: account.reviewScopeId ?? null };
  if (typeof scope.demoMode !== "boolean" || (scope.reviewScopeId !== null &&
      (!scope.demoMode || !scopeIdPattern.test(scope.reviewScopeId)))) {
    throw new Error("Invalid persisted Signal pool scope");
  }
  return scope;
}

/** Only seeded overview accounts get overview shortcuts; reviewers take ordinary exams. */
export function isOverviewDemo(account: SignalScopedAccount): boolean {
  const scope = poolScopeForAccount(account);
  return scope.demoMode && scope.reviewScopeId === null;
}

export function sameSignalPool(left: SignalScopedAccount, right: SignalScopedAccount): boolean {
  const a = poolScopeForAccount(left), b = poolScopeForAccount(right);
  return a.demoMode === b.demoMode && a.reviewScopeId === b.reviewScopeId;
}

/** Works with aliases; never derive this scope from a request body, query or header. */
export function signalPoolPredicate(
  userColumns: { demoMode: AnyPgColumn; reviewScopeId: AnyPgColumn },
  account: SignalScopedAccount | boolean,
): SQL {
  const scope = poolScopeForAccount(account);
  return and(eq(userColumns.demoMode, scope.demoMode), scope.reviewScopeId === null
    ? isNull(userColumns.reviewScopeId)
    : eq(userColumns.reviewScopeId, scope.reviewScopeId))!;
}

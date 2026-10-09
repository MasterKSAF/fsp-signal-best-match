import type { QueryClient } from '@tanstack/react-query';

const sessionGenerations = new WeakMap<QueryClient, number>();
export type AuthQuerySession = { userId: number; role: string; generation: number };

/** Only the session endpoint's explicit rejection proves the login is invalid.
 * Network failures and 5xx keep the last known account available for retry. */
export function isAuthSessionRejected(error: unknown): boolean {
  const status = error && typeof error === 'object' && 'status' in error ? error.status : undefined;
  return status === 401 || status === 403;
}

export function currentAuthUser<T extends { user?: unknown }>(data: T | null | undefined, error: unknown): T['user'] | undefined {
  return isAuthSessionRejected(error) ? undefined : data?.user;
}

/** React Query retains successful data after a failed refetch. Expire only the
 * rejected current request; a later successful login must win cancellation races. */
export async function expireRejectedAuthQuery(client: QueryClient, authKey: readonly string[], error: unknown): Promise<boolean> {
  const state = client.getQueryState<{ user?: unknown } | null>(authKey);
  if (!isAuthSessionRejected(error) || !state || state.error !== error || !state.data?.user) return false;
  const generation = (sessionGenerations.get(client) ?? 0) + 1;
  sessionGenerations.set(client, generation);
  await client.cancelQueries();
  if (sessionGenerations.get(client) !== generation || client.getQueryState(authKey)?.error !== error) return false;
  client.removeQueries({ predicate: query => query.queryKey.length !== authKey.length || authKey.some((part, index) => query.queryKey[index] !== part) });
  client.setQueryData(authKey, null);
  return true;
}

/** Mutations may finish after their component unmounts. Capture the current
 * login, not only the account ID (logout and login can return to the same ID). */
export function captureAuthQuerySession(client: QueryClient, authKey: readonly string[], userId: number, role: string): AuthQuerySession | null {
  const user = client.getQueryData<{ user?: { id: number; role: string } } | null>(authKey)?.user;
  return user?.id === userId && user.role === role ? { userId, role, generation: sessionGenerations.get(client) ?? 0 } : null;
}

export function isAuthQuerySessionCurrent(client: QueryClient, authKey: readonly string[], session: AuthQuerySession | undefined): boolean {
  if (!session || session.generation !== (sessionGenerations.get(client) ?? 0)) return false;
  const user = client.getQueryData<{ user?: { id: number; role: string } } | null>(authKey)?.user;
  return user?.id === session.userId && user.role === session.role;
}

/** Keep active auth observers attached while removing the previous user's data. */
export async function replaceAuthQueryCache<T>(client: QueryClient, authKey: readonly string[], session: T | null) {
  // Revoke mutation callbacks before cancelQueries yields to pending responses.
  sessionGenerations.set(client, (sessionGenerations.get(client) ?? 0) + 1);
  await client.cancelQueries();
  client.removeQueries({ predicate: query => query.queryKey.length !== authKey.length || authKey.some((part, index) => query.queryKey[index] !== part) });
  client.setQueryData(authKey, session);
}

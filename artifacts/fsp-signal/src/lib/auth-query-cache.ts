import type { QueryClient } from '@tanstack/react-query';

/** Keep active auth observers attached while removing the previous user's data. */
export async function replaceAuthQueryCache<T>(client: QueryClient, authKey: readonly string[], session: T | null) {
  await client.cancelQueries();
  client.removeQueries({ predicate: query => query.queryKey.length !== authKey.length || authKey.some((part, index) => query.queryKey[index] !== part) });
  client.setQueryData(authKey, session);
}

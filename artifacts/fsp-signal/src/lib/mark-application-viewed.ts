import type { MutationOptions, QueryClient } from '@tanstack/react-query';
import { captureAuthQuerySession, isAuthQuerySessionCurrent } from './auth-query-cache';

export type ApplicationViewedResponse = { id: number; status: string; resumeId: number };

/** A first detail GET may have read `sent` before the status POST committed.
 * Invalidation alone can reuse that pending GET when its cache has no data. */
export function markApplicationViewedMutationOptions(
  client: QueryClient,
  authKey: readonly string[],
  userId: number,
  send: (applicationId: number) => Promise<ApplicationViewedResponse>,
): MutationOptions<ApplicationViewedResponse, Error, number> {
  return {
    mutationFn: async applicationId => {
      const session = captureAuthQuerySession(client, authKey, userId, 'employer');
      if (!session) throw new Error('Сессия изменилась. Откройте отклики заново.');
      const result = await send(applicationId);
      if (!isAuthQuerySessionCurrent(client, authKey, session)) return result;
      const queries = [
        { queryKey: ['employer-application-detail', applicationId], exact: true },
        { queryKey: ['employer-applications'] },
        { queryKey: ['employer-jobs'] },
      ];
      // Explicit cancellation rejects the old retryer even when the transport
      // ignores AbortSignal. Its late result cannot replace the fresh response.
      await Promise.all(queries.map(filters => client.cancelQueries(filters)));
      if (!isAuthQuerySessionCurrent(client, authKey, session)) return result;
      // Read the full authorized response; the POST is not a substitute for ACL
      // checks or list filtering/counts, and no optimistic status is invented.
      await Promise.all(queries.map(filters => client.invalidateQueries(filters)));
      return result;
    },
  };
}

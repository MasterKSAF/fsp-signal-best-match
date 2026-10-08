import { QueryClient } from '@tanstack/react-query';

type QueryClientModuleState = { queryClient?: QueryClient };

/** Mounted observers must keep the same cache when an App module is replaced. */
export function queryClientForModule(hotData?: QueryClientModuleState): QueryClient {
  const client = hotData?.queryClient ?? new QueryClient();
  // A failed session check is a settled anonymous/error result. Remounting
  // a public header must not restart it and repeatedly replace the route tree.
  // Explicit auth cache updates, refetch and invalidation still work normally.
  client.setQueryDefaults(['/api/me'], { retry: false, retryOnMount: false });
  if (hotData) hotData.queryClient = client;
  return client;
}

// In production this imported module is evaluated once. Vite also retains the
// instance if this module itself changes, rather than detaching its observers.
const hotData = (import.meta as ImportMeta & { hot?: { data: QueryClientModuleState } }).hot?.data;
export const queryClient = queryClientForModule(hotData);

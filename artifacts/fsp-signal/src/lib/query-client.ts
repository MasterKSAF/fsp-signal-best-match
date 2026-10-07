import { QueryClient } from '@tanstack/react-query';

type QueryClientModuleState = { queryClient?: QueryClient };

/** Mounted observers must keep the same cache when an App module is replaced. */
export function queryClientForModule(hotData?: QueryClientModuleState): QueryClient {
  if (hotData?.queryClient) return hotData.queryClient;
  const client = new QueryClient();
  if (hotData) hotData.queryClient = client;
  return client;
}

// In production this imported module is evaluated once. Vite also retains the
// instance if this module itself changes, rather than detaching its observers.
const hotData = (import.meta as ImportMeta & { hot?: { data: QueryClientModuleState } }).hot?.data;
export const queryClient = queryClientForModule(hotData);

import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '../artifacts/fsp-signal/node_modules/@tanstack/react-query/build/modern/index.js';
import { queryClientForModule } from '../artifacts/fsp-signal/src/lib/query-client';

test('a retained module client invalidates the mounted resume observer after create without reload', async () => {
  const hotState: { queryClient?: QueryClient } = {};
  const before = queryClientForModule(hotState);
  let rows = [88, 110];
  const observer = new QueryObserver(before, { queryKey: ['candidate-resumes', 68],
    queryFn: async () => ({ resumes: rows.map(id => ({ id })) }), staleTime: Infinity, retry: false });
  const stop = observer.subscribe(() => {});
  try {
    await observer.refetch();
    assert.deepEqual(observer.getCurrentResult().data?.resumes.map(row => row.id), [88, 110]);
    const replacedAppClient = queryClientForModule(hotState);
    assert.equal(replacedAppClient, before);
    rows = [88, 110, 125];
    await replacedAppClient.invalidateQueries({ queryKey: ['candidate-resumes'] });
    assert.deepEqual(observer.getCurrentResult().data?.resumes.map(row => row.id), [88, 110, 125]);
    assert.equal(observer.getCurrentResult().data, replacedAppClient.getQueryData(['candidate-resumes', 68]));
  } finally { stop(); before.clear(); }
});

test('a recreated provider client is a negative control: its invalidation cannot reach the old observer', async () => {
  const old = new QueryClient(), recreated = new QueryClient();
  let rows = [88, 110];
  const observer = new QueryObserver(old, { queryKey: ['candidate-resumes', 68],
    queryFn: async () => ({ resumes: rows.map(id => ({ id })) }), staleTime: Infinity, retry: false });
  const stop = observer.subscribe(() => {});
  try {
    await observer.refetch();
    rows = [88, 110, 125];
    await recreated.invalidateQueries({ queryKey: ['candidate-resumes'] });
    assert.deepEqual(observer.getCurrentResult().data?.resumes.map(row => row.id), [88, 110]);
    await old.invalidateQueries({ queryKey: ['candidate-resumes'] });
    assert.deepEqual(observer.getCurrentResult().data?.resumes.map(row => row.id), [88, 110, 125]);
  } finally { stop(); old.clear(); recreated.clear(); }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver } from '../artifacts/fsp-signal/node_modules/@tanstack/react-query/build/modern/index.js';
import { replaceAuthQueryCache } from '../artifacts/fsp-signal/src/lib/auth-query-cache.ts';

const key = ['/api/me'] as const;

test('an already mounted auth observer receives logout and the next candidate without reload', async () => {
  const client = new QueryClient();
  const employer = { user: { id: 1, role: 'employer' } };
  const candidate = { user: { id: 2, role: 'candidate' } };
  client.setQueryData(key, employer);
  const observer = new QueryObserver<typeof employer | null>(client, { queryKey: key, enabled: false });
  const seen: unknown[] = [];
  const stop = observer.subscribe(value => seen.push(value.data));
  const authQuery = client.getQueryCache().find({ queryKey: key, exact: true });
  client.setQueryData(['candidate-resumes', 1], { resumes: [{ id: 91 }] });
  await replaceAuthQueryCache(client, key, null);
  assert.equal(observer.getCurrentResult().data, null);
  assert.equal(client.getQueryData(['candidate-resumes', 1]), undefined);
  await replaceAuthQueryCache(client, key, candidate);
  assert.deepEqual(observer.getCurrentResult().data, candidate);
  assert.equal(client.getQueryCache().find({ queryKey: key, exact: true }), authQuery);
  assert.ok(seen.includes(null));
  assert.ok(seen.some(value => (value as typeof candidate)?.user?.id === 2));
  stop(); client.clear();
});

test('an old account pending query cannot repopulate data after the session changes', async () => {
  const client = new QueryClient();
  client.setQueryData(key, { user: { id: 1 } });
  let release!: (value: unknown) => void;
  const request = client.fetchQuery({ queryKey: ['candidate-resumes', 1], queryFn: () => new Promise(resolve => { release = resolve; }) });
  const cancellation = request.catch(() => 'cancelled');
  await replaceAuthQueryCache(client, key, { user: { id: 2 } });
  release({ resumes: [{ id: 91 }] });
  assert.equal(await cancellation, 'cancelled');
  assert.equal(client.getQueryData(['candidate-resumes', 1]), undefined);
  assert.deepEqual(client.getQueryData(key), { user: { id: 2 } });
  client.clear();
});

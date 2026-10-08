import assert from 'node:assert/strict';
import test from 'node:test';
import { QueryObserver } from '../artifacts/fsp-signal/node_modules/@tanstack/react-query/build/modern/index.js';
import { queryClientForModule } from '../artifacts/fsp-signal/src/lib/query-client';
import { replaceAuthQueryCache } from '../artifacts/fsp-signal/src/lib/auth-query-cache';

const authKey = ['/api/me'] as const;
const denied = () => Object.assign(new Error('Unauthorized'), { status: 401 });

test('anonymous protected-route/header remounts settle one 401 instead of starting another auth check', async () => {
  const client = queryClientForModule();
  let requests = 0;
  const queryFn = async () => { requests++; throw denied(); };
  for (let mount = 0; mount < 20; mount++) {
    const observer = new QueryObserver(client, { queryKey: authKey, queryFn, retry: false });
    const unsubscribe = observer.subscribe(() => {});
    await client.getQueryCache().find({ queryKey: authKey })?.promise?.catch(() => {});
    const state = observer.getCurrentResult();
    assert.equal(state.status, 'error');
    assert.equal(state.isLoading, false, 'the auth-required branch must remain settled');
    assert.equal(state.fetchStatus, 'idle');
    assert.equal(requests, 1, 'mounting a public header must not trigger another /api/me');
    unsubscribe();
  }
  assert.equal(client.getDefaultOptions().queries?.retryOnMount, undefined, 'unrelated query policies are unchanged');
  client.clear();
});

test('settled session errors still allow explicit retry, current login cache and auth invalidation', async () => {
  const hotState = {};
  const client = queryClientForModule(hotState);
  assert.equal(queryClientForModule(hotState), client, 'HMR keeps the same configured client');
  let requests = 0;
  const session = { user: { id: 77, role: 'candidate' as const } };
  let allowed = false;
  const observer = new QueryObserver(client, {
    queryKey: authKey,
    queryFn: async () => { requests++; if (!allowed) throw denied(); return session; },
  });
  const unsubscribe = observer.subscribe(() => {});
  await client.getQueryCache().find({ queryKey: authKey })?.promise?.catch(() => {});
  assert.equal(requests, 1);
  allowed = true;
  const retried = await observer.refetch();
  assert.equal(retried.status, 'success');
  assert.equal(requests, 2);
  assert.deepEqual(retried.data, session);
  await replaceAuthQueryCache(client, authKey, { user: { id: 88, role: 'employer' } });
  assert.equal(observer.getCurrentResult().data?.user.id, 88, 'login/role switch reaches attached auth observers');
  await client.invalidateQueries({ queryKey: authKey });
  assert.equal(requests, 3, 'explicit invalidation remains effective');
  assert.equal(observer.getCurrentResult().data?.user.id, 77);
  await replaceAuthQueryCache(client, authKey, null);
  assert.equal(observer.getCurrentResult().data, null, 'logout removes the authenticated session');
  unsubscribe();
  client.clear();
});

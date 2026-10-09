import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, QueryObserver, MutationObserver } from '../artifacts/fsp-signal/node_modules/@tanstack/react-query/build/modern/index.js';
import { replaceAuthQueryCache } from '../artifacts/fsp-signal/src/lib/auth-query-cache';
import { markApplicationViewedMutationOptions, type ApplicationViewedResponse } from '../artifacts/fsp-signal/src/lib/mark-application-viewed';

const authKey = ['/api/me'] as const;
const detailKey = (id: number) => ['employer-application-detail', id] as const;
const listKey = ['employer-applications', 'page=1'] as const;
const jobsKey = ['employer-jobs'] as const;
const session = (id = 700001, role = 'employer') => ({ user: { id, role } });
const application = (status = 'sent', id = 800001): ApplicationViewedResponse => ({ id, status, resumeId: id + 1 });
const listing = (status = 'sent') => ({ items: [application(status)] });

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
function clientForEmployer() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: Infinity }, mutations: { retry: false, gcTime: Infinity } } });
  client.setQueryData(authKey, session());
  return client;
}
function controlledQuery<T>(client: QueryClient, queryKey: readonly unknown[], count = 2) {
  const gates = Array.from({ length: count }, () => ({ started: deferred<void>(), response: deferred<T>() }));
  let calls = 0;
  const observer = new QueryObserver<T>(client, { queryKey, staleTime: Infinity,
    queryFn: () => {
      const gate = gates[calls++];
      assert.ok(gate, 'unexpected additional request');
      gate.started.resolve();
      // Deliberately ignore AbortSignal: even a transport that finishes after
      // cancellation must not overwrite the authoritative replacement GET.
      return gate.response.promise;
    },
  });
  const stop = observer.subscribe(() => {});
  return { observer, gates, stop, calls: () => calls };
}
function pendingMutation(client: QueryClient, id = 800001) {
  const started = deferred<void>(), response = deferred<ApplicationViewedResponse>();
  const observer = new MutationObserver(client, markApplicationViewedMutationOptions(client, authKey, 700001,
    applicationId => { assert.equal(applicationId, id); started.resolve(); return response.promise; }));
  const promise = observer.mutate(id);
  return { observer, started: started.promise, response, promise };
}
async function releaseLate<T>(gate: { response: ReturnType<typeof deferred<T>> }, value: T) {
  gate.response.resolve(value);
  await gate.response.promise;
  await Promise.resolve();
}

test('negative control: invalidate-only really reuses the pending initial GET and leaves sent after POST', async () => {
  const client = clientForEmployer();
  const detail = controlledQuery<ApplicationViewedResponse>(client, detailKey(800001));
  try {
    await detail.gates[0].started.promise;
    assert.equal(client.getQueryData(detailKey(800001)), undefined);
    const invalidating = deferred<void>();
    const post = new MutationObserver(client, { mutationFn: async () => application('viewed'),
      onSuccess: () => {
        const pending = client.invalidateQueries({ queryKey: detailKey(800001), exact: true });
        invalidating.resolve();
        return pending;
      },
    });
    const completed = post.mutate(undefined);
    // The server mutation succeeds while the initial GET still holds sent.
    await invalidating.promise;
    await releaseLate(detail.gates[0], application('sent'));
    await completed;
    assert.equal(detail.calls(), 1);
    assert.equal(detail.observer.getCurrentResult().data?.status, 'sent');
  } finally { detail.stop(); client.clear(); }
});

test('first open: confirmed POST cancels pending detail/list GETs and late sent responses cannot roll back fresh viewed', async () => {
  const client = clientForEmployer();
  const detail = controlledQuery<ApplicationViewedResponse>(client, detailKey(800001));
  const list = controlledQuery<ReturnType<typeof listing>>(client, listKey);
  try {
    await Promise.all([detail.gates[0].started.promise, list.gates[0].started.promise]);
    const post = pendingMutation(client);
    await post.started;
    assert.equal(detail.calls(), 1);
    assert.equal(list.calls(), 1);
    assert.equal(client.getQueryData(detailKey(800001)), undefined, 'no optimistic viewed before POST');
    post.response.resolve(application('viewed'));
    await Promise.all([detail.gates[1].started.promise, list.gates[1].started.promise]);
    assert.equal(client.getQueryData(detailKey(800001)), undefined, 'POST response must not fabricate a full ACL-protected detail');
    detail.gates[1].response.resolve(application('viewed'));
    list.gates[1].response.resolve(listing('viewed'));
    await post.promise;
    await releaseLate(detail.gates[0], application('sent'));
    await releaseLate(list.gates[0], listing('sent'));
    assert.equal(detail.calls(), 2);
    assert.equal(list.calls(), 2);
    assert.equal(detail.observer.getCurrentResult().data?.status, 'viewed');
    assert.equal(list.observer.getCurrentResult().data?.items[0].status, 'viewed');
    assert.equal(post.observer.getCurrentResult().status, 'success');
  } finally { detail.stop(); list.stop(); client.clear(); }
});

test('normal path: detail GET completed before POST, both active views refresh from the server', async () => {
  const client = clientForEmployer();
  client.setQueryData(detailKey(800001), application());
  client.setQueryData(listKey, listing());
  client.setQueryData(jobsKey, [{ id: 33, applicationCount: 1 }]);
  const detail = controlledQuery<ApplicationViewedResponse>(client, detailKey(800001), 1);
  const list = controlledQuery<ReturnType<typeof listing>>(client, listKey, 1);
  const jobs = controlledQuery<Array<{ id: number; applicationCount: number }>>(client, jobsKey, 1);
  try {
    const post = pendingMutation(client);
    await post.started;
    assert.equal(detail.observer.getCurrentResult().data?.status, 'sent');
    post.response.resolve(application('viewed'));
    await Promise.all([detail.gates[0].started.promise, list.gates[0].started.promise, jobs.gates[0].started.promise]);
    detail.gates[0].response.resolve(application('viewed'));
    list.gates[0].response.resolve(listing('viewed'));
    jobs.gates[0].response.resolve([{ id: 33, applicationCount: 1 }]);
    await post.promise;
    assert.equal(detail.observer.getCurrentResult().data?.status, 'viewed');
    assert.equal(list.observer.getCurrentResult().data?.items[0].status, 'viewed');
    assert.equal(jobs.calls(), 1);
  } finally { detail.stop(); list.stop(); jobs.stop(); client.clear(); }
});

for (const status of [403, 409]) {
  test(`POST ${status} is preserved, never invents viewed, and does not cancel a pending legitimate GET`, async () => {
    const client = clientForEmployer();
    const detail = controlledQuery<ApplicationViewedResponse>(client, detailKey(800001), 1);
    const list = controlledQuery<ReturnType<typeof listing>>(client, listKey, 1);
    const failure = Object.assign(new Error(`HTTP ${status}`), { status });
    try {
      await Promise.all([detail.gates[0].started.promise, list.gates[0].started.promise]);
      const post = pendingMutation(client);
      const rejected = assert.rejects(post.promise, error => error === failure);
      await post.started;
      post.response.reject(failure);
      await rejected;
      const serverStatus = status === 409 ? 'withdrawn' : 'sent';
      await releaseLate(detail.gates[0], application(serverStatus));
      await releaseLate(list.gates[0], listing(serverStatus));
      assert.equal(detail.calls(), 1);
      assert.equal(list.calls(), 1);
      assert.equal(detail.observer.getCurrentResult().data?.status, serverStatus);
      assert.equal(list.observer.getCurrentResult().data?.items[0].status, serverStatus);
      assert.equal(post.observer.getCurrentResult().error, failure);
    } finally { detail.stop(); list.stop(); client.clear(); }
  });
}

test('fresh detail GET 403 remains a visible query error after successful POST; late old detail cannot restore access', async () => {
  const client = clientForEmployer();
  const detail = controlledQuery<ApplicationViewedResponse>(client, detailKey(800001));
  const failure = Object.assign(new Error('Access revoked'), { status: 403 });
  try {
    await detail.gates[0].started.promise;
    const post = pendingMutation(client);
    await post.started;
    post.response.resolve(application('viewed'));
    await detail.gates[1].started.promise;
    detail.gates[1].response.reject(failure);
    await post.promise;
    await releaseLate(detail.gates[0], application('sent'));
    assert.equal(detail.observer.getCurrentResult().error, failure);
    assert.equal(detail.observer.getCurrentResult().isError, true);
    assert.equal(detail.observer.getCurrentResult().data, undefined);
  } finally { detail.stop(); client.clear(); }
});

test('a later authoritative declined status wins over the successful viewed POST receipt', async () => {
  const client = clientForEmployer();
  client.setQueryData(detailKey(800001), application());
  client.setQueryData(listKey, listing());
  const detail = controlledQuery<ApplicationViewedResponse>(client, detailKey(800001), 1);
  const list = controlledQuery<ReturnType<typeof listing>>(client, listKey, 1);
  try {
    const post = pendingMutation(client);
    await post.started;
    post.response.resolve(application('viewed'));
    await Promise.all([detail.gates[0].started.promise, list.gates[0].started.promise]);
    detail.gates[0].response.resolve(application('declined'));
    list.gates[0].response.resolve(listing('declined'));
    await post.promise;
    assert.equal(detail.observer.getCurrentResult().data?.status, 'declined');
    assert.equal(list.observer.getCurrentResult().data?.items[0].status, 'declined');
  } finally { detail.stop(); list.stop(); client.clear(); }
});

test('exact detail key: opening application A never cancels, invalidates, or overwrites pending application B', async () => {
  const client = clientForEmployer();
  const other = controlledQuery<ApplicationViewedResponse>(client, detailKey(800002), 1);
  try {
    await other.gates[0].started.promise;
    const post = pendingMutation(client);
    await post.started;
    post.response.resolve(application('viewed'));
    await post.promise;
    assert.equal(client.getQueryState(detailKey(800002))?.isInvalidated, false);
    assert.equal(client.getQueryState(detailKey(800002))?.fetchStatus, 'fetching');
    await releaseLate(other.gates[0], application('declined', 800002));
    assert.equal(other.calls(), 1);
    assert.equal(other.observer.getCurrentResult().data?.id, 800002);
    assert.equal(other.observer.getCurrentResult().data?.status, 'declined');
    assert.equal(client.getQueryData(detailKey(800001)), undefined, 'absent full detail is not synthesized from POST');
  } finally { other.stop(); client.clear(); }
});

for (const nextSession of [null, session(700002), session(700002, 'candidate'), session(700001)]) {
  test(`old POST callback cannot alter a replacement session: ${nextSession ? `${nextSession.user.role}/${nextSession.user.id}` : 'logout'}`, async () => {
    const client = clientForEmployer();
    const post = pendingMutation(client);
    await post.started;
    await replaceAuthQueryCache(client, authKey, null);
    if (nextSession) await replaceAuthQueryCache(client, authKey, nextSession);
    const current = application('declined');
    client.setQueryData(detailKey(800001), current);
    client.setQueryData(listKey, listing('declined'));
    const detail = controlledQuery<ApplicationViewedResponse>(client, detailKey(800001), 1);
    try {
      post.response.resolve(application('viewed'));
      await post.promise;
      assert.deepEqual(client.getQueryData(authKey), nextSession);
      assert.deepEqual(detail.observer.getCurrentResult().data, current);
      assert.deepEqual(client.getQueryData(listKey), listing('declined'));
      assert.equal(client.getQueryState(detailKey(800001))?.isInvalidated, false);
      assert.equal(client.getQueryState(listKey)?.isInvalidated, false);
      assert.equal(detail.calls(), 0);
    } finally { detail.stop(); client.clear(); }
  });
}

test('stale employer page cannot send mark-viewed under another current account', async () => {
  const client = clientForEmployer();
  client.setQueryData(authKey, session(700002));
  let sends = 0;
  const post = new MutationObserver(client, markApplicationViewedMutationOptions(client, authKey, 700001,
    async () => { sends++; return application('viewed'); }));
  try {
    await assert.rejects(post.mutate(800001), /Сессия изменилась/);
    assert.equal(sends, 0);
    assert.equal(client.getQueryData(detailKey(800001)), undefined);
  } finally { client.clear(); }
});

test('rapid repeated Open of the same selected application cannot let either older GET undo viewed', async () => {
  const client = clientForEmployer();
  const detail = controlledQuery<ApplicationViewedResponse>(client, detailKey(800001), 3);
  const responses = [deferred<ApplicationViewedResponse>(), deferred<ApplicationViewedResponse>()];
  const started = [deferred<void>(), deferred<void>()];
  let sends = 0;
  const post = new MutationObserver(client, markApplicationViewedMutationOptions(client, authKey, 700001,
    () => { const index = sends++; started[index].resolve(); return responses[index].promise; }));
  try {
    await detail.gates[0].started.promise;
    const first = post.mutate(800001);
    await started[0].promise;
    const second = post.mutate(800001);
    await started[1].promise;
    responses[0].resolve(application('viewed'));
    await detail.gates[1].started.promise;
    responses[1].resolve(application('viewed'));
    await detail.gates[2].started.promise;
    detail.gates[2].response.resolve(application('viewed'));
    await Promise.all([first, second]);
    await releaseLate(detail.gates[0], application('sent'));
    await releaseLate(detail.gates[1], application('sent'));
    assert.equal(sends, 2);
    assert.equal(detail.calls(), 3);
    assert.equal(detail.observer.getCurrentResult().data?.status, 'viewed');
    assert.equal(detail.observer.getCurrentResult().data?.id, 800001);
  } finally { detail.stop(); client.clear(); }
});

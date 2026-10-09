import test from 'node:test';
import assert from 'node:assert/strict';
import { QueryClient, MutationObserver, QueryObserver } from '../artifacts/fsp-signal/node_modules/@tanstack/react-query/build/modern/index.js';
import { replaceAuthQueryCache } from '../artifacts/fsp-signal/src/lib/auth-query-cache';
import { companyQueryKey, companySaveMutationOptions, type CompanyProfile, type CompanyResponse, type CompanyDraft } from '../artifacts/fsp-signal/src/lib/company-query';

const authKey = ['/api/me'] as const;
const session = (id: number, role = 'employer') => ({ user: { id, role } });
const company = (id: number, name = `Synthetic company ${id}`): CompanyProfile => ({ id, name, description: 'Synthetic in-memory company profile',
  industry: 'ИТ', inn: '', contactEmail: `company-${id}@example.test`, contactPhone: null, contactMethod: 'Электронная почта' });
const draft = (value: CompanyProfile): CompanyDraft => { const { id: _id, ...fields } = value; return fields; };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function pendingSave(client: QueryClient, userId: number) {
  const started = deferred<void>(), response = deferred<CompanyResponse>();
  const notices: number[] = [];
  // These are the actual options consumed by CompanyPage, not a copied callback.
  const observer = new MutationObserver(client, companySaveMutationOptions(client, authKey, userId,
    () => { started.resolve(); return response.promise; }, saved => notices.push(saved.id)));
  const unmount = observer.subscribe(() => {});
  const saved = observer.mutate(draft(company(userId)));
  return { started: started.promise, release: response.resolve, saved, unmount, notices };
}

test('pending company mutation cannot repopulate or invalidate another employer after the form unmounts', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const A = company(900001), B = company(900002);
  client.setQueryData(authKey, session(A.id));
  client.setQueryData(companyQueryKey(A.id), { company: A });
  const pending = pendingSave(client, A.id);
  await pending.started;
  pending.unmount();
  await replaceAuthQueryCache(client, authKey, null);
  await replaceAuthQueryCache(client, authKey, session(B.id));
  client.setQueryData(companyQueryKey(B.id), { company: B });
  let refetches = 0;
  const current = new QueryObserver<CompanyResponse>(client, { queryKey: companyQueryKey(B.id), staleTime: Infinity,
    queryFn: async () => { refetches++; return { company: B }; } });
  const stop = current.subscribe(() => {});
  try {
    pending.release({ company: A });
    await pending.saved;
    assert.equal(client.getQueryData<ReturnType<typeof session>>(authKey)?.user.id, B.id);
    assert.deepEqual(current.getCurrentResult().data, { company: B });
    assert.equal(client.getQueryData(companyQueryKey(A.id)), undefined);
    assert.equal(client.getQueryData(['employer-company']), undefined);
    assert.equal(client.getQueryState(companyQueryKey(B.id))?.isInvalidated, false);
    assert.equal(refetches, 0, 'old mutation must not invalidate B or trigger another request');
    assert.deepEqual(pending.notices, [], 'late callback must not update local form state');
  } finally { stop(); client.clear(); }
});

test('logout or candidate login discards the old employer mutation response', async () => {
  for (const next of [null, session(900003, 'candidate')]) {
    const client = new QueryClient();
    client.setQueryData(authKey, session(900001));
    const pending = pendingSave(client, 900001);
    await pending.started;
    pending.unmount();
    await replaceAuthQueryCache(client, authKey, next);
    pending.release({ company: company(900001) });
    await pending.saved;
    assert.deepEqual(client.getQueryData(authKey), next);
    assert.equal(client.getQueryData(companyQueryKey(900001)), undefined);
    assert.deepEqual(pending.notices, []);
    client.clear();
  }
});

test('returning to the same employer creates a new session that rejects the old save', async () => {
  const client = new QueryClient();
  client.setQueryData(authKey, session(900001));
  const pending = pendingSave(client, 900001);
  await pending.started;
  pending.unmount();
  await replaceAuthQueryCache(client, authKey, null);
  await replaceAuthQueryCache(client, authKey, session(900001));
  const current = { company: company(900001, 'Company from the new login') };
  client.setQueryData(companyQueryKey(900001), current);
  pending.release({ company: company(900001, 'Late company from old login') });
  await pending.saved;
  assert.deepEqual(client.getQueryData(companyQueryKey(900001)), current);
  assert.equal(client.getQueryState(companyQueryKey(900001))?.isInvalidated, false);
  assert.deepEqual(pending.notices, []);
  client.clear();
});

test('session transition revokes old callbacks before asynchronous query cancellation finishes', async () => {
  const client = new QueryClient();
  client.setQueryData(authKey, session(900001));
  const pending = pendingSave(client, 900001);
  await pending.started;
  pending.unmount();
  const transition = replaceAuthQueryCache(client, authKey, session(900002));
  pending.release({ company: company(900001) });
  await Promise.all([transition, pending.saved]);
  assert.deepEqual(client.getQueryData(authKey), session(900002));
  assert.equal(client.getQueryData(companyQueryKey(900001)), undefined);
  assert.deepEqual(pending.notices, []);
  client.clear();
});

test('normal company save updates the mounted form and header using one scoped envelope', async () => {
  const client = new QueryClient();
  client.setQueryData(authKey, session(900001));
  const before = company(900001), after = company(900001, 'Updated company name');
  client.setQueryData(companyQueryKey(900001), { company: before });
  client.setQueryData(companyQueryKey(900002), { company: company(900002) });
  const header = new QueryObserver<CompanyResponse>(client, { queryKey: companyQueryKey(900001), enabled: false });
  const form = new QueryObserver<CompanyResponse, Error, CompanyProfile>(client, { queryKey: companyQueryKey(900001), enabled: false, select: data => data.company });
  const stopHeader = header.subscribe(() => {}), stopForm = form.subscribe(() => {});
  const notices: number[] = [];
  const save = new MutationObserver(client, companySaveMutationOptions(client, authKey, 900001, async () => ({ company: after }), saved => notices.push(saved.id)));
  try {
    await save.mutate(draft(after));
    assert.equal(header.getCurrentResult().data?.company.name, after.name);
    assert.deepEqual(form.getCurrentResult().data, after);
    assert.deepEqual(client.getQueryData(companyQueryKey(900001)), { company: after });
    assert.equal(client.getQueryState(companyQueryKey(900001))?.isInvalidated, true);
    assert.equal(client.getQueryState(companyQueryKey(900002))?.isInvalidated, false);
    assert.equal(client.getQueryData(['employer-company']), undefined);
    assert.deepEqual(notices, [900001]);
  } finally { stopHeader(); stopForm(); client.clear(); }
});

test('stale employer form cannot start a request under another current account', async () => {
  const client = new QueryClient();
  client.setQueryData(authKey, session(900002));
  let sends = 0;
  const save = new MutationObserver(client, companySaveMutationOptions(client, authKey, 900001,
    async () => { sends++; return { company: company(900001) }; }, () => assert.fail('No success callback expected')));
  await assert.rejects(save.mutate(draft(company(900001))), /Сессия изменилась/);
  assert.equal(sends, 0);
  client.clear();
});

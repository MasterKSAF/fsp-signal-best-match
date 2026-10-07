// Read-only synthetic check of installed QueryClient observer behavior; no browser/network/auth.
const { createRequire } = require('node:module');
const { resolve } = require('node:path');
const assert = require('node:assert/strict');
const frontendRequire = createRequire(resolve('artifacts/fsp-signal/package.json'));
const { QueryClient, QueryObserver } = frontendRequire('@tanstack/react-query');
const key = ['/api/me'];
const a = { user: { id: 1, role: 'candidate', displayName: 'Synthetic A' } };
const b = { user: { id: 2, role: 'candidate', displayName: 'Synthetic B' } };
const options = { queryKey: key, enabled: false, retry: false, queryFn: async () => { throw new Error('Network forbidden in this check'); } };
const client = new QueryClient();
client.setQueryData(key, a);
const existing = new QueryObserver(client, options), observed = [];
const unsubscribe = existing.subscribe(result => observed.push(result.data?.user?.id ?? null));
assert.equal(existing.getCurrentResult().data.user.id, 1);
client.clear(); client.setQueryData(key, b);
const newlyMounted = new QueryObserver(client, options);
const afterClear = {
  cacheUser: client.getQueryData(key).user.id,
  existingObserverUser: existing.getCurrentResult().data.user.id,
  newlyMountedObserverUser: newlyMounted.getCurrentResult().data.user.id,
};
assert.deepEqual(afterClear, { cacheUser: 2, existingObserverUser: 1, newlyMountedObserverUser: 2 });
existing.setOptions(options);
assert.equal(existing.getCurrentResult().data.user.id, 2);
unsubscribe(); existing.destroy(); newlyMounted.destroy(); client.clear();

const preserved = new QueryClient();
preserved.setQueryData(key, a);
preserved.setQueryData(['candidate-resumes', 1], { resumes: [1, 2, 3, 4, 5] });
const persistent = new QueryObserver(preserved, options);
const stop = persistent.subscribe(() => {});
preserved.removeQueries({ predicate: query => JSON.stringify(query.queryKey) !== JSON.stringify(key) });
preserved.setQueryData(key, b);
const preservingMeQuery = {
  cacheUser: preserved.getQueryData(key).user.id,
  existingObserverUser: persistent.getCurrentResult().data.user.id,
  oldAccountCacheAbsent: preserved.getQueryData(['candidate-resumes', 1]) === undefined,
};
assert.deepEqual(preservingMeQuery, { cacheUser: 2, existingObserverUser: 2, oldAccountCacheAbsent: true });
stop(); persistent.destroy(); preserved.clear();
console.log(JSON.stringify({ passed: true, afterClear, preservingMeQuery, scope: 'Installed QueryClient active-observer behavior only; browser incident causality not yet replayed.', networkRequests: 0 }));

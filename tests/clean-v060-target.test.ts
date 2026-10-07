import test from 'node:test';
import assert from 'node:assert/strict';
import { captureCleanV060Target } from '../scripts/lib/clean-v060-target';
const database = 'signal_clean_v060_f00dbabe';
const env: NodeJS.ProcessEnv = { SIGNAL_CLEAN_V060_ACCEPTANCE: '1', DEMO_MODE: 'true', SIGNAL_REVIEWER_PROFILE: 'isolated-local-review',
  DATABASE_URL: `postgresql://synthetic:synthetic@127.0.0.1:55441/${database}`, REVIEWER_DATABASE_NAME: database };
test('clean release is inactive unless explicitly selected', () => assert.equal(captureCleanV060Target({}, 'untrusted', 'untrusted'), null));
test('only the exact named fresh loopback clean target is accepted', () => assert.equal(captureCleanV060Target(env, 'http://127.0.0.1:4334', database)?.database, database));
test('stage, working, compiled, nonlocal and old clean ports cannot be used', () => {
  for (const port of [4310, 4314, 4363, 4365, 4330]) assert.throws(() => captureCleanV060Target(env, `http://127.0.0.1:${port}`, database));
  for (const url of [`postgresql://x:x@127.0.0.1:55435/${database}`, `postgresql://x:x@localhost:55441/${database}`, 'postgresql://x:x@127.0.0.1:55441/signal_resume_stage'])
    assert.throws(() => captureCleanV060Target({ ...env, DATABASE_URL: url }, 'http://127.0.0.1:4334', database));
});
test('ambiguous acceptance modes and missing isolated reviewer flags fail closed', () => {
  for (const flag of ['SIGNAL_V060_COMPILED_ACCEPTANCE', 'SIGNAL_ISOLATED_STAGE_ACCEPTANCE', 'SIGNAL_ISOLATED_FRESH_ACCEPTANCE'])
    assert.throws(() => captureCleanV060Target({ ...env, [flag]: '1' }, 'http://127.0.0.1:4334', database));
  for (const change of [{ DEMO_MODE: 'false' }, { SIGNAL_REVIEWER_PROFILE: '' }, { REVIEWER_DATABASE_NAME: 'other' }])
    assert.throws(() => captureCleanV060Target({ ...env, ...change }, 'http://127.0.0.1:4334', database));
});

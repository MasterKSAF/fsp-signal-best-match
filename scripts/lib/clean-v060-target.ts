import assert from 'node:assert/strict';

/** Only the newly owned 0.6 clean Compose target; never stage or compiled QA. */
export function captureCleanV060Target(environment: NodeJS.ProcessEnv, origin: string, databaseName: string) {
  if (environment.SIGNAL_CLEAN_V060_ACCEPTANCE !== '1') return null;
  for (const flag of ['SIGNAL_V060_COMPILED_ACCEPTANCE', 'SIGNAL_ISOLATED_STAGE_ACCEPTANCE', 'SIGNAL_ISOLATED_FRESH_ACCEPTANCE']) assert.notEqual(environment[flag], '1');
  assert.equal(environment.DEMO_MODE, 'true'); assert.equal(environment.SIGNAL_REVIEWER_PROFILE, 'isolated-local-review');
  assert.equal(origin, 'http://127.0.0.1:4334');
  assert.match(databaseName, /^signal_clean_v060_[a-f0-9]{8}$/);
  const database = new URL(environment.DATABASE_URL ?? 'postgresql://invalid');
  assert.ok(['postgresql:', 'postgres:'].includes(database.protocol));
  assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55441');
  assert.equal(database.pathname, '/' + databaseName);
  assert.equal(environment.REVIEWER_DATABASE_NAME, databaseName);
  return { database: databaseName, apiOrigin: origin, scope: 'New owned 0.6 clean Compose database only' };
}

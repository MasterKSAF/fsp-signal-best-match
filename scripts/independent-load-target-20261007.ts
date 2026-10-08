import assert from 'node:assert/strict';
/** New owned profile only. Previous 4315 load guards remain untouched. */
export function validatedIndependentLoadTarget(env: NodeJS.ProcessEnv) {
  assert.equal(env.SIGNAL_INDEPENDENT_PERF_ACCEPTANCE, '1');
  const database = new URL(env.DATABASE_URL ?? '');
  assert.equal(database.protocol, 'postgresql:');
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '55435');
  assert.equal(database.pathname, '/signal_independent_load_20261007');
  assert.equal(env.LOAD_API_ORIGIN, 'http://127.0.0.1:4369');
  assert.equal(env.INTEGRATION_APP_ORIGIN, 'http://127.0.0.1:4370');
  assert.ok(env.SIGNAL_INDEPENDENT_FORMS_PATH && env.SIGNAL_LOAD_RUNTIME_MANIFEST);
  return { key: 'independent-20261007', database: 'signal_independent_load_20261007', postgresPort: '55435', apiPort: '4369', appPort: '4370' };
}

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';

/** The additive 0.6 acceptance branch cannot fall back to the working stage. */
export function captureV060CompiledTarget(environment: NodeJS.ProcessEnv, apiOrigin: string, appOrigin: string) {
  if (environment.SIGNAL_V060_COMPILED_ACCEPTANCE !== '1') return null;
  assert.notEqual(environment.SIGNAL_ISOLATED_STAGE_ACCEPTANCE, '1');
  assert.notEqual(environment.SIGNAL_ISOLATED_FRESH_ACCEPTANCE, '1');
  const database = new URL(environment.DATABASE_URL ?? 'postgresql://invalid');
  assert.equal(database.hostname, '127.0.0.1');
  assert.equal(database.port, '55435');
  assert.equal(database.pathname, '/signal_resume_v060_compiled_check');
  assert.equal(apiOrigin, 'http://127.0.0.1:4365');
  assert.equal(appOrigin, 'http://127.0.0.1:4365');
  assert.equal(environment.DEMO_MODE, 'true');
  const expected = environment.SIGNAL_V060_COMPILED_API_SHA;
  assert.match(expected ?? '', /^[a-f0-9]{64}$/, 'Explicit normal compiled bundle SHA is required');
  const sha256 = createHash('sha256').update(readFileSync('artifacts/api-server/dist/index.mjs')).digest('hex');
  assert.equal(sha256, expected, 'Normal bundle must match the dedicated stand receipt');
  return { database: database.pathname.slice(1), apiOrigin, appOrigin, apiBundleSha256: sha256,
    scope: 'Dedicated compiled normal-delivery API; source script directly owns only its temporary fixture rows.' };
}

/** Run only after root releases the owned UI fixture. No broad cleanup. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { pool } from '../lib/db/src/index';
import { qaEnvironment, deleteOwnedActor, protectedState, proofDirectory, type OwnedActor } from './qa-owned-http-20261008';
qaEnvironment();
const file = 'C:/Users/Misha/.codex/private/signal-legacy-active-ui-20261008.json';
const fixture = JSON.parse(await readFile(file, 'utf8'));
assert.ok(fixture.actor.email.startsWith('legacy-active-') && fixture.actor.email.endsWith('@example.test'));
try {
  await deleteOwnedActor(fixture.actor as OwnedActor);
  const finalProtectedState = await protectedState();
  assert.deepEqual(finalProtectedState, fixture.protectedBefore);
  const reportPath = proofDirectory + '/legacy-active-restore-http.json';
  const report = JSON.parse(await readFile(reportPath, 'utf8'));
  report.cleanup = { cleaned: true, retainedForRootUi: false, ownFixtureOnly: true, afterRootUi: true };
  report.cleanupAt = new Date().toISOString();
  report.finalProtectedState = finalProtectedState;
  await writeFile(reportPath, JSON.stringify(report, null, 2));
  await writeFile(file, JSON.stringify({ cleaned: true, userId: fixture.actor.id, resumeId: fixture.resumeId, cleanedAt: report.cleanupAt }, null, 2));
  console.log(JSON.stringify({ cleaned: true, userId: fixture.actor.id, originalLegacyRows: 7, actor997Unchanged: true }));
} finally { await pool.end(); }

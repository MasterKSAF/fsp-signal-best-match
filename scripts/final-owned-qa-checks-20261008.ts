/** Final read-only receipt after root UI cleanup; preserve original data exactly. */
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { eq } from 'drizzle-orm';
import { db, pool, signalUsersTable as users } from '../lib/db/src/index';
import { qaEnvironment, guardRuntime, powershell, protectedState, proofDirectory } from './qa-owned-http-20261008';
qaEnvironment();
try {
  const file = proofDirectory + '/legacy-active-restore-http.json';
  const report = JSON.parse(await readFile(file,'utf8'));
  const fixture = JSON.parse(await readFile('C:/Users/Misha/.codex/private/signal-legacy-active-ui-20261008.json','utf8'));
  assert.equal(fixture.cleaned,true); assert.equal(report.passed,true); assert.equal(report.cleanup.cleaned,true);
  await guardRuntime(report.runtime.bundlePath,report.runtime.sha256,report.runtime.pid);
  assert.equal(Number(powershell('@(Get-NetTCPConnection -LocalPort 4389 -State Listen -ErrorAction SilentlyContinue).Count')),0);
  assert.equal((await db.select({ id:users.id }).from(users).where(eq(users.id,fixture.userId))).length,0);
  const finalProtectedState = await protectedState(); assert.deepEqual(finalProtectedState,report.preserved);
  assert.equal(finalProtectedState.legacy.count,7); assert.equal(finalProtectedState.legacy.md5,'8fe3a1ca84bf5f25bb357bee68ca0630');
  report.finalProtectedState = finalProtectedState; report.finalCheckedAt = new Date().toISOString();
  await writeFile(file,JSON.stringify(report,null,2));
  console.log(JSON.stringify({ passed:true, originalLegacyCount:7, originalLegacyMd5:finalProtectedState.legacy.md5, actor997Unchanged:true, ownedActorRemoved:true, temporary4389Free:true, normalPid:report.runtime.pid }));
} finally { await pool.end(); }

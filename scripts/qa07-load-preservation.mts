/** Local operation guard and exact-row preservation; no seed/reset or broad cleanup. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, realpath } from 'node:fs/promises';
import { resolve } from 'node:path';
import { and, eq, inArray, like } from 'drizzle-orm';

const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const protectedIds = [5056, 5123];
function targetGuard(api: string, database: string) {
  const web = new URL(api), sql = new URL(database);
  assert.ok(['http:'].includes(web.protocol) && ['127.0.0.1', 'localhost'].includes(web.hostname) && web.port === '4310' && web.pathname === '/' && !web.search && !web.hash && !web.username && !web.password, 'QA07 requires exact working loopback HTTP4310');
  assert.ok(sql.protocol === 'postgresql:' && ['127.0.0.1', 'localhost'].includes(sql.hostname) && sql.port === '55433' && sql.pathname === '/signal' && !sql.search && !sql.hash, 'QA07 requires exact working loopback PostgreSQL55433/signal');
  return { apiOrigin: web.origin, databaseHost: sql.hostname, databasePort: sql.port, databaseName: 'signal', credentialValuesExported: false };
}
function fixtureGuard(path: string, fixture: { id: string; createdUserIds: number[] }) {
  assert.match(fixture.id, /^[a-f0-9]{8}$/);
  assert.equal(resolve(path), resolve(`outputs/local-backup/load-scale-fixtures-${fixture.id}.json`), 'Cleanup file must be exact run-owned private path');
  assert.ok(Array.isArray(fixture.createdUserIds) && fixture.createdUserIds.length <= 1016);
  assert.equal(new Set(fixture.createdUserIds).size, fixture.createdUserIds.length);
  assert.ok(fixture.createdUserIds.every(id => Number.isSafeInteger(id) && id > 0 && !protectedIds.includes(id)), 'Cleanup IDs must be generated IDs, disjoint from protected ordinary accounts');
}
const mode = process.argv[2];
const proofPrefix = process.env.QA07_PRESERVATION_PREFIX || 'qa07-load';
assert.ok(['qa07-load','qa-cycle-03','qa-cycle-04','qa07-clean'].includes(proofPrefix),'Explicit preservation proof prefix only');
if (mode === '--guard-self-test') {
  targetGuard('http://127.0.0.1:4310', 'postgresql://signal:fixture-only@localhost:55433/signal');
  for (const [api, database] of [
    ['http://remote.invalid:4310', 'postgresql://signal:fixture-only@localhost:55433/signal'],
    ['http://localhost:4321', 'postgresql://signal:fixture-only@localhost:55433/signal'],
    ['http://localhost:4310/foreign', 'postgresql://signal:fixture-only@localhost:55433/signal'],
    ['http://localhost:4310', 'postgresql://signal:fixture-only@localhost:55435/signal'],
    ['http://localhost:4310', 'postgresql://signal:fixture-only@localhost:55433/foreign'],
  ]) assert.throws(() => targetGuard(api!, database!));
  const own = { id: 'a1b2c3d4', createdUserIds: [900001,900002] };
  fixtureGuard('outputs/local-backup/load-scale-fixtures-a1b2c3d4.json', own);
  assert.throws(() => fixtureGuard('outputs/local-backup/other.json', own));
  assert.throws(() => fixtureGuard('outputs/local-backup/load-scale-fixtures-a1b2c3d4.json', { ...own, createdUserIds:[5056] }));
  assert.throws(() => fixtureGuard('outputs/local-backup/load-scale-fixtures-a1b2c3d4.json', { ...own, createdUserIds:[900001,900001] }));
  assert.throws(() => fixtureGuard('outputs/local-backup/load-scale-fixtures-a1b2c3d4.json', { ...own, createdUserIds:[0] }));
  assert.throws(() => fixtureGuard('outputs/local-backup/load-scale-fixtures-a1b2c3d4.json', { ...own, createdUserIds:Array.from({length:1017},(_,index)=>900001+index) }));
  console.log(JSON.stringify({passed:true,groups:4,checks:['exact_working_target_only','wrong_origin_port_database_rejected','exact_private_fixture_path_only','protected_duplicate_invalid_IDs_rejected'],scope:'Pure operation guard; no HTTP/database use'}));
  process.exit(0);
}
const target = targetGuard(process.env.LOAD_API_ORIGIN || 'http://127.0.0.1:4310', process.env.DATABASE_URL || '');
if (mode === '--guard') {
  console.log(JSON.stringify({passed:true,readOnly:true,target}));
  process.exit(0);
}
assert.ok(['before','after','cleanup'].includes(mode!));
if (mode === 'cleanup') assert.equal(process.env.QA07_VIDEO_CAPTURE_RELEASED, '1', 'Cleanup belongs only to an authorized released load run');
const { db, pool, signalUsersTable: users, signalCandidateProfilesTable: profiles, signalAssessmentAttemptsTable: attempts, signalNeedsTable: needs } = await import('../lib/db/src/index.ts');
try {
  if (mode === 'cleanup') {
    const path = process.argv[3]!;
    assert.ok(path, 'Exact own fixture path required');
    assert.equal(await realpath(path), resolve(path), 'Fixture file must not be a symbolic link');
    const fixture = JSON.parse(await readFile(path, 'utf8'));
    fixtureGuard(path, fixture);
    const ids = fixture.createdUserIds as number[];
    const rows = ids.length ? await db.select({id:users.id,email:users.email}).from(users).where(inArray(users.id,ids)) : [];
    const prefix = `signal-scale-${fixture.id}-`;
    assert.ok(rows.every(row => row.email.startsWith(prefix) && row.email.endsWith('@example.test')), 'Every remaining cleanup ID must also match this exact synthetic run namespace');
    if (rows.length) await db.delete(users).where(and(inArray(users.id,ids),like(users.email,`${prefix}%@example.test`)));
    const remaining = ids.length ? (await db.select({id:users.id}).from(users).where(inArray(users.id,ids))).length : 0;
    assert.equal(remaining,0);
    console.log(JSON.stringify({passed:true,runId:fixture.id,capturedSyntheticUserCount:ids.length,removedByGuardedFallback:rows.length,remainingSyntheticUsers:remaining,scope:'Captured IDs intersected with exact own namespace only; no reset/seed or unrelated deletion'}));
  } else {
    const accounts = await db.select().from(users).where(inArray(users.id,protectedIds)).orderBy(users.id);
    assert.equal(accounts.length,2);
    assert.deepEqual(accounts.map(row=>row.id),protectedIds);
    assert.ok(accounts.every(row=>!row.demoMode));
    const profileRows = await db.select().from(profiles).where(inArray(profiles.userId,protectedIds)).orderBy(profiles.userId);
    const attemptRows = await db.select().from(attempts).where(eq(attempts.id,1134));
    const needRows = await db.select().from(needs).where(eq(needs.id,179));
    assert.equal(attemptRows.length,1); assert.equal(needRows.length,1);
    assert.ok(accounts.some(row=>row.id===attemptRows[0]!.userId && row.role==='candidate'));
    const state = {accounts:{count:accounts.length,ids:protectedIds,sha256:hash(accounts)},profiles:{count:profileRows.length,sha256:hash(profileRows)},attempt:{id:1134,sha256:hash(attemptRows)},need:{id:179,sha256:hash(needRows)}};
    const previous = mode==='after' ? JSON.parse(await readFile(`outputs/verification/${proofPrefix}-preserved-before.json`,'utf8')) : null;
    const preserved = previous ? JSON.stringify(previous.state)===JSON.stringify(state) : null;
    const report = {capturedAt:new Date().toISOString(),readOnly:true,target,state,preserved,scope:'Exact protected ordinary QA account/profile/attempt1134/need179 row hashes; no raw personal rows/passwords/answers exported'};
    await writeFile(`outputs/verification/${proofPrefix}-preserved-${mode}.json`,JSON.stringify(report,null,2)+'\n');
    if (mode==='after') assert.equal(preserved,true,'Protected ordinary QA records changed');
    console.log(JSON.stringify({passed:true,mode,readOnly:true,protectedAccounts:2,preserved}));
  }
} finally { await pool.end(); }

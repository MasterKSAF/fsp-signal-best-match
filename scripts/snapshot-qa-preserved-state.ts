/** Read-only before/after preservation check for explicitly protected QA rows. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
const target = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['localhost','127.0.0.1'].includes(target.hostname) && target.port === '55433', 'This read-only check targets the named working local DB');
const mode = process.argv[2];
assert.ok(mode === 'before' || mode === 'after');
const { db, pool, signalUsersTable: users, signalCandidateProfilesTable: profiles, signalAssessmentAttemptsTable: attempts, signalNeedsTable: needs } = await import('../lib/db/src/index');
const hash = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
try {
  const accounts = await db.select().from(users).where(inArray(users.email, ['qa-ui-candidate-20261006-f65aff@example.invalid','qa-ui-employer-20261006-f65aff@example.invalid'])).orderBy(users.id);
  assert.equal(accounts.length,2,'Protected ordinary accounts must exist');
  const profileRows = await db.select().from(profiles).where(inArray(profiles.userId,accounts.map(row=>row.id))).orderBy(profiles.userId);
  const attemptRows = await db.select().from(attempts).where(eq(attempts.id,1134));
  const needRows = await db.select().from(needs).where(eq(needs.id,179));
  assert.equal(attemptRows.length,1); assert.equal(needRows.length,1);
  assert.ok(accounts.some(row=>row.id===attemptRows[0].userId && row.role==='candidate'));
  const state = { accounts: { count: accounts.length, ids: accounts.map(row=>row.id), sha256: hash(accounts) }, profiles: { count: profileRows.length, sha256: hash(profileRows) }, attempt: { id:1134,sha256:hash(attemptRows) }, need: { id:179,sha256:hash(needRows) } };
  const path = `outputs/verification/qa-cycle-01-preserved-${mode}.json`;
  let preserved: boolean | null = null;
  if (mode==='after') {
    const previous=JSON.parse(await readFile('outputs/verification/qa-cycle-01-preserved-before.json','utf8'));
    preserved=JSON.stringify(previous.state)===JSON.stringify(state);
    assert.equal(preserved,true,'Protected QA rows changed');
  }
  await writeFile(path,JSON.stringify({ capturedAt:new Date().toISOString(),readOnly:true,scope:'Exact protected ordinary account/profile/attempt1134/need179 rows only; values never printed, no dump or secret material included',state,preserved },null,2)+'\n');
  console.log(JSON.stringify({readOnly:true,mode,accounts:accounts.length,attempt:1134,need:179,preserved}));
} finally { await pool.end(); }

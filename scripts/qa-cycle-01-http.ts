/** Actual isolated app regression. Exact newly created user IDs own every row. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { inArray } from 'drizzle-orm';
import { runQaIdHttp } from './qa-id-integration';

const base = process.env.QA_CYCLE_API_ORIGIN ?? '';
const target = new URL(base), database = new URL(process.env.DATABASE_URL ?? '');
assert.ok(['127.0.0.1','localhost'].includes(target.hostname) && target.port === '4321');
assert.ok(['127.0.0.1','localhost'].includes(database.hostname) && database.port === '55435');
const { db, pool, signalUsersTable: users, signalSessionsTable: sessions, signalCompaniesTable: companies } = await import('../lib/db/src/index');
const ids: number[] = [];
async function fixture(role: 'candidate' | 'employer') {
  const token = randomBytes(32).toString('base64url');
  const [user] = await db.insert(users).values({ email: `qa-id-${token.slice(0,12)}@example.test`, passwordHash: 'unusable-synthetic-fixture', role, displayName: 'Isolated QA ID fixture', emailVerified: true, demoMode: false }).returning();
  ids.push(user.id);
  await db.insert(sessions).values({ userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now()+600000), demoMode: false });
  if (role === 'employer') await db.insert(companies).values({ ownerUserId: user.id, name: 'Isolated QA ID company', contactEmail: user.email });
  return `fsp_signal_session=${token}`;
}
try {
  const candidateCookie = await fixture('candidate'), employerCookie = await fixture('employer');
  const report = await runQaIdHttp({ base, candidateCookie, employerCookie });
  await mkdir('outputs/verification', { recursive: true });
  await writeFile('outputs/verification/qa-cycle-01-id-http.json', JSON.stringify({ ...report, image: process.env.QA_TESTED_IMAGE ?? null, fixtureScope: 'Two newly captured isolated ordinary account IDs, removed in finally; independent working QA accounts untouched' }, null, 2)+'\n');
  console.log(JSON.stringify({ passed: report.passed, counts: report.counts }));
  assert.equal(report.passed, true, 'See exact failed ID requests in qa-cycle-01-id-http.json');
} finally {
  if (ids.length) await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
}

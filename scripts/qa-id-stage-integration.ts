import assert from 'node:assert/strict';
import { randomBytes, randomUUID, createHash } from 'node:crypto';
import { writeFile, mkdir } from 'node:fs/promises';
import { inArray, sql } from 'drizzle-orm';
import { runQaIdHttp } from './qa-id-integration';
const url = new URL(process.env.DATABASE_URL ?? 'postgresql://invalid');
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55435'); assert.equal(url.pathname, '/signal_resume_stage');
const { db, pool, signalUsersTable: users, signalSessionsTable: sessions, signalCompaniesTable: companies } = await import('../lib/db/src/index');
assert.equal((await db.execute(sql`select current_database() as name`)).rows[0]?.name, 'signal_resume_stage');
const prefix = 'qa-id-stage-' + randomUUID(), captured: number[] = [];
async function fixture(role: 'candidate' | 'employer') {
  const [user] = await db.insert(users).values({ email: `${prefix}-${role}@example.test`, passwordHash: 'unusable-synthetic-local-only', displayName: 'Synthetic ID acceptance', role, emailVerified: true, demoMode: false }).returning(); assert.ok(user); captured.push(user.id);
  if (role === 'employer') await db.insert(companies).values({ ownerUserId: user.id, name: 'Synthetic ID company', contactEmail: user.email });
  const token = randomBytes(32).toString('base64url'); await db.insert(sessions).values({ userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 3600000), demoMode: false });
  return 'fsp_signal_session=' + token;
}
try {
  const candidateCookie = await fixture('candidate'), employerCookie = await fixture('employer');
  const report = await runQaIdHttp({ base: 'http://127.0.0.1:4313', target: 'multi-resume-stage', candidateCookie, employerCookie });
  await mkdir('outputs/verification/assessment-purpose', { recursive: true });
  const path = process.env.INTEGRATION_REPORT_PATH ?? `outputs/verification/assessment-purpose/${prefix}.json`;
  await writeFile(path, JSON.stringify(report, null, 2)); console.log(JSON.stringify({ passed: report.passed, counts: report.counts, report: path }));
  assert.equal(report.passed, true);
} finally { if (captured.length) await db.delete(users).where(inArray(users.id, captured)); await pool.end(); }

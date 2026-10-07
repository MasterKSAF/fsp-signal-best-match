/** One real-time delivery to the privately owned UI pair; no worker-wide dispatch. */
import assert from 'node:assert/strict';
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
assert.equal(process.env.SIGNAL_V060_UI_PRACTICE_RELEASE, '1');
const url = new URL(process.env.DATABASE_URL ?? '');
assert.equal(url.hostname, '127.0.0.1'); assert.equal(url.port, '55435');
assert.equal(url.pathname, '/signal_resume_v060_check');
assert.equal(process.env.API_ORIGIN, 'http://127.0.0.1:4363');
const privateFile = join(homedir(), '.codex/private/signal-v060-ui-reviewers.json');
const manifest = JSON.parse(await readFile(privateFile, 'utf8'));
const candidate = manifest.accounts.find((a: any) => a.role === 'candidate');
const employer = manifest.accounts.find((a: any) => a.role === 'employer' && a.reviewScopeId === candidate?.reviewScopeId);
assert.ok(candidate?.id && employer?.id && candidate.reviewScopeId);
const { db, pool, signalUsersTable: users, signalCompaniesTable: companies, signalMicroSubscriptionsTable: subs,
  signalMicroTemplatesTable: templates, signalMicroOffersTable: offers, signalCandidateResumesTable: resumes } = await import('../lib/db/src/index.ts');
const { runMicrotaskScheduler } = await import('../artifacts/api-server/src/lib/microtask-scheduler.ts');
const now = new Date(), report: any = { schemaVersion: 1, applicationVersion: '0.6.0', passed: false,
  scope: 'Real current-time first offer for one privately owned isolated UI pair. No time acceleration, grade fabrication or broad scheduler dispatch.',
  startedAt: now.toISOString(), sourceRuntimeOnly: true, credentialsExported: false };
async function foreignCommitment() {
  const result = await db.execute(sql`SELECT (SELECT md5(coalesce(string_agg(to_jsonb(o)::text, '' ORDER BY o.id), '')) FROM signal_micro_offers o WHERE candidate_user_id <> ${candidate.id}) AS offers,
    (SELECT md5(coalesce(string_agg(to_jsonb(s)::text, '' ORDER BY s.id), '')) FROM signal_micro_subscriptions s WHERE candidate_user_id <> ${candidate.id}) AS subscriptions`);
  return result.rows[0];
}
try {
  const actors = await db.select({ id: users.id, scope: users.reviewScopeId, demo: users.demoMode }).from(users).where(sql`${users.id} IN (${candidate.id},${employer.id})`);
  assert.equal(actors.length, 2); assert.ok(actors.every(a => a.demo && a.scope === candidate.reviewScopeId));
  const rows = await db.select({ subscription: subs, template: templates, company: companies }).from(subs)
    .innerJoin(templates, eq(templates.id, subs.templateId)).innerJoin(companies, eq(companies.id, templates.companyId))
    .where(eq(subs.candidateUserId, candidate.id));
  assert.equal(rows.length, 1, 'Candidate filter must resolve to exactly one subscription');
  const row = rows[0]; assert.equal(row.company.ownerUserId, employer.id);
  assert.equal(row.template.title, 'Надёжный учебный счётчик'); assert.equal(row.subscription.resumeId, 110);
  assert.equal(row.subscription.active, true); assert.equal(row.template.active, true);
  assert.ok(row.subscription.nextDueAt.getTime() <= now.getTime(), 'No accelerated clock is allowed');
  const existing = await db.select({ id: offers.id }).from(offers).where(eq(offers.candidateUserId, candidate.id));
  assert.equal(existing.length, 0, 'Only a genuine first offer may be dispatched');
  const [resume] = await db.select().from(resumes).where(and(eq(resumes.id, 110), eq(resumes.userId, candidate.id)));
  assert.equal(resume?.verifiedGrade, 'Junior');
  const before = await foreignCommitment();
  const result = await runMicrotaskScheduler(now, [candidate.id]);
  assert.equal(result.checked, 1); assert.equal(result.created, 1);
  const [offer] = await db.select().from(offers).where(eq(offers.candidateUserId, candidate.id));
  assert.equal(offer.subscriptionId, row.subscription.id); assert.equal(offer.resumeId, 110);
  assert.equal(offer.resumeProvenance, 'captured'); assert.equal(offer.status, 'offered');
  assert.equal(offer.createdAt.toISOString(), now.toISOString());
  assert.deepEqual(await foreignCommitment(), before);
  report.passed = true; report.checked = 1; report.created = 1; report.offerId = offer.id;
  report.resumeId = 110; report.resumeRevision = offer.resumeRevision; report.foreignRowsUnchanged = true;
} catch (error) { report.failureKind = error instanceof Error ? error.name : 'Unknown'; process.exitCode = 1; }
finally {
  report.finishedAt = new Date().toISOString();
  report.schedulerSha256 = createHash('sha256').update(await readFile('artifacts/api-server/src/lib/microtask-scheduler.ts')).digest('hex');
  await mkdir('outputs/verification/release-0.6.0', { recursive: true });
  await writeFile('outputs/verification/release-0.6.0/ui-practice-real-time-dispatch.json', JSON.stringify(report, null, 2) + '\n');
  await pool.end(); console.log(JSON.stringify({ passed: report.passed, created: report.created ?? 0,
    offerId: report.offerId, report: 'outputs/verification/release-0.6.0/ui-practice-real-time-dispatch.json' }));
}

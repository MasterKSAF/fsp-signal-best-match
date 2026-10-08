/** Search/count/page regression; owned ordinary fixtures, no qualification fabrication. */
import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';
import { inArray } from 'drizzle-orm';
import { db, pool, signalCompaniesTable as companies, signalNeedsTable as needs, signalInvitationsTable as invitations } from '../lib/db/src/index';
import { qaEnvironment, guardRuntime, createOwnedActor, deleteOwnedActor, ok, protectedState, proofDirectory, type OwnedActor } from './qa-owned-http-20261008';

qaEnvironment();
const [bundlePath, expectedSha, expectedPid] = process.argv.slice(2);
const runtime = await guardRuntime(bundlePath, expectedSha, Number(expectedPid));
const before = await protectedState(); assert.equal(before.legacy.count, 7);
assert.equal(before.legacy.md5, '8fe3a1ca84bf5f25bb357bee68ca0630');
const owned: OwnedActor[] = [], invitationIds: number[] = [], checks: string[] = [];
let passed = false, failure: string | undefined, cleaned = false;
try {
  const candidate = await createOwnedActor('format-candidate', 'candidate', 'Михаил Андреевич Зорин'); owned.push(candidate);
  const other = await createOwnedActor('format-other', 'candidate', 'Александр Ильич Ветров'); owned.push(other);
  const employer = await createOwnedActor('format-company', 'employer', 'Ирина Михайловна Волкова'); owned.push(employer);
  const resume = (await ok(candidate, '/me/resumes')).resumes[0];
  const prefix = 'Format QA ' + candidate.id;
  const [company] = await db.insert(companies).values({ ownerUserId: employer.id, name: prefix, contactEmail: employer.email }).returning();
  const [need] = await db.insert(needs).values({ companyId: company.id, title: prefix, specialization: 'Backend / Python', grade: 'Junior', requiredSkills: [], description: 'Owned search fixture only', workFormat: 'Удалённо', salaryMin: 100000, salaryMax: 200000 }).returning();
  const descriptions = ['Удалённо', 'Офис', 'Гибрид', ...Array(4).fill('Удалённо или гибрид'), 'без удалённой работы', 'Офис, без удалённой работы', 'по договорённости', 'офис или другой формат'];
  const rows = await db.insert(invitations).values([...descriptions, 'Удалённо или гибрид'].map((workFormat, index) => ({ needId: need.id, companyId: company.id, candidateUserId: index === descriptions.length ? other.id : candidate.id, resumeId: index === descriptions.length ? null : resume.id, title: prefix + ' role ' + index, message: 'Synthetic search fixture', reason: 'No matching, proof or contact rights are granted by this fixture.', salaryMin: 100000, salaryMax: 200000, salaryPeriod: 'month' as const, salaryType: 'gross' as const, workFormat, status: index === 3 ? 'viewed' as const : 'sent' as const, createdAt: new Date('2026-10-08T10:00:00Z') }))).returning();
  invitationIds.push(...rows.map(row => row.id));
  const visible = rows.filter(row => row.candidateUserId === candidate.id);
  const search = (format: string, page = 1, sort = 'newest', extras: Record<string,string> = {}) => ok(candidate, '/me/invitations/search?' + new URLSearchParams({ q: prefix, status: 'pending', resumeId: String(resume.id), workFormat: format, pageSize: '2', page: String(page), sort, ...extras }));
  const all = await search('', 1, 'newest', { pageSize: '100' });
  assert.equal(all.total, descriptions.length); assert.equal(all.items.length, descriptions.length);
  assert.ok(!all.items.some((row: any) => row.id === rows.at(-1)!.id));
  for (const row of all.items) assert.equal(row.workFormat, visible.find(record => record.id === row.id)!.workFormat);
  checks.push('Unfiltered history retains all 11 exact descriptions and excludes the other candidate');
  for (const [format, indices] of [['Удалённо', [0,3,4,5,6]], ['Гибрид', [2,3,4,5,6]], ['Офис', [1,8]]] as const) {
    const expected = indices.map(index => rows[index].id).sort((a,b) => b-a);
    const found: number[] = [];
    for (let page = 1; page <= Math.ceil(expected.length / 2); page++) {
      const response = await search(format, page);
      assert.equal(response.total, expected.length); assert.equal(response.page, page); assert.equal(response.pageCount, Math.ceil(expected.length / 2));
      found.push(...response.items.map((row: any) => row.id));
      for (const row of response.items) assert.equal(row.workFormat, rows.find(record => record.id === row.id)!.workFormat);
    }
    assert.deepEqual(found, expected); assert.equal(new Set(found).size, expected.length);
    const oldest = await search(format, 1, 'oldest', { pageSize: '100' });
    assert.deepEqual(oldest.items.map((row: any) => row.id), expected.toReversed());
    const clamped = await search(format, 99); assert.equal(clamped.page, Math.ceil(expected.length/2)); assert.equal(clamped.total, expected.length);
    checks.push(`${format}: exact IDs, all pages, count, stable inverse sort and page clamp agree (${expected.length} matches)`);
  }
  const sent = await search('Удалённо', 1, 'newest', { status: 'sent', pageSize: '100' });
  assert.equal(sent.total, 4); assert.ok(!sent.items.some((row: any) => row.id === rows[3].id));
  const viewed = await search('Гибрид', 1, 'newest', { status: 'viewed' });
  assert.equal(viewed.total, 1); assert.equal(viewed.items[0].id, rows[3].id);
  const empty = await search('Удалённо', 1, 'newest', { q: prefix + ' role 7' });
  assert.equal(empty.total, 0); assert.equal(empty.pageCount, 0); assert.deepEqual(empty.items, []);
  checks.push('Status/resume/title filters compose with format; negated-only description has zero remote matches');
  passed = true;
} catch (error) { failure = error instanceof Error ? error.message : String(error); }
finally {
  try {
    for (const actor of owned.toReversed()) await deleteOwnedActor(actor);
    assert.equal(invitationIds.length ? (await db.select({ id: invitations.id }).from(invitations).where(inArray(invitations.id, invitationIds))).length : 0, 0);
    const after = await protectedState(); assert.deepEqual(after, before); cleaned = true;
    checks.push('Only captured fixtures removed; original seven legacy rows and actor997 content/limits unchanged');
  } catch (error) { passed = false; failure = [failure, 'Cleanup/preservation: ' + String(error)].filter(Boolean).join('; '); }
  await pool.end(); await mkdir(proofDirectory, { recursive: true });
  await writeFile(proofDirectory + '/invitation-work-format-http.json', JSON.stringify({ passed, failure, checks, runtime, synthetic: true, fixtureScope: 'Direct owned invitation conditions test search; no exam result or qualification is fabricated.', cleanup: { cleaned, usersCreated: owned.length, invitationCount: invitationIds.length, ownFixturesOnly: true }, preserved: before, measuredAt: new Date().toISOString() }, null, 2));
  console.log(JSON.stringify({ passed, checks: checks.length, failure, cleaned, sha256: runtime.sha256 }));
}
if (!passed) process.exitCode = 1;

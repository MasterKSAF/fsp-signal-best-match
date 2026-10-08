/**
 * A03 bounded HTTP/PG regression. Requires coordinator-reviewed clean runtime and core actors.
 * Never targets the protected/UI-refinement databases. Creates marked own fixtures only;
 * preserves all own records and each run receipt in the dedicated audit database.
 */
import assert from 'node:assert/strict';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { and, eq, inArray } from 'drizzle-orm';
import {
  db, pool, signalUsersTable as users, signalSessionsTable as sessions,
  signalCompaniesTable as companies, signalCandidateProfilesTable as profiles,
  signalCandidateResumesTable as resumes, signalJobsTable as jobs,
  signalApplicationsTable as applications, signalCompanyBlocksTable as blocks, signalContactGrantsTable as grants,
} from '../lib/db/src/index';
import { signalJobRequirementsTable as requirements } from '../lib/db/src/schema/signal-job-discovery';
import { hashPassword } from '../artifacts/api-server/src/lib/signal-auth';
import { normalizeJobFilterParams } from '../artifacts/fsp-signal/src/lib/job-skill-filters';

const taskRoot = 'C:/Users/Misha/Documents/ChatGPT/LCT/signal-ui-refinement-workspace-20261008';
const coreManifest = 'C:/Users/Misha/.codex/private/signal-full-audit-a10-fixtures-20261008.json';
const runId = randomUUID();
const marker = 'audit-jobfilters-' + runId;
const directory = `${taskRoot}/outputs/verification/full-audit-a01-a11-20261008/job-filters/${runId}`;
const origin = 'http://localhost:4383', appOrigin = 'http://localhost:4384';
const [bundlePath, expectedSha, expectedPid] = process.argv.slice(2);
const requireApi = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const ExcelJS = requireApi('exceljs') as { Workbook: new () => any };

type Actor = { id: number; role: 'candidate' | 'employer'; email: string; cookie: string; companyId?: number; suffix: string };
type Job = { id: number; companyId: number; version: number; index: number };
const actors: Actor[] = [];
const ownResumeIds: number[] = [], ownJobs: Job[] = [], ownApplicationIds: number[] = [];
const secretValues: string[] = [];
const checks: { name: string; status: 'PASS'; details?: unknown }[] = [];
const requestReceipts: { method: string; path: string; status: number; actorId: number | null }[] = [];
const exportReceipts: { caseName: string; format: string; ids: number[]; sha256: string; bytes: number }[] = [];
let passed = false, failure: string | undefined, stage = 'guard', sha256: string | undefined;
let running: { pid: number; commandLine: string } | undefined;
let databaseIdentity: { database: string; port: number } | undefined;

function record(name: string, details?: unknown) { checks.push({ name, status: 'PASS', details }); }
function sanitizeFailure(error: unknown) {
  let text = error instanceof Error ? `${error.name}: ${error.message}` : 'Unknown failure';
  for (const secret of secretValues.filter(Boolean)) text = text.replaceAll(secret, '[redacted]');
  return `${stage}: ${text.replace(/postgres(?:ql)?:\/\/[^\s]+/gi, '[private-database-url]').replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, '[fixture-email]').slice(0, 1800)}`;
}
async function request(actor: Actor | null, path: string, method = 'GET', body?: unknown) {
  assert.ok(requestReceipts.length < 120, 'Bounded request budget exceeded');
  const response = await fetch(origin + '/api' + path, {
    method, headers: { Origin: appOrigin, ...(actor ? { Cookie: actor.cookie } : {}), ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) },
    body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000),
  });
  const bytes = Buffer.from(await response.arrayBuffer());
  const json = response.headers.get('content-type')?.includes('json') ? JSON.parse(bytes.toString('utf8')) : undefined;
  requestReceipts.push({ method, path, status: response.status, actorId: actor?.id ?? null });
  return { status: response.status, bytes, json, headers: response.headers };
}
async function ok(actor: Actor, path: string, method = 'GET', body?: unknown, expected = 200) {
  const result = await request(actor, path, method, body);
  assert.equal(result.status, expected, `${method} ${path} HTTP status`); return result.json;
}
async function fixture(role: Actor['role'], suffix: string) {
  const password = randomBytes(32).toString('base64url'); secretValues.push(password);
  const passwordHash = await hashPassword(password); secretValues.push(passwordHash);
  const [user] = await db.insert(users).values({ email: `${marker}-${suffix}@example.test`, role,
    displayName: `Контроль фильтров ${suffix}`, passwordHash, emailVerified: true, demoMode: false }).returning();
  assert.ok(user);
  const token = randomBytes(32).toString('base64url'); secretValues.push(token);
  await db.insert(sessions).values({ userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'),
    expiresAt: new Date(Date.now() + 3600000), demoMode: false });
  const actor: Actor = { id: user.id, role, email: user.email, cookie: 'fsp_signal_session=' + token, suffix };
  actors.push(actor);
  if (role === 'candidate') {
    await db.insert(profiles).values({ userId: user.id, professionalAlias: `Контроль ${suffix}`, visibility: 'private',
      consentMatching: false, contactEmail: user.email });
  } else {
    const [company] = await db.insert(companies).values({ ownerUserId: user.id, name: `${marker} ${suffix}`, contactEmail: user.email }).returning();
    assert.ok(company); actor.companyId = company.id;
  }
  return actor;
}
async function ownResume(actor: Actor, suffix: string, primary: boolean) {
  assert.equal(actor.role, 'candidate');
  const [resume] = await db.insert(resumes).values({ userId: actor.id, title: `${marker} ${suffix}`, isPrimary: primary,
    visibility: 'private', consentMatching: false, consentCatalog: false, readyForOffers: false }).returning();
  assert.ok(resume); ownResumeIds.push(resume.id); return resume;
}

// Deliberately independent fixture specification: never derives expectations from jobSearchInput,
// jobFilterConditions, personalJobFilterConditions or a production exported row helper.
const specifications = [
  { grade: 'Junior', skills: [{ skill: 'Python', level: 'Junior' }, { skill: 'SQL', level: 'Middle' }] },
  { grade: 'Middle', skills: [{ skill: 'Python', level: 'Middle' }] },
  { grade: 'Senior', skills: [{ skill: 'Python', level: 'Senior' }] },
  { grade: 'Middle', skills: [{ skill: 'SQL', level: 'Middle' }] },
  { grade: 'Senior', skills: [{ skill: 'TypeScript', level: 'Senior' }] },
  { grade: 'Middle', skills: [{ skill: 'SQL', level: 'Senior' }, { skill: 'Python', level: 'Middle' }] },
] as const;
function expectedIds(indices: number[]) { return indices.map(index => { assert.ok(ownJobs[index]); return ownJobs[index]!.id; }); }
function csvRows(bytes: Buffer) {
  const text = bytes.toString('utf8').replace(/^\uFEFF/, '');
  const rows: string[][] = []; let row: string[] = [], cell = '', quoted = false;
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) { if (char === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (char === '"') quoted = false; else cell += char; }
    else if (char === '"') quoted = true;
    else if (char === ',') { row.push(cell); cell = ''; }
    else if (char === '\n') { row.push(cell.replace(/\r$/, '')); if (row.some(Boolean)) rows.push(row); row = []; cell = ''; }
    else cell += char;
  }
  assert.equal(quoted, false, 'Unclosed CSV quote');
  return rows;
}
function idsFromExportRows(rows: string[][]) {
  assert.ok(rows.length >= 1, 'Export header missing');
  assert.equal(rows[0]!.length, 14); assert.equal(rows[0]![13], 'Ссылка');
  return rows.slice(1).map(row => {
    assert.equal(row.length, 14); const url = new URL(row[13]!);
    assert.equal(url.pathname, '/jobs'); const id = Number(url.searchParams.get('job'));
    assert.ok(Number.isSafeInteger(id) && id > 0); return id;
  });
}
async function exportIds(actor: Actor | null, params: URLSearchParams, format: 'csv' | 'xlsx', caseName: string) {
  const query = new URLSearchParams(params); query.set('format', format);
  const result = await request(actor, '/public/jobs/export?' + query);
  assert.equal(result.status, 200, `${caseName} ${format} HTTP status`);
  assert.match(result.headers.get('cache-control') ?? '', /no-store/);
  let rows: string[][];
  if (format === 'csv') {
    assert.match(result.headers.get('content-type') ?? '', /^text\/csv/);
    assert.equal(result.bytes.subarray(0, 3).toString('hex'), 'efbbbf'); rows = csvRows(result.bytes);
  } else {
    assert.match(result.headers.get('content-type') ?? '', /spreadsheetml/);
    const workbook = new ExcelJS.Workbook(); await workbook.xlsx.load(result.bytes);
    const sheet = workbook.getWorksheet('Вакансии'); assert.ok(sheet); rows = [];
    sheet.eachRow((row: any) => { const values = Array.from({ length: 14 }, (_, i) => row.getCell(i + 1).value);
      assert.ok(values.every(value => typeof value === 'string'), 'Unexpected export formula/object cell'); rows.push(values as string[]); });
  }
  const ids = idsFromExportRows(rows);
  assert.equal(result.headers.get('x-export-row-count'), String(ids.length));
  const digest = createHash('sha256').update(result.bytes).digest('hex');
  exportReceipts.push({ caseName, format, ids, sha256: digest, bytes: result.bytes.length });
  await writeFile(`${directory}/${caseName}.${format}`, result.bytes, { flag: 'wx' });
  return ids;
}
function parameters(extra: Record<string, string> = {}) { return new URLSearchParams({ q: marker, sort: 'oldest', ...extra }); }
async function search(actor: Actor | null, params: URLSearchParams) {
  const result = await request(actor, '/public/jobs/search?' + params);
  assert.equal(result.status, 200, 'Filtered search HTTP status');
  assert.match(result.headers.get('cache-control') ?? '', /no-store/); return result.json;
}
async function coherent(actor: Actor | null, params: URLSearchParams, indices: number[], name: string) {
  const ids = expectedIds(indices), page = await search(actor, params);
  assert.equal(page.total, ids.length); assert.deepEqual(page.items.map((item: any) => item.id), ids);
  assert.equal(page.page, 1); assert.equal(page.pageCount, ids.length ? 1 : 0);
  assert.deepEqual(await exportIds(actor, params, 'csv', name), ids);
  assert.deepEqual(await exportIds(actor, params, 'xlsx', name), ids);
  record(name, { total: ids.length, ids });
}

try {
  assert.ok(process.env.DATABASE_URL, 'Coordinator private DATABASE_URL missing');
  const database = new URL(process.env.DATABASE_URL!); secretValues.push(database.password, decodeURIComponent(database.password));
  assert.equal(database.hostname, '127.0.0.1'); assert.equal(database.port, '55435');
  assert.equal(database.pathname, '/signal_full_audit_a10_20261008');
  assert.equal(process.env.PORT, '4383'); assert.equal(process.env.SIGNAL_WORKSPACE_ENABLED, 'true');
  assert.equal(process.env.SIGNAL_SKILL_MODULES_ENABLED, 'true');
  assert.ok(bundlePath && bundlePath.replaceAll('\\', '/').startsWith(`${taskRoot}/outputs/verification/full-audit-a01-a11-20261008/clean-workspace/artifacts/api-server/dist/`));
  assert.match(expectedSha ?? '', /^[a-f0-9]{64}$/); assert.match(expectedPid ?? '', /^\d+$/);
  sha256 = createHash('sha256').update(await readFile(bundlePath)).digest('hex');
  assert.equal(sha256, expectedSha, 'Coordinator-reviewed runtime bytes changed');
  const cleanRoot = bundlePath.replaceAll('\\', '/').split('/artifacts/api-server/dist/')[0]!;
  for (const relative of ['artifacts/fsp-signal/src/lib/job-skill-filters.ts', 'artifacts/api-server/src/lib/job-discovery.ts',
    'artifacts/api-server/src/lib/job-personal-filters.ts', 'artifacts/api-server/src/routes/signal-jobs.ts']) {
    const current = createHash('sha256').update(await readFile(`${taskRoot}/${relative}`)).digest('hex');
    const clean = createHash('sha256').update(await readFile(`${cleanRoot}/${relative}`)).digest('hex');
    assert.equal(current, clean, 'Current tested filter source differs from clean reviewed runtime source: ' + relative);
  }
  const ps = "$taskListeners = @(Get-NetTCPConnection -LocalPort 4383 -State Listen | Select-Object -ExpandProperty OwningProcess -Unique); if ($taskListeners.Count -ne 1) { throw 'Expected one owned API listener' }; $taskApi = Get-CimInstance Win32_Process -Filter ('ProcessId = ' + $taskListeners[0]); @{pid=$taskApi.ProcessId; commandLine=$taskApi.CommandLine} | ConvertTo-Json -Compress";
  running = JSON.parse(execFileSync('C:/Users/Misha/AppData/Local/Programs/PowerShell/7/pwsh.exe', ['-NoLogo', '-NoProfile', '-EncodedCommand', Buffer.from(ps, 'utf16le').toString('base64')], { encoding: 'utf8', timeout: 15000 }));
  assert.equal(running!.pid, Number(expectedPid));
  assert.ok(running!.commandLine.replaceAll('\\', '/').toLowerCase().includes(bundlePath.replaceAll('\\', '/').toLowerCase()), 'API listener is not reviewed runtime');
  const actualDatabase = (await pool.query('select current_database() as database, inet_server_port() as port')).rows[0];
  assert.equal(actualDatabase.database, 'signal_full_audit_a10_20261008'); assert.equal(actualDatabase.port, 5432);
  databaseIdentity = actualDatabase;
  const manifest = JSON.parse(await readFile(coreManifest, 'utf8'));
  assert.equal(manifest.apiOrigin, origin); assert.ok(Array.isArray(manifest.actors));
  const coreCandidate = manifest.actors.find((actor: any) => actor.role === 'candidate' && actor.suffix === 'candidate') as Actor | undefined;
  assert.ok(coreCandidate && Number.isSafeInteger(coreCandidate.id) && coreCandidate.email.endsWith('@example.test'));
  secretValues.push(coreCandidate!.cookie);
  const coreRows = await db.select().from(users).where(eq(users.id, coreCandidate!.id));
  assert.ok(coreRows.length === 1 && coreRows[0]!.email === coreCandidate!.email && coreRows[0]!.role === 'candidate' && !coreRows[0]!.demoMode && coreRows[0]!.emailVerified, 'Core manifest does not match owned DB actor');
  // First HTTP is a read-only exact identity guard, before any new fixture writes.
  const firstMe = await ok(coreCandidate!, '/me');
  assert.ok(firstMe.user.id === coreCandidate!.id && firstMe.user.email === coreCandidate!.email, 'First /me returned a different fixture identity');
  record('Reviewed runtime, isolated PG and first read-only identity guards');
  await mkdir(directory, { recursive: true });

  stage = 'own fixtures';
  const candidate = await fixture('candidate', 'candidate-a'), otherCandidate = await fixture('candidate', 'candidate-b');
  const employerA = await fixture('employer', 'company-a'), employerB = await fixture('employer', 'company-b');
  const resumeA1 = await ownResume(candidate, 'cv-a1', true), resumeA2 = await ownResume(candidate, 'cv-a2', false);
  const resumeB = await ownResume(otherCandidate, 'cv-b1', true);
  for (const actor of actors) { const me = await ok(actor, '/me'); assert.ok(me.user.id === actor.id && me.user.email === actor.email, 'New own actor identity mismatch'); }
  for (const [index, spec] of specifications.entries()) {
    const company = index < 3 ? employerA.companyId! : employerB.companyId!;
    const [job] = await db.insert(jobs).values({ companyId: company, title: `${marker} вакансия ${index}`,
      description: 'Отдельная синтетическая вакансия для ограниченной проверки согласованности фильтров, страниц и выгрузки.',
      specialization: 'Backend / Python', grade: spec.grade, skills: spec.skills.map(item => item.skill), workFormat: 'Удалённо',
      salaryMin: 100000 + index * 10000, salaryMax: 150000 + index * 10000, salaryPeriod: 'month', salaryType: 'gross',
      status: 'published', publishedAt: new Date(Date.UTC(2026, 9, 8, 0, 0, index)) }).returning();
    assert.ok(job); ownJobs.push({ id: job.id, companyId: company, version: job.version, index });
    await db.insert(requirements).values({ jobId: job.id, location: 'Казань', skillRequirements: spec.skills.map(item => ({ ...item })) });
  }
  await writeFile(`C:/Users/Misha/.codex/private/signal-full-audit-jobfilters-${runId}.json`, JSON.stringify({ runId, database: databaseIdentity, actors }, null, 2), { flag: 'wx' });
  const privacy = await db.select({ visibility: resumes.visibility, matching: resumes.consentMatching, catalog: resumes.consentCatalog }).from(resumes).where(inArray(resumes.id, ownResumeIds));
  assert.equal(privacy.length, 3); assert.ok(privacy.every(item => item.visibility === 'private' && !item.matching && !item.catalog));
  record('Only new marked ordinary fixtures; three private CVs without catalogue/matching consent', { actors: actors.length, jobs: ownJobs.length, resumes: ownResumeIds.length });

  stage = 'malformed normalization';
  const malformedCases = [
    { name: 'null-skills', raw: '[null]', normalized: [], indices: [0, 1, 2, 3, 4, 5] },
    { name: 'mixed-skills', raw: '[{"skill":" Python ","level":"Middle"},null,3,{"skill":"SQL","level":"Wizard"}]', normalized: [{ skill: 'Python', level: 'Middle' }], indices: [1, 2, 5] },
    { name: 'unknown-level', raw: '[{"skill":"Python","level":"Wizard"}]', normalized: [], indices: [0, 1, 2, 3, 4, 5] },
  ];
  for (const item of malformedCases) {
    const source = parameters({ skills: item.raw, resumeId: String(resumeA1.id), hideApplied: 'false', hideBlocked: 'false', location: 'Казань' });
    for (const suffix of ['', '&format=csv', '&format=xlsx']) {
      const path = suffix ? '/public/jobs/export?' + source + suffix : '/public/jobs/search?' + source;
      assert.equal((await request(candidate, path)).status, 400, 'Raw invalid skill shape must be rejected by API');
    }
    const normalized = normalizeJobFilterParams(source); assert.equal(normalized.invalid, true);
    assert.deepEqual(normalized.skills, item.normalized); assert.equal(source.get('skills'), item.raw, 'Normalizer mutated input URL');
    for (const key of ['q', 'resumeId', 'hideApplied', 'hideBlocked', 'location']) assert.equal(normalized.params.get(key), source.get(key));
    await coherent(candidate, normalized.params, item.indices, item.name);
  }
  const shapeCases = ['null', '42', '"Python"', '{}', '[{}]', 'not json', JSON.stringify(Array.from({ length: 21 }, () => ({ skill: 'Python' })))];
  for (const raw of shapeCases) { const value = normalizeJobFilterParams(parameters({ skills: raw })); assert.equal(value.invalid, true); assert.deepEqual(value.skills, []); }
  record('Non-array, missing skill, malformed JSON and over-limit shapes safely normalize empty', { cases: shapeCases.length });
  const duplicate = normalizeJobFilterParams(parameters({ skills: '[{"skill":"Python","level":"Junior"},{"skill":" python ","level":"Senior"}]', grade: 'Senior' }));
  assert.equal(duplicate.invalid, false); assert.deepEqual(duplicate.skills, [{ skill: 'Python', level: 'Senior' }]);
  await coherent(candidate, duplicate.params, [2], 'deduplicated-senior');
  await coherent(candidate, parameters({ skills: '[{"skill":"Python","level":"Middle"},{"skill":"SQL","level":"Senior"}]', location: 'Казань', salaryMin: '170000' }), [5], 'intersecting-skill-salary-location');

  stage = 'own applications';
  const apply = async (actor: Actor, index: number, resumeId: number) => {
    const job = ownJobs[index]!;
    const application = await ok(actor, `/jobs/${job.id}/applications`, 'POST', { message: 'Синтетический отклик в изолированном стенде.',
      consentDisclosure: true, companyId: job.companyId, jobVersion: job.version, resumeId }, 201);
    ownApplicationIds.push(application.id); assert.equal(application.resumeId, resumeId); return application;
  };
  const withdrawn = await apply(candidate, 0, resumeA1.id); await ok(candidate, `/me/applications/${withdrawn.id}/withdraw`, 'POST');
  const declined = await apply(candidate, 1, resumeA2.id); await ok(employerA, `/employer/applications/${declined.id}/status`, 'POST', { status: 'declined' });
  const sent = await apply(candidate, 3, resumeA1.id); const foreign = await apply(otherCandidate, 2, resumeB.id);
  const actualApplications = await db.select().from(applications).where(inArray(applications.id, ownApplicationIds));
  assert.deepEqual(actualApplications.filter(item => item.candidateUserId === candidate.id).map(item => [item.jobId, item.status, item.resumeId]).sort((a, b) => Number(a[0]) - Number(b[0])),
    [[ownJobs[0]!.id, 'withdrawn', resumeA1.id], [ownJobs[1]!.id, 'declined', resumeA2.id], [ownJobs[3]!.id, 'sent', resumeA1.id]]);
  record('Actual HTTP applications: withdrawn, declined and sent across two own CVs; foreign candidate separate', { applications: ownApplicationIds.length, foreignApplicationId: foreign.id });
  await coherent(candidate, parameters({ hideApplied: 'true', hideBlocked: 'false', resumeId: String(resumeA1.id) }), [2, 4, 5], 'without-applied-cv1');
  await coherent(candidate, parameters({ hideApplied: 'true', hideBlocked: 'false', resumeId: String(resumeA2.id) }), [2, 4, 5], 'without-applied-cv2');
  const pageParams = parameters({ hideApplied: 'true', hideBlocked: 'false', resumeId: String(resumeA2.id), page: '2', pageSize: '2' });
  const second = await search(candidate, pageParams); assert.equal(second.total, 3); assert.equal(second.pageCount, 2); assert.equal(second.page, 2);
  assert.deepEqual(second.items.map((item: any) => item.id), expectedIds([5]));
  assert.deepEqual(await exportIds(candidate, pageParams, 'csv', 'paginated-export'), expectedIds([2, 4, 5]));
  assert.deepEqual(await exportIds(candidate, pageParams, 'xlsx', 'paginated-export'), expectedIds([2, 4, 5]));
  const clamped = await search(candidate, parameters({ hideApplied: 'true', page: '99', pageSize: '2' }));
  assert.equal(clamped.page, 2); assert.equal(clamped.total, 3); assert.deepEqual(clamped.items.map((item: any) => item.id), expectedIds([5]));
  record('Account-wide filtering precedes count/page; export includes entire filtered pool rather than selected page', { total: 3, pageCount: 2 });
  for (const status of ['viewed', 'shortlisted']) {
    await ok(employerB, `/employer/applications/${sent.id}/status`, 'POST', { status });
    await coherent(candidate, parameters({ hideApplied: 'true', hideBlocked: 'false', resumeId: String(resumeA2.id) }),
      [2, 4, 5], 'without-applied-' + status);
  }
  record('All five application statuses are excluded: withdrawn, declined, sent, viewed and shortlisted');

  stage = 'active blocks and isolation';
  // Private resume visibility is an additional independent ACL: do not change it merely
  // to make contacts readable. Verify actual addressed grants and their revocation in PG.
  const addressedBefore = await db.select().from(grants).where(eq(grants.applicationId, sent.id));
  assert.ok(addressedBefore.length === 1 && addressedBefore[0]!.candidateUserId === candidate.id && !addressedBefore[0]!.revokedAt);
  await ok(candidate, `/me/companies/${employerB.companyId}/block`, 'PUT', { blocked: true });
  const addressedAfter = await db.select().from(grants).where(eq(grants.applicationId, sent.id));
  assert.ok(addressedAfter.length === 1 && addressedAfter[0]!.revokedAt, 'Block must revoke actual addressed grant');
  await ok(otherCandidate, `/me/companies/${employerA.companyId}/block`, 'PUT', { blocked: true });
  await coherent(candidate, parameters({ hideApplied: 'false', hideBlocked: 'true', resumeId: String(resumeA2.id) }), [0, 1, 2], 'without-blocked');
  await coherent(candidate, parameters({ hideApplied: 'true', hideBlocked: 'true', resumeId: String(resumeA1.id) }), [2], 'combined');
  await coherent(candidate, parameters({ hideApplied: 'false', hideBlocked: 'false' }), [0, 1, 2, 3, 4, 5], 'blocked-visible');
  assert.equal((await request(employerB, `/employer/applications/${sent.id}/contacts`)).status, 403, 'Visible blocked company must not retain contacts');
  const blockedJob = ownJobs[4]!;
  assert.equal((await request(candidate, `/jobs/${blockedJob.id}/applications`, 'POST', { message: '', consentDisclosure: true,
    companyId: blockedJob.companyId, jobVersion: blockedJob.version, resumeId: resumeA2.id })).status, 403, 'Visibility toggle must not allow blocked application');
  record('Blocked-visible flag does not bypass application/contact permissions');
  await coherent(otherCandidate, parameters({ hideApplied: 'true', hideBlocked: 'true', resumeId: String(resumeB.id) }), [3, 4, 5], 'other-candidate-isolation');
  await coherent(null, parameters({ hideApplied: 'true', hideBlocked: 'true' }), [0, 1, 2, 3, 4, 5], 'anonymous-role-isolation');
  await coherent(employerA, parameters({ hideApplied: 'true', hideBlocked: 'true' }), [0, 1, 2, 3, 4, 5], 'employer-role-isolation');
  await ok(candidate, `/me/companies/${employerB.companyId}/block`, 'PUT', { blocked: false });
  await coherent(candidate, parameters({ hideApplied: 'true', hideBlocked: 'true', resumeId: String(resumeA2.id) }), [2, 4, 5], 'removed-block');
  assert.equal((await request(employerB, `/employer/applications/${sent.id}/contacts`)).status, 403, 'Unblock must not resurrect contact grant');
  const blockRows = await db.select().from(blocks).where(and(eq(blocks.candidateUserId, candidate.id), eq(blocks.companyId, employerB.companyId!)));
  assert.ok(blockRows.length === 1 && !blockRows[0]!.active && blockRows[0]!.unblockedAt);
  record('Removed block row is retained, does not hide jobs and does not resurrect contact grants');
  passed = true;
} catch (error) {
  failure = sanitizeFailure(error);
} finally {
  await pool.end();
  await mkdir(directory, { recursive: true });
  const sourcePaths = ['scripts/full-audit-jobfilters-http-20261008.ts', 'artifacts/fsp-signal/src/lib/job-skill-filters.ts', 'artifacts/api-server/src/lib/job-discovery.ts', 'artifacts/api-server/src/lib/job-personal-filters.ts', 'artifacts/api-server/src/routes/signal-jobs.ts'];
  const sourceSha256: Record<string, string> = {};
  for (const source of sourcePaths) sourceSha256[source] = createHash('sha256').update(await readFile(`${taskRoot}/${source}`)).digest('hex');
  const report = { runId, measuredAt: new Date().toISOString(), passed, failure, stage, checks, requestReceipts, exportReceipts,
    runtime: { origin, pid: running?.pid, bundlePath: bundlePath?.replaceAll('\\', '/'), sha256 }, database: databaseIdentity,
    sourceSha256, fixtureLedger: { marker, users: actors.map(actor => ({ id: actor.id, role: actor.role, companyId: actor.companyId })),
      resumeIds: ownResumeIds, jobs: ownJobs, applicationIds: ownApplicationIds, retained: true,
      reason: 'Dedicated owned audit DB: preserve own fixtures, exports and append-only evidence; no destructive cleanup or protected-history writes' },
    limits: ['Synthetic fixture expected IDs are hand-specified, not derived from production filtering helper.',
      'Tests actual UI normalization helper and HTTP/PG/export paths, not a rendered browser; coordinator owns live malformed-URL UI QA.',
      'New fixture actors are seeded verified ordinary test accounts with private resumes; auth verification is separately covered by A01.',
      'Request budget 120; six jobs, four own actors, three own resumes; not a load test.'] };
  await writeFile(`${directory}/http-report.json`, JSON.stringify(report, null, 2), { flag: 'wx' });
  console.log(JSON.stringify({ passed, failure, runId, checks: checks.length, requests: requestReceipts.length, apiSha256: sha256, retainedOwnActors: actors.length }));
}
if (!passed) process.exitCode = 1;

/** Negative integer-ID HTTP acceptance on the dedicated QA app only. Existing
 * fixture cookies are supplied in memory by the caller; never printed/saved.
 * This script neither creates nor removes users, rows, DBs or containers. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

type Input = { base: string; candidateCookie: string; employerCookie: string; target?: 'multi-resume-stage' };
type Role = 'anonymous' | 'candidate' | 'employer';
export async function runQaIdHttp(input: Input) {
  const url = new URL(input.base);
  const expectedPort = input.target === 'multi-resume-stage' ? '4313' : '4321';
  assert.ok(['127.0.0.1', 'localhost'].includes(url.hostname) && url.port === expectedPort && ['/', '/api', '/api/'].includes(url.pathname), 'QA ID integration is restricted to the explicitly selected isolated app; never localhost:4310.');
  assert.ok(input.candidateCookie && input.employerCookie, 'Existing isolated fixture sessions are required; no demo signup/reset is performed.');
  const base = `${url.origin}/api`;
  const ownedResponse = await fetch(`${base}/me/resumes`, { headers: { cookie: input.candidateCookie }, signal: AbortSignal.timeout(15000) });
  assert.equal(ownedResponse.status, 200);
  const owned: any = await ownedResponse.json(); const resumeId = owned.resumes?.find((row: any) => row.isPrimary)?.id;
  assert.ok(Number.isInteger(resumeId), 'The ID boundary test needs a valid owned primary resume so confirmation validation does not hide invitation bounds.');
  const startedAt = new Date().toISOString();
  const rows: { name: string; role: Role; method: string; route: string; status: number; expected: number[]; passed: boolean }[] = [];
  async function check(name: string, role: Role, method: string, route: string, expected: number[], body?: unknown) {
    const response = await fetch(`${base}${route}`, { method, headers: { ...(role === 'anonymous' ? {} : { cookie: role === 'candidate' ? input.candidateCookie : input.employerCookie }), ...(body === undefined ? {} : { 'content-type': 'application/json' }) }, ...(body === undefined ? {} : { body: JSON.stringify(body) }), signal: AbortSignal.timeout(15000) });
    await response.arrayBuffer();
    rows.push({ name, role, method, route, status: response.status, expected, passed: expected.includes(response.status) });
  }
  const invalid = ['2147483648', '9007199254740991', '-1', '0', '1.5', 'NaN', '1e2'];
  const paths: { role: Role; method: string; route: (id: string) => string; body?: unknown }[] = [
    { role: 'anonymous', method: 'GET', route: id => `/public/jobs/${id}` },
    { role: 'employer', method: 'PUT', route: id => `/employer/jobs/${id}`, body: {} },
    { role: 'candidate', method: 'POST', route: id => `/me/applications/${id}/withdraw`, body: {} },
    { role: 'candidate', method: 'POST', route: id => `/me/microtasks/${id}/decision`, body: { decision: 'decline' } },
    { role: 'employer', method: 'GET', route: id => `/employer/invitations/${id}/contacts` },
    { role: 'candidate', method: 'GET', route: id => `/assessments/attempts/${id}` },
    { role: 'candidate', method: 'GET', route: id => `/assessments/attempts/${id}/context` },
    { role: 'employer', method: 'GET', route: id => `/employer/needs/${id}/assessment-context` },
    { role: 'employer', method: 'GET', route: id => `/research/studies/${id}` },
    { role: 'employer', method: 'PUT', route: id => `/research/studies/1/participants/${id}/group`, body: { grade: 'Middle', basis: 'Synthetic independent reference before test.' } },
    { role: 'candidate', method: 'PUT', route: id => `/assessments/attempts/${id}/answers`, body: { answers: [] } },
    { role: 'candidate', method: 'POST', route: id => `/assessments/attempts/${id}/submit`, body: {} },
    { role: 'employer', method: 'GET', route: id => `/employer/needs/${id}/matching-status` },
  ];
  for (const path of paths) for (const id of invalid) await check('Integer path rejects malformed/out-of-range before SQL resource binding', path.role, path.method, path.route(encodeURIComponent(id)), [400], path.body);
  for (const id of invalid) {
    await check('Matching need query bounded', 'employer', 'GET', `/matches?needId=${encodeURIComponent(id)}`, [400]);
    await check('Explanation candidate query bounded', 'employer', 'GET', `/matches/explanation?needId=1&candidateId=${encodeURIComponent(id)}`, [400]);
  }
  for (const id of [2147483648, 9007199254740991, -1, 1.5]) {
    const invite = { idempotencyKey: 'qa-id-boundary', resumeId, needId: 1, candidateId: 1, title: 'Синтетическое приглашение', message: 'Обсудим условия синтетической проверки API.', reason: 'Синтетический профиль и подтверждённые навыки.', salaryMin: 100000, salaryMax: 200000, salaryPeriod: 'month', salaryType: 'gross', workFormat: 'Удалённо' };
    await check('Invitation need JSON ID bounded', 'employer', 'POST', '/employer/invitations', [400], { ...invite, needId: id });
    await check('Invitation candidate JSON ID bounded', 'employer', 'POST', '/employer/invitations', [400], { ...invite, candidateId: id });
    await check('Subscription candidate JSON ID bounded', 'employer', 'POST', '/employer/microtasks/1/subscriptions', [400], { candidateId: id });
    await check('Application company JSON ID bounded', 'candidate', 'POST', '/jobs/1/applications', [400], { companyId: id, jobVersion: 1, consentDisclosure: true, resumeId });
    await check('Assessment invitation JSON ID bounded', 'candidate', 'POST', '/assessments/attempts', [400], { purpose: 'signal_qualification', gradeConfirmed: true, resumeId, programId: 'backend-python', grade: 'Middle', invitationId: id });
  }
  for (const route of ['/public/jobs/2147483647', '/assessments/attempts/2147483647', '/assessments/attempts/2147483647/context']) await check('Maximum PostgreSQL integer is valid but absent in the isolated fixture DB', route.includes('/public/') ? 'anonymous' : 'candidate', 'GET', route, [404]);
  await check('Lower integer bound reaches real resource handler', 'anonymous', 'GET', '/public/jobs/1', [200, 404]);
  await check('Text program ID contract preserved', 'anonymous', 'GET', '/assessments/programs/backend-python/competencies', [200]);
  const sourceFiles = ['artifacts/api-server/src/lib/postgres-id.ts', 'artifacts/api-server/src/lib/opportunity-auth.ts', 'artifacts/api-server/src/routes/signal-jobs.ts', 'artifacts/api-server/src/routes/signal-microtasks.ts', 'artifacts/api-server/src/routes/signal-invitations.ts', 'artifacts/api-server/src/routes/signal-profile-assessments.ts', 'artifacts/api-server/src/routes/signal-assessment-context.ts', 'artifacts/api-server/src/routes/signal-research.ts', 'artifacts/api-server/src/routes/signal-employer-matching.ts'];
  const sourceHashes = Object.fromEntries(await Promise.all(sourceFiles.map(async path => [path, createHash('sha256').update(await readFile(path)).digest('hex')])));
  return { version: 'signal-qa-cycle-01-id-http-v1', startedAt, finishedAt: new Date().toISOString(), base, scope: 'Actual isolated app HTTP with caller-supplied local fixture sessions. Source hashes alone do not prove runtime/build equality; parent must attest the tested process/container.', passed: rows.every(row => row.passed), counts: { requests: rows.length, passed: rows.filter(row => row.passed).length, failed: rows.filter(row => !row.passed).length, serverErrors: rows.filter(row => row.status >= 500).length }, sourceHashes, requests: rows, limitations: ['No working 4310 app/DB request, signup, reset, seed or fixture cleanup is performed.', 'Maximum-bound absence is an assertion about the controlled isolated DB only.', 'No UUID/bigint routes are changed; current affected schema IDs are PostgreSQL serial/integer.'] };
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  const report = await runQaIdHttp({ base: process.env.QA_ID_BASE_URL ?? '', candidateCookie: process.env.QA_ID_CANDIDATE_COOKIE ?? '', employerCookie: process.env.QA_ID_EMPLOYER_COOKIE ?? '' });
  await writeFile('outputs/verification/qa-cycle-01-id-http.json', JSON.stringify(report, null, 2));
  console.log(JSON.stringify({ passed: report.passed, counts: report.counts, protocol: 'outputs/verification/qa-cycle-01-id-http.json' }));
  assert.equal(report.passed, true, 'Inspect exact failed HTTP ID scenarios.');
}

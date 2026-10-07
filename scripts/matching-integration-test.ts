/** Synthetic fixtures only; does not claim a human pilot or registration validation. */
import assert from 'node:assert/strict';
import { createHash, randomBytes } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, signalUsersTable as users, signalSessionsTable as sessions, signalCandidateProfilesTable as profiles, signalCompaniesTable as companies, signalAssessmentAttemptsTable as attempts } from '../lib/db/src/index';
import { assembleManagedAttempt } from '../artifacts/api-server/src/lib/assessment-managed';

const apiOrigin = process.env.INTEGRATION_API_ORIGIN || 'http://127.0.0.1:4312';
const origin = process.env.INTEGRATION_APP_ORIGIN || 'http://127.0.0.1:4310';
for (const value of [apiOrigin, origin, process.env.DATABASE_URL!]) assert.ok(['localhost', '127.0.0.1', '[::1]'].includes(new URL(value).hostname), 'Local fixture test only');
const ids: number[] = [], passed: string[] = [];
async function fixture(role: 'candidate' | 'employer') {
  const token = randomBytes(32).toString('base64url');
  const [user] = await db.insert(users).values({ email: `matching-${token.slice(0, 12)}@example.test`, passwordHash: 'unusable-test-fixture', role, displayName: 'Synthetic matching fixture', emailVerified: true, demoMode: false }).returning();
  ids.push(user.id);
  await db.insert(sessions).values({ userId: user.id, tokenHash: createHash('sha256').update(token).digest('hex'), expiresAt: new Date(Date.now() + 600000), demoMode: false });
  if (role === 'employer') await db.insert(companies).values({ ownerUserId: user.id, name: 'Synthetic test company', contactEmail: user.email });
  const request = async (path: string, method = 'GET', body?: unknown, expected = 200) => {
    const response = await fetch(`${apiOrigin}/api${path}`, { method, headers: { Origin: origin, Cookie: `fsp_signal_session=${token}`, 'Content-Type': 'application/json' }, body: body === undefined ? undefined : JSON.stringify(body), signal: AbortSignal.timeout(15000) });
    const data: any = await response.json();
    assert.equal(response.status, expected, `${method} ${path}: ${JSON.stringify(data)}`);
    return data;
  };
  return { user, request };
}
try {
  const employer = await fixture('employer'), stranger = await fixture('employer'), candidate = await fixture('candidate');
  const now = new Date();
  const form = assembleManagedAttempt('backend-python', 'Middle', 'matching-http-synthetic');
  const [attempt] = await db.insert(attempts).values({ userId: candidate.user.id, programId: 'backend-python', grade: 'Middle', status: 'submitted', ...form, answers: form.cases.map(item => ({ caseId: item.id, answer: form.oracles[item.id].answer })), score: 100, verified: true, startedAt: new Date(now.getTime() - 60000), dueAt: new Date(now.getTime() + 60000), submittedAt: now }).returning();
  await db.insert(profiles).values({ userId: candidate.user.id, professionalAlias: `Matching fixture ${candidate.user.id}`, specialization: 'Backend / Python', verifiedGrade: 'Middle', verifiedScore: 100, verifiedSkills: ['python', 'Postgres', 'API-контракты'], stack: ['Postgres'], skills: ['FastAPI'], consentMatching: true, visibility: 'pseudonymous', latestAssessmentAt: now });
  const needInput = { title: 'Matching regression', specialization: 'Backend / Python', grade: 'Middle', requiredSkills: ['Python', 'PostgreSQL'], desirableSkills: ['API contracts'], description: 'Synthetic case requiring separate explicit PostgreSQL evidence', workFormat: 'Удалённо', salaryMin: 100000, salaryMax: 200000, salaryPeriod: 'month', salaryType: 'gross' };
  const need = await employer.request('/employer/needs', 'POST', needInput, 201);
  assert.deepEqual(need.requiredSkills, ['Python', 'PostgreSQL']);
  assert.equal(need.coverage[1].supported, false);
  const match = (await employer.request(`/matches?needId=${need.id}`)).find((item: any) => item.candidateId === candidate.user.id);
  assert.ok(match);
  for (const skill of ['Python', 'python', 'PostgreSQL', 'Postgres']) assert.ok((await employer.request(`/employer/candidates?skill=${skill}`)).candidates.some((row: any) => row.candidateId === candidate.user.id));
  assert.ok(!(await employer.request('/employer/candidates?skill=SQL')).candidates.some((row: any) => row.candidateId === candidate.user.id));
  passed.push('raw requirements preserved; aliases agree in matching and bank; SQL does not imply Postgres');
  const own = await candidate.request('/me/evidence');
  assert.equal(own.evidence.find((row: any) => row.skill === 'python').attemptId, attempt.id);
  const explanation = await employer.request(`/matches/explanation?needId=${need.id}&candidateId=${candidate.user.id}`);
  assert.ok(explanation.evidence.some((row: any) => row.provenance?.attemptId === attempt.id));
  assert.ok(!/oracles|savedAnswer|correctAnswer|seed|Demo/.test(JSON.stringify(explanation)));
  await employer.request('/me/evidence', 'GET', undefined, 403);
  await stranger.request(`/employer/needs/${need.id}/matching-status`, 'GET', undefined, 404);
  passed.push('own and employer proof whitelist; source is real; role and owner restrictions');
  const weaker = await fixture('candidate');
  await db.insert(attempts).values({ userId: weaker.user.id, programId:'backend-python', grade:'Middle', status:'submitted', ...form,
    answers:form.cases.map((item,index)=>({caseId:item.id,answer:index===2?'':form.oracles[item.id].answer})),
    score:83, verified:true, startedAt:new Date(now.getTime()-60000),dueAt:new Date(now.getTime()+60000),submittedAt:now });
  await db.insert(profiles).values({userId:weaker.user.id,professionalAlias:'AAA comparable weaker result',specialization:'Backend / Python',verifiedGrade:'Middle',verifiedScore:100,verifiedSkills:['python','Postgres','API-контракты'],stack:['Postgres'],skills:['FastAPI'],consentMatching:true,visibility:'pseudonymous',latestAssessmentAt:now});
  const ordered = (await employer.request(`/matches?needId=${need.id}`)).filter((row:any)=>[candidate.user.id,weaker.user.id].includes(row.candidateId));
  assert.deepEqual(ordered.map((row:any)=>row.candidateId),[candidate.user.id,weaker.user.id]);
  assert.deepEqual(ordered.map((row:any)=>row.ranking.qualityScore),[100,83]);
  assert.equal(ordered[0].ranking.groupId,ordered[1].ranking.groupId);
  const weakExplanation = await employer.request(`/matches/explanation?needId=${need.id}&candidateId=${weaker.user.id}`);
  assert.equal(weakExplanation.ranking.qualityScore,83);
  assert.equal(weakExplanation.ranking.position,ordered[1].ranking.position);
  assert.equal(weakExplanation.ranking.poolSize,ordered[1].ranking.poolSize);
  assert.equal(weakExplanation.ranking.orderPolicy,'need-fit-traceability-comparable-queues-v2');
  // Both requests use the same common freshness band and deterministic prepared-pool order.
  assert.ok(Math.abs(weakExplanation.rankingScore-ordered[1].rankingScore)<0.0001);
  assert.equal(weakExplanation.factors.find((row:any)=>row.name==='Результат сопоставимой проверки').score,0.83);
  assert.ok(!/oracles|savedAnswer|correctAnswer|seed/.test(JSON.stringify(ordered)));
  passed.push('v5 comparable100 outranks83; actual attempt overrides arbitrary profile score; explanation/list group, position and exact score agree');
  const legacy = await fixture('candidate');
  await db.insert(profiles).values({userId:legacy.user.id,professionalAlias:'AAA historical incomplete protocol',specialization:'Backend / Python',verifiedGrade:'Middle',verifiedScore:100,verifiedSkills:['python','Postgres','API-контракты'],stack:['Postgres'],skills:['FastAPI'],consentMatching:true,visibility:'pseudonymous',latestAssessmentAt:now,hasFspHistory:true});
  await db.update(profiles).set({hasFspHistory:true}).where(eq(profiles.userId,weaker.user.id));
  const scope = [candidate.user.id,weaker.user.id,legacy.user.id];
  const traceable = (await employer.request(`/matches?needId=${need.id}`)).filter((row:any)=>scope.includes(row.candidateId));
  assert.deepEqual(traceable.map((row:any)=>row.candidateId),[candidate.user.id,weaker.user.id,legacy.user.id]);
  assert.equal(traceable[2].ranking.qualityStatus,'not_measured');assert.equal(traceable[2].ranking.qualityScore,null);
  assert.equal(traceable[2].fspBonus,3);assert.equal(traceable[1].fspBonus,3);
  assert.equal(traceable[0].ranking.businessFitScore,traceable[2].ranking.businessFitScore);
  // Better common need-fit must still beat a more complete lower-fit proof.
  await db.update(profiles).set({workFormat:'Офис'}).where(eq(profiles.userId,weaker.user.id));
  const betterFit = (await employer.request(`/matches?needId=${need.id}`)).filter((row:any)=>scope.includes(row.candidateId));
  assert.deepEqual(betterFit.map((row:any)=>row.candidateId),[candidate.user.id,legacy.user.id,weaker.user.id]);
  assert.ok(betterFit[1].ranking.businessFitScore>betterFit[2].ranking.businessFitScore);
  await db.update(profiles).set({workFormat:'Удалённо'}).where(eq(profiles.userId,weaker.user.id));
  const legacyExplanation = await employer.request(`/matches/explanation?needId=${need.id}&candidateId=${legacy.user.id}`);
  const restored = await employer.request(`/matches?needId=${need.id}`);
  const legacyMatch = restored.find((row:any)=>row.candidateId===legacy.user.id);
  assert.equal(legacyExplanation.ranking.position,legacyMatch.ranking.position);
  assert.equal(legacyExplanation.ranking.qualityScore,null);
  assert.match(legacyExplanation.categoryNote,/Это не нулевой балл/);
  passed.push('v5 traceability tie-break preserves null; FSP83 cannot beat comparable100; higher-fit unknown beats lower-fit complete proof; explanation uses same pool policy');
  const invite = await employer.request('/employer/invitations', 'POST', { needId: need.id, candidateId: candidate.user.id, title: needInput.title, message: 'Synthetic regression invitation with explicit conditions', reason: 'Confirmed skills', salaryMin: 100000, salaryMax: 200000, salaryPeriod: 'month', salaryType: 'gross', workFormat: 'Удалённо' }, 201);
  assert.equal((await candidate.request('/me/invitations')).find((row: any) => row.id === invite.id).status, 'sent');
  assert.equal((await candidate.request(`/me/invitations/${invite.id}/view`, 'POST')).status, 'viewed');
  assert.equal((await candidate.request(`/me/invitations/${invite.id}/view`, 'POST')).status, 'viewed');
  await stranger.request(`/me/invitations/${invite.id}/view`, 'POST', undefined, 403);
  passed.push('list does not mark viewed; exact opening is authorized and idempotent');
  await db.update(profiles).set({ consentMatching: false }).where(eq(profiles.userId, candidate.user.id));
  await employer.request(`/matches/explanation?needId=${need.id}&candidateId=${candidate.user.id}`, 'GET', undefined, 404);
  assert.ok(!(await employer.request(`/matches?needId=${need.id}`)).some((row: any) => row.candidateId === candidate.user.id));
  assert.ok(!(await employer.request(`/employer/candidates?q=${encodeURIComponent(`Matching fixture ${candidate.user.id}`)}`)).candidates.length);
  passed.push('matching consent revoke closes bank, matching and explanation');
  await mkdir('outputs/verification', { recursive: true });
  await writeFile(process.env.INTEGRATION_REPORT_PATH || 'outputs/verification/matching-v3-http.json', JSON.stringify({ passed: true, generatedAt: new Date().toISOString(), groups: passed, source: 'synthetic-local-technical-fixtures', apiOrigin }, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, groups: passed.length }));
} finally {
  if (ids.length) await db.delete(users).where(inArray(users.id, ids));
  await pool.end();
}

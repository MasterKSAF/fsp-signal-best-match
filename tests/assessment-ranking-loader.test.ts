import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { assembleManagedAttempt, type ProgramId } from '../artifacts/api-server/src/lib/assessment-managed';
import { evaluateMatch, rankMatches, type MatchCandidate, type MatchNeed, type SignalGrade } from '../artifacts/api-server/src/lib/signal-matching';
import type { withAssessmentRankingEvidence } from '../artifacts/api-server/src/lib/assessment-ranking-evidence';

const requireApi = createRequire(new URL('../artifacts/api-server/package.json', import.meta.url));
const { PgDialect } = requireApi('drizzle-orm/pg-core');
const dialect = new PgDialect();
const at = new Date('2026-10-06T00:00:00Z');
const programs: ProgramId[] = ['backend-python', 'frontend-typescript'];
const grades: SignalGrade[] = ['Junior', 'Middle', 'Senior'];
const digest = (value: unknown) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const specialization = (program: ProgramId) => program === 'backend-python' ? 'Backend / Python' : 'Frontend / TypeScript';

// No connection to a real database is possible even if a future regression
// accidentally ignores the injected queryDb. No HTTP/runtime is used.
let loaderModule: Promise<typeof import('../artifacts/api-server/src/lib/assessment-ranking-evidence')> | undefined;
function loader() {
  process.env.DATABASE_URL = 'postgresql://unit_only:unused@127.0.0.1:1/unit_mock_never_connect';
  return loaderModule ??= import('../artifacts/api-server/src/lib/assessment-ranking-evidence');
}

type SavedRow = { id: number; userId: number; programId: string; programVersion: string | null; purpose: string; grade: SignalGrade; score: number | null; submittedAt: Date | null; oracles: unknown };
type Capture = { fields: Record<string, unknown>; whereSql: string; params: unknown[] };
function queryFixture(rows: SavedRow[], revoked: number[] = []) {
  const captures: Capture[] = [];
  const queryDb = {
    select(fields: Record<string, unknown>) {
      return { from: (_table: unknown) => ({ where: (condition: unknown) => {
        const compiled = dialect.sqlToQuery(condition);
        captures.push({ fields, whereSql: compiled.sql, params: compiled.params });
        assert.ok(captures.length <= 3, 'Unexpected query count; no real DB fallback is allowed');
        return Promise.resolve('attemptId' in fields ? revoked.map(attemptId => ({ attemptId })) : 'oracles' in fields ? rows.map(({ id, oracles }) => ({ id, oracles })) : rows.map(({ oracles: _oracles, ...fresh }) => ({ data: { ...fresh, submittedAt: fresh.submittedAt?.toISOString() ?? null } })));
      } }) };
    },
  } as unknown as NonNullable<Parameters<typeof withAssessmentRankingEvidence>[1]>;
  return { queryDb, captures };
}

function candidate(program: ProgramId, grade: SignalGrade, userId = 101): MatchCandidate {
  return { userId, alias: `Synthetic loader ${userId}`, specialization: specialization(program), verifiedGrade: grade, verifiedScore: 100,
    verifiedSkills: [program === 'backend-python' ? 'Python' : 'TypeScript'], stack: [], statedSkills: [], workFormat: 'Удалённо',
    salaryMin: null, salaryMax: null, salaryType: 'gross', salaryPeriod: 'month', latestAssessmentAt: at,
    hasFspHistory: false, visibility: 'pseudonymous', consentMatching: true, demoMode: false };
}
function need(program: ProgramId, grade: SignalGrade = 'Junior'): MatchNeed {
  return { specialization: specialization(program), grade, requiredSkills: [], desirableSkills: [], workFormat: 'Удалённо', salaryMin: 100000, salaryMax: 200000, salaryType: 'gross', salaryPeriod: 'month' };
}
function saved(program: ProgramId, grade: SignalGrade, userId = 101, score = 83): SavedRow {
  const form = assembleManagedAttempt(program, grade, `loader-regression-${program}-${grade}`);
  return { id: userId + 1000, userId, programId: program, programVersion: program === 'backend-python' ? 'signal-backend-python-v6' : 'signal-frontend-typescript-v2', purpose: 'signal_qualification', grade, score, submittedAt: at, oracles: form.oracles };
}

// Independent JSON-level contract for the projected read. PostgreSQL execution
// is checked separately in isolated integration, not simulated by these tests.
function blueprintRead(value: unknown): unknown {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return structuredClone(value);
  return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, {
    blueprint: item !== null && typeof item === 'object' && !Array.isArray(item)
      ? (item as Record<string, unknown>).blueprint ?? null : null,
  }]));
}
async function evidenceRead(people: MatchCandidate[], rows: SavedRow[], projected: boolean, revoked: number[] = []) {
  const { withAssessmentRankingEvidence: load } = await loader();
  const fixture = queryFixture(rows.map(row => ({ ...row, oracles: projected ? blueprintRead(row.oracles) : structuredClone(row.oracles) })), revoked);
  const peopleBefore = digest(people);
  const result = await load(people, fixture.queryDb);
  assert.equal(digest(people), peopleBefore, 'Loader must not mutate source candidates');
  return { result, captures: fixture.captures };
}
function evaluatedPool(program: ProgramId, people: MatchCandidate[]) {
  const definition = need(program);
  return rankMatches(people.map(person => ({ candidate: person, evaluation: evaluateMatch(definition, person, false, at) }))
    .filter(row => row.evaluation.eligible)).map(row => ({ candidateId: row.candidate.userId, evaluation: row.evaluation }));
}

test('proposed SQL profile prefilter retains every admitted row across program/grade/privacy/pool boundaries', () => {
  let checks = 0;
  for (const program of programs) for (const minimum of grades) for (const verified of [...grades, null])
    for (const visibility of ['private', 'pseudonymous', 'public'] as const) for (const consentMatching of [false, true])
      for (const demoMode of [false, true]) for (const sameSpecialization of [false, true]) for (const latestAssessmentAt of [null, at]) {
        const person = { ...candidate(program, verified ?? 'Junior'), verifiedGrade: verified, visibility, consentMatching, demoMode,
          specialization: sameSpecialization ? specialization(program) : specialization(program === 'backend-python' ? 'frontend-typescript' : 'backend-python'), latestAssessmentAt };
        const definition = need(program, minimum);
        const admitted = evaluateMatch(definition, person, false, at).eligible;
        const preselected = person.consentMatching === true && person.visibility !== 'private' && person.specialization === definition.specialization && person.verifiedGrade !== null;
        assert.ok(!admitted || preselected, 'Proposed prefilter excluded an admitted profile');
        if (verified === 'Senior' && minimum === 'Junior' && visibility === 'public' && consentMatching && !demoMode && sameSpecialization) assert.ok(admitted, 'Higher grade and unknown legacy date remain admitted');
        checks++;
      }
  assert.equal(checks, 1152);
});

for (const program of programs) for (const grade of grades) {
  test(`actual ${program}/${grade} snapshot retains rubric, exact saved score and full matching outcome after blueprint read`, async () => {
    const person = candidate(program, grade), row = saved(program, grade);
    const before = await evidenceRead([person], [row], false), after = await evidenceRead([person], [row], true);
    const proof = after.result[0].assessmentEvidence;
    assert.ok(proof, 'Actual bank fixture must establish a linked proof');
    assert.equal(proof.score, 83, 'Saved attempt score is authoritative over profile100');
    assert.equal(proof.attemptId, row.id);
    assert.equal(proof.programVersion, program === 'backend-python' ? 'signal-backend-python-v6' : 'signal-frontend-typescript-v2');
    assert.equal(proof.state, 'verified');
    assert.match(proof.rubricKey, /^[0-9a-f]{64}$/);
    assert.equal(digest(before.result[0].assessmentEvidence), digest(proof), 'Rubric/provenance changed');
    assert.equal(digest(evaluatedPool(program, before.result)), digest(evaluatedPool(program, after.result)), 'Full matching outcome changed');
  });
}

test('mixed grade, FSP, linked score and unknown-quality pools retain exact order and explanations', async () => {
  for (const program of programs) {
    const people = [candidate(program, 'Middle', 201), candidate(program, 'Middle', 202), candidate(program, 'Senior', 203), candidate(program, 'Junior', 204), candidate(program, 'Middle', 205)];
    people[0].hasFspHistory = true;
    const rows = [saved(program, 'Middle', 201, 83), saved(program, 'Middle', 202, 100), saved(program, 'Senior', 203, 100), saved(program, 'Junior', 204, 100)];
    const before = await evidenceRead(people, rows, false), after = await evidenceRead(people, rows, true);
    assert.equal(after.result[4].assessmentEvidence, null, 'Legacy quality must remain unknown');
    const beforePool = evaluatedPool(program, before.result), afterPool = evaluatedPool(program, after.result);
    assert.equal(digest(beforePool), digest(afterPool), 'Pool order or complete explanation changed');
    assert.ok(afterPool.findIndex(row => row.candidateId === 202) < afterPool.findIndex(row => row.candidateId === 201), 'Comparable100 must beat83+FSP');
  }
});

test('extra, missing and malformed oracle metadata cannot become a six-criterion proof through projection', async () => {
  const row = saved('backend-python', 'Middle'), base = structuredClone(row.oracles) as Record<string, { blueprint?: Record<string, unknown> }>;
  const keys = Object.keys(base);
  const variants: unknown[] = [
    { ...base, extra: null },
    Object.fromEntries(Object.entries(base).slice(0, 5)),
    { ...base, [keys[2]]: null },
    { ...base, [keys[2]]: 'malformed' },
    { ...base, [keys[2]]: { blueprint: { ...base[keys[2]].blueprint, templateVersion: 1.5 } } },
    { ...base, [keys[2]]: { blueprint: { ...base[keys[2]].blueprint, family: 'unrelated' } } },
    { ...base, [keys[2]]: { blueprint: { ...base[keys[2]].blueprint, programId: 'frontend-typescript' } } },
  ];
  for (const oracles of variants) {
    const projected = blueprintRead(oracles) as Record<string, unknown>;
    assert.equal(Object.keys(projected).length, Object.keys(oracles as object).length, 'Projection must retain every root key/count');
    assert.equal(digest(Object.keys(projected).sort()), digest(Object.keys(oracles as object).sort()));
    const before = await evidenceRead([candidate('backend-python', 'Middle')], [{ ...row, oracles }], false);
    const after = await evidenceRead([candidate('backend-python', 'Middle')], [{ ...row, oracles }], true);
    assert.equal(before.result[0].assessmentEvidence, null);
    assert.equal(after.result[0].assessmentEvidence, null, 'Malformed metadata became measured');
    assert.equal(digest(evaluatedPool('backend-python', before.result)), digest(evaluatedPool('backend-python', after.result)));
  }
});

test('top-level non-object JSON is preserved; arrays keep their existing structural interpretation', async () => {
  const row = saved('frontend-typescript', 'Senior');
  for (const oracles of [false, 0, 'legacy', [], Object.values(row.oracles as object)]) {
    assert.equal(digest(blueprintRead(oracles)), digest(oracles), 'Top-level JSON must remain literal');
    const before = await evidenceRead([candidate('frontend-typescript', 'Senior')], [{ ...row, oracles }], false);
    const after = await evidenceRead([candidate('frontend-typescript', 'Senior')], [{ ...row, oracles }], true);
    assert.equal(digest(before.result[0].assessmentEvidence), digest(after.result[0].assessmentEvidence));
  }
  const { assessmentRubricKey } = await loader();
  assert.equal(assessmentRubricKey(null, 'frontend-typescript', 'signal-frontend-typescript-v2', 'Senior'), null);
});

test('ambiguous exact links remain unknown; revoked links still fail admission', async () => {
  const person = candidate('backend-python', 'Middle'), first = saved('backend-python', 'Middle');
  for (const projected of [false, true]) {
    const ambiguous = await evidenceRead([person], [first, { ...first, id: first.id + 1 }], projected);
    assert.equal(ambiguous.result[0].assessmentEvidence, null);
    const revoked = await evidenceRead([person], [first], projected, [first.id]);
    assert.equal(revoked.result[0].assessmentEvidence?.state, 'revoked');
    assert.equal(evaluateMatch(need('backend-python'), revoked.result[0], false, at).eligible, false);
  }
});

test('wrong owner, exact timestamp, grade, program and missing score cannot supply a profile proof', async () => {
  const row = saved('backend-python', 'Middle'), person = candidate('backend-python', 'Middle');
  for (const patch of [{ userId: row.userId + 1 }, { submittedAt: new Date(at.getTime() + 1) }, { grade: 'Senior' as const }, { programId: 'frontend-typescript' }, { score: null }]) {
    const before = await evidenceRead([person], [{ ...row, ...patch }], false), after = await evidenceRead([person], [{ ...row, ...patch }], true);
    assert.equal(before.result[0].assessmentEvidence, null);
    assert.equal(after.result[0].assessmentEvidence, null);
  }
});

test('actual loader query is a metadata whitelist, batch-bound and correction-aware; no evidence means no DB read', async () => {
  const row = saved('backend-python', 'Middle'), person = candidate('backend-python', 'Middle');
  const { captures } = await evidenceRead([person], [row], true);
  assert.equal(captures.length, 3);
  assert.equal(Object.keys(captures[0].fields).sort().join(','), 'data');
  const freshProjection = dialect.sqlToQuery(captures[0].fields.data);
  assert.match(freshProjection.sql, /jsonb_build_object/);
  assert.deepEqual(freshProjection.params, ['id','userId','programId','programVersion','purpose','grade','score','submittedAt']);
  assert.equal(Object.keys(captures[1].fields).sort().join(','), 'id,oracles');
  const projection = dialect.sqlToQuery(captures[1].fields.oracles);
  assert.match(projection.sql, /jsonb_each/);
  assert.match(projection.sql, /jsonb_object_agg/);
  assert.match(projection.sql, /'blueprint'/);
  assert.match(projection.sql, /else\s+"signal_assessment_attempts"\."oracles"\s+end/i);
  assert.ok(captures[0].params.flat().includes(person.userId) && captures[0].params.includes('submitted') && captures[0].params.includes(true) && captures[0].params.includes('signal_qualification'));
  assert.ok(captures[1].params.flat().includes(row.id));
  assert.match(captures[0].whereSql,/any\(/i);
  const empty = await evidenceRead([{ ...person, latestAssessmentAt: null }, { ...person, userId: 102, verifiedGrade: null }], [], true);
  assert.equal(empty.captures.length, 0);
  assert.ok(empty.result.every(item => item.assessmentEvidence === null));
});

test('warm immutable rubric cache retains exact outcomes while score, date, absence and revocation stay fresh', async () => {
  const { withAssessmentRankingEvidence: load, RankingRubricCache } = await loader();
  const cache = new RankingRubricCache(2), row = saved('backend-python', 'Middle'), person = candidate('backend-python', 'Middle');
  const read = async (people: MatchCandidate[], rows: SavedRow[], revoked: number[] = []) => {
    const fixture = queryFixture(rows, revoked);
    return { result: await load(people, fixture.queryDb, cache), captures: fixture.captures };
  };
  const cold = await read([person], [row]), warm = await read([person], [row]);
  assert.deepEqual(warm.result, cold.result);
  assert.equal(cold.captures.length, 3); assert.equal(warm.captures.length, 2);
  assert.ok(warm.captures.every(capture => !('oracles' in capture.fields)), 'Warm reads must not reload large oracle JSON');
  const changedScore = await read([person], [{ ...row, score: 67 }]);
  assert.equal(changedScore.result[0].assessmentEvidence?.score, 67);
  const revoked = await read([person], [row], [row.id]);
  assert.equal(revoked.result[0].assessmentEvidence?.state, 'revoked');
  assert.equal(evaluateMatch(need('backend-python'), revoked.result[0], false, at).eligible, false);
  const changedDate = await read([person], [{ ...row, submittedAt: new Date(at.getTime() + 1) }]);
  assert.equal(changedDate.result[0].assessmentEvidence, null, 'Fresh date must preserve exact link policy');
  const removedOrUnverified = await read([person], []);
  assert.equal(removedOrUnverified.result[0].assessmentEvidence, null, 'Cached metadata cannot resurrect an absent/unverified attempt');
  const restored = await read([person], [row]);
  assert.equal(restored.result[0].assessmentEvidence?.state, 'verified', 'Corrections are re-read each time');
});

test('rubric cache is bounded, identity changes invalidate it and no private oracle/answer survives', async () => {
  const { RankingRubricCache } = await loader(), cache = new RankingRubricCache(2);
  const first = saved('backend-python', 'Middle', 401), second = saved('backend-python', 'Middle', 402), third = saved('frontend-typescript', 'Senior', 403);
  const summary = cache.put(first, first.oracles);
  assert.deepEqual(Object.keys(summary).sort(), ['rubricKey', 'version']);
  cache.put(second, second.oracles); assert.ok(cache.get(first)); cache.put(third, third.oracles);
  assert.equal(cache.get(second), undefined, 'Least recently used entry is evicted at the fixed capacity');
  for (const patch of [{ userId: 999 }, { programId: 'other' }, { grade: 'Senior' }, { programVersion: 'different' }, { purpose: 'company_task' }]) {
    cache.put(first, first.oracles); assert.equal(cache.get({ ...first, ...patch }), undefined, 'Immutable identity mismatch must force fresh validation');
  }
  const invalid = cache.put(first, { injected: null });
  assert.equal(invalid.rubricKey, null); assert.equal(invalid.version, null);
  assert.equal(cache.get(first)?.rubricKey, null, 'Malformed historical rubric remains unknown on a warm read');
});

test('opt-in fresh local pool enrichment removes only cloning; default is non-mutating and all values/proof identities remain exact',async()=>{
  const {withAssessmentRankingEvidence:load}=await loader(),person=candidate('backend-python','Middle'),row=saved('backend-python','Middle');
  const originals=[person,{...person}],direct=await load(originals,queryFixture([row]).queryDb);
  assert.ok(originals.every(item=>item.assessmentEvidence===undefined));
  const locals=structuredClone(originals),actual=await load(locals,queryFixture([row]).queryDb,null,{mutateLocalProjection:true});
  assert.deepEqual(actual,direct);assert.equal(actual[0],locals[0]);assert.equal(actual[1],locals[1]);
  assert.equal(actual[0]?.assessmentEvidence,actual[1]?.assessmentEvidence,'Only the same exact immutable attempt shares fresh safe proof');
});

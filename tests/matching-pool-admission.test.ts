import test from 'node:test';
import assert from 'node:assert/strict';
import { preparePoolAdmission } from '../artifacts/api-server/src/lib/matching-pool-admission';
import { evaluateMatch, rankMatches, type AssessmentRankingEvidence, type MatchCandidate, type MatchNeed, type SignalGrade } from '../artifacts/api-server/src/lib/signal-matching';

const at = new Date('2026-10-06T00:00:00Z');
const grades: SignalGrade[] = ['Junior', 'Middle', 'Senior'];
const programs = ['Backend / Python', 'Frontend / TypeScript'] as const;
function need(specialization: string = programs[0], grade: SignalGrade = 'Junior', requiredSkills: readonly string[] = [specialization === programs[0] ? 'Python' : 'TypeScript']): MatchNeed {
  return { specialization, grade, requiredSkills, desirableSkills: [], workFormat: 'Удалённо', salaryMin: 100000, salaryMax: 200000, salaryType: 'gross', salaryPeriod: 'month' };
}
function candidate(specialization: string = programs[0], grade: SignalGrade | null = 'Middle', userId = 101): MatchCandidate {
  return { userId, alias: `Synthetic admission ${userId}`, specialization, verifiedGrade: grade, verifiedScore: 100,
    verifiedSkills: [specialization === programs[0] ? 'Python' : 'TypeScript'], stack: [], statedSkills: [], workFormat: 'Удалённо',
    salaryMin: null, salaryMax: null, salaryType: 'gross', salaryPeriod: 'month', latestAssessmentAt: at,
    hasFspHistory: false, visibility: 'pseudonymous', consentMatching: true, demoMode: false };
}
function proof(person: MatchCandidate, state: 'verified' | 'revoked' = 'verified', score = 83): AssessmentRankingEvidence {
  const backend = person.specialization === programs[0];
  return { attemptId: person.userId + 1000, candidateId: person.userId, programId: backend ? 'backend-python' : 'frontend-typescript',
    programVersion: backend ? 'signal-backend-python-v6' : 'signal-frontend-typescript-v2', grade: person.verifiedGrade!, score,
    submittedAt: person.latestAssessmentAt!.toISOString(), state, comparisonPolicy: 'same-program-version-rubric-v1', rubricKey: 'synthetic-structural-rubric' };
}
function assertCandidateUnchanged(person: MatchCandidate, before: MatchCandidate) {
  // Node releases disagree on deep equality of distinct Invalid Date objects.
  // Preserve the Date/null type and exact time (including NaN), independently
  // of the unchanged fields; do not stringify away malformed historical dates.
  const { latestAssessmentAt: actualDate, ...actualFields } = person;
  const { latestAssessmentAt: expectedDate, ...expectedFields } = before;
  assert.deepEqual(actualFields, expectedFields, 'Compiled admission must not mutate candidate fields');
  if (expectedDate === null) assert.equal(actualDate, null);
  else {
    assert.ok(actualDate instanceof Date, 'Candidate assessment date must remain a Date');
    assert.ok(Object.is(actualDate.getTime(), expectedDate.getTime()), 'Candidate assessment time must remain exact, including NaN');
  }
}
function assertEquivalent(definition: MatchNeed, person: MatchCandidate, poolDemoMode = false) {
  const definitionBefore = structuredClone(definition), personBefore = structuredClone(person);
  assert.equal(preparePoolAdmission(definition, poolDemoMode)(person), evaluateMatch(definition, person, poolDemoMode, at).eligible);
  assert.deepEqual(definition, definitionBefore, 'Compiled admission must not mutate the need');
  assertCandidateUnchanged(person, personBefore);
}

test('compiled admission equals full evaluation across the 1152 raw profile boundary matrix', () => {
  let checks = 0;
  for (const specialization of programs) for (const minimum of grades) for (const verified of [...grades, null])
    for (const visibility of ['private', 'pseudonymous', 'public'] as const) for (const consentMatching of [false, true])
      for (const demoMode of [false, true]) for (const sameSpecialization of [false, true]) for (const latestAssessmentAt of [null, at]) {
        const person = { ...candidate(specialization, verified), visibility, consentMatching, demoMode, latestAssessmentAt,
          specialization: sameSpecialization ? specialization : specialization === programs[0] ? programs[1] : programs[0] };
        assertEquivalent(need(specialization, minimum), person);
        checks++;
      }
  assert.equal(checks, 1152);
});

test('required skill coverage retains controlled aliases, Unicode and unknown exact identity', () => {
  const cases: ReadonlyArray<readonly [readonly string[], readonly string[], boolean]> = [
    [['Python', 'py', 'Ｐｙｔｈｏｎ'], ['\u00a0ＰＹＴＨＯＮ\u00a0'], true],
    [['API contracts'], [' ＡＰＩ\u3000\u3000contracts '], true],
    [['API-контракты'], ['ＡＰＩ－контракты'], true],
    [['Accessibility', 'Доступность'], ['Ａ１１Ｙ'], true],
    [[' Ｑ－Ｓｔｏｒｅ '], ['Q-Store'], true],
    [['Q-Store'], ['QStore'], false],
    [['API contracts'], ['API\u200bcontracts'], false],
    [[' e\u0301ngine  X '], ['ÉNGINE\tX'], true],
    [[], [], false],
    [['', '\t', '\u3000'], [], false],
    [['Python', 'SQL'], ['py', 'SQL', 'extra'], true],
    [['Python', 'SQL'], ['py', 'extra'], false],
  ];
  for (const specialization of programs) for (const [required, verified, expected] of cases) {
    const definition = need(specialization, 'Junior', required), person = { ...candidate(specialization), verifiedSkills: verified };
    assertEquivalent(definition, person);
    assert.equal(preparePoolAdmission(definition, false)(person), expected);
  }
});

test('invalid original requirements reject raw and enriched profiles before deduplication, with exact bounds', () => {
  const cases: ReadonlyArray<readonly [readonly string[], readonly string[], boolean]> = [
    [[], ['Python'], false],
    [['Python', ''], ['Python'], false],
    [['py', '\u00a0'], ['Python'], false],
    [['Python', '\ufeff'], ['Python'], false],
    [['Python', '\u202f'], ['Python'], false],
    [Array(41).fill('Python'), ['Python'], false],
    [['x'.repeat(101)], ['x'.repeat(101)], false],
    [['ﬃ'.repeat(40)], ['ffi'.repeat(40)], false], // NFKC expands 40 codepoints to 120.
    [Array(40).fill('py'), ['Python'], true],
    [['x'.repeat(100)], ['x'.repeat(100)], true],
    [[' Q-Store ', 'py'], ['Q-Store', 'Python'], true],
    [['Python', 'QStore'], ['Python', 'Q-Store'], false],
  ];
  for (const specialization of programs) for (const [required, verified, expected] of cases) {
    const definition = need(specialization, 'Junior', Object.freeze([...required]));
    const raw = { ...candidate(specialization), verifiedSkills: Object.freeze([...verified]) };
    const compiled = preparePoolAdmission(definition, false);
    const profiles: MatchCandidate[] = [raw, { ...raw, assessmentEvidence: proof(raw) }, { ...raw, assessmentEvidence: proof(raw, 'revoked') }];
    for (const person of profiles) {
      assertEquivalent(definition, person);
      assert.equal(compiled(person), expected && person.assessmentEvidence?.state !== 'revoked');
    }
  }
  const brokenNeed = Object.freeze(need(programs[0], 'Junior', Object.freeze(['Python', ' '])));
  const unusedCandidate = new Proxy(candidate(), { get() { throw new Error('Invalid requirements must not evaluate a candidate or its proof'); } });
  assert.equal(preparePoolAdmission(brokenNeed, false)(unusedCandidate), false);
});

test('minimum grade and demo pool remain exact independent gates in both pool modes', () => {
  for (const minimum of grades) for (const verified of grades) for (const poolDemoMode of [false, true]) {
    const definition = need(programs[0], minimum), person = { ...candidate(programs[0], verified), demoMode: poolDemoMode };
    assertEquivalent(definition, person, poolDemoMode);
    assert.equal(preparePoolAdmission(definition, poolDemoMode)(person), grades.indexOf(verified) >= grades.indexOf(minimum));
    assertEquivalent(definition, { ...person, demoMode: !poolDemoMode }, poolDemoMode);
    assert.equal(preparePoolAdmission(definition, poolDemoMode)({ ...person, demoMode: !poolDemoMode }), false);
  }
  assert.equal(preparePoolAdmission(need(programs[0], 'Junior'), false)(candidate(programs[0], 'Senior')), true);
  assert.equal(preparePoolAdmission(need(programs[0], 'Senior'), false)(candidate(programs[0], 'Junior')), false);
});

test('context, legacy timestamps and unsupported program names do not invent new admission gates', () => {
  // The snapshot assertion itself must reject a changed invalid-date type/time
  // and mutations to unrelated fields on both supported Node runtimes.
  const invalidDate = { ...candidate(), latestAssessmentAt: new Date(Number.NaN) };
  const invalidBefore = structuredClone(invalidDate);
  assertCandidateUnchanged(invalidDate, invalidBefore);
  assert.throws(() => assertCandidateUnchanged({ ...invalidDate, latestAssessmentAt: null }, invalidBefore), assert.AssertionError);
  assert.throws(() => assertCandidateUnchanged({ ...invalidDate, latestAssessmentAt: at }, invalidBefore), assert.AssertionError);
  assert.throws(() => assertCandidateUnchanged({ ...invalidDate, consentMatching: false }, invalidBefore), assert.AssertionError);
  const definition = { ...need(), desirableSkills: ['SQL', 'Docker', 'PostgreSQL'] };
  const variants: MatchCandidate[] = [
    { ...candidate(), latestAssessmentAt: null, verifiedScore: null },
    { ...candidate(), latestAssessmentAt: new Date('2000-01-01T00:00:00Z'), verifiedScore: 0 },
    { ...candidate(), latestAssessmentAt: new Date('2099-01-01T00:00:00Z'), verifiedScore: 100 },
    { ...candidate(), latestAssessmentAt: new Date(Number.NaN) },
    { ...candidate(), workFormat: 'Только офис', salaryMin: 900000, salaryMax: 1000000, salaryPeriod: 'year', salaryType: 'net' },
    { ...candidate(), stack: ['Python', 'SQL'], statedSkills: ['Docker'], verifiedSkills: [], hasFspHistory: true },
  ];
  for (const person of variants) {
    const effectiveNeed = definition;
    assertEquivalent(effectiveNeed, person);
    assert.equal(preparePoolAdmission(effectiveNeed, false)(person), person.verifiedSkills.includes('Python'));
    if (Number.isNaN(person.latestAssessmentAt?.getTime())) assert.equal(evaluateMatch(effectiveNeed, person, false, at).evidence[0]!.date, null, 'A malformed historical date stays unknown, not a rejection or invented ISO timestamp');
  }
  const unknown = candidate('Unsupported / Legacy');
  assertEquivalent(need('Unsupported / Legacy'), unknown);
  assert.equal(preparePoolAdmission(need('Unsupported / Legacy'), false)(unknown), true);
  assertEquivalent(need(), unknown);
  assert.equal(preparePoolAdmission(need(), false)(unknown), false);
  const statedOnly = { ...candidate(), verifiedSkills: [], stack: ['Python'], statedSkills: ['py'] };
  assertEquivalent(need(programs[0], 'Junior', ['Python']), statedOnly);
  assert.equal(preparePoolAdmission(need(programs[0], 'Junior', ['Python']), false)(statedOnly), false);
});

test('truthy linked and revoked assessment evidence follows the authoritative full evaluation', () => {
  let checks = 0;
  for (const specialization of programs) for (const grade of grades) {
    const definition = need(specialization), raw = candidate(specialization, grade);
    for (const state of ['verified', 'revoked'] as const) {
      const person = { ...raw, assessmentEvidence: proof(raw, state) };
      assertEquivalent(definition, person);
      assert.equal(preparePoolAdmission(definition, false)(person), state === 'verified');
      assert.equal(evaluateMatch(definition, person, false, at).ranking.qualityStatus, state === 'verified' ? 'measured' : 'revoked');
      checks++;
    }
  }
  assert.equal(checks, 12);
});

test('invalid or mismatched revoked provenance remains unknown instead of becoming a rejection', () => {
  const raw = candidate(), valid = proof(raw, 'revoked');
  const invalid: AssessmentRankingEvidence[] = [
    { ...valid, candidateId: raw.userId + 1 }, { ...valid, grade: 'Senior' }, { ...valid, programId: 'frontend-typescript' },
    { ...valid, comparisonPolicy: 'unsupported' as AssessmentRankingEvidence['comparisonPolicy'] },
    { ...valid, submittedAt: 'not-a-date' }, { ...valid, submittedAt: '2026-10-05T00:00:00Z' },
    { ...valid, attemptId: 0 }, { ...valid, attemptId: -1 }, { ...valid, attemptId: 1.5 },
    { ...valid, score: Number.NaN }, { ...valid, score: -1 }, { ...valid, score: 101 },
    { ...valid, programVersion: 'legacy-version' }, { ...valid, rubricKey: '' },
  ];
  for (const assessmentEvidence of invalid) {
    const person = { ...raw, assessmentEvidence };
    assertEquivalent(need(), person);
    assert.equal(preparePoolAdmission(need(), false)(person), true);
    assert.equal(evaluateMatch(need(), person, false, at).ranking.qualityStatus, 'not_measured');
  }
  for (const person of [{ ...raw, latestAssessmentAt: null, assessmentEvidence: valid }, { ...raw, specialization: 'Unsupported / Legacy', assessmentEvidence: valid }]) {
    const definition = need(person.specialization, 'Junior', person.verifiedSkills);
    assertEquivalent(definition, person);
    assert.equal(preparePoolAdmission(definition, false)(person), true);
    assert.equal(evaluateMatch(definition, person, false, at).ranking.qualityStatus, 'not_measured');
  }
});

test('compiled request predicates stay independent across needs, candidates and null evidence', () => {
  const backend = Object.freeze(need(programs[0], 'Junior', Object.freeze(['py'])));
  const frontend = Object.freeze(need(programs[1], 'Middle', Object.freeze(['ts'])));
  const admitBackend = preparePoolAdmission(backend, false), admitFrontend = preparePoolAdmission(frontend, true);
  const backendCandidate = Object.freeze({ ...candidate(), assessmentEvidence: null, verifiedSkills: Object.freeze(['Ｐｙｔｈｏｎ']) });
  const frontendCandidate = Object.freeze({ ...candidate(programs[1]), demoMode: true, verifiedSkills: Object.freeze(['TypeScript']) });
  for (let index = 0; index < 20; index++) {
    assert.equal(admitBackend(backendCandidate), true);
    assert.equal(admitFrontend(frontendCandidate), true);
    assert.equal(admitBackend(frontendCandidate), false);
    assert.equal(admitFrontend(backendCandidate), false);
    assertEquivalent(backend, backendCandidate);
    assertEquivalent(frontend, frontendCandidate, true);
  }
});

test('initial fast admission followed by proof enrichment preserves the full final pool and explanations', () => {
  for (const specialization of programs) {
    const definition = need(specialization), otherProgram = specialization === programs[0] ? programs[1] : programs[0];
    const people = [candidate(specialization, 'Middle', 201), candidate(specialization, 'Middle', 202), candidate(specialization, 'Senior', 203),
      candidate(specialization, 'Junior', 204), candidate(specialization, 'Middle', 205), candidate(otherProgram, 'Middle', 206),
      { ...candidate(specialization, 'Senior', 207), consentMatching: false }];
    people[0].hasFspHistory = true;
    const enrich = (person: MatchCandidate): MatchCandidate => ({ ...person, assessmentEvidence: person.userId === 205 ? null :
      proof(person, person.userId === 204 ? 'revoked' : 'verified', person.userId === 201 ? 83 : 100) });
    const finalPool = (initial: MatchCandidate[]) => rankMatches(initial.map(enrich).map(person => ({ candidate: person, evaluation: evaluateMatch(definition, person, false, at) }))
      .filter(entry => entry.evaluation.eligible));
    const before = structuredClone(people);
    const authoritative = finalPool(people.filter(person => evaluateMatch(definition, person, false, at).eligible));
    const compiled = finalPool(people.filter(preparePoolAdmission(definition, false)));
    assert.deepEqual(compiled, authoritative);
    assert.deepEqual(compiled.map(entry => entry.candidate.userId).sort(), [201, 202, 203, 205]);
    assert.ok(compiled.findIndex(entry => entry.candidate.userId === 202) < compiled.findIndex(entry => entry.candidate.userId === 201));
    assert.equal(compiled.find(entry => entry.candidate.userId === 205)!.evaluation.ranking.qualityScore, null);
    assert.deepEqual(people, before);
  }
});

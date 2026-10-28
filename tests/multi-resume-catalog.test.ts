import test from "node:test";
import assert from "node:assert/strict";
import {
  catalogVisible,
  deduplicateResumes,
  factBadges,
  matchesCatalogFilters,
  orderCatalog,
  selectMatchingResumes,
  type CatalogResume,
} from "../artifacts/api-server/src/lib/signal-resume-catalog";
import { compareResumeFacts } from "../artifacts/api-server/src/lib/signal-resume-comparison";
import { evaluateResumeCandidates } from "../artifacts/api-server/src/lib/signal-resume-evaluation";
import { FreshRankingCache, freshRankingKey, estimateRankingStringBytes } from "../artifacts/api-server/src/lib/signal-fresh-ranking-cache";
import {
  closedInvitationRetryAt,
  invitationBodyHash,
  quotaRetryAt,
} from "../artifacts/api-server/src/lib/signal-invitation-policy";
import {
  evaluateMatch,
  rankMatches,
  type AssessmentRankingEvidence,
  type MatchNeed,
  type SafeSkillEvidence,
} from "../artifacts/api-server/src/lib/signal-matching";
const now = new Date("2026-10-06T12:00:00Z");
const need: MatchNeed = {
  specialization: "Backend / Python",
  grade: "Middle",
  requiredSkills: ["Python", "SQL"],
  desirableSkills: [],
  workFormat: "Удалённо",
  salaryMin: 100000,
  salaryMax: 200000,
  salaryPeriod: "month",
  salaryType: "gross",
};
function resume(
  userId: number,
  resumeId: number,
  patch: Partial<CatalogResume> = {},
): CatalogResume {
  return {
    userId,
    resumeId,
    resumeRevision: 1,
    title: `Resume ${resumeId}`,
    alias: `Person ${userId}`,
    specialization: "Backend / Python",
    verifiedGrade: "Middle",
    verifiedScore: 85,
    verifiedSkills: ["Python", "SQL"],
    stack: [],
    statedSkills: [],
    yearsExperience: 4,
    workFormat: "Удалённо",
    salaryMin: 120000,
    salaryMax: 180000,
    salaryPeriod: "month",
    salaryType: "gross",
    latestAssessmentAt: new Date("2026-10-05T12:00:00Z"),
    hasFspHistory: false,
    visibility: "pseudonymous",
    consentMatching: true,
    consentCatalog: true,
    readyForOffers: false,
    demoMode: false,
    avatarDataUrl: null,
    publicName: null,
    deletedAt: null,
    legacyQualification: null,
    ...patch,
  };
}
function proof(
  candidate: CatalogResume,
  score: number,
  version = "signal-backend-python-v4",
): AssessmentRankingEvidence {
  return {
    attemptId: 100 + candidate.resumeId,
    candidateId: candidate.userId,
    programId: "backend-python",
    programVersion: version,
    grade: candidate.verifiedGrade!,
    score,
    submittedAt: candidate.latestAssessmentAt!.toISOString(),
    state: "verified",
    comparisonPolicy: "same-program-version-rubric-v1",
    rubricKey: "shared-rubric",
  };
}
const entry = (candidate: CatalogResume) => ({
  candidate,
  evaluation: evaluateMatch(need, candidate, false, now),
});
function evidence(
  skill: string,
  index: number,
  date = "2026-10-05T12:00:00Z",
): SafeSkillEvidence & { practicalPassed: boolean } {
  return {
    skill,
    candidateId: 1,
    attemptId: index + 1,
    programId: "backend-python",
    programVersion: "signal-backend-python-v4",
    templateId: "scenario",
    templateVersion: 1,
    criterionId: "sql-data",
    criterion: "SQL data",
    result: 100,
    date,
    sourceType: "signal_assessment",
    limitation: null,
    practicalPassed: true,
  };
}

test("catalogue requires explicit catalogue consent independently of old matching consent and never includes tombstones", () => {
  const old = resume(1, 10, { consentCatalog: false });
  assert.equal(catalogVisible(old, false), false);
  assert.equal(
    catalogVisible(
      { ...old, consentCatalog: true, visibility: "private" },
      false,
    ),
    false,
  );
  assert.equal(catalogVisible(resume(1, 11, { deletedAt: now }), false), false);
  assert.equal(catalogVisible(resume(1, 12, { demoMode: true }), false), false);
  assert.equal(catalogVisible(resume(1, 13), false), true);
});
test("all filters must match one whole resume; backend Senior cannot qualify frontend Junior", () => {
  const backend = resume(1, 10, { verifiedGrade: "Senior" }),
    frontend = resume(1, 11, {
      specialization: "Frontend / TypeScript",
      verifiedGrade: "Junior",
      verifiedSkills: ["TypeScript"],
    });
  const filters = {
    specialization: "Frontend / TypeScript",
    grade: "Senior" as const,
  };
  assert.deepEqual(
    [backend, frontend].filter((row) =>
      matchesCatalogFilters(row, filters, now),
    ),
    [],
  );
  assert.equal(
    matchesCatalogFilters(
      resume(1, 10, { verifiedSkills: ["Python"], stack: ["SQL"] }),
      { skills: ["Python", "SQL"] },
      now,
    ),
    false,
  );
  assert.equal(
    matchesCatalogFilters(
      resume(1, 10, { verifiedSkills: ["Ｐｙｔｈｏｎ", "SQL"] }),
      { skills: ["py", "SQL"] },
      now,
    ),
    true,
  );
});
test("salary compares annual/monthly only within gross/net, photo requires visible actual image, readiness is explicit", () => {
  assert.equal(
    matchesCatalogFilters(
      resume(1, 10, {
        visibility: "public",
        hasAccessiblePhoto: true,
        avatarDataUrl: null,
      }),
      { hasPhoto: "yes" },
      now,
    ),
    true,
  );
  assert.equal(
    matchesCatalogFilters(
      resume(1, 10, {
        visibility: "pseudonymous",
        hasAccessiblePhoto: true,
        avatarDataUrl: null,
      }),
      { hasPhoto: "yes" },
      now,
    ),
    false,
  );
  assert.equal(
    matchesCatalogFilters(
      resume(1, 10, {
        visibility: "public",
        hasAccessiblePhoto: false,
        avatarDataUrl: "data:image/png;base64,old",
      }),
      { hasPhoto: "yes" },
      now,
    ),
    false,
  );
  const annual = resume(1, 10, {
    salaryMin: 1440000,
    salaryMax: 2160000,
    salaryPeriod: "year",
    avatarDataUrl: "data:image/png;base64,real",
  });
  assert.equal(
    matchesCatalogFilters(
      annual,
      {
        salaryMin: 130000,
        salaryMax: 170000,
        salaryPeriod: "month",
        salaryType: "gross",
      },
      now,
    ),
    true,
  );
  assert.equal(
    matchesCatalogFilters(
      annual,
      {
        salaryMin: 130000,
        salaryMax: 170000,
        salaryPeriod: "month",
        salaryType: "net",
      },
      now,
    ),
    false,
  );
  assert.equal(matchesCatalogFilters(annual, { hasPhoto: "yes" }, now), false);
  assert.equal(
    matchesCatalogFilters(
      { ...annual, visibility: "public" },
      { hasPhoto: "yes" },
      now,
    ),
    true,
  );
  assert.equal(
    matchesCatalogFilters(annual, { readyForOffers: "yes" }, now),
    false,
  );
  assert.equal(
    matchesCatalogFilters(
      { ...annual, readyForOffers: true },
      { readyForOffers: "yes" },
      now,
    ),
    true,
  );
  assert.equal(
    matchesCatalogFilters(
      resume(1, 11, { verifiedGrade: null }),
      { grade: "unconfirmed" },
      now,
    ),
    true,
  );
});
test("deduplication before pagination/counts and neutral stable order ignores photo, primary and extra resumes", () => {
  const rows = Array.from({ length: 30 }, (_, index) =>
    resume(index + 1, index + 100),
  );
  const result = orderCatalog(
    deduplicateResumes([
      ...rows,
      ...rows.map((row) => ({ ...row, resumeId: row.resumeId + 1000 })),
    ]),
  );
  assert.equal(result.people.length, 30);
  assert.equal(result.order, "confirmed-first");
  assert.equal(result.confirmedOrder, "neutral-alias");
  const first = result.people
      .slice(0, 24)
      .map((person) => person.selected.userId),
    second = result.people.slice(24).map((person) => person.selected.userId);
  assert.equal(new Set([...first, ...second]).size, 30);
  const photos = orderCatalog(
    deduplicateResumes([
      ...rows.map((row) => ({
        ...row,
        avatarDataUrl: "data:image/png;base64,x",
        visibility: "public" as const,
      })),
      resume(1, 9999),
    ]),
  );
  assert.deepEqual(
    photos.people.map((person) => person.selected.userId),
    result.people.map((person) => person.selected.userId),
  );
});
test("mixed program versions stay neutral; comparable group can use its own score and tie IDs stay deterministic", () => {
  let a = resume(1, 10, { alias: "A" }),
    b = resume(2, 20, { alias: "B" }),
    c = resume(3, 30, { alias: "C" });
  a = { ...a, assessmentEvidence: proof(a, 60) };
  b = { ...b, assessmentEvidence: proof(b, 95) };
  c = { ...c, assessmentEvidence: proof(c, 99, "signal-backend-python-v3") };
  assert.deepEqual(
    orderCatalog(deduplicateResumes([b, a])).people.map(
      (person) => person.selected.userId,
    ),
    [2, 1],
  );
  for (const rows of [
    [a, b, c],
    [c, a, b],
    [b, c, a],
  ]) {
    const ordered = orderCatalog(deduplicateResumes(rows));
    assert.equal(ordered.order, "confirmed-first");
    assert.equal(ordered.confirmedOrder, "neutral-alias");
    assert.deepEqual(
      ordered.people.map((person) => person.selected.userId),
      [1, 2, 3],
    );
  }
});
test("one person reaches frozen matching exactly once; best whole resume selected without raw cross-group score comparison", () => {
  const good = resume(1, 10),
    worse = resume(1, 11, { workFormat: "Офис" }),
    other = resume(2, 20);
  const selected = selectMatchingResumes([
    entry(worse),
    entry(other),
    entry(good),
  ]);
  assert.equal(selected.length, 2);
  assert.equal(
    selected.find((row) => row.candidate.userId === 1)!.candidate.resumeId,
    10,
  );
  assert.equal(rankMatches(selected).length, 2);
  const allSame = [resume(1, 30), resume(1, 31), resume(1, 32)].map(
    (row, index) => ({
      ...row,
      assessmentEvidence: proof(
        row,
        60 + index * 10,
        index === 2 ? "signal-backend-python-v3" : "signal-backend-python-v4",
      ),
    }),
  );
  for (const rows of [allSame, [...allSame].reverse()])
    assert.equal(
      selectMatchingResumes(rows.map(entry))[0]!.candidate.resumeId,
      30,
    );
});
test("factual badges count canonical current proofs, not aliases, legacy aggregates or invented dates", () => {
  const nine = Array.from({ length: 9 }, (_, index) =>
    evidence(`Independent skill ${index}`, index),
  );
  assert.equal(
    factBadges(nine, now).some((b) => b.id === "ten-skills"),
    false,
  );
  const ten = [...nine, evidence("SQL", 10), evidence("sql", 11)];
  const badges = factBadges(ten, now);
  assert.equal(badges.find((b) => b.id === "ten-skills")!.skills.length, 10);
  assert.ok(badges.some((b) => b.id === "recent-skills"));
  assert.ok(badges.some((b) => b.id === "practical"));
  assert.equal(
    factBadges(
      ten.map((e) => ({
        ...e,
        sourceType: "legacy_record" as const,
        attemptId: null,
      })),
      now,
    ).length,
    0,
  );
  assert.equal(
    factBadges(
      ten.map((e) => ({
        ...e,
        date: "2026-08-01T00:00:00Z",
        practicalPassed: false,
      })),
      now,
    ).some((b) => b.id === "recent-skills" || b.id === "practical"),
    false,
  );
  assert.equal(
    factBadges(ten.slice(0, 9), now).some((b) => b.id === "ten-skills"),
    false,
  );
});
test("comparison names decisive admission and conditions, preserves full-pool positions, avoids false universal superiority", () => {
  let a = resume(1, 10),
    b = resume(2, 20),
    c = resume(3, 30);
  a = { ...a, assessmentEvidence: proof(a, 70) };
  b = { ...b, assessmentEvidence: proof(b, 80) };
  c = { ...c, assessmentEvidence: proof(c, 95, "signal-backend-python-v3") };
  const pool = rankMatches([entry(a), entry(b), entry(c)]),
    result = compareResumeFacts(need, entry(a), entry(c), pool);
  assert.equal(result.comparable, false);
  assert.ok(result.limitations[0]!.includes("не сравниваются"));
  assert.equal(
    result.orderContext.leftPosition,
    pool.findIndex((row) => row.candidate.userId === 1) + 1,
  );
  assert.ok(result.summary.includes("равно"));
  assert.ok(!/лучше вообще|сильнее|лучший специалист/.test(result.summary));
  const missing = resume(2, 21, {
    verifiedSkills: ["Python"],
    statedSkills: ["SQL"],
    workFormat: "Офис",
    salaryMin: 500000,
    salaryMax: 600000,
  });
  const contrast = compareResumeFacts(need, entry(a), entry(missing), pool);
  assert.ok(contrast.differences.some((d) => d.kind === "admission"));
  assert.ok(contrast.differences.some((d) => d.kind === "required-skill"));
  assert.ok(contrast.summary.includes("только указан"));
  const comparable = compareResumeFacts(need, entry(a), entry(b), pool);
  assert.ok(comparable.differences.some((d) => d.kind === "comparable-result"));
});
test("invitation quota uses rolling UTC instants, closed contact cooldown spans requests, body hashes are sender-key content independent", () => {
  const recent = Array.from(
    { length: 20 },
    (_, index) => new Date(now.getTime() - 23 * 3600000 + index * 1000),
  );
  assert.equal(
    quotaRetryAt(recent, now, 20),
    new Date(recent[0]!.getTime() + 86400000).toISOString(),
  );
  assert.equal(
    quotaRetryAt(recent, new Date(now.getTime() + 3600001), 20),
    null,
  );
  assert.equal(quotaRetryAt(recent.slice(1), now, 20), null);
  assert.equal(closedInvitationRetryAt(now, now), "2026-10-13T12:00:00.000Z");
  assert.equal(
    closedInvitationRetryAt(new Date("2026-09-29T12:00:00Z"), now),
    null,
  );
  assert.equal(
    invitationBodyHash({ resumeId: 10, candidateId: 1 }),
    invitationBodyHash({ candidateId: 1, resumeId: 10 }),
  );
  assert.notEqual(
    invitationBodyHash({ resumeId: 10, candidateId: 1 }),
    invitationBodyHash({ candidateId: 1, resumeId: 11 }),
  );
});

test('request-local same-person résumé evaluation preserves every outcome and complete ranking at 5000×5 scale', () => {
  const rows = Array.from({length:5000},(_,index)=>Array.from({length:5},(_,copy)=>resume(index+1,index*5+copy+1,{alias:`Alias ${String(index).padStart(5,'0')}`,workFormat: index%3===0?'Гибрид':'Удалённо',hasFspHistory:index%7===0}))).flat();
  const direct = rows.map(candidate=>({candidate,evaluation:evaluateMatch(need,candidate,false,now)}));
  const optimized = evaluateResumeCandidates(need,rows,false,now);
  assert.deepEqual(optimized,direct);
  assert.equal(new Set(optimized.map(row=>row.evaluation.ranking)).size,5000,'Same-person alternatives retain the shared pure ranking calculation');
  assert.ok(optimized.every(row=>row.evaluation.factorLedger!.factors.every(f=>f.versions.resumeId===row.candidate.resumeId&&f.versions.resumeRevision===(row.candidate.resumeRevision??null))),'Every ledger is bound to its exact CV');
  assert.deepEqual(rankMatches(selectMatchingResumes(optimized)),rankMatches(selectMatchingResumes(direct)));
  const changes: Partial<CatalogResume>[] = [{alias:'Different'}, {specialization:'Frontend / TypeScript'}, {verifiedGrade:'Junior'}, {verifiedScore:32}, {verifiedSkills:['Python']}, {stack:['Redis']}, {statedSkills:['Docker']}, {workFormat:'Офис'}, {salaryMin:400000}, {salaryMax:400000}, {salaryPeriod:'year'}, {salaryType:'net'}, {latestAssessmentAt:new Date(now.getTime()-181*86400000)}, {hasFspHistory:true}, {visibility:'private'}, {consentMatching:false}, {demoMode:true}, {assessmentEvidence:{attemptId:7,candidateId:1,programId:'backend-python',programVersion:'signal-backend-python-v6',grade:'Middle',score:83,submittedAt:'2026-10-05T12:00:00Z',state:'revoked',comparisonPolicy:'same-program-version-rubric-v1',rubricKey:'actual'}}, {skillEvidence:[{skill:'Python',candidateId:1,attemptId:8,programId:'backend-python',programVersion:'v6',templateId:null,templateVersion:null,criterionId:'api-contracts',criterion:'API',result:100,date:'2026-10-05T12:00:00Z',sourceType:'signal_assessment',limitation:null}]}];
  for(const patch of changes) {
    const variants=[resume(1,1),resume(1,2,patch)];
    const actual=evaluateResumeCandidates(need,variants,false,now);
    assert.deepEqual(actual,variants.map(candidate=>({candidate,evaluation:evaluateMatch(need,candidate,false,now)})));
    assert.notEqual(actual[0]!.evaluation,actual[1]!.evaluation,'A differing whole résumé must not use another résumé calculation');
  }
});

test('fresh-input ranking memo matches complete results, reattaches current candidate rows and never omits semantic need/scope/time changes',()=>{
  const scope={demoMode:false,reviewScopeId:null},cache=new FreshRankingCache(),rows=[resume(1,1),resume(1,2),resume(2,3)];
  const key=(n:MatchNeed=need,s=scope,o=new Map<number,number>(),at=now)=>freshRankingKey(n,s,o,'complete-current-pool-sha','fresh-current-assessment-sha',rows,at);
  let computes=0;const compute=()=>{computes++;return rankMatches(selectMatchingResumes(evaluateResumeCandidates(need,rows,false,now)));};
  const cold=cache.read(key(),rows,compute),freshRows=structuredClone(rows),warm=cache.read(key(),freshRows,()=>{throw new Error('Expected semantic hit');});
  assert.deepEqual(warm,cold);assert.equal(computes,1);assert.equal(warm[0]!.candidate,freshRows.find(row=>row.resumeId===warm[0]!.candidate.resumeId));
  assert.ok(Object.isFrozen(warm[0]!.evaluation.ranking));assert.equal(Reflect.set(warm[0]!.evaluation.ranking,'position',100),false);
  const otherOwnerNeed={...need,requiredSkills:[...need.requiredSkills],desirableSkills:[...need.desirableSkills]};assert.equal(key(otherOwnerNeed),key(),'Only exact semantic fields affect pure matching, ownership is checked separately');
  for(const patch of [{grade:'Senior' as const},{specialization:'Frontend / TypeScript'},{requiredSkills:['Python']},{desirableSkills:['Docker']},{workFormat:'Офис'},{salaryMin:1},{salaryMax:9},{salaryPeriod:'year' as const},{salaryType:'net' as const}])assert.notEqual(key({...need,...patch}),key());
  assert.notEqual(key(need,{demoMode:true,reviewScopeId:null}),key());assert.notEqual(key(need,scope,new Map([[1,2]])),key());
  assert.notEqual(freshRankingKey(need,scope,new Map(),'hidden-current-pool-sha','fresh-current-assessment-sha',rows,now),key());
  assert.notEqual(freshRankingKey(need,scope,new Map(),'complete-current-pool-sha','corrected-current-assessment-sha',rows,now),key());
  const at=rows[0]!.latestAssessmentAt!;
  for(const boundary of [30,90,180]) {
    const before=new Date(at.getTime()+boundary*86400000-(boundary===180?1:0)),after=new Date(at.getTime()+boundary*86400000+(boundary===180?0:1));
    assert.notEqual(key(need,scope,new Map(),before),key(need,scope,new Map(),after));
    assert.notEqual(evaluateMatch(need,rows[0]!,false,before).ranking.businessFitScore,evaluateMatch(need,rows[0]!,false,after).ranking.businessFitScore);
  }
});

test('matches JSON facet preserves exact bytes, invalidates with every fresh key and shares the ranking retention boundary',()=>{
  const cache=new FreshRankingCache(),rows=[resume(1,1),resume(2,2)];let renders=0;
  const compute=()=>rankMatches(selectMatchingResumes(evaluateResumeCandidates(need,rows,false,now)));
  const render=(entries:ReturnType<typeof compute>)=>{renders++;return JSON.stringify(entries.map(row=>({resumeId:row.candidate.resumeId,title:row.candidate.title,alias:row.candidate.alias,ranking:row.evaluation.ranking})));};
  const cold=cache.read('complete-current-inputs',rows,compute),coldBytes=cache.serialize(cold,()=>render(cold));
  const warm=cache.read('complete-current-inputs',structuredClone(rows),compute),warmBytes=cache.serialize(warm,()=>{throw new Error('Exact JSON should reuse');});assert.equal(warmBytes,coldBytes);assert.equal(renders,1);
  for(const changed of ['hidden-row','new-title','new-score','new-date','fresh-correction','new-role','new-scope']) {
    const current=cache.read(changed,rows,compute);assert.equal(cache.serialize(current,()=>render(current)),coldBytes);
  }
  assert.equal(renders,8);
  const bounded=new FreshRankingCache(2,512),oversize=bounded.read('big',rows,compute);let largeRenders=0;
  for(let n=0;n<2;n++)bounded.serialize(oversize,()=>{largeRenders++;return 'x'.repeat(10000);});assert.equal(largeRenders,2,'Oversized presentation must not be retained outside the shared budget');
});

test('UTF16 conservative string accounting covers ASCII, Cyrillic and surrogate pairs while two facets still obey the same byte cap',()=>{
  for(const value of ['ASCII','Кириллица','Signal ⚡ 😀','\ud800']) {
    assert.equal(estimateRankingStringBytes(value),Buffer.byteLength(value,'utf16le')+64);
  }
  const rows=[resume(1,1)],compute=()=>rankMatches(selectMatchingResumes(evaluateResumeCandidates(need,rows,false,now)));
  const measured=new FreshRankingCache();measured.read('accounted-compact',rows,compute);
  const compactBytes=measured.diagnostics().retainedEstimatedBytes;
  const json=JSON.stringify({label:'Профессиональный профиль ⚡ 😀'.repeat(100)}),budget=compactBytes*2+estimateRankingStringBytes(json);
  const cache=new FreshRankingCache(2,budget),a=cache.read('A',rows,compute);
  assert.equal(cache.serialize(a,()=>json),json);
  const b=cache.read('B',rows,compute);
  assert.equal(cache.diagnostics().entries,2);assert.equal(cache.diagnostics().retainedEstimatedBytes,budget);
  cache.serialize(b,()=>json);
  assert.equal(cache.diagnostics().entries,1);assert.ok(cache.diagnostics().retainedEstimatedBytes<=budget);
  let recomputed=false;cache.read('A',rows,()=>{recomputed=true;return compute();});assert.ok(recomputed);
});

test('explicit overrides can reuse default full ranking only when every current winner ID is exactly requested',()=>{
  const rows=[resume(1,1),resume(1,2,{workFormat:'Офис'}),resume(2,3)],cache=new FreshRankingCache();
  const compute=()=>rankMatches(selectMatchingResumes(evaluateResumeCandidates(need,rows,false,now)));
  const cold=cache.read('fresh-full-default',rows,compute),requested=new Map(cold.map(item=>[item.candidate.userId,item.candidate.resumeId]));
  const equivalent=cache.readEquivalentDefault('fresh-full-default',structuredClone(rows),requested);assert.deepEqual(equivalent,cold);
  assert.equal(cache.readEquivalentDefault('fresh-full-default',rows,new Map([[1,2]])),undefined);
  assert.equal(cache.readEquivalentDefault('fresh-full-default',rows,new Map([[999,1]])),undefined);
  assert.equal(cache.readEquivalentDefault('fresh-correction-title-scope-or-clock',rows,requested),undefined);
  assert.equal(cache.readEquivalentDefault('fresh-full-default',rows.filter(row=>row.resumeId!==1),requested),undefined);
  const changed=rows.map(row=>row.resumeId===1?{...row,workFormat:'Офис'}:row.resumeId===2?{...row,workFormat:'Удалённо'}:row);
  cache.read('new-fresh-choice',changed,()=>rankMatches(selectMatchingResumes(evaluateResumeCandidates(need,changed,false,now))));
  assert.equal(cache.readEquivalentDefault('new-fresh-choice',changed,new Map([[1,1]])),undefined);
  assert.ok(cache.readEquivalentDefault('new-fresh-choice',changed,new Map([[1,2]])));
});

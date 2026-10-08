/** Preregistered, one-use synthetic business control. No DB, seed, or tuning. */
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { evaluateMatch, rankMatches, type MatchNeed, type SignalGrade } from '../artifacts/api-server/src/lib/signal-matching';
import { catalogVisible, matchesCatalogFilters, prepareCatalogFilters, deduplicateResumes, orderCatalog, selectMatchingResumes, type CatalogResume } from '../artifacts/api-server/src/lib/signal-resume-catalog';
import { EmployerRequiredSkills } from '../artifacts/api-server/src/lib/employer-required-skills';
import { emptyFspSignal, compactFspSignal, trustedFspResults, type FspRankingFacts, type FspResult } from '../artifacts/api-server/src/lib/fsp-results';

type Salary = { min: number; max: number; period: 'month' | 'year'; type: 'gross' | 'net'; currency: string };
type Qualification = { purpose: string; valid: boolean; specialization: string; declaredGrade: SignalGrade; verificationState: string; programId: string; programVersion: string; rubricId: string | null; resultPercent: number | null; confirmedAt: string };
type FspSource = { state: string; legacyBoolean: boolean; trustedResults: { eventId: string; trusted: boolean; category: { specialization: string; grade: SignalGrade }; result: string; occurredAt: string }[] };
type SourceResume = { resumeId: number; personId: number; revision: number; isPrimary: boolean; title: string; specialization: string; visibility: 'private' | 'public' | 'pseudonymous'; deleted: boolean; consentMatching: boolean; consentCandidateBank: boolean; verifiedSkills: string[]; claimedSkills: string[]; workFormat: string; salary: Salary; qualification: Qualification | null; otherEvidence: unknown[]; fspEvidence: FspSource; businessContext: unknown };
type SourceNeed = { needId: string; split: 'diagnostic' | 'untouched_final'; title: string; specialization: string; minimumGrade: SignalGrade; requiredSkills: string[]; desirableSkills: string[]; workFormat: string; salary: Salary; poolPersonIds: number[]; requestValidation: { expected: string }; businessTask: string };
type Dataset = { datasetId: string; measurementTimeForAdapter: string; people: { personId: number; alias: string; split: string }[]; resumes: SourceResume[]; needs: SourceNeed[]; catalogContract: unknown };
type Pointwise = { personId: number; strictRelevance: number; strictEligible: boolean; eligibleResumeIds: number[]; catalogRelevance: number; catalogReadableResumeIds: number[] };
type LabelCase = { needId: string; split: string; pointwise: Pointwise[]; coverageExpectation: unknown };
type Labels = { cases: LabelCase[] };
type Variant = 'base-conservative-unresolved' | 'conditional-participation-plus1' | 'conditional-prize-plus2' | 'conditional-win-plus3';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const inputsDir = 'docs/validation/independent-matching-20261007';
const outDir = 'outputs/quality/independent-matching-20261007';
const ownSource = 'scripts/evaluate-independent-matching-20261007.ts';
const productionSources = ['signal-matching.ts', 'signal-resume-catalog.ts', 'fsp-results.ts', 'employer-required-skills.ts', 'skill-catalog.ts'].map(name => `artifacts/api-server/src/lib/${name}`);
const sha = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex');
const jsonText = (value: unknown) => JSON.stringify(value, null, 2) + '\n';
const read = (relative: string) => readFile(path.join(root, relative));
const loadJson = async <T,>(relative: string) => JSON.parse((await read(relative)).toString('utf8')) as T;
const writeExclusive = (relative: string, value: unknown) => writeFile(path.join(root, relative), jsonText(value), { flag: 'wx' });
const formats: Record<string, string> = { remote: 'Удалённо', hybrid: 'Гибрид', office: 'Офис' };
const programs: Record<string, string> = { 'Backend / Python': 'backend-python', 'Frontend / TypeScript': 'frontend-typescript' };
const variants: Variant[] = ['base-conservative-unresolved', 'conditional-participation-plus1', 'conditional-prize-plus2', 'conditional-win-plus3'];
const conditionalOutcome: Partial<Record<Variant, FspResult>> = { 'conditional-participation-plus1': 'participation', 'conditional-prize-plus2': 'prize', 'conditional-win-plus3': 'win' };
const metricFormula = {
  schemaVersion: 1, k: [3, 5], positiveThreshold: 2,
  gain: '2 ** relevance - 1', discount: '1 / Math.log2(oneBasedRank + 1)',
  ideal: 'all 12 pointwise strict business labels sorted numerically descending; not product rank',
  nDCG: 'DCG@k / IDCG@k, null when IDCG is zero; empty with positive IDCG is 0',
  precision: 'count of returned labels >= 2 in first k / k; missing positions are 0',
  macro: 'all cases reported; nDCG mean over non-null cases with explicit null and case counts; P mean over all cases',
  recall: 'returned unique business-positive people / expected unique positives; null at zero positives',
  coverage: 'actual and expected admitted unique people and exact CV IDs, false and missing IDs, empty/short outputs, dedup and privacy',
  catalog: 'independent specialization-only readable CV coverage and person dedup, confirmed-first order; no strict nDCG',
  invalidNeed: 'strict validation uses production EmployerRequiredSkills before evaluate/rank; independent catalog has no need dependency',
  permutations: 'original and reversed input storage order, for every variant and split; secondary run tests invariance, never tuning',
  sensitivity: 'three preregistered conditional outcome mappings, same input/labels/metrics; not authored or observed FSP outcomes',
};

async function verifyOriginalInputs() {
  const original = await loadJson<{ immutableInputs: Record<string, { path: string; sha256: string }>; scope: unknown }>(`${inputsDir}/freeze.json`);
  const freezeHash = sha(await read(`${inputsDir}/freeze.json`));
  if (freezeHash !== '318607b05e5779a4f47e42ed3842e7562a459f64f67e05e5e3e17fdb0b084eb0') throw new Error('Original freeze changed');
  const hashes: Record<string, string> = { [`${inputsDir}/freeze.json`]: freezeHash };
  for (const item of Object.values(original.immutableInputs)) {
    const relative = item.path.replaceAll('\\', '/');
    const hash = sha(await read(relative));
    if (hash !== item.sha256) throw new Error(`Frozen input changed: ${relative}`);
    hashes[relative] = hash;
  }
  hashes[`${inputsDir}/adapter-semantics-v1.json`] = sha(await read(`${inputsDir}/adapter-semantics-v1.json`));
  return { original, hashes };
}

function mappingFor(dataset: Dataset) {
  const versions = [...new Set(dataset.resumes.flatMap(row => row.qualification ? [row.qualification.programVersion] : []))].sort();
  const versionMap = Object.fromEntries(versions.map((value, index) => [value, index + 101]));
  return {
    schemaVersion: 1, sourceShape: 'source-neutral-v1', synthetic: true,
    formatMap: formats, specializationProgramMap: programs, opaqueVersionSuffixMap: versionMap,
    versionSemantics: 'Injective spelling only: suffix numbers grant no superiority; same specialization/version remains equal, disjoint groups remain disjoint. Grade and literal rubric key remain comparison boundaries.',
    qualifications: 'Only valid signal_qualification whose specialization and source program specialization/grade exactly match this CV grants declaredGrade. current_linked uses this same immutable source percent/date/program/version/rubric. legacy_valid_grade keeps grade/date but score and full proof null.',
    ids: 'personId remains userId. resumeId/revision remain exact, synthetic attemptId=resumeId is injective and tied to that person/CV. No primary substitution or pooled skill union.',
    fsp: 'Base keeps trusted connected same current qualification category completed_with_distinction unresolved bonus0. Claimed, foreign category, provider error and boolean alone are untrusted/no effect. Conditional variants map only the eligible ambiguous outcome to +1/+2/+3.',
    catalog: 'consentCandidateBank maps to consentCatalog; independent public/nondeleted specialization-only catalog with unconfirmed included, no minimum grade, independent of strict request validity.',
    omitted: 'businessContext and businessTask have no fields in actual matching DTO; preserved in source and reported as an unmodelled product business limitation. No fabricated text/score/grade/evidence criteria. Currency must be RUB; this dataset is single-currency.',
    mappings: dataset.resumes.map(row => ({
      resumeId: row.resumeId, personId: row.personId, sourceProgramId: row.qualification?.programId ?? null,
      programId: row.qualification ? programs[row.specialization] : null,
      sourceVersion: row.qualification?.programVersion ?? null,
      programVersion: row.qualification ? `signal-${programs[row.specialization]}-v${versionMap[row.qualification.programVersion]}` : null,
      rubricKey: row.qualification?.rubricId ?? null,
      attemptId: row.qualification?.verificationState === 'current_linked' ? row.resumeId : null,
      verificationState: row.qualification?.verificationState ?? null,
      rawFsp: row.fspEvidence,
    })),
  };
}

function validQualification(row: SourceResume): Qualification | null {
  const q = row.qualification;
  const sourcePrefix = row.specialization === 'Backend / Python' ? 'backend' : row.specialization === 'Frontend / TypeScript' ? 'frontend' : null;
  return q && q.purpose === 'signal_qualification' && q.valid === true && q.specialization === row.specialization && sourcePrefix && q.programId === `${sourcePrefix}-synthetic-${q.declaredGrade.toLowerCase()}` ? q : null;
}
function relevantAmbiguousResults(row: SourceResume) {
  const q = validQualification(row);
  return row.fspEvidence.state === 'connected' && q
    ? row.fspEvidence.trustedResults.filter(result => result.trusted === true && result.category.specialization === row.specialization && result.category.grade === q.declaredGrade && result.result === 'completed_with_distinction') : [];
}
function fspFacts(row: SourceResume, variant: Variant): FspRankingFacts {
  const relevant = relevantAmbiguousResults(row);
  const outcome = conditionalOutcome[variant];
  if (relevant.length && outcome) return compactFspSignal(trustedFspResults(relevant.map(result => ({ id: result.eventId, title: 'Conditional synthetic outcome, not an authored placement', event: result.eventId, occurredAt: result.occurredAt.slice(0, 10), kind: 'placement', result: outcome }))));
  if (relevant.length) return { policyVersion: 'fsp-category-results-v1', historyStatus: 'unresolved_results', bestResult: null, bonus: 0, source: 'synthetic_fixture', synthetic: true };
  return compactFspSignal(emptyFspSignal(row.fspEvidence.legacyBoolean || row.fspEvidence.state !== 'not_connected'));
}

function adaptResume(row: SourceResume, dataset: Dataset, manifest: ReturnType<typeof mappingFor>, variant: Variant): CatalogResume {
  if (row.salary.currency !== 'RUB' || !formats[row.workFormat] || !programs[row.specialization]) throw new Error(`adapterUnsupported: unmapped source field in CV ${row.resumeId}`);
  const person = dataset.people.find(person => person.personId === row.personId);
  if (!person) throw new Error(`Missing person ${row.personId}`);
  const q = validQualification(row);
  const linked = q?.verificationState === 'current_linked' && q.rubricId !== null && q.resultPercent !== null;
  if (q && !['current_linked', 'legacy_valid_grade'].includes(q.verificationState)) throw new Error(`adapterUnsupported: qualification state ${q.verificationState}`);
  return {
    userId: row.personId, alias: person.alias, resumeId: row.resumeId, resumeRevision: row.revision,
    title: row.title, specialization: row.specialization,
    verifiedGrade: q?.declaredGrade ?? null, verifiedScore: linked ? q!.resultPercent : null,
    verifiedSkills: q ? [...row.verifiedSkills] : [], stack: [...row.claimedSkills], statedSkills: [...row.claimedSkills],
    workFormat: formats[row.workFormat]!, salaryMin: row.salary.min, salaryMax: row.salary.max,
    salaryPeriod: row.salary.period, salaryType: row.salary.type,
    latestAssessmentAt: q ? new Date(q.confirmedAt) : null,
    hasFspHistory: row.fspEvidence.legacyBoolean || row.fspEvidence.state !== 'not_connected', fspSignal: fspFacts(row, variant),
    visibility: row.visibility, consentMatching: row.consentMatching, consentCatalog: row.consentCandidateBank,
    demoMode: true, deletedAt: row.deleted ? new Date(dataset.measurementTimeForAdapter) : null,
    yearsExperience: 0, readyForOffers: false, avatarDataUrl: null, publicName: null, legacyQualification: null,
    assessmentEvidence: linked ? {
      attemptId: row.resumeId, candidateId: row.personId, programId: programs[row.specialization]!,
      programVersion: `signal-${programs[row.specialization]}-v${manifest.opaqueVersionSuffixMap[q!.programVersion]}`,
      grade: q!.declaredGrade, score: q!.resultPercent!, submittedAt: q!.confirmedAt, state: 'verified',
      comparisonPolicy: 'same-program-version-rubric-v1', rubricKey: q!.rubricId!,
    } : null,
  };
}
function adaptNeed(row: SourceNeed): MatchNeed {
  if (row.salary.currency !== 'RUB' || !formats[row.workFormat]) throw new Error(`adapterUnsupported: need ${row.needId}`);
  return { specialization: row.specialization, grade: row.minimumGrade, requiredSkills: [...row.requiredSkills], desirableSkills: [...row.desirableSkills], workFormat: formats[row.workFormat]!, salaryMin: row.salary.min, salaryMax: row.salary.max, salaryPeriod: row.salary.period, salaryType: row.salary.type };
}
function metricAt(ids: number[], pointwise: Pointwise[], k: number) {
  const labels = new Map(pointwise.map(point => [point.personId, point.strictRelevance]));
  const actualLabels = ids.slice(0, k).map(id => labels.get(id) ?? 0);
  const idealLabels = pointwise.map(point => point.strictRelevance).sort((a, b) => b - a).slice(0, k);
  const dcg = (values: number[]) => values.reduce((sum, value, index) => sum + (2 ** value - 1) / Math.log2(index + 2), 0);
  const idealDcg = dcg(idealLabels);
  return { k, nDCG: idealDcg === 0 ? null : dcg(actualLabels) / idealDcg, precision: actualLabels.filter(value => value >= 2).length / k, dcg: dcg(actualLabels), idealDcg, missingPlaces: Math.max(0, k - ids.length), precisionDenominator: k };
}
const difference = (left: number[], right: number[]) => left.filter(id => !new Set(right).has(id)).sort((a, b) => a - b);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

function runCase(need: SourceNeed, labels: LabelCase, dataset: Dataset, manifest: ReturnType<typeof mappingFor>, variant: Variant) {
  const sourceRows = dataset.resumes.filter(row => need.poolPersonIds.includes(row.personId));
  const now = new Date(dataset.measurementTimeForAdapter);
  const request = EmployerRequiredSkills.safeParse(need.requiredSkills);
  const definition = adaptNeed(need);
  const candidates = sourceRows.map(row => adaptResume(row, dataset, manifest, variant));
  const strictFor = (pool: CatalogResume[]) => {
    if (!request.success) return { ranked: [], entries: [] };
    const entries = pool.filter(row => !row.deletedAt).map(candidate => ({ candidate, evaluation: evaluateMatch(definition, candidate, true, now) })).filter(entry => entry.evaluation.eligible);
    return { entries, ranked: rankMatches(selectMatchingResumes(entries)) };
  };
  const catalogFor = (pool: CatalogResume[]) => {
    const filters = { specialization: need.specialization };
    const prepared = prepareCatalogFilters(filters);
    const rows = pool.filter(row => catalogVisible(row, true) && matchesCatalogFilters(row, filters, now, prepared));
    return { rows, ordered: orderCatalog(deduplicateResumes(rows)) };
  };
  const actual = strictFor(candidates), permuted = strictFor([...candidates].reverse());
  const catalog = catalogFor(candidates), catalogPermuted = catalogFor([...candidates].reverse());
  const ids = actual.ranked.map(row => row.candidate.userId);
  const expectedIds = labels.pointwise.filter(point => point.strictEligible).map(point => point.personId);
  const eligibleResumeIds = labels.pointwise.flatMap(point => point.eligibleResumeIds);
  const actualResumeIds = actual.entries.map(entry => entry.candidate.resumeId);
  const readableIds = labels.pointwise.flatMap(point => point.catalogReadableResumeIds);
  const actualReadableIds = catalog.rows.map(row => row.resumeId);
  const expectedCatalogPeople = labels.pointwise.filter(point => point.catalogReadableResumeIds.length > 0).map(point => point.personId);
  const catalogPeople = catalog.ordered.people.map(person => person.selected.userId);
  const positive = labels.pointwise.filter(point => point.strictRelevance >= 2).map(point => point.personId);
  const strictPrivateLeaks = actual.ranked.flatMap(row => [row.candidate, ...row.alternatives]).filter(row => row.deletedAt || row.visibility === 'private' || !row.consentMatching).map(row => row.resumeId);
  const catalogPrivateLeaks = catalog.ordered.people.flatMap(person => person.alternatives).filter(row => row.deletedAt || row.visibility === 'private' || !row.consentCatalog).map(row => row.resumeId);
  const eligibleAmbiguous = sourceRows.filter(row => actualResumeIds.includes(row.resumeId) && relevantAmbiguousResults(row).length > 0).map(row => row.resumeId);
  const unsupportedRaw = sourceRows.filter(row => row.fspEvidence.trustedResults.some(result => result.trusted && result.result === 'completed_with_distinction')).map(row => row.resumeId);
  const bestResumeFailures = actual.ranked.filter(row => !labels.pointwise.find(point => point.personId === row.candidate.userId)?.eligibleResumeIds.includes(row.candidate.resumeId)).map(row => row.candidate.resumeId);
  const strictInvariant = same(actual.ranked.map(row => [row.candidate.userId, row.candidate.resumeId]), permuted.ranked.map(row => [row.candidate.userId, row.candidate.resumeId]));
  const catalogInvariant = same(catalogPeople, catalogPermuted.ordered.people.map(person => person.selected.userId));
  return {
    needId: need.needId, split: need.split, variant,
    status: variant === 'base-conservative-unresolved' && unsupportedRaw.length ? 'adapterUnsupported-fsp-outcome-partial' : variant === 'base-conservative-unresolved' ? 'measured' : 'conditional-synthetic-sensitivity',
    adapterUnsupported: { outcome: 'completed_with_distinction', rawPoolResumeIds: unsupportedRaw, eligibleSameCategoryResumeIds: eligibleAmbiguous, baseTreatment: 'unresolved bonus0; retained, not dropped' },
    request: { accepted: request.success, expected: need.requestValidation.expected, validationMatchesExpectation: request.success === (need.requestValidation.expected === 'accept'), noRankBeforeInvalidValidation: !request.success ? actual.ranked.length === 0 : null },
    metrics: { at3: metricAt(ids, labels.pointwise, 3), at5: metricAt(ids, labels.pointwise, 5) },
    coverage: { poolUniquePeople: need.poolPersonIds.length, expectedEligiblePeople: expectedIds.length, actualEligiblePeople: ids.length, expectedPositivePeople: positive.length, actualReturnedPositivePeople: ids.filter(id => positive.includes(id)).length, positiveRecall: positive.length ? ids.filter(id => positive.includes(id)).length / positive.length : null, empty: ids.length === 0, shortAt3: ids.length < 3, shortAt5: ids.length < 5, unexpectedPeople: difference(ids, expectedIds), missingPeople: difference(expectedIds, ids), unexpectedEligibleResumeIds: difference(actualResumeIds, eligibleResumeIds), missingEligibleResumeIds: difference(eligibleResumeIds, actualResumeIds) },
    strict: { personIds: ids, rows: actual.ranked.map(row => ({ personId: row.candidate.userId, resumeId: row.candidate.resumeId, alternativeResumeIds: row.alternatives.map(item => item.resumeId), label: labels.pointwise.find(point => point.personId === row.candidate.userId)?.strictRelevance ?? null, fit: row.evaluation.ranking.businessFitScore, salaryCompatibility: row.evaluation.salaryCompatibility, fspBonus: row.evaluation.fspBonus, ranking: row.evaluation.ranking })), evaluatedResumeIds: actualResumeIds },
    checks: { inputPermutationInvariant: strictInvariant, catalogInputPermutationInvariant: catalogInvariant, duplicatePeople: ids.length - new Set(ids).size, strictPrivateLeaks, catalogPrivateLeaks, bestResumeFailures, exactWholeResumeSelected: bestResumeFailures.length === 0 },
    catalog: { independentRequest: true, filters: { specialization: need.specialization, includeUnconfirmed: true, minimumGrade: null }, order: catalog.ordered.order, confirmedOrder: catalog.ordered.confirmedOrder, confirmedTotal: catalog.ordered.confirmedTotal, unconfirmedTotal: catalog.ordered.unconfirmedTotal, personIds: catalogPeople, rows: catalog.ordered.people.map(person => ({ personId: person.selected.userId, selectedResumeId: person.selected.resumeId, alternativeResumeIds: person.alternatives.map(row => row.resumeId), confirmed: person.selected.verifiedGrade !== null })), expectedReadablePeople: expectedCatalogPeople.length, actualReadablePeople: catalogPeople.length, unexpectedPeople: difference(catalogPeople, expectedCatalogPeople), missingPeople: difference(expectedCatalogPeople, catalogPeople), unexpectedResumeIds: difference(actualReadableIds, readableIds), missingResumeIds: difference(readableIds, actualReadableIds), scopeConflict: !request.success ? 'Frozen labels mark catalog empty for invalid strict need, but catalogContract is independent specialization-only query. Preserve both; this is a scope conflict, not evidence of privacy disclosure.' : null },
  };
}
type Result = ReturnType<typeof runCase>;
function aggregate(rows: Result[]) {
  const means = (selector: (row: Result) => number | null) => { const values = rows.map(selector).filter((value): value is number => value !== null); return { mean: values.length ? values.reduce((a, b) => a + b, 0) / values.length : null, measuredCaseCount: values.length, nullCaseCount: rows.length - values.length, totalCaseCount: rows.length }; };
  return {
    totalCaseCount: rows.length,
    nDCGAt3: means(row => row.metrics.at3.nDCG), nDCGAt5: means(row => row.metrics.at5.nDCG),
    precisionAt3: means(row => row.metrics.at3.precision), precisionAt5: means(row => row.metrics.at5.precision),
    expectedEligiblePeopleAcrossCases: rows.reduce((sum, row) => sum + row.coverage.expectedEligiblePeople, 0), actualEligiblePeopleAcrossCases: rows.reduce((sum, row) => sum + row.coverage.actualEligiblePeople, 0),
    expectedPositivePeopleAcrossCases: rows.reduce((sum, row) => sum + row.coverage.expectedPositivePeople, 0), returnedPositivePeopleAcrossCases: rows.reduce((sum, row) => sum + row.coverage.actualReturnedPositivePeople, 0),
    emptyCaseIds: rows.filter(row => row.coverage.empty).map(row => row.needId), shortAt3: rows.filter(row => row.coverage.shortAt3).length, shortAt5: rows.filter(row => row.coverage.shortAt5).length,
    adapterUnsupportedCaseCount: rows.filter(row => row.status.startsWith('adapterUnsupported')).length,
    sameCategoryAmbiguousEligibleCases: rows.filter(row => row.adapterUnsupported.eligibleSameCategoryResumeIds.length).length,
    falseAdmissions: rows.reduce((sum, row) => sum + row.coverage.unexpectedPeople.length, 0), missingAdmissions: rows.reduce((sum, row) => sum + row.coverage.missingPeople.length, 0),
    perResumeFalseAdmissions: rows.reduce((sum, row) => sum + row.coverage.unexpectedEligibleResumeIds.length, 0), perResumeMissingAdmissions: rows.reduce((sum, row) => sum + row.coverage.missingEligibleResumeIds.length, 0),
    bestResumeFailures: rows.reduce((sum, row) => sum + row.checks.bestResumeFailures.length, 0), duplicatePeople: rows.reduce((sum, row) => sum + row.checks.duplicatePeople, 0),
    privacyViolations: rows.reduce((sum, row) => sum + row.checks.strictPrivateLeaks.length + row.checks.catalogPrivateLeaks.length, 0),
    invalidRequestFailures: rows.filter(row => !row.request.validationMatchesExpectation || row.request.noRankBeforeInvalidValidation === false).length,
    permutationFailures: rows.filter(row => !row.checks.inputPermutationInvariant || !row.checks.catalogInputPermutationInvariant).length,
    catalog: { falseResumeAdmissions: rows.reduce((sum, row) => sum + row.catalog.unexpectedResumeIds.length, 0), missingResumeAdmissions: rows.reduce((sum, row) => sum + row.catalog.missingResumeIds.length, 0), scopeConflictCaseIds: rows.filter(row => row.catalog.scopeConflict).map(row => row.needId), otherMismatchCaseIds: rows.filter(row => !row.catalog.scopeConflict && (row.catalog.unexpectedResumeIds.length || row.catalog.missingResumeIds.length)).map(row => row.needId) },
  };
}

async function main() {
  const mode = process.argv[2];
  if (!['--freeze-adapter', '--evaluate-once'].includes(mode ?? '')) throw new Error('Use --freeze-adapter (no ranking), then --evaluate-once (one-use receipt)');
  const originals = await verifyOriginalInputs();
  const dataset = await loadJson<Dataset>(`${inputsDir}/dataset.json`);
  const labels = await loadJson<Labels>(`${inputsDir}/labels.json`);
  if (dataset.needs.length !== 24 || dataset.people.length !== 24 || dataset.resumes.length !== 32 || labels.cases.reduce((sum, row) => sum + row.pointwise.length, 0) !== 288) throw new Error('Frozen scope differs');
  const manifest = mappingFor(dataset);
  const formulaHash = sha(jsonText(metricFormula)), mappingHash = sha(jsonText(manifest));
  const adapterHash = sha(await read(ownSource));
  const sourceHashes = Object.fromEntries(await Promise.all(productionSources.map(async relative => [relative, sha(await read(relative))])));
  await mkdir(path.join(root, outDir), { recursive: true });
  if (mode === '--freeze-adapter') {
    // Pure mapping/type construction only. No admission, comparator, or metrics called.
    for (const row of dataset.resumes) adaptResume(row, dataset, manifest, 'base-conservative-unresolved');
    for (const row of dataset.needs) adaptNeed(row);
    await writeExclusive(`${outDir}/mapping-manifest.json`, manifest);
    await writeExclusive(`${outDir}/metrics-formula.json`, metricFormula);
    await writeExclusive(`${outDir}/adapter-freeze.json`, { schemaVersion: 1, status: 'FROZEN_BEFORE_FIRST_NEW_RANK', frozenAtUtc: new Date().toISOString(), originalInputs: originals.hashes, adapterSource: { path: ownSource, sha256: adapterHash }, productionSourceHashes: sourceHashes, mappingManifestSha256: mappingHash, metricFormulaSha256: formulaHash, firstNewRankExecuted: false, variants, newInputsOrLabelsEdited: false, tuningAllowed: false, limitedBlindness: 'Author knew historical policy; reader/adapter implementer inspected current functions after original label freeze. Synthetic, not independent human pilot.' });
    console.log(jsonText({ status: 'ADAPTER_FROZEN_NO_RANK_RUN', adapterHash, mappingHash, formulaHash, outDir }));
    return;
  }
  const freeze = await loadJson<{ adapterSource: { sha256: string }; originalInputs: Record<string, string>; productionSourceHashes: Record<string, string>; mappingManifestSha256: string; metricFormulaSha256: string; frozenAtUtc: string }>(`${outDir}/adapter-freeze.json`);
  if (freeze.adapterSource.sha256 !== adapterHash || !same(freeze.originalInputs, originals.hashes) || !same(freeze.productionSourceHashes, sourceHashes) || freeze.mappingManifestSha256 !== mappingHash || freeze.metricFormulaSha256 !== formulaHash) throw new Error('Frozen adapter/input/production/metrics changed; do not evaluate');
  if (sha(await read(`${outDir}/mapping-manifest.json`)) !== mappingHash || sha(await read(`${outDir}/metrics-formula.json`)) !== formulaHash) throw new Error('Manifest/formula changed');
  const firstRunAt = new Date().toISOString();
  // Exclusive first-use marker persists even if this run fails. No silent rerun.
  await writeExclusive(`${outDir}/first-use.json`, { startedAtUtc: firstRunAt, adapterFreezeSha256: sha(await read(`${outDir}/adapter-freeze.json`)), adapterHash, mode, finalSetUsedForTuning: false, diagnosticAndFinalEvaluatedTogetherNoTuning: true });
  const results: Result[] = [];
  for (const variant of variants) for (const need of dataset.needs) {
    const row = labels.cases.find(row => row.needId === need.needId);
    if (!row) throw new Error(`Missing labels ${need.needId}`);
    results.push(runCase(need, row, dataset, manifest, variant));
  }
  const splitSummary = Object.fromEntries(variants.map(variant => [variant, Object.fromEntries(['diagnostic', 'untouched_final', 'all'].map(split => [split, aggregate(results.filter(row => row.variant === variant && (split === 'all' || row.split === split)))]))]));
  const report = { schemaVersion: 1, status: 'MEASURED_WITH_EXPLICIT_ADAPTER_AND_SCOPE_LIMITS', startedAtUtc: firstRunAt, completedAtUtc: new Date().toISOString(), originalFreezeAtUtc: '2026-10-07T13:48:28Z', adapterFreezeAtUtc: freeze.frozenAtUtc, adapterFreezeSha256: sha(await read(`${outDir}/adapter-freeze.json`)), originalInputsSha256: originals.hashes, adapterHash, mappingHash, formulaHash, sourceHashes, datasetId: dataset.datasetId, measurementTime: dataset.measurementTimeForAdapter, totalFrozenCases: 24, finalSets: 1, finalUsedForTuning: false, summary: splitSummary, results,
    limitations: [
      'Preregistered synthetic business control, limited blindness and zero independent human users/employers; not evidence of hiring effectiveness.',
      'completed_with_distinction has no authored numeric outcome: main conservative measurements retain adapterUnsupported coverage; conditional +1/+2/+3 are sensitivity only, not observed provider result.',
      'Matching DTO has no businessTask/domain text input. Numeric business relevance can reflect this gap; no text or relevance-derived score invented.',
      'Opaque provenance spelling mapped injectively, raw percentages preserved only for same program+grade+version+rubric. Legacy full result remains null.',
      'D07/F23 labels make independent catalog empty solely because strict request invalid, conflicting with source catalogContract; both actual and frozen expectations retained.',
      'Catalog relevance labels are not strict ranking metrics; catalog coverage/permissions/order are reported separately.',
      'No production changes, parameter tuning, input changes, label edits, dropped cases, DB writes or historical report overwrites performed.',
    ],
    historical: { intergroupNDcgAt5: { before: 0.9200023809, after: 0.9025322621, reference: 'outputs/quality/0.6.0/fsp-category/frozen-quality-summary-7ea2c5003deb.json', overwritten: false }, competitiveNDcgAt5: { before: 0.9705, after: 0.9788, reference: 'outputs/quality/0.6.0/fsp-category', overwritten: false }, differentDatasetNotDirectComparison: true },
  };
  await writeExclusive(`${outDir}/report.json`, report);
  const base = results.filter(row => row.variant === 'base-conservative-unresolved');
  const csvRows = [['need', 'split', 'status', 'nDCG@3', 'nDCG@5', 'P@3', 'P@5', 'expectedEligible', 'actualEligible', 'positiveRecall', 'empty', 'returnedPersonIds', 'selectedResumeIds', 'fspUnsupportedEligibleResumeIds', 'catalogScopeConflict']];
  for (const row of base) csvRows.push([row.needId, row.split, row.status, String(row.metrics.at3.nDCG ?? 'null'), String(row.metrics.at5.nDCG ?? 'null'), String(row.metrics.at3.precision), String(row.metrics.at5.precision), String(row.coverage.expectedEligiblePeople), String(row.coverage.actualEligiblePeople), String(row.coverage.positiveRecall ?? 'null'), String(row.coverage.empty), row.strict.personIds.join(';'), row.strict.rows.map(item => item.resumeId).join(';'), row.adapterUnsupported.eligibleSameCategoryResumeIds.join(';'), String(Boolean(row.catalog.scopeConflict))]);
  const csv = csvRows.map(row => row.map(cell => '"' + cell.replaceAll('"', '""') + '"').join(',')).join('\r\n') + '\r\n';
  await writeFile(path.join(root, outDir, 'base-cases.csv'), csv, { flag: 'wx' });
  console.log(jsonText({ status: report.status, report: `${outDir}/report.json`, summary: splitSummary }));
}
main().catch(error => { console.error(error instanceof Error ? error.message : String(error)); process.exitCode = 1; });

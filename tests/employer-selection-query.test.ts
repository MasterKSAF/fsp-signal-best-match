import assert from 'node:assert/strict';
import test from 'node:test';
import { SelectionQuery, matchesSelectionFilters, selectionCandidate, sortSelection, verifiedSkillLevels, type SelectionResume, type SelectionQueryInput } from '../artifacts/api-server/src/lib/employer-selection-query';
import { deduplicateResumes } from '../artifacts/api-server/src/lib/signal-resume-catalog';
import { evaluateMatch, type SafeSkillEvidence } from '../artifacts/api-server/src/lib/signal-matching';

const now = new Date('2026-10-08T10:00:00Z');
const row = (patch: Partial<SelectionResume> = {}): SelectionResume => ({
  userId: 7, resumeId: 41, resumeRevision: 3, title: 'Backend-разработчик', alias: 'Alias Seven', publicName: 'Скрытое Имя',
  specialization: 'Backend / Python', verifiedGrade: 'Middle', verifiedScore: 80, verifiedSkills: ['Python'], stack: ['Python', 'SQL'], statedSkills: ['Python', 'SQL'],
  workFormat: 'Удалённо', salaryMin: 120000, salaryMax: 180000, salaryPeriod: 'month', salaryType: 'gross',
  latestAssessmentAt: now, hasFspHistory: false, visibility: 'pseudonymous', consentMatching: true, consentCatalog: true,
  demoMode: false, yearsExperience: 4, readyForOffers: true, avatarDataUrl: 'data:image/png;base64,TEST', deletedAt: null,
  legacyQualification: null, location: 'Москва', updatedAt: now, ...patch,
});
const proof = (skill: string, level: SafeSkillEvidence['level'], sourceType: SafeSkillEvidence['sourceType'] = 'signal_skill_module'): SafeSkillEvidence => ({
  skill, level, sourceType, candidateId: 7, attemptId: 9, programId: null, programVersion: null, templateId: null,
  templateVersion: null, criterionId: null, criterion: null, result: null, date: now.toISOString(), limitation: null,
});
const filter = (patch: Record<string, unknown> = {}): SelectionQueryInput => SelectionQuery.parse(patch);

test('empty skill filters do not create a synthetic empty skill requirement', () => {
  assert.equal(matchesSelectionFilters(row(), filter(), now), true);
});

test('name filter searches permitted identity and does not search a hidden true name', () => {
  assert.equal(matchesSelectionFilters(row(), filter({ q: 'Скрытое' }), now), false);
  assert.equal(matchesSelectionFilters(row(), filter({ q: 'alias' }), now), true);
  assert.equal(matchesSelectionFilters(row({ visibility: 'public' }), filter({ q: 'скрытое' }), now), true);
  assert.equal(matchesSelectionFilters(row({ visibility: 'public' }), filter({ q: 'alias' }), now), true);
});
test('individual verified filter requires a current skill module and actual minimum level', () => {
  const legacy = row({ skillEvidence: [proof('Python', 'Senior', 'legacy_record')] });
  assert.equal(matchesSelectionFilters(legacy, filter({ verifiedSkills: 'Python' }), now), false);
  const actual = row({ skillEvidence: [proof('Python', 'Junior')] });
  assert.equal(matchesSelectionFilters(actual, filter({ verifiedSkills: 'py' }), now), true);
  assert.equal(matchesSelectionFilters(actual, filter({ verifiedSkills: 'Python', verifiedSkillLevel: 'Middle' }), now), false);
  assert.equal(verifiedSkillLevels(legacy).size, 0);
});
test('confirmed and declared skill predicates have separate explicit AND / OR semantics', () => {
  const person = row({ skillEvidence: [proof('Python', 'Middle')] });
  assert.equal(matchesSelectionFilters(person, filter({ verifiedSkills: 'Python,SQL', verifiedSkillsMode: 'all' }), now), false);
  assert.equal(matchesSelectionFilters(person, filter({ verifiedSkills: 'Python,SQL', verifiedSkillsMode: 'any' }), now), true);
  assert.equal(matchesSelectionFilters(person, filter({ declaredSkills: 'SQL,React', declaredSkillsMode: 'all' }), now), false);
  assert.equal(matchesSelectionFilters(person, filter({ declaredSkills: 'SQL,React', declaredSkillsMode: 'any' }), now), true);
  assert.equal(matchesSelectionFilters(person, filter({ verifiedSkills: 'SQL', declaredSkills: 'SQL' }), now), false);
});
test('combined salary, skill and grade filters cannot borrow fields from another CV before person deduplication', () => {
  const salaryCV = row({ resumeId: 41, salaryMin: 120000, skillEvidence: [proof('SQL', 'Middle')], stack: ['SQL'] });
  const pythonCV = row({ resumeId: 42, salaryMin: 300000, salaryMax: 350000, skillEvidence: [proof('Python', 'Middle')], stack: ['Python'] });
  const input = filter({ verifiedSkills: 'Python', salaryMin: 100000, salaryMax: 180000, salaryPeriod: 'month', salaryType: 'gross', grade: 'Middle', experienceMin: 2, location: 'Москва' });
  assert.deepEqual(deduplicateResumes([salaryCV, pythonCV].filter(cv => matchesSelectionFilters(cv, input, now))), []);
  const accepted = row({ ...pythonCV, salaryMin: 120000, salaryMax: 180000 });
  const people = deduplicateResumes([salaryCV, accepted].filter(cv => matchesSelectionFilters(cv, input, now)));
  assert.equal(people.length, 1);
  assert.equal(people[0].selected.resumeId, 42);
  assert.equal(people[0].selected.salaryMin, 120000);
});
test('salary filter rejects unknown bases and gross / net differences while accepting known annual conversion', () => {
  const input = filter({ salaryMin: 100000, salaryMax: 180000, salaryPeriod: 'month', salaryType: 'gross' });
  assert.equal(matchesSelectionFilters(row({ salaryType: 'net' }), input, now), false);
  assert.equal(matchesSelectionFilters(row({ salaryType: undefined }), input, now), false);
  assert.equal(matchesSelectionFilters(row({ salaryPeriod: 'year', salaryMin: 1200000, salaryMax: 1800000 }), input, now), true);
  assert.equal(SelectionQuery.safeParse({ salaryMin: 100000 }).success, false);
});
test('sorting puts unknowns last in each direction, preserves deterministic ties and unique people across pages', () => {
  const resumes = [row({ userId: 5, resumeId: 52, verifiedGrade: null }), row({ userId: 3, resumeId: 32 }), row({ userId: 2, resumeId: 22 }), row({ userId: 1, resumeId: 12, verifiedGrade: 'Senior' })];
  const people = deduplicateResumes(resumes);
  const descending = sortSelection(people, { sort: 'grade', direction: 'desc' });
  const ascending = sortSelection(people, { sort: 'grade', direction: 'asc' });
  assert.deepEqual(descending.map(person => person.selected.userId), [1, 2, 3, 5]);
  assert.deepEqual(ascending.map(person => person.selected.userId), [2, 3, 1, 5]);
  assert.deepEqual([...descending.slice(0, 2), ...descending.slice(2, 4)].map(person => person.selected.resumeId), [12, 22, 32, 52]);
  assert.equal(new Set(descending.map(person => person.selected.userId)).size, 4);
});
test('salary sorting keeps separate gross and net groups and does not promote missing salary', () => {
  const people = deduplicateResumes([row({ userId: 3, resumeId: 33, salaryType: 'net', salaryMin: 90000 }), row({ userId: 2, resumeId: 22, salaryMin: 150000 }), row({ userId: 1, resumeId: 11, salaryMin: 100000 }), row({ userId: 4, resumeId: 44, salaryMin: null })]);
  assert.deepEqual(sortSelection(people, { sort: 'salary', direction: 'asc' }).map(person => person.selected.userId), [1, 2, 3, 4]);
});
test('safe projection uses exact CV grade and ID, hides private identity / photo and exposes no exam dump', () => {
  const candidate = row({ verifiedGrade: null, skillEvidence: [proof('Python', 'Junior'), proof('py', 'Middle'), proof('SQL', 'Senior', 'legacy_record')] });
  const projected = selectionCandidate(candidate, [candidate]);
  assert.equal(projected.resumeId, 41);
  assert.equal(projected.resumeRevision, 3);
  assert.equal(projected.verifiedGrade, null);
  assert.equal(projected.publicName, null);
  assert.equal(projected.avatarDataUrl, null);
  assert.equal(projected.skillChips.find(skill => skill.status === 'verified')?.level, 'Middle');
  assert.equal(projected.skillChips.filter(skill => skill.status === 'verified').length, 1);
  assert.equal(projected.skillChips.find(skill => skill.label === 'SQL')?.status, 'declared');
  for (const key of ['skillEvidence', 'assessmentEvidence', 'verifiedScore', 'legacyQualification', 'categoryEvidence', 'programVersion']) assert.equal(Object.hasOwn(projected, key), false, key);
  assert.equal(Object.hasOwn(projected, 'match'), false, 'catalogue has no invented fit score');
});
test('ineligible context comparison shows null match score separately from confirmed grade', () => {
  const candidate = row({ verifiedGrade: 'Junior' });
  const evaluation = evaluateMatch({ specialization: 'Backend / Python', grade: 'Senior', requiredSkills: ['Python'], desirableSkills: [], workFormat: 'Удалённо', salaryMin: 100000, salaryMax: 200000, salaryPeriod: 'month', salaryType: 'gross' }, candidate, false, now);
  const projected = selectionCandidate(candidate, [candidate], evaluation);
  assert.equal(projected.verifiedGrade, 'Junior');
  assert.equal(projected.match?.eligible, false);
  assert.equal(projected.match?.score, null);
});

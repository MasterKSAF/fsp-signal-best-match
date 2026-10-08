// Business labels are authored here before any scorer, qualification or ranker import.
import { mkdir, readFile, readdir, writeFile } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { resolve, relative } from 'node:path';
const root = resolve(import.meta.dirname, '..');
const dir = resolve(root, 'docs/validation/correction-01-matching-supplement-20261008');
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
const now = '2026-10-08T12:00:00.000Z';
const backend = 'Backend / Python', frontend = 'Frontend / TypeScript';
const cores = { [backend]: ['python', 'sql', 'backend-engineering'], [frontend]: ['typescript', 'react', 'frontend-engineering'] };
const names = { python: 'Python', sql: 'SQL', 'backend-engineering': 'Backend Engineering', typescript: 'TypeScript', react: 'React', 'frontend-engineering': 'Frontend Engineering' };
const resumes = [], moduleProofs = [], assessmentProofs = [];
const add = (id, alias, patch = {}) => {
  const specialization = patch.specialization ?? backend;
  const row = { userId: id, resumeId: id * 10, resumeRevision: 1, title: `Synthetic CV ${id}`, alias,
    specialization, assumedGrade: 'Middle', stack: cores[specialization].map(s => names[s]), statedSkills: ['Docker'],
    yearsExperience: 3, workFormat: 'Удалённо', salaryMin: 120000, salaryMax: 180000, salaryPeriod: 'month', salaryType: 'gross',
    visibility: 'pseudonymous', consentMatching: true, consentCatalog: true, readyForOffers: true,
    demoMode: true, deletedAt: null, legacyQualification: null, fsp: 'none', ...patch };
  resumes.push(row); return row;
};
const modules = (owner, specialization = backend, level = 'Middle', skillIds = cores[specialization]) => {
  for (const [index, skillId] of skillIds.entries()) moduleProofs.push({ id: owner * 100 + index, userId: owner, attemptId: owner * 100 + index + 500000,
    skillId, level, seed: `correction01-module-${owner}-${skillId}-${level}`, verifiedAt: now, responseModel: 'all-authoritative-wire-responses' });
};
add(1001, 'B Current strong'); modules(1001);
add(1002, 'A Current peer'); modules(1002);
add(1003, 'Z Current Demo FSP', { fsp: 'trusted-demo-win' }); modules(1003);
add(1004, '0 Senior category', { assumedGrade: 'Senior', fsp: 'trusted-demo-win' }); modules(1004, backend, 'Senior');
add(1005, 'Incomplete mandatory'); modules(1005, backend, 'Middle', ['python']);
add(1006, 'C Two CV one owner', { stack: ['Docker'], statedSkills: [] });
resumes.push({ ...resumes.at(-1), resumeId: 10061, title: 'Synthetic CV 1006 declared Python', stack: ['Python', 'SQL'], statedSkills: ['Docker'] }); modules(1006);
add(1007, 'D Mixed legacy current', { legacyQualification: { specialization: backend, grade: 'Middle', score: 92, skills: ['Python', 'SQL'],
  assessedAt: '2026-10-01T12:00:00.000Z', gradeChangedAt: null, attemptId: null, limitation: 'Synthetic historical summary: version/criterion source unavailable.' } }); modules(1007, backend, 'Junior');
add(1008, 'Revoked module'); modules(1008);
add(1009, 'A Ordinary ID only', { demoMode: false, fsp: 'id-only' }); modules(1009);
add(1010, 'Private CV', { visibility: 'private' }); modules(1010);
add(1011, 'No matching consent', { consentMatching: false }); modules(1011);
add(1012, 'Deleted CV', { deletedAt: '2026-10-07T12:00:00.000Z' }); modules(1012);
add(1013, 'A Frontend peer', { specialization: frontend }); modules(1013, frontend);
add(1014, 'Z Frontend Demo FSP', { specialization: frontend, fsp: 'trusted-demo-win' }); modules(1014, frontend);
add(1015, 'Frontend undeclared framework', { specialization: frontend, stack: ['TypeScript'], statedSkills: [] }); modules(1015, frontend);
add(1016, 'Other owner no language'); modules(1016, backend, 'Middle', ['sql', 'backend-engineering']);
add(1017, 'Demo ID only', { fsp: 'id-only' }); modules(1017);
add(1018, 'Demo revoked FSP', { fsp: 'revoked-demo-win' }); modules(1018);
for (const spec of [
  { userId: 1020, alias: 'Z Exam stronger', version: 'signal-backend-python-v6', responseModel: 'all-authoritative-wire-responses' },
  { userId: 1021, alias: 'A Exam weaker', version: 'signal-backend-python-v6', responseModel: 'one-noncritical-error' },
  { userId: 1022, alias: 'B Other exam scale', version: 'signal-backend-python-v5', responseModel: 'one-noncritical-error' },
  { userId: 1024, alias: 'Revoked full exam', version: 'signal-backend-python-v6', responseModel: 'all-authoritative-wire-responses' },
]) {
  const row = add(spec.userId, spec.alias, { stack: ['Python', 'SQL'], statedSkills: [] });
  assessmentProofs.push({ id: spec.userId + 800000, userId: spec.userId, resumeId: row.resumeId, resumeRevision: 1,
    programId: 'backend-python', programVersion: spec.version, grade: 'Middle', seed: `correction01-assessment-${spec.userId}`, submittedAt: now,
    responseModel: spec.responseModel, errorFamily: spec.responseModel === 'one-noncritical-error' ? 'incident-diagnosis' : null });
  modules(spec.userId, backend, 'Junior');
}
add(1030, 'B Ordinary peer', { demoMode: false }); modules(1030);
const makeNeed = (id, specialization, demoMode, minimums = {}) => ({ needId: id, specialization, grade: 'Middle',
  requiredSkills: specialization === backend ? ['Python', 'SQL'] : ['TypeScript', 'React'], requiredSkillLevels: minimums,
  desirableSkills: [], workFormat: 'Удалённо', salaryMin: 100000, salaryMax: 200000, salaryPeriod: 'month', salaryType: 'gross', poolDemoMode: demoMode });
const needs = [makeNeed('backend-demo-middle', backend, true), makeNeed('backend-demo-explicit-skill-minimum', backend, true, { python: 'Middle' }),
  makeNeed('frontend-demo-middle', frontend, true), makeNeed('backend-ordinary-middle', backend, false)];
// Expected admission is derived from the stated business contract, not production output.
const admission = {
  'backend-demo-middle': [1001,1002,1003,1004,1006,1007,1017,1018,1020,1021,1022],
  'backend-demo-explicit-skill-minimum': [1001,1002,1003,1004,1006,1017,1018],
  'frontend-demo-middle': [1013,1014],
  'backend-ordinary-middle': [1009,1030],
};
const expectedGrades = Object.fromEntries(resumes.map(row => [row.resumeId, [1005,1008,1015,1016,1024].includes(row.userId) || row.resumeId === 10060 ? null : row.userId === 1004 ? 'Senior' : 'Middle']));
const selected = id => id === 1006 ? 10061 : id * 10;
const labels = { version: 'c03-business-supplement-v1', authoredWithoutEvaluatorImports: true, expectedGrades,
  needLabels: needs.map(need => ({ needId: need.needId, pointwise: [...new Set(resumes.map(row => row.userId))].map(userId => ({ userId,
    eligible: admission[need.needId].includes(userId), relevance: admission[need.needId].includes(userId) ? 3 : 0,
    allowedSelectedResumeIds: admission[need.needId].includes(userId) ? [selected(userId)] : [],
    rationale: admission[need.needId].includes(userId) ? 'One whole CV has the category and requested evidence; visible, consented and in the selected pool.' :
      'At least one category, owner/declaration, explicit skill level, specialization, visibility, consent or pool gate is not met.' })) })),
  ordering: [
    { needId: 'backend-demo-middle', before: 1003, after: 1002, reason: 'Trusted synthetic Demo win changes an otherwise equal current Middle queue.' },
    { needId: 'frontend-demo-middle', before: 1014, after: 1013, reason: 'Equal Frontend Middle module receipts: trusted Demo win gives a category-local preference.' },
    { needId: 'backend-demo-middle', before: 1020, after: 1021, reason: 'Same program/version/rubric: full correct result is stronger than one noncritical error.' },
    { needId: 'backend-demo-middle', before: 1022, after: 1020, reason: 'Different version queues use neutral identity for heads; the raw scores cannot be compared across scales.' },
    { needId: 'backend-demo-middle', before: 1021, after: 1007, reason: 'Complete linked evidence precedes unknown historical strength at equal fit.' },
  ],
  ablation: [
    { needId: 'backend-demo-middle', withFspBefore: 1003, withFspAfter: 1002, withoutFspBefore: 1002, withoutFspAfter: 1003, sameCategory: true },
    { needId: 'frontend-demo-middle', withFspBefore: 1014, withFspAfter: 1013, withoutFspBefore: 1013, withoutFspAfter: 1014, sameCategory: true },
  ],
  comparison: { comparable: [1020,1021], incomparable: [1020,1022], modularUnknownOverall: [1001,1002,1003], legacyUnknownOverall: [1007] },
  expectedBonus: { 1003: 3, 1004: 3, 1014: 3, 1009: 0, 1017: 0, 1018: 0 },
  categoryIsolation: { needId: 'backend-demo-middle', userId: 1004, unchangedCategoryBlockWithAblation: true },
  catalogLabels: [
    { id: 'backend-demo-qualified-middle', demoMode: true, filters: { specialization: backend, grade: 'Middle', skills: ['Python','SQL'], workFormat: 'Удалённо' }, expectedPeople: [1001,1002,1003,1006,1007,1011,1017,1018,1020,1021,1022], selectedResume: { 1006: 10061 } },
    { id: 'frontend-demo-qualified-middle', demoMode: true, filters: { specialization: frontend, grade: 'Middle', skills: ['TypeScript','React'] }, expectedPeople: [1013,1014], selectedResume: {} },
    { id: 'backend-ordinary-qualified-middle', demoMode: false, filters: { specialization: backend, grade: 'Middle', skills: ['Python','SQL'] }, expectedPeople: [1009,1030], selectedResume: {} },
  ] };
const rubric = { version: 'c03-supplement-rubric-v1', synthetic: true, exposure: 'Author read the audit and production contracts. Preregistered synthetic scenario validation; not a blind human holdout.',
  purpose: 'Cover actual evidence-to-CV category projection, scope, whole-CV selection, structural proof comparability and a nonzero trusted Demo-FSP ablation.',
  proofConstruction: 'Synthetic fixtures only. Current module receipts and saved full exams are built with authoritative wire answers and scored; business admission/order labels above are fixed before importing those functions.',
  noManualFinalGrade: true, productionWeightOrThresholdTuning: false, metrics: { k: [3,5], relevance: '3 for admissible compatible fit; 0 otherwise', positiveThreshold: 2, gain: '2^relevance-1', discount: '1/log2(rank+1)' },
  limits: ['No real people, hiring outcomes, human difficulty calibration, semantic job understanding or external FSP registry are measured.',
    'All category/profile/evidence sources are synthetic and stateless; demo FSP is explicitly fictional.',
    'Module scores are not a comparable overall category score; qualification strength is compared only for linked full exams of the same program/version/rubric.',
    'Historical full-exam construction validates read compatibility; it does not authorize production issuance of retired programs.',
    'Pointwise relevance is intentionally uniform for admitted compatible profiles, so nDCG does not independently validate fine ordering; preregistered pair and ablation assertions do.',
    'Injected fixture reads exercise production projection and metadata linkage, not PostgreSQL execution, HTTP latency or real ACL races.'] };
const dataset = { version: 'c03-matching-supplement-v1', now, resumes, moduleProofs, assessmentProofs,
  revokedModuleEvidenceIds: [1008 * 100 + 1], correctedAssessmentAttemptIds: [1024 + 800000], needs };
await mkdir(dir, { recursive: true });
const files = {};
for (const [name,value] of Object.entries({dataset,labels,rubric})) {
  const bytes = JSON.stringify(value,null,2)+'\n'; await writeFile(resolve(dir,`${name}.json`),bytes,{flag:'wx'}); files[name]=sha(bytes);
}
const preserved = {};
for (const relativeDir of ['docs/validation/modular-matching-a10-20261008','outputs/verification/full-audit-a01-a11-20261008/matching']) {
  const walk = async absolute => { for (const entry of await readdir(absolute,{withFileTypes:true})) { const path = resolve(absolute,entry.name); if(entry.isDirectory()) await walk(path); else preserved[relative(root,path).replaceAll('\\','/')]=sha(await readFile(path)); } };
  await walk(resolve(root,relativeDir));
}
const freeze = { frozenAt: new Date().toISOString(), beforeFirstEvaluatorInvocation: true, files, preservation: preserved,
  counts: { people: new Set(resumes.map(row=>row.userId)).size, resumes: resumes.length, moduleProofs: moduleProofs.length, assessmentProofs: assessmentProofs.length, needs: needs.length, labels: labels.needLabels.reduce((sum,row)=>sum+row.pointwise.length,0) } };
await writeFile(resolve(dir,'freeze.json'),JSON.stringify(freeze,null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({directory:dir,freeze,labelsSha256:files.labels}));

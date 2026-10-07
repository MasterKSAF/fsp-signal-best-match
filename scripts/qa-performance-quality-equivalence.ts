/** Rerun immutable controls after a pure normalization optimization; no DB/HTTP. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile } from 'node:fs/promises';
import { runCompetitiveMatchingQuality } from '../artifacts/api-server/src/lib/matching-competitive-quality';
import { runIntergroupControl } from './evaluate-intergroup-control';
import { runTraceabilityRegression } from './evaluate-traceability-regression';

const sha = (bytes: Buffer | string) => createHash('sha256').update(bytes).digest('hex');
// Preserve all outcomes and fixed/history metadata. Only the newly measured
// timestamp and the executing Node version can differ in an equivalent rerun.
function outcome(value: any): any {
  if (Array.isArray(value)) return value.map(outcome);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value)
    .filter(([key]) => key !== 'measurementAt')
    .map(([key, item]) => [key, key === 'environment' && item && typeof item === 'object'
      ? outcome(Object.fromEntries(Object.entries(item).filter(([field]) => field !== 'node')))
      : outcome(item)]));
  return value;
}
const runs = [
  { name: 'competitive', path: 'outputs/quality/matching-competitive-v2-report.json', run: runCompetitiveMatchingQuality },
  { name: 'intergroup', path: 'outputs/quality/qa-cycle-01/intergroup-control-v1-report.json', run: runIntergroupControl },
  { name: 'traceability', path: 'outputs/quality/qa-cycle-01/traceability-regression-v1-report.json', run: runTraceabilityRegression },
];
const controls = [];
for (const test of runs) {
  const bytes = await readFile(test.path), original = JSON.parse(bytes.toString('utf8')), current = test.run();
  assert.deepEqual(outcome(current), outcome(original), `${test.name}: exact outcomes/metadata differ`);
  assert.equal(sha(await readFile(test.path)), sha(bytes), 'Original report was rewritten');
  controls.push({ name: test.name, originalReportPath: test.path, originalReportSha256: sha(bytes),
    recomputedAt: current.measurementAt, exactOutcomeSha256: sha(JSON.stringify(outcome(current))),
    algorithmSha256: current.algorithmSha256, datasetSha256: current.datasetSha256, passed: true });
}
const sourcePaths = ['artifacts/api-server/src/lib/signal-matching.ts','artifacts/api-server/src/lib/skill-catalog.ts',
  'artifacts/api-server/src/lib/matching-pool-admission.ts','artifacts/api-server/src/lib/assessment-ranking-evidence.ts',
  'artifacts/api-server/src/routes/signal-employer-matching.ts'];
const sourceHashes = Object.fromEntries(await Promise.all(sourcePaths.map(async path => [path, sha(await readFile(path))])));
const report = { schemaVersion: 'signal-performance-quality-equivalence-v1', passed: true, checkedAt: new Date().toISOString(),
  scope: 'Actual pure-function rerun with the new catalog dependency; all frozen outcomes and metadata equal apart from measurementAt and executing Node version. No old timestamps or report bytes relabelled.',
  controls, sourceHashes, publicAggregateSha256: sha(await readFile('artifacts/api-server/src/lib/quality-public-report.json')),
  databaseUsed: false, httpUsed: false, originalReportsUnchanged: true,
  limits: ['The public algorithm hash identifies signal-matching.ts; the changed pure normalization dependency is explicitly identified here.',
    'The admission helper is covered by its own regression and targeted HTTP retest; these controls directly call the unchanged final matcher.',
    'Used synthetic controls remain regression; no new holdout or human measurement claim.'] };
await writeFile('outputs/verification/qa-cycle-04-quality-equivalence.json', JSON.stringify(report, null, 2)+'\n');
console.log(JSON.stringify({ passed: true, controls: controls.length, sourceHashes, originalReportsUnchanged: true }));

/** Reproduce current v6 measurements while retaining every historical loss. */
import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { runIntergroupControl } from './evaluate-intergroup-control';
import { runTraceabilityRegression } from './evaluate-traceability-regression';
import { runCompetitiveMatchingQuality } from '../artifacts/api-server/src/lib/matching-competitive-quality';
import { MATCH_ALGORITHM_VERSION } from '../artifacts/api-server/src/lib/signal-matching';
const sha = (data: Buffer) => createHash('sha256').update(data).digest('hex');
const metadata = JSON.parse(await readFile('RELEASE-METADATA.json', 'utf8'));
assert.equal(metadata.applicationVersion, '0.6.0');
const currentSha = sha(await readFile('artifacts/api-server/src/lib/signal-matching.ts'));
assert.equal(currentSha, metadata.matchingAlgorithmSha256);
assert.equal(MATCH_ALGORITHM_VERSION, metadata.matchingAlgorithmVersion);
async function baseline(name: 'policyQuality' | 'traceabilityDelta') {
  const item = metadata.offlineBaselines?.[name];
  assert.ok(item && metadata.publicProofInputs.some((proof: any) => proof.path === item.path && proof.sha256 === item.sha256));
  assert.match(item.path, /^outputs\/quality\/0\.6\.0\/fsp-category\/[a-z0-9-]+\.json$/);
  const bytes = await readFile(item.path); assert.equal(sha(bytes), item.sha256);
  const result = JSON.parse(bytes.toString('utf8')); assert.equal(result.applicationVersion, '0.6.0');
  assert.equal(name === 'policyQuality' ? result.sourceHashes['artifacts/api-server/src/lib/signal-matching.ts'] : result.algorithmSha256, currentSha);
  if (name === 'policyQuality') for (const [path, hash] of Object.entries(result.sourceHashes)) assert.equal(sha(await readFile(path)), hash, 'Exact measured policy source drifted');
  return { item, result };
}
const quality = await baseline('policyQuality'), traceability = await baseline('traceabilityDelta');
const intergroup = runIntergroupControl(), competitive = runCompetitiveMatchingQuality(), trace = runTraceabilityRegression();
for (const [actual, frozen] of [[intergroup, quality.result.intergroup.fullAfter], [competitive, quality.result.competitive.fullAfter]] as const) {
  assert.equal(actual.algorithmVersion, MATCH_ALGORITHM_VERSION); assert.equal(actual.algorithmSha256, currentSha);
  assert.deepEqual(actual.summary, frozen.summary); assert.deepEqual(actual.byQuery, frozen.byQuery);
}
assert.deepEqual(intergroup.metamorphic, quality.result.intergroup.fullAfter.metamorphic);
assert.deepEqual(trace.checks, traceability.result.checks);
assert.deepEqual(trace.originalCases, traceability.result.originalCases); assert.deepEqual(trace.newCases, traceability.result.newCases);
assert.equal(trace.datasetSha256, traceability.result.datasetSha256); assert.equal(trace.boundaryDatasetSha256, traceability.result.boundaryDatasetSha256);
const report = { schemaVersion: 1, applicationVersion: '0.6.0', passed: true, generatedAt: new Date().toISOString(),
  algorithmVersion: MATCH_ALGORITHM_VERSION, algorithmSha256: currentSha,
  baselines: { policyQuality: quality.item, traceabilityDelta: traceability.item },
  checks: { currentPolicy: true, intergroupExact: true, competitiveExact: true, traceabilityExactIncludingHistoricalFalse: true, datasetsUnchanged: true },
  lossesRetained: { intergroup: quality.result.intergroup.losses.length, competitive: quality.result.competitive.losses.length,
    historicalTraceabilityFalse: Object.entries(trace.checks).filter(([, value]) => value === false).map(([name]) => name) },
  scope: 'Pure synthetic current-policy reproduction from exact sealed inputs; no labels changed, no old losses promoted to PASS, no HTTP/load/human validation claim.' };
await mkdir('outputs/release-0.6.0/offline', { recursive: true });
await writeFile('outputs/release-0.6.0/offline/reproduction.json', JSON.stringify(report, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, checks: Object.keys(report.checks).length, lossesRetained: report.lossesRetained }));

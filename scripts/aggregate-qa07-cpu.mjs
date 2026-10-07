import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';

const proofPath = 'outputs/verification/qa07-cpu-warmup.json';
const proofBytes = fs.readFileSync(proofPath);
const proof = JSON.parse(proofBytes);
assert.equal(proof.passed, true);
assert.match(proof.rawProfile.path, /^outputs\/local-backup\/qa07-cpu-[a-f0-9]{8}\.cpuprofile$/);
const rawBytes = fs.readFileSync(proof.rawProfile.path);
const sha = bytes => createHash('sha256').update(bytes).digest('hex');
assert.equal(sha(rawBytes), proof.rawProfile.sha256);
assert.ok(proof.disabledBeforeNominalWarmupEndMilliseconds >= 2000);
const profile = JSON.parse(rawBytes);
const nodes = new Map(profile.nodes.map(node => [node.id, node]));
const parents = new Map();
for (const node of profile.nodes) for (const child of node.children || []) parents.set(child, node.id);
const frameKey = id => {
  const frame = nodes.get(id).callFrame;
  return JSON.stringify([frame.functionName || '(anonymous)', frame.url.startsWith('node:') ? frame.url : path.basename(frame.url) || '(native)', frame.lineNumber + 1, frame.columnNumber + 1]);
};
const exclusive = new Map(), inclusive = new Map();
let total = 0;
for (let index = 0; index < profile.samples.length; index++) {
  const elapsed = profile.timeDeltas[index];
  const sample = profile.samples[index];
  assert.ok(Number.isFinite(elapsed) && elapsed >= 0 && nodes.has(sample));
  total += elapsed;
  const frame = frameKey(sample);
  exclusive.set(frame, (exclusive.get(frame) || 0) + elapsed);
  // The same frame can occur at different call sites or recursively. Count its
  // inclusive contribution only once per sample, avoiding recursive inflation.
  const framesSeen = new Set(), idsSeen = new Set();
  for (let id = sample; id !== undefined; id = parents.get(id)) {
    assert.ok(!idsSeen.has(id), 'CPU call tree must be acyclic');
    idsSeen.add(id);
    const key = frameKey(id);
    if (!framesSeen.has(key)) {
      inclusive.set(key, (inclusive.get(key) || 0) + elapsed);
      framesSeen.add(key);
    }
  }
}
assert.equal([...exclusive.values()].reduce((sum, value) => sum + value, 0), total);
assert.equal(total, proof.totalSampleMicroseconds);
assert.equal(profile.samples.length, proof.sampleCount);
assert.ok([...inclusive.values()].every(value => value <= total));
const rows = values => [...values].sort((a, b) => b[1] - a[1]).map(([key, elapsed]) => {
  const [functionName, script, line, column] = JSON.parse(key);
  return { functionName, script, line, column, milliseconds: elapsed / 1000, fraction: elapsed / total };
});
const measuredFunctions = new Set(['normalized', 'formatFits', 'evaluateMatch', 'rankedNeedPool', 'rankMatches', 'assessmentRubricKey', 'withAssessmentRankingEvidence', 'canonicalSkillKey', 'renderCandidateResumePdf']);
const summary = {
  version: 'signal-qa07-cpu-frame-aggregation-v1', measuredAt: new Date().toISOString(), passed: true,
  cpuProof: { path: proofPath, sha256: sha(proofBytes) },
  apiImageId: proof.apiImageId, fixtureHash: proof.fixtureHash, loadScriptHash: proof.loadScriptHash,
  rawProfile: proof.rawProfile, sampleCount: profile.samples.length, totalSampleMicroseconds: total,
  disabledBeforeNominalWarmupEndMilliseconds: proof.disabledBeforeNominalWarmupEndMilliseconds,
  aggregation: 'All sampled call-site nodes grouped by exact function/script/line/column; inclusive frames deduplicated within each sampled stack',
  exclusiveByFrame: rows(exclusive).slice(0, 30),
  relevantInclusiveByFrame: rows(inclusive).filter(row => measuredFunctions.has(row.functionName)),
  accountingChecks: ['Exclusive frame sum equals total sampled duration', 'Inclusive frame never exceeds total', 'Sample count/duration/raw SHA agree with captured CPU proof', 'Profiler disabled at least2seconds before unprofiled measurement'],
  limitations: ['Inclusive rows overlap and must not be summed.', 'Warmup CPU subtree samples do not measure DB-query elapsed time or production capacity.', 'No historical CPU sampler exists for a direct before/after function comparison.'],
  rawSourceOrProfileCandidateDataExported: false,
};
fs.writeFileSync('outputs/verification/qa07-cpu-hotspots.json', JSON.stringify(summary, null, 2) + '\n');
console.log(JSON.stringify({ passed: true, report: 'outputs/verification/qa07-cpu-hotspots.json', relevantInclusiveByFrame: summary.relevantInclusiveByFrame, topExclusive: summary.exclusiveByFrame.slice(0, 5) }));

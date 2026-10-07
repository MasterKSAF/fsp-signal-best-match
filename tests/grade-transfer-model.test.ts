import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { modelSourceMechanismTransfer, transferModelVersion, type TransferInput } from '../scripts/lib/grade-transfer-model';

const sha = (value: string | Buffer) => createHash('sha256').update(value).digest('hex');
const fixturePath = 'docs/validation/transfer-model-regression-v1.json';
const manifest = JSON.parse(readFileSync('docs/validation/transfer-model-regression-v1-manifest.json', 'utf8'));
const fixtures = JSON.parse(readFileSync(fixturePath, 'utf8'));
assert.equal(sha(readFileSync(fixturePath)), manifest.files[fixturePath], 'Frozen expectations must not be blessed after model changes.');
const correctionFixturePath = 'docs/validation/transfer-model-regression-v2.json';
const correctionManifest = JSON.parse(readFileSync('docs/validation/transfer-model-regression-v2-manifest.json', 'utf8'));
const corrections = JSON.parse(readFileSync(correctionFixturePath, 'utf8'));
for (const [path, hash] of Object.entries(correctionManifest.files)) assert.equal(sha(readFileSync(path)), hash, 'Do not overwrite pre-correction expectations.');
const exactFixturePath = 'docs/validation/transfer-model-regression-v3.json';
const exactManifest = JSON.parse(readFileSync('docs/validation/transfer-model-regression-v3-manifest.json', 'utf8'));
const exactCorrections = JSON.parse(readFileSync(exactFixturePath, 'utf8'));
for (const [path, hash] of Object.entries(exactManifest.files)) assert.equal(sha(readFileSync(path)), hash, 'Preserve historical fixture bytes when bounding model syntax.');
type Fixture = TransferInput & { id: string; expected: { status: 'evaluated' | 'not_evaluated'; answer: string | null; reasonContains: string | null; recognizedCallCount: number } };

const currentFixtures = [...fixtures.cases, ...corrections.cases, ...exactCorrections.cases].map((fixture: Fixture) => ({ ...fixture, expected: exactCorrections.policyOverrides[fixture.id] ?? fixture.expected })) as Fixture[];
for (const fixture of currentFixtures) test(`source transfer independent regression: ${fixture.id}`, () => {
  const result = modelSourceMechanismTransfer(fixture);
  assert.equal(result.status, fixture.expected.status);
  assert.equal(result.answer, fixture.expected.answer);
  assert.equal(result.recognizedCallCount, fixture.expected.recognizedCallCount);
  assert.equal(result.provenance.modelVersion, transferModelVersion);
  assert.equal(result.provenance.sourceId, fixture.sourceId);
  assert.equal(result.provenance.sourcePromptSha256, sha(fixture.sourcePrompt));
  assert.equal(result.provenance.targetPromptSha256, sha(fixture.targetPrompt));
  assert.equal(result.provenance.targetAnswerKeyAccess, false);
  if (fixture.expected.reasonContains) assert.ok(result.reason?.includes(fixture.expected.reasonContains), result.reason ?? 'missing reason');
  if (result.status === 'evaluated') {
    assert.ok(result.answer.length > 0);
    assert.equal(result.trace.length, result.expectedCallCount);
    assert.equal(result.recognizedCallCount, result.expectedCallCount);
    assert.equal(result.answer.split('|').length, result.expectedCallCount);
    assert.ok(result.trace.every(call => call.output.length > 0 && call.decision.length > 0));
  } else {
    assert.equal(result.answer, null);
    assert.equal(result.trace.length, 0);
    assert.ok(result.reason);
  }
});

test('source transfer fixture expectations cover all grade/program combinations and both source-method success and unsupported conditions', () => {
  const cases = fixtures.cases as Fixture[];
  for (const programId of ['backend-python', 'frontend-typescript']) for (const grade of ['Junior', 'Middle', 'Senior']) {
    assert.ok(cases.some(item => item.programId === programId && item.grade === grade && item.expected.status === 'evaluated'));
  }
  assert.ok(cases.filter(item => item.expected.status === 'not_evaluated').length >= 6);
  assert.ok(cases.filter(item => item.strategy === 'same-template').length >= 4);
});

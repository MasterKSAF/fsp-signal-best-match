import assert from 'node:assert/strict';
import test from 'node:test';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { assertBankAttested, bankContentHash, bankCheckerFiles, buildBankBundle, canonicalBankJson, SkillBankNotAttestedError, type BankBundle } from '../artifacts/api-server/src/lib/skill-bank-manifest';
import { buildSkillAttempt } from '../artifacts/api-server/src/lib/skill-module-bank';
import { replaySkillSnapshot } from '../artifacts/api-server/src/lib/skill-bank-replay';

function testAttested(bundle: BankBundle): BankBundle {
  const checks = JSON.parse(readFileSync('artifacts/api-server/src/data/skill-bank-attestation.json', 'utf8')).checks;
  return { ...bundle, attestation: { schema: 1, manifestHash: bundle.manifestHash, checkerVersion: 'signal-bank-checker-v1', checkerHash: bundle.checkerHash, checks, passed: true } };
}
test('S01 deterministic manifest contains transitive oracle/helper/rubric/matrix files', () => {
  assert.equal(canonicalBankJson({ z: 1, a: { b: 2, a: 1 } }), canonicalBankJson({ a: { a: 1, b: 2 }, z: 1 }));
  const a = buildBankBundle(); const b = buildBankBundle();
  assert.equal(a.manifestHash, b.manifestHash);
  for (const file of ['skill-middle-outcomes.ts', 'skill-senior-outcomes.ts', 'skill-junior-reviewed-choices-v6.ts', 'skill-bank-availability.ts', 'skill-module-qualification.ts']) assert.ok(a.manifest.files.some(f => f.path.endsWith(file)), file);
  assertBankAttested(testAttested(a));
  assert.throws(() => assertBankAttested({ ...a, attestation: null }), SkillBankNotAttestedError);
  const good = testAttested(a);
  assert.throws(() => assertBankAttested({ ...good, attestation: { ...good.attestation!, checks: good.attestation!.checks.slice(1) } }), SkillBankNotAttestedError);
  assert.throws(() => assertBankAttested({ ...good, attestation: { ...good.attestation!, checks: [...good.attestation!.checks, good.attestation!.checks[0]!] } }), SkillBankNotAttestedError);
});
test('S01 editing a real generator, rubric, shared helper or checker invalidates an old attestation', () => {
  const original = buildBankBundle();
  const temp = mkdtempSync(path.join(tmpdir(), 'signal-bank-manifest-'));
  try {
    const files = { ...original.sources, ...Object.fromEntries(bankCheckerFiles.map(p => [p, readFileSync(p, 'utf8')])) };
    for (const [file, source] of Object.entries(files)) { const target = path.join(temp, file); mkdirSync(path.dirname(target), { recursive: true }); writeFileSync(target, source); }
    const attested = testAttested(buildBankBundle(temp));
    const attestationFile = path.join(temp, 'artifacts/api-server/src/data/skill-bank-attestation.json');
    mkdirSync(path.dirname(attestationFile), { recursive: true }); writeFileSync(attestationFile, JSON.stringify(attested.attestation));
    for (const file of ['artifacts/api-server/src/lib/skill-module-bank.ts', 'artifacts/api-server/src/lib/skill-middle-outcomes.ts', 'artifacts/api-server/src/lib/skill-bank-availability.ts', 'artifacts/api-server/src/lib/skill-bank-checker.ts']) {
      const target = path.join(temp, file); const originalSource = readFileSync(target, 'utf8');
      writeFileSync(target, `${originalSource}\n// regression mutation\n`);
      assert.throws(() => assertBankAttested(buildBankBundle(temp)), SkillBankNotAttestedError, file);
      writeFileSync(target, originalSource);
      assertBankAttested(buildBankBundle(temp));
    }
    assert.throws(() => assertBankAttested({ ...attested, attestation: { ...attested.attestation!, passed: false } }), SkillBankNotAttestedError);
  } finally { rmSync(temp, { recursive: true, force: true }); }
});
test('S01 saved snapshot replays after current bank changes and legacy stays explicitly legacy', () => {
  const form = buildSkillAttempt('python', 'Middle', 'historical-replay');
  const answers = Object.fromEntries(Object.entries(form.oracles).map(([id, o]) => [id, o.expected]));
  const snapshot = { ...form, answers, provenance: { status: 'complete' as const, releaseId: 'old-release', contentHash: 'old-content', attestationHash: 'old-check', seed: 'historical-replay', variantHash: bankContentHash(form) } };
  snapshot.provenance.variantHash = bankContentHash({ cases: form.cases, oracles: form.oracles, policy: form.policy });
  assert.equal(replaySkillSnapshot(snapshot).decision.passed, true);
  assert.equal(replaySkillSnapshot({ ...snapshot, provenance: null }).provenanceStatus, 'legacy_snapshot');
  const altered = structuredClone(snapshot); altered.oracles.q1.expected += '-mutated';
  assert.throws(() => replaySkillSnapshot(altered), /integrity/);
});

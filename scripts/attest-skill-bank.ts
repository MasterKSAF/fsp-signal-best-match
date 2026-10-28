import { spawnSync } from 'node:child_process';
import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { bankCheckerFiles, buildBankBundle, findBankRepository, type BankAttestation } from '../artifacts/api-server/src/lib/skill-bank-manifest';
import { checkBankContent } from '../artifacts/api-server/src/lib/skill-bank-checker';

const root = findBankRepository();
const before = buildBankBundle(root);
const checks = await checkBankContent();
// These existing regressions include independently handwritten outcomes and boundary examples.
const testFiles = bankCheckerFiles.filter(p => p.startsWith('tests/'));
const regressions = spawnSync(process.execPath, ['--import', 'tsx', '--test', ...testFiles], { cwd: root, encoding: 'utf8', timeout: 120_000, maxBuffer: 3_000_000 });
checks.push({ id: 'handwritten-outcomes-and-historical-bank-regressions', passed: regressions.status === 0, checked: testFiles.length });
const after = buildBankBundle(root);
if (before.manifestHash !== after.manifestHash || before.checkerHash !== after.checkerHash) throw new Error('Bank changed during validation; no attestation written.');
const attestation: BankAttestation = { schema: 1, manifestHash: after.manifestHash, checkerVersion: 'signal-bank-checker-v1', checkerHash: after.checkerHash, checks, passed: checks.every(c => c.passed && c.checked > 0) };
if (!attestation.passed) {
  console.error(JSON.stringify({ passed: false, checks, regressions: regressions.status ? regressions.stdout.slice(-6000) : undefined }));
  process.exitCode = 1;
} else {
  const target = path.join(root, 'artifacts/api-server/src/data/skill-bank-attestation.json');
  mkdirSync(path.dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(attestation, null, 2)}\n`);
  console.info(JSON.stringify({ passed: true, manifestHash: after.manifestHash, checks }));
}

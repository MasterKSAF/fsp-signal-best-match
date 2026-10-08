/** Finite independent regression for Middle coverage; no API, database or human-validation claim. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { buildSkillAttempt, scoreSkillAttempt, skillContentFamilyId, SKILL_BANK_VERSION, SKILL_RUBRIC_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';

const skillIds = ['python', 'sql', 'typescript', 'react', 'backend-engineering', 'frontend-engineering'];
let forms = 0, wrongCriticalBRejections = 0, baseOnlyRejections = 0, crossLevelRotatedCases = 0;
for (const skillId of skillIds) for (let index = 0; index < 20; index++) {
  const seed = `independent-final-middle-${skillId}-${index}`;
  const form = buildSkillAttempt(skillId, 'Middle', seed);
  assert.equal(form.cases.length, 6);
  assert.equal(new Set(form.cases.map(c => c.levelRequirementId)).size, 6);
  const answers = Object.fromEntries(Object.entries(form.oracles).map(([id, oracle]) => [id, oracle.expected]));
  const baseOnly = Object.fromEntries(Object.entries(form.oracles).map(([id, oracle]) => [id, oracle.parts![0]!.expected]));
  assert.equal(scoreSkillAttempt(form.cases, form.oracles, answers, form.policy).passed, true);
  const baseResult = scoreSkillAttempt(form.cases, form.oracles, baseOnly, form.policy);
  assert.equal(baseResult.passed, false); assert.equal(baseResult.criticalComplete, false); baseOnlyRejections++;
  for (const question of form.cases.filter(c => c.critical)) {
    const oracle = form.oracles[question.id]!;
    const invalidB = { ...answers, [question.id]: `${oracle.parts![0]!.expected};__wrong_B__` };
    const decision = scoreSkillAttempt(form.cases, form.oracles, invalidB, form.policy);
    assert.equal(decision.passed, false); assert.equal(decision.criticalComplete, false);
    assert.equal(decision.score, 83); wrongCriticalBRejections++;
  }
  const exposure = new Map(form.cases.map(c => [c.templateId.replace('-v2:', '-v1:').replace(':Middle:', ':Junior:'), 100]));
  const rotated = buildSkillAttempt(skillId, 'Middle', seed, { personalExposures: exposure });
  for (let i = 0; i < 6; i++) {
    assert.notEqual(skillContentFamilyId(rotated.cases[i]!.templateId), skillContentFamilyId(form.cases[i]!.templateId));
    crossLevelRotatedCases++;
  }
  forms++;
}
const sourceFingerprints = Object.fromEntries(await Promise.all(['skill-middle-outcomes.ts', 'skill-module-bank.ts'].map(async name => [name, createHash('sha256').update(await readFile(`artifacts/api-server/src/lib/${name}`)).digest('hex')])));
const report = { status: 'PASS', measuredAt: new Date().toISOString(), bankVersion: SKILL_BANK_VERSION, rubricVersion: SKILL_RUBRIC_VERSION, sourceFingerprints, forms, baseOnlyRejections, wrongCriticalBRejections, crossLevelRotatedCases, limits: 'Pure finite mechanics. Numeric semantics probed separately. This does not validate human difficulty or hiring effectiveness.' };
const output = 'outputs/verification/candidate-workspace-skill-matrix-20261008/skill-independent-middle';
await mkdir(output, { recursive: true });
await writeFile(`${output}/bank-mechanics-final.json`, JSON.stringify(report, null, 2));
console.log(JSON.stringify(report));

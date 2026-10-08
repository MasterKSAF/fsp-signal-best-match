/** Read-only, stateless C04 comparison. Does not import DB or call either live API. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { skillModuleRegistry, skillModuleTemplates, skillScenarioFixture, skillContentFamilyId, SKILL_BANK_VERSION, SENIOR_SKILL_RUBRIC_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
import { historicalSeniorV4RequirementProbe, seniorRequirementProbe } from '../artifacts/api-server/src/lib/skill-senior-outcomes';
import { seniorV5ChangedFamilies } from '../artifacts/api-server/src/lib/skill-senior-corrections-v5';
import { middleRequirementProbe } from '../artifacts/api-server/src/lib/skill-middle-outcomes';
const dir = 'outputs/verification/ui-refinement-correction01-20261008/senior';
const normalize = (s: string) => s.replaceAll('\r\n', '\n');
const hash = (s: string | Buffer) => createHash('sha256').update(s).digest('hex');
const before = normalize(await readFile(`${dir}/skill-senior-outcomes-v4-before.ts.txt`, 'utf8'));
const now = normalize(await readFile('artifacts/api-server/src/lib/skill-senior-outcomes.ts', 'utf8'));
const beforeBody = before.split('export function seniorRequirementProbe')[0]!;
const nowBody = now.replace("import { seniorCorrectionV5 } from './skill-senior-corrections-v5';\n", '').split('/** Private historical fixture only.')[0]!;
assert.equal(nowBody, beforeBody, 'Historical Senior scenario builders must remain byte-exact after newline normalization');
const choicesBefore = await readFile(`${dir}/skill-senior-reviewed-choices-v4-before.ts.txt`);
const choicesNow = await readFile('artifacts/api-server/src/lib/skill-senior-reviewed-choices.ts');
assert.equal(hash(choicesNow), hash(choicesBefore), 'Unmodified authored choice bank changed');
const oldLower = await import(pathToFileURL(resolve('../fsp-signal/artifacts/api-server/src/lib/skill-module-bank.ts')).href);
assert.equal(oldLower.SKILL_BANK_VERSION, 'signal-skills-2026-10-v3');
const records: unknown[] = [], comparisons: unknown[] = [];
let unchangedSenior = 0, changedSenior = 0, lowerExact = 0;
for (const module of skillModuleRegistry) for (let c = 0; c < 6; c++) for (let s = 0; s < 3; s++) {
  const key = `${module.id}:${module.competencies[c]}:s${s + 1}`;
  const template = skillModuleTemplates.find(t => t.skillId === module.id && t.level === 'Senior' && t.competencyIndex === c && t.scenarioIndex === s)!;
  const changed = seniorV5ChangedFamilies.has(key);
  for (let n = 5; n <= 9; n++) for (const flag of [false, true]) {
    const old = historicalSeniorV4RequirementProbe(module.id, c, s, n, flag), current = seniorRequirementProbe(module.id, c, s, n, flag);
    if (changed) { assert.notDeepEqual(current.parts, old.parts); changedSenior++; }
    else { assert.deepEqual(current, old); unchangedSenior++; }
    for (const level of ['Junior', 'Middle'] as const) {
      assert.deepEqual(skillScenarioFixture(module.id, level, c, s, n, flag), oldLower.skillScenarioFixture(module.id, level, c, s, n, flag)); lowerExact++;
    }
    records.push({ family: key, n, flag, changed, original: old, current, oldTemplateFamily: skillContentFamilyId(template.id.replace('-v5:', '-v4:')), currentTemplateFamily: template.contentFamilyId, templateVersion: template.version });
  }
  if (changed) comparisons.push({ family: key, oldTemplateId: template.id.replace('-v5:', '-v4:'), newTemplateId: template.id, newContentFamily: template.contentFamilyId, templateVersion: template.version, middle: middleRequirementProbe(module.id, c, s, 5, true), oldSenior: historicalSeniorV4RequirementProbe(module.id, c, s, 5, true), newSenior: seniorRequirementProbe(module.id, c, s, 5, true) });
}
assert.equal(changedSenior, 50); assert.equal(unchangedSenior, 1030); assert.equal(lowerExact, 2160); assert.equal(comparisons.length, 5);
const sourceFiles = [
  'artifacts/api-server/src/lib/skill-module-bank.ts', 'artifacts/api-server/src/lib/skill-module-qualification.ts',
  'artifacts/api-server/src/lib/skill-senior-outcomes.ts', 'artifacts/api-server/src/lib/skill-senior-reviewed-choices.ts',
  'artifacts/api-server/src/lib/skill-senior-corrections-v5.ts', 'tests/skill-senior-correction01.test.ts',
];
const source = await Promise.all(sourceFiles.map(async path => ({ path, sha256: hash(await readFile(path)) })));
await mkdir(dir, { recursive: true });
await writeFile(`${dir}/paired-comparison.json`, JSON.stringify({ passed: true, bankVersion: SKILL_BANK_VERSION, rubricVersion: SENIOR_SKILL_RUBRIC_VERSION, matrixVersion: 'signal-category-competency-matrix-v2', counts: { changedFamilies: 5, changedSeniorVariants: changedSenior, unchangedSeniorVariants: unchangedSenior, exactLowerVariants: lowerExact }, historicalBuilderSourcePreserved: true, historicalReviewedChoicesSha: hash(choicesNow), source, comparisons, records, measuredAt: new Date().toISOString(), limitations: ['Stateless operator comparison only; no DB, snapshots or live users modified.', 'Semantic reference executions are in skill-senior-correction01.test.ts; they are not empirical professional calibration.'] }, null, 2));
console.log(JSON.stringify({ passed: true, changedFamilies: 5, unchangedSeniorVariants: unchangedSenior, exactLowerVariants: lowerExact, receipt: `${dir}/paired-comparison.json` }));

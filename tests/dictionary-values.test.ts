import { test } from 'node:test';
import assert from 'node:assert/strict';
import { addDictionaryValues, exactDictionaryOption } from '../artifacts/fsp-signal/src/lib/professional-dictionaries';
import { SKILL_CATALOG, canonicalSkillKey } from '../artifacts/api-server/src/lib/skill-catalog';
const options = SKILL_CATALOG.map(skill => ({ id: skill.id, value: skill.label, aliases: skill.aliases }));
test('managed aliases preserve server canonical identity without a fuzzy proof', () => {
  for (const skill of SKILL_CATALOG) for (const alias of [skill.id, skill.label, ...skill.aliases]) {
    const selected = exactDictionaryOption(options, ` ${alias.toUpperCase()} `)!;
    assert.equal(canonicalSkillKey(selected.value), canonicalSkillKey(alias));
  }
  assert.equal(exactDictionaryOption(options, 'PostgreSQL optimized'), undefined);
});
test('custom skills persist with raw identity; similar skill names remain distinct', () => {
  const result = addDictionaryValues(['sql', ' SQL ', 'PostgreSQL'], ['java', 'JavaScript', '  Open  telemetry ', 'open telemetry'], options);
  assert.deepEqual(result, ['SQL', 'PostgreSQL', 'java', 'JavaScript', 'Open telemetry']);
  assert.equal(canonicalSkillKey(result[2]), 'raw:java');
  assert.notEqual(canonicalSkillKey(result[0]), canonicalSkillKey(result[1]));
  assert.notEqual(canonicalSkillKey(result[2]), canonicalSkillKey(result[3]));
});
test('pasted duplicates are canonicalized conservatively and limited without changing old order', () => {
  assert.deepEqual(addDictionaryValues(['py'], ['Python', 'postgres', 'PostgreSQL', 'React'], options, 2), ['Python', 'PostgreSQL']);
  assert.deepEqual(addDictionaryValues([], [' ', 'Data lake'], options), ['Data lake']);
});

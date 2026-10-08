import assert from 'node:assert/strict';
import test from 'node:test';
import { compactJuniorUiDistractorsV6 } from '../artifacts/api-server/src/lib/skill-junior-ui-contrast-choices-v6';
import { juniorReviewedChoicesV6 } from '../artifacts/api-server/src/lib/skill-junior-reviewed-choices-v6';
import { skillBaseScenarioFixture } from '../artifacts/api-server/src/lib/skill-module-bank';

test('UI/TypeScript compact counterplans cover only all 27 Junior choice families and never repeat the current correct text', () => {
  const families = new Set<string>();
  let variants = 0;
  for (const skill of ['typescript', 'react', 'frontend-engineering']) {
    for (let c = 0; c < 6; c++) for (let s = 0; s < 3; s++) {
      for (let n = 5; n <= 9; n++) for (const flag of [false, true]) {
        const base = skillBaseScenarioFixture(skill, 'Junior', c, s, n, flag);
        const compact = compactJuniorUiDistractorsV6(skill, c, s, n, flag);
        if (!base.options) { assert.equal(compact, null); continue; }
        families.add(`${skill}/${c}/${s}`); variants++;
        assert.ok(compact, `${skill}/${c}/${s}`);
        assert.equal(compact.length, 3);
        assert.equal(new Set(compact).size, 3);
        assert.ok(compact.every(value => value.trim().length > 0));
        const correctIndex = base.options.indexOf(base.answer);
        const correct = juniorReviewedChoicesV6(skill, c, s, n, flag)![correctIndex];
        assert.ok(compact.every(value => value !== correct));
        compact.reverse();
        assert.notDeepEqual(compact, compactJuniorUiDistractorsV6(skill, c, s, n, flag));
      }
    }
  }
  assert.equal(families.size, 27);
  assert.equal(variants, 270);
  assert.equal(compactJuniorUiDistractorsV6('sql', 5, 2, 5, true), null);
});

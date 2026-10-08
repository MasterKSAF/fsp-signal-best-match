import assert from 'node:assert/strict';
import test from 'node:test';
import { juniorSqlPythonProtocolChoicesV6 } from '../artifacts/api-server/src/lib/skill-junior-sql-python-protocol-choices-v6';
import { skillBaseScenarioFixture } from '../artifacts/api-server/src/lib/skill-module-bank';

const families: readonly [string, number, number][] = [
  ['python', 4, 2], ['python', 5, 2],
  ['sql', 3, 1], ['sql', 3, 2], ['sql', 5, 0], ['sql', 5, 1], ['sql', 5, 2],
];

test('SQL/Python protocols cover exactly the seven current MCQ families and both actual branches', () => {
  let covered = 0;
  for (const skill of ['python', 'sql']) for (let c = 0; c < 6; c++) for (let s = 0; s < 3; s++) {
    const owned = families.some(([id, ci, si]) => skill === id && c === ci && s === si);
    for (let n = 5; n <= 9; n++) for (const flag of [false, true]) {
      const options = juniorSqlPythonProtocolChoicesV6(skill, c, s, n, flag);
      if (!owned) { assert.equal(options, null); continue; }
      covered++;
      assert.ok(options);
      assert.equal(options.length, 4);
      assert.equal(new Set(options).size, 4);
      const labels = options.map(value => value.split('; ').map(field => field.slice(0, field.indexOf(':'))));
      assert.equal(labels[0].length, 3);
      for (const labelsOfOption of labels) assert.deepEqual(labelsOfOption, labels[0]);
      const junior = skillBaseScenarioFixture(skill, 'Junior', c, s, n, flag);
      const middle = skillBaseScenarioFixture(skill, 'Middle', c, s, n, flag);
      assert.ok(junior.options);
      assert.deepEqual(middle.options, junior.options, 'Middle A reuse must retain the exact historical equality gate');
      assert.equal(middle.answer, junior.answer);
      options[0] = 'caller-owned mutation';
      assert.notEqual(juniorSqlPythonProtocolChoicesV6(skill, c, s, n, flag)![0], options[0]);
    }
  }
  assert.equal(covered, 70);
  assert.equal(juniorSqlPythonProtocolChoicesV6('react', 4, 2, 5, true), null);
});

test('CAS actual outcome interpolates the requested revision, without turning the non-CAS branch into a protected write', () => {
  for (let n = 5; n <= 9; n++) {
    const cas = juniorSqlPythonProtocolChoicesV6('sql', 3, 1, n, true)!;
    assert.ok(cas.every(value => value.includes(`WHERE revision=${n}`)));
    assert.match(cas[0], /rowcount=0.*409/);
    const unsafe = juniorSqlPythonProtocolChoicesV6('sql', 3, 1, n, false)![0];
    assert.match(unsafe, /revision не участвует в WHERE.*затереть первое.*CAS/);
  }
});

import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import * as current from '../artifacts/api-server/src/lib/skill-catalog';
import * as frozen from '../outputs/verification/history/qa-cycle-01-before-traceability/artifacts/api-server/src/lib/skill-catalog';

const frozenUrl = new URL('../outputs/verification/history/qa-cycle-01-before-traceability/artifacts/api-server/src/lib/skill-catalog.ts', import.meta.url);
const frozenSha256 = '8d7b0ffede249af975713581771d188ae520b8f803c7e7840a72ec4b06473b39';
const whitespace = [
  ...Array.from({ length: 5 }, (_, index) => String.fromCodePoint(0x09 + index)),
  ' ', '\u00a0', '\u1680',
  ...Array.from({ length: 11 }, (_, index) => String.fromCodePoint(0x2000 + index)),
  '\u2028', '\u2029', '\u202f', '\u205f', '\u3000', '\ufeff',
];
const toFullwidth = (value: string) => value.replace(/[!-~]/g, letter => String.fromCodePoint(letter.charCodeAt(0) + 0xfee0));
function assertEquivalent(raw: string) {
  assert.equal(current.normalizeSkillSearchToken(raw), frozen.normalizeSkillSearchToken(raw));
  assert.deepEqual(current.resolveSkill(raw), frozen.resolveSkill(raw));
  assert.equal(current.canonicalSkillKey(raw), frozen.canonicalSkillKey(raw));
  assert.deepEqual(current.skillSearchAliases(raw), frozen.skillSearchAliases(raw));
}

test('catalogue regression uses the unmodified frozen source and unchanged skill definitions', () => {
  assert.equal(createHash('sha256').update(readFileSync(frozenUrl)).digest('hex'), frozenSha256);
  assert.equal(current.SKILL_CATALOG_VERSION, frozen.SKILL_CATALOG_VERSION);
  assert.equal(current.SKILL_SEARCH_WHITESPACE_PATTERN, frozen.SKILL_SEARCH_WHITESPACE_PATTERN);
  assert.deepEqual(current.SKILL_CATALOG, frozen.SKILL_CATALOG);
});

test('every controlled alias retains its identity across case, padding and NFKC spellings', () => {
  for (const skill of frozen.SKILL_CATALOG) {
    for (const alias of [skill.id, skill.label, ...skill.aliases]) {
      for (const raw of [alias, alias.toUpperCase(), ` \t${alias}\r\n `, toFullwidth(alias)]) {
        assertEquivalent(raw);
        assert.equal(current.resolveSkill(raw).id, skill.id);
        assert.equal(current.resolveSkill(raw).label, skill.label);
      }
    }
  }
});

test('all ECMAScript whitespace characters normalize equivalently without removing word boundaries', () => {
  assert.equal(whitespace.length, 25);
  for (const space of whitespace) {
    const known = `${space}ＡＰＩ${space}${space}contracts${space}`;
    const unknown = `${space}Unknown${space}${space}Skill${space}`;
    assertEquivalent(known);
    assertEquivalent(unknown);
    assert.equal(current.resolveSkill(known).id, 'api-contracts');
    assert.equal(current.normalizeSkillSearchToken(unknown), 'unknown skill');
    assert.notEqual(current.canonicalSkillKey(unknown), current.canonicalSkillKey('UnknownSkill'));
  }
});

test('NFKC and composed marks keep the established known and unknown semantics', () => {
  const examples: ReadonlyArray<readonly [string, string, string | null]> = [
    ['\u00a0ＰＹＴＨＯＮ\u00a0', 'python', 'python'],
    ['𝑃𝑦𝑡ℎ𝑜𝑛', 'python', 'python'],
    ['ＡＰＩ－контракты', 'api-контракты', 'api-contracts'],
    ['Ａ１１Ｙ', 'a11y', 'accessibility'],
    [' e\u0301ngine\u2003\u2003X ', 'éngine x', null],
    ['\u3000Ｑ－Ｓｔｏｒｅ\u3000', 'q-store', null],
    ['\ufb00 unknown', 'ff unknown', null],
  ];
  for (const [raw, normalized, id] of examples) {
    assertEquivalent(raw);
    assert.equal(current.normalizeSkillSearchToken(raw), normalized);
    assert.equal(current.resolveSkill(raw).id, id);
  }
  assert.notEqual(current.canonicalSkillKey('Q-Store'), current.canonicalSkillKey('QStore'));
});

test('characters outside the whitespace set remain distinct rather than gaining an alias', () => {
  for (const mark of ['\u0085', '\u200b', '\u2060', '\u0000']) {
    for (const raw of [`${mark}Python${mark}`, `API${mark}contracts`]) {
      assertEquivalent(raw);
      assert.equal(current.resolveSkill(raw).id, null);
      assert.notEqual(current.canonicalSkillKey(raw), current.canonicalSkillKey(raw.replaceAll(mark, '')));
    }
  }
});

test('equal normalized keys never reuse another callers raw text or unknown display label', () => {
  const groups = [
    [' Python ', 'Ｐｙｔｈｏｎ', '\ufeffPYTHON\ufeff'],
    [' Q-Store ', 'Ｑ－Ｓｔｏｒｅ', '\u00a0q-store\u00a0'],
    [' e\u0301ngine  X ', 'ÉNGINE\tX', 'éngine x'],
  ];
  for (let round = 0; round < 4; round++) {
    for (const group of groups) {
      for (const raw of round % 2 ? [...group].reverse() : group) {
        assertEquivalent(raw);
        const resolved = current.resolveSkill(raw);
        assert.equal(resolved.raw, raw);
        if (resolved.id === null) assert.equal(resolved.label, raw.trim());
      }
      assert.equal(new Set(group.map(current.canonicalSkillKey)).size, 1);
    }
  }
});

test('canonical labels keep first-key ordering and last raw label while preserving input arrays', () => {
  const values = ['py', ' Q-Store ', 'TS', 'PYTHON', 'Ｑ－Ｓｔｏｒｅ', 'a11y', 'ts', '\t', '', '\u200b'];
  const before = [...values];
  Object.freeze(values);
  assert.deepEqual(current.canonicalSkillLabels(values), ['Python', 'Ｑ－Ｓｔｏｒｅ', 'TypeScript', 'Accessibility', '\u200b']);
  assert.deepEqual(current.canonicalSkillLabels(values), frozen.canonicalSkillLabels(values));
  assert.deepEqual(values, before);
  assert.deepEqual(current.canonicalSkillLabels([...values].reverse()), frozen.canonicalSkillLabels([...values].reverse()));
});

test('search aliases keep duplicates and order and return fresh mutable arrays', () => {
  assert.deepEqual(current.skillSearchAliases(' Ｐｙ '), ['python', 'python', 'py']);
  for (const raw of ['Python', 'API-контракты', 'Доступность', ' Q-Store ', '']) {
    const first = current.skillSearchAliases(raw);
    const second = current.skillSearchAliases(raw);
    assert.notStrictEqual(first, second);
    first.fill('changed-by-caller');
    first.push('new-caller-entry');
    assert.deepEqual(second, frozen.skillSearchAliases(raw));
    assert.deepEqual(current.skillSearchAliases(raw), frozen.skillSearchAliases(raw));
  }
});

test('resolved skill objects are independently mutable on repeated and interleaved calls', () => {
  for (const raw of ['Python', ' ＰＹＴＨＯＮ ', 'Q-Store', ' Ｑ－Ｓｔｏｒｅ ', '']) {
    const first = current.resolveSkill(raw);
    const second = current.resolveSkill(raw);
    assert.notStrictEqual(first, second);
    Object.assign(first, { raw: 'caller-change', id: 'caller-change', label: 'caller-change', key: 'caller-change' });
    assert.deepEqual(second, frozen.resolveSkill(raw));
    for (let repeat = 0; repeat < 20; repeat++) {
      current.resolveSkill(repeat % 2 ? 'ts' : 'py');
      assert.deepEqual(current.resolveSkill(raw), frozen.resolveSkill(raw));
    }
  }
});

test('canonical label arrays remain independently mutable and empty results are fresh', () => {
  for (const values of [['Python', 'Q-Store', 'TypeScript'], [], ['', '\t']]) {
    const first = current.canonicalSkillLabels(values);
    const second = current.canonicalSkillLabels(values);
    assert.notStrictEqual(first, second);
    first.splice(0, first.length, 'caller-change');
    assert.deepEqual(second, frozen.canonicalSkillLabels(values));
    assert.deepEqual(current.canonicalSkillLabels(values), frozen.canonicalSkillLabels(values));
  }
});

test('interleaved role coverage preserves program-specific decisions with no mutable result leakage', () => {
  const skills = Object.freeze(['py', 'ts', 'a11y', 'API contracts', 'SQL', 'PostgreSQL', 'Q-Store']);
  const specializations = ['Backend / Python', 'Frontend / TypeScript', 'Unknown program'];
  const originals = [...skills];
  for (let round = 0; round < 8; round++) {
    for (const specialization of round % 2 ? [...specializations].reverse() : specializations) {
      const first = current.skillCoverage(skills, specialization);
      const second = current.skillCoverage(skills, specialization);
      assert.deepEqual(first, frozen.skillCoverage(skills, specialization));
      assert.notStrictEqual(first, second);
      assert.notStrictEqual(first[0], second[0]);
      Object.assign(first[0], { raw: 'caller-change', id: null, label: 'caller-change', key: 'caller-change', supported: !first[0].supported, program: 'caller-change', evidence: 'caller-change' });
      first.length = 0;
      assert.deepEqual(second, frozen.skillCoverage(skills, specialization));
      assert.deepEqual(current.skillCoverage(skills, specialization), frozen.skillCoverage(skills, specialization));
    }
  }
  assert.equal(current.skillCoverage(['py'], 'Backend / Python')[0].supported, true);
  assert.equal(current.skillCoverage(['py'], 'Frontend / TypeScript')[0].supported, false);
  assert.equal(current.skillCoverage(['ts'], 'Frontend / TypeScript')[0].supported, true);
  assert.equal(current.skillCoverage(['ts'], 'Backend / Python')[0].supported, false);
  assert.deepEqual(skills, originals);
});

test('more than 512 distinct inputs and early/recent repeats remain equivalent after cache churn', () => {
  // Unique normalized values also exceed the possible 512-entry cache, not just raw spellings.
  const inputs = Array.from({ length: 1537 }, (_, index) => `\u00a0Unknown\u2003skill-${index}\u3000`);
  assert.equal(new Set(inputs.map(frozen.normalizeSkillSearchToken)).size, 1537);
  for (const [index, raw] of inputs.entries()) {
    assertEquivalent(raw);
    assertEquivalent(index % 2 ? ' ＰＹＴＨＯＮ ' : 'ts');
    if (index % 128 === 0) {
      assert.deepEqual(current.canonicalSkillLabels([raw, 'py', raw.toUpperCase(), 'TypeScript']), frozen.canonicalSkillLabels([raw, 'py', raw.toUpperCase(), 'TypeScript']));
    }
  }
  const repeated = [0, 1, 255, 511, 512, 1023, 1535, 1536];
  for (let pass = 0; pass < 3; pass++) {
    for (const index of pass % 2 ? [...repeated].reverse() : repeated) {
      const raw = inputs[index];
      assertEquivalent(raw);
      assertEquivalent(toFullwidth(raw.toUpperCase()));
      const values = [raw, 'py', 'ts', raw.trim().toUpperCase()];
      assert.deepEqual(current.canonicalSkillLabels(values), frozen.canonicalSkillLabels(values));
      for (const specialization of ['Backend / Python', 'Frontend / TypeScript']) {
        assert.deepEqual(current.skillCoverage(values, specialization), frozen.skillCoverage(values, specialization));
      }
    }
  }
});

test('empty, long and punctuation-rich user input keep frozen semantics without trimming raw values', () => {
  const inputs = ['', ' ', '\t\r\n', 'X'.repeat(2048), "Q-Store'); select 'private'; --", '__proto__', 'constructor', 'toString', 'skill:python', 'İ', 'I', 'ı', 'ß'];
  for (const raw of inputs) {
    assertEquivalent(raw);
    assert.equal(current.resolveSkill(raw).raw, raw);
    assert.deepEqual(current.canonicalSkillLabels([raw, 'py', raw]), frozen.canonicalSkillLabels([raw, 'py', raw]));
  }
});

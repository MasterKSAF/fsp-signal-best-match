import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSkillAttempt, scoreSkillAttempt, skillModuleRegistry, skillModuleTemplates, skillScenarioFixture, skillContentFamilyId, skillModulePolicy, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
import { getSkillQualification, type SkillModuleEvidence } from '../artifacts/api-server/src/lib/skill-module-qualification';
// Literal captured by independent-skill-probes.json, independent-sql-6, before v2. Self-contained for clean repository installs.
const oldProbe = { sqlRepro: { question: { id: 'q6', competencyId: 'constraints', title: 'Уникальный ключ', prompt: 'Контракт: одно событие (tenant_id,event_id) обрабатывается один раз. Система имеет одного tenant; event_id глобален. Какое ограничение выражает контракт?', responseType: 'choice' as const, options: [{ id: 'o1', text: 'UNIQUE(event_id), обработка конфликта в транзакции с результатом.' }, { id: 'o4', text: 'UNIQUE(tenant_id,event_id), обработка конфликта в той же транзакции с результатом.' }], critical: true, templateId: 'signal-skills-2026-10-v1:sql:Middle:constraints:s1', templateVersion: 1 }, keyed: { id: 'o1' }, alternative: { id: 'o4' }, decisionWithAlternativeAndOtherFiveCorrect: { rubricVersion: 'six-competencies-critical-5of6-canonical-integer-v2' } } };

test('v2 Middle requires six explicit additional outcomes; base-only answers never certify either critical slot', () => {
  for (const module of skillModuleRegistry) for (const seed of ['independent-react-34', 'independent-sql-6', 'boundary0', 'boundary1']) {
    const form = buildSkillAttempt(module.id, 'Middle', seed);
    assert.equal(form.programVersion, SKILL_BANK_VERSION);
    assert.equal(new Set(form.cases.map(c => c.levelRequirementId)).size, 6);
    assert.ok(form.cases.every(c => c.middleOutcome && c.contentFamilyId && [2,3,4].includes(c.templateVersion) && form.oracles[c.id]?.parts?.length === 2));
    const answers = Object.fromEntries(form.cases.map(c => [c.id, form.oracles[c.id]!.expected]));
    const good = scoreSkillAttempt(form.cases, form.oracles, answers, form.policy);
    assert.equal(good.passed, true); assert.equal(good.levelCoverage?.filter(r => r.passed).length, 6);
    const baseOnly = Object.fromEntries(form.cases.map(c => [c.id, form.oracles[c.id]!.parts![0]!.expected]));
    assert.equal(scoreSkillAttempt(form.cases, form.oracles, baseOnly, form.policy).passed, false);
    for (const critical of form.cases.filter(c => c.critical)) {
      const partial = `${form.oracles[critical.id]!.parts![0]!.expected};wrong`;
      const wrong = scoreSkillAttempt(form.cases, form.oracles, { ...answers, [critical.id]: partial }, form.policy);
      assert.equal(wrong.score, 83); assert.equal(wrong.criticalComplete, false); assert.equal(wrong.passed, false);
    }
  }
});
test('every level slot has a substantive B requirement, not a cosmetic variant of the complete Junior task', () => {
  for (const module of skillModuleRegistry) for (let c = 0; c < 6; c++) for (let s = 0; s < 3; s++) for (let n = 5; n <= 9; n++) for (const flag of [false, true]) {
    const junior = skillScenarioFixture(module.id, 'Junior', c, s, n, flag);
    const middle = skillScenarioFixture(module.id, 'Middle', c, s, n, flag);
    assert.ok(middle.middleOutcome); assert.ok(middle.parts?.length === 2); assert.ok(middle.prompt.includes('Часть B — обязательное требование Middle'));
    assert.notEqual(junior.answer, middle.answer); assert.notEqual(junior.prompt, middle.prompt);
  }
});
test('same base content is remembered across levels and old/new versions; unseen alternative is selected', () => {
  const base = buildSkillAttempt('react', 'Middle', 'independent-react-34');
  const previous = new Map(base.cases.map(c => [c.templateId.replace(/-v\d+:/, '-v1:').replace(':Middle:', ':Junior:'), 100]));
  const rotated = buildSkillAttempt('react', 'Middle', 'independent-react-34', { personalExposures: previous });
  for (let i = 0; i < 6; i++) assert.notEqual(skillContentFamilyId(base.cases[i]!.templateId), skillContentFamilyId(rotated.cases[i]!.templateId));
  const global = new Map(base.cases.map(c => [c.contentFamilyId!, 50]));
  const balanced = buildSkillAttempt('react', 'Junior', 'independent-react-34', { globalExposures: global });
  for (let i = 0; i < 6; i++) assert.notEqual(skillContentFamilyId(base.cases[i]!.templateId), skillContentFamilyId(balanced.cases[i]!.templateId));
  const snapshot = structuredClone(base);
  buildSkillAttempt('react', 'Middle', 'independent-react-34', { disabled: new Set(base.cases.map(c => c.templateId)) });
  assert.deepEqual(base, snapshot);
  assert.equal(new Set(skillModuleTemplates.filter(t => t.level !== 'Senior').map(t => t.contentFamilyId)).size, 108);
});
test('SQL s1 has explicit global/local cross-tenant counterexamples on both levels', () => {
  for (const level of ['Junior', 'Middle'] as const) for (const local of [false, true]) {
    const task = skillScenarioFixture('sql', level, 5, 0, 5, local);
    assert.ok(task.prompt.includes('(1,7)') && task.prompt.includes('(2,7)'));
    if (level === 'Junior') assert.equal(task.answer.includes(local ? 'UNIQUE(tenant_id,event_id)' : 'UNIQUE(event_id)'), true);
    else { const a=task.prompt.split('Часть B')[0]!; const line=a.split('\n').find(x=>x.startsWith(`${task.parts?.[0]?.expected}. `)); assert.ok(line?.includes(local ? 'UNIQUE(tenant_id,event_id)' : 'UNIQUE(event_id)')); }
  }
});
test('captured v1 SQL ambiguity and score remain unchanged under its saved rubric; no retroactive regrade', () => {
  const legacy = oldProbe.sqlRepro;
  const q6 = legacy.question;
  const cases = Array.from({ length: 6 }, (_, c) => c === 5 ? q6 : { ...q6, id: `q${c + 1}`, competencyId: `c${c}`, critical: c === 0 });
  const oracles = Object.fromEntries(cases.map(c => [c.id, { expected: c.id === 'q6' ? legacy.keyed.id : 'right', explanation: '', points: 1, rubricVersion: legacy.decisionWithAlternativeAndOtherFiveCorrect.rubricVersion }]));
  const answers = Object.fromEntries(cases.map(c => [c.id, c.id === 'q6' ? legacy.alternative.id : 'right']));
  const snapshot = structuredClone({ cases, oracles });
  const decision = scoreSkillAttempt(cases, oracles, answers, { threshold: 83, rubricVersion: legacy.decisionWithAlternativeAndOtherFiveCorrect.rubricVersion });
  assert.equal(decision.passed, false); assert.equal(decision.score, 83); assert.equal(decision.criticalComplete, false);
  assert.deepEqual({ cases, oracles }, snapshot);
});
test('new v2 Middle evidence needs its advanced coverage; genuine old v1 evidence stays versioned', () => {
  const target = { userId: 42, specialization: 'Backend / Python', assumedGrade: 'Middle' as const, stack: ['Python', 'SQL'], skills: [] };
  const proof = (skillId: string, id: number): SkillModuleEvidence => {
    const form = buildSkillAttempt(skillId, 'Middle', `proof-${id}`);
    const answers = Object.fromEntries(Object.entries(form.oracles).map(([id, oracle]) => [id, oracle.expected]));
    const decision = scoreSkillAttempt(form.cases, form.oracles, answers, form.policy);
    return { id, userId: 42, attemptId: id, skillId, level: 'Middle', programVersion: form.programVersion, competencyIds: form.cases.map(c => c.competencyId), decision, verifiedAt: new Date('2026-10-08T00:00:00Z') };
  };
  const evidence = [proof('python', 1), proof('sql', 2), proof('backend-engineering', 3)];
  assert.equal(getSkillQualification(target, { evidence, revokedIds: new Set() }).verifiedGrade, 'Middle');
  const broken = structuredClone(evidence); delete broken[0]!.decision.levelCoverage;
  assert.equal(getSkillQualification(target, { evidence: broken, revokedIds: new Set() }).verifiedGrade, null);
  const savedV2 = evidence.map(e => ({ ...structuredClone(e), programVersion: 'signal-skills-2026-10-v2' }));
  assert.equal(getSkillQualification(target, { evidence: savedV2, revokedIds: new Set() }).verifiedGrade, 'Middle');
  const brokenV2 = structuredClone(savedV2); delete brokenV2[0]!.decision.levelCoverage;
  assert.equal(getSkillQualification(target, { evidence: brokenV2, revokedIds: new Set() }).verifiedGrade, null);
  const old = evidence.map(e => { const row = structuredClone(e); row.programVersion = 'signal-skills-2026-10-v1'; delete row.decision.levelCoverage; row.decision.rubricVersion = 'six-competencies-critical-5of6-canonical-integer-v2'; return row; });
  assert.equal(getSkillQualification(target, { evidence: old, revokedIds: new Set() }).verifiedGrade, 'Middle');
});

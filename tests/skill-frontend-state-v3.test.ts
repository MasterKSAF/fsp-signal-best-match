import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSkillAttempt, historicalSkillScenarioFixture, scoreSkillAttempt, skillContentFamilyId, skillModuleTemplates, skillScenarioFixture, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';

test('Frontend state A explicitly changes active and agrees with actual rows for both actions and every n', () => {
  for (let n = 5; n <= 9; n++) for (const removed of [false, true]) {
    let rows = [{ id: 1, p: n, active: true }, { id: 2, p: 2, active: false }, { id: 3, p: 4, active: true }];
    if (removed) rows = rows.filter(row => row.id !== 1);
    else rows.find(row => row.id === 2)!.active = true;
    const juniorSum = rows.filter(row => row.active === true).reduce((sum, row) => sum + row.p, 0);
    const junior = skillScenarioFixture('frontend-engineering', 'Junior', 0, 0, n, removed);
    assert.equal(junior.answer, String(juniorSum));
    assert.deepEqual(junior, historicalSkillScenarioFixture('frontend-engineering', 'Junior', 0, 0, n, removed));
    rows.find(row => row.id === 3)!.active = false;
    const middleSum = rows.filter(row => row.active === true).reduce((sum, row) => sum + row.p, 0);
    const middle = skillScenarioFixture('frontend-engineering', 'Middle', 0, 0, n, removed);
    assert.match(middle.prompt, /у строки id=3 установили active=false/);
    assert.match(middle.prompt, /только для строк с active=true/);
    assert.equal(middle.parts![0]!.expected, String(middleSum));
    assert.match(middle.explanation, /у id=3 явно установлено active=false/);
    assert.match(historicalSkillScenarioFixture('frontend-engineering', 'Middle', 0, 0, n, removed).prompt, /Затем скрыли id=3/);
  }
});

test('Frontend template keeps version3 and stable v1/v2/v3/v4 exposure family; Middle B remains critical', () => {
  assert.equal(SKILL_BANK_VERSION, 'signal-skills-2026-10-v6');
  const template = skillModuleTemplates.find(t => t.id.endsWith(':frontend-engineering:Middle:state-model:s1'))!;
  assert.equal(template.version, 3);
  const disabled = new Set(skillModuleTemplates.filter(t => t.skillId === 'frontend-engineering' && t.level === 'Middle' && t.competencyId === 'state-model' && t.scenarioIndex !== 0).map(t => t.id));
  const form = buildSkillAttempt('frontend-engineering', 'Middle', 'independent-frontend-active-1', { disabled });
  const state = form.cases.find(c => c.competencyId === 'state-model')!;
  assert.equal(state.templateId, template.id); assert.equal(state.templateVersion, 3); assert.equal(state.critical, true);
  for (const version of [1, 2, 3, 4]) assert.equal(skillContentFamilyId(state.templateId.replace(/-v\d+:/, `-v${version}:`)), state.contentFamilyId);
  const correct = Object.fromEntries(Object.entries(form.oracles).map(([id, oracle]) => [id, oracle.expected]));
  assert.equal(scoreSkillAttempt(form.cases, form.oracles, correct, form.policy).passed, true);
  const base = form.oracles[state.id]!.parts![0]!.expected;
  for (const response of [base, `${base};wrong`]) {
    const decision = scoreSkillAttempt(form.cases, form.oracles, { ...correct, [state.id]: response }, form.policy);
    assert.equal(decision.score, 83); assert.equal(decision.criticalComplete, false); assert.equal(decision.passed, false);
  }
  const rotated = buildSkillAttempt('frontend-engineering', 'Middle', 'independent-frontend-active-1', { personalExposures: new Map([[state.templateId.replace(/-v\d+:/, '-v2:').replace(':Middle:', ':Junior:'), 1]]) });
  assert.notEqual(rotated.cases[0]!.contentFamilyId, state.contentFamilyId);
});

test('Captured ambiguous v2 case keeps its frozen key, explanation and failed result; no silent regrade', () => {
  const form = buildSkillAttempt('frontend-engineering', 'Middle', 'historical-read-only');
  const old = historicalSkillScenarioFixture('frontend-engineering', 'Middle', 0, 0, 9, true);
  form.programVersion = 'signal-skills-2026-10-v2';
  form.cases[0] = { ...form.cases[0]!, title: old.title, prompt: old.prompt, templateId: 'signal-skills-2026-10-v2:frontend-engineering:Middle:state-model:s1', templateVersion: 2 };
  form.oracles.q1 = { ...form.oracles.q1!, expected: '0;1', explanation: old.explanation, parts: [{ expected: '0', responseType: 'integer' }, { expected: '1', responseType: 'integer' }] };
  const saved = { ...form, startedAt: '2026-10-08T00:00:00Z', submittedAt: '2026-10-08T00:01:00Z' };
  const snapshot = structuredClone(saved);
  const answers = Object.fromEntries(Object.entries(saved.oracles).map(([id, oracle]) => [id, oracle.expected]));
  const decision = scoreSkillAttempt(saved.cases, saved.oracles, { ...answers, q1: '4;1' }, saved.policy);
  assert.equal(decision.score, 83); assert.equal(decision.criticalComplete, false); assert.equal(decision.passed, false);
  buildSkillAttempt('frontend-engineering', 'Middle', 'new-issuance');
  assert.deepEqual(saved, snapshot);
});

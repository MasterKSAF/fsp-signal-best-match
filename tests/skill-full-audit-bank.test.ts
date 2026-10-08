import assert from 'node:assert/strict';
import test from 'node:test';
import { skillModuleRegistry, skillModuleTemplates, buildSkillAttempt, skillContentFamilyId, SkillBankUnavailableError, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
import { seniorRequirementProbe, historicalSeniorV5RequirementProbe } from '../artifacts/api-server/src/lib/skill-senior-outcomes';
import { getSkillBankAvailability } from '../artifacts/api-server/src/lib/skill-bank-availability';
import { skillOverrideStatus, currentSkillTemplateForOperator, legacyQualificationIssuancePolicy } from '../artifacts/api-server/src/lib/skill-bank-operator-policy';
import { middleRequirementProbe, historicalMiddleV5RequirementProbe } from '../artifacts/api-server/src/lib/skill-middle-outcomes';

test('A05 old-version disabled unchanged families block registry and actual issuance across all18 skill/levels', () => {
  assert.equal(SKILL_BANK_VERSION, 'signal-skills-2026-10-v6');
  for (const module of skillModuleRegistry) for (const level of ['Junior', 'Middle', 'Senior'] as const) {
    const competency = module.competencies.find(id => skillModuleTemplates.filter(t => t.skillId === module.id && t.level === level && t.competencyId === id).every(t => skillContentFamilyId(t.id) === skillContentFamilyId(t.id.replace('-v6:', '-v5:'))))!;
    const all = skillModuleTemplates.filter(t => t.skillId === module.id && t.level === level && t.competencyId === competency);
    const oldIds = all.map(t => t.id.replace('-v6:', '-v5:'));
    const disabled = new Set(oldIds);
    assert.equal(getSkillBankAvailability(module, level, { templates: skillModuleTemplates, disabled, contentFamilyId: skillContentFamilyId }).available, false);
    assert.throws(() => buildSkillAttempt(module.id, level, 'disabled-existing-content', { disabled }), SkillBankUnavailableError);
    const rows = oldIds.map(templateId => ({ templateId, status: 'disabled' }));
    for (const t of all) { assert.equal(skillOverrideStatus(t.id, rows), 'disabled'); assert.ok(currentSkillTemplateForOperator(t.id.replace('-v6:', '-v5:'))); }
    const enabled = rows.map(row => ({ ...row, status: 'active' }));
    assert.equal(skillOverrideStatus(all[0]!.id, enabled), 'active');
  }
  const current = skillModuleTemplates.filter(t => t.skillId === 'python' && t.level === 'Senior' && t.competencyId === 'collections');
  const v4 = new Set(current.map(t => t.id.replace('-v6:', '-v4:')));
  assert.throws(() => buildSkillAttempt('python', 'Senior', 'exact-audit-M03', { disabled: v4 }), SkillBankUnavailableError);
});

test('A05 only materially changed identity content gets new lineage; v5 corrections and all other content retain version history', () => {
  let changed = 0;
  for (const t of skillModuleTemplates.filter(t => t.level === 'Senior')) {
    const oldId = t.id.replace('-v6:', '-v5:');
    const oldFamily = skillContentFamilyId(oldId);
    const newFamily = skillContentFamilyId(t.id);
    if (oldFamily !== newFamily) { changed++; assert.equal(t.skillId, 'react'); assert.equal(t.competencyId, 'identity'); assert.equal(t.level, 'Senior'); assert.ok([0, 2].includes(t.scenarioIndex)); }
    else assert.equal(skillOverrideStatus(t.id, [{ templateId: oldId, status: 'disabled' }]), 'disabled');
  }
  assert.equal(changed, 2);
  const next = skillModuleTemplates.find(t => t.id.endsWith(':react:Senior:identity:s1'))!;
  assert.equal(skillOverrideStatus(next.id, [{ templateId: next.id.replace('-v6:', '-v5:'), status: 'disabled' }]), 'active');
  assert.equal(skillOverrideStatus(next.id, [{ templateId: next.id, status: 'disabled' }]), 'disabled');
});

test('A05 optimistic client/server identity needs receipt linkage and durable UI identity; stable server key alone loses draft', () => {
  for (const ack of [false, true]) {
    const initial = { uiKey: 'CA', draft: 'draftA', serverId: null as number | null };
    const serverId = ack ? 5 : null;
    const naiveKey = serverId ?? initial.uiKey;
    const naiveDraft = naiveKey === initial.uiKey ? initial.draft : 'empty';
    const stableDraft = initial.draft;
    assert.equal(seniorRequirementProbe('react', 3, 0, 5, ack).parts[0].expected, `${naiveDraft}|${stableDraft}|${ack ? 1 : 0}`);
    assert.notEqual(seniorRequirementProbe('react', 3, 0, 5, ack).parts[1].prompt, historicalSeniorV5RequirementProbe('react', 3, 0, 5, ack).parts[1].prompt);
  }
  const rows = [{ uiId: 'CA', op: 'KA', serverId: null }, { uiId: 'CB', op: 'KB', serverId: null }];
  const ack = { op: 'KA', serverId: 5 };
  const reconciled = rows.map(row => row.op === ack.op ? { ...row, serverId: ack.serverId } : row);
  assert.equal(reconciled.length, 2); assert.equal(reconciled[1]!.serverId, null); assert.equal(reconciled[0]!.uiId, 'CA');
});

test('A05 plugin replacement keeps migrated durable draft but fences old schema/generation validation despite same CV revision', () => {
  for (const completeGuard of [false, true]) {
    const current = { entity: 'A', cvRevision: 7, schema: 2, generation: 2, draft: { value: 5 } };
    const old = { entity: 'A', cvRevision: 7, schema: 1, generation: 1 };
    const accepted = old.entity === current.entity && old.cvRevision === current.cvRevision && (!completeGuard || old.schema === current.schema && old.generation === current.generation);
    assert.equal(seniorRequirementProbe('react', 3, 2, 5, completeGuard).parts[0].expected, `${Number(accepted)}|${current.draft.value}|empty`);
  }
});

test('A04 Middle alternatives preserve the selected semantic contract and historical probes without boilerplate', () => {
  const seen = new Set<string>();
  for (const module of skillModuleRegistry) for (let c = 0; c < 6; c++) {
    const ranks = new Set<number>();
    for (let s = 0; s < 3; s++) for (let n = 5; n <= 9; n++) for (const f of [false, true]) {
      const current = middleRequirementProbe(module.id, c, s, n, f), previous = historicalMiddleV5RequirementProbe(module.id, c, s, n, f);
      assert.equal(current.expected, previous.expected); assert.equal(current.outcome, previous.outcome);
      if (!current.choices) { assert.deepEqual(current, previous); continue; }
      seen.add(current.requirementId); assert.equal(new Set(current.choices).size, 4);
      const correctLength = current.choices[Number(current.expected) - 1]!.length;
      ranks.add(current.choices.filter(text => text.length > correctLength).length);
    }
    // Choice-only shortcuts are measured by the separate unchanged adversarial experiment,
    // rather than prescribing correct-answer length ranks to the authoring implementation.
  }
  assert.equal(seen.size, 18); assert.equal(legacyQualificationIssuancePolicy, 'read_complete_only');
});


test('A05 v6 explicit lower clarifications have new lineage while all99 unchanged base families retain v5 disable/exposure',()=>{
 const seen=new Set<string>();let changed=0;
 for(const t of skillModuleTemplates.filter(t=>t.level==='Junior')){const old=t.id.replace('-v6:','-v5:');const newFamily=skillContentFamilyId(t.id),oldFamily=skillContentFamilyId(old);if(newFamily!==oldFamily){changed++;assert.equal(t.version,4);assert.ok(newFamily.startsWith('skill-content-v2:'));}else{assert.equal(newFamily,oldFamily);seen.add(newFamily);}assert.equal(skillContentFamilyId(t.id.replace(':Junior:',':Middle:')),newFamily);}
 assert.equal(changed,9);assert.equal(seen.size,99);
});

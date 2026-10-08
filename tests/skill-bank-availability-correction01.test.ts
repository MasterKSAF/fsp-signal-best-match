import assert from 'node:assert/strict';
import test from 'node:test';
import { buildSkillAttempt, skillContentFamilyId, skillModuleRegistry, skillModuleTemplates, SkillBankUnavailableError, SKILL_BANK_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
import { eligibleSkillTemplates, findContinuableSkillAttempt, getSkillBankAvailability, skillFamilyExposureCounts } from '../artifacts/api-server/src/lib/skill-bank-availability';
import { skillIssueRestriction } from '../artifacts/api-server/src/lib/skill-module-policy';

const pool = (module: typeof skillModuleRegistry[number], personal = new Map<string, number>(), disabled = new Set<string>(), level = 'Senior') =>
  getSkillBankAvailability(module, level, { templates: skillModuleTemplates, personalExposures: personal, disabled, contentFamilyId: skillContentFamilyId });

test('matrix and real issuance agree before/after all three nonrepeating Senior forms for every skill', () => {
  for (const module of skillModuleRegistry) {
    const seen = new Map<string, number>(), families = new Set<string>();
    for (let index = 0; index < 3; index++) {
      assert.deepEqual(pool(module, seen), { available: true, reason: null, availabilityCode: null }, `${module.id}/${index}`);
      const form = buildSkillAttempt(module.id, 'Senior', `C05:${module.id}:${index}`, { personalExposures: seen });
      for (const item of form.cases) {
        assert.ok(!families.has(item.contentFamilyId!), `${module.id} repeated ${item.contentFamilyId}`);
        families.add(item.contentFamilyId!); seen.set(item.templateId, 1);
      }
    }
    assert.equal(families.size, 18);
    assert.deepEqual(pool(module, seen), { available: false, reason: 'Новая форма временно недоступна.', availabilityCode: 'skill_bank_unavailable' });
    assert.throws(() => buildSkillAttempt(module.id, 'Senior', 'C05:fourth', { personalExposures: seen }), SkillBankUnavailableError);
  }
});

test('a missing single competency disables the complete form even when other competencies remain unseen', () => {
  for (const module of skillModuleRegistry) {
    const templates = skillModuleTemplates.filter(t => t.skillId === module.id && t.level === 'Senior' && t.competencyId === module.competencies[0]);
    const seen = new Map(templates.map(t => [t.id, 1]));
    assert.equal(pool(module, seen).available, false);
    assert.throws(() => buildSkillAttempt(module.id, 'Senior', 'C05:one-missing', { personalExposures: seen }), SkillBankUnavailableError);
  }
});

test('cooldown expiry reopens the clock but never removes the personal exposure block', () => {
  const now = new Date('2026-10-08T14:00:00Z');
  for (const module of skillModuleRegistry) {
    const seen = new Map(skillModuleTemplates.filter(t => t.skillId === module.id && t.level === 'Senior').map(t => [t.id, 1]));
    const rows = [{ skillId: module.id, level: 'Senior', status: 'submitted', startedAt: new Date(+now - 25 * 3600_000), submittedAt: new Date(+now - 24 * 3600_000) }];
    assert.equal(skillIssueRestriction(rows, module.id, 'Senior', now), null);
    const exposureSnapshot = [...seen.entries()];
    assert.equal(pool(module, seen).available, false);
    assert.equal(pool(module, seen).available, false);
    assert.deepEqual([...seen.entries()], exposureSnapshot, 'Repeated matrix reads do not mutate exposure state');
  }
});

test('active snapshots remain continuable despite exhaustion, old programme version, or disabled current templates', () => {
  const now = new Date('2026-10-08T14:00:00Z');
  for (const module of skillModuleRegistry) {
    const seen = new Map(skillModuleTemplates.filter(t => t.skillId === module.id && t.level === 'Senior').map(t => [t.id, 1]));
    const row = { id: 99, skillId: module.id, level: 'Senior', status: 'active', expiresAt: new Date(+now + 60_000), programVersion: 'signal-skills-2026-10-v4', resumeId: 1 };
    const snapshot = structuredClone(row);
    assert.equal(pool(module, seen, new Set(skillModuleTemplates.map(t => t.id))).available, false);
    assert.equal(findContinuableSkillAttempt([row], module.id, 'Senior', now), row);
    assert.equal(findContinuableSkillAttempt([row], module.id, 'Middle', now), undefined);
    assert.equal(findContinuableSkillAttempt([row], module.id, 'Senior', row.expiresAt), undefined);
    assert.deepEqual(row, snapshot);
  }
});

test('historical v4 exposures do not become fresh just because the current bank version changed', () => {
  for (const module of skillModuleRegistry) {
    const templates = skillModuleTemplates.filter(t => t.skillId === module.id && t.level === 'Senior');
    const seen = new Map(templates.map(t => [t.id.replace(`${SKILL_BANK_VERSION}:`, 'signal-skills-2026-10-v4:'), 1]));
    assert.equal(pool(module, seen).available, false, `${module.id}: all unchanged competencies are still exhausted`);
    const counts = skillFamilyExposureCounts(seen, skillContentFamilyId);
    for (const template of templates) {
      const historicFamily = skillContentFamilyId(template.id.replace(`${SKILL_BANK_VERSION}:`, 'signal-skills-2026-10-v4:'));
      if (historicFamily === template.contentFamilyId) assert.ok(counts.has(template.contentFamilyId), 'Unchanged content keeps historical lineage');
    }
  }
});

test('disabled templates and exposed templates use the same pool predicate as the real form builder', () => {
  for (const module of skillModuleRegistry) {
    const first = buildSkillAttempt(module.id, 'Senior', 'C05:mixed-pool');
    const seen = new Map(first.cases.map(c => [c.templateId, 1]));
    const personal = skillFamilyExposureCounts(seen, skillContentFamilyId);
    const remaining = skillModuleTemplates.filter(t => t.skillId === module.id && t.level === 'Senior' && t.competencyId === module.competencies[0] && !personal.has(t.contentFamilyId));
    const disabled = new Set(remaining.map(t => t.id));
    assert.equal(eligibleSkillTemplates(skillModuleTemplates, module.id, 'Senior', module.competencies[0]!, personal, disabled).length, 0);
    assert.equal(pool(module, seen, disabled).availabilityCode, 'skill_bank_unavailable');
    assert.throws(() => buildSkillAttempt(module.id, 'Senior', 'C05:disabled', { personalExposures: seen, disabled }), SkillBankUnavailableError);
  }
});

test('unsupported levels fail closed and existing Junior/Middle rotation remains available', () => {
  const unsupported = getSkillBankAvailability(undefined, 'Senior', { templates: skillModuleTemplates, contentFamilyId: skillContentFamilyId });
  assert.equal(unsupported.available, false); assert.equal(unsupported.availabilityCode, 'unsupported_skill_level');
  for (const module of skillModuleRegistry) {
    assert.equal(pool(module, new Map(), new Set(), 'Staff').availabilityCode, 'unsupported_skill_level');
    for (const level of ['Junior', 'Middle'] as const) {
      const seen = new Map(skillModuleTemplates.filter(t => t.skillId === module.id && t.level === level).map(t => [t.id, 100]));
      assert.equal(pool(module, seen, new Set(), level).available, true);
      assert.equal(buildSkillAttempt(module.id, level, 'C05:existing-lower-rotation', { personalExposures: seen }).cases.length, 6);
    }
  }
});

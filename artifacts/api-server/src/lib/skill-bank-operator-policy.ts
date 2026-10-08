import { skillContentFamilyId, skillModuleTemplates } from './skill-module-bank';
export const legacyQualificationIssuancePolicy = 'read_complete_only' as const;
/** An override targets immutable content, not the release label spelling. */
export function skillOverrideScope(templateId: string) { return skillContentFamilyId(templateId); }
export function skillOverrideStatus(templateId: string, overrides: readonly { templateId: string; status: string }[]) {
  const family = skillOverrideScope(templateId);
  return overrides.some(row => row.status === 'disabled' && skillOverrideScope(row.templateId) === family) ? 'disabled' : 'active';
}
export function currentSkillTemplateForOperator(id: string) {
  const family = skillOverrideScope(id);
  return skillModuleTemplates.find(t => t.id === id || t.contentFamilyId === family) ?? null;
}

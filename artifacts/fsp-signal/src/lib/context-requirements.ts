import { exactDictionaryOption, normalizeDictionaryText, type DictionaryOption } from './professional-dictionaries';

export type RequirementMode = 'verified' | 'declared_or_verified';
export type RequirementLevel = 'Junior' | 'Middle' | 'Senior';
const levelledSkills = new Set(['python','sql','typescript','react','backend engineering','frontend engineering']);
const builtInAliases: Record<string,string> = {py:'Python',ts:'TypeScript'};
const builtInSkillLabel = (value: string) => builtInAliases[normalizeDictionaryText(value)] ?? value;
export function requirementSkillLabel(skill: string, dictionary: readonly DictionaryOption[] = []): string {
  return exactDictionaryOption(dictionary, skill)?.value ?? builtInSkillLabel(skill);
}
export function supportsRequirementLevel(skill: string, dictionary: readonly DictionaryOption[] = []): boolean {
  return levelledSkills.has(normalizeDictionaryText(requirementSkillLabel(skill,dictionary)));
}
export type SkillRequirement = { skill: string; mode?: RequirementMode; level?: RequirementLevel };
export type RequirementContext = {
  skills?: string[]; requiredSkills?: string[]; skillRequirements?: SkillRequirement[];
  requiredSkillLevels?: Record<string, RequirementLevel>; gradeMode?: RequirementMode;
};
export const requirementModeLabel = (mode?: RequirementMode) => mode === 'declared_or_verified' ? 'Достаточно заявленного' : 'Требуется подтверждение';
export const requirementLabel = (item: SkillRequirement) => `${item.skill} · ${item.mode === 'declared_or_verified' ? 'достаточно заявленного' : item.level ? `подтверждение от ${item.level}` : 'подтверждение'}`;
export function editorRequirements(skills: readonly string[], source: RequirementContext, dictionary: readonly DictionaryOption[] = []): SkillRequirement[] {
  const identity = (value: string) => {
    const prefix = value.startsWith('skill:') ? 'skill:' : value.startsWith('raw:') ? 'raw:' : '';
    const raw = prefix ? value.slice(prefix.length) : value;
    const option = exactDictionaryOption(dictionary, raw);
    return normalizeDictionaryText(requirementSkillLabel(option?.value ?? raw,dictionary));
  };
  return skills.map(skill => {
    const existing = source.skillRequirements?.find(item => identity(item.skill) === identity(skill));
    const level = existing?.level ?? Object.entries(source.requiredSkillLevels ?? {}).find(([key]) => identity(key) === identity(skill))?.[1];
    const mode = existing?.mode ?? 'verified';
    return { skill: requirementSkillLabel(skill,dictionary), mode, ...(mode === 'verified' && level ? { level } : {}) };
  });
}
export function contextRequirements(context: RequirementContext): SkillRequirement[] {
  return editorRequirements([...new Set([...(context.skills ?? context.requiredSkills ?? []), ...(context.skillRequirements ?? []).map(item => item.skill)])], context);
}
export function verifiedRequirementLevels(requirements: readonly SkillRequirement[]): Record<string, RequirementLevel> {
  return Object.fromEntries(requirements.flatMap(item => item.mode !== 'declared_or_verified' && item.level ? [[item.skill, item.level]] : []));
}
export function invitationDraft(context: {type: 'job'|'need'; title: string}) {
  return context.type === 'need'
    ? {title:'Приглашение от компании', message:'Здравствуйте! Предлагаем обсудить работу в нашей компании. Условия предложения указаны ниже.'}
    : {title:`Приглашение: ${context.title}`, message:`Здравствуйте! Предлагаем обсудить роль «${context.title}» в нашей компании.`};
}

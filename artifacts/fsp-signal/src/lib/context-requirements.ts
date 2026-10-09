import { exactDictionaryOption, normalizeDictionaryText, type DictionaryOption } from './professional-dictionaries';

export type RequirementMode = 'verified' | 'declared_or_verified';
export type RequirementLevel = 'Junior' | 'Middle' | 'Senior';
const levelledSkillIds = new Set(['python','sql','typescript','react','backend-engineering','frontend-engineering']);
export function supportsRequirementLevel(skill:string,dictionary:readonly DictionaryOption[]=[]):boolean {
  const raw=skill.replace(/^(skill|raw):/,'');
  const option=exactDictionaryOption(dictionary,raw);
  const key=normalizeDictionaryText(option?.id ?? option?.value ?? raw).replace(/ /g,'-');
  return levelledSkillIds.has(key==='py'?'python':key==='ts'?'typescript':key);
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
    return option?.id ? `skill:${option.id}` : normalizeDictionaryText(prefix === 'skill:' ? raw.replace(/-/g, ' ') : raw);
  };
  return skills.map(skill => {
    const existing = source.skillRequirements?.find(item => identity(item.skill) === identity(skill));
    const level = existing?.level ?? Object.entries(source.requiredSkillLevels ?? {}).find(([key]) => identity(key) === identity(skill))?.[1];
    const mode = existing?.mode ?? 'verified';
    return { skill, mode, ...(mode === 'verified' && level ? { level } : {}) };
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

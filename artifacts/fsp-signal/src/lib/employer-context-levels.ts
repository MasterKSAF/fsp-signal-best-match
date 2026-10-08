import { exactDictionaryOption, normalizeDictionaryText, type DictionaryOption } from './professional-dictionaries';

export type ContextSkillLevels = Record<string, 'Junior' | 'Middle' | 'Senior'>;
/** API keys are identities; editor controls use labels. Resolve both through
 * the same dictionary without rewriting a stored key into a custom skill. */
export function editorSkillLevels(skills: readonly string[], levels: ContextSkillLevels, dictionary: readonly DictionaryOption[] = []): ContextSkillLevels {
  const identity = (value: string) => {
    const prefix = value.startsWith('skill:') ? 'skill:' : value.startsWith('raw:') ? 'raw:' : '';
    const text = prefix ? value.slice(prefix.length) : value;
    const option = exactDictionaryOption(dictionary, text);
    return option?.id ? `skill:${option.id}` : normalizeDictionaryText(prefix === 'skill:' ? text.replace(/-/g, ' ') : text);
  };
  const result: ContextSkillLevels = {};
  const rank = {Junior: 1, Middle: 2, Senior: 3};
  for (const skill of skills) {
    const key = identity(skill);
    for (const [stored, level] of Object.entries(levels)) if (identity(stored) === key && (!result[skill] || rank[level] > rank[result[skill]])) result[skill] = level;
  }
  return result;
}

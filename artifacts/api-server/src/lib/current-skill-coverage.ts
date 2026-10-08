import { resolveSkill, canonicalSkillKey, SKILL_CATALOG_VERSION } from './skill-catalog';
import { skillModuleRegistry, skillModuleTemplates, skillContentFamilyId, SKILL_BANK_VERSION } from './skill-module-bank';
import { getSkillBankAvailability } from './skill-bank-availability';

export const CURRENT_SKILL_COVERAGE_VERSION = `${SKILL_CATALOG_VERSION}:${SKILL_BANK_VERSION}`;
/** Employer coverage describes the current module registry, not a candidate's
 * personal retry/exposure state or a historical broad assessment programme. */
export function currentSkillCoverage(raw: readonly string[], options: { enabled: boolean; disabled?: ReadonlySet<string> }) {
  return raw.filter(value=>value.trim()).map(value=>{
    const resolved=resolveSkill(value);
    const module=skillModuleRegistry.find(item=>[item.id,item.title].some(label=>canonicalSkillKey(label)===resolved.key));
    const levels=module?.availableLevels.map(level=>({level,...getSkillBankAvailability(module,level,{templates:skillModuleTemplates,disabled:options.disabled,contentFamilyId:skillContentFamilyId})}))??[];
    const availableLevels=options.enabled?levels.filter(item=>item.available).map(item=>item.level):[];
    const supported=availableLevels.length>0;
    return {...resolved,id:module?.id??resolved.id,label:module?.title??resolved.label,supported,
      program:module?.id??null,programVersion:module?SKILL_BANK_VERSION:null,availableLevels,
      evidence:supported?`Отдельная проверка ${module!.title}: ${availableLevels.join(', ')}.`:
        module?'Проверка этого навыка временно недоступна.':'Отдельная проверка этого навыка пока не предусмотрена.',
      action:supported?'skill_module' as const:'review_requirement' as const};
  });
}

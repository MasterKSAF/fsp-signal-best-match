/** Search only the identity already allowed by the application's current ACL. */
export function applicationNameMatches(candidate:{alias:string;publicName:string|null}|null,query:string) {
  const needle = query.trim().toLocaleLowerCase('ru-RU');
  if (!needle) return true;
  return !!candidate && [candidate.publicName,candidate.alias].some(name=>typeof name === 'string' && name.toLocaleLowerCase('ru-RU').includes(needle));
}

/** Apply the fresh account evidence only to this exact CV's current target.
 * Historical verifiedSkills, another CV and neighbouring technologies never
 * supply green chips. No exam answers or private evidence objects leave here. */
export function applicationSkillChips(target: SkillQualificationTarget, inputs: SkillQualificationInputs) {
  const bySkill = new Map<string, {label:string;status:'verified'|'declared';level?:'Junior'|'Middle'|'Senior'}>();
  for (const proof of getSkillQualification(target, inputs).skills) bySkill.set(canonicalSkillKey(proof.label), {label:proof.label,status:'verified',level:proof.level});
  for (const label of [...target.stack, ...target.skills]) if (label.trim() && !bySkill.has(canonicalSkillKey(label))) bySkill.set(canonicalSkillKey(label), {label:resolveSkill(label).label,status:'declared'});
  return [...bySkill.values()];
}
import { canonicalSkillKey, resolveSkill } from './skill-catalog';
import { getSkillQualification, type SkillQualificationInputs, type SkillQualificationTarget } from './skill-module-qualification';

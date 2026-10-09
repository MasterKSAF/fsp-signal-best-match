import { canonicalSkillKey, resolveSkill } from './skill-catalog';
import { skillModuleRegistry } from './skill-module-bank';

type ResumeSkills = { stack: readonly string[]; skills: readonly string[] };
type Coverage = readonly { skillId: string | null }[];

export const resumeSkillModule = (raw: string) => skillModuleRegistry.find(module =>
  module.id === resolveSkill(raw).id || module.id === raw.trim().toLowerCase() || module.title.toLowerCase() === raw.trim().toLowerCase());
export const resumeAffiliationKey = (raw: string) => {
  const module = resumeSkillModule(raw);
  return module ? `skill:${module.id}` : canonicalSkillKey(raw);
};
const relatedSkills = (resume: ResumeSkills, coverage: Coverage) =>
  [...resume.stack, ...resume.skills, ...coverage.flatMap(item => item.skillId ? [item.skillId] : [])];

/** Display affiliation shared by exact-CV passport and documents. Proof ownership,
 * qualification, matching and consent remain independent account/access rules. */
export function resumeAffiliatedSkillIds(resume: ResumeSkills, coverage: Coverage): string[] {
  return [...new Set(relatedSkills(resume, coverage).map(raw => resumeSkillModule(raw)?.id).filter((id): id is NonNullable<typeof id> => Boolean(id)))].sort();
}
export function resumeAffiliatedSkillKeys(resume: ResumeSkills, coverage: Coverage): string[] {
  return [...new Set(relatedSkills(resume, coverage).map(resumeAffiliationKey))].sort();
}

import type { CandidateResume } from './signal-resume';
import { canonicalSkillKey, resolveSkill } from './skill-catalog';

/** Five professional sections; identity, photo, contacts and optional education are not completeness penalties. */
export function resumeCompletion(row: Pick<CandidateResume,'title'|'specialization'|'summary'|'stack'|'skills'|'experience'|'projects'|'workFormat'>) {
  const sections = [
    { id: 'role', label: 'Роль и направление', completed: Boolean(row.title.trim() && row.specialization.trim()) },
    { id: 'summary', label: 'О себе', completed: Boolean(row.summary.trim()) },
    { id: 'skills', label: 'Стек и навыки', completed: row.stack.length + row.skills.length > 0 },
    { id: 'work', label: 'Опыт или проекты', completed: row.experience.length + row.projects.length > 0 },
    { id: 'conditions', label: 'Условия работы', completed: Boolean(row.workFormat.trim()) },
  ];
  return { completed: sections.filter(s => s.completed).length, total: sections.length, sections };
}
export function selectedSkillProgress(row: Pick<CandidateResume,'stack'|'skills'>, evidence: { label: string; level: string }[], availableLabels: string[]) {
  const selected = [...new Map([...row.stack, ...row.skills].map(label => [canonicalSkillKey(label), resolveSkill(label).label])).values()];
  const verified = new Map(evidence.map(item => [canonicalSkillKey(item.label), item]));
  const available = new Set(availableLabels.map(canonicalSkillKey));
  const items = selected.map(label => ({ label, verified: verified.has(canonicalSkillKey(label)), level: verified.get(canonicalSkillKey(label))?.level ?? null, supported: available.has(canonicalSkillKey(label)) }));
  return { confirmed: items.filter(item => item.verified).length, total: items.length, supported: items.filter(item => item.supported).length, unsupported: items.filter(item => !item.supported).length, items };
}

/** Recommendations expose only missing mandatory matrix modules, never an arbitrary list of optional tags. */
export function resumeRoleRecommendations(coverage:{skillId:string|null;level:string;covered:boolean}[],proofs:{skillId:string;level:string}[],modules:{id:string;label:string}[]) {
  return coverage.flatMap(item=>{
    const module=modules.find(module=>module.id===item.skillId);
    if(item.covered||!module)return[];
    const proof=proofs.find(proof=>proof.skillId===module.id);
    return[{skillId:module.id,label:module.label,level:item.level,verifiedLevel:proof?.level??null}];
  });
}

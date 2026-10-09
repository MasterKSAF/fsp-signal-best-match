import { canonicalSkillKey, resolveSkill } from './skill-catalog';
import { skillModuleRegistry } from './skill-module-bank';
import { getSkillQualification, skillLevelRank, type SkillEvidenceProjection, type SkillQualificationInputs, type SkillQualificationTarget } from './skill-module-qualification';
import { resumeAffiliatedSkillIds, resumeSkillModule as moduleFor } from './resume-skill-affiliation';

export type PassportResumeContext = SkillQualificationTarget & { id: number; title: string };
export type PassportSkillContext = { resumeId: number; state: 'declared' | 'recommended'; targetLevel: 'Junior' | 'Middle' | 'Senior' | null; reason: string | null };
export type PassportAccountSkill = { skillId: string | null; label: string; state: 'declared' | 'recommended'; resumeIds: number[]; contexts: PassportSkillContext[]; targetLevel: 'Junior' | 'Middle' | 'Senior' | null; verifiedLevel: 'Junior' | 'Middle' | 'Senior' | null };
const keyFor = (raw: string) => { const module = moduleFor(raw); return module ? `skill:${module.id}` : canonicalSkillKey(raw); };

/** Owner display affiliation only. Never narrows/revokes the account's proofs,
 * or changes employer matching and exact-CV access. */
export function passportRelatedSkillIds(resume: PassportResumeContext, inputs: SkillQualificationInputs): string[] {
  return resumeAffiliatedSkillIds(resume, getSkillQualification(resume, inputs).coverage);
}

/** Account projections never turn a neighbouring technology into a proof, or CV tags into category requirements. */
export function projectPassportAccountSkills(contexts: readonly PassportResumeContext[], inputs: SkillQualificationInputs, proofs: readonly SkillEvidenceProjection[]): PassportAccountSkill[] {
  const rows = new Map<string, PassportAccountSkill>();
  const proofFor = (raw: string) => proofs.find(p => keyFor(p.skillId) === keyFor(raw));
  for (const resume of contexts) {
    for (const raw of [...resume.stack, ...resume.skills]) {
      if (!raw.trim() || proofFor(raw)) continue;
      const key = keyFor(raw); const module = moduleFor(raw); const previous = rows.get(key);
      if (previous) { if (!previous.resumeIds.includes(resume.id)) previous.resumeIds.push(resume.id); if (!previous.contexts.some(c => c.resumeId === resume.id)) previous.contexts.push({ resumeId: resume.id, state: 'declared', targetLevel: null, reason: null }); }
      else rows.set(key, { skillId: module?.id ?? resolveSkill(raw).id, label: module?.title ?? resolveSkill(raw).label, state: 'declared', resumeIds: [resume.id], contexts: [{ resumeId: resume.id, state: 'declared', targetLevel: null, reason: null }], targetLevel: null, verifiedLevel: null });
    }
    const qualification = getSkillQualification(resume, inputs);
    for (const missing of qualification.coverage.filter(c => !c.covered && c.skillId)) {
      const module = skillModuleRegistry.find(m => m.id === missing.skillId); if (!module) continue;
      const key = keyFor(module.id); const previous = rows.get(key); const proof = proofFor(module.id);
      if (previous) {
        previous.state = 'recommended'; previous.targetLevel = !previous.targetLevel || skillLevelRank[missing.level] > skillLevelRank[previous.targetLevel] ? missing.level : previous.targetLevel;
        previous.verifiedLevel = proof?.level ?? null;
        if (!previous.resumeIds.includes(resume.id)) previous.resumeIds.push(resume.id);
        const local = previous.contexts.find(c => c.resumeId === resume.id);
        if (local) { local.state = 'recommended'; local.targetLevel = missing.level; local.reason = missing.reason; }
        else previous.contexts.push({ resumeId: resume.id, state: 'recommended', targetLevel: missing.level, reason: missing.reason });
      } else rows.set(key, { skillId: module.id, label: module.title, state: 'recommended', resumeIds: [resume.id], contexts: [{ resumeId: resume.id, state: 'recommended', targetLevel: missing.level, reason: missing.reason }], targetLevel: missing.level, verifiedLevel: proof?.level ?? null });
    }
  }
  return [...rows.values()].map(row => ({ ...row, resumeIds: row.resumeIds.sort((a, b) => a - b), contexts: row.contexts.sort((a, b) => a.resumeId - b.resumeId) })).sort((a, b) => a.label.localeCompare(b.label, 'ru'));
}

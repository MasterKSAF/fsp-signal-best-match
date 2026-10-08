/**
 * Personal bank availability is about a complete NEW form. It is deliberately
 * independent of retry clocks and saved-attempt continuation. Seen content is
 * never forgotten when a cooldown expires or a programme gets a new name.
 * This module accepts the bank's lineage resolver to avoid a bank/helper cycle.
 */
export type SkillAvailabilityTemplate = {
  id: string;
  contentFamilyId: string;
  skillId: string;
  level: string;
  competencyId: string;
};
type Module = { id: string; availableLevels: readonly string[]; competencies: readonly string[] };
export type SkillBankPoolInput = {
  templates: readonly SkillAvailabilityTemplate[];
  personalExposures?: ReadonlyMap<string, number>;
  disabled?: ReadonlySet<string>;
  contentFamilyId: (templateId: string) => string;
};
export type SkillBankAvailability = {
  available: boolean;
  reason: string | null;
  availabilityCode: 'unsupported_skill_level' | 'skill_bank_unavailable' | null;
};

export function skillFamilyExposureCounts(raw: ReadonlyMap<string, number> | undefined, contentFamilyId: (templateId: string) => string) {
  const counts = new Map<string, number>();
  for (const [id, count] of raw ?? []) {
    const family = contentFamilyId(id);
    counts.set(family, (counts.get(family) ?? 0) + count);
  }
  return counts;
}

/** Shared pool filter for the matrix, the issue guard, and the form selector. */
export function eligibleSkillTemplates<T extends SkillAvailabilityTemplate>(
  templates: readonly T[], skillId: string, level: string, competencyId: string,
  personalFamilies: ReadonlyMap<string, number>, disabled?: ReadonlySet<string>, contentFamilyId?: (id: string) => string,
) {
  const disabledFamilies = new Set([...disabled ?? []].map(id => contentFamilyId?.(id) ?? id));
  return templates.filter(t => t.skillId === skillId && t.level === level && t.competencyId === competencyId
    && !disabled?.has(t.id) && !disabledFamilies.has(t.contentFamilyId) && (level !== 'Senior' || !(personalFamilies.get(t.contentFamilyId) ?? 0)));
}

export function getSkillBankAvailability(module: Module | undefined, level: string, input: SkillBankPoolInput): SkillBankAvailability {
  if (!module || !module.availableLevels.includes(level)) {
    return { available: false, reason: 'Программа этого уровня недоступна.', availabilityCode: 'unsupported_skill_level' };
  }
  const personalFamilies = skillFamilyExposureCounts(input.personalExposures, input.contentFamilyId);
  const available = module.competencies.every(competencyId =>
    eligibleSkillTemplates(input.templates, module.id, level, competencyId, personalFamilies, input.disabled, input.contentFamilyId).length > 0);
  return { available, reason: available ? null : 'Новая форма временно недоступна.', availabilityCode: available ? null : 'skill_bank_unavailable' };
}

/** A saved snapshot remains resumable even if its families exhaust the new pool. */
export function findContinuableSkillAttempt<T extends { skillId: string; level: string; status: string; expiresAt: Date }>(
  rows: readonly T[], skillId: string, level: string, now: Date,
): T | undefined {
  return rows.find(a => a.skillId === skillId && a.level === level && a.status === 'active' && +a.expiresAt > +now);
}

/** Controlled aliases only. User text stays in the original profile/need arrays. */
export const SKILL_CATALOG_VERSION = 'signal-skills-v1';
type Skill = { id: string; label: string; aliases: readonly string[]; programs: readonly string[]; evidence: string };
const backend = ['Backend / Python'];
const frontend = ['Frontend / TypeScript'];
export const SKILL_CATALOG: readonly Skill[] = [
  { id: 'python', label: 'Python', aliases: ['py'], programs: backend, evidence: 'Успешная программа Backend / Python' },
  { id: 'sql', label: 'SQL', aliases: [], programs: backend, evidence: 'Критерий SQL и данные' },
  { id: 'postgresql', label: 'PostgreSQL', aliases: ['postgres'], programs: [], evidence: 'Нужна отдельная проверка PostgreSQL; общий SQL её не заменяет' },
  { id: 'api-contracts', label: 'API contracts', aliases: ['API-контракты', 'API контракты'], programs: backend, evidence: 'Критерий API-контракты' },
  { id: 'idempotency', label: 'Idempotency', aliases: ['Идемпотентность'], programs: backend, evidence: 'Критерий Идемпотентность' },
  { id: 'architecture', label: 'Architecture', aliases: ['Архитектура', 'Выбор архитектуры'], programs: backend, evidence: 'Критерий Выбор архитектуры' },
  { id: 'incident-diagnosis', label: 'Incident diagnosis', aliases: ['Диагностика инцидента'], programs: backend, evidence: 'Критерий Диагностика инцидента' },
  { id: 'replay-safety', label: 'Replay safety', aliases: ['Безопасность повторов'], programs: backend, evidence: 'Критерий Изменение условия' },
  { id: 'typescript', label: 'TypeScript', aliases: ['ts'], programs: frontend, evidence: 'Успешная программа Frontend / TypeScript' },
  { id: 'frontend-state', label: 'Frontend state', aliases: ['Состояние интерфейса'], programs: frontend, evidence: 'Критерий состояния интерфейса' },
  { id: 'accessibility', label: 'Accessibility', aliases: ['a11y', 'Доступность интерфейса', 'Доступность'], programs: frontend, evidence: 'Критерий доступности интерфейса' },
  { id: 'frontend-performance', label: 'Frontend performance', aliases: ['Производительность интерфейса'], programs: frontend, evidence: 'Критерий производительности интерфейса' },
  { id: 'frontend-architecture', label: 'Frontend architecture', aliases: ['Архитектура интерфейса'], programs: frontend, evidence: 'Критерий архитектуры интерфейса' },
  { id: 'async-ui', label: 'Async UI', aliases: ['Асинхронный интерфейс'], programs: frontend, evidence: 'Критерий асинхронного интерфейса' },
  ...['FastAPI', 'React', 'JavaScript', 'HTML', 'CSS', 'Redis', 'Kafka', 'Docker', 'MySQL', 'MongoDB'].map(label => ({ id: label.toLowerCase(), label, aliases: [] as string[], programs: [] as string[], evidence: `Отдельной проверки ${label} пока нет` })),
];
const normalized = (raw: string) => raw.normalize('NFKC').trim().toLocaleLowerCase('en-US').replace(/\s+/g, ' ');
/** The ECMAScript WhiteSpace + LineTerminator set, used by the SQL reader too.
 * Explicit characters avoid locale-dependent POSIX whitespace classifications. */
export const SKILL_SEARCH_WHITESPACE_PATTERN = '[\u0009-\u000D\u0020\u00A0\u1680\u2000-\u200A\u2028\u2029\u202F\u205F\u3000\uFEFF]+';
export const normalizeSkillSearchToken = normalized;
const byAlias = new Map(SKILL_CATALOG.flatMap(skill => [skill.id, skill.label, ...skill.aliases].map(alias => [normalized(alias), skill] as const)));
export function resolveSkill(raw: string) {
  const skill = byAlias.get(normalized(raw));
  return { raw, id: skill?.id ?? null, label: skill?.label ?? raw.trim(), key: skill ? `skill:${skill.id}` : `raw:${normalized(raw)}` };
}
export const canonicalSkillKey = (raw: string): string => resolveSkill(raw).key;
export function canonicalSkillLabels(raw: readonly string[]): string[] {
  return [...new Map(raw.filter(x => x.trim()).map(x => [canonicalSkillKey(x), resolveSkill(x).label])).values()];
}
export function skillSearchAliases(raw: string): string[] {
  const skill = byAlias.get(normalized(raw));
  return skill ? [skill.id, skill.label, ...skill.aliases].map(normalized) : [normalized(raw)];
}
export function skillCoverage(raw: readonly string[], specialization: string) {
  return raw.filter(x => x.trim()).map(value => {
    const resolved = resolveSkill(value);
    const skill = SKILL_CATALOG.find(x => x.id === resolved.id);
    const supported = Boolean(skill?.programs.includes(specialization));
    return { ...resolved, supported, program: supported ? specialization : null, evidence: supported ? skill!.evidence : skill?.programs.length ? `Это требование проверяется в программе ${skill.programs.join(', ')}` : skill?.evidence ?? 'Такое требование пока не входит в программы проверки', action: supported ? 'assessment' as const : 'review_requirement' as const };
  });
}

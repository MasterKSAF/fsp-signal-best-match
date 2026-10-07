import type { MatchCandidate, MatchNeed } from './signal-matching';

/** Frozen, hand-authored synthetic business labels. Never derived from the matcher. */
export const MATCH_CONTROL_VERSION = 'signal-matching-control-v2-2026-10-05';
export const MATCH_CONTROL_AT = new Date('2026-10-05T12:00:00Z');
const candidate = (userId: number, alias: string, grade: MatchCandidate['verifiedGrade'], verifiedSkills: string[], extra: Partial<MatchCandidate> = {}): MatchCandidate => ({
  userId, alias, specialization: 'Backend / Python', verifiedGrade: grade, verifiedScore: 85,
  verifiedSkills, stack: [], statedSkills: [], workFormat: 'Удалённо', salaryMin: 150000, salaryMax: 250000,
  salaryPeriod: 'month', salaryType: 'gross', latestAssessmentAt: new Date('2026-10-01T12:00:00Z'),
  hasFspHistory: false, visibility: 'pseudonymous', consentMatching: true, demoMode: true, ...extra,
});
export const MATCH_CONTROL_CANDIDATES: MatchCandidate[] = [
  candidate(1, 'Платформенные API', 'Middle', ['python', 'API-контракты', 'Идемпотентность'], { stack: ['FastAPI'], statedSkills: ['FastAPI'], verifiedScore: 83 }),
  candidate(2, 'SQL и транзакции', 'Senior', ['Python', 'SQL', 'Postgres', 'Architecture'], { salaryMin: 300000, salaryMax: 450000, latestAssessmentAt: new Date('2026-08-01T12:00:00Z') }),
  candidate(3, 'Начинающий разработчик', 'Junior', ['PYTHON', 'SQL'], { verifiedScore: 100 }),
  candidate(4, 'Сильное самоописание', null, [], { stack: ['Python', 'SQL', 'PostgreSQL', 'FastAPI'], statedSkills: ['Python', 'Architecture'], verifiedScore: null, latestAssessmentAt: null }),
  candidate(5, 'Только язык', 'Middle', ['Python'], { statedSkills: ['PostgreSQL', 'API contracts'], hasFspHistory: true }),
  candidate(6, 'Надёжность сервисов', 'Senior', ['Python', 'Incident diagnosis', 'Replay safety', 'Architecture'], { workFormat: 'Гибрид', salaryType: 'net' }),
  candidate(7, 'Фронтенд и доступность', 'Middle', ['TypeScript', 'Accessibility', 'Frontend state', 'Async UI'], { specialization: 'Frontend / TypeScript', stack: ['React'], verifiedScore: 100 }),
  candidate(8, 'Закрытый профиль', 'Senior', ['Python', 'SQL', 'PostgreSQL', 'API contracts'], { visibility: 'private' }),
  candidate(9, 'Отозвано согласие', 'Middle', ['Python', 'API contracts', 'SQL'], { consentMatching: false }),
  candidate(10, 'Другой пул', 'Middle', ['Python', 'API contracts', 'SQL'], { demoMode: false }),
  candidate(11, 'Нестандартная технология', 'Middle', ['Python', 'Q-Store'], { statedSkills: ['SQL'], latestAssessmentAt: null }),
  candidate(12, 'Исторический PostgreSQL', 'Middle', ['Python', 'PostgreSQL'], { latestAssessmentAt: new Date('2025-12-01T12:00:00Z'), workFormat: 'Офис' }),
  candidate(13, 'API и SQL', 'Middle', ['Python', 'API contracts', 'SQL'], { salaryMin: 2400000, salaryMax: 3600000, salaryPeriod: 'year' }),
  candidate(14, 'Инциденты и соревнования', 'Senior', ['python', 'Incident diagnosis', 'Architecture'], { hasFspHistory: true, latestAssessmentAt: new Date('2026-09-01T12:00:00Z') }),
  candidate(15, 'Новая категория', 'Middle', ['Python', 'SQL'], { latestAssessmentAt: new Date('2026-10-05T10:00:00Z'), verifiedScore: 83 }),
  candidate(16, 'Явное свидетельство фреймворка', 'Middle', ['Python', 'FastAPI'], { latestAssessmentAt: new Date('2026-07-01T12:00:00Z') }),
];
// Privacy labels are separate from relevance: hidden people cannot be false negatives.
export const MATCH_CONTROL_VISIBLE = [1, 2, 3, 4, 5, 6, 7, 11, 12, 13, 14, 15, 16];
const need = (grade: MatchNeed['grade'], requiredSkills: string[], desirableSkills: string[] = [], extra: Partial<MatchNeed> = {}): MatchNeed => ({ specialization: 'Backend / Python', grade, requiredSkills, desirableSkills, workFormat: 'Удалённо', salaryMin: 180000, salaryMax: 300000, salaryPeriod: 'month', salaryType: 'gross', ...extra });
export const MATCH_CONTROL_QUERIES: Array<{ id: string; purpose: string; need: MatchNeed; eligible: number[]; labels: Record<number, number> }> = [
  { id: 'api-synonyms', purpose: 'API платформы; контролируемые синонимы до допуска', need: need('Middle', ['PYTHON', 'api contracts'], ['Idempotency', 'SQL']), eligible: [1, 13], labels: { 1: 3, 13: 3 } },
  { id: 'postgres-legacy', purpose: 'Postgres: отдельное сохранённое свидетельство, а не общий SQL', need: need('Middle', ['python', 'postgres']), eligible: [2, 12], labels: { 2: 3, 12: 1 } },
  { id: 'junior-data', purpose: 'Junior — минимальный уровень; SQL и актуальность', need: need('Junior', ['Python', 'SQL'], ['Architecture']), eligible: [2, 3, 13, 15], labels: { 2: 2, 3: 2, 13: 3, 15: 3 } },
  { id: 'senior-recovery', purpose: 'Восстановление сервисов и история ФСП', need: need('Senior', ['Python', 'Incident diagnosis'], ['Replay safety', 'Architecture'], { workFormat: 'Гибрид', salaryType: 'net' }), eligible: [6, 14], labels: { 6: 3, 14: 2 } },
  { id: 'framework-boundary', purpose: 'Язык не подтверждает фреймворк', need: need('Middle', ['Python', 'FastAPI']), eligible: [16], labels: { 16: 2 } },
  { id: 'frontend-accessible', purpose: 'Отдельная специализация и a11y', need: need('Middle', ['typescript', 'a11y'], ['Async UI'], { specialization: 'Frontend / TypeScript' }), eligible: [7], labels: { 7: 3 } },
  { id: 'no-covered-witness', purpose: 'Непокрытое обязательное требование: пустой результат корректен', need: need('Junior', ['Python', 'Rust']), eligible: [], labels: {} },
  { id: 'unknown-exact', purpose: 'Неизвестные значения сохраняются без выдуманных синонимов', need: need('Middle', ['Python', 'Q-Store']), eligible: [11], labels: { 11: 2 } },
  { id: 'senior-api-empty', purpose: 'Пустой результат: категория обязательна, Junior100 не равен Senior', need: need('Senior', ['Python', 'API contracts']), eligible: [], labels: {} },
];

export const MATCH_CONTROL_RUBRIC = {
  version: 'matching-rubric-v2', frozenAt: '2026-10-05', source: 'team-authored-synthetic-with-AI-assistance',
  privacy: 'Only same-pool, visible, consenting candidates may be exposed. Checked separately from relevance.',
  eligibility: 'Exact specialization, verified category at least the minimum, and each mandatory skill explicitly evidenced. Only published controlled aliases are equivalent. Salary/work format influence explanation, not the hard gate.',
  relevance: { 0: 'No useful fit for the role', 1: 'Minimum admissible but material context/evidence limitations', 2: 'Useful role fit with a specific limitation', 3: 'Strong evidence for the actual role with suitable context' },
  limits: 'Labels predate this evaluation run, not the original algorithm. This is a regression suite, not independent market validation or a statistical holdout. No weights tuned from these results.',
};

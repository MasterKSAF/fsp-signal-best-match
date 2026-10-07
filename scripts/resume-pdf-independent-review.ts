/** Synthetic layout/Unicode fixtures only; no database, accounts, grades or runtime are changed. */
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import fs from 'node:fs';
import path from 'node:path';
import { emptyResume, SaveResumeSchema } from '../artifacts/api-server/src/lib/signal-resume-contract';
import { renderCandidateResumePdf, type ResumePdfProfile } from '../artifacts/api-server/src/lib/signal-resume-pdf';

const directory = path.resolve('outputs/release-0.5.0/pdf-preview');
await mkdir(directory, { recursive: true });
const sha = (value: Buffer | string) => createHash('sha256').update(value).digest('hex');
const source = 'artifacts/api-server/src/lib/signal-resume-pdf.ts';
const profile: ResumePdfProfile & { contactEmail: string; contactPhone: string } = {
  displayName: 'Мария Ёлкина', professionalAlias: 'qa-layout-candidate', specialization: 'Backend / Python', assumedGrade: 'Middle',
  verifiedGrade: null, verifiedSkills: [], stack: ['Python', 'PostgreSQL', 'FastAPI'], skills: ['Проектирование API'],
  yearsExperience: 4, workFormat: 'Удалённо', salaryMin: 180000, salaryMax: 240000, salaryPeriod: 'month', salaryType: 'net', latestAssessmentAt: null,
  qualificationSource: 'none', contactEmail: 'account-field-must-not-export@example.test', contactPhone: '+7-000-999-88-77',
};
const short = SaveResumeSchema.parse({ ...emptyResume(), summary: 'Пишу надёжные сервисы на Python. Работаю с SQL, тестированием и очередями. Café, naïve, Émile — Unicode сохраняется.', softSkills: ['Обратная связь', 'Самостоятельность'] });
const paragraph = 'Проектировала сервис приёма заявок и согласовала контракт API. Проверяла транзакции, повторы и права доступа; описывала изменения понятным языком. Команда измеряла задержки запросов и разбирала причины сбоев. Документировала решение и помогала коллегам поддерживать его. ';
const long = SaveResumeSchema.parse({ ...emptyResume(),
  summary: 'Многостраничная проверка — Ёж, ёлка, café, naïve, Émile, 180 000 ₽. Контакт в моём собственном тексте: self-authored@example.test. ' + paragraph.repeat(3),
  softSkills: ['Самостоятельность', 'Техническая коммуникация', 'Командная работа'],
  experience: Array.from({ length: 3 }, (_, index) => ({ company: `Тестовая организация ${index + 1}`, role: `Backend-разработчик ${index + 1}`, start: `202${index}-01`, end: `202${index + 1}-01`, description: `Начало опыта ${index + 1}. ${paragraph.repeat(4)} Конец опыта ${index + 1}.` })),
  projects: Array.from({ length: 2 }, (_, index) => ({ title: `Проект проверяемого API ${index + 1}`, role: 'Разработчик', description: `Начало проекта ${index + 1}. ${paragraph.repeat(4)} Конец проекта ${index + 1}.`, url: `https://example.test/project-${index + 1}` })),
  education: [{ institution: 'Условный технический университет', qualification: 'Информационные системы и технологии', start: '2015-09', end: '2019-06' }],
  portfolio: [{ title: 'Портфолио кандидата', url: 'https://example.test/portfolio' }, { title: 'Ссылка, указанная кандидатом', url: 'https://example.test/contact?author=self-authored' }],
  questionnaire: { version: 'backend-python-v1', industry: 'Информационные технологии', specialization: 'Backend / Python', answers: { python: 2, databases: 2, api: 2, testing: 2, reliability: 2, ownership: 2 } },
});
const fixtures = [
  { name: 'Resume-Unicode-Short-v050', profile, resume: short, date: new Date('2026-10-07T09:00:00Z'), expectedName: 'Мария Ёлкина', expectedDate: '07.10.2026', minimumPages: 1, maximumPages: 1, markers: ['Café, naïve, Émile', 'пока не подтверждена', 'Backend / Python'] },
  { name: 'Resume-Unicode-Multipage-v050', profile: { ...profile, displayName: 'Алексей Ширяев', specialization: 'Backend / Python', verifiedGrade: 'Middle', verifiedSkills: ['Python', 'SQL'], qualificationSource: 'assessment' as const, latestAssessmentAt: new Date('2026-10-06T10:00:00Z') }, resume: long, date: new Date('2026-10-08T09:00:00Z'), expectedName: 'Алексей Ширяев', expectedDate: '08.10.2026', minimumPages: 3, maximumPages: 9, markers: ['Ёж, ёлка, café, naïve, Émile', 'self-authored@example.test', 'Конец опыта 1.', 'Конец опыта 2.', 'Конец опыта 3.', 'Конец проекта 1.', 'Конец проекта 2.', 'Портфолио кандидата', 'https://example.test/portfolio', 'Источник категории: полная квалификационная программа Signal.', 'Практические задания компаний оцениваются отдельно', '180 000 ₽'] },
];
const results = [];
for (const fixture of fixtures) {
  const started = performance.now();
  const actualFontReads: Record<string, number> = {};
  const originalRead = fs.readFileSync;
  // Observe actual file opens in this isolated test process, restoring the
  // standard function even on error. No application font cache is introduced.
  fs.readFileSync = ((...args: Parameters<typeof fs.readFileSync>) => {
    const filename = String(args[0]);
    if (/Manrope-(Regular|SemiBold)\.ttf$/.test(filename)) {
      const basename = path.basename(filename);
      actualFontReads[basename] = (actualFontReads[basename] ?? 0) + 1;
    }
    return originalRead(...args);
  }) as typeof fs.readFileSync;
  let bytes: Buffer;
  try { bytes = await renderCandidateResumePdf(fixture.profile, fixture.resume, fixture.date); }
  finally { fs.readFileSync = originalRead; }
  assert.deepEqual(actualFontReads, { 'Manrope-Regular.ttf': 1, 'Manrope-SemiBold.ttf': 1 });
  assert.ok(bytes.subarray(0, 5).equals(Buffer.from('%PDF-')));
  const output = path.join(directory, `${fixture.name}.pdf`);
  await writeFile(output, bytes);
  results.push({ ...fixture, profile: undefined, resume: undefined, date: undefined, path: output, sha256: sha(bytes), bytes: bytes.length, elapsedMs: Math.round(performance.now() - started), actualFontReads, accountFieldsMustBeAbsent: [profile.contactEmail, profile.contactPhone], otherDocumentName: fixture.expectedName === 'Мария Ёлкина' ? 'Алексей Ширяев' : 'Мария Ёлкина' });
}
const reportPath = path.resolve('outputs/verification/assessment-purpose/resume-pdf-layout-inputs-v050.json');
await mkdir(path.dirname(reportPath), { recursive: true });
await writeFile(reportPath, JSON.stringify({ generatedAt: new Date().toISOString(), source, sourceSha256: sha(await readFile(source)), fixturesSynthetic: true, noDatabaseOrRuntimeChanges: true, noTimingSlaClaim: true, validatedBy: 'SaveResumeSchema', outputs: results }, null, 2));
process.stdout.write(JSON.stringify({ generated: results.length, reportPath, sourceSha256: sha(await readFile(source)) }) + '\n');

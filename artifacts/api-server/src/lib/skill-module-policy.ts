import { skillModulePolicy } from './skill-module-bank';
export type IssuedSkillPolicyRow = { skillId: string; level: string; status: string; startedAt: Date; submittedAt: Date | null };
/** Sliding-window issuance limits include abandoned forms; equality opens the exact boundary. */
export function skillIssueRestriction(rows: readonly IssuedSkillPolicyRow[], skillId: string, level: string, now: Date) {
  const daily = rows.filter(r => +r.startedAt > +now - 24 * 3600_000);
  const moduleDaily = daily.filter(r => r.skillId === skillId);
  const submitted = rows.filter(r => r.skillId === skillId && r.level === level && r.status === 'submitted' && r.submittedAt).sort((a, b) => +b.submittedAt! - +a.submittedAt!)[0];
  const limits: { at: number; reason: string; code: string }[] = [];
  if (submitted && +submitted.submittedAt! + skillModulePolicy.retryHours * 3600_000 > +now) limits.push({ at: +submitted.submittedAt! + skillModulePolicy.retryHours * 3600_000, reason: 'Повтор этого уровня навыка доступен через 24 часа после завершения.', code: 'module_retry' });
  if (daily.length >= skillModulePolicy.maxDailyIssues) limits.push({ at: +daily.sort((a, b) => +a.startedAt - +b.startedAt)[daily.length - skillModulePolicy.maxDailyIssues]!.startedAt + 24 * 3600_000, reason: 'Достигнут общий предел 8 новых проверок за 24 часа. Восстановление текущей попытки не расходует лимит.', code: 'account_issue_limit' });
  if (moduleDaily.length >= skillModulePolicy.maxModuleDailyIssues) limits.push({ at: +moduleDaily.sort((a, b) => +a.startedAt - +b.startedAt)[moduleDaily.length - skillModulePolicy.maxModuleDailyIssues]!.startedAt + 24 * 3600_000, reason: 'Достигнут предел 2 новых проверок одного навыка за 24 часа, включая истёкшие попытки и разные уровни.', code: 'module_issue_limit' });
  const restriction = limits.sort((a, b) => b.at - a.at)[0];
  return restriction ? { retryAt: new Date(restriction.at).toISOString(), error: restriction.reason, code: restriction.code } : null;
}

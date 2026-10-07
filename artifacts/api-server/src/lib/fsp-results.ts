import type { FspAchievement } from '../../../../lib/db/src/schema/signal-fsp';

export const FSP_RESULT_POLICY_VERSION = 'fsp-category-results-v1';
export type FspResult = 'participation' | 'prize' | 'win';
export type FspRankingSignal = {
  policyVersion: typeof FSP_RESULT_POLICY_VERSION;
  historyStatus: 'trusted_results' | 'unresolved_results' | 'unverified' | 'none';
  bestResult: FspResult | null;
  bonus: 0 | 1 | 2 | 3;
  source: 'synthetic_fixture' | null;
  synthetic: boolean;
  note: string;
};
export type FspRankingFacts = Omit<FspRankingSignal,'note'>;
const weights: Record<FspResult, 1 | 2 | 3> = { participation: 1, prize: 2, win: 3 };
export function compactFspSignal(value:FspRankingSignal|FspRankingFacts):FspRankingFacts {const {note:_note,...facts}=value as FspRankingSignal;return facts;}
export function presentFspSignal(facts:FspRankingFacts|undefined):FspRankingSignal {
  const value=facts??compactFspSignal(emptyFspSignal());
  return {...value,note:value.synthetic
    ? 'Demo: вымышленные результаты, не реестр ФСП. Участие +1, призовое место +2, победа +3; учитывается лучший результат. Это приоритет Signal только внутри одного направления и подтверждённого уровня, после соответствия требованиям и полного действующего экзамена. ФСП не заменяет грейд и обязательные навыки.'
    : value.historyStatus==='unverified'?'Источник спортивных результатов не подтверждён; эффекта на порядок нет.'
    : 'ФСП необязательна. Грейд и необходимые навыки подтверждаются отдельно в Signal.'};
}
export function emptyFspSignal(unverified = false): FspRankingSignal {
  return { policyVersion: FSP_RESULT_POLICY_VERSION, historyStatus: unverified ? 'unverified' : 'none', bestResult: null, bonus: 0, source: null, synthetic: false,
    note: unverified ? 'Спортивные результаты не подтверждены источником и не влияют на порядок.' : 'Без спортивной истории доступны проверка навыков и подбор; грейд и обязательные навыки остаются самостоятельными условиями.' };
}
/** Validate the complete small provider payload before trusting any of it.
 * Placement/rank and human-readable titles never imply prize or victory. */
export function validFspAchievements(value: unknown): value is FspAchievement[] {
  return Array.isArray(value) && value.length <= 128 && value.every(item => item && typeof item === 'object' && !Array.isArray(item)
    && Object.keys(item).every(key=>['id','title','event','occurredAt','kind','result'].includes(key))
    && ['id','title','event','occurredAt'].every(key => typeof item[key] === 'string' && item[key].length > 0 && item[key].length <= (key === 'id' ? 120 : key === 'occurredAt' ? 10 : 500))
    && /^\d{4}-\d{2}-\d{2}$/.test(item.occurredAt) && Number.isFinite(Date.parse(item.occurredAt)) && new Date(item.occurredAt).toISOString().slice(0,10) === item.occurredAt
    && ['participation','placement','rank'].includes(item.kind)
    && (item.result === undefined || ['participation','prize','win'].includes(item.result)));
}
/** Input must already have passed server connection/context/provenance checks. */
export function trustedFspResults(achievements: readonly FspAchievement[]): FspRankingSignal {
  if (!validFspAchievements(achievements)) return emptyFspSignal(true);
  let bestResult: FspResult | null = null;
  // MAX, never SUM: duplicated events and repeated participation cannot build
  // a stronger result. No event prestige, age or individual team credit is inferred.
  for (const item of achievements) {
    const result = item.result ?? (item.kind === 'participation' ? 'participation' : null);
    if (result && (!bestResult || weights[result] > weights[bestResult])) bestResult = result;
  }
  return { policyVersion: FSP_RESULT_POLICY_VERSION, historyStatus: bestResult ? 'trusted_results' : achievements.length ? 'unresolved_results' : 'none', bestResult,
    bonus: bestResult ? weights[bestResult] : 0, source: 'synthetic_fixture', synthetic: true,
    note: 'Demo: вымышленные результаты, не реестр ФСП. Участие +1, призовое место +2, победа +3; учитывается лучший результат. Это приоритет Signal только внутри одного направления и подтверждённого уровня, после соответствия требованиям и полного действующего экзамена. ФСП не заменяет грейд и обязательные навыки.' };
}
/** The matcher accepts only the normalized server signal. Old booleans,
 * user-entered identifiers and malformed numeric claims grant no effect. */
export function fspBonusForSignal(signal: FspRankingFacts | undefined, candidateIsDemo: boolean): 0 | 1 | 2 | 3 {
  if (!signal || !candidateIsDemo || signal.policyVersion !== FSP_RESULT_POLICY_VERSION || signal.historyStatus !== 'trusted_results'
    || signal.source !== 'synthetic_fixture' || signal.synthetic !== true || !signal.bestResult || !Object.hasOwn(weights,signal.bestResult)) return 0;
  return signal.bonus === weights[signal.bestResult] ? signal.bonus : 0;
}

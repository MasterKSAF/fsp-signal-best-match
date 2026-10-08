import { evidenceNoteForDisplay } from '../lib/qualification-presentation';
import { useQuery } from '@tanstack/react-query';
import { BadgeCheck, CircleHelp, Trophy } from 'lucide-react';
import { Link } from 'wouter';
import { api } from './product-enhancements';
import { InlineInfo } from './inline-info';

type CoverageItem = { raw: string; id: string | null; label: string; supported: boolean; program: string | null; evidence: string };
type Coverage = { catalogVersion: string; coverage: CoverageItem[] };
export type EvidenceProof = { skill: string; level?: string; candidateId: number; attemptId: number | null; programId: string | null; programVersion: string | null; templateId: string | null; templateVersion: string | number | null; criterionId: string | null; criterion: string | null; result: number | null; date: string | null; sourceType: 'signal_assessment' | 'signal_skill_module' | 'demo_example' | 'legacy_record' | 'company_task' | 'fsp'; limitation: string | null };
const sourceNames: Record<EvidenceProof['sourceType'], string> = { signal_assessment: 'Проверка навыков Signal', signal_skill_module: 'Отдельная проверка навыка Signal', demo_example: 'Demo · синтетический пример', legacy_record: 'Сохранённое подтверждение', company_task: 'Задание компании', fsp: 'Данные ФСП' };
export type SportingSignal = {policyVersion:'fsp-category-results-v1';historyStatus:'trusted_results'|'unresolved_results'|'unverified'|'none';bestResult:'participation'|'prize'|'win'|null;bonus:number;source:'synthetic_fixture'|null;synthetic:boolean;note:string};
const sportingResultNames={participation:'Участие',prize:'Призовое место',win:'Победа'};
export function FspSignalDetails({signal}:{signal?:SportingSignal|null}) {
  if(!signal||signal.historyStatus==='none')return null;
  return <details className="requirement-evidence fsp-signal-details"><summary><span><Trophy size={15}/>{signal.bestResult?sportingResultNames[signal.bestResult]:signal.historyStatus==='unverified'?'ФСП · источник не подтверждён':'ФСП · исход не уточнён'}{signal.synthetic&&<small> · Demo</small>}</span><span className="badge badge-neutral">{signal.bonus>0?`+${signal.bonus} в категории`:'Без эффекта'}</span></summary><div className="requirement-body"><p>{signal.note}</p><small>Категория — специализация и подтверждённый грейд. Это не прибавка к баллу соответствия, грейду или спортивный разряд.</small></div></details>;
}

export function EvidenceProofDetails({ proof }: { proof: EvidenceProof }) {
  return <div className="requirement-body"><dl><dt>Источник</dt><dd>{sourceNames[proof.sourceType]}</dd>{proof.attemptId !== null && <><dt>Проверка</dt><dd>№ {proof.attemptId} · {proof.programId === 'backend-python' ? 'Backend / Python' : proof.programId === 'frontend-typescript' ? 'Frontend / TypeScript' : proof.programId}</dd></>}{proof.criterion && <><dt>Что проверено</dt><dd>{proof.criterion}</dd></>}{proof.result !== null && <><dt>Результат критерия</dt><dd>{proof.result} / 100</dd></>}<dt>Дата</dt><dd>{proof.date ? new Date(proof.date).toLocaleDateString('ru-RU') : 'Не сохранена'}</dd></dl>{evidenceNoteForDisplay(proof.limitation) && <p className="muted">{evidenceNoteForDisplay(proof.limitation)}</p>}</div>;
}

export function RequirementCoverage({ requirements, specialization }: { requirements: string[]; specialization: string }) {
  const params = new URLSearchParams({ specialization, skills: requirements.join(',') });
  const query = useQuery({ queryKey: ['skill-coverage', specialization, requirements], queryFn: () => api<Coverage>(`/api/skills/coverage?${params}`), enabled: requirements.some(x => x.trim().length > 0), staleTime: 60000 });
  if (!requirements.some(x => x.trim())) return null;
  return <InlineInfo label="Как подтверждаются требования"><strong>Проверки навыков</strong>{query.isPending ? <span role="status"> Проверяем доступные программы…</span> : query.isError ? <span role="alert"> Не удалось загрузить программы. <button type="button" className="button text-button" onClick={() => query.refetch()}>Повторить</button></span> : <>{query.data?.coverage.map((item,index)=><span key={`${item.raw}-${index}`} style={{display:'block',marginTop:7}}><strong>{item.supported?<BadgeCheck size={14}/>:<CircleHelp size={14}/>} {item.label}</strong> — {item.evidence}</span>)}{query.data?.coverage.some(item=>!item.supported)&&<span style={{display:'block',marginTop:7}}>Указанный навык остаётся обязательным условием подбора.</span>}</>}</InlineInfo>;
}
export const SkillCoverage = RequirementCoverage;

type SearchStatus = Coverage & { eligibleCount: number; status: 'available' | 'unsupported_requirements' | 'no_verified_candidates' | 'invalid_requirements'; minimumGrade: string; note: string };
export function MatchSearchState({ needId, totalMatches, filteredCount, resetFilters }: { needId: number; totalMatches: number; filteredCount: number; resetFilters: () => void }) {
  const query = useQuery({ queryKey: ['matching-status', needId, totalMatches], queryFn: () => api<SearchStatus>(`/api/employer/needs/${needId}/matching-status`) });
  if (totalMatches > 0) return filteredCount ? null : <div className="empty-state"><h3>Кандидаты скрыты фильтрами</h3><p>В исходном подборе {totalMatches} профилей. Условия потребности сохранены.</p><button className="button secondary" onClick={resetFilters}>Сбросить фильтры</button></div>;
  if (query.isPending) return <p role="status">Проверяем причину пустого подбора…</p>;
  if (query.isError) return <div role="alert"><p>Не удалось загрузить покрытие требований.</p><button className="button secondary" onClick={() => query.refetch()}>Повторить</button></div>;
  const unsupported = query.data?.coverage.filter(x => !x.supported) ?? [];
  if (query.data?.status === 'invalid_requirements') return <div className="empty-state" role="alert"><CircleHelp size={26}/><h3>Уточните обязательные навыки</h3><p>{query.data.note}</p><Link className="button secondary" href="/employer">Создать запрос</Link></div>;
  return <div className="empty-state"><CircleHelp size={26}/><h3>{unsupported.length ? 'Для части требований пока нет проверки' : 'Нет кандидатов со всеми подтверждениями'} <InlineInfo label="О требованиях запроса">Неподтверждённые навыки не заменяют обязательные. Можно создать новый запрос с другим списком требований; текущий останется в истории.</InlineInfo></h3><p>{unsupported.length ? unsupported.map(x => `${x.label}: ${x.evidence}`).join('. ') : `Нужны подтверждённые обязательные навыки и категория не ниже ${query.data?.minimumGrade}.`}</p><Link className="button secondary" href="/employer">К запросам на подбор</Link></div>;
}

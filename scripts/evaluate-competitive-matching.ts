import { mkdir, writeFile } from 'node:fs/promises';
import { runCompetitiveMatchingQuality, COMPETITIVE_METHODS } from '../artifacts/api-server/src/lib/matching-competitive-quality';

const report = runCompetitiveMatchingQuality();
await mkdir('outputs/quality',{recursive:true});
await writeFile('outputs/quality/matching-competitive-v2-report.json',JSON.stringify(report,null,2)+'\n');
const format = (value:number|null) => value===null?'not_defined':value.toFixed(4);
const lines = [
  '# Конкурентный контроль подбора: фактический локальный результат', '',
  `Дата измерения: ${report.measurementAt}. Алгоритм: \`${report.algorithmVersion}\`; контроль: \`${report.datasetVersion}\`.`,
  `SHA256 данных: \`${report.datasetSha256}\`. Метки: ${report.annotationSource}.`,
  '', 'Это синтетический содержательный контроль; человеческая экспертиза и реальный найм не измерены. Исходные данные, метки и разделы не изменены. Политика QA-01/01b исправлена после содержательной проверки уже измеренных контрпримеров; конечные результаты являются регрессионной проверкой, а не неиспользованным holdout.', '',
  `Всего: ${report.summary.queries} потребностей, ${report.summary.admission.pairs} пар, ${report.summary.admission.expectedEligible} допустимых. Ошибки исключения: ${report.summary.admission.falseExclusions.length}; допуска: ${report.summary.admission.falseAdmissions.length}; приватности: ${report.summary.admission.privacyViolations.length}.`,
  '', '| Метод | P@5 все 9 | nDCG@5 все определённые | Неопределённые nDCG |', '| --- | ---: | ---: | ---: |',
  ...COMPETITIVE_METHODS.map(method=>{
    const m = report.summary.methods[method];
    return `| ${method} | ${format(m.precisionAt5.value)} | ${format(m.ndcgAt5.value)} | ${m.ndcgAt5.undefined}/${m.ndcgAt5.total} |`;
  }),
  '', '| Потребность | Раздел | Допустимых | Signal P@5 | Signal nDCG@5 | Old v3 nDCG@5 | Без результата nDCG@5 |', '| --- | --- | ---: | ---: | ---: | ---: | ---: |',
  ...report.byQuery.map(q=>`| ${q.queryId} | ${q.split} | ${q.expectedEligibleIds.length} | ${format(q.methods.signal.endToEnd.precisionAt5)} | ${format(q.methods.signal.endToEnd.ndcgAt5)} | ${format(q.methods['old-v3'].endToEnd.ndcgAt5)} | ${format(q.methods['without-test-result'].endToEnd.ndcgAt5)} |`),
  '', 'Полные порядки всех методов, оценки/группы, pair-причины и срезы сохранены в JSON. Ранжирование Signal использует один comparator с production, без evaluator-ID исключений.',
  '', '## Чувствительность', '', ...Object.entries(report.diagnostics.checks).map(([key,value])=>`- ${key}: ${value?'PASS':'NOT DETECTED'}`),
  `- Строковая регрессия на эквивалентных синонимах исключила ${report.diagnostics.aliasRegressionFalseExclusions.length} допустимых пар.`,
  '', '## Все проигрыши сохраняются', '',
  ...report.comparisons.oldV3.filter(x=>x.ndcgAt5!==null&&x.ndcgAt5<0).map(x=>`- ${x.queryId}: Signal − old-v3 nDCG@5 = ${format(x.ndcgAt5)}.`),
  ...report.comparisons.keywordBaseline.filter(x=>x.ndcgAt5!==null&&x.ndcgAt5<0).map(x=>`- ${x.queryId}: Signal − keyword-baseline nDCG@5 = ${format(x.ndcgAt5)}.`),
  '', '## Ограничения', '', ...report.limitations.map(value=>`- ${value}`), '',
];
await writeFile('outputs/quality/matching-competitive-v2-report.md',lines.join('\n'));
const quote=(value:unknown)=>'"'+String(value).replaceAll('"','""')+'"';
const rows=[['query_id','split','kind','candidate_id','expected_eligible','actual_eligible','privacy_permitted','relevance','reason']];
for(const q of report.byQuery)for(const p of q.pairRows)rows.push([q.queryId,q.split,q.kind,String(p.candidateId),String(p.expectedEligible),String(p.actualEligible),String(p.privacyPermitted),String(p.relevance),p.labelReason]);
await writeFile('outputs/quality/matching-competitive-v2-pairs.csv','\ufeff'+rows.map(r=>r.map(quote).join(',')).join('\r\n')+'\r\n');
console.log(JSON.stringify({dataset:report.datasetVersion,algorithm:report.algorithmVersion,summary:report.summary,diagnostics:report.diagnostics.checks},null,2));

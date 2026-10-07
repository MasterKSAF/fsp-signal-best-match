import { getGetQualityReportQueryKey, useGetQualityReport, type QualityMeasurement, type QualityMetric, type QualitySlice } from '@workspace/api-client-react';
import { CircleHelp, FlaskConical, History, ShieldCheck } from 'lucide-react';

const measuredAt = (value: string | null) => value ? new Date(value).toLocaleString('ru-RU') : 'Не зафиксировано';
const admissionRatio = (numerator: number | null, denominator: number | null) => numerator === null || denominator === null
  ? 'Не измерено' : denominator === 0 ? `Не определено (ошибок ${numerator}, примеров 0)` : `${numerator}/${denominator}`;
function MetricValue({ metric }: { metric: QualityMetric }) {
  return <><strong className="mono">{metric.value === null ? '—' : metric.value.toFixed(3)}</strong><br/><small>{metric.defined}/{metric.total} запросов; не определено: {metric.undefined}{metric.denominator === null ? '' : ` · ${metric.numerator}/${metric.denominator} позиций`}</small></>;
}
function QualitySliceView({ slice }: { slice: QualitySlice }) {
  const admission = slice.admission;
  return <details className="requirement-evidence" open={slice.id === 'all'}><summary><b>{slice.label}</b><span>{slice.queries} запросов</span></summary><div className="requirement-body">
    <p>Пар: {admission.pairs}; допустимых: {admission.expectedEligible}. Ошибочное исключение: {admissionRatio(admission.falseExclusions,admission.expectedEligible)}; ошибочный допуск: {admissionRatio(admission.falseAdmissions,admission.permittedNegative)}; раскрытие исключённых по приватности: {admissionRatio(admission.privacyViolations,admission.privacyExcluded)}.</p>
    <div className="table-scroll"><table className="quality-table"><caption>{slice.label}: средние по запросам только этого среза. В каждой ячейке указан собственный знаменатель.</caption><thead><tr><th>Метод</th><th>Precision@5</th><th>nDCG@5</th><th>Полнота релевантных в top-5</th><th>Полнота релевантных во всей выдаче</th><th>Неожиданно пустых</th></tr></thead><tbody>{slice.methods.map(method => <tr key={method.method}><th>{method.label}</th><td><MetricValue metric={method.precisionAt5}/></td><td><MetricValue metric={method.ndcgAt5}/></td><td><MetricValue metric={method.relevantRecallAt5}/></td><td><MetricValue metric={method.relevantRecallAll}/></td><td>{method.unexpectedEmpty}</td></tr>)}</tbody></table></div>
  </div></details>;
}
function QualityMeasurementView({ report, historical = false }: { report: QualityMeasurement; historical?: boolean }) {
  return <section className="panel evaluation-panel"><div className="panel-heading"><h2>{report.title}</h2><span className={`badge badge-${historical ? 'neutral' : 'verified'}`}>{historical ? 'Историческое измерение' : 'Сохранённое измерение'}</span></div>
    <dl><dt>Набор данных</dt><dd>{report.datasetVersion}</dd><dt>SHA256 набора</dt><dd style={{overflowWrap:'anywhere'}}><code>{report.datasetSha256}</code></dd><dt>Алгоритм</dt><dd>{report.algorithmVersion}</dd><dt>SHA256 алгоритма</dt><dd style={{overflowWrap:'anywhere'}}><code>{report.algorithmSha256 ?? 'Не зафиксирован'}</code></dd><dt>Измерение выполнено</dt><dd>{measuredAt(report.measuredAt)}</dd><dt>Часы моделирования свежести</dt><dd>{measuredAt(report.evaluationClock)}</dd><dt>Версия оценщика</dt><dd>{report.evaluatorVersion}</dd><dt>SHA256 оценщика</dt><dd style={{overflowWrap:'anywhere'}}><code>{report.evaluatorSha256 ?? 'Не зафиксирован'}</code></dd><dt>SHA256 исходного отчёта</dt><dd style={{overflowWrap:'anywhere'}}><code>{report.sourceReportSha256}</code></dd></dl>
    <p className="muted">{report.measurementNotice}</p><p><b>Происхождение разметки:</b> {report.annotationSource}. {report.labelProvenance}</p><p className="muted">{report.splitPolicy}</p>
    <p>Precision@{report.k}: релевантность не ниже {report.relevantAtLeast}; знаменатель — {report.k} на запрос, включая короткие и пустые пулы. nDCG@{report.k}: gain = {report.ndcgGain}. Пустой идеальный рейтинг даёт неопределённое значение, которое не заменяется нулём или единицей. Усреднение — по определённым запросам; их количество видно рядом с каждым показателем.</p>
    <p><b>Проверка людьми: {report.humanValidation.status === 'not_measured' ? 'не проведена' : 'измерена'}.</b> Участников: {report.humanValidation.participants}; экспертов: {report.humanValidation.expertReviewers}. {report.humanValidation.notice}</p>
    {report.slices.map(slice => <QualitySliceView key={slice.id} slice={slice}/>)}
    <details className="requirement-evidence"><summary>Ограничения измерения</summary><div className="requirement-body">{report.limitations.map((item,index) => <p className="muted" key={index}>{item}</p>)}</div></details>
  </section>;
}

export function QualityPage() {
  const query = useGetQualityReport({query:{queryKey:getGetQualityReportQueryKey(),retry:false}});
  const report = query.data;
  const states = {current:'Отчёт соответствует текущему алгоритму', stale:'Отчёт устарел', missing:'Текущее измерение отсутствует', invalid:'Целостность отчёта не подтверждена'};
  return <><div className="page-title"><div><h1>Методика и проверка качества</h1><p>Проверка навыков и подбор: сохранённые контрольные измерения, происхождение данных и ограничения.</p></div><FlaskConical size={30}/></div>
    {query.isLoading ? <div className="state-panel" role="status">Загружаем отчёт…</div> : query.isError ? <div className="state-panel" role="alert"><p>Отчёт сейчас недоступен. Точность подбора здесь не заявляется.</p><button className="button secondary" onClick={() => query.refetch()}>Повторить</button></div> : report && <>
      <section className="panel quality-limitations"><div className="panel-heading"><h2>{states[report.status]}</h2><ShieldCheck size={21}/></div>{report.notices.map(notice => <p key={notice}><CircleHelp size={16}/>{notice}</p>)}<p>Текущий алгоритм: <code>{report.runtimeAlgorithmVersion}</code></p><p style={{overflowWrap:'anywhere'}}>SHA256 текущего алгоритма: <code>{report.runtimeAlgorithmSha256}</code></p><small>Представление построено {measuredAt(report.renderedAt)}. Безопасный агрегат: {report.aggregateVersion ?? 'отсутствует'}; собран {measuredAt(report.aggregateBuiltAt)}.</small>{report.aggregateSha256 && <p style={{overflowWrap:'anywhere'}}><small>Версия схемы: {report.schemaVersion}; SHA256 агрегата: <code>{report.aggregateSha256}</code></small></p>}</section>
      {report.current.map(measurement => <QualityMeasurementView key={measurement.id} report={measurement}/>)}
      {!!report.history.length && <details className="panel quality-checks"><summary><History size={18}/> История измерений · {report.history.length}</summary><p>Эти результаты относятся к прежним версиям или исходникам алгоритма. Они не являются показателями текущего подбора.</p>{report.history.map((measurement,index) => <QualityMeasurementView key={`${measurement.id}-${index}`} report={measurement} historical/>)}</details>}
    </>}
  </>;
}

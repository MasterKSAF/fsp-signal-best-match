"""Publish only whitelisted aggregates from measured reports, never fixtures.

Usage: python scripts/publish-quality-report.py --current REPORT (repeatable)
       --historical REPORT --legacy outputs/quality/control-report.json
"""
import argparse
from datetime import datetime, timezone
import hashlib
import json
from pathlib import Path
import subprocess

ROOT = Path(__file__).resolve().parents[1]
METHODS = {'signal': 'Signal', 'keyword-baseline': 'Поиск по ключевым словам',
           'old-v3': 'Исторический алгоритм v3', 'old-v4': 'Исторический алгоритм v4',
           'random': 'Фиксированный случайный порядок', 'reverse': 'Обратный порядок Signal',
           'without-test-result': 'Без результата проверки навыков', 'baseline': 'Поиск по ключевым словам'}

def digest(data): return hashlib.sha256(data).hexdigest()
def canonical(value):
    return json.dumps(value, sort_keys=True, ensure_ascii=False, separators=(',', ':')).encode('utf-8')
def read(path):
    data = path.read_bytes()
    return json.loads(data.decode('utf-8-sig')), digest(data)
def mean_metric(values, numerator=None, denominator=None):
    defined = [value for value in values if value is not None]
    assert all(isinstance(value, (int, float)) and 0 <= value <= 1 for value in defined)
    return {'value': sum(defined) / len(defined) if defined else None,
            'defined': len(defined), 'undefined': len(values) - len(defined), 'total': len(values),
            'numerator': numerator, 'denominator': denominator,
            'aggregation': 'macro: arithmetic mean of defined query values; undefined queries retained in counts'}
def count(value): return len(value) if isinstance(value, list) else int(value)

def public_control_usage(metadata):
    """Only the explicitly public lifecycle string, no arbitrary report data."""
    usage = metadata.get('controlUsage')
    value = usage.get('currentUse') if isinstance(usage, dict) else metadata.get('currentUse')
    if value is None:
        return ''
    assert isinstance(value, str) and value.strip() and len(value) <= 500, 'Invalid public currentUse'
    return ' Current control use: ' + value.strip() + '.'

def aggregate_admission(rows, legacy=False):
    if legacy:
        return {'pairs': sum(row['pairs'] for row in rows),
                'expectedEligible': sum(row['eligibleCount'] for row in rows),
                **{key: None for key in ['falseExclusions', 'permittedNegative', 'falseAdmissions', 'privacyExcluded', 'privacyViolations']}}
    def admission(row):
        data = row['admission']
        hidden = data.get('hidden', data.get('privacyNegativeDenominator'))
        assert hidden is not None, 'Privacy denominator missing; do not invent it'
        negative = data.get('permittedNegative', data['pairs'] - data['expectedEligible'] - hidden)
        assert negative >= 0 and hidden >= 0
        return {'pairs': data['pairs'], 'expectedEligible': data['expectedEligible'],
                'falseExclusions': count(data['falseExclusions']), 'permittedNegative': negative,
                'falseAdmissions': count(data['falseAdmissions']), 'privacyExcluded': hidden,
                'privacyViolations': count(data['privacyViolations'])}
    admitted = [admission(row) for row in rows]
    return {key: sum(row[key] for row in admitted) for key in ['pairs', 'expectedEligible', 'falseExclusions',
        'permittedNegative', 'falseAdmissions', 'privacyExcluded', 'privacyViolations']}

def slice_report(rows, slice_id, label, method_names, legacy=False):
    methods = []
    for method in method_names:
        metrics = [row['methods'][method]['endToEnd'] for row in rows]
        denominators = [m['precisionAt5Denominator'] for m in metrics]
        assert all(value == 5 for value in denominators), 'Unexpected P@5 denominator'
        methods.append({'method': method, 'label': METHODS[method],
            'precisionAt5': mean_metric([m['precisionAt5'] for m in metrics],
                sum(m['precisionAt5Numerator'] for m in metrics) if rows else None,
                sum(denominators) if rows else None),
            'ndcgAt5': mean_metric([m['ndcgAt5'] for m in metrics]),
            'relevantRecallAt5': mean_metric([m.get('relevantRecallAt5') for m in metrics]),
            'relevantRecallAll': mean_metric([m.get('relevantRecallAll') for m in metrics]),
            'unexpectedEmpty': sum(bool(m.get('unexpectedEmpty', False)) for m in metrics)})
    return {'id': slice_id, 'label': label, 'queries': len(rows),
            'admission': aggregate_admission(rows, legacy), 'methods': methods}

def legacy_measurement(path):
    source, source_hash = read(path)
    fixtures_path = ROOT / 'outputs/quality/control-fixtures.json'
    fixtures, fixtures_hash = read(fixtures_path)
    pairs = {row['id']: len(row['candidates']) for row in fixtures}
    rows = []
    for query in source['byQuery']:
        methods = {}
        for method in ['signal', 'baseline']:
            metrics = query[method]
            # A stored control snapshot has no reliable wall-clock measurement
            # timestamp. Its generatedAt is explicitly the simulation clock.
            methods[method] = {'endToEnd': {**metrics,
                'precisionAt5Numerator': round(metrics['precisionAt5'] * 5), 'precisionAt5Denominator': 5}}
        rows.append({**query, 'pairs': pairs[query['queryId']], 'methods': methods})
    assert len(rows) == 8 and source['totalPairs'] == sum(row['pairs'] for row in rows)
    return {'id': 'historical-small-control-v1', 'title': 'История: первоначальный небольшой контроль',
        'datasetVersion': source['datasetVersion'], 'datasetSha256': fixtures_hash,
        'algorithmVersion': source['algorithmVersion'], 'algorithmSha256': None,
        'evaluatorVersion': 'historical-signal-control-v1', 'evaluatorSha256': None,
        'sourceReportSha256': source_hash, 'measuredAt': None,
        'measurementNotice': 'Фактическое время измерения и SHA исходников алгоритма не зафиксированы. generatedAt старого отчёта — заданные часы моделирования, поэтому он не является актуальным измерением.',
        'evaluationClock': source['generatedAt'], 'annotationSource': source['annotationSource'],
        'labelProvenance': source['labelMethod'], 'splitPolicy': source['split'],
        'k': 5, 'relevantAtLeast': 2, 'precisionDenominator': '5 for each query, including short and empty pools',
        'ndcgGain': '2^relevance - 1',
        'humanValidation': {'status': 'not_measured', 'participants': 0, 'expertReviewers': 0,
            'notice': 'Синтетические ожидания команды с помощью ИИ; человеческая оценка и реальный найм не измерены.'},
        'slices': [slice_report(rows, 'all', 'Все 8 первоначальных сценариев', ['signal', 'baseline'], True)]
          + [slice_report([row for row in rows if row['split'] == split], 'split-' + split,
              'Первоначальные ' + split, ['signal', 'baseline'], True) for split in ['development', 'control-holdout']],
        'limitations': [value.replace('КАЛИБР', 'Проверка навыков') for value in source['limitations']]
          + ['Это исторический небольшой контроль с общими архетипами. Его показатели не заменяют конкурентный контроль.',
             'Ошибки допуска и приватности для этого исторического снимка отдельно не измерены; null означает отсутствие измерения.']}

def measurement(path):
    source, source_hash = read(path)
    metadata = source.get('meta', source)
    rows = source['byQuery']
    assert rows, 'Empty report is not an executed control'
    names = list(rows[0]['methods'])
    assert all(set(row['methods']) == set(names) for row in rows)
    assert set(names) <= set(METHODS), 'Unsupported method; do not silently discard it'
    report = {'id': metadata['datasetVersion'] + ':' + metadata['algorithmVersion'],
        'title': 'Межгрупповой контроль' if 'intergroup' in metadata['datasetVersion'] else 'Конкурентный контроль',
        **{key: metadata[key] for key in ['datasetVersion', 'datasetSha256', 'algorithmVersion', 'algorithmSha256', 'evaluatorVersion', 'evaluatorSha256']},
        'sourceReportSha256': source_hash, 'measuredAt': metadata['measurementAt'],
        'measurementNotice': 'Фактическое время выполнения сохранённого локального измерения; часы оценки свежести указаны отдельно.',
        'evaluationClock': metadata['evaluationClock'],
        'annotationSource': metadata.get('annotationSource', source.get('annotationSource', 'AI-authored synthetic business judgements; no human expert or participant')),
        'labelProvenance': metadata.get('rubric', source.get('rubric', {})).get('provenance', 'AI-authored synthetic business judgements; no human expert or participant'),
        'splitPolicy': metadata.get('rubric', source.get('rubric', {})).get('holdout', 'Scenario-level synthetic holdout; not independent human or market observations')
          + public_control_usage(metadata),
        'k': 5, 'relevantAtLeast': 2, 'precisionDenominator': '5 for each query, including short and empty pools',
        'ndcgGain': '2^relevance - 1',
        'humanValidation': {'status': 'not_measured', 'participants': 0, 'expertReviewers': 0,
            'notice': 'Нет независимой человеческой разметки или наблюдений найма; модельный контроль не является исследованием людей.'},
        'slices': [slice_report(rows, 'all', 'Все запросы этого набора', names)],
        'limitations': source.get('limitations', metadata.get('limitations', []))}
    for kind, title in [('competitive', 'Конкурентные пулы'), ('short', 'Короткие пулы'), ('empty', 'Пустые пулы')]:
        report['slices'].append(slice_report([row for row in rows if row['kind'] == kind], 'kind-' + kind, title, names))
    for split, title in [('development', 'Development: проверка при разработке'), ('control-holdout', 'Control-holdout: синтетический отложенный контроль')]:
        report['slices'].append(slice_report([row for row in rows if row['split'] == split], 'split-' + split, title, names))
    # Individual query aggregates retain visible losses; no IDs or works leave
    # the generator. A report never hides inconvenient queries by re-slicing.
    for index, row in enumerate(rows):
        report['slices'].append(slice_report([row], 'query-' + str(index + 1), row['queryId'] + ' · ' + row['split'] + ' · ' + row['kind'], names))
    assert report['measuredAt'] and report['algorithmSha256']
    return report

def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--current', type=Path, action='append', default=[])
    parser.add_argument('--historical', type=Path, action='append', default=[])
    parser.add_argument('--legacy', type=Path)
    parser.add_argument('--version', default='signal-quality-qa-cycle-01')
    parser.add_argument('--out', type=Path, default=ROOT / 'artifacts/api-server/src/lib/quality-public-report.json')
    args = parser.parse_args()
    manifest = {'schemaVersion': 'signal-public-quality-v1', 'aggregateVersion': args.version,
        'builtAt': datetime.now(timezone.utc).isoformat(timespec='milliseconds').replace('+00:00', 'Z'),
        'current': [measurement(path) for path in args.current],
        'history': [measurement(path) for path in args.historical]
          + ([legacy_measurement(args.legacy)] if args.legacy else [])}
    if manifest['current']:
        assert len({(row['algorithmVersion'], row['algorithmSha256']) for row in manifest['current']}) == 1, 'Current reports refer to different runtime sources'
    # Use the same ECMAScript number serialization as the runtime verifier.
    manifest['sha256'] = subprocess.check_output(['node', str(ROOT / 'scripts/quality-canonical-digest.mjs')],
        input=json.dumps(manifest, ensure_ascii=False).encode('utf-8')).decode('ascii')
    args.out.parent.mkdir(parents=True, exist_ok=True)
    args.out.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({'file': str(args.out), 'sha256': manifest['sha256'], 'current': len(manifest['current']), 'historical': len(manifest['history'])}))

if __name__ == '__main__': main()

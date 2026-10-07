"""Build OpenAPI quality DTOs; public statistics never include fixture rows."""
from pathlib import Path

path = Path(__file__).resolve().parents[1] / 'lib/api-spec/openapi.yaml'
text = path.read_text(encoding='utf-8')
start = text.index('    QualityEvaluation:\n')
end = text.index('    HealthStatus:\n', start)
text = text[:start] + '    QualityEvaluation:\n      $ref: "#/components/schemas/QualityReport"\n' + text[end:]
start = text.index('    QualityMetric:\n') if '    QualityMetric:\n' in text else text.index('    QualityReport:\n')
end = text.index('    ResumeQuestionnaire:\n', start)

def object_schema(name, properties):
    lines = [f'    {name}:', '      type: object', '      additionalProperties: false', '      required:']
    lines += [f'        - {key}' for key in properties]
    lines += ['      properties:']
    for key, body in properties.items():
        lines.append(f'        {key}:')
        lines += ['          ' + line for line in body.split('\n')]
    return '\n'.join(lines) + '\n'

string = 'type: string'
nullable_string = 'type:\n  - string\n  - "null"'
integer = 'type: integer\nminimum: 0'
nullable_ratio = 'type:\n  - number\n  - "null"\nminimum: 0\nmaximum: 1'
def enum(*items): return 'type: string\nenum:\n' + '\n'.join('  - ' + item for item in items)
def array(ref): return f'type: array\nitems:\n  $ref: "#/components/schemas/{ref}"'
strings = 'type: array\nitems:\n  type: string'
def ref(name): return f'$ref: "#/components/schemas/{name}"'
schema = object_schema('QualityMetric', {
    'value': nullable_ratio, 'defined': integer, 'undefined': integer, 'total': integer,
    'numerator': 'type:\n  - integer\n  - "null"\nminimum: 0',
    'denominator': 'type:\n  - integer\n  - "null"\nminimum: 0', 'aggregation': string,
})
schema += object_schema('QualityMethod', {'method': string, 'label': string,
    'precisionAt5': ref('QualityMetric'), 'ndcgAt5': ref('QualityMetric'),
    'relevantRecallAt5': ref('QualityMetric'), 'relevantRecallAll': ref('QualityMetric'),
    'unexpectedEmpty': integer})
nullable_integer = 'type:\n  - integer\n  - "null"\nminimum: 0'
schema += object_schema('QualityAdmission', {'pairs': integer, 'expectedEligible': integer,
    'falseExclusions': nullable_integer, 'permittedNegative': nullable_integer, 'falseAdmissions': nullable_integer,
    'privacyExcluded': nullable_integer, 'privacyViolations': nullable_integer})
schema += object_schema('QualitySlice', {'id': string, 'label': string, 'queries': integer,
    'admission': ref('QualityAdmission'), 'methods': array('QualityMethod')})
schema += object_schema('QualityHumanValidation', {'status': enum('not_measured', 'measured'),
    'participants': integer, 'expertReviewers': integer, 'notice': string})
schema += object_schema('QualityMeasurement', {'id': string, 'title': string,
    'datasetVersion': string, 'datasetSha256': string, 'algorithmVersion': string,
    'algorithmSha256': nullable_string, 'evaluatorVersion': string, 'evaluatorSha256': nullable_string,
    'sourceReportSha256': string, 'measuredAt': nullable_string, 'measurementNotice': string,
    'evaluationClock': nullable_string, 'annotationSource': string, 'labelProvenance': string,
    'splitPolicy': string, 'k': integer, 'relevantAtLeast': integer,
    'precisionDenominator': string, 'ndcgGain': string,
    'humanValidation': ref('QualityHumanValidation'), 'slices': array('QualitySlice'),
    'limitations': strings})
schema += object_schema('QualityReport', {
    'schemaVersion': enum('signal-public-quality-v1'), 'renderedAt': 'type: string\nformat: date-time',
    'runtimeAlgorithmVersion': string, 'runtimeAlgorithmSha256': string,
    'status': enum('current', 'stale', 'missing', 'invalid'),
    'aggregateVersion': nullable_string, 'aggregateBuiltAt': nullable_string,
    'aggregateSha256': nullable_string,
    'current': array('QualityMeasurement'), 'history': array('QualityMeasurement'), 'notices': strings,
})
path.write_text(text[:start] + schema + text[end:], encoding='utf-8')

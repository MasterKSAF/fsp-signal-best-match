"""Exact reviewed offline QA inputs; no recursive output-directory permission."""
from pathlib import Path
import hashlib

QA_SOURCE_REQUIRED_INPUTS = {
    'outputs/quality/qa-cycle-01/intergroup-control-v1.json': '602e7c230ebf7374a44c2cfc2a8ff47392f302aba27c30e3d6d0c4ce3c78c01a',
    'outputs/quality/qa-cycle-01/intergroup-control-freeze.json': '935a773649e9466b9807935cab2936bba07772d22d8695c9b7a336c617387adc',
    'outputs/quality/qa-cycle-01/traceability-regression-v1.json': '5bcf243f34c7f2be835d2759bdc20f67f63682724a14905487a3ad058824ccab',
    'outputs/quality/qa-cycle-01/traceability-regression-freeze.json': '8848bf5e7a18f420a534d239a6bb356aa2eda748cc80389a706571f78f2b871d',
    'outputs/quality/qa-cycle-01/traceability-quality-boundary-v1.json': 'd15d6d52aa0081f034c11b058ec331a7a1a4b314f1c9aa3eb5ae3d2a9f74be77',
    'outputs/quality/qa-cycle-01/traceability-quality-boundary-freeze.json': '512ff4c98a34870035a9a58329f70534051362f981896b1890ef39fedec68cb7',
    'outputs/verification/history/qa-cycle-01-before-traceability/artifacts/api-server/src/lib/signal-matching.ts': '054a9d7879cf622634cb4d6bc2d089f200268550547914ef954b23d883a2df1f',
    'outputs/verification/history/qa-cycle-01-before-traceability/artifacts/api-server/src/lib/skill-catalog.ts': '8d7b0ffede249af975713581771d188ae520b8f803c7e7840a72ec4b06473b39',
    'outputs/verification/history/qa-cycle-01-before-traceability/outputs/quality/qa-cycle-01/intergroup-control-v1-report.json': 'fd55fb5bd71995a3834bd35c92cac09a11f9937026f76cfcef3f57918e22fe0a',
}
QA_SOURCE_OPTIONAL_INPUTS = {
    'outputs/quality/qa-cycle-01/intergroup-control-v1-first-measurement.json': 'e8a73c7ab769b79847bf41b7cb65c5d1194d6393e5a28f91014604504f173ccc',
    'outputs/verification/history/qa-cycle-01-before-traceability/history-manifest.json': '95f48a949c0060d377872884dcad22f8b675e8698c1c7ba8e579723cb167ae82',
}
QA_SOURCE_ALLOWED_INPUTS = {**QA_SOURCE_REQUIRED_INPUTS, **QA_SOURCE_OPTIONAL_INPUTS}
QA_SOURCE_CURRENT_REPORT_INPUTS = {
    'outputs/quality/qa-cycle-01/intergroup-control-v1-report.json': 'd69471537bc6c7e5c6a8b9f2cdae4482e4f5ea0efc227787f702e8a4e785a298',
    'outputs/quality/qa-cycle-01/traceability-regression-v1-report.json': '775db0c7097375a6b1dae49b84e5fc8da8d30b2c98e06a409885b76ca1407a7b',
}
QA_SOURCE_REVIEWED_INPUTS = {**QA_SOURCE_ALLOWED_INPUTS, **QA_SOURCE_CURRENT_REPORT_INPUTS}
QA_SOURCE_CODE_INPUTS = {path: expected for path, expected in QA_SOURCE_ALLOWED_INPUTS.items() if path.endswith('.ts')}
QA_EVALUATOR_MARKERS = {'fsp-signal/scripts/evaluate-intergroup-control.ts', 'fsp-signal/scripts/evaluate-traceability-regression.ts'}

# 0.5.0 additive policy. The original 0.4.1 validator/counts remain unchanged.
# These two exact source files are the only additional output-directory TS
# dependencies imported by matching-bucket-append.test.ts.
QA_SOURCE_V050_ONLY_REQUIRED_INPUTS = {
    'outputs/verification/history/multi-resume-before-rank-append/artifacts/api-server/src/lib/signal-matching.ts': '5132063b3585b3e3c7a3cc98644287288058994c1e9b6b12a29ae016ab9bde44',
    'outputs/verification/history/multi-resume-before-rank-append/artifacts/api-server/src/lib/skill-catalog.ts': '3ef0c5ba605a0c7852fff4614c43c2d3aa2e79cb43e70dbd75f29ac3485a138f',
}

# 0.6.0 policy transition is additive: these are synthetic, pre-policy inputs
# and the exact v5 queue-optimisation source imported by current tests. No
# output-directory prefix or sibling permission is granted.
QA_SOURCE_V060_ONLY_REQUIRED_INPUTS = {
    'outputs/quality/0.6.0/fsp-category/before-policy.json': 'a09b6caad9509df6e5defd487087375494a12f939c2d37c7248a1ab4f8bddcb4',
    'outputs/quality/0.6.0/fsp-category/history/signal-matching.ts': '8d9564d2024c3ecd3d75f21eecf3dcd92fba986388b104a09a9ef40a745cccfe',
    'outputs/quality/0.6.0/fsp-category/history/skill-catalog.ts': '3ef0c5ba605a0c7852fff4614c43c2d3aa2e79cb43e70dbd75f29ac3485a138f',
}
QA_SOURCE_V060_ADDITIONAL_INPUTS = {**QA_SOURCE_V050_ONLY_REQUIRED_INPUTS, **QA_SOURCE_V060_ONLY_REQUIRED_INPUTS}


def validate_qa_source_inputs_v060(root: Path, include_current_reports=True):
    selected = validate_qa_source_inputs_v050(root, include_current_reports)
    workspace = root.resolve()
    for relative, expected in QA_SOURCE_V060_ONLY_REQUIRED_INPUTS.items():
        path = workspace / relative
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(workspace):
            raise ValueError('Required 0.6.0 frozen policy input missing/unsafe: ' + relative)
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Frozen 0.6.0 policy SHA mismatch: ' + relative)
        selected.append((path, Path(relative)))
    return selected


def validate_qa_source_inputs_v050(root: Path, include_current_reports=True):
    selected = validate_qa_source_inputs(root, include_current_reports)
    workspace = root.resolve()
    for relative, expected in QA_SOURCE_V050_ONLY_REQUIRED_INPUTS.items():
        path = workspace / relative
        if not path.is_file() or path.is_symlink() or not path.resolve().is_relative_to(workspace):
            raise ValueError('Required 0.5.0 golden input missing/unsafe: ' + relative)
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Frozen 0.5.0 golden SHA mismatch: ' + relative)
        selected.append((path, Path(relative)))
    return selected


def validate_qa_source_inputs(root: Path, include_current_reports=True):
    """Fail before sealing when mandatory inputs are absent or frozen bytes drift."""
    workspace = root.resolve()
    selected = []
    checked_inputs = QA_SOURCE_REVIEWED_INPUTS if include_current_reports else QA_SOURCE_ALLOWED_INPUTS
    for relative, expected in checked_inputs.items():
        path = workspace / relative
        if not path.is_file():
            if relative in QA_SOURCE_REQUIRED_INPUTS or relative in QA_SOURCE_CURRENT_REPORT_INPUTS:
                raise ValueError('Required offline QA input missing: ' + relative)
            continue
        if path.is_symlink() or not path.resolve().is_relative_to(workspace):
            raise ValueError('Unsafe offline QA input path: ' + relative)
        if hashlib.sha256(path.read_bytes()).hexdigest() != expected:
            raise ValueError('Frozen offline QA input SHA mismatch: ' + relative)
        selected.append((path, Path(relative)))
    return selected

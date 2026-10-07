"""Code-only QA07 preflight. Fabricated temporary archives, never submission ZIP."""
from pathlib import Path
from tempfile import TemporaryDirectory
import hashlib
import importlib.util
import json
import zipfile
import sys
from source_qa_inputs import QA_SOURCE_REQUIRED_INPUTS, QA_SOURCE_OPTIONAL_INPUTS, QA_SOURCE_ALLOWED_INPUTS, QA_SOURCE_CODE_INPUTS, QA_SOURCE_CURRENT_REPORT_INPUTS, QA_SOURCE_REVIEWED_INPUTS, validate_qa_source_inputs

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('source_privacy_qa07', ROOT / 'scripts/audit-source-privacy.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)


def digest(data):
    return hashlib.sha256(data).hexdigest()


def main():
    frozen_only = '--frozen-only' in sys.argv
    selected = validate_qa_source_inputs(ROOT, include_current_reports=not frozen_only)
    dependency_list = json.loads((ROOT / 'outputs/verification/qa-cycle-01-source-required-inputs.json').read_text(encoding='utf-8'))
    declared = {row['path']: row['sha256'] for row in dependency_list['requiredInputs'] + dependency_list['optionalHistoricalCompanions']}
    assert declared == QA_SOURCE_ALLOWED_INPUTS
    assert len(QA_SOURCE_REQUIRED_INPUTS) == 9 and len(QA_SOURCE_OPTIONAL_INPUTS) == 2 and len(QA_SOURCE_CODE_INPUTS) == 2
    checks = ['exact11_paths_match_dependency_list', 'actual_frozen_input_SHA11', 'only2_specific_TS_paths_allowed']
    if frozen_only:
        print(json.dumps({'passed':True,'checks':checks,'groups':len(checks),'selectedFrozenInputs':len(selected),'selectedCurrentPublicReports':0,'scope':'After independent offline regeneration: immutable11 inputs unchanged. Current measurement reports intentionally regenerated only inside extracted checkout; sealed ZIP remains unchanged.'},ensure_ascii=False))
        return
    assert len(QA_SOURCE_CURRENT_REPORT_INPUTS)==2 and len(QA_SOURCE_REVIEWED_INPUTS)==13
    checks.append('exact2_current_public_reports_SHA')
    for relative in QA_SOURCE_REVIEWED_INPUTS:
        assert audit.exclusion_category('fsp-signal/' + relative) is None
    for relative in ['outputs/quality/qa-cycle-01/private-work.json',
                     'outputs/verification/history/qa-cycle-01-before-traceability/other.ts',
                     'outputs/verification/mobile-refinement/private-screen.png',
                     'outputs/local-backup/raw-study.json']:
        assert audit.exclusion_category('fsp-signal/' + relative) is not None
    checks.append('unlisted_nested_JSON_TS_screen_private_stay_forbidden')

    with TemporaryDirectory(prefix='signal-qa07-source-policy-') as folder:
        temp = Path(folder)
        archive = temp / 'synthetic.zip'

        def fixture(files):
            manifest = [{'path': name, 'bytes': len(data), 'sha256': digest(data)} for name, data in files.items()]
            with zipfile.ZipFile(archive, 'w') as package:
                for name, data in files.items():
                    package.writestr('fsp-signal/' + name, data)
                package.writestr('fsp-signal/SOURCE-MANIFEST.json', json.dumps(manifest))
            return digest(archive.read_bytes())

        public_inputs = {path: (ROOT / path).read_bytes() for path in QA_SOURCE_REVIEWED_INPUTS}
        public_inputs['scripts/evaluate-intergroup-control.ts'] = b'Public synthetic marker only; not an executable submitted source.'
        valid = fixture(public_inputs)
        assert audit.inspect_archive(archive, valid, set())['passed']
        checks.append('exact_reviewed_inputs_pass_temporary_manifest_audit')
        tampered = dict(public_inputs)
        code_path = next(iter(QA_SOURCE_CODE_INPUTS))
        tampered[code_path] += b'\n// fabricated drift with a self-consistent ZIP manifest\n'
        result = audit.inspect_archive(archive, fixture(tampered), set())
        assert not result['passed'] and result['findingCounts'].get('qa_frozen_input_sha_mismatch') == 1
        checks.append('tampered_exact_TS_rejected_despite_updated_manifest')
        missing = dict(public_inputs)
        missing.pop(next(iter(QA_SOURCE_REQUIRED_INPUTS)))
        result = audit.inspect_archive(archive, fixture(missing), set())
        assert not result['passed'] and result['findingCounts'].get('qa_required_input_missing') == 1
        checks.append('current_evaluator_missing_required_input_rejected')
        changed_report = dict(public_inputs)
        report_path = next(iter(QA_SOURCE_CURRENT_REPORT_INPUTS))
        changed_report[report_path] += b'\n '
        result = audit.inspect_archive(archive, fixture(changed_report), set())
        assert not result['passed'] and result['findingCounts'].get('qa_current_report_sha_mismatch') == 1
        checks.append('pinned_current_report_drift_rejected_despite_manifest')
        missing_report = dict(public_inputs)
        missing_report.pop(report_path)
        result = audit.inspect_archive(archive, fixture(missing_report), set())
        assert not result['passed'] and result['findingCounts'].get('qa_current_report_missing') == 1
        checks.append('current_evaluator_missing_cited_public_report_rejected')
        historic = {'README.md': b'Pre-QA historical synthetic source'}
        assert audit.inspect_archive(archive, fixture(historic), set())['passed']
        checks.append('historical_archive_without_QA_evaluator_not_retroactively_rejected')
        minimal = temp / 'missing-workspace'
        minimal.mkdir()
        try:
            validate_qa_source_inputs(minimal)
            raise AssertionError('Missing mandatory inputs accepted')
        except ValueError:
            pass
        checks.append('packager_missing_inputs_fail_before_seal')

    print(json.dumps({'passed': True, 'checks': checks, 'groups': len(checks), 'selectedFrozenInputs': sum(relative.as_posix() in QA_SOURCE_ALLOWED_INPUTS for _,relative in selected), 'selectedCurrentPublicReports':sum(relative.as_posix() in QA_SOURCE_CURRENT_REPORT_INPUTS for _,relative in selected),
                      'scope': 'Code-only dependency selection and temporary synthetic ZIP policy, no submission ZIP or runtime/database modifications',
                      'actualCleanSourceArchiveRun': 'pending-after-independent-acceptance'}, ensure_ascii=False))


if __name__ == '__main__':
    main()

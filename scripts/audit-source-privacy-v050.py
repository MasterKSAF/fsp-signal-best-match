"""Read-only exact 0.5.0 seal audit, including optional local private-value comparison."""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import argparse
import importlib.util
import json
import re
import shutil
import zipfile
from source_qa_inputs import QA_SOURCE_V050_ONLY_REQUIRED_INPUTS
from source_research_inputs_v050 import RESEARCH_SOURCE_INPUTS_V050

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('source_privacy_v050_base', ROOT / 'scripts/audit-source-privacy.py')
audit = importlib.util.module_from_spec(spec)
spec.loader.exec_module(audit)
# Version-specific instance only; the historical audit and its policy are intact.
for name in ['QA_SOURCE_ALLOWED_INPUTS', 'QA_SOURCE_REQUIRED_INPUTS', 'QA_SOURCE_CODE_INPUTS', 'QA_SOURCE_REVIEWED_INPUTS']:
    setattr(audit, name, {**getattr(audit, name), **QA_SOURCE_V050_ONLY_REQUIRED_INPUTS})
audit.ALLOWED_NESTED_PROOFS.update(QA_SOURCE_V050_ONLY_REQUIRED_INPUTS)
audit.ALLOWED_NESTED_PROOFS.update({'outputs/verification/fsp-category-policy/current-behavior.json', 'outputs/verification/fsp-category-policy/synthetic-input.json'})
audit.ALLOWED_NESTED_PROOFS.update(RESEARCH_SOURCE_INPUTS_V050)
audit.SELF_REPORT_PREFIXES = (*audit.SELF_REPORT_PREFIXES, 'source-seal', 'release-freeze', 'package-ready')
audit.FORBIDDEN_PARTS = {*audit.FORBIDDEN_PARTS, '.load-runtime'}
BASE_NESTED_PROOFS = set(audit.ALLOWED_NESTED_PROOFS)
# The old audit accepts four public text suffixes. The reviewed hash companion
# is a single exact leaf exception, never a new generic suffix permission.
base_exclusion_category = audit.exclusion_category
def exclusion_category_v050(name):
    if name == 'fsp-signal/outputs/research/confirmation-v1/protocol.sha256':
        return None
    return base_exclusion_category(name)
audit.exclusion_category = exclusion_category_v050


def public_proof_path(relative):
    if not isinstance(relative, str):
        return False
    path = PurePosixPath(relative)
    exact_research = relative in RESEARCH_SOURCE_INPUTS_V050
    return relative == '/'.join(path.parts) and '\\' not in relative and ':' not in relative and '..' not in path.parts and (exact_research or relative.startswith(('outputs/release-0.5.0/', 'outputs/verification/', 'outputs/quality/'))) and (exact_research or path.suffix.lower() in {'.json', '.csv', '.txt', '.md'}) and not any(p in {'private', 'local-backup', 'screens', 'raw', 'clean'} or p.startswith('clean-') for p in path.parts) and not path.name.startswith(audit.SELF_REPORT_PREFIXES)


def inspect_v050(archive, expected, secrets):
    with zipfile.ZipFile(archive) as package:
        if len({name.casefold() for name in package.namelist()}) != len(package.namelist()):
            raise ValueError('Case-insensitive duplicate archive paths are unsafe on Windows')
        metadata = json.loads(package.read('fsp-signal/RELEASE-METADATA.json'))
        if metadata.get('applicationVersion') != '0.5.0' or not re.fullmatch(r'[a-f0-9]{64}', metadata.get('freezeReceiptSha256', '')):
            raise ValueError('Versioned frozen release metadata required')
        runtime = metadata.get('acceptedRuntime', {})
        if runtime.get('applicationVersion') != '0.5.0' or not re.fullmatch(r'[a-f0-9]{64}', runtime.get('bundleSHA', '')) or not isinstance(runtime.get('sourceHashes'), dict) or not runtime['sourceHashes']:
            raise ValueError('Nonempty accepted new runtime attestation required')
        for relative, expected_source_sha in runtime['sourceHashes'].items():
            if not isinstance(relative, str) or relative != '/'.join(PurePosixPath(relative).parts) or ':' in relative or '\\' in relative or '..' in PurePosixPath(relative).parts or not isinstance(expected_source_sha, str) or not re.fullmatch(r'[a-f0-9]{64}', expected_source_sha) or audit.sha(package.read('fsp-signal/' + relative)) != expected_source_sha:
                raise ValueError('Accepted runtime source bytes do not match actual source ZIP')
        if audit.sha(package.read('fsp-signal/artifacts/api-server/src/lib/signal-matching.ts')) != metadata.get('matchingAlgorithmSha256'):
            raise ValueError('Current matching metadata does not match source bytes')
        for relative, expected_research_sha in RESEARCH_SOURCE_INPUTS_V050.items():
            if audit.sha(package.read('fsp-signal/' + relative)) != expected_research_sha:
                raise ValueError('Frozen synthetic research input missing or drifted')
        proofs = metadata.get('publicProofInputs', [])
        if len(proofs) > 64 or any(not public_proof_path(item.get('path')) or not re.fullmatch(r'[a-f0-9]{64}', item.get('sha256', '')) for item in proofs):
            raise ValueError('Invalid bounded public proof input list')
        for item in proofs:
            if audit.sha(package.read('fsp-signal/' + item['path'])) != item['sha256']:
                raise ValueError('Frozen public proof bytes mismatch')
        audit.ALLOWED_NESTED_PROOFS = BASE_NESTED_PROOFS | {item['path'] for item in proofs}
    return audit.inspect_archive(archive, expected, secrets)


def private_values(paths):
    values = set()
    for raw in paths:
        path = Path(raw).resolve()
        if path.is_relative_to(ROOT) or not path.is_file() or path.stat().st_size > 2 * 1024 * 1024:
            raise ValueError('Private comparison manifest must be a bounded external JSON file')
        def visit(item):
            if isinstance(item, dict):
                for key, value in item.items():
                    if isinstance(value, str) and (audit.CREDENTIAL_VALUE_KEY.search(str(key)) or str(key).lower() in {'email', 'contactemail'}):
                        if len(value) >= 8 and not audit.PLACEHOLDER.search(value):
                            values.add(value)
                    visit(value)
            elif isinstance(item, list):
                for value in item:
                    visit(value)
        visit(json.loads(path.read_text(encoding='utf-8-sig')))
    return values


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', default='outputs/release-0.5.0/fsp-signal-source-0.5.0.zip')
    parser.add_argument('--expected-sha256', required=True)
    parser.add_argument('--private-manifest', action='append', default=[])
    parser.add_argument('--output', default='outputs/release-0.5.0/source-privacy-audit.json')
    args = parser.parse_args()
    archive, output = (ROOT / args.archive).resolve(), (ROOT / args.output).resolve()
    if not re.fullmatch(r'[a-fA-F0-9]{64}', args.expected_sha256) or not archive.is_relative_to(ROOT / 'outputs/release-0.5.0') or archive.suffix != '.zip' or output.parent != (ROOT / 'outputs/release-0.5.0').resolve() or output.name != 'source-privacy-audit.json':
        raise ValueError('Exact versioned source seal SHA and companion paths required')
    secrets, comparisons = audit.known_values()
    reviewers = private_values(args.private_manifest)
    secrets.update(reviewers)
    report = inspect_v050(archive, args.expected_sha256.lower(), secrets)
    report.update({'schemaVersion': 1, 'applicationVersion': '0.5.0', 'generatedAt': datetime.now(timezone.utc).isoformat(), 'auditVersion': 'signal-source-privacy-v050', 'scriptSha256': audit.sha(Path(__file__).read_bytes()), 'knownValueComparison': {**comparisons, 'externalPrivateManifestsCompared': len(args.private_manifest), 'externalPrivateValuesCompared': len(reviewers), 'externalPrivateValuesExported': False}, 'scope': 'Read-only actual versioned source ZIP. Local private values/paths and matching text are never exported.', 'limitations': ['Known-value and pattern comparison is not a universal secret detector.', 'Historical synthetic protocols are preserved as historical, not new acceptance.']})
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        history = output.parent / 'history'
        history.mkdir(exist_ok=True)
        historical = history / ('source-privacy-audit-' + audit.sha(output.read_bytes())[:12] + '.json')
        if not historical.exists():
            shutil.copyfile(output, historical)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ['passed', 'sourceSha256', 'archiveMembers', 'sourceManifestRecords', 'findingCounts', 'sealedArchiveUnchanged']}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        print(json.dumps({'passed': False, 'failureCategory': type(error).__name__, 'privateValuesExported': False}))
        raise SystemExit(1)

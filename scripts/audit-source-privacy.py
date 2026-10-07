"""Read-only sealed-ZIP audit. Never prints secret values or matched text.

Only counts, SHA-256 fingerprints and fixed categories are exported. Local
environment/QA values are read solely for comparison, never copied to a report.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
from urllib.parse import urlparse
import argparse
import hashlib
import json
import re
import shutil
import stat
import tempfile
import zipfile
from source_qa_inputs import QA_SOURCE_ALLOWED_INPUTS, QA_SOURCE_REQUIRED_INPUTS, QA_SOURCE_CODE_INPUTS, QA_SOURCE_CURRENT_REPORT_INPUTS, QA_SOURCE_REVIEWED_INPUTS, QA_EVALUATOR_MARKERS

ROOT = Path(__file__).resolve().parents[1]
SELF_REPORT_PREFIXES = ('final-report', 'clean-source-launch', 'source-privacy-audit')
ALLOWED_NESTED_PROOFS = {'outputs/verification/technical-description/build.json',
                        'outputs/verification/technical-description/content.txt',
                        'outputs/verification/qa-cycle-02-technical-description/visual-review.json',
                        'outputs/verification/mobile-refinement/observations.json',
                        'outputs/verification/mobile-refinement/contrast.json'}
ALLOWED_NESTED_PROOFS.update(QA_SOURCE_REVIEWED_INPUTS)
FORBIDDEN_PARTS = {'.git', 'node_modules', 'dist', '.cache', '__pycache__', 'local-backup'}
FORBIDDEN_SUFFIXES = {'.dump', '.sqlite', '.db', '.bak', '.key', '.pem', '.p12', '.pfx', '.log', '.tsbuildinfo', '.zip', '.7z', '.rar'}
SENSITIVE_KEY = re.compile(r'password|secret|token|api.?key|cookie|bearer|authorization', re.I)
CREDENTIAL_VALUE_KEY = re.compile(r'(?:password(?:_?hash)?|secret|token|cookie|bearer|authorization|api.?key)$', re.I)
PLACEHOLDER = re.compile(r'^(?:demo|example|test|placeholder|replace|change.?me|your.?)[\W_]|^\$\{', re.I)
CONTENT_PATTERNS = {
    'private_key_block': re.compile(r'-----BEGIN (?:[A-Z0-9 ]* )?PRIVATE KEY-----'),
    'literal_session_cookie': re.compile(r'\bsignal_session=[A-Za-z0-9._~-]{20,}'),
    'literal_bearer_token': re.compile(r'\bBearer\s+[A-Za-z0-9._~-]{20,}'),
}


def sha(data):
    return hashlib.sha256(data).hexdigest()


def env_values(path):
    if not path.is_file():
        return {}
    values = {}
    for line in path.read_text(encoding='utf-8-sig').splitlines():
        match = re.match(r'^\s*(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$', line)
        if match:
            value = match[2]
            if len(value) >= 2 and value[0] == value[-1] and value[0] in '\"\'':
                value = value[1:-1]
            values[match[1]] = value
    return values


def known_values():
    example = env_values(ROOT / '.env.example')
    values, env_count, qa_count = set(), 0, 0

    def remember(value, kind):
        nonlocal env_count, qa_count
        if not isinstance(value, str) or len(value) < 12 or PLACEHOLDER.search(value):
            return
        if value not in values:
            values.add(value)
            if kind == 'env':
                env_count += 1
            else:
                qa_count += 1

    for key, value in env_values(ROOT / '.env').items():
        if SENSITIVE_KEY.search(key) and value != example.get(key):
            remember(value, 'env')
        if key == 'DATABASE_URL' and value != example.get(key):
            password = urlparse(value).password
            if password:
                remember(password, 'env')

    def visit(value):
        if isinstance(value, dict):
            for key, nested in value.items():
                if CREDENTIAL_VALUE_KEY.search(str(key)):
                    remember(nested, 'qa')
                visit(nested)
        elif isinstance(value, list):
            for nested in value:
                visit(nested)

    private_root = ROOT / 'outputs/local-backup'
    if private_root.is_dir():
        for path in private_root.rglob('*'):
            if not path.is_file() or path.stat().st_size > 4 * 1024 * 1024:
                continue
            if path.suffix == '.json':
                try:
                    visit(json.loads(path.read_text(encoding='utf-8-sig')))
                except (ValueError, UnicodeError):
                    pass  # Raw errors could contain private values; never print them.
            elif SENSITIVE_KEY.search(path.name) and path.suffix in {'.txt', '.cookie'}:
                remember(path.read_text(encoding='utf-8-sig').strip(), 'qa')
            elif path.suffix in {'.ts', '.mts', '.js', '.mjs'}:
                try:
                    text = path.read_text(encoding='utf-8-sig')
                    for match in re.finditer(r'([A-Za-z_$][\w$]*)\s*[:=]\s*([\"\'])([^\r\n\"\']{12,})\2', text):
                        if CREDENTIAL_VALUE_KEY.search(match[1]):
                            remember(match[3], 'qa')
                except UnicodeError:
                    pass
    fixture_identifiers = set()
    owned_accounts = ROOT.parent / 'docs/best-match/qa-cycle-2026-10-06/ui/owned-accounts.json'
    if owned_accounts.is_file():
        def collect_identifiers(item):
            if isinstance(item, dict):
                for nested in item.values():
                    collect_identifiers(nested)
            elif isinstance(item, list):
                for nested in item:
                    collect_identifiers(nested)
            elif isinstance(item, str) and re.fullmatch(r'[^\s@]+@[^\s@]+\.[^\s@]+', item):
                fixture_identifiers.add(item)
        collect_identifiers(json.loads(owned_accounts.read_text(encoding='utf-8-sig')))
        if len(fixture_identifiers) != 2:
            raise ValueError('Protected fixture identifier count differs from reviewed local scope')
        values.update(fixture_identifiers)
    return values, {'environmentValuesCompared': env_count, 'savedQaValuesCompared': qa_count,
                    'protectedFixtureIdentifiersCompared': len(fixture_identifiers), 'fixtureIdentifierValuesExported': False,
                    'comparisonValuesExported': False, 'commonTemplateValuesExcluded': True}


def exclusion_category(name):
    path = PurePosixPath(name)
    parts = path.parts
    if '\\' in name or not name.startswith('fsp-signal/') or '..' in parts or ':' in name or name.startswith('/'):
        return 'unsafe_archive_path'
    if any(part in FORBIDDEN_PARTS or part.startswith('clean-') for part in parts[:-1]):
        return 'private_or_generated_directory'
    if path.name.startswith('.env') and path.name != '.env.example':
        return 'private_environment_file'
    if path.suffix.lower() in FORBIDDEN_SUFFIXES:
        return 'key_database_archive_or_log_artifact'
    relative = '/'.join(parts[1:])
    if relative == 'scripts/snapshot-qa-preserved-state.ts':
        return 'historical_local_qa_helper'
    if relative.startswith('outputs/'):
        if path.name.startswith(SELF_REPORT_PREFIXES):
            return 'postseal_self_report'
        top_proof = len(parts) == 4 and parts[2] in {'quality', 'verification'}
        historical_proof = len(parts) == 5 and parts[2] in {'quality', 'verification'} and parts[3] == 'history'
        public_type = path.suffix.lower() in {'.json', '.csv', '.md', '.txt'} or relative in QA_SOURCE_CODE_INPUTS
        if not public_type or not (top_proof or historical_proof or relative in ALLOWED_NESTED_PROOFS):
            return 'nonpublic_output_screens_raw_or_render'
    return None


def inspect_archive(path, expected_sha, secrets):
    first = path.read_bytes()
    findings, names, manifest, scanned = [], [], [], 0
    observed_sha = sha(first)

    def finding(category, name=None, data=None):
        item = {'category': category}
        if name is not None:
            item['memberNameSha256'] = sha(name.encode('utf-8'))
        if data is not None:
            item['memberSha256'] = sha(data)
        findings.append(item)

    if observed_sha != expected_sha:
        finding('expected_seal_sha_mismatch')
    with zipfile.ZipFile(path) as archive:
        entries = archive.infolist()
        names = [item.filename for item in entries]
        # Historical pre-QA archives do not need inputs for evaluators they do
        # not contain. Any current source handoff must contain all nine inputs.
        if QA_EVALUATOR_MARKERS.intersection(names):
            for relative in QA_SOURCE_REQUIRED_INPUTS:
                if 'fsp-signal/' + relative not in names:
                    finding('qa_required_input_missing', 'fsp-signal/' + relative)
            for relative in QA_SOURCE_CURRENT_REPORT_INPUTS:
                if 'fsp-signal/' + relative not in names:
                    finding('qa_current_report_missing', 'fsp-signal/' + relative)
        if len(names) != len(set(names)):
            finding('duplicate_archive_members')
        if sum(item.file_size for item in entries) > 256 * 1024 * 1024 or any(item.file_size > 64 * 1024 * 1024 for item in entries):
            finding('unexpected_archive_expanded_size')
        else:
            if archive.testzip() is not None:
                finding('zip_crc_failure')
            for item in entries:
                category = exclusion_category(item.filename)
                if category:
                    finding(category, item.filename)
                if stat.S_ISLNK(item.external_attr >> 16):
                    finding('archive_symlink', item.filename)
                data = archive.read(item)
                relative = '/'.join(PurePosixPath(item.filename).parts[1:])
                if relative in QA_SOURCE_ALLOWED_INPUTS and sha(data) != QA_SOURCE_ALLOWED_INPUTS[relative]:
                    finding('qa_frozen_input_sha_mismatch', item.filename, data)
                if relative in QA_SOURCE_CURRENT_REPORT_INPUTS and sha(data) != QA_SOURCE_CURRENT_REPORT_INPUTS[relative]:
                    finding('qa_current_report_sha_mismatch', item.filename, data)
                if any(value.encode('utf-8') in data for value in secrets):
                    finding('known_local_secret_or_qa_credential', item.filename, data)
                try:
                    text = data.decode('utf-8-sig')
                except UnicodeError:
                    continue
                scanned += 1
                for category, pattern in CONTENT_PATTERNS.items():
                    if pattern.search(text):
                        finding(category, item.filename, data)
            manifest_name = 'fsp-signal/SOURCE-MANIFEST.json'
            if manifest_name not in names:
                finding('source_manifest_missing')
            else:
                manifest = json.loads(archive.read(manifest_name))
                recorded = set()
                for item in manifest:
                    name = 'fsp-signal/' + item['path']
                    if name in recorded:
                        finding('duplicate_manifest_record', name)
                    recorded.add(name)
                    if name not in names:
                        finding('manifest_member_missing', name)
                        continue
                    data = archive.read(name)
                    if len(data) != item['bytes'] or sha(data) != item['sha256']:
                        finding('manifest_hash_or_size_mismatch', name, data)
                if set(names) != recorded | {manifest_name}:
                    finding('unmanifested_or_extra_archive_member')
    last_sha = sha(path.read_bytes())
    if last_sha != observed_sha:
        finding('archive_changed_during_audit')
    counts = {}
    for item in findings:
        counts[item['category']] = counts.get(item['category'], 0) + 1
    return {'passed': not findings, 'sourceSha256': observed_sha, 'expectedSourceSha256': expected_sha,
            'archiveBytes': len(first), 'archiveMembers': len(names), 'sourceManifestRecords': len(manifest),
            'textFilesScanned': scanned, 'findings': findings, 'findingCounts': counts,
            'sealedArchiveUnchanged': observed_sha == last_sha}


def self_test():
    # All values are fabricated inside a temporary directory, not local secrets.
    with tempfile.TemporaryDirectory(prefix='signal-privacy-selftest-') as folder:
        path = Path(folder) / 'fixture.zip'

        def fixture(files, corrupt=False):
            manifest = [{'path': name, 'bytes': len(data), 'sha256': sha(data)} for name, data in files.items()]
            if corrupt:
                manifest[0]['sha256'] = '0' * 64
            with zipfile.ZipFile(path, 'w') as archive:
                for name, data in files.items():
                    archive.writestr('fsp-signal/' + name, data)
                archive.writestr('fsp-signal/SOURCE-MANIFEST.json', json.dumps(manifest))
            return sha(path.read_bytes())

        good = fixture({'README.md': b'Public synthetic example without credentials',
                        'scripts/clean-source-launch.ps1': b'Public clean launcher source',
                        'outputs/verification/technical-description/build.json': b'{}',
                        'outputs/verification/technical-description/content.txt': b'Reviewed synthetic technical text only',
                        'outputs/verification/qa-cycle-02-technical-description/visual-review.json': b'{}',
                        'outputs/verification/mobile-refinement/observations.json': b'[]',
                        'outputs/verification/mobile-refinement/contrast.json': b'[]'})
        assert inspect_archive(path, good, set())['passed']
        cases = [('.env', b'SYNTHETIC=private', 'private_environment_file'),
                 ('outputs/local-backup/raw.json', b'{}', 'private_or_generated_directory'),
                 ('outputs/verification/source-privacy-audit-old.json', b'{}', 'postseal_self_report'),
                 ('scripts/snapshot-qa-preserved-state.ts', b'Historical fabricated local helper', 'historical_local_qa_helper'),
                 ('README.md', b'signal_session=' + b'0123456789abcdef0123456789abcdef', 'literal_session_cookie'),
                 ('README.md', b'-----BEGIN ' + b'RSA PRIVATE KEY-----', 'private_key_block')]
        for name, data, category in cases:
            expected = fixture({name: data})
            result = inspect_archive(path, expected, set())
            assert not result['passed'] and category in result['findingCounts']
        expected = fixture({'README.md': b'FabricatedSelfTestCredentialValue123'})
        assert 'known_local_secret_or_qa_credential' in inspect_archive(path, expected, {'FabricatedSelfTestCredentialValue123'})['findingCounts']
        expected = fixture({'README.md': b'Public'}, corrupt=True)
        assert 'manifest_hash_or_size_mismatch' in inspect_archive(path, expected, set())['findingCounts']
        assert not inspect_archive(path, '0' * 64, set())['passed']
    print(json.dumps({'passed': True, 'selfTestChecks': 10, 'scope': 'Temporary fabricated fixtures; no sealed ZIP, local secrets, database or containers accessed'}))


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--archive', default='outputs/submission/fsp-signal-source.zip')
    parser.add_argument('--expected-sha256')
    parser.add_argument('--output', default='outputs/verification/source-privacy-audit.json')
    parser.add_argument('--self-test', action='store_true')
    args = parser.parse_args()
    if args.self_test:
        self_test()
        return 0
    if not args.expected_sha256 or not re.fullmatch(r'[a-fA-F0-9]{64}', args.expected_sha256):
        parser.error('Provide the exact expected SHA-256 of the sealed source ZIP')
    archive = (ROOT / args.archive).resolve()
    output = (ROOT / args.output).resolve()
    if not archive.is_relative_to(ROOT) or archive.suffix != '.zip' or output.parent != (ROOT / 'outputs/verification').resolve() or output.suffix != '.json':
        parser.error('Archive must be inside this workspace; report must be a public top-level verification JSON')
    values, comparison = known_values()
    report = inspect_archive(archive, args.expected_sha256.lower(), values)
    report.update({'generatedAt': datetime.now(timezone.utc).isoformat(), 'auditVersion': 'signal-source-privacy-v1',
                   'scope': 'Read-only actual sealed source ZIP; companion report, never inserted into its seal',
                   'scriptSha256': sha(Path(__file__).read_bytes()), 'knownValueComparison': comparison,
                   'integrity': 'CRC, manifest SHA-256/byte lengths, exact unique safe file set',
                   'exclusionsVerified': ['Private environment, dependencies, build/cache/log/database/key artifacts',
                                          'Local backups, screen/raw/render outputs and post-seal self reports'],
                   'limitations': ['Patterns and known-value comparison are not a universal secret detector.',
                                   'Common example/template credentials and short values are not treated as secret evidence.',
                                   'Confirmed team contacts and AI-authored synthetic task references are intentional public source content.',
                                   'No local comparison values, matched text or private fixture identifiers are printed/exported.']})
    output.parent.mkdir(parents=True, exist_ok=True)
    if output.exists():
        history = output.parent / 'history'
        history.mkdir(exist_ok=True)
        previous = history / ('source-privacy-audit-' + sha(output.read_bytes())[:12] + '.json')
        if not previous.exists():
            shutil.copyfile(output, previous)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({key: report[key] for key in ['passed', 'sourceSha256', 'expectedSourceSha256', 'archiveMembers', 'sourceManifestRecords', 'textFilesScanned', 'findingCounts', 'sealedArchiveUnchanged']}))
    return 0 if report['passed'] else 1


if __name__ == '__main__':
    try:
        raise SystemExit(main())
    except Exception as error:
        # Exceptions from JSON/ZIP/path readers may contain a private value.
        print(json.dumps({'passed': False, 'auditFailureCategory': type(error).__name__,
                          'scope': 'Audit could not complete; no exception text or private values exported'}))
        raise SystemExit(1)

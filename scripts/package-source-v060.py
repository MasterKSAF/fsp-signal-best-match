"""Versioned 0.6.0 source seal; --check-only never creates an archive."""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import argparse
import hashlib
import json
import os
import re
import shutil
import zipfile
from source_qa_inputs import validate_qa_source_inputs_v060, QA_SOURCE_V060_ADDITIONAL_INPUTS
from source_research_inputs_v050 import RESEARCH_SOURCE_INPUTS_V050

ROOT = Path(__file__).resolve().parents[1]
DESTINATION = ROOT / 'outputs/release-0.6.0'
ARCHIVE = DESTINATION / 'fsp-signal-source-0.6.0.zip'
EXCLUDED_DIRS = {'.git', 'node_modules', 'dist', 'outputs', 'local-backup', '.load-runtime', '.cache', '__pycache__', '.replit', '.local', 'tmp', 'out-tsc'}
EXCLUDED_SUFFIXES = {'.log', '.tsbuildinfo', '.zip', '.7z', '.rar', '.dump', '.sqlite', '.db', '.bak', '.key', '.pem', '.p12', '.pfx', '.cookie'}
EXCLUDED_FILES = {'scripts/snapshot-qa-preserved-state.ts'}
# Reviewed text protocols only. Never recurse through outputs/screens/private.
PUBLIC_NESTED_INPUTS = {
    'outputs/verification/fsp-category-policy/current-behavior.json',
    'outputs/verification/fsp-category-policy/synthetic-input.json',
}
PUBLIC_NESTED_INPUTS.update(RESEARCH_SOURCE_INPUTS_V050)
POSTSEAL_PREFIXES = ('final-report', 'clean-source-launch', 'source-privacy-audit', 'source-seal', 'release-freeze', 'package-ready')
CRITICAL_FROZEN_INPUTS = {'package.json', 'pnpm-lock.yaml', 'artifacts/api-server/build.mjs', 'artifacts/api-server/build-portability.mjs', 'artifacts/api-server/src/lib/signal-matching.ts', 'artifacts/api-server/src/lib/signal-auth.ts', 'artifacts/api-server/src/lib/signal-pool-scope.ts', 'artifacts/api-server/src/lib/assessment-purpose.ts', 'lib/db/src/schema/fsp-signal.ts', 'lib/db/src/schema/signal-resume.ts', 'lib/db/migrations/0006_assessment_purpose.sql', 'lib/db/migrations/0007_reviewer_scope.sql', 'lib/db/migrations/0008_resume_pool_digest.sql', 'lib/api-spec/openapi.yaml',
    'lib/db/src/schema/signal-opportunities.ts', 'lib/db/migrations/0009_microtask_resume.sql',
    'artifacts/api-server/src/lib/microtask-resume-policy.ts', 'artifacts/api-server/src/lib/microtask-resume.ts',
    'artifacts/api-server/src/lib/microtask-scheduler.ts', 'artifacts/api-server/src/routes/signal-microtasks.ts',
    'artifacts/api-server/src/lib/signal-candidate-evidence.ts', 'artifacts/api-server/src/lib/signal-evidence-compatibility.ts',
    'artifacts/api-server/src/lib/fsp-results.ts', 'artifacts/api-server/src/lib/fsp-provider.ts',
    'scripts/upgrade-owned-stage-v060.cjs', 'scripts/restart-owned-stage-v060.ps1', 'scripts/reproduce-offline-v060.ts',
    'scripts/package-source-v060.py', 'scripts/audit-source-privacy-v060.py', 'scripts/clean-source-launch-v060.ps1',
    'scripts/clean-source-http-v060.ts', 'scripts/lib/clean-v060-target.ts', 'scripts/associate-microtask-compiled-v060.ts',
    'tests/fixtures/fsp-category-v060.json'}
sha = lambda data: hashlib.sha256(data).hexdigest()


def freeze_zip_timestamp(frozen_at):
    """Use the release instant rather than a timestamp shared by all versions.

    DOS ZIP dates have two-second precision and no timezone marker. Derive the
    fields from an explicitly zoned UTC instant; source bytes remain untouched.
    """
    if not isinstance(frozen_at, str):
        raise ValueError('Freeze timestamp must be an explicit ISO instant')
    instant = datetime.fromisoformat(frozen_at.replace('Z', '+00:00'))
    if instant.tzinfo is None or instant.utcoffset() is None:
        raise ValueError('Freeze timestamp must have an explicit timezone')
    instant = instant.astimezone(timezone.utc)
    if not 1980 <= instant.year <= 2107:
        raise ValueError('Freeze timestamp lies outside ZIP date limits')
    return (instant.year, instant.month, instant.day, instant.hour,
            instant.minute, instant.second // 2 * 2)


def safe_relative(relative):
    if not isinstance(relative, str):
        return False
    parts = PurePosixPath(relative).parts
    return bool(parts) and relative == '/'.join(parts) and not any(p in {'.', '..', ''} for p in parts) and ':' not in relative and '\\' not in relative


def collect_source():
    files = {}
    for folder, directories, names in os.walk(ROOT, followlinks=False):
        directories[:] = sorted(n for n in directories if n not in EXCLUDED_DIRS and not (Path(folder) / n).is_symlink())
        for name in sorted(names):
            path = Path(folder) / name
            relative = path.relative_to(ROOT).as_posix()
            if path.is_symlink() or relative in EXCLUDED_FILES or not safe_relative(relative):
                continue
            if name.startswith('.env') and name != '.env.example':
                continue
            if path.suffix.lower() in EXCLUDED_SUFFIXES or name == '.replitignore':
                continue
            if not path.resolve().is_relative_to(ROOT):
                raise ValueError('Source path escapes root')
            files[relative] = path
    for folder in ['quality', 'verification']:
        # Previous facts are provenance/history, never advertised as 0.6.0 PASS.
        public_root = ROOT / 'outputs' / folder
        for path in list(public_root.glob('*')) + list((public_root / 'history').glob('*')):
            if path.is_file() and not path.is_symlink() and path.suffix.lower() in {'.json', '.csv', '.md', '.txt'} and not path.name.startswith(POSTSEAL_PREFIXES):
                files[path.relative_to(ROOT).as_posix()] = path
    for relative in PUBLIC_NESTED_INPUTS:
        path = ROOT / relative
        if relative in RESEARCH_SOURCE_INPUTS_V050 and (not path.is_file() or path.is_symlink() or sha(path.read_bytes()) != RESEARCH_SOURCE_INPUTS_V050[relative]):
            raise ValueError('Frozen synthetic research input missing or drifted')
        if path.is_file() and not path.is_symlink():
            files[relative] = path
    # Do not recursively include the release directory: explicitly reviewed
    # acceptance inputs are provided by a bounded public freeze receipt.
    for path, relative in validate_qa_source_inputs_v060(ROOT):
        files[relative.as_posix()] = path
    return files


def metadata():
    package = json.loads((ROOT / 'package.json').read_text(encoding='utf-8-sig'))
    program = (ROOT / 'artifacts/api-server/src/lib/assessment-managed.ts').read_text(encoding='utf-8')
    versions = dict(re.findall(r'id:\s*"(backend-python|frontend-typescript)"[\s\S]*?version:\s*"(signal-[\w-]+-v\d+)"', program.split('export function isProgramId')[0]))
    if set(versions) != {'backend-python', 'frontend-typescript'}:
        raise ValueError('Program registry metadata unavailable')
    matcher = (ROOT / 'artifacts/api-server/src/lib/signal-matching.ts').read_bytes()
    algorithm = re.search(r'MATCH_ALGORITHM_VERSION\s*=\s*"([^"]+)"', matcher.decode('utf-8'))[1]
    return {'schemaVersion': 1, 'applicationVersion': package['version'], 'releaseName': 'Signal 0.6.0', 'programVersions': versions,
            'matchingAlgorithmVersion': algorithm, 'matchingAlgorithmSha256': sha(matcher),
            'proofScope': 'New 0.6.0 acceptance is separate from historical 0.4.1 and sealed 0.5.0 facts. Synthetic technical checks do not establish human grade validity.',
            'historicalProofsRetainedAsHistory': True, 'additionalFrozenGoldenInputs': QA_SOURCE_V060_ADDITIONAL_INPUTS,
            'postSealCompanions': ['source-privacy-audit.json', 'clean-source-launch.json', 'final-report.json']}


def read_freeze(path, files):
    receipt = json.loads(path.read_text(encoding='utf-8'))
    if receipt.get('schemaVersion') != 1 or receipt.get('applicationVersion') != '0.6.0' or receipt.get('status') != 'frozen-for-source-seal':
        raise ValueError('Explicit frozen 0.6.0 release receipt required')
    if not receipt.get('frozenAt') or receipt.get('acceptedRuntime', {}).get('applicationVersion') != '0.6.0' or not re.fullmatch(r'[a-f0-9]{64}', receipt.get('acceptedRuntime', {}).get('bundleSHA', '')):
        raise ValueError('Freeze must identify timestamp and accepted runtime bundle')
    freeze_zip_timestamp(receipt['frozenAt'])
    hashes = receipt.get('sourceHashes', {})
    if not isinstance(hashes, dict) or not hashes or any(not safe_relative(p) or p not in files or not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected) or sha(files[p].read_bytes()) != expected for p, expected in hashes.items()):
        raise ValueError('Frozen source hashes missing or drifted')
    if not CRITICAL_FROZEN_INPUTS.issubset(hashes):
        raise ValueError('Freeze lacks required new feature source inputs')
    runtime_hashes = receipt['acceptedRuntime'].get('sourceHashes', {})
    if not isinstance(runtime_hashes, dict) or not runtime_hashes or any(p not in hashes or expected != hashes[p] for p, expected in runtime_hashes.items()):
        raise ValueError('Accepted runtime source inputs must match the frozen source attestations')
    proofs = receipt.get('publicProofInputs', [])
    if not isinstance(proofs, list) or len(proofs) > 64 or any(not isinstance(item, dict) for item in proofs):
        raise ValueError('Public proof inputs must be a bounded explicit list')
    seen_proofs = set()
    for item in proofs:
        relative, expected = item.get('path'), item.get('sha256')
        exact_research = relative in RESEARCH_SOURCE_INPUTS_V050
        if not safe_relative(relative) or not (exact_research or relative.startswith(('outputs/release-0.6.0/', 'outputs/verification/', 'outputs/quality/'))) or not (exact_research or Path(relative).suffix.lower() in {'.json', '.md', '.txt', '.csv'}) or any(part in {'private', 'local-backup', 'screens', 'raw', 'clean'} or part.startswith('clean-') for part in PurePosixPath(relative).parts):
            raise ValueError('Freeze proof input is not a public bounded text protocol')
        if exact_research and expected != RESEARCH_SOURCE_INPUTS_V050[relative]:
            raise ValueError('Synthetic research proof must retain its exact reviewed SHA')
        if relative.casefold() in seen_proofs or any(existing.casefold() == relative.casefold() and existing != relative for existing in files) or not isinstance(expected, str) or not re.fullmatch(r'[a-f0-9]{64}', expected):
            raise ValueError('Public proof paths must be unique with exact SHA-256 values')
        seen_proofs.add(relative.casefold())
        if Path(relative).name.startswith(POSTSEAL_PREFIXES):
            raise ValueError('Self-referential post-seal proof cannot enter source seal')
        actual = ROOT / relative
        if not actual.is_file() or actual.is_symlink() or not actual.resolve().is_relative_to(ROOT) or sha(actual.read_bytes()) != expected:
            raise ValueError('Freeze proof input drifted/missing')
        files[relative] = actual
    baselines = receipt.get('offlineBaselines', {})
    if not isinstance(baselines, dict) or set(baselines) != {'policyQuality', 'traceabilityDelta'}:
        raise ValueError('Current version requires exact policy/traceability offline baselines')
    proof_map = {item['path']: item['sha256'] for item in proofs}
    matcher_sha = hashes['artifacts/api-server/src/lib/signal-matching.ts']
    for name, item in baselines.items():
        if not isinstance(item, dict) or item.get('path') not in proof_map or item.get('sha256') != proof_map[item['path']]:
            raise ValueError('Offline baseline must be an exact frozen public proof input')
        baseline = json.loads(files[item['path']].read_text(encoding='utf-8'))
        measured_sha = baseline.get('sourceHashes', {}).get('artifacts/api-server/src/lib/signal-matching.ts') if name == 'policyQuality' else baseline.get('algorithmSha256')
        if baseline.get('applicationVersion') != '0.6.0' or measured_sha != matcher_sha:
            raise ValueError('Offline baseline must measure the sealed current policy, not old PASS history')
        if name == 'policyQuality':
            measured_inputs = baseline.get('sourceHashes', {})
            if not isinstance(measured_inputs, dict) or not measured_inputs or any(p not in hashes or expected != hashes[p] for p, expected in measured_inputs.items()):
                raise ValueError('Every measured current-policy input must match the frozen source')
    return receipt


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true')
    parser.add_argument('--freeze', default='outputs/release-0.6.0/release-freeze.json')
    args = parser.parse_args()
    files, release = collect_source(), metadata()
    freeze_path = (ROOT / args.freeze).resolve()
    if not freeze_path.is_relative_to(DESTINATION) or freeze_path.name != 'release-freeze.json':
        raise ValueError('Freeze receipt must be the explicit release-0.6.0 receipt')
    if args.check_only:
        frozen = read_freeze(freeze_path, files) if freeze_path.is_file() else None
        print(json.dumps({'checkOnly': True, 'archiveWritten': False, 'archive': str(ARCHIVE), 'applicationVersion': release['applicationVersion'], 'versionReady': release['applicationVersion'] == '0.6.0', 'sourceFiles': len(files), 'newGoldenInputs': QA_SOURCE_V060_ADDITIONAL_INPUTS, 'publicNestedInputs': sorted(PUBLIC_NESTED_INPUTS), 'freezePresent': frozen is not None, 'freezeValidated': frozen is not None, 'selectedFrozenProofs': [item['path'] for item in frozen.get('publicProofInputs', [])] if frozen else []}, ensure_ascii=False))
        return
    if release['applicationVersion'] != '0.6.0':
        raise ValueError('Version 0.6.0 required before sealing')
    frozen = read_freeze(freeze_path, files)
    zip_timestamp = freeze_zip_timestamp(frozen['frozenAt'])
    if len({relative.casefold() for relative in files}) != len(files):
        raise ValueError('Case-insensitive duplicate source paths cannot enter Windows extraction')
    release.update({'frozenAt': frozen['frozenAt'], 'freezeReceiptSha256': sha(freeze_path.read_bytes()), 'acceptedRuntime': frozen['acceptedRuntime'], 'publicProofInputs': frozen.get('publicProofInputs', []), 'offlineBaselines': frozen['offlineBaselines']})
    release_bytes = (json.dumps(release, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    DESTINATION.mkdir(parents=True, exist_ok=True)
    if ARCHIVE.exists():
        history = DESTINATION / 'history'
        history.mkdir(exist_ok=True)
        previous = history / ('fsp-signal-source-0.6.0-' + sha(ARCHIVE.read_bytes())[:12] + '.zip')
        if not previous.exists():
            shutil.copyfile(ARCHIVE, previous)
    entries = [(relative, path.read_bytes()) for relative, path in sorted(files.items())]
    entries.append(('RELEASE-METADATA.json', release_bytes))
    manifest = [{'path': path, 'sha256': sha(data), 'bytes': len(data)} for path, data in entries]
    with zipfile.ZipFile(ARCHIVE, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as package:
        for path, data in entries + [('SOURCE-MANIFEST.json', (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8'))]:
            item = zipfile.ZipInfo('fsp-signal/' + path, zip_timestamp)
            item.compress_type = zipfile.ZIP_DEFLATED
            package.writestr(item, data)
    with zipfile.ZipFile(ARCHIVE) as package:
        if package.testzip() is not None or len(package.namelist()) != len(set(package.namelist())):
            raise ValueError('ZIP integrity/unique set failed')
    receipt = {'schemaVersion': 1, 'applicationVersion': '0.6.0', 'sealedAt': datetime.now(timezone.utc).isoformat(), 'archive': ARCHIVE.relative_to(ROOT).as_posix(), 'sourceSha256': sha(ARCHIVE.read_bytes()), 'bytes': ARCHIVE.stat().st_size, 'manifestFiles': len(manifest), 'freezeReceiptSha256': release['freezeReceiptSha256'], 'metadata': release, 'cleanLaunch': 'not_run', 'privacyAudit': 'not_run'}
    (DESTINATION / 'source-seal.json').write_text(json.dumps(receipt, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
    print(json.dumps({k: receipt[k] for k in ['archive', 'sourceSha256', 'bytes', 'manifestFiles', 'cleanLaunch', 'privacyAudit']}, ensure_ascii=False))


if __name__ == '__main__':
    main()

"""Create a reproducible, secret-free source handoff from the project folder."""
from pathlib import Path
import hashlib
import json
import os
import re
import shutil
import sys
import zipfile
from source_qa_inputs import validate_qa_source_inputs, QA_SOURCE_ALLOWED_INPUTS, QA_SOURCE_CURRENT_REPORT_INPUTS

root = Path(__file__).resolve().parents[1]
destination = root / 'outputs' / 'submission'
destination.mkdir(parents=True, exist_ok=True)
archive = destination / 'fsp-signal-source.zip'
excluded = {'node_modules', '.git', 'dist', '.cache', '__pycache__', 'outputs', '.replit', 'local-backup'}
files = []
for folder, directories, names in os.walk(root):
    directories[:] = sorted(name for name in directories if name not in excluded)
    for name in names:
        path = Path(folder) / name
        relative = path.relative_to(root)
        if relative.as_posix() == 'scripts/snapshot-qa-preserved-state.ts':
            continue  # Historical local-only helper contains protected fixture identifiers.
        if path.name.startswith('.env') and path.name != '.env.example':
            continue
        if path.suffix in {'.log', '.tsbuildinfo', '.zip', '.dump', '.sqlite', '.db'} or path.name == '.replitignore':
            continue
        files.append((path, relative))
for folder in ['quality', 'verification']:
    public_root = root / 'outputs' / folder
    # Public historical JSON protocols are preserved, never recursively include
    # extracted clean checkouts, screenshots, private raw answers or local backups.
    candidates = list(public_root.glob('*')) + list((public_root / 'history').glob('*'))
    for path in candidates:
        # These post-seal attestations identify this ZIP itself and belong beside it.
        if path.name.startswith(('final-report', 'clean-source-launch', 'source-privacy-audit')):
            continue
        if path.is_file() and path.suffix in {'.json', '.csv', '.md', '.txt'}:
            files.append((path, path.relative_to(root)))
for relative in ['outputs/verification/technical-description/build.json',
                 'outputs/verification/technical-description/content.txt',
                 'outputs/verification/qa-cycle-02-technical-description/visual-review.json',
                 'outputs/verification/mobile-refinement/observations.json',
                 'outputs/verification/mobile-refinement/contrast.json']:
    path = root / relative
    if path.is_file():
        files.append((path, path.relative_to(root)))
# Only reviewed frozen synthetic inputs, two exact code dependencies and the
# two exact measured public reports cited by current submission documents.
# The serving Docker image intentionally omits them; the source handoff needs
# them to reproduce offline unit/evaluator checks after clean extraction.
qa_frozen_inputs = validate_qa_source_inputs(root)
files.extend(qa_frozen_inputs)
program_source = (root / 'artifacts/api-server/src/lib/assessment-managed.ts').read_text(encoding='utf-8')
program_versions = dict(re.findall(r'id:\s*"(backend-python|frontend-typescript)"[\s\S]*?version:\s*"(signal-[\w-]+-v\d+)"', program_source.split('export function isProgramId')[0]))
assert set(program_versions) == {'backend-python', 'frontend-typescript'}, 'Current program registry metadata not found'
matching_source = (root / 'artifacts/api-server/src/lib/signal-matching.ts').read_text(encoding='utf-8')
algorithm = re.search(r'MATCH_ALGORITHM_VERSION\s*=\s*"([^\"]+)"', matching_source)[1]
metadata = {'releaseDate': '2026-10-06', 'applicationVersion': json.loads((root / 'package.json').read_text(encoding='utf-8-sig'))['version'], 'programVersions': program_versions, 'bankVersions': list(program_versions.values()), 'matchingAlgorithmVersion': algorithm, 'proofScope': 'Local synthetic/technical verification. Human grade validity and usability observations remain not_measured.', 'postSealCompanions': ['clean-source-launch.json', 'source-privacy-audit.json', 'final-report-refinement.json']}
metadata_bytes = (json.dumps(metadata, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
if '--check-only' in sys.argv:
    print(json.dumps({'checkOnly': True, 'prospectiveSourceFiles': len(files)+1, 'metadata': metadata,
                      'qaFrozenInputsSelected': sum(relative.as_posix() in QA_SOURCE_ALLOWED_INPUTS for _,relative in qa_frozen_inputs),
                      'qaCurrentPublicReportsSelected': sum(relative.as_posix() in QA_SOURCE_CURRENT_REPORT_INPUTS for _,relative in qa_frozen_inputs),
                      'qaFrozenInputPaths': [relative.as_posix() for _, relative in qa_frozen_inputs if relative.as_posix() in QA_SOURCE_ALLOWED_INPUTS],
                      'qaCurrentPublicReportPaths': [relative.as_posix() for _, relative in qa_frozen_inputs if relative.as_posix() in QA_SOURCE_CURRENT_REPORT_INPUTS]}, ensure_ascii=False))
    sys.exit(0)
if archive.exists():
    historical = destination / 'history'
    historical.mkdir(exist_ok=True)
    previous_sha = hashlib.sha256(archive.read_bytes()).hexdigest()
    previous = historical / f'fsp-signal-source-{previous_sha[:12]}.zip'
    if not previous.exists():
        shutil.copyfile(archive, previous)
manifest = []
with zipfile.ZipFile(archive, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as package:
    for path, relative in sorted(files, key=lambda item: item[1].as_posix()):
        data = path.read_bytes()
        item = zipfile.ZipInfo('fsp-signal/' + relative.as_posix(), (2026, 10, 6, 0, 0, 0))
        item.compress_type = zipfile.ZIP_DEFLATED
        package.writestr(item, data)
        manifest.append({'path': relative.as_posix(), 'sha256': hashlib.sha256(data).hexdigest(), 'bytes': len(data)})
    release_entry = zipfile.ZipInfo('fsp-signal/RELEASE-METADATA.json', (2026, 10, 6, 0, 0, 0))
    release_entry.compress_type = zipfile.ZIP_DEFLATED
    package.writestr(release_entry, metadata_bytes)
    manifest.append({'path': 'RELEASE-METADATA.json', 'sha256': hashlib.sha256(metadata_bytes).hexdigest(), 'bytes': len(metadata_bytes)})
    manifest_entry = zipfile.ZipInfo('fsp-signal/SOURCE-MANIFEST.json', (2026, 10, 6, 0, 0, 0))
    manifest_entry.compress_type = zipfile.ZIP_DEFLATED
    package.writestr(manifest_entry, json.dumps(manifest, ensure_ascii=False, indent=2))
with zipfile.ZipFile(archive) as package:
    assert package.testzip() is None
    assert not any(any(part in name.split('/') for part in ['node_modules', '.git', 'local-backup']) or (Path(name).name.startswith('.env') and Path(name).name != '.env.example') or name.endswith('.dump') for name in package.namelist())
print(json.dumps({'archive': str(archive), 'files': len(manifest), 'bytes': archive.stat().st_size, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest(), 'metadata': metadata}, ensure_ascii=False))

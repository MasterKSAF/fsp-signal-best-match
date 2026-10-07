"""Bundle the tested seal and current evidence; no reseal or external submission."""
from datetime import datetime, timezone
from pathlib import Path, PurePosixPath
import hashlib
import json
import sys
import zipfile
import shutil

root = Path(__file__).resolve().parents[1]
folder = root / 'outputs/submission'
source_zip = folder / 'fsp-signal-source.zip'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


# Keep the old option as an explicit description of the only supported mode.
# Recreating a ZIP here would invalidate clean-launch and privacy attestations.
assert all(argument in {'--reuse-tested-source', '--check-only'} for argument in sys.argv[1:]), 'Unsupported packaging option'
clean = read(root / 'outputs/verification/clean-source-launch.json')
current = read(root / 'outputs/verification/final-report-refinement.json')
assert clean['passed'] and clean['containerCleanup'] == 'complete' and current['passed']
source_sha = digest(source_zip)
assert source_sha == clean['sourceSha256'] == current['sourceSha256'], 'Source changed after verification'
with zipfile.ZipFile(source_zip) as archive:
    assert archive.testzip() is None
    metadata = json.loads(archive.read('fsp-signal/RELEASE-METADATA.json'))
assert current['applicationVersion'] == metadata['applicationVersion']
assert current['programVersions'] == metadata['programVersions']
assert current['matchingAlgorithmVersion'] == metadata['matchingAlgorithmVersion']
copies = {'verification/final-report-refinement.json': root / 'outputs/verification/final-report-refinement.json'}
for proof in current['proofFiles']:
    path = root / proof['file']
    assert digest(path) == proof['sha256'], f'Proof changed after finalization: {proof["file"]}'
    relative = PurePosixPath(proof['file']).relative_to('outputs')
    assert relative.parts[0] in {'quality', 'verification'} and '..' not in relative.parts
    copies[relative.as_posix()] = path
for name in ['assessment-validation-before-original.json', 'assessment-validation-before.json']:
    copies[f'quality/{name}'] = root / 'outputs/quality' / name
copies['verification/completion-status.md'] = root / 'docs/completion-status.md'
names = ['README-FIRST.md', 'fsp-signal-source.zip', 'Signal-Technical-Description.pdf',
         'Signal-Pitch.pptx', 'Signal-Pitch.pdf', 'Signal-Demo.mp4', 'Signal-Demo-audit.json']
for item in current['deliverables']:
    assert digest(folder / item['file']) == item['sha256'], f'Deliverable changed after finalization: {item["file"]}'
names += sorted(copies)
names += [path.relative_to(folder).as_posix() for path in sorted((folder / 'fonts').rglob('*')) if path.is_file()]
assert len(names) == len(set(names)), 'Duplicate submission names'
for name in names:
    path = copies.get(name, folder / name)
    assert path.is_file() and path.stat().st_size > 0, f'Missing deliverable: {name}'
manifest = {
    'applicationVersion': metadata['applicationVersion'], 'programVersions': metadata['programVersions'],
    'bankVersions': metadata['bankVersions'], 'matchingAlgorithmVersion': metadata['matchingAlgorithmVersion'],
    'sourceSha256': source_sha, 'generatedAt': datetime.now(timezone.utc).isoformat(),
    'scope': 'Local verified handoff. No external upload, publication or contest submission.',
    'files': [{'file': name, 'bytes': copies.get(name, folder / name).stat().st_size,
               'sha256': digest(copies.get(name, folder / name))} for name in names],
}
if '--check-only' in sys.argv:
    print(json.dumps({'checkOnly': True, 'sourceSha256': source_sha, 'applicationVersion': metadata['applicationVersion'],
                      'files': len(names), 'bankVersions': metadata['bankVersions']}, ensure_ascii=False))
    sys.exit(0)
for name, path in copies.items():
    target = folder / name
    target.parent.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(path, target)
manifest_path = folder / 'submission-manifest.json'
manifest_path.write_text(json.dumps(manifest, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
destination = folder / 'Signal-Best-Match.zip'
if destination.exists():
    historical = folder / 'history'
    historical.mkdir(exist_ok=True)
    previous = historical / f'Signal-Best-Match-{digest(destination)[:12]}.zip'
    if not previous.exists():
        shutil.copyfile(destination, previous)
with zipfile.ZipFile(destination, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as package:
    for name in names + [manifest_path.name]:
        package.write(folder / name, name)
with zipfile.ZipFile(destination) as package:
    assert package.testzip() is None
    assert len(package.namelist()) == len(names) + 1
    for item in manifest['files']:
        data = package.read(item['file'])
        assert len(data) == item['bytes'] and hashlib.sha256(data).hexdigest() == item['sha256'], item['file']
assert digest(source_zip) == source_sha, 'Submission packaging changed the source seal'
print(json.dumps({'archive': str(destination), 'bytes': destination.stat().st_size,
                  'sha256': digest(destination), 'sourceSha256': source_sha, 'applicationVersion': metadata['applicationVersion']}, ensure_ascii=False))

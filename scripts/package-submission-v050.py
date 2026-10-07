"""Bundle only the exact tested 0.5.0 source seal and reviewed companions.

This creates a local delivery ZIP, never changes the source ZIP and never sends
files externally. Preparation --check-only does not create a delivery archive.
"""
from pathlib import Path, PurePosixPath
from datetime import datetime, timezone
import argparse
import hashlib
import json
import shutil
import zipfile

ROOT = Path(__file__).resolve().parents[1]
RELEASE = ROOT / 'outputs/release-0.5.0'
SOURCE = RELEASE / 'fsp-signal-source-0.5.0.zip'
DESTINATION = RELEASE / 'Signal-Best-Match-0.5.0.zip'
sha = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()


def read(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def canonical_path(relative):
    path = PurePosixPath(relative)
    return (isinstance(relative, str) and relative == path.as_posix()
            and not path.is_absolute() and bool(path.parts)
            and ':' not in relative and '\\' not in relative
            and not any(p in {'.', '..', 'private', 'raw', 'screens', 'local-backup'} for p in path.parts)
            and not any(p.startswith('clean-') for p in path.parts[:-1]))


def collect():
    final = read(RELEASE / 'final-report.json')
    clean = read(RELEASE / 'clean-source-launch.json')
    privacy = read(RELEASE / 'source-privacy-audit.json')
    if final.get('applicationVersion') != '0.5.0' or final.get('status') != 'PASS':
        raise ValueError('Current 0.5.0 final acceptance required')
    required = {'functional', 'browser', 'fullLoad', 'cleanLaunch', 'privacy', 'mediaVisual'}
    if not required.issubset(final.get('checks', {})) or any(final['checks'][key] is not True for key in required):
        raise ValueError('All required types of current acceptance must pass')
    source_sha = sha(SOURCE)
    if final.get('sourceSha256') != source_sha or clean.get('sourceSha256') != source_sha or privacy.get('sourceSha256') != source_sha:
        raise ValueError('Companions identify a different source ZIP')
    if not clean.get('passed') or clean.get('cleanup') != 'complete' or not clean.get('protectedRuntimePreserved'):
        raise ValueError('Exact isolated clean launch and cleanup required')
    if not privacy.get('passed') or not privacy.get('sealedArchiveUnchanged') or privacy.get('findings'):
        raise ValueError('Exact sealed source privacy PASS required')
    with zipfile.ZipFile(SOURCE) as archive:
        if archive.testzip() is not None:
            raise ValueError('Source ZIP CRC failed')
        metadata = json.loads(archive.read('fsp-signal/RELEASE-METADATA.json'))
        if metadata.get('applicationVersion') != '0.5.0':
            raise ValueError('Historical source cannot enter the new delivery')
        if clean.get('runtime', {}).get('bundleSHA') != metadata['acceptedRuntime']['bundleSHA']:
            raise ValueError('Clean compiled API differs from accepted source runtime')
        if not clean['runtime'].get('sourceMatchesSealed') or not clean['runtime'].get('bundleMatchesAccepted'):
            raise ValueError('Clean runtime attestations missing')
        readme_sha = hashlib.sha256(archive.read('fsp-signal/docs/submission-readme-0.5.0.md')).hexdigest()
        if sha(ROOT / 'docs/submission-readme-0.5.0.md') != readme_sha:
            raise ValueError('Delivery README differs from the accepted sealed source')
    files = {'fsp-signal-source-0.5.0.zip': SOURCE,
             'README-FIRST.md': ROOT / 'docs/submission-readme-0.5.0.md',
             'verification/final-report.json': RELEASE / 'final-report.json'}
    proofs = final.get('proofFiles', [])
    if not proofs or len(proofs) > 100:
        raise ValueError('Bounded explicit reviewed public proofs required')
    kinds = set()
    for item in proofs:
        relative = item['file']
        if not canonical_path(relative) or not relative.startswith(('outputs/verification/', 'outputs/release-0.5.0/', 'docs/')) or Path(relative).suffix.lower() not in {'.json', '.md', '.txt', '.csv'}:
            raise ValueError('Unreviewed private/non-text proof path')
        path = ROOT / relative
        if path.is_symlink() or not path.resolve().is_relative_to(ROOT) or sha(path) != item['sha256']:
            raise ValueError('Reviewed proof drifted')
        name = 'verification/' + relative
        if name in files:
            raise ValueError('Duplicate proof delivery path')
        files[name] = path
        kinds.add(item['kind'])
    if not required.issubset(kinds):
        raise ValueError('Separate evidence required for every accepted check type')
    deliverables = final.get('deliverables', [])
    expected = {'Signal-Technical-Description.pdf', 'Signal-Pitch.pptx', 'Signal-Pitch.pdf', 'Signal-Demo.mp4', 'Signal-Demo-audit.json'}
    if {item['file'] for item in deliverables} != expected or len(deliverables) != len(expected):
        raise ValueError('Exact five reviewed media companions required')
    for item in deliverables:
        name = item['file']
        path = RELEASE / name
        if not path.is_file() or path.is_symlink() or not path.stat().st_size or sha(path) != item['sha256']:
            raise ValueError('Reviewed media missing/drifted')
        files[name] = path
    if any(not path.is_file() or path.stat().st_size == 0 for path in files.values()):
        raise ValueError('Empty delivery input')
    if len({name.casefold() for name in files}) != len(files):
        raise ValueError('Case-insensitive duplicate delivery paths')
    return files, metadata, source_sha, final


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--check-only', action='store_true')
    args = parser.parse_args()
    files, metadata, source_sha, final = collect()
    manifest = {'schemaVersion': 1, 'applicationVersion': '0.5.0',
                'createdAt': datetime.now(timezone.utc).isoformat(),
                'sourceSha256': source_sha, 'programVersions': metadata['programVersions'],
                'matchingAlgorithmVersion': metadata['matchingAlgorithmVersion'],
                'scope': 'Local handoff only; no external publication, upload or contest submission.',
                'limitations': final.get('limitations', []),
                'files': [{'file': name, 'bytes': path.stat().st_size, 'sha256': sha(path)}
                          for name, path in sorted(files.items())]}
    if args.check_only:
        print(json.dumps({'checkOnly': True, 'archiveCreated': False, 'sourceSha256': source_sha, 'files': len(files)}))
        return
    manifest_bytes = (json.dumps(manifest, ensure_ascii=False, indent=2) + '\n').encode('utf-8')
    if DESTINATION.exists():
        history = RELEASE / 'history'
        history.mkdir(exist_ok=True)
        historical = history / f'Signal-Best-Match-0.5.0-{sha(DESTINATION)[:12]}.zip'
        if not historical.exists():
            shutil.copyfile(DESTINATION, historical)
    temporary = RELEASE / 'Signal-Best-Match-0.5.0.next.zip'
    with zipfile.ZipFile(temporary, 'w', zipfile.ZIP_DEFLATED, compresslevel=9) as archive:
        for name, path in sorted(files.items()):
            archive.write(path, name)
        archive.writestr('submission-manifest.json', manifest_bytes)
    with zipfile.ZipFile(temporary) as archive:
        if archive.testzip() is not None or len(archive.namelist()) != len(files) + 1:
            raise ValueError('Delivery CRC/member check failed')
        for item in manifest['files']:
            data = archive.read(item['file'])
            if len(data) != item['bytes'] or hashlib.sha256(data).hexdigest() != item['sha256']:
                raise ValueError('Delivery member differs from reviewed input')
    if sha(SOURCE) != source_sha:
        raise ValueError('Packaging altered the tested source seal')
    temporary.replace(DESTINATION)
    (RELEASE / 'submission-manifest.json').write_bytes(manifest_bytes)
    receipt = {'schemaVersion': 1, 'applicationVersion': '0.5.0', 'passed': True,
               'archive': DESTINATION.relative_to(ROOT).as_posix(),
               'sha256': sha(DESTINATION), 'bytes': DESTINATION.stat().st_size,
               'sourceSha256': source_sha, 'sourceSealUnchanged': True,
               'files': len(files), 'externalSubmissionPerformed': False}
    (RELEASE / 'package-ready.json').write_text(json.dumps(receipt, indent=2) + '\n', encoding='utf-8')
    print(json.dumps(receipt))


if __name__ == '__main__':
    main()

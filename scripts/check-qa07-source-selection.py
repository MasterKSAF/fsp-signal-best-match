"""Check the real packager selection without creating a submission ZIP."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import contextlib
import hashlib
import importlib.util
import io
import json
import sys

ROOT = Path(__file__).resolve().parents[1]
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--output', choices=['outputs/verification/qa07-final-source-selection-preflight.json',
                                         'outputs/verification/qa07-technical-source-selection-preflight.json'],
                    default='outputs/verification/qa07-final-source-selection-preflight.json')
args = parser.parse_args()
digest = lambda path: hashlib.sha256(path.read_bytes()).hexdigest()
archive = ROOT / 'outputs/submission/fsp-signal-source.zip'
archive_before = digest(archive)
sys.path.insert(0, str(ROOT / 'scripts'))
previous_argv = sys.argv
sys.argv = ['scripts/package-source.py', '--check-only']
namespace = {'__name__': '__main__', '__file__': str(ROOT / 'scripts/package-source.py')}
captured = io.StringIO()
try:
    with contextlib.redirect_stdout(captured):
        try:
            exec(compile((ROOT / 'scripts/package-source.py').read_text(encoding='utf-8'),
                         'scripts/package-source.py', 'exec'), namespace)
        except SystemExit as stopped:
            assert stopped.code == 0
finally:
    sys.argv = previous_argv
selection = json.loads(captured.getvalue())
selected = {relative.as_posix(): path for path, relative in namespace['files']}
assert 'scripts/snapshot-qa-preserved-state.ts' not in selected
wanted = ['outputs/verification/qa-cycle-04-independent-load.json',
          'outputs/verification/qa-cycle-04-independent-acceptance.json',
          'outputs/verification/qa-cycle-04-quality-equivalence.json',
          'outputs/verification/qa-cycle-04-working-runtime.json',
          'outputs/verification/qa-cycle-04-runtime-ready.json',
          'outputs/verification/qa07-load.json', 'outputs/verification/qa07-fixed-profile-history.json',
          'scripts/compact-load-acceptance.py', 'scripts/clean-source-launch.ps1',
          'scripts/qa07-load-preservation.mts', 'scripts/finalize-qa-cycle-02.py',
          'outputs/verification/qa-cycle-02-technical-description.json',
          'outputs/verification/technical-description/build.json',
          'outputs/verification/technical-description/content.txt',
          'outputs/verification/qa-cycle-02-technical-description/visual-review.json']
assert all(relative in selected for relative in wanted)
assert selection['qaFrozenInputsSelected'] == 11 and selection['qaCurrentPublicReportsSelected'] == 2
spec = importlib.util.spec_from_file_location('signal_source_privacy', ROOT / 'scripts/audit-source-privacy.py')
privacy = importlib.util.module_from_spec(spec)
spec.loader.exec_module(privacy)
for relative in wanted:
    assert privacy.exclusion_category('fsp-signal/' + relative) is None
for relative in ['outputs/verification/technical-description/page-21.png',
                 'outputs/verification/technical-description/private.txt',
                 'outputs/verification/qa-cycle-02-technical-description/other.json',
                 'outputs/verification/qa-cycle-02-technical-description/page-21.png']:
    assert relative not in selected
    assert privacy.exclusion_category('fsp-signal/' + relative) is not None
technical = json.loads((ROOT / 'outputs/verification/qa-cycle-02-technical-description.json').read_text(encoding='utf-8-sig'))
assert technical['passed'] and technical['artifact']['pages'] == 21
for field in ['build', 'extractedContent', 'visualReview']:
    reference = technical['audit'][field]
    assert reference['path'] in selected and digest(selected[reference['path']]) == reference['sha256']
assert digest(archive) == archive_before
rows = [{'path': relative, 'sha256': digest(selected[relative]), 'selected': True} for relative in wanted]
proof = {'version': 'signal-qa07-final-source-selection-preflight-v2',
         'recordedAt': datetime.now(timezone.utc).isoformat(), 'passed': True,
         'scope': 'Real check-only source selection; no submission ZIP written, no runtime/database operations',
         'selectedCurrentInputs': rows, 'frozenInputsSelected': 11, 'pinnedCurrentReportsSelected': 2,
         'technicalAuditReferencesAndExactHashesSelected': True,
         'unlistedNeighborTextJsonAndRenderedImagesRejected': True,
         'sourceArchiveUnchangedSha256': archive_before,
         'prospectiveFileCountAtCheck': selection['prospectiveSourceFiles'],
         'actualCleanSourceArchiveRun': 'pending root final-document/source-seal release'}
output = ROOT / args.output
if output.exists():
    previous_sha = digest(output)
    preserved = ROOT / ('outputs/verification/history/' + output.stem + '-' + previous_sha[:12] + '.json')
    if not preserved.exists():
        preserved.write_bytes(output.read_bytes())
    assert digest(preserved) == previous_sha
    proof['previousPreflight'] = {'path': preserved.relative_to(ROOT).as_posix(), 'sha256': previous_sha}
output.write_text(json.dumps(proof, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passed': True, 'report': args.output, 'selectedCurrentInputs': len(rows),
                  'frozenInputs': 11, 'pinnedReports': 2, 'technicalAuditReferences': 3,
                  'ZIPUnchangedSha256': archive_before, 'prospectiveFiles': selection['prospectiveSourceFiles']}))

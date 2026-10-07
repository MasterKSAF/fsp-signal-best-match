"""Export only safe facts from the independently produced performance retest."""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, json, shutil

ROOT = Path(__file__).resolve().parents[1]
BASELINE = 'sha256:55a5c92928c6f0f9d22e07ca6d991e32fa39602d86f2ee871cbe41d3f83c0120'
CHANGED = {
    'artifacts/api-server/src/routes/signal-employer-matching.ts',
    'artifacts/api-server/src/lib/assessment-ranking-evidence.ts',
    'artifacts/api-server/src/lib/skill-catalog.ts',
    'artifacts/api-server/src/lib/matching-pool-admission.ts',
}
def digest(path): return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path): return json.loads(path.read_text(encoding='utf-8-sig'))
parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--matching-report', required=True)
parser.add_argument('--source-guard-report', required=True)
args = parser.parse_args()
original = Path(args.matching_report).resolve()
audit_root = (ROOT.parent/'docs/best-match/qa-cycle-2026-10-06/matching').resolve()
assert original.is_relative_to(audit_root), 'Explicit independently produced local matching report required'
report = read(original)
guard_path = Path(args.source_guard_report).resolve()
assert guard_path.is_relative_to(audit_root)
guard = read(guard_path)
current = read(ROOT/'outputs/verification/qa-cycle-04-working-runtime.json')
baseline = read(ROOT/'outputs/verification/qa-cycle-01-working-runtime.json')
checks = [{'name': item.get('name', item.get('id')), 'passed': item.get('passed', item.get('status') == 'pass')} for item in report['checks']]
assert len(checks) == 20 and all(item['passed'] for item in checks)
assert report['summary']['passed'] == 20 and report['summary']['failed'] == 0
assert not report['summary']['fatal'] and report['cleanup']['passed'] and report['cleanup']['remainingIds'] == []
assert report['runtimeUnchanged'] and report['sourceUnchanged'] and report['localSourceMatchesRuntime']
runtime = report['before']['runtime']
assert runtime['image'] == current['imageId'] != BASELINE
assert runtime['bundleSha256'] == current['bundleSHA']
assert guard['image'] == current['imageId'] and guard['bundle'] == current['bundleSHA']
assert guard['localMatchesServed'] and guard['sourceStable'] and guard['runtimeStable'] and guard['sourceCount'] == 9
assert guard['sourceBefore'] == guard['sourceAfter']
for path, value in runtime['sourceHashes'].items(): assert guard['sourceBefore'][path] == value
for path, value in guard['sourceBefore'].items():
    if path in current['sourceHashes']: assert current['sourceHashes'][path] == value
    assert digest(ROOT/path) == value
assert current['frontendManifestSHA'] == baseline['frontendManifestSHA']
changed_in_previous_attestation = {path for path, value in baseline['sourceHashes'].items() if current['sourceHashes'][path] != value}
assert changed_in_previous_attestation == CHANGED - {'artifacts/api-server/src/lib/assessment-ranking-evidence.ts', 'artifacts/api-server/src/lib/matching-pool-admission.ts'}
assert current['sourceHashes']['artifacts/api-server/src/lib/signal-matching.ts'] == '5132063b3585b3e3c7a3cc98644287288058994c1e9b6b12a29ae016ab9bde44'
out = {
    'schemaVersion': 'signal-safe-performance-targeted-acceptance-v1',
    'exportedAt': datetime.now(timezone.utc).isoformat(), 'passed': True,
    'provenance': 'Independent retest in a separate audit chat; strict export omits fixture identities, payloads, credentials, answers and contacts.',
    'originalReportSha256': digest(original), 'sourceGuardReportSha256': digest(guard_path), 'applicationVersion': '0.4.1',
    'imageId': current['imageId'], 'apiBundleSha256': current['bundleSHA'],
    'baselineImageId': BASELINE, 'targetedBuiltRuntimeGroups': 20,
    'checks': checks, 'fixturesCleaned': True, 'runtimeUnchanged': True,
    'matcherSha256': current['sourceHashes']['artifacts/api-server/src/lib/signal-matching.ts'],
    'sourceHashes': guard['sourceBefore'], 'changedApplicationPaths': sorted(CHANGED),
    'frontendManifestSha256': current['frontendManifestSHA'],
    'mediaCompatibility': {
        'passed': True, 'captureImageId': BASELINE, 'acceptedRuntimeImageId': current['imageId'],
        'sameFrontendBytes': True, 'unchangedMatcherAndTransferModel': True,
        'scope': 'Backend performance optimization only; pure normalization and compiled initial admission preserve outcomes; targeted matching tests cover ranking, provenance, explanations and access. Original media capture provenance stays unchanged.',
    },
    'limits': ['The earlier 60 groups remain measured on image55a5; they are not relabelled as a complete retest of the new image.', 'These20 groups do not measure latency; the unchanged load profile has its own report.'],
}
target = ROOT/'outputs/verification/qa-cycle-04-independent-acceptance.json'
if target.exists():
    history = target.parent/'history'
    history.mkdir(exist_ok=True)
    previous = history/(target.stem+'-'+digest(target)[:12]+'.json')
    if not previous.exists(): shutil.copyfile(target, previous)
target.write_text(json.dumps(out, ensure_ascii=False, indent=2)+'\n', encoding='utf-8')
print(json.dumps({'passed': True, 'targetedGroups': 20, 'file': str(target), 'sha256': digest(target)}))

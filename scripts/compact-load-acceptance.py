"""Export the independent load audit without fixture identities or private paths."""
from pathlib import Path
from datetime import datetime, timezone
import argparse
import hashlib
import json
import shutil

ROOT = Path(__file__).resolve().parents[1]


def sha(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


parser = argparse.ArgumentParser(description=__doc__)
parser.add_argument('--report', type=Path, required=True)
parser.add_argument('--output', default='outputs/verification/qa-cycle-04-independent-load.json')
args = parser.parse_args()
audit = json.loads(args.report.read_text(encoding='utf-8-sig'))
runtime = json.loads((ROOT / 'outputs/verification/qa-cycle-04-working-runtime.json').read_text(encoding='utf-8-sig'))
assert audit['inspectionPassed'] and audit['loadAcceptancePassed'] and not audit['blockingFindings']
assert audit['imageId'] == runtime['imageId']
assert audit['bundleSha256'] == runtime['bundleSHA']
assert audit['sourceHashCount'] == len(runtime['sourceHashes']) == 22
assert audit['runtimeStableDuringRun'] and audit['currentListedSourceHashesMatch']
assert audit['profileAndLimitsUnchanged'] and audit['protectedOrdinaryRecordsPreserved']
assert audit['ownLoadFixtureCount'] == 1016 and audit['ownLoadFixturesRemaining'] == 0
assert not audit['diagnosticProfilerUsedThisRun'] and audit['errors'] == 0
assert audit['scriptSha256'] == sha(ROOT / 'scripts/load-scale.ts')
assert len(audit['failedHistory']) == 3 and all(item['failed'] and item['preservedExact'] for item in audit['failedHistory'])
inputs = []
for item in audit['inputs']:
    # Only hashes of project-owned, public verification records are exported.
    relative = Path(item['source']).relative_to('fsp-signal')
    assert relative.parts[:2] == ('outputs', 'verification') and '..' not in relative.parts
    assert sha(ROOT / relative) == item['sha256']
    inputs.append({'file': relative.as_posix(), 'sha256': item['sha256']})
routes = []
for item in audit['routeResults']:
    assert item['route'] in {'catalogue', 'profile', 'pdf', 'matching', 'explanation'}
    assert item['passed'] and item['errors'] == 0 and item['p95Ms'] <= item['p95LimitMs']
    routes.append({key: item[key] for key in ('route', 'requests', 'errors', 'p50Ms', 'p95Ms', 'p99Ms', 'passed', 'p95LimitMs')})
report = {
    'schemaVersion': 'signal-safe-independent-load-acceptance-v1',
    'exportedAt': datetime.now(timezone.utc).isoformat(),
    'passed': True,
    'originalReportSha256': sha(args.report),
    'provenance': 'Independent file audit in a separate audit chat; strict export excludes fixture identities, payloads and private paths.',
    'imageId': audit['imageId'], 'apiBundleSha256': audit['bundleSha256'],
    'matcherSha256': audit['matcherSha256'], 'sourceHashCount': 22,
    'runtimeStableDuringRun': True, 'profileAndLimitsUnchanged': True,
    'scriptSha256': audit['scriptSha256'], 'fixtureHash': audit['fixtureHash'],
    'warmupSeconds': audit['warmupSeconds'], 'elapsedSeconds': audit['elapsedSeconds'],
    'totalRequests': audit['totalRequests'], 'errors': 0, 'rps': audit['rps'],
    'telemetrySamples': audit['telemetrySamples'], 'peakMemoryMiB': audit['peakMemoryMiB'],
    'routes': routes, 'inputs': inputs,
    'protectedOrdinaryRecordsPreserved': True, 'exactOwnCleanup': True,
    'ownLoadFixturesRemaining': 0, 'diagnosticProfilerUsedThisRun': False,
    'failedHistory': [{key: item[key] for key in ('run', 'sha256', 'failed', 'matchingP95Ms', 'explanationP95Ms', 'preservedExact')} for item in audit['failedHistory']],
    'limits': ['One fixed local synthetic workload; not production capacity.',
               'Percentiles are recorded aggregates from the unchanged load script; raw duration arrays were not retained.',
               'Runtime semantic acceptance and sealed-source launch have separate proofs.'],
}
target = ROOT / args.output
if target.exists():
    previous = target.parent / 'history' / (target.stem + '-' + sha(target)[:12] + '.json')
    previous.parent.mkdir(parents=True, exist_ok=True)
    if not previous.exists():
        shutil.copyfile(target, previous)
target.write_text(json.dumps(report, ensure_ascii=False, indent=2) + '\n', encoding='utf-8')
print(json.dumps({'passed': True, 'output': args.output, 'sha256': sha(target)}))

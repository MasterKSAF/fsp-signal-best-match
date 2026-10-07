"""Record actual targeted performance-repair checks without relabelling history."""
from pathlib import Path
from datetime import datetime, timezone
import argparse, hashlib, json, re
ROOT=Path(__file__).resolve().parents[1]
def digest(path):return hashlib.sha256(path.read_bytes()).hexdigest()
def read(path):return json.loads(path.read_text(encoding='utf-8-sig'))
parser=argparse.ArgumentParser(description=__doc__)
parser.add_argument('--loader-proof',required=True)
args=parser.parse_args()
loader_path=Path(args.loader_proof)
assert not loader_path.is_absolute() and '..' not in loader_path.parts
runtime=read(ROOT/'outputs/verification/qa-cycle-04-working-runtime.json')
http=read(ROOT/'outputs/verification/qa-cycle-04-matching-http.json')
sql=read(ROOT/'outputs/verification/qa07-readonly-perf.json')
loader=read(ROOT/loader_path)
unit_path=ROOT/'outputs/verification/qa-cycle-04-unit.log'
unit=unit_path.read_text(encoding='utf-8-sig')
passed=int(re.search(r'(?m)^.*?\bpass\s+(\d+)\s*$',unit).group(1))
failed=int(re.search(r'(?m)^.*?\bfail\s+(\d+)\s*$',unit).group(1))
assert passed>=155 and failed==0
type_path=ROOT/'outputs/verification/qa-cycle-04-typecheck.log'
type_log=type_path.read_text(encoding='utf-8-sig')
assert all(line in type_log for line in ['artifacts/api-server typecheck: Done','scripts typecheck: Done','artifacts/fsp-signal typecheck: Done'])
assert 'error TS' not in type_log and 'Failed' not in type_log
assert http['passed'] and len(http['groups'])==6
assert sql['actualSqlCapturedFromProductionLoader'] and sql['rubricHashesAndObjectKeysEquivalent'] and sql['malformedShapesPreserved']
assert sql['productionLoaderSha256']==runtime['sourceHashes']['artifacts/api-server/src/lib/assessment-ranking-evidence.ts']
assert loader['passed']
additional_paths={
 'catalogRegression':'outputs/verification/qa-cycle-03-catalog-regression.json',
 'admissionRegression':'outputs/verification/qa-cycle-03-admission-regression.json',
 'qualityEquivalence':'outputs/verification/qa-cycle-04-quality-equivalence.json',
}
additional={name:read(ROOT/path) for name,path in additional_paths.items()}
assert all(item['passed'] for item in additional.values())
for path,value in additional['qualityEquivalence']['sourceHashes'].items():assert runtime['sourceHashes'][path]==value
out={
 'schemaVersion':'signal-performance-functional-summary-v1',
 'recordedAt':datetime.now(timezone.utc).isoformat(),'passed':True,'applicationVersion':'0.4.1',
 'imageId':runtime['imageId'],'apiBundleSha256':runtime['bundleSHA'],'sourceHashes':runtime['sourceHashes'],
 'unit':{'passed':passed,'failed':0,'runnerLogSha256':digest(unit_path)},
 'typecheck':{'passed':True,'runnerLogSha256':digest(type_path)},
 'targetedHttpGroups':6,
 'sqlProjection':{'passed':True,'proofSha256':digest(ROOT/'outputs/verification/qa07-readonly-perf.json'),'sourceLoaderSha256':sql['productionLoaderSha256']},
 'loaderRegression':{'passed':True,'proofPath':loader_path.as_posix(),'proofSha256':digest(ROOT/loader_path)},
 **{name:{'passed':True,'proofPath':path,'proofSha256':digest(ROOT/path)} for name,path in additional_paths.items()},
 'historicalCheckpoint':{'proofPath':'outputs/verification/qa-cycle-02-functional-summary.json','proofSha256':digest(ROOT/'outputs/verification/qa-cycle-02-functional-summary.json'),'imageId':'sha256:55a5c92928c6f0f9d22e07ca6d991e32fa39602d86f2ee871cbe41d3f83c0120'},
 'limits':['The earlier65 built HTTP groups and130 ID requests remain a historical checkpoint on image55a5.','Current regression scope covers four backend performance paths; no human measurements or production capacity claim.'],
}
target=ROOT/'outputs/verification/qa-cycle-04-functional-summary.json'
target.write_text(json.dumps(out,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(json.dumps({'passed':True,'unit':passed,'targetedHttpGroups':6,'file':str(target)}))

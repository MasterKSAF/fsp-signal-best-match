"""Attest the root-released NORMAL 0.6.1 dist and current code; never build it."""
from pathlib import Path
import json, hashlib, os
root=Path(__file__).resolve().parents[1]
sha=lambda path:hashlib.sha256(path.read_bytes()).hexdigest()
expected='78b798efdcf9c130655eebb7c1d65a05cd9f0c73913db6ccca7162109b95021d'
released=root/'outputs/local-backup/v061-independent-normal-78b798efdcf9'
inventory=json.loads((released/'bundle-files.json').read_text(encoding='utf8'))
assert len(inventory)==11
files={item['name']:item['sha256'] for item in inventory}
assert files['index.mjs']==expected
actual=root/'artifacts/api-server/dist'
assert sorted(p.name for p in actual.iterdir())==sorted(files)
for name,digest in files.items():
    assert sha(released/'dist'/name)==digest
    assert sha(actual/name)==digest
selected={}
skip={'node_modules','dist','.git','outputs','.load-runtime','.cache','__pycache__'}
for base in ['artifacts','lib','scripts','tests']:
    for directory,dirs,names in os.walk(root/base,followlinks=False):
        dirs[:]=sorted(d for d in dirs if d not in skip and not (Path(directory)/d).is_symlink())
        for name in sorted(names):
            path=Path(directory)/name
            if path.suffix.lower() in {'.md','.log','.zip','.dump','.mp4','.pdf','.pptx','.pyc'} or path.is_symlink():continue
            if name.startswith('.env'):continue
            selected[path.relative_to(root).as_posix()]=sha(path)
for name in ['package.json','pnpm-lock.yaml','pnpm-workspace.yaml','tsconfig.json','tsconfig.base.json','compose.yaml','Dockerfile','.gitignore','.dockerignore','.npmrc']:
    path=root/name
    if path.is_file():selected[name]=sha(path)
# Verify actual map source bytes for every project source embedded in the build.
mapping=json.loads((actual/'index.mjs.map').read_text(encoding='utf8'))
embedded={}
for name,content in zip(mapping['sources'],mapping['sourcesContent']):
    source=(actual/name).resolve()
    if not source.is_relative_to(root) or 'node_modules' in source.parts:continue
    if not source.is_file():continue
    digest=hashlib.sha256(content.encode('utf8')).hexdigest()
    assert sha(source)==digest,source.name
    embedded[source.relative_to(root).as_posix()]=digest
for required in ['artifacts/api-server/src/lib/signal-fresh-ranking-cache.ts','artifacts/api-server/src/lib/signal-resume-matching.ts','artifacts/api-server/src/routes/signal-employer-matching.ts','artifacts/api-server/src/lib/assessment-ranking-evidence.ts']:
    assert required in embedded,required
output=root/'outputs/verification/independent-performance-20261007/current-build-candidate.json'
receipt={'schemaVersion':1,'applicationVersion':'0.6.1','bundleSHA':expected,'sourceHashes':dict(sorted(selected.items())),'distFiles':files,'embeddedProjectInputHashes':embedded,'embeddedProjectInputsVerified':len(embedded),'buildSource':'Root actual pnpm build/test327 PASS; all eleven released normal dist files and actual map project source contents verified. No build performed by attestor.'}
output.write_text(json.dumps(receipt,ensure_ascii=False,indent=2)+'\n',encoding='utf8')
print(json.dumps({'path':output.relative_to(root).as_posix(),'sha256':sha(output),'sources':len(selected),'embeddedProjectInputs':len(embedded),'assets':len(files),'bundleSHA':expected}))

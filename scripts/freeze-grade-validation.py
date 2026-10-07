"""Explicit one-time fixture freeze. Do not run to silently bless changed expectations."""
import hashlib,json
from pathlib import Path
root=Path(__file__).resolve().parents[1]
files=['docs/validation/visible-forms-v1.json','docs/validation/reference-answers-v1.json','docs/validation/work-profiles-v1.json']
output=root/'docs/validation/frozen-manifest-v1.json'
if output.exists():raise SystemExit('Manifest already exists. New control requires a new version, not overwriting the frozen labels.')
result={'version':'signal-grade-validation-v1','frozenBeforeEvaluation':True,'frozenDate':'2026-10-06','origin':'AI-assisted synthetic team reference, not independent human expertise','files':{path:hashlib.sha256((root/path).read_bytes()).hexdigest() for path in files},'development':'independent-v1','diagnosticHoldout':'independent-holdout-v1 (previous golden seed; diagnostic, not unseen human control)','freshControl':'grade-validation-20261006-fresh-control; newly generated public instances, labels frozen before scoring; unseen parameters, same semantic templates. Not an unseen construct or recruited people.'}
output.write_text(json.dumps(result,indent=2)+'\n',encoding='utf-8')
print(json.dumps(result))

import json,hashlib,datetime
from pathlib import Path
base=Path('outputs/verification/full-audit-a01-a11-20261008/bank')
files=['profiles-frozen-before-scoring.json','reference-primary-v2-frozen-before-b4-rerun.json','independent-review/middle-semantic-worksheet-v2-frozen.json','independent-review/senior-all-semantic-108-frozen.json','public-only-scenarios-python-lifecycle-final-review-frozen.json','independent-review/protocol-semantic-mapping-v3-frozen.json','independent-review/lower-seven-protocol-semantic-mapping-v4-frozen.json','independent-review/python-two-protocol-semantic-mapping-v5-frozen.json']
inputs={f:json.loads((base/f).read_text()) for f in files};primary={r['key']:r for r in inputs[files[1]]['rows']};middle={r['key']:r for r in inputs[files[2]]['rows']};senior={r['key']:r for r in inputs[files[3]]['rows']};public=inputs[files[4]]['rows'];supplement={r['key']:r for r in inputs[files[5]]['rows']};supplement.update({r['key']:r for r in inputs[files[6]]['rows']});supplement.update({r['key']:r for r in inputs[files[7]]['rows']});vectors=[];mismatches=[]
def numbered(part):
 import re
 return [(m.group(1),m.group(2)) for m in re.finditer(r'^([1-4])\. (.+)$',part,re.M)]
def mapresponse(value,part):
 opts=numbered(part)
 if not opts:return value
 matches=[n for n,text in opts if text==value]
 if len(matches)!=1:raise ValueError(f'semantic statement not unique: {value}')
 return matches[0]
for r in public:
 if r['n']!=5 or not r['flag']:continue
 key=r['key'];level=r['level'];change=supplement.get(key,{});a=change.get('primarySemanticDecision',primary[key]['semanticDecision'])
 try:
  if level=='Junior':
   if r.get('options'):
    ix=[i for i,v in enumerate(r['options']) if v==a];assert len(ix)==1;a=f'o{ix[0]+1}'
   response=a
  elif level=='Middle':
   first,second=r['prompt'].split('Часть B',1);response=mapresponse(a,first)+';'+mapresponse(middle[key]['semanticDecision'],second)
  else:
   first,second=r['prompt'].split('Часть 2',1);response=a+';'+mapresponse(change.get('invariantSemanticDecision',senior[key]['semanticDecision']),second)
  vectors.append({'key':key,'skill':r['skill'],'level':level,'c':r['c'],'s':r['s'],'response':response,'primaryResponse':a,'primaryBasis':change.get('basis',primary[key]['method']) if 'primarySemanticDecision' in change else primary[key]['method'],'invariantBasis':None if level=='Junior' else change.get('basis',senior[key]['basis']) if level=='Senior' and 'invariantSemanticDecision' in change else (middle if level=='Middle' else senior)[key]['basis'],'semanticSupplement':change.get('key')})
 except Exception as e:mismatches.append({'key':key,'reason':str(e)})
result={'frozenAt':datetime.datetime.now(datetime.UTC).isoformat(),'status':'Frozen reference response vectors BEFORE B4 production scorer import/execution','sourceHashes':{f:hashlib.sha256((base/f).read_bytes()).hexdigest() for f in files},'provenance':'Semantic texts mapped to visible option ids/numbers only; no production oracle, generator.answer, scoreSkillAttempt, or score values imported to build these reference vectors. Pre-exposed primary/Senior subset declared in source worksheets.','scope':'324 task references, 18 modular programmes, 3 n5true forms. Additional n9falseMiddle reference check separate.','rows':vectors,'unmapped':mismatches,'profileResponsePolicy':{'known':'full independent reference response','junior-only-at-Middle-or-Senior':'known primary only, no mandatory independent invariant','middle-only-at-Senior':'known primary only, no Senior invariant','critical/noncritical gaps and weak unknown competency':'0 (or 0;0), explicit naive zero-work/count/choice misconception; no invisible scorer-key dependence','nontransferable':'corresponding independent Junior response of a fixed different module, no requested module invariant'},'limitations':['Synthetic declared knowledge profiles; no human or market calibration.','Gap models include systematic omission/zero-work error, not an empirical skill distribution.','Reference reasoning previously exposed to some authored Senior content; only designated independent Middle and remaining Senior selections carry blind provenance.']}
(base/'b4-reference-vectors-v5-frozen.json').write_text(json.dumps(result,ensure_ascii=False,indent=2),encoding='utf-8');print('vectors',len(vectors),'unmapped',len(mismatches));print(json.dumps(mismatches,ensure_ascii=False,indent=2));print(hashlib.sha256((base/'b4-reference-vectors-v5-frozen.json').read_bytes()).hexdigest());raise SystemExit(1 if mismatches else 0)

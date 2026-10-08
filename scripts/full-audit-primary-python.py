import json,re,contextlib,io
from pathlib import Path
src=Path('outputs/verification/full-audit-a01-a11-20261008/bank/public-only-scenarios-draft.json');d=json.loads(src.read_text());rows=[]
for r in d['rows']:
 if r['n']!=5 or not r['flag'] or r['skill']!='python' or r['level'] not in ['Junior','Middle']:continue
 stem=r['prompt'].split('Часть B')[0]
 codes=re.findall(r'```python\n(.*?)\n```',stem,re.S)
 if not codes:continue
 output=[]
 def capture(*args,sep=' ',end='\n',**kwargs):output.append('|'.join(str(a) for a in args))
 namespace={'print':capture};exec(compile(codes[0],r['key'],'exec'),namespace)
 rows.append({'key':r['key'],'semanticDecision':'|'.join(output),'method':'CPython execution of public-only fenced source; print values serialized per response contract','source':codes[0]})
Path('outputs/verification/full-audit-a01-a11-20261008/bank/reference-primary-python.json').write_text(json.dumps({'rows':rows},ensure_ascii=False,indent=2),encoding='utf-8');print(len(rows))

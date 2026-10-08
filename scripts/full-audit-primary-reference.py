import json,re,hashlib,datetime
from pathlib import Path
base=Path('outputs/verification/full-audit-a01-a11-20261008/bank');pub=json.loads((base/'public-only-scenarios-draft.json').read_text())['rows']
executed={r['key']:r for f in ['reference-primary-python.json','reference-primary-typescript.json'] for r in json.loads((base/f).read_text())['rows']}
# Independently authored calculation/state worksheet for public n5/true forms. No bank imports/keys/scorer.
man={
 ('sql','Junior'):[['6','2','2'],['3|2|12','2','7'],['1','0','2'],['43',None,None],['2|3','7','3|4'],[None,None,None]],
 ('sql','Middle'):[['6','3','1'],['3|2|12|2','1','7'],['0','12','2'],['45',None,None],['2|1','5','2|3'],[None,None,None]],
 ('react','Junior'):[['7','4',None],['5',None,'12'],['setup:5|cleanup:5|setup:6',None,None],[None,'0',None],[None,'Ada|0',None],[None,None,None]],
 ('react','Middle'):[['14','2',None],['8',None,'14'],['setup:5|cleanup:5|setup:6|cleanup:6',None,None],[None,'2',None],[None,'Lin|0',None],[None,None,None]],
 ('backend-engineering','Junior'):[['200',None,None],['45',None,None],['10','3',None],[None,'10',None],['200',None,None],['1|1|1',None,'10']],
 ('backend-engineering','Middle'):[['412',None,None],['43',None,None],['10','2',None],[None,'5',None],['200',None,None],['1|1|1',None,'40']],
 ('frontend-engineering','Junior'):[['4',None,None],['first|last|first|open',None,None],['50',None,'26'],['B:new|B:new','8',None],[None,None,None],[None,'B:ready|B:ready',None]],
 ('frontend-engineering','Middle'):[['0',None,None],['first|last|first|heading',None,None],['55',None,'24'],['B:new|B:new|B:new','9',None],[None,None,None],[None,'B:ready|B:ready|A:draft',None]],
}
markers={
 'python':{'4/2':r'^with open','5/2':r'^Проверить целочисленный'},
 'sql':{'3/1':r'^UPDATE.*0 строк','3/2':r'^Изменена 1 строка','5/0':r'^UNIQUE\(tenant_id,event_id\)','5/1':r'^customer_id NOT NULL','5/2':r'^NOT NULL'},
 'typescript':{'0/2':r'^assertNever обнаружит','1/2':r'^Схема не пройдена','2/1':r'^extends','4/2':r'^await Promise.all\(','5/2':r'^Для runtime'},
 'react':{'0/2':r'^setProfile\(p','1/1':r'^При \[\]','2/1':r'^Эффект возвращает','2/2':r'^Поздний A проверять','3/0':r'^При key=index после удаления draft может','3/2':r'^Объявить Editor','4/0':r'^value без onChange','4/2':r'^type="button"','5/0':r'^Разделяемый фильтр','5/1':r'^selectedItem вычислять','5/2':r'^Render-сбой — Error boundary'},
 'backend-engineering':{'0/1':r'^Сверить payload','0/2':r'^Новое необязательное','1/1':r'^Заказ и outbox','1/2':r'^Для обязательной','2/2':r'^Меньший token','3/0':r'^При доминирующих','3/2':r'^Для одного tenant','4/1':r'^Передать строку','4/2':r'^Приватный файл','5/1':r'^Сначала совместимое'},
 'frontend-engineering':{'0/1':r'^Разделяемый фильтр','0/2':r'^Совпавшая revision','1/1':r'^Ошибку связать','1/2':r'^Переход в раздел','2/1':r'^При длинном расчёте','3/2':r'^Ошибку устаревшего','4/0':r'^Версии DTO','4/1':r'^При смене аккаунта','4/2':r'^Сбой secondary','5/0':r'^Актуальный success','5/2':r'^Экспортировать все'},
}
# Prior handwritten, independently verified C04 reference primary results, explicitly pre-exposed, not a blind new oracle.
text=Path('tests/skill-senior-v4.test.ts').read_text(encoding='utf-8');obj=re.search(r'handwrittenSeniorPrimary:.*?= (\{.*?\n\});',text,re.S).group(1)
obj=re.sub(r'(?m)^  (python|sql|typescript|react):',r'  "\1":',obj).replace("'",'"');obj=re.sub(r',\s*}', '}',obj);sen=json.loads(obj)
rows=[];errors=[]
for r in pub:
 if r['n']!=5 or not r['flag']:continue
 key=r['key'];c,s=r['c'],r['s'];skill,level=r['skill'],r['level'];stem=r['prompt'].split('Часть B')[0]
 if level=='Senior':value=sen[skill][c][s];method='Previous handwritten primary reference, independently verified C04; pre-exposed, no blind claim';solution='Explicit primary state/type/SQL arithmetic result; invariant assessed separately'
 elif key in executed:value=executed[key]['semanticDecision'];method=executed[key]['method'];solution='Executing visible source under stated semantics'
 else:
  opts=r.get('options') or [m.group(2) for m in re.finditer(r'^([1-4])\. (.+)$',stem,re.M)]
  if opts:
   marker=markers.get(skill,{}).get(f'{c}/{s}')
   selected=[o for o in opts if marker and re.search(marker,o)]
   if len(selected)!=1:errors.append({'key':key,'options':opts,'marker':marker});continue
   value=selected[0];method='Handwritten semantic public-contract selection; no answer-key/scorer import';solution=marker
  else:
   value=man.get((skill,level),[[None]*3]*6)[c][s];method='Independent handwritten arithmetic/queue/focus/version state model';solution='Ordered stated operations, ignoring stale identities, observing row/field conditions'
 if value is None:errors.append({'key':key,'reason':'missing manualmodel'});continue
 rows.append({'key':key,'scope':'Part A / primary only or complete Junior','semanticDecision':value,'method':method,'basis':solution})
(base/'reference-primary-draft.json').write_text(json.dumps({'createdAt':datetime.datetime.now(datetime.UTC).isoformat(),'sourceSha256':hashlib.sha256((base/'public-only-scenarios-draft.json').read_bytes()).hexdigest(),'notBlind':'Author previously implemented bank; no production oracle/generator-answer/scorer used by this worksheet script. Handwritten Senior primary table was pre-exposed. Independent blind Middle/Senior invariant worksheets are separate.','rows':rows,'errors':errors},ensure_ascii=False,indent=2),encoding='utf-8')
print('rows',len(rows),'errors',len(errors));print(json.dumps(errors,ensure_ascii=False,indent=2))

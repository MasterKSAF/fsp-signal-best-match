"""AI-assisted team synthetic reference. Reads public prompts only, never TS oracle/scorer.
Python traces run in CPython; SQL runs in SQLite (DISTINCT ON is independently
expressed by MAX version in a correlated subquery). Frontend traces and choice
rationales below are manually reasoned from visible specifications.
This constructs frozen *answers*, not empirical human grade labels.
"""
import ast
import hashlib
import json
import re
import sqlite3
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
source = ROOT / 'docs/validation/visible-forms-v1.json'
forms = json.loads(source.read_text(encoding='utf-8'))['forms']

def python_trace(prompt):
    text = re.search(r'```python\n(.*?)\n```', prompt, re.S)[1]
    tree = ast.parse(text)
    calls = [node for node in tree.body if isinstance(node, ast.Expr) and isinstance(node.value, ast.Call)]
    namespace = {}
    if calls:
        for index, node in enumerate(tree.body):
            if node in calls:
                tree.body[index] = ast.copy_location(ast.Assign(targets=[ast.Name(id=f'_trace_{calls.index(node)}', ctx=ast.Store())], value=node.value), node)
        ast.fix_missing_locations(tree)
    exec(compile(tree, '<visible-generated-fixture>', 'exec'), namespace)
    keys = [f'_trace_{i}' for i in range(len(calls))] if calls else sorted([key for key in namespace if re.fullmatch(r'r\d+',key)], key=lambda key:int(key[1:]))
    return '|'.join(str(namespace[key]) for key in keys)

def sql_answer(prompt):
    query = re.search(r'```sql\n(.*?)\n```',prompt,re.S)[1]
    rows = lambda name: [tuple(v.strip() for v in item.split(',')) for item in re.findall(r'\(([^()]+)\)', prompt.split(name+':',1)[1].split('\n')[0].split(';')[0])]
    db = sqlite3.connect(':memory:')
    if 'payments:' in prompt and 'orders:' not in prompt:
        db.execute('CREATE TABLE payments(tenant_id INTEGER,status TEXT,amount INTEGER)')
        db.executemany('INSERT INTO payments VALUES(?,?,?)', rows('payments'))
    elif 'payment_attempts:' in prompt:
        db.execute('CREATE TABLE orders(tenant_id INTEGER,id TEXT,amount INTEGER)')
        db.execute('CREATE TABLE payment_attempts(tenant_id INTEGER,order_id TEXT,status TEXT)')
        db.executemany('INSERT INTO orders VALUES(?,?,?)', rows('orders'))
        db.executemany('INSERT INTO payment_attempts VALUES(?,?,?)',rows('payment_attempts'))
    elif 'payment_versions:' in prompt:
        db.execute('CREATE TABLE payment_versions(tenant_id INTEGER,order_id TEXT,version INTEGER,status TEXT,amount INTEGER)')
        db.executemany('INSERT INTO payment_versions VALUES(?,?,?,?,?)',[(int(a),b,int(c[1:]),d,int(e)) for a,b,c,d,e in rows('payment_versions')])
        tenant = int(re.search(r'tenant_id = (\d+)',query)[1])
        query = f"SELECT COALESCE(SUM(p.amount),0) FROM payment_versions p WHERE p.tenant_id={tenant} AND p.status='paid' AND p.version=(SELECT MAX(q.version) FROM payment_versions q WHERE q.tenant_id=p.tenant_id AND q.order_id=p.order_id)"
    elif 'orders.id:' in prompt:
        db.execute('CREATE TABLE orders(id INTEGER)');db.execute('CREATE TABLE payments(order_id INTEGER)')
        orders = re.search(r'orders.id: ([\d, ]+);',prompt)[1]
        payments = re.search(r'payments.order_id: ([\d, ]+)',prompt)[1]
        db.executemany('INSERT INTO orders VALUES(?)',[(int(v),) for v in orders.split(',')]);db.executemany('INSERT INTO payments VALUES(?)',[(int(v),) for v in payments.split(',')])
    elif 'cancellations (tenant,order_id):' in prompt:
        db.execute('CREATE TABLE orders(tenant INTEGER,id TEXT,amount INTEGER)')
        db.execute('CREATE TABLE cancellations(tenant INTEGER,order_id TEXT)')
        db.executemany('INSERT INTO orders VALUES(?,?,?)',rows('orders (tenant,id,amount)'))
        db.executemany('INSERT INTO cancellations VALUES(?,?)',[(int(a),None if b=='NULL' else b) for a,b in rows('cancellations (tenant,order_id)')])
    elif 'events (tenant,order_id,revision,id,status,amount):' in prompt:
        db.execute('CREATE TABLE events(tenant INTEGER,order_id TEXT,revision INTEGER,id INTEGER,status TEXT,amount INTEGER)')
        db.executemany('INSERT INTO events VALUES(?,?,?,?,?,?)',rows('events (tenant,order_id,revision,id,status,amount)'))
    else:
        raise ValueError(prompt)
    answer = str(db.execute(query).fetchone()[0]);db.close();return answer

choice_rules = {
 'backend-python': {
  ('A',2): ['Снять EXPLAIN', 'Снять trace', 'Снять граф pg_locks', 'Сопоставить trace', 'Остановить canary', 'Приостановить consumer'],
  ('A',4): ['Записать изменение', 'Передавать устойчивый', 'Сохранить заказ', 'Повторять outbox', 'Уникально закрепить', 'Зафиксировать шаг саги', 'Сохранить глобально устойчивый', 'Публиковать версионированный', 'Зафиксировать состояние саги'],
  ('B',2): ['Сопоставить частоту', 'По trace связать', 'Ввести admission control'],
  ('B',4): ['Добавить необязательное', 'Расширить схему', 'После сверки данных'],
 },
 'frontend-typescript': {
  ('A',2): ['Сопоставить long task', 'Профилировать сам расчёт', 'Разделить стоимость'],
  ('A',4): ['У общего владельца', 'Хранить сериализуемый', 'Разделить серверный'],
  ('B',2): ['Запустить независимые', 'После получения ID', 'Дедуплицировать запрос'],
  ('B',4): ['Проверить поле', 'Преобразовать и проверить', 'Версионировать формат'],
 }
}
choice_reason = {
 ('backend-python',2): 'Observe evidence before changing capacity; protect budgets/contain the incident rather than magnify retries or guess a database cause.',
 ('backend-python',4): 'Persist and scope identity/side effect atomically; acknowledge after effect; version migration keeps compatible readers/writers and rollback.',
 ('frontend-typescript',2): 'Change the measured bottleneck; preserve request dependencies, account-scoped authorization and measurable error handling.',
 ('frontend-typescript',4): 'Keep explicit ownership and contract boundaries; reject silent conflicting revisions and incompatible cache schemas.',
}

for form in forms:
    grade, family = form['grade'],form['form']
    refs = []
    n = int(re.search(r'value:(\d+)',form['cases'][0]['prompt'])[1]) if form['programId']=='frontend-typescript' and family=='A' else int(re.search(r'count:(\d+)',form['cases'][0]['prompt'])[1]) if form['programId']=='frontend-typescript' else None
    for slot, case in enumerate(form['cases']):
        if case['options']:
            opts = [option for option in case['options'] if any(option.startswith(prefix) for prefix in choice_rules[form['programId']][(family,slot)])]
            assert len(opts)==1,(form['id'],slot,opts)
            answer=opts[0]; reason=choice_reason[(form['programId'],slot)]
        elif form['programId']=='backend-python':
            answer=sql_answer(case['prompt']) if slot==1 else python_trace(case['prompt'])
            reason='Independent SQLite query/row reconstruction from visible data.' if slot==1 else 'Independent CPython execution of visible state transitions; ordered return values.'
        else:
            if slot==0:
                answer=(f'value:{n}|wait|wait' if grade=='Junior' else f'value:{n}|wait|retry'+ ('|stop' if grade=='Senior' else '')) if family=='A' else f'{n+1}|invalid|'+('version' if grade=='Senior' else 'invalid')
                reason='Discriminated union branches / runtime object-number-version checks traced independently.'
            elif slot==1:
                answer=str(n+5 if grade=='Junior' else n+9 if grade=='Middle' else n+11) if family=='A' else str(3*n+6 if grade=='Middle' else n+4)
                reason='A: sequential add/reset/stale/add; B: filter/map then sum active points; no mutation from ignored action.'
            elif slot==3:
                answer=f'first-{n}|last-{n}|'+(f'open-{n}' if grade=='Junior' else f'first-{n}|'+(f'heading-{n}' if grade=='Senior' else f'open-{n}')) if family=='A' else 'email:Ошибка|'+('heading' if grade=='Senior' else 'submit')+':Отправлено|'+('heading' if grade=='Senior' else 'submit')+':Отправлено'
                reason='Focus skips disabled, wraps, restores surviving trigger/fallback; stale feedback cannot replace current success.'
            else:
                answer=f'new-{n}|new-{n}|'+(f'late-{n}' if grade=='Junior' else f'new-{n}') if family=='A' else f'{n if grade=="Junior" else n+2}|{n+2}|{n+2}'
                reason='A: identity/current request plus mounted check; B: only current revision can roll back; a failed old update cannot destroy the newer one.'
        refs.append({'slot':slot,'family':case['family'],'answer':answer,'reason':reason,'publicPromptSha256':hashlib.sha256(case['prompt'].encode()).hexdigest()})
    form['reference']=refs
    del form['cases']

result={'version':'signal-grade-reference-v1','origin':'AI-assisted team-authored synthetic reference; no recruited people, no independent human experts.', 'independence':'Expected answers use only exported public prompts, CPython, SQLite and written semantic reasoning. This file does not read production oracle, scorer or requiredScore. Production assembly supplies public task inputs only.', 'forms':forms}
output=ROOT/'docs/validation/reference-answers-v1.json'
output.write_text(json.dumps(result,ensure_ascii=False,indent=2)+'\n',encoding='utf-8')
print(f'Frozen candidate reference contains {len(forms)*6} independently worked task answers; no evaluation has run yet.')

/** Independent execution of authored additional outcomes, not a human difficulty/equivalence study. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import vm from 'node:vm';
import { middleRequirementProbe } from '../artifacts/api-server/src/lib/skill-middle-outcomes';
import { buildSkillAttempt, scoreSkillAttempt, skillContentFamilyId, SKILL_BANK_VERSION, SKILL_RUBRIC_VERSION } from '../artifacts/api-server/src/lib/skill-module-bank';
const tasks: { id: string; code: string; expected: string }[] = [];
for (let s = 0; s < 3; s++) for (let n = 5; n <= 9; n++) for (const f of [false, true]) {
  const py = (c: number, code: string) => tasks.push({ id: `python/${c}/${s}/${n}/${f}`, code, expected: middleRequirementProbe('python', c, s, n, f).expected });
  py(0, `import copy\nrow=[${n}];a=[row,row];b=copy.deepcopy(a);b[0].append(9)\n${f ? 'a[0].append(8)' : ''}\nprint(str(len(a[1]))+'|'+str(len(b[1]))+'|'+str(b[0] is b[1]))`);
  py(1, `from itertools import islice,chain\nit=iter(range(1,${n + 4}));head=list(islice(it,${s + 1}));preview=next(it)\nprint(sum(${f ? 'it' : 'chain([preview],it)'}))`);
  py(2, `def factory():\n count=0\n def take(step):\n  nonlocal count\n  count+=step\n  return count\n return take\na=factory();b=${f ? 'a' : 'factory()'};a(${n});b(2)\nprint(str(a(1))+'|'+str(b(0)))`);
  py(4, `from contextlib import ExitStack\nlog=[]\nclass M:\n def __init__(self,name,suppress):self.name=name;self.suppress=suppress\n def __enter__(self):return self\n def __exit__(self,t,v,tb):log.append(self.name+(':'+('error' if t else 'clean')));return self.suppress\ntry:\n with ExitStack() as st:\n  st.enter_context(M('A',False));st.enter_context(M('B',${f ? 'True' : 'False'}));log.append('body');raise ValueError('x')\nexcept ValueError:log.append('caught')\nprint('|'.join(log))`);
  const sq = (c: number, code: string) => tasks.push({ id: `sql/${c}/${s}/${n}/${f}`, code: `import sqlite3\ndb=sqlite3.connect(':memory:')\n${code}`, expected: middleRequirementProbe('sql', c, s, n, f).expected });
  sq(0, `db.executescript('CREATE TABLE o(id int,amount int); CREATE TABLE i(order_id int); CREATE TABLE t(order_id int); INSERT INTO o VALUES(1,${n}),(2,${n + 1}); INSERT INTO i VALUES(1),(1),(2); INSERT INTO t VALUES(1),(1),(1),(2);')\na=db.execute('SELECT SUM(o.amount) FROM o JOIN i ON o.id=i.order_id JOIN t ON o.id=t.order_id').fetchone()[0]\nb=db.execute('SELECT SUM(amount) FROM o').fetchone()[0]\nprint(str(a)+'|'+str(b))`);
  sq(1, `db.executescript('CREATE TABLE g(total int,cnt int); INSERT INTO g VALUES(${n * 2},2),(${n + 4},1);')\na,b=db.execute('SELECT SUM(total),SUM(cnt) FROM g').fetchone();print(str(a)+'/'+str(b))`);
  sq(2, `db.executescript('CREATE TABLE l(id int); CREATE TABLE r(id int); INSERT INTO l VALUES(1),(2),(NULL); INSERT INTO r VALUES(1),(${f ? 'NULL' : '3'});')\na=db.execute('SELECT COUNT(*) FROM l WHERE id NOT IN(SELECT id FROM r)').fetchone()[0]\nb=db.execute('SELECT COUNT(*) FROM l WHERE id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM r WHERE r.id=l.id)').fetchone()[0]\nprint(str(a)+'|'+str(b))`);
  sq(4, `db.executescript('CREATE TABLE t(id int,k int,v int); INSERT INTO t VALUES(1,1,${n}),(2,1,2),(3,2,4);')\na=dict(db.execute('SELECT id,SUM(v) OVER(ORDER BY k RANGE BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM t'))\nb=dict(db.execute('SELECT id,SUM(v) OVER(ORDER BY k,id ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW) FROM t'))\nprint(str(a[1])+'|'+str(b[1])+'|'+str(a[3])+'|'+str(b[3]))`);
}
const runtime = spawnSync('C:/Users/Misha/AppData/Local/Programs/Python/Python311/python.exe', ['-c', `import sys,json,io,contextlib
tasks=json.load(sys.stdin);rows=[]
for t in tasks:
 b=io.StringIO()
 try:
  with contextlib.redirect_stdout(b):exec(compile(t['code'],'<independent-middle-probe>','exec'),{})
  rows.append({'id':t['id'],'pass':b.getvalue().strip()==t['expected']})
 except Exception as e:rows.append({'id':t['id'],'pass':False,'error':type(e).__name__})
print(json.dumps(rows))`], { input: JSON.stringify(tasks), encoding: 'utf8', maxBuffer: 2_000_000 });
assert.equal(runtime.status, 0, runtime.stderr);
const rows = JSON.parse(runtime.stdout) as { id: string; pass: boolean }[];
assert.deepEqual(rows.filter(r => !r.pass), []);
const sqlContracts = spawnSync('C:/Users/Misha/AppData/Local/Programs/Python/Python311/python.exe', ['-c', `import sqlite3,json
def insertions(key,one_tenant=False):
 db=sqlite3.connect(':memory:');db.execute('CREATE TABLE e(tenant_id INTEGER NOT NULL'+(' CHECK(tenant_id=1)' if one_tenant else '')+',event_id INTEGER NOT NULL,UNIQUE('+key+'))');ok=[]
 for pair in ([(1,7),(1,7)] if one_tenant else [(1,7),(2,7),(1,7)]):
  try:db.execute('INSERT INTO e VALUES(?,?)',pair);ok.append(True)
  except sqlite3.IntegrityError:ok.append(False)
 return ok
checks={
 'historic_single_tenant_pair_and_global_both_valid':insertions('tenant_id,event_id',True)==insertions('event_id',True)==[True,False],
 'new_global_key_rejects_cross_tenant_repeat':insertions('event_id')==[True,False,False],
 'new_global_pair_key_violates_contract':insertions('tenant_id,event_id')!=[True,False,False],
 'new_local_pair_key_accepts_independent_tenants':insertions('tenant_id,event_id')==[True,True,False],
 'new_local_global_key_rejects_required_distinct_event':insertions('event_id')!=[True,True,False]}
for scope in ['global','local']:
 db=sqlite3.connect(':memory:');db.execute('CREATE TABLE e(tenant int NOT NULL,event int NOT NULL,hash text NOT NULL,result text NOT NULL,UNIQUE('+('event' if scope=='global' else 'tenant,event')+'))');db.commit()
 def process(h,crash=False):
  db.execute('BEGIN');row=db.execute('SELECT hash,result FROM e WHERE tenant=1 AND event=7').fetchone()
  if row:db.rollback();return row[1] if row[0]==h else 'conflict'
  db.execute('INSERT INTO e VALUES(1,7,?,?)',(h,'R'))
  if crash:db.rollback();return 'crash'
  db.commit();return 'R'
 checks[scope+'_crash_claim_rolled_back']=process('P',True)=='crash' and db.execute('SELECT COUNT(*) FROM e').fetchone()[0]==0
 checks[scope+'_retry_and_payload_binding']=(process('P'),process('P'),process('Q'))==('R','R','conflict') and db.execute('SELECT COUNT(*) FROM e').fetchone()[0]==1
assert all(checks.values());print(json.dumps(checks))`], { encoding: 'utf8', maxBuffer: 100000 });
assert.equal(sqlContracts.status, 0, sqlContracts.stderr);
let tsCount = 0, reactModelCount = 0;
for (let s = 0; s < 3; s++) for (let n = 5; n <= 9; n++) for (const f of [false, true]) {
  const input = { n, f };
  const trace = await vm.runInNewContext(`(async()=>{let state={n};const captured=state;const read=()=>state.n;const log=[];const p=Promise.resolve().then(()=>log.push(captured.n,read()));if(f){state={n:n+2};captured.n+=1}else{state.n+=2};await p;return log.join('|')})()`, input);
  assert.equal(trace, middleRequirementProbe('typescript', 1, s, n, f).expected); tsCount++;
  const normalized = vm.runInNewContext(`(()=>{const rows=[{id:2,revision:n},{id:1,revision:n+1},{id:2,revision:f?n+2:n-1}];const byId=new Map();for(const r of rows){const old=byId.get(r.id);if(!old||r.revision>old.revision)byId.set(r.id,r)};return[byId.get(1).revision,byId.get(2).revision,rows.length].join('|')})()`, input);
  assert.equal(normalized, middleRequirementProbe('typescript', 3, s, n, f).expected); tsCount++;
  const sharing = vm.runInNewContext(`(()=>{const old={a:{n},b:{n:2}};const next={...old,a:{...old.a,n:n+1}};next.a.n+=1;if(f)next.b.n+=1;return[old.a.n,next.a.n,old.b.n,old.b===next.b].join('|')})()`, input);
  assert.equal(sharing, middleRequirementProbe('typescript', 5, s, n, f).expected); tsCount++;
  const apply = (state: number, updates: (number | ((v: number) => number))[]) => updates.reduce<number>((v, update) => typeof update === 'number' ? update : update(v), state);
  const first = apply(n, [v => v + 1, n + 2, v => v * 2]); const second = apply(first, [f ? n + 3 : (v: number) => v + 3]);
  assert.equal(`${first}|${second}`, middleRequirementProbe('react', 0, s, n, f).expected); reactModelCount++;
}
const repro = ['independent-react-34', 'independent-sql-6'].map(seed => {
  const skill = seed.includes('react') ? 'react' : 'sql'; const form = buildSkillAttempt(skill, 'Middle', seed);
  const all = Object.fromEntries(Object.entries(form.oracles).map(([id, o]) => [id, o.expected])); const onlyA = Object.fromEntries(Object.entries(form.oracles).map(([id, o]) => [id, o.parts![0]!.expected]));
  assert.equal(scoreSkillAttempt(form.cases, form.oracles, all, form.policy).passed, true); assert.equal(scoreSkillAttempt(form.cases, form.oracles, onlyA, form.policy).passed, false);
  const exposure = new Map(form.cases.map(c => [c.templateId.replace('-v2:', '-v1:').replace(':Middle:', ':Junior:'), 100]));
  const rotated = buildSkillAttempt(skill, 'Middle', seed, { personalExposures: exposure });
  assert.ok(rotated.cases.every((c, i) => skillContentFamilyId(c.templateId) !== skillContentFamilyId(form.cases[i]!.templateId)));
  return { seed, skill, newFormCases: form.cases.map(c => ({ templateId: c.templateId, contentFamilyId: c.contentFamilyId, middleOutcome: c.middleOutcome, critical: c.critical })), baseOnlyPassed: false, fullSnapshotPassed: true, sixFamiliesRotatedAfterJunior: true };
});
const report = { passed: true, bankVersion: SKILL_BANK_VERSION, rubricVersion: SKILL_RUBRIC_VERSION, counts: { pythonAdditional: rows.filter(r => r.id.startsWith('python/')).length, sqliteAdditional: rows.filter(r => r.id.startsWith('sql/')).length, sqliteConstraintAndTransactionContracts: Object.keys(JSON.parse(sqlContracts.stdout)).length, javascriptAdditional: tsCount, reactQueueModel: reactModelCount }, sqlContracts: JSON.parse(sqlContracts.stdout), repro, limitations: ['SQLite probes verify the explicit SQL data/constraint contracts; they do not certify a specific DBMS.', 'React queue probe is an independent pure semantic model, not a real mounted React renderer.', 'Additional conceptual choices were independently reviewed in source; not every scenario runs as a real application.', 'No human difficulty/equivalence or hiring validity calibration is claimed.'], measuredAt: new Date().toISOString() };
await mkdir('outputs/verification/candidate-workspace-skill-matrix-20261008', { recursive: true });
await writeFile('outputs/verification/candidate-workspace-skill-matrix-20261008/skill-middle-v2-probes.json', JSON.stringify(report, null, 2));
console.log(JSON.stringify({ passed: true, counts: report.counts }));
